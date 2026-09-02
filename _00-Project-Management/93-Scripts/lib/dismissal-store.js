'use strict';
/**
 * dismissal-store.js — ONE dismiss-with-reason mechanism, configured per subject
 * (STORY-31.1.02, generalising STORY-29.1.04's store; ADR-0219).
 *
 * ============================================================================
 * WHY THIS IS A CORE AND NOT A SECOND STORE
 * ============================================================================
 * STORY-29.1.04 built an operator-judgement store for stale autopilot runs, and got five
 * decisions right that any such store needs:
 *
 *   1. A dismissal is keyed to the EVIDENCE, not to the subject. "Quiet until something
 *      changes" is the only expiry that cannot go quiet at the wrong moment.
 *   2. A reason is REQUIRED. A field that may be empty will be empty, and six months later
 *      "we decided this one is fine" and "somebody clicked it away" are the same record.
 *   3. An ACTOR is required on write. A store whose only question is "who decided this, and
 *      may I ask them?" has to be able to answer it. The READ path tolerates a record without
 *      one and shows `(not recorded)`, because dropping it would silently un-dismiss a
 *      judgement an operator really made.
 *   4. The store is APPEND-ONLY. Two people judging the same evidence on two days is two
 *      facts.
 *   5. The read path NEVER THROWS, and an unreadable store is reported rather than read as
 *      empty — "no dismissals" and "the store is broken" are different answers. The write
 *      path DOES throw: a dismissal that silently failed to record is worse than one refused.
 *
 * STORY-31.1.02 needs exactly that for a different subject: a drift flag on a wiki document.
 * Its AC-4 says so outright — *"dismissals carry a reason and survive regeneration until
 * evidence changes (shared idiom with STORY-29.1.04's ADR — ONE dismiss-with-reason
 * contract)"*.
 *
 * A second implementation of those five decisions is the two-censuses shape this repo has
 * been paying for all epic: two stores drift silently and asymmetrically, and the one that
 * checks fewer fields still reports a clean green — over a weaker contract than its reader
 * believes. There is one implementation or there are two. `stale-dismissal.js` is now a
 * configuration of this file, and so is the wiki's store.
 *
 * ============================================================================
 * WHAT IS CONFIGURABLE AND WHAT IS NOT
 * ============================================================================
 * CONFIGURABLE: the file name, the subject field's name and label, which fields make up the
 * evidence key, how those evidence fields are spelled out on the record (a stale run's
 * evidence `reason` is written as `stale_reason`, because `reason` on the record is the
 * DISMISSAL's reason), and the caps.
 *
 * NOT CONFIGURABLE, deliberately: whether a reason is required, whether an actor is required,
 * whether the store appends, whether the reader throws. Those are the CONTRACT. A store that
 * could switch them off would not be the same mechanism wearing a different name — it would
 * be a second mechanism reached through a config flag, which is the thing this file exists to
 * prevent.
 *
 * Node stdlib only.
 */

const fs = require('fs');
const path = require('path');

/** What every surface shows for a record written before `dismissed_by` existed. ONE spelling. */
const ACTOR_NOT_RECORDED = '(not recorded)';

/** A reason long enough to be a document is not a reason; a stored file is not a wiki. */
const DEFAULT_MAX_REASON_CHARS = 1000;

/** An actor is a name and, at most, the hat and the context it acted in — not a paragraph. */
const DEFAULT_MAX_ACTOR_CHARS = 300;

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function safeMessage(err) {
  try {
    if (err && typeof err.message === 'string') return err.message;
    return String(err);
  } catch {
    return '(unprintable error)';
  }
}

/** The actor to SHOW for a record, in one place, so a legacy record reads the same everywhere. */
function actorOf(record) {
  return str(record && record.dismissed_by) || ACTOR_NOT_RECORDED;
}

/**
 * Build a store.
 *
 * @param {object} cfg
 * @param {string} cfg.fileName        the operator-owned file, beside what it judges
 * @param {number} cfg.storeVersion    bumped only on a breaking change to a record's meaning
 * @param {string[]} cfg.evidenceFields  the pieces of a verdict a dismissal is keyed to
 * @param {string} cfg.subjectField    the evidence field naming WHAT was judged (e.g. run_id)
 * @param {string} cfg.subjectLabel    how to say that in an error message (e.g. "a run id")
 * @param {object} [cfg.evidenceRecordNames]  evidence field -> record field, where they differ
 * @param {number} [cfg.maxReasonChars]
 * @param {number} [cfg.maxActorChars]
 */
function createDismissalStore(cfg) {
  const FILE_NAME = cfg.fileName;
  const STORE_VERSION = cfg.storeVersion;
  const EVIDENCE_FIELDS = Object.freeze(cfg.evidenceFields.slice());
  const SUBJECT_FIELD = cfg.subjectField;
  const SUBJECT_LABEL = cfg.subjectLabel;
  const RECORD_NAMES = cfg.evidenceRecordNames || {};
  const MAX_REASON_CHARS = cfg.maxReasonChars || DEFAULT_MAX_REASON_CHARS;
  const MAX_ACTOR_CHARS = cfg.maxActorChars || DEFAULT_MAX_ACTOR_CHARS;

  if (EVIDENCE_FIELDS.indexOf(SUBJECT_FIELD) === -1) {
    // A key that does not include the subject would let a dismissal of one subject silence the
    // identically-shaped evidence of another. Refused at construction, not at write time.
    throw new Error(`dismissal store "${FILE_NAME}": the subject field "${SUBJECT_FIELD}" must be `
      + 'part of the evidence key, or a dismissal would cover subjects nobody judged');
  }

  /** Where the store lives for a given directory. */
  function storePath(dir) {
    return path.join(dir, FILE_NAME);
  }

  /**
   * THE EVIDENCE KEY. Two verdicts share a key exactly when an operator judging one has judged
   * the other. Fields are joined with a separator no field can contain, and each is normalised
   * through `str()`, so `null`, `''` and `undefined` produce ONE key rather than three.
   *
   * NEVER THROWS.
   */
  function evidenceKey(verdict) {
    try {
      const v = verdict || {};
      return EVIDENCE_FIELDS.map((f) => str(v[f])).join('|');
    } catch {
      return '';
    }
  }

  /**
   * Read the store. NEVER THROWS.
   *
   * `error` is non-null for a store that exists and could not be understood — a DIFFERENT fact
   * from an absent one, because a corrupt store silently read as empty would un-dismiss
   * everything and every notice would come back looking like new evidence.
   */
  function read(dir) {
    const p = storePath(dir);
    const out = { path: p, exists: false, dismissals: [], error: null };
    let text;
    try {
      text = fs.readFileSync(p, 'utf8');
      out.exists = true;
    } catch (err) {
      if (err && err.code !== 'ENOENT') out.error = `unreadable store: ${safeMessage(err)}`;
      return out;
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      out.error = `store is not valid JSON: ${safeMessage(err)}`;
      return out;
    }
    const list = parsed && Array.isArray(parsed.dismissals) ? parsed.dismissals : null;
    if (list === null) {
      out.error = 'store carries no `dismissals` array';
      return out;
    }
    // A record with no subject or no reason is not a dismissal — it is the shape this module
    // refuses to write, so reading one back means somebody hand-edited the file. Dropped and
    // COUNTED rather than trusted or thrown on.
    const kept = [];
    let dropped = 0;
    for (const d of list) {
      if (d && typeof d === 'object' && str(d[SUBJECT_FIELD]) !== '' && str(d.reason) !== '') kept.push(d);
      else dropped += 1;
    }
    out.dismissals = kept;
    if (dropped) out.error = `${dropped} store record(s) carried no ${SUBJECT_LABEL} or no reason and were ignored`;
    return out;
  }

  /**
   * THE ONLY WRITER. A deliberate, separate invocation — never reached from a detection path
   * and never from the dashboard, which is generated and must not acquire a side effect.
   *
   * THROWS on a missing/empty reason, a missing subject, a missing actor, or a write failure.
   */
  function dismiss(dir, input) {
    const inp = input || {};
    const subject = str(inp.subject);
    const reason = str(inp.reason);
    const by = str(inp.by);
    if (subject === '') throw new Error(`a dismissal needs ${SUBJECT_LABEL}`);
    if (reason === '') {
      throw new Error('a dismissal needs a REASON — refusing to record a judgement nobody can '
        + 'read back. Six months from now, "we decided this one is fine" and "somebody clicked it '
        + 'away" are the same record without it.');
    }
    if (reason.length > MAX_REASON_CHARS) {
      throw new Error(`a dismissal reason is capped at ${MAX_REASON_CHARS} characters `
        + `(got ${reason.length})`);
    }
    if (by === '') {
      throw new Error('a dismissal needs an ACTOR — refusing to record an operator judgement that '
        + 'cannot say who made it. A store of judgements with no "who" cannot answer the question '
        + 'it exists for, and a Dev hat acting on an operator\'s behalf must be readable as such.');
    }
    if (by.length > MAX_ACTOR_CHARS) {
      throw new Error(`a dismissal actor is capped at ${MAX_ACTOR_CHARS} characters `
        + `(got ${by.length})`);
    }

    const evidence = Object.assign({}, inp.evidence || {});
    evidence[SUBJECT_FIELD] = subject;
    const record = {
      [SUBJECT_FIELD]: subject,
      reason,
      // WHO judged it, beside WHY. Required on write; the reader still accepts a record that
      // predates the field.
      dismissed_by: by,
      dismissed_at: str(inp.at) || new Date().toISOString(),
      evidence_key: evidenceKey(evidence),
    };
    // The evidence SPELLED OUT beside its key, so a reader can see WHAT was judged without
    // reverse-engineering a delimited string, and so a future key format can be recomputed
    // from the record rather than from a subject that may have moved on.
    for (const f of EVIDENCE_FIELDS) {
      if (f === SUBJECT_FIELD) continue;
      const name = RECORD_NAMES[f] || f;
      record[name] = str(evidence[f]) || null;
    }

    const current = read(dir);
    if (current.error && current.exists) {
      // Refuse to append to a store we could not read: rewriting it would delete dismissals.
      throw new Error(`refusing to write over a store that could not be read (${current.error}) `
        + `— fix or move ${current.path} first`);
    }
    const alreadyDismissed = current.dismissals
      .some((d) => str(d.evidence_key) === record.evidence_key);

    // APPEND-ONLY. A repeat dismissal of the same evidence is still appended: two operators
    // judging the same thing on two days is two facts, and collapsing them would lose the
    // second reason. `isDismissed()` reads the most recent.
    const next = { version: STORE_VERSION, dismissals: current.dismissals.concat([record]) };
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(storePath(dir), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    return { record, path: storePath(dir), alreadyDismissed };
  }

  /**
   * Has THIS verdict been dismissed? Returns the most recent matching record, or null.
   *
   * Matching is on the EVIDENCE KEY, never on the subject alone — a subject-only match is the
   * blanket mute that silences the next real finding.
   *
   * NEVER THROWS.
   */
  function isDismissed(dismissals, verdict) {
    try {
      const key = evidenceKey(verdict);
      if (key === '' || !Array.isArray(dismissals)) return null;
      let found = null;
      for (const d of dismissals) {
        if (d && str(d.evidence_key) === key) found = d;
      }
      return found;
    } catch {
      return null;
    }
  }

  return {
    FILE_NAME, STORE_VERSION, EVIDENCE_FIELDS, SUBJECT_FIELD,
    MAX_REASON_CHARS, MAX_ACTOR_CHARS, ACTOR_NOT_RECORDED, actorOf,
    storePath, evidenceKey, read, dismiss, isDismissed,
    // THE PROVENANCE STAMP. A store is a closure, so none of its functions can be compared by
    // identity against anything a caller holds — which meant the "one mechanism" assertion had
    // to be made about SHARED CONSTANTS, and a literal copy-paste of this file would have
    // satisfied it perfectly. This is the one thing only this factory can put on a product:
    // a reference to the factory itself. `store.createdBy === createDismissalStore` is true of
    // a configuration and false of a sibling, which is the whole claim (ADR-0219 decision 4).
    createdBy: createDismissalStore,
  };
}

module.exports = { createDismissalStore, actorOf, ACTOR_NOT_RECORDED };
