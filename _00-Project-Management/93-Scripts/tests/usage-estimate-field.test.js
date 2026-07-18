#!/usr/bin/env node
/**
 * usage-estimate-field.test.js — behavioural test for the R23 `usage_estimate:` shape rule
 * (STORY-21.2.02 / ADR-0079 / TESTPLAN-21.2.02 TC-04).
 *
 * Two layers:
 *
 *   1. Unit — calls `validate-frontmatter.js`'s exported checkUsageEstimateShape(value)
 *      directly (pure function, no filesystem access): a valid positive integer passes;
 *      0, a negative number, a non-numeric string, and a decimal all fail; an absent/empty
 *      value passes (the field is OPTIONAL — same shape-only stance as R19).
 *
 *   2. Integration — runs the real validator as a CHILD process (spawnSync, true black-box)
 *      with `--fixtures-dir` against a temp BACKLOG fixture (backlog chosen over story to
 *      avoid R6's paired-testplan requirement, which is orthogonal to this rule): a fixture
 *      carrying a valid `usage_estimate` produces 0 violations / exit 0; a fixture carrying
 *      a malformed one produces an R23 violation / exit 1. Never touches the real corpus.
 *
 * Exit 0 = pass, non-zero = fail. Dependency-free (Node stdlib only).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPTS_ROOT = path.resolve(__dirname, '..');
const VALIDATOR = path.join(SCRIPTS_ROOT, 'validate-frontmatter.js');
const { checkUsageEstimateShape } = require(VALIDATOR);

let failures = 0;
function check(name, cond) {
  if (cond) { console.log('  ok  - ' + name); }
  else { console.log('  FAIL- ' + name); failures += 1; }
}

function runValidator(fixturesDir) {
  return spawnSync(process.execPath, [VALIDATOR, '--fixtures-dir', fixturesDir], { encoding: 'utf8' });
}

function backlogFixture(id, usageEstimateLine) {
  return [
    '---',
    'type: backlog',
    `id: ${id}`,
    `title: Fixture — ${id}`,
    'status: not-started',
    "created_at: '2026-07-18T00:00:00+01:00'",
    "started_at: ''",
    "completed_at: ''",
    usageEstimateLine,
    '---',
    '',
    `# ${id} · fixture`,
    '',
  ].join('\n');
}

function main() {
  // ---------------------------------------------------------------------
  // 1. Unit — the pure checkUsageEstimateShape(value) checker.
  // ---------------------------------------------------------------------
  check('checkUsageEstimateShape is exported as a function', typeof checkUsageEstimateShape === 'function');

  // Valid positive integers pass (return null — no violation).
  check('a plain positive integer string passes', checkUsageEstimateShape('1500') === null);
  check('a single-digit positive integer passes', checkUsageEstimateShape('1') === null);
  check('a large positive integer passes', checkUsageEstimateShape('250000') === null);

  // Absent/empty — the field is optional, must pass.
  check('undefined passes (field absent)', checkUsageEstimateShape(undefined) === null);
  check('null passes (field absent)', checkUsageEstimateShape(null) === null);
  check("empty string '' passes (field present but empty)", checkUsageEstimateShape('') === null);
  check('whitespace-only string passes (trims to empty)', checkUsageEstimateShape('   ') === null);

  // Invalid shapes: 0, negative, non-numeric, decimal — each must fail with a message.
  const zeroResult = checkUsageEstimateShape('0');
  check('0 fails (not positive)', typeof zeroResult === 'string' && zeroResult.length > 0);

  const negativeResult = checkUsageEstimateShape('-5');
  check('a negative number fails', typeof negativeResult === 'string' && negativeResult.length > 0);

  const bananaResult = checkUsageEstimateShape('banana');
  check("'banana' (non-numeric) fails", typeof bananaResult === 'string' && bananaResult.length > 0);
  check('failure messages name the field', /usage_estimate/.test(bananaResult));

  const decimalResult = checkUsageEstimateShape('12.5');
  check('12.5 (decimal) fails', typeof decimalResult === 'string' && decimalResult.length > 0);

  // ---------------------------------------------------------------------
  // 2. Integration — full validator, isolated fixtures dir, real corpus never touched.
  // ---------------------------------------------------------------------
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-usage-estimate-field-test-'));
  try {
    const validDir = path.join(tmpDir, 'valid');
    const invalidDir = path.join(tmpDir, 'invalid');
    fs.mkdirSync(validDir, { recursive: true });
    fs.mkdirSync(invalidDir, { recursive: true });

    fs.writeFileSync(
      path.join(validDir, 'BACKLOG-9001-fixture.md'),
      backlogFixture('BACKLOG-9001', "usage_estimate: '1500'"));
    fs.writeFileSync(
      path.join(invalidDir, 'BACKLOG-9002-fixture.md'),
      backlogFixture('BACKLOG-9002', "usage_estimate: 'banana'"));

    const validResult = runValidator(validDir);
    check('validator exits 0 on a fixture story carrying a VALID usage_estimate', validResult.status === 0);
    check('validator reports 0 violations for the valid fixture', /0 violations/.test(validResult.stdout || ''));

    const invalidResult = runValidator(invalidDir);
    check('validator exits non-zero on a fixture carrying a MALFORMED usage_estimate', invalidResult.status !== 0);
    check('validator reports an R23 violation for the malformed fixture', /\[R23\]/.test(invalidResult.stdout || ''));
    check('the R23 violation message names usage_estimate', /usage_estimate/.test(invalidResult.stdout || ''));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  if (failures === 0) {
    console.log('\n✓ usage-estimate-field — all checks passed.');
    process.exit(0);
  }
  console.log('\n✗ usage-estimate-field — ' + failures + ' check(s) failed.');
  process.exit(1);
}

main();
