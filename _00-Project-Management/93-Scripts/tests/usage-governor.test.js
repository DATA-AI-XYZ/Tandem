#!/usr/bin/env node
/**
 * usage-governor.test.js — behavioural test for usage-governor.js (STORY-21.3.04 / TC-02, TC-04).
 *
 * Runs the helper as a CHILD process (spawnSync — true black-box, not a require() of
 * internals) with fixture CLI-arg signals and asserts the returned one-line JSON decision.
 *
 * Modes:
 *   node usage-governor.test.js                 — default suite (TC-02 / AC-2):
 *     threshold crossing mid-unit -> pause-now, with finish-current-unit semantics asserted
 *     via the decision JSON's `reason`; a custom --threshold is honoured in both directions;
 *     below-threshold -> continue; a missing/invalid signal -> pause-and-ask, exit 0;
 *     --reset-at is propagated verbatim to `resume_at`.
 *   node usage-governor.test.js --affordability — TC-04 / AC-4:
 *     a projected-next that exceeds the remaining window budget -> pause-before-next (NOT
 *     pause-now); one that fits -> continue.
 *
 * Exit 0 = pass, non-zero = fail. Dependency-free (Node stdlib only).
 */

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPTS_ROOT = path.resolve(__dirname, '..');
const HELPER = path.join(SCRIPTS_ROOT, 'usage-governor.js');

let failures = 0;
function check(name, cond) {
  if (cond) { console.log('  ok  - ' + name); }
  else { console.log('  FAIL- ' + name); failures += 1; }
}

function run(args) {
  const result = spawnSync(process.execPath, [HELPER, ...args], { encoding: 'utf8' });
  let decision = null;
  try { decision = JSON.parse((result.stdout || '').trim()); } catch { /* leave null */ }
  return { status: result.status, decision, stdout: result.stdout, stderr: result.stderr };
}

const RESET_AT = '2026-07-19T02:00:00Z'; // an arbitrary future ISO timestamp used verbatim

function defaultSuite() {
  console.log('-- default suite (threshold / continue / degraded / reset propagation) --');

  // ---- threshold crossing mid-unit -> pause-now, finish-current-unit semantics in reason ----
  {
    const { status, decision } = run(['--percent-used', '95', '--reset-at', RESET_AT]);
    check('exits 0 on a threshold-crossing decision', status === 0);
    check('decision parses as JSON', decision !== null);
    if (decision) {
      check('action is "pause-now" when percent-used (95) >= default threshold (92)', decision.action === 'pause-now');
      check('reason mentions the 92% threshold', /92/.test(decision.reason || ''));
      check('reason asserts finish-current-unit semantics ("atomic unit")', /atomic unit/i.test(decision.reason || ''));
      check('reason asserts finishing before pausing ("finish")', /finish/i.test(decision.reason || ''));
      check('resume_at is --reset-at propagated verbatim (not recomputed)', decision.resume_at === RESET_AT);
    }
  }

  // ---- custom --threshold honoured: lowers the bar (85% now crosses at threshold 80) ----
  {
    const { decision } = run(['--percent-used', '85', '--reset-at', RESET_AT, '--threshold', '80']);
    check('custom --threshold=80 crosses at 85% -> pause-now', decision && decision.action === 'pause-now');
    check('reason reflects the custom threshold (80), not the default (92)', decision && /80/.test(decision.reason || ''));
  }

  // ---- custom --threshold honoured: raises the bar (85% no longer crosses at threshold 90) ----
  {
    const { decision } = run(['--percent-used', '85', '--reset-at', RESET_AT, '--threshold', '90']);
    check('custom --threshold=90 keeps 85% below threshold -> continue', decision && decision.action === 'continue');
  }

  // ---- below (default) threshold -> continue ----
  {
    const { decision } = run(['--percent-used', '50', '--reset-at', RESET_AT]);
    check('percent-used (50) below default threshold (92) -> continue', decision && decision.action === 'continue');
    check('continue carries a null resume_at (nothing scheduled)', decision && decision.resume_at === null);
  }

  // ---- missing signal -> pause-and-ask, exit 0 (degraded mode is an OUTPUT, not an error) ----
  {
    const { status, decision } = run([]);
    check('no args at all -> exit 0 (never a script error)', status === 0);
    check('no --percent-used -> action is "pause-and-ask"', decision && decision.action === 'pause-and-ask');
    check('pause-and-ask carries a null resume_at (nothing to schedule)', decision && decision.resume_at === null);
  }

  // ---- invalid (non-numeric) --percent-used -> pause-and-ask, exit 0 ----
  {
    const { status, decision } = run(['--percent-used', 'not-a-number', '--reset-at', RESET_AT]);
    check('invalid --percent-used -> exit 0', status === 0);
    check('invalid --percent-used -> action is "pause-and-ask"', decision && decision.action === 'pause-and-ask');
  }

  // ---- --percent-used given but --reset-at missing/invalid -> also degraded pause-and-ask ----
  {
    const { status, decision } = run(['--percent-used', '95']);
    check('--percent-used without a valid --reset-at -> exit 0', status === 0);
    check('--percent-used without a valid --reset-at -> action is "pause-and-ask" (not a guessed pause-now)', decision && decision.action === 'pause-and-ask');
  }
}

function affordabilitySuite() {
  console.log('-- --affordability suite (pre-flight pause-before-next vs continue) --');

  // ---- projected-next exceeds remaining window budget -> pause-before-next, NOT pause-now ----
  {
    const { status, decision } = run([
      '--percent-used', '50', '--reset-at', RESET_AT,
      '--projected-next', '50000', '--window-budget', '10000',
    ]);
    check('affordability-exceeded run exits 0', status === 0);
    check('projected-next (50000) > window-budget (10000) -> "pause-before-next"', decision && decision.action === 'pause-before-next');
    check('affordability pre-flight decision is NOT "pause-now" (percent-used is well below threshold)', decision && decision.action !== 'pause-now');
    check('reason names both figures (projected-next and window-budget)', decision && /50000/.test(decision.reason || '') && /10000/.test(decision.reason || ''));
  }

  // ---- projected-next fits within the remaining window budget -> continue ----
  {
    const { decision } = run([
      '--percent-used', '50', '--reset-at', RESET_AT,
      '--projected-next', '5000', '--window-budget', '10000',
    ]);
    check('projected-next (5000) <= window-budget (10000) -> "continue"', decision && decision.action === 'continue');
  }

  // ---- threshold crossed AND unaffordable at once -> pause-now wins (rule priority) ----
  {
    const { decision } = run([
      '--percent-used', '95', '--reset-at', RESET_AT,
      '--projected-next', '50000', '--window-budget', '10000',
    ]);
    check('threshold-crossed takes priority over the affordability pre-flight -> "pause-now"', decision && decision.action === 'pause-now');
  }

  // ---- only one of the pair given -> affordability check does not apply -> continue ----
  {
    const { decision } = run(['--percent-used', '50', '--reset-at', RESET_AT, '--projected-next', '50000']);
    check('--projected-next without --window-budget does not trigger affordability -> "continue"', decision && decision.action === 'continue');
  }
}

function main() {
  const affordabilityMode = process.argv.includes('--affordability');
  if (affordabilityMode) {
    affordabilitySuite();
  } else {
    defaultSuite();
  }

  if (failures === 0) {
    console.log('\n✓ usage-governor — all checks passed.');
    process.exit(0);
  }
  console.log('\n✗ usage-governor — ' + failures + ' check(s) failed.');
  process.exit(1);
}

main();
