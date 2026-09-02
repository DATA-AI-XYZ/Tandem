#!/usr/bin/env node
/**
 * generate-codebase-map.js
 *
 * Generates / refreshes a repo-root `CODEBASE-MAP.md` — a lightweight markdown
 * table listing the repository's top-level directories with a one-line purpose
 * and an owner. Per Anthropic's large-codebases guidance, a codebase map gives
 * Claude a fast orientation without walking the whole tree.
 *
 * Behaviour:
 *   - Globs top-level DIRECTORIES at the repo root (one level deep only).
 *   - Skips transient / dependency / build directories (DENY_DIRS) and `.git`.
 *     Other dot-prefixed directories that carry project meaning (e.g.
 *     `.claude-plugin`, `.github`) are KEPT — see ADR-0008.
 *   - Skips anything GIT ALREADY IGNORES. DENY_DIRS is a hand-kept list and it
 *     drifted: `.playwright-mcp/` is a machine-local scratch directory, listed in
 *     .gitignore since it appeared, and this script mapped it into a TRACKED file
 *     anyway — so `npm run pm:map` produced an uncommittable diff on any machine
 *     that had ever run the Playwright MCP, and a clean one everywhere else
 *     (BUG-20260818-11). The repository's own ignore list is the answer that
 *     cannot drift from the repository.
 *   - Does NOT follow symlinks (uses lstat; symlinked dirs are skipped).
 *   - Idempotent + non-destructive: if CODEBASE-MAP.md already exists, rows whose
 *     Purpose/Owner have been filled in (i.e. are not the TODO placeholder) are
 *     preserved; only newly-appeared directories are added with TODO placeholders.
 *     Rows for directories that no longer exist are dropped.
 *
 * Usage:
 *   node _00-Project-Management/93-Scripts/generate-codebase-map.js
 *   npm run pm:map
 *
 * Exit codes:
 *   0 — wrote CODEBASE-MAP.md (even if zero mappable dirs — emits an empty table)
 *   2 — script error (couldn't read repo root or write the file)
 *
 * Dependency-free — uses only Node.js stdlib (fs, path).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// ---------- Config ----------

// Script lives at <repo>/_00-Project-Management/93-Scripts/ — repo root is two up.
const PM_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PM_ROOT, '..');
const OUT_FILE = path.join(REPO_ROOT, 'CODEBASE-MAP.md');

const TODO = 'TODO';

// Directories never worth mapping: dependencies, build outputs, caches, VCS.
// Mirrors the spirit of the scaffold `.claudeignore`. Dot-dirs NOT listed here
// (e.g. `.claude-plugin`, `.github`) are intentionally kept (ADR-0008).
const DENY_DIRS = new Set([
  '.git', 'node_modules', '.venv', 'venv', 'vendor', '.pnp',
  'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', '.turbo',
  '.parcel-cache', 'coverage', '.nyc_output', 'test-results',
  'playwright-report', '.cache', '.idea', '.vscode', '__pycache__',
]);

// ---------- Helpers ----------

/**
 * The candidate names git already ignores, in ONE batch call.
 *
 * Returns `consulted: false` when git is unavailable — in which case DENY_DIRS alone applies
 * and the caller SAYS SO, rather than printing the same line either way. `check-ignore` exits
 * 1 when nothing matched, which is a normal answer and not a failure.
 */
function gitIgnoredNames(root, names) {
  if (!names.length) return { set: new Set(), consulted: false };
  const r = spawnSync('git', ['check-ignore', '--stdin'], {
    cwd: root, input: names.join('\n'), encoding: 'utf8',
  });
  if (r.error || (r.status !== 0 && r.status !== 1)) return { set: new Set(), consulted: false };
  const hit = String(r.stdout || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  return { set: new Set(hit.map((x) => x.replace(/[/\\]+$/, ''))), consulted: true };
}

/**
 * Return the sorted list of mappable top-level directory names.
 * One level deep; skips DENY_DIRS, anything git ignores, and symlinks.
 */
function listTopLevelDirs(root) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (err) {
    console.error(`✗ cannot read repo root: ${root}\n  ${err.message}`);
    process.exit(2);
  }
  const ig = gitIgnoredNames(root, entries.filter((e) => !DENY_DIRS.has(e.name)).map((e) => e.name));
  listTopLevelDirs.gitConsulted = ig.consulted;
  listTopLevelDirs.gitSkipped = [];
  const dirs = [];
  for (const entry of entries) {
    const name = entry.name;
    if (DENY_DIRS.has(name)) continue;
    if (ig.set.has(name)) { listTopLevelDirs.gitSkipped.push(name); continue; }
    // Resolve real type with lstat so we never follow a symlink into another tree.
    let st;
    try {
      st = fs.lstatSync(path.join(root, name));
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    if (!st.isDirectory()) continue;
    dirs.push(name);
  }
  return dirs.sort((a, b) => a.localeCompare(b));
}

/**
 * Parse an existing CODEBASE-MAP.md table into { '<path>': {purpose, owner} }.
 * Tolerant of hand edits: only reads pipe-table rows under the header.
 */
function parseExistingRows(content) {
  const rows = {};
  if (!content) return rows;
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    // A data row: | <path> | <purpose> | <owner> |
    const m = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*$/);
    if (!m) continue;
    const pathCell = m[1].trim();
    // Skip the header row and the separator row.
    if (pathCell === 'Path' || /^-+$/.test(pathCell)) continue;
    // Normalise: strip surrounding backticks if a human added them.
    const key = pathCell.replace(/^`+|`+$/g, '');
    rows[key] = { purpose: m[2].trim(), owner: m[3].trim() };
  }
  return rows;
}

function buildMarkdown(dirs, existing) {
  const header =
    '# Codebase Map\n' +
    '\n' +
    'Lightweight map of the repository\'s top-level directories. Auto-generated by\n' +
    '`npm run pm:map` (`_00-Project-Management/93-Scripts/generate-codebase-map.js`).\n' +
    'Re-running adds any new directories with `TODO` placeholders and preserves rows\n' +
    'you have already filled in. Replace each `TODO`.\n' +
    '\n' +
    '| Path | Purpose | Owner |\n' +
    '|---|---|---|\n';

  const rows = dirs.map((name) => {
    const key = name + '/';
    const prev = existing[key] || existing[name] || {};
    const purpose = prev.purpose && prev.purpose !== '' ? prev.purpose : TODO;
    const owner = prev.owner && prev.owner !== '' ? prev.owner : TODO;
    return `| ${key} | ${purpose} | ${owner} |`;
  });

  return header + rows.join('\n') + '\n';
}

// ---------- Main ----------

function main() {
  const dirs = listTopLevelDirs(REPO_ROOT);

  let existing = {};
  if (fs.existsSync(OUT_FILE)) {
    try {
      existing = parseExistingRows(fs.readFileSync(OUT_FILE, 'utf8'));
    } catch {
      existing = {};
    }
  }

  const md = buildMarkdown(dirs, existing);

  try {
    fs.writeFileSync(OUT_FILE, md, 'utf8');
  } catch (err) {
    console.error(`✗ cannot write ${OUT_FILE}\n  ${err.message}`);
    process.exit(2);
  }

  const rel = path.relative(REPO_ROOT, OUT_FILE).replace(/\\/g, '/');
  console.log(`✓ wrote ${rel} (${dirs.length} row${dirs.length === 1 ? '' : 's'})`);
  // WHICH RULE APPLIED IS PART OF THE RESULT. On a machine without git the ignore list is not
  // consulted at all, and the same success line either way would hide that this run mapped by
  // a weaker rule than the last one.
  if (listTopLevelDirs.gitConsulted) {
    const sk = listTopLevelDirs.gitSkipped || [];
    console.log(`  git-ignored directories skipped: ${sk.length ? sk.join(', ') : 'none'}`);
  } else {
    console.log('  note: git was not available, so only DENY_DIRS applied — a gitignored '
      + 'directory may have been mapped into this tracked file.');
  }
  process.exit(0);
}

main();
