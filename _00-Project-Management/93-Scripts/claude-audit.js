#!/usr/bin/env node
/**
 * claude-audit.js
 *
 * Report CLAUDE.md coverage for a host repo. For each detected boundary,
 * classify it: covered / incomplete / gap / undecided / excluded.
 *
 *   - excluded   — recorded in config's exclude list (intentionally no CLAUDE.md)
 *   - covered    — included/discovered, CLAUDE.md present and fully filled
 *   - incomplete — CLAUDE.md present but still carrying `<fill in>` or
 *                  `[auto — verify]` stub markers (needs the fill-claude-md skill)
 *   - gap        — explicitly included in config but the CLAUDE.md is missing
 *   - undecided  — neither included nor excluded, and no CLAUDE.md yet
 *
 * Usage:
 *   node claude-audit.js [--root <dir>] [--templates <dir>] [--report <file>]
 *                        [--strict] [--json] [--nudge]
 *
 *   --root <dir>      repo root to audit (default: two levels above this script)
 *   --templates <dir> templates dir for template-inline detection (default: a
 *                     91-Templates/ under --root if present)
 *   --strict          exit 1 if any boundary is a real gap (included-but-missing)
 *   --json            emit machine-readable JSON instead of markdown
 *   --report          also write the markdown report to <file>
 *   --nudge           opt-in, warn-only staleness reminder (STORY-12.6.01). OFF by
 *                     default: prints a one-line nudge (and always exits 0, never
 *                     blocks) ONLY when the env flag PM_CLAUDE_NUDGE is set. To
 *                     enable, set PM_CLAUDE_NUDGE=1 in the environment / a git
 *                     pre-commit or session-start hook; unset it to silence.
 *
 * Dependency-free — Node stdlib only.
 *
 * Tiered-layout enforcement (STORY-12.4.03): beyond the coverage report, the
 * audit walks EVERY CLAUDE.md in the tree and reports a per-file line count.
 * It raises a *finding* when a file exceeds its line budget (a Tier-1 always-on
 * root earns a tighter budget than a Tier-2 folder file) or when a subdir file
 * duplicates the root (overlap above the threshold). Findings make the default
 * invocation exit non-zero — the tiered model is enforced, not just recommended.
 * (`--strict` additionally gates on a real `gap`.) See ADR-0056 for the chosen
 * budget + overlap-threshold defaults.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { detectBoundaries } = require('./lib/detect-boundaries');
const cfgLib = require('./lib/claude-config');

// Line budgets (cost-of-a-miss / content-economics, CLAUDE-CODE-CONFIG §2.1.4).
// Root is the always-loaded Tier-1 file → leaner; subdir files are Tier-2 and
// additive. Exceeding a budget is a finding (gates the default exit). See ADR-0056.
const ROOT_BUDGET = 200;
const SUBDIR_BUDGET = 120;

// Root-duplication detection (STORY-12.4.03). A subdir CLAUDE.md is flagged when
// it restates the root rather than being additive. We require BOTH a minimum
// number of matching non-trivial lines AND a high overlap ratio, so short shared
// phrases (a benign one-liner) never false-flag. See ADR-0056.
const DUP_OVERLAP_THRESHOLD = 0.6;
const DUP_MIN_MATCHED = 2;

// Directories never walked when scanning for CLAUDE.md files.
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'out',
  'coverage', 'vendor', '__pycache__', 'target', '.venv', 'venv',
]);

function parseArgs(argv) {
  const args = { root: path.resolve(__dirname, '..', '..'), report: null, strict: false, json: false, templates: null, nudge: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root' && argv[i + 1]) args.root = path.resolve(argv[++i]);
    else if (a === '--report' && argv[i + 1]) args.report = argv[++i];
    else if (a === '--templates' && argv[i + 1]) args.templates = path.resolve(argv[++i]);
    else if (a === '--strict') args.strict = true;
    else if (a === '--json') args.json = true;
    else if (a === '--nudge') args.nudge = true;
    else if (a === '--help') args.help = true;
  }
  return args;
}

function claudeFileFor(root, relPath) {
  const dir = relPath === '/'
    ? root
    : path.join(root, relPath.replace(/^\//, '').split('/').join(path.sep));
  return path.join(dir, 'CLAUDE.md');
}

// A scaffolded-but-unfilled CLAUDE.md still carries the auto-generated stub
// markers. `[auto — verify]` is emitted by buildCommandsBlock; `<fill in>` is
// the placeholder the fill-claude-md skill replaces.
function isIncomplete(file) {
  if (!fs.existsSync(file)) return false;
  const txt = fs.readFileSync(file, 'utf8');
  return /\[auto — verify\]/.test(txt) || /<fill in>/.test(txt);
}

function audit(root) {
  const candidates = detectBoundaries(root);
  const cfg = cfgLib.readConfig(root);
  return candidates.map((c) => {
    const file = claudeFileFor(root, c.path);
    const exists = fs.existsSync(file);
    const status = cfgLib.decideStatus(cfg, c.path);
    let state;
    if (status === 'excluded') state = 'excluded';
    else if (exists) state = isIncomplete(file) ? 'incomplete' : 'covered';
    else state = (status === 'included') ? 'gap' : 'undecided';
    return { path: c.path, manifest: c.manifest, state };
  });
}

// Walk the whole tree (not just detected boundaries) for every CLAUDE.md file.
// The tiered checks must see folder-scoped files in plain source dirs that carry
// no package manifest, which detectBoundaries deliberately skips.
function findClaudeFiles(root) {
  const out = [];
  (function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        walk(path.join(dir, e.name));
      } else if (e.isFile() && e.name === 'CLAUDE.md') {
        out.push(path.join(dir, e.name));
      }
    }
  })(root);
  return out;
}

function relClaudePath(root, file) {
  const r = path.relative(root, file).split(path.sep).join('/');
  return '/' + r;
}

function lineCountOf(txt) {
  return txt.replace(/\r\n/g, '\n').split('\n').length;
}

// Non-trivial content lines for overlap comparison: trimmed, non-empty, skipping
// markdown headings and PM-KIT managed-block markers (structural, not content).
function contentLines(txt) {
  return txt.replace(/\r\n/g, '\n').split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => !l.startsWith('#'))
    .filter((l) => !/^<!--.*-->$/.test(l));
}

// ---------------------------------------------------------------------------
// Template-inline detection (STORY-12.5.01)
//
// A CLAUDE.md should *point to* a 91-Templates/ file, not re-paste its frontmatter
// block. We fingerprint each template by its leading-frontmatter key set, then
// flag a CLAUDE.md that re-states enough of those template-specific keys to be a
// copy rather than a reference. Keyed on the template's own frontmatter keys (not
// generic headings) so a benign pointer that merely names the template file — but
// carries none of its keys — passes clean. See ADR-0057.
// ---------------------------------------------------------------------------
const TEMPLATE_INLINE_MIN_KEYS = 3;      // an absolute floor: ≥3 template keys present
const TEMPLATE_INLINE_RATIO = 0.75;      // …or ≥75% of a smaller template's keys

function frontmatterKeys(txt) {
  const norm = txt.replace(/\r\n/g, '\n');
  const m = norm.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return [];
  const keys = [];
  for (const line of m[1].split('\n')) {
    const km = line.match(/^([A-Za-z0-9_]+):/);
    if (km) keys.push(km[1]);
  }
  return keys;
}

// Load { file, keys } fingerprints for every *.md template that carries a
// frontmatter block with ≥2 keys. Returns [] for a missing/unreadable dir.
function loadTemplateFingerprints(templatesDir) {
  const out = [];
  if (!templatesDir) return out;
  let entries;
  try { entries = fs.readdirSync(templatesDir, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    let txt;
    try { txt = fs.readFileSync(path.join(templatesDir, e.name), 'utf8'); } catch { continue; }
    const keys = frontmatterKeys(txt);
    if (keys.length >= 2) out.push({ file: e.name, keys });
  }
  return out;
}

// `key:` tokens appearing anywhere in a CLAUDE.md body (a re-pasted template
// block surfaces its keys as `key:` lines). Used to test for template overlap.
function presentKeySet(txt) {
  const set = new Set();
  for (const line of txt.replace(/\r\n/g, '\n').split('\n')) {
    const km = line.match(/^\s*([A-Za-z0-9_]+):/);
    if (km) set.add(km[1]);
  }
  return set;
}

function templateInlineHits(claudeTxt, fingerprints) {
  const present = presentKeySet(claudeTxt);
  const hits = [];
  for (const fp of fingerprints) {
    const matched = fp.keys.filter((k) => present.has(k)).length;
    const ratio = fp.keys.length ? matched / fp.keys.length : 0;
    if (matched >= TEMPLATE_INLINE_MIN_KEYS || (matched >= 2 && ratio >= TEMPLATE_INLINE_RATIO)) {
      hits.push({ template: fp.file, matched, total: fp.keys.length });
    }
  }
  return hits;
}

// Build the per-file line-count table + tiered findings (over-budget,
// duplicates-root, template-inline). Findings gate the default exit code.
function buildClaudeReport(root, templatesDir) {
  const fingerprints = loadTemplateFingerprints(templatesDir);
  const files = findClaudeFiles(root);
  const rootFile = path.join(root, 'CLAUDE.md');
  const rootResolved = path.resolve(rootFile);
  let rootSet = new Set();
  try {
    if (fs.existsSync(rootFile)) rootSet = new Set(contentLines(fs.readFileSync(rootFile, 'utf8')));
  } catch { /* leave empty */ }

  const counts = [];
  const findings = [];
  for (const f of files) {
    let txt;
    try { txt = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const isRoot = path.resolve(f) === rootResolved;
    const rel = isRoot ? '/CLAUDE.md' : relClaudePath(root, f);
    const lines = lineCountOf(txt);
    counts.push({ path: rel, lines, isRoot });

    const budget = isRoot ? ROOT_BUDGET : SUBDIR_BUDGET;
    if (lines > budget) {
      findings.push({
        path: rel, kind: 'over-budget',
        message: `over budget: ${lines} lines exceeds the ${isRoot ? 'root' : 'subdir'} budget of ${budget} — trim with the fill-claude-md skill (content economics)`,
      });
    }
    if (!isRoot && rootSet.size > 0) {
      const sub = contentLines(txt);
      const matched = sub.filter((l) => rootSet.has(l)).length;
      const ratio = sub.length ? matched / sub.length : 0;
      if (matched >= DUP_MIN_MATCHED && ratio >= DUP_OVERLAP_THRESHOLD) {
        findings.push({
          path: rel, kind: 'duplicates-root',
          message: `duplicates root (${Math.round(ratio * 100)}% overlap, ${matched} shared lines) — make it additive or replace with a pointer to the root CLAUDE.md`,
        });
      }
    }
    // Template-inline: this CLAUDE.md re-pastes a 91-Templates/ frontmatter block.
    for (const hit of templateInlineHits(txt, fingerprints)) {
      findings.push({
        path: rel, kind: 'template-inline',
        message: `inlines the ${hit.template} frontmatter block (${hit.matched} of ${hit.total} template keys) — replace it with a pointer to \`91-Templates/${hit.template}\` instead of copying the template`,
      });
    }
  }
  return { counts, findings };
}

function isoDate() {
  return new Date().toISOString().slice(0, 10);
}

const STATE_ORDER = ['covered', 'incomplete', 'gap', 'undecided', 'excluded'];

function toMarkdown(rows, report) {
  const by = (s) => rows.filter((r) => r.state === s);
  const lines = [];
  lines.push(`# CLAUDE.md coverage audit — ${isoDate()}`, '');
  for (const state of STATE_ORDER) {
    const items = by(state);
    lines.push(`## ${state} (${items.length})`);
    for (const r of items) lines.push(`- \`${r.path}\` (${r.manifest || '-'})`);
    lines.push('');
  }
  // Per-file line counts (always emitted) — every CLAUDE.md in the tree.
  if (report && report.counts.length > 0) {
    lines.push(`## CLAUDE.md files (${report.counts.length}) — line counts`);
    for (const c of report.counts) {
      const budget = c.isRoot ? ROOT_BUDGET : SUBDIR_BUDGET;
      lines.push(`- \`${c.path}\` — ${c.lines} lines (budget ${budget})`);
    }
    lines.push('');
  }
  // Findings — gate the default exit. Omitted entirely when none.
  if (report && report.findings.length > 0) {
    lines.push(`## findings (${report.findings.length}) — enforced (non-zero exit)`);
    for (const f of report.findings) lines.push(`- \`${f.path}\` — ${f.message}`);
    lines.push('');
  }
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node claude-audit.js [--root <dir>] [--templates <dir>] [--report <file>] [--strict] [--json] [--nudge]');
    console.log('  --nudge: opt-in warn-only reminder; fires only when PM_CLAUDE_NUDGE is set; always exits 0.');
    process.exit(0);
  }
  const rows = audit(args.root);
  // Templates dir: explicit --templates wins; else fall back to a 91-Templates/
  // under the audited root if it exists. null → template-inline check is skipped.
  let templatesDir = args.templates;
  if (!templatesDir) {
    const guess = path.join(args.root, '91-Templates');
    if (fs.existsSync(guess)) templatesDir = guess;
  }
  const report = buildClaudeReport(args.root, templatesDir);

  // Opt-in staleness nudge (STORY-12.6.01). OFF by default: fires only when the
  // PM_CLAUDE_NUDGE env flag is set (an explicit, documented opt-in — see
  // 90-Standards/CLAUDE-CODE-CONFIG.md). Warn-only: it prints at most a single
  // line and ALWAYS exits 0, so it can never block a commit or session. With the
  // flag unset, nothing fires and nothing prints.
  if (args.nudge) {
    if (!process.env.PM_CLAUDE_NUDGE) process.exit(0); // off by default — silent
    const reasons = [];
    for (const c of report.counts) {
      if (c.lines > (c.isRoot ? ROOT_BUDGET : SUBDIR_BUDGET)) {
        reasons.push(`${c.path} over budget (${c.lines} lines)`);
      }
    }
    for (const r of rows) {
      if (r.state === 'incomplete') reasons.push(`${r.path} incomplete (still has fill-in markers)`);
    }
    if (reasons.length > 0) {
      console.log(`CLAUDE.md nudge — ${reasons.join('; ')}. (opt-in; unset PM_CLAUDE_NUDGE to silence)`);
    }
    process.exit(0); // warn-only — never blocks
  }

  const md = toMarkdown(rows, report);
  if (args.json) {
    process.stdout.write(JSON.stringify({ boundaries: rows, counts: report.counts, findings: report.findings }, null, 2) + '\n');
  } else {
    process.stdout.write(md + '\n');
  }
  // --report always writes the markdown form, regardless of --json on stdout.
  if (args.report) {
    fs.mkdirSync(path.dirname(path.resolve(args.report)), { recursive: true });
    fs.writeFileSync(args.report, md, 'utf8');
  }
  // Findings (over-budget, duplicates-root) enforce the tiered model: the default
  // invocation exits non-zero when any fire. --strict additionally gates on a gap.
  const gaps = rows.filter((r) => r.state === 'gap').length;
  const fail = report.findings.length > 0 || (args.strict && gaps > 0);
  process.exit(fail ? 1 : 0);
}

main();
