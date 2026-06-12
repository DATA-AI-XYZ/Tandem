#!/usr/bin/env node
/**
 * validate-frontmatter.js
 *
 * Lints YAML frontmatter across the PM folder against the rule set
 * (R0–R15, R15b, R16, R17, R18, R19, R21, R22) defined in 90-Standards/SOP.md and the
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
const AI_REVIEW_TERMINAL = new Set([
  'completed', // matched by prefix: completed-YYYY-MM-DD
  'skipped-trivial',
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
let FIXTURES_DIR = null;
let MANIFEST_DIR = null;
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

function fileIdFromName(filename) {
  // e.g. "STORY-01.2.07-foo-bar.md" -> "STORY-01.2.07"
  //      "BUG-20260520-03-symptom.md" -> "BUG-20260520-03"
  //      "ADR-0007-postgres-jsonb.md" -> "ADR-0007"
  const base = path.basename(filename, '.md');
  const m = base.match(/^(EPIC-\d+|FEAT-\d+\.\d+|STORY-\d+\.\d+\.\d+|TESTPLAN-\d+\.\d+\.\d+|BUG-\d{8}-\d+|ADR-\d+|BACKLOG-\d+|RELEASE-v\d+\.\d+|RETRO-\d{4}-\d{2})/);
  return m ? m[1] : null;
}

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

function checkFile(filepath, allFilesByType, storyIndex) {
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

  // W1 (non-fatal) — a Story or Feature SHOULD carry a founder-facing "what you'll
  // have" line. Routed through warn(), never the fatal path; its absence is optional,
  // not a build break. Coverage accrues over time; see STORY-14.2.03 / STORY-14.2.04.
  if ((fm.type === 'story' || fm.type === 'feature') &&
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
            'Set to `completed-YYYY-MM-DD`, `skipped-trivial` (with `ai_review_skip_reason`), or `n-a`.');
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
              `terminal token 'completed-YYYY-MM-DD', 'skipped-trivial', or 'n-a' — never the ` +
              `review's verdict word (e.g. 'approve'/'lgtm'/'reject'; see BUG-20260608-01).`);
          }
          if (aiReview === 'skipped-trivial' &&
              (!fm.ai_review_skip_reason || fm.ai_review_skip_reason === '')) {
            violate(filepath, 'R14',
              '`ai_review=skipped-trivial` requires `ai_review_skip_reason` to be non-empty ' +
              '(brief rationale why the review was skipped — e.g. "typo fix in copy").');
          }
        }
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
            `41-Reports/AI-CODE-REVIEW-<story-id>-<YYYY-MM-DD>.html). ` +
            `Exempt: ai_review=skipped-trivial / n-a, and stories created before ${R15B_PRESENCE_CUTOFF}.`);
        }
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
          if (!/^STORY-\d+\.\d+\.\d+$/.test(depId)) {
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

  // The chain is the single line listing `/...:<command>` tokens joined by `→`. Pick the
  // line carrying the most such tokens (robust against any other arrow-bearing prose line).
  // Capture the prefix from the first token on the winning line and reuse it for both the
  // chain extraction and the per-skill Next: pointer match — no hardcoded prefix literals
  // here (R22 / BACKLOG-0064 AC-3).
  let CANONICAL_CHAIN = [];
  let chainPrefix = null; // captured from the chain line (e.g. 'Tandem')
  for (const line of coreText.split(/\r?\n/)) {
    if (!line.includes('→')) continue;
    // Extract prefix:command pairs from backtick-quoted `/<prefix>:<command>` tokens.
    const matches = [...line.matchAll(/`\/([^:`]+):([a-z][\w-]*)`/g)];
    const cmds = matches.map(m => m[2]);
    if (cmds.length > CANONICAL_CHAIN.length) {
      CANONICAL_CHAIN = cmds;
      chainPrefix = matches[0] ? matches[0][1] : null;
    }
  }

  if (CANONICAL_CHAIN.length < 2) {
    // core exists but its canonical chain line could not be parsed — the SoT is malformed.
    // Fail closed (a silent pass would let the whole gate rot unnoticed).
    violate(corePath, 'R22',
      'Could not parse the canonical lifecycle chain from skills/core/SKILL.md ' +
      '(expected one line of `/...:<command>` tokens joined by →, per ADR-0047). ' +
      'Restore the chain line before the chain-sync gate can run.');
    return;
  }

  // Build the successor map from the parsed chain; the last element is terminal (no Next:).
  // Membership is derived from the chain itself — any skill dir NOT in the chain is a
  // cadence/utility/alternative skill (session-start, execute-story, etc.) and is exempt.
  const chainSuccessor = {};
  for (let i = 0; i < CANONICAL_CHAIN.length - 1; i++) {
    chainSuccessor[CANONICAL_CHAIN[i]] = CANONICAL_CHAIN[i + 1];
  }
  const terminal = CANONICAL_CHAIN[CANONICAL_CHAIN.length - 1];
  chainSuccessor[terminal] = null;
  const chainMembers = new Set(CANONICAL_CHAIN);

  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillName = entry.name;
    if (!chainMembers.has(skillName)) continue; // non-member → exempt

    const skillPath = path.join(skillsDir, skillName, 'SKILL.md');
    if (!fs.existsSync(skillPath)) continue;

    const content = fs.readFileSync(skillPath, 'utf8');
    // Next: pointer — the prefix captured from the canonical chain line is reused here so
    // both dev (`/Tandem:`) and published (`/Tandem:`) prefixes are matched
    // without hardcoding either literal. Fallback: match any single `/<prefix>:` prefix.
    const prefixPattern = chainPrefix ? chainPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '[^:`]+';
    const nextMatch = content.match(new RegExp(`^Next:\\s*\`\\/${prefixPattern}:([^\`]+)\``, 'm'));
    const nextCommand = nextMatch ? nextMatch[1] : null;
    const expectedNext = chainSuccessor[skillName];

    if (nextCommand !== expectedNext) {
      violate(skillPath, 'R22',
        `Lifecycle skill '${skillName}' has Next: \`/...:${nextCommand || '(missing)'}\` ` +
        `but the canonical chain (skills/core/SKILL.md, ADR-0047) specifies ` +
        `\`/...:${expectedNext || '(terminal — no Next expected)'}\`. ` +
        `Update the skill's Next: pointer (the chain record wins).`);
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
function checkVerifyAntiPatterns(reportsDir = path.join(PM_ROOT, '41-Reports')) {
  if (!fs.existsSync(reportsDir)) return;
  for (const entry of fs.readdirSync(reportsDir)) {
    if (!/^EXECUTION-STRATEGY-.*\.json$/.test(entry)) continue;
    const full = path.join(reportsDir, entry);
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

// ---------- Main ----------

function main() {
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

  // Index by type for cross-reference lookups.
  // Frontmatter is parsed once per file here and reused — no per-file re-read downstream.
  const allFilesByType = {};
  // parsedFmCache: file path → parsed frontmatter object (avoids a second parse in storyIndex).
  const parsedFmCache = new Map();
  for (const f of allFiles) {
    const content = fs.readFileSync(f, 'utf8');
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
  // (BACKLOG-0064 AC-2). Only meaningful in normal (non-fixtures) mode; fixtures
  // don't carry a multi-epic story tree.
  const storyIndex = new Map();
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
  }

  for (const f of allFiles) {
    checkFile(f, allFilesByType, storyIndex);
  }

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

  // W2 — verify-gate anti-pattern self-check (STORY-19.1.03 AC-4). Advisory/non-fatal;
  // normal mode only (fixtures don't carry strategy sidecars).
  if (!FIXTURES_DIR) {
    checkVerifyAntiPatterns();
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
// Exported for test injection (STORY-19.1.03 AC-4 verify-gate self-check).
module.exports.checkVerifyAntiPatterns = checkVerifyAntiPatterns;
// Exported for test injection (STORY-19.2.01 kitVersion parity gate).
module.exports.checkVersionParity = checkVersionParity;

// Run as CLI only. The guard lets a test `require()` this module to reach the export
// above WITHOUT triggering a full corpus lint + process.exit() (mirrors the
// `if (require.main === module)` guard generate-monitor.js already uses). Peer-review
// STORY-16.2.03 major fix.
if (require.main === module) {
  main();
}
