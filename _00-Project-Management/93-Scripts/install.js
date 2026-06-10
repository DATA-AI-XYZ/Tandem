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
const { execFileSync } = require('child_process');
const { detectLayout, loadPaths, PRESETS } = require('./lib/pm-paths');
const { ROLE_BY_FULL_FOLDER, remapPmSubPath, remapPmRepoPath, walkFiles, readJson } = require('./lib/pm-materialize');
const { shouldShipKitScript } = require('./lib/ship-filter');

// The kit's own _00-Project-Management (this file lives at 93-Scripts/install.js).
// Seed SOURCES (`seedFiles[].src` in the manifest) are resolved against this — they
// travel with the scripts, so materialization survives the scaffold's retirement
// (STORY-16.4.05). The install TARGET (REPO_ROOT/PM_ROOT) is resolved separately in main().
const KIT_PM_ROOT = path.resolve(__dirname, '..');
const MANIFEST = readJson(path.join(__dirname, 'lib', 'pm-manifest.json'));

// Containment guard: is `childAbs` strictly inside `parentAbs`? A manifest entry with a
// `..` segment would otherwise let `path.join` resolve outside the install target — install
// must never write outside it (the manifest is kit-controlled, but this is the safety
// primitive `update` builds on, so we assert rather than trust). Allows parent === child.
function isInside(parentAbs, childAbs) {
  const parent = path.resolve(parentAbs);
  const child = path.resolve(childAbs);
  return child === parent || child.startsWith(parent + path.sep);
}

// pm:* scripts wired into a host package.json. pm:install / pm:doctor point at the
// canonical install.js / doctor.js (ADR-0054), not the retired pm-*.js names.
const SCRIPTS = {
  'pm:lint': 'validate-frontmatter.js',
  'pm:dash': 'generate-dashboard.js',
  'pm:monitor': 'generate-monitor.js',
  'pm:map': 'generate-codebase-map.js',
  'pm:doctor': 'doctor.js',
  'pm:install': 'install.js',
  'pm:update': 'update.js',
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
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: cmd('user-prompt-submit') }] }],
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
  const priorLayout = cfg.layout;   // capture before mutation for change-detection (no tolerant re-read)
  const layout = args.layout || cfg.layout || detectLayout(PM_ROOT) || 'full';
  // Computed destructuring: extract the preset map for the resolved layout name into
  // layoutPreset — used for pm-paths.json content and the dry-run layoutMap fallback.
  const { [layout]: layoutPreset } = PRESETS;
  cfg.layout = layout;
  // Stamp the installed kit version (manifest is the source that travels with the scripts),
  // so a fresh install reads as current and `pm:update`/`pm:doctor` have a baseline to compare.
  if (MANIFEST && MANIFEST.kitVersion) cfg.kitVersion = MANIFEST.kitVersion;
  const cfgContent = JSON.stringify(cfg, null, 2) + '\n';

  // ---- 3. hooks: guarded write into target .claude/settings.json (ADR-0055) ----
  const settingsPath = path.join(REPO_ROOT, '.claude', 'settings.json');
  const settings = readJsonStrict(settingsPath, '.claude/settings.json');
  const alreadyHooked = settings.hooks && typeof settings.hooks === 'object' && Object.keys(settings.hooks).length > 0;
  let settingsContent = null;
  if (!alreadyHooked) {
    settings.hooks = hooksBlock();
    settingsContent = JSON.stringify(settings, null, 2) + '\n';
  }

  // ---- 0. materialize the PM tree from the manifest (folders + seed files) ----
  // Ordering (AC-1): write .claude-pm-config.json to disk FIRST so loadPaths reads the
  // freshly-pinned layout and any per-key paths overrides in pm-paths.json are honoured.
  // In --dry-run mode we skip the disk write and build layoutMap from in-memory cfg instead.
  if (!MANIFEST || !Array.isArray(MANIFEST.folders) || !Array.isArray(MANIFEST.seedFiles)) {
    console.error('✗ lib/pm-manifest.json missing or malformed (need `folders` + `seedFiles` arrays). Cannot materialize the PM tree.');
    process.exit(1);
  }

  let layoutMap;
  if (!args.dryRun) {
    // Write .claude-pm-config.json now so loadPaths sees the pinned layout (AC-1 ordering).
    writeIfChanged(cfgPath, cfgContent);
    // loadPaths reads both pm-paths.json (per-role overrides) and .claude-pm-config.json
    // (layout pin); together they honour any custom paths in 90-Standards/pm-paths.json.
    layoutMap = loadPaths(PM_ROOT).map;
  } else {
    // Dry-run: config not on disk yet — build the map from in-memory cfg so the dry-run
    // summary reflects what a real run would produce.
    layoutMap = { ...layoutPreset, ...(cfg.paths && typeof cfg.paths === 'object' && !Array.isArray(cfg.paths) ? cfg.paths : {}) };
  }

  // Folder/seed paths are authored in canonical 'full' numbering and remapped onto the
  // target layout; a per-key `paths` override already pinned in cfg layers on top.

  // Folders: create each declared dir (so no work-dir is ever lost to git's empty-dir
  // behaviour). mkdir -p semantics; absent only → counts as a change. A folder that resolves
  // outside the target (a `..` in the manifest) is a kit-authoring bug → fatal.
  let foldersCreated = 0;
  for (const folderRel of MANIFEST.folders) {
    const abs = path.join(REPO_ROOT, remapPmRepoPath(folderRel, layoutMap));
    if (!isInside(REPO_ROOT, abs)) {
      console.error(`✗ manifest folder escapes the target: "${folderRel}" → ${abs}. Refusing to create outside ${REPO_ROOT}.`);
      process.exit(1);
    }
    if (!fs.existsSync(abs)) {
      if (!args.dryRun) fs.mkdirSync(abs, { recursive: true });
      foldersCreated++;
    }
  }
  if (foldersCreated) changes.push(`PM tree → created ${foldersCreated} folder(s)`);

  // Seed files: kit-owned are always (over)written (idempotent — skipped when byte-identical);
  // user-owned are written ONLY when absent, so an operator's edits survive a re-install. This
  // ownership rule is the safety primitive `update` (STORY-16.4.03) builds on — do not soften it.
  let kitWrote = 0, userSeeded = 0, userPreserved = 0;
  const seenDests = new Map();   // destAbs → src, to catch two seeds colliding on one file
  for (const s of MANIFEST.seedFiles) {
    // Malformed entry or missing source = kit packaging bug, not operator variability → fatal
    // (mirrors the manifest-shape guard above; a silent skip would let a promised seed vanish
    // behind an exit-0 "done"). dest-collision is likewise fatal.
    if (!s || !s.src || !s.dest || !['kit', 'user'].includes(s.ownership)) {
      console.error(`✗ malformed seedFiles entry in pm-manifest.json: ${JSON.stringify(s)}`);
      process.exit(1);
    }
    const srcAbs = path.join(KIT_PM_ROOT, s.src);
    const destAbs = path.join(PM_ROOT, remapPmSubPath(s.dest, layoutMap));
    if (!isInside(REPO_ROOT, destAbs)) {
      console.error(`✗ seed dest escapes the target: "${s.dest}" → ${destAbs}. Refusing to write outside ${REPO_ROOT}.`);
      process.exit(1);
    }
    if (seenDests.has(destAbs)) {
      console.error(`✗ two seedFiles resolve to the same dest (${destAbs}): "${seenDests.get(destAbs)}" and "${s.src}". Fix the manifest.`);
      process.exit(1);
    }
    seenDests.set(destAbs, s.src);
    if (!fs.existsSync(srcAbs)) {
      console.error(`✗ seed source missing: ${s.src} (expected at ${srcAbs}). This is a kit packaging bug — the manifest promises a file the kit doesn't ship.`);
      process.exit(1);
    }
    // Self-install (no --target inside the kit repo): src === dest. Skip explicitly so the
    // intent is legible and immune to a refactor reordering the byte-equality check below —
    // copyFileSync(x, x) is not a guaranteed-safe no-op across platforms.
    if (path.resolve(srcAbs) === path.resolve(destAbs)) continue;
    const present = fs.existsSync(destAbs);
    if (s.ownership === 'user') {
      if (present) { userPreserved++; continue; }      // write-if-absent — never clobber user work
      if (!args.dryRun) { fs.mkdirSync(path.dirname(destAbs), { recursive: true }); fs.copyFileSync(srcAbs, destAbs); }
      userSeeded++;
      continue;
    }
    // kit-owned: (over)write, but stay idempotent — skip when the target already matches.
    if (present) {
      try { if (fs.readFileSync(destAbs).equals(fs.readFileSync(srcAbs))) continue; } catch (_e) { /* fall through to write */ }
    }
    if (!args.dryRun) { fs.mkdirSync(path.dirname(destAbs), { recursive: true }); fs.copyFileSync(srcAbs, destAbs); }
    kitWrote++;
  }
  if (kitWrote) changes.push(`seed files → wrote ${kitWrote} kit-owned`);
  if (userSeeded) changes.push(`seed files → seeded ${userSeeded} user-owned (new)`);
  if (userPreserved) skipped.push(`${userPreserved} user-owned seed file(s) already present — preserved (write-if-absent)`);

  // ---- 0b. ship the kit TOOLING (93-Scripts/ tree) into the target ----
  // The retired scaffold (STORY-16.4.05 / ADR-0074) used to carry the scripts; now install
  // materializes the kit's own 93-Scripts tree so a fresh from-source/plugin install has runnable
  // pm:* scripts (the package.json entries point at 93-Scripts/<script>.js). Kit-owned wholesale:
  // recursive, idempotent (skip byte-identical). The whole loop is skipped when the kit scripts
  // root === the target scripts root (self-install in the kit repo); a per-file src===dest guard
  // adds defense-in-depth for a custom `paths.scripts` overlay. Dev-only test/fixture files are
  // excluded via shouldShipKitScript (AI-review M1) so consumers don't get the __fixtures__ tree.
  const kitScriptsRoot = path.join(KIT_PM_ROOT, '93-Scripts');
  const tgtScriptsRoot = path.join(PM_ROOT, layoutMap.scripts || '93-Scripts');
  let scriptsWrote = 0;
  if (path.resolve(kitScriptsRoot) !== path.resolve(tgtScriptsRoot)) {
    for (const srcAbs of walkFiles(kitScriptsRoot)) {
      const rel = path.relative(kitScriptsRoot, srcAbs);
      if (!shouldShipKitScript(rel)) continue;
      const destAbs = path.join(tgtScriptsRoot, rel);
      if (path.resolve(srcAbs) === path.resolve(destAbs)) continue;   // never copy a file onto itself
      if (!isInside(REPO_ROOT, destAbs)) continue;
      if (fs.existsSync(destAbs)) { try { if (fs.readFileSync(destAbs).equals(fs.readFileSync(srcAbs))) continue; } catch (_e) { /* write */ } }
      if (!args.dryRun) { fs.mkdirSync(path.dirname(destAbs), { recursive: true }); fs.copyFileSync(srcAbs, destAbs); }
      scriptsWrote++;
    }
  }
  if (scriptsWrote) changes.push(`tooling → wrote ${scriptsWrote} script file(s) into 93-Scripts/`);

  // ---- apply (or dry-run) ----
  console.log(`pm:install — wiring ${path.basename(REPO_ROOT)} (layout: ${layout})\n`);

  // .claude-pm-config.json was already written early (before loadPaths, for AC-1 ordering).
  // The remaining plan writes package.json, pm-paths.json, and settings.json.
  const pathsCfgPath = path.join(PM_ROOT, '90-Standards', 'pm-paths.json');
  const pathsContent = JSON.stringify({ layout, paths: { ...layoutPreset } }, null, 2) + '\n';

  const plan = [
    { path: pkgPath, content: pkgContent, label: added.length ? `package.json → added scripts: ${added.join(', ')}` : null },
    { path: cfgPath, content: cfgContent, label: layout !== priorLayout ? `.claude-pm-config.json → layout: "${layout}"` : null },
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
    console.log(`  • would generate dashboard → ${path.relative(REPO_ROOT, path.join(PM_ROOT, '42-Monitor', 'DASHBOARD.html'))}`);
    console.log('\n(dry-run — no files written)');
    process.exit(0);
  }

  for (const step of plan) {
    if (writeIfChanged(step.path, step.content)) changes.push(step.label || path.relative(REPO_ROOT, step.path));
  }
  if (changes.length) for (const c of changes) console.log(`  • ${c}`);
  else console.log('  Nothing to do — already wired. ✓');
  for (const s of skipped) console.log(`  · ${s}`);

  // ---- 4. generate HTML (dashboard + docs) — the Command Center opens with working links ----
  // Runs LAST, after seed files + .claude-pm-config.json are in place, so the dashboard header
  // resolves the TARGET project's name (consuming D.project, STORY-15.2.04) and bundled links
  // resolve. The dashboard is mandatory (a failure fails the install); docs render only when a
  // documentation/ source exists — a brand-new project has none, so it's skipped gracefully.
  const dashOut = path.join(PM_ROOT, '42-Monitor', 'DASHBOARD.html');
  try {
    // Setting PM_DASH_ROOT also flips the generator's EXTERNAL_ROOT on, so the install-time
    // dashboard is intentionally AI-catalogue-blind (no ~/.claude scan, no machine-absolute
    // paths) — correct for a just-installed project; the operator's later `pm:dash` (run from
    // the project, no PM_DASH_ROOT) renders the live catalogue. Conscious choice, not a leak.
    execFileSync(process.execPath, [path.join(__dirname, 'generate-dashboard.js')], {
      env: { ...process.env, PM_DASH_ROOT: PM_ROOT },
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    console.log(`  • dashboard → ${path.relative(REPO_ROOT, dashOut)}`);
  } catch (e) {
    console.error(`✗ pm:install: dashboard generation failed: ${e.message}`);
    process.exit(1);
  }
  const docsSrc = path.join(REPO_ROOT, 'documentation');
  if (fs.existsSync(docsSrc) && fs.statSync(docsSrc).isDirectory()) {
    try {
      execFileSync(process.execPath, [path.join(__dirname, 'generate-docs.js')], {
        env: { ...process.env, DOC_ROOT: docsSrc },
        stdio: ['ignore', 'ignore', 'inherit'],
      });
      console.log('  • docs → documentation/*.html');
    } catch (e) {
      // Docs are best-effort — a render failure must not fail the whole install.
      console.error(`  · docs generation skipped (non-fatal): ${e.message}`);
    }
  }

  console.log(`\n✓ pm:install done — dashboard at ${dashOut}`);
  console.log('Next: npm run pm:doctor');
  process.exit(0);
}

main();
