'use strict';
/**
 * lib/usage-estimate.js — the `usage_estimate:` PRODUCER. STORY-29.3.02 / BACKLOG-0157.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * `usage_estimate` was designed end to end — template field, R23 shape rule, a reconciler that
 * reads it, a projection that sums it — and **nothing ever wrote one**. 0 of ~300 stories carry
 * a number, so every estimate-vs-actual surface in the kit runs on one leg and prints its honest
 * null. This module is the missing writer, and the one place the derivation is defined.
 *
 * ---------------------------------------------------------------------------
 * THE HEURISTIC, AND WHICH PARTS OF IT ARE MEASURED
 *
 *     usage_estimate  =  ANCHOR_M  ×  BAND_RATIO[estimate]  ×  TYPE_MULTIPLIER[type_of_work]
 *
 * Three factors, and they are NOT equally well founded. Saying which is which is the whole
 * difference between an estimate and a number that looks measured:
 *
 *   ANCHOR_M — MEASURED. Derived from the live usage ledger, recomputable by
 *     `usage-estimate.js --refresh-anchors`, snapshot recorded below with its date and n.
 *
 *   BAND_RATIO — A STATED JUDGEMENT. XS/S/M/L is a human sizing scale; there are no per-band
 *     actuals to fit it to, because there are no story-level actuals at all yet
 *     (STORY-29.3.03 is what makes them possible). The ladder is 0.25 / 0.5 / 1 / 2 — doubling
 *     per band — and it is declared as a judgement rather than dressed up as a finding.
 *
 *   TYPE_MULTIPLIER — 1.00 FOR EVERY DISCIPLINE, DELIBERATELY. The obvious move is to make
 *     `docs` cheap and `backend` dear. There is no evidence for any spread, and inventing one
 *     would be exactly the fabrication this kit files bugs about. The factor exists in the
 *     formula so the refresh has somewhere to put a measured value; until then it multiplies
 *     by one and says so.
 *
 * ---------------------------------------------------------------------------
 * HOW THE ANCHOR IS MEASURED, AND THE THING THAT MAKES IT NON-OBVIOUS
 *
 * A `--chat` capture sums the WHOLE session transcript directory, so each chat row on the
 * ledger is a CUMULATIVE re-sum, not that chat's own spend: the live rows climb 907M → 2.77B
 * across 39 captures. Taking a row total as "what a chat cost" would overstate a story's
 * expected cost by two orders of magnitude.
 *
 * The incremental figure is therefore the DELTA between consecutive rows, and the median of
 * those deltas is the anchor for one chat. Median rather than mean because two of the 38
 * intervals are transcript-directory rotations (686M and 331M) that no chat spent.
 *
 * A chat carries a median of 2 stories (mean 2.55 over 102 planned chats), so:
 *
 *     ANCHOR_M  =  median chat-interval delta  /  mean stories per chat
 *               =  18,180,687 / 2.55  =  7,129,681  →  stated as 7,000,000
 *
 * Rounded HARD on purpose. An estimate carried to seven significant figures is precision
 * theatre; the honest claim is "about seven million tokens", and the rounding is what says so.
 *
 * Node stdlib only.
 */

const fs = require('fs');
const path = require('path');

/** Heuristic version. Bump when a factor CHANGES, not when the snapshot is refreshed. */
const HEURISTIC_VERSION = 1;

/**
 * The measured half, with its provenance attached. `--refresh-anchors` recomputes every number
 * in here from a ledger and prints the diff; nothing in this file is a constant somebody typed
 * because it looked plausible.
 */
const ANCHORS = Object.freeze({
  // Refreshed 2026-09-01 at the STORY-34.2.03 DoD gate (CHAT-06 of the EPIC-34/35 programme) —
  // the NINTH occurrence, and the THIRD in which THE ANCHOR ITSELF MOVES, this time DOWNWARD.
  // CHAT-04, CHAT-05 and CHAT-06 appended six rows between them (68 -> 74, intervals 67 -> 73),
  // and those chats were SHORTER per capture than the EPIC-33 port work the previous snapshot
  // was measured over: the median interval fell 24,344,688 -> 21,173,428 (-13.0%). The divisor
  // is byte-identical at 2.6 — no strategy sidecar was emitted in between — so the entire
  // movement is the median. Raw division 8,143,626, which one significant figure rounds DOWN:
  // `anchor_m_tokens` 9,000,000 -> 8,000,000.
  //
  // A FALLING ANCHOR IS AS REAL A MEASUREMENT AS A RISING ONE, and is recorded rather than
  // smoothed: an M story is now expected to cost about a million tokens LESS than it was on
  // 2026-08-29. Stories written before today keep the basis line they were written with — a
  // basis records what was believed when the estimate was made, and rewriting it would destroy
  // the variance data it exists to make interpretable. The three FEAT-34.2 stories closed in
  // this very chat therefore still read `anchor 9,000,000`, correctly.
  //
  // HEURISTIC_VERSION is still NOT bumped: the factors are unchanged, only the measurement they
  // are applied to. The RECURRENCE remains BACKLOG-0214 — nine of nine occurrences closed by
  // re-running this chore, which is still a treatment and still not a cure.
  //
  // Refreshed 2026-08-29 during STORY-35.3.05 (CHAT-01 of the EPIC-34/35 programme) — the
  // EIGHTH occurrence, and the SECOND caused by a STRATEGY EMISSION (the fifth-occurrence
  // shape, BUG-20260824-07, recurring): landing EXECUTION-STRATEGY-2026-08-29.json added
  // 11 chats / 25 stories to the divisor's population in one write (119/313 -> 130/338), so
  // the divisor moved 2.6303 -> 2.6 the moment the sidecar existed. The ledger also grew
  // 67 -> 68 rows (intervals 66 -> 67), median 22,911,709 -> 24,344,688 (+6.3%); the raw
  // division lands at 9,363,342 and one significant figure absorbs it, so `anchor_m_tokens`
  // stays 9,000,000. HEURISTIC_VERSION NOT bumped: a refreshed snapshot is not a new
  // heuristic. Recorded as BUG-20260829-01; the recurrence remains BACKLOG-0214.
  //
  // Refreshed 2026-08-26 at the EPIC-33 CHAT-09 / STORY-33.8.01 DoD gate (same run).
  // SEVENTH occurrence, and the SECOND in which the ANCHOR ITSELF MOVES. The ledger grew
  // 63 -> 67 rows across CHAT-07, the Phase-4/5 closes and CHAT-08's captures; the median
  // interval re-measured 20,347,043 -> 22,911,709.5 (+12.6%); the divisor is byte-identical at
  // 2.6303 because no strategy sidecar was emitted in between, so the ENTIRE movement is the
  // median. Raw division 8,710,683, which one significant figure rounds UP: `anchor_m_tokens`
  // 8,000,000 -> 9,000,000. Drift against the recorded block was 8.2%.
  //
  // HEURISTIC_VERSION is still NOT bumped: the factors are unchanged, only the measurement they
  // are applied to. A refreshed snapshot is not a new heuristic.
  //
  // Recorded as BUG-20260826-08. The RECURRENCE remains BACKLOG-0214 and is now six of seven
  // occurrences closed by re-running this chore — still a treatment, still not a cure.
  //
  // THE MEDIAN IS RECORDED AS A WHOLE TOKEN, AND THIS IS THE FIRST TIME THAT HAS MATTERED.
  // 66 intervals is an EVEN sample, so the median is the mean of the two middle deltas and
  // measures 22,911,709.5. `estimate-producer.test.js --case anchors-grounded` compares this
  // block against the table in `90-Standards/USAGE-ESTIMATE-HEURISTIC.md` for EXACT equality, and
  // its table parser captures `[\d,]+` — digits and commas, no decimal point — so a half token
  // cannot be stated in both places. It is recorded truncated: half a token is 0.000002% of the
  // value, it does not move the one-significant-figure anchor, and the alternative (widening a
  // gate's parser so this measurement fits) is changing the check to fit the data. The parser
  // gap itself is BACKLOG-0220.
  //
  // Refreshed 2026-08-26 at the EPIC-33 CHAT-06 DoD gate (run `autopilot-2026-08-24-epic33-preact-port`).
  // SIXTH occurrence, and the FIRST in which the ANCHOR ITSELF MOVES rather than the population
  // around it. The ledger grew 58 -> 63 rows across CHAT-02..CHAT-05's captures, the median
  // interval re-measured 18,520,938 -> 20,347,043 (+9.9%), the divisor is byte-identical at
  // 2.6303 — and the raw division lands at 7,735,636, which one significant figure rounds UP:
  // `anchor_m_tokens` 7,000,000 -> 8,000,000. That is a real change to what an M story is
  // expected to cost, measured rather than chosen, and it is why this refresh is worth reading
  // rather than skimming.
  //
  // HEURISTIC_VERSION is still NOT bumped: the factors are unchanged, only the measurement they
  // are applied to. A refreshed snapshot is not a new heuristic — the same rule the five notes
  // below follow.
  //
  // Recorded as BUG-20260826-01, and the RECURRENCE is recorded as BACKLOG-0214: five of the six
  // occurrences were closed by re-running this chore, which is a treatment rather than a cure.
  // The assertion that goes red compares a LIVE measurement against this frozen block, so every
  // chat's own usage capture can falsify it; BACKLOG-0214 is where that gets fixed properly.
  // Refreshed 2026-08-24 at the EPIC-33 CHAT-01 close (run `autopilot-2026-08-24-epic33-preact-port`).
  // FIFTH occurrence, and the FIRST caused by a STRATEGY EMISSION rather than by a usage capture:
  // landing `EXECUTION-STRATEGY-2026-08-24.json` added 10 chats / 33 stories to the divisor's
  // population in one write (109/280 -> 119/313), so the divisor moved 2.5688 -> 2.6303 the moment
  // the sidecar existed — before a single story had run. The guard caught it at the chat close, as
  // designed, and BUG-20260824-07 records the shape: the divisor is measured from the SIDECAR
  // corpus, so a strategist run is a population event exactly like a chat close is.
  //
  // ONLY THE POPULATION MOVED, again. Median interval re-measured 19,020,798 -> 18,520,938 (-2.6%),
  // rows 53 -> 58, intervals 52 -> 57, divisor 2.5688 -> 2.6303 (+2.4%); the raw division lands at
  // 7,041,379 and one significant figure absorbs it, so `anchor_m_tokens` stays 7,000,000.
  // HEURISTIC_VERSION NOT bumped: a refreshed snapshot is not a new heuristic.
  //
  // Refreshed 2026-08-19 at the E32 CHAT-02 close (STORY-32.2.02 gate re-run). The chat-level
  // usage captures since the 2026-08-18 snapshot (E31-run02 CHAT-01, the phase close, and
  // CHAT-02's two rows — an unattributed first capture kept per ADR-0165 plus the attributed
  // re-capture) took the ledger from 47 rows to 53 and the intervals from 46 to 52 — six past
  // ROW_SLACK, so `estimate-producer` went RED at the chat's own close gate. FOURTH occurrence
  // of a close-out falsifying this snapshot; the guard did exactly what MAJOR-1 built it to do.
  // ONLY THE POPULATION MOVED, again: median interval re-measured 18,242,082 → 19,020,798
  // (+4.3%), divisor byte-identical at 2.5688, raw division 7,404,546 → one significant figure
  // absorbs it and `anchor_m_tokens` stays 7,000,000. HEURISTIC_VERSION NOT bumped: a refreshed
  // snapshot is not a new heuristic.
  //
  // Refreshed 2026-08-18 at the EPIC-30 phase close (independent review of the CHAT-07 merge).
  // The four chat-level usage captures for E30-CHAT-05/06/07 took the ledger from 41 rows to 47
  // and the intervals from 40 to 46 — six past the `ROW_SLACK` of 5 — so `estimate-producer`
  // went RED on the row and interval arms and the chat's own "npm test 95/95" claim was already
  // false when it was written. THIS IS THE THIRD TIME a phase's own close-out has falsified this
  // snapshot (see the 2026-08-10 note below); the guard did exactly what MAJOR-1 built it to do.
  //
  // ONLY THE POPULATION MOVED. `--refresh-anchors` measures the median interval at 18,242,082 and
  // the divisor at 2.5688 — both byte-identical to the recorded values — so `anchor_m_tokens`
  // stays 7,000,000 (raw 7,101,402, 1.4% drift, absorbed by one significant figure) and
  // HEURISTIC_VERSION is NOT bumped: a refreshed snapshot is not a new heuristic.
  //
  // Refreshed 2026-08-11 (ADR-0189 Amendment 2). Run-1 closed, its ledger row landed, and the
  // EPIC-30 autopilot-track sidecar was emitted — so the DIVISOR's population grew from 102/260
  // to 109/280 and the guard Amendment 1 built said so, exactly as designed. ANCHOR_M is
  // unchanged at 7,000,000: the raw division moved 7,047,166 → 7,101,402, 1.4% of drift, which
  // one significant figure absorbs.
  //
  // Refreshed 2026-08-10 after the E29-CHAT-05 close appended row 40 (review MAJOR-1: the phase's
  // own close-out falsified three of these four numbers and the suite stayed green). The drift
  // guard now re-measures rows, intervals AND the median against the live ledger, so a snapshot
  // this stale fails loudly instead of being quoted into every future basis line.
  snapshot_date: '2026-09-01',
  ledger: '_00-Project-Management/41-Reports/usage/usage-log.jsonl',
  rows: 74,
  intervals: 73,
  median_chat_interval_tokens: 21173428,
  stories_per_chat_mean: 2.6,
  stories_per_chat_source: '130 chats / 338 stories across the EXECUTION-STRATEGY-*.json sidecars',
  /** median_chat_interval_tokens / stories_per_chat_mean, rounded to one significant figure. */
  anchor_m_tokens: 8000000,
  refresh_command: 'node _00-Project-Management/93-Scripts/usage-estimate.js --refresh-anchors',
});

/** The stated judgement half. Doubling per band; XL is not here because DoR splits an XL. */
const BAND_RATIO = Object.freeze({ XS: 0.25, S: 0.5, M: 1, L: 2 });

/** The unmeasured half, held at 1.00 until per-type actuals exist. See the header. */
const TYPE_MULTIPLIER = Object.freeze({
  frontend: 1, backend: 1, infra: 1, data: 1, docs: 1, 'tech-debt': 1,
});

/** The default for a discipline this table has never heard of. Neutral, and it is recorded in
 *  the basis line so the reader can see that no adjustment was made. */
const DEFAULT_TYPE_MULTIPLIER = 1;

/**
 * The date this producer became the rule. Stories created ON OR AFTER it must carry an
 * estimate; the ~300 that predate it are exempt, because an estimate written for finished work
 * is a measurement wearing an estimate's clothes. Same activation-date pattern as R25/R27.
 */
const ACTIVATION_DATE = '2026-08-10';

/** Round to one significant figure below 10M, two above — enough to be useful, not enough to
 *  pretend. 7,129,681 → 7,000,000; 14,259,362 → 14,000,000. */
function roundEstimate(n) {
  if (!Number.isFinite(n) || n <= 0) return null;
  const magnitude = Math.pow(10, Math.floor(Math.log10(n)));
  const step = n >= 1e7 ? magnitude / 10 : magnitude;
  const rounded = Math.round(n / step) * step;
  return Math.max(1, Math.round(rounded));
}

/**
 * The derivation. Returns `{ value, basis, factors }` — or `{ value: null, why }` when the band
 * is one this heuristic has no ratio for, which is the honest answer for `XL` (split it) and
 * for a missing band (a DoR gap the caller must report, not paper over).
 *
 * @param {object} input `{ estimate: 'XS'|'S'|'M'|'L', type_of_work: string }`
 */
function derive(input, opts) {
  const band = String((input && input.estimate) || '').trim().toUpperCase();
  const type = String((input && input.type_of_work) || '').trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(BAND_RATIO, band)) {
    return {
      value: null,
      why: band === 'XL'
        ? 'estimate band XL — split the story before estimating it (SOP §6 DoR); no ratio is defined for XL on purpose'
        : `estimate band '${input && input.estimate}' is not one of XS/S/M/L — set the band first (DoR gap)`,
    };
  }
  const ratio = BAND_RATIO[band];
  const known = Object.prototype.hasOwnProperty.call(TYPE_MULTIPLIER, type);
  const multiplier = known ? TYPE_MULTIPLIER[type] : DEFAULT_TYPE_MULTIPLIER;
  // MAJOR-1 (review of E29-CHAT-05) — MEASURE NOW WHERE A LEDGER IS AVAILABLE. `measured` is a
  // fresh `recomputeAnchors()` result; when present its anchor and its provenance are used, so a
  // basis line records what the ledger said WHEN THE ESTIMATE WAS WRITTEN rather than restating a
  // frozen snapshot that had already drifted before the producer was used once.
  const measured = (opts && opts.measured && opts.measured.ok) ? opts.measured : null;
  const anchor = measured ? measured.anchor_m_tokens : ANCHORS.anchor_m_tokens;
  const raw = anchor * ratio * multiplier;
  const value = roundEstimate(raw);
  const factors = { anchor, band, ratio, type: type || '(unset)', multiplier, known };
  return { value, basis: basisLine(value, factors, measured), factors, measured: !!measured };
}

/**
 * The one-line basis the story must carry. It names every factor and the provenance of the
 * anchor, so a variance a year from now is interpretable rather than mysterious — which is the
 * entire reason an estimate without a basis is worth less than no estimate.
 *
 * MAJOR-1 — the provenance is the FRESH measurement when one was taken (`measured as of <date>,
 * n=<intervals>`), and the recorded snapshot only when no ledger was readable. The old form
 * stamped `snapshot 2026-08-10, n=38` into every story the producer would ever fill, over a
 * ledger that already had 39 intervals: a claim about the data that was false on the day it was
 * written, repeated forever.
 */
function basisLine(value, f, measured) {
  const provenance = measured
    ? `median chat-interval delta ${fmt(measured.median_chat_interval_tokens)} / `
      + `${measured.stories_per_chat_mean} stories per chat, measured as of ${todayIso()}, `
      + `n=${measured.intervals} over ${measured.rows} chat rows`
    : `median chat-interval delta ${fmt(ANCHORS.median_chat_interval_tokens)} / `
      + `${ANCHORS.stories_per_chat_mean} stories per chat, recorded snapshot `
      + `${ANCHORS.snapshot_date}, n=${ANCHORS.intervals} (no ledger readable at fill time)`;
  return `**Usage estimate basis:** ${fmt(value)} tokens = anchor ${fmt(f.anchor)} `
    + `(${provenance}) × band ${f.band} ${f.ratio} `
    + `× type_of_work ${f.type} ${f.multiplier.toFixed(2)}`
    + `${f.known ? '' : ' (unlisted discipline — neutral factor applied)'} `
    + `· heuristic v${HEURISTIC_VERSION}, see \`90-Standards/USAGE-ESTIMATE-HEURISTIC.md\`.`;
}

/** Local calendar date, no ICU. The basis line records WHEN the measurement was taken. */
function todayIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

// ---------------------------------------------------------------------------
// Fill-if-missing
// ---------------------------------------------------------------------------

/**
 * A frontmatter value, comment-stripped and unquoted, or null when the key is absent.
 *
 * The trailing-comment strip is not defensive programming: `91-Templates/STORY.template.md`
 * carries `usage_estimate: ''               # optional: approximate TOTAL tokens …`, and a story
 * written straight from the template still has it. Without the strip, that line reads as a
 * POPULATED estimate and the producer politely declines to fill the one file it most needs to.
 * A `usage_estimate` never legitimately contains `#`.
 */
function readField(text, key) {
  const m = new RegExp('^' + key + ':[ \\t]*(.*)$', 'm').exec(String(text || ''));
  if (!m) return null;
  const withoutComment = m[1].split('#')[0];
  return withoutComment.trim().replace(/^['"]|['"]$/g, '').trim();
}

/** The estimate field as written. Deliberately NOT parsed into a number: "is there something
 *  here" is the question, and `''` is an answer. */
function readEstimateField(text) {
  return readField(text, 'usage_estimate');
}

/** R23's shape rule, asked of a raw field value. Kept here so `fillIfMissing` and `checkCorpus`
 *  ask the SAME question of the same value — MINOR-2 was the two of them disagreeing. */
function parsePositiveIntLike(value) {
  return /^[1-9]\d*$/.test(String(value === null || value === undefined ? '' : value).trim());
}

/**
 * FILL IF MISSING, NEVER OVERWRITE — the `outcome:` producer's contract (ADR-0059 / ADR-0105
 * lineage), applied to a second field.
 *
 * A populated estimate comes back with `changed: false` and the text BYTE-IDENTICAL. Not
 * "equivalent", not "re-serialised": identical, because a producer that rewrites what it did
 * not need to touch is a producer nobody can safely run twice.
 *
 * The file's own newline is honoured (BUG-20260804-41's lesson): a CRLF story stays CRLF.
 *
 * @returns {{changed: boolean, text: string, value: number|null, basis: string|null, why: string|null}}
 */
function fillIfMissing(text, opts) {
  const options = opts || {};
  const original = String(text === undefined || text === null ? '' : text);
  const existing = readEstimateField(original);

  if (existing === null) {
    return { changed: false, text: original, value: null, basis: null,
      why: 'no `usage_estimate:` key in the frontmatter — this is not a story file, or its frontmatter predates the field' };
  }
  if (existing !== '') {
    // PRESERVED VERBATIM. The value is the author's, whatever this heuristic would have said.
    //
    // MINOR-2 (review of E29-CHAT-05) — a value that R23 REJECTS (`0`, `1.5`, `-5`, `abc`) is
    // still the author's, so it is still not overwritten; what was wrong was the message. It
    // said "preserved", `--check` said "offender", and neither told the operator that the only
    // exit is a hand edit. The producer now names the disagreement it is leaving behind.
    const valid = parsePositiveIntLike(existing);
    return { changed: false, text: original, value: null, basis: null,
      why: valid
        ? `usage_estimate already populated ('${existing}') — preserved verbatim, never overwritten`
        : `usage_estimate is populated with '${existing}', which R23 rejects (a single positive `
          + 'integer is required). The producer never overwrites a human value, so this cannot be '
          + 'fixed by re-running it: clear the field to refill it, or correct the number by hand' };
  }

  const band = options.estimate !== undefined ? options.estimate : readField(original, 'estimate');
  const type = options.type_of_work !== undefined ? options.type_of_work : readField(original, 'type_of_work');
  // MAJOR-1 — the caller passes a fresh measurement when it has one, and the basis line records
  // it. Absent one, `derive` falls back to the recorded snapshot AND says so in the basis.
  const derived = derive({ estimate: band, type_of_work: type }, { measured: options.measured });
  if (derived.value === null) {
    return { changed: false, text: original, value: null, basis: null, why: derived.why };
  }

  const eol = original.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
  // Three empty spellings are fillable, and only these three: bare, explicitly-empty-string, and
  // either of those followed by the template's inline comment. Anything else is left alone —
  // a producer that guesses at an unfamiliar line shape is a producer that corrupts frontmatter.
  const next = original.replace(/^usage_estimate:[ \t]*(?:''|"")?[ \t]*(?:#.*)?$/m,
    `usage_estimate: ${derived.value}`);
  if (next === original) {
    return { changed: false, text: original, value: null, basis: null,
      why: 'the `usage_estimate:` line did not match a fillable empty shape — left untouched' };
  }

  // The basis goes in the technical notes, where a reader looking at the story's design finds
  // it. Appended to the section rather than inserted at a fixed offset, so a story with extra
  // bullets keeps them.
  const withBasis = appendTechnicalNote(next, '- ' + derived.basis, eol);
  return { changed: true, text: withBasis, value: derived.value, basis: derived.basis, why: null };
}

/**
 * Append one bullet to `## Technical notes`, before the next `## ` heading. Returns the text
 * unchanged (plus the note at the end) when the story carries no such section — a missing
 * heading is not a reason to lose the basis.
 */
function appendTechnicalNote(text, note, eol) {
  const lines = String(text).split(/\r?\n/);
  const start = lines.findIndex(l => /^##\s+Technical notes\s*$/.test(l));
  if (start === -1) return text.replace(/\s*$/, '') + eol + eol + note + eol;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) { end = i; break; }
  }
  let insertAt = end;
  while (insertAt > start + 1 && lines[insertAt - 1].trim() === '') insertAt -= 1;
  lines.splice(insertAt, 0, note);
  return lines.join(eol);
}

// ---------------------------------------------------------------------------
// Activation-date enforcement
// ---------------------------------------------------------------------------

function isStoryFrontmatter(text) {
  return /^type:\s*story\s*$/m.test(String(text || ''));
}

/** The mandatory basis line, as the producer writes it. One spelling, checked by `checkCorpus`
 *  and written by `basisLine()` — MINOR-3. */
const BASIS_RE = /\*\*Usage estimate basis:\*\*/;

/**
 * Every story created ON OR AFTER `ACTIVATION_DATE` must carry a positive integer estimate.
 * Returns `{ checked, exempt, offenders: [{file, id, created_at, value}] }` — `checked` is the
 * post-activation population, and a caller that cannot see it cannot tell a real pass from a
 * vacuous one.
 */
function checkCorpus(storiesDir, opts) {
  const activation = (opts && opts.activationDate) || ACTIVATION_DATE;
  const out = { checked: 0, exempt: 0, offenders: [], activation };
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.endsWith('.md')) inspect(full);
    }
  };
  const inspect = (file) => {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
    if (!isStoryFrontmatter(text)) return;
    const created = readField(text, 'created_at') || '';
    const day = created.slice(0, 10);
    if (!day || day < activation) { out.exempt += 1; return; }
    out.checked += 1;
    const value = readEstimateField(text);
    const id = readField(text, 'id');
    if (!parsePositiveIntLike(value)) {
      out.offenders.push({
        file, id, created_at: created, value, reason: 'no usage_estimate',
        // MINOR-2 — the producer will NOT close a populated-but-invalid value (it never
        // overwrites a human number), so the message says which of the two exits applies.
        fix: (value === null || value === '')
          ? 'run `usage-estimate.js --story <path>` to fill it'
          : `the value '${value}' is populated but fails R23 — the producer will not overwrite it; `
            + 'clear the field to refill it, or correct the number by hand',
      });
      return;
    }
    // MINOR-3 — THE BASIS LINE, ENFORCED. The standard calls it mandatory and nothing checked
    // it: the producer always writes one, so the rule held for produced numbers and was unenforced
    // for exactly the case the document warns about — a hand-typed estimate a year later, whose
    // variance nobody can interpret.
    if (!BASIS_RE.test(text)) {
      out.offenders.push({
        file, id, created_at: created, value, reason: 'no basis line',
        fix: 'add the one-line basis to `## Technical notes` (the producer writes it; a '
          + 'hand-written estimate must state its own basis — see 90-Standards/USAGE-ESTIMATE-HEURISTIC.md)',
      });
    }
  };
  walk(storiesDir);
  return out;
}

// ---------------------------------------------------------------------------
// Anchor refresh
// ---------------------------------------------------------------------------

/**
 * Recompute the measured half from a usage ledger. Same arithmetic the header documents, run
 * against whatever ledger it is handed — which is what makes the snapshot above a claim that
 * can be checked rather than a number to be trusted.
 *
 * `storiesPerChat` is not derivable from the ledger (it lives in the strategy sidecars), so it
 * is an input with the recorded value as its default; the caller states what it used.
 */
function recomputeAnchors(records, opts) {
  const options = opts || {};
  // MINOR-5 (review of E29-CHAT-05) — the divisor is HALF the anchor and was never re-measured:
  // `--refresh-anchors` recomputed the median delta and carried `2.55` through unchanged, while
  // the document said "it re-measures the live ledger". Handed a sidecar directory, it now
  // measures the divisor too, and reports which of the two it did.
  const measuredDivisor = options.sidecarDir ? measureStoriesPerChat(options.sidecarDir) : null;
  const storiesPerChat = options.storiesPerChat
    || (measuredDivisor && measuredDivisor.ok ? measuredDivisor.mean : ANCHORS.stories_per_chat_mean);
  const sum = (t) => (Number(t && t.input) || 0) + (Number(t && t.output) || 0)
    + (Number(t && t.cache_read) || 0) + (Number(t && t.cache_creation) || 0);
  const chats = (records || []).filter(r => r && r.kind === 'chat');
  if (chats.length < 2) {
    return { ok: false, why: `a ledger with ${chats.length} chat record(s) has no interval to measure` };
  }
  const totals = chats.map(r => sum(r.tokens));
  const deltas = [];
  for (let i = 1; i < totals.length; i++) deltas.push(totals[i] - totals[i - 1]);
  const sorted = [...deltas].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const perStory = median / storiesPerChat;
  return {
    ok: true,
    rows: chats.length,
    intervals: deltas.length,
    median_chat_interval_tokens: median,
    stories_per_chat_mean: storiesPerChat,
    stories_per_chat_measured: !!(measuredDivisor && measuredDivisor.ok),
    stories_per_chat_source: (measuredDivisor && measuredDivisor.ok)
      ? `${measuredDivisor.chats} chats / ${measuredDivisor.stories} stories across the `
        + 'EXECUTION-STRATEGY-*.json sidecars'
      : ANCHORS.stories_per_chat_source,
    anchor_m_raw: perStory,
    anchor_m_tokens: roundEstimate(perStory),
  };
}

/**
 * The divisor, measured: mean stories per planned chat across the execution-strategy sidecars.
 * Walks recursively, because the sidecars moved once already (STORY-27.3.02) and a flat read
 * would answer "0 chats" for a corpus that has hundreds.
 *
 * @param {string} dir a directory holding `EXECUTION-STRATEGY-*.json` (searched recursively)
 */
function measureStoriesPerChat(dir) {
  let chats = 0;
  let stories = 0;
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/^EXECUTION-STRATEGY-.*\.json$/.test(e.name)) continue;
      let data;
      try { data = JSON.parse(fs.readFileSync(full, 'utf8')); } catch { continue; }
      for (const phase of (Array.isArray(data && data.phases) ? data.phases : [])) {
        for (const chat of (Array.isArray(phase && phase.chats) ? phase.chats : [])) {
          chats += 1;
          stories += Array.isArray(chat && chat.stories) ? chat.stories.length : 0;
        }
      }
    }
  };
  walk(dir);
  if (chats === 0) return { ok: false, why: `no sidecar chats found under ${dir}` };
  return { ok: true, chats, stories, mean: Number((stories / chats).toFixed(4)) };
}

/** How far the recorded snapshot is from a fresh measurement, as a fraction. The tolerance the
 *  testplan asserts against lives with the test, not here — this returns the number. */
function anchorDrift(fresh) {
  if (!fresh || !fresh.ok || !fresh.anchor_m_raw) return null;
  return Math.abs(ANCHORS.anchor_m_tokens - fresh.anchor_m_raw) / fresh.anchor_m_raw;
}

module.exports = {
  HEURISTIC_VERSION, ANCHORS, BAND_RATIO, TYPE_MULTIPLIER, DEFAULT_TYPE_MULTIPLIER,
  ACTIVATION_DATE,
  derive, basisLine, roundEstimate, fmt,
  readEstimateField, readField, parsePositiveIntLike, fillIfMissing, appendTechnicalNote,
  todayIso,
  checkCorpus, isStoryFrontmatter, BASIS_RE,
  recomputeAnchors, anchorDrift, measureStoriesPerChat,
};
