#!/usr/bin/env node
/**
 * install-dashboard-policy.test.js — behavioural test for the CONSUMER-only DASHBOARD.html
 * .gitignore policy (STORY-21.4.02 / ADR-0082). `install.js` writes/refreshes a managed block
 * in a CONSUMER target's root `.gitignore` ignoring the resolved monitor folder's
 * `DASHBOARD.html` — a fully-regenerable ~9 MB build output — so `git add` and a `close-phase`
 * merge can never fail on it (BACKLOG-0084). The kit's OWN repo is a deliberate exception: its
 * live dashboard stays tracked, so a self-install into the kit repo must never touch the kit's
 * own `.gitignore`.
 *
 * Covers (per TESTPLAN-21.4.02 TC-02, extended by STORY-21.2.03 AC-4 for the usage-log
 * .jsonl — ADR-0082's "Future generated artefacts" second tenant of the same managed block):
 *   (a) a fresh consumer install's .gitignore gains the DASHBOARD.html AND usage-log.jsonl entries
 *   (b) re-install adds no duplicate (marker-delimited upsert, not append-forever)
 *   (c) a custom-monitor-folder overlay resolves the DASHBOARD.html path correctly while the
 *       (unrenamed) usage-log.jsonl path stays at its default location — proves the two
 *       entries resolve independently through their own layoutMap roles
 *   (d) --dry-run reports both planned changes but writes nothing
 *   (e) the KIT repo's own .gitignore is untouched (read-only check)
 *
 * Spawns install.js as a CHILD process (spawnSync) for true black-box behaviour, mirroring
 * install-dryrun-parity.test.js's fixture technique. Exit 0 = pass, non-zero = fail.
 * Dependency-free (Node stdlib only). Cleans up its temp dirs even on failure (try/finally) and
 * never writes into the live repo tree — the kit's own .gitignore is only ever READ, never
 * written by this test.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// tests/ -> 93-Scripts -> _00-Project-Management -> repo root.
const SCRIPTS_ROOT = path.resolve(__dirname, '..');
const INSTALL_JS = path.join(SCRIPTS_ROOT, 'install.js');
const KIT_REPO_ROOT = path.resolve(SCRIPTS_ROOT, '..', '..');
const KIT_GITIGNORE = path.join(KIT_REPO_ROOT, '.gitignore');
const { PRESETS } = require(path.join(SCRIPTS_ROOT, 'lib', 'pm-paths.js'));

let failures = 0;
function check(name, cond) {
  if (cond) { console.log('  ok  - ' + name); }
  else { console.log('  FAIL- ' + name); failures += 1; }
}

// Must match the marker install.js writes (GITIGNORE_BLOCK_BEGIN in install.js) — duplicated
// here deliberately so this test asserts the on-disk CONTRACT, not an internal implementation
// detail reached via require() (install.js is a self-executing CLI script, not a module export).
const MARKER_BEGIN = '# BEGIN pm-kit managed generated-artefact ignores (ADR-0082) — do not edit by hand';

function stageTarget(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }, null, 2));
  return dir;
}

// A consumer-shaped target with a hand-authored pm-paths.json overlay renaming the 'monitor'
// role — proves the .gitignore entry is resolved through layoutMap, not hardcoded to '42-Monitor'.
function stageCustomMonitorTarget(prefix) {
  const dir = stageTarget(prefix);
  const pmRoot = path.join(dir, '_00-Project-Management');
  const standardsDir = path.join(pmRoot, PRESETS.full.standards);
  fs.mkdirSync(standardsDir, { recursive: true });
  const overlay = { monitor: '42-Monitor-CUSTOM' };
  fs.writeFileSync(path.join(standardsDir, 'pm-paths.json'), JSON.stringify({ layout: 'full', paths: overlay }, null, 2));
  return { dir, overlay };
}

function runInstall(targetDir, extraArgs) {
  return spawnSync(process.execPath, [INSTALL_JS, '--target', targetDir, ...extraArgs], { encoding: 'utf8' });
}

function readGitignore(dir) {
  const p = path.join(dir, '.gitignore');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

function countOccurrences(haystack, needle) {
  if (!haystack) return 0;
  let count = 0, idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) { count += 1; idx += needle.length; }
  return count;
}

function main() {
  // Baseline read of the KIT repo's own .gitignore BEFORE any install runs — for check (e).
  const kitGitignoreBefore = fs.existsSync(KIT_GITIGNORE) ? fs.readFileSync(KIT_GITIGNORE, 'utf8') : null;
  check('precondition: kit repo has its own .gitignore to compare against', kitGitignoreBefore !== null);

  const targetA = stageTarget('pm-install-dash-policy-a-');
  const targetDry = stageTarget('pm-install-dash-policy-dry-');
  const { dir: targetCustom, overlay } = stageCustomMonitorTarget('pm-install-dash-policy-custom-');

  try {
    // ---- (a) fresh consumer install gains the DASHBOARD.html entry ----
    const firstRun = runInstall(targetA, []);
    check('(a) fresh install exits 0', firstRun.status === 0);
    const gitignoreAfterFirst = readGitignore(targetA);
    check('(a) target .gitignore was created', gitignoreAfterFirst !== null);
    check('(a) target .gitignore carries the managed marker block', !!gitignoreAfterFirst && gitignoreAfterFirst.includes(MARKER_BEGIN));
    const expectedDefaultPath = '_00-Project-Management/' + PRESETS.full.monitor + '/DASHBOARD.html';
    check('(a) target .gitignore ignores the default-layout DASHBOARD.html path',
      !!gitignoreAfterFirst && gitignoreAfterFirst.includes(expectedDefaultPath));
    // STORY-21.2.03 AC-4: the usage-log .jsonl is the second tenant of this managed block
    // (ADR-0082 "Future generated artefacts" — same generated/derived-artefact policy as
    // the dashboard, applied to usage-capture.js's usage-log.jsonl).
    const expectedDefaultUsageLogPath = '_00-Project-Management/' + PRESETS.full.reports + '/usage/usage-log.jsonl';
    check('(a) target .gitignore ALSO ignores the default-layout usage-log.jsonl path',
      !!gitignoreAfterFirst && gitignoreAfterFirst.includes(expectedDefaultUsageLogPath));

    // ---- (b) re-install adds no duplicate ----
    const secondRun = runInstall(targetA, []);
    check('(b) re-install exits 0', secondRun.status === 0);
    const gitignoreAfterSecond = readGitignore(targetA);
    check('(b) re-install is a byte-identical no-op on .gitignore', gitignoreAfterSecond === gitignoreAfterFirst);
    check('(b) exactly one managed block marker after re-install (no duplicate)',
      countOccurrences(gitignoreAfterSecond, MARKER_BEGIN) === 1);

    // ---- (c) custom-monitor-folder overlay resolves the ignored path correctly ----
    const customRun = runInstall(targetCustom, []);
    check('(c) custom-monitor-overlay install exits 0', customRun.status === 0);
    const gitignoreCustom = readGitignore(targetCustom);
    const expectedCustomPath = '_00-Project-Management/' + overlay.monitor + '/DASHBOARD.html';
    check('(c) target .gitignore ignores the CUSTOM-layout DASHBOARD.html path',
      !!gitignoreCustom && gitignoreCustom.includes(expectedCustomPath));
    check('(c) target .gitignore does NOT ignore the default-layout path (proves it re-resolved, not hardcoded)',
      !!gitignoreCustom && !gitignoreCustom.includes(expectedDefaultPath));
    // The custom overlay only renames 'monitor', so the usage-log path (under 'reports')
    // still resolves to the default 41-Reports/usage/ location — proves the two entries are
    // resolved independently through their own layoutMap roles, not coupled to one another.
    check('(c) target .gitignore ALSO ignores the (unrenamed) default-layout usage-log.jsonl path',
      !!gitignoreCustom && gitignoreCustom.includes(expectedDefaultUsageLogPath));

    // ---- (d) --dry-run reports the planned change but writes nothing ----
    const dryRun = runInstall(targetDry, ['--dry-run']);
    check('(d) dry-run exits 0', dryRun.status === 0);
    check('(d) dry-run does NOT create a .gitignore in the target', readGitignore(targetDry) === null);
    check('(d) dry-run STDOUT reports the planned DASHBOARD.html gitignore change',
      /DASHBOARD\.html ignored/i.test(dryRun.stdout || ''));
    check('(d) dry-run STDOUT ALSO reports the planned usage-log.jsonl gitignore change',
      /usage-log\.jsonl ignored/i.test(dryRun.stdout || ''));

    // ---- (e) the KIT repo's own .gitignore is untouched (read-only check) ----
    const kitGitignoreAfter = fs.existsSync(KIT_GITIGNORE) ? fs.readFileSync(KIT_GITIGNORE, 'utf8') : null;
    check('(e) kit repo .gitignore is byte-identical after all installs above (no diff)', kitGitignoreAfter === kitGitignoreBefore);
    check('(e) kit repo .gitignore does NOT carry the managed marker block (self-install exception, ADR-0082)',
      !!kitGitignoreAfter && !kitGitignoreAfter.includes(MARKER_BEGIN));
  } finally {
    fs.rmSync(targetA, { recursive: true, force: true });
    fs.rmSync(targetDry, { recursive: true, force: true });
    fs.rmSync(targetCustom, { recursive: true, force: true });
  }

  if (failures === 0) {
    console.log('\n✓ install-dashboard-policy — all checks passed.');
    process.exit(0);
  }
  console.log('\n✗ install-dashboard-policy — ' + failures + ' check(s) failed.');
  process.exit(1);
}

main();
