#!/usr/bin/env node
/**
 * format-tok.test.js — unit test for generate-dashboard.js's exported `formatTok(n)`
 * helper (STORY-21.5.03 Case C / TESTPLAN-21.5.03 TC-03).
 *
 * BUG-20260618-03 Case C: every cost figure used to render as a raw integer
 * ('~' + cost + ' tok') with no thousands separator and no magnitude abbreviation.
 * formatTok(n) is the single shared number-format site (rollup header + every card
 * cost tag), applied consistently. This test exercises the helper directly (pure
 * function, no filesystem access) across the documented boundaries:
 *   - below 10,000: thousands-comma integer (no abbreviation)
 *   - from 10,000: one-decimal K abbreviation, trailing ".0" dropped
 *   - from 1,000,000: one-decimal M abbreviation, trailing ".0" dropped
 * plus the specific edge values called out in the story: 0, 999, 9999, 10000,
 * 999999, 1000000.
 *
 * Exit 0 = pass, non-zero = fail. Dependency-free (Node stdlib only).
 */

'use strict';

const path = require('path');

const SCRIPTS_ROOT = path.resolve(__dirname, '..');
const DASHBOARD = path.join(SCRIPTS_ROOT, 'generate-dashboard.js');
const { formatTok } = require(DASHBOARD);

let failures = 0;
function check(name, cond) {
  if (cond) { console.log('  ok  - ' + name); }
  else { console.log('  FAIL- ' + name); failures += 1; }
}

function main() {
  check('formatTok is exported as a function', typeof formatTok === 'function');

  // ---------------------------------------------------------------------
  // Story-specified edge values.
  // ---------------------------------------------------------------------
  check('0 -> "0"', formatTok(0) === '0');
  check('999 -> "999" (no comma below 1,000)', formatTok(999) === '999');
  check('9999 -> "9,999" (comma, still below the 10K abbreviation boundary)', formatTok(9999) === '9,999');
  check('10000 -> "10K" (abbreviation starts at 10,000, ".0" dropped)', formatTok(10000) === '10K');
  check('999999 -> "999.9K" (truncates, does not round up into "1000K")', formatTok(999999) === '999.9K');
  check('1000000 -> "1M" (abbreviation starts at 1,000,000, ".0" dropped)', formatTok(1000000) === '1M');

  // ---------------------------------------------------------------------
  // General comma behaviour (below 10,000).
  // ---------------------------------------------------------------------
  check('1 -> "1"', formatTok(1) === '1');
  check('12 -> "12"', formatTok(12) === '12');
  check('123 -> "123"', formatTok(123) === '123');
  check('1344 -> "1,344"', formatTok(1344) === '1,344');
  check('2672 -> "2,672"', formatTok(2672) === '2,672');

  // ---------------------------------------------------------------------
  // K abbreviation behaviour (10,000 - 999,999).
  // ---------------------------------------------------------------------
  check('15000 -> "15K"', formatTok(15000) === '15K');
  check('294620 -> "294.6K"', formatTok(294620) === '294.6K');
  check('377998 -> "377.9K" (the reported BUG-20260618-03 Case A figure)', formatTok(377998) === '377.9K');
  check('502935 -> "502.9K" (the reported BUG-20260618-03 Case A catalogue figure)', formatTok(502935) === '502.9K');

  // ---------------------------------------------------------------------
  // M abbreviation behaviour (>= 1,000,000).
  // ---------------------------------------------------------------------
  check('1200000 -> "1.2M"', formatTok(1200000) === '1.2M');
  check('25000000 -> "25M"', formatTok(25000000) === '25M');

  // ---------------------------------------------------------------------
  // Non-numeric / falsy inputs never throw and floor to a sane value.
  // ---------------------------------------------------------------------
  check('null -> "0"', formatTok(null) === '0');
  check('undefined -> "0"', formatTok(undefined) === '0');
  check("NaN input ('banana') -> \"0\"", formatTok('banana') === '0');

  // ---------------------------------------------------------------------
  // No raw-integer concatenation pattern remains anywhere in the source
  // (mirrors TC-03's own source assertion; kept here too as a belt-and-
  // suspenders regression guard local to this test file).
  // ---------------------------------------------------------------------
  const src = require('fs').readFileSync(DASHBOARD, 'utf8');
  check('source defines function formatTok', src.indexOf('function formatTok') >= 0);
  check(
    "no render site still concatenates the raw integer (\"'~' + cost + ' tok'\")",
    !/'~' ?\+ ?cost ?\+ ?' tok'/.test(src)
  );

  if (failures === 0) {
    console.log('\n✓ format-tok — all checks passed.');
    process.exit(0);
  }
  console.log('\n✗ format-tok — ' + failures + ' check(s) failed.');
  process.exit(1);
}

main();
