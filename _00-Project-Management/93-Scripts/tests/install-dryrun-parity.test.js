#!/usr/bin/env node
/**
 * install-dryrun-parity.test.js — behavioural test for install.js's --dry-run vs real-run
 * layout parity under a custom pm-paths.json overlay (STORY-21.1.02 / BACKLOG-0079 tranche A).
 *
 * Before the fix, the --dry-run branch rebuilt its layoutMap in memory as
 * `{ ...layoutPreset, ...cfg.paths }` and never consulted the on-disk
 * 90-Standards/pm-paths.json — so a project carrying a hand-authored custom pm-paths.json
 * overlay could see --dry-run report a DIFFERENT materialization than a real install actually
 * performs. install.js now resolves both branches via the same resolveLayoutMap()/loadPaths()
 * path (a real run reads the freshly-pinned .claude-pm-config.json off disk; dry-run stages the
 * same in-memory config into a throwaway scratch dir instead of writing the real target).
 *
 * This stages two temp target dirs, seeded IDENTICALLY with a custom pm-paths.json overlay that
 * diverges from the 'full' preset on 2 logical keys, with the CORRECT custom-named folders for
 * those keys (plus 90-Standards, needed to host the overlay file) already pre-created. An install
 * that resolves paths via the bare preset (the pre-fix dry-run bug) will look for the PRESET
 * names instead, find them missing, and misreport them as "to create" — inflating its folder
 * count. Runs `install.js --dry-run` against one target and a real `install.js` against the
 * other, then asserts the "PM tree -> created N folder(s)" decision they each report is
 * byte-identical, and that it's the CORRECT (overlay-honouring) count.
 *
 * Spawns install.js as a CHILD process (spawnSync) for both runs — a true black-box integration
 * check, not a require() of install.js's internals (which auto-runs main() + process.exit() on
 * require and would kill the test runner).
 *
 * Exit 0 = pass, non-zero = fail. Dependency-free (Node stdlib only). Cleans up its temp dirs
 * even on failure (try/finally) and never writes into the live repo tree — os.tmpdir() only.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// tests/ -> 93-Scripts -> lib/scripts root.
const SCRIPTS_ROOT = path.resolve(__dirname, '..');
const INSTALL_JS = path.join(SCRIPTS_ROOT, 'install.js');
const MANIFEST = require(path.join(SCRIPTS_ROOT, 'lib', 'pm-manifest.json'));
const { PRESETS } = require(path.join(SCRIPTS_ROOT, 'lib', 'pm-paths.js'));

let failures = 0;
function check(name, cond) {
  if (cond) { console.log('  ok  - ' + name); }
  else { console.log('  FAIL- ' + name); failures += 1; }
}

// A custom overlay that genuinely diverges from PRESETS.full on 2 keys — a fixture that
// collapses to the preset would vacuously pass (the Gotcha the story flags: the kit's own
// self-install has pm-paths.json == { layout, paths: PRESETS[layout] }).
const OVERLAY_PATHS = { stories: '32-Stories-CUSTOM', decisions: '40-Decisions-CUSTOM' };
const STANDARDS_FOLDER = PRESETS.full.standards; // '90-Standards' — never overridden here

// Stages a fresh target: package.json (required by install.js), a hand-authored custom
// pm-paths.json overlay under 90-Standards/, and the folders a CORRECTLY-resolving install
// would already consider present (90-Standards itself, plus the 2 custom-named overlay
// folders) — everything else is left missing so it's genuinely "to create".
function stageTarget(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }, null, 2));
  const pmRoot = path.join(dir, '_00-Project-Management');
  const standardsDir = path.join(pmRoot, STANDARDS_FOLDER);
  fs.mkdirSync(standardsDir, { recursive: true });
  fs.writeFileSync(path.join(standardsDir, 'pm-paths.json'), JSON.stringify({ layout: 'full', paths: OVERLAY_PATHS }, null, 2));
  for (const customName of Object.values(OVERLAY_PATHS)) {
    fs.mkdirSync(path.join(pmRoot, customName), { recursive: true });
  }
  return dir;
}

function runInstall(targetDir, extraArgs) {
  return spawnSync(process.execPath, [INSTALL_JS, '--target', targetDir, ...extraArgs], { encoding: 'utf8' });
}

// Both branches share the same `changes.push(\`PM tree -> created N folder(s)\`)` line, printed
// via the same `  * ${c}` formatting — parity means this substring is identical between the
// dry-run report and the real run's report.
function extractFolderLine(stdout) {
  const m = /PM tree[^\n]*created \d+ folder\(s\)/.exec(stdout || '');
  return m ? m[0] : null;
}

function main() {
  const dryTarget = stageTarget('pm-install-dryrun-parity-dry-');
  const realTarget = stageTarget('pm-install-dryrun-parity-real-');
  try {
    const dryResult = runInstall(dryTarget, ['--dry-run']);
    check('dry-run exits 0', dryResult.status === 0);
    check('dry-run writes nothing under the target (.claude-pm-config.json absent afterwards)',
      !fs.existsSync(path.join(dryTarget, '.claude-pm-config.json')));

    const realResult = runInstall(realTarget, []);
    check('real run exits 0', realResult.status === 0);

    const dryLine = extractFolderLine(dryResult.stdout);
    const realLine = extractFolderLine(realResult.stdout);
    check('dry-run reports a "PM tree -> created N folder(s)" decision', dryLine !== null);
    check('real run reports a "PM tree -> created N folder(s)" decision', realLine !== null);
    check('dry-run and real run report an IDENTICAL folder-count decision', dryLine !== null && dryLine === realLine);

    // Anchor: the expected count is manifest folders minus the 3 pre-seeded ones (90-Standards +
    // the 2 custom-named overlay folders) — proves the parity assertion above isn't vacuously
    // comparing two wrong-but-equal numbers. Computed from MANIFEST.folders.length, not
    // hardcoded, so a manifest change can't silently stale this out.
    const preCreatedCount = 1 + Object.keys(OVERLAY_PATHS).length;
    const expectedCount = MANIFEST.folders.length - preCreatedCount;
    const expectedLine = `PM tree → created ${expectedCount} folder(s)`;
    check(`both runs report the overlay-honouring count (${expectedCount}) — not ${MANIFEST.folders.length - 1}, the pre-fix bug's bare-preset count`,
      realLine === expectedLine && dryLine === expectedLine);

    // Sanity: the real run (whose branch was already correct pre-fix) actually used the custom
    // names, not the preset defaults — ties the fixture to what it's meant to exercise.
    check('real run used the custom "stories" folder name (not the preset default)',
      fs.existsSync(path.join(realTarget, '_00-Project-Management', OVERLAY_PATHS.stories)) &&
      !fs.existsSync(path.join(realTarget, '_00-Project-Management', PRESETS.full.stories)));
    check('real run used the custom "decisions" folder name (not the preset default)',
      fs.existsSync(path.join(realTarget, '_00-Project-Management', OVERLAY_PATHS.decisions)) &&
      !fs.existsSync(path.join(realTarget, '_00-Project-Management', PRESETS.full.decisions)));
  } finally {
    fs.rmSync(dryTarget, { recursive: true, force: true });
    fs.rmSync(realTarget, { recursive: true, force: true });
  }

  if (failures === 0) {
    console.log('\n✓ install-dryrun-parity — all checks passed.');
    process.exit(0);
  }
  console.log('\n✗ install-dryrun-parity — ' + failures + ' check(s) failed.');
  process.exit(1);
}

main();
