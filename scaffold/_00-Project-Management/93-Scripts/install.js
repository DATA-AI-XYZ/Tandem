#!/usr/bin/env node
/**
 * install.js — wire the PM kit into a host project (idempotent).
 *
 * Does the steps that were previously buried in BOOTSTRAP prose and easy to skip:
 *   1. merge the `pm:*` scripts into the host root package.json (adds only what's
 *      missing — never overwrites an existing definition),
 *   2. write the declared path map `90-Standards/pm-paths.json` for the target,
 *      using the detected (or --layout) preset, and pin the layout in
 *      `.claude-pm-config.json`,
 *   3. register the kit's Claude Code hooks into the target `.claude/settings.json`
 *      — GUARDED: only when the target has no existing hook registration, so a
 *      project that already gets hooks from the plugin (or a pasted scaffold
 *      settings.json) is not double-registered (the BACKLOG-0055 double-fire risk;
 *      ADR-0055).
 *
 * Run it again any time — every step is additive and idempotent. After it, run
 * `npm run pm:doctor` (doctor.js).
 *
 * Canonical entrypoint (ADR-0054): this file — and doctor.js — supersede the
 * v2.4.0 `pm-install.js` / `pm-doctor.js` spike, which used a `--root` seam and
 * pinned only `.claude-pm-config.json`. `--root` is still accepted as an alias of
 * `--target` so existing muscle memory / docs keep working.
 *
 * Usage: node _00-Project-Management/93-Scripts/install.js   (npm run pm:install)
 *        --target <dir> | --root <dir>   install into a different project root
 *        --layout full|flattened         pin a layout instead of auto-detecting
 *        --dry-run                        print what would change, write nothing
 * Exit codes: 0 = done (or dry-run) · 1 = nothing to write into (no package.json) · 2 = bad args.
 * Dependency-free — Node stdlib only.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { detectLayout, PRESETS } = require('./lib/pm-paths');

// pm:* scripts wired into a host package.json. pm:install / pm:doctor point at the
// canonical install.js / doctor.js (ADR-0054), not the retired pm-*.js names.
const SCRIPTS = {
  'pm:lint': 'validate-frontmatter.js',
  'pm:dash': 'generate-dashboard.js',
  'pm:monitor': 'generate-monitor.js',
  'pm:map': 'generate-codebase-map.js',
  'pm:doctor': 'doctor.js',
  'pm:install': 'install.js',
  'pm:claude-scaffold': 'claude-scaffold.js',
  'pm:claude-audit': 'claude-audit.js',
};

// The kit's Claude Code hooks, written into a target's .claude/settings.json ONLY
// when it has none (guarded write — ADR-0055). Cross-platform Node entrypoint per
// ADR-0053; ${CLAUDE_PROJECT_DIR} is resolved by Claude Code at run time.
function hooksBlock() {
  const cmd = (event) => `node "${'${CLAUDE_PROJECT_DIR}'}/_00-Project-Management/93-Scripts/hook.js" ${event}`;
  return {
    PostToolUse: [{ matcher: 'Write|Edit', hooks: [{ type: 'command', command: cmd('post-tool-use') }] }],
    Stop: [{ hooks: [{ type: 'command', command: cmd('stop') }] }],
  };
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const out = { root: null, layout: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target' || a === '--root') {
      out.root = argv[++i];
      if (!out.root || out.root.startsWith('--')) { console.error(`✗ ${a} requires a path`); process.exit(2); }
    } else if (a === '--layout') {
      out.layout = argv[++i];
      if (!PRESETS[out.layout]) { console.error(`✗ --layout must be one of: ${Object.keys(PRESETS).join(', ')}`); process.exit(2); }
    } else if (a === '--dry-run') { out.dryRun = true; }
    else { console.error(`✗ unknown arg: ${a}`); process.exit(2); }
  }
  return out;
}

// Write `content` to `p` only if it differs from what's on disk — keeps re-runs a
// true no-op (idempotency, AC-4). Returns true if it wrote.
function writeIfChanged(p, content) {
  try { if (fs.existsSync(p) && fs.readFileSync(p, 'utf8') === content) return false; } catch (_e) { /* fall through to write */ }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
  return true;
}

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_e) { return null; } }

// Read an existing JSON object strictly: a MISSING file → {} (we'll create it), but a
// present-but-malformed file is FATAL (exit 1) rather than silently treated as empty.
// Critical for .claude/settings.json — overwriting an unparseable settings.json would
// destroy the user's permissions.deny (the exact key AC-2 promises to preserve). Same
// guard for .claude-pm-config.json so a corrupt custom `paths` map isn't clobbered.
function readJsonStrict(p, label) {
  if (!fs.existsSync(p)) return {};
  let obj;
  try { obj = JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { console.error(`✗ Malformed ${label}: ${e.message}. Fix or remove it, then re-run pm:install (refusing to overwrite to preserve its contents).`); process.exit(1); }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    console.error(`✗ ${label} must be a JSON object. Fix or remove it, then re-run pm:install.`); process.exit(1);
  }
  return obj;
}

function main() {
  const args = parseArgs();
  const REPO_ROOT = args.root ? path.resolve(args.root) : path.resolve(__dirname, '..', '..');
  const PM_ROOT = path.join(REPO_ROOT, '_00-Project-Management');
  const changes = [];
  const skipped = [];

  // ---- 1. package.json scripts (additive; never overwrite) ----
  const pkgPath = path.join(REPO_ROOT, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    console.error(`✗ No package.json at ${REPO_ROOT}. Run \`npm init -y\` first, then re-run pm:install.`);
    process.exit(1);
  }
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); } catch (e) { console.error(`✗ Malformed package.json: ${e.message}`); process.exit(1); }
  pkg.scripts = pkg.scripts || {};
  const added = [];
  for (const [name, file] of Object.entries(SCRIPTS)) {
    const cmd = `node _00-Project-Management/93-Scripts/${file}`;
    if (!pkg.scripts[name]) { pkg.scripts[name] = cmd; added.push(name); }
  }
  if (!pkg.scripts['pm:all']) { pkg.scripts['pm:all'] = 'npm run pm:lint && npm run pm:monitor && npm run pm:dash'; added.push('pm:all'); }
  const pkgContent = JSON.stringify(pkg, null, 2) + '\n';

  // ---- 2. layout: pin .claude-pm-config.json + write 90-Standards/pm-paths.json ----
  const cfgPath = path.join(REPO_ROOT, '.claude-pm-config.json');
  const cfg = readJsonStrict(cfgPath, '.claude-pm-config.json');
  const layout = args.layout || cfg.layout || detectLayout(PM_ROOT) || 'full';
  cfg.layout = layout;
  const cfgContent = JSON.stringify(cfg, null, 2) + '\n';
  const pathsCfgPath = path.join(PM_ROOT, '90-Standards', 'pm-paths.json');
  const pathsContent = JSON.stringify({ layout, paths: { ...PRESETS[layout] } }, null, 2) + '\n';

  // ---- 3. hooks: guarded write into target .claude/settings.json (ADR-0055) ----
  const settingsPath = path.join(REPO_ROOT, '.claude', 'settings.json');
  const settings = readJsonStrict(settingsPath, '.claude/settings.json');
  const alreadyHooked = settings.hooks && typeof settings.hooks === 'object' && Object.keys(settings.hooks).length > 0;
  let settingsContent = null;
  if (!alreadyHooked) {
    settings.hooks = hooksBlock();
    settingsContent = JSON.stringify(settings, null, 2) + '\n';
  }

  // ---- apply (or dry-run) ----
  console.log(`pm:install — wiring ${path.basename(REPO_ROOT)} (layout: ${layout})\n`);

  const plan = [
    { path: pkgPath, content: pkgContent, label: added.length ? `package.json → added scripts: ${added.join(', ')}` : null },
    { path: cfgPath, content: cfgContent, label: cfg.layout !== readJson(cfgPath)?.layout ? `.claude-pm-config.json → layout: "${layout}"` : null },
    { path: pathsCfgPath, content: pathsContent, label: 'pm-paths.json' },
    ...(settingsContent ? [{ path: settingsPath, content: settingsContent, label: '.claude/settings.json → hooks registered' }] : []),
  ];
  if (alreadyHooked) skipped.push('.claude/settings.json hooks already registered — skipped (avoids double-fire, ADR-0055)');

  if (args.dryRun) {
    for (const step of plan) {
      const wouldChange = !(fs.existsSync(step.path) && (() => { try { return fs.readFileSync(step.path, 'utf8') === step.content; } catch (_e) { return false; } })());
      if (wouldChange) changes.push(step.label || path.relative(REPO_ROOT, step.path));
    }
    if (changes.length) for (const c of changes) console.log(`  • ${c}`);
    else console.log('  Nothing to do — already wired. ✓');
    for (const s of skipped) console.log(`  · ${s}`);
    console.log('\n(dry-run — no files written)');
    process.exit(0);
  }

  for (const step of plan) {
    if (writeIfChanged(step.path, step.content)) changes.push(step.label || path.relative(REPO_ROOT, step.path));
  }
  if (changes.length) for (const c of changes) console.log(`  • ${c}`);
  else console.log('  Nothing to do — already wired. ✓');
  for (const s of skipped) console.log(`  · ${s}`);

  console.log('\n✓ pm:install done. Next: npm run pm:doctor');
  process.exit(0);
}

main();
