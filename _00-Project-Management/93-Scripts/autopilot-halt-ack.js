#!/usr/bin/env node
/**
 * autopilot-halt-ack.js — a run that stopped because something went wrong cannot restart as
 * though nothing did (STORY-26.5.04, PRD-Autonomous-Execution §B.3.4, ADR-0160).
 *
 * ============================================================================
 * A HALT IS NOT A PAUSE, AND RESUMING ONE IS A HUMAN DECISION
 * ============================================================================
 * ADR-0152 made `halted` a terminal state distinct from `completed`: the run stopped WITHOUT
 * reaching its stop condition. A `paused` run has a reason to come back — a governor threshold,
 * a scheduled wake, an operator who said "in three hours". A `halted` run has something
 * unresolved in front of it, and continuing past that unattended is the failure this file
 * exists to prevent.
 *
 * So the gate is scoped to halts ONLY. A paused resume is untouched (AC-3) — deliberately,
 * because a gate that fired on every resume would be turned off.
 *
 * ============================================================================
 * THE ACKNOWLEDGEMENT MUST BE DISTINGUISHABLE ON THE LEDGER, NOT ONLY IN THE PROSE
 * ============================================================================
 * `resume_authorisation` (`lib/retro-schema.js`, ADR-0160) is an ENUM with three values:
 *
 *   acknowledged-halt      a halted run resumed, and a human wrote why that was acceptable
 *                          — RECORDED at `run` level
 *   halt-unacknowledged    a halted run's resume was REFUSED for want of that acknowledgement
 *                          — RECORDED at `run` level
 *   not-required           the run was not halted; the gate never engaged — NOT recorded
 *                          (ADR-0162)
 *
 * THE REFUSAL IS RECORDED TOO. A gate that only leaves a trace when it lets you through cannot
 * tell you afterwards how often it stopped somebody — and "a resume that proceeded without a
 * recorded acknowledgement" is the defect, which is only detectable if BOTH directions are on
 * the ledger under one field a reader can count. This is ADR-0156's argument for
 * `signal_source`, one story later, about the same class of mistake.
 *
 * THE NON-EVENT IS NOT. `not-required` says the gate declined to engage, which is not one of the
 * two directions that argument is about. Recording it wrote a `run` line on EVERY invocation —
 * and because the derivation could not produce `halted` at all (BUG-20260804-38), that was every
 * invocation this repository could make, into the production calibration ledger, from the
 * invocation the operator guidance itself documents (BUG-20260804-39). `--out` now appears in the
 * usage string too, so the safe form is discoverable.
 *
 * ============================================================================
 * TWO SPELLINGS OF "WHY IT HALTED" ALREADY EXIST IN THIS REPOSITORY
 * ============================================================================
 * `autopilot-checkpoint.js` writes a `terminal` block carrying `halt_cause` (an enum).
 * The LIVE checkpoint of the run executing this file carries something else entirely: a
 * hand-written top-level `halt` block with `found_at` / `found_by` / `audit` / `damage` /
 * `proposed_fix` / `resolved_at` / `resolution`, written by the operator on 2026-08-04. Neither
 * knows about the other.
 *
 * `haltReason()` reads BOTH, in a stated precedence, and REPORTS WHICH IT READ. A gate that
 * knew only the `terminal` spelling would have found "no reason recorded" on the one real halt
 * this repository has ever had, and taken the acknowledge-blind path for a halt that is in fact
 * documented in exhausting detail.
 *
 * AND THAT IS EXACTLY HALF THE PROBLEM, WHICH IS WHY THE WORD LIST MOVED OUT (ADR-0161).
 * This gate keys off `state === 'halted'`, and `state` is supplied by
 * `autopilot-checkpoint.deriveState()` for every checkpoint here, because none carries the key.
 * That derivation was never taught the second spelling, so it answered `running` for the live
 * file while `haltReason()` below extracted its `halt.audit` prose in full — and the gate
 * returned `not-required` for the one situation it exists for (BUG-20260804-38). The vocabulary
 * now lives in `lib/halt-spellings.js`; both modules read it, and
 * `halt-acknowledgement.test.js :: derivation-agrees` fails if they ever disagree again.
 *
 * ============================================================================
 * …AND A `terminal` BLOCK IS NOT ALWAYS A HALT (BUG-20260811-04, ADR-0193)
 * ============================================================================
 * `terminal.reason` is the NEUTRAL ending-in-words: `recordTerminal()` writes it at all six
 * boundaries, and two of them (`stop-condition-reached`, `plan-exhausted`) COMPLETE the run.
 * `haltReason()` answered from that key without asking which kind of ending it described, so the
 * first time a run recorded a clean ending through the real writer, the reader reported a halt
 * reason for a record that said `state: "completed"`, `halt_cause: null` in the same object.
 *
 * The `terminal` arm is now gated on `autopilot-checkpoint.terminalRecordsCompletion()` — ONE
 * predicate, shared with `carriesHalt()` next door, so the pair cannot learn this separately the
 * way they learned the halt spellings separately (BUG-20260804-38). When the block records a
 * completion the read FALLS THROUGH to the halt block, which is not the same as answering `none`:
 * a run can complete having earlier raised a halt, and that halt is still what a resume must be
 * shown.
 *
 * ============================================================================
 * A HALT WITH NO RECORDED REASON: ACKNOWLEDGE-BLIND, LOUDLY (AC-4, ADR-0160)
 * ============================================================================
 * The story's Risks section asks for a decision and for it to be recorded. The choice is
 * ACKNOWLEDGE-BLIND WITH A WARNING, not refuse: refusing would make an older-shape halted
 * checkpoint permanently unresumable with no path forward, which converts a recoverable state
 * into a dead one. The absence is PRESENTED as the thing being acknowledged, the record carries
 * `acknowledged_halt_reason: null`, and `reason_source: 'none'` says so in a field rather than
 * in a sentence.
 *
 * ============================================================================
 * NO AUTO-REDO (AC-5)
 * ============================================================================
 * `pendingUnits()` subtracts the checkpoint's `completed.chats` from the planned set. An
 * acknowledged resume dispatches the remainder and nothing else. Re-executing work that already
 * landed is the worst outcome available in this feature — it is what `skills/autopilot`'s
 * board-wins reconciliation exists to prevent, and an acknowledgement must not become a licence
 * to start over.
 *
 * Usage:
 *   node autopilot-halt-ack.js --run-id <run_id> [--dir <reports-dir>]
 *        [--acknowledge "<what the operator is accepting, in words>"]
 *        [--chat <CHAT-NN>]… [--phase EPIC-NN] [--record] [--out <ledger>] [--json]
 *
 *   `--record` also writes the acknowledgement onto the checkpoint, which makes it durable —
 *   a later resume reads it back and does not ask again. Without it the gate is evaluated and
 *   recorded on the ledger but the checkpoint is left alone.
 *
 * Exit codes:
 *   0 — the run may resume (`acknowledged-halt` or `not-required`)
 *   2 — usage error
 *   6 — REFUSED: the run is halted and the halt has not been acknowledged. Do not resume.
 *       A code of its own: 3 is the entry probe's refusal, 4 the branch assertion's halt and
 *       5 the divergence flag, and an unattended caller must be able to tell them apart.
 *
 * Dependency-free — Node stdlib only, consistent with every other `93-Scripts/` tool.
 */

'use strict';

const path = require('path');

const checkpoint = require(path.join(__dirname, 'autopilot-checkpoint.js'));
const decisionCapture = require(path.join(__dirname, 'autopilot-decision-capture.js'));
const schema = require(path.join(__dirname, 'lib', 'retro-schema.js'));
const spellings = require(path.join(__dirname, 'lib', 'halt-spellings.js'));

const EXIT_OK = 0;
const EXIT_USAGE = 2;
const EXIT_REFUSED = 6;

/** Read off the schema, never re-typed here — a second spelling of a vocabulary is the defect
 *  ADR-0109 exists to prevent, and the ledger field this feeds is validated against exactly
 *  this set. */
const RESUME_AUTHORISATIONS = schema.RESUME_AUTHORISATIONS;

/** Where a halt reason was read from. `terminal` and `halt-block` are the two spellings that
 *  actually exist in this repository; `halt-cause` is the enum alone, which is a cause and not
 *  a reason; `none` is an honest absence. */
const REASON_SOURCES = Object.freeze(['terminal', 'halt-block', 'halt-cause', 'none']);

/**
 * Markers the resume sequence emits, in the order it emits them. THE ORDER IS THE AC-4
 * CONTRACT — the reason is presented before the acknowledgement is requested — and the names
 * are how a test reads it without the module being asked to grade itself.
 */
const MARKERS = Object.freeze({
  reason: 'halt-reason',
  request: 'acknowledgement-request',
  ledger: 'ledger',
  resume: 'resume',
});

/**
 * Keys the top-level `halt` block may carry a reason under, MOST SPECIFIC FIRST. `audit` is in
 * the list because it is what the one real halt in this repository actually used.
 *
 * READ OFF `lib/halt-spellings.js`, NEVER RE-TYPED HERE (ADR-0161). This list used to be a
 * literal in this file, and `autopilot-checkpoint.deriveState()` — the sibling that decides
 * whether the gate below fires at all — knew nothing about it. The reader found the live halt in
 * full prose while the deriver said `running`, so the gate returned `not-required` for the one
 * halt it exists for (BUG-20260804-38). One list, two readers, no way to teach only one of them.
 */
const HALT_BLOCK_REASON_KEYS = spellings.HALT_BLOCK_REASON_KEYS;

/** The `terminal` block's reason-in-words keys, same source, same argument. */
const TERMINAL_REASON_KEYS = spellings.TERMINAL_REASON_KEYS;

function safeMessage(err) {
  try {
    if (err && typeof err.message === 'string') return err.message;
    return String(err);
  } catch {
    return '(unprintable error)';
  }
}

function firstNonEmptyString(obj, keys) {
  if (obj === null || typeof obj !== 'object') return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim() !== '') return { key: k, value: v.trim() };
  }
  return null;
}

// ---------- AC-4 · what the operator is shown ----------

/**
 * WHY DID IT HALT? — read from every spelling this repository has, and say which one answered.
 *
 * @param {object} raw a checkpoint record (`readCheckpoint().raw`)
 * @returns {{reason: string|null, source: string, key: string|null, thin: boolean}}
 *          `thin` marks a "reason" that is only the `halt_cause` enum — a category, not an
 *          explanation. A gate that presented `gate-failure` and called it informed consent
 *          would be the reflexive acknowledgement AC-4 exists to prevent.
 * NEVER THROWS.
 */
function haltReason(raw) {
  const none = { reason: null, source: 'none', key: null, thin: false };
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return none;

  const terminal = raw.terminal;
  // A COMPLETION'S ENDING IS NOT A HALT REASON (BUG-20260811-04, ADR-0193).
  //
  // `terminal.reason` is the NEUTRAL ending-in-words — `recordTerminal()` writes it for all six
  // boundaries, and only four of them halt. This arm answered from it unconditionally, so
  // recording Run-1's clean `stop-condition-reached` ending on the live checkpoint made
  // `haltReason()` report `terminal.reason` as a halt reason for a run whose own record said
  // `state: "completed"`, `halt_cause: null` beside it. Everything needed to tell the two apart
  // was already in the record; nothing looked.
  //
  // The predicate is the CHECKPOINT MODULE'S, not a second copy of the rule here — this file
  // already requires it, and one function answering for both readers is ADR-0161's argument
  // applied to what a `terminal` block MEANS rather than to the keys it is spelled with.
  const terminalIsCompletion = checkpoint.terminalRecordsCompletion(terminal);
  if (!terminalIsCompletion
      && terminal !== null && typeof terminal === 'object' && !Array.isArray(terminal)) {
    const hit = firstNonEmptyString(terminal, TERMINAL_REASON_KEYS);
    if (hit) return { reason: hit.value, source: 'terminal', key: hit.key, thin: false };
  }

  // THE SPELLING THE LIVE CHECKPOINT ACTUALLY USES. See the header.
  //
  // REACHED DELIBERATELY WHEN THE TERMINAL BLOCK RECORDS A COMPLETION, and not merely when it is
  // absent: a run can complete having earlier raised a halt, and that halt block must still
  // answer. Falling straight to `none` on any `terminal` key would trade one wrong answer for
  // another.
  const block = raw.halt;
  if (block !== null && typeof block === 'object' && !Array.isArray(block)) {
    const hit = firstNonEmptyString(block, HALT_BLOCK_REASON_KEYS);
    if (hit) return { reason: hit.value, source: 'halt-block', key: hit.key, thin: false };
  }

  // Last resort: the enum. Recorded as THIN so the caller can say so out loud.
  // A completion carries `halt_cause: null` by construction, so this cannot fire for one — the
  // guard is here so the arm states the rule rather than relying on the writer to keep it true.
  if (!terminalIsCompletion && terminal !== null && typeof terminal === 'object'
      && typeof terminal.halt_cause === 'string' && terminal.halt_cause.trim() !== '') {
    return {
      reason: terminal.halt_cause.trim(), source: 'halt-cause', key: 'halt_cause', thin: true,
    };
  }
  return none;
}

/** The acknowledgement already on the record, if one was made durable by an earlier `--record`. */
function recordedAcknowledgement(raw) {
  if (raw === null || typeof raw !== 'object') return null;
  const a = raw.halt_acknowledgement;
  if (a === null || typeof a !== 'object' || Array.isArray(a)) return null;
  return (typeof a.text === 'string' && a.text.trim() !== '') ? a : null;
}

// ---------- AC-1 / AC-2 / AC-3 · the gate ----------

/**
 * May this run resume?
 *
 * @param {{record: object, acknowledgement?: string}} input `record` is a `readCheckpoint()`
 *        result. `acknowledgement` is A STRING A HUMAN WROTE — a bare flag is not one, for the
 *        same reason `--acknowledge-signalless` refuses an empty value (ADR-0154): a switch
 *        being flipped says nothing about who knew what.
 * @returns {{required, decision, mayResume, reason, presented, haltReason, reasonSource,
 *            thinReason, acknowledgement, acknowledgementSource, warning}}
 * NEVER THROWS.
 */
function gateResume(input) {
  const rec = (input && input.record) || null;
  const raw = (rec && rec.raw) || null;
  const state = rec && rec.ok ? rec.state : null;

  const ackRaw = input && input.acknowledgement;
  const supplied = (typeof ackRaw === 'string' && ackRaw.trim() !== '') ? ackRaw.trim() : null;
  const stored = recordedAcknowledgement(raw);

  // AC-3. The gate is scoped to halts. Anything else — `paused`, `running`, `completed`, or a
  // checkpoint that could not be read — is not this gate's business, and saying so explicitly
  // beats an `if (state === 'halted')` whose else-branch is silence.
  if (state !== 'halted') {
    return {
      required: false,
      decision: 'not-required',
      mayResume: true,
      reason: `the run is ${JSON.stringify(state)}, not halted — the halt-acknowledgement gate `
        + 'applies only to halts (AC-3)',
      presented: null,
      haltReason: null,
      reasonSource: 'none',
      thinReason: false,
      acknowledgement: supplied,
      acknowledgementSource: supplied ? 'flag' : 'none',
      warning: null,
    };
  }

  const hr = haltReason(raw);
  // WHAT THE OPERATOR IS SHOWN, assembled here so it is one string a caller can print and a
  // test can inspect — including in the case where the honest content is "nothing was recorded".
  const presented = hr.reason === null
    ? 'This run HALTED and its checkpoint records NO reason. Nothing can be shown to you about '
      + 'why it stopped. Acknowledging here is acknowledging that absence.'
    : `This run HALTED. Recorded reason (from ${hr.source}.${hr.key}): ${hr.reason}`;
  const warning = hr.reason === null
    ? 'acknowledge-blind: the halt carries no recorded reason (ADR-0160)'
    : (hr.thin
      ? `the only recorded reason is the halt_cause category ${JSON.stringify(hr.reason)}, which `
        + 'is a classification rather than an explanation'
      : null);

  const acknowledgement = supplied || (stored ? stored.text : null);
  const acknowledgementSource = supplied ? 'flag' : (stored ? 'checkpoint' : 'none');

  if (acknowledgement === null) {
    return {
      required: true,
      decision: 'halt-unacknowledged',
      mayResume: false,
      reason: 'this run is HALTED and the halt has not been acknowledged, so the resume is '
        + 'REFUSED (ADR-0160). Re-invoke with --acknowledge "<what you are accepting>" once you '
        + 'have read the reason above.',
      presented,
      haltReason: hr.reason,
      reasonSource: hr.source,
      thinReason: hr.thin,
      acknowledgement: null,
      acknowledgementSource: 'none',
      warning,
    };
  }

  return {
    required: true,
    decision: 'acknowledged-halt',
    mayResume: true,
    reason: `the halt was acknowledged (${acknowledgementSource}): ${acknowledgement}`,
    presented,
    haltReason: hr.reason,
    reasonSource: hr.source,
    thinReason: hr.thin,
    acknowledgement,
    acknowledgementSource,
    warning,
  };
}

// ---------- AC-2 · recording ----------

/**
 * The acknowledgement on the CHECKPOINT, through the real writer. Additive: every existing key
 * is written through unchanged and the state stays `halted` — acknowledging is not resuming,
 * and a gate that quietly cleared the terminal state would destroy the evidence a later reader
 * needs.
 */
function acknowledgeOnCheckpoint(reportsDir, runId, verdict, at) {
  const rec = checkpoint.readCheckpointForRun(reportsDir, runId);
  if (!rec.ok || !rec.raw) {
    throw new Error(`cannot record an acknowledgement for ${runId}: `
      + `${rec.error || 'no readable record'}`);
  }
  const next = Object.assign({}, rec.raw, {
    halt_acknowledgement: {
      at: at || new Date().toISOString(),
      text: verdict.acknowledgement,
      // WHAT WAS ACKNOWLEDGED (AC-2), stored beside the acknowledgement rather than left to be
      // re-derived later — the halt block could be edited afterwards, and then the record would
      // claim consent to something nobody saw.
      acknowledged_reason: verdict.haltReason,
      reason_source: verdict.reasonSource,
      presented: verdict.presented,
    },
  });
  // DECLARE THE BODY THIS EDIT WAS MADE AGAINST (BUG-20260817-10). `readCheckpointForRun()` may
  // have answered from the run's ARCHIVE while the live pointer for the same run has advanced past
  // it; handing the archive's body back would rewind the live record. The writer refuses on a
  // divergence rather than silently choosing the older body.
  return checkpoint.writeCheckpoint(reportsDir, next, { basedOn: rec.raw });
}

/**
 * AC-2 — the acknowledgement at `run` level of the ledger, through the single writer
 * (`retro-capture.js`, reached via `autopilot-decision-capture.capture()`, which reads the
 * writer's stdout rather than its exit code).
 *
 * EVERY OUTCOME IS RECORDED, refusals included. See the header.
 */
function recordResumeGate(state, opts) {
  const options = opts || {};
  const v = state.verdict;
  const argv = ['--level', 'run', '--id', state.runId];
  if (state.phase) argv.push('--phase', state.phase);
  if (state.chat) argv.push('--chat', state.chat);
  // THE DISCRIMINATOR, ALWAYS, AND FIRST. A record that says a halted run resumed must never be
  // able to omit what authorised it.
  argv.push('--resume-authorisation', v.decision);
  if (typeof v.haltReason === 'string' && v.haltReason.trim() !== '') {
    argv.push('--acknowledged-halt-reason', v.haltReason);
  }
  argv.push('--stop-reason',
    `resume-gate: ${v.decision} [reason_source=${v.reasonSource}`
    + `${v.acknowledgementSource ? `, ack_source=${v.acknowledgementSource}` : ''}]. ${v.reason}`
    + (v.warning ? ` (${v.warning})` : ''));
  try {
    // THE RUN CONTEXT GOES WITH THE RECORD (STORY-29.1.01). ADR-0162 stopped the `not-required`
    // verdict writing at all; this stops the two verdicts that DO write from writing into the
    // production calibration ledger for a run nothing on disk records (BUG-20260804-39).
    return decisionCapture.capture(argv, {
      out: options.out, runId: state.runId, reportsDir: options.reportsDir,
    });
  } catch (err) {
    return {
      captured: false, refused: false, code: null, stdout: '', stderr: '',
      warnings: [`resume-gate capture threw: ${safeMessage(err)}`], argv,
    };
  }
}

// ---------- AC-5 · what is left to do ----------

/**
 * The planned units this run has NOT already completed.
 *
 * @param {object} raw a checkpoint record
 * @param {string[]} planned the chats the resume is being asked to run
 * @returns {{pending: string[], alreadyDone: string[]}}
 *
 * Exact string match, deliberately: a fuzzy match here would either re-run a completed chat or
 * skip a pending one, and both are worse than an id that has to be spelled correctly.
 */
function pendingUnits(raw, planned) {
  const list = Array.isArray(planned) ? planned.slice() : [];
  const done = (raw && raw.completed && Array.isArray(raw.completed.chats))
    ? raw.completed.chats : [];
  const doneSet = new Set(done);
  return {
    pending: list.filter(c => !doneSet.has(c)),
    alreadyDone: list.filter(c => doneSet.has(c)),
  };
}

// ---------- the sequence ----------

/**
 * AC-1 / AC-4 / AC-5 — the resume sequence.
 *
 * `markers` is an array the CALLER owns; every step appends its own name, so the ORDER is
 * observable from outside without this function grading itself. A dispatched unit appends
 * `resume:<unit>`, which is how AC-5's "chats one and two produce no new dispatch markers" is
 * checkable rather than assertable-by-assertion.
 */
function runResume(opts) {
  const options = opts || {};
  const markers = Array.isArray(options.markers) ? options.markers : [];
  const record = options.record
    || checkpoint.readCheckpointForRun(options.dir, options.runId);

  const isHalted = record && record.ok && record.state === 'halted';
  // AC-4: THE REASON FIRST, THEN THE REQUEST. Both markers are emitted for a halted run
  // whether or not an acknowledgement was supplied — the operator being shown the reason is
  // not conditional on their having already answered.
  if (isHalted) {
    markers.push(MARKERS.reason);
    markers.push(MARKERS.request);
  }

  const verdict = gateResume({ record, acknowledgement: options.acknowledgement });

  const state = {
    runId: options.runId || (record && record.run_id) || 'autopilot-unknown-run',
    phase: options.phase || null,
    chat: options.chat || null,
    verdict,
  };
  // A GATE THAT DID NOT ENGAGE HAS NOTHING TO RECORD (ADR-0162, narrowing ADR-0160).
  // ADR-0160's "every outcome writes a record" is an argument about REFUSALS: a gate that only
  // leaves a trace when it lets you through cannot say how often it stopped somebody. It is not
  // an argument about a verdict where the gate declined to engage at all. `not-required` is that
  // verdict, and it was the ONLY reachable one on this repository before BUG-20260804-38 was
  // fixed — so every documented invocation of this tool appended a junk `run` line to the
  // production calibration ledger (BUG-20260804-39). Both directions that MEAN something —
  // `acknowledged-halt` and `halt-unacknowledged` — are still recorded, unchanged.
  const engaged = verdict.decision !== 'not-required';
  const capture = engaged
    ? recordResumeGate(state, { out: options.out, reportsDir: options.dir })
    : { captured: false, recorded: false, skipped: 'not-required', refused: false, code: null,
      stdout: '', stderr: '', warnings: [], argv: [] };
  if (engaged) markers.push(MARKERS.ledger);

  if (engaged && !capture.captured) {
    try {
      process.stderr.write('⚠ autopilot-halt-ack: the run-level resume-gate record was NOT '
        + `written (${capture.skipped || (capture.refused ? 'REFUSED' : 'not captured')}) — `
        + `${capture.warnings.join('; ') || 'no reason given'}\n`);
    } catch { /* a diagnostic must not take the gate down */ }
  }

  const units = pendingUnits(record && record.raw, options.planned);
  const dispatched = [];
  if (verdict.mayResume && typeof options.dispatch === 'function') {
    for (const unit of units.pending) {
      markers.push(`${MARKERS.resume}:${unit}`);
      dispatched.push(unit);
      options.dispatch({ unit, verdict, record });
    }
  }

  return { verdict, markers, units, dispatched, capture, record };
}

// ---------- CLI ----------

function usage(msg) {
  if (msg) console.error(msg);
  console.error('usage: node autopilot-halt-ack.js --run-id <run_id> [--dir <reports-dir>] '
    + '[--acknowledge "<text>"] [--chat <CHAT-NN>]… [--phase EPIC-NN] [--record] '
    + '[--out <ledger>] [--json]');
  // `--out` was missing from this string while the other three gate tools printed it, so the
  // only discoverable way to exercise the gate wrote to the production calibration ledger
  // (BUG-20260804-39). A safe invocation nobody can find is not a safe invocation.
  console.error('  --out <ledger> writes the run-level record somewhere other than the '
    + 'production 41-Reports/retro/retro-log.jsonl — use it for any ad-hoc invocation. Without '
    + 'it, a --run-id this repository has no run plan and no checkpoint for records NOTHING '
    + '(STORY-29.1.01), and the tool says where it would have written.');
  console.error('  exit 6 means REFUSED: the run is halted and the halt is unacknowledged. '
    + 'Do not resume.');
  return EXIT_USAGE;
}

function main(argv) {
  const args = argv.slice(2);
  const flags = Object.create(null);
  const chats = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') { flags.json = true; continue; }
    if (a === '--record') { flags.record = true; continue; }
    if (a.indexOf('--') !== 0) return usage(`unexpected argument "${a}"`);
    const v = args[i + 1];
    if (v === undefined || String(v).indexOf('--') === 0) { flags[a.slice(2)] = ''; continue; }
    if (a === '--chat') { chats.push(v); i++; continue; }
    flags[a.slice(2)] = v;
    i++;
  }
  if (!flags['run-id']) return usage('--run-id is required');

  const out = runResume({
    runId: flags['run-id'],
    dir: flags.dir || undefined,
    phase: flags.phase,
    chat: chats.length === 1 ? chats[0] : undefined,
    acknowledgement: flags.acknowledge,
    planned: chats,
    out: flags.out,
  });

  const v = out.verdict;
  if (flags.record && v.decision === 'acknowledged-halt') {
    try {
      acknowledgeOnCheckpoint(flags.dir || undefined, flags['run-id'], v);
    } catch (err) {
      console.error(`could not record the acknowledgement on the checkpoint: ${safeMessage(err)}`);
    }
  }

  if (flags.json) {
    console.log(JSON.stringify({
      run_id: flags['run-id'],
      state: out.record && out.record.state,
      gate_required: v.required,
      resume_authorisation: v.decision,
      may_resume: v.mayResume,
      reason_source: v.reasonSource,
      halt_reason: v.haltReason,
      warning: v.warning,
      pending: out.units.pending,
      already_done: out.units.alreadyDone,
      recorded: out.capture.captured,
      // Why nothing was written, when nothing was written. `null` means it was attempted.
      not_recorded_because: out.capture.captured ? null : (out.capture.skipped || 'capture-failed'),
    }, null, 2));
  } else {
    if (v.presented) console.log(v.presented);
    console.log(`resume-gate: ${v.decision} (may_resume: ${v.mayResume})`);
    console.log(v.reason);
    if (v.warning) console.error(`⚠ ${v.warning}`);
    if (out.units.alreadyDone.length) {
      console.log(`already completed, not re-run: ${out.units.alreadyDone.join(', ')}`);
    }
    if (!out.capture.captured && !out.capture.skipped) {
      console.error('resume-gate: run-level record NOT written');
    }
  }

  return v.mayResume ? EXIT_OK : EXIT_REFUSED;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = {
  RESUME_AUTHORISATIONS, REASON_SOURCES, MARKERS,
  HALT_BLOCK_REASON_KEYS, TERMINAL_REASON_KEYS,
  EXIT_OK, EXIT_USAGE, EXIT_REFUSED,
  haltReason, recordedAcknowledgement, gateResume,
  acknowledgeOnCheckpoint, recordResumeGate, pendingUnits, runResume, main,
};
