#!/usr/bin/env node
/**
 * r22-cross-prefix.test.js
 *
 * Fixture test for R22's Next: pointer matcher (STORY-21.1.01 / BACKLOG-0078). Plain Node
 * script — no test framework. Exercises checkChainSync() (exported by validate-frontmatter.js)
 * against synthesised fixture skill dirs, via the temp-injection pattern TESTPLAN-19.2.01 set
 * for checkVersionParity: require the module (its `require.main === module` guard means
 * require()ing it never runs the full corpus lint), call the exported check function directly
 * against a fixture, then inspect the exported `violations` array it pushed to.
 *
 * Modes:
 *   node r22-cross-prefix.test.js                     — cross-prefix tolerance (TC-02 / AC-2)
 *   node r22-cross-prefix.test.js --genuine-violation  — genuine violation still fires
 *                                                         (TC-03 / AC-3)
 *
 * Exit codes: 0 — all fixture assertions passed. 1 — at least one failed (message on stderr
 * names which fixture and what was expected vs. observed).
 *
 * Run from the repo root, e.g.:
 *   node _00-Project-Management/93-Scripts/tests/r22-cross-prefix.test.js
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const validator = require(path.join(__dirname, '..', 'validate-frontmatter.js'));

// A 2-command chain (alpha -> beta, beta terminal) is the minimum shape checkChainSync
// needs — only 'alpha' requires a Next: pointer, so only its SKILL.md matters here.
const CMD_A = 'alpha';
const CMD_B = 'beta';

const DEV_PREFIX = 'Tandem';
const PUBLISHED_PREFIX = 'Tandem';

function mkFixtureSkillsDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r22-fixture-'));
  fs.mkdirSync(path.join(dir, 'core'), { recursive: true });
  fs.mkdirSync(path.join(dir, CMD_A), { recursive: true });
  return dir;
}

function writeCoreChainLine(skillsDir, prefix) {
  const content =
    '# core (fixture)\n\n' +
    'Chain: `/' + prefix + ':' + CMD_A + '` → `/' + prefix + ':' + CMD_B + '`\n';
  fs.writeFileSync(path.join(skillsDir, 'core', 'SKILL.md'), content, 'utf8');
}

function writeMemberNextPointer(skillsDir, memberName, nextPrefix, nextCommand) {
  const content =
    '# ' + memberName + ' (fixture)\n\n' +
    'Next: `/' + nextPrefix + ':' + nextCommand + '`\n';
  fs.writeFileSync(path.join(skillsDir, memberName, 'SKILL.md'), content, 'utf8');
}

function cleanUp(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// Runs checkChainSync against a fixture skills dir in isolation: the shared violations[]
// array is cleared first so each fixture's result can't be polluted by an earlier run.
function r22ViolationsFor(skillsDir) {
  validator.violations.length = 0;
  validator.checkChainSync(skillsDir);
  return validator.violations.filter(function (v) { return v.rule === 'R22'; });
}

let failures = 0;

function assertNoViolation(label, skillsDir) {
  const found = r22ViolationsFor(skillsDir);
  if (found.length > 0) {
    failures += 1;
    console.error('FAIL: ' + label + ' — expected no R22 violation, got ' + found.length + ':');
    found.forEach(function (v) {
      console.error('  [' + v.rule + '] ' + v.file + ': ' + v.message);
    });
  } else {
    console.log('PASS: ' + label + ' — no R22 violation, as expected.');
  }
}

function assertViolation(label, skillsDir) {
  const found = r22ViolationsFor(skillsDir);
  if (found.length === 0) {
    failures += 1;
    console.error('FAIL: ' + label + ' — expected an R22 violation, got none.');
  } else {
    console.log('PASS: ' + label + ' — R22 violation fired as expected (' + found[0].message + ')');
  }
}

const genuineViolationMode = process.argv.includes('--genuine-violation');

if (!genuineViolationMode) {
  // AC-2 / TC-02: a core/member prefix mismatch, in both directions, must stay green —
  // the Next: command itself is correct in both fixtures, only the prefix differs.
  let dir = mkFixtureSkillsDir();
  try {
    writeCoreChainLine(dir, DEV_PREFIX);
    writeMemberNextPointer(dir, CMD_A, PUBLISHED_PREFIX, CMD_B);
    assertNoViolation('core=dev prefix, member Next=published prefix (same next command)', dir);
  } finally {
    cleanUp(dir);
  }

  dir = mkFixtureSkillsDir();
  try {
    writeCoreChainLine(dir, PUBLISHED_PREFIX);
    writeMemberNextPointer(dir, CMD_A, DEV_PREFIX, CMD_B);
    assertNoViolation('core=published prefix, member Next=dev prefix (same next command, inverse)', dir);
  } finally {
    cleanUp(dir);
  }
} else {
  // AC-3 / TC-03: identical prefixes on both sides, but the Next: pointer names the wrong
  // next command — the tolerance must not mask a real chain-drift violation.
  const dir = mkFixtureSkillsDir();
  try {
    writeCoreChainLine(dir, DEV_PREFIX);
    writeMemberNextPointer(dir, CMD_A, DEV_PREFIX, 'wrong-next-command');
    assertViolation('core=dev prefix, member Next=dev prefix, wrong next command', dir);
  } finally {
    cleanUp(dir);
  }
}

if (failures > 0) {
  console.error('\n' + failures + ' fixture assertion(s) failed.');
  process.exit(1);
}
console.log('\nAll fixture assertions passed.');
process.exit(0);
