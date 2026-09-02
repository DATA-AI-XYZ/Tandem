#!/usr/bin/env node
/**
 * autopilot-checkpoint.js — checkpoint terminal state and per-run identity
 * (STORY-26.4.02, PRD-Autonomous-Execution §B.2, ADR-0152 extending ADR-0083).
 *
 * ============================================================================
 * "IT FINISHED" AND "IT STOPPED RESPONDING AT 3AM" USED TO LOOK IDENTICAL
 * ============================================================================
 * ADR-0083's checkpoint carries `paused` and nothing else, so the only thing it can say
 * about a run that is not paused is nothing at all. A run that reached its stop condition
 * and a run whose harness died mid-story produce byte-comparable checkpoints. This module
 * adds a `state` and, when the run ends, a `terminal` block — ADDITIVELY, leaving every
 * existing key intact.
 *
 * ---------------------------------------------------------------------------
 * THE STATE SET IS ENUMERATED, AND `halted` IS NOT A CATCH-ALL
 *
 *   running     in flight; nothing terminal has happened
 *   paused      governor pause, operator pause, or a confirmation gate. Resumable.
 *               The existing `paused` block (at / reason / resume_at) is unchanged.
 *   completed   TERMINAL. The stop condition was reached.
 *   halted      TERMINAL. The run stopped WITHOUT reaching its stop condition.
 *
 * `halted` alone would hide the difference between a crash and an explicit stop, which
 * TESTPLAN-26.4.02's risk section names directly, so a halted run also carries a
 * `terminal.halt_cause` drawn from an enumerated set:
 *
 *   crash                the harness or session died; nobody wrote a reason
 *   operator-stop        a human stopped it deliberately
 *   gate-failure         fail-stops-the-chain fired (a failed TC, a raised BUG, a batch
 *                        that did not report the full success triple)
 *   governor-degraded    the usage governor could not get a signal and the run stopped
 *                        rather than guessing
 *   unknown              recorded when the cause genuinely is not known. Distinct from
 *                        `crash`: "we know it died" and "we do not know what happened"
 *                        are different facts, and collapsing them is how a catch-all
 *                        starts.
 *
 * ---------------------------------------------------------------------------
 * MIGRATION STANCE (AC-5): READ-BOTH, DERIVE ON READ, NEVER REWRITE IN PLACE
 *
 * An old-shape checkpoint has no `state` key. `readCheckpoint()` DERIVES one and marks it
 * `state_source: 'derived'` so a consumer can tell a recorded state from an inferred one:
 *
 *   a halt is RECORDED, in either spelling  ->  `halted`    (ADR-0161)
 *   a completion is RECORDED on `terminal`  ->  `completed` (ADR-0193 Amendment 1)
 *   `paused` is a non-null object           ->  `paused`
 *   otherwise                               ->  `running`
 *
 * THE HALT ARM CAME LATER, AND ITS ABSENCE WAS THE DEFECT (BUG-20260804-38). A halt is spelled
 * two ways here — the `terminal` block this module writes, and the hand-written top-level `halt`
 * block on the live checkpoint — and `autopilot-halt-ack.haltReason()` was taught BOTH while this
 * derivation was taught NEITHER. The gate keys off `state === 'halted'`, so it returned
 * `not-required` for the only real halt this repository has ever recorded, while the reader beside
 * it extracted that halt's reason in full. The word list now lives in `lib/halt-spellings.js` and
 * both read it; `halt-acknowledgement.test.js :: derivation-agrees` derives its cases from those
 * constants and requires the two answers to agree for every one.
 *
 * DERIVING `running` FROM ABSENCE IS THE WHOLE POINT, AND `completed` FROM ABSENCE WOULD BE THE
 * BUG. Nothing in the old shape can assert completion, so inferring it from the absence of a
 * pause is exactly the false reassurance this story exists to remove — an interrupted run
 * would read as a finished one, which is the pre-change behaviour wearing a new field. The
 * completion arm added by ADR-0193 Amendment 1 does not weaken this: it fires only on a `terminal`
 * block that ASSERTS the completion (`state: 'completed'`, or a boundary `TERMINAL_BOUNDARIES`
 * maps to `completed`), which is written evidence rather than the absence of evidence. Silence
 * still derives `running`; a bare ending-in-words still derives `halted`.
 *
 * The reader NEVER writes. A paused run recorded under the old shape stays resumable
 * because reading it does not touch it, and the `paused` block it carries is returned
 * unchanged. There is no migration script and no upgrade-on-read, deliberately: an
 * in-flight run's checkpoint is the one file a change like this must not race.
 *
 * ---------------------------------------------------------------------------
 * `branch` — THE RUN'S PHASE BRANCH, AND WHY IT LIVES HERE (ADR-0157)
 *
 * `skills/autopilot/SKILL.md` has documented a `"branch"` key in this file's shape since
 * STORY-26.5.03 landed, and this module had NO branch handling at all: the live checkpoint
 * reads `"branch": null` and `readCheckpoint()` did not even surface the key. That made
 * `autopilot-branch-assert.js --expected` a value with no authoritative source, so the natural
 * thing for an agent to reach for was `git rev-parse --abbrev-ref HEAD` — the same call the
 * assertion's own `currentBranch()` makes. A check whose "expected" comes from the same place
 * as its "found" can only ever pass, which is the failure mode that file's own header warns
 * about and had solved for one side only.
 *
 * So the checkpoint carries it: the branch is RECORDED WHEN THE PHASE IS OPENED, by the thing
 * that cut it, and every later assertion reads that record rather than re-deriving it. It is
 * normalised (trimmed, empty becomes null) and always present on a written record, because an
 * absent key and a null value are the same answer here — "this run cannot say which branch it
 * belongs on" — and the assertion refuses on it either way.
 *
 * ---------------------------------------------------------------------------
 * PER-RUN IDENTITY (AC-3)
 *
 * `AUTOPILOT-CHECKPOINT.json` stays the LIVE pointer — `skills/autopilot` hard-codes that
 * path and this run resumes from it. Alongside it, each run also owns
 * `AUTOPILOT-CHECKPOINT-<run_id>.json`. When a new run's checkpoint is written over a live
 * file belonging to a DIFFERENT run — and the caller SAYS that is what it is doing, see
 * `takeLive` below — the old record is ARCHIVED to its own per-run path first and the new
 * record records `supersedes_checkpoint`.
 *
 * This is not invented: the operator did it by hand on 2026-08-02, and
 * `41-Reports/AUTOPILOT-CHECKPOINT-epic23-paused-2026-08-01.json` plus the live file's
 * `supersedes_checkpoint` key are the precedent. Automating the convention that already
 * exists beats inventing a second one.
 *
 * A write that would overwrite an EXISTING per-run archive with different content is
 * REFUSED rather than resolved — that means two runs share a `run_id`, which is an
 * operator collision (ADR-0151 chose a readable id over a random one precisely so this
 * surfaces) and not something a writer should silently paper over.
 *
 * ---------------------------------------------------------------------------
 * THE DIRECTION OF TRAVEL IS DECLARED, NEVER INFERRED (ADR-0181, BUG-20260810-03)
 *
 * The paragraph above describes ONE direction: a run TAKING OVER the live pointer. Every other
 * caller in this kit travels the other way — it reads a run's own record, changes something on
 * it, and writes it back (`recordTerminal` here, `autopilot-stale-runs.scheduleResume`,
 * `autopilot-halt-ack.acknowledgeOnCheckpoint`). The writer could not tell the two apart, so an
 * update aimed at an OLD run seized the live pointer of whatever run was executing, archived the
 * in-flight run out from under itself, and stamped a false `supersedes_checkpoint` onto the
 * record it was updating. `--finish <an old run>` is documented in `skills/autopilot/SKILL.md`
 * and is exactly that shape, which is how it was found.
 *
 * So the takeover is now OPT-IN — `writeCheckpoint(dir, rec, { takeLive: true })` — and the
 * DEFAULT is the safe direction: the live pointer is written only when it is absent, unreadable,
 * or already names this run. The default was chosen deliberately: a caller that forgets
 * `takeLive` leaves a stale pointer beside an intact per-run record, which is visible and
 * recoverable; a caller that forgot to opt OUT of a takeover silently corrupted the control
 * plane. The failure of the safe default is the cheaper one.
 *
 * And the run's OWN record is the file that ALREADY carries that `run_id`, whatever it is
 * called — not `perRunName()` unconditionally. Two of the three checkpoints in this repository
 * are hand-named (`AUTOPILOT-CHECKPOINT-epic23-paused-2026-08-01.json`), so writing to the
 * conventional name would have left two files, two states and one `run_id`. Reading by content
 * and writing by content are the same rule, which is BUG-20260804-26's rule applied to the
 * writer.
 *
 * ---------------------------------------------------------------------------
 * …AND SOMETHING FINALLY WRITES THE KEY (STORY-29.1.02, BACKLOG-0148)
 *
 * ADR-0152 enumerated the states and three consumers were built on them, and NOTHING PRODUCED
 * ONE: every state on every checkpoint here was `derived`, `completed` was underivable by design,
 * and a `halted` state waited on somebody hand-writing a halt block. `recordTerminal()` is the
 * trigger — `TERMINAL_BOUNDARIES` enumerates the places the shipped skill says a run ends, and
 * `--finish <run_id> --boundary <id>` records the ending through this same single writer.
 *
 * NOTHING FIRES IT AUTOMATICALLY. A run that died leaves a stale NON-terminal state, and that
 * absence IS the died-signal: `classify()` says "IN FLIGHT OR DIED" rather than "still running"
 * and carries `in_flight_or_died`. An exit hook that tidied a crash into `halted` would destroy
 * the exact distinction ADR-0152 exists to make.
 *
 * And the round-trip question BACKLOG-0148 raised is answered: NO, a DERIVED state is never
 * written back as a recorded one. See `writeCheckpoint()`.
 *
 * Usage:
 *   node autopilot-checkpoint.js [--dir <reports-dir>] [--json]     summarise every record
 *   node autopilot-checkpoint.js --unfinished [--dir <reports-dir>] the session-start probe
 *   node autopilot-checkpoint.js --boundaries [--json]              the enumerated run boundaries
 *   node autopilot-checkpoint.js --finish <run_id> --boundary <id> [--reason "<in words>"]
 *        [--halt-cause <cause>] [--at <iso>] [--dir <reports-dir>] [--json]
 *
 * `--unfinished` ALWAYS exits 0 — session-start must never be blocked by this.
 * Exit codes: 0 = ok · 2 = usage error · 3 = a `--finish` write failed.
 *
 * Dependency-free — Node stdlib only, consistent with every other `93-Scripts/` tool.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// THE VOCABULARY OF A HALT, SHARED WITH `autopilot-halt-ack.js` RATHER THAN RESTATED HERE
// (ADR-0161). See `lib/halt-spellings.js`: this module's `deriveState()` and that module's
// `haltReason()` are two answers to two different questions, and they must be asked of the same
// word list or one of them learns a spelling the other never does — which is BUG-20260804-38.
const spellings = require(path.join(__dirname, 'lib', 'halt-spellings.js'));

const PM_ROOT = path.resolve(__dirname, '..');
const DEFAULT_REPORTS_DIR = path.join(PM_ROOT, '41-Reports');
const LIVE_NAME = 'AUTOPILOT-CHECKPOINT.json';

const STATES = Object.freeze(['running', 'paused', 'completed', 'halted']);
const TERMINAL_STATES = Object.freeze(['completed', 'halted']);
const HALT_CAUSES = Object.freeze([
  'crash', 'operator-stop', 'gate-failure', 'governor-degraded', 'unknown',
]);

// A run whose state is one of these has work left in it, and session-start must say so.
const UNFINISHED_STATES = Object.freeze(['running', 'paused', 'halted']);

/**
 * ============================================================================
 * THE RUN BOUNDARIES THAT WRITE A TERMINAL STATE (STORY-29.1.02, BACKLOG-0148)
 * ============================================================================
 * ADR-0152 enumerated the states and taught three consumers to read them. NOTHING WROTE THE KEY.
 * Every state on every checkpoint in this repository is `state_source: derived`, `completed` is
 * underivable by design, and a `halted` state depended on somebody having hand-written a halt
 * block. So "a finished run is distinguishable from a died one by reading the checkpoint alone"
 * — OKR-2026-Q3-4 — was unmeasurable, not because the reader was wrong but because no production
 * path ever recorded an ending.
 *
 * This is the trigger. Each boundary below is a place the SHIPPED SKILL or a shipped script says
 * a run ends, mapped to the state that ending produces:
 *
 *   stop-condition-reached  `skills/autopilot`: "until the stop condition fires" and the
 *                           end-of-session summary's "stop-condition exit"          -> completed
 *   plan-exhausted          the same sentence's other arm, "or the plan is exhausted" -> completed
 *   fail-stops-the-chain    the "Fail-stops-the-chain" section: a failed TC, a raised BUG or a
 *                           batch without the full success triple "halts the run immediately.
 *                           On halt: write the checkpoint"                          -> halted
 *   operator-stop           an operator stopping a run deliberately (HALT_CAUSES)    -> halted
 *   governor-degraded       the run stops rather than guessing at a missing usage signal
 *                           (ADR-0154's refuse path)                                -> halted
 *   abandonment-detected    `autopilot-stale-runs.js` surfaces a run nobody came back to and an
 *                           operator confirms it is over                            -> halted
 *
 * ---------------------------------------------------------------------------
 * NOTHING HERE FIRES BY ITSELF, AND THAT IS THE DESIGN (the story's own gotcha)
 *
 * There is no exit hook, no `process.on('exit')`, no timer that promotes a stale run to
 * `halted`. **A died run's honest signature is a stale NON-TERMINAL state**, and a writer that
 * tidied that up on the way down would destroy the one distinction this feature exists to make.
 * `abandonment-detected` is a boundary an operator TYPES after reading a stale-run notice; the
 * detector never writes it.
 */
const TERMINAL_BOUNDARIES = Object.freeze({
  'stop-condition-reached': Object.freeze({
    state: 'completed', halt_cause: null,
    describes: 'the run reached the stop condition it was authorised with',
  }),
  'plan-exhausted': Object.freeze({
    state: 'completed', halt_cause: null,
    describes: 'every phase in scope closed; there was nothing left to dispatch',
  }),
  'fail-stops-the-chain': Object.freeze({
    state: 'halted', halt_cause: 'gate-failure',
    describes: 'a failed TC, a raised BUG, or a batch that did not report the full success triple',
  }),
  'operator-stop': Object.freeze({
    state: 'halted', halt_cause: 'operator-stop',
    describes: 'a human stopped the run deliberately',
  }),
  'governor-degraded': Object.freeze({
    state: 'halted', halt_cause: 'governor-degraded',
    describes: 'the usage governor could not get a signal and the run stopped rather than guessing',
  }),
  'abandonment-detected': Object.freeze({
    state: 'halted', halt_cause: 'unknown',
    describes: 'an operator confirmed a stale run is over. NEVER written by the stale-run '
      + 'detector itself: "we do not know what happened" is the honest cause, and inferring an '
      + 'ending from silence is what this design refuses to do',
  }),
});

const BOUNDARY_IDS = Object.freeze(Object.keys(TERMINAL_BOUNDARIES));

const EXIT_OK = 0;
const EXIT_USAGE = 2;
/** A `--finish` that could not be written. Distinct from a usage error: the caller said
 *  something valid and the write failed, which is the case an unattended run must be able to
 *  tell apart. Mirrors `autopilot-stale-runs.js --schedule`. */
const EXIT_WRITE_FAILED = 3;

function safeMessage(err) {
  try {
    if (err && typeof err.message === 'string') return err.message;
    return String(err);
  } catch {
    return '(unprintable error)';
  }
}

/** One spelling of "what counts as a recorded branch", used on read and on write so the two
 *  can never disagree. Empty / whitespace / non-string all mean "not recorded". */
function normaliseBranch(v) {
  return (typeof v === 'string' && v.trim() !== '') ? v.trim() : null;
}

function perRunName(runId) {
  return `AUTOPILOT-CHECKPOINT-${runId}.json`;
}

/** Where an UNREADABLE live pointer is set aside before it would be overwritten — beside
 *  itself, keeping the original name as a prefix so a `ls` groups them, and stamped so two
 *  quarantines never collide. Colons are stripped: this repository runs on Windows, where a
 *  colon in a filename is not a filename. */
function quarantinePath(livePath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let candidate = `${livePath}.unreadable-${stamp}`;
  let n = 1;
  while (fs.existsSync(candidate)) {
    n += 1;
    candidate = `${livePath}.unreadable-${stamp}-${n}`;
  }
  return candidate;
}

/**
 * WHERE THIS RUN'S OWN RECORD LIVES — the file that already carries the `run_id`, whatever it
 * is called, and `perRunName()` only when there is no such file (BUG-20260810-03).
 *
 * `readCheckpointForRun()` already answers by CONTENT rather than by filename (BUG-20260804-26)
 * because this repository's archived checkpoints are hand-named. The writer answered by
 * filename, so updating a hand-named archive minted a SECOND file under the conventional name
 * and left one `run_id` in two contradictory states. Reader and writer now use one rule.
 *
 * The LIVE pointer is deliberately not a candidate: it is a pointer, not a run's record, and
 * whether it gets written is decided separately in `writeCheckpoint()`.
 */
function ownRecordPath(reportsDir, runId) {
  const dir = reportsDir || DEFAULT_REPORTS_DIR;
  const conventional = path.join(dir, perRunName(runId));
  if (fs.existsSync(conventional)) return conventional;
  for (const rec of listCheckpoints(dir)) {
    if (rec.ok && !rec.live && rec.run_id === runId) return rec.path;
  }
  return conventional;
}

/** One line's worth of a reason that may be several hundred words. Truncation is MARKED, so a
 *  reader can tell a short reason from a shortened one. */
function summarise(text, max) {
  const limit = Number.isFinite(max) ? max : 160;
  const s = String(text === null || text === undefined ? '' : text).replace(/\s+/g, ' ').trim();
  return s.length <= limit ? s : `${s.slice(0, limit - 1)}…`;
}

// ---------- reading ----------

/**
 * ============================================================================
 * DOES THIS `terminal` BLOCK RECORD AN ENDING THAT WAS *NOT* A HALT?
 * (BUG-20260811-04, ADR-0193)
 * ============================================================================
 * `terminal.reason` is NEUTRAL — `recordTerminal()` writes it for all six boundaries, four of
 * which halt and two of which complete (see `TERMINAL_BOUNDARIES` and the round-2 NEW-4 note on
 * `halt_reason`). Both halt readers — `carriesHalt()` here and `autopilot-halt-ack.haltReason()`
 * — answered from that neutral key without ever asking which kind of ending it described, so
 * recording Run-1's clean stop-condition ending made a *completion* read back as a halt reason,
 * with a plausible, well-formed, wrong answer.
 *
 * THE PREDICATE IS "IS THIS A COMPLETION?", NOT "IS THIS A HALT?", AND THE ASYMMETRY IS THE POINT.
 * A completion must SAY SO — `state: 'completed'` or a boundary whose state is `completed`.
 * Silence is not a completion: a bare `{ terminal: { reason: '…' } }` (the pre-boundary shape, and
 * every case `derivation-agrees` generates off the shared vocabulary) keeps reading as a halt,
 * because `halted` remains the safe direction to be wrong in — it refuses an unacknowledged
 * resume, where the other answer proceeds silently.
 *
 * AND A POSITIVE HALT SIGNAL ALWAYS WINS over a completion signal beside it. A block claiming
 * both is a contradiction somebody must look at, and the safe reading of a contradiction is the
 * one that stops.
 *
 * ONE FUNCTION, BOTH READERS. `autopilot-halt-ack.js` already requires this module, so it calls
 * this rather than restating the rule — which is ADR-0161's whole argument, applied to the
 * question of what a `terminal` block MEANS rather than to the keys it is spelled with.
 *
 * NEVER THROWS.
 */
function terminalRecordsCompletion(terminal) {
  if (!spellings.isPlainObject(terminal)) return false;
  const read = (key) => { try { return terminal[key]; } catch { return undefined; } };

  const state = read('state');
  const stateSays = typeof state === 'string' ? state.trim() : null;
  const cause = read('halt_cause');
  const boundaryId = read('boundary');
  const boundary = (typeof boundaryId === 'string'
    && Object.prototype.hasOwnProperty.call(TERMINAL_BOUNDARIES, boundaryId.trim()))
    ? TERMINAL_BOUNDARIES[boundaryId.trim()] : null;

  // A HALT, SAID OUT LOUD, IN ANY OF THE THREE PLACES THE WRITER PUTS IT — AND "OUT LOUD" MEANS
  // IN THE VOCABULARY EVERY OTHER READER HERE USES (review MINOR-3).
  //
  // The `halt_cause` veto is STRING-ONLY, deliberately, and this comment used to overstate it by
  // implying any populated cause vetoes. A non-string truthy cause — `halt_cause: 1` — is not a
  // halt signal ANYWHERE in this pair: `firstNonEmptyString()` is string-only by contract,
  // `carriesHalt()`'s `cause` arm reads it through that function, `haltReason()`'s last-resort arm
  // tests `typeof === 'string'`, and `HALT_CAUSES` is a frozen list of strings. Vetoing on a value
  // none of those can read would make this predicate STRICTER than the readers it feeds, which is
  // ADR-0161's disagreement reintroduced one level up. Such a record is malformed, not halted, and
  // the completion it states in `state` / `boundary` is the only thing on it anybody can read.
  if (stateSays === 'halted') return false;
  if (typeof cause === 'string' && cause.trim() !== '') return false;
  if (boundary && boundary.state === 'halted') return false;

  // A COMPLETION, SAID OUT LOUD. Absence answers neither question, and answers `false` here.
  if (stateSays === 'completed') return true;
  if (boundary && boundary.state === 'completed') return true;
  return false;
}

/**
 * Does this record CARRY A HALT, in any spelling this repository has? (ADR-0161)
 *
 * Returns `{source, key, reason, thin}` or `null`. The precedence is
 * `terminal`-in-words → hand-written `halt` block → the `halt_cause` enum alone, which is the
 * SAME precedence `autopilot-halt-ack.haltReason()` applies, deliberately: `classify()` surfaces
 * this reason, and a summary that disagreed with what the gate presented would be a second
 * spelling of the defect that produced it.
 *
 * The key lists come from `lib/halt-spellings.js`. The traversal is this module's own, because
 * "what state is this run in" and "what shall I show the operator" are different questions — but
 * neither module owns the vocabulary, and a probe requires the two answers to agree for every
 * spelling the shared constants declare.
 *
 * NEVER THROWS.
 */
function carriesHalt(raw) {
  if (!spellings.isPlainObject(raw)) return null;

  const terminal = raw.terminal;
  // THE SPELLING THE LIVE CHECKPOINT ACTUALLY USES — hand-written by the operator, and the only
  // real halt this repository has ever recorded. Its presence is the record, so the state does not
  // wait on a readable reason. The `terminal` block gets no such treatment, because a COMPLETED run
  // carries one too.
  //
  // BUG-20260804-40: presence alone was too strong. The block ALSO survives after the halt is
  // resolved — that is what `resolved_at` and `resolution` are for — so deriving `halted` from
  // presence refused a resume the halt no longer blocked, on this run's own checkpoint. A resolved
  // halt is not an active halt. Scoped to the block arm only: `terminal` means the run ended, and a
  // resolution does not undo that.
  const hasBlock = spellings.isPlainObject(raw.halt) && !spellings.haltIsResolved(raw.halt);
  // BUG-20260811-04: A COMPLETION'S `terminal` BLOCK CONTRIBUTES NOTHING TO THE HALT QUESTION.
  // Its `reason` is the neutral ending-in-words, not a halt reason, and reading it as one made a
  // clean stop-condition ending report a halt that never happened. The halt-block arm below is
  // deliberately NOT gated on this: a run can complete having earlier raised a halt, and that
  // block must still answer.
  const completed = terminalRecordsCompletion(terminal);
  const inWords = completed
    ? null : spellings.firstNonEmptyString(terminal, spellings.TERMINAL_REASON_KEYS);
  const blockWords = hasBlock
    ? spellings.firstNonEmptyString(raw.halt, spellings.HALT_BLOCK_REASON_KEYS) : null;
  const cause = completed
    ? null : spellings.firstNonEmptyString(terminal, [spellings.HALT_CAUSE_KEY]);

  if (!hasBlock && inWords === null && cause === null) return null;

  // The REASON, in `haltReason()`'s precedence exactly — words on the terminal block, then words
  // in the halt block, then the enum alone.
  if (inWords) return { source: 'terminal', key: inWords.key, reason: inWords.value, thin: false };
  if (blockWords) {
    return { source: 'halt-block', key: blockWords.key, reason: blockWords.value, thin: false };
  }
  if (cause) return { source: 'halt-cause', key: cause.key, reason: cause.value, thin: true };

  // A halt block carrying no key anyone can read a reason from. IT IS STILL A HALT — this is the
  // acknowledge-blind path ADR-0160 documented and nothing could reach: the state fires the gate,
  // the absence is what the operator is asked to acknowledge.
  return { source: 'none', key: null, reason: null, thin: false };
}

/**
 * Derive a state for a record that does not carry one. See the header: SILENCE can only ever mean
 * "unfinished", never "completed".
 *
 * A RECORDED HALT DERIVES `halted` (ADR-0161, amending ADR-0152). The original two-line
 * derivation knew only `paused`, so the live checkpoint — which carries a fully populated
 * top-level `halt` block and no `state` — derived `running`, and the acknowledgement gate that
 * keys off `halted` returned `not-required` for the one halt it was built for
 * (BUG-20260804-38). `halted` is also the SAFE direction to be wrong in: it refuses an
 * unacknowledged resume, where `running` proceeds silently.
 *
 * ---------------------------------------------------------------------------
 * A RECORDED COMPLETION DERIVES `completed` (ADR-0193 Amendment 1, review MINOR-2)
 *
 * ADR-0152's rule is that ABSENCE never means completion, and it still holds: a record that says
 * nothing about how it ended derives `running`, and a bare `{ terminal: { reason: '…' } }` still
 * derives `halted`. What this arm answers is a record that SAYS SO — `terminal.state:
 * 'completed'`, or a `terminal.boundary` that `TERMINAL_BOUNDARIES` maps to `completed` — and
 * carries no top-level `state`. That is not an inference from silence; it is the same class of
 * positive, written evidence the halt arm above already accepts, read through the SAME predicate
 * both halt readers use.
 *
 * Before ADR-0193 that shape derived `halted`, because the completion's neutral ending-in-words
 * was read as a halt reason — the defect itself. Removing the conflation left it deriving
 * `running`, which is worse than either: `running` is in `UNFINISHED_STATES`, so `unfinishedRun()`
 * offers a run that recorded its own completion for RESUME, `classify()` reports
 * `in_flight_or_died` and prints "no ending was recorded at any run boundary" about a record that
 * names one, and `terminal_boundary` — which is gated on the state being terminal — hides the
 * boundary the record states. `halted` was no better: it prints `HALTED (unknown)` for a record
 * that says `completed` and puts an acknowledgement gate in front of a halt that never happened,
 * which is BUG-20260811-04 moved from the reader into the deriver.
 *
 * This cannot launder a derivation into a record: `writeCheckpoint()` writes `state` only when the
 * CALLER supplied one, so a derived `completed` is never persisted, and `recordTerminal()`'s
 * never-rewrite guard still keys off `state_source === 'recorded'`.
 *
 * ORDER MATTERS, TWICE. A checkpoint can carry BOTH a `paused` block and a halt record — this
 * one does, with `paused: null` and a resolved `halt` block — and a run that halted after being
 * paused is halted. Testing the halt first is the difference between a gate that fires and one
 * that does not. The completion arm sits BELOW the halt arm for the same reason
 * `terminalRecordsCompletion()` vetoes on a positive halt signal: a contradiction reads as the
 * ending that stops. It sits ABOVE `paused` because a run that ENDED is not still pausable, and a
 * stale pause block does not un-end it.
 */
function deriveState(raw) {
  if (carriesHalt(raw) !== null) return 'halted';
  if (raw && terminalRecordsCompletion(raw.terminal)) return 'completed';
  if (raw && raw.paused !== null && typeof raw.paused === 'object') return 'paused';
  return 'running';
}

/**
 * Read one checkpoint file. NEVER THROWS and NEVER WRITES.
 *
 * @returns {{
 *   path, exists, ok, error,
 *   run_id, state, state_source, terminal, halt_cause, paused,
 *   raw
 * }}
 * `state_source` is `'recorded'` when the file carried a `state`, `'derived'` when this
 * module inferred it from the old shape. A consumer that treats the two alike is making a
 * claim the file did not make.
 */
function readCheckpoint(filePath) {
  const out = {
    path: filePath, exists: false, ok: false, error: null,
    run_id: null, state: null, state_source: null,
    terminal: null, halt_cause: null, paused: null, branch: null, raw: null,
  };
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
    out.exists = true;
  } catch (err) {
    out.error = err && err.code ? String(err.code) : safeMessage(err);
    return out;
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    out.error = `unparseable JSON: ${safeMessage(err)}`;
    return out;
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    out.error = 'checkpoint is not a JSON object';
    return out;
  }

  out.raw = raw;
  out.ok = true;
  out.run_id = typeof raw.run_id === 'string' && raw.run_id.trim() ? raw.run_id.trim() : null;
  out.paused = raw.paused === undefined ? null : raw.paused;
  // The run's phase branch, if the record carries one. SURFACED EVEN WHEN NULL: a consumer must
  // be able to tell "no branch recorded" from "this reader does not know about branches", and
  // before ADR-0157 those two were the same absent key.
  out.branch = normaliseBranch(raw.branch);

  const recorded = typeof raw.state === 'string' ? raw.state : null;
  if (recorded !== null && STATES.indexOf(recorded) !== -1) {
    out.state = recorded;
    out.state_source = 'recorded';
  } else if (recorded !== null) {
    // A state the enum does not know. Do NOT silently fall back to a derived value — an
    // unknown state is a fact about the file and hiding it would make a future shape change
    // look like an old-shape file.
    out.state = recorded;
    out.state_source = 'unknown-value';
    out.error = `unknown state value ${JSON.stringify(recorded)} `
      + `(expected one of ${STATES.join(', ')})`;
  } else {
    out.state = deriveState(raw);
    out.state_source = 'derived';
  }

  const t = raw.terminal;
  if (t && typeof t === 'object' && !Array.isArray(t)) {
    out.terminal = t;
    out.halt_cause = typeof t.halt_cause === 'string' ? t.halt_cause : null;
  }
  return out;
}

/** Every checkpoint record under a reports dir — the live pointer plus every per-run file. */
function listCheckpoints(reportsDir) {
  const dir = reportsDir || DEFAULT_REPORTS_DIR;
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter(n => n === LIVE_NAME || /^AUTOPILOT-CHECKPOINT-.+\.json$/.test(n))
    .sort()
    .map(n => Object.assign(readCheckpoint(path.join(dir, n)), { live: n === LIVE_NAME }));
}

/**
 * The record for one run.
 *
 * ============================================================================
 * MATCH ON THE `run_id` INSIDE THE FILE, NOT ON THE FILENAME (BUG-20260804-26)
 * ============================================================================
 * This used to try `perRunName(runId)`, then the live pointer, and give up — so it could only
 * ever find checkpoints THIS module had itself named. The one archived checkpoint that actually
 * exists in this repository is `AUTOPILOT-CHECKPOINT-epic23-paused-2026-08-01.json`, written by
 * hand by the operator; `perRunName()` would call it
 * `AUTOPILOT-CHECKPOINT-autopilot-2026-07-31-epic23-epic24.json`. `listCheckpoints()` found the
 * file and `unfinishedRun()` reported it PAUSED — while THIS function, the API built to reach a
 * named run, returned "no checkpoint record". The header above cites that very file as the
 * convention being automated; a second convention was invented instead.
 *
 * So the fallback is a CONTENT scan: the filename is a hint, the `run_id` inside is the fact.
 * The two positional lookups stay because they are O(1) and they are right in the common case;
 * the scan is what makes the answer true rather than conventional.
 *
 * The per-run file is preferred over the live pointer when both carry the run, and the live
 * pointer over an arbitrary scan hit — a run's own archive is its own record.
 */
function readCheckpointForRun(reportsDir, runId) {
  const dir = reportsDir || DEFAULT_REPORTS_DIR;
  const own = path.join(dir, perRunName(runId));
  if (fs.existsSync(own)) {
    const rec = readCheckpoint(own);
    // Only if it really is that run's. A file named for one run and holding another is a
    // collision, not a match, and answering from the name would hide it.
    if (rec.ok && rec.run_id === runId) return rec;
  }
  const live = readCheckpoint(path.join(dir, LIVE_NAME));
  if (live.ok && live.run_id === runId) return live;

  // THE FALLBACK. Whatever the file is called, if it holds this run_id it is this run.
  for (const rec of listCheckpoints(dir)) {
    if (rec.ok && rec.run_id === runId) return rec;
  }

  // A CLEAN not-found. The old else-branch did `Object.assign(live, {...})`, which returned the
  // LIVE run's `state`, `paused`, `terminal` and `raw` attached to a `ok: false` verdict — so a
  // caller that read `.paused` off a not-found result got another run's pause block. "I could
  // not find it" carries no other run's data.
  return {
    path: null, exists: false, ok: false,
    error: `no checkpoint record for run_id ${runId}`,
    run_id: null, state: null, state_source: null,
    terminal: null, halt_cause: null, paused: null, branch: null, raw: null,
  };
}

// ---------- terminal states ----------

function isTerminal(state) {
  return TERMINAL_STATES.indexOf(state) !== -1;
}

/**
 * AC-2 — completed vs halted, FROM THE CHECKPOINT ALONE.
 *
 * Returns a verdict object rather than a boolean, because "did it finish?" and "why did it
 * stop?" are two questions and a boolean can only answer one of them.
 */
function classify(record) {
  if (!record || !record.ok) {
    return {
      state: null, terminal: false, finished: false, unfinished: false,
      readable: false, branch: null,
      summary: `checkpoint unreadable${record && record.error ? ` (${record.error})` : ''}`,
    };
  }
  const state = record.state;
  const terminal = isTerminal(state);
  // THE REASON, NOT ONLY THE CATEGORY (ADR-0161). `HALTED (unknown)` beside a `halt` block
  // holding several hundred words of audit was the summary this verdict used to print — the same
  // reason the gate presents, absent from the line an operator actually reads.
  const found = state === 'halted' ? carriesHalt(record.raw) : null;
  const halt = (found && found.reason !== null) ? found : null;
  return {
    state,
    state_source: record.state_source,
    terminal,
    // THE DIED SIGNAL, STATED RATHER THAN LEFT TO BE INFERRED (STORY-29.1.02). A run that ENDS
    // records its ending at a named boundary (`recordTerminal`), so a non-terminal state on a run
    // nobody is driving means one of exactly two things and the reader must not pretend to know
    // which: it is still in flight, or it died without being able to say so. There is deliberately
    // no third answer and no exit hook that would manufacture one — a fabricated `completed` is
    // the false reassurance ADR-0152 was written to remove.
    in_flight_or_died: !terminal,
    // Which boundary recorded the ending, when one did. `null` for a derived or non-terminal
    // state: an ending nobody wrote has no boundary, and guessing one would be the same defect.
    terminal_boundary: (terminal && record.terminal && typeof record.terminal.boundary === 'string')
      ? record.terminal.boundary : null,
    terminal_at: (terminal && record.terminal && typeof record.terminal.at === 'string')
      ? record.terminal.at : null,
    finished: state === 'completed',
    // `halted` IS terminal and is still unfinished work: the run stopped short of its stop
    // condition, which is precisely what an operator returning to it needs to be told.
    unfinished: UNFINISHED_STATES.indexOf(state) !== -1,
    readable: true,
    halt_cause: state === 'halted' ? (record.halt_cause || 'unknown') : null,
    // What the gate would present, on the verdict the CLI prints. `halt_reason_source` is the
    // spelling that answered — `none` is an honest absence, not a missing feature.
    halt_reason: halt ? halt.reason : null,
    halt_reason_source: state === 'halted' ? (halt ? halt.source : 'none') : null,
    halt_reason_key: halt ? halt.key : null,
    thin_halt_reason: halt ? halt.thin : false,
    run_id: record.run_id,
    // Carried onto the verdict so a consumer that only ever sees `classify()` output — which
    // is what the CLI prints and what `unfinishedRun()` returns — can still reach the branch.
    branch: record.branch === undefined ? null : record.branch,
    summary: state === 'completed'
      ? `run ${record.run_id} COMPLETED`
      : state === 'halted'
        ? `run ${record.run_id} HALTED (${record.halt_cause || 'unknown'}) — `
          + (halt
            ? `${halt.source}.${halt.key}: ${summarise(halt.reason)}`
            : 'no reason recorded')
        : state === 'paused'
          ? `run ${record.run_id} PAUSED`
          // "IN FLIGHT OR DIED" — never "still running" flatly. The old wording read as a
          // positive statement about a process nothing here can see (STORY-29.1.02).
          : `run ${record.run_id} IN FLIGHT OR DIED — state ${record.state} `
            + `(${record.state_source}); no ending was recorded at any run boundary`,
  };
}

/**
 * AC-6 — the signal `session-start` reads. From the checkpoint alone; no board, no ledger.
 *
 * Returns `{ unfinished: false }` when nothing needs picking up, and an object NAMING the
 * run when something does. Never throws; a corrupt checkpoint is reported as unreadable
 * rather than silently treated as "nothing to do", because "I cannot tell" and "there is
 * nothing" are different answers and only one of them is safe to act on.
 */
function unfinishedRun(reportsDir) {
  const records = listCheckpoints(reportsDir);
  if (!records.length) {
    return { unfinished: false, runs: [], unreadable: [], summary: 'no checkpoint found — no run to resume' };
  }
  // De-duplicate by run_id: the live pointer and a per-run archive of the SAME run are one
  // run, not two. Without this, every live run is reported twice the moment it is archived.
  const seen = new Map();
  const unreadable = [];
  for (const r of records) {
    if (!r.ok) { unreadable.push({ path: r.path, error: r.error }); continue; }
    const key = r.run_id || r.path;
    // Prefer the per-run file's record when both exist — it is the run's own.
    if (!seen.has(key) || r.live === false) seen.set(key, r);
  }
  const verdicts = [...seen.values()].map(classify);
  const open = verdicts.filter(v => v.unfinished);
  return {
    unfinished: open.length > 0,
    runs: open,
    finished: verdicts.filter(v => !v.unfinished),
    unreadable,
    summary: open.length
      ? `unfinished run present: ${open.map(v => `${v.run_id} (${v.state})`).join(', ')}`
      : `no unfinished run — ${verdicts.length} checkpoint record(s), all terminal`,
  };
}

// ---------- writing ----------

class CheckpointCollision extends Error {
  constructor(message, collidingPath) {
    super(message);
    this.name = 'CheckpointCollision';
    this.path = collidingPath;
  }
}

/**
 * ============================================================================
 * THE LIVE POINTER IS AHEAD OF THE RECORD THE CALLER EDITED (BUG-20260817-10)
 * ============================================================================
 * `readCheckpointForRun()` PREFERS a run's own archive over the live pointer — correct for
 * reading, because a run's archive is its own record. Every updating caller in this kit
 * (`recordTerminal()`, `autopilot-stale-runs.scheduleResume()`,
 * `autopilot-halt-ack.acknowledgeOnCheckpoint()`) then reads through it, changes one thing, and
 * hands the WHOLE body back to `writeCheckpoint()` — which writes the live pointer too, because
 * the pointer already names this run. So the archive's body became the live body, and every field
 * the live record had advanced past since the archive was frozen was silently discarded.
 *
 * That is not a hypothetical: `--finish autopilot-2026-08-11-e30-run01` did exactly this on
 * 2026-08-17 and rewound `branch`, `current`, `completed.chats`, `completed.stories`, `paused`,
 * `run_log`, `resumed` and `prior_run_logs` to a snapshot frozen five days earlier — 13 insertions
 * against 31 deletions, exit 0, no warning.
 *
 * THE ANSWER IS TO REFUSE, NOT TO MERGE. Merging live-forward would make every one of these
 * callers a silent reconciler of two records that disagree, and this module's whole posture
 * (ADR-0152's never-rewrite-in-place, ADR-0181's declared direction of travel, `CheckpointCollision`
 * beside this class) is that two contradictory records are something a human looks at. The refusal
 * NAMES the diverging keys so the human has somewhere to start.
 *
 * The guard has two arms, and the second one exists because the first is opt-in:
 *
 *   basedOn DECLARED   compare-and-swap. The caller says which body it edited; if the live
 *                      pointer no longer holds that body, writing would erase the difference.
 *   basedOn ABSENT     the writer compares the run's own archive against the live pointer itself.
 *                      If those two disagree, the writer cannot tell which one the caller edited,
 *                      and picking is how this bug happened. It refuses rather than guessing.
 *
 * Without the second arm a future caller that forgot `basedOn` would silently reintroduce the
 * defect — the same opt-in fail-open shape as BUG-20260811-02.
 */
class CheckpointDivergence extends Error {
  constructor(message, keys) {
    super(message);
    this.name = 'CheckpointDivergence';
    this.keys = Object.freeze((keys || []).slice());
  }
}

/**
 * Which TOP-LEVEL keys two checkpoint bodies disagree about, absence included: a key the live
 * record carries and the base does not is progress the base would erase, which is the exact shape
 * `resumed` and `prior_run_logs` took in the live incident.
 *
 * A value that cannot be serialised counts as DIVERGENT rather than equal — the safe direction to
 * be wrong in here is the one that refuses.
 */
function divergentKeys(base, live) {
  const l = spellings.isPlainObject(base) ? base : {};
  const r = spellings.isPlainObject(live) ? live : {};
  const names = [...new Set([...Object.keys(l), ...Object.keys(r)])].sort();
  const out = [];
  for (const k of names) {
    let a; let b;
    try { a = JSON.stringify(l[k]); } catch { a = '\u0000uncomparable-base'; }
    try { b = JSON.stringify(r[k]); } catch { b = '\u0000uncomparable-live'; }
    if (a !== b) out.push(k);
  }
  return out;
}

function stateFor(record) {
  if (typeof record.state === 'string') return record.state;
  return deriveState(record);
}

/** Did the CALLER supply a state, or did this module have to infer one? The distinction the
 *  writer has to keep, for the same reason `readCheckpoint()` reports `state_source`. */
function stateWasRecorded(record) {
  return typeof record.state === 'string' && record.state.trim() !== '';
}

/**
 * Write a checkpoint. ADDITIVE: whatever keys the caller's record carries are written
 * through unchanged; this function only ensures `run_id`, `state` and (for a terminal
 * state) `terminal` are present and consistent.
 *
 * ---------------------------------------------------------------------------
 * A DERIVED STATE IS NEVER WRITTEN BACK AS A RECORDED ONE (STORY-29.1.02)
 *
 * BACKLOG-0148 spotted this before anything could hit it, and asked whoever built the terminal
 * writer to decide it: `stateFor()` DERIVES when the record carries no `state`, so a record with
 * a `halt` block that was round-tripped through here gained `state: "halted"` AND a synthesised
 * `terminal: { state: 'halted', at: null, halt_cause: 'unknown' }` — a derivation written back as
 * a recorded fact, which is exactly what ADR-0152's never-rewrite-in-place stance rejects. It was
 * survivable only because nothing called this writer on the live file, and ADR-0161 made
 * `autopilot-halt-ack.js --record` reachable, which would have been the first thing to do so.
 *
 * THE ANSWER IS NO. A state the caller did not supply is not written at all: the key stays
 * absent and `readCheckpoint()` keeps deriving it, exactly as it does for every old-shape file.
 * The derived value is still VALIDATED (an out-of-enum state is still refused) — it is simply not
 * recorded. Only `recordTerminal()` below, driven by a named run boundary, produces a recorded
 * terminal state and a `terminal` block, and a `halt_cause` on it is a fact somebody asserted
 * rather than the `unknown` a fallback picked.
 *
 * Per-run identity: always writes the run's OWN record; writes the live pointer only when this
 * run already holds it, when nothing holds it, or when the caller declares a takeover with
 * `opts.takeLive === true` (see the header — ADR-0181). A takeover, and only a takeover,
 * archives the incumbent and stamps `supersedes_checkpoint`.
 *
 * `basedOn` is the body the caller READ before editing it — an updating caller must declare it,
 * so this writer can refuse rather than rewind when the live pointer has moved on (see
 * `CheckpointDivergence`). Omitting it is not a bypass: the writer then compares the run's own
 * archive against the live pointer itself and refuses if THOSE disagree.
 *
 * @param {{at?: string, haltCause?: string, takeLive?: boolean, basedOn?: object}} [opts]
 * @returns {{livePath, ownPath, archived, tookLive, record}} `livePath` is null when the live
 *          pointer was left alone — a caller reporting where it wrote must not name a file it
 *          did not write.
 */
function writeCheckpoint(reportsDir, record, opts) {
  const dir = reportsDir || DEFAULT_REPORTS_DIR;
  const options = opts || {};
  if (!record || typeof record !== 'object') throw new Error('writeCheckpoint needs a record object');
  const runId = typeof record.run_id === 'string' ? record.run_id.trim() : '';
  if (!runId) throw new Error('writeCheckpoint needs a non-empty run_id');

  const state = stateFor(record);
  if (STATES.indexOf(state) === -1) {
    throw new Error(`unknown state ${JSON.stringify(state)} (expected one of ${STATES.join(', ')})`);
  }
  const recorded = stateWasRecorded(record);
  // `branch` is ALWAYS written, null included (ADR-0157) — a key that appears only when set
  // makes "not recorded" indistinguishable from "written before branches were carried", and
  // the assertion that reads it has to refuse on both anyway.
  const out = Object.assign({}, record, {
    run_id: runId, branch: normaliseBranch(record.branch),
  });
  // …and `state` is written ONLY when the caller stated one. See the header: writing a derived
  // value here would launder an inference into a record. `state` is deliberately NOT like
  // `branch` on this point — a null branch and an absent branch mean the same thing to the one
  // consumer that reads it, whereas a recorded state and a derived state are different facts and
  // `readCheckpoint()` exists to tell them apart.
  if (recorded) out.state = state;
  else delete out.state;

  if (recorded && isTerminal(state)) {
    const t = Object.assign({}, out.terminal || {});
    t.state = state;
    if (!t.at) t.at = options.at || null;
    if (state === 'halted') {
      const cause = t.halt_cause || options.haltCause || 'unknown';
      if (HALT_CAUSES.indexOf(cause) === -1) {
        throw new Error(`unknown halt_cause ${JSON.stringify(cause)} `
          + `(expected one of ${HALT_CAUSES.join(', ')})`);
      }
      t.halt_cause = cause;
    } else {
      t.halt_cause = null;
    }
    out.terminal = t;
  } else if (out.terminal === undefined) {
    out.terminal = null;
  }

  fs.mkdirSync(dir, { recursive: true });
  const livePath = path.join(dir, LIVE_NAME);
  const ownPath = ownRecordPath(dir, runId);

  // WHOSE POINTER IS IT? A write only takes `AUTOPILOT-CHECKPOINT.json` when it is this run's
  // already, when nobody's name is on it, or when the caller declared a takeover. See the
  // header: an update to an OLD run must never repoint the live file at it (BUG-20260810-03).
  const existingLive = readCheckpoint(livePath);
  const liveNamesThisRun = existingLive.ok && existingLive.run_id === runId;
  const liveIsUnclaimed = !existingLive.ok || !existingLive.run_id;
  const tookLive = options.takeLive === true || liveNamesThisRun || liveIsUnclaimed;

  // NEVER REWIND THE LIVE POINTER TO A STALE BASE (BUG-20260817-10). See `CheckpointDivergence`
  // above for why this refuses rather than merging, and why it has two arms. It runs BEFORE any
  // filesystem side effect — no quarantine, no archive, no write — so a refusal leaves the
  // directory byte-identical.
  if (tookLive && existingLive.ok && existingLive.run_id === runId) {
    const declared = spellings.isPlainObject(options.basedOn) ? options.basedOn : null;
    const fallbackPath = ownPath === livePath ? null : ownPath;
    const fallback = declared === null && fallbackPath !== null ? readCheckpoint(fallbackPath) : null;
    const base = declared !== null
      ? { body: declared, where: 'the record this caller read and edited' }
      : (fallback && fallback.ok && fallback.run_id === runId
        ? { body: fallback.raw, where: `the run's own archive ${path.basename(fallbackPath)}` }
        : null);
    if (base !== null) {
      const drift = divergentKeys(base.body, existingLive.raw);
      if (drift.length) {
        throw new CheckpointDivergence(
          `refusing to write the live checkpoint for run ${runId}: ${base.where} disagrees with `
          + `${LIVE_NAME} on ${drift.length} key(s) — ${drift.join(', ')}. Writing would REWIND the `
          + 'live pointer to the older body and silently discard everything recorded since '
          + '(BUG-20260817-10). Reconcile the two records by hand — decide which body is true, make '
          + `${LIVE_NAME} and ${path.basename(ownPath)} agree, then re-run this command. This writer `
          + 'does not merge two records that disagree (ADR-0152, ADR-0181).', drift);
      }
    }
  }

  // AN UNREADABLE POINTER IS QUARANTINED, NEVER DESTROYED (review round-2 NEW-3).
  //
  // A live file that exists and does not parse counts as "unclaimed" above — nobody's name is
  // legible on it — so the next write took it. That was overwrite-in-place: the archive branch
  // below cannot fire (it needs `existingLive.ok`), so the bytes were gone. ADR-0181 recorded
  // that as an accepted edge; the round-2 reviewer disagreed, and they are right. A corrupt
  // pointer is usually a truncated or half-flushed write, which is exactly the case where the
  // original bytes are the only evidence of what the run was doing — and the cost of keeping
  // them is one rename.
  //
  // If the quarantine itself fails, the live write is ABANDONED rather than forced. The run's
  // own record is still written, so nothing is lost; a corrupt pointer an operator can see and
  // delete is recoverable, and destroying it on the way past is not.
  let quarantined = null;
  let quarantineError = null;
  if (tookLive && existingLive.exists && !existingLive.ok) {
    try {
      quarantined = quarantinePath(livePath);
      fs.renameSync(livePath, quarantined);
    } catch (err) {
      quarantined = null;
      quarantineError = safeMessage(err);
    }
  }
  const writesLive = tookLive && quarantineError === null;

  // ARCHIVE a live pointer that belongs to a different run, before it is overwritten. Only a
  // TAKEOVER reaches here — an update that leaves the pointer alone displaces nothing, so there
  // is nothing to archive and nothing it supersedes.
  let archived = null;
  if (tookLive && existingLive.ok && existingLive.run_id && existingLive.run_id !== runId) {
    const archivePath = path.join(dir, perRunName(existingLive.run_id));
    if (fs.existsSync(archivePath)) {
      const already = fs.readFileSync(archivePath, 'utf8');
      const incoming = fs.readFileSync(livePath, 'utf8');
      if (already !== incoming) {
        throw new CheckpointCollision(
          `refusing to overwrite the archived checkpoint at ${archivePath} with a different `
          + `record for the same run_id ${existingLive.run_id} — two runs sharing a run_id is `
          + 'an operator collision, not something this writer should resolve', archivePath);
      }
    } else {
      fs.writeFileSync(archivePath, fs.readFileSync(livePath, 'utf8'), 'utf8');
    }
    archived = archivePath;
    if (!out.supersedes_checkpoint) {
      out.supersedes_checkpoint = `41-Reports/${perRunName(existingLive.run_id)}`;
    }
  }

  const text = JSON.stringify(out, null, 2) + '\n';
  fs.writeFileSync(ownPath, text, 'utf8');
  if (writesLive) fs.writeFileSync(livePath, text, 'utf8');
  return {
    livePath: writesLive ? livePath : null,
    ownPath,
    archived,
    tookLive: writesLive,
    quarantined,
    quarantineError,
    record: out,
  };
}

/**
 * ============================================================================
 * THE PRODUCTION TRIGGER (STORY-29.1.02, closing BACKLOG-0148's writer half)
 * ============================================================================
 * Record that a run ENDED, at a named boundary, through the single writer (ADR-0153). This is
 * the only thing in the kit that produces a RECORDED terminal state; everything else derives, and
 * `writeCheckpoint()` above will not launder a derivation into a record.
 *
 * @param {string} reportsDir
 * @param {string} runId
 * @param {{boundary: string, reason?: string, at?: string, haltCause?: string}} opts
 *        `boundary` is a key of `TERMINAL_BOUNDARIES` and supplies the state and the default
 *        cause. `reason` is the ending IN WORDS — `halt_cause` is a category and a category is
 *        not an explanation (the `thin` distinction `autopilot-halt-ack.haltReason()` makes).
 *        `haltCause` overrides the boundary's default for a halt whose cause is genuinely a
 *        different member of `HALT_CAUSES`.
 * @returns {{livePath, ownPath, archived, tookLive, record, boundary, state, previous}}
 *
 * ---------------------------------------------------------------------------
 * IT ENDS THE RUN IT WAS NAMED, AND NOTHING ELSE (BUG-20260810-03, ADR-0181)
 *
 * This is the first caller that writes a run which is FINISHING rather than one that is taking
 * over, and `abandonment-detected` is DEFINED as being aimed at a run that is not the live one —
 * `skills/autopilot/SKILL.md` tells an operator to type it after reading a stale-run notice. It
 * therefore never declares `takeLive`. Finishing an OLD run writes that run's own record and
 * leaves `AUTOPILOT-CHECKPOINT.json` byte-for-byte alone; finishing the LIVE run updates the
 * pointer as before, because the pointer already names it.
 *
 * THROWS, deliberately, on:
 *   - an unknown boundary — a free-text ending cannot be counted, which is ADR-0152's whole point
 *   - a run with no readable checkpoint — a terminal state for a run nothing recorded is a
 *     fabrication, the same argument ADR-0177 makes about the ledger
 *   - a run that ALREADY carries a DIFFERENT recorded terminal state — ADR-0152 says never
 *     rewrite in place, and "it completed, no, it halted" is a fact somebody has to look at.
 *     Re-recording the SAME ending is idempotent and allowed, because a retried close-out step
 *     must not be the thing that stops a run from being able to say it finished.
 */
function recordTerminal(reportsDir, runId, opts) {
  const options = opts || {};
  const boundaryId = typeof options.boundary === 'string' ? options.boundary.trim() : '';
  const boundary = TERMINAL_BOUNDARIES[boundaryId];
  if (!boundary) {
    throw new Error(`unknown run boundary ${JSON.stringify(options.boundary)} `
      + `(expected one of ${BOUNDARY_IDS.join(', ')})`);
  }

  // REFUSE LOUDLY, AND NAME WHAT WAS LOOKED FOR (BUG-20260810-03). A `--finish` for a run this
  // directory has no record of used to say only "no checkpoint record", which reads as "the tool
  // is broken" rather than "you typed a run id nothing here has heard of" — and the previous
  // writer would then have gone on to MINT a record for it over the live pointer. There is no
  // guessing left: a run with no record on disk cannot be recorded as having ended.
  const dir = reportsDir || DEFAULT_REPORTS_DIR;
  const rec = readCheckpointForRun(reportsDir, runId);
  if (!rec.ok || !rec.raw) {
    const seen = listCheckpoints(dir)
      .map(r => `${path.basename(String(r.path))}${r.ok && r.run_id ? ` (${r.run_id})` : ' (unreadable)'}`);
    throw new Error(`cannot record a terminal state for ${runId}: `
      + `${rec.error || 'no readable checkpoint record'}. Looked for `
      + `${perRunName(runId)}, then ${LIVE_NAME}, then every checkpoint under ${dir} `
      + `by run_id — found ${seen.length ? seen.join(', ') : 'no checkpoint files at all'}`);
  }

  const state = boundary.state;
  const previous = (rec.state_source === 'recorded' && isTerminal(rec.state)) ? rec.state : null;
  if (previous !== null && previous !== state) {
    throw new Error(`run ${runId} already recorded the terminal state ${JSON.stringify(previous)}; `
      + `refusing to rewrite it as ${JSON.stringify(state)} (ADR-0152: a terminal state is `
      + 'never rewritten in place — a run that ended twice is something a human should look at)');
  }

  const at = typeof options.at === 'string' && options.at.trim() !== ''
    ? options.at.trim() : new Date().toISOString();
  const cause = state === 'halted'
    ? (options.haltCause || boundary.halt_cause || 'unknown') : null;
  if (state === 'halted' && HALT_CAUSES.indexOf(cause) === -1) {
    throw new Error(`unknown halt_cause ${JSON.stringify(cause)} `
      + `(expected one of ${HALT_CAUSES.join(', ')})`);
  }

  const terminal = Object.assign({}, rec.raw.terminal || {}, {
    state,
    at,
    halt_cause: cause,
    // WHICH boundary ended it. `halt_cause` says what KIND of ending; this says WHERE in the run
    // it was recorded, which is what a reader reconstructing the run actually needs.
    boundary: boundaryId,
  });
  if (typeof options.reason === 'string' && options.reason.trim() !== '') {
    // The words, under a key that does not lie about them (review round-2 NEW-4).
    //
    // This wrote `halt_reason` for EVERY ending, so the 2026-08-02 run — which reached its stop
    // condition and closed 13/13 phases — recorded its success under a field named for halting.
    // Four of the six boundaries are halts and two are completions; a key that is right for two
    // thirds of the enum is still a falsehood on the other third, and this is a record a human
    // reads years later to find out what happened.
    //
    // `reason` is NEUTRAL and was ALREADY a recognised spelling in `TERMINAL_REASON_KEYS`
    // (ADR-0161's shared vocabulary), so the readers needed no change and `halt_reason` keeps
    // working for records already written under it. One writer, one key, both readable.
    terminal.reason = options.reason.trim();
  }

  const next = Object.assign({}, rec.raw, { state, terminal });
  // `basedOn` DECLARES WHICH BODY THIS EDIT WAS MADE AGAINST (BUG-20260817-10). `rec` may be the
  // run's ARCHIVE — `readCheckpointForRun()` prefers it — while the live pointer for the same run
  // has advanced past it. Handing the archive's body back would rewind the live record; the writer
  // refuses instead, naming the keys that disagree.
  const written = writeCheckpoint(reportsDir, next, {
    at, haltCause: cause || undefined, basedOn: rec.raw,
  });
  return Object.assign(written, { boundary: boundaryId, state, previous });
}

// ---------- CLI ----------

function usage(msg) {
  if (msg) console.error(msg);
  console.error('usage: node autopilot-checkpoint.js [--dir <reports-dir>] [--unfinished] [--json]');
  console.error('       node autopilot-checkpoint.js --boundaries [--json]');
  console.error('       node autopilot-checkpoint.js --finish <run_id> --boundary <id> '
    + '[--reason "<in words>"] [--halt-cause <cause>] [--at <iso>] [--dir <reports-dir>] [--json]');
  console.error(`  boundaries: ${BOUNDARY_IDS.join(' | ')}`);
  console.error('  --finish RECORDS that a run ended, at a named boundary. It is the only path '
    + 'that writes a terminal state; everything else derives one on read. Nothing fires it '
    + 'automatically — a run that died leaves a stale NON-terminal state, on purpose.');
  return EXIT_USAGE;
}

function main(argv) {
  const args = argv.slice(2);
  let dir = DEFAULT_REPORTS_DIR;
  let wantUnfinished = false;
  let wantBoundaries = false;
  let asJson = false;
  const finish = { runId: null, boundary: null, reason: null, haltCause: null, at: null };
  const value = (flag, args_, i) => {
    const v = args_[i];
    return (v === undefined || String(v).indexOf('--') === 0) ? null : v;
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dir') {
      const v = args[++i];
      if (v === undefined || String(v).indexOf('--') === 0) return usage('--dir requires a value');
      dir = v;
    } else if (a === '--unfinished') wantUnfinished = true;
    else if (a === '--boundaries') wantBoundaries = true;
    else if (a === '--json') asJson = true;
    else if (a === '--finish' || a === '--boundary' || a === '--reason'
             || a === '--halt-cause' || a === '--at') {
      const v = value(a, args, i + 1);
      if (v === null) return usage(`${a} requires a value`);
      i++;
      if (a === '--finish') finish.runId = v;
      else if (a === '--boundary') finish.boundary = v;
      else if (a === '--reason') finish.reason = v;
      else if (a === '--halt-cause') finish.haltCause = v;
      else finish.at = v;
    } else return usage(`unknown argument "${a}"`);
  }

  if (wantBoundaries) {
    if (asJson) { console.log(JSON.stringify(TERMINAL_BOUNDARIES, null, 2)); return EXIT_OK; }
    console.log(`autopilot-checkpoint — ${BOUNDARY_IDS.length} run boundaries that record an ending`);
    for (const id of BOUNDARY_IDS) {
      const b = TERMINAL_BOUNDARIES[id];
      console.log(`  ${id} -> ${b.state}${b.halt_cause ? ` (${b.halt_cause})` : ''}`);
      console.log(`      ${b.describes}`);
    }
    return EXIT_OK;
  }

  if (finish.runId !== null || finish.boundary !== null) {
    if (!finish.runId) return usage('--finish requires a run_id');
    if (!finish.boundary) {
      return usage(`--finish requires --boundary <${BOUNDARY_IDS.join('|')}>`);
    }
    let res;
    try {
      res = recordTerminal(dir, finish.runId, {
        boundary: finish.boundary, reason: finish.reason,
        haltCause: finish.haltCause, at: finish.at,
      });
    } catch (err) {
      console.error(`could not record the terminal state: ${safeMessage(err)}`);
      return EXIT_WRITE_FAILED;
    }
    // SAY EVERY FILE IT TOUCHED (MINOR-3 of AI-CODE-REVIEW-E29-CHAT-01-02). The success line
    // used to print `-> <ownPath>` alone while the writer also moved the live pointer and
    // archived somebody else's run — the silence is what let BUG-20260810-03 run undetected.
    if (asJson) {
      console.log(JSON.stringify({
        run_id: finish.runId, boundary: res.boundary, state: res.state,
        terminal: res.record.terminal, path: res.ownPath,
        live_pointer: res.tookLive ? res.livePath : null,
        live_pointer_untouched: !res.tookLive,
        archived: res.archived,
        quarantined: res.quarantined || null,
        quarantine_error: res.quarantineError || null,
      }, null, 2));
    } else {
      console.log(`run ${finish.runId} recorded ${res.state} at boundary ${res.boundary} `
        + `(${res.record.terminal.at}) -> ${res.ownPath}`);
      console.log(res.tookLive
        ? `  live pointer -> ${res.livePath}`
        : `  live pointer LEFT ALONE (it names another run) -> ${path.join(dir, LIVE_NAME)}`);
      if (res.archived) console.log(`  archived the displaced run -> ${res.archived}`);
      // Never silent: a quarantined pointer is a fact an operator has to be told, and a FAILED
      // quarantine means the live pointer is still corrupt and was deliberately not written.
      if (res.quarantined) {
        console.log(`  the live pointer could not be read and was SET ASIDE, not overwritten `
          + `-> ${res.quarantined}`);
      }
      if (res.quarantineError) {
        console.error(`  the live pointer is unreadable and could not be set aside `
          + `(${res.quarantineError}), so it was left untouched rather than destroyed — this `
          + `run's own record was still written to ${res.ownPath}`);
      }
    }
    return EXIT_OK;
  }

  if (wantUnfinished) {
    const v = unfinishedRun(dir);
    if (asJson) console.log(JSON.stringify(v, null, 2));
    else {
      console.log(v.summary);
      for (const r of v.runs) console.log(`  - ${r.summary}`);
      for (const u of v.unreadable) console.log(`  ! unreadable checkpoint: ${u.path} (${u.error})`);
    }
    // ALWAYS 0 — session-start must not be blocked by a checkpoint probe.
    return EXIT_OK;
  }

  const records = listCheckpoints(dir);
  if (asJson) { console.log(JSON.stringify(records.map(classify), null, 2)); return EXIT_OK; }
  console.log(`autopilot-checkpoint — ${records.length} record(s) under ${dir}`);
  for (const r of records) {
    const v = classify(r);
    console.log(`  ${r.live ? '*' : ' '} ${path.basename(r.path)} — ${v.summary}`
      + (v.readable ? ` [state ${v.state_source}]` : ''));
  }
  return EXIT_OK;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = {
  STATES, TERMINAL_STATES, HALT_CAUSES, UNFINISHED_STATES,
  TERMINAL_BOUNDARIES, BOUNDARY_IDS,
  LIVE_NAME, DEFAULT_REPORTS_DIR, perRunName, ownRecordPath, quarantinePath,
  readCheckpoint, listCheckpoints, readCheckpointForRun,
  deriveState, carriesHalt, terminalRecordsCompletion, summarise, normaliseBranch, isTerminal,
  classify, unfinishedRun,
  TERMINAL_REASON_KEYS: spellings.TERMINAL_REASON_KEYS,
  HALT_BLOCK_REASON_KEYS: spellings.HALT_BLOCK_REASON_KEYS,
  HALT_SPELLINGS: spellings.HALT_SPELLINGS,
  writeCheckpoint, stateWasRecorded, recordTerminal, CheckpointCollision,
  CheckpointDivergence, divergentKeys,
  main, EXIT_OK, EXIT_USAGE, EXIT_WRITE_FAILED,
};
