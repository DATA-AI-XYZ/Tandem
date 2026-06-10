#!/usr/bin/env node
/**
 * claude-scaffold.js
 *
 * Create/merge the CLAUDE.md context layer in a host repo from detected
 * boundaries. Non-destructive: only PM-KIT managed blocks are (re)written;
 * human content is preserved. settings.json deny list is union-merged.
 *
 * Usage:
 *   node claude-scaffold.js [--root <dir>] [--include /a,/b | --all] [--yes]
 *
 *   --root <dir>       repo root to scaffold (default: two levels above this script)
 *   --include a,b      comma-separated candidate paths to include (non-interactive)
 *   --all              include every detected candidate (non-interactive)
 *   --yes              skip the confirm prompt when --include/--all is absent and
 *                      a config already exists (use config include list)
 *   (no flags + TTY)   interactive confirm: tick which candidates to include
 *
 * Writes: <root>/CLAUDE.md, <root>/<sub>/CLAUDE.md, <root>/codebase-map.md,
 *         <root>/.claude/settings.json, <root>/.claude-pm-config.json
 *
 * Template resolution (see ADR-0012): each template is looked up across an
 * ordered set of candidate locations so the command works both in a deployed
 * host repo (templates under <repo>/91-Templates and the settings baseline at
 * <repo>/.claude/settings.json) and inside this kit (where the CLAUDE-layer
 * templates live under _00-Project-Management/91-Templates, incl. the migrated
 * CLAUDE-SETTINGS.template.json baseline — the scaffold/ tree is retired, ADR-0074). Missing
 * optional templates (e.g. SUBDIR-CLAUDE — owned by a parallel lane) fall back
 * to a minimal in-code stub rather than failing.
 *
 * Dependency-free — Node stdlib only.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const { detectBoundaries } = require('./lib/detect-boundaries');
const cfgLib = require('./lib/claude-config');
const { upsertManagedBlock, mergeSettingsDeny, buildCommandsBlock } =
  require('./lib/claude-md-writer');

// Ordered template search roots. First hit wins. The canonical templates live under
// `_00-Project-Management/91-Templates` (the retired scaffold/ staging layout is gone — ADR-0074;
// the setup templates ROOT-CLAUDE/SUBDIR-CLAUDE/CODEBASE-MAP/CLAUDE-SETTINGS migrated there).
const PM_ROOT = path.resolve(__dirname, '..');           // _00-Project-Management
const REPO_ROOT = path.resolve(PM_ROOT, '..');           // kit repo root (or host repo root once deployed)
const TEMPLATE_ROOTS = [
  path.join(PM_ROOT, '91-Templates'),                    // canonical (host-repo + kit layout)
  path.join(REPO_ROOT, '91-Templates'),                  // deploy root layout
];
const SETTINGS_BASELINE_PATHS = [
  path.join(REPO_ROOT, '.claude', 'settings.json'),                       // deployed host repo
  path.join(PM_ROOT, '91-Templates', 'CLAUDE-SETTINGS.template.json'),    // canonical settings baseline
];

function findTemplate(name) {
  for (const root of TEMPLATE_ROOTS) {
    const p = path.join(root, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function readTemplateOptional(name) {
  const p = findTemplate(name);
  return p ? fs.readFileSync(p, 'utf8') : null;
}

// Minimal in-code stubs used when an optional template is absent (e.g. the
// SUBDIR-CLAUDE template, which a parallel lane owns). The scaffold owns the
// managed:commands block inside; human prose is added later by the fill skill.
function rootClaudeFallback() {
  return '# CLAUDE.md\n\n## Commands\n' +
    '<!-- PM-KIT:BEGIN managed:commands -->\n<!-- PM-KIT:END managed:commands -->\n';
}
function subdirClaudeFallback(relPath) {
  return `# CLAUDE.md — ${relPath}\n\n## Commands\n` +
    '<!-- PM-KIT:BEGIN managed:commands -->\n<!-- PM-KIT:END managed:commands -->\n';
}
function codebaseMapFallback() {
  return '# Codebase Map\n\n' +
    '<!-- PM-KIT:BEGIN managed -->\n<!-- PM-KIT:END managed -->\n';
}

function baselineDeny() {
  for (const p of SETTINGS_BASELINE_PATHS) {
    if (!fs.existsSync(p)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (j && j.permissions && Array.isArray(j.permissions.deny)) return j.permissions.deny;
    } catch { /* fall through */ }
  }
  // Conservative destructive-only floor (matches ADR-0007) if no baseline found.
  return [
    'Bash(rm -rf:*)', 'Bash(git push --force*)', 'Bash(git push --force-with-lease*)',
    'Bash(npm publish*)', 'Write(.env*)', 'Write(node_modules/**)',
    'Edit(.env*)', 'Edit(node_modules/**)',
  ];
}

function parseArgs(argv) {
  const args = { root: path.resolve(__dirname, '..', '..'), include: null, all: false, yes: false, tiered: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    // --target is an alias of --root: a fixture seam for the tiered mode so a temp
    // tree can be scaffolded without touching the real repo root.
    if ((a === '--root' || a === '--target') && argv[i + 1]) args.root = path.resolve(argv[++i]);
    else if (a === '--include' && argv[i + 1]) args.include = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--all') args.all = true;
    else if (a === '--yes') args.yes = true;
    else if (a === '--tiered') args.tiered = true;
    else if (a === '--help') args.help = true;
  }
  return args;
}

function relToFsDir(root, relPath) {
  if (relPath === '/') return root;
  return path.join(root, relPath.replace(/^\//, '').split('/').join(path.sep));
}

function writeFileEnsuringDir(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function scaffoldRootClaude(root, rootCandidate) {
  const file = path.join(root, 'CLAUDE.md');
  let base;
  if (fs.existsSync(file)) base = fs.readFileSync(file, 'utf8');
  else base = readTemplateOptional('ROOT-CLAUDE.template.md') || rootClaudeFallback();
  const commands = buildCommandsBlock(rootCandidate ? rootCandidate.scripts : {});
  const out = upsertManagedBlock(base, 'managed:commands', commands);
  writeFileEnsuringDir(file, out);
  return '/CLAUDE.md';
}

function scaffoldSubdirClaude(root, candidate) {
  const dir = relToFsDir(root, candidate.path);
  const file = path.join(dir, 'CLAUDE.md');
  let base;
  if (fs.existsSync(file)) base = fs.readFileSync(file, 'utf8');
  else base = readTemplateOptional('SUBDIR-CLAUDE.template.md') || subdirClaudeFallback(candidate.path);
  const commands = buildCommandsBlock(candidate.scripts);
  const out = upsertManagedBlock(base, 'managed:commands', commands);
  writeFileEnsuringDir(file, out);
  return candidate.path + '/CLAUDE.md';
}

// ---------------------------------------------------------------------------
// Tiered layout (STORY-12.4.01)
//
// The tiered mode emits a three-tier CLAUDE.md layout instead of a single flat
// file, so a host repo's always-loaded context stays small:
//   • Tier 1 — an always-on root CLAUDE.md (loaded every session).
//   • Tier 2 — a folder-scoped CLAUDE.md per primary source area (additive:
//              area-specific rules only; never a copy of root).
//   • Tier 3 — a thin pointer CLAUDE.md in occasional-use folders that just
//              defers to root rather than carrying its own rules.
// Folders are classified by name: occasional-use tooling/asset folders get a
// pointer; everything else gets a folder-scoped file. The classifier is a
// sensible default — projects extend it via `.claude-pm-config.json` include
// lists in the normal (non-tiered) flow.
// ---------------------------------------------------------------------------
const OCCASIONAL_FOLDERS = new Set([
  'scripts', 'script', 'tools', 'tool', 'docs', 'doc', 'config', 'configs',
  'infra', 'infrastructure', 'examples', 'example', 'assets', 'public',
  'vendor', 'bin', 'fixtures', '__fixtures__',
]);

const TIERED_IGNORE = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'out',
  'coverage', 'vendor', '__pycache__', 'target', '.venv', 'venv',
]);

function immediateSubdirs(root) {
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); }
  catch { return []; }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !TIERED_IGNORE.has(e.name))
    .map((e) => e.name)
    .sort();
}

// Tier-2 folder-scoped file: additive, area-specific, NOT a copy of root.
function tieredScopedContent(relName) {
  return `# CLAUDE.md — ${relName}/\n\n` +
    `Folder-scoped rules for \`${relName}/\`. **Additive** — assume the always-on ` +
    `root \`CLAUDE.md\` is already loaded; record here only what is specific to ` +
    `this area (its canonical test/build commands, conventions, gotchas). Do not ` +
    `restate root rules.\n\n## Commands\n` +
    '<!-- PM-KIT:BEGIN managed:commands -->\n<!-- PM-KIT:END managed:commands -->\n';
}

// Tier-3 thin pointer file: defers to root, carries no rules of its own.
function tieredPointerContent(relName) {
  return `# CLAUDE.md — ${relName}/ (pointer)\n\n` +
    `Pointer file. \`${relName}/\` is an occasional-use folder — it follows the ` +
    `always-on root \`CLAUDE.md\` and \`codebase-map.md\`. Add folder-specific ` +
    `rules here only if this area ever diverges from root.\n`;
}

// Write a Tier-2/Tier-3 subdir file without clobbering existing human content:
// if a CLAUDE.md already exists in the folder, leave it untouched.
function writeTieredSubdirFile(root, relName, kind) {
  const file = path.join(root, relName, 'CLAUDE.md');
  if (fs.existsSync(file)) return null; // never clobber an existing file
  const content = kind === 'pointer'
    ? tieredPointerContent(relName)
    : tieredScopedContent(relName);
  writeFileEnsuringDir(file, content);
  return '/' + relName + '/CLAUDE.md' + (kind === 'pointer' ? ' (pointer)' : '');
}

function scaffoldTiered(root) {
  const written = [];
  // Tier 1 — always-on root (reuse the standard root writer; no detected scripts
  // for a bare fixture tree → empty managed:commands block).
  written.push(scaffoldRootClaude(root, null));

  const subdirs = immediateSubdirs(root);
  let scopedCount = 0;
  let pointerCount = 0;
  for (const name of subdirs) {
    const kind = OCCASIONAL_FOLDERS.has(name.toLowerCase()) ? 'pointer' : 'scoped';
    const w = writeTieredSubdirFile(root, name, kind);
    if (!w) continue;
    if (kind === 'pointer') pointerCount += 1; else scopedCount += 1;
    written.push(w);
  }
  // Guarantee the three-tier shape (≥1 folder-scoped AND ≥1 pointer) when there
  // are ≥2 subdirs but the name-based classifier produced only one kind:
  // demote the last unwritten/last scoped folder to a pointer, or promote one.
  if (subdirs.length >= 2 && pointerCount === 0 && scopedCount >= 2) {
    // Re-emit the alphabetically-last subdir as a pointer (overwrite the scoped
    // file we just wrote for it — it carries no human content this run).
    const last = subdirs[subdirs.length - 1];
    const file = path.join(root, last, 'CLAUDE.md');
    fs.writeFileSync(file, tieredPointerContent(last), 'utf8');
    written[written.length - 1] = '/' + last + '/CLAUDE.md (pointer)';
  } else if (subdirs.length >= 2 && scopedCount === 0 && pointerCount >= 2) {
    const first = subdirs[0];
    const file = path.join(root, first, 'CLAUDE.md');
    fs.writeFileSync(file, tieredScopedContent(first), 'utf8');
    // first scoped entry is the one written right after root
    written[1] = '/' + first + '/CLAUDE.md';
  }

  // A codebase map ties the tiers together (Tier-1 index of where to look).
  const included = subdirs.map((p) => ({ path: '/' + p, manifest: null, framework: null }));
  written.push(scaffoldCodebaseMap(root, [{ path: '/', manifest: null, framework: null }, ...included]));
  written.push(scaffoldSettings(root));

  console.log('Scaffolded (tiered):');
  for (const w of written) console.log('  ' + w);
  console.log('\nTiers: 1 always-on root + ' + scopedCount + ' folder-scoped + ' +
    pointerCount + ' pointer file(s).');
  console.log('Next: run the `fill-claude-md` skill to complete each tier.');
  return written;
}

function scaffoldCodebaseMap(root, included) {
  const file = path.join(root, 'codebase-map.md');
  let base;
  if (fs.existsSync(file)) base = fs.readFileSync(file, 'utf8');
  else base = readTemplateOptional('CODEBASE-MAP.template.md') || codebaseMapFallback();
  const rows = ['| Folder | Purpose | Read its CLAUDE.md? |', '|---|---|---|'];
  for (const c of included) {
    const fw = c.framework ? c.framework : (c.manifest || '');
    const claudeRef = c.path === '/' ? '`CLAUDE.md`' : '`' + c.path.replace(/^\//, '') + '/CLAUDE.md`';
    rows.push(`| \`${c.path}\` | ${fw} | yes — ${claudeRef} |`);
  }
  const out = upsertManagedBlock(base, 'managed', rows);
  writeFileEnsuringDir(file, out);
  return '/codebase-map.md';
}

function scaffoldSettings(root) {
  const file = path.join(root, '.claude', 'settings.json');
  const deny = baselineDeny();
  let existing = null;
  if (fs.existsSync(file)) {
    try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { existing = null; }
  }
  const merged = mergeSettingsDeny(existing, deny);
  writeFileEnsuringDir(file, JSON.stringify(merged, null, 2) + '\n');
  return '/.claude/settings.json';
}

function chooseInteractive(candidates) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log('Detected candidates (root is always included):');
    candidates.forEach((c, i) => {
      const fw = c.framework ? ` (${c.framework})` : '';
      console.log(`  [${i}] ${c.path}\t${c.manifest || '-'}${fw}`);
    });
    rl.question('Include which? comma-separated indices, or "all": ', (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      if (a === 'all' || a === '') return resolve(candidates.map((c) => c.path));
      const idx = a.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n));
      const picked = candidates.filter((c, i) => idx.includes(i) || c.path === '/');
      resolve(picked.map((c) => c.path));
    });
  });
}

async function resolveIncludeList(args, candidates, cfg) {
  if (args.all) return candidates.map((c) => c.path);
  if (args.include) return Array.from(new Set(['/', ...args.include]));
  const fromCfg = cfg.claude_md.include || [];
  if (fromCfg.length > 0 && args.yes) return fromCfg;
  if (process.stdin.isTTY) return chooseInteractive(candidates);
  // Non-interactive, no flags, no config: default to root only (safe minimum).
  return ['/'];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node claude-scaffold.js [--root|--target <dir>] [--tiered] [--include /a,/b | --all] [--yes]');
    process.exit(0);
  }
  // Tiered mode (STORY-12.4.01): emit the three-tier layout and return. It is
  // self-contained and non-interactive — no boundary detection / config prompt.
  if (args.tiered) {
    scaffoldTiered(args.root);
    return;
  }
  const candidates = detectBoundaries(args.root);
  const byPath = Object.fromEntries(candidates.map((c) => [c.path, c]));
  const cfg = cfgLib.readConfig(args.root);

  const includePaths = await resolveIncludeList(args, candidates, cfg);
  const includedSet = new Set(includePaths);
  const excluded = candidates.map((c) => c.path).filter((p) => !includedSet.has(p));

  // Persist decisions.
  cfg.claude_md.include = includePaths;
  cfg.claude_md.exclude = Array.from(new Set([...(cfg.claude_md.exclude || []), ...excluded]))
    .filter((p) => !includedSet.has(p));
  cfgLib.writeConfig(args.root, cfg);

  const written = [];
  const includedCandidates = includePaths.map((p) => byPath[p]).filter(Boolean);

  written.push(scaffoldRootClaude(args.root, byPath['/']));
  for (const c of includedCandidates) {
    if (c.path === '/') continue;
    written.push(scaffoldSubdirClaude(args.root, c));
  }
  written.push(scaffoldCodebaseMap(args.root, includedCandidates));
  written.push(scaffoldSettings(args.root));

  console.log('Scaffolded:');
  for (const w of written) console.log('  ' + w);
  console.log('\nNext: run the `fill-claude-md` skill to complete gotchas/conventions and verify [auto — verify] lines.');
}

// Guard main() behind require.main so `require('./claude-scaffold.js')` performs NO side effect
// (no file writes) — matches doctor.js / pm-paths.js. Without this, importing the module scaffolds
// CLAUDE.md / CODEBASE-MAP.md / .claude/settings.json into the repo as a surprise side effect.
if (require.main === module) { main(); }
