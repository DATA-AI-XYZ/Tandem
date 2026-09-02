/**
 * retro-schema.js — the single machine-checkable contract for the development retro ledger
 * `41-Reports/retro/retro-log.jsonl` (STORY-26.1.01, PRD-Autonomous-Execution §A.1–§A.2).
 *
 * Three downstream components must agree on this shape and must not re-derive it from prose:
 *   - the writer      (`93-Scripts/retro-capture.js`, STORY-26.1.02)
 *   - the aggregator  (`93-Scripts/retro-report.js`,  STORY-26.2.01)
 *   - validator R25   (ledger completeness at phase merge, STORY-26.3.01)
 * All three `require()` THIS module. The shape is defined once, here, in code — never
 * duplicated in prose. See ADR-0109 for the decisions this file implements.
 *
 * Five levels — `story`, `chat`, `phase`, `run`, `pause`. Every record requires the common
 * core (`level`, `id`, `ts`); every other field — level-specific or common — is optional.
 *
 * TIMESTAMP FIELD IS `ts`, NOT THE PRD's `at` (ADR-0109). The PRD names it `at`; the sibling
 * ledger `41-Reports/usage/usage-log.jsonl` has always written `ts`, and STORY-26.1.01's
 * technical notes require mirroring that ledger's conventions so the join is natural rather
 * than adapted. One name for one concept across two sibling ledgers beat fidelity to the
 * PRD's draft spelling.
 *
 * JOIN: `id` joins a retro record to a usage record in `usage-log.jsonl`. See `joinSemantics`.
 *
 * Forward compatibility: unknown extra fields are PERMITTED. Capture points that have not
 * been written yet (FEAT-26.4's `run`/`pause` sites) may carry fields this module does not
 * yet name; rejecting them would make the schema a brake on the epic rather than a contract.
 * The core set is required, known fields are type-checked, unknown fields pass through.
 *
 * Dependency-free — Node stdlib only, consistent with every other `93-Scripts/` tool.
 */

'use strict';

// THE JOIN KEY IS DEFINED ONCE, AND NOT HERE (STORY-29.1.03). `lib/ledger-join.js` owns the
// field name, its shape predicate, and the derive-on-read rules — because `usage-capture.js`
// writes the same field and must not require the RETRO schema to learn what the field is.
// This module registers it, validates it, and adds nothing to its definition. The require is
// one-directional on purpose: `ledger-join.js` requires nothing.
const ledgerJoin = require('./ledger-join.js');

// ---------- record version ----------

// Bumped only on a BREAKING change to the required set or a field's meaning. Registered as a
// common optional field so a future writer can stamp it without a schema change; nothing
// writes it today, and readers may treat an absent value as 1.
const SCHEMA_VERSION = 1;

// ---------- the join ----------

// THE FIELD READERS JOIN ON. Was `'id'` until STORY-29.1.03, and `id` is why the join did not
// work: the two writers spelled one chat two ways (`E27-CHAT-05` / `CHAT-05`) and the bare
// spelling named five different chats. `join_key` is the phase-qualified spelling of the same
// unit, written ADDITIVELY by both writers at capture time and DERIVED on read for every record
// that predates the field. No historical `id` byte is rewritten — see ADR-0179.
const joinKey = ledgerJoin.KEY_FIELD;

// One-line summary (TC-02 prints this). The three cases are enumerated in `joinSemanticsNotes`
// and argued in ADR-0109.
// AMENDED 2026-08-04 (review of E26-CHAT-02, ADR-0149). This said "1:1 for story/chat" until the
// aggregator was pointed at the live ledgers and the claim turned out to be false: `usage-capture.js`
// writes one row per INVOCATION, not one per chat, and chat ids are recycled `CHAT-01 … CHAT-10`
// once per phase — so `CHAT-01` names five different chats and joins 1:5. `retro-report.js` prints
// this sentence directly underneath its own join counts, so a wrong declaration here is a wrong
// statement in an operator's face. The cardinality is 1:many on every level; ADR-0147 is why the
// usage side of the join is modelled as an array everywhere rather than only for `pause`.
// AMENDED AGAIN 2026-08-10 (STORY-29.1.03, ADR-0179). The join is on `join_key`, not `id`:
// both writers now stamp the phase-qualified spelling at capture time, and a record written
// before the field derives one on read — from itself where it can, from a time window over the
// keys already known where it cannot, and NOT AT ALL where two candidates fit, which is
// reported as `ambiguous` with its candidate set rather than picked from.
const joinSemantics =
  'left-outer on join_key (derived on read for records that predate the field; ambiguous derivations are reported, never picked): retro is the left side; 1:many on every level (the usage side is an array, ADR-0147); unmatched on either side is normal and never an error';

const joinSemanticsNotes = Object.freeze([
  'one-to-many — a `story` or `chat` retro record may match SEVERAL usage rows with the same id. ' +
    'The intent was one row per story/chat bracket, but `usage-capture.js` writes one row per ' +
    'invocation and the chat ids it is given are recycled once per phase, so a bare `CHAT-01` ' +
    'names a different chat in every epic. Collapsing to one row would report an arbitrary one of ' +
    'them as *the* usage for that chat. See BACKLOG-0144 for making the key unique.',
  'one-to-many — a `pause` level id (the autopilot run_id) may appear on several retro lines ' +
    '(§A.4: resume updates by append, so one pause event is two lines sharing id + ts). ' +
    'A `run` id likewise fans out across its pause lines. Fold before joining, never after.',
  'unmatched-on-either-side — a valid, expected result, NOT an error. A retro line with no ' +
    'usage row means usage capture no-opped (no transcript available); a usage row with no ' +
    'retro line means the work predates the ledger or R25 will flag it. Consumers report ' +
    'unmatched counts and continue; they never fail the rollup.',
]);

// ---------- field vocabulary ----------

const LEVELS = Object.freeze(['story', 'chat', 'phase', 'run', 'pause']);

// Required on every level. `id` because the join key cannot be optional; `ts` because a
// ledger line with no time is not calibration data.
const COMMON_REQUIRED = Object.freeze(['level', 'id', 'ts']);

// Optional on every level (not level-specific). `phase`/`chat` place the record in the plan;
// friction/artefact_gap/kit_signal are the three judgement fields (§A.2) — written only when
// something genuine happened, and written as explicit null otherwise.
//
// `stage` (STORY-26.4.03, ADR-0153) discriminates the TWO records one story now leaves.
// The ledger is append-only, so a decision taken at dispatch (which tier, what the estimate
// was) and the outcome known only afterwards (estimate-vs-actual, bugs, ADRs) cannot be one
// amended record — they are two records sharing an `id`, joined on it. Without a
// discriminator a reader can order them by `ts` but cannot LABEL them, and "the second one"
// is not a fact about the record. Absent means "the single record a non-autopilot close-out
// writes", which is every record written before this field existed.
//
// `join_key` / `run_id` (STORY-29.1.03, ADR-0179) are the join's two additive fields. The KEY
// is the phase-qualified unit id both ledgers now write; the RUN sits BESIDE it rather than
// inside it, because a key containing a run id would only join when both writers happened to
// be handed the same flag — the two-spellings defect in a new field. `run_id` is
// `unattributed-run` when nothing named a run, never a fabricated id.
const COMMON_OPTIONAL = Object.freeze([
  'phase', 'chat', 'friction', 'artefact_gap', 'kit_signal', 'schema_version', 'stage',
  ledgerJoin.KEY_FIELD, ledgerJoin.RUN_FIELD,
]);

// Tier assignment reasons (STORY-26.4.03 AC-1). ENUMERATED, because the story's own Risks
// section is right that "tier and why" as free text is unanalysable — you can read it and
// you cannot count it. A free-text `tier_note` sits beside it for the case the enum does not
// cover, which is the shape that keeps the enum honest instead of growing a catch-all.
const TIER_REASONS = Object.freeze([
  'plan-declared',          // the run plan's `tier_plan` named this story explicitly
  'default-tier',           // the plan's declared default applied; nothing special about this unit
  'complexity-escalation',  // schema / parser / concurrency / security — escalates regardless of size
  'risk-escalation',        // ambiguity or risk resolved upward, per the quality-first rule
  'operator-override',      // a human said so
  'fallback',               // the preferred tier was unavailable and a lower one was used
]);

// What the usage governor decided. The SAME vocabulary `usage-governor.js` already returns —
// one name for one concept, rather than a second spelling on the ledger side (the ADR-0109
// lesson that gave this schema `ts` instead of the PRD's `at`).
const GOVERNOR_ACTIONS = Object.freeze([
  'continue', 'pause-before-next', 'pause-now', 'pause-and-ask',
]);

// Which governor decisions CAUSE a pause. AC-3 routes a pausing decision to the `pause`
// level and everything else to `run`, so this list is the routing rule, stated once.
const PAUSING_ACTIONS = Object.freeze(['pause-before-next', 'pause-now', 'pause-and-ask']);

// WHERE THE ENTRY PROBE'S USAGE SIGNAL CAME FROM (ADR-0156, amending ADR-0154).
//
// `governor_action: continue` on a `run` record used to be the ONLY thing a reader had, and it
// is the same value whether a live harness surface was read or a caller typed two flags at the
// CLI. In this repository there IS no usage surface, so every "signal" on the ledger is the
// latter — and ADR-0154 explicitly rejected fabricating one. A line that claims a signal was
// available without saying where it came from cannot be audited afterwards, which is precisely
// the property ADR-0154 was written to give the run.
//
//   harness-acquirer  an acquirer was injected by the harness/orchestrator
//   cli-flags         --percent-used / --reset-at, typed by whoever launched the probe
//   none              no acquirer at all — nothing was even asked
//   unknown           an acquirer was injected under a source name this enum does not know
const SIGNAL_SOURCES = Object.freeze(['harness-acquirer', 'cli-flags', 'none', 'unknown']);

// WHAT AUTHORISED A RESUME (STORY-26.5.04, ADR-0160).
//
// A halted run is one that stopped WITHOUT reaching its stop condition (ADR-0152), so resuming
// it past whatever stopped it is a human decision, not a scheduling one. The gate that enforces
// that is only as good as the record it leaves: without a field, an acknowledged resume and one
// that simply proceeded produce the same ledger line, and "did anybody agree to this?" becomes
// unanswerable after the fact. This is the same argument ADR-0156 made for `signal_source`, in
// the same feature, about the same class of mistake.
//
// ENUM, not free text, for the reason every other vocabulary here is one: the question a
// reviewer asks is "how many resumes after a halt were acknowledged?", and a field that accepts
// any string cannot answer it.
//
//   acknowledged-halt      a halted run was resumed, and a human wrote why that was acceptable
//   halt-unacknowledged    a halted run's resume was REFUSED for want of that acknowledgement
//   not-required           the run was not halted; the gate does not apply (a `paused` resume)
const RESUME_AUTHORISATIONS = Object.freeze([
  'acknowledged-halt', 'halt-unacknowledged', 'not-required',
]);

// Level-specific mechanical fields (§A.2 "always written, never prompted"). They are
// SCHEMA-optional but WRITER-always: retro-capture.js emits them as explicit null/0 rather
// than omitting the key, so readers need no key-presence checks. Requiring them here would
// reject a bare-bones record that is otherwise perfectly joinable, which is the wrong
// trade for a capture that must never block work.
const LEVEL_OPTIONAL = Object.freeze(Object.assign(Object.create(null), {
  // `wall_clock_s` at story level is the ADR-0107 amendment (STORY-26.1.01 AC-6). The PRD as
  // written put a time field on `chat` only, so no per-story duration was derivable. Keeping
  // it here — an execution-window number — keeps it separate from any lead-time number, the
  // same discipline ADR-0079 drew between execution spend and context-load tax.
  // `tier_reason` / `tier_note` / `usage_estimate` are STORY-26.4.03's additions. The
  // estimate is the story's `usage_estimate:` frontmatter value (approximate total tokens)
  // carried onto the ledger at dispatch so it is joinable to the actual in
  // `usage-log.jsonl` on `id` — and written as explicit NULL when the story carries none,
  // because an absent estimate is information (AC-5) and 0 would read as a measurement.
  story: Object.freeze(['tier', 'tier_reason', 'tier_note', 'usage_estimate',
    'estimate_vs_actual', 'rework', 'bugs', 'adrs', 'wall_clock_s']),
  chat: Object.freeze(['stories', 'halts', 'lanes', 'fallback_fired', 'wall_clock_s', 'dispatch_overhead_s']),
  phase: Object.freeze(['chats', 'stories', 'merge']),
  // `governor_action` / `percent_used` / `threshold` also appear on `pause`, deliberately: a
  // governor decision that DID NOT pause is a `run`-level event (AC-3) and must be readable
  // under the same field names as one that did. Two spellings for one concept is the defect
  // ADR-0109 exists to prevent, and a reader driven by these lists would not know to look.
  // `signal_source` (ADR-0156) sits beside `governor_action` for the same reason
  // `governor_action` sits on both `run` and `pause`: the provenance of a signal is only
  // meaningful next to the verdict taken on it, and separating them would let a reader
  // read one without the other.
  // `resume_authorisation` / `acknowledged_halt_reason` (ADR-0160) sit at `run` level and not
  // `pause` for the reason ADR-0154 put the entry probe there: a halt is not a pause. Nothing
  // is scheduled, nothing resumes on its own, and there is no pause event to attach to — the
  // fact being recorded is about the RUN's authorisation to continue at all.
  run: Object.freeze(['phases', 'pauses', 'stop_reason', 'plan', 'predicted',
    'governor_action', 'percent_used', 'threshold', 'signal_source',
    'resume_authorisation', 'acknowledged_halt_reason']),
  pause: Object.freeze(['percent_used', 'threshold', 'reset_at', 'action', 'governor_action',
    'resumed_at', 'resume_mechanism']),
}));

// ---------- type checkers ----------

const ISO_8601_WITH_ZONE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

// Calendar-aware: `Date.parse` happily rolls 2026-02-30 over to 2 March, so the day-of-month
// is round-tripped through Date.UTC rather than trusted.
function isIsoWithZone(v) {
  if (typeof v !== 'string') return false;
  const m = ISO_8601_WITH_ZONE.exec(v);
  if (!m) return false;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  const hour = Number(m[4]), minute = Number(m[5]), second = Number(m[6]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 ||
      probe.getUTCDate() !== day) return false;
  return !Number.isNaN(Date.parse(v));
}
function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}
function isCount(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}
/**
 * `nullable` and `oneOf` CARRY THEIR ALLOW-LIST (BUG-20260804-27).
 *
 * A closure over `allowed` is unreadable from outside, so the only way to probe an enum was to
 * hand-write its values a second time in a test — which meant each enum was covered separately,
 * by whoever remembered, and three of the eight were not covered at all. Relaxing
 * `estimate_vs_actual`, `lanes` and `merge` to `typeof v === 'string'` left the full 58-suite
 * `npm test` green, while `level`, `tier`, `tier_reason`, `governor_action` and `stage` were
 * each killed by something. `stage` — the enum STORY-26.4.03 added — was covered and its
 * siblings were not.
 *
 * Attaching the set to the predicate makes the vocabulary ENUMERABLE, so one table-driven probe
 * walks every `oneOf` in `FIELD_TYPES` and a future enum is covered on the day it lands rather
 * than on the day someone remembers. `nullable` propagates it: wrapping must not hide it.
 */
const nullable = (fn) => {
  const g = v => v === null || fn(v);
  if (Array.isArray(fn.oneOf)) g.oneOf = fn.oneOf;
  g.nullable = true;
  return g;
};
const oneOf = (...allowed) => {
  const g = v => allowed.includes(v);
  g.oneOf = Object.freeze(allowed.slice());
  return g;
};

/**
 * The enumerated values a field accepts, or `null` if the field is not an enum. The one
 * accessor `retro-schema.test.js :: enums-are-enforced` walks, so the probe's table IS the
 * schema rather than a copy of it.
 */
function allowedValuesFor(field) {
  const spec = FIELD_TYPES[field];
  if (!spec || !spec.check || !Array.isArray(spec.check.oneOf)) return null;
  return spec.check.oneOf;
}

/** Every field name in `FIELD_TYPES` whose contract is an enumerated set. */
function enumeratedFields() {
  return Object.keys(FIELD_TYPES).filter(f => allowedValuesFor(f) !== null);
}

// Type/enum contract per field name. NULL-PROTOTYPE: a lookup for an unknown field named
// `constructor` / `toString` / `__proto__` must miss, not inherit a truthy value off
// Object.prototype — otherwise a forward-compatible record is falsely rejected.
const FIELD_TYPES = Object.freeze(Object.assign(Object.create(null), {
  level: { check: oneOf(...LEVELS), describe: `one of ${LEVELS.join(' | ')}` },
  id: { check: isNonEmptyString, describe: 'non-empty string' },
  ts: { check: isIsoWithZone, describe: 'ISO 8601 with zone designator (Z or ±HH:MM)' },

  phase: { check: nullable(isNonEmptyString), describe: 'string | null' },
  chat: { check: nullable(isNonEmptyString), describe: 'string | null' },
  friction: { check: nullable(v => typeof v === 'string'), describe: 'string | null' },
  artefact_gap: { check: nullable(v => typeof v === 'string'), describe: 'string | null' },
  kit_signal: { check: nullable(v => typeof v === 'string'), describe: 'string | null' },
  schema_version: { check: nullable(isCount), describe: 'non-negative integer | null' },
  stage: {
    check: nullable(oneOf('dispatch', 'close')),
    describe: '"dispatch" | "close" | null',
  },
  // THE JOIN KEY. The predicate is `ledger-join.isKey` verbatim, not a restatement of it — the
  // one property that matters is that a BARE `CHAT-01` is refused, and a second spelling of
  // that rule here is how the writer and the validator would come to disagree about what a key
  // is. Null is legitimate and means "this capture could not name its unit unambiguously",
  // which the reader then derives; a WRONG key is refused before the line is written.
  [ledgerJoin.KEY_FIELD]: {
    check: nullable(ledgerJoin.isKey),
    describe: 'a phase-qualified unit id (never the bare `CHAT-NN` form) | null',
  },
  // The run a record was captured under. Free-form because run ids are minted by
  // `autopilot-plan.js` and this schema does not get a second opinion on their shape
  // (ADR-0177 made the same call: an artefact on disk, never a shape rule).
  [ledgerJoin.RUN_FIELD]: { check: nullable(isNonEmptyString), describe: 'string | null' },

  // story
  tier: { check: nullable(oneOf('low', 'high')), describe: '"low" | "high" | null' },
  tier_reason: {
    check: nullable(oneOf(...TIER_REASONS)),
    describe: `${TIER_REASONS.map(r => `"${r}"`).join(' | ')} | null`,
  },
  tier_note: { check: nullable(v => typeof v === 'string'), describe: 'string | null' },
  // Approximate total tokens, matching the `usage_estimate:` frontmatter field STORY-21.2.02
  // produced and `generate-dashboard.js` reads as a positive integer.
  usage_estimate: { check: nullable(isCount), describe: 'non-negative integer | null' },
  estimate_vs_actual: {
    check: nullable(oneOf('under', 'on', 'over')),
    describe: '"under" | "on" | "over" | null',
  },
  rework: { check: nullable(v => typeof v === 'boolean'), describe: 'boolean | null' },
  bugs: { check: nullable(isCount), describe: 'non-negative integer | null' },
  adrs: { check: nullable(isCount), describe: 'non-negative integer | null' },

  // chat
  stories: { check: nullable(isCount), describe: 'non-negative integer | null' },
  halts: { check: nullable(isCount), describe: 'non-negative integer | null' },
  lanes: { check: nullable(oneOf('serial', 'parallel')), describe: '"serial" | "parallel" | null' },
  fallback_fired: { check: nullable(v => typeof v === 'boolean'), describe: 'boolean | null' },
  wall_clock_s: { check: nullable(isCount), describe: 'non-negative integer seconds | null' },
  dispatch_overhead_s: { check: nullable(isCount), describe: 'non-negative integer seconds | null' },

  // phase
  chats: { check: nullable(isCount), describe: 'non-negative integer | null' },
  merge: {
    check: nullable(oneOf('pr', 'direct', 'already-integrated')),
    describe: '"pr" | "direct" | "already-integrated" | null',
  },

  // run
  phases: { check: nullable(isCount), describe: 'non-negative integer | null' },
  pauses: { check: nullable(isCount), describe: 'non-negative integer | null' },
  stop_reason: { check: nullable(v => typeof v === 'string'), describe: 'string | null' },
  plan: { check: nullable(v => typeof v === 'string'), describe: 'path string | null' },
  predicted: {
    check: nullable(v => typeof v === 'object' && !Array.isArray(v)),
    describe: 'object | null',
  },

  // pause. `percent_used` and `threshold` are deliberately NOT clamped to 0..100 — a governor
  // reporting an overrun above 100 is real signal, and clamping at capture time would discard
  // exactly the data the threshold-tuning question needs.
  percent_used: {
    check: nullable(v => typeof v === 'number' && Number.isFinite(v)),
    describe: 'number | null',
  },
  threshold: {
    check: nullable(v => typeof v === 'number' && Number.isFinite(v)),
    describe: 'number | null',
  },
  reset_at: { check: nullable(isIsoWithZone), describe: 'ISO 8601 with zone | null' },
  // `action` is the PAUSE-LIFECYCLE marker — which half of a pause/resume pair this line is
  // (§A.4: a resume updates by append, so one pause event is two lines sharing id + ts).
  // STORY-26.4.03 briefly tried to reuse it for the governor's DECISION and the existing
  // fixtures rejected it immediately: they carry `pause` and `resume`, which are not
  // governor actions. Two concepts, two fields — see `governor_action` below.
  action: { check: nullable(v => typeof v === 'string'), describe: 'string | null' },
  // The governor's decision. ENUM, not free text (STORY-26.4.03 AC-3): the point of
  // capturing it is to count how often each decision fired, and a field that accepts any
  // string cannot be counted. Valid at BOTH `pause` and `run` level — a decision that did
  // not pause is a `run`-level event and must be readable under the same field name.
  governor_action: {
    check: nullable(oneOf(...GOVERNOR_ACTIONS)),
    describe: `${GOVERNOR_ACTIONS.map(a => `"${a}"`).join(' | ')} | null`,
  },
  resumed_at: { check: nullable(isIsoWithZone), describe: 'ISO 8601 with zone | null' },
  resume_mechanism: { check: nullable(v => typeof v === 'string'), describe: 'string | null' },
  // PROVENANCE OF THE SIGNAL THE GOVERNOR JUDGED (ADR-0156). ENUM, not free text, for the
  // same reason `governor_action` is: the question a reviewer asks of the ledger is
  // "how many of these runs actually had a signal?", and a field that accepts any string
  // cannot answer it.
  signal_source: {
    check: nullable(oneOf(...SIGNAL_SOURCES)),
    describe: `${SIGNAL_SOURCES.map(s => `"${s}"`).join(' | ')} | null`,
  },
  // WHAT AUTHORISED A RESUME (ADR-0160). See `RESUME_AUTHORISATIONS` above. Enumerated so an
  // acknowledged resume and an unacknowledged one are DIFFERENT on the ledger rather than
  // different only in the prose of `stop_reason`.
  resume_authorisation: {
    check: nullable(oneOf(...RESUME_AUTHORISATIONS)),
    describe: `${RESUME_AUTHORISATIONS.map(s => `"${s}"`).join(' | ')} | null`,
  },
  // WHAT was acknowledged — the halt reason as it was presented to the operator. Free text,
  // deliberately: a halt reason is prose. It sits beside the enum rather than inside
  // `stop_reason` because "why the run stopped" and "what the operator was shown before
  // agreeing to continue" are two facts, and one field holding both is the drift ADR-0109
  // exists to prevent. Null when the halt carried no recorded reason — which is itself the
  // fact the acknowledge-blind path (ADR-0160) needs to leave behind.
  acknowledged_halt_reason: { check: nullable(v => typeof v === 'string'), describe: 'string | null' },
}));

// ---------- the levels table ----------

// `levels[<name>].required` / `.optional` are the public, machine-readable field lists.
// Null-prototype and deeply frozen: three components require() this module in one process,
// and a mutable export would let one of them silently redefine the shape for the other two.
const levels = Object.create(null);
for (const level of LEVELS) {
  levels[level] = Object.freeze({
    required: Object.freeze([...COMMON_REQUIRED]),
    optional: Object.freeze([...COMMON_OPTIONAL, ...LEVEL_OPTIONAL[level]]),
  });
}
Object.freeze(levels);

// ---------- validate ----------

// Render a value for an error message without trusting it. A circular structure, a BigInt, or
// a hostile `toJSON` all make JSON.stringify throw — inside the message builder, which would
// otherwise defeat the never-throw contract from the one place least expecting it.
function describeValue(v) {
  try {
    const s = JSON.stringify(v);
    return s === undefined ? typeof v : s;
  } catch {
    return `[unserialisable ${typeof v}]`;
  }
}

function validateInner(record) {
  const errors = [];

  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    return { ok: false, errors: ['record is not a JSON object'], level: null };
  }

  // `level` is fully diagnosed here and then skipped by the type loop below, so a bad level
  // is reported exactly once and with the most specific message available.
  const rawLevel = record.level;
  const level = LEVELS.includes(rawLevel) ? rawLevel : null;
  if (rawLevel === undefined || rawLevel === null) {
    errors.push('missing required field: level');
  } else if (typeof rawLevel !== 'string') {
    errors.push(`field level: expected one of ${LEVELS.join(' | ')}, got ${describeValue(rawLevel)}`);
  } else if (!level) {
    errors.push(`unknown level: ${describeValue(rawLevel)} (expected one of ${LEVELS.join(', ')})`);
  }

  // Required-field presence. Falls back to the common core when the level is unknown, so a
  // record with a bad level still reports every problem it has rather than only the first.
  // MUST be keyed off the LEVELS membership test, never a bare `levels[rawLevel]` lookup —
  // `levels` is null-prototype for the same reason, but the explicit test is the guarantee.
  const required = level ? levels[level].required : COMMON_REQUIRED;
  for (const field of required) {
    if (field === 'level') continue;
    const missing = !(field in record) || record[field] === undefined || record[field] === null;
    if (missing) errors.push(`missing required field: ${field}`);
  }

  // Type/enum contract for every known field actually present. Unknown fields are permitted
  // and skipped (see header) — FIELD_TYPES is null-prototype so an unknown field named
  // `constructor` or `toString` misses cleanly instead of inheriting a bogus spec.
  for (const [field, value] of Object.entries(record)) {
    if (field === 'level') continue; // diagnosed above
    if (value === undefined) continue;
    const spec = FIELD_TYPES[field];
    if (!spec) continue;
    // A missing required field is already reported above; don't double-report it as a type error.
    if (value === null && required.includes(field)) continue;
    let ok = false;
    try {
      ok = spec.check(value);
    } catch {
      ok = false;
    }
    if (!ok) {
      errors.push(`field ${field}: expected ${spec.describe}, got ${describeValue(value)}`);
    }
  }

  return { ok: errors.length === 0, errors, level };
}

/**
 * Validate one record against the schema.
 *
 * @param {unknown} record
 * @returns {{ok: boolean, errors: string[], level: string|null}}
 *
 * Rejects: a non-object; an unknown/missing `level`; any missing required field; any known
 * field whose value violates its type/enum contract. Accepts: unknown extra fields, and any
 * level-specific optional field being absent.
 *
 * NOT LEVEL-SCOPED BY DESIGN. A `story` record carrying `percent_used`, or a `pause` record
 * carrying `tier`, VALIDATES. Because unknown fields are permitted for forward compatibility
 * (see header), a field known to another level is indistinguishable from a field not yet
 * named — so `levels[l].optional` documents intent and drives readers, but does not gate
 * writes. R25 must not infer "this record's fields match its level" from an `ok` verdict.
 *
 * NEVER THROWS, for any input whatsoever. The writer's always-exit-0 contract
 * (STORY-26.1.02 AC-2) depends on this — a validator that throws on a hostile payload would
 * defeat the point of validating before writing. The outer guard is belt-and-braces over the
 * per-site care taken in validateInner: property access on a Proxy, a throwing getter, or a
 * revoked Proxy can throw from expressions that look total. Covered by
 * `93-Scripts/tests/retro-schema.test.js`.
 */
function validate(record) {
  try {
    return validateInner(record);
  } catch {
    // Deliberately does NOT interpolate the caught value — a hostile `message` getter or
    // toString would let the failure handler itself throw.
    return { ok: false, errors: ['record could not be inspected'], level: null };
  }
}

module.exports = {
  // The join helper, re-exported so a component that already requires the schema (the writer,
  // the aggregator, R25) reaches the key rules through ONE require rather than growing a second
  // one that could be forgotten. `ledgerJoin` is the module itself — same object, not a copy.
  ledgerJoin,
  joinKeyField: ledgerJoin.KEY_FIELD,
  runField: ledgerJoin.RUN_FIELD,
  composeJoinKey: ledgerJoin.compose,
  UNATTRIBUTED_RUN: ledgerJoin.UNATTRIBUTED_RUN,
  SCHEMA_VERSION,
  LEVELS,
  TIER_REASONS,
  GOVERNOR_ACTIONS,
  PAUSING_ACTIONS,
  SIGNAL_SOURCES,
  RESUME_AUTHORISATIONS,
  levels,
  joinKey,
  joinSemantics,
  joinSemanticsNotes,
  COMMON_REQUIRED,
  COMMON_OPTIONAL,
  LEVEL_OPTIONAL,
  FIELD_TYPES,
  allowedValuesFor,
  enumeratedFields,
  validate,
};
