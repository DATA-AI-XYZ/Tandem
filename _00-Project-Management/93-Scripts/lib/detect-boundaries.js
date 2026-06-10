#!/usr/bin/env node
/**
 * detect-boundaries.js
 *
 * Shared detection module for the CLAUDE.md-layer automation. Scans a repo and
 * returns the directories that should carry a CLAUDE.md, based on package
 * manifests and workspace declarations. Repo root is always a candidate.
 *
 * Library:  const { detectBoundaries } = require('./lib/detect-boundaries');
 *           detectBoundaries(rootAbsPath) -> Candidate[]
 * CLI:      node detect-boundaries.js --root <dir> [--json]
 *
 * Candidate = {
 *   path:      string,  // repo-relative, forward-slash, leading-slash; root = "/"
 *   manifest:  string|null,  // e.g. "package.json", "pyproject.toml", "workspace:turbo.json"
 *   framework: string|null,  // e.g. "Next.js", "Expo" (package.json only)
 *   scripts:   object        // { test, build, dev, lint, start } -> command string
 * }
 *
 * Dependency-free — Node stdlib only.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const MANIFESTS = [
  'package.json', 'pyproject.toml', 'setup.py', 'Cargo.toml',
  'go.mod', 'pom.xml', 'build.gradle', 'Gemfile', 'composer.json',
];
const WORKSPACE_FILES = ['pnpm-workspace.yaml', 'turbo.json', 'lerna.json', 'go.work', 'nx.json'];
const CSPROJ_RE = /\.csproj$/i;
const DEFAULT_IGNORE = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'out',
  'coverage', 'vendor', '__pycache__', 'target', '.venv', 'venv',
]);
const SCRIPT_KEYS = ['test', 'build', 'dev', 'lint', 'start'];

function isManifestName(name) {
  return MANIFESTS.includes(name) || CSPROJ_RE.test(name);
}

function readJSONSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}

// Lightweight .gitignore support: add bare top-level directory names to the
// ignore set (e.g. a line "tmp/" or "tmp"). Full glob semantics are out of
// scope — this catches the common "ignore this whole folder" case.
function loadGitignore(root) {
  const ignore = new Set(DEFAULT_IGNORE);
  const gi = path.join(root, '.gitignore');
  if (!fs.existsSync(gi)) return ignore;
  for (const raw of fs.readFileSync(gi, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.includes('*') || line.includes('/')) {
      // skip blanks, comments, globs, and nested paths
      if (line.endsWith('/') && !line.slice(0, -1).includes('/') && !line.includes('*')) {
        ignore.add(line.slice(0, -1));
      }
      continue;
    }
    ignore.add(line);
  }
  return ignore;
}

function detectFramework(dir) {
  const pkg = readJSONSafe(path.join(dir, 'package.json'));
  if (!pkg) return null;
  const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);
  if (deps.next) return 'Next.js';
  if (deps.expo) return 'Expo';
  if (deps['@remix-run/react']) return 'Remix';
  if (deps['@angular/core']) return 'Angular';
  if (deps.svelte) return 'Svelte';
  if (deps.vue) return 'Vue';
  if (deps.react) return 'React';
  return null;
}

function detectScripts(dir) {
  const pkg = readJSONSafe(path.join(dir, 'package.json'));
  const out = {};
  if (!pkg || !pkg.scripts) return out;
  for (const key of SCRIPT_KEYS) {
    if (pkg.scripts[key]) out[key] = `npm run ${key}`;
  }
  return out;
}

function manifestFor(dir, entryNames) {
  // Workspace declarations win the label when present (signals a monorepo root).
  for (const w of WORKSPACE_FILES) {
    if (entryNames.includes(w)) return `workspace:${w}`;
  }
  // Cargo workspace special-case.
  if (entryNames.includes('Cargo.toml')) {
    try {
      const txt = fs.readFileSync(path.join(dir, 'Cargo.toml'), 'utf8');
      if (/^\s*\[workspace\]/m.test(txt)) return 'workspace:Cargo.toml';
    } catch { /* ignore */ }
  }
  const m = entryNames.find(isManifestName);
  return m || null;
}

function hasBoundarySignal(entryNames) {
  return entryNames.some(isManifestName) ||
    entryNames.some((n) => WORKSPACE_FILES.includes(n));
}

function toRelPath(root, abs) {
  const rel = path.relative(root, abs).split(path.sep).join('/');
  return rel === '' ? '/' : '/' + rel;
}

function makeCandidate(root, abs, entryNames) {
  return {
    path: toRelPath(root, abs),
    manifest: manifestFor(abs, entryNames),
    framework: detectFramework(abs),
    scripts: detectScripts(abs),
  };
}

function detectBoundaries(root) {
  const absRoot = path.resolve(root);
  const ignore = loadGitignore(absRoot);
  const candidates = [];

  function walk(absDir) {
    let entries;
    try { entries = fs.readdirSync(absDir, { withFileTypes: true }); }
    catch { return; }
    const entryNames = entries.map((e) => e.name);

    const isRoot = path.resolve(absDir) === absRoot;
    if (isRoot || hasBoundarySignal(entryNames)) {
      candidates.push(makeCandidate(absRoot, absDir, entryNames));
    }

    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (ignore.has(e.name)) continue;
      if (e.name.startsWith('.')) continue;
      walk(path.join(absDir, e.name));
    }
  }

  walk(absRoot);
  candidates.sort((a, b) => a.path.localeCompare(b.path));
  return candidates;
}

// ---------- CLI ----------
function parseArgs(argv) {
  const args = { root: process.cwd(), json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root' && argv[i + 1]) { args.root = argv[++i]; }
    else if (argv[i] === '--json') { args.json = true; }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = detectBoundaries(args.root);
  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    for (const c of result) {
      const fw = c.framework ? ` (${c.framework})` : '';
      console.log(`${c.path}\t${c.manifest || '-'}${fw}`);
    }
  }
}

if (require.main === module) main();

module.exports = { detectBoundaries };
