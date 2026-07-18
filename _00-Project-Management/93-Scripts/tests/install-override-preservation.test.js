#!/usr/bin/env node
/**
 * install-override-preservation.test.js — behavioural test for install.js preserving
 * pre-existing 90-Standards/pm-paths.json per-key overrides when it rewrites the file
 * (STORY-21.1.02 / BACKLOG-0079 tranche B).
 *
 * Before the fix, install.js always emitted `pathsContent` as `{ layout, paths: {...layoutPreset} }`
 * — the BARE preset — discarding any pre-existing per-key `paths` overrides in the on-disk
 * pm-paths.json, even though the SAME run used the layered (overrides-honouring) layoutMap to
 * actually materialize the folders/seed files. That "read-old / write-preset" drift meant a
 * later `update`/`doctor`/`pm:lint` (which re-reads pm-paths.json) would resolve DIFFERENT
 * folders than install had just materialized. The fix folds `layoutMap` (the map that actually
 * walked the manifest) into `pathsContent` instead of the bare preset.
 *
 * This stages a temp target dir with a hand-authored custom pm-paths.json overlay (2 keys
 * diverging from the 'full' preset — a fixture matching the preset would vacuously pass), runs a
 * real install.js over it, and asserts the persisted pm-paths.json still declares BOTH
 * overrides (plus every other logical key, preset-completed). It then re-installs (idempotent
 * re-run) and re-asserts, so a fix that only "worked" on the very first materialization pass
 * would still be caught.
 *
 * Spawns install.js as a CHILD process (spawnSync) — a true black-box integration check.
 *
 * Exit 0 = pass, non-zero = fail. Dependency-free (Node stdlib only). Cleans up its temp dir
 * even on failure (try/finally) and never writes into the live repo tree — os.tmpdir() only.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPTS_ROOT = path.resolve(__dirname, '..');
const INSTALL_JS = path.join(SCRIPTS_ROOT, 'install.js');
const { PRESETS } = require(path.join(SCRIPTS_ROOT, 'lib', 'pm-paths.js'));

let failures = 0;
function check(name, cond) {
  if (cond) { console.log('  ok  - ' + name); }
  else { console.log('  FAIL- ' + name); failures += 1; }
}

// Diverges from PRESETS.full on 2 keys — matches the Gotcha the story flags: a fixture that
// mirrors the preset (like the kit's own self-install pm-paths.json) would vacuously pass.
const OVERLAY_PATHS = { stories: '32-Stories-CUSTOM', bugs: '34-Bugs-CUSTOM' };

function pathsJsonFile(dir) {
  return path.join(dir, '_00-Project-Management', '90-Standards', 'pm-paths.json');
}

function readPathsJson(dir) {
  return JSON.parse(fs.readFileSync(pathsJsonFile(dir), 'utf8'));
}

function assertOverridesPreserved(dir, label) {
  const persisted = readPathsJson(dir);
  const hasPaths = persisted && typeof persisted.paths === 'object' && persisted.paths !== null;
  check(`${label}: persisted pm-paths.json has a paths object`, hasPaths);
  for (const [key, expected] of Object.entries(OVERLAY_PATHS)) {
    check(`${label}: pre-existing override "${key}" -> "${expected}" is preserved`, hasPaths && persisted.paths[key] === expected);
  }
  // An un-overridden key should still resolve to the preset default — proves this is a genuine
  // fold (preset completed + overrides layered on top), not just "whatever was on disk verbatim".
  check(`${label}: an un-overridden key ("epics") still resolves to the preset default`,
    hasPaths && persisted.paths.epics === PRESETS.full.epics);
}

function main() {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-install-override-preservation-'));
  try {
    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }, null, 2));
    const standardsDir = path.join(target, '_00-Project-Management', '90-Standards');
    fs.mkdirSync(standardsDir, { recursive: true });
    fs.writeFileSync(path.join(standardsDir, 'pm-paths.json'), JSON.stringify({ layout: 'full', paths: OVERLAY_PATHS }, null, 2));

    const first = spawnSync(process.execPath, [INSTALL_JS, '--target', target], { encoding: 'utf8' });
    check('first install (over the custom-overlay target) exits 0', first.status === 0);
    assertOverridesPreserved(target, 'after first install');

    // Materialization sanity: the custom-named folders should actually exist on disk — ties the
    // persisted-file assertion to what was really materialized, per the AC's own phrasing
    // ("the persisted file declares exactly the overrides that were materialised").
    check('materialized "stories" folder uses the custom name',
      fs.existsSync(path.join(target, '_00-Project-Management', OVERLAY_PATHS.stories)));
    check('materialized "bugs" folder uses the custom name',
      fs.existsSync(path.join(target, '_00-Project-Management', OVERLAY_PATHS.bugs)));

    // Re-install (idempotent re-run) — the fix must not be a one-shot fluke that only survives
    // the very first materialization pass.
    const second = spawnSync(process.execPath, [INSTALL_JS, '--target', target], { encoding: 'utf8' });
    check('second install (re-run over the same target) exits 0', second.status === 0);
    assertOverridesPreserved(target, 'after second install (re-run)');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }

  if (failures === 0) {
    console.log('\n✓ install-override-preservation — all checks passed.');
    process.exit(0);
  }
  console.log('\n✗ install-override-preservation — ' + failures + ' check(s) failed.');
  process.exit(1);
}

main();
