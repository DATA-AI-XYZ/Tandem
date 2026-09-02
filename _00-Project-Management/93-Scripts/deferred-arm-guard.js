#!/usr/bin/env node
/**
 * deferred-arm-guard.js — run a probe that carries a DEFERRED ARM, and pass only if the
 * arms it fails on are EXACTLY the ones that were declared, with their owner named.
 *
 *   node deferred-arm-guard.js --owner STORY-NN.M.PP --expect-exit 1 \
 *     --expect-failure "<substring>" [--expect-failure "<substring>" …] \
 *     -- <command> [args…]
 *
 * Exit 0 = the declared deferral, and nothing else · 1 = the guard's own verdict failed
 * · 2 = usage. Node stdlib only.
 *
 * ===========================================================================
 * WHY THIS EXISTS (BUG-20260825-14)
 * ===========================================================================
 * A verify line is a chain of commands that must all exit 0. When one of its probes
 * legitimately cannot go green yet — because the markup it walks is a LATER story's
 * deliverable — there are only three things a chat can do with it, and two of them are
 * wrong:
 *
 *   1. leave it in and let the chain go red. Honest, and it makes the gate useless: a
 *      permanently-red gate stops being read, which is how a REAL regression hides
 *      behind a known one.
 *   2. take it out. The chain goes green and the family it covered is simply absent.
 *      This is a SHRINKING DENOMINATOR, and it is exactly the defect
 *      `--dropdown-adoption-scan` exists to catch on the product side — "proved
 *      adoption on 5 of 6; NOT proved: phases" is a failure that NAMES itself rather
 *      than a smaller census. CHAT-05 did this to its own verify line, and the
 *      omission survived TWO independent runs of the chain, because a command that is
 *      not there cannot fail.
 *   3. declare the deferral and gate on it. That is this file.
 *
 * ===========================================================================
 * WHAT A PASS FROM THIS GUARD MEANS, AND WHAT IT DOES NOT
 * ===========================================================================
 * It means: the command ran, it exited exactly as declared, every failure it reported
 * was one of the declared ones — AND every declared one still occurred.
 *
 * That second direction is what makes the guard self-retiring rather than a permanent
 * excuse. When the owning story lands its markup the declared arm stops failing, the
 * guard goes RED, and whoever runs the chain has to come and delete the declaration. A
 * deferral that could quietly outlive its cause is not a deferral, it is a hole with a
 * comment next to it.
 *
 * It does NOT mean the deferred arm passes. Nothing here claims that, and the printed
 * verdict says so in the owner's name on every run, green included — because a green
 * line that does not state what it excluded is how the excluded thing gets forgotten.
 *
 * ===========================================================================
 * HOW THE FAILURE SET IS READ
 * ===========================================================================
 * From the harness's OWN failure blocks, never from a bare scan for bullet lines:
 * `smoke-dashboard.js` prints REPORTED-BUT-NOT-FAILED material in the same bullet shape
 * ("34 option(s) predict an EMPTY set — honoured, but proves nothing"), and a scan that
 * swept those up would demand they be declared too — turning a caveat into an
 * expectation, which is the same overclaim in the other direction.
 *
 * So: a header line ending in `failure(s):` or `failure(s)):` opens a block, and the
 * bullet lines directly under it are the failures. Anything else is output.
 */

'use strict';

const { spawnSync } = require('child_process');

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;

const USAGE = 'usage: node deferred-arm-guard.js --owner <ID> --expect-exit <n> '
  + '--expect-failure "<substring>" [--expect-failure …] -- <command> [args…]';

function usageError(why) {
  console.error(USAGE);
  console.error(why);
  process.exit(EXIT_USAGE);
}

function parseArgs(argv) {
  const out = { owner: null, expectExit: null, expect: [], cmd: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { out.cmd = argv.slice(i + 1); break; }
    const v = argv[i + 1];
    if (a === '--owner') {
      if (v === undefined) usageError('--owner requires a value');
      out.owner = v; i++;
    } else if (a === '--expect-exit') {
      if (v === undefined) usageError('--expect-exit requires a value');
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) usageError('--expect-exit expects a non-negative integer');
      out.expectExit = n; i++;
    } else if (a === '--expect-failure') {
      if (v === undefined || String(v).trim() === '') {
        usageError('--expect-failure requires a non-empty substring');
      }
      out.expect.push(String(v)); i++;
    } else {
      usageError('unknown option "' + a + '"');
    }
  }
  return out;
}

/**
 * The failure bullets under every "… failure(s):" header the harness prints, in order,
 * trimmed of the leading dash so a declaration matches as a substring of the message
 * the probe actually wrote.
 */
function failureLines(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let inBlock = false;
  for (const line of lines) {
    if (/failure\(s\)\)?\s*:\s*$/.test(line)) { inBlock = true; continue; }
    if (!inBlock) continue;
    const m = /^\s{1,4}-\s+(.*)$/.exec(line);
    if (m) { out.push(m[1].trim()); continue; }
    inBlock = false;
  }
  return out;
}

/** The guard's verdict over an already-captured run. Separated so it is testable. */
function verdict(args, run) {
  const problems = [];
  const out = String(run.stdout || '');
  const err = String(run.stderr || '');
  if (!out.trim() && !err.trim()) {
    problems.push('the command produced no output at all — nothing to verdict');
  }
  if (run.status !== args.expectExit) {
    problems.push('exit ' + run.status + ', declared ' + args.expectExit);
  }
  const observed = failureLines(out + '\n' + err);
  if (!observed.length) {
    problems.push('the command reported NO failure block, so the declared arm(s) cannot have occurred');
  }
  for (const f of observed) {
    if (!args.expect.some((e) => f.indexOf(e) !== -1)) problems.push('UNDECLARED failure: ' + f);
  }
  for (const e of args.expect) {
    if (!observed.some((f) => f.indexOf(e) !== -1)) {
      problems.push('the declared arm no longer fails — DELETE the declaration and let the chain '
        + 'gate on it directly: ' + e);
    }
  }
  return { problems, observed };
}

function main() {
  const args = parseArgs(process.argv);

  // Anti-vacuity, in the order each would have produced a meaningless green.
  if (!args.owner) usageError('--owner is required: a deferral with no named owner is an excuse');
  if (!args.cmd.length) usageError('no command after `--` — the guard would run nothing');
  if (args.expectExit === null) usageError('--expect-exit is required');
  if (args.expectExit === 0) {
    usageError('--expect-exit 0 declares no deferral at all; run the command directly rather than wrapping it');
  }
  if (!args.expect.length) {
    usageError('at least one --expect-failure is required: a guard that declares no arm would accept '
      + 'ANY failure, which is worse than removing the command');
  }

  const run = spawnSync(args.cmd[0], args.cmd.slice(1), { encoding: 'utf8' });
  if (run.error) {
    console.error('[deferred-arm] could not run the command: ' + run.error.message);
    return EXIT_USAGE;
  }
  // STDOUT AND STDERR BOTH GO THROUGH, always. Swallowing stderr on a gate is
  // BUG-20260824-04 and it hid a real failure; this guard exists to make a partial
  // result readable, so hiding half of it would defeat the point.
  process.stdout.write(String(run.stdout || ''));
  process.stderr.write(String(run.stderr || ''));

  const v = verdict(args, run);

  // Printed on green as well as red. A gate that states its exclusions only when it is
  // unhappy is a gate whose exclusions are invisible exactly when they matter.
  console.error('[deferred-arm] ' + args.cmd.slice(1).join(' '));
  console.error('[deferred-arm] declared deferral, owner ' + args.owner + ' — ' + args.expect.length
    + ' arm(s) declared, ' + v.observed.length + ' failure(s) observed, exit ' + run.status);
  for (const e of args.expect) console.error('[deferred-arm]   deferred: ' + e);

  if (v.problems.length) {
    console.error('[deferred-arm] FAIL — ' + v.problems.length + ' problem(s):');
    for (const p of v.problems) console.error('  - ' + p);
    return EXIT_FAILED;
  }
  console.error('[deferred-arm] OK — the ONLY failures are the ' + args.expect.length + ' arm(s) '
    + 'declared to ' + args.owner + '. This is NOT a pass of those arms.');
  return EXIT_OK;
}

if (require.main === module) process.exit(main());

module.exports = { failureLines, parseArgs, verdict };
