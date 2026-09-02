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
const { loadPaths, dashboardOutPath } = require('./lib/pm-paths');
const { remapPmSubPath, walkFiles, readJson } = require('./lib/pm-materialize');
const { shouldShipKitScript } = require('./lib/ship-filter');
const { legacyCommands } = require('./lib/pm-scripts');

// Kit-side roots + shipped metadata (travel with the scripts; see install.js).
const KIT_PM_ROOT = path.resolve(__dirname, '..');
const MANIFEST = readJson(path.join(__dirname, 'lib', 'pm-manifest.json'));
const KIT_VERSION = (MANIFEST && MANIFEST.kitVersion) || null;

// The install contract, restated on the refresh path (ADR-0226 / STORY-32.2.02, layered on
// this script's ADR-0073 non-destructive guarantee): board builds run only in the Tandem kit
// repo; pm:update refreshes kit-owned content — which will include the PREBUILT board runtime
// once the Command Center rewrite ships it — and regenerates the board with zero consumer-side
// build steps. Operator artefacts stay byte-identical (STORY-16.4.03), and nothing here ever
// asks a consumer for npm, a bundler, or a compile.
const UPDATE_CONTRACT_LINE =
  '  · install contract (ADR-0226): board builds run in the Tandem kit repo only — pm:update ' +
  'refreshes kit-owned files and regenerates the board with zero consumer-side build steps ' +
  '(prebuilt kit-shipped runtime: 93-Scripts/assets/board-runtime.js + lib/board-assemble.js, ' +
  'inlined with locally-produced data by 93-Scripts/build-board.js — no bundler, no npm, no node_modules)';

// pm:update does NOT write package.json. The pm:* script entries are the host's file, and
// ADR-0073's guarantee is that a refresh touches kit-owned content only — so when this run finds
// a `pm:dash` still pointing at the pre-port generator it SAYS SO and stops there. Silence would
// be the worse outcome of the two available: the refreshed board would be replaced by the
// pre-port one the next time the operator ran their own `pm:dash`, with nothing in either
// transcript to explain why. The fix is one documented, idempotent command (STORY-33.10.02).
const STALE_DASH_NOTICE =
  '  · your package.json still wires pm:dash to the pre-port generator — pm:update does not ' +
  'rewrite package.json (ADR-0073). Run `npm run pm:install` once to retarget it at ' +
  'build-board.js, or your next pm:dash will replace the board this run just refreshed.';

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
// `dryRun` is a PARAMETER, not a check the caller is trusted to make. Both loops below run
// BEFORE the `if (args.dryRun)` report branch, so a helper that wrote unconditionally made
// `pm:update --dry-run` overwrite every stale kit-owned file and then print
// "(dry-run — no files written)" (BUG-20260827-05, reproduced on a fixture). The verdict and
// the write are the same decision, so they belong in the same function.
function copyIfChangedNoMkdir(srcAbs, destAbs, dryRun) {
  if (path.resolve(srcAbs) === path.resolve(destAbs)) return false; // self-update: never copy onto self
  if (!fs.existsSync(path.dirname(destAbs))) return false;          // parent absent → would add a folder → skip
  if (fs.existsSync(destAbs)) {
    try { if (fs.readFileSync(destAbs).equals(fs.readFileSync(srcAbs))) return false; } catch (_e) { /* write */ }
  }
  if (!dryRun) fs.writeFileSync(destAbs, fs.readFileSync(srcAbs));
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
  // CONSUMER-ONLY. In the kit repo `pm:dash` is SUPPOSED to name the generator until the
  // cutover story lands (ADR-0269 §4), so the notice would be advice to break a rule — and
  // acting on it would rewrite the committed board that `board:build` reads as its input.
  const isConsumerUpdate = path.resolve(PM_ROOT) !== path.resolve(KIT_PM_ROOT);
  let staleDash = false;
  try {
    const hostPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const current = hostPkg && hostPkg.scripts && hostPkg.scripts['pm:dash'];
    staleDash = isConsumerUpdate && !!current && legacyCommands('pm:dash').includes(current);
  } catch (_e) { /* a malformed host package.json is install's problem to report, not update's */ }
  // Resolve the layout map the SAME way install.js does — via loadPaths(), which layers
  // PRESETS[layout] < 90-Standards/pm-paths.json .paths < .claude-pm-config.json .paths.
  //
  // The local `layout` binding that used to sit here is GONE, not merely unused: it was the
  // vestige of the private merge below, and leaving a dead resolution expression at the exact
  // spot two report/write divergences were born from offers the next reader a plausible wrong
  // reading — that layout resolution still happens locally. There is no ESLint config in this
  // repo, so nothing else would have flagged it.
  //
  // This file used to re-implement the merge as a plain spread over `.claude-pm-config.json`
  // ALONE, which made `90-Standards/pm-paths.json` — the file the kit ships, `install.js`
  // writes, and pm-paths.js's own header calls authoritative (ADR-0052) — structurally
  // invisible here. A consumer whose monitor role is declared there got a board written to
  // the resolved folder by the generator and REPORTED at the default one by this script:
  // BUG-20260819-01's exact symptom, on the refresh path. Caught by STORY-33.10.01's DoD
  // review and reproduced on a fixture before this line was changed.
  //
  // The spread also kept non-string override values, so `{"monitor": 42}` reached
  // `path.join(..., 42, ...)` and killed pm:update with an uncaught TypeError where pm:install
  // degraded cleanly. loadPaths ignores non-strings; monitorDir() guards the rest.
  const layoutMap = loadPaths(PM_ROOT).map;

  const changed = [];

  // 1. Refresh kit-owned SEED FILES (templates, standards, PM CLAUDE.md). User-owned are
  //    skipped entirely — the non-destructive guarantee. Parent must already exist (no mkdir).
  for (const s of MANIFEST.seedFiles) {
    if (!s || s.ownership !== 'kit' || !s.src || !s.dest) continue;
    const srcAbs = path.join(KIT_PM_ROOT, s.src);
    const destAbs = path.join(PM_ROOT, remapPmSubPath(s.dest, layoutMap));
    if (!fs.existsSync(srcAbs)) continue;
    if (copyIfChangedNoMkdir(srcAbs, destAbs, args.dryRun)) changed.push(path.relative(REPO_ROOT, destAbs));
  }

  // 2. Refresh the kit TOOLING (93-Scripts/ tree). These are kit-owned wholesale; copy each
  //    into the target only where the parent dir already exists (never restructure folders).
  const kitScriptsRoot = path.join(KIT_PM_ROOT, '93-Scripts');
  const tgtScriptsRoot = path.join(PM_ROOT, layoutMap.scripts || '93-Scripts');
  for (const srcAbs of walkFiles(kitScriptsRoot)) {
    const rel = path.relative(kitScriptsRoot, srcAbs);
    if (!shouldShipKitScript(rel)) continue;   // never re-introduce dev test/fixture files install excluded
    const destAbs = path.join(tgtScriptsRoot, rel);
    if (copyIfChangedNoMkdir(srcAbs, destAbs, args.dryRun)) changed.push(path.relative(REPO_ROOT, destAbs));
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
    if (staleDash) console.log(STALE_DASH_NOTICE);
    console.log(UPDATE_CONTRACT_LINE);
    console.log('\n(dry-run — no files written)');
    process.exit(0);
  }
  if (changed.length) for (const c of changed) console.log(`  • refreshed ${c}`);
  else console.log('  Nothing to refresh — kit files already current. ✓');
  if (versionChanged) console.log(`  • recorded kitVersion: ${KIT_VERSION}`);

  // 4. Regenerate HTML (dashboard) against the target — but ONLY when something actually
  //    changed, so a true no-op update writes nothing at all (idempotency). Never restructures,
  //    just rewrites the generated read-view; catalogue-blind by design (see install.js step 4).
  // The board's destination is the layout's `monitor` ROLE, never a folder literal
  // (STORY-33.10.01 / CF-45), and it comes from the SHARED resolver in lib/pm-paths.js that
  // `install.js` and `generate-dashboard.js` also consume — so this report and that write are
  // genuinely two readings of one map, which is what stops pm:update telling a consumer their
  // board was refreshed at a path nothing was written to (BUG-20260819-01).
  const dashOut = dashboardOutPath(PM_ROOT, layoutMap);
  if (changed.length || versionChanged) {
    try {
      // EVERY update runs the ASSEMBLER (STORY-33.9.05 cutover; ADR-0269 §4's kit-repo
      // exception is discharged — the generator is payload-only, ADR-0277): the refreshed
      // prebuilt runtime is only delivered if something inlines a payload into it.
      execFileSync(process.execPath,
        [path.join(__dirname, 'build-board.js'), '--quiet'], {
          env: { ...process.env, PM_DASH_ROOT: PM_ROOT },
          stdio: ['ignore', 'ignore', 'inherit'],
        });
      console.log(`  • regenerated dashboard → ${path.relative(REPO_ROOT, dashOut)}`);
    } catch (e) {
      console.error(`✗ pm:update: dashboard regeneration failed: ${e.message}`);
      process.exit(1);
    }
  }

  if (staleDash) console.log(STALE_DASH_NOTICE);
  console.log(UPDATE_CONTRACT_LINE);
  console.log(`\n✓ pm:update done — ${changed.length} kit file(s) refreshed at kit ${KIT_VERSION || '(unknown)'}.`);
  process.exit(0);
}

main();
