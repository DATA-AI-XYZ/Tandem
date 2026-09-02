'use strict';
/**
 * stale-dismissal.js — an operator's judgement about a stale run, recorded once, beside the
 * run and never on it (STORY-29.1.04, closing BACKLOG-0147).
 *
 * ============================================================================
 * A NOTICE THAT IS ALWAYS PRESENT IS A NOTICE NOBODY READS
 * ============================================================================
 * `41-Reports/AUTOPILOT-CHECKPOINT-epic23-paused-2026-08-01.json` is paused at an operator
 * confirmation gate for a deferred v2.8.0 release. It is paused DELIBERATELY and it will stay
 * paused for as long as that release is deferred, so `autopilot-stale-runs.js` reports it at
 * every session-start with an age that grows by a day each day. The detection is correct; its
 * long-run ergonomics are not, and the moment a SECOND run goes stale it arrives in the same
 * undifferentiated list as the one everybody has learnt to skip.
 *
 * ============================================================================
 * WHERE A DISMISSAL LIVES — BESIDE THE CHECKPOINT, NOT ON IT
 * ============================================================================
 * BACKLOG-0147 Tranche A poses the choice: a `stale_acknowledged` block ON the checkpoint, or
 * an operator-owned file BESIDE it. It is the file, for three reasons that all point the same
 * way:
 *
 *   - ADR-0152's never-rewrite stance. A checkpoint is the run's own record. Editing it to
 *     record something an operator thought about it later is a record rewrite.
 *   - STORY-26.5.02 AC-5's read-only guarantee. Detection never writes; if the dismissal lived
 *     on the checkpoint, the only writer would still have to be a separate command, so the
 *     checkpoint buys nothing and costs the guarantee's simplicity.
 *   - ADR-0178 (STORY-29.1.02) had just finished removing a derivation that round-tripped into
 *     a record. A judgement written into the run's own file is the same shape.
 *
 * The store is `<reportsDir>/STALE-RUN-DISMISSALS.json` — inside the SAME directory the
 * detector already takes as `--dir`, so a test can point the whole mechanism at a temp dir
 * without a second seam, and a demo/`PM_DASH_ROOT` render reads the fixture root's store rather
 * than the host's (ADR-0106's posture, obtained structurally instead of by a filter).
 *
 * ============================================================================
 * DISMISSAL IS KEYED TO THE EVIDENCE, NOT TO THE RUN
 * ============================================================================
 * BACKLOG-0147 Tranche B names the failure mode outright: "a blanket mute that silences the
 * next real stale run is the failure mode here". So a dismissal records the EVIDENCE it was
 * given — the run id, WHICH staleness arm fired (ADR-0159's two), when the pause began, and
 * what resume was scheduled — and suppresses only while that evidence is unchanged. A run that
 * is resumed and pauses again has a new `paused.at`, therefore a new evidence key, therefore a
 * notice again. A run whose arm flips from `paused-without-schedule` to
 * `overdue-scheduled-resume` is likewise new evidence. A different run was never covered.
 *
 * That is the answer to Tranche A's second question — permanent or expiring — without a timer:
 * a dismissal expires when the FACTS change, which is the only expiry that cannot go quiet at
 * the wrong moment. "Quiet until the release ships" and "quiet forever" stop being different
 * intentions, because neither is expressible: you are quiet until something happens.
 *
 * ============================================================================
 * WHO, AS WELL AS WHY (BUG-20260810-04, review MAJOR-1)
 * ============================================================================
 * The first shape of this record carried `reason` and no actor, and STORY-29.1.04 AC-3 —
 * *"the notice's drawer/detail shows who-dismissed-why"* — was ticked on it. The "why" half was
 * delivered; the "who" half existed in no schema, no writer, no CLI, no render and no probe.
 * That is not a cosmetic gap in an operator-judgement store: the one production record was
 * written by a Dev hat ON an operator's behalf, and as shipped it was indistinguishable from one
 * the operator typed. A store whose only question is "who decided this, and may I ask them?"
 * cannot answer it.
 *
 * So `dismissed_by` is REQUIRED on the write path, on exactly the same terms as `reason`. The
 * CLI defaults it from `git config user.name` and `--by` overrides; neither may be empty.
 *
 * The READ path tolerates a record without one — it does NOT drop it. A pre-field dismissal is a
 * judgement an operator really made, and dropping it would silently un-dismiss it and bring the
 * notice back looking like new evidence, which is the failure mode the corrupt-store branch
 * already refuses. The surface renders `(not recorded)` instead, which is the honest answer.
 *
 * ============================================================================
 * A REASON IS REQUIRED, AND THE RECORD IS NEVER SWALLOWED
 * ============================================================================
 * A dismissal with no reason is refused. Six months later the difference between "we decided
 * this one is fine" and "somebody clicked it away" is the whole value of the record, and a
 * field that may be empty will be empty. Every dismissal stays readable — the store is
 * append-only, `--include-dismissed` shows everything, and the board renders the dismissed set
 * in a detail surface rather than deleting it from the page.
 *
 * NEVER THROWS on the read path. Session-start orientation and the dashboard both read this,
 * and neither may be taken down by a malformed operator file: an unreadable store is an empty
 * store, LOUDLY (the `error` field is carried, so "no dismissals" and "the store is broken"
 * are different answers). The WRITE path does throw — it is a deliberate, interactive command,
 * and a dismissal that silently failed to record is worse than one that refused.
 *
 * Node stdlib only.
 */

/* ----------------------------------------------------------------------------
 * STORY-31.1.02 — THE MECHANISM MOVED; THIS FILE IS NOW ITS CONFIGURATION.
 *
 * Everything above is still true and is still the reason the store exists. What changed is
 * that the five decisions it records — evidence-keyed, reason required, actor required,
 * append-only, never-throws-on-read — are no longer implemented HERE. They live in
 * lib/dismissal-store.js, because STORY-31.1.02 needed the identical contract for a second
 * subject (a drift flag on a wiki document) and its AC-4 asks for ONE dismiss-with-reason
 * contract rather than a second store that agrees on the day it lands.
 *
 * The exported surface is unchanged, including `dismiss({ runId, ... })` — callers name a RUN,
 * and translating that to the core's generic subject belongs here rather than in every
 * caller. See ADR-0219.
 * ---------------------------------------------------------------------------- */

const { createDismissalStore, actorOf, ACTOR_NOT_RECORDED } = require('./dismissal-store.js');

/** The operator-owned store, beside the checkpoints it judges. ONE spelling. */
const FILE_NAME = 'STALE-RUN-DISMISSALS.json';

/** Bumped only on a breaking change to a record's meaning. Readers treat absent as 1. */
const STORE_VERSION = 1;

/** The pieces of a staleness verdict a dismissal is keyed to. ENUMERATED so a reader can see
 *  exactly what "the same evidence" means rather than infer it from a join expression. */
const EVIDENCE_FIELDS = Object.freeze(['run_id', 'reason', 'paused_at', 'scheduled_at']);

/** A reason long enough to be a document is not a reason; a stored file is not a wiki. */
const MAX_REASON_CHARS = 1000;

/** An actor is a name and, at most, the hat and the context it acted in — not a paragraph. */
const MAX_ACTOR_CHARS = 300;

const store = createDismissalStore({
  fileName: FILE_NAME,
  storeVersion: STORE_VERSION,
  evidenceFields: EVIDENCE_FIELDS,
  subjectField: 'run_id',
  subjectLabel: 'a run id',
  // The verdict's `reason` is WHY IT IS STALE. The record's `reason` is why an operator
  // dismissed it. Two different facts that cannot share a field name.
  evidenceRecordNames: { reason: 'stale_reason' },
  maxReasonChars: MAX_REASON_CHARS,
  maxActorChars: MAX_ACTOR_CHARS,
});

/** Where the store lives for a given reports dir. */
const storePath = store.storePath;

/** THE EVIDENCE KEY. See the core. NEVER THROWS. */
const evidenceKey = store.evidenceKey;

/** Read the store. NEVER THROWS. */
const read = store.read;

/** Has THIS staleness verdict been dismissed? Most recent matching record, or null. */
const isDismissed = store.isDismissed;

/**
 * THE ONLY WRITER. Callers name a RUN; the core takes a generic subject.
 *
 * THROWS on a missing/empty reason, a missing run id, a missing actor, or a write failure.
 *
 * @param {string} reportsDir
 * @param {{runId: string, reason: string, by: string, evidence: object, at: string}} input
 * @returns {{record: object, path: string, alreadyDismissed: boolean}}
 */
function dismiss(reportsDir, input) {
  const inp = input || {};
  return store.dismiss(reportsDir, {
    subject: inp.runId,
    reason: inp.reason,
    by: inp.by,
    evidence: inp.evidence,
    at: inp.at,
  });
}

module.exports = {
  FILE_NAME, STORE_VERSION, EVIDENCE_FIELDS, MAX_REASON_CHARS, MAX_ACTOR_CHARS,
  ACTOR_NOT_RECORDED, actorOf,
  storePath, evidenceKey, read, dismiss, isDismissed,
  // Re-exported so the "one mechanism" assertion can be made by IDENTITY against the factory
  // rather than by comparing shared constants — a literal duplicate of the core would satisfy
  // the constants and cannot satisfy this. `dismiss` above wraps the core's, so the tag has to
  // be carried across explicitly; every other function here IS the core's own.
  createdBy: store.createdBy,
};
