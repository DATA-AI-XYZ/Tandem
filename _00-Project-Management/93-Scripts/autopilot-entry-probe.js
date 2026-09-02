#!/usr/bin/env node
/**
 * autopilot-entry-probe.js — does this install have a usage signal at all? Asked at RUN ENTRY,
 * before the first dispatch (STORY-26.5.01, PRD-Autonomous-Execution §B.3.1).
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * `usage-governor.js` returns `pause-and-ask` when the live signal is missing or invalid
 * (ADR-0085's mandated degraded mode — never guess, never barrel on). In a harness that
 * exposes no signal at all, that answer arrives at EVERY atomic boundary, and the first one it
 * arrives at is somewhere in the middle of the night with nobody to answer it. ADR-0091 patched
 * that under time pressure by reading the operator's generic entry authorisation as the answer
 * to an ask nobody had been told would be made. This file replaces that patch: the question is
 * asked ONCE, AT ENTRY, BEFORE ANY WORK, and the answer is a decision the operator can see.
 *
 * ============================================================================
 * THE DESIGNED NO-SIGNAL PATH IS **REFUSE**, WITH ONE EXPLICIT WAY PAST (ADR-0154)
 * ============================================================================
 *   signal usable        -> `proceed`
 *   no usable signal     -> `refuse` — the run does NOT dispatch. Exit 3.
 *   no usable signal AND an explicit operator acknowledgement of the signal-less state,
 *   supplied at entry    -> `proceed-degraded-acknowledged`, recorded on the ledger.
 *
 * Refuse is the default because the story's own risk note says so and because an operator who
 * is not there cannot consent to running without usage protection. The acknowledgement is not
 * a loophole around that: it is the operator saying the specific thing ADR-0091 merely inferred
 * from a generic "go". A run that dispatched under ADR-0091 could not tell you afterwards
 * whether anyone had ever been told the signal was missing. This one can.
 *
 * ============================================================================
 * "IS THE SIGNAL USABLE?" IS ASKED OF THE GOVERNOR, NOT RE-DECIDED HERE
 * ============================================================================
 * Validity rules for a usage signal already exist, in one place, in `usage-governor.js`:
 * `pause-and-ask` IS its verdict of "this signal is not usable". Restating those rules here
 * would create a second spelling that drifts — so this file hands whatever it acquired to
 * `decide()` and reads the action. When the governor's notion of an invalid signal changes,
 * this probe changes with it and nothing has to be remembered.
 *
 * ============================================================================
 * SIGNAL ACQUISITION IS STILL THE CALLER'S (ADR-0085's SPLIT IS PRESERVED)
 * ============================================================================
 * `acquire()` is injected. This file never reaches out to a live system, exactly as
 * `usage-governor.js` never does. A harness with a real usage surface passes a function that
 * reads it; this repository's harness has none, so the CLI's default acquirer returns whatever
 * `--percent-used` / `--reset-at` were given — which is nothing, which is the honest answer.
 *
 * ============================================================================
 * EVERY RECORD SAYS WHERE ITS SIGNAL CAME FROM (ADR-0156, amending ADR-0154)
 * ============================================================================
 * The CLI's default acquirer reads the CLI's own flags, so `--percent-used 41 --reset-at <iso>`
 * produced a `signal-present -> proceed` ledger line INDISTINGUISHABLE from a genuine live read
 * — which is the fabricated signal ADR-0154 named and rejected, arriving through the front door.
 * The probe now carries `signal_source` (`SIGNAL_SOURCES`, defined in `lib/retro-schema.js`) and
 * `recordProbe` writes it, so "the run had a signal" can never again be recorded without "and
 * this is where it came from".
 *
 * WHETHER CALLER-TYPED FLAGS SHOULD PROCEED AT ALL IS STILL OPEN. This file deliberately does
 * NOT decide it — see ADR-0156's open question. Provenance makes the ledger honest either way,
 * and it is what a later decision will be argued from.
 *
 * ============================================================================
 * SHAPE IS CHECKED HERE; USABILITY IS STILL THE GOVERNOR'S
 * ============================================================================
 * `usage-governor.isValidIso()` is `new Date(v)` + `isNaN`, which accepts `"0"` (it parses as
 * the year 2000), so `--reset-at 0` walked through the refusal and the run reported itself
 * healthy. "Is this even a usage signal?" and "is this signal a reason to pause?" are two
 * questions: the first is a SHAPE rule and is answered here (`validateSignalShape` — a finite
 * percentage in 0..100 and an ISO-8601 instant with a zone designator), the second remains the
 * governor's and is never restated. A signal that fails the shape rule is not handed any extra
 * authority: it takes the ordinary refuse path, and the reason names the field that failed.
 *
 * A PROBE THAT THROWS MEANS "NO SIGNAL", NEVER A CRASH (AC-5). An acquirer that raises is
 * an install whose signal surface is broken, which is operationally identical to not having
 * one — and a probe that took the run down while checking whether the run was safe would be
 * the most embarrassing failure mode available here.
 *
 * LEDGER: the outcome is recorded at `run` level (AC-4) THROUGH `retro-capture.js` — the single
 * writer (ADR-0153) — reached via `autopilot-decision-capture.capture()`, which reads the
 * writer's stdout rather than its exit code. `run` level and not `pause`, even when the
 * governor's action is `pause-and-ask`: entry refusal is not a pause. Nothing is in flight and
 * there is nothing to resume, so ADR-0153's pausing-action routing does not apply here. See
 * ADR-0154.
 *
 * ============================================================================
 * AND IT NO LONGER DEFAULTS TO THE PRODUCTION LEDGER (STORY-29.1.01)
 * ============================================================================
 * A verification invocation of this probe — run it, read the exit code, pass no `--out` — used
 * to append a fabricated `run` record to the production calibration ledger. It did:
 * `"id":"verify-junk"` is on that ledger from 2026-08-04 (BUG-20260804-37). `capture()` now
 * resolves its destination through `lib/ledger-target.js`, so a production write requires a run
 * this repository can vouch for — at entry, the RUN PLAN `autopilot-plan.js` wrote before this
 * probe ran. The verdict and the exit code are untouched; only the destination changed.
 *
 * Usage:
 *   node autopilot-entry-probe.js --run-id <run_id> [--phase EPIC-NN] [--threshold <n>]
 *     [--acknowledge-signalless "<what the operator acknowledged, verbatim>"]
 *     [--out <ledger path>] [--reports-dir <path>] [--json]
 *
 *   `--out <ledger path>` writes the run-level record somewhere other than the production
 *   `41-Reports/retro/retro-log.jsonl`. USE IT FOR ANY AD-HOC INVOCATION.
 *
 *   THIS HARNESS EXPOSES NO USAGE SURFACE. The only sanctioned way past a refusal HERE is
 *   `--acknowledge-signalless "<text>"`. `--percent-used <n> --reset-at <iso>` exist for an
 *   install that genuinely has a surface a caller can read; typing them here does not create
 *   one, and every record they produce is stamped `signal_source: cli-flags` so a reader can
 *   tell.
 *
 * Exit codes:
 *   0 — the run may dispatch (`proceed` or `proceed-degraded-acknowledged`)
 *   2 — usage error (no --run-id)
 *   3 — REFUSED: no usable usage signal and no acknowledgement. Do not dispatch.
 *       Same code `autopilot-plan.js` uses for the other entry-blocking condition, deliberately.
 *
 * Dependency-free — Node stdlib only, consistent with every other `93-Scripts/` tool.
 */

'use strict';

const path = require('path');

const governor = require(path.join(__dirname, 'usage-governor.js'));
const decisionCapture = require(path.join(__dirname, 'autopilot-decision-capture.js'));
const schema = require(path.join(__dirname, 'lib', 'retro-schema.js'));

const EXIT_OK = 0;
const EXIT_USAGE = 2;
const EXIT_REFUSED = 3;

/** What the probe found. `probe-error` is a DISTINCT outcome from `no-signal` on the record
 *  even though both take the same path — "the surface is broken" and "there is no surface"
 *  need different fixes, and collapsing them on the ledger loses that. */
const PROBE_OUTCOMES = Object.freeze(['signal-present', 'no-signal', 'probe-error']);

/** What entry decided. Enumerated so a reader can COUNT them; free text could not be. */
const ENTRY_DECISIONS = Object.freeze(['proceed', 'proceed-degraded-acknowledged', 'refuse']);

/** Markers the entry sequence emits, in the order it emits them. The ORDER is the AC-1
 *  contract; the names are how a test reads it. */
const MARKERS = Object.freeze({ probe: 'probe', ledger: 'ledger', dispatch: 'dispatch' });

/** WHERE A SIGNAL CAME FROM (ADR-0156). Read off `lib/retro-schema.js` rather than re-typed
 *  here — a second spelling of a vocabulary is the defect ADR-0109 exists to prevent, and the
 *  ledger field this feeds is validated against exactly that set. */
const SIGNAL_SOURCES = schema.SIGNAL_SOURCES;

function safeMessage(err) {
  try {
    if (err && typeof err.message === 'string') return err.message;
    return String(err);
  } catch {
    return '(unprintable error)';
  }
}

/**
 * Normalise a caller-declared source into the enum. NEVER invents `harness-acquirer` for a
 * caller who did not inject an acquirer, and never lets an unrecognised name masquerade as a
 * known one — an unknown provenance is a fact worth recording, not a fact worth rounding.
 */
function normaliseSource(declared, hasAcquirer) {
  if (!hasAcquirer) return 'none';
  if (typeof declared === 'string' && declared.trim() !== '') {
    const s = declared.trim();
    return (SIGNAL_SOURCES.indexOf(s) !== -1 && s !== 'none') ? s : 'unknown';
  }
  // An injected acquirer with no declared source IS the harness: nothing else can inject one.
  return 'harness-acquirer';
}

/** ISO 8601 instant with an explicit zone designator (`Z` or `±HH:MM`), calendar-checked.
 *  Deliberately NOT `new Date(v)` — that is the predicate that accepted `--reset-at 0`. */
const ISO_INSTANT_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isIsoInstant(v) {
  if (typeof v !== 'string') return false;
  const m = ISO_INSTANT_RE.exec(v.trim());
  if (!m) return false;
  const year = Number(m[1]); const month = Number(m[2]); const day = Number(m[3]);
  const hour = Number(m[4]); const minute = Number(m[5]); const second = Number(m[6]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1
    || probe.getUTCDate() !== day) return false;
  return !Number.isNaN(Date.parse(v.trim()));
}

/**
 * IS THIS EVEN A USAGE SIGNAL? — a SHAPE rule, not a usability rule (see the header).
 *
 * @returns {{ok: boolean, reasons: string[], checked: boolean}} `checked: false` means there
 *          was nothing to check (no values at all), which is an absence, not a malformed
 *          signal — the governor already calls that `pause-and-ask` and saying it twice would
 *          put two different reasons on one ledger line.
 * NEVER THROWS: both values arrive already snapshotted onto plain locals.
 */
function validateSignalShape(rawPercent, rawResetAt) {
  const pStr = (rawPercent === undefined || rawPercent === null) ? '' : String(rawPercent).trim();
  const rStr = (rawResetAt === undefined || rawResetAt === null) ? '' : String(rawResetAt).trim();
  if (pStr === '' && rStr === '') return { ok: true, checked: false, reasons: [] };

  const reasons = [];
  const n = Number(pStr);
  if (pStr === '' || !Number.isFinite(n)) {
    reasons.push(`percentUsed ${JSON.stringify(rawPercent)} is not a number`);
  } else if (n < 0 || n > 100) {
    reasons.push(`percentUsed ${n} is outside 0..100`);
  }
  if (!isIsoInstant(rStr)) {
    reasons.push(`resetAt ${JSON.stringify(rawResetAt)} is not an ISO 8601 instant with a `
      + 'zone designator (e.g. 2026-08-04T20:00:00Z)');
  }
  return { ok: reasons.length === 0, checked: true, reasons };
}

/**
 * Ask the install whether it has a usable usage signal.
 *
 * @param {{acquire?: Function, source?: string, threshold?: *}} opts `acquire()` returns
 *        `{percentUsed, resetAt}` (any shape) or throws, or returns null. `source` names WHERE
 *        the acquirer came from and is normalised into `SIGNAL_SOURCES`.
 * @returns {{outcome: string, available: boolean, governorAction: string, reason: string,
 *            signalSource: string, shapeValid: boolean, shapeReasons: string[],
 *            percentUsed: number|null, error: string|null}}
 *
 * NEVER THROWS. Every failure mode of `acquire` — throwing, returning junk, returning null —
 * lands on the same no-signal verdict.
 */
function probeSignal(opts) {
  const options = opts || {};
  const hasAcquirer = typeof options.acquire === 'function';
  const signalSource = normaliseSource(options.source, hasAcquirer);
  let raw = null;
  let error = null;

  if (hasAcquirer) {
    try {
      raw = options.acquire();
    } catch (err) {
      error = safeMessage(err);
    }
  }

  // NO `typeof raw === 'object'` GUARD HERE, DELIBERATELY (BUG-20260804-36, ADR-0156).
  // There used to be one — `const signal = (raw && typeof raw === 'object') ? raw : null` —
  // and replacing it with `const signal = raw` left all 60 checks green, because nothing
  // depended on it: property access on a string or a number yields `undefined`, the reads
  // below are already inside the try/catch that BUG-20260804-28 installed, and a signal of
  // `undefined` is rejected by the shape rule and by the governor alike. A guard nothing can
  // falsify is decoration that reads as protection, so it is gone rather than left in place.
  //
  // THE ACQUIRED VALUE IS READ EXACTLY ONCE, HERE, INSIDE THE TRY (BUG-20260804-28).
  // It came from outside; its properties may be getters that throw, and a second read
  // somewhere further down the file would be a second crash site this one does not cover.
  // That is precisely what happened: `recordProbe` read `signal.percentUsed` again while
  // assembling the ledger argv, and a hostile getter took the entry sequence down after the
  // probe had already correctly classified it. The values are snapshotted onto plain fields
  // below and every later reader uses the snapshot.
  let action;
  let percentUsed = null;
  let shape = { ok: true, checked: false, reasons: [] };
  try {
    const rawPercent = raw === null || raw === undefined ? null : raw.percentUsed;
    const rawResetAt = raw === null || raw === undefined ? null : raw.resetAt;
    percentUsed = Number.isFinite(Number(rawPercent)) && String(rawPercent).trim() !== ''
      ? Number(rawPercent) : null;
    // SHAPE FIRST, then the governor. Both run: `governor_action` on the ledger must stay a
    // faithful record of what the governor said, even when the shape rule is what refused.
    shape = validateSignalShape(rawPercent, rawResetAt);
    // THE GOVERNOR DECIDES WHETHER THE SIGNAL IS USABLE — see the header. A `pause-and-ask`
    // here is not a pause request; at entry it is the governor saying "that is not a signal".
    action = governor.decide({
      percentUsed: rawPercent,
      resetAt: rawResetAt,
      threshold: options.threshold === undefined ? null : options.threshold,
      projectedNext: null,
      windowBudget: null,
    }).action;
  } catch (err) {
    // The governor is contracted never to throw; belt-and-braces so a future change there
    // cannot turn this probe into a crash.
    error = error === null ? safeMessage(err) : error;
    action = 'pause-and-ask';
    shape = { ok: true, checked: false, reasons: [] };
  }

  const governorSaysUsable = action !== 'pause-and-ask';
  // A malformed signal is NOT available, whatever the governor made of it.
  const available = governorSaysUsable && shape.ok;
  const outcome = error !== null ? 'probe-error' : (available ? 'signal-present' : 'no-signal');

  let reason;
  if (error !== null) {
    reason = `the usage-signal probe itself failed (${error}) — treated as NO SIGNAL, never as a crash`;
  } else if (available) {
    reason = `a usage signal was acquired from ${signalSource} and the governor accepted it`;
  } else if (!shape.ok) {
    reason = `the value offered as a usage signal (from ${signalSource}) is not one: `
      + `${shape.reasons.join('; ')} — treated as NO SIGNAL rather than parsed into one`;
  } else {
    reason = `no usable usage signal is available in this install (source ${signalSource}; `
      + 'the governor returned pause-and-ask)';
  }

  return {
    outcome,
    available,
    governorAction: action,
    // PROVENANCE. Always present, on every verdict, including a refusal (ADR-0156).
    signalSource,
    shapeValid: shape.ok,
    shapeChecked: shape.checked,
    shapeReasons: shape.reasons,
    // The snapshot every later reader uses instead of touching the acquired value again.
    percentUsed: available ? percentUsed : null,
    error,
    reason,
  };
}

/**
 * The designed no-signal path, in one place (ADR-0154).
 *
 * @param {{probe: object, acknowledgement?: string}} input
 * @returns {{decision: string, mayDispatch: boolean, reason: string, acknowledgement: string|null}}
 */
function decideEntry(input) {
  const probe = (input && input.probe) || { available: false, outcome: 'no-signal' };
  const ackRaw = input && input.acknowledgement;
  // An acknowledgement is a STRING A HUMAN WROTE, not a boolean flag. `--acknowledge-signalless`
  // with no text is not an acknowledgement — a bare flag records that a switch was flipped and
  // says nothing about who knew what.
  const acknowledgement = (typeof ackRaw === 'string' && ackRaw.trim() !== '') ? ackRaw.trim() : null;

  if (probe.available) {
    return {
      decision: 'proceed',
      mayDispatch: true,
      reason: 'a usable usage signal is available at entry',
      acknowledgement,
    };
  }
  if (acknowledgement !== null) {
    return {
      decision: 'proceed-degraded-acknowledged',
      mayDispatch: true,
      reason: 'no usable usage signal, and the operator explicitly acknowledged the signal-less '
        + `state at entry: ${acknowledgement}`,
      acknowledgement,
    };
  }
  return {
    decision: 'refuse',
    mayDispatch: false,
    // CARRY THE PROBE'S OWN REASON THROUGH (ADR-0156). "No usable signal" is the verdict; the
    // probe knows WHICH FIELD failed, and an operator reading a refusal at 2am needs the
    // second sentence, not the first. A generic refusal reads identically whether the surface
    // is missing or a flag was mistyped.
    reason: `${probe.reason || 'no usable usage signal'} — no explicit operator acknowledgement `
      + 'of the signal-less state, so the run REFUSES to dispatch (ADR-0154). Re-invoke with '
      + '--acknowledge-signalless "<what you are accepting>" to run without usage protection.',
    acknowledgement: null,
  };
}

/**
 * AC-4 — the probe result at `run` level, through the single writer.
 * Never throws; a capture that refuses is reported, never fatal.
 */
function recordProbe(state, opts) {
  const options = opts || {};
  const argv = ['--level', 'run', '--id', state.runId];
  if (state.phase) argv.push('--phase', state.phase);
  argv.push('--governor-action', state.probe.governorAction);
  // PROVENANCE, ALWAYS (ADR-0156). Unconditional and before any value-bearing flag: a record
  // that says a signal was available must never be able to omit where it came from. `none` is
  // written explicitly rather than left absent — "nothing was asked" is information.
  argv.push('--signal-source', state.probe.signalSource);
  // THE SNAPSHOT, never a second read of the acquired value — see `probeSignal` (BUG-20260804-28).
  if (typeof state.probe.percentUsed === 'number' && Number.isFinite(state.probe.percentUsed)) {
    argv.push('--percent-used', String(state.probe.percentUsed));
  }
  if (state.threshold !== undefined && state.threshold !== null && state.threshold !== '') {
    argv.push('--threshold', String(state.threshold));
  }
  argv.push('--stop-reason',
    `entry-probe: ${state.probe.outcome} -> ${state.entry.decision} `
    + `[signal_source=${state.probe.signalSource}]. ${state.entry.reason}`);
  try {
    // THE RUN CONTEXT GOES WITH THE RECORD (STORY-29.1.01). Without `--out`, `capture()` writes
    // the production ledger only for a run this repository can vouch for — at entry that is the
    // RUN PLAN, written by `autopilot-plan.js` before this probe runs. `--run-id verify-junk`
    // has no plan and no checkpoint, so it now writes nowhere instead of into the calibration
    // data (BUG-20260804-37).
    return decisionCapture.capture(argv, {
      out: options.out, runId: state.runId, reportsDir: options.reportsDir,
    });
  } catch (err) {
    return {
      captured: false, refused: false, code: null, stdout: '', stderr: '',
      warnings: [`entry-probe capture threw: ${safeMessage(err)}`], argv,
    };
  }
}

/**
 * AC-1 — the run's entry sequence. The probe runs FIRST; a dispatch can only happen after it.
 *
 * `markers` is an array the caller owns; every step appends its own name to it, so the ORDER
 * is observable from outside without this function being asked to grade itself.
 *
 * @returns {{probe, entry, markers, dispatched: boolean, capture: object, result: *}}
 */
function runEntry(opts) {
  const options = opts || {};
  const markers = Array.isArray(options.markers) ? options.markers : [];

  // FIRST. Before anything that could dispatch.
  markers.push(MARKERS.probe);
  const probe = probeSignal({
    acquire: options.acquire, source: options.signalSource, threshold: options.threshold,
  });
  const entry = decideEntry({ probe, acknowledgement: options.acknowledgement });

  const state = {
    runId: options.runId || 'autopilot-unknown-run',
    phase: options.phase || null,
    threshold: options.threshold,
    probe,
    entry,
  };
  const captureResult = recordProbe(state, {
    out: options.out, reportsDir: options.reportsDir,
  });
  markers.push(MARKERS.ledger);

  if (!captureResult.captured) {
    try {
      process.stderr.write('⚠ autopilot-entry-probe: the run-level probe record was NOT written ('
        + `${captureResult.skipped || (captureResult.refused ? 'REFUSED' : 'not captured')}) — `
        + `${captureResult.warnings.join('; ') || 'no reason given'}\n`);
    } catch { /* a diagnostic must not take the entry down */ }
  }

  let dispatched = false;
  let result;
  if (entry.mayDispatch && typeof options.dispatch === 'function') {
    markers.push(MARKERS.dispatch);
    dispatched = true;
    result = options.dispatch({ probe, entry });
  }

  return { probe, entry, markers, dispatched, capture: captureResult, result };
}

// ---------- CLI ----------

function usage(msg) {
  if (msg) console.error(msg);
  console.error('usage: node autopilot-entry-probe.js --run-id <run_id> [--phase EPIC-NN] '
    + '[--threshold <n>] [--acknowledge-signalless "<text>"] [--out <ledger>] '
    + '[--reports-dir <path>] [--json]');
  console.error('  --out <ledger> writes the run-level record somewhere other than the '
    + 'production 41-Reports/retro/retro-log.jsonl — use it for any ad-hoc invocation. Without '
    + 'it, a run with no plan and no checkpoint records NOTHING rather than polluting the '
    + 'calibration ledger (STORY-29.1.01).');
  console.error('  this harness exposes NO usage surface: --acknowledge-signalless "<text>" is '
    + 'the only sanctioned way past a refusal here.');
  console.error('  [--percent-used <n> --reset-at <iso>] are for an install that genuinely has '
    + 'a surface; records they produce are stamped signal_source=cli-flags.');
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
  if (!flags['run-id']) return usage('--run-id is required');

  // THE DEFAULT ACQUIRER MEASURED "DID SOMEONE TYPE TWO FLAGS", AND SAID `harness` NOWHERE.
  // It is still the CLI's flags — that policy question is open, see ADR-0156 — but it now
  // declares itself, and it is only installed when a flag was ACTUALLY GIVEN. With neither
  // flag present there is no acquirer at all, which records `signal_source: none` rather than
  // a `cli-flags` read that nobody made.
  const typedAnything = flags['percent-used'] !== undefined || flags['reset-at'] !== undefined;
  const out = runEntry({
    runId: flags['run-id'],
    phase: flags.phase,
    threshold: flags.threshold,
    acknowledgement: flags['acknowledge-signalless'],
    out: flags.out,
    reportsDir: flags['reports-dir'] || undefined,
    signalSource: typedAnything ? 'cli-flags' : undefined,
    acquire: typedAnything
      ? () => ({ percentUsed: flags['percent-used'], resetAt: flags['reset-at'] })
      : undefined,
  });

  if (flags.json) {
    console.log(JSON.stringify({
      run_id: flags['run-id'],
      probe: out.probe.outcome,
      governor_action: out.probe.governorAction,
      signal_source: out.probe.signalSource,
      decision: out.entry.decision,
      may_dispatch: out.entry.mayDispatch,
      reason: out.entry.reason,
      recorded: out.capture.captured,
      // Why nothing was written, when nothing was written. `null` means it was attempted.
      not_recorded_because: out.capture.captured
        ? null : (out.capture.skipped || (out.capture.refused ? 'refused' : 'capture-failed')),
    }, null, 2));
  } else {
    console.log(`entry-probe: ${out.probe.outcome} -> ${out.entry.decision} `
      + `(signal_source: ${out.probe.signalSource})`);
    console.log(out.entry.reason);
    if (!out.capture.captured) {
      console.error('entry-probe: run-level record NOT written'
        + `${out.capture.skipped ? ` (${out.capture.skipped})` : ''}`
        + `${out.capture.warnings.length ? ` — ${out.capture.warnings.join('; ')}` : ''}`);
    }
  }

  return out.entry.mayDispatch ? EXIT_OK : EXIT_REFUSED;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = {
  PROBE_OUTCOMES, ENTRY_DECISIONS, MARKERS, SIGNAL_SOURCES,
  EXIT_OK, EXIT_USAGE, EXIT_REFUSED,
  isIsoInstant, normaliseSource, validateSignalShape,
  probeSignal, decideEntry, recordProbe, runEntry, main,
};
