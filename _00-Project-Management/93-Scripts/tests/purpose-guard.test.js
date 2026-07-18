#!/usr/bin/env node
/**
 * purpose-guard.test.js — behavioural test for purpose-guard.js (STORY-21.4.04 /
 * TESTPLAN-21.4.04).
 *
 * Runs the REAL purpose-guard.js as a CHILD process (spawnSync — true black-box, not a
 * require() of internals) against a throwaway fixture tree (`--root`) and a throwaway
 * copy of the reference doc (`--doc`), so no test run ever touches the real
 * `documentation/what-each-thing-is-for.md`. The fixture tree only ever creates
 * `_00-Project-Management/93-Scripts/` — no `skills/`, `90-Standards/`, etc. — so the
 * only section under test ("## Scripts") is meaningfully populated; other sections
 * naturally scan to empty lists and add no noise.
 *
 * Modes (mirrors the TESTPLAN's three TCs):
 *   --stub-emission   TC-01 — add a fixture script, run --write-stubs, assert its stub
 *                      row appears; run --write-stubs again, assert no duplicate.
 *   --warn-tier        TC-02 — with an unfilled stub already in the fixture doc, assert
 *                      --check prints the "[W-purpose]" warning and exits 0.
 *   --full-loop        TC-03 — add -> stub -> warn, then fill the stub line, assert the
 *                      warn for that item no longer fires.
 * With no flag, runs all three. Exit 0 = all pass, non-zero = fail. Dependency-free
 * (Node stdlib only). Cleans up its temp dirs in a finally block on every mode.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPTS_ROOT = path.resolve(__dirname, '..');
const GUARD = path.join(SCRIPTS_ROOT, 'purpose-guard.js');
const STUB_MARKER = 'TODO: one-line purpose (auto-stub; fill me)';

let failures = 0;
function check(name, cond) {
  if (cond) { console.log('  ok  - ' + name); }
  else { console.log('  FAIL- ' + name); failures += 1; }
}

function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }

// A minimal fixture root: only `_00-Project-Management/93-Scripts/` exists, so every
// OTHER section (pm-folders picks up "93-Scripts" itself, but top-level-dirs/standards/
// templates/prompts/skills all scan to empty lists) stays quiet.
function buildFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-purpose-guard-root-'));
  mkdirp(path.join(root, '_00-Project-Management', '93-Scripts'));
  return root;
}

function writeFixtureScript(root, name) {
  fs.writeFileSync(path.join(root, '_00-Project-Management', '93-Scripts', name), '// fixture\n');
}

function runGuard(args) {
  return spawnSync(process.execPath, [GUARD, ...args], { encoding: 'utf8' });
}

// ---------- TC-01 · stub emission + idempotency ----------

function testStubEmission() {
  console.log('-- --stub-emission (TC-01) --');
  const root = buildFixtureRoot();
  const docPath = path.join(root, 'fixture-what-each-thing-is-for.md');
  try {
    writeFixtureScript(root, 'existing-script.js');
    writeFixtureScript(root, 'fixture-script.js');
    fs.writeFileSync(docPath,
      '# What each thing is for\n' +
      '\n' +
      '## Scripts\n' +
      '\n' +
      '- **existing-script.js** — already documented, should be left alone.\n');

    const r1 = runGuard(['--root', root, '--doc', docPath, '--write-stubs']);
    check('first --write-stubs exits 0', r1.status === 0);
    check('first run reports the fixture script as added', /fixture-script\.js/.test(r1.stdout || ''));

    const afterFirst = fs.readFileSync(docPath, 'utf8');
    check('doc now contains a TODO stub row for fixture-script.js',
      afterFirst.includes('- `fixture-script.js` — ' + STUB_MARKER));
    check('the pre-existing hand-written row is untouched',
      afterFirst.includes('- **existing-script.js** — already documented, should be left alone.'));
    check('existing-script.js was not re-stubbed (still exactly one mention)',
      (afterFirst.match(/existing-script\.js/g) || []).length === 1);

    const r2 = runGuard(['--root', root, '--doc', docPath, '--write-stubs']);
    check('second --write-stubs exits 0', r2.status === 0);
    check('second run reports nothing to add (idempotent)', /nothing to add/.test(r2.stdout || ''));

    const afterSecond = fs.readFileSync(docPath, 'utf8');
    check('doc content is byte-identical after the second run (no duplicate stub)', afterSecond === afterFirst);
    check('fixture-script.js still appears exactly once', (afterSecond.match(/fixture-script\.js/g) || []).length === 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// ---------- TC-02 · warn is non-fatal ----------

function testWarnTier() {
  console.log('-- --warn-tier (TC-02) --');
  const root = buildFixtureRoot();
  const docPath = path.join(root, 'fixture-what-each-thing-is-for.md');
  try {
    writeFixtureScript(root, 'stub-item.js');
    fs.writeFileSync(docPath,
      '# What each thing is for\n' +
      '\n' +
      '## Scripts\n' +
      '\n' +
      '- `stub-item.js` — ' + STUB_MARKER + '\n');

    const r = runGuard(['--root', root, '--doc', docPath, '--check']);
    check('--check exits 0 even with an unfilled stub present', r.status === 0);
    check('warning carries the "[W-purpose]" prefix', /\[W-purpose\]/.test(r.stdout || ''));
    check('warning names the unfilled stub item', /stub-item\.js/.test(r.stdout || ''));
    check('warning text calls out the unfilled stub specifically', /unfilled stub for/.test(r.stdout || ''));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// ---------- TC-03 · full loop clears the warn ----------

function testFullLoop() {
  console.log('-- --full-loop (TC-03) --');
  const root = buildFixtureRoot();
  const docPath = path.join(root, 'fixture-what-each-thing-is-for.md');
  try {
    writeFixtureScript(root, 'loop-item.js');
    fs.writeFileSync(docPath,
      '# What each thing is for\n' +
      '\n' +
      '## Scripts\n' +
      '\n' +
      '- **existing-script.js** — already documented, should be left alone.\n');

    // add -> stub
    const stubResult = runGuard(['--root', root, '--doc', docPath, '--write-stubs']);
    check('write-stubs (add) exits 0', stubResult.status === 0);
    const afterStub = fs.readFileSync(docPath, 'utf8');
    check('loop-item.js got a TODO stub row', afterStub.includes('- `loop-item.js` — ' + STUB_MARKER));

    // stub -> warn
    const warnResult = runGuard(['--root', root, '--doc', docPath, '--check']);
    check('check (warn) exits 0', warnResult.status === 0);
    check('warn fires for loop-item.js while unfilled', /\[W-purpose\][^\n]*loop-item\.js/.test(warnResult.stdout || ''));

    // fill the line
    const filled = afterStub.replace(
      '- `loop-item.js` — ' + STUB_MARKER,
      '- `loop-item.js` — walks the fixture loop end to end.'
    );
    check('fill step actually replaced the stub text (sanity)', filled !== afterStub && !filled.includes(STUB_MARKER));
    fs.writeFileSync(docPath, filled);

    // warn clears
    const clearResult = runGuard(['--root', root, '--doc', docPath, '--check']);
    check('check (post-fill) exits 0', clearResult.status === 0);
    check('the loop-item.js warn no longer fires', !new RegExp('\\[W-purpose\\][^\\n]*loop-item\\.js').test(clearResult.stdout || ''));
    // Note: the trailing summary line always reads "N unfilled stub(s)" (even N=0), so
    // assert on the specific PER-ITEM phrasing ("unfilled stub for"), not the substring
    // "unfilled stub" alone — that would false-positive against "0 unfilled stub(s)".
    check('no per-item unfilled-stub warning remains', !/unfilled stub for/.test(clearResult.stdout || ''));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function main() {
  const args = process.argv.slice(2);
  const runAll = args.length === 0;

  if (runAll || args.includes('--stub-emission')) testStubEmission();
  if (runAll || args.includes('--warn-tier')) testWarnTier();
  if (runAll || args.includes('--full-loop')) testFullLoop();

  if (failures === 0) {
    console.log('\n✓ purpose-guard — all checks passed.');
    process.exit(0);
  }
  console.log('\n✗ purpose-guard — ' + failures + ' check(s) failed.');
  process.exit(1);
}

main();
