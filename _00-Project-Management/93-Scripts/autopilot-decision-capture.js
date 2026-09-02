#!/usr/bin/env node
/**
 * autopilot-decision-capture.js — the judgement calls a run makes at 2am, written down
 * (STORY-26.4.03, PRD-Autonomous-Execution §B.2 / §B.4).
 *
 * Which model tier a unit went to and why, what it was estimated to cost, and every decision
 * the usage governor took. Today those are acted on and thrown away; the consequences survive
 * and the reasoning does not.
 *
 * ============================================================================
 * IT WRITES THROUGH `retro-capture.js`. IT DOES NOT WRITE THE LEDGER.
 * ============================================================================
 * AC-4 is a single-writer rule, and this file honours it by SPAWNING `retro-capture.js` as a
 * child process rather than by importing a helper and hoping. That is deliberate: the
 * never-blocking contract belongs to that script's process boundary — it always exits 0,
 * including on a refusal — so inheriting the contract means inheriting the process, not
 * re-implementing the promise. There is no `appendFileSync` here and no ledger path.
 *
 * ---------------------------------------------------------------------------
 * AND THIS IS WHY THE EXIT CODE IS NOT THE ANSWER
 *
 * `retro-capture.js` EXITS 0 WHEN IT REFUSES A RECORD. That is correct — refusing and
 * crashing are different things and a close-out must survive both — but it means a caller
 * that gates on the exit code cannot tell "written" from "refused". This run has already
 * been bitten: a phase-level capture with `--merge ff-only` was rejected (the enum is
 * pr | direct | already-integrated | null) and still exited 0, so the phase closed believing
 * it had recorded something.
 *
 * So `capture()` READS STDOUT. `retro-capture.js` prints `retro: <level> <id> -> <path>` on
 * success and nothing of the sort on refusal, and this function returns:
 *
 *   { captured: true,  refused: false }   the line is on the ledger
 *   { captured: false, refused: true  }   REFUSED — the reason is in `.warnings`
 *
 * Both are non-blocking. `refused` is loud, not swallowed: the caller gets the warnings and
 * `dispatchWithCapture()` prints them. A capture that silently fails is worse than no
 * capture at all, because the gap is invisible and R25/R27 are the only things that would
 * ever notice.
 *
 * ---------------------------------------------------------------------------
 * TWO RECORDS PER STORY, JOINED ON `id` (AC-2)
 *
 * The tier and the estimate are known AT DISPATCH; the outcome is known only afterwards. The
 * ledger is append-only, so that is two records — `stage: "dispatch"` and `stage: "close"` —
 * sharing an `id`, never one record amended. `stage` is what lets a reader label them; `ts`
 * only orders them.
 *
 * AN ABSENT ESTIMATE IS WRITTEN AS EXPLICIT NULL, NEVER OMITTED AND NEVER 0 (AC-5). Every
 * story in this repository carries `usage_estimate: ''` today — 0 of 295 have a number — so
 * the null path is the ORDINARY path here, not an edge case, and a 0 would put a fabricated
 * measurement into the one dataset that exists to calibrate estimates.
 *
 * ---------------------------------------------------------------------------
 * BOTH OPERANDS OF THE ESTIMATE COMPARISON ARE EMPTY IN PRODUCTION TODAY
 *
 * The paragraph above discloses ONE half. Stating half of a two-sided absence reads as though
 * the other side were fine, so both are stated here, measured 2026-08-04:
 *
 *   ESTIMATE side   83 of 295 stories carry a `usage_estimate:` key; 0 of 295 carry a NUMBER.
 *   ACTUAL side     `41-Reports/usage/usage-log.jsonl` holds 28 rows. ALL are `kind: "chat"`.
 *                   ZERO carry a `STORY-` id, because `usage-capture.js` brackets CHATS, not
 *                   stories — so there is no story-keyed row for the join to find.
 *
 * Consequence: 47 of 47 story-level retro entries in the live ledger join to zero usage rows,
 * and `plan-vs-actual`'s per-story `actual` is `null` for every story in this repository BY
 * CONSTRUCTION. STORY-26.4.04 AC-3 is proven correct against fixtures and has never had a
 * production input. The runtime is honest about it — it prints "there is no accuracy figure to
 * report" and never 100% — but nothing in the artefacts said so, so AC-3 was readable as proven
 * in production. It is not. BACKLOG-0146 is the per-story attribution that would give it one.
 *
 * ---------------------------------------------------------------------------
 * AND IT NO LONGER DEFAULTS TO THE PRODUCTION LEDGER (STORY-29.1.01)
 *
 * `capture()` resolves its destination through `lib/ledger-target.js`: `--out` wins, otherwise
 * a production write requires a RUN CONTEXT the repository can vouch for (a run plan or a
 * checkpoint), otherwise the record is written NOWHERE and the refusal names the path it would
 * have used. Three gate tools shared this default and all three could pollute the calibration
 * ledger from the invocation their own documentation printed (BUG-20260804-37 / -39).
 *
 * Usage:
 *   node autopilot-decision-capture.js tier      --id STORY-26.4.03 --tier high \
 *        --reason complexity-escalation [--note "..."] [--usage-estimate <int>] [--run-id <id>]
 *   node autopilot-decision-capture.js governor  --run-id <run_id> --action pause-now \
 *        --percent-used 93.1 --threshold 92 [--reset-at <iso>]
 *   common: [--phase EPIC-NN] [--chat CHAT-NN] [--out <ledger path>] [--reports-dir <dir>]
 *
 *   `--out <ledger path>` writes somewhere other than the production
 *   `41-Reports/retro/retro-log.jsonl` — use it for ANY ad-hoc invocation. Without it, and
 *   without a `--run-id` naming a run this repository has a plan or a checkpoint for, nothing
 *   is written at all and the tool says so.
 *
 * Exit code: 0. ALWAYS — this inherits the never-blocking contract it is built on. A refusal
 * is reported on stderr and in `--json` output, never as an exit code.
 *
 * Dependency-free — Node stdlib only, consistent with every other `93-Scripts/` tool.
 */

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const schema = require(path.join(__dirname, 'lib', 'retro-schema.js'));
const ledgerTarget = require(path.join(__dirname, 'lib', 'ledger-target.js'));

const CAPTURE_SCRIPT = path.join(__dirname, 'retro-capture.js');

// The success line `retro-capture.js` prints. Matched, not assumed — see the header.
const SUCCESS_RE = /^retro: (\S+) (\S+) -> /m;
const WARNING_RE = /^⚠ retro-capture: (.*)$/gm;

const TIER_REASONS = schema.TIER_REASONS;
const GOVERNOR_ACTIONS = schema.GOVERNOR_ACTIONS;
const PAUSING_ACTIONS = schema.PAUSING_ACTIONS;

function safeMessage(err) {
  try {
    if (err && typeof err.message === 'string') return err.message;
    return String(err);
  } catch {
    return '(unprintable error)';
  }
}

/**
 * `pause` when the governor's decision causes a pause, `run` otherwise (AC-3). Stated once,
 * here, driven by `retro-schema.PAUSING_ACTIONS` rather than by a second list.
 */
function levelForGovernorAction(action) {
  return PAUSING_ACTIONS.indexOf(action) !== -1 ? 'pause' : 'run';
}

/**
 * Run `retro-capture.js` with `argv`. NEVER THROWS.
 *
 * ---------------------------------------------------------------------------
 * THE LEDGER TARGET IS RESOLVED HERE, ONCE, FOR EVERY GATE TOOL (STORY-29.1.01)
 *
 * `lib/ledger-target.js` decides between `--out`, the production ledger, and writing NOWHERE.
 * This is the shared seam BUG-20260804-39 asked for — "the decision lives in ONE place all
 * three read" — so a verification invocation of ANY gate cannot pollute the calibration ledger,
 * and no tool grows a `--dry-run` of its own.
 *
 * A refused capture does NOT spawn the writer. It returns `skipped: 'no-run-context'` and a
 * warning naming the production path it declined, which the gate tools print and put on
 * `--json` under `not_recorded_because` — the same field ADR-0162 added for the other reason a
 * record can be legitimately absent. Silence is what made this defect invisible for a week.
 *
 * The resolved path is passed EXPLICITLY as `--out`, including for a production write. The
 * destination is then a fact at the process boundary rather than a default two files away, and
 * the production branch becomes exercisable in a test (via `PM_RETRO_LOG`) without the test
 * having to write to the real ledger to prove the branch works.
 *
 * @param {string[]} argv
 * @param {{out?: string, runId?: string, reportsDir?: string}} opts `runId` is the RUN CONTEXT,
 *        not the record's `--id`: a story-level record belongs to a run too, and the id of the
 *        thing being recorded says nothing about whether the run exists.
 * @returns {{captured, refused, code, stdout, stderr, warnings, argv, target, skipped?}}
 */
function capture(argv, opts) {
  const options = opts || {};

  let target;
  try {
    target = ledgerTarget.resolve({
      out: options.out, runId: options.runId, reportsDir: options.reportsDir,
    });
  } catch (err) {
    // The resolver is contracted never to throw. If it ever does, REFUSE rather than fall back
    // to the production default — falling back is the behaviour this whole change removes.
    target = {
      mode: 'refused', path: null, runId: null, source: 'none', evidence: null,
      productionPath: null, why: `ledger target could not be resolved: ${safeMessage(err)}`,
    };
  }

  if (target.mode === 'refused') {
    return {
      captured: false,
      refused: false,
      skipped: ledgerTarget.NO_RUN_CONTEXT,
      code: null, stdout: '', stderr: '',
      warnings: [target.why],
      argv, target,
    };
  }

  const args = [CAPTURE_SCRIPT].concat(argv, ['--out', target.path]);

  let res;
  try {
    res = spawnSync(process.execPath, args, {
      encoding: 'utf8',
      env: Object.assign({}, process.env, { PM_RETRO_QUIET: '' }),
    });
  } catch (err) {
    // A spawn failure is still not allowed to block anything.
    return {
      captured: false, refused: false, code: null, stdout: '', stderr: '',
      warnings: [`capture could not be spawned: ${safeMessage(err)}`], argv, target,
    };
  }

  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  const warnings = [];
  let m;
  WARNING_RE.lastIndex = 0;
  while ((m = WARNING_RE.exec(stderr)) !== null) warnings.push(m[1]);
  if (res.error) warnings.push(`capture process error: ${safeMessage(res.error)}`);

  const captured = SUCCESS_RE.test(stdout);
  return {
    captured,
    // REFUSED, not merely "not captured": the process ran and declined to write. This is the
    // state the exit code cannot express.
    refused: !captured && res.error === undefined,
    code: res.status === undefined ? null : res.status,
    stdout, stderr, warnings, argv, target,
  };
}

function push(argv, flag, value) {
  if (value === undefined || value === null || value === '') return argv;
  argv.push(flag, String(value));
  return argv;
}

// ---------- the three capture sites ----------

/**
 * AC-1 + AC-2 + AC-5 — the DISPATCH record. Tier, why, and what it was estimated to cost.
 *
 * `usageEstimate` is passed through as-is when it is a number and OMITTED FROM ARGV when it
 * is not — which makes `retro-capture.js` write the key as explicit null, because it emits
 * every field its level defines whether or not a flag supplied it. Passing `--usage-estimate
 * ''` instead would record the empty string, and `--usage-estimate 0` would record a
 * measurement nobody made.
 */
function captureTierAssignment(unit, opts) {
  const argv = ['--level', 'story', '--id', unit.id, '--stage', 'dispatch'];
  push(argv, '--phase', unit.phase);
  push(argv, '--chat', unit.chat);
  push(argv, '--tier', unit.tier);
  push(argv, '--tier-reason', unit.tierReason);
  push(argv, '--tier-note', unit.tierNote);
  if (typeof unit.usageEstimate === 'number' && Number.isFinite(unit.usageEstimate)) {
    push(argv, '--usage-estimate', unit.usageEstimate);
  }
  return capture(argv, opts);
}

/** AC-2 — the CLOSE record. The outcome, joined to the dispatch record on `id`. */
function captureStoryOutcome(unit, opts) {
  const argv = ['--level', 'story', '--id', unit.id, '--stage', 'close'];
  push(argv, '--phase', unit.phase);
  push(argv, '--chat', unit.chat);
  push(argv, '--tier', unit.tier);
  push(argv, '--estimate-vs-actual', unit.estimateVsActual);
  push(argv, '--bugs', unit.bugs);
  push(argv, '--adrs', unit.adrs);
  push(argv, '--wall-clock-s', unit.wallClockS);
  if (unit.rework === true) argv.push('--rework');
  else if (unit.rework === false) argv.push('--no-rework');
  push(argv, '--friction', unit.friction);
  push(argv, '--kit-signal', unit.kitSignal);
  return capture(argv, opts);
}

/**
 * AC-3 — a governor decision. Routed to `pause` when it caused one and `run` when it did not,
 * under the SAME field names either way.
 */
function captureGovernorEvent(event, opts) {
  const level = levelForGovernorAction(event.action);
  const argv = ['--level', level, '--id', event.runId];
  push(argv, '--phase', event.phase);
  push(argv, '--chat', event.chat);
  push(argv, '--governor-action', event.action);
  push(argv, '--percent-used', event.percentUsed);
  push(argv, '--threshold', event.threshold);
  push(argv, '--reset-at', event.resetAt);
  if (level === 'pause') {
    push(argv, '--action', event.resumedAt ? 'resume' : 'pause');
    push(argv, '--resumed-at', event.resumedAt);
    push(argv, '--resume-mechanism', event.resumeMechanism);
  }
  const result = capture(argv, opts);
  result.level = level;
  return result;
}

// ---------- the never-blocking seam ----------

/**
 * AC-4 — capture, then dispatch. THE DISPATCH HAPPENS WHATEVER THE CAPTURE DID.
 *
 * The ordering is deliberate: capture FIRST, so a capture that hangs or crashes is visible in
 * the one place it can still be recovered from, and dispatch UNCONDITIONALLY, so no capture
 * outcome can ever gate work. Contrast `autopilot-plan.js`, where the write is the gate — the
 * asymmetry between authorisation and reflection is the whole shape of EPIC-26.
 *
 * A refusal is REPORTED, not swallowed: it is on `result.capture.refused`, its reasons are in
 * `.warnings`, and this function writes them to stderr so an unattended run leaves a trace.
 */
function dispatchWithCapture(unit, dispatch, opts) {
  const options = opts || {};
  let captureResult;
  try {
    captureResult = captureTierAssignment(unit, options);
  } catch (err) {
    // Belt-and-braces: `capture()` is contracted never to throw.
    captureResult = {
      captured: false, refused: false, code: null, stdout: '', stderr: '',
      warnings: [`capture threw: ${safeMessage(err)}`], argv: [],
    };
  }

  if (!captureResult.captured) {
    const why = captureResult.warnings.length
      ? captureResult.warnings.join('; ')
      : 'no reason given';
    try {
      process.stderr.write(
        `⚠ autopilot-decision-capture: the tier record for ${unit.id} was NOT written `
        + `(${captureResult.skipped || (captureResult.refused ? 'REFUSED' : 'not captured')}) `
        + `— ${why}. Dispatching anyway; capture never blocks work.\n`);
    } catch { /* a diagnostic must not take the run down either */ }
  }

  const dispatched = typeof dispatch === 'function'
    ? { ran: true, value: dispatch({ unit, capture: captureResult }) }
    : { ran: false, value: undefined };

  return { capture: captureResult, dispatched: dispatched.ran, result: dispatched.value };
}

// ---------- CLI ----------

function usage(msg) {
  if (msg) console.error(msg);
  console.error('usage: node autopilot-decision-capture.js tier --id <STORY-ID> --tier <low|high> '
    + `--reason <${TIER_REASONS.join('|')}> [--note <text>] [--usage-estimate <int>] `
    + '[--run-id <run_id>]');
  console.error('       node autopilot-decision-capture.js governor --run-id <run_id> '
    + `--action <${GOVERNOR_ACTIONS.join('|')}> [--percent-used <n>] [--threshold <n>] `
    + '[--reset-at <iso>] [--resumed-at <iso>] [--resume-mechanism <text>]');
  console.error('       common: [--phase <id>] [--chat <id>] [--out <ledger path>] '
    + '[--reports-dir <dir>] [--json]');
  console.error('  --out <ledger path> writes the record somewhere other than the production '
    + '41-Reports/retro/retro-log.jsonl — use it for any ad-hoc invocation. Without --out, a '
    + 'production write needs a --run-id this repository has a run plan or checkpoint for; '
    + 'otherwise nothing is written and the refusal names the path it would have used.');
  // ALWAYS 0. Even a usage error must not become an exit code a dispatch could gate on.
  return 0;
}

function main(argv) {
  const args = argv.slice(2);
  const mode = args.shift();
  const flags = Object.create(null);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') { flags.json = true; continue; }
    if (a.indexOf('--') !== 0) return usage(`unexpected argument "${a}"`);
    const v = args[i + 1];
    if (v === undefined || String(v).indexOf('--') === 0) { flags[a.slice(2)] = null; continue; }
    flags[a.slice(2)] = v;
    i++;
  }
  const common = { phase: flags.phase, chat: flags.chat };
  // THE RUN CONTEXT, not the record's `--id`. A story-level record belongs to a run too, and
  // `--id STORY-x` says nothing about whether that run was ever authorised (STORY-29.1.01).
  const opts = {
    out: flags.out, runId: flags['run-id'], reportsDir: flags['reports-dir'],
  };

  let result;
  if (mode === 'tier') {
    if (!flags.id) return usage('tier: --id is required');
    const est = flags['usage-estimate'];
    result = captureTierAssignment(Object.assign({
      id: flags.id, tier: flags.tier, tierReason: flags.reason, tierNote: flags.note,
      usageEstimate: /^\d{1,15}$/.test(String(est)) ? Number(est) : null,
    }, common), opts);
  } else if (mode === 'governor') {
    if (!flags['run-id']) return usage('governor: --run-id is required');
    result = captureGovernorEvent(Object.assign({
      runId: flags['run-id'], action: flags.action,
      percentUsed: flags['percent-used'], threshold: flags.threshold,
      resetAt: flags['reset-at'], resumedAt: flags['resumed-at'],
      resumeMechanism: flags['resume-mechanism'],
    }, common), opts);
  } else {
    return usage(`unknown mode ${JSON.stringify(mode)}`);
  }

  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else if (result.captured) console.log(`captured: ${result.argv.join(' ')}`);
  else {
    const because = result.skipped || (result.refused ? 'refused' : 'failed');
    console.error(`NOT CAPTURED (${because}): `
      + `${result.warnings.join('; ') || 'no reason given'}`);
  }
  // ALWAYS 0. See the header.
  return 0;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = {
  CAPTURE_SCRIPT, TIER_REASONS, GOVERNOR_ACTIONS, PAUSING_ACTIONS,
  levelForGovernorAction, capture,
  captureTierAssignment, captureStoryOutcome, captureGovernorEvent,
  dispatchWithCapture, main,
};
