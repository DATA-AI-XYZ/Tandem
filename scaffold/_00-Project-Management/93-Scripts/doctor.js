#!/usr/bin/env node
/**
 * doctor.js — read-only wiring pre-flight for a project's PM-kit wiring.
 *
 * Reports, as discrete ✓/✗/⚠ lines, the things that silently break when the kit
 * is half-installed:
 *   - the `pm:*` scripts are wired into the host package.json,
 *   - the path map (90-Standards/pm-paths.json or .claude-pm-config.json) is present + valid,
 *   - the mapped artefact folders that exist,
 *   - Node is available.
 *
 * Exits non-zero if any CORE check fails (no path map, or core pm:* scripts not
 * wired), zero when the core wiring is healthy. Strictly READ-ONLY — running it
 * leaves the target tree byte-for-byte unchanged (the value is a safe diagnostic).
 *
 * Canonical entrypoint (ADR-0054): this file supersedes the v2.4.0 `pm-doctor.js`
 * spike. `--root` is accepted as an alias of `--target`.
 *
 * Usage: node _00-Project-Management/93-Scripts/doctor.js   (npm run pm:doctor)
 *        --target <dir> | --root <dir>   audit a different project root
 *        --gate                          terse skill pre-flight: on unwired, print
 *                                        ONE canonical "kit not wired" line + exit 1;
 *                                        silent + exit 0 when healthy.
 * Exit codes: 0 = healthy · 1 = core wiring broken · 2 = bad args.
 * Dependency-free — Node stdlib only.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { loadPaths, SCAN_KEYS } = require('./lib/pm-paths');

// The ONE canonical "not wired" line (STORY-12.2.03). Lives here so the skills can
// surface it verbatim and there is a single source of truth for the wording + fix.
const NOT_WIRED_MSG = 'kit not wired — run `npm run pm:install`';

// --target / --root override lets you point doctor at another project (default = this
// kit's repo). --gate selects the terse skill pre-flight mode.
function parseArgs() {
  const argv = process.argv.slice(2);
  let target = path.resolve(__dirname, '..', '..'); // repo root (two up from 93-Scripts)
  let gate = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--target' || argv[i] === '--root') {
      const v = argv[i + 1];
      if (!v || v.startsWith('--')) { console.error(`✗ ${argv[i]} requires a directory path`); process.exit(2); }
      target = path.resolve(v); i++;
    } else if (argv[i] === '--gate') { gate = true; }
    else if (argv[i].startsWith('--')) { console.error(`✗ unknown arg: ${argv[i]}`); process.exit(2); }
  }
  return { target, gate };
}

// pm:* scripts, split by how badly a project breaks without them.
const CORE_SCRIPTS = { 'pm:lint': 'validate-frontmatter.js', 'pm:dash': 'generate-dashboard.js' };
const RECOMMENDED_SCRIPTS = { 'pm:monitor': 'generate-monitor.js', 'pm:map': 'generate-codebase-map.js', 'pm:doctor': 'doctor.js', 'pm:install': 'install.js' };
const OPTIONAL_SCRIPTS = { 'pm:claude-scaffold': 'claude-scaffold.js', 'pm:claude-audit': 'claude-audit.js' };

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_e) { return null; } }

// Run every check and return { lines, coreBroken } — pure (no writes), so the gate
// wrapper (STORY-12.2.03) can reuse the verdict without re-implementing the checks.
function diagnose(REPO_ROOT) {
  const PM_ROOT = path.join(REPO_ROOT, '_00-Project-Management');
  const lines = [];
  let coreBroken = false;
  const ok = (label, detail) => lines.push(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  const warn = (label, detail) => lines.push(`  ⚠ ${label}${detail ? ` — ${detail}` : ''}`);
  const bad = (label, detail) => { lines.push(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); coreBroken = true; };

  // 1. Node available
  ok('Node runtime', process.version);

  // 2. pm:* scripts wired into host package.json (CORE = pm:lint + pm:dash)
  const pkg = readJson(path.join(REPO_ROOT, 'package.json'));
  const scripts = (pkg && pkg.scripts) || {};
  if (!pkg) bad('package.json not found', `${REPO_ROOT} — pm:* scripts cannot be wired (run pm:install)`);
  else {
    const coreMissing = Object.keys(CORE_SCRIPTS).filter(n => !scripts[n]);
    if (coreMissing.length) bad('Core pm:* scripts not wired', `missing: ${coreMissing.join(', ')} (run pm:install)`);
    else ok('Core pm:* scripts wired', 'pm:lint, pm:dash');
    const recMissing = Object.keys(RECOMMENDED_SCRIPTS).filter(n => !scripts[n]);
    if (recMissing.length) warn('Recommended scripts not wired', recMissing.join(', '));
    const optMissing = Object.keys(OPTIONAL_SCRIPTS).filter(n => !scripts[n]);
    if (optMissing.length) lines.push(`  · optional Claude-layer scripts not wired: ${optMissing.join(', ')}`);
  }

  // 3. path map present + valid (CORE) — pm-paths.json or .claude-pm-config.json
  const pmPaths = path.join(PM_ROOT, '90-Standards', 'pm-paths.json');
  const cfgPath = path.join(REPO_ROOT, '.claude-pm-config.json');
  const pmPathsExists = fs.existsSync(pmPaths);
  const cfgExists = fs.existsSync(cfgPath);
  if (!pmPathsExists && !cfgExists) {
    bad('Path map missing', 'no 90-Standards/pm-paths.json or .claude-pm-config.json (run pm:install)');
  } else {
    let valid = true, which = [];
    if (pmPathsExists) { if (readJson(pmPaths)) which.push('pm-paths.json'); else { valid = false; } }
    if (cfgExists) { if (readJson(cfgPath)) which.push('.claude-pm-config.json'); else { valid = false; } }
    if (!valid) bad('Path map invalid', 'present but not valid JSON — fix or re-run pm:install');
    else ok('Path map present + valid', which.join(' + '));
  }

  // 4. layout resolves + which mapped folders exist (report; not core)
  const { map, layout, source } = loadPaths(PM_ROOT);
  ok(`Folder layout: ${layout}`, `resolved via ${source}`);
  if (fs.existsSync(PM_ROOT)) {
    const present = [], missing = [];
    for (const k of SCAN_KEYS) { const f = map[k]; (fs.existsSync(path.join(PM_ROOT, f)) ? present : missing).push(`${k}→${f}`); }
    if (present.length) ok('Mapped folders found', present.join(', '));
    else warn('No artefact folders found yet', 'create epics/stories/… or check the layout preset');
    if (missing.length) lines.push(`  · not present (ok if unused): ${missing.join(', ')}`);
  } else {
    lines.push('  · no _00-Project-Management/ folder yet (copy the scaffold or run BOOTSTRAP)');
  }

  return { lines, coreBroken };
}

function main() {
  const { target: REPO_ROOT, gate } = parseArgs();
  const { lines, coreBroken } = diagnose(REPO_ROOT);

  // --gate: the cheap skill pre-flight. ONE line on failure, silence on success — so
  // a skill can refuse loudly and surface the canonical message verbatim, with no
  // friction in a correctly-wired repo.
  if (gate) {
    if (coreBroken) { console.log(NOT_WIRED_MSG); process.exit(1); }
    process.exit(0);
  }

  console.log('pm:doctor — PM-kit wiring health\n');
  for (const l of lines) console.log(l);
  if (coreBroken) {
    console.log(`\n→ ${NOT_WIRED_MSG}   (or: node _00-Project-Management/93-Scripts/install.js)`);
    console.error('\n✗ pm:doctor — core wiring problems found.');
    process.exit(1);
  }
  console.log('\n✓ pm:doctor — wiring is healthy.');
  process.exit(0);
}

module.exports = { diagnose, NOT_WIRED_MSG };

if (require.main === module) { main(); }
