'use strict';
/**
 * lib/halt-spellings.js — THE VOCABULARY OF "THIS RUN HALTED", IN ONE PLACE (ADR-0161).
 *
 * ============================================================================
 * WHY THIS FILE EXISTS: TWO FUNCTIONS WERE TAUGHT THE SAME THING SEPARATELY, AND
 * ONLY ONE OF THEM LEARNED IT
 * ============================================================================
 * A halt is spelled two ways in this repository and always has been:
 *
 *   1. `terminal` — written by `autopilot-checkpoint.writeCheckpoint()`: a `halt_cause` from an
 *      enum (ADR-0152) and, optionally, a reason in words.
 *   2. a top-level `halt` block — written BY HAND by the operator, on 2026-08-04, on the live
 *      checkpoint: `found_at` / `found_by` / `audit` / `damage` / `proposed_fix` / `resolution`.
 *      It is the only real halt this repository has ever recorded.
 *
 * STORY-26.5.04 taught `autopilot-halt-ack.haltReason()` BOTH — `HALT_BLOCK_REASON_KEYS`
 * includes `audit` precisely because that is what the live file uses. It then keyed the gate off
 * `state === 'halted'`, and `autopilot-checkpoint.deriveState()` — the sibling that supplies
 * `state` for every checkpoint here, because none carries the key — had been taught only
 * `paused`. So the reader found the halt in full prose while the deriver said `running`, and the
 * gate returned `not-required` for the one situation it exists for (BUG-20260804-38).
 *
 * The fix is not "teach the deriver too" and move on. It is to make the vocabulary a THING BOTH
 * READ, so a third spelling cannot be added to one and forgotten in the other. The traversals
 * stay separate — `haltReason()` extracts a reason, `deriveState()` returns a state, and they are
 * different questions — but neither owns the word list, and
 * `halt-acknowledgement.test.js :: derivation-agrees` derives its cases FROM THESE CONSTANTS and
 * requires the two answers to agree for every one of them.
 *
 * Dependency-free, and deliberately dependency-LESS in the other direction too: this module
 * requires nothing, so `autopilot-checkpoint.js` (which `autopilot-halt-ack.js` requires) can
 * read it without a cycle.
 */

/**
 * Keys the `terminal` block may carry its ending IN WORDS under, MOST SPECIFIC FIRST.
 * `halt_cause` is deliberately NOT here: it is an enumerated category, not an explanation, and
 * conflating the two is how `gate-failure` gets presented to an operator as a reason.
 *
 * `halt_reason` IS A LEGACY SPELLING (review round-2 NEW-4). `recordTerminal()` wrote it for
 * every ending, including the two boundaries that produce `completed` — so a run that finished
 * its plan recorded its success under a field named for halting. The writer now emits the
 * neutral `reason`; `halt_reason` stays FIRST in this list because the records already written
 * under it are real and must keep reading, and because a halted run's `halt_reason` is not a
 * falsehood. Do not remove it to tidy up: that would silently blank the reason on every
 * pre-2026-08-10 terminal block.
 */
const TERMINAL_REASON_KEYS = Object.freeze([
  'halt_reason', 'reason', 'why', 'note',
]);

/**
 * Keys the top-level `halt` block may carry a reason under, MOST SPECIFIC FIRST. `audit` is on
 * the list because it is what the one real halt in this repository actually used.
 */
const HALT_BLOCK_REASON_KEYS = Object.freeze([
  'reason', 'why', 'cause', 'audit', 'found_by', 'summary',
]);

/** The enumerated cause field on the `terminal` block. A category, never an explanation. */
const HALT_CAUSE_KEY = 'halt_cause';

/**
 * Every spelling, as `{block, key}` pairs, DERIVED from the constants above rather than restated.
 * A probe that walks this walks exactly what production walks — which is the whole point, since a
 * hand-restated list is how the pair drifted in the first place.
 */
const HALT_SPELLINGS = Object.freeze([]
  .concat(TERMINAL_REASON_KEYS.map(k => Object.freeze({ block: 'terminal', key: k, source: 'terminal', thin: false })))
  .concat(HALT_BLOCK_REASON_KEYS.map(k => Object.freeze({ block: 'halt', key: k, source: 'halt-block', thin: false })))
  .concat([Object.freeze({ block: 'terminal', key: HALT_CAUSE_KEY, source: 'halt-cause', thin: true })]));

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** The first key in `keys` whose value on `obj` is a non-empty string. NEVER THROWS. */
function firstNonEmptyString(obj, keys) {
  if (!isPlainObject(obj)) return null;
  for (const k of keys) {
    let v;
    // A getter that throws is a fact about the file, not a reason to take the whole probe down —
    // the lesson of BUG-20260804-28, one story earlier, in the sibling reader.
    try { v = obj[k]; } catch { continue; }
    if (typeof v === 'string' && v.trim() !== '') return { key: k, value: v.trim() };
  }
  return null;
}

// BUG-20260804-40. A halt block does NOT exist only while the halt is live — it is also the
// durable record of a halt that was raised, answered and RESOLVED, which is why it carries these
// keys at all. Deriving `halted` from its mere presence therefore refuses a resume the halt no
// longer blocks. These are the spellings that say "this one is over".
//
// Scoped to the halt block on purpose: a `terminal` block means the run ENDED, and a resolution
// does not undo that.
const HALT_RESOLUTION_KEYS = ['resolved_at', 'resolved', 'resolution_at'];

/** True when a halt block records its own resolution. NEVER THROWS. */
function haltIsResolved(block) {
  if (!isPlainObject(block)) return false;
  for (const k of HALT_RESOLUTION_KEYS) {
    let v;
    try { v = block[k]; } catch { continue; }
    if (v === true) return true;
    if (typeof v === 'string' && v.trim() !== '') return true;
  }
  return false;
}

module.exports = {
  TERMINAL_REASON_KEYS,
  HALT_BLOCK_REASON_KEYS,
  HALT_CAUSE_KEY,
  HALT_SPELLINGS,
  HALT_RESOLUTION_KEYS,
  haltIsResolved,
  isPlainObject,
  firstNonEmptyString,
};
