#!/usr/bin/env node
/**
 * install-hooks.js
 *
 * Copy the PM-KIT pre-commit hook into the host repo's .git/hooks/ and make it
 * executable. Graceful no-op when not inside a git repo. Never overwrites a
 * pre-existing non-PM-kit hook. Re-runnable (idempotent).
 *
 * Usage: node install-hooks.js [--root <dir>]
 *   --root <dir>   repo root whose .git/hooks/ to install into
 *                  (default: two levels above this script)
 *
 * Dependency-free — Node stdlib only.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Signature line both the hook and this installer recognise as "PM-kit owns
// this hook" — gate for safe overwrite vs. preserving a foreign hook.
const HOOK_SIGNATURE = 'PM-KIT pre-commit hook';

function parseArgs(argv) {
  const args = { root: path.resolve(__dirname, '..', '..') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root' && argv[i + 1]) args.root = path.resolve(argv[++i]);
  }
  return args;
}

// Resolve the actual git dir (honours worktrees / `.git` files). Returns null
// when not a git repo or git is unavailable.
function gitDir(root) {
  try {
    const out = execFileSync('git', ['rev-parse', '--git-dir'], { cwd: root, encoding: 'utf8' });
    return path.resolve(root, out.trim());
  } catch {
    return null;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const gd = gitDir(args.root);
  if (!gd) {
    console.log('Not a git repo (or git unavailable) — skipping hook install.');
    process.exit(0);
  }
  const src = path.join(__dirname, 'hooks', 'pre-commit');
  const hooksDir = path.join(gd, 'hooks');
  const dest = path.join(hooksDir, 'pre-commit');
  fs.mkdirSync(hooksDir, { recursive: true });
  if (fs.existsSync(dest)) {
    const existing = fs.readFileSync(dest, 'utf8');
    if (!existing.includes(HOOK_SIGNATURE)) {
      console.log(`A non-PM-kit pre-commit hook already exists at ${dest} — not overwriting.`);
      console.log('Add this line to it manually: node _00-Project-Management/93-Scripts/install-hooks.js');
      process.exit(0);
    }
  }
  fs.copyFileSync(src, dest);
  try { fs.chmodSync(dest, 0o755); } catch { /* windows / no-chmod fs — ignore */ }
  console.log(`Installed PM-kit pre-commit hook → ${dest}`);
}

main();
