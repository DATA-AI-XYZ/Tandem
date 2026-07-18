#!/usr/bin/env node
/**
 * release-tandem-failpath.test.js — behavioural test for readCanonicalVersion()'s fail-loud path
 * (STORY-21.1.04 / BACKLOG-0081).
 *
 * TESTPLAN-20.1.01 AC-4 promises "a missing/garbled canonical version fails the build loudly", but
 * its TC-03 only greps the source for the ABSENCE of a hard-coded '1.0.0' default — the actual error
 * branch inside readCanonicalVersion() was never behaviourally exercised. A future refactor that
 * broke the fail-loud contract could still pass that testplan green (peer-review major finding).
 *
 * This stages real fixture dirs under os.tmpdir() and drives readCanonicalVersion() through its
 * opts.manifestPath test seam (mirrors checkVersionParity's opts.manifestPath in
 * validate-frontmatter.js). Each call runs in a CHILD `node` process (spawnSync, no shell — argv
 * array, so Windows paths need no quoting) because readCanonicalVersion()'s failure path calls
 * fail(), which does process.exit(1); running it in-process would kill this test runner before it
 * could check the second fixture.
 *
 * Modes:
 *   node release-tandem-failpath.test.js               — negative-path mode (TESTPLAN-21.1.04 TC-02)
 *   node release-tandem-failpath.test.js --happy-path   — positive-path mode (TESTPLAN-21.1.04 TC-04)
 *
 * Exit 0 = pass, non-zero = fail. Dependency-free (Node stdlib only). Cleans up its temp dirs.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// tests/ -> 93-Scripts -> _00-Project-Management -> repo root.
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const RELEASE_TANDEM = path.join(REPO_ROOT, 'scripts', 'release-tandem.js');

let failures = 0;
function check(name, cond) {
  if (cond) { console.log('  ok  - ' + name); }
  else { console.log('  FAIL- ' + name); failures += 1; }
}

function tmpFixtureDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  return dir;
}

function writePluginJson(fixtureDir, contents) {
  const pjPath = path.join(fixtureDir, '.claude-plugin', 'plugin.json');
  fs.writeFileSync(pjPath, JSON.stringify(contents, null, 2));
  return pjPath;
}

// Runs readCanonicalVersion({ manifestPath }) in a child process via the module's exported seam.
// No shell involved (argv array to spawnSync) so a Windows path with backslashes needs no escaping.
function runReadCanonicalVersion(manifestPath) {
  const script = [
    'const rt = require(' + JSON.stringify(RELEASE_TANDEM) + ');',
    'const v = rt.readCanonicalVersion({ manifestPath: ' + JSON.stringify(manifestPath) + ' });',
    'process.stdout.write(String(v));',
  ].join('\n');
  return spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
}

// Either loud phrase is an acceptable fail-loud message (readCanonicalVersion has two failure
// branches: a read/parse error, or a missing/non-semver value) — see STORY-21.1.04 AC-2.
const LOUD_PHRASES = [/missing or not semver-shaped/, /cannot read canonical version/];
function matchesLoudMessage(stderr) {
  return LOUD_PHRASES.some((re) => re.test(stderr || ''));
}

function runNegativePath() {
  const fixtures = [];
  try {
    // Variant A: version key present but an empty string.
    const emptyDir = tmpFixtureDir('release-tandem-failpath-empty-');
    fixtures.push(emptyDir);
    const emptyPjPath = writePluginJson(emptyDir, { name: 'fixture', version: '' });
    const emptyResult = runReadCanonicalVersion(emptyPjPath);
    check('empty-version fixture (version: "") exits non-zero', emptyResult.status !== 0);
    check('empty-version fixture stderr carries the loud fail-loud message', matchesLoudMessage(emptyResult.stderr));

    // Variant B: version key missing entirely.
    const missingDir = tmpFixtureDir('release-tandem-failpath-missing-');
    fixtures.push(missingDir);
    const missingPjPath = writePluginJson(missingDir, { name: 'fixture' });
    const missingResult = runReadCanonicalVersion(missingPjPath);
    check('missing-field fixture exits non-zero', missingResult.status !== 0);
    check('missing-field fixture stderr carries the loud fail-loud message', matchesLoudMessage(missingResult.stderr));
  } finally {
    for (const dir of fixtures) fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runHappyPath() {
  const dir = tmpFixtureDir('release-tandem-failpath-happy-');
  try {
    const pjPath = writePluginJson(dir, { name: 'fixture', version: '4.5.6' });
    const result = runReadCanonicalVersion(pjPath);
    check('valid fixture exits 0', result.status === 0);
    check('valid fixture stamps/returns its own semver (not a stale default)', (result.stdout || '').trim() === '4.5.6');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const happyPath = process.argv.includes('--happy-path');
if (happyPath) runHappyPath();
else runNegativePath();

if (failures === 0) {
  console.log('\n✓ release-tandem-failpath — all checks passed' + (happyPath ? ' (happy-path mode).' : '.'));
  process.exit(0);
}
console.log('\n✗ release-tandem-failpath — ' + failures + ' check(s) failed' + (happyPath ? ' (happy-path mode).' : '.'));
process.exit(1);
