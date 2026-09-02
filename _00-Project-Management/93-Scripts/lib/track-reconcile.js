'use strict';
/**
 * track-reconcile.js — ONE executed-truth across the two tracks, and the run-kind of a unit
 * (STORY-29.2.03; BACKLOG-0113 Tranche C · BACKLOG-0153 Tranche C).
 *
 * ============================================================================
 * THE DEFECT THIS ANSWERS
 * ============================================================================
 * Since ADR-0182 the strategist emits the same story corpus TWICE: as `phases[].chats[]` (the
 * chat track, what a human session runs) and as `autopilot_runs[]` (the autopilot track, what
 * an unattended run dispatches). Only the chat track carries a forward-written `executed` flag,
 * and only `execute-batch` writes it. So the moment autopilot finished the work:
 *
 *   - the chat track's chat still reads `executed: false` and the board reports it UNEXECUTED,
 *     even though every one of its stories is `done`;
 *   - and if anything ever wrote the run side too, the same story would be counted once under
 *     its chat and again under its run.
 *
 * Both failures are of the same shape — two groupings, one corpus, and no rule saying which one
 * the board believes.
 *
 * ============================================================================
 * THE RULE: THE BOARD WINS, AND THE JOIN HAPPENS AT READ TIME (ADR-0186)
 * ============================================================================
 * `skills/autopilot/SKILL.md` already states the precedence for resume: "story status and chat
 * `executed` flags are ground truth; the checkpoint is a hint". This module makes that the
 * reconciliation rule for the whole board:
 *
 *   1. A STORY'S `status:` IS THE ONE TRUTH. Neither track owns it. It is written once, by
 *      whichever track ran the story, at the same moment either track would have written it.
 *   2. A UNIT (a chat, or a run) IS EXECUTED WHEN ITS OWN FLAG SAYS SO, AND
 *      COVERED-BY-REFERENCE WHEN EVERY STORY IT COVERS IS `done` WITHOUT ITS OWN FLAG BEING SET.
 *      `covered-by-reference` is a THIRD state, deliberately not folded into `executed`: a
 *      reader must be able to tell "this chat was run" from "this chat's work landed elsewhere".
 *   3. NO UNIT WHOSE STORIES ARE ALL `done` IS EVER REPORTED `not-executed`. That is the
 *      BACKLOG-0113 Tranche C warning, stated as an invariant a test can check.
 *
 * NOTHING IS REWRITTEN. Sidecars are frozen snapshots of a plan (ADR-0152's never-rewrite
 * stance, and the story's own gotcha). This module writes nothing at all: it is a read-time
 * join over three inputs that already exist — the sidecar, the live story records, and the
 * retro ledger's `run_id` beside `join_key` (ADR-0179, written by both capture writers since
 * STORY-29.1.03). The "forward-written marker" the story's Risks section asked us to choose
 * between is therefore ALREADY WRITTEN, one layer down, by a writer that exists; adding a
 * second one in the sidecar would be a second truth to keep in sync.
 *
 * ============================================================================
 * RUN-KIND IS ASYMMETRIC ON PURPOSE, AND NEVER GUESSED
 * ============================================================================
 * PLANNED side — positive evidence in the sidecar, so both kinds are assertable:
 *
 *   autopilot      the chat is named in some `autopilot_runs[].chats[]`
 *   batch          a track WAS emitted and no run claims this chat, so the plan is for a human
 *                  session to batch it
 *   unclassified   no track in this sidecar (the key is absent) — the producer never grouped
 *                  for autopilot, so "not in a run" carries no information. ADR-0184 is
 *                  explicit that an absent key and an empty track are different facts.
 *
 * EXECUTED side — evidence is one-sided, and the enum says so:
 *
 *   autopilot      the unit's ledger record names a real run, or a written run plan declares
 *                  the unit in its `scope_chats` and that run has a `run`-level ledger record
 *   unattributed   the record carries `run_id: "unattributed-run"` — the kit's honest marker
 *                  for "the capture was not told a run". IT IS NOT `batch`: measured on this
 *                  repo on 2026-08-10, E29-CHAT-02 and E29-CHAT-03 carry exactly that marker
 *                  and were both dispatched by autopilot-2026-08-05-epic28-29-32a. Reading the
 *                  marker as "manual batch" would have mislabelled two real autopilot chats.
 *   unclassified   no record, or a record written before the field existed (114 of the 124 live
 *                  records, measured 2026-08-10 — the ledger is append-only, so the numerator
 *                  is fixed and the denominator only grows; date-stamped rather than left to
 *                  read as current)
 *
 * THERE IS NO EXECUTED `batch`. Asserting it would require reading a MISSING run signal as
 * evidence of a human session, and absence of evidence is the one inference this module refuses
 * to make. `unclassified` is the honest answer and FEAT-30.1's display contract renders it as
 * one.
 *
 * NEVER THROWS. Consumed by `generate-dashboard.js`, whose contract is that a malformed
 * artefact degrades the board rather than failing the generation.
 *
 * Node stdlib only, and it requires nothing from `93-Scripts/` — `ledger-join.js`'s constants
 * are re-declared as a two-line local mirror rather than imported, because this file is loaded
 * by the dashboard builder and a require chain into the ledger reader is a cycle waiting to
 * happen. The mirror is asserted equal to the source in the test.
 */

/** `ledger-join.js`'s `RUN_FIELD` / `UNATTRIBUTED_RUN`. Mirrored, and pinned by the test. */
const RUN_FIELD = 'run_id';
const UNATTRIBUTED_RUN = 'unattributed-run';
const KEY_FIELD = 'join_key';

/** The planned side can assert both kinds; the executed side cannot. See the header. */
const PLANNED_KINDS = Object.freeze(['autopilot', 'batch', 'unclassified']);
const EXECUTED_KINDS = Object.freeze(['autopilot', 'unattributed', 'unclassified']);

/** What a phase rolls up to when its chats disagree. */
const MIXED = 'mixed';

/** The unit states. `covered-by-reference` is the state this module exists to add. */
const STATES = Object.freeze([
  'executed', 'covered-by-reference', 'partially-executed', 'not-executed', 'empty',
]);

const DONE_STATUS = 'done';

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function arr(v) {
  return Array.isArray(v) ? v : [];
}

/** A story entry in a sidecar may be a bare id string or `{id, status, ready}`. */
function storyId(entry) {
  if (entry === null || entry === undefined) return '';
  if (typeof entry === 'string') return entry.trim();
  if (typeof entry === 'object') return str(entry.id);
  return '';
}

/**
 * Is this a real run id, as opposed to the honest "no run" marker or an absent field?
 * Deliberately shape-agnostic beyond the marker: `autopilot-plan.js` owns the id GRAMMAR, and a
 * reader that re-validated it here would reject a run the writer accepted.
 */
function isRealRunId(v) {
  const s = str(v);
  return s !== '' && s !== UNATTRIBUTED_RUN;
}

/**
 * `E31-CHAT-01` -> `'31'`; `CHAT-01` -> `null`. A BARE chat id names no epic, and chat ids are
 * only unique WITHIN an epic — every board on this repository has a `CHAT-01`. ADR-0179's
 * canonical spelling is the qualified one for exactly that reason.
 */
function chatEpic(id) {
  const m = /^E0*(\d+)-CHAT-/i.exec(str(id));
  return m ? String(Number(m[1])) : null;
}

/** `STORY-31.1.02` -> `'31'`; anything else -> `null`. */
function storyEpic(id) {
  const m = /^STORY-0*(\d+)\./i.exec(str(id));
  return m ? String(Number(m[1])) : null;
}

/**
 * The epic(s) a written run plan's scope is DEMONSTRABLY about, read from the spellings that
 * carry an epic: a qualified chat id, or any story id. An EMPTY set is the honest answer for a
 * plan that named its whole scope in ids that do not say which board they belong to — and it is
 * treated as no evidence, never as "any epic".
 *
 * Accepts the raw `readPlan()` shape (`scope_chats` / `scope_stories`) as well as the
 * normalised one (`chats` / `stories`), because both reach `executedRunKind()` in practice.
 *
 * @returns {Set<string>} epic numbers as strings, e.g. `{'28','29','32'}`
 */
function scopeEpics(scope) {
  const set = new Set();
  for (const c of arr(scope && (scope.chats || scope.scope_chats))) {
    const e = chatEpic(c);
    if (e) set.add(e);
  }
  for (const s of arr(scope && (scope.stories || scope.scope_stories))) {
    const e = storyEpic(storyId(s));
    if (e) set.add(e);
  }
  return set;
}

/* =========================================================================
 * PLANNED run-kind — from the sidecar's two tracks
 * ======================================================================= */

/**
 * Which chats each emitted run claims. Returns a Map<chatId, runId>, and the SECOND claim on a
 * chat is reported rather than overwritten: ADR-0184 forbids a chat appearing in two runs, and
 * a reconciler that silently kept the last writer would hide the very defect the shape test
 * fails.
 *
 * @returns {{byChat: Map<string,string>, duplicates: Array<{chat, runs: string[]}>}}
 */
function indexTrack(sidecar) {
  const byChat = new Map();
  const claims = new Map();
  for (const run of arr(sidecar && sidecar.autopilot_runs)) {
    const runId = str(run && run.id);
    if (runId === '') continue;
    for (const c of arr(run && run.chats)) {
      const chat = str(c);
      if (chat === '') continue;
      if (!claims.has(chat)) claims.set(chat, []);
      claims.get(chat).push(runId);
      if (!byChat.has(chat)) byChat.set(chat, runId);
    }
  }
  const duplicates = [];
  for (const [chat, runs] of claims) if (runs.length > 1) duplicates.push({ chat, runs });
  return { byChat, duplicates };
}

/** Does this sidecar carry an autopilot track AT ALL? Absent key !== empty array (ADR-0184). */
function trackPresence(sidecar) {
  const raw = sidecar ? sidecar.autopilot_runs : undefined;
  if (!Array.isArray(raw)) return { present: false, empty: false, runs: 0 };
  return { present: true, empty: raw.length === 0, runs: raw.length };
}

/**
 * The planned run-kind of one chat. Never a guess — every answer names its basis.
 * @returns {{kind: string, basis: string, run: string|null}}
 */
function plannedRunKind(chatId, sidecar, index) {
  const idx = index || indexTrack(sidecar);
  const presence = trackPresence(sidecar);
  const chat = str(chatId);
  if (!presence.present) {
    return {
      kind: 'unclassified',
      basis: 'this sidecar carries no `autopilot_runs` key, so no run was ever planned for or '
        + 'against this chat',
      run: null,
    };
  }
  const run = idx.byChat.get(chat);
  if (run) {
    return { kind: 'autopilot', basis: `planned into ${run} of the emitted track`, run };
  }
  if (presence.empty) {
    return {
      kind: 'unclassified',
      basis: 'the emitted track is empty while chats exist — the emission cannot say how this '
        + 'chat was meant to run',
      run: null,
    };
  }
  return {
    kind: 'batch',
    basis: `a track of ${presence.runs} run(s) was emitted and no run claims this chat — it is `
      + 'planned as a chat-track batch',
    run: null,
  };
}

/* =========================================================================
 * EXECUTED run-kind — from the ledger, and from written run scopes
 * ======================================================================= */

/**
 * Index the retro ledger by the unit each record is about. The key is `join_key` when the
 * record carries one (ADR-0179's canonical spelling) and the record's own `id` otherwise, so a
 * pre-key record still indexes under the id it was written with.
 *
 * @param {object[]} retroRecords
 * @returns {Map<string, object[]>}
 */
function indexLedger(retroRecords) {
  const byUnit = new Map();
  for (const rec of arr(retroRecords)) {
    if (rec === null || typeof rec !== 'object') continue;
    const keys = new Set();
    const jk = str(rec[KEY_FIELD]);
    if (jk) keys.add(jk);
    const id = str(rec.id);
    if (id) keys.add(id);
    for (const k of keys) {
      if (!byUnit.has(k)) byUnit.set(k, []);
      byUnit.get(k).push(rec);
    }
  }
  return byUnit;
}

/** The run ids the ledger holds a `run`-level record for — the runs that demonstrably ran. */
function ledgerRunIds(retroRecords) {
  const ids = new Set();
  for (const rec of arr(retroRecords)) {
    if (rec && rec.level === 'run' && str(rec.id)) ids.add(str(rec.id));
  }
  return ids;
}

/**
 * The executed run-kind of one unit.
 *
 * @param {string[]} unitKeys  every spelling this unit answers to (`E29-CHAT-04`, `CHAT-04`, …)
 * @param {Map} ledgerIndex    from `indexLedger()`
 * @param {object} [opts]
 * @param {Array<{run_id: string, chats: string[]}>} [opts.runScopes] written run plans, used
 *        ONLY when the plan's run also has a `run`-level ledger record — a plan is an
 *        authorisation, and an authorisation that never ran is not evidence that it did
 * @param {Set<string>} [opts.ranRunIds]
 * @param {string} [opts.unitEpic] the epic number of the sidecar this unit belongs to (`'31'`).
 *        REQUIRED for a plan scope written in bare chat ids to be honoured — see the join rule
 *        in step 2 below.
 * @returns {{kind: string, basis: string, run: string|null, records: number}}
 */
function executedRunKind(unitKeys, ledgerIndex, opts) {
  const options = opts || {};
  const keys = arr(unitKeys).map(str).filter(k => k !== '');
  const records = [];
  const seen = new Set();
  for (const k of keys) {
    for (const rec of (ledgerIndex && ledgerIndex.get(k)) || []) {
      if (seen.has(rec)) continue;
      seen.add(rec);
      records.push(rec);
    }
  }

  // 1. A record that names a real run. The strongest evidence there is: the writer was TOLD.
  const named = records.find(r => isRealRunId(r[RUN_FIELD]));
  if (named) {
    return {
      kind: 'autopilot',
      basis: `the ledger record for this unit names run ${str(named[RUN_FIELD])}`,
      run: str(named[RUN_FIELD]),
      records: records.length,
    };
  }

  // 2. A written run plan that declares this unit in scope, for a run the ledger shows ran.
  //    Positive evidence — a document, not an inference from silence.
  //
  //    THE JOIN IS EPIC-QUALIFIED (BUG-20260810-07). Chat ids are unique only WITHIN an epic,
  //    and the authorisation seam MANDATES the bare spelling in a plan: the strategist emits a
  //    run whose `chats` are this sidecar's own `CHAT-01`/`CHAT-02`, and
  //    `autopilot-plan.js :: verifyTrackReference()` fails any plan whose `scope_chats` is not
  //    that list exactly — so an implementer cannot legally qualify them. Matching a plan scope
  //    against ANY spelling a unit answers to therefore made ONE EPIC-31 plan attribute EVERY
  //    board's `CHAT-01` to its run, and `combineRunKind()` lets that outrank the correct
  //    planned side. So:
  //
  //      - a QUALIFIED scope entry (`E31-CHAT-01`) carries its own epic and is trusted as
  //        written, wherever it appears;
  //      - a BARE entry (`CHAT-01`) is honoured only when the plan's OWN scope demonstrably
  //        concerns this unit's epic — a qualified chat id or a story id in the same scope;
  //      - a plan whose scope names no epic at all attributes NOTHING. Absence of evidence is
  //        the one inference this module refuses to make (ADR-0186 §4), and "some epic's
  //        CHAT-01" is not an identification.
  const ran = options.ranRunIds instanceof Set ? options.ranRunIds : new Set();
  const unitEpic = str(options.unitEpic);
  for (const scope of arr(options.runScopes)) {
    const runId = str(scope && scope.run_id);
    if (runId === '' || !ran.has(runId)) continue;
    const declared = arr(scope && scope.chats).map(str);
    const has = k => declared.indexOf(k) !== -1;
    let hit = keys.find(k => chatEpic(k) !== null && has(k)) || null;
    let how = hit ? 'its epic-qualified id' : '';
    // …AND THE PLAN'S SCOPE MUST NAME EXACTLY ONE EPIC (BUG-20260810-08).
    //
    // `scopeEpics()` is computed PLAN-WIDE, so on a scope like
    // `["E91-CHAT-01", "CHAT-01", "CHAT-02"]` + EPIC-31 stories the single qualified foreign entry
    // put `91` into the evidence set — and every BARE id in that plan then unlocked for EPIC-91,
    // taking `CHAT-02`, which belonged to EPIC-31. `.has(unitEpic)` asked "does this plan concern
    // that epic at all", which is not the same question as "is THIS bare id that epic's".
    //
    // When a scope names one epic, a bare id in it can only mean that epic's chat, and the
    // inference is sound. When it names two or more, the plan must qualify every entry or the bare
    // ones attribute NOTHING — which is ADR-0186 §4's own stance ("absence of evidence is the one
    // inference this module refuses to make") applied to the mixed case it did not anticipate.
    // Nothing is lost in the shape the authorisation seam actually produces:
    // `verifyTrackReference()` enforces transcription of ONE named run from ONE sidecar, so a
    // legally-emitted plan is single-epic and this gate never fires on it.
    const epics = scopeEpics(scope);
    if (!hit && unitEpic !== '' && epics.size === 1 && epics.has(unitEpic)) {
      hit = keys.find(k => chatEpic(k) === null && has(k)) || null;
      how = hit ? `\`${hit}\`, whose epic that plan's own scope confirms is EPIC-${unitEpic} — `
        + 'and that scope names no other epic, so the bare id is unambiguous' : '';
    }
    if (hit) {
      return {
        kind: 'autopilot',
        basis: `run plan for ${runId} declares this unit in \`scope_chats\` by ${how}, and the `
          + 'ledger holds a `run`-level record for that run',
        run: runId,
        records: records.length,
      };
    }
  }

  // 3. The honest marker. NOT `batch` — see the header.
  const unattributed = records.find(r => str(r[RUN_FIELD]) === UNATTRIBUTED_RUN);
  if (unattributed) {
    return {
      kind: 'unattributed',
      basis: 'the ledger record carries `run_id: "' + UNATTRIBUTED_RUN + '"` — the capture was '
        + 'not told a run. That is not a claim that a human ran it',
      run: null,
      records: records.length,
    };
  }

  // 4. A record with no run signal at all: written before the field existed.
  if (records.length) {
    return {
      kind: 'unclassified',
      basis: `${records.length} ledger record(s) for this unit carry no \`${RUN_FIELD}\` field `
        + '— they predate it',
      run: null,
      records: records.length,
    };
  }

  return {
    kind: 'unclassified',
    basis: 'no ledger record names this unit',
    run: null,
    records: 0,
  };
}

/**
 * The single `run_kind` a view renders, and where it came from. The EXECUTED side wins when it
 * is definite, because what happened outranks what was planned; the planned side is the
 * fallback; `unclassified` when neither can speak.
 */
function combineRunKind(planned, executed) {
  const p = planned || { kind: 'unclassified', basis: '', run: null };
  const e = executed || { kind: 'unclassified', basis: '', run: null };
  if (e.kind === 'autopilot') {
    return { kind: 'autopilot', source: 'executed', basis: e.basis, planned: p, executed: e };
  }
  if (p.kind === 'autopilot' || p.kind === 'batch') {
    return { kind: p.kind, source: 'planned', basis: p.basis, planned: p, executed: e };
  }
  return {
    kind: 'unclassified',
    source: 'none',
    basis: `planned: ${p.basis || 'no signal'} · executed: ${e.basis || 'no signal'}`,
    planned: p,
    executed: e,
  };
}

/** Roll several unit kinds into one. Disagreement is `mixed`, never a majority vote. */
function rollUpKind(kinds) {
  const list = arr(kinds).filter(k => k !== 'unclassified');
  if (!list.length) return 'unclassified';
  const distinct = Array.from(new Set(list));
  return distinct.length === 1 ? distinct[0] : MIXED;
}

/* =========================================================================
 * The reconciliation
 * ======================================================================= */

/**
 * The state of one unit given the live status of the stories it covers.
 * @returns {{state: string, done: number, total: number}}
 */
function unitState(storyIds, statusOf, executedFlag) {
  const ids = arr(storyIds).map(str).filter(Boolean);
  const done = ids.filter(id => statusOf(id) === DONE_STATUS).length;
  if (!ids.length) return { state: executedFlag ? 'executed' : 'empty', done: 0, total: 0 };
  if (executedFlag) return { state: 'executed', done, total: ids.length };
  // INVARIANT (AC-2). Every story done and no flag is NEVER `not-executed`.
  if (done === ids.length) return { state: 'covered-by-reference', done, total: ids.length };
  if (done > 0) return { state: 'partially-executed', done, total: ids.length };
  return { state: 'not-executed', done: 0, total: ids.length };
}

/**
 * Reconcile one strategy sidecar against the live board and the ledger.
 *
 * @param {object} input
 * @param {object} input.sidecar            the parsed EXECUTION-STRATEGY-*.json
 * @param {Map<string,string>|object} input.storyStatus  live story id -> status
 * @param {object[]} [input.retroRecords]   parsed retro-log.jsonl records
 * @param {Array<{run_id, chats}>} [input.runScopes] written run plans (`readPlan()` output is
 *        accepted directly: `{run_id, scope_chats}` is normalised here)
 * @returns {object} see the header of each field below. NEVER THROWS.
 */
function reconcile(input) {
  try {
    const inp = input || {};
    const sidecar = inp.sidecar || {};
    const statusMap = inp.storyStatus instanceof Map
      ? inp.storyStatus
      : new Map(Object.entries(inp.storyStatus || {}));
    const statusOf = id => str(statusMap.get(str(id)) || '');

    const retro = arr(inp.retroRecords);
    const ledgerIndex = indexLedger(retro);
    const ranRunIds = ledgerRunIds(retro);
    const runScopes = arr(inp.runScopes).map(s => ({
      run_id: str(s && (s.run_id || s.runId)),
      chats: arr(s && (s.chats || s.scope_chats)).map(str).filter(Boolean),
      stories: arr(s && (s.stories || s.scope_stories)).map(storyId).filter(Boolean),
    })).filter(s => s.run_id !== '');

    const index = indexTrack(sidecar);
    const presence = trackPresence(sidecar);
    const epic = str(sidecar.epic) || '(unknown)';
    // `EPIC-29` -> the `E29-` prefix the ledger's canonical chat key uses (ADR-0179).
    const epicNum = (/^EPIC-0*(\d+)/i.exec(epic) || [])[1] || null;
    const unitEpic = epicNum ? String(Number(epicNum)) : '';
    const keysFor = id => (epicNum && /^CHAT-\d+$/i.test(str(id))
      ? [str(id), `E${Number(epicNum)}-${str(id).toUpperCase()}`]
      : [str(id)]);

    /* ---- chats, phase by phase ------------------------------------------ */
    const chats = [];
    const chatById = new Map();
    const phases = [];
    arr(sidecar.phases).forEach((phase, phaseIndex) => {
      const phaseChats = [];
      for (const chat of arr(phase && phase.chats)) {
        const id = str(chat && chat.id);
        const stories = arr(chat && chat.stories).map(storyId).filter(Boolean);
        const flag = chat && chat.executed === true;
        const st = unitState(stories, statusOf, flag);
        const planned = plannedRunKind(id, sidecar, index);
        const executed = executedRunKind(keysFor(id), ledgerIndex,
          { runScopes, ranRunIds, unitEpic });
        const rec = {
          id,
          track: 'chat',
          phase_index: phaseIndex,
          phase_name: str(phase && phase.name),
          title: str(chat && chat.title),
          stories,
          executed_flag: flag,
          state: st.state,
          stories_done: st.done,
          stories_total: st.total,
          // Filled in below, once both tracks' units exist — reconciliation is a join, and a
          // join cannot be completed while only one side has been walked.
          reconciled_by: [],
          state_basis: '',
          run_kind: combineRunKind(planned, executed),
        };
        chats.push(rec);
        phaseChats.push(rec);
        if (id && !chatById.has(id)) chatById.set(id, rec);
      }
      phases.push({
        index: phaseIndex,
        name: str(phase && phase.name),
        chats: phaseChats.map(c => c.id),
        state: rollUpState(phaseChats.map(c => c.state)),
        run_kind: rollUpKind(phaseChats.map(c => c.run_kind.kind)),
        run_kind_source: rollUpKind(phaseChats.map(c => c.run_kind.source)),
      });
    });

    /* ---- runs, from the autopilot track --------------------------------- */
    const runs = [];
    for (const run of arr(sidecar.autopilot_runs)) {
      const id = str(run && run.id);
      const runChats = arr(run && run.chats).map(str).filter(Boolean);
      // A run's story corpus is its own `stories[]` when it has one, else the union of its
      // chats' stories. Both spellings occur; neither is re-derived from the other.
      const declared = arr(run && run.stories).map(storyId).filter(Boolean);
      const viaChats = [];
      for (const cid of runChats) {
        const c = chatById.get(cid);
        if (c) for (const s of c.stories) if (viaChats.indexOf(s) === -1) viaChats.push(s);
      }
      const stories = declared.length ? declared : viaChats;
      // A run has NO forward-written flag in ADR-0184's ten fields. That is deliberate: the
      // autopilot track is a plan, and the only thing that writes an executed flag today is
      // `execute-batch`, on a chat. So a run is never `executed` — at best it is covered.
      const st = unitState(stories, statusOf, false);
      const executed = executedRunKind([id].concat(runChats.flatMap(keysFor)), ledgerIndex,
        { runScopes, ranRunIds, unitEpic });
      runs.push({
        id,
        track: 'autopilot',
        title: str(run && run.title),
        chats: runChats,
        stories,
        executed_flag: false,
        state: st.state,
        stories_done: st.done,
        stories_total: st.total,
        reconciled_by: [],
        state_basis: '',
        run_kind: combineRunKind(
          { kind: 'autopilot', basis: 'this unit IS an autopilot-track run', run: id }, executed),
      });
    }

    /* ---- the join: who covers whom -------------------------------------- */
    // A chat is reconciled BY REFERENCE to the runs that contain it; a run is reconciled by
    // reference to the chats it contains. The reference is by NAME, both ways, so a reader of
    // either view can follow it to the other one.
    for (const c of chats) {
      const owning = runs.filter(r => r.chats.indexOf(c.id) !== -1);
      c.reconciled_by = c.state === 'covered-by-reference'
        ? (owning.length ? owning.map(r => r.id) : ['the story board'])
        : [];
      c.state_basis = describeState(c, c.reconciled_by);
    }
    for (const r of runs) {
      // ONLY A CHAT THAT ACTUALLY RAN CAN COVER A RUN. Counting a chat that is ITSELF only
      // `covered-by-reference` made the two units name each other — the chat "done under RUN-01",
      // the run "done under CHAT-01, CHAT-02" — when neither ran the work, and a reader
      // following the named reference went in a circle. The honest answer the module already
      // has for that case is `'the story board'`, and it was exactly the one being overwritten.
      const covering = chats.filter(c => r.chats.indexOf(c.id) !== -1
        && (c.executed_flag || c.state === 'executed'));
      r.reconciled_by = r.state === 'covered-by-reference'
        ? (covering.length ? covering.map(c => c.id) : ['the story board'])
        : [];
      r.state_basis = describeState(r, r.reconciled_by);
    }

    /* ---- the one-truth story roll -------------------------------------- */
    // ONE ROW PER DISTINCT STORY ID, across BOTH tracks. This is the anti-double-count: the
    // union is taken over a Map keyed by id, so a story that appears in a chat and in a run
    // contributes exactly one row carrying both memberships.
    const byStory = new Map();
    const touch = (id) => {
      const key = str(id);
      if (!key) return null;
      if (!byStory.has(key)) {
        byStory.set(key, {
          id: key,
          status: statusOf(key),
          done: statusOf(key) === DONE_STATUS,
          chats: [],
          runs: [],
          completed_under: 'unclassified',
          completed_basis: 'no unit covering this story carries a run signal',
        });
      }
      return byStory.get(key);
    };
    for (const c of chats) {
      for (const s of c.stories) {
        const row = touch(s);
        if (row && row.chats.indexOf(c.id) === -1) row.chats.push(c.id);
      }
    }
    for (const r of runs) {
      for (const s of r.stories) {
        const row = touch(s);
        if (row && row.runs.indexOf(r.id) === -1) row.runs.push(r.id);
      }
    }
    for (const row of byStory.values()) {
      if (!row.done) continue;
      const covering = row.chats.map(id => chatById.get(id)).filter(Boolean);
      const withRun = covering.find(c => c.run_kind.executed.kind === 'autopilot');
      if (withRun) {
        row.completed_under = 'autopilot';
        row.completed_basis = withRun.run_kind.executed.basis;
        continue;
      }
      const unattributed = covering.find(c => c.run_kind.executed.kind === 'unattributed');
      if (unattributed) {
        row.completed_under = 'unattributed';
        row.completed_basis = unattributed.run_kind.executed.basis;
      }
    }
    const stories = Array.from(byStory.values())
      .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));

    /* ---- the invariants, computed rather than asserted ------------------ */
    // Returned as data so the caller decides what to do with a violation. A library that threw
    // here would take the board down over a planning defect it should be RENDERING.
    const falselyUnexecuted = chats.concat(runs)
      .filter(u => u.stories_total > 0 && u.stories_done === u.stories_total
        && u.state === 'not-executed')
      .map(u => u.id);
    const duplicated = [];
    const counted = new Map();
    for (const u of chats) for (const s of u.stories) counted.set(s, (counted.get(s) || 0) + 1);
    for (const [id, n] of counted) if (n > 1) duplicated.push({ id, chats: n });

    return {
      epic,
      track: presence,
      duplicate_chat_claims: index.duplicates,
      phases,
      chats,
      runs,
      stories,
      counts: {
        stories: stories.length,
        stories_done: stories.filter(s => s.done).length,
        chats: chats.length,
        runs: runs.length,
        // The corpus is ONE. If the two tracks disagree about which stories exist, that is a
        // planning defect and it is named rather than averaged.
        chat_track_stories: new Set(chats.flatMap(c => c.stories)).size,
        autopilot_track_stories: new Set(runs.flatMap(r => r.stories)).size,
      },
      invariants: {
        // AC-2, both halves.
        one_row_per_story: stories.length === new Set(stories.map(s => s.id)).size,
        no_false_unexecuted: falselyUnexecuted.length === 0,
        falsely_unexecuted: falselyUnexecuted,
        // A story listed twice INSIDE the chat track is a different defect (the chat track
        // double-books it) and is reported separately so the two cannot be confused.
        duplicated_in_chat_track: duplicated,
        one_corpus: runs.length === 0
          || new Set(runs.flatMap(r => r.stories)).size
             <= new Set(chats.flatMap(c => c.stories)).size,
      },
    };
  } catch (err) {
    return {
      epic: '(unreadable)',
      track: { present: false, empty: false, runs: 0 },
      duplicate_chat_claims: [],
      phases: [], chats: [], runs: [], stories: [],
      counts: { stories: 0, stories_done: 0, chats: 0, runs: 0,
        chat_track_stories: 0, autopilot_track_stories: 0 },
      invariants: { one_row_per_story: true, no_false_unexecuted: true, falsely_unexecuted: [],
        duplicated_in_chat_track: [], one_corpus: true },
      error: (err && err.message) || String(err),
    };
  }
}

/** Roll several unit states into one. Order matters: any not-done work dominates. */
function rollUpState(states) {
  const list = arr(states).filter(Boolean);
  if (!list.length) return 'empty';
  if (list.every(s => s === 'executed')) return 'executed';
  if (list.every(s => s === 'executed' || s === 'covered-by-reference')) {
    return 'covered-by-reference';
  }
  if (list.some(s => s === 'executed' || s === 'covered-by-reference'
    || s === 'partially-executed')) return 'partially-executed';
  return 'not-executed';
}

/** One sentence a view can print verbatim. Named references, never "elsewhere". */
function describeState(unit, references) {
  const refs = arr(references);
  switch (unit.state) {
    case 'executed':
      return unit.executed_flag
        ? 'the unit carries its own `executed: true` flag'
        : `all ${unit.stories_total} of its stories are done`;
    case 'covered-by-reference':
      return `all ${unit.stories_total} of its stories are done under `
        + `${refs.join(', ') || 'the story board'} — this unit did not run them itself, and it `
        + 'is NOT unexecuted';
    case 'partially-executed':
      return `${unit.stories_done} of ${unit.stories_total} stories are done`;
    case 'empty':
      return 'this unit lists no stories, so there is nothing to reconcile';
    default:
      return `none of its ${unit.stories_total} stories are done`;
  }
}

module.exports = {
  RUN_FIELD, UNATTRIBUTED_RUN, KEY_FIELD,
  PLANNED_KINDS, EXECUTED_KINDS, STATES, MIXED, DONE_STATUS,
  storyId, isRealRunId, chatEpic, storyEpic, scopeEpics,
  indexTrack, trackPresence, plannedRunKind,
  indexLedger, ledgerRunIds, executedRunKind, combineRunKind, rollUpKind,
  unitState, rollUpState, describeState,
  reconcile,
};
