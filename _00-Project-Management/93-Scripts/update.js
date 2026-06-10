#!/usr/bin/env node
/**
 * update.js — non-destructive kit refresh (pm:update).
 *
 * Pulls kit improvements into an already-installed project WITHOUT touching the
 * operator's work. It refreshes ONLY kit-owned content to the installed kit version,
 * regenerates the HTML, records the applied `kitVersion`, and prints a summary.
 *
 * The non-destructive contract (STORY-16.4.03, ADR-0073) — load-bearing:
 *   - `ownership:user` seed files (PROJECT-CONTEXT.md, MONITOR.md, ACTIVE.md) and every
 *     user work-folder are NEVER written — they stay byte-identical.
 *   - The FOLDER SET is never changed: update writes kit files only into directories that
 *     already exist; it never creates, removes, or moves a folder. (A structural change to
 *     the script tree comes from re-installing the plugin, not from update.)
 *   - Kit-owned content refreshed: the manifest's `ownership:kit` seed files (templates,
 *     standards, the PM-folder CLAUDE.md) + the kit's `93-Scripts/` tooling files whose
 *     target parent dir already exists.
 *
 * Usage: node _00-Project-Management/93-Scripts/update.js   (npm run pm:update)
 *        --target <dir> | --root <dir>   update a different project root
 *        --dry-run                        print what would change, write nothing
 * Exit codes: 0 = done (or dry-run) · 1 = no install to update (no package.json/config) · 2 = bad args.
 * Dependency-free — Node stdlib only.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { PRESETS } = require('./lib/pm-paths');
const { remapPmSubPath, walkFiles, readJson } = require('./lib/pm-materialize');
const { shouldShipKitScript } = require('./lib/ship-filter');

// Kit-side roots + shipped metadata (travel with the scripts; see install.js).
const KIT_PM_ROOT = path.resolve(__dirname, '..');
const MANIFEST = readJson(path.join(__dirname, 'lib', 'pm-manifest.json'));
const KIT_VERSION = (MANIFEST && MANIFEST.kitVersion) || null;

function parseArgs() {
  const argv = process.argv.slice(2);
  const out = { root: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target' || a === '--root') {
      out.root = argv[++i];
      if (!out.root || out.root.startsWith('--')) { console.error(`✗ ${a} requires a path`); process.exit(2); }
    } else if (a === '--dry-run') { out.dryRun = true; }
    else { console.error(`✗ unknown arg: ${a}`); process.exit(2); }
  }
  return out;
}

// Copy src→dest only when content differs (idempotent). Returns true if it wrote. NEVER
// creates the parent dir — callers pre-check that the parent exists, so update can never
// introduce a new folder (the folder-set-invariant of the non-destructive contract).
function copyIfChangedNoMkdir(srcAbs, destAbs) {
  if (path.resolve(srcAbs) === path.resolve(destAbs)) return false; // self-update: never copy onto self
  if (!fs.existsSync(path.dirname(destAbs))) return false;          // parent absent → would add a folder → skip
  if (fs.existsSync(destAbs)) {
    try { if (fs.readFileSync(destAbs).equals(fs.readFileSync(srcAbs))) return false; } catch (_e) { /* write */ }
  }
  fs.writeFileSync(destAbs, fs.readFileSync(srcAbs));
  return true;
}

function main() {
  const args = parseArgs();
  const REPO_ROOT = args.root ? path.resolve(args.root) : path.resolve(__dirname, '..', '..');
  const PM_ROOT = path.join(REPO_ROOT, '_00-Project-Management');

  // Must be an already-installed project — refuse otherwise (this is update, not install).
  const pkgPath = path.join(REPO_ROOT, 'package.json');
  const cfgPath = path.join(REPO_ROOT, '.claude-pm-config.json');
  if (!fs.existsSync(pkgPath) || !fs.existsSync(PM_ROOT)) {
    console.error(`✗ No installed PM kit at ${REPO_ROOT} (need package.json + _00-Project-Management/). Run pm:install first.`);
    process.exit(1);
  }
  if (!MANIFEST || !Array.isArray(MANIFEST.seedFiles)) {
    console.error('✗ lib/pm-manifest.json missing or malformed — cannot determine the kit-owned set.');
    process.exit(1);
  }

  const cfg = readJson(cfgPath) || {};
  const layout = (cfg.layout && PRESETS[cfg.layout]) ? cfg.layout : 'full';
  const layoutMap = { ...PRESETS[layout], ...(cfg.paths && typeof cfg.paths === 'object' && !Array.isArray(cfg.paths) ? cfg.paths : {}) };

  const changed = [];

  // 1. Refresh kit-owned SEED FILES (templates, standards, PM CLAUDE.md). User-owned are
  //    skipped entirely — the non-destructive guarantee. Parent must already exist (no mkdir).
  for (const s of MANIFEST.seedFiles) {
    if (!s || s.ownership !== 'kit' || !s.src || !s.dest) continue;
    const srcAbs = path.join(KIT_PM_ROOT, s.src);
    const destAbs = path.join(PM_ROOT, remapPmSubPath(s.dest, layoutMap));
    if (!fs.existsSync(srcAbs)) continue;
    if (copyIfChangedNoMkdir(srcAbs, destAbs)) changed.push(path.relative(REPO_ROOT, destAbs));
  }

  // 2. Refresh the kit TOOLING (93-Scripts/ tree). These are kit-owned wholesale; copy each
  //    into the target only where the parent dir already exists (never restructure folders).
  const kitScriptsRoot = path.join(KIT_PM_ROOT, '93-Scripts');
  const tgtScriptsRoot = path.join(PM_ROOT, layoutMap.scripts || '93-Scripts');
  for (const srcAbs of walkFiles(kitScriptsRoot)) {
    const rel = path.relative(kitScriptsRoot, srcAbs);
    if (!shouldShipKitScript(rel)) continue;   // never re-introduce dev test/fixture files install excluded
    const destAbs = path.join(tgtScriptsRoot, rel);
    if (copyIfChangedNoMkdir(srcAbs, destAbs)) changed.push(path.relative(REPO_ROOT, destAbs));
  }

  // 3. Record the applied kit version (AC-4) — write before regenerating so the dashboard
  //    header/version reflects the new state. Pure metadata write to a kit-managed field.
  // `cfg.kitVersion !== KIT_VERSION` already covers the absent-key case (undefined !== string).
  let versionChanged = false;
  if (KIT_VERSION && cfg.kitVersion !== KIT_VERSION) { cfg.kitVersion = KIT_VERSION; versionChanged = true; }
  if (versionChanged && !args.dryRun) fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');

  // --- report (dry-run stops here) ---
  console.log(`pm:update — refreshing ${path.basename(REPO_ROOT)} → kit ${KIT_VERSION || '(unknown)'}\n`);
  if (args.dryRun) {
    if (changed.length) for (const c of changed) console.log(`  • would refresh ${c}`);
    else console.log('  Nothing to refresh — kit files already current. ✓');
    if (versionChanged) console.log(`  • would record kitVersion: ${KIT_VERSION}`);
    console.log('\n(dry-run — no files written)');
    process.exit(0);
  }
  if (changed.length) for (const c of changed) console.log(`  • refreshed ${c}`);
  else console.log('  Nothing to refresh — kit files already current. ✓');
  if (versionChanged) console.log(`  • recorded kitVersion: ${KIT_VERSION}`);

  // 4. Regenerate HTML (dashboard) against the target — but ONLY when something actually
  //    changed, so a true no-op update writes nothing at all (idempotency). Never restructures,
  //    just rewrites the generated read-view; catalogue-blind by design (see install.js step 4).
  const dashOut = path.join(PM_ROOT, '42-Monitor', 'DASHBOARD.html');
  if (changed.length || versionChanged) {
    try {
      execFileSync(process.execPath, [path.join(__dirname, 'generate-dashboard.js')], {
        env: { ...process.env, PM_DASH_ROOT: PM_ROOT },
        stdio: ['ignore', 'ignore', 'inherit'],
      });
      console.log(`  • regenerated dashboard → ${path.relative(REPO_ROOT, dashOut)}`);
    } catch (e) {
      console.error(`✗ pm:update: dashboard regeneration failed: ${e.message}`);
      process.exit(1);
    }
  }

  console.log(`\n✓ pm:update done — ${changed.length} kit file(s) refreshed at kit ${KIT_VERSION || '(unknown)'}.`);
  process.exit(0);
}

main();
