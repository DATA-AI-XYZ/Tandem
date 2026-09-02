#!/usr/bin/env node
/**
 * autopilot-branch-assert.js — is the working tree still on the phase branch? Asked BEFORE
 * EVERY chat dispatch (STORY-26.5.03, PRD-Autonomous-Execution §B.3.3).
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * Dispatched subagents share one working tree (SOP §18). If that tree drifts onto another
 * branch — a stray checkout, an interrupted merge, a lane that wandered — the next dispatch
 * writes its commits somewhere nobody is looking. The run keeps reporting success, because
 * every story really did get done; they just landed on the wrong branch.
 *
 * ============================================================================
 * IT READS GIT. IT DOES NOT READ A VARIABLE THE CALLER SET.
 * ============================================================================
 * `currentBranch()` spawns `git rev-parse --abbrev-ref HEAD` in the tree being dispatched
 * into, every time. A check whose "found" value comes from the same place as its "expected"
 * value is a check that can only ever pass — so the only injectable thing here is the PATH TO
 * THE GIT BINARY and the DIRECTORY, never the answer.
 *
 * ============================================================================
 * …AND `expected` HAS A RECORDED SOURCE TOO (ADR-0157)
 * ============================================================================
 * The paragraph above solved that for `found` and NOT AT ALL for `expected`, which is half a
 * guarantee: `SKILL.md` documented a checkpoint `"branch"` field, `autopilot-checkpoint.js`
 * had no branch handling whatsoever, and the live checkpoint read `"branch": null`. With no
 * authoritative source the obvious move for an agent filling in `--expected` is
 * `git rev-parse --abbrev-ref HEAD` — THE SAME CALL `currentBranch()` MAKES — and the guard
 * then compares git to git and can only pass.
 *
 * So `--expected` now falls back to `autopilot-checkpoint.js`'s recorded `branch` for the run,
 * written when the phase was opened. It is a RECORD OF AN INTENTION, made before the drift
 * this file exists to catch could have happened, which is what makes it an independent
 * expectation rather than a second reading of the same fact. When neither the flag nor the
 * checkpoint can supply one, the existing empty-`expected` path REFUSES: a run that cannot
 * say which branch it belongs on has no business dispatching into a shared tree.
 *
 * `expected_source` (`flag` / `checkpoint` / `none`) is on the verdict and on the ledger, for
 * the same reason `signal_source` is on the entry probe's record (ADR-0156): an expectation
 * with no stated origin cannot be audited afterwards.
 *
 * ============================================================================
 * A MISMATCH HALTS. IT DOES NOT CORRECT.
 * ============================================================================
 * Checking out the expected branch is the tempting behaviour and it is explicitly wrong: if
 * the tree drifted, uncommitted work may be sitting in it, and a checkout can destroy exactly
 * the evidence a human needs. There is no `git checkout` in this file, and there never should
 * be. `dispatchChats()` stops at the first mismatch — the remaining chats are not dispatched.
 *
 * THREE THINGS ARE ALL "MISMATCH" (AC-4):
 *   - a different branch name          -> state `mismatch`
 *   - a detached HEAD                  -> state `detached` (git prints the literal `HEAD`)
 *   - git failing, missing, or silent  -> state `unreadable`
 * The last one is the one worth arguing about: "we could not tell" is not "it was fine". An
 * unreadable git state passing the check would make the guard useless in precisely the
 * situation — a broken or half-locked repository — where drift is most likely.
 *
 * NO PROMPT (AC-5). Halting and reporting is not asking. There is no readline, no stdin read,
 * and no question in any message this file emits; an unattended run completes this check alone.
 *
 * LEDGER: a halt is recorded at `run` level through `retro-capture.js`, the single writer
 * (ADR-0153), carrying BOTH branch names in `stop_reason`. `run` rather than `pause` because a
 * branch halt is not a pause: there is no reset time, nothing resumes it on a schedule, and a
 * human has to look. Same reasoning, same level, as the entry probe (ADR-0154).
 *
 * Usage:
 *   node autopilot-branch-assert.js [--expected <branch>] --run-id <id> [--cwd <path>]
 *                                   [--phase EPIC-NN] [--chat CHAT-NN] [--reports-dir <path>]
 *                                   [--out <ledger>] [--json]
 *
 *   With no `--expected`, the run's checkpoint supplies it. With neither, the run HALTS.
 *
 *   `--out <ledger>` writes the halt record somewhere other than the production
 *   `41-Reports/retro/retro-log.jsonl`. USE IT FOR ANY AD-HOC INVOCATION. Without it, a run
 *   this repository has no plan and no checkpoint for records NOTHING rather than polluting the
 *   calibration ledger — one shared rule for the whole gate-tool family, in
 *   `lib/ledger-target.js` (STORY-29.1.01, BUG-20260804-39).
 *
 * Exit codes:
 *   0 — the tree is on the expected branch; dispatch may proceed
 *   2 — usage error (neither --expected nor --run-id: nothing to resolve an expectation from)
 *   4 — HALT: mismatch, detached HEAD, unreadable git state, or NO RECORDED EXPECTATION.
 *       Do not dispatch.
 *
 * Dependency-free — Node stdlib only, consistent with every other `93-Scripts/` tool.
 */

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const decisionCapture = require(path.join(__dirname, 'autopilot-decision-capture.js'));
const checkpoint = require(path.join(__dirname, 'autopilot-checkpoint.js'));

const EXIT_OK = 0;
const EXIT_USAGE = 2;
const EXIT_HALT = 4;

/** Where the EXPECTATION came from. Enumerated for the same reason the states below are:
 *  so a reader can count them, and so `checkpoint` can never be silently reported as `flag`. */
const EXPECTED_SOURCES = Object.freeze(['flag', 'checkpoint', 'none']);

/** Every way the tree can be. Enumerated so a reader can count them and a probe can walk them. */
const BRANCH_STATES = Object.freeze(['match', 'mismatch', 'detached', 'unreadable']);

/** The states that stop a dispatch. `match` is the only one that does not. */
const HALTING_STATES = Object.freeze(['mismatch', 'detached', 'unreadable']);

/** What git prints for `--abbrev-ref HEAD` when HEAD is detached. */
const DETACHED = 'HEAD';

function safeMessage(err) {
  try {
    if (err && typeof err.message === 'string') return err.message;
    return String(err);
  } catch {
    return '(unprintable error)';
  }
}

/**
 * Read the branch the tree at `cwd` is actually on.
 *
 * @returns {{branch: string|null, error: string|null}} `branch` is null when git could not be
 *          read at all — a state deliberately distinct from any branch name, including `HEAD`.
 * NEVER THROWS.
 */
function currentBranch(opts) {
  const options = opts || {};
  const gitBin = options.gitBin || 'git';
  let res;
  try {
    res = spawnSync(gitBin, ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: options.cwd || process.cwd(),
      encoding: 'utf8',
      // A branch check must not inherit a pager, an editor, or a hook's environment.
      env: Object.assign({}, process.env, { GIT_PAGER: 'cat', GIT_OPTIONAL_LOCKS: '0' }),
    });
  } catch (err) {
    return { branch: null, error: `git could not be spawned: ${safeMessage(err)}` };
  }
  if (res.error) return { branch: null, error: `git failed: ${safeMessage(res.error)}` };
  if (res.status !== 0) {
    return { branch: null, error: `git exited ${res.status}: ${String(res.stderr || '').trim()}` };
  }
  const branch = String(res.stdout || '').trim();
  if (branch === '') return { branch: null, error: 'git printed no branch name' };
  return { branch, error: null };
}

/**
 * Where the run says it belongs — the flag if one was given, otherwise the run's CHECKPOINT
 * (ADR-0157). NEVER reads git: a value derived from the same call as `found` would make the
 * assertion unfalsifiable, which is the whole point of this file.
 *
 * @returns {{expected: string|null, source: string, note: string|null}}
 * NEVER THROWS — `readCheckpointForRun` never throws, and a missing reports dir is a miss.
 */
function resolveExpected(opts) {
  const options = opts || {};
  const fromFlag = typeof options.expected === 'string' ? options.expected.trim() : '';
  if (fromFlag !== '') return { expected: fromFlag, source: 'flag', note: null };

  const runId = typeof options.runId === 'string' ? options.runId.trim() : '';
  if (runId === '') {
    return {
      expected: null,
      source: 'none',
      note: 'no --expected and no --run-id, so there is nothing to resolve an expectation from',
    };
  }
  let rec;
  try {
    rec = checkpoint.readCheckpointForRun(options.reportsDir, runId);
  } catch (err) {
    return { expected: null, source: 'none', note: `checkpoint unreadable: ${safeMessage(err)}` };
  }
  if (!rec || !rec.ok) {
    return {
      expected: null,
      source: 'none',
      note: `no usable checkpoint for run ${runId}${rec && rec.error ? ` (${rec.error})` : ''}`,
    };
  }
  const branch = typeof rec.branch === 'string' && rec.branch.trim() !== '' ? rec.branch.trim() : null;
  if (branch === null) {
    return {
      expected: null,
      source: 'none',
      note: `the checkpoint for run ${runId} records no branch (\`branch\` is null) — the phase `
        + 'open did not write one',
    };
  }
  return { expected: branch, source: 'checkpoint', note: null };
}

/**
 * The assertion. `expected` is the phase branch recorded for the run — from `--expected`, or
 * from the run's checkpoint when the flag is absent (ADR-0157).
 *
 * @returns {{ok, state, expected, expected_source, found, message}} — `found` is the branch
 *          name, the literal `HEAD` for a detached head, or null when git was unreadable.
 * NEVER THROWS.
 */
function assertBranch(opts) {
  const options = opts || {};
  const resolved = resolveExpected(options);
  const expected = resolved.expected === null ? '' : resolved.expected;
  const read = currentBranch(options);
  const found = read.branch;

  if (expected === '') {
    // No expectation is not a pass. A run that cannot say which branch it belongs on has no
    // business dispatching into a shared tree.
    return {
      ok: false, state: 'unreadable', expected: null, expected_source: 'none', found,
      message: 'HALT: no expected branch was recorded for this run, so the branch assertion '
        + `cannot be made (${resolved.note || 'no source available'}). `
        + `Found: ${found === null ? '<git unreadable>' : found}. Record the phase branch on the `
        + 'run checkpoint (`"branch": "phase/<phase-id>"`) or pass --expected.',
    };
  }
  if (found === null) {
    return {
      ok: false, state: 'unreadable', expected, expected_source: resolved.source, found: null,
      message: `HALT: the git state could not be read, so the branch could not be verified. `
        + `Expected: ${expected}. Found: <unreadable> (${read.error}). "We could not tell" is `
        + 'not "it was fine" — nothing was dispatched and nothing was checked out.',
    };
  }
  if (found === DETACHED) {
    return {
      ok: false, state: 'detached', expected, expected_source: resolved.source, found,
      message: `HALT: HEAD is DETACHED. Expected: ${expected}. Found: detached HEAD. Commits `
        + 'made here would belong to no branch — nothing was dispatched and nothing was '
        + 'checked out.',
    };
  }
  if (found !== expected) {
    return {
      ok: false, state: 'mismatch', expected, expected_source: resolved.source, found,
      message: `HALT: the working tree is on the wrong branch. Expected: ${expected} `
        + `(from ${resolved.source}). Found: ${found}. The run did NOT check out ${expected} — `
        + 'uncommitted work may be sitting in this tree and a checkout could destroy it. '
        + 'A human should look.',
    };
  }
  return {
    ok: true, state: 'match', expected, expected_source: resolved.source, found,
    message: `branch ok: ${found} (expected from ${resolved.source})`,
  };
}

/** AC-3 — both names on the ledger, at `run` level, through the single writer. Never throws. */
function recordHalt(verdict, ctx) {
  const context = ctx || {};
  const argv = ['--level', 'run', '--id', context.runId || 'autopilot-unknown-run'];
  if (context.phase) argv.push('--phase', context.phase);
  if (context.chat) argv.push('--chat', context.chat);
  argv.push('--halts', '1');
  argv.push('--stop-reason',
    `branch-assertion ${verdict.state}: expected ${verdict.expected === null ? '<none recorded>' : verdict.expected}`
    + ` [expected_source=${verdict.expected_source || 'none'}]`
    + `, found ${verdict.found === null ? '<git unreadable>' : verdict.found}`
    + `${context.chat ? ` (before dispatching ${context.chat})` : ''}`);
  try {
    // THE RUN CONTEXT GOES WITH THE RECORD (STORY-29.1.01). Exercising this assertion ad-hoc —
    // `--expected some-other-branch --run-id probe` — used to append a `run` line to the
    // production calibration ledger for a run that does not exist (BUG-20260804-39).
    return decisionCapture.capture(argv, {
      out: context.out, runId: context.runId, reportsDir: context.reportsDir,
    });
  } catch (err) {
    return {
      captured: false, refused: false, code: null, stdout: '', stderr: '',
      warnings: [`branch-halt capture threw: ${safeMessage(err)}`], argv,
    };
  }
}

/**
 * AC-1 + AC-2 — dispatch a list of chats, asserting the branch before EACH one.
 *
 * Not once per run, and not cached: under ADR-0081's shared-tree fallback several lanes use the
 * same tree, so a verdict from one dispatch says nothing about the next. `markers` records
 * `assert:<chat>` and `dispatch:<chat>` in the order they happened, so a caller can see both
 * that the check ran and that it ran per dispatch.
 *
 * @returns {{halted, verdicts, markers, dispatched: string[], halt: object|null, capture}}
 */
function dispatchChats(opts) {
  const options = opts || {};
  const chats = Array.isArray(options.chats) ? options.chats : [];
  const markers = Array.isArray(options.markers) ? options.markers : [];
  const verdicts = [];
  const dispatched = [];
  let halt = null;
  let capture = null;

  for (const chat of chats) {
    markers.push(`assert:${chat}`);
    // READ THE TREE AGAIN. Every time.
    const verdict = assertBranch({
      expected: options.expected, cwd: options.cwd, gitBin: options.gitBin,
      // Resolved PER DISPATCH, like the git read: a checkpoint rewritten mid-run (a phase
      // closing, a new phase opening) must change the expectation the next dispatch is held to.
      runId: options.runId, reportsDir: options.reportsDir,
    });
    verdicts.push(verdict);
    if (!verdict.ok) {
      halt = verdict;
      capture = recordHalt(verdict, {
        runId: options.runId, phase: options.phase, chat, out: options.out,
        reportsDir: options.reportsDir,
      });
      try {
        // Operator-facing, on stderr, carrying BOTH names. No question mark anywhere in it.
        process.stderr.write(`${verdict.message}\n`);
      } catch { /* a diagnostic must not take the halt down */ }
      break; // no further dispatch, and no checkout
    }
    markers.push(`dispatch:${chat}`);
    dispatched.push(chat);
    if (typeof options.dispatch === 'function') options.dispatch({ chat, verdict });
  }

  return { halted: halt !== null, halt, verdicts, markers, dispatched, capture };
}

// ---------- CLI ----------

function usage(msg) {
  if (msg) console.error(msg);
  console.error('usage: node autopilot-branch-assert.js [--expected <branch>] --run-id <id> '
    + '[--cwd <path>] [--phase EPIC-NN] [--chat CHAT-NN] [--reports-dir <path>] '
    + '[--out <ledger>] [--json]');
  console.error('  with no --expected, the run checkpoint\'s `branch` supplies it; with '
    + 'neither, the assertion HALTS (exit 4) rather than passing.');
  console.error('  --out <ledger> writes the halt record somewhere other than the production '
    + '41-Reports/retro/retro-log.jsonl — use it for any ad-hoc invocation. Without it, a '
    + '--run-id this repository has no run plan and no checkpoint for records NOTHING '
    + '(STORY-29.1.01), and the tool says where it would have written.');
  return EXIT_USAGE;
}

function main(argv) {
  const args = argv.slice(2);
  const flags = Object.create(null);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') { flags.json = true; continue; }
    if (a.indexOf('--') !== 0) return usage(`unexpected argument "${a}"`);
    const v = args[i + 1];
    if (v === undefined || String(v).indexOf('--') === 0) { flags[a.slice(2)] = ''; continue; }
    flags[a.slice(2)] = v;
    i++;
  }
  // NEITHER a flag NOR a run to look one up for. That is a caller who supplied nothing, which
  // is a usage error; a caller who named a run and got no branch back is a REFUSAL (exit 4),
  // decided by assertBranch below. The two are different failures and get different codes.
  if (!flags.expected && !flags['run-id']) {
    return usage('one of --expected or --run-id is required (--run-id resolves the expected '
      + 'branch from the run checkpoint)');
  }

  const verdict = assertBranch({
    expected: flags.expected, cwd: flags.cwd,
    runId: flags['run-id'], reportsDir: flags['reports-dir'],
  });
  let capture = null;
  if (!verdict.ok) {
    capture = recordHalt(verdict, {
      runId: flags['run-id'], phase: flags.phase, chat: flags.chat, out: flags.out,
      reportsDir: flags['reports-dir'],
    });
  }

  // WHY NOTHING WAS WRITTEN, WHATEVER THE OUTPUT FORMAT (STORY-29.1.01). This diagnostic used
  // to live in the non-JSON branch only, so `--json` reported `recorded: false` and never said
  // whether that was a refusal, a failure, or a destination the tool declined to use.
  if (capture && !capture.captured) {
    try {
      process.stderr.write('⚠ autopilot-branch-assert: the run-level halt record was NOT written '
        + `(${capture.skipped || (capture.refused ? 'REFUSED' : 'not captured')}) — `
        + `${capture.warnings.join('; ') || 'no reason given'}\n`);
    } catch { /* a diagnostic must not take the halt down */ }
  }

  if (flags.json) {
    console.log(JSON.stringify({
      ok: verdict.ok, state: verdict.state, expected: verdict.expected,
      expected_source: verdict.expected_source, found: verdict.found,
      message: verdict.message, recorded: capture ? capture.captured : null,
      not_recorded_because: !capture || capture.captured
        ? null : (capture.skipped || (capture.refused ? 'refused' : 'capture-failed')),
    }, null, 2));
  } else if (verdict.ok) {
    console.log(verdict.message);
  } else {
    console.error(verdict.message);
  }

  return verdict.ok ? EXIT_OK : EXIT_HALT;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = {
  BRANCH_STATES, HALTING_STATES, DETACHED, EXPECTED_SOURCES,
  EXIT_OK, EXIT_USAGE, EXIT_HALT,
  currentBranch, resolveExpected, assertBranch, recordHalt, dispatchChats, main,
};
