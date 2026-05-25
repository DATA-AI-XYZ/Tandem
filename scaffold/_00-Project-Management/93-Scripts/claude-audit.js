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
 *   node claude-audit.js [--root <dir>] [--report <file>] [--strict] [--json]
 *
 *   --root <dir>   repo root to audit (default: two levels above this script)
 *   --strict       exit 1 if any boundary is a real gap (included-but-missing)
 *   --json         emit machine-readable JSON instead of markdown
 *   --report       also write the markdown report to <file>
 *
 * Default (no --strict): exit 0 — it's a report, not a gate.
 * Dependency-free — Node stdlib only.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { detectBoundaries } = require('./lib/detect-boundaries');
const cfgLib = require('./lib/claude-config');

function parseArgs(argv) {
  const args = { root: path.resolve(__dirname, '..', '..'), report: null, strict: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root' && argv[i + 1]) args.root = path.resolve(argv[++i]);
    else if (a === '--report' && argv[i + 1]) args.report = argv[++i];
    else if (a === '--strict') args.strict = true;
    else if (a === '--json') args.json = true;
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

function isoDate() {
  return new Date().toISOString().slice(0, 10);
}

const STATE_ORDER = ['covered', 'incomplete', 'gap', 'undecided', 'excluded'];

function toMarkdown(rows) {
  const by = (s) => rows.filter((r) => r.state === s);
  const lines = [];
  lines.push(`# CLAUDE.md coverage audit — ${isoDate()}`, '');
  for (const state of STATE_ORDER) {
    const items = by(state);
    lines.push(`## ${state} (${items.length})`);
    for (const r of items) lines.push(`- \`${r.path}\` (${r.manifest || '-'})`);
    lines.push('');
  }
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node claude-audit.js [--root <dir>] [--report <file>] [--strict] [--json]');
    process.exit(0);
  }
  const rows = audit(args.root);
  const md = toMarkdown(rows);
  if (args.json) {
    process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
  } else {
    process.stdout.write(md + '\n');
  }
  // --report always writes the markdown form, regardless of --json on stdout.
  if (args.report) {
    fs.mkdirSync(path.dirname(path.resolve(args.report)), { recursive: true });
    fs.writeFileSync(args.report, md, 'utf8');
  }
  if (args.strict) {
    const gaps = rows.filter((r) => r.state === 'gap').length;
    process.exit(gaps > 0 ? 1 : 0);
  }
  process.exit(0);
}

main();
