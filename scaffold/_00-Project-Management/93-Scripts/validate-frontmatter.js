#!/usr/bin/env node
/**
 * validate-frontmatter.js
 *
 * Lints YAML frontmatter across the PM folder against the rule set
 * (R0–R15, R15b, R16, R17, R18, R19) defined in 90-Standards/SOP.md and the
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

const SCAN_DIRS = [
  '11-Backlog',
  '30-Epics',
  '31-Features',
  '32-Stories',
  '33-Testplans',
  '34-Bugs',
  '40-Decisions',
];

// ---------- CLI args ----------
// --fixtures-dir <path>  scan a flat fixtures dir instead of PM_ROOT; resolve
//                        R15's html_artefacts paths relative to that dir
//                        (lets tests stay self-contained, no real repo files).
let FIXTURES_DIR = null;
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

function stripQuotes(s) {
  if (typeof s !== 'string') return s;
  if ((s.startsWith("'") && s.endsWith("'")) ||
      (s.startsWith('"') && s.endsWith('"'))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseFrontmatter(content) {
  // Match a YAML block delimited by --- on first and second occurrences at line start.
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return null;
  const block = m[1];
  const fm = {};
  // Small flat-YAML parser: key: value, with optional quoting and inline arrays.
  // Also supports multi-line list form (`key:` followed by `  - item` lines).
  // Frontmatter in this kit deliberately stays flat; nested mappings are not parsed.
  const lines = block.split(/\r?\n/);
  // `listKey` is the key currently allowed to accept multi-line `- item` rows.
  // ONLY a bare key (one whose inline value is the empty string) becomes a list
  // parent; any inline-valued key (scalar or inline `[...]` array) clears it. This
  // prevents (a) a stray `- ` line attaching to an unrelated earlier key, and
  // (b) merging an inline array with subsequent block items.
  let listKey = null;
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;

    // Multi-line list item: leading whitespace + `- value`, only under a bare key.
    const listItem = line.match(/^\s+-\s+(.*)$/);
    if (listItem && listKey) {
      const item = stripQuotes(listItem[1].trim());
      if (!Array.isArray(fm[listKey])) fm[listKey] = [];
      fm[listKey].push(item);
      continue;
    }

    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (kv) {
      const key = kv[1];
      let value = stripQuotes(kv[2].trim());
      // Inline arrays: [a, b, c] — strip per-item quotes.
      if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
        const inner = value.slice(1, -1).trim();
        value = inner ? inner.split(',').map(s => stripQuotes(s.trim())) : [];
      }
      fm[key] = value;
      // Contract: a bare key (empty inline value) MAY own following `- item` rows
      // and will parse to an array; an inline-valued key never does. NOTE: this means
      // `files_touched:` / `depends_on:` written in multi-line form parse to arrays,
      // not the empty string they yielded before R15 (intended — any future rule
      // reading them, e.g. EPIC-02 R17/R18, should expect an array).
      listKey = (value === '') ? key : null;
    }
  }
  return fm;
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
  for (const f of walk(path.join(PM_ROOT, '32-Stories'))) {
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

function checkFile(filepath, allFilesByType) {
  const content = fs.readFileSync(filepath, 'utf8');
  const fm = parseFrontmatter(content);

  if (!fm) {
    violate(filepath, 'R0', 'Missing or malformed YAML frontmatter');
    return;
  }

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

  // Type-specific rules
  switch (fm.type) {
    case 'epic':
      // R9 — Epic must have okr or prd_section
      if (!fm.okr && !fm.prd_section) {
        violate(filepath, 'R9',
          'Epic must have either `okr:` or `prd_section:` in frontmatter (strategy linkage)');
      }
      break;

    case 'story':
      // R6 — Story has paired Testplan at mirrored path
      if (fm.id) {
        const mirroredTp = filepath
          .replace(/[\\/]32-Stories[\\/]/, path.sep + '33-Testplans' + path.sep)
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
          // Validate the terminal-value format.
          const looksCompleted = /^completed-\d{4}-\d{2}-\d{2}$/.test(aiReview);
          const isOtherTerminal = AI_REVIEW_TERMINAL.has(aiReview);
          if (!looksCompleted && !isOtherTerminal) {
            violate(filepath, 'R14',
              `Invalid \`ai_review\` value '${aiReview}'. Must match ` +
              `'completed-YYYY-MM-DD', 'skipped-trivial', or 'n-a'.`);
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
      if (Array.isArray(fm.depends_on)) {
        for (const dep of fm.depends_on) {
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
      if (Array.isArray(fm.files_touched)) {
        for (const entry of fm.files_touched) {
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
  const allFilesByType = {};
  for (const f of allFiles) {
    const content = fs.readFileSync(f, 'utf8');
    const fm = parseFrontmatter(content);
    const type = fm && fm.type;
    if (type) {
      allFilesByType[type] = allFilesByType[type] || [];
      allFilesByType[type].push(f);
    }
  }

  for (const f of allFiles) {
    checkFile(f, allFilesByType);
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

main();
