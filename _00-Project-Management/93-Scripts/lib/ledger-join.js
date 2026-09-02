'use strict';
/**
 * ledger-join.js — ONE join key for the retro ledger and the usage ledger (STORY-29.1.03,
 * closing BACKLOG-0144). The key is defined here, written by BOTH writers at capture time,
 * and derived — never guessed — for every record written before this file existed.
 *
 * ============================================================================
 * THE DEFECT WAS TWO SPELLINGS AND A KEY THAT WAS NOT ONE
 * ============================================================================
 * Measured on the live corpus on 2026-08-10 (114 retro records, 36 usage rows):
 *
 *   - `retro-capture.js` is called with PHASE-QUALIFIED chat ids at most sites
 *     (`E25-CHAT-02`, `E27-CHAT-05`) and with BARE ones at others (`CHAT-01`, `CHAT-04`);
 *     `usage-capture.js` was called with bare ids for 31 of its 36 rows. Two spellings for
 *     one chat is a join that cannot fire.
 *   - The bare form is not unique. `CHAT-01` appears on 5 usage rows drawn from 5 different
 *     phases and on 2 retro records from 2 different epics, so the join that DID fire
 *     over-matched 1:5. `retro-report.js` was honest about the fan-out (ADR-0147) but honest
 *     about being unjoinable is not joined.
 *
 * The join rate before this module: 8 of 22 chat-level retro records matched, and 3 of those
 * 8 matches were the over-matched bare ones. After: 21 of 22, each to its own rows, with the
 * single remainder ITEMISED rather than absorbed.
 *
 * ============================================================================
 * THE KEY IS THE PHASE-QUALIFIED UNIT ID, AND NOTHING ELSE
 * ============================================================================
 * BACKLOG-0144 Tranche A asks for one spelling; Tranche B asks that the spelling be unique.
 * `E25-CHAT-04` is both, and it is the form the corpus already reaches for when it is
 * careful, so canonicalising it renames nothing and teaches nobody a new vocabulary.
 *
 * WHAT THE KEY DELIBERATELY DOES NOT CARRY:
 *
 *   the run id   STORY-29.1.03 offers "run id + chat id, or an equivalent recorded key". A
 *                run id is only knowable to a writer that was TOLD it, and the two writers
 *                are invoked separately at chat close — so a key containing it would join
 *                only when both invocations happened to be handed the same flag. That is the
 *                two-spellings defect wearing a new field. The run is recorded BESIDE the key
 *                (`run_id`, absent as `null`, never fabricated — the story's own gotcha), so
 *                FEAT-29.3's attribution work has it without the join depending on it.
 *   the level    `retro-schema.joinSemanticsNotes` note 2 says a `run` id fans out across its
 *                `pause` lines and that a reader must fold before joining. A level-prefixed
 *                key would silently stop those lines joining to their run, which is a
 *                behaviour change dressed up as a key change.
 *
 * A key is therefore INDISTINGUISHABLE IN SHAPE from a well-formed id, which is the point:
 * the field records the canonical spelling of the unit this record is about, additively,
 * without any historical `id` byte being rewritten (ADR-0152's never-rewrite stance).
 *
 * ============================================================================
 * DERIVE-ON-READ, WITH AMBIGUITY REPORTED RATHER THAN RESOLVED
 * ============================================================================
 * Every record written before this module lacks the field. Two derivation rules, tried in
 * order, and a third outcome that is an honest refusal:
 *
 *   SELF        the record already carries enough to qualify itself — an id that is already
 *               qualified (`E27-CHAT-05`, `STORY-26.1.02`, `RUN-FX-01`), or a bare `CHAT-NN`
 *               beside a `phase: EPIC-NN`. No inference at all; this covers 100% of the retro
 *               side and the 5 usage rows written after the convention settled.
 *   WINDOW      a bare id with no phase — the usage ledger's shape. Candidates are the keys
 *               ALREADY KNOWN (declared or self-derived, from either ledger) that share this
 *               record's unit suffix and whose anchor instant is within `windowMs`. Exactly
 *               one candidate derives; more than one is AMBIGUOUS and reports the candidate
 *               set without joining; none is UNKEYED and is itemised in the remainder.
 *
 * WHY A 15-MINUTE WINDOW, MEASURED RATHER THAN CHOSEN. `usage-capture.js` runs immediately
 * after `retro-capture.js` at a chat close, so the two records for one chat are seconds apart:
 * across the 5 pairs where both sides are already qualified the gap is 6–18 SECONDS, and the
 * widest gap for any unambiguous old pair in the corpus is 2m50s. Meanwhile the smallest gap
 * between two DISTINCT chat keys is 85 minutes. 15 minutes is ~5x the widest observed pair and
 * ~1/5 of the closest observed collision, so it cannot bridge two chats — and when it would,
 * the answer is `ambiguous`, not a pick. It is an option, not a constant in hiding.
 *
 * NEVER THROWS. This module is required by a writer whose entire contract is that recording
 * how work went cannot break the work (`retro-capture.js`, ADR-0110) and by a metric that must
 * never fail the run it measures (`usage-capture.js`). A join helper that could throw would
 * defeat both from the one place least expecting it.
 *
 * Node stdlib only — nothing is required from here, deliberately: `retro-schema.js` requires
 * THIS file to register the field, so a require in the other direction would be a cycle.
 */

/** The additive field both writers emit. ONE spelling, read off this constant everywhere. */
const KEY_FIELD = 'join_key';

/** Where the run that produced a record is recorded — BESIDE the key, never inside it. */
const RUN_FIELD = 'run_id';

/** The honest absence the story's gotcha requires: a record captured outside a run gets this
 *  marker, never a fabricated run id. */
const UNATTRIBUTED_RUN = 'unattributed-run';

/** How a key was arrived at. ENUMERATED so a reader can COUNT the derivations rather than
 *  read an adjective about them, and so `ambiguous` can never be mistaken for a key. */
const STATUSES = Object.freeze(['declared', 'self', 'window', 'ambiguous', 'unkeyed']);

/** The statuses that yield a usable key. `ambiguous` is deliberately not one. */
const KEYED_STATUSES = Object.freeze(['declared', 'self', 'window']);

/** Default derivation window. See the header for the measurement behind the number. */
const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

/** A key long enough to be a paragraph is not a key. Bounded so a hostile value cannot make
 *  the ledger line exceed `retro-capture.js`'s atomic-append byte cap on its own. */
const MAX_KEY_CHARS = 200;

// The bare, NON-UNIQUE chat form — the thing this module exists to stop being a key.
const BARE_CHAT_RE = /^CHAT-(\d+)$/i;
// The qualified form the corpus already writes when it is careful.
const QUALIFIED_CHAT_RE = /^E(\d+)-CHAT-(\d+)$/i;
// A phase as the ledger spells it: `EPIC-25`, and also `EPIC-27-P3` (the phase-level id form).
const PHASE_EPIC_RE = /^EPIC-0*(\d+)/i;

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Is `v` a well-formed join key?
 *
 * Non-empty, single-token, bounded — and NOT the bare `CHAT-NN` form, because a key that
 * names five different chats is the defect, not a key. The bare-form rejection is the whole
 * contract in one predicate: `retro-schema.validate()` refuses a record carrying one, so a
 * writer cannot regress into emitting an ambiguous key without the ledger noticing.
 *
 * NEVER THROWS.
 */
function isKey(v) {
  const s = str(v);
  if (s === '' || s.length > MAX_KEY_CHARS) return false;
  if (/\s/.test(s)) return false;
  if (BARE_CHAT_RE.test(s)) return false;
  return true;
}

/**
 * The unit suffix a bare and a qualified chat id share — `'01'` for both `CHAT-01` and
 * `E27-CHAT-01`. Null for anything that is not a chat id, so window derivation never fires on
 * a story or a run. Leading zeros are stripped so `CHAT-01` and `CHAT-1` are one suffix.
 */
function chatSuffix(id) {
  const s = str(id);
  let m = QUALIFIED_CHAT_RE.exec(s);
  if (m) return String(Number(m[2]));
  m = BARE_CHAT_RE.exec(s);
  if (m) return String(Number(m[1]));
  return null;
}

/**
 * The canonical spelling of `id`, qualified by `phase` when it needs qualifying.
 *
 * `CHAT-04` + `EPIC-25` -> `E25-CHAT-04`. An already-qualified id is returned unchanged (it
 * is NOT re-qualified from the phase — the id a writer took the trouble to qualify is the
 * fact, and overriding it from a `phase` field would be this module inventing a disagreement).
 * A bare chat id with no usable phase returns null: unqualifiable is a fact worth reporting,
 * and `CHAT-04` is exactly the value that must never be returned as a key.
 *
 * NEVER THROWS.
 */
function qualify(id, phase) {
  const s = str(id);
  if (s === '') return null;
  if (!BARE_CHAT_RE.test(s)) return isKey(s) ? s : null;
  const m = PHASE_EPIC_RE.exec(str(phase));
  if (!m) return null;
  const n = BARE_CHAT_RE.exec(s)[1];
  return `E${Number(m[1])}-CHAT-${n}`;
}

/**
 * THE WRITER'S CALL. The key to stamp on a record being captured now, or null when the caller
 * has not supplied enough to name the unit unambiguously.
 *
 * Null is a legitimate, deliberate answer: writing `CHAT-04` would be minting a key already
 * known to name five things. `retro-capture.js` and `usage-capture.js` both write the field
 * as explicit null in that case, so a reader needs no key-presence check and the ABSENCE is
 * on the record rather than inferred from its shape.
 *
 * NEVER THROWS.
 */
function compose(rec) {
  try {
    const r = rec || {};
    return qualify(r.id, r.phase);
  } catch {
    return null;
  }
}

/**
 * The key a record DECLARES, or null. Only a well-formed value counts — a record carrying a
 * malformed key is treated as carrying none and falls through to derivation, which is the
 * ADR-0110 posture (report, never throw, never trust).
 */
function declaredKey(record) {
  try {
    if (record === null || typeof record !== 'object') return null;
    const v = record[KEY_FIELD];
    return isKey(v) ? str(v) : null;
  } catch {
    return null;
  }
}

function tsMs(record) {
  try {
    const t = record && record.ts;
    if (typeof t !== 'string') return null;
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

/**
 * Every key a set of records can name WITHOUT inference, with the instants those keys were
 * seen at. This is the anchor set window derivation matches against — built only from
 * `declared` and `self` keys, never from other window derivations, so a derived key can never
 * become the evidence for the next derivation.
 *
 * @param {Array<Array<object>>} recordSets
 * @returns {Map<string, {key: string, suffix: string|null, instants: number[]}>}
 * NEVER THROWS.
 */
function buildAnchors(recordSets) {
  const anchors = new Map();
  const add = (key, ms) => {
    if (!isKey(key)) return;
    if (!anchors.has(key)) {
      anchors.set(key, { key, suffix: chatSuffix(key), instants: [] });
    }
    if (ms !== null) anchors.get(key).instants.push(ms);
  };
  for (const set of (recordSets || [])) {
    for (const record of (set || [])) {
      try {
        const ms = tsMs(record);
        const declared = declaredKey(record);
        if (declared) { add(declared, ms); continue; }
        const self = compose(record);
        if (self) add(self, ms);
      } catch { /* one unreadable record is not an anchor, and not an exception either */ }
    }
  }
  for (const a of anchors.values()) a.instants.sort((x, y) => x - y);
  return anchors;
}

/** The closest distance from `ms` to any instant an anchor was seen at, or Infinity. */
function distanceTo(anchor, ms) {
  if (ms === null || !anchor || !anchor.instants.length) return Infinity;
  let best = Infinity;
  for (const i of anchor.instants) {
    const d = Math.abs(i - ms);
    if (d < best) best = d;
  }
  return best;
}

/**
 * THE READER'S CALL. The key for ONE record, and how it was arrived at.
 *
 * @param {object} record
 * @param {Map} anchors from `buildAnchors()`
 * @param {{windowMs?: number}} [opts]
 * @returns {{key: string|null, status: string, candidates: string[], why: string}}
 *          `key` is null for `ambiguous` and `unkeyed`. `candidates` is populated ONLY for
 *          `ambiguous` — the whole point of that status is that the reader hands back the set
 *          instead of choosing from it (the ADR-0149 provenance stance).
 * NEVER THROWS.
 */
function resolve(record, anchors, opts) {
  const windowMs = opts && Number.isFinite(opts.windowMs) ? opts.windowMs : DEFAULT_WINDOW_MS;
  const nothing = { key: null, status: 'unkeyed', candidates: [], why: '' };
  try {
    if (record === null || typeof record !== 'object') {
      return Object.assign({}, nothing, { why: 'not a record' });
    }

    const declared = declaredKey(record);
    if (declared) {
      return { key: declared, status: 'declared', candidates: [], why: `the record carries ${KEY_FIELD}` };
    }

    const self = compose(record);
    if (self) {
      return {
        key: self,
        status: 'self',
        candidates: [],
        why: str(record.id) === self
          ? 'the id is already the canonical spelling'
          : `the id ${JSON.stringify(str(record.id))} was qualified by phase `
            + `${JSON.stringify(str(record.phase))}`,
      };
    }

    const suffix = chatSuffix(record.id);
    if (suffix === null) {
      return Object.assign({}, nothing, {
        why: `id ${JSON.stringify(str(record.id))} names no unit this module can canonicalise`,
      });
    }

    const ms = tsMs(record);
    if (ms === null) {
      return Object.assign({}, nothing, {
        why: 'a bare chat id with no usable `ts` — nothing to derive a window from',
      });
    }

    const inWindow = [];
    for (const anchor of (anchors ? anchors.values() : [])) {
      if (anchor.suffix !== suffix) continue;
      if (distanceTo(anchor, ms) <= windowMs) inWindow.push(anchor.key);
    }
    inWindow.sort();

    if (inWindow.length === 1) {
      return {
        key: inWindow[0],
        status: 'window',
        candidates: [],
        why: `the only chat key ending -${suffix} within ${Math.round(windowMs / 60000)} minute(s) `
          + `of ${str(record.ts)}`,
      };
    }
    if (inWindow.length > 1) {
      // NEVER PICKS. Reporting the set is the deliverable; choosing from it would make the
      // rollup's number look measured and be arbitrary — the exact failure ADR-0147 refused.
      return {
        key: null,
        status: 'ambiguous',
        candidates: inWindow,
        why: `${inWindow.length} chat keys ending -${suffix} sit within `
          + `${Math.round(windowMs / 60000)} minute(s) of ${str(record.ts)}: ${inWindow.join(', ')}`,
      };
    }
    return Object.assign({}, nothing, {
      why: `no chat key ending -${suffix} within ${Math.round(windowMs / 60000)} minute(s) of `
        + `${str(record.ts)} — this unit is not in the retro ledger`,
    });
  } catch {
    return Object.assign({}, nothing, { why: 'the record could not be inspected' });
  }
}

/**
 * The whole picture for one pair of ledgers: a key per record on both sides, the join, and
 * the remainder — ITEMISED, because AC-3 asks for a number with its leftovers named and a
 * rate with no list under it is an adjective with a decimal point.
 *
 * @param {object[]} retroRecords
 * @param {object[]} usageRecords
 * @param {{windowMs?: number, level?: string, kind?: string}} [opts] `level`/`kind` scope the
 *        REPORTED unit; they default to `chat`/`chat`, the unit AC-3 names. The keying itself
 *        is unscoped — every record on both sides is keyed, because a consumer joining stories
 *        needs the same map.
 * NEVER THROWS.
 */
function joinLedgers(retroRecords, usageRecords, opts) {
  const options = opts || {};
  const level = options.level === undefined ? 'chat' : options.level;
  const kind = options.kind === undefined ? 'chat' : options.kind;
  const retro = Array.isArray(retroRecords) ? retroRecords : [];
  const usage = Array.isArray(usageRecords) ? usageRecords : [];

  const anchors = buildAnchors([retro, usage]);

  const keyRecords = records => records.map((record) => {
    const r = resolve(record, anchors, options);
    return { record, key: r.key, status: r.status, candidates: r.candidates, why: r.why };
  });

  const retroKeyed = keyRecords(retro);
  const usageKeyed = keyRecords(usage);

  const usageByKey = new Map();
  for (const u of usageKeyed) {
    if (u.key === null) continue;
    if (kind !== null && u.record && u.record.kind !== undefined && u.record.kind !== kind) continue;
    if (!usageByKey.has(u.key)) usageByKey.set(u.key, []);
    usageByKey.get(u.key).push(u);
  }

  const units = retroKeyed.filter(r => level === null || (r.record && r.record.level === level));
  const matchedKeys = new Set();
  const pairs = [];
  const unmatched = [];
  for (const u of units) {
    const rows = u.key === null ? [] : (usageByKey.get(u.key) || []);
    if (rows.length) {
      matchedKeys.add(u.key);
      pairs.push({ key: u.key, status: u.status, id: u.record.id, usageCount: rows.length });
    } else {
      unmatched.push({
        key: u.key,
        status: u.status,
        id: u.record ? u.record.id : null,
        ts: u.record ? u.record.ts : null,
        candidates: u.candidates,
        why: u.why,
      });
    }
  }

  // The RIGHT-side leftovers, kept separate so the left-side arithmetic
  // (`unmatched.length === total - joined`) stays exact — two remainders in one list is a
  // count nobody can check.
  const usageRemainder = usageKeyed
    .filter(u => (kind === null || !u.record || u.record.kind === undefined || u.record.kind === kind))
    .filter(u => u.key === null || !matchedKeys.has(u.key))
    .map(u => ({
      key: u.key,
      status: u.status,
      id: u.record ? u.record.id : null,
      ts: u.record ? u.record.ts : null,
      candidates: u.candidates,
      why: u.why,
    }));

  const byStatus = Object.create(null);
  for (const s of STATUSES) byStatus[s] = 0;
  for (const k of retroKeyed.concat(usageKeyed)) byStatus[k.status] += 1;

  return {
    keyField: KEY_FIELD,
    windowMs: Number.isFinite(options.windowMs) ? options.windowMs : DEFAULT_WINDOW_MS,
    level,
    kind,
    total: units.length,
    joined: pairs.length,
    pairs,
    unmatched,
    usageRemainder,
    ambiguous: retroKeyed.concat(usageKeyed).filter(k => k.status === 'ambiguous')
      .map(k => ({ id: k.record ? k.record.id : null, ts: k.record ? k.record.ts : null,
        candidates: k.candidates })),
    byStatus,
    retroKeyed,
    usageKeyed,
    anchors,
  };
}

/** The one-line report AC-3 asks for: a number, and the leftovers by name. */
function formatReport(report) {
  const items = report.unmatched.map(u => `${u.id}${u.key ? '' : ' (unkeyed)'}`);
  return `joined=${report.joined}/${report.total} unmatched=[${items.join(', ')}]`;
}

module.exports = {
  KEY_FIELD, RUN_FIELD, UNATTRIBUTED_RUN, STATUSES, KEYED_STATUSES,
  DEFAULT_WINDOW_MS, MAX_KEY_CHARS,
  isKey, chatSuffix, qualify, compose, declaredKey,
  buildAnchors, resolve, joinLedgers, formatReport,
};
