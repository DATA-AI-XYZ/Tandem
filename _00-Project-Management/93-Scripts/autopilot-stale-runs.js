#!/usr/bin/env node
/**
 * autopilot-stale-runs.js — a run that paused and never came back says so
 * (STORY-26.5.02, PRD-Autonomous-Execution §B.3.2, ADR-0159 extending ADR-0083/ADR-0152).
 *
 * ============================================================================
 * THE RUN THIS REPOSITORY ACTUALLY LOST
 * ============================================================================
 * `41-Reports/AUTOPILOT-CHECKPOINT-epic23-paused-2026-08-01.json` is a real paused run. Its
 * `paused` block carries the entire deferred v2.8.0 resume procedure and `"resume_at": null` —
 * it was paused at an operator confirmation gate on 2026-08-01 and nothing has picked it up
 * since. Nothing surfaces it. `autopilot-checkpoint.js --unfinished` reports it as one of
 * several open runs and says nothing about its age, so it reads the same on the day it paused
 * as it does three days later.
 *
 * THAT SHAPE IS WHY THE OVERDUE RULE ALONE WOULD BE USELESS HERE (AC-3 / ADR-0159).
 * A rule keyed only on "a scheduled resume that has passed" would find NOTHING in this
 * repository, because the one genuinely stale run never had a schedule to miss. So staleness
 * has TWO arms and both are derived, never pinned:
 *
 *   overdue-scheduled-resume   a `resume_scheduled` (or the older `paused.resume_at`) is in
 *                              the past. Staleness is measured from that instant.
 *   paused-without-schedule    no usable schedule at all, and the pause is older than
 *                              `maxPausedAgeMs` (default 24h). Measured from `paused.at`.
 *
 * ---------------------------------------------------------------------------
 * THE CLOCK IS AN ARGUMENT, NOT AN IMPORT (TESTPLAN-26.5.02 risk 1)
 *
 * `detect()` and `classifyStale()` take `nowMs`. Nothing below reads `Date.now()` except the
 * CLI, at the boundary, once. Staleness is the one property in this feature that is a function
 * of time, which makes a test of it decay by construction unless the clock is injected — so it
 * is injected, and the paired suite drives the SAME fixture at several clocks and asserts the
 * verdict flips at the boundary rather than asserting a date.
 *
 * ---------------------------------------------------------------------------
 * TWO SPELLINGS OF ONE INSTANT, RECONCILED RATHER THAN DUPLICATED (ADR-0159)
 *
 * `skills/autopilot/SKILL.md` and ADR-0083 already document `paused.resume_at`, and the usage
 * governor passes its `reset_at` straight into it. STORY-26.5.02 asks for `resume_scheduled`.
 * Two keys for one instant is precisely the defect ADR-0109 exists to prevent, so:
 *
 *   - `resume_scheduled` is the CANONICAL key and lives at the top level of the record.
 *   - `readResumeSchedule()` falls back to `paused.resume_at` and reports
 *     `source: 'paused-block'`, exactly as `autopilot-checkpoint.js` reports `state_source`
 *     for a state it had to derive. A consumer can always tell a recorded schedule from a
 *     derived one.
 *   - `withResumeScheduled()` writes BOTH — the canonical key and, when a `paused` block
 *     exists, its `resume_at` — so the two can never drift into disagreeing about one instant.
 *
 * ---------------------------------------------------------------------------
 * THE INSTANT PREDICATE IS THE LEDGER'S, NOT A THIRD ONE
 *
 * `lib/retro-schema.js` already owns "is this an ISO 8601 instant with a zone designator",
 * calendar-checked, and `autopilot-entry-probe.js` was bitten by a looser one (`new Date("0")`
 * parses). This module reads that predicate off the schema rather than restating it, so a
 * timestamp the ledger would refuse is not a timestamp this module will record or trust.
 *
 * ---------------------------------------------------------------------------
 * READ-ONLY (AC-5)
 *
 * Detection NEVER writes, resumes, or cancels. `staleRuns()` and everything it calls are pure
 * over the filesystem; the only writers in this file are `scheduleResume()` (the AC-1 path) and
 * `dismissRun()` (STORY-29.1.04), and NEITHER is reachable from the detection path. The CLI
 * ALWAYS EXITS 0 for detection — session-start must not be blocked by an orientation probe, the
 * same contract `autopilot-checkpoint.js --unfinished` carries.
 *
 * ---------------------------------------------------------------------------
 * A JUDGED NOTICE STAYS QUIET UNTIL THE FACTS CHANGE (STORY-29.1.04, ADR-0180)
 *
 * `--dismiss <run_id> --reason "<why>" [--by "<who>"]` records an operator's judgement in
 * `<reports-dir>/STALE-RUN-DISMISSALS.json` — beside the checkpoint, never on it (ADR-0152's
 * never-rewrite stance, and AC-5 above). The dismissal is keyed to the EVIDENCE, not the run:
 * the staleness arm, the pause instant and the scheduled resume travel with it, so a run that
 * resumes and pauses again is a new notice, and a DIFFERENT run was never covered.
 *
 * `runs` and `stale` are UNCHANGED by any dismissal — they are the facts. `active` is what a
 * surface shows by default and `--include-dismissed` shows everything with its reason.
 *
 * Usage:
 *   node autopilot-stale-runs.js [--dir <reports-dir>] [--now <iso>]
 *                                [--max-paused-age-hours <n>] [--include-dismissed] [--json]
 *   node autopilot-stale-runs.js --schedule <run_id> --at <iso> [--dir <reports-dir>]
 *   node autopilot-stale-runs.js --dismiss <run_id> --reason "<why>" [--by "<who>"]
 *                                [--dir <reports-dir>]
 *
 * Exit codes: 0 always for detection · 2 = usage error · 3 = a --schedule or --dismiss write
 * failed (including a refused dismissal).
 *
 * Dependency-free — Node stdlib only, consistent with every other `93-Scripts/` tool.
 */

'use strict';

const path = require('path');

const checkpoint = require(path.join(__dirname, 'autopilot-checkpoint.js'));
const schema = require(path.join(__dirname, 'lib', 'retro-schema.js'));
// STORY-29.1.04 / ADR-0180 — the operator's judgement about a stale run, stored BESIDE the
// checkpoint. Read on the detection path (read-only, never throws); written only by the
// deliberate `--dismiss` command below, which is not reachable from detection.
const dismissal = require(path.join(__dirname, 'lib', 'stale-dismissal.js'));

const EXIT_OK = 0;
const EXIT_USAGE = 2;
const EXIT_WRITE_FAILED = 3;

/** The canonical key. One name, at the top level of the record. */
const RESUME_SCHEDULED_KEY = 'resume_scheduled';

/** Default age at which a pause with NO schedule becomes stale. Overridable everywhere it is
 *  used — a number that can only be changed by editing this file is a policy in hiding. */
const DEFAULT_MAX_PAUSED_AGE_MS = 24 * 60 * 60 * 1000;

/** Why a run is stale. ENUMERATED so a reader can COUNT them, and so the two arms above stay
 *  distinguishable on the record: "it missed its slot" and "nobody ever gave it one" need
 *  different follow-ups. */
const STALE_REASONS = Object.freeze(['overdue-scheduled-resume', 'paused-without-schedule']);

/** Where a schedule was read from. Mirrors `autopilot-checkpoint.js`'s `state_source`. */
const SCHEDULE_SOURCES = Object.freeze([
  'resume_scheduled', 'paused-block', 'unparseable', 'none',
]);

/** ONLY a `paused` run can be a stale paused run (AC-4). `completed` and `halted` are terminal
 *  and `running` is not paused; each is excluded for its own reason, and stating the set
 *  positively means a future state is excluded until somebody decides otherwise. */
const STALE_CANDIDATE_STATES = Object.freeze(['paused']);

/**
 * "Is this an ISO 8601 instant with a zone designator?" — READ OFF THE LEDGER SCHEMA.
 * `FIELD_TYPES.ts.check` is `isIsoWithZone`, calendar-aware. Deliberately not `new Date(v)`:
 * that predicate accepts `"0"` and is what let `--reset-at 0` through the entry probe.
 */
const isIsoInstant = schema.FIELD_TYPES.ts.check;

function safeMessage(err) {
  try {
    if (err && typeof err.message === 'string') return err.message;
    return String(err);
  } catch {
    return '(unprintable error)';
  }
}

/** Milliseconds for an instant this module is willing to trust, or null. NEVER THROWS. */
function instantMs(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!isIsoInstant(s)) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

/** A duration a human reads at 8am without doing arithmetic. */
function formatDuration(ms) {
  if (!Number.isFinite(ms)) return 'an unknown time';
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86400000);
  const h = Math.floor((abs % 86400000) / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (!d && m) parts.push(`${m}m`);
  if (!parts.length) parts.push('under a minute');
  return parts.join(' ');
}

// ---------- reading the schedule ----------

/**
 * The instant a resume was scheduled for, and WHERE that came from.
 *
 * @param {object} raw a checkpoint record (`readCheckpoint().raw`)
 * @returns {{at: string|null, ms: number|null, source: string}} `source` is one of
 *          `SCHEDULE_SOURCES`. `unparseable` is DISTINCT from `none`: a record that carries a
 *          schedule this module will not trust is a different fact from one that carries no
 *          schedule, and collapsing them would hide a typo behind a legitimate absence.
 * NEVER THROWS.
 */
function readResumeSchedule(raw) {
  const none = { at: null, ms: null, source: 'none' };
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return none;

  const canonical = raw[RESUME_SCHEDULED_KEY];
  if (canonical !== undefined && canonical !== null && String(canonical).trim() !== '') {
    const ms = instantMs(canonical);
    if (ms !== null) return { at: String(canonical).trim(), ms, source: 'resume_scheduled' };
    return { at: String(canonical), ms: null, source: 'unparseable' };
  }

  // THE OLDER SPELLING. ADR-0083 shipped `paused.resume_at` and the governor writes it, so a
  // reader that only knew the new key would report every pre-ADR-0159 run as unscheduled.
  const paused = raw.paused;
  if (paused !== null && typeof paused === 'object' && !Array.isArray(paused)) {
    const legacy = paused.resume_at;
    if (legacy !== undefined && legacy !== null && String(legacy).trim() !== '') {
      const ms = instantMs(legacy);
      if (ms !== null) return { at: String(legacy).trim(), ms, source: 'paused-block' };
      return { at: String(legacy), ms: null, source: 'unparseable' };
    }
  }
  return none;
}

/** When the pause began, from the `paused` block. Null when there is no usable timestamp. */
function pausedAtMs(raw) {
  if (raw === null || typeof raw !== 'object') return null;
  const paused = raw.paused;
  if (paused === null || typeof paused !== 'object' || Array.isArray(paused)) return null;
  return instantMs(paused.at);
}

// ---------- AC-1 · recording a scheduled resume ----------

/**
 * Return a COPY of `raw` carrying `resume_scheduled: <at>`, with `paused.resume_at` kept in
 * step when a pause block exists. Pure — the input is not mutated.
 *
 * THROWS on an `at` this module would not trust. A scheduler that silently recorded an
 * unusable instant would produce a run that looks scheduled and can never be overdue, which
 * is the failure this story exists to remove wearing a new field.
 */
function withResumeScheduled(raw, at) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('withResumeScheduled needs a checkpoint record object');
  }
  const s = typeof at === 'string' ? at.trim() : '';
  if (!isIsoInstant(s)) {
    throw new Error(`resume_scheduled ${JSON.stringify(at)} is not an ISO 8601 instant with a `
      + 'zone designator (e.g. 2026-08-05T09:00:00+01:00)');
  }
  const out = Object.assign({}, raw, { [RESUME_SCHEDULED_KEY]: s });
  if (out.paused !== null && typeof out.paused === 'object' && !Array.isArray(out.paused)) {
    // ONE INSTANT, BOTH SPELLINGS. See the header: the fallback read exists for records written
    // before this key, and letting the two disagree afterwards would be worse than either alone.
    out.paused = Object.assign({}, out.paused, { resume_at: s });
  }
  return out;
}

/**
 * AC-1 — schedule a resume on a run's checkpoint, through the REAL writer.
 *
 * The only writing path in this file. Reads the run's record by `run_id` (content match, not
 * filename — BUG-20260804-26), applies `withResumeScheduled`, and hands it to
 * `autopilot-checkpoint.writeCheckpoint`, so per-run identity, archiving and the branch/state
 * normalisation all keep working rather than being reimplemented here.
 */
function scheduleResume(reportsDir, runId, at) {
  const rec = checkpoint.readCheckpointForRun(reportsDir, runId);
  if (!rec.ok || !rec.raw) {
    throw new Error(`cannot schedule a resume for ${runId}: ${rec.error || 'no readable record'}`);
  }
  const next = withResumeScheduled(rec.raw, at);
  // DECLARE THE BODY THIS EDIT WAS MADE AGAINST (BUG-20260817-10). `readCheckpointForRun()` may
  // have answered from the run's ARCHIVE while the live pointer for the same run has advanced past
  // it; handing the archive's body back would rewind the live record. The writer refuses on a
  // divergence rather than silently choosing the older body.
  return checkpoint.writeCheckpoint(reportsDir, next, { basedOn: rec.raw });
}

// ---------- STORY-29.1.04 · dismissing a stale run ----------

/**
 * Record an operator's judgement about ONE stale run. The second writing path in this file,
 * and — like `scheduleResume` — never reached from detection.
 *
 * IT DISMISSES THE EVIDENCE, NOT THE RUN. The verdict is recomputed here, at the caller's
 * clock, and the FOUR fields that make a staleness verdict what it is are stored with it. So a
 * dismissal cannot be recorded for a shape the detector is not currently reporting, and it
 * cannot cover a shape it has not seen.
 *
 * REFUSES a run that is not stale right now. There is nothing to dismiss, the evidence key
 * would name a verdict nobody was shown, and a pre-emptive mute is exactly the blanket the
 * evidence key exists to prevent.
 *
 * THROWS on refusal — this is a deliberate command, and a dismissal that silently did nothing
 * is worse than one that said no.
 *
 * @param {string} reportsDir
 * @param {string} runId
 * @param {string} reason        REQUIRED, non-empty
 * @param {{now?: string|number|Date, maxPausedAgeMs?: number, at?: string, by?: string}} opts
 *        `by` is the ACTOR and is REQUIRED by the store (BUG-20260810-04). The CLI defaults it
 *        from `git config user.name`; this function does not guess.
 */
function dismissRun(reportsDir, runId, reason, opts) {
  const options = opts || {};
  const dir = reportsDir || checkpoint.DEFAULT_REPORTS_DIR;
  const id = typeof runId === 'string' ? runId.trim() : '';
  if (id === '') throw new Error('--dismiss requires a run_id');

  const verdict = staleRuns(dir, options);
  const run = verdict.runs.filter(v => v.run_id === id)[0];
  if (!run) {
    const known = verdict.considered.map(v => v.run_id).filter(Boolean);
    throw new Error(`run ${JSON.stringify(id)} is not a stale paused run at ${verdict.now}, so `
      + 'there is nothing to dismiss. A dismissal is keyed to the evidence it was shown; '
      + 'recording one for a verdict nobody was given would mute the next real one. '
      + `Runs considered: ${known.length ? known.join(', ') : '(none)'}`);
  }

  const written = dismissal.dismiss(dir, {
    runId: id,
    reason,
    by: options.by,
    evidence: run,
    at: typeof options.at === 'string' && options.at.trim() !== ''
      ? options.at.trim() : new Date().toISOString(),
  });
  return Object.assign({}, written, { verdict: run });
}

// ---------- AC-2..AC-4 · detection ----------

/**
 * Is ONE record a stale paused run, at `nowMs`?
 *
 * @param {object} rec a `readCheckpoint()` result
 * @param {number} nowMs the clock, INJECTED (see the header)
 * @param {{maxPausedAgeMs?: number}} opts
 * @returns {{stale: boolean, run_id, state, reason, why, scheduled_at, scheduled_source,
 *            paused_at, stale_for_ms, stale_for, summary}}
 * NEVER THROWS and NEVER WRITES.
 */
function classifyStale(rec, nowMs, opts) {
  const options = opts || {};
  const maxAge = Number.isFinite(options.maxPausedAgeMs)
    ? options.maxPausedAgeMs : DEFAULT_MAX_PAUSED_AGE_MS;

  const base = {
    stale: false,
    run_id: (rec && rec.run_id) || null,
    state: (rec && rec.state) || null,
    state_source: (rec && rec.state_source) || null,
    path: (rec && rec.path) || null,
    // Did this run RECORD an ending, and where? Always present so a consumer can tell
    // "no ending was recorded" from "this reader does not know about endings" — the same
    // argument ADR-0157 made for surfacing a null `branch` (STORY-29.1.02).
    terminal: false,
    terminal_source: 'none',
    terminal_boundary: null,
    terminal_at: null,
    reason: null,
    scheduled_at: null,
    scheduled_source: 'none',
    paused_at: null,
    stale_for_ms: null,
    stale_for: null,
  };

  if (!rec || !rec.ok) {
    return Object.assign(base, {
      why: `checkpoint unreadable${rec && rec.error ? ` (${rec.error})` : ''}`,
      summary: 'unreadable checkpoint — not classified',
    });
  }
  // AC-4. A completed or halted run is terminal; a running one is not paused. Neither is a
  // STALE PAUSED RUN, whatever else may be true of it.
  if (STALE_CANDIDATE_STATES.indexOf(rec.state) === -1) {
    // A RECORDED terminal state is a FACT, and this notice reports it rather than inferring
    // anything (STORY-29.1.02 AC-3). Until something wrote the key there was nothing to prefer:
    // every state was `derived`, so "not a stale paused run" was the most that could be said
    // about a run that had, in fact, finished. Now an ending recorded at a named boundary is
    // repeated back with its boundary and its instant, and a DERIVED state still says it was
    // inferred — the two must never read alike.
    const recordedTerminal = rec.state_source === 'recorded'
      && checkpoint.TERMINAL_STATES.indexOf(rec.state) !== -1;
    if (recordedTerminal) {
      const t = (rec.raw && rec.raw.terminal) || {};
      const boundary = typeof t.boundary === 'string' ? t.boundary : null;
      return Object.assign(base, {
        terminal: true,
        terminal_source: 'recorded',
        terminal_boundary: boundary,
        terminal_at: typeof t.at === 'string' ? t.at : null,
        why: `the run RECORDED that it ended: state ${JSON.stringify(rec.state)}`
          + `${boundary ? ` at boundary ${boundary}` : ''}`
          + `${typeof t.at === 'string' ? ` on ${t.at}` : ''} — a written fact, not a staleness `
          + 'inference',
        summary: `run ${rec.run_id} ENDED — ${rec.state}`
          + `${boundary ? ` (${boundary})` : ''}${typeof t.at === 'string' ? ` on ${t.at}` : ''}`,
      });
    }
    return Object.assign(base, {
      terminal: checkpoint.TERMINAL_STATES.indexOf(rec.state) !== -1,
      terminal_source: rec.state_source === 'recorded' ? 'recorded' : 'derived',
      why: `state is ${JSON.stringify(rec.state)} (${rec.state_source}) — only `
        + `${STALE_CANDIDATE_STATES.join('/')} runs can be stale paused runs`,
      summary: `run ${rec.run_id} is ${rec.state} — not a stale paused run`,
    });
  }

  const sched = readResumeSchedule(rec.raw);
  const pausedMs = pausedAtMs(rec.raw);
  const out = Object.assign(base, {
    scheduled_at: sched.at,
    scheduled_source: sched.source,
    paused_at: (rec.raw && rec.raw.paused && rec.raw.paused.at) || null,
  });

  if (sched.ms !== null) {
    const overdueBy = nowMs - sched.ms;
    if (overdueBy > 0) {
      return Object.assign(out, {
        stale: true,
        reason: 'overdue-scheduled-resume',
        stale_for_ms: overdueBy,
        stale_for: formatDuration(overdueBy),
        why: `its scheduled resume at ${sched.at} (${sched.source}) has passed`,
        summary: `run ${rec.run_id} PAUSED and overdue by ${formatDuration(overdueBy)} — `
          + `resume was scheduled for ${sched.at}`,
      });
    }
    // AC-3. Still to come. Not stale, and saying WHEN it is due is the useful half.
    return Object.assign(out, {
      why: `its resume is scheduled for ${sched.at}, which is ${formatDuration(-overdueBy)} away`,
      summary: `run ${rec.run_id} PAUSED, resume due in ${formatDuration(-overdueBy)}`,
    });
  }

  // No usable schedule. THE ARM THE REAL ARCHIVED RUN LANDS ON — see the header.
  if (pausedMs === null) {
    return Object.assign(out, {
      why: 'no usable resume schedule and no usable `paused.at` — nothing to measure age from',
      summary: `run ${rec.run_id} PAUSED with no schedule and no pause timestamp — cannot age it`,
    });
  }
  const age = nowMs - pausedMs;
  if (age > maxAge) {
    return Object.assign(out, {
      stale: true,
      reason: 'paused-without-schedule',
      stale_for_ms: age,
      stale_for: formatDuration(age),
      why: `it has been paused for ${formatDuration(age)} with no scheduled resume`
        + (sched.source === 'unparseable'
          ? ` (it carries a resume time this module will not trust: ${JSON.stringify(sched.at)})`
          : ''),
      summary: `run ${rec.run_id} PAUSED ${formatDuration(age)} ago with no scheduled resume `
        + `(older than the ${formatDuration(maxAge)} threshold)`,
    });
  }
  return Object.assign(out, {
    why: `paused ${formatDuration(age)} ago, within the ${formatDuration(maxAge)} threshold`,
    summary: `run ${rec.run_id} PAUSED ${formatDuration(age)} ago — not yet stale`,
  });
}

/**
 * Every checkpoint record under `reportsDir`, de-duplicated by `run_id` the same way
 * `autopilot-checkpoint.unfinishedRun()` does it — the live pointer and a run's own archive
 * are ONE run, and reporting a stale run twice is how a notice becomes noise.
 */
function candidateRecords(reportsDir) {
  const seen = new Map();
  const unreadable = [];
  for (const r of checkpoint.listCheckpoints(reportsDir)) {
    if (!r.ok) { unreadable.push({ path: r.path, error: r.error }); continue; }
    const key = r.run_id || r.path;
    if (!seen.has(key) || r.live === false) seen.set(key, r);
  }
  return { records: [...seen.values()], unreadable };
}

/**
 * AC-2..AC-5 — the signal `session-start` reads.
 *
 * @param {string} reportsDir
 * @param {{now?: string|number|Date, maxPausedAgeMs?: number}} opts `now` is REQUIRED in
 *        spirit: it defaults to `Date.now()` for the CLI, and every test passes it explicitly.
 * @returns {{stale: boolean, runs: [], considered: [], unreadable: [], now: string, summary}}
 * NEVER WRITES. NEVER THROWS.
 */
function staleRuns(reportsDir, opts) {
  const options = opts || {};
  let nowMs;
  if (typeof options.now === 'number' && Number.isFinite(options.now)) nowMs = options.now;
  else if (options.now instanceof Date) nowMs = options.now.getTime();
  else if (typeof options.now === 'string' && options.now.trim() !== '') {
    const parsed = instantMs(options.now);
    nowMs = parsed === null ? NaN : parsed;
  } else nowMs = Date.now();

  if (!Number.isFinite(nowMs)) {
    return {
      stale: false, runs: [], considered: [], unreadable: [], now: String(options.now),
      summary: `refusing to judge staleness against ${JSON.stringify(options.now)} — `
        + 'that is not an ISO 8601 instant with a zone designator',
    };
  }

  const { records, unreadable } = candidateRecords(reportsDir);
  const considered = records.map(r => classifyStale(r, nowMs, options));

  // THE DISMISSAL STORE IS READ, NOT OBEYED (STORY-29.1.04, ADR-0180). `runs` and `stale` keep
  // meaning exactly what they meant before — the FACTS, every stale run, dismissed or not —
  // because a dismissal is a judgement about whether to nag, never a claim that the run stopped
  // being stale. A detector that quietly shortened its own answer would be the blanket mute
  // BACKLOG-0147 Tranche B names as the failure mode. The SURFACES (this CLI, the board) render
  // `active`; `--include-dismissed` renders `runs`.
  const store = dismissal.read(reportsDir || checkpoint.DEFAULT_REPORTS_DIR);
  for (const v of considered) {
    const record = v.stale ? dismissal.isDismissed(store.dismissals, v) : null;
    v.evidence_key = dismissal.evidenceKey(v);
    v.dismissed = record !== null;
    v.dismissal = record;
  }
  const runs = considered.filter(v => v.stale);
  const active = runs.filter(v => !v.dismissed);
  const dismissed = runs.filter(v => v.dismissed);

  const activeSummary = active.length
    ? `stale paused run(s): ${active.map(v => `${v.run_id} (${v.reason}, ${v.stale_for})`).join(', ')}`
    : `no stale paused run — ${considered.length} checkpoint record(s) considered`;
  return {
    stale: runs.length > 0,
    runs,
    active,
    dismissed,
    dismissals: store.dismissals,
    // A store that exists and could not be read is carried, never swallowed: read as empty it
    // would un-dismiss everything, and the notice would return looking like new evidence.
    dismissalStore: { path: store.path, exists: store.exists, error: store.error },
    considered,
    unreadable,
    now: new Date(nowMs).toISOString(),
    // The two shapes `skills/session-start` documents are preserved verbatim. The dismissed
    // count is APPENDED rather than folded in, so a run that has been judged is still one
    // sentence away instead of invisible.
    summary: dismissed.length
      ? `${activeSummary} · ${dismissed.length} dismissed (see --include-dismissed)`
      : activeSummary,
  };
}

// ---------- CLI ----------

function usage(msg) {
  if (msg) console.error(msg);
  console.error('usage: node autopilot-stale-runs.js [--dir <reports-dir>] [--now <iso>] '
    + '[--max-paused-age-hours <n>] [--include-dismissed] [--json]');
  console.error('       node autopilot-stale-runs.js --schedule <run_id> --at <iso> '
    + '[--dir <reports-dir>]');
  console.error('       node autopilot-stale-runs.js --dismiss <run_id> --reason "<why>" '
    + '[--by "<who>"] [--dir <reports-dir>]');
  console.error('  --by defaults to `git config user.name`. A dismissal records WHO judged it as '
    + 'well as why, and neither may be empty.');
  return EXIT_USAGE;
}

/**
 * The default ACTOR. `git config user.name` is who this repository already believes is working,
 * it is what every commit beside the dismissal will carry, and it needs no new configuration.
 *
 * NEVER THROWS and never guesses: an unset name returns '' and the caller refuses, rather than
 * inventing "unknown" — a store whose actor field can say `unknown` has the field and not the
 * property (the `run_id: "unattributed-run"` shape BACKLOG-0165 is about).
 */
function defaultActor() {
  try {
    const out = require('child_process')
      .execFileSync('git', ['config', 'user.name'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return typeof out === 'string' ? out.trim() : '';
  } catch {
    return '';
  }
}

// Boolean flags — listed, because the value-consuming parser below would otherwise swallow the
// NEXT argument as this flag's value, which is how a stray argument gets silently eaten
// (the defect `tests/lib/arg-guard.js` exists to stop, applied to a CLI rather than a test).
const BOOLEAN_FLAGS = Object.freeze(['--json', '--include-dismissed']);

function main(argv) {
  const args = argv.slice(2);
  const flags = Object.create(null);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (BOOLEAN_FLAGS.indexOf(a) !== -1) { flags[a.slice(2)] = true; continue; }
    if (a.indexOf('--') !== 0) return usage(`unexpected argument "${a}"`);
    const v = args[i + 1];
    if (v === undefined || String(v).indexOf('--') === 0) { flags[a.slice(2)] = ''; continue; }
    flags[a.slice(2)] = v;
    i++;
  }
  const dir = flags.dir || undefined;

  if (flags.schedule !== undefined) {
    if (!flags.schedule) return usage('--schedule requires a run_id');
    try {
      const res = scheduleResume(dir, flags.schedule, flags.at);
      console.log(`resume_scheduled ${res.record[RESUME_SCHEDULED_KEY]} recorded for `
        + `${res.record.run_id} -> ${res.ownPath}`);
      return EXIT_OK;
    } catch (err) {
      console.error(`could not schedule a resume: ${safeMessage(err)}`);
      return EXIT_WRITE_FAILED;
    }
  }

  const hours = Number(flags['max-paused-age-hours']);
  const detectOpts = {
    now: flags.now || undefined,
    maxPausedAgeMs: Number.isFinite(hours) && flags['max-paused-age-hours']
      ? hours * 3600000 : undefined,
  };

  // STORY-29.1.04 — the deliberate write. Its own branch, before detection prints anything, so
  // it can never be reached by an invocation whose purpose is to look.
  if (flags.dismiss !== undefined) {
    if (!flags.dismiss) return usage('--dismiss requires a run_id');
    // TRIMMED before the test. `--reason "   "` is a reason-less dismissal wearing three
    // spaces, and it must land on the SAME usage code as omitting the flag — a caller who
    // typed nothing and a caller who typed whitespace made the same mistake, and two exit
    // codes for one mistake is a contract nobody can act on.
    if (!String(flags.reason || '').trim()) {
      return usage('--dismiss requires --reason "<why>" — a dismissal with no reason is a '
        + 'judgement nobody can read back');
    }
    // THE ACTOR, on the same terms as the reason (BUG-20260810-04). `--by` wins; otherwise the
    // repository's own `git config user.name`. An unset git identity refuses HERE rather than
    // reaching the store with an empty field.
    //
    // WHITESPACE IS NOT A NAME, AND IT IS NOT AN ABSENCE EITHER (review round-2 NEW-2). This
    // trimmed `--by "   "` to empty and then fell through to the git identity, so a caller who
    // typed whitespace got exit 0 and SOMEBODY ELSE'S NAME recorded as the judge — while the
    // same whitespace in `--reason` exits 2. Two contracts for one mistake, and the actor half
    // failed silently in the direction that matters: attributing a judgement to a person who did
    // not make it. Supplied-but-empty is now the same refusal as an unusable identity; only an
    // ABSENT `--by` falls back.
    const bySupplied = flags.by !== undefined;
    const byTyped = String(flags.by || '').trim();
    if (bySupplied && byTyped === '') {
      return usage('--by was given but is empty or whitespace. That is not a name, and it must '
        + 'not fall back to `git config user.name` — attributing a judgement to whoever happens '
        + 'to be configured is worse than refusing. Pass a real actor, or omit --by entirely to '
        + 'use the git identity deliberately.');
    }
    const by = byTyped || defaultActor();
    if (!by) {
      return usage('--dismiss requires an actor: pass --by "<who>", or set `git config '
        + 'user.name`. A dismissal that cannot say who judged it is the half of '
        + '"who-dismissed-why" this store exists to answer.');
    }
    try {
      const res = dismissRun(dir, flags.dismiss, flags.reason,
        Object.assign({}, detectOpts, { by }));
      console.log(`dismissed ${res.record.run_id} (${res.record.stale_reason}) — `
        + `"${res.record.reason}" by ${res.record.dismissed_by} `
        + `at ${res.record.dismissed_at} -> ${res.path}`);
      console.log(`  evidence: ${res.record.evidence_key}`);
      console.log('  it will surface again the moment that evidence changes — a new pause, a '
        + 'different staleness arm, or another run.');
      if (res.alreadyDismissed) {
        console.log('  note: this evidence had already been dismissed; the store is append-only '
          + 'and both judgements are kept.');
      }
      return EXIT_OK;
    } catch (err) {
      console.error(`could not dismiss: ${safeMessage(err)}`);
      return EXIT_WRITE_FAILED;
    }
  }

  const verdict = staleRuns(dir, detectOpts);
  const shown = flags['include-dismissed'] ? verdict.runs : verdict.active;

  if (flags.json) console.log(JSON.stringify(verdict, null, 2));
  else {
    console.log(verdict.summary);
    for (const r of shown) {
      console.log(`  - ${r.summary}${r.dismissed ? ' [DISMISSED]' : ''}`);
      // THE RECORD IS NEVER SWALLOWED (AC-3). Even under `--include-dismissed`, the reason and
      // the instant travel with the run, so "why is this quiet?" is answerable from the same
      // command that went quiet.
      if (r.dismissed && r.dismissal) {
        console.log(`      dismissed ${r.dismissal.dismissed_at}: "${r.dismissal.reason}"`);
      }
    }
    if (!flags['include-dismissed'] && verdict.dismissed.length) {
      console.log(`  (${verdict.dismissed.length} dismissed run(s) hidden — `
        + `--include-dismissed shows them with their reasons)`);
    }
    if (verdict.dismissalStore.error) {
      console.log(`  ! dismissal store: ${verdict.dismissalStore.error} `
        + `(${verdict.dismissalStore.path})`);
    }
    for (const u of verdict.unreadable) {
      console.log(`  ! unreadable checkpoint: ${u.path} (${u.error})`);
    }
  }
  // ALWAYS 0 for detection — orientation must never be blocked by a probe.
  return EXIT_OK;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = {
  RESUME_SCHEDULED_KEY, DEFAULT_MAX_PAUSED_AGE_MS, STALE_REASONS, SCHEDULE_SOURCES,
  STALE_CANDIDATE_STATES, BOOLEAN_FLAGS,
  EXIT_OK, EXIT_USAGE, EXIT_WRITE_FAILED,
  isIsoInstant, instantMs, formatDuration,
  readResumeSchedule, pausedAtMs, withResumeScheduled, scheduleResume,
  classifyStale, candidateRecords, staleRuns, dismissRun, defaultActor, dismissal, main,
};
