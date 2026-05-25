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
 * templates live under scaffold/91-Templates and scaffold/.claude). Missing
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

// Ordered template search roots. First hit wins. Covers both the deployed
// host-repo layout and this kit's scaffold/ staging layout.
const PM_ROOT = path.resolve(__dirname, '..');           // _00-Project-Management
const REPO_ROOT = path.resolve(PM_ROOT, '..');           // kit repo root (or host repo root once deployed)
const TEMPLATE_ROOTS = [
  path.join(PM_ROOT, '91-Templates'),                    // host-repo layout
  path.join(REPO_ROOT, '91-Templates'),                  // deploy root layout
  path.join(REPO_ROOT, 'scaffold', '91-Templates'),      // kit staging layout
];
const SETTINGS_BASELINE_PATHS = [
  path.join(REPO_ROOT, '.claude', 'settings.json'),      // deployed host repo
  path.join(REPO_ROOT, 'scaffold', '.claude', 'settings.json'), // kit staging
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
  const args = { root: path.resolve(__dirname, '..', '..'), include: null, all: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root' && argv[i + 1]) args.root = path.resolve(argv[++i]);
    else if (a === '--include' && argv[i + 1]) args.include = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--all') args.all = true;
    else if (a === '--yes') args.yes = true;
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
    console.log('Usage: node claude-scaffold.js [--root <dir>] [--include /a,/b | --all] [--yes]');
    process.exit(0);
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

main();
