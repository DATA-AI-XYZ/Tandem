#!/usr/bin/env node
/**
 * retro-report.js — the retro ledger's ONE aggregator (STORY-26.2.01, PRD §A.5).
 *
 * Turns `41-Reports/retro/retro-log.jsonl` + `41-Reports/usage/usage-log.jsonl` into a rollup,
 * joined on `id` per the semantics declared in `lib/retro-schema.js`. Three surfaces consume it
 * — `close-phase` (STORY-26.2.02), `monthly-retro` and `reflect` (STORY-26.2.03) — so the join
 * is implemented once, here, and never restated in a skill body.
 *
 * ---------------------------------------------------------------------------
 * PURITY (AC-2)
 *
 * `build()` reads its two paths and nothing else. No clock, no network, no env, no `process.cwd()`.
 * In particular it does NOT stamp a `generatedAt` — a stamped rollup stops being comparable
 * across runs and would make every fixture test a moving target. The CLI stamps nothing either;
 * a caller that wants a timestamp on a rendered document adds it at the call site.
 *
 * ---------------------------------------------------------------------------
 * THE JOIN IS LEFT-OUTER ON `join_key` SINCE STORY-29.1.03, AND `usage` IS AN ARRAY
 *
 * It was on `id` until 2026-08-10, and `id` is why it barely worked: the two writers spelled one
 * chat two ways and the bare spelling named five chats. `lib/ledger-join.js` now supplies the
 * key for every record on both sides — declared by the writer where the record is new, derived
 * from the record itself or from a time window where it is not, and withheld entirely where two
 * candidates fit (reported as `ambiguous`, with the candidate set, never picked). Measured on
 * the live ledgers the chat-level join went from 8/22 — three of them over-matched 1:5 — to
 * 21/22 with the single remainder itemised. See ADR-0179. The paragraph below is the history
 * that made the change necessary and is kept for that reason.
 *
 * `retro-schema.joinSemantics` said 1:1 for story/chat until the review of E26-CHAT-02; it now says
 * 1:many on every level, which is what both this code and the live ledgers do (ADR-0149). The
 * declaration had to move because this file PRINTS it, one line under its own join counts — a
 * reader was being told "1:1 for story/chat" directly beneath a chat that joined 1:5. The LIVE
 * ledgers are why: `usage-log.jsonl` carries 27 rows whose
 * ids are `CHAT-01 … CHAT-10` **recycled once per phase**, so `CHAT-01` appears three times.
 * A chat-level join is therefore 1:many in practice too. Modelling `usage` as a single object
 * would have silently kept whichever row won the last write and reported it as *the* usage for
 * that chat — a number that looks measured and is arbitrary. It is an ARRAY on every level, and
 * `usageCount` is part of the rollup so a consumer can see the fan-out rather than average it
 * away. See ADR-0147.
 *
 * UNMATCHED ON EITHER SIDE IS NORMAL, NEVER AN ERROR (AC-4). The live ledgers make this the
 * common case, not the edge: 39 story-level retro records have no usage counterpart at all,
 * because `usage-capture.js` brackets chats and not stories. Both sides are reported with counts
 * and both sides survive into the rollup.
 *
 * ---------------------------------------------------------------------------
 * TOLERANCE (AC-5, AC-6)
 *
 * One bad line cannot take down a close-phase. A line that will not parse, or that parses but
 * fails `retro-schema.validate()`, is SKIPPED and COUNTED — never thrown. A missing ledger file
 * is an empty ledger, not an error: a fresh install has neither file and must still produce a
 * rollup. `skipped` is a total; `skippedDetail` says which line and why, so a ledger that has
 * quietly started rejecting everything is visible rather than merely small.
 *
 * LINE ENDINGS. The working-tree ledger is CRLF (git stores LF; this is a CRLF checkout), so
 * every split here is `/\r?\n/`. A `split('\n')` would leave a trailing `\r` on every record —
 * harmless to `JSON.parse`, which treats CR as whitespace, and therefore exactly the kind of
 * defect that survives a test suite. Asserted in `tests/retro-report.test.js :: all-levels`.
 *
 * Usage:
 *   node retro-report.js                                  rollup summary for the live ledgers
 *   node retro-report.js --phase EPIC-26                  the recalled section for one phase
 *   node retro-report.js --month 2026-08                  the recalled section for one month
 *   node retro-report.js --json                           the whole rollup as JSON
 *   node retro-report.js --retro <path> --usage <path>    point at fixture ledgers
 *
 * Exit codes: 0 = a rollup was produced (an EMPTY rollup is a success) · 2 = usage error.
 *
 * Dependency-free — Node stdlib only, consistent with every other `93-Scripts/` tool.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const schema = require(path.join(__dirname, 'lib', 'retro-schema.js'));
// THE ONE JOIN HELPER (STORY-29.1.03). Reached through the schema's own re-export so this file
// has exactly one require to keep in step, and so a consumer reading `schema.ledgerJoin` and one
// reading `lib/ledger-join.js` directly are provably the same object.
const ledgerJoin = schema.ledgerJoin;

const PM_ROOT = path.resolve(__dirname, '..');
const DEFAULT_RETRO_LOG = path.join(PM_ROOT, '41-Reports', 'retro', 'retro-log.jsonl');
const DEFAULT_USAGE_LOG = path.join(PM_ROOT, '41-Reports', 'usage', 'usage-log.jsonl');

// The sentence an absent window gets. Stated ONCE, here, because three surfaces assert on it
// and a second spelling would let one of them drift into rendering a blank section instead —
// which reads as an omission, or worse as a measured zero (STORY-26.2.02 AC-3).
const NO_RECORDS_PHASE = 'No retro records for this phase.';
const NO_RECORDS_WINDOW = 'No retro records for this window.';

// ---------- reading ----------

/**
 * Read one JSONL ledger. NEVER THROWS on content: an unreadable file is an empty ledger and a
 * bad line is a skip. `validate` is optional because `usage-log.jsonl` has its own (older,
 * unversioned) shape that `retro-schema` does not describe — it is read structurally.
 */
function readLedger(filePath, validate) {
  const out = { path: filePath || null, exists: false, lines: 0, records: [], skipped: 0, skippedDetail: [] };
  if (!filePath) return out;

  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
    out.exists = true;
  } catch (err) {
    // AC-6 — a missing (or unreadable) ledger IS an empty ledger. Recorded, not thrown.
    out.readError = err && err.code ? String(err.code) : 'unreadable';
    return out;
  }

  const rawLines = text.split(/\r?\n/);
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (line.trim() === '') continue; // trailing newline, blank separator — not a record
    out.lines += 1;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      out.skipped += 1;
      // `text` is the offending line VERBATIM (capped). Two jobs: a reader debugging a skipped
      // line needs to see it, and it makes the line SPLIT observable — a `split('\n')` reader
      // records a trailing `\r` here where `/\r?\n/` records none. JSON.parse treats CR as
      // whitespace, so without this the CRLF/LF distinction has no witness anywhere in the
      // aggregator and a wrong split would be green forever (BUG-20260804-17's shape).
      out.skippedDetail.push({
        line: i + 1, reason: 'unparseable', detail: safeMessage(err), text: line.slice(0, 200),
      });
      continue;
    }
    if (validate) {
      let verdict;
      try {
        verdict = validate(parsed);
      } catch (err) {
        verdict = { ok: false, errors: [safeMessage(err)] };
      }
      if (!verdict || !verdict.ok) {
        out.skipped += 1;
        out.skippedDetail.push({
          line: i + 1,
          reason: 'invalid',
          detail: (verdict && verdict.errors ? verdict.errors : ['failed validation']).join('; '),
          text: line.slice(0, 200),
        });
        continue;
      }
    } else if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      out.skipped += 1;
      out.skippedDetail.push({ line: i + 1, reason: 'invalid', detail: 'not a JSON object' });
      continue;
    }
    out.records.push(parsed);
  }
  return out;
}

function safeMessage(err) {
  try {
    if (err && typeof err.message === 'string') return err.message;
    return String(err);
  } catch {
    return '(unprintable error)';
  }
}

// ---------- the build ----------

/**
 * Build the rollup. PURE given the two paths.
 *
 * @param {string} retroPath  path to retro-log.jsonl (may not exist)
 * @param {string} usagePath  path to usage-log.jsonl (may not exist)
 * @returns {object} rollup
 */
function build(retroPath, usagePath) {
  const retro = readLedger(
    retroPath === undefined ? DEFAULT_RETRO_LOG : retroPath,
    schema.validate,
  );
  const usage = readLedger(
    usagePath === undefined ? DEFAULT_USAGE_LOG : usagePath,
    null,
  );

  // THE KEY COMES FROM THE ONE HELPER (STORY-29.1.03, ADR-0179). `ledger-join` decides, per
  // record, whether the key was DECLARED by the writer, derived from the record itself, derived
  // from a time window over keys already known, or is AMBIGUOUS — in which case there is no key
  // and the record joins to nothing, with its candidate set carried so a reader can see why.
  // This file no longer knows how a key is spelled, which is the point: `plan-vs-actual.js` and
  // the dashboard rollup read the same rules from the same module rather than three copies.
  const anchors = ledgerJoin.buildAnchors([retro.records, usage.records]);
  const keyOf = (record) => ledgerJoin.resolve(record, anchors);

  // Index the usage side by join key. A Map, not an object literal: a usage row with
  // `id: "__proto__"` must key cleanly rather than reach Object.prototype.
  const usageById = new Map();
  const usageKeys = new Map();
  for (const u of usage.records) {
    const resolved = keyOf(u);
    usageKeys.set(u, resolved);
    if (resolved.key === null) continue;
    if (!usageById.has(resolved.key)) usageById.set(resolved.key, []);
    usageById.get(resolved.key).push(u);
  }

  const matchedUsageKeys = new Set();
  const entries = [];
  const byLevel = Object.create(null);
  for (const level of schema.LEVELS) byLevel[level] = [];

  for (const r of retro.records) {
    const resolved = keyOf(r);
    const matches = resolved.key === null ? [] : (usageById.get(resolved.key) || []);
    if (matches.length) matchedUsageKeys.add(resolved.key);
    const entry = {
      level: r.level,
      id: r.id,
      ts: r.ts,
      phase: r.phase === undefined ? null : r.phase,
      chat: r.chat === undefined ? null : r.chat,
      // The key AND how it was arrived at, on every entry. A consumer that renders a joined
      // figure can say whether the join was recorded or inferred — the ADR-0159 `state_source`
      // discipline, applied to a key instead of a state.
      joinKey: resolved.key,
      joinKeyStatus: resolved.status,
      joinKeyCandidates: resolved.candidates,
      retro: r,
      usage: matches,          // ARRAY — 1:many is real on the live ledgers. See the header.
      usageCount: matches.length,
      matched: matches.length > 0,
    };
    entries.push(entry);
    byLevel[entry.level].push(entry);
  }

  // Left side with no right side. Normal (schema note 3), reported, never an error.
  const unmatchedRetro = entries.filter(e => !e.matched)
    .map(e => ({ level: e.level, id: e.id, ts: e.ts, phase: e.phase,
      joinKey: e.joinKey, joinKeyStatus: e.joinKeyStatus }));

  // Right side with no left side. Also normal, also carried through — a usage row that predates
  // the ledger is exactly the R27 gap the validator is designed to notice.
  const unmatchedUsage = usage.records.filter((u) => {
    const resolved = usageKeys.get(u);
    const key = resolved ? resolved.key : null;
    return key === null || !matchedUsageKeys.has(key);
  });

  // EVERY DERIVATION THIS ROLLUP COULD NOT MAKE, BY NAME. AC-2's "never silently picks" is only
  // true if the reader can SEE the picks it declined — a rollup that quietly drops an ambiguous
  // record reads exactly like one that had nothing to drop.
  const ambiguous = [];
  for (const [record, resolved] of usageKeys) {
    if (resolved.status === 'ambiguous') {
      ambiguous.push({ side: 'usage', id: record.id, ts: record.ts,
        candidates: resolved.candidates, why: resolved.why });
    }
  }
  for (const e of entries) {
    if (e.joinKeyStatus === 'ambiguous') {
      ambiguous.push({ side: 'retro', id: e.id, ts: e.ts,
        candidates: e.joinKeyCandidates, why: 'ambiguous derivation' });
    }
  }

  const levelCounts = Object.create(null);
  for (const level of schema.LEVELS) levelCounts[level] = byLevel[level].length;

  return {
    joinKey: schema.joinKey,
    joinSemantics: schema.joinSemantics,
    retro: {
      path: retro.path, exists: retro.exists, lines: retro.lines,
      skipped: retro.skipped, skippedDetail: retro.skippedDetail,
    },
    usage: {
      path: usage.path, exists: usage.exists, lines: usage.lines,
      skipped: usage.skipped, skippedDetail: usage.skippedDetail,
    },
    entries,
    byLevel,
    unmatchedRetro,
    unmatchedUsage,
    ambiguous,
    counts: {
      retroRecords: entries.length,
      usageRecords: usage.records.length,
      byLevel: levelCounts,
      matched: entries.filter(e => e.matched).length,
      unmatchedRetro: unmatchedRetro.length,
      unmatchedUsage: unmatchedUsage.length,
      ambiguous: ambiguous.length,
      // The rollup's `skipped` total AC-5 names — both ledgers, both reasons.
      skipped: retro.skipped + usage.skipped,
    },
  };
}

// ---------- windowing ----------

/**
 * Every entry belonging to a phase. A phase is named three different ways across the live
 * ledger — `phase: "EPIC-26"` on its stories and chats, `id: "EPIC-27-P3"` on the phase record
 * itself, and `id: "FEAT-26.1"` on the older phase records — so all three are matched rather
 * than assuming one convention the writers never agreed on.
 */
function forPhase(rollup, phaseId) {
  if (!rollup || !phaseId) return [];
  const want = String(phaseId);
  return rollup.entries.filter(e =>
    e.phase === want || e.id === want || (typeof e.id === 'string' && e.id.indexOf(want + '-') === 0));
}

/** Every entry whose `ts` DATE PART falls in `YYYY-MM`. String prefix, for the reason
 *  `retro-shipped.js` gives: that is what a reader does when they look at the file. */
function forMonth(rollup, month) {
  if (!rollup || !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''))) return [];
  return rollup.entries.filter(e => typeof e.ts === 'string' && e.ts.slice(0, 7) === month);
}

// ---------- rendering ----------

function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\r?\n/g, ' ').trim();
}

// ---- the rendered payload (BUG-20260804-21) --------------------------------
//
// This renderer used to walk a HAND-WRITTEN list of `if`s covering nine fields, and silently
// dropped everything else the schema defines — every `run` field, every `pause` field,
// `wall_clock_s` (which 28 of the live ledger's records carry, and which ADR-0107 was amended
// specifically to add), `chats`, `dispatch_overhead_s` and `fallback_fired`. In the committed
// fixture a pause at `percent_used: 82.5` and its own resume rendered BYTE-IDENTICALLY.
//
// It now iterates `retro-schema`'s field lists, so A FIELD ADDED TO THE SCHEMA APPEARS ON THE
// PAGE BY DEFAULT and omission is an explicit decision recorded below. The unlabelled default
// formatter exists for exactly that: a new field renders as `field name value` with nobody
// having to remember to come back here.
//
// The bug write-up counted eleven dropped fields; the real number was fifteen at the time and
// is larger now that STORY-26.4.03 added four more. That is the argument for deriving the list
// rather than maintaining it — a hand-written list was already wrong about its own size.

// Rendered as their own indented sub-line, because they are sentences, not measurements.
const SUBLINE_FIELDS = Object.freeze(['friction', 'kit_signal', 'artefact_gap']);

// Deliberately NOT on the line, each with its reason. This is the whole allow-list; anything
// not named here renders — and that sentence is only true if the walk below covers `required`
// as well as `optional`. It did not (BUG-20260804-24): `ts` is a REQUIRED field, so it fell
// through a filter that reads as an allow-list and was silently dropped while claiming not to
// be. `level` and `id` are omitted here because they are already the line's own prefix, which
// is a reason; `ts` had none, and two `run`-level `continue` records five hours apart rendered
// byte-identically because of it.
const OMITTED_FROM_LINE = Object.freeze(Object.assign(Object.create(null), {
  level: 'already the bolded prefix of every line — a second copy would be noise',
  id: 'already the code-spanned prefix of every line — a second copy would be noise',
  schema_version: 'constant per writer version — noise on every line, and never a measurement',
}));

// Presentation only. A field with no entry here still renders, via `defaultBit()`.
const FIELD_BIT = Object.freeze(Object.assign(Object.create(null), {
  // FIRST on the line, and the only field that distinguishes two records a run leaves at two
  // different moments with otherwise identical payloads. ADR-0153 argues `stage` labels a
  // story's two records and "`ts` only orders them" — an argument that holds only while `ts`
  // is on the page for the reader to order by. See BUG-20260804-24.
  ts: v => `${v}`,
  phase: v => `phase ${v}`,
  chat: v => `chat ${v}`,
  stage: v => `stage ${v}`,
  tier: v => `tier ${v}`,
  tier_reason: v => `reason ${v}`,
  tier_note: v => `note ${v}`,
  usage_estimate: v => `estimate ${v} tok`,
  estimate_vs_actual: v => `estimate ${v}`,
  // `false` MUST render. It used to be invisible, so "this story needed no second pass" and
  // "nobody said" looked the same on the page — the exact calibration hole ADR-0110's
  // tri-state `rework` exists to keep out of the data, reintroduced at the presentation layer.
  rework: v => (v ? 'rework' : 'no rework'),
  bugs: v => `${v} bug(s)`,
  adrs: v => `${v} ADR(s)`,
  wall_clock_s: v => `${v}s wall clock`,
  stories: v => `${v} story/ies`,
  halts: v => `${v} halt(s)`,
  lanes: v => `${v} lanes`,
  fallback_fired: v => (v ? 'fallback fired' : 'no fallback'),
  dispatch_overhead_s: v => `${v}s dispatch overhead`,
  chats: v => `${v} chat(s)`,
  merge: v => `merge ${v}`,
  phases: v => `${v} phase(s)`,
  pauses: v => `${v} pause(s)`,
  stop_reason: v => `stop: ${v}`,
  plan: v => `plan ${v}`,
  predicted: (v) => { try { return `predicted ${JSON.stringify(v)}`; } catch { return 'predicted (unserialisable)'; } },
  percent_used: v => `${v}% used`,
  threshold: v => `threshold ${v}%`,
  reset_at: v => `resets ${v}`,
  action: v => `action ${v}`,
  governor_action: v => `governor ${v}`,
  resumed_at: v => `resumed ${v}`,
  resume_mechanism: v => `via ${v}`,
}));

function defaultBit(field, value) {
  return `${field.replace(/_/g, ' ')} ${value}`;
}

/**
 * Every field this level's line should carry, in schema order. Exported so the probe asserts
 * the SAME list the renderer walks rather than a second copy of it that can drift.
 *
 * REQUIRED FIRST, THEN OPTIONAL. Walking `optional` alone was BUG-20260804-24: `retro-schema`
 * splits its vocabulary into `required` (`level`, `id`, `ts`) and `optional`, and a filter over
 * only the second half cannot honour a comment that promises "anything not named in
 * OMITTED_FROM_LINE renders". Both halves are walked and the omission list carries the reason
 * for each of the three fields that legitimately does not appear.
 */
function payloadFieldsFor(level) {
  const spec = schema.levels[level];
  if (!spec) return [];
  return spec.required.concat(spec.optional).filter(f =>
    SUBLINE_FIELDS.indexOf(f) === -1 && !(f in OMITTED_FROM_LINE));
}

function renderEntryLines(entries) {
  const lines = [];
  for (const e of entries) {
    const bits = [];
    for (const field of payloadFieldsFor(e.level)) {
      const v = e.retro[field];
      // `null`/absent means "nobody supplied this" and is not rendered. `false` and `0` ARE
      // values and must be — `v === null || v === undefined`, never a truthiness test, which
      // is how `0 bug(s)` and `no rework` disappeared from the page in the first place.
      if (v === null || v === undefined) continue;
      const fmt = FIELD_BIT[field];
      bits.push(fmt ? fmt(v) : defaultBit(field, v));
    }
    bits.push(e.matched ? `${e.usageCount} usage row(s)` : 'no usage row');
    lines.push(`- **${e.level}** \`${e.id}\` — ${bits.join(' · ')}`);
    for (const field of SUBLINE_FIELDS) {
      const v = esc(e.retro[field]);
      if (v) lines.push(`  - _${field.replace('_', ' ')}:_ ${v}`);
    }
  }
  return lines;
}

/**
 * The section `close-phase` pastes into its phase report. ADDITIVE BY CONSTRUCTION: it emits
 * exactly one `##` heading of its own and never re-emits close-phase's derived headings
 * (`## What shipped`, `## Metrics`, …), so pasting it can only add to the derived retro — it
 * cannot overwrite a section of it. `tests/close-phase-retro.test.js :: augments-not-replaces`
 * asserts both halves.
 */
function renderPhaseRecall(rollup, phaseId) {
  const lines = ['## Recalled from the retro ledger', ''];
  const entries = forPhase(rollup, phaseId);
  if (entries.length === 0) {
    lines.push(NO_RECORDS_PHASE);
  } else {
    lines.push(...renderEntryLines(entries));
  }
  lines.push('', renderProvenance(rollup, entries));
  return lines.join('\n');
}

/** The same, for a calendar window — `monthly-retro` and `reflect`. */
function renderWindowRecall(rollup, month) {
  const lines = ['## Recalled from the retro ledger', ''];
  const entries = forMonth(rollup, month);
  if (entries.length === 0) {
    lines.push(NO_RECORDS_WINDOW);
  } else {
    lines.push(...renderEntryLines(entries));
  }
  lines.push('', renderProvenance(rollup, entries));
  return lines.join('\n');
}

/**
 * The provenance comment. Carries the SKIPPED count so a malformed ledger surfaces through the
 * aggregator's own tolerance rather than through a second bespoke error path in each consumer
 * (STORY-26.2.02 AC-4). Deliberately an HTML comment: it is evidence, not narrative.
 */
function renderProvenance(rollup, shown) {
  const c = rollup.counts;
  // SCOPE THE JOIN NUMBERS TO THE WINDOW THEY SIT UNDER (review of E26-CHAT-02, ADR-0149).
  // These were whole-ledger totals printed immediately after a window-scoped record count, in one
  // sentence, separated only by `·`. A July retro with no records at all still read
  // `0 of 68 record(s) in window · 3 joined / 65 retro-unmatched`, and an EPIC-26 phase report
  // claimed `3 joined` when exactly 1 of its own 9 records joined. The numbers were true and they
  // answered a different question from the one the sentence appears to ask — the precise shape
  // this kit calls presence-is-not-correctness. Ledger totals are still carried, LABELLED.
  const entries = Array.isArray(shown) ? shown : null;
  const count = entries ? entries.length : shown;
  const inWindow = entries
    ? `${entries.filter(e => e.matched).length} joined / `
      + `${entries.filter(e => !e.matched).length} unjoined in window · `
    : '';
  return `<!-- retro-report · ${count} of ${c.retroRecords} record(s) in window · `
    + inWindow
    + `ledger totals: ${c.matched} joined / ${c.unmatchedRetro} retro-unmatched / `
    + `${c.unmatchedUsage} usage-unmatched · `
    + `${c.skipped} skipped line(s) -->`;
}

// ---------- CLI ----------

function usage(msg) {
  if (msg) console.error(msg);
  console.error('usage: node retro-report.js [--retro <path>] [--usage <path>] '
    + '[--phase <id> | --month YYYY-MM] [--json]');
  process.exit(2);
}

function main(argv) {
  const args = argv.slice(2);
  let retroPath;
  let usagePath;
  let phaseId = null;
  let month = null;
  let asJson = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const need = (name) => {
      const v = args[++i];
      // Guarded like every other value flag in this tree: a valueless flag must not silently
      // fall back to the production ledger.
      if (v === undefined || String(v).indexOf('--') === 0) usage(`${name} requires a value`);
      return v;
    };
    if (a === '--retro') retroPath = need('--retro');
    else if (a === '--usage') usagePath = need('--usage');
    else if (a === '--phase') phaseId = need('--phase');
    else if (a === '--month') month = need('--month');
    else if (a === '--json') asJson = true;
    else usage(`unknown argument "${a}"`);
  }

  const rollup = build(retroPath, usagePath);

  if (asJson) { console.log(JSON.stringify(rollup, null, 2)); return 0; }
  if (phaseId) { console.log(renderPhaseRecall(rollup, phaseId)); return 0; }
  if (month) { console.log(renderWindowRecall(rollup, month)); return 0; }

  const c = rollup.counts;
  console.log(`retro-report — ${c.retroRecords} retro record(s), ${c.usageRecords} usage record(s)`);
  console.log(`  by level: ${schema.LEVELS.map(l => `${l} ${c.byLevel[l]}`).join(' · ')}`);
  console.log(`  joined: ${c.matched} · retro-unmatched: ${c.unmatchedRetro} · usage-unmatched: ${c.unmatchedUsage}`);
  // BY LEVEL, because the bare totals read as a match RATE and are not one: `usage-capture.js`
  // brackets chats, so `story` and `phase` records have no usage counterpart to miss and their
  // "unmatched" is structural, not a gap. 3/68 looks like a broken join; `chat 3/15 · story 0/43`
  // says which part is actually unjoined and which part was never joinable (review of E26-CHAT-02).
  console.log(`  joined by level: ${schema.LEVELS
    .map(l => `${l} ${rollup.byLevel[l].filter(e => e.matched).length}/${rollup.byLevel[l].length}`)
    .join(' · ')}`);
  console.log(`  skipped line(s): ${c.skipped}`);
  // HOW THE KEYS WERE ARRIVED AT (STORY-29.1.03). Printed beside the join counts because a
  // reader deciding whether to trust `joined: 29` needs to know how many of those keys were
  // WRITTEN and how many were inferred from a time window — the same reason ADR-0159 surfaces
  // `state_source` next to a state.
  const census = Object.create(null);
  for (const s of ledgerJoin.STATUSES) census[s] = 0;
  for (const e of rollup.entries) census[e.joinKeyStatus] += 1;
  console.log(`  retro keys: ${ledgerJoin.STATUSES.map(s => `${s} ${census[s]}`).join(' · ')}`);
  if (c.ambiguous) {
    console.log(`  AMBIGUOUS derivations (reported, never picked): ${c.ambiguous}`);
    for (const a of rollup.ambiguous) {
      console.log(`    - ${a.side} ${a.id} @ ${a.ts} → candidates: ${a.candidates.join(', ')}`);
    }
  }
  console.log(`  join: ${rollup.joinSemantics}`);
  return 0;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = {
  build, readLedger, forPhase, forMonth,
  renderPhaseRecall, renderWindowRecall, renderEntryLines, renderProvenance,
  payloadFieldsFor, SUBLINE_FIELDS, OMITTED_FROM_LINE, FIELD_BIT,
  NO_RECORDS_PHASE, NO_RECORDS_WINDOW,
  DEFAULT_RETRO_LOG, DEFAULT_USAGE_LOG,
};
