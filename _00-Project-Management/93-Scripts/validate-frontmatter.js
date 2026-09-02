#!/usr/bin/env node
/**
 * validate-frontmatter.js
 *
 * Lints YAML frontmatter across the PM folder against the rule set
 * (R0–R15, R15b, R16, R17, R18, R19, R21, R22, R23) defined in 90-Standards/SOP.md and the
 * CLAUDE.md project rules.
 *
 * Usage: node _00-Project-Management/93-Scripts/validate-frontmatter.js
 *        npm run pm:lint    (wired in package.json)
 *        node ...validate-frontmatter.js --fixtures-dir <dir>   (scan an isolated
 *            fixtures dir instead of the PM folder — used by R15 test fixtures)
 *
 * Exit codes:
 *   0 — no violations
 *   1 — violations found (prints numbered report)
 *   2 — script error (couldn't read PM folder, etc.)
 *
 * Dependency-free — uses only Node.js stdlib (fs, path).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { parseFrontmatter, stripQuotes } = require('./lib/frontmatter');
const promptLint = require('./lib/prompt-lint');
// STORY-27.3.02 / ADR-0141 — the shared shape-agnostic 41-Reports reader.
const reportTree = require('./lib/report-tree.js');
// STORY-28.3.01 / ADR-0175 — THE artefact-id grammar. This file used to carry four
// private copies of it (the filename reader, W6's prose scanner, R17's `depends_on`
// shape and R28's folder-scope test); the dashboard and the backlog board carried two
// more — SEVEN in total. See lib/artefact-id.js for what each one did before
// consolidation and which THREE disagreed. (R28's was the one the first freeze
// missed; corrected 2026-08-05 by the E28-P2 review remediation.)
const artefactId = require('./lib/artefact-id.js');
// STORY-28.3.03 / BUG-20260804-01 — the MONITOR.md anchor contract R31 checks, shared with
// the two writers that resolve those anchors.
const monitorAnchors = require('./lib/monitor-anchors.js');

// ---------- Config ----------

const STATUS_ENUM = new Set([
  'not-started', 'ready', 'in-progress', 'in-review',
  'done', 'blocked', 'wontfix', 'duplicate', 'archived'
]);

const ESTIMATE_ENUM = new Set(['XS', 'S', 'M', 'L', 'XL']);

const TERMINAL_STATUSES = new Set(['done', 'wontfix', 'duplicate', 'archived']);

// WIP limits per SOP §5 — applied across stories only (epics/features have no WIP).
const WIP_LIMITS = {
  'in-progress': 2,
  'in-review': 3,
  'blocked': 5,
};

// Valid ai_review values per SOP §7 + STORY template frontmatter contract.
// `pending` is allowed while status != done; only `done` stories must have a
// terminal value here.
// BACKLOG-0123 / ADR-0121 — `deferred-chat-review` is the fourth terminal token.
// SOP §18's subagent-per-batch pattern dispatches ONE independent reviewer over a
// whole chat AFTER the chat finishes, so at the instant a story inside that chat
// flips `done` the review is genuinely pending-but-scheduled. The three original
// terminals cannot express that, and CHAT-04 resolved it by writing
// `skipped-trivial` with a reason saying, in as many words, that the review was
// not skipped — a lint-clean lie that reads as a real skip a year from now, AND
// one that R15b exempts from carrying an artefact, so the story ends up
// permanently unlinked to the review that did happen.
//
// It is NOT an escape hatch: `ai_review_deferred_to` must name the reviewing
// chat/phase (enforced in R14 below), so every deferral is addressed to something
// specific and is auditable as still-outstanding.
const AI_REVIEW_TERMINAL = new Set([
  'completed', // matched by prefix: completed-YYYY-MM-DD
  'skipped-trivial',
  'deferred-chat-review',
  'n-a',
]);

// R15b rollout cutoff (ADR-0013). The "completed review must carry an
// ai_review_artefact" presence check only fires for stories whose created_at date is
// on or after this date. Stories created earlier are grandfathered — they closed
// legitimately before AI-CODE-REVIEW.template.html existed and must not retroactively
// fail pm:lint. Do NOT "tidy away" this constant; see ADR-0013 for the rationale and the
// review trigger for when it can be removed.
const R15B_PRESENCE_CUTOFF = '2026-05-24';

// Resolve PM folder relative to this script's location.
const PM_ROOT = path.resolve(__dirname, '..');

// Resolve logical PM sub-folder names through the layout map (full / flattened /
// custom). PATHS.<logical> → physical folder name for this project. See lib/pm-paths.js.
const { loadPaths, SCAN_KEYS } = require('./lib/pm-paths');
const PATHS = loadPaths(PM_ROOT).map;

// Artefact-bearing folders the linter scans. Map the canonical SCAN_KEYS order
// (backlog, epics, features, stories, testplans, bugs, decisions) through the layout
// map so the full layout yields exactly the 7 historical names in the same order,
// while a flattened/custom layout yields its own folder names. We map all 7 keys
// (rather than using scanDirs, which drops non-existent dirs) so behaviour is
// unchanged — walk() already skips folders that don't exist on disk.
const SCAN_DIRS = SCAN_KEYS.map(k => PATHS[k]);

// ---------- CLI args ----------
// --fixtures-dir <path>  scan a flat fixtures dir instead of PM_ROOT; resolve
//                        R15's html_artefacts paths relative to that dir
//                        (lets tests stay self-contained, no real repo files).
// --manifest-dir <path>  override the base dir for manifest-parity checks (version-parity gate).
//                        If absent, uses repo root. Allows testing with fixture manifests.
// --prompt-lint-target <file>  lint a SINGLE file against the prompt-lint phrase list
//                        (STORY-24.1.02) and exit — bypasses the frontmatter corpus
//                        scan entirely (the target fixture carries no YAML frontmatter).
//                        The fixture-driven test seam for TESTPLAN-24.1.02 TC-01.
// --retro-log <path>     override the retro ledger R27 reads. Set explicitly, this is ALSO the
//                        only way R27 runs under --fixtures-dir: a fixture corpus checked
//                        against the LIVE ledger would flag every fixture story, which would
//                        break three sibling suites that assert "0 violations" in fixtures mode.
let FIXTURES_DIR = null;
let MANIFEST_DIR = null;
let PROMPT_LINT_TARGET = null;
let RETRO_LOG = null;
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--fixtures-dir') {
      const val = argv[i + 1];
      // Guard: a present-but-valueless flag must NOT silently fall back to scanning
      // the real PM folder (a typo'd flag would otherwise run against production data).
      if (!val || val.startsWith('--')) {
        console.error('✗ --fixtures-dir requires a directory path argument');
        process.exit(2);
      }
      FIXTURES_DIR = path.resolve(val);
    } else if (argv[i] === '--manifest-dir') {
      const val = argv[i + 1];
      if (!val || val.startsWith('--')) {
        console.error('✗ --manifest-dir requires a directory path argument');
        process.exit(2);
      }
      MANIFEST_DIR = path.resolve(val);
    } else if (argv[i] === '--retro-log') {
      const val = argv[i + 1];
      // Guarded like every other value flag: a valueless `--retro-log` must not silently fall
      // back to the production ledger while the caller believes it pointed elsewhere.
      if (!val || val.startsWith('--')) {
        console.error('✗ --retro-log requires a file path argument');
        process.exit(2);
      }
      RETRO_LOG = path.resolve(val);
    } else if (argv[i] === '--prompt-lint-target') {
      const val = argv[i + 1];
      if (!val || val.startsWith('--')) {
        console.error('✗ --prompt-lint-target requires a file path argument');
        process.exit(2);
      }
      PROMPT_LINT_TARGET = path.resolve(val);
    }
  }
}

// Base for `rel()` paths in messages.
const REL_BASE = FIXTURES_DIR || PM_ROOT;
// Repo root used to resolve R15's html_artefacts entries.
const REPO_ROOT = FIXTURES_DIR || path.resolve(PM_ROOT, '..');

// ---------- Helpers ----------

function walk(dir, list = []) {
  if (!fs.existsSync(dir)) return list;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // Never descend into a `__fixtures__/` directory during a corpus walk — those hold
    // intentionally-invalid R17/R18 test artefacts that must NOT pollute the real corpus
    // (TC-08 stays 0 violations). Fixtures are validated in isolation via --fixtures-dir,
    // which is pointed *inside* __fixtures__ (e.g. __fixtures__/positive), so this guard
    // skips the parent during a normal walk but never the fixture subdir under test.
    if (entry.isDirectory() && entry.name === '__fixtures__') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, list);
    else if (entry.isFile() && entry.name.endsWith('.md')) list.push(full);
  }
  return list;
}


function isISO8601WithOffset(s) {
  if (typeof s !== 'string' || !s) return false;
  // YYYY-MM-DDTHH:MM:SS+HH:MM or ...Z
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(s);
}

// e.g. "STORY-01.2.07-foo-bar.md" -> "STORY-01.2.07"
//      "BUG-20260520-03-symptom.md" -> "BUG-20260520-03"
//      "ADR-0007-postgres-jsonb.md" -> "ADR-0007"
//      "RELEASE-v2.7.1.md" -> "RELEASE-v2.7.1"
//
// BUG-20260803-01. The RELEASE arm here was `RELEASE-v\d+\.\d+` (TWO segments) while
// generate-dashboard.js has carried a three-segment form all along — the same id parsed
// two different ways by two files. R10 therefore read RELEASE-v2.7.1.md as id
// "RELEASE-v2.7" and reported a mismatch against its own correct frontmatter. It stayed
// invisible because `releases` was not in SCAN_KEYS, so this function was never handed a
// release filename; adding it (ADR-0132) made the latent defect live on all 15 records at
// once. The fix then asked, in a comment, that the pair be kept byte-identical — which is
// a request, not a mechanism. STORY-28.3.01 supplies the mechanism: both readers now call
// the same function, so "identical" is structural rather than remembered.
const fileIdFromName = artefactId.fileIdFromName;

function rel(p) {
  return path.relative(REL_BASE, p).replace(/\\/g, '/');
}

// R17 resolves `depends_on:` against the REAL story corpus under PM_ROOT/32-Stories/ —
// NOT against the current scan set. This matters under --fixtures-dir: a positive fixture
// declares `depends_on: [STORY-02.1.01]` (a real story), which lives outside the isolated
// fixtures dir. Resolving against the real corpus lets that fixture pass while a bogus
// id (STORY-99.9.99) still fails. The `__fixtures__/` guard in walk() keeps fixture
// stories out of this index, so a fixture can never satisfy another fixture's depends_on.
// Computed once, lazily, and cached.
let _realStoryIds = null;
function realStoryIds() {
  if (_realStoryIds) return _realStoryIds;
  _realStoryIds = new Set();
  for (const f of walk(path.join(PM_ROOT, PATHS.stories))) {
    const id = fileIdFromName(f);
    if (id && id.startsWith('STORY-')) _realStoryIds.add(id);
  }
  return _realStoryIds;
}

// Shared repo-relative-path safety + existence check used by R15 (html_artefacts),
// R15b (ai_review_artefact), and R16 (html_context). A path field value must be a
// repo-relative path inside the repo (no absolute, no `..` traversal) AND resolve to an
// existing file. `label` is the human name used in the violation message (e.g.
// "html_artefacts entry", "ai_review_artefact", "html_context entry"). Paths resolve
// against REPO_ROOT (= the fixtures dir under --fixtures-dir). See BACKLOG-0023 / ADR-0013.
function checkRepoRelativePath(filepath, rule, label, value) {
  const p = String(value).trim();
  if (!p) return;
  const abs = path.resolve(REPO_ROOT, p);
  const within = path.relative(REPO_ROOT, abs);
  if (path.isAbsolute(p) || within.startsWith('..')) {
    violate(filepath, rule,
      `${label} '${p}' must be a repo-relative path inside the repo ` +
      `(no absolute paths, no '..' traversal)`);
    return;
  }
  if (!fs.existsSync(abs)) {
    violate(filepath, rule,
      `${label} '${p}' does not point at an existing file (resolved to ${rel(abs)})`);
  }
}

// R18 path-safety check for `files_touched:` entries. Unlike R15/R16's
// checkRepoRelativePath, this is a FORMAT-only check — it must NOT require the file to
// exist. files_touched declares the paths a story INTENDS to modify; at planning time
// those files may not exist yet (the story creates them). So the contract is purely:
// a repo-relative path — reject absolute paths, a leading '/', and any '..' traversal.
// Handles both POSIX (/) and Windows (\, drive-letter) absolute forms so the rule fires
// identically regardless of the OS the validator runs on. See SOP §11 / ADR-0020.
function checkFilesTouchedPath(filepath, value) {
  const p = String(value).trim();
  if (!p) return;
  // Leading slash (POSIX-absolute or root-relative) or any backslash-rooted form.
  const leadingSlash = p.startsWith('/') || p.startsWith('\\');
  // Windows drive-absolute, e.g. C:\ or C:/.
  const driveAbsolute = /^[A-Za-z]:[\\/]/.test(p);
  // '..' as a standalone path segment (start, middle, or end) — split on both separators.
  const hasDotDot = p.split(/[\\/]/).some(seg => seg === '..');
  if (leadingSlash || driveAbsolute || path.isAbsolute(p) || hasDotDot) {
    violate(filepath, 'R18',
      `files_touched entry '${p}' must be a repo-relative path ` +
      `(no absolute paths, no leading '/', no '..' traversal)`);
  }
}

// R23 — `usage_estimate:` shape check (STORY-21.2.02 / ADR-0079). Pure function, no
// filesystem access, exported for unit tests. `usage_estimate` is an OPTIONAL
// approximate TOTAL token figure (input+output+cache_read+cache_creation summed) a
// story/backlog item is expected to consume when executed — a single positive
// integer, never a coarse band, so `usage-reconcile.js` projections can sum it
// directly. SAME STANCE AS R19: shape only — whether the number is a realistic
// estimate is NEVER judged here. Returns a violation message string when the shape
// is invalid, or null when the value is absent/empty/valid.
function checkUsageEstimateShape(value) {
  if (value === undefined || value === null) return null; // field absent — fine, optional
  const str = String(value).trim();
  if (str === '') return null; // present but empty — fine, optional
  if (!/^[1-9]\d*$/.test(str)) {
    return `usage_estimate must be a positive integer (approximate TOTAL tokens — ` +
      `input+output+cache_read+cache_creation summed) when present (got '${value}'). ` +
      `Shape only — feasibility is never judged (same stance as R19). Leave empty/absent if unknown.`;
  }
  return null;
}

// ---------- W8 — timestamp sanity (ADR-0123) ----------
// Pure function, no filesystem access, exported for unit tests — same seam as
// checkUsageEstimateShape (R23). Returns an ARRAY of warning message strings (possibly
// empty); the caller routes each through warn(), never violate().
//
// WHY THIS EXISTS: story timestamps were fabricated twice in the 2026-08-02 autopilot run —
// 14 in total, 8 of them dated in the FUTURE. Both incidents were caught only because a human
// noticed a clock apparently running backwards. Nothing in the validator ever compared a
// timestamp to the wall clock or to its own sibling: R2 checks that `created_at` PARSES,
// R3/R4/R5 check that the fields are PRESENT or ABSENT for a status, and no rule has ever
// checked that the values are possible. A fabricated `completed_at` therefore reads as
// authoritative on the board, in MONITOR, and in every cycle-time figure derived from it.
//
// PARSE, NEVER STRING-COMPARE. These are ISO 8601 with offsets, so
// '2026-08-02T00:30:00+01:00' is EARLIER than '2026-08-01T23:45:00Z' despite sorting after it
// lexically. Every comparison below goes through Date.parse (epoch ms), which resolves the
// offset. A naive string compare would manufacture false positives at every offset boundary
// and, worse, miss real inversions in the other direction.
//
// FIVE arms:
//   1. `completed_at` in the future
//   2. `started_at` in the future
//   3. `completed_at` earlier than `started_at`
//   4. `completed_at` set while `status` is not terminal (see the not-started carve-out below)
//   5. a present-but-unparseable `started_at`/`completed_at` — the anti-vacuity arm. Without
//      it, arms 1-4 are silently skipped by any value Date.parse cannot read, so writing
//      garbage would DEFEAT the check rather than trip it. (No such value exists in the
//      corpus today; the arm exists so the rule is total rather than true-of-today's-data.)
//
// Warn-tier (ADR-0061), never fatal: a wrong timestamp is a reporting defect, not a broken
// artefact, and making it fatal would let one bad clock block a merge.
const W8_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

function checkTimestampSanity(fm, nowMs = Date.now()) {
  const out = [];
  if (!fm) return out;

  // Present-but-empty is "absent" everywhere else in this validator; keep that meaning.
  const raw = (k) => {
    const v = fm[k];
    if (v === undefined || v === null) return '';
    return String(v).trim();
  };
  const started = raw('started_at');
  const completed = raw('completed_at');

  // Arm 5 — parseability. `Date.parse` accepts a lot of non-ISO input, so the ISO shape is
  // required first (the same predicate R2 applies to created_at) and THEN parsed.
  const ms = {};
  for (const [key, val] of [['started_at', started], ['completed_at', completed]]) {
    if (!val) { ms[key] = null; continue; }
    const t = isISO8601WithOffset(val) ? Date.parse(val) : NaN;
    if (Number.isNaN(t)) {
      ms[key] = null;
      out.push(`\`${key}\` is '${val}', which is not a parseable ISO 8601 timestamp with an ` +
        `offset (e.g. 2026-08-02T14:32:00+01:00). The timestamp-sanity comparisons are skipped ` +
        `for this field, so an unreadable value hides a wrong one.`);
    } else {
      ms[key] = t;
    }
  }

  // Arms 1 and 2 — a timestamp the clock has not reached. The tolerance absorbs ordinary
  // machine-to-machine clock skew (a story closed "now" on a CI box a minute ahead of the
  // author's laptop is not fabrication); it is far below the hours-to-days error the two real
  // incidents produced, so it costs nothing in detection.
  const horizon = nowMs + W8_FUTURE_TOLERANCE_MS;
  for (const key of ['completed_at', 'started_at']) {
    if (ms[key] !== null && ms[key] > horizon) {
      out.push(`\`${key}\` is '${raw(key)}', which is in the FUTURE relative to now ` +
        `(${new Date(nowMs).toISOString()}). A timestamp the clock has not reached was not ` +
        `observed — it was written by hand or copied. Re-derive it from the actual event.`);
    }
  }

  // Arm 3 — an artefact that finished before it started.
  if (ms.started_at !== null && ms.completed_at !== null && ms.completed_at < ms.started_at) {
    out.push(`\`completed_at\` ('${completed}') is EARLIER than \`started_at\` ('${started}'). ` +
      `Compared as instants, not as strings, so this is a real inversion and not an offset ` +
      `artefact. One of the two is wrong.`);
  }

  // Arm 4 — a completion stamp on work that is not finished.
  // `not-started` is deliberately excluded: R5 already VIOLATES on exactly that combination,
  // and a warn-tier duplicate of a fatal rule adds noise to every run without adding signal.
  // The statuses this arm actually covers — ready / in-progress / in-review / blocked — are
  // the ones nothing else checks, and they are where a copied-forward timestamp hides.
  if (completed && fm.status && fm.status !== 'not-started' && !TERMINAL_STATUSES.has(fm.status)) {
    out.push(`\`completed_at\` is set ('${completed}') but status is '${fm.status}', which is ` +
      `not a terminal state (${[...TERMINAL_STATUSES].join('/')}). Either the work is done and ` +
      `the status is stale, or the stamp was written before the work finished.`);
  }

  return out;
}

// ---------- W12 — parent-status rollup mirrors (STORY-35.3.05 / ADR-0278) ----------
// The R21 family's missing mirrors, warn-tier (ADR-0061 channel, tag W12):
//   - FEATURE all-children-terminal arm: every child story terminal with >=1 'done' but the
//     feature's own status non-terminal → the feature lags its children (the 18-features
//     hand sweep of 2026-08-27, commit 652fb172, made mechanical).
//   - FEATURE reverse arm: status 'done' over non-terminal child stories (mirrors R21 case 2).
//   - ANY-CHILD-STARTED arm, BOTH tiers: a 'not-started' feature or epic with any child beyond
//     'not-started'/'ready' — the arm that would have caught EPIC-33 at 32/33 done. A 'blocked'
//     sibling does NOT suppress it (BACKLOG-0206's EPIC-31 case: 6 done + 1 blocked under a
//     not-started epic must still flag).
//
// TERMINAL-PARENT GUARD (ADR-0278): a parent whose OWN status is terminal
// (done/wontfix/duplicate/archived) is settled, never stale — a 'wontfix' feature over 'done'
// children is the FEAT-15.1 false-positive class and must NOT be flagged. Only the reverse arm
// looks at a terminal parent, and only at 'done'. Do NOT copy R21's `!== 'done'` predicate here.
//
// Suppression (ADR-0278 sub-ruling 3): the any-child-started arm stays quiet when the
// all-children-terminal condition holds for the same parent — the feature-tier W12 arm (or,
// at the epic tier, fatal R21 case 1) already names that drift; one finding per parent per
// problem.
//
// PURE — no filesystem, exported for the paired unit test
// (tests/parent-status-rollup.test.js). childStatuses mirrors R21's index shape:
// [{ id, status }]. Zero-children parents are never flagged (R21's existing guard, kept).
// The epic tier emits ONLY the any-child-started arm from here — the epic
// all-terminal/reverse arms already exist at fatal tier as R21 and are not duplicated.
function checkParentStatusRollup(parentType, fm, childStatuses) {
  const out = [];
  if (!fm || !fm.status) return out;
  if (!Array.isArray(childStatuses) || childStatuses.length === 0) return out;
  const label = parentType === 'epic' ? 'Epic' : 'Feature';
  const id = fm.id || '(no id)';
  const isTerminal = (s) => TERMINAL_STATUSES.has(s);
  const allTerminal = childStatuses.every(c => isTerminal(c.status));
  const anyDone = childStatuses.some(c => c.status === 'done');
  const nonTerminal = childStatuses.filter(c => !isTerminal(c.status));
  const startedChildren = childStatuses.filter(
    c => c.status !== 'not-started' && c.status !== 'ready');

  if (parentType === 'feature') {
    // Feature all-children-terminal arm — the terminal-parent guard is the
    // `!isTerminal(fm.status)` conjunct (mutant anchor: deleting it flags wontfix parents).
    if (allTerminal && anyDone && !isTerminal(fm.status)) {
      out.push(`${label} '${id}' has all child stories in terminal states ` +
        `(${childStatuses.map(c => c.status).join(', ')}) with at least one 'done', but its own ` +
        `status is '${fm.status}' (expected 'done'). Run \`npm run pm:reconcile -- --apply\` to ` +
        `derive it, or reconcile by hand.`);
    }
    // Feature reverse arm — 'done' over non-terminal children (mirrors R21 case 2).
    if (fm.status === 'done' && nonTerminal.length > 0) {
      out.push(`${label} '${id}' has status='done' but the following child stories are ` +
        `non-terminal: ${nonTerminal.map(c => c.id + ' (' + c.status + ')').join(', ')}. ` +
        `Either complete the children or change the ${parentType} status to reflect the actual state.`);
    }
  }

  // Any-child-started arm, both tiers. Suppressed when the all-terminal condition holds —
  // that drift is already named by the feature arm above / fatal R21 case 1 at the epic tier.
  if (fm.status === 'not-started' && startedChildren.length > 0 && !(allTerminal && anyDone)) {
    out.push(`${label} '${id}' is 'not-started' but child ` +
      `${startedChildren.map(c => c.id + ' (' + c.status + ')').join(', ')} ` +
      `${startedChildren.length === 1 ? 'has' : 'have'} moved beyond 'not-started'/'ready' — ` +
      `work under this ${parentType} has started. Run \`npm run pm:reconcile -- --apply\` to ` +
      `derive the parent status, or update it by hand.`);
  }

  return out;
}

// ---------- W8 (git arm) — a timestamp ahead of the commit that RECORDED it (ADR-0158) ----
//
// The five arms above compare to `now`. `now` moves; the defect does not. A `completed_at` of
// 13:38 written into a file whose recording commit is 11:58 is FALSE the moment it is written
// and INVISIBLE to the arms above within the hour — after which nothing can ever see it again.
// Four artefacts in this repository were in exactly that state when the E26-CHAT-04 review
// found them by hand, and three of them had less than an hour left before they became
// permanently undetectable.
//
// The comparison that does not decay is against the artefact's OWN LAST COMMIT: git recorded
// these bytes at instant T, so every timestamp inside them describes an event that had already
// happened at T. A value after T was not observed — it was typed.
//
// ONLY FOR A FILE THAT IS CLEAN VS HEAD. A file with uncommitted changes has NOT been recorded
// by any commit yet, so its last-commit time says nothing about its current contents — and
// comparing them would fire on every artefact anyone is legitimately editing right now, which
// is the false-positive flood that gets a warn rule switched off. Untracked files are skipped
// for the same reason.
//
// ============================================================================
// R29 — THE SAME CHECK, AT THE BLOCKING TIER, FOR ARTEFACTS CREATED FROM THE ACTIVATION DATE
// ============================================================================
// (STORY-28.2.03 / BACKLOG-0145 / ADR-0170.)
//
// W8's git arm has been advisory since ADR-0158, and advisory did not stop it. Timestamp
// fabrication recurred through every phase that ran with the warning live, and the drift grew
// rather than shrank: 27 minutes at the first incident, 5.6 hours by BACKLOG-0145. On the corpus
// as this rule landed, 181 findings stood across 95 files — including ten artefacts written
// EARLIER THE SAME DAY, one of them stamped 30 minutes after the commit that recorded it. A
// warning nobody has to act on is a warning nobody acts on; this file carries hundreds of them.
//
// WHAT CHANGES IS THE TIER, NOT THE CHECK. `checkTimestampVsCommit` is untouched: same fields,
// same 5-minute tolerance, same comparison against the commit that recorded the bytes, same
// silent skip when the file is dirty, untracked, or there is no git. The caller decides which
// channel a finding goes down, by ONE fact about the artefact: its `created_at` date.
//
//   created_at >= R29_ACTIVATION_DATE  →  violate() as R29   (fatal, exit 1)
//   created_at <  R29_ACTIVATION_DATE  →  warn()   as W8     (advisory, as before)
//   created_at absent or malformed     →  warn()   as W8     (R2 owns the malformed field;
//                                                             a rule that cannot place an
//                                                             artefact in time must not block on
//                                                             the guess)
//
// WHY A NEW RULE NUMBER RATHER THAN A FATAL `W8`. Every `W` in this file means advisory and every
// `R` means blocking; a fatal finding labelled `W8` would be the first exception and would read
// as a mistake in the violations list. R29's message names W8 explicitly so nothing is hidden.
// See ADR-0170 for the alternatives weighed.
//
// WHY ONLY THE GIT ARM. The five wall-clock arms in `checkTimestampSanity` DECAY — a
// `completed_at` an hour in the future stops being in the future within the hour, so a fatal tier
// there would make the build's colour depend on when it was run. The git arm's comparison does
// not move (ADR-0158), which is exactly what makes it safe to block on.
//
// THE ACTIVATION DATE IS THE DAY THE TIER LANDED, and the ten live offenders were FIXED rather
// than grandfathered — see ADR-0170 for the before/after table and for why this differs from
// R27's write-forward activation (there, compliance was impossible before the capture wiring
// existed; here, writing a true timestamp was always possible and W8 had been saying so on every
// run for two epics).
const R29_ACTIVATION_DATE = '2026-08-05';

// Warn-tier, like the rest of W8 (ADR-0061): a wrong timestamp is a reporting defect.
const W8_COMMIT_FIELDS = Object.freeze(['created_at', 'started_at', 'completed_at']);

/**
 * @param {object} fm parsed frontmatter
 * @param {number|null} commitMs epoch ms of the file's last commit, or null when unknown
 *        (untracked, dirty, or no git) — in which case NOTHING is reported.
 * @returns {string[]} warning messages
 * Pure; no filesystem, no git, no clock. Exported for unit tests, same seam as
 * `checkTimestampSanity`.
 */
function checkTimestampVsCommit(fm, commitMs, toleranceMs = W8_FUTURE_TOLERANCE_MS) {
  const out = [];
  if (!fm) return out;
  if (commitMs === null || commitMs === undefined || !Number.isFinite(commitMs)) return out;
  const horizon = commitMs + toleranceMs;
  for (const key of W8_COMMIT_FIELDS) {
    const v = fm[key];
    if (v === undefined || v === null) continue;
    const val = String(v).trim();
    if (!val) continue;
    // Unparseable values are arm 5's business; reporting them twice adds noise, not signal.
    if (!isISO8601WithOffset(val)) continue;
    const t = Date.parse(val);
    if (Number.isNaN(t)) continue;
    if (t > horizon) {
      out.push(`\`${key}\` is '${val}', which is AFTER the commit that recorded this file ` +
        `(${new Date(commitMs).toISOString()}). Those bytes were already in git at that ` +
        `instant, so the value describes an event that had not happened when it was written — ` +
        `it was not observed. Re-derive it from the recording commit ` +
        `(\`git log -1 --format=%cI -- <path>\`). This check does not decay: comparing to ` +
        `\`now\` stops seeing it within the hour.`);
    }
  }
  return out;
}

/**
 * Last-commit time per repo-relative path, plus the set of paths that must be SKIPPED because
 * the working tree's bytes are not the committed bytes.
 *
 * Two `git` invocations, once per lint run. NEVER THROWS and never fails the lint: a consumer
 * project that is not a git repository, or has no `git` on PATH, gets `{ ok: false }` and the
 * arm simply does not run. A lint rule that broke outside a git checkout would be worse than
 * the defect it catches.
 *
 * `top` is git's own `--show-toplevel`, NOT the caller's `scanRoot`: `git log --name-only`
 * prints paths relative to the repository root whatever directory it was invoked from, so
 * keying on anything else silently produces a map nothing looks up. That is how this arm would
 * go quietly inert under `--fixtures-dir`.
 *
 * @returns {{ok: boolean, top: string|null, times: Map<string, number>, skip: Set<string>,
 *            reason: string|null}}
 */
function gitCommitIndex(scanRoot) {
  const times = new Map();
  const skip = new Set();
  const { spawnSync } = require('child_process');
  const run = (args) => spawnSync('git', args, {
    cwd: scanRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: Object.assign({}, process.env, { GIT_PAGER: 'cat', GIT_OPTIONAL_LOCKS: '0' }),
  });

  let res;
  try {
    res = run(['rev-parse', '--show-toplevel']);
  } catch (err) {
    return { ok: false, top: null, prefix: '', times, skip, reason: `git could not be spawned: ${err && err.message}` };
  }
  if (!res || res.error || res.status !== 0 || String(res.stdout || '').trim() === '') {
    return { ok: false, top: null, prefix: '', times, skip, reason: 'not inside a git work tree' };
  }
  const top = path.resolve(String(res.stdout).trim());

  // THE KEY IS BUILT FROM `--show-prefix`, NOT FROM `path.relative(top, file)`.
  // On Windows `os.tmpdir()` hands back an 8.3 SHORT path — the account segment arrives
  // abbreviated, e.g. `RUNNER~1` (spelled out rather than shown as a literal user-profile path,
  // which the release scrub gate's machine-path shape rule refuses in shipped text) — while
  // `--show-toplevel` prints the long form, and neither `path.resolve` nor `fs.realpathSync`
  // reconciles the two — so relativising one against the other yields `..\..\..`, every lookup
  // misses, and the whole arm goes SILENTLY INERT. `--show-prefix` is git's own answer to
  // "where am I inside the repo", expressed as a relative path, so no absolute path is ever
  // compared to another.
  const pfx = run(['rev-parse', '--show-prefix']);
  const prefix = (pfx && pfx.status === 0)
    ? String(pfx.stdout || '').trim().replace(/\\/g, '/').replace(/\/*$/, '')
    : '';

  // Anything modified, staged, or untracked: the committed bytes are not these bytes.
  const status = run(['status', '--porcelain', '-z', '--untracked-files=all']);
  if (status && status.status === 0) {
    for (const entry of String(status.stdout || '').split('\0')) {
      if (entry.length < 4) continue;
      // `XY <path>`; a rename entry is followed by its origin path as the NEXT NUL field,
      // which lands here as a bare path with no status prefix and is skipped by the length
      // test above only if short — so guard on the separator explicitly.
      if (entry.charAt(2) !== ' ') continue;
      skip.add(entry.slice(3).replace(/\\/g, '/'));
    }
  }

  // Last commit per path. `--no-renames` so a path's history is keyed on the name it has now;
  // following a rename would attribute an older commit to the current file, which is the wrong
  // direction for this check (it would make the horizon EARLIER and over-report).
  const log = run(['log', '--no-merges', '--no-renames', '--format=%x00%cI', '--name-only']);
  if (!log || log.status !== 0) {
    return { ok: false, top, prefix, times, skip, reason: 'git log failed' };
  }
  let currentMs = null;
  for (const rawLine of String(log.stdout || '').split(/\r?\n/)) {
    if (rawLine.charCodeAt(0) === 0) {
      const t = Date.parse(rawLine.slice(1).trim());
      currentMs = Number.isNaN(t) ? null : t;
      continue;
    }
    const line = rawLine.trim();
    if (!line || currentMs === null) continue;
    const key = line.replace(/\\/g, '/');
    // FIRST hit wins: `git log` walks newest-first, so the first commit naming a path is its
    // most recent one.
    if (!times.has(key)) times.set(key, currentMs);
  }
  return { ok: true, top, prefix, times, skip, reason: null };
}

// Built once, lazily, on first use. RUNS UNDER --fixtures-dir TOO, keyed off git's own
// toplevel — a fixtures dir that IS a git repository is exactly how this arm is probed
// end-to-end, and disabling it there would leave the wiring between `checkFile` and the pure
// checker untestable except against the live corpus (which is the "fixtures made by the code
// under test" trap wearing a different hat).
let _commitIndex = null;
function commitIndex() {
  if (_commitIndex === null) _commitIndex = gitCommitIndex(REPO_ROOT);
  return _commitIndex;
}

/** @returns {number|null} the file's last-commit epoch ms, or null when the arm must not run. */
function lastCommitMsFor(filepath) {
  const idx = commitIndex();
  if (!idx.ok) return null;
  const withinScan = path.relative(REPO_ROOT, filepath).replace(/\\/g, '/');
  // Outside the scanned tree the git index says nothing about this file.
  if (withinScan === '' || withinScan.indexOf('..') === 0) return null;
  const key = idx.prefix ? `${idx.prefix}/${withinScan}` : withinScan;
  if (idx.skip.has(key)) return null;
  const t = idx.times.get(key);
  return t === undefined ? null : t;
}

// ---------- Rule engine ----------

const violations = [];

function violate(file, rule, message) {
  violations.push({ file: rel(file), rule, message });
}

// Non-fatal warning channel (W-tier), kept deliberately separate from the fatal
// violations[]/violate() path. A warn() never affects the exit code — only
// violations.length decides exit 1. This is the kit's first soft-lint tier: it lets
// new advisory checks accrue coverage over time without breaking the build for the
// hundreds of artefacts that predate the field being checked. See STORY-14.2.03.
const warnings = [];

function warn(file, rule, message) {
  warnings.push({ file: rel(file), rule, message });
}

function checkFile(filepath, allFilesByType, storyIndex, featureIndex) {
  const content = fs.readFileSync(filepath, 'utf8');
  const fm = parseFrontmatter(content);

  if (!fm) {
    violate(filepath, 'R0', 'Missing or malformed YAML frontmatter');
    return;
  }

  // R20 — no duplicate top-level keys and no nested keys (STORY-09.3.03)
  if (fm._diagnostics && Array.isArray(fm._diagnostics)) {
    for (const diag of fm._diagnostics) {
      if (diag.type === 'duplicate-key') {
        violate(filepath, 'R20',
          `Duplicate top-level key '${diag.key}' in frontmatter. ` +
          `Remove the duplicate line (the last occurrence wins, but this is an error).`);
      } else if (diag.type === 'nested-key') {
        violate(filepath, 'R20',
          `Unsupported nested key '${diag.key}' in frontmatter. ` +
          `The kit's frontmatter is deliberately flat — nested mappings are not supported. ` +
          `Promote the key to the top level or use an inline value/array.`);
      }
    }
  }
  // Clean up the internal diagnostics field so it doesn't leak into rule processing.
  delete fm._diagnostics;

  // R21 — Epic↔Story status mismatch (cross-file aggregation check).
  // Flagged in the epic rule section below after allFilesByType is indexed.
  // (Deferred until after story/epic type checks so we can use the indexed children.)

  // R1 — status in enum
  if (!fm.status) {
    violate(filepath, 'R1', 'Missing required `status` field');
  } else if (!STATUS_ENUM.has(fm.status)) {
    violate(filepath, 'R1',
      `Invalid status '${fm.status}'. Must be one of: ${[...STATUS_ENUM].join(', ')}`);
  }

  // R2 — created_at non-empty and ISO 8601
  if (!fm.created_at) {
    violate(filepath, 'R2', 'Missing or empty `created_at` (must be ISO 8601 with offset)');
  } else if (!isISO8601WithOffset(fm.created_at)) {
    violate(filepath, 'R2',
      `created_at '${fm.created_at}' is not ISO 8601 with offset (e.g. 2026-05-20T14:32:00+01:00)`);
  }

  // R24 — title required and non-empty. Every artefact template carries `title:` and the
  // dashboard keys cards, drawers and search on it (the generator falls back to the body H1
  // only as a render-time courtesy). Before this rule, 44 legacy bugs + 3 reports shipped
  // without one and the board rendered "(no title)" — BUG-20260731-01.
  if (fm.title === undefined || fm.title === null || String(fm.title).trim() === '') {
    violate(filepath, 'R24',
      'Missing or empty `title` — set it to the artefact H1 text (for BUG files: the symptom). ' +
      'Without it the board and search render "(no title)".');
  }

  // R3 — in-progress implies started_at non-empty
  if (fm.status === 'in-progress' && !fm.started_at) {
    violate(filepath, 'R3', 'status=in-progress requires `started_at` to be set');
  }

  // R4 — terminal status implies completed_at non-empty
  if (TERMINAL_STATUSES.has(fm.status) && !fm.completed_at) {
    violate(filepath, 'R4',
      `status='${fm.status}' requires \`completed_at\` to be set`);
  }

  // R5 — not-started implies started_at and completed_at empty
  if (fm.status === 'not-started') {
    if (fm.started_at) violate(filepath, 'R5',
      'status=not-started but `started_at` is set (clear it)');
    if (fm.completed_at) violate(filepath, 'R5',
      'status=not-started but `completed_at` is set (clear it)');
  }

  // W8 — timestamp sanity (ADR-0123). Type-agnostic: every artefact template carries the
  // same three timestamp fields, and a fabricated `completed_at` is as misleading on a BUG or
  // an ADR as on a story. Warn-tier only; the shape logic lives in the pure
  // checkTimestampSanity() above so it can be unit-tested without a corpus.
  for (const msg of checkTimestampSanity(fm)) {
    warn(filepath, 'W8', msg);
  }
  // W8's git arm (ADR-0158) — the comparison that does NOT decay. Same check, a second
  // reference instant: the commit that recorded these bytes. Silently inert when the file is
  // dirty, untracked, or there is no git.
  //
  // TWO TIERS, ONE CHECK (STORY-28.2.03 / ADR-0170). An artefact created on or after
  // R29_ACTIVATION_DATE was written when this rule already existed, so a timestamp ahead of its
  // own recording commit is a violation. Everything older keeps the advisory tier it has had
  // since ADR-0158 — a rule about the past pretending to be a rule about the future is the
  // shape ADR-0148 warns against, and 181 findings stand in the historic corpus.
  {
    const created = (fm.created_at === undefined || fm.created_at === null)
      ? '' : String(fm.created_at).trim();
    const createdDate = created.slice(0, 10);
    // An unplaceable artefact stays advisory: R2 already violates on a malformed `created_at`,
    // and blocking on a date this cannot read would be blocking on a guess.
    const postActivation = /^\d{4}-\d{2}-\d{2}$/.test(createdDate)
      && createdDate >= R29_ACTIVATION_DATE;
    for (const msg of checkTimestampVsCommit(fm, lastCommitMsFor(filepath))) {
      if (postActivation) {
        violate(filepath, 'R29',
          `${msg} This artefact was created on ${createdDate}, on or after the R29 activation ` +
          `date ${R29_ACTIVATION_DATE}, so W8's timestamp-vs-recording-commit check BLOCKS here ` +
          `rather than warning (BACKLOG-0145 / ADR-0170: the advisory tier ran for two epics ` +
          `while the drift grew from 27 minutes to 5.6 hours). The check itself is unchanged — ` +
          `same fields, same tolerance, same comparison (ADR-0158). Artefacts created before ` +
          `${R29_ACTIVATION_DATE} keep the W8 warning.`);
      } else {
        warn(filepath, 'W8', msg);
      }
    }
  }

  // R10 — id matches filename
  const filenameId = fileIdFromName(filepath);
  if (filenameId && fm.id && fm.id !== filenameId) {
    violate(filepath, 'R10',
      `Frontmatter id='${fm.id}' does not match filename id '${filenameId}'`);
  }

  // R15 — every `html_artefacts:` entry must resolve to an existing file inside the repo.
  // Type-agnostic (in practice only EPIC + FEATURE templates declare it).
  if (Array.isArray(fm.html_artefacts)) {
    for (const entry of fm.html_artefacts) {
      checkRepoRelativePath(filepath, 'R15', 'html_artefacts entry', entry);
    }
  }

  // R15b (existence arm) — if `ai_review_artefact:` is set it must resolve to an existing
  // in-repo file. See ADR-0013. The presence arm (a *completed* review REQUIRES the field)
  // lives in the `story` case below, gated by the rollout cutoff.
  if (fm.ai_review_artefact) {
    checkRepoRelativePath(filepath, 'R15b', 'ai_review_artefact', fm.ai_review_artefact);
  }

  // R16 — every `html_context:` entry (PRIOR sibling HTML the verification agents read
  // before reviewing/testing) must resolve to an existing in-repo file. Type-agnostic;
  // OPT-IN — no existing artefact carries the field, so the corpus stays at 0 violations
  // until a story/testplan adds it. See SOP §11.
  if (Array.isArray(fm.html_context)) {
    for (const entry of fm.html_context) {
      checkRepoRelativePath(filepath, 'R16', 'html_context entry', entry);
    }
  }

  // W1 (non-fatal) — a Story, Feature, or Epic SHOULD carry a founder-facing "what
  // you'll have" / "what you'll see" line. Routed through warn(), never the fatal
  // path; its absence is optional, not a build break. Coverage accrues over time;
  // see STORY-14.2.03 / STORY-14.2.04. Extended to `epic` in STORY-21.4.01 (BACKLOG-
  // 0082 / ADR-0084) so the Plan → Roadmap timeline's deliverable line gets the same
  // soft nudge stories/features already have — still warn-tier only, exit code
  // unaffected (ADR-0061).
  if ((fm.type === 'story' || fm.type === 'feature' || fm.type === 'epic') &&
      (!fm.outcome || String(fm.outcome).trim() === '')) {
    warn(filepath, 'W1',
      'Missing `outcome` — the founder-facing "what you\'ll have" line. ' +
      'Optional (non-fatal); add it when you can.');
  }

  // Type-specific rules
  switch (fm.type) {
    case 'epic':
      // R9 — Epic must have okr or prd_section
      if (!fm.okr && !fm.prd_section) {
        violate(filepath, 'R9',
          'Epic must have either `okr:` or `prd_section:` in frontmatter (strategy linkage)');
      }

      // R21 — Epic↔Story status mismatch (cross-file aggregation).
      // Collects all stories where story.epic === this epic.id and checks two mismatches:
      // Case 1: all children are terminal AND at least one is 'done', BUT epic status != 'done'
      //         (stale epic frontmatter — the EPIC-10/11/12/14 hand-reconciliation this rule
      //          replaces). The epic's own started_at being empty is itself part of the drift,
      //          so it is NOT a reason to skip the check.
      // Case 2: epic status === 'done' but has non-terminal children.
      // Guard: epics with 0 children are never flagged.
      //
      // storyIndex is a Map<epicId, {id, status}[]> built ONCE in main() and passed in —
      // no per-epic disk re-read (BACKLOG-0064 AC-2). Falls back to re-reading from disk
      // when storyIndex is absent (e.g. called from tests without the index).
      if (fm.id) {
        let childStatuses;
        if (storyIndex) {
          // Fast path: O(1) lookup from the pre-built index.
          childStatuses = storyIndex.get(fm.id) || [];
        } else {
          // Fallback path (no index — legacy / test usage): read from disk.
          const childFiles = (allFilesByType.story || []).filter(f => {
            const storyFm = parseFrontmatter(fs.readFileSync(f, 'utf8'));
            return storyFm && storyFm.epic === fm.id;
          });
          childStatuses = childFiles.map(f => {
            const storyFm = parseFrontmatter(fs.readFileSync(f, 'utf8'));
            return { id: storyFm.id, status: storyFm.status };
          });
        }

        if (childStatuses.length > 0) {
          // Define terminal statuses (consistent with TERMINAL_STATUSES above).
          const isTerminal = (status) => TERMINAL_STATUSES.has(status);

          const allChildrenTerminal = childStatuses.every(s => isTerminal(s.status));
          const anyChildDone = childStatuses.some(s => s.status === 'done');
          const hasNonTerminalChild = childStatuses.some(s => !isTerminal(s.status));

          // Case 1: all children terminal AND at least one done, but epic status != 'done'.
          if (allChildrenTerminal && anyChildDone && fm.status !== 'done') {
            violate(filepath, 'R21',
              `Epic '${fm.id}' has all children in terminal states (${childStatuses.map(s => s.status).join(', ')}) ` +
              `with at least one 'done', but epic status is '${fm.status}' (expected 'done'). ` +
              `Set epic status to 'done' to reconcile.`);
          }

          // Case 2: epic status === 'done' but has non-terminal children.
          if (fm.status === 'done' && hasNonTerminalChild) {
            const nonTerminal = childStatuses.filter(s => !isTerminal(s.status));
            violate(filepath, 'R21',
              `Epic '${fm.id}' has status='done' but the following child stories are non-terminal: ` +
              `${nonTerminal.map(s => s.id + ' (' + s.status + ')').join(', ')}. ` +
              `Either complete the children or change epic status to reflect the actual state.`);
          }
        }

        // W12 — the epic tier's any-child-started mirror (STORY-35.3.05 / ADR-0278). Reuses the
        // SAME childStatuses list the R21 arms above just aggregated, so fast path and fallback
        // path can never disagree about membership. Warn-tier only; the pure checker carries the
        // terminal-parent guard and the R21-case-1 suppression.
        for (const msg of checkParentStatusRollup('epic', fm, childStatuses)) {
          warn(filepath, 'W12', msg);
        }
      }
      break;

    case 'story':
      // R6 — Story has paired Testplan at mirrored path
      if (fm.id) {
        const storiesRe = new RegExp(
          '[\\\\/]' + PATHS.stories.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\\\/]');
        const mirroredTp = filepath
          .replace(storiesRe, path.sep + PATHS.testplans + path.sep)
          .replace(/[\\/]STORY-/, path.sep + 'TESTPLAN-');
        // Need to glob — find any file in the testplan folder whose id matches.
        const tpId = fm.id.replace(/^STORY-/, 'TESTPLAN-');
        const tpDir = path.dirname(mirroredTp);
        let found = false;
        if (fs.existsSync(tpDir)) {
          for (const f of fs.readdirSync(tpDir)) {
            if (f.startsWith(tpId + '-') && f.endsWith('.md')) {
              found = true;
              break;
            }
          }
        }
        if (!found) {
          violate(filepath, 'R6',
            `Story has no paired TESTPLAN. Expected at: ${rel(tpDir)}/${tpId}-<slug>.md`);
        }
      }
      // R11 — Story estimate set
      if (!fm.estimate) {
        violate(filepath, 'R11', 'Story missing `estimate` (XS/S/M/L; XL means split)');
      } else if (!ESTIMATE_ENUM.has(fm.estimate)) {
        violate(filepath, 'R11',
          `Invalid estimate '${fm.estimate}'. Must be one of: XS, S, M, L, XL`);
      } else if (fm.estimate === 'XL') {
        violate(filepath, 'R11',
          'Story estimate is XL — split into smaller stories before pulling to Ready');
      }

      // R14 — AI-code-review gate (SOP §7 DoD)
      // When status=done, ai_review MUST be a terminal value (completed-YYYY-MM-DD,
      // skipped-trivial, or n-a). `pending` or empty fails the DoD.
      // skipped-trivial additionally requires ai_review_skip_reason non-empty.
      if (fm.status === 'done') {
        const aiReview = fm.ai_review;
        if (!aiReview || aiReview === 'pending') {
          violate(filepath, 'R14',
            'Story status=done but `ai_review` is missing or still `pending`. ' +
            'Set to `completed-YYYY-MM-DD`, `skipped-trivial` (with `ai_review_skip_reason`), ' +
            '`deferred-chat-review` (with `ai_review_deferred_to`), or `n-a`.');
        } else {
          // Validate the terminal-value format. A `done` story's `ai_review` is a lifecycle
          // marker, NOT the review's verdict — so a verdict word copied in by close-out (e.g.
          // 'approve', 'lgtm', 'reject') is rejected here. This is the exact regression
          // BUG-20260608-01 recorded: close-out wrote the AI-review's verdict word into the field
          // instead of the mechanical `completed-<today>` token. See close-out-story SKILL.md.
          const looksCompleted = /^completed-\d{4}-\d{2}-\d{2}$/.test(aiReview);
          const isOtherTerminal = AI_REVIEW_TERMINAL.has(aiReview);
          if (!looksCompleted && !isOtherTerminal) {
            violate(filepath, 'R14',
              `Invalid \`ai_review\` value '${aiReview}' on a done story. Must be the mechanical ` +
              `terminal token 'completed-YYYY-MM-DD', 'skipped-trivial', 'deferred-chat-review' or ` +
              `'n-a' — never the review's verdict word (e.g. 'approve'/'lgtm'/'reject'; see ` +
              `BUG-20260608-01).`);
          }
          if (aiReview === 'skipped-trivial' &&
              (!fm.ai_review_skip_reason || fm.ai_review_skip_reason === '')) {
            violate(filepath, 'R14',
              '`ai_review=skipped-trivial` requires `ai_review_skip_reason` to be non-empty ' +
              '(brief rationale why the review was skipped — e.g. "typo fix in copy").');
          }
          // BACKLOG-0123 / ADR-0121. Without this arm the new token IS the escape
          // hatch it must not be: "deferred" with no addressee is indistinguishable
          // from "never reviewed", and nothing would ever come back for it.
          if (aiReview === 'deferred-chat-review' &&
              (!fm.ai_review_deferred_to || String(fm.ai_review_deferred_to).trim() === '')) {
            violate(filepath, 'R14',
              '`ai_review=deferred-chat-review` requires `ai_review_deferred_to` to name the ' +
              'chat or phase whose independent reviewer owns it (e.g. "CHAT-05" or ' +
              '"EPIC-25 Phase 3 close"). A deferral with no addressee is just a skip.');
          }
        }
      }

      // ---------- W7 — a deferred chat review that never landed ----------
      // ADR-0121 added `deferred-chat-review` as R14's fourth terminal so a story closing
      // inside a SOP §18 subagent batch could say "pending-but-scheduled" instead of lying
      // with `skipped-trivial`. R14 makes the deferral ADDRESSED (`ai_review_deferred_to`
      // must name the reviewing chat). Nothing makes it FINISH.
      //
      // WHY: `deferred-chat-review` is R15b-exempt by design — at the moment the story flips
      // `done` the artefact genuinely does not exist yet. That exemption is also the hole: a
      // story can sit in "a review is coming" forever and every gate stays green, which is the
      // same permanently-unlinked end state ADR-0121 was written to prevent, reached by a
      // different door. This rule is the only thing that ever asks whether the promise was kept.
      //
      // Warn-tier (ADR-0061): never fatal, never blocks a merge. It CANNOT be fatal — the
      // window between "story done" and "chat review written" is legitimate and is exactly the
      // workflow ADR-0121 blesses. Its job is to keep the outstanding promise on screen on
      // every run until close-out fills `ai_review_artefact:`, at which point it goes quiet by
      // itself. Deliberately no age threshold: any wall-clock cutoff would be arbitrary, and a
      // deferral that is still open is worth naming whether it is ten minutes or ten weeks old.
      if (fm.status === 'done' &&
          fm.ai_review === 'deferred-chat-review' &&
          (!fm.ai_review_artefact || String(fm.ai_review_artefact).trim() === '')) {
        warn(filepath, 'W7',
          `status=done with \`ai_review: deferred-chat-review\` (deferred to ` +
          `'${String(fm.ai_review_deferred_to || '').trim() || '(unnamed)'}') but ` +
          `\`ai_review_artefact:\` is still empty — the review was promised and has not landed. ` +
          `Set \`ai_review_artefact:\` to the AI-CODE-REVIEW path when the chat review is written, ` +
          `and flip \`ai_review\` to \`completed-YYYY-MM-DD\`. Non-fatal by design (ADR-0121/ADR-0123): ` +
          `the gap between closing the story and writing the chat review is a legitimate window.`);
      }

      // R15b (presence arm) — a *completed* AI-review must carry an ai_review_artefact.
      // Gated by the rollout cutoff so existing pre-cutoff `done` stories (which closed
      // before AI-CODE-REVIEW.template.html existed) are grandfathered. skipped-trivial /
      // n-a are exempt — no artefact is expected for those. See ADR-0013.
      if (fm.status === 'done' &&
          typeof fm.ai_review === 'string' &&
          /^completed-\d{4}-\d{2}-\d{2}$/.test(fm.ai_review)) {
        // Compare the created_at DATE portion (YYYY-MM-DD) lexically against the cutoff —
        // ISO 8601 dates sort correctly as strings. Stories with a missing/malformed
        // created_at are already flagged by R2; skip the gate rather than double-report.
        const createdDate = typeof fm.created_at === 'string' ? fm.created_at.slice(0, 10) : '';
        const onOrAfterCutoff = /^\d{4}-\d{2}-\d{2}$/.test(createdDate) &&
                                createdDate >= R15B_PRESENCE_CUTOFF;
        if (onOrAfterCutoff &&
            (!fm.ai_review_artefact || String(fm.ai_review_artefact).trim() === '')) {
          violate(filepath, 'R15b',
            `Story status=done with ai_review='${fm.ai_review}' must set \`ai_review_artefact:\` ` +
            `(repo-relative path to the AI-CODE-REVIEW HTML artefact, typically ` +
            `41-Reports/reviews/AI-CODE-REVIEW-<story-id>-<YYYY-MM-DD>.html). ` +
            `Exempt: ai_review=skipped-trivial / n-a, and stories created before ${R15B_PRESENCE_CUTOFF}.`);
        }
      }

      // W3 (BUG-20260801-02 m5) — cross-story ai_review_artefact reuse on a SKIPPED review,
      // unguarded seam flagged by the CHAT-08 review (anno-7). R15b's existence arm only
      // checks the artefact path resolves; nothing checks it actually belongs to THIS
      // story, so any existing HTML file satisfies it. Scoped to `skipped-trivial` only
      // (not `completed-*`) — completed reviews legitimately share one batch/wave artefact
      // across many stories (an established, intentional corpus pattern; see the epic21
      // "wave" artefacts), which is not the seam this finding is about. Warn (not error,
      // ADR-0061) when the artefact's basename does not carry this story's id AND the skip
      // reason does not explicitly justify the reuse (e.g. "same commit", "shared files",
      // "sibling story") — STORY-23.6.02's own skip reason ("same commit, shared files")
      // stays silent under this rule; an unexplained mismatch does not.
      if (fm.ai_review === 'skipped-trivial' && fm.ai_review_artefact && fm.id &&
          !path.basename(String(fm.ai_review_artefact)).includes(fm.id) &&
          !/shared|sibling|same commit/i.test(String(fm.ai_review_skip_reason || ''))) {
        warn(filepath, 'W3',
          `ai_review_artefact ('${fm.ai_review_artefact}') filename does not carry this ` +
          `story's id (${fm.id}) — cross-story reuse must be justified in ai_review_skip_reason ` +
          `(e.g. mention "same commit" / "shared files" / "sibling story").`);
      }

      // R17 — every `depends_on:` entry must point at an existing STORY-NN.M.PP under
      // 32-Stories/. OPTIONAL field: the rule only fires when present, so the existing
      // corpus (no story carries it) stays at 0 violations. The forward-reference policy
      // (ADR-0020) is STRICT: a depends_on pointing at a not-yet-created story IS a
      // violation — the target must exist now. This keeps execution-strategist's dependency graph
      // honest (it groups READY stories; a dangling edge would mis-order a batch) and is
      // cheap to satisfy (create the depended-on story first). The entry must be a bare
      // STORY id (e.g. STORY-02.1.01). Resolved against the REAL corpus (realStoryIds),
      // not the scan set, so a fixture can legitimately depend on a real story.
      // STORY-09.3.01: also validates bracket-less scalar `depends_on:` values, not just arrays.
      if (fm.depends_on !== undefined && fm.depends_on !== '' && fm.depends_on !== null) {
        // Normalize scalar to a single-element array for uniform processing.
        const depsList = Array.isArray(fm.depends_on) ? fm.depends_on : [fm.depends_on];
        for (const dep of depsList) {
          const depId = String(dep).trim();
          if (!depId) continue;
          // STORY-28.3.01: the STORY shape comes from lib/artefact-id.js, so a change to
          // what a story id looks like reaches this rule on the same day it reaches the
          // filename reader — the two used to be separate literals.
          if (!artefactId.isExactId(depId, 'STORY')) {
            violate(filepath, 'R17',
              `depends_on entry '${depId}' is not a valid STORY id ` +
              `(expected form STORY-NN.M.PP)`);
            continue;
          }
          if (!realStoryIds().has(depId)) {
            violate(filepath, 'R17',
              `depends_on entry '${depId}' does not point at an existing STORY ` +
              `under 32-Stories/ (forward references to not-yet-created stories are ` +
              `not allowed — create the depended-on story first; see ADR-0020)`);
          }
        }
      }

      // R18 — every `files_touched:` entry must be a repo-relative path (no absolute, no
      // leading '/', no '..'). OPTIONAL field — fires only when present. Format-only:
      // does NOT require the file to exist (a story may create files that don't yet exist).
      // STORY-09.3.01: also validates bracket-less scalar `files_touched:` values, not just arrays.
      if (fm.files_touched !== undefined && fm.files_touched !== '' && fm.files_touched !== null) {
        // Normalize scalar to a single-element array for uniform processing.
        const touchedList = Array.isArray(fm.files_touched) ? fm.files_touched : [fm.files_touched];
        for (const entry of touchedList) {
          checkFilesTouchedPath(filepath, entry);
        }
      }

      // R19 — `suggested_agents:` shape (optional; SHAPE-only, no existence check). When
      // present it must be a LIST of non-empty agent-name strings. A scalar (e.g.
      // `suggested_agents: react-expert`) is rejected — this guards the scalar-bypass class
      // noted in BACKLOG-0024. Agent existence is NOT checked: the installed roster is
      // project-specific (the type_of_work→agent default map lives in PROJECT-CONTEXT). The
      // resolution order suggested_agents → map → discipline/general-purpose is consumed by
      // execution-strategist / execute-story. Empty (field absent or bare) is fine — optional.
      // See SOP §11 / FEAT-03.1 (ADR-0023).
      if (fm.suggested_agents !== undefined && fm.suggested_agents !== '') {
        if (!Array.isArray(fm.suggested_agents)) {
          violate(filepath, 'R19',
            `suggested_agents must be a LIST of agent-name strings (got scalar ` +
            `'${fm.suggested_agents}'). Use [agent-a, agent-b] or a block list. Shape only — ` +
            `agent existence is not checked (roster is install-specific).`);
        } else {
          for (const a of fm.suggested_agents) {
            if (typeof a !== 'string' || String(a).trim() === '') {
              violate(filepath, 'R19',
                `suggested_agents entry must be a non-empty agent-name string (found '${a}')`);
            }
          }
        }
      }

      // R23 — `usage_estimate:` shape (optional; SHAPE-only, same stance as R19). See
      // ADR-0079 / STORY-21.2.02 and the shared checkUsageEstimateShape() above (also
      // applied to the `backlog` case below).
      {
        const usageMsg = checkUsageEstimateShape(fm.usage_estimate);
        if (usageMsg) violate(filepath, 'R23', usageMsg);
      }
      break;

    case 'backlog':
      // R23 — `usage_estimate:` shape (optional; SHAPE-only). Mirrors the story case
      // above — see ADR-0079 / STORY-21.2.02.
      {
        const usageMsg = checkUsageEstimateShape(fm.usage_estimate);
        if (usageMsg) violate(filepath, 'R23', usageMsg);
      }
      break;

    case 'testplan':
      // R7 — Testplan refers to an existing story
      if (fm.story) {
        const id = fm.story;
        const found = (allFilesByType.story || []).some(f =>
          fileIdFromName(f) === id);
        if (!found) {
          violate(filepath, 'R7',
            `Testplan references story '${id}' but no STORY file with that id exists`);
        }
      } else {
        violate(filepath, 'R7', 'Testplan missing required `story:` field');
      }
      break;

    case 'bug':
      // R8 — Bug refs valid story + testplan (unless exploratory)
      if (fm.story && fm.story !== 'exploratory') {
        const found = (allFilesByType.story || []).some(f =>
          fileIdFromName(f) === fm.story);
        if (!found) {
          violate(filepath, 'R8',
            `Bug references story '${fm.story}' but no STORY file with that id exists`);
        }
      }
      if (fm.testplan && fm.testplan !== 'exploratory') {
        const found = (allFilesByType.testplan || []).some(f =>
          fileIdFromName(f) === fm.testplan);
        if (!found) {
          violate(filepath, 'R8',
            `Bug references testplan '${fm.testplan}' but no TESTPLAN file with that id exists`);
        }
      }
      break;

    case 'feature':
      // R12 — Feature.epic exists
      if (fm.epic) {
        const found = (allFilesByType.epic || []).some(f =>
          fileIdFromName(f) === fm.epic);
        if (!found) {
          violate(filepath, 'R12',
            `Feature references epic '${fm.epic}' but no EPIC file with that id exists`);
        }
      } else {
        violate(filepath, 'R12', 'Feature missing required `epic:` field');
      }

      // W12 — feature-tier parent-status rollup mirrors (STORY-35.3.05 / ADR-0278).
      // Cross-file aggregation over stories where story.feature === this feature's id —
      // the same shape as R21's epic tier (parents derive from STORIES, never from each
      // other; the epic↔feature reading reconciles transitively once both tiers follow
      // their stories).
      //
      // featureIndex is a Map<featureId, {id, status}[]> built ONCE in main() and passed
      // in — no per-feature disk re-read. The fallback path below mirrors the index's
      // membership EXACTLY (feature match only, no id requirement; consumers read only
      // .status/.id) so fast path and legacy path can never fire different findings —
      // the STORY-19.3.01 AC-2 parity risk, restated from the storyIndex comment.
      if (fm.id) {
        let featChildStatuses;
        if (featureIndex) {
          // Fast path: O(1) lookup from the pre-built index.
          featChildStatuses = featureIndex.get(fm.id) || [];
        } else {
          // Fallback path (no index — legacy / test usage): read from disk.
          featChildStatuses = (allFilesByType.story || [])
            .map(f => parseFrontmatter(fs.readFileSync(f, 'utf8')))
            .filter(storyFm => storyFm && storyFm.feature === fm.id)
            .map(storyFm => ({ id: storyFm.id, status: storyFm.status }));
        }
        for (const msg of checkParentStatusRollup('feature', fm, featChildStatuses)) {
          warn(filepath, 'W12', msg);
        }
      }
      break;
  }
}

// ---------- R22 — Lifecycle chain sync gate ----------
// Parses the canonical lifecycle chain from skills/core/SKILL.md and validates that
// each lifecycle skill's Next: pointer matches the canonical successor.
// If skills/core is absent (e.g., in deployed projects), silently skips (no-op).
// Exported for test injection (parameterise for TC-03).
function checkChainSync(skillsDir = path.join(REPO_ROOT, 'skills')) {
  // Graceful no-op: deployed projects have no kit skills/ dir installed alongside the PM
  // folder, so there is no canonical chain to check against.
  if (!fs.existsSync(skillsDir)) return;

  // Parse the canonical chain from skills/core/SKILL.md — the SINGLE source of truth
  // (ADR-0047). We deliberately do NOT hardcode the chain here: a hardcoded copy would be a
  // second source that could silently drift from core, which is the exact failure this rule
  // exists to prevent.
  const corePath = path.join(skillsDir, 'core', 'SKILL.md');
  if (!fs.existsSync(corePath)) return; // no core SoT present → nothing to enforce
  const coreText = fs.readFileSync(corePath, 'utf8');

  // The chain record is the set of lines listing `/...:<command>` tokens joined by `→`.
  // Since STORY-35.2.01 the canonical record FORKS at the strategist step: one planning-prefix
  // line plus one line per fork path (ADR-0279). Every line carrying ≥2 backtick-quoted tokens
  // and a literal arrow contributes edges; the union of those lines is the chain graph. A
  // legacy linear record still parses identically (one qualifying line). We deliberately do
  // NOT hardcode the chain here: a hardcoded copy would be a second source that could silently
  // drift from core, which is the exact failure this rule exists to prevent.
  // Capture the prefix from the first token of the first chain line — no hardcoded prefix
  // literals here (R22 / BACKLOG-0064 AC-3). This captured value is kept for diagnostics
  // only; the per-skill Next: pointer match below deliberately does NOT pin to it (see the
  // note there — BACKLOG-0078 / STORY-21.1.01).
  const successorSets = new Map(); // member → Set of canonical successors (union over lines)
  const chainMembers = new Set();
  let chainPrefix = null; // captured from the first chain line
  for (const line of coreText.split(/\r?\n/)) {
    if (!line.includes('→')) continue;
    // Extract prefix:command pairs from backtick-quoted `/<prefix>:<command>` tokens.
    const matches = [...line.matchAll(/`\/([^:`]+):([a-z][\w-]*)`/g)];
    if (matches.length < 2) continue; // prose line, not a chain line
    if (chainPrefix === null) chainPrefix = matches[0][1];
    const cmds = matches.map(m => m[2]);
    for (const c of cmds) chainMembers.add(c);
    for (let i = 0; i < cmds.length - 1; i++) {
      if (!successorSets.has(cmds[i])) successorSets.set(cmds[i], new Set());
      successorSets.get(cmds[i]).add(cmds[i + 1]);
    }
  }

  if (chainMembers.size < 2) {
    // core exists but its canonical chain record could not be parsed — the SoT is malformed.
    // Fail closed (a silent pass would let the whole gate rot unnoticed).
    violate(corePath, 'R22',
      'Could not parse the canonical lifecycle chain from skills/core/SKILL.md ' +
      '(expected line(s) of `/...:<command>` tokens joined by →, per ADR-0047). ' +
      'Restore the chain line(s) before the chain-sync gate can run.');
    return;
  }

  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillName = entry.name;
    if (!chainMembers.has(skillName)) continue; // non-member → exempt

    const skillPath = path.join(skillsDir, skillName, 'SKILL.md');
    if (!fs.existsSync(skillPath)) continue;

    const content = fs.readFileSync(skillPath, 'utf8');
    // Next: pointer — matched against any single prefix of the same captured shape as the
    // chain line's own tokens, NOT pinned to the chain line's exact captured value. A
    // chain member on the published prefix while core is still on the dev prefix (or the
    // reverse, post-republish) must not false-positive here; a wrong next command under a
    // matching prefix still must (BACKLOG-0078 / STORY-21.1.01).
    const nextMatch = content.match(/^Next:\s*`\/([^:`]+):([^`]+)`/m);
    const nextCommand = nextMatch ? nextMatch[2] : null;
    const successors = successorSets.get(skillName) || new Set();

    // Path-final members (zero successors in the union) carry no successor claim to enforce:
    // the terminal step is terminal by core's prose, and the single-story path's final step
    // may carry the recorded phase-end bridge pointer, which is not a chain edge (ADR-0279).
    if (successors.size === 0) continue;

    if (successors.size === 1) {
      const expectedNext = successors.values().next().value;
      if (nextCommand !== expectedNext) {
        violate(skillPath, 'R22',
          `Lifecycle skill '${skillName}' has Next: \`/...:${nextCommand || '(missing)'}\` ` +
          `but the canonical chain (skills/core/SKILL.md, ADR-0047) specifies ` +
          `\`/...:${expectedNext}\`. ` +
          `Update the skill's Next: pointer (the chain record wins).`);
      }
    } else if (!nextCommand || !successors.has(nextCommand)) {
      // Fork point (2+ canonical successors): its single Next: pointer must name ONE of its
      // fork successors — anything else (or none) is chain drift (ADR-0279).
      violate(skillPath, 'R22',
        `Lifecycle skill '${skillName}' is the chain's fork point; its Next: ` +
        `\`/...:${nextCommand || '(missing)'}\` must name one of its fork successors ` +
        `(${[...successors].join(' | ')}) per the canonical chain ` +
        `(skills/core/SKILL.md, ADR-0047). Update the skill's Next: pointer (the chain record wins).`);
    }
  }
}

// ---------- R33 — A Next: pointer must name a command that exists ----------
// BUG-20260901-13. R22 above checks chain MEMBERS' Next: pointers against core's canonical
// chain, and deliberately exempts every non-chain skill (`if (!chainMembers.has(skillName))
// continue`) — a utility has no canonical successor to compare against, so there is nothing
// for THAT rule to check. The exemption left a blind spot: a non-chain skill can ship a
// successor pointer at a command that does not exist at all, and nothing fires
// (`document`'s retired `document-html` forward reference was the live instance). R33 closes
// the EXISTENCE half for every skill at once: any `Next:`-shaped line in any SKILL.md under
// skills/ that names a backtick-quoted `/<prefix>:<command>` token must resolve to an
// existing `skills/<command>/` directory. It reads the tree, not a list, so it cannot rot
// the way a second hand-kept lifecycle set would (the bug's rejected option 2).
//
// Scope decisions, both deliberate:
//   - The prefix is NOT pinned — same cross-prefix tolerance as R22 (BACKLOG-0078 /
//     STORY-21.1.01): a pointer under the dev or the published prefix resolves to the same
//     skills/<command>/ directory, so only the command segment is checked.
//   - WHICH existing successor a chain member names stays R22's job; R33 only refuses
//     pointers with no owner. The two rules overlap on nothing and neither replaces the other.
// Graceful no-op when skills/ is absent (deployed projects), matching checkChainSync.
// Exported for test injection (r33-dangling-successor.test.js drives it over fixture dirs).
function checkDanglingSuccessors(skillsDir = path.join(REPO_ROOT, 'skills')) {
  if (!fs.existsSync(skillsDir)) return;

  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillPath = path.join(skillsDir, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillPath)) continue;

    const lines = fs.readFileSync(skillPath, 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      // `Next:`-shaped lines only — the same line shape R22's pointer matcher reads
      // (`^Next:`). Prose that merely mentions a sibling command is out of scope: R26
      // owns links, and flagging every prose mention would make the rule too loud to keep.
      if (!/^Next:/.test(lines[i])) continue;
      // Every `/<prefix>:<command>` token on the line — a Next: line may name more than one
      // command (e.g. install's "orient, then plan" pointer). Trailing text inside the
      // backticks (arguments like `<chat-id>`) is tolerated after the command token.
      for (const m of lines[i].matchAll(/`\/([^:`\s]+):([a-z][\w-]*)[^`]*`/g)) {
        const cmd = m[2];
        if (!fs.existsSync(path.join(skillsDir, cmd))) {
          violate(skillPath, 'R33',
            `Next: pointer (line ${i + 1}) names \`/${m[1]}:${cmd}\`, but no ` +
            `skills/${cmd}/ directory exists — the successor it hands the operator to has ` +
            `no owner (dangling pointer, BUG-20260901-13). Point it at an existing command ` +
            `or delete the pointer.`);
        }
      }
    }
  }
}

// ---------- Version-parity gate (STORY-09.3.02 · extended STORY-19.2.01) ----------
// Checks that .claude-plugin/plugin.json, .claude-plugin/marketplace.json (Tandem
// entry), package.json, AND _00-Project-Management/93-Scripts/lib/pm-manifest.json `kitVersion`
// all declare the same version. The kitVersion arm (STORY-19.2.01) enforces the manifest's own
// `$comment` lockstep promise — STORY-16.4.03's pm:doctor "update available" drift notice and
// install/update stamping all key off kitVersion, so a drifted kitVersion would mis-report forever.
//
// Returns { ok: boolean, message: string|null } in addition to pushing a violation on mismatch, so
// callers (and TESTPLAN-19.2.01 TC-02) can assert the result directly. `opts.manifestPath` overrides
// the pm-manifest.json location (used by the test harness to inject a drifted fixture); when absent
// the canonical PM_ROOT/93-Scripts/lib/pm-manifest.json is read.
function checkVersionParity(baseDir, opts = {}) {
  try {
    const pluginPath = path.join(baseDir, '.claude-plugin', 'plugin.json');
    const marketplacePath = path.join(baseDir, '.claude-plugin', 'marketplace.json');
    const packagePath = path.join(baseDir, 'package.json');
    const manifestPath = opts.manifestPath ||
      path.join(PM_ROOT, '93-Scripts', 'lib', 'pm-manifest.json');

    // Read and parse manifests.
    let pluginVersion = null;
    let marketplaceVersion = null;
    let packageVersion = null;
    let kitVersion = null;

    try {
      if (fs.existsSync(pluginPath)) {
        const pluginJson = JSON.parse(fs.readFileSync(pluginPath, 'utf8'));
        pluginVersion = pluginJson.version;
      }
    } catch (e) {
      const msg = `Failed to parse .claude-plugin/plugin.json: ${e.message}`;
      violate(PM_ROOT, 'VERSION-PARITY', msg);
      return { ok: false, message: msg };
    }

    try {
      if (fs.existsSync(marketplacePath)) {
        const marketplaceJson = JSON.parse(fs.readFileSync(marketplacePath, 'utf8'));
        // The Tandem entry is in the plugins array.
        const entry = marketplaceJson.plugins && marketplaceJson.plugins.find(p => p.name === 'Tandem');
        if (entry) {
          marketplaceVersion = entry.version;
        }
      }
    } catch (e) {
      const msg = `Failed to parse .claude-plugin/marketplace.json: ${e.message}`;
      violate(PM_ROOT, 'VERSION-PARITY', msg);
      return { ok: false, message: msg };
    }

    try {
      if (fs.existsSync(packagePath)) {
        const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        packageVersion = packageJson.version;
      }
    } catch (e) {
      const msg = `Failed to parse package.json: ${e.message}`;
      violate(PM_ROOT, 'VERSION-PARITY', msg);
      return { ok: false, message: msg };
    }

    try {
      if (fs.existsSync(manifestPath)) {
        const manifestJson = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        kitVersion = manifestJson.kitVersion;
      }
    } catch (e) {
      const msg = `Failed to parse pm-manifest.json (kitVersion): ${e.message}`;
      violate(PM_ROOT, 'VERSION-PARITY', msg);
      return { ok: false, message: msg };
    }

    // Consumer-repo guard (BUG-20260612-01). `package.json` only *describes the kit* in
    // Tandem's own dev repo, where it ships alongside the plugin manifests. In a vendored/
    // consumer install, package.json describes the consuming application — its version is
    // unrelated to the kit version, so including it would make the gate fire on every fresh
    // install (app 0.1.0 vs kit 2.6.0). The unambiguous "this is the kit's own repo" signature
    // is the presence of .claude-plugin/plugin.json or marketplace.json (both absent in a
    // consumer repo). Outside the kit repo the set reduces to { kitVersion } and the gate passes.
    const isKitRepo = fs.existsSync(pluginPath) || fs.existsSync(marketplacePath);

    // Collect the versions into a set to detect divergence.
    const versions = new Set();
    if (pluginVersion !== null && pluginVersion !== undefined) versions.add(pluginVersion);
    if (marketplaceVersion !== null && marketplaceVersion !== undefined) versions.add(marketplaceVersion);
    if (isKitRepo && packageVersion !== null && packageVersion !== undefined) versions.add(packageVersion);
    if (kitVersion !== null && kitVersion !== undefined) versions.add(kitVersion);

    // If more than one distinct version, report a violation naming every source (incl. kitVersion).
    if (versions.size > 1) {
      const msg = `Version mismatch across plugin manifests: ` +
        `plugin.json=${pluginVersion}, ` +
        `marketplace.json (plugins[Tandem])=${marketplaceVersion}, ` +
        `package.json=${packageVersion}, ` +
        `pm-manifest.json (kitVersion)=${kitVersion}. All four must be identical.`;
      violate(PM_ROOT, 'VERSION-PARITY', msg);
      return { ok: false, message: msg };
    }
    return { ok: true, message: null };
  } catch (e) {
    // Unexpected error — surface it.
    const msg = `Unexpected error during version-parity check: ${e.message}`;
    violate(PM_ROOT, 'VERSION-PARITY', msg);
    return { ok: false, message: msg };
  }
}

// ---------- AC-4 — verify-gate anti-pattern self-check (STORY-19.1.03) ----------
// Advisory W-tier scan of the kit-emitted `verify` blocks in EXECUTION-STRATEGY-*.json
// sidecars. Flags two "gate that can never fail" / "gate that always fails" shapes that
// BUG-20260608-01 + ADR-0074 exposed:
//   (1) a `| tail`/`| head` masking the real exit status of a gate pipeline (the substring-
//       of-output anti-pattern — the pipeline's exit code becomes tail/head's, always 0);
//   (2) a stale `npm run pm:mirror` (the mirror gate was retired in ADR-0074; the script no
//       longer exists, so the gate now hard-fails on a missing script).
// DELIBERATELY non-fatal (warn(), not violate()) and scoped to advisory surfacing only — a
// frozen historical sidecar must NOT break the build (the gotcha in STORY-19.1.03 / its risks),
// while a freshly-emitted one gets surfaced so it can be fixed. Graceful no-op if the reports
// folder is absent (deployed projects without the sidecars).
// R25 — THE FLAT-ROOT GUARD (STORY-27.3.04 AC-4/AC-5, ADR-0143).
//
// STORY-27.3.03 moved 193 documents out of `41-Reports/` into topic folders. Ten
// skills write into that directory, and a skill whose documented path was missed
// produces ONE stray file — which looks like nothing. The corpus reached 204 loose
// documents one indistinguishable file at a time, and the second time would look
// exactly like the first.
//
// FATAL, not warn-tier, and that is the decision AC-4 asks to have recorded.
// Three reasons:
//   1. The story's own Technical notes put the guard in the same story as the
//      teaching precisely so a missed skill "surfaces as a loud failure rather
//      than a slow re-flattening". A warning that nobody must act on is the slow
//      re-flattening with a log line attached — this file already carries 23
//      standing W6 hits, which is what warnings do at rest.
//   2. The escape is cheap and needs no code change: ANY sub-folder is a topic
//      (ADR-0141 derives them), so the fix for a legitimate one-off report with
//      no obvious home is `mkdir` — not a lint suppression. The story's Risks
//      section required confirming that path works before enabling the guard;
//      it does, and `tests/build-reports-recursive.test.js :: walks-subfolders`
//      is the standing proof.
//   3. A genuinely root-dwelling file has a declared home too: ROOT_EXEMPT.
//
// Scoped to normal mode: the isolated fixtures dir carries no reports corpus.
function checkFlatRootReports(reportsDir = path.join(PM_ROOT, '41-Reports')) {
  if (!fs.existsSync(reportsDir)) return; // deployed project without the folder
  for (const stray of reportTree.strayRootReports(reportsDir)) {
    violate(stray.path, 'R25', stray.reason);
  }
}

// R26 — A LINK RESOLVES FROM THE FILE IT IS WRITTEN IN (BUG-20260804-08, BACKLOG-0142).
//
// The STORY-27.3.03 migration rewrote the `41-Reports/` half of every reference and
// left the relative depth alone, so 59 links inside 13 moved reports resolved before
// the move and not after — `](../40-Decisions/ADR-0045.md)` in a file that had just
// dropped a level now means `41-Reports/40-Decisions/…`. Every gate stayed green,
// because the migration test asks whether a path STRING names something in the
// corpus, never whether the LINK, followed from its own file, arrives anywhere.
// This rule asks the second question, which is the one a reader asks.
//
// ============================================================================
// SCOPE: THE WHOLE SCAN SET, NOT JUST 41-Reports (STORY-28.2.02)
// ============================================================================
// The first slice of this rule shipped narrow, and said so: "the corpus at large carries
// 567 unresolved markdown links, almost all template placeholders — a corpus-wide rule
// cannot ship until that distinction is designed". That distinction is designed here, and
// the 567 turns out to have been counting a different thing. Measured over the artefact
// bodies with code context excluded, the corpus carries **24** unresolved links:
//
//   19 sit inside HTML COMMENTS — the `<!-- - [ADR-NNNN — <title>](…) -->` line every
//      EPIC and FEATURE template ships in its `## Decisions` section, left in place as a
//      prompt until a real ADR exists. A commented-out link is not rendered by any
//      markdown engine and no reader can follow it, which makes it exactly the same class
//      as a link inside a code span (BUG-20260804-11) and exactly the same class as the
//      `](…)` inside an .html report's inlined script that the first slice excluded a whole
//      file type to avoid. Recognising the third member of that family is what makes the
//      corpus-wide rule shippable — not a placeholder allowlist, which would have to guess
//      at `NNNN`, `<slug>`, `...` and every future template token.
//    5 are genuine dead links: four wrong relative depths and one path pasted from the
//      wrong folder. All five are fixed by STORY-28.2.02 rather than grandfathered, which
//      is why this rule needs no activation date and no warn-first tier.
//
// The rule is therefore GENERALISED IN PLACE rather than renumbered: R26's behaviour on
// `41-Reports` is unchanged (its regression shapes still fail), and its scope now also
// covers every artefact the linter scans. One rule, one id, one implementation — a second
// rule number for "the same question asked about a different folder" is how R25/R27 came
// to disagree with their own test filename (ADR-0148).
//
// STILL OUT OF SCOPE, deliberately:
//   - `.html` reports: `](…)` inside a review artefact's inlined script is a regex, not a
//     link, and there are two such false positives today.
//   - Absolute URLs, `mailto:`, `data:` and bare anchors. A fragment is stripped before
//     resolution; `#anchor` alone is a same-document reference with no file to resolve.
//
// FATAL, matching R25: the corpus will keep moving, and this defect's whole character
// was that it was invisible.
const MD_LINK_RE = /\]\(([^)\s]+)\)/g;
const MD_FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;

// ---------------------------------------------------------------------------
// ONE FILE-EXISTENCE INDEX PER RUN (STORY-28.2.02 AC-4).
//
// The narrow rule could afford an `fs.existsSync` per link. Corpus-wide it cannot: the scan
// set carries thousands of links, and one stat each is the O(links × stat) shape the story
// names. The PM tree is walked ONCE into a Set of absolute paths — files AND directories,
// because a link to a folder is a legitimate link — and every lookup under PM_ROOT is
// answered from memory.
//
// A MISS FALLS BACK TO A MEMOISED `existsSync`, and that is not belt-and-braces. NTFS is
// case-insensitive: `fs.existsSync('.../adr-0010-x.md')` is true where a Set keyed on the
// real on-disk name misses. Answering "dead" from a case-mismatched Set lookup would invent
// violations that no reader could reproduce by clicking the link. The fallback also covers
// every target outside the PM folder (`../skills/…`, `../package.json`), which is why the
// index is not simply "the repo" — indexing `node_modules/` and `dist/` would cost far more
// than the stats it saves.
let _pathIndex = null;
const _existsMemo = new Map();
function buildPathIndex(root) {
  const set = new Set();
  (function walkAll(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      set.add(full);
      if (e.isDirectory()) walkAll(full);
    }
  })(root);
  set.add(root);
  return set;
}
function pathExists(abs) {
  if (_pathIndex === null) _pathIndex = buildPathIndex(PM_ROOT);
  if (_pathIndex.has(abs)) return true;
  if (_existsMemo.has(abs)) return _existsMemo.get(abs);
  const hit = fs.existsSync(abs);
  _existsMemo.set(abs, hit);
  return hit;
}

/**
 * Every unresolved relative link in one markdown document's BODY.
 *
 * Pure apart from the existence lookup, and exported, so the exemptions can be probed
 * without a corpus — the three of them are the whole rule's judgement.
 *
 * @param {string} text   the document
 * @param {string} dir    the folder the document lives in (links resolve from here)
 * @param {(abs: string) => boolean} exists
 * @returns {{line: number, target: string, tried: string}[]}
 */
function findDeadLinks(text, dir, exists) {
  const out = [];
  const lines = text.split(/\r?\n/);
  // Frontmatter is not body. Its path-valued fields have their own rules (R15/R15b/R16/R18)
  // and a `](…)` there would be a YAML value, not a link.
  let start = 0;
  if (/^---\s*$/.test(lines[0] || '')) {
    for (let i = 1; i < lines.length; i++) {
      if (/^---\s*$/.test(lines[i])) { start = i + 1; break; }
    }
  }
  let openFence = null;    // the opening fence's marker character, or null outside a block
  let openComment = false; // an HTML comment can span lines, so the state has to as well
  for (let i = start; i < lines.length; i++) {
    const rawLine = lines[i];
    const fence = MD_FENCE_RE.exec(rawLine);
    if (fence) {
      const marker = fence[1];
      if (openFence === null) { openFence = marker[0]; continue; }
      // A closing fence must use the same character.
      if (marker[0] === openFence) { openFence = null; }
      continue;
    }
    if (openFence !== null) continue;   // inside a fenced block — not link text

    // Blank out HTML-commented regions, preserving column positions so a match's index
    // still lines up with the un-masked line. Handles `<!--` and `-->` on the same line,
    // on different lines, and several of each per line.
    let masked = '';
    let j = 0;
    while (j < rawLine.length) {
      if (!openComment) {
        const open = rawLine.indexOf('<!--', j);
        if (open === -1) { masked += rawLine.slice(j); break; }
        masked += rawLine.slice(j, open);
        openComment = true;
        j = open;
      } else {
        const close = rawLine.indexOf('-->', j);
        if (close === -1) { masked += ' '.repeat(rawLine.length - j); break; }
        masked += ' '.repeat(close + 3 - j);
        openComment = false;
        j = close + 3;
      }
    }
    // `](path)` inside a code span is LITERAL TEXT — markdown does not render it as a link
    // (BUG-20260804-11). Applied to the comment-masked line so the two exemptions compose.
    const line = masked.replace(/(`+)(?:[^`]|(?!\1)`)*\1/g, (m) => ' '.repeat(m.length));
    for (const m of line.matchAll(MD_LINK_RE)) {
      const target = m[1];
      if (/^(https?:|mailto:|data:|#)/i.test(target)) continue;
      const bare = target.split('#')[0];
      if (!bare) continue;
      const abs = path.resolve(dir, bare);
      if (exists(abs)) continue;
      out.push({
        line: i + 1,
        target,
        tried: path.relative(path.resolve(PM_ROOT, '..'), abs).replace(/\\/g, '/'),
      });
    }
  }
  return out;
}

function reportDeadLinks(full, text, where) {
  for (const d of findDeadLinks(text, path.dirname(full), pathExists)) {
    violate(full, 'R26',
      `line ${d.line}: link target \`${d.target}\` does not resolve from this file's own folder `
      + `(tried ${d.tried}). A markdown link is relative to the file it is written in, so an `
      + `artefact that moves — or a path pasted from a file at a different depth — keeps its link `
      + `text and changes its meaning. Fix the path, or make it absolute from the repo root. `
      + `Link-shaped text inside a code span, a fenced block or an HTML comment is exempt, so if `
      + `this one is illustrative rather than followable, put it in backticks. [${where}]`);
  }
}

// The 41-Reports arm — unchanged scope, unchanged rule id, now sharing one implementation
// with the corpus arm so the two can never disagree about what a link is.
function checkReportLinkTargets(reportsDir = path.join(PM_ROOT, '41-Reports')) {
  if (!fs.existsSync(reportsDir)) return; // deployed project without the folder
  for (const found of reportTree.findReportDocs(reportsDir, (n) => /\.md$/i.test(n))) {
    let text;
    try { text = fs.readFileSync(found.full, 'utf8'); } catch (_) { continue; }
    reportDeadLinks(found.full, text, 'reports');
  }
}

// The corpus arm — every artefact the linter scans (STORY-28.2.02). Reads from main()'s
// cache of file contents rather than re-reading each file.
function checkArtefactLinkTargets(files, textOf) {
  for (const file of files) {
    const text = textOf(file);
    if (text === null || text === undefined) continue;
    reportDeadLinks(file, text, 'artefact');
  }
}

// R27 — LEDGER COMPLETENESS (STORY-26.3.01, PRD §A.8, ADR-0148).
//
// A `done` story that left no line in `41-Reports/retro/retro-log.jsonl` is a hole in the
// calibration data, and the hole is invisible: `retro-capture.js` always exits 0 (ADR-0110, by
// design — capturing a retro must never block a close-out), so a capture that silently stopped
// working looks exactly like a capture that had nothing to say. Nothing else ever asks whether
// the promise was kept. This rule asks, once, at the phase merge.
//
// THE RULE NUMBER IS R27, THE TEST FILE IS `validator-r25.test.js`. STORY-26.3.01 was written
// asking for "R25"; between the writing and the doing, EPIC-27 Phase 3 shipped R25 (flat-root
// guard) and R26 (report link resolution), so R25 is taken twice over. The rule number follows
// the registry. The FILENAME follows the phase plan's stored verify line, which is a contract
// the executing chat cannot edit. The mismatch is deliberate and is recorded in ADR-0148 so the
// next reader does not file it as a bug.
//
// WRITE-FORWARD ACTIVATION. The corpus holds 241 `done` stories that closed before the ledger
// existed, every one of them completed on or before 2026-08-01. A retrospective rule would fail
// lint on all 241 on day one, forcing either a fabricated backfill or a blanket suppression —
// both strictly worse than the gap. The activation date is the day the CAPTURE WIRING landed
// (STORY-26.1.03, completed 2026-08-02T01:48:09+01:00), not the day this rule landed: a story
// closed before capture was wired had no way to comply, and flagging it would be a rule about
// the past pretending to be a rule about the future.
const R27_ACTIVATION_DATE = '2026-08-02';

// The ledger's own path. Overridable with `--retro-log <path>` — the test seam, and the only
// way R27 runs under `--fixtures-dir` at all (see the mode note in main()).
const R27_DEFAULT_LEDGER = path.join(PM_ROOT, '41-Reports', 'retro', 'retro-log.jsonl');

/**
 * Read the set of `story`-level ids present in the ledger.
 *
 * Returns `{ present, ids, skipped }`. `present: false` means the FILE IS NOT THERE, which is a
 * different fact from "the file is there and empty" — see the mode note below. Never throws: a
 * ledger this cannot read must not take `pm:lint` down, which would invert the whole point.
 *
 * Split on `/\r?\n/`: this is a CRLF checkout and the live ledger is CRLF in the working tree.
 */
function readLedgerStoryIds(ledgerPath) {
  const out = { present: false, ids: new Set(), skipped: 0 };
  let text;
  try {
    text = fs.readFileSync(ledgerPath, 'utf8');
    out.present = true;
  } catch (_) {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    let rec;
    try { rec = JSON.parse(line); } catch (_) { out.skipped += 1; continue; }
    if (rec && rec.level === 'story' && typeof rec.id === 'string' && rec.id.trim() !== '') {
      out.ids.add(rec.id.trim());
    }
  }
  return out;
}

/**
 * R27 proper. `storyFiles` and `fmCache` come from main()'s single corpus pass — the ledger is
 * read ONCE here, never once per story.
 *
 * A MISSING ledger file DISABLES the rule (with a warning); an EMPTY-but-PRESENT one does not.
 * The two are different facts. A consumer project that installs this kit and has never run a
 * capture would otherwise take one violation per closed story on the day it installs — the exact
 * fresh-install landmine the activation date exists to avoid, arriving through a different door.
 * A ledger that exists and is empty, by contrast, means capture IS wired and has recorded
 * nothing, which is precisely the silent-failure this rule is for. The disabled case is a W9
 * warning rather than silence, so "the rule is off" is never invisible. See ADR-0148.
 *
 * A `done` story with an EMPTY `completed_at` is out of scope: it cannot be classified by date,
 * and R4/R5 already violate on exactly that combination. Verified: the corpus has none today.
 */
function checkLedgerCompleteness(storyFiles, fmCache, ledgerPath = R27_DEFAULT_LEDGER) {
  const ledger = readLedgerStoryIds(ledgerPath);

  const inScope = [];
  for (const file of storyFiles) {
    const fm = fmCache.get(file);
    if (!fm || fm.status !== 'done') continue;
    const completed = String(fm.completed_at === undefined || fm.completed_at === null
      ? '' : fm.completed_at).trim();
    if (!completed) continue;                                   // R4/R5's job, not this rule's
    if (completed.slice(0, 10) < R27_ACTIVATION_DATE) continue; // pre-activation — never flagged
    if (!fm.id || String(fm.id).trim() === '') continue;        // R1/R10's job
    inScope.push({ file, id: String(fm.id).trim(), completed });
  }

  if (!ledger.present) {
    if (inScope.length > 0) {
      warn(ledgerPath, 'W9',
        `R27 (retro-ledger completeness) is DISABLED: the ledger ` +
        `\`41-Reports/retro/retro-log.jsonl\` does not exist, so "capture is wired but recorded ` +
        `nothing" cannot be told apart from "capture was never wired here". ${inScope.length} ` +
        `story/ies completed on or after ${R27_ACTIVATION_DATE} are therefore unchecked. Run any ` +
        `close-out (or \`93-Scripts/retro-capture.js\`) once to create the ledger and the rule ` +
        `activates by itself.`);
    }
    return;
  }

  for (const s of inScope) {
    if (ledger.ids.has(s.id)) continue;
    violate(s.file, 'R27',
      `Story is \`done\` with \`completed_at: ${s.completed}\` (on or after the R27 activation ` +
      `date ${R27_ACTIVATION_DATE}) but no \`story\`-level record with id \`${s.id}\` exists in ` +
      `\`41-Reports/retro/retro-log.jsonl\`. The retro ledger is the calibration data every ` +
      `retrospective recalls from, and \`retro-capture.js\` always exits 0 by design (ADR-0110) — ` +
      `so a capture that silently failed leaves no other trace. Fix by running the story-level ` +
      `capture from \`close-out-story\` step 5:  node _00-Project-Management/93-Scripts/` +
      `retro-capture.js --level story --id ${s.id} --phase <EPIC-NN> --chat <CHAT-NN> ...  ` +
      `Stories completed before ${R27_ACTIVATION_DATE} (the day capture was wired) are never ` +
      `flagged. See ADR-0148.`);
  }
}

// ---------- R32 — AN AUTHORISATION WITH NO CLOCK (BUG-20260811-03) ----------
//
// `41-Reports/AUTOPILOT-PLAN-*.md` is the authorisation document for an unattended run, and its
// one-line counterpart in `10-Inbox/APPROVALS.md` is the durable record that the run WAS
// authorised. Both were emitted with an EMPTY timestamp when `--created-at` was omitted — plan
// frontmatter `created_at: ''`, and an approval line opening `-  — autopilot run …` with the
// timestamp column simply absent. Exit 0, both success lines printed.
//
// THE PRODUCER AND THE GUARD FAILED OPEN IN THE SAME DIRECTION, WHICH IS WHY THE BUG SURVIVED.
// `pm:lint` reported 0 violations across 1395 artefacts with four unstamped plans on disk, because
// `41-Reports/AUTOPILOT-PLAN-*.md` is outside the corpus the type-driven rules walk — R29 is fatal
// on `created_at` everywhere it LOOKS, and it never looked here. `autopilot-plan.js` now stamps by
// default; this is the half that would have caught it, and that catches a hand-edited plan too.
//
// ---------------------------------------------------------------------------
// DATED, BECAUSE THE DEFECT ALREADY LANDED IN THE RECORD
//
// `AUTOPILOT-PLAN-autopilot-2026-08-05-epic28-29-32a.md` carries `created_at: ''` and its
// APPROVALS line is unstamped — a real, executed run's authorisation, on disk today. ADR-0165
// says an executed record is a record, so a fatal rule with no activation date would demand the
// one edit this kit forbids. The date is derived from the RUN ID (`autopilot-YYYY-MM-DD-slug`),
// which carries the day even when the field does not — so a pre-activation plan is exempt without
// anybody having to write a suppression, and a post-activation one is fatal.
//
// The exemption is a W11 warning rather than silence, exactly as W9 is for R27: "the rule is off
// for this one" must never be invisible.
const R32_ACTIVATION_DATE = '2026-08-18';
// The kit's frontmatter shape: ISO-8601 with an offset (BUG-20260801-04). A bare `Z` is
// ACCEPTED here — it is a valid ISO-8601 instant, and this rule's job is "is there a clock
// on this authorisation", not house style. The comment used to say "never a bare `Z`" while
// the regex on the next line has always allowed one; the regex was right and the comment was
// wrong, and in this file comments are load-bearing (EPIC-30 phase-close review).
const R32_STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[+-]\d{2}:\d{2}|Z)$/;
const R32_RUN_ID_DATE = /autopilot-(\d{4}-\d{2}-\d{2})-/;

/**
 * PURE — findings out, nothing written. Exported so the rule can be driven over a fixture reports
 * dir without planting an unstamped plan in the real tree (the R31 / `checkMonitorAnchors`
 * precedent), and so `main()` stays the only thing that decides fatal-vs-warn routing.
 *
 * @returns {{file: string, rule: string, fatal: boolean, message: string}[]}
 */
function autopilotStampFindings(reportsDir, approvalsPath) {
  const out = [];
  const dateOf = (text) => {
    const m = R32_RUN_ID_DATE.exec(String(text || ''));
    return m ? m[1] : null;
  };
  const stamped = (v) => R32_STAMP_RE.test(String(v || '').trim());

  let names = [];
  try { names = fs.readdirSync(reportsDir); } catch (_) { names = []; }
  for (const name of names.filter(n => /^AUTOPILOT-PLAN-.+\.md$/.test(n)).sort()) {
    const file = path.join(reportsDir, name);
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (_) { continue; }
    const created = (/^created_at:\s*(.*)$/m.exec(text) || [])[1];
    const value = String(created || '').trim().replace(/^['"]|['"]$/g, '');
    if (stamped(value)) continue;
    const day = dateOf((/^run_id:\s*(.*)$/m.exec(text) || [])[1] || name);
    const historic = day !== null && day < R32_ACTIVATION_DATE;
    out.push({
      file,
      rule: historic ? 'W11' : 'R32',
      fatal: !historic,
      message: `run plan \`created_at\` is ${value === '' ? 'EMPTY' : JSON.stringify(value)} — an ` +
        `authorisation with no clock cannot say WHEN it was given, which is the field that ` +
        `distinguishes a live authorisation from one carried over from an earlier run. ` +
        (historic
          ? `This plan's run id dates it ${day}, before the R32 activation date ` +
            `${R32_ACTIVATION_DATE}, so it is recorded rather than flagged — it is an executed ` +
            `record and ADR-0165 forbids rewriting one to make an assertion green.`
          : `\`autopilot-plan.js\` stamps this by default; re-emit the plan, or pass ` +
            `\`--created-at <ISO-8601 with offset>\`. See BUG-20260811-03.`),
    });
  }

  let approvals;
  try { approvals = fs.readFileSync(approvalsPath, 'utf8'); } catch (_) { return out; }
  let lineNo = 0;
  for (const line of approvals.split(/\r?\n/)) {
    lineNo += 1;
    if (!/^-\s/.test(line) || line.indexOf('autopilot run') === -1) continue;
    // EXTRACT THE FIRST TOKEN, VALIDATE IT SEPARATELY. The extractor deliberately does NOT
    // require the convention's em dash after the stamp: this rule is FATAL, and an extractor
    // shaped like the SPELLING of the line would call a correctly-stamped entry that used a
    // plain hyphen "an authorisation with no ISO-8601 timestamp" while printing the timestamp
    // back at the reader (phase-close review, EPIC-30). `stamped()` below is the only thing
    // that decides whether the token is a real stamp, so loosening this cannot let an
    // unstamped line through.
    const stamp = (/^-\s+(\S+)(?:\s|$)/.exec(line) || [])[1];
    if (stamped(stamp)) continue;
    const day = dateOf(line);
    const historic = day !== null && day < R32_ACTIVATION_DATE;
    out.push({
      file: approvalsPath,
      rule: historic ? 'W11' : 'R32',
      fatal: !historic,
      message: `line ${lineNo} logs an autopilot authorisation with no ISO-8601 timestamp — the ` +
        `line opens \`${line.slice(0, 24).replace(/\s+$/, '')}…\`. The skill's entry gate ` +
        `specifies this line as "ISO-8601 timestamp, what was authorised, by: operator, gated: ` +
        `autopilot entry", and the stamp is the half that carries the audit weight. ` +
        (historic
          ? `The run id dates it ${day}, before ${R32_ACTIVATION_DATE}, so it is recorded rather ` +
            `than flagged (ADR-0165).`
          : `\`autopilot-plan.js\` stamps this by default. See BUG-20260811-03.`),
    });
  }
  return out;
}

// ---------- W10 — A LEDGER ROW THAT FORGOT ITS RUN (BUG-20260811-02) ----------
//
// `retro-capture.js` / `usage-capture.js` take the owning run as an explicit `--run` and fall back
// to the literal `unattributed-run` when it is absent — exit 0, a success line, nothing anywhere
// else. The row is then invisible to every run-scoped report and every usage↔retro join. Both
// writers now warn at WRITE time (`lib/run-attribution.js`); this is the backstop that reads rows
// already on disk, because a warning on a terminal an unattended run never sees is only half a
// control.
//
// ---------------------------------------------------------------------------
// IT IS ADVISORY, DATED, AND DELIBERATELY QUIET ABOUT HISTORY
//
// ADR-0165: an executed record is a record — the mis-attributed rows already in the ledger must
// NOT be rewritten. Warning about them on every run would therefore be a warning nobody can act
// on, which this file's own W-tier notes call the thing that gets a warn rule switched off. So
// W10 carries an ACTIVATION DATE, exactly as R27 and R29 do: rows written before it are history
// and are never flagged. Measured at activation: 23 retro rows and 9 usage rows would otherwise
// have been reported on every single `pm:lint`.
//
// ---------------------------------------------------------------------------
// ONLY A GLOBALLY UNIQUE ID COUNTS AS EVIDENCE (BUG-20260810-08's LESSON, APPLIED)
//
// A run plan's `scope_chats:` may carry the BARE `CHAT-03` form, and a bare chat id names one chat
// per epic — the live corpus has `CHAT-03` in three different plans' scopes. Attributing on it is
// precisely the defect BUG-20260810-07/08 are about, so it is ignored here: only `STORY-NN.M.PP`
// and the epic-qualified `E<NN>-CHAT-NN` form are unique enough to say "this row belongs to a run
// somebody planned". A row whose only identifier is bare stays unflagged rather than guessed at.
// AN INSTANT IN **UTC**, NOT A LOCAL CALENDAR DATE. Both writers stamp `ts` with
// `new Date().toISOString()`, which is UTC — and this repository runs at +01:00, so for one hour
// either side of midnight the local date and the ledger's date disagree by a day. A date-shaped
// constant compared against a UTC stamp is off by one for that window, which is how a freshly
// written row reads as history (caught by this rule's own probe, which could not make it fire).
// ISO-8601 UTC strings compare correctly with `<`, so the comparison stays a string one.
const W10_ACTIVATION = '2026-08-18T00:00:00.000Z';
const W10_UNATTRIBUTED = 'unattributed-run';
// THE ID SHAPE IS NOT RESTATED HERE. `lib/artefact-id.js` owns the grammar and
// `tests/artefact-id.test.js :: consumers-converged` fails any consumer that encodes one of its
// own — this rule tripped it on the first draft, which is the guard doing exactly its job.
// The epic-qualified chat id is NOT an artefact-id family (it names a conversation, not an
// artefact), so it is spelled here and nowhere else; the STORY half comes from the shared reader.
const W10_QUALIFIED_CHAT = /^E\d+-CHAT-\d+$/i;
function w10IsUniqueId(value) {
  const s = String(value === undefined || value === null ? '' : value).trim();
  return artefactId.isExactId(s, 'STORY') || W10_QUALIFIED_CHAT.test(s);
}

// ---------------------------------------------------------------------------
// WIDENED — THE RULE WAS AIMED AT AN ID SHAPE THIS KIT'S WRITERS DO NOT PRODUCE
// (BUG-20260818-03(c))
//
// The uniqueness test above is right and stays. What was wrong is that it was applied to the RAW
// id and to nothing else, so it skipped:
//
//   - every chat-level USAGE row, which carries the bare `CHAT-07` form — 79% of that ledger;
//   - every bare `CHAT-NN` entry in a run plan's `scope_chats:`, so `e30-run02`, whose scope is
//     spelled `CHAT-05 / CHAT-06 / CHAT-07`, contributed NO chat scope at all to match against.
//
// Both halves were blind at once, which is how `pm:lint 0` and an unattributed row coexisted
// through a whole epic. The fix is not to relax uniqueness — it is to QUALIFY the bare form first,
// from an epic the artefact itself declares, and only then apply the unchanged test. A bare id
// that cannot be qualified is still skipped, exactly as before.
const W10_BARE_CHAT = /^CHAT-(\d+)$/i;
const W10_EPIC_PREFIX = /^EPIC-0*(\d+)/i;

/** The epic a value names, or null. `STORY-30.4.01` -> 30, `E30-CHAT-07` -> 30, `EPIC-30` -> 30. */
function w10EpicOf(value) {
  const s = String(value === undefined || value === null ? '' : value).trim();
  let m = /^STORY-0*(\d+)\./i.exec(s) || /^E0*(\d+)-CHAT-/i.exec(s) || W10_EPIC_PREFIX.exec(s);
  return m ? Number(m[1]) : null;
}

/** `CHAT-07` + epic 30 -> `E30-CHAT-07`. Anything already unique is returned as-is. */
function w10Qualify(value, epic) {
  const s = String(value === undefined || value === null ? '' : value).trim();
  if (w10IsUniqueId(s)) return s;
  const b = W10_BARE_CHAT.exec(s);
  if (!b || epic === null || epic === undefined) return null;
  return `E${Number(epic)}-CHAT-${b[1]}`;
}

/**
 * Every unique id a LEDGER ROW can be known by, including the qualified form of a bare chat id
 * recovered from the row's own `phase:` field. Upper-cased for comparison.
 */
function w10RowIds(rec) {
  const epic = w10EpicOf(rec.phase) !== null ? w10EpicOf(rec.phase)
    : (w10EpicOf(rec.id) !== null ? w10EpicOf(rec.id) : w10EpicOf(rec.join_key));
  const out = new Set();
  for (const v of [rec.id, rec.chat, rec.join_key]) {
    if (typeof v !== 'string' || v.trim() === '') continue;
    const q = w10Qualify(v, epic);
    if (q && w10IsUniqueId(q)) out.add(q.toUpperCase());
  }
  return [...out];
}

/**
 * A phase-level row (`EPIC-30-P1`) is named in no plan's scope list, so scope cannot judge it.
 *
 * THE EPIC HALF IS NOT SPELLED HERE. `lib/artefact-id.js` owns that grammar and
 * `tests/artefact-id.test.js :: consumers-converged` fails any consumer that encodes one of its
 * own — it caught the first draft of this very function, which is the guard doing exactly its job
 * (the same way it caught the W10 rule's first draft). So the phase SUFFIX is stripped and what
 * remains is handed to the shared reader. Only `-P<n>` is spelled locally, and that is not an
 * artefact-id family: it names a phase within a run, the same exemption the epic-qualified chat
 * id already takes.
 */
const W10_PHASE_SUFFIX = /-P\d+$/i;
function w10IsPhaseRow(rec) {
  const s = String(rec && rec.id ? rec.id : '').trim();
  if (!W10_PHASE_SUFFIX.test(s)) return false;
  return artefactId.isExactId(s.replace(W10_PHASE_SUFFIX, ''), 'EPIC');
}

/** Run id -> the set of UNIQUE scope entries its plan declares. Never throws. */
function readRunScopes(reportsDir) {
  const scopes = new Map();
  let names;
  try { names = fs.readdirSync(reportsDir); } catch (_) { return scopes; }
  const strip = s => String(s).trim().replace(/^['"]|['"]$/g, '');
  for (const name of names.filter(n => /^AUTOPILOT-PLAN-.+\.md$/.test(n))) {
    let text;
    try { text = fs.readFileSync(path.join(reportsDir, name), 'utf8'); } catch (_) { continue; }
    const runMatch = /^run_id:\s*(.+)$/m.exec(text);
    if (!runMatch) continue;
    const runId = strip(runMatch[1]);
    if (!runId) continue;
    // TWO PASSES, because a bare `CHAT-07` can only be qualified once the plan's epic is known,
    // and the epic is carried by the plan's OTHER entries (its `scope_stories:`). A single pass
    // dropped every bare chat entry on the floor — see the note above `W10_BARE_CHAT`.
    const raw = [];
    for (const key of ['scope_chats', 'scope_stories']) {
      const block = new RegExp(`^${key}:\\s*\\r?\\n((?:[ \\t]*-[ \\t].*\\r?\\n)*)`, 'm').exec(text);
      if (!block) continue;
      for (const line of block[1].split(/\r?\n/)) {
        const entry = /^[ \t]*-[ \t]*(.*)$/.exec(line);
        if (!entry) continue;
        const v = strip(entry[1]);
        if (v) raw.push(v);
      }
    }
    const epics = new Set();
    for (const v of raw) {
      const e = w10EpicOf(v);
      if (e !== null && !W10_EPIC_PREFIX.test(v)) epics.add(e);
    }
    // Only an UNAMBIGUOUS single-epic plan may qualify its own bare entries. A run spanning
    // several epics (the 08-05 run spans 28/29/32) cannot say which one `CHAT-03` meant, and
    // guessing there would re-introduce exactly the collision BUG-20260810-07/08 closed.
    const planEpic = epics.size === 1 ? [...epics][0] : null;

    const items = new Set();
    for (const v of raw) {
      const q = w10Qualify(v, planEpic);
      if (q && w10IsUniqueId(q)) items.add(q.toUpperCase());
    }
    if (items.size) scopes.set(runId, items);
  }
  return scopes;
}

/**
 * W10 proper. Reads BOTH ledgers — the retro one and its usage sibling — because the live
 * incident produced one bad row in EACH for the same chat, and a rule that read one of them would
 * be the half-fix this repository keeps paying for.
 *
 * The reports dir is DERIVED from the ledger path (`<reports>/retro/retro-log.jsonl`) rather than
 * taken from PM_ROOT, so `--retro-log` relocates the plans and the usage ledger with it and the
 * rule is testable against a fixture without a second flag.
 */
function checkUnattributedRunRows(ledgerPath) {
  const reportsDir = path.dirname(path.dirname(ledgerPath));
  const scopes = readRunScopes(reportsDir);
  if (scopes.size === 0) return;                 // no authorised run on disk — nothing to miss

  const ledgers = [
    ['retro', ledgerPath],
    ['usage', path.join(reportsDir, 'usage', 'usage-log.jsonl')],
  ];
  for (const [label, file] of ledgers) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (_) { continue; }
    let lineNo = 0;
    for (const line of text.split(/\r?\n/)) {
      lineNo += 1;
      if (line.trim() === '') continue;
      let rec;
      try { rec = JSON.parse(line); } catch (_) { continue; }   // R27's reader owns malformed lines
      if (!rec) continue;
      const declared = String(rec.run_id === undefined || rec.run_id === null ? '' : rec.run_id).trim();
      if (declared === '') continue;                  // pre-field history: the key did not exist
      const ts = String(rec.ts || '').trim();
      if (!ts || ts < W10_ACTIVATION) continue;                    // history stays history
      const ids = w10RowIds(rec);
      if (!ids.length) continue;

      // ---- ARM 1 — the row forgot its run, and some plan declares it. -----------------------
      if (declared === W10_UNATTRIBUTED) {
        const candidates = [...scopes].filter(([, items]) => ids.some(i => items.has(i)))
          .map(([runId]) => runId);
        if (!candidates.length) continue;
        warn(file, 'W10',
          `${label}-ledger line ${lineNo} records \`run_id: "${W10_UNATTRIBUTED}"\` for ` +
          `\`${rec.id}\`, but ${candidates.length === 1 ? 'run' : 'runs'} ` +
          `${candidates.map(c => `\`${c}\``).join(' / ')} ${candidates.length === 1 ? 'declares' : 'declare'} ` +
          `it in scope — so \`--run\` was almost certainly forgotten and this row is invisible to ` +
          `every run-scoped report and to the usage↔retro join. Re-capture with \`--run\`, record ` +
          `why it belongs to no run, or repair it under ADR-0216 (\`93-Scripts/` +
          `backfill-run-attribution.js\`, which stamps \`run_id_source\` so a derived attribution ` +
          `stays distinguishable from a captured one). Rows written before ${W10_ACTIVATION} are ` +
          `history and are never flagged. See BUG-20260811-02.`);
        continue;
      }

      // ---- ARM 2 — the row names a run whose plan does NOT declare it (BUG-20260818-03(c)). --
      //
      // NOTHING IN THE KIT LOOKED FOR THIS. Arm 1 catches an ABSENT attribution; a WRONG one was
      // invisible to every rule, and the live incident produced one: E30-CHAT-07's retro row
      // credited its cost and outcome to `e30-run01` — a completed, foreign run whose plan scope
      // is CHAT-01..04. A false attribution is strictly worse than an absent one, because every
      // consumer believes it.
      //
      // Deliberately narrow, so it accuses only when it can be sure:
      //   - the named run must be ON DISK. An unknown run id may be a plan this checkout does not
      //     have, and W10 does not flag what it cannot read.
      //   - PHASE-LEVEL rows are exempt. `EPIC-30-P1` appears in no plan's scope list by design,
      //     so "not declared" is the normal case for them and would be a pure false positive.
      const owner = scopes.get(declared);
      if (!owner) continue;
      if (w10IsPhaseRow(rec)) continue;
      if (ids.some(i => owner.has(i))) continue;                   // correctly attributed
      const better = [...scopes].filter(([, items]) => ids.some(i => items.has(i)))
        .map(([runId]) => runId);
      warn(file, 'W10',
        `${label}-ledger line ${lineNo} attributes \`${rec.id}\` to run \`${declared}\`, but that ` +
        `run's plan does NOT declare it in scope` +
        (better.length
          ? ` — ${better.length === 1 ? 'run' : 'runs'} ${better.map(c => `\`${c}\``).join(' / ')} ` +
            `${better.length === 1 ? 'does' : 'do'}`
          : ` and no run on disk declares it`) +
        `. A WRONG attribution is worse than an absent one: every run-scoped report believes it. ` +
        `Confirm which run owns this unit and repair it under ADR-0216 ` +
        `(\`93-Scripts/backfill-run-attribution.js\` records the prior value as ` +
        `\`run_id_source: "corrected:<prior>"\`, so nothing is destroyed). See BUG-20260818-03.`);
    }
  }
}

// ---------- R28 — TWO ARTEFACTS, ONE ID (STORY-28.2.01, BACKLOG-0122) ----------
//
// An artefact id is the kit's only stable reference. `depends_on:`, `story:`, `testplan:`,
// `superseded_by:`, every MONITOR line, every retro-ledger record and every cross-reference in
// prose resolves an id to ONE artefact. When two artefacts declare the same one, every consumer
// silently picks a winner — R7/R8 use `.some()`, the dashboard's `findArtefact` uses `.find()` —
// and the loser becomes invisible while still appearing on the board. Nothing has ever asked
// whether an id is unique; the gap was found by hand during the BACKLOG-0122 interstitial.
//
// ============================================================================
// THE IDENTITY CONTRACT IS (id + SCOPE), NOT id ALONE — AND THE SCOPE IS THE BUG COUNTER'S
// ============================================================================
// `_00-Project-Management/CLAUDE.md` § Numbering rules is the source:
//
//     Epic / Feature / Story / Testplan / Backlog / Release / Retro — sequential across the
//     PROJECT. Two files with one of these ids are the same artefact twice. GLOBAL scope.
//
//     ADR — "sequential across the whole project, no folder grouping". GLOBAL scope.
//
//     BUG — "BUG-YYYYMMDD-NN where NN is the sequential bug filed that day WITHIN THAT FEATURE
//     FOLDER". The counter restarts per folder BY DESIGN, so `BUG-20260805-01` legitimately
//     exists once under every feature that filed a bug that day. FOLDER scope.
//
// This is not a carve-out bolted on to make the corpus pass: a naive global rule reports 20
// duplicate ids on today's corpus, all of them BUG ids obeying the documented scheme, and
// reddening half of `34-Bugs/` is how a rule gets switched off in its first week. The scope is
// the CONTAINING DIRECTORY, which for `34-Bugs/EPIC-NN/FEAT-NN.M/` IS the feature folder — so
// two `BUG-20260805-01`s in the SAME folder are still a collision, which is the case the day
// counter can actually get wrong. Measured on the corpus as committed: 0 violations under this
// contract, 20 under the naive one.
//
// Keyed on the id PREFIX rather than on `type: bug`, deliberately: a bug file whose `type:` is
// wrong is still a bug by its id and its folder, and scoping it globally would fire a confusing
// second violation on top of the one R10/R1 already report.
//
// STORY-28.3.01: the SCOPE now travels with the grammar in lib/artefact-id.js
// (`scope: 'folder'` on the BUG family) instead of being a second hand-written statement of
// CLAUDE.md § Numbering rules living here. Which families restart their counter per folder is
// exactly the kind of fact that goes stale in one copy and not the other.
//
// FATAL. An id collision is not advisory — it silently breaks reference resolution, and the fix
// (renumber the newer artefact) is mechanical and always available.

/**
 * @param {string[]} files every artefact in the scan set
 * @param {Map<string, object|null>} fmCache main()'s single-pass frontmatter cache
 * Emits ONE violation per colliding identity, attached to the first path in sorted order and
 * naming EVERY path involved — a violation per participating file would report the same fact
 * N times and still leave the reader to assemble the list.
 */
function checkDuplicateIds(files, fmCache) {
  const groups = new Map();
  for (const file of files) {
    const fm = fmCache.get(file);
    if (!fm) continue;                                   // no frontmatter — R0 owns it
    const id = (fm.id === undefined || fm.id === null) ? '' : String(fm.id).trim();
    if (!id) continue;                                   // absent id — R1/R10's job, not a collision
    const folderScoped = artefactId.isFolderScoped(id);
    // NUL joins the scope to the id: no folder name can contain it, so the key cannot be
    // forged by a directory that happens to be named like an id.
    const key = folderScoped ? `${path.dirname(file)}\u0000${id}` : `\u0000${id}`;
    if (!groups.has(key)) groups.set(key, { id, folderScoped, files: [] });
    groups.get(key).files.push(file);
  }
  for (const g of groups.values()) {
    if (g.files.length < 2) continue;
    const sorted = g.files.slice().sort();
    const named = sorted.map(f => rel(f)).join('\n         ');
    violate(sorted[0], 'R28',
      `id '${g.id}' is declared by ${g.files.length} artefacts:\n         ${named}\n       ` +
      `An id is the only stable reference the kit has — \`depends_on:\`, \`story:\`, ` +
      `\`testplan:\` and every cross-reference resolve it to ONE artefact, so a collision makes ` +
      `one of these permanently unreachable while it still renders on the board. Renumber the ` +
      `NEWER artefact (and update anything that cites it). ` +
      (g.folderScoped
        ? `Scope: this id is folder-scoped (BUG-YYYYMMDD-NN restarts its counter per feature ` +
          `folder, see CLAUDE.md § Numbering rules) — the same id in a DIFFERENT folder is fine; ` +
          `these two share one folder.`
        : `Scope: this id type is project-global (CLAUDE.md § Numbering rules) — only BUG ids ` +
          `are folder-scoped.`));
  }
}

// ---------- R30 — A PLAN CANNOT NAME A DASHBOARD VIEW THAT DOES NOT EXIST ----------
// (STORY-28.2.03 / BACKLOG-0110 Tranche B / ADR-0171.)
//
// `smoke-dashboard.js --views <csv>` resolves its list against the rail views actually present
// in the rendered DOM and exits 2 on an unknown one — loudly, by design (ADR-0112), rather than
// skipping it. That is the RUNTIME half. The plan-time half was missing: a testplan or a strategy
// sidecar could name `--views docs` for weeks, and the first anyone heard of it was a phase-1
// halt when the chat that owned the story finally ran the line. BACKLOG-0110 was raised for
// exactly that, and the corpus still carried one when this rule landed.
//
// THE VOCABULARY IS READ FROM `RAIL_GROUPS`, NEVER FROM A COPY. `generate-dashboard.js` exports
// it (STORY-27.1.03 made the nav config single-source for this reason), and it is required
// LAZILY — only once a `--views` value has actually been found — so a lint run over a corpus
// that mentions no views pays nothing for a rule it does not need. A hand-typed list here would
// be a second source of truth for the rail, which is the BUG-20260804-35 lesson.
//
// SCOPE IS COMMANDS, NOT PROSE, and that distinction is load-bearing. A first draft matched
// `--views` anywhere in an artefact and reported six offenders, five of which were sentences
// ABOUT the flag — "a `--views` token outside RAIL_GROUPS", "`--views` names N view(s)" — in the
// very stories and backlog items that asked for this rule. The rule therefore reads only:
//   - fenced ```bash blocks in TESTPLAN-*.md            (the W5 precedent)
//   - `verify` and `trigger` strings in EXECUTION-STRATEGY-*.json
//   - fenced blocks in the EXECUTION-STRATEGY-*.md twins (a human copies commands from those,
//     and the twin drifting from the JSON is how a defective line survived in both copies until
//     BUG-20260803-01)
//
// `--views all` ALWAYS PASSES: it is the harness's own "every view" token, resolved against the
// DOM at runtime, and it is the correct answer whenever a list would have to be maintained.
//
// FATAL. The defect class it catches is a halt — a chat stops mid-phase because its verify line
// names something that was never there — and the fix is to correct one token in a plan nobody
// has executed yet.
const VIEWS_FLAG_RE = /--views(?:=|\s+)(?:'([^']*)'|"([^"]*)"|([^\s'"|;&)]+))/g;

let _railVocabulary = null;
/** @returns {{ok: true, views: string[]} | {ok: false, why: string}} */
function railVocabulary() {
  if (_railVocabulary === null) {
    try {
      const gen = require('./generate-dashboard.js');
      const groups = gen && gen.RAIL_GROUPS;
      if (!Array.isArray(groups) || groups.length === 0) {
        _railVocabulary = { ok: false, why: 'generate-dashboard.js exports no RAIL_GROUPS array' };
      } else {
        const views = groups.map(g => String(g[0])).filter(v => v !== '');
        _railVocabulary = views.length
          ? { ok: true, views }
          : { ok: false, why: 'RAIL_GROUPS carries no view keys' };
      }
    } catch (e) {
      _railVocabulary = { ok: false, why: `could not load generate-dashboard.js: ${e.message}` };
    }
  }
  return _railVocabulary;
}

/**
 * Every `--views` value in one command string, with its unknown tokens.
 * Pure and exported: the vocabulary is injected, so a probe can state the boundary without
 * depending on whichever views the dashboard happens to carry today.
 * @returns {{raw: string, tokens: string[], unknown: string[]}[]}
 */
function viewsUsagesIn(command, vocabulary) {
  const known = new Set(vocabulary);
  const out = [];
  for (const m of String(command).matchAll(VIEWS_FLAG_RE)) {
    const raw = m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3]);
    if (raw === undefined) continue;
    const tokens = raw.split(',').map(t => t.trim()).filter(Boolean);
    out.push({
      raw,
      tokens,
      unknown: tokens.filter(t => t !== 'all' && !known.has(t)),
    });
  }
  return out;
}

// ONE fence regex for both arms of R30. They used to differ — ```bash only for testplans,
// any language for the `.md` twins — so a `--views` inside a ```sh / ```shell / ```console /
// bare fence was invisible in a TESTPLAN and caught in a twin (review MINOR-6). Latent, not
// live: the corpus uses ```bash 1572 times and ```powershell once. Latent is when to fix it.
const FENCED_BLOCK_RE = /```[a-z]*\r?\n([\s\S]*?)```/g;

function checkViewsVocabulary(opts = {}) {
  const testplansDir = opts.testplansDir
    || path.join(PM_ROOT, PATHS.testplans || '33-Testplans');
  const reportsDir = opts.reportsDir || path.join(PM_ROOT, '41-Reports');

  // Every (file, label, command) the rule is allowed to read.
  const commands = [];
  if (fs.existsSync(testplansDir)) {
    (function walkTp(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walkTp(full); continue; }
        if (!/^TESTPLAN-.*\.md$/.test(entry.name)) continue;
        const text = fs.readFileSync(full, 'utf8');
        if (text.indexOf('--views') === -1) continue;
        for (const block of text.matchAll(FENCED_BLOCK_RE)) {
          commands.push({ file: full, label: 'TC command', command: block[1] });
        }
      }
    })(testplansDir);
  }
  if (fs.existsSync(reportsDir)) {
    for (const found of reportTree.findReportDocs(reportsDir,
      (n) => /^EXECUTION-STRATEGY-.*\.(json|md)$/.test(n))) {
      const full = found.full;
      let text;
      try { text = fs.readFileSync(full, 'utf8'); } catch (_) { continue; }
      if (text.indexOf('--views') === -1) continue;
      if (/\.json$/i.test(full)) {
        let data;
        try { data = JSON.parse(text); } catch (_) { continue; } // malformed sidecar: not this rule's fight
        for (const phase of (Array.isArray(data && data.phases) ? data.phases : [])) {
          for (const chat of (Array.isArray(phase && phase.chats) ? phase.chats : [])) {
            for (const key of ['verify', 'trigger']) {
              if (typeof chat[key] !== 'string' || chat[key].indexOf('--views') === -1) continue;
              commands.push({
                file: full,
                label: `${chat.id || '(chat)'} ${key}`,
                command: chat[key],
              });
            }
          }
        }
      } else {
        for (const block of text.matchAll(FENCED_BLOCK_RE)) {
          commands.push({ file: full, label: 'command block', command: block[1] });
        }
      }
    }
  }
  if (!commands.length) return;   // nothing names --views; the vocabulary is never loaded

  const vocab = railVocabulary();
  if (!vocab.ok) {
    // Fail loudly rather than silently linting nothing on every future run — the stance W4's
    // and W5's config loaders already take.
    violate(PM_ROOT, 'VIEWS-VOCAB-CONFIG',
      `the \`--views\` vocabulary could not be read from the dashboard's RAIL_GROUPS ` +
      `(${vocab.why}), so R30 cannot check the ${commands.length} command(s) that name it. ` +
      `The vocabulary has ONE source by design (STORY-27.1.03); this rule will not fall back ` +
      `to a hand-typed copy.`);
    return;
  }

  for (const c of commands) {
    for (const usage of viewsUsagesIn(c.command, vocab.views)) {
      if (!usage.unknown.length) continue;
      violate(c.file, 'R30',
        `${c.label}: \`--views ${usage.raw}\` names ${usage.unknown.length} view(s) that do not ` +
        `exist: ${usage.unknown.join(', ')}. The rail carries exactly: ${vocab.views.join(', ')} ` +
        `(plus the literal \`all\`). \`smoke-dashboard.js\` resolves this list against the rendered ` +
        `rail and exits 2 on an unknown entry (ADR-0112), so this line cannot run — and nothing ` +
        `would have said so until the chat that owns it reached this step and halted ` +
        `(BACKLOG-0110). Fix the token, or use \`--views all\`. If the view is one a future story ` +
        `will ADD, the plan cannot name it yet: the vocabulary is read from the dashboard's ` +
        `RAIL_GROUPS, which is the only place a view becomes real.`);
    }
  }
}

function checkVerifyAntiPatterns(reportsDir = path.join(PM_ROOT, '41-Reports')) {
  if (!fs.existsSync(reportsDir)) return;
  // STORY-27.3.02 — reader site 4 of 6. Was a flat `readdirSync`. This check is
  // advisory (warn-tier) and no-ops gracefully on an empty folder, so a corpus
  // migration would have turned it off entirely without a single message: the
  // lint would keep reporting 0 violations while scanning nothing.
  for (const found of reportTree.findReportDocs(reportsDir, (n) => /^EXECUTION-STRATEGY-.*\.json$/.test(n))) {
    const full = found.full;
    let data;
    try {
      data = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch {
      continue; // malformed sidecar — not this check's job to fail the build over.
    }
    const phases = Array.isArray(data && data.phases) ? data.phases : [];
    for (const phase of phases) {
      const chats = Array.isArray(phase && phase.chats) ? phase.chats : [];
      for (const chat of chats) {
        const verify = chat && typeof chat.verify === 'string' ? chat.verify : '';
        if (!verify) continue;
        // Strip $(...) and `...` command substitutions so a legitimate `$(… | head -1)`
        // (head feeding a real `test -n` exit-code gate) is NOT mistaken for a masked gate.
        const bare = verify.replace(/\$\([^)]*\)/g, '').replace(/`[^`]*`/g, '');
        if (/\|\s*(tail|head)\b/.test(bare)) {
          warn(full, 'W2',
            `${chat.id || '(chat)'} verify pipes a gate into \`| tail\`/\`| head\`, which masks ` +
            `the real exit status (the pipeline can never fail). Use an exit-code gate ` +
            `(\`npm run pm:lint >/dev/null 2>&1 && echo OK\`) instead. See BUG-20260608-01.`);
        }
        if (/pm:mirror/.test(verify)) {
          warn(full, 'W2',
            `${chat.id || '(chat)'} verify still calls \`npm run pm:mirror\`, a gate retired in ` +
            `ADR-0074 (the script no longer exists, so this now hard-fails). Drop it from the ` +
            `verify line.`);
        }
      }
    }
  }
}

// ---------- W4 — prompt-language lint (STORY-24.1.02 / BACKLOG-0091 / ADR-0104) ----------
// Advisory (warn-tier, ADR-0061) scan of `skills/**/SKILL.md` and `<prompts>/**/*.md` for
// model-fragile prompt phrases — patterns that once were standard prompting advice but now
// cause over-verification, refusal triggers, or tool-overtriggering on newer Claude models
// (e.g. "double-check your", "ALWAYS use"). The seed phrase list lives in
// lib/prompt-lint-phrases.json (config/data, not code — AC-2), so extending it never touches
// this file. Every hit routes through warn(), never violate() — a future edit that
// reintroduces a banned phrase gets nudged in `pm:lint` output, never blocked (same stance as
// W1/W2/W3). Corpus scan only (skipped under --fixtures-dir and --prompt-lint-target, which
// exercise the phrase-matching logic in isolation — see main()'s standalone target-mode
// handling and test-prompt-lint.js).
function checkPromptLint(skillsDir = path.join(REPO_ROOT, 'skills'),
                          promptsDir = path.join(PM_ROOT, PATHS.prompts)) {
  let phrases;
  try {
    phrases = promptLint.loadPhraseConfig();
  } catch (e) {
    // A broken phrase config is a script/data problem, not a corpus problem — fail loudly
    // (fatal) rather than silently linting nothing on every future run.
    violate(PM_ROOT, 'PROMPT-LINT-CONFIG', `prompt-lint phrase config failed to load: ${e.message}`);
    return;
  }
  const files = promptLint.findCorpusFiles(skillsDir, promptsDir);
  for (const f of files) {
    const hits = promptLint.scanFile(f, phrases);
    for (const hit of hits) {
      warn(f, 'W4',
        `Model-fragile prompt phrase '${hit.phrase}' at line ${hit.line} — ${hit.reason}. ` +
        `Replacement: ${hit.replacement}. See 90-Standards/CLAUDE-CODE-CONFIG.md ` +
        `§ "Cross-model prompt language".`);
    }
  }
}

// ---------- W5 — testplan TC-command lint (RETRO-2026-07 One change) ----------
// Advisory (warn-tier, ADR-0061) scan of the fenced ```bash blocks inside
// <testplans>/**/TESTPLAN-*.md for commands that cannot run unattended everywhere, or that
// mutate destructively, or that mask their own exit status.
//
// WHY THIS EXISTS: RETRO-2026-05 proposed this check, nobody owned it, and the same defect
// class then produced BUG-20260608-01/02, BUG-20260609-01/02 and BUG-20260801-01/02/03 across
// three consecutive months. RETRO-2026-07 made it the committed One change.
//
// Patterns live in lib/testplan-command-patterns.json (config/data, not code) so extending the
// list never touches this file — same stance as W4's phrase config. Every hit routes through
// warn(), never violate(): a historical testplan must not break the build, while a freshly
// written one gets surfaced. Measured clean over the 52 testplans written 2026-08-01 before
// landing; the two hits it does report on the pre-existing corpus are genuine gate-masking.
function checkTestplanCommands(testplansDir = path.join(PM_ROOT, PATHS.testplans || '33-Testplans')) {
  if (!fs.existsSync(testplansDir)) return;
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(
      path.join(__dirname, 'lib', 'testplan-command-patterns.json'), 'utf8'));
  } catch (e) {
    // A broken pattern config is a script/data problem, not a corpus problem — fail loudly
    // rather than silently linting nothing on every future run (same stance as W4).
    violate(PM_ROOT, 'TESTPLAN-CMD-CONFIG',
      `testplan-command pattern config failed to load: ${e.message}`);
    return;
  }
  const pats = (cfg.patterns || []).map(p => ({ ...p, re: new RegExp(p.pattern, p.flags || '') }));
  if (!pats.length) return;

  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (/^TESTPLAN-.*\.md$/.test(entry.name)) files.push(full);
    }
  })(testplansDir);

  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    for (const block of text.matchAll(/```bash\n([\s\S]*?)```/g)) {
      const lines = block[1].split('\n');
      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        if (!raw.trim() || raw.trim().startsWith('#')) continue;
        // Strip $(...) and `...` command substitutions so a legitimate `$(… | head -1)` feeding
        // a real exit-code gate is not mistaken for a masked gate — same carve-out as W2.
        const bare = raw.replace(/\$\([^)]*\)/g, '').replace(/`[^`]*`/g, '');
        for (const pat of pats) {
          if (pat.re.test(bare)) {
            warn(f, 'W5',
              `TC command matches '${pat.id}' — ${pat.reason}. Fix: ${pat.fix}. ` +
              `(line ${i + 1} of a \`\`\`bash block)`);
          }
        }
      }
    }
  }
}

// ---------- R31 — ONE BOARD, ONE DOCUMENT (STORY-28.3.03, BUG-20260804-01) ----------
//
// `42-Monitor/MONITOR.md` held TWO COMPLETE COPIES of itself for roughly eight phases of a
// thirteen-phase run. Every writer and every reader located its section by first match, so each
// one silently picked a body: 36 revision entries landed in copy one, 217 in copy two, none in
// both, and neither copy was the record. The merge rebuilt one document holding the union.
//
// STORY-28.3.03 makes the WRITERS refuse an ambiguous anchor. This is the other direction, and it
// is not redundant with them: a duplication can arrive from a merge, a restore, an editor, or a
// skill following prose instructions — none of which run a kit writer — and in that case the first
// thing to notice would again be a fork nobody can reconstruct. `pm:lint` runs on every close-out,
// so the corruption is caught within one story of appearing regardless of who caused it.
//
// SCOPE IS AMBIGUITY, NOT ABSENCE. Only anchors occurring MORE THAN ONCE are reported. A missing
// marker block is already `pm:monitor`'s own error, and a board that has never had one is a
// different problem from a board that has two of them.
//
// The anchor list is `lib/monitor-anchors.js` — the same array the writers check, so a rule and a
// writer cannot come to disagree about what an anchor is. Normal mode only: the isolated fixtures
// dir carries no board. The checker takes its path so it can be driven over a fixture.
//
// FATAL. A forked board is silent, cumulative and expensive to reconstruct — the 2026-08-04 merge
// took a session — while the fix at first sight is one deletion.
function checkMonitorAnchors(monitorPath) {
  const p = monitorPath || path.join(PM_ROOT, PATHS.monitor || '42-Monitor', 'MONITOR.md');
  if (!fs.existsSync(p)) return;                        // no board: R25/R0 territory, not this rule
  const text = fs.readFileSync(p, 'utf8');
  for (const problem of monitorAnchors.ambiguousAnchors(text)) {
    violate(p, 'R31',
      `MONITOR.md carries ${problem.lines.length} copies of the anchor \`${problem.name}\` ` +
      `(line ${problem.lines.join(', line ')}). One board, one document: every writer and reader ` +
      `of this file resolves its section by FIRST match, so a second copy does not read as an ` +
      `error — it reads as a different board. In 2026-08-03 the file forked in exactly this way ` +
      `and 253 revision entries ended up split across two bodies with nothing in both ` +
      `(BUG-20260804-01). Merge the duplicated sections into one document, keeping the UNION of ` +
      `the revision entries, then re-run \`npm run pm:monitor\`.`);
  }
}

// ---------- W6 — supersession traceability for non-delivered terminal status ----------
// A `duplicate` or `wontfix` artefact is a claim that the work went somewhere else, or nowhere.
// If it does not say WHERE, a future reader cannot tell whether the need was met, folded into
// another item, or quietly dropped — and the board reads as if the work happened.
//
// WHY: a 2026-08-02 sweep found 49 `duplicate` backlog items, of which 21 named no supersession
// in prose — the link was inferable only by reading cited ids and guessing. None were provably
// lost, but "inferable by a careful reader" is not traceability.
//
// Warn-tier (ADR-0061): never fails pm:lint, never blocks a merge. Its job is to make the debt
// visible on every run until someone writes the sentence, and to stop the next one being created
// without it. `done` and `archived` are deliberately NOT checked — `done` means delivered here,
// and `archived` is an explicit sunset (SOP §15) that carries its own rationale.
function checkSupersessionTraceability(pmRoot = PM_ROOT) {
  const SCOPED = ['11-Backlog', PATHS.stories || '32-Stories', '34-Bugs'];
  const NEEDS_TARGET = ['duplicate', 'wontfix'];
  // STORY-28.3.01 / ADR-0175: the id vocabulary is the canonical one, not a private
  // six-family subset. The copy that used to live here omitted TESTPLAN, RELEASE and
  // RETRO, so "covered by TESTPLAN-01.2.03" and "replaced by RELEASE-v2.7.1" did not
  // count as saying where the work went — a supersession named in perfectly good prose
  // still warned. Widening can only silence a W6 warning, never create one; measured on
  // the corpus at the switch: unchanged.
  const PROSE_RE = /duplicate of|superseded by|supersedes|folded into|absorbed|promoted (in)?to|became|tracked (by|in)|replaced by|covered by|wontfix because|not doing because/i;

  for (const sub of SCOPED) {
    const dir = path.join(pmRoot, sub);
    if (!fs.existsSync(dir)) continue;
    (function walk(d) {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.name.endsWith('.md')) continue;
        const text = fs.readFileSync(full, 'utf8');
        const status = (text.match(/^status:\s*(\S+)/m) || [])[1];
        if (!NEEDS_TARGET.includes(status)) continue;
        const body = text.replace(/^---[\s\S]*?---/, '');
        const explicit = PROSE_RE.test(body) && artefactId.mentionsId(body);
        const declared = /^superseded_by:\s*\S/m.test(text);
        if (explicit || declared) continue;
        warn(full, 'W6',
          `status is \`${status}\` but the artefact never states where the work went. A reader ` +
          `cannot tell whether it was folded elsewhere or dropped. Add one sentence naming the ` +
          `superseding artefact (e.g. "Superseded by STORY-12.3.04") or a \`superseded_by:\` field.`);
      }
    })(dir);
  }
}

// ---------- Main ----------

function main() {
  // --prompt-lint-target <file> — single-file phrase-lint report, then exit. Runs BEFORE
  // any frontmatter/corpus logic because the target is typically a frontmatter-free fixture
  // (it would otherwise trip R0 "missing frontmatter"). Warn-tier: ALWAYS exits 0, regardless
  // of hit count — this is the fixture-driven test seam for TESTPLAN-24.1.02 TC-01.
  if (PROMPT_LINT_TARGET) {
    if (!fs.existsSync(PROMPT_LINT_TARGET)) {
      console.error(`✗ --prompt-lint-target file not found: ${PROMPT_LINT_TARGET}`);
      process.exit(2);
    }
    let phrases;
    try {
      phrases = promptLint.loadPhraseConfig();
    } catch (e) {
      console.error(`✗ prompt-lint phrase config failed to load: ${e.message}`);
      process.exit(2);
    }
    const hits = promptLint.scanFile(PROMPT_LINT_TARGET, phrases);
    const base = path.basename(PROMPT_LINT_TARGET);
    if (hits.length === 0) {
      console.log(`✓ prompt-lint — 0 finding(s) for ${base}.`);
    } else {
      console.log(`⚠ prompt-lint — ${hits.length} WARN finding(s) for ${base}:`);
      hits.forEach((hit, i) => {
        console.log(`  ${i + 1}. WARN [${hit.phrase}] ${base}:${hit.line} — ${hit.reason}. ` +
          `Replacement: ${hit.replacement}.`);
      });
    }
    process.exit(0);
  }

  // Resolve scan root depending on mode.
  const scanRoot = FIXTURES_DIR || PM_ROOT;
  if (!fs.existsSync(scanRoot)) {
    console.error(`✗ scan root not found: ${scanRoot}`);
    process.exit(2);
  }

  // Collect all files first so cross-references can resolve.
  const allFiles = [];
  if (FIXTURES_DIR) {
    // Flat walk of the fixtures dir — no subdir conventions.
    walk(FIXTURES_DIR, allFiles);
  } else {
    for (const dir of SCAN_DIRS) {
      walk(path.join(PM_ROOT, dir), allFiles);
    }
  }

  // THE SCAN SET, STATED (STORY-28.2.01 AC-3). Until now the only way to learn which folders
  // `pm:lint` walks was to read `SCAN_KEYS` in lib/pm-paths.js — which is how `13-Releases/`
  // went unlinted for 25 epics (ADR-0132) and `14-Retros/` for 28. A folder that is missing
  // from this list produces exactly the same output as a folder with nothing wrong in it, and
  // the summary line's artefact count cannot tell the two apart. Printing the set makes the
  // next omission visible in the output an operator already reads. Normal mode only: under
  // `--fixtures-dir` there is no scan set, only the one directory named on the command line.
  if (!FIXTURES_DIR) {
    console.log(`ℹ pm:lint scan set (${SCAN_DIRS.length} folders): ${SCAN_DIRS.join(', ')}`);
  }

  // Index by type for cross-reference lookups.
  // Frontmatter is parsed once per file here and reused — no per-file re-read downstream.
  const allFilesByType = {};
  // parsedFmCache: file path → parsed frontmatter object (avoids a second parse in storyIndex).
  const parsedFmCache = new Map();
  // textCache: file path → raw contents. R26's corpus arm needs the BODY of every artefact,
  // and this pass has already read every one of them — a second read per file would double
  // the rule's cost for nothing (STORY-28.2.02 AC-4).
  const textCache = new Map();
  for (const f of allFiles) {
    const content = fs.readFileSync(f, 'utf8');
    textCache.set(f, content);
    const fm = parseFrontmatter(content);
    parsedFmCache.set(f, fm);
    const type = fm && fm.type;
    if (type) {
      allFilesByType[type] = allFilesByType[type] || [];
      allFilesByType[type].push(f);
    }
  }

  // R21 story index — built ONCE in main(), keyed by epicId → [{id, status}].
  // Passed into checkFile so the epic case never re-reads story files from disk
  // (BACKLOG-0064 AC-2). Built in BOTH modes: W12's rollup arms (STORY-35.3.05) run
  // under --fixtures-dir too — a fixtures dir is exactly where the tripping corpus can
  // be constructed without planting drift in the real one (the R28 stance).
  const storyIndex = new Map();
  // W12 feature index — same construction, keyed by featureId (fm.feature). Membership
  // mirrors the feature case's fallback disk-scan EXACTLY (feature match only, no id
  // requirement) so fast path and legacy path can never fire different findings —
  // the STORY-19.3.01 AC-2 parity risk.
  const featureIndex = new Map();
  for (const f of (allFilesByType.story || [])) {
    const fm = parsedFmCache.get(f);
    // Membership mirrors the fallback disk-scan EXACTLY (epic match only, no id
    // requirement) so the R21 fast path can never fire a different set of violations
    // than the legacy path — an id-less malformed story still counts toward the epic's
    // child aggregation (consumers read only .status). See STORY-19.3.01 AC-2 risk.
    if (fm && fm.epic) {
      if (!storyIndex.has(fm.epic)) storyIndex.set(fm.epic, []);
      storyIndex.get(fm.epic).push({ id: fm.id, status: fm.status });
    }
    if (fm && fm.feature) {
      if (!featureIndex.has(fm.feature)) featureIndex.set(fm.feature, []);
      featureIndex.get(fm.feature).push({ id: fm.id, status: fm.status });
    }
  }

  for (const f of allFiles) {
    checkFile(f, allFilesByType, storyIndex, featureIndex);
  }

  // R28 — duplicate artefact ids (STORY-28.2.01). Runs in BOTH modes: it is a cross-file
  // aggregation over whatever set was scanned, and a fixtures dir is exactly where the
  // colliding pair can be constructed without planting a collision in the real corpus.
  checkDuplicateIds(allFiles, parsedFmCache);

  // R13 — WIP limits across stories (SOP §5)
  // Counts stories grouped by status and emits one violation per breached limit.
  // Story-only — bugs and features have their own flow and aren't WIP-limited.
  // Skipped in fixtures mode — fixtures don't represent real WIP.
  if (!FIXTURES_DIR) {
    const storyStatusCounts = {};
    for (const f of (allFilesByType.story || [])) {
      const content = fs.readFileSync(f, 'utf8');
      const fm = parseFrontmatter(content);
      if (fm && fm.status) {
        storyStatusCounts[fm.status] = (storyStatusCounts[fm.status] || 0) + 1;
      }
    }
    for (const [status, limit] of Object.entries(WIP_LIMITS)) {
      const count = storyStatusCounts[status] || 0;
      if (count > limit) {
        // Violation attached to PM_ROOT pseudo-file since it's a global count, not file-specific.
        violate(PM_ROOT, 'R13',
          `WIP limit exceeded: ${count} stories in status='${status}' (max ${limit} per SOP §5). ` +
          `Close existing stories before starting/reviewing more.`);
      }
    }
  }

  // R22 — Lifecycle chain sync (ADR-0047). Run in normal mode only (not fixtures).
  if (!FIXTURES_DIR) {
    checkChainSync(path.join(REPO_ROOT, 'skills'));
  }

  // R33 — a Next: pointer must name a command that exists (BUG-20260901-13). FATAL; normal
  // mode only (the isolated fixtures dir carries no skills/). Drivable over a fixture skills
  // dir through its exported entry point, which is how it is probed.
  if (!FIXTURES_DIR) {
    checkDanglingSuccessors(path.join(REPO_ROOT, 'skills'));
  }

  // W2 — verify-gate anti-pattern self-check (STORY-19.1.03 AC-4). Advisory/non-fatal;
  // normal mode only (fixtures don't carry strategy sidecars).
  if (!FIXTURES_DIR) {
    checkVerifyAntiPatterns();
  }

  // R25 — flat-root guard (STORY-27.3.04). FATAL; normal mode only.
  if (!FIXTURES_DIR) {
    checkFlatRootReports();
  }

  // R26 — a link resolves from the file it is written in (BUG-20260804-08). FATAL.
  //
  // Two arms, one rule, one implementation. The ARTEFACT arm runs in both modes: a fixtures
  // dir is where the exemptions (code span, fenced block, HTML comment) can be probed without
  // planting a dead link in the real corpus. The REPORTS arm is normal mode only — the
  // isolated fixtures dir carries no reports tree.
  checkArtefactLinkTargets(allFiles, (f) => textCache.get(f));
  if (!FIXTURES_DIR) {
    checkReportLinkTargets();
  }

  // R27 — retro-ledger completeness (STORY-26.3.01). FATAL. Runs in normal mode always, and in
  // fixtures mode ONLY when `--retro-log` names a fixture ledger — a fixture corpus checked
  // against the live ledger would flag every fixture story and break the sibling suites that
  // assert "0 violations" under `--fixtures-dir`.
  if (!FIXTURES_DIR || RETRO_LOG) {
    checkLedgerCompleteness(allFilesByType.story || [], parsedFmCache,
      RETRO_LOG || R27_DEFAULT_LEDGER);
    // W10 — a ledger row that forgot its run (BUG-20260811-02). Advisory. Shares R27's ledger
    // path and its `--retro-log` seam: one flag relocates the whole ledger family, and the run
    // plans and the usage sibling are derived from it rather than re-flagged.
    checkUnattributedRunRows(RETRO_LOG || R27_DEFAULT_LEDGER);
  }

  // R32 — an authorisation with no clock (BUG-20260811-03). FATAL from the activation date;
  // W11 for the pre-activation records that cannot be corrected. Normal mode only — the isolated
  // fixtures dir carries no reports tree or inbox.
  if (!FIXTURES_DIR) {
    for (const f of autopilotStampFindings(
      path.join(PM_ROOT, '41-Reports'), path.join(PM_ROOT, '10-Inbox', 'APPROVALS.md'))) {
      if (f.fatal) violate(f.file, f.rule, f.message);
      else warn(f.file, f.rule, f.message);
    }
  }

  // W4 — prompt-language lint corpus scan (STORY-24.1.02 AC-1/AC-3). Advisory/non-fatal;
  // normal mode only (the isolated fixtures dir doesn't carry skills/ or a prompts folder).
  if (!FIXTURES_DIR) {
    checkPromptLint();
  }

  // W5 — testplan TC-command lint (RETRO-2026-07 One change). Advisory/non-fatal; normal mode
  // only, since the isolated fixtures dir carries no testplan corpus.
  if (!FIXTURES_DIR) {
    checkTestplanCommands();
  }

  // W6 — supersession traceability for `duplicate` / `wontfix` artefacts. Advisory/non-fatal.
  if (!FIXTURES_DIR) {
    checkSupersessionTraceability();
  }

  // R30 — `--views` vocabulary (STORY-28.2.03). FATAL; normal mode only, since the isolated
  // fixtures dir carries neither a testplan corpus nor a sidecar tree. The rule is drivable
  // over fixture directories through its exported entry point, which is how it is probed.
  if (!FIXTURES_DIR) {
    checkViewsVocabulary();
  }

  // R31 — one board, one document (STORY-28.3.03). FATAL; normal mode only (the isolated
  // fixtures dir carries no 42-Monitor/). Drivable over a fixture board through its exported
  // entry point, which is how it is probed.
  if (!FIXTURES_DIR) {
    checkMonitorAnchors();
  }

  // Version-parity gate (STORY-09.3.02) — check that all three version manifests align.
  // Runs whenever MANIFEST_DIR is set or in normal (non-fixtures) mode.
  const manifestBaseDir = MANIFEST_DIR || (FIXTURES_DIR ? null : REPO_ROOT);
  if (manifestBaseDir) {
    checkVersionParity(manifestBaseDir);
  }

  // Warnings (W-tier) — printed but NON-FATAL: they never feed the exit code, which is
  // decided solely by violations.length below. Reported before the violations summary so
  // a warnings-only run still surfaces them while exiting 0. See STORY-14.2.03.
  if (warnings.length > 0) {
    console.log(`⚠ pm:lint — ${warnings.length} warning(s) (non-fatal):\n`);
    const wByFile = new Map();
    for (const w of warnings) {
      if (!wByFile.has(w.file)) wByFile.set(w.file, []);
      wByFile.get(w.file).push(w);
    }
    let wn = 0;
    for (const [file, ws] of wByFile) {
      console.log(`  ${file}`);
      for (const w of ws) {
        wn += 1;
        console.log(`    ${String(wn).padStart(3)}. [${w.rule}] ${w.message}`);
      }
      console.log('');
    }
  }

  // Report
  if (violations.length === 0) {
    console.log(`✓ pm:lint — ${allFiles.length} artefact(s) checked, 0 violations.`);
    process.exit(0);
  }

  console.log(`✗ pm:lint — ${allFiles.length} artefact(s) checked, ${violations.length} violation(s):\n`);

  // Group by file for readability.
  const byFile = new Map();
  for (const v of violations) {
    if (!byFile.has(v.file)) byFile.set(v.file, []);
    byFile.get(v.file).push(v);
  }

  let n = 0;
  for (const [file, vs] of byFile) {
    console.log(`  ${file}`);
    for (const v of vs) {
      n += 1;
      console.log(`    ${String(n).padStart(3)}. [${v.rule}] ${v.message}`);
    }
    console.log('');
  }

  console.log(`Total: ${violations.length} violation(s) across ${byFile.size} file(s).`);
  process.exit(1);
}

// Exported for test injection (e.g., TC-03 negative fixture).
module.exports.checkChainSync = checkChainSync;
// Exported for test injection (BUG-20260901-13): R33's dangling-successor scan, drivable
// over a fixture skills dir the same way checkChainSync is.
module.exports.checkDanglingSuccessors = checkDanglingSuccessors;
// Exported for test injection (STORY-19.1.03 AC-4 verify-gate self-check).
module.exports.checkVerifyAntiPatterns = checkVerifyAntiPatterns;
// Exported for test injection (STORY-19.2.01 kitVersion parity gate).
module.exports.checkVersionParity = checkVersionParity;
// Exported for test injection (STORY-21.1.01): lets a harness inspect what checkChainSync
// (or any other rule function) pushed via violate(), without re-running the whole corpus.
module.exports.violations = violations;
// Exported for unit tests (STORY-21.2.02 / ADR-0079): the pure R23 shape checker, no
// filesystem access — mirrors the R19 suggested_agents export seam.
module.exports.checkUsageEstimateShape = checkUsageEstimateShape;
// Exported for unit tests (ADR-0123): the pure W8 timestamp-sanity checker, no filesystem
// access. `nowMs` is injectable so a test can pin the wall clock instead of racing it —
// without that seam a "completed_at is in the future" fixture would have to carry a literal
// far-future date and would decay into a different assertion as the real clock advanced.
module.exports.checkTimestampSanity = checkTimestampSanity;
// W8's git arm (ADR-0158) — pure, so it can be probed without a corpus or a repository.
module.exports.checkTimestampVsCommit = checkTimestampVsCommit;
module.exports.gitCommitIndex = gitCommitIndex;
module.exports.W8_COMMIT_FIELDS = W8_COMMIT_FIELDS;
// Exported for test injection (STORY-24.1.02): lets test-prompt-lint.js point the W4
// corpus scan at fixture skills/prompts dirs without touching the real repo tree.
module.exports.checkPromptLint = checkPromptLint;
// Exported for test injection (STORY-26.3.01 / ADR-0148): R27's ledger reader and the rule
// itself, plus the activation date as a value rather than a literal a test would have to
// re-type. Re-typing it is how a probe and a rule quietly disagree about the same date.
module.exports.checkLedgerCompleteness = checkLedgerCompleteness;
module.exports.readLedgerStoryIds = readLedgerStoryIds;
module.exports.R27_ACTIVATION_DATE = R27_ACTIVATION_DATE;
// Exported for STORY-28.2.01: the folders this linter actually walks, so a probe can assert the
// scan set without re-deriving it from a hand-typed list that would agree with the rule only by
// coincidence. `checkDuplicateIds` is exported for the same reason validator-r25 exports R27's
// checker — the rule is drivable without a corpus.
module.exports.SCAN_DIRS = SCAN_DIRS;
module.exports.checkDuplicateIds = checkDuplicateIds;
// Exported for STORY-28.2.02: R26's link finder, with its existence lookup injected. The three
// exemptions (code span, fenced block, HTML comment) are the whole rule's judgement, and a probe
// that had to construct a real filesystem to reach them would test the filesystem instead.
module.exports.findDeadLinks = findDeadLinks;
// The 41-Reports arm itself, parameterised on its root — so the R26-subsumption assertion can
// drive the SHIPPED arm over a fixture reports tree rather than assert that a call to it still
// appears in main(). A grep for the call site would stay green with the function emptied out.
module.exports.checkReportLinkTargets = checkReportLinkTargets;
// Exported for STORY-28.2.03 (ADR-0170/ADR-0171).
//
// R29's activation date is a VALUE rather than a literal a probe would have to re-type — the
// R27 precedent, and for the same reason: re-typing it is how a probe and a rule quietly come to
// disagree about the same date.
//
// `viewsUsagesIn` takes its vocabulary as an argument so a probe can state the boundary without
// depending on whichever views the dashboard happens to carry today, while `railVocabulary`
// exposes the REAL one so a probe can assert it is non-empty and genuinely read from the rail
// (the assertion TESTPLAN-28.2.03 TC-03 asks for). `checkViewsVocabulary` takes its directories
// so the shipped rule can be driven over fixtures rather than asserted about by grep.
module.exports.R29_ACTIVATION_DATE = R29_ACTIVATION_DATE;
module.exports.viewsUsagesIn = viewsUsagesIn;
module.exports.railVocabulary = railVocabulary;
module.exports.checkViewsVocabulary = checkViewsVocabulary;
module.exports.warnings = warnings;
// Exported for STORY-26.5.05: `commit-status-divergence.js` classifies a story by its status,
// and a second hand-written copy of the enum is exactly how two tools come to disagree about
// what `wontfix` means. The detector derives its vocabulary from THESE objects — the ones the
// linter itself enforces — so a status added here is a status the detector sees on the same day.
module.exports.STATUS_ENUM = STATUS_ENUM;
module.exports.TERMINAL_STATUSES = TERMINAL_STATUSES;
// Exported for STORY-35.3.05 / ADR-0278: the pure W12 parent-status rollup checker, no
// filesystem access — the paired test (tests/parent-status-rollup.test.js) drives every arm,
// both tiers, and both guards through this seam, the same pattern as checkTimestampSanity.
module.exports.checkParentStatusRollup = checkParentStatusRollup;
// Exported for STORY-28.3.01: the id reader THIS file uses, so the propagation proof can ask
// each consumer what it makes of a filename instead of asserting that a `require` line still
// appears in the source. A grep for the import stays green with the import unused.
module.exports.fileIdFromName = fileIdFromName;
// Exported for STORY-28.3.03: R31, parameterised on the board it reads, so the rule can be
// driven over a duplicated-body fixture AND over the live MONITOR.md without planting a
// corrupted board in the real tree.
module.exports.checkMonitorAnchors = checkMonitorAnchors;

// Exported for BUG-20260811-03: R32/W11, parameterised on the reports dir and approvals file it
// reads, so the rule can be driven over a fixture WITHOUT planting an unstamped authorisation in
// the real tree. PURE — findings out; `main()` alone decides fatal-vs-warn routing.
module.exports.autopilotStampFindings = autopilotStampFindings;
module.exports.R32_ACTIVATION_DATE = R32_ACTIVATION_DATE;

// Exported for BUG-20260818-03(c): W10's activation instant, so its probe can DERIVE the
// before/after boundary instead of re-typing a date that would silently drift from the rule's.
// The rule went blind for a whole epic; a probe that tests a date the rule does not use would
// have been the second silence on top of the first.
module.exports.W10_ACTIVATION = W10_ACTIVATION;

// Run as CLI only. The guard lets a test `require()` this module to reach the export
// above WITHOUT triggering a full corpus lint + process.exit() (mirrors the
// `if (require.main === module)` guard generate-monitor.js already uses). Peer-review
// STORY-16.2.03 major fix.
if (require.main === module) {
  main();
}
