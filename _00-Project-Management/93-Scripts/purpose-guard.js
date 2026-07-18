#!/usr/bin/env node
/**
 * purpose-guard.js — sync guard for documentation/what-each-thing-is-for.md (STORY-21.4.04).
 *
 * ADR-0080 chose a dedicated, hand-curated doc (`documentation/what-each-thing-is-for.md`)
 * as the per-item purpose reference — deliberately NOT an extension of the
 * `generate-codebase-map.js` generator contract (ADR-0008 scoped that generator to
 * top-level directories only). ADR-0080 left "kept current" as this story's job. This
 * script IS that job: a standalone guard, not a generator, that scans the SAME
 * enumerable sets ADR-0080's coverage contract names and flags drift.
 *
 * Modes:
 *   --check        (default) reports items present in the scanned tree but missing a
 *                  purpose line in the doc, and any unfilled auto-stub lines already
 *                  in the doc. ALWAYS exits 0 — this is a W-tier nudge (ADR-0061),
 *                  never a gate. Warnings print with a "[W-purpose]" prefix.
 *   --write-stubs  appends a TODO stub line under the correct section for each missing
 *                  item. Idempotent (ADR-0008's non-destructive-regeneration pattern):
 *                  a second run adds nothing new, and existing hand-written lines are
 *                  never touched.
 *
 * Scope is deliberately narrow (warn-fatigue risk called out in the story's Risks
 * section) — only the exact sets ADR-0080 names, nothing broader:
 *   - every directory directly under `_00-Project-Management/`
 *   - the top-level dirs skills/, hooks/, .claude/, .claude-plugin/, docs/, documentation/
 *   - every `*.md` directly in `90-Standards/`
 *   - every file directly in `91-Templates/`
 *   - every `*.md` directly in `92-Prompts/`
 *   - every `*.js` directly in `93-Scripts/`
 *   - every directory directly under `skills/`
 * No recursive walk, no other file types, no per-hook/per-template-internal detail.
 *
 * Usage:
 *   node _00-Project-Management/93-Scripts/purpose-guard.js [--check]
 *   node _00-Project-Management/93-Scripts/purpose-guard.js --write-stubs
 *   ... --root <dir>   scan a different project root (default: this repo, two up from here)
 *   ... --doc <path>   point at a different reference doc (tests use this so the real
 *                      doc is never touched by a test run)
 *
 * Exit codes: --check is always 0 (warn-only). --write-stubs: 0 on success (including
 * "nothing to add"), 2 if the target doc doesn't exist (script error — no doc to stub).
 * Dependency-free — Node stdlib only (fs, path).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const STUB_MARKER = 'TODO: one-line purpose (auto-stub; fill me)';
const EM_DASH = '—'; // '—' — matches the doc's existing bullet separator
const WARN_PREFIX = '[W-purpose]';

// ---------- args ----------

function parseArgs(argv) {
  const args = argv.slice(2);
  let mode = 'check';
  let root = null;
  let doc = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--check') mode = 'check';
    else if (a === '--write-stubs') mode = 'write-stubs';
    else if (a === '--root') {
      root = args[++i];
      if (!root) { console.error('purpose-guard: --root requires a directory path'); process.exit(2); }
    } else if (a === '--doc') {
      doc = args[++i];
      if (!doc) { console.error('purpose-guard: --doc requires a file path'); process.exit(2); }
    } else {
      console.error(`purpose-guard: unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return { mode, root, doc };
}

function resolveRoot(root) {
  if (root) return path.resolve(root);
  // This file lives at <repo>/_00-Project-Management/93-Scripts/purpose-guard.js.
  return path.resolve(__dirname, '..', '..');
}

// ---------- fs helpers ----------

function listDirNames(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
  } catch (_e) {
    return [];
  }
}

function listFileNames(dir, filterFn) {
  if (!dir || !fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && (!filterFn || filterFn(e.name)))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
  } catch (_e) {
    return [];
  }
}

// ---------- the enumerable sets (ADR-0080 coverage contract) ----------

function buildSections(REPO_ROOT, PM_ROOT) {
  return [
    {
      key: 'pm-folders',
      label: '_00-Project-Management/ folders',
      heading: '### `_00-Project-Management/` folders',
      items: listDirNames(PM_ROOT).map((name) => ({ docName: name })),
    },
    {
      key: 'top-level-dirs',
      label: 'top-level directories',
      heading: '### Top-level directories',
      items: ['skills', 'hooks', '.claude', '.claude-plugin', 'docs', 'documentation']
        .filter((name) => fs.existsSync(path.join(REPO_ROOT, name)))
        .map((name) => ({ docName: `${name}/` })),
    },
    {
      key: 'standards',
      label: '90-Standards/*.md',
      heading: '## Standards',
      items: listFileNames(path.join(PM_ROOT, '90-Standards'), (n) => n.endsWith('.md'))
        .map((name) => ({ docName: name.replace(/\.md$/, '') })),
    },
    {
      key: 'templates',
      label: '91-Templates/*',
      heading: '## Templates',
      items: listFileNames(path.join(PM_ROOT, '91-Templates')).map((name) => ({ docName: name })),
    },
    {
      key: 'prompts',
      label: '92-Prompts/*.md',
      heading: '## Prompts',
      items: listFileNames(path.join(PM_ROOT, '92-Prompts'), (n) => n.endsWith('.md'))
        .map((name) => ({ docName: name })),
    },
    {
      key: 'scripts',
      label: '93-Scripts/*.js',
      heading: '## Scripts',
      items: listFileNames(path.join(PM_ROOT, '93-Scripts'), (n) => n.endsWith('.js'))
        .map((name) => ({ docName: name })),
    },
    {
      key: 'skills',
      label: 'skills/<name>/',
      heading: '## Skills',
      items: listDirNames(path.join(REPO_ROOT, 'skills')).map((name) => ({ docName: name })),
    },
  ];
}

// ---------- doc parsing ----------

function detectEol(content) {
  const crlf = (content.match(/\r\n/g) || []).length;
  const bareLf = (content.match(/(?<!\r)\n/g) || []).length;
  return crlf > bareLf ? '\r\n' : '\n';
}

function splitLines(content) {
  return content.split(/\r\n|\n/);
}

// A bullet line names its item as the first bold-or-backtick token after "- ", e.g.
// "- **00-Strategy** — the vision..." or "- `fixture-item.js` — TODO: ...". Deliberately
// does NOT require an em dash to follow immediately — the Scripts section interposes a
// "(`npm run pm:x`)" / "(internal/library — ...)" annotation between the name and the
// separator dash, so anchoring on the dash would miss every row in that section.
const BULLET_RE = /^-\s+(?:\*\*([^*]+)\*\*|`([^`]+)`)/;

function findHeadingIndex(lines, heading) {
  const target = heading.trim();
  return lines.findIndex((l) => l.trim() === target);
}

function findSectionEnd(lines, startIdx) {
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) return i;
  }
  return lines.length;
}

function sectionNames(lines, startIdx, endIdx) {
  const names = new Set();
  for (let i = startIdx + 1; i < endIdx; i++) {
    const m = lines[i].match(BULLET_RE);
    if (m) names.add((m[1] || m[2]).trim());
  }
  return names;
}

function sectionUnfilledStubs(lines, startIdx, endIdx) {
  const out = [];
  for (let i = startIdx + 1; i < endIdx; i++) {
    if (lines[i].includes(STUB_MARKER)) {
      const m = lines[i].match(BULLET_RE);
      out.push(m ? (m[1] || m[2]).trim() : lines[i].trim());
    }
  }
  return out;
}

// ---------- --check ----------

/**
 * Run the guard's read-only check against REPO_ROOT/docPath.
 * @returns {{ warnings: string[], missing: number, unfilled: number }}
 */
function check(REPO_ROOT, docPath) {
  const PM_ROOT = path.join(REPO_ROOT, '_00-Project-Management');
  const warnings = [];
  let missing = 0;
  let unfilled = 0;

  if (!fs.existsSync(docPath)) {
    // Nothing to guard if the reference doc doesn't exist for this target (e.g. a
    // consumer project that hasn't authored ADR-0080's doc) — silent no-op, not a
    // warning of its own. The guard's job is drift detection, not doc existence.
    return { warnings, missing, unfilled };
  }

  const content = fs.readFileSync(docPath, 'utf8');
  const lines = splitLines(content);
  const sections = buildSections(REPO_ROOT, PM_ROOT);

  for (const section of sections) {
    const headingIdx = findHeadingIndex(lines, section.heading);
    if (headingIdx === -1) {
      for (const item of section.items) {
        warnings.push(`${WARN_PREFIX} missing purpose line for '${item.docName}' (${section.label}) — section "${section.heading}" not found in ${docPath}`);
        missing++;
      }
      continue;
    }
    const endIdx = findSectionEnd(lines, headingIdx);
    const existing = sectionNames(lines, headingIdx, endIdx);
    for (const item of section.items) {
      if (!existing.has(item.docName)) {
        warnings.push(`${WARN_PREFIX} missing purpose line for '${item.docName}' (${section.label})`);
        missing++;
      }
    }
    for (const name of sectionUnfilledStubs(lines, headingIdx, endIdx)) {
      warnings.push(`${WARN_PREFIX} unfilled stub for '${name}' (${section.label}) — replace the TODO placeholder`);
      unfilled++;
    }
  }

  return { warnings, missing, unfilled };
}

// ---------- --write-stubs ----------

/**
 * Append a TODO stub line under the correct section for each item missing one.
 * Idempotent: items already present (hand-written OR a prior stub) are never re-added.
 * @returns {{ added: string[], error: string|null }}
 */
function writeStubs(REPO_ROOT, docPath) {
  const PM_ROOT = path.join(REPO_ROOT, '_00-Project-Management');
  if (!fs.existsSync(docPath)) {
    return { added: [], error: `reference doc not found: ${docPath} — nothing to stub` };
  }

  const original = fs.readFileSync(docPath, 'utf8');
  const eol = detectEol(original);
  let lines = splitLines(original);
  const sections = buildSections(REPO_ROOT, PM_ROOT);
  const added = [];

  for (const section of sections) {
    // Re-resolve against the CURRENT `lines` each iteration — earlier sections in this
    // same run may already have shifted line numbers by inserting stubs.
    const headingIdx = findHeadingIndex(lines, section.heading);
    if (headingIdx === -1) continue; // can't stub a section the doc doesn't have — leave for a human
    const endIdx = findSectionEnd(lines, headingIdx);
    const existing = sectionNames(lines, headingIdx, endIdx);
    const toAdd = section.items.filter((item) => !existing.has(item.docName));
    if (!toAdd.length) continue;

    // Insert right after the section's last non-blank content line, so the
    // blank-line-before-the-next-heading formatting the doc already has is preserved.
    let insertAt = headingIdx + 1;
    for (let i = endIdx - 1; i > headingIdx; i--) {
      if (lines[i].trim() !== '') { insertAt = i + 1; break; }
    }
    const stubLines = toAdd.map((item) => `- \`${item.docName}\` ${EM_DASH} ${STUB_MARKER}`);
    lines = lines.slice(0, insertAt).concat(stubLines, lines.slice(insertAt));
    for (const item of toAdd) added.push(`${item.docName} (${section.label})`);
  }

  if (added.length) {
    fs.writeFileSync(docPath, lines.join(eol));
  }
  return { added, error: null };
}

// ---------- main ----------

function main() {
  const { mode, root, doc } = parseArgs(process.argv);
  const REPO_ROOT = resolveRoot(root);
  const DOC_PATH = doc ? path.resolve(doc) : path.join(REPO_ROOT, 'documentation', 'what-each-thing-is-for.md');

  if (mode === 'write-stubs') {
    const { added, error } = writeStubs(REPO_ROOT, DOC_PATH);
    if (error) {
      console.error(`purpose-guard --write-stubs: ${error}`);
      process.exit(2);
    }
    if (added.length) {
      console.log(`purpose-guard --write-stubs: appended ${added.length} stub line(s) to ${DOC_PATH}:`);
      for (const a of added) console.log(`  - ${a}`);
    } else {
      console.log(`purpose-guard --write-stubs: nothing to add — ${DOC_PATH} already covers every scanned item.`);
    }
    process.exit(0);
    return;
  }

  // --check (default): warn-only, ALWAYS exits 0 (ADR-0061 W-tier).
  const { warnings, missing, unfilled } = check(REPO_ROOT, DOC_PATH);
  if (warnings.length) {
    for (const w of warnings) console.log(w);
    console.log(`${WARN_PREFIX} ${missing} missing purpose line(s), ${unfilled} unfilled stub(s) in ${DOC_PATH}`);
  } else {
    console.log(`purpose-guard --check: ${DOC_PATH} is in sync with the scanned tree.`);
  }
  process.exit(0);
}

module.exports = { check, writeStubs, buildSections, WARN_PREFIX, STUB_MARKER };

if (require.main === module) { main(); }
