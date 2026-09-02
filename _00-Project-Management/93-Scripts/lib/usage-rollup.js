'use strict';
/**
 * lib/usage-rollup.js — THE usage rollup. One implementation, every surface.
 * STORY-29.3.01 / BUG-20260805-01 (and its sibling BUG-20260801-11).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *
 * The ledger had two consumers and they gave the operator two different answers to one
 * question. `generate-dashboard.js` was taught about `kind:"chat"` records by STORY-25.4.01
 * (ADR-0124: counted, not attributed) and reported 31 of them. `generate-monitor.js` kept the
 * story-kind-only path it was born with, so MONITOR.md's usage block asserted
 *
 *     "no usage actuals recorded yet"
 *
 * over a ledger holding 31 records. That is the one-of-a-pair defect this run has now paid for
 * three times: a fix applied to one call site and not its sibling is not a fix.
 *
 * The convergence is the fix. The rollup lives HERE, both generators call it, and the numbers
 * on the two boards cannot disagree because there is only one place they are computed.
 *
 * ---------------------------------------------------------------------------
 * THE HONESTY RULES THIS MODULE ENFORCES (they predate it; it inherits them)
 *
 *  1. ABSENT DATA RENDERS AS ABSENT, NEVER AS A FABRICATED ZERO. An epic/feature entry is
 *     created only when a story CONTRIBUTES an estimate or an actual (`> 0`, not `!== null` —
 *     BUG-20260802-02). `totalTokens` is null, never 0, when nothing contributed.
 *  2. A COUNT AND A FIGURE ARE DIFFERENT CLAIMS. "31 records exist" is always honest to state;
 *     "they cost N tokens" is only stated when something contributed N.
 *  3. A CHAT RECORD IS COUNTED AND ATTRIBUTED TO NOTHING (ADR-0124). A chat id repeats across
 *     sidecars and a chat may span epics, so attributing one to an epic would be a guess
 *     dressed as a measurement. Since STORY-29.1.03 the rows carry a join key, so they can be
 *     COUNTED AS CHATS — which is a different question from which epic owns them, and that
 *     question is still not answered here.
 *  4. THREE STATES, NEVER TWO. "nothing on disk", "records on disk but none attributable" and
 *     "attributable records" are distinguishable in the payload, because a surface that
 *     conflates the first two is exactly how BUG-20260805-01 happened.
 *
 * ---------------------------------------------------------------------------
 * WHAT MOVED, AND WHAT DID NOT
 *
 * The tolerant ledger primitives (`readUsageLog`, `sumTokens`, the three totals maps,
 * `parsePositiveInt`) moved here from `usage-reconcile.js` and are RE-EXPORTED from their old
 * home, so every existing importer keeps working unchanged. Nothing was re-implemented; the
 * rollup body is STORY-25.4.01's, moved verbatim except where a comment names a change.
 *
 * Node stdlib only, consistent with every other `93-Scripts/` module.
 */

const fs = require('fs');
const path = require('path');
// STORY-29.1.03 / ADR-0179 — the ONE join-key helper. The rollup READS the key; it never
// derives a second spelling of one.
const ledgerJoin = require('./ledger-join.js');
// The retro ledger's OWN tolerant reader, used ONLY for join-key anchors (it carries the
// `phase` that turns a bare `CHAT-04` into `E25-CHAT-04`). NOT `readUsageLog`: that one
// requires a `tokens` block and would drop every retro record as a shape skip, which looks
// exactly like an empty ledger and is wrong.
const retroReport = require('../retro-report.js');

// ---------------------------------------------------------------------------
// Ledger primitives (moved from usage-reconcile.js — that file re-exports them)
// ---------------------------------------------------------------------------

/**
 * Returns { found, records, skipped }. `found` is false only when the file does not exist at
 * all — the "no actuals recorded yet" case. An existing-but-empty/malformed file is tolerated
 * the way usage-capture.js tolerates malformed transcript lines: bad lines are skipped, never
 * thrown.
 *
 * STORY-25.4.01 AC-5 — the skip is COUNTED, not merely silent. Two categories, kept apart
 * because they mean different things to a reader: `malformed` is a line that is not JSON at
 * all (a truncated append, a half-flushed write), `shape` is valid JSON that does not carry
 * the { id, tokens } contract (a record from a future/foreign writer).
 */
function readUsageLog(logPath) {
  const emptySkipped = { malformed: 0, shape: 0, total: 0 };
  if (!logPath || !fs.existsSync(logPath)) {
    return { found: false, records: [], skipped: Object.assign({}, emptySkipped) };
  }
  let content;
  try {
    content = fs.readFileSync(logPath, 'utf8');
  } catch {
    return { found: false, records: [], skipped: Object.assign({}, emptySkipped) };
  }
  const records = [];
  const skipped = Object.assign({}, emptySkipped);
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj;
    try { obj = JSON.parse(trimmed); } catch { skipped.malformed += 1; continue; }
    if (obj && typeof obj === 'object' && obj.id && obj.tokens) records.push(obj);
    else skipped.shape += 1;
  }
  skipped.total = skipped.malformed + skipped.shape;
  return { found: true, records, skipped };
}

/** The ledger's token contract: four counters, summed. A missing counter is 0, never NaN. */
function sumTokens(tokens) {
  if (!tokens || typeof tokens !== 'object') return 0;
  return (Number(tokens.input) || 0) + (Number(tokens.output) || 0) +
    (Number(tokens.cache_read) || 0) + (Number(tokens.cache_creation) || 0);
}

/** Map<storyId, totalTokens> over `story`-kind records. A story may be captured across more
 *  than one session, so this is total spend so far, not a single sample. */
function actualTotalsByStoryId(records) {
  const totals = new Map();
  for (const r of (records || [])) {
    if (!r || r.kind !== 'story') continue;
    totals.set(r.id, (totals.get(r.id) || 0) + sumTokens(r.tokens));
  }
  return totals;
}

/**
 * Map<chatId, totalTokens> over `chat`-kind records, KEYED BY THE ID AS WRITTEN, deliberately.
 * `--chat CHAT-01` is what an operator types, and this map answers "what did the thing I just
 * named cost". It is NOT the join — see `actualTotalsByChatKey()` — and BACKLOG-0144 is why
 * the two are different questions: `CHAT-01` names five different chats on this ledger.
 */
function actualTotalsByChatId(records) {
  const totals = new Map();
  for (const r of (records || [])) {
    if (!r || r.kind !== 'chat') continue;
    totals.set(r.id, (totals.get(r.id) || 0) + sumTokens(r.tokens));
  }
  return totals;
}

/**
 * The SAME chat totals, keyed by the join key (STORY-29.1.03), through `lib/ledger-join.js`.
 *
 * `unkeyed` is returned beside the map rather than folded into it. A row whose chat cannot be
 * named is not a row worth zero — it is a row this rollup declines to attribute, and a caller
 * that cannot see the count would render a total that silently omits it.
 */
function actualTotalsByChatKey(records, otherRecords) {
  const totals = new Map();
  const unkeyed = [];
  const ambiguous = [];
  const chats = (records || []).filter(r => r && r.kind === 'chat');
  const anchors = ledgerJoin.buildAnchors([chats, otherRecords || []]);
  for (const r of chats) {
    const resolved = ledgerJoin.resolve(r, anchors);
    if (resolved.key === null) {
      (resolved.status === 'ambiguous' ? ambiguous : unkeyed)
        .push({ id: r.id, ts: r.ts, candidates: resolved.candidates, why: resolved.why });
      continue;
    }
    totals.set(resolved.key, (totals.get(resolved.key) || 0) + sumTokens(r.tokens));
  }
  return { totals, unkeyed, ambiguous };
}

/**
 * Positive-integer parse mirroring validate-frontmatter.js's R23 shape rule. An invalid
 * `usage_estimate` (0, negative, non-numeric, decimal) is treated as ABSENT: R23 already flags
 * the shape problem at lint time, and a reporting surface must neither crash on it nor coerce
 * it into a fabricated number.
 */
function parsePositiveInt(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  if (!/^[1-9]\d*$/.test(str)) return null;
  return Number(str);
}

// ---------------------------------------------------------------------------
// The rollup
// ---------------------------------------------------------------------------

/**
 * The retro ledger that sits beside a usage ledger. DERIVED FROM THE USAGE LOG PATH, never
 * from a module constant: a fixture usage ledger must reach its OWN sibling retro ledger, and
 * a temp-dir fixture with no sibling must reach nothing at all. A default pinned to the host's
 * reports folder would make every rollup test read this repository's live ledger.
 */
function siblingRetroLogPath(logPath) {
  if (!logPath) return null;
  return path.join(path.dirname(path.dirname(logPath)), 'retro', 'retro-log.jsonl');
}

/**
 * Normalise one story record from whatever the calling surface holds into the three fields the
 * rollup reads. The dashboard hands over its `pm.story` objects (flat, `usage_estimate` already
 * numeric); generate-monitor.js hands over parsed frontmatter (`usage_estimate` a raw string).
 * ONE normalisation for both — which is also why a numeric string now counts on the dashboard,
 * where the old `typeof === 'number'` guard silently ignored it.
 */
function normaliseStory(s) {
  if (!s || typeof s !== 'object') return null;
  const fm = (s.fm && typeof s.fm === 'object') ? s.fm : s;
  return {
    id: fm.id || null,
    epic: fm.epic || null,
    feature: fm.feature || null,
    usage_estimate: parsePositiveInt(fm.usage_estimate),
  };
}

/**
 * THE ROLLUP.
 *
 * @param {object[]} storyRecords  the corpus's stories, in either supported shape
 * @param {object}   [opts]
 * @param {string}   [opts.logPath]      the usage ledger (required in practice; a surface
 *                                       passes its OWN resolved path so PM_DASH_ROOT /
 *                                       PM_MONITOR_ROOT / PM_USAGE_LOG all keep working)
 * @param {string}   [opts.retroLogPath] override for the sibling retro ledger
 * @param {object[]} [opts.retroRecords] pre-read retro records (skips the sibling read)
 * @returns {object} the payload every surface renders from
 */
function buildUsageRollup(storyRecords, opts) {
  const options = opts || {};
  const logPath = options.logPath || null;
  const { found, records, skipped } = readUsageLog(logPath);

  const retroRecords = Array.isArray(options.retroRecords)
    ? options.retroRecords
    : retroReport.readLedger(options.retroLogPath || siblingRetroLogPath(logPath), null).records;

  const actualsByStoryId = actualTotalsByStoryId(records);

  const byEpic = new Map();
  const byFeature = new Map();
  function bump(map, key) {
    if (!map.has(key)) map.set(key, { estimateSum: 0, estimateCount: 0, actualSum: 0, actualCount: 0 });
    return map.get(key);
  }

  // BUG-20260802-02 — CONTRIBUTES, not EXISTS. The original guard was `!== null`, which is true
  // for 0: a ledger record whose tokens all read zero entered the totals map, `.has(id)` was
  // true, `actual` was 0, and a fabricated `actual: 0` row was written — precisely the row rule
  // 1 forbids. Both arms are guarded; a `usage_estimate: 0` fabricated the same way.
  const contributingActualIds = new Set();
  for (const raw of (storyRecords || [])) {
    const s = normaliseStory(raw);
    if (!s) continue;
    const epicId = s.epic || '(no epic)';
    const featureId = s.feature || '(no feature)';
    const rawActual = s.id && actualsByStoryId.has(s.id) ? actualsByStoryId.get(s.id) : null;
    const estimate = (s.usage_estimate !== null && s.usage_estimate > 0) ? s.usage_estimate : null;
    const actual = (rawActual !== null && rawActual > 0) ? rawActual : null;

    if (estimate !== null) {
      const e = bump(byEpic, epicId); e.estimateSum += estimate; e.estimateCount += 1;
      const f = bump(byFeature, featureId); f.estimateSum += estimate; f.estimateCount += 1;
    }
    if (actual !== null) {
      contributingActualIds.add(s.id);
      const e = bump(byEpic, epicId); e.actualSum += actual; e.actualCount += 1;
      const f = bump(byFeature, featureId); f.actualSum += actual; f.actualCount += 1;
    }
  }

  const chatTotals = actualTotalsByChatId(records);
  const chatRecords = records.filter(r => r.kind === 'chat');
  // Neither a story bracket nor a chat bracket — a future or foreign writer's row. Counted AND
  // its tokens named, because a row whose tokens are in no figure is a gap a reader can only
  // find by subtracting censuses (MAJOR-2).
  const otherRecords = records.filter(r => r.kind !== 'chat' && r.kind !== 'story');
  const contributing = chatRecords.filter(r => sumTokens(r.tokens) > 0);
  let chatSum = 0;
  for (const v of chatTotals.values()) chatSum += v;
  const chatKeys = actualTotalsByChatKey(records, retroRecords);
  // BUG-20260810-11 — the cumulative reading, computed once and rendered by every surface.
  const cumulative = detectCumulative(chatRecords);

  // The two censuses are BOTH reported and they disagree on purpose: `idCount` counts the ids
  // as written (15 on the live ledger, because `CHAT-01` was written five times for five
  // different chats), `keyCount` counts the chats those rows can actually be resolved to. The
  // gap IS the BACKLOG-0144 finding, made visible on the board instead of argued in a comment.
  const chat = chatRecords.length ? {
    recordCount: chatRecords.length,
    contributingCount: contributing.length,
    idCount: chatTotals.size,
    ids: [...chatTotals.keys()].sort(),
    keyCount: chatKeys.totals.size,
    keys: [...chatKeys.totals.keys()].sort(),
    /*
      THE SAME KEYS, WITH THEIR TOTALS (STORY-34.1.03 · ADR-0284).

      `keys` already published WHICH chats the ledger can name; a surface that wants to state
      what one of them cost had no way to ask. Build · Phases does — its chat telemetry states
      an estimate and an actual per chat — and the alternative was for the view to re-derive
      the join in the browser off the raw ledger, which is a second implementation of
      `ledger-join.js` in a place no test drives.

      KEYED BY THE JOIN KEY, NEVER BY THE BARE ID. `E33-CHAT-01` is a chat; `CHAT-01` is five
      of them (BACKLOG-0144), and `chatTotals` above is deliberately the other question. A
      consumer that cannot find its key gets NOTHING back, which is the honest answer — the
      row exists or it does not, and there is no partial credit to fabricate.
    */
    keyTotals: Object.fromEntries([...chatKeys.totals.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))),
    unkeyedCount: chatKeys.unkeyed.length,
    ambiguousCount: chatKeys.ambiguous.length,
    totalTokens: contributing.length ? chatSum : null, // never a fabricated 0
    // BUG-20260810-11 — WHAT THE FIGURE IS, carried beside the figure. `totalTokens` is a SUM OF
    // BRACKETS and always was; the phase that first rendered it on MONITOR printed it as though
    // it were spend. A surface cannot restate the number innocently while this field sits next
    // to it, and `figures()` carries both into the cross-surface comparison.
    totalTokensIsSumOfBrackets: true,
    cumulative,
    // Null unless something IS cumulative. A "bound" equal to the sum adds no information and
    // invites a reader to treat the sum as verified — the same shape of misreading this whole
    // disclosure exists to stop. `attributeUsage()` applies the identical rule.
    distinctSpendUpperBound: (contributing.length && cumulative.detected) ? cumulative.upperBound : null,
    attributedToEpic: 0,
    reason: 'chat ids repeat across the execution-strategy sidecars and a chat may span epics, '
      + 'so a chat record cannot be attributed to one epic (ADR-0124). Since STORY-29.1.03 the '
      + 'rows carry a join key, so they can be counted as chats — attribution to an epic is a '
      + 'separate question and is still not answered here.',
  } : null;

  // The caveat is COMPOSED HERE, once, and carried in the payload — so the dashboard's client JS
  // and MONITOR's markdown both PRINT it rather than each writing their own version of what the
  // number means. A figure and its meaning travel together or they drift apart (BUG-20260810-11).
  if (chat) chat.cumulativeNote = cumulativeNote(chat);

  function toPayload(map) {
    const out = {};
    for (const [key, r] of map) {
      out[key] = {
        estimated: r.estimateCount > 0 ? r.estimateSum : null,
        actual: r.actualCount > 0 ? r.actualSum : null,
        coverage: { storiesWithEstimate: r.estimateCount, storiesWithActual: r.actualCount },
      };
    }
    return out;
  }

  return {
    // "a record exists for some story" is not "a story has an actual" (BUG-20260802-02).
    hasAnyActual: contributingActualIds.size > 0,
    // The ledger census. `recordCount` is what a surface needs in order to refuse to claim an
    // absence: "0 attributable rows" and "0 records on disk" are different facts.
    ledger: {
      found,
      recordCount: records.length,
      storyRecordCount: records.filter(r => r.kind === 'story').length,
      chatRecordCount: chatRecords.length,
      // MAJOR-2 / review of E29-CHAT-05 — THE UNACCOUNTED ROWS. `attributeUsage()` itemises a
      // record that belongs to no bucket "rather than quietly widen a bucket to swallow it";
      // this reader — the one both boards render — counted such a row in `recordCount` and then
      // dropped its TOKENS from every figure, with nothing on either surface saying a gap
      // existed. The same discipline, in the other half of the module.
      otherRecordCount: otherRecords.length,
      otherTokens: otherRecords.reduce((a, r) => a + sumTokens(r.tokens), 0),
      otherKinds: [...new Set(otherRecords.map(r => (r.kind === undefined || r.kind === null || r.kind === '') ? '(none)' : String(r.kind)))].sort(),
      skipped: skipped || { malformed: 0, shape: 0, total: 0 },
    },
    chat,
    byEpic: toPayload(byEpic),
    byFeature: toPayload(byFeature),
  };
}

/**
 * THE CUMULATIVE READING (BUG-20260810-11 / ADR-0190 amendment 1).
 *
 * A `--chat` capture sums the WHOLE session transcript directory, so consecutive captures of the
 * same directory are RE-SUMS: row n contains row n−1. Summing them counts the same tokens over
 * and over — 40 rows on this repository's live ledger sum to 74,078,704,903 for at most
 * 2,785,764,867 of distinct spend, a factor of 26.6. The phase that put that figure on MONITOR
 * had documented the cause twice and encoded it nowhere.
 *
 * WHAT IS OBSERVABLE, AND WHAT IS INFERRED. A ledger row does not record whether its capture was
 * windowed (`--since`), so no reader can PROVE a bracket is a re-sum. Two things are observable:
 *
 *   1. `source` — the capture's scope, as the writer recorded it. Measured on the live ledger:
 *      present and non-empty on 40 of 40 chat rows, with exactly ONE distinct value. Rows sharing
 *      it were captured over the same growing directory.
 *   2. Monotonicity — within such a group, totals non-decreasing in time order. Measured: 39 of
 *      39 steps non-decreasing, and file order equals `ts` order.
 *
 * Both together are the SIGNATURE of a re-summed directory, and that is how this is reported: the
 * evidence and the reading, never a claim of certainty. A group whose totals dip somewhere is not
 * re-summed and is left alone.
 *
 * `upperBound` is the distinct-spend ceiling UNDER THAT READING: a cumulative group contributes
 * its largest row (the last re-sum contains every earlier one), a non-cumulative group contributes
 * its sum. With no cumulative group it equals the plain sum, and no surface says anything.
 *
 * @param {object[]} chatRecords the chat-kind records, in ledger order
 */
function detectCumulative(chatRecords) {
  const rows = (chatRecords || []).map(r => ({
    source: (typeof r.source === 'string' && r.source.trim() !== '') ? r.source.trim() : null,
    total: sumTokens(r.tokens),
    ts: typeof r.ts === 'string' ? r.ts : '',
    id: r.id,
    // THE WINDOW THE WRITER RECORDED (BUG-20260810-12). See below.
    since: (typeof r.since === 'string' && r.since.trim() !== '') ? r.since.trim() : null,
  }));
  const groups = new Map();
  let ungroupedSum = 0;
  for (const row of rows) {
    // A WINDOWED ROW IS NOT A RE-SUM OF THE WHOLE SOURCE, SO IT NEVER JOINS A CUMULATIVE GROUP
    // (BUG-20260810-12).
    //
    // The cumulative signature is "same `source`, totals non-decreasing in time order", and two
    // DISJOINT `--since` windows over one transcript directory produce it just as readily as one
    // capture that re-sums the whole directory twice. Read as cumulative, the ceiling becomes
    // `max(rowTotal)` — 300 for windows of 100 then 300, against a true distinct spend of 400. An
    // upper bound that understates is worse than a loose one, because the whole point of the
    // figure is that the truth is not above it.
    //
    // `usage-capture.js` now records `since` when it narrowed, so the writer's own knowledge
    // answers the question instead of a signature guessing at it. A windowed row is SUMMED, which
    // is right: disjoint windows do not double-count, so their totals add.
    //
    // ABSENT `since` KEEPS TODAY'S READING, deliberately. Every row already on disk lacks the
    // field and every one of them measured its whole source; treating absence as "windowed" would
    // rewrite the reading of the entire historical ledger to fix an edge no live row exercises
    // (ADR-0165 — old rows are records). The change is additive, with no migration.
    if (row.source === null || row.since !== null) { ungroupedSum += row.total; continue; }
    if (!groups.has(row.source)) groups.set(row.source, []);
    groups.get(row.source).push(row);
  }

  const detected = [];
  let upperBound = ungroupedSum;
  for (const [source, members] of groups) {
    const ordered = [...members].sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
    const totals = ordered.map(m => m.total);
    const sum = totals.reduce((a, b) => a + b, 0);
    const max = totals.length ? Math.max(...totals) : 0;
    let monotonic = true;
    for (let i = 1; i < totals.length; i++) if (totals[i] < totals[i - 1]) { monotonic = false; break; }
    // One bracket cannot overlap itself, and a dip proves the rows are not re-sums of one another.
    const isCumulative = ordered.length >= 2 && monotonic && max > 0;
    if (isCumulative) {
      detected.push({
        source,
        rows: ordered.length,
        firstId: ordered[0].id,
        lastId: ordered[ordered.length - 1].id,
        sum,
        max,
        inflation: max > 0 ? sum / max : null,
      });
      upperBound += max;
    } else {
      upperBound += sum;
    }
  }

  const rowsInGroups = detected.reduce((a, g) => a + g.rows, 0);
  return {
    detected: detected.length > 0,
    groups: detected,
    rowsAffected: rowsInGroups,
    upperBound,
    basis: detected.length
      ? `${rowsInGroups} chat bracket(s) in ${detected.length} group(s) share a capture `
        + '`source` and their totals are non-decreasing in time order — the signature of a '
        + 'capture that re-sums the whole transcript directory (ADR-0079), so the sum counts the '
        + 'same tokens repeatedly'
      : null,
  };
}

/** Thousands separator without locale/ICU — the stdlib-only stance every script here keeps. */
function fmtGrouped(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

/** The sentence every surface prints beside the figure when the signature is present. ONE
 *  wording, so MONITOR, the dashboard and the CLI cannot disagree about what the number is. */
function cumulativeNote(chat) {
  if (!chat || !chat.cumulative || !chat.cumulative.detected) return null;
  const c = chat.cumulative;
  const bound = c.upperBound;
  return 'this total is a SUM OF BRACKETS, not distinct spend: ' + c.basis
    + `. Distinct spend is at most ${String(bound).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} tokens `
    + 'under that reading.';
}

/**
 * THE FIGURES, FLATTENED — the contract behind "every surface shows the same numbers".
 *
 * A surface is free to choose its own words and its own layout. What it may NOT do is show a
 * DIFFERENT NUMBER, and this is the list of numbers that carries that promise. TESTPLAN-29.3.01
 * TC-04 extracts these from each surface's own output and compares them field by field, so the
 * claim is measured rather than asserted in a comment.
 *
 * Nulls stay null. `chatTotalTokens: null` means "no chat record contributed a token count",
 * and turning it into 0 here would defeat rule 1 one layer down from where it is enforced.
 */
function figures(rollup) {
  const r = rollup || {};
  const led = r.ledger || {};
  const chat = r.chat || null;
  const epics = r.byEpic || {};
  const features = r.byFeature || {};
  const sumField = (obj, field) => {
    let total = null;
    for (const k of Object.keys(obj)) {
      const v = obj[k] && obj[k][field];
      if (typeof v === 'number') total = (total || 0) + v;
    }
    return total;
  };
  return {
    ledgerRecords: Number(led.recordCount) || 0,
    storyRecords: Number(led.storyRecordCount) || 0,
    chatRecords: Number(led.chatRecordCount) || 0,
    skippedTotal: Number((led.skipped || {}).total) || 0,
    // MAJOR-2 — in the comparison, so a surface that shows the census must show these too.
    otherRecords: Number(led.otherRecordCount) || 0,
    otherTokens: Number(led.otherTokens) || 0,
    chatIdCount: chat ? chat.idCount : 0,
    chatKeyCount: chat ? chat.keyCount : 0,
    chatTotalTokens: chat ? chat.totalTokens : null,
    // BUG-20260810-11 — the figure's own meaning travels with it across surfaces.
    chatCumulativeRows: chat && chat.cumulative ? chat.cumulative.rowsAffected : 0,
    chatDistinctUpperBound: chat ? chat.distinctSpendUpperBound : null,
    epicRows: Object.keys(epics).length,
    featureRows: Object.keys(features).length,
    estimateSum: sumField(epics, 'estimated'),
    actualSum: sumField(epics, 'actual'),
  };
}

// ---------------------------------------------------------------------------
// Attribution (STORY-29.3.03 / ADR-0190)
// ---------------------------------------------------------------------------

/** The stamp `usage-capture.js --chat … --stories …` writes. One spelling, two readers. */
const UNATTRIBUTABLE = 'unattributable-to-story';

/**
 * PARTITION THE LEDGER: attributed to a story, or explicitly not.
 *
 * The rule is boundary observability, not effort. A `story`-kind record was bracketed at a
 * story boundary someone could actually see, so it attributes. A `chat`-kind record covers work
 * whose internal boundaries were not observable, so it does NOT attribute — it is stated whole,
 * with its constituent stories listed when the writer knew them.
 *
 * NOTHING IS PRORATED. Dividing a chat bracket by its story count would produce per-story
 * numbers that look measured and are not, and they would flow straight into variance figures
 * where nobody could tell them from real ones. The remainder stays a remainder.
 *
 * `leaks` is deliberately reachable. A record of some third kind belongs to neither bucket, and
 * the honest response is to report it as unaccounted rather than quietly widen a bucket to
 * swallow it — which is why `reconciles` is false when a leak exists even though the two bucket
 * sums are individually fine.
 *
 * OVERLAP, STATED. On this repository's ledger a `--chat` capture RE-SUMS the whole session
 * directory, so a chat bracket can include the very turns its stories' own brackets counted.
 * `totals.ledger` is therefore a sum of BRACKETS, not of distinct spend, and `overlap` says so
 * whenever a chat record names constituents that also carry their own story records.
 *
 * @param {object[]} records the usage ledger's records
 * @returns {object}
 */
function attributeUsage(records) {
  const all = Array.isArray(records) ? records : [];
  const attributedMap = new Map();
  const unattributable = [];
  const leaks = [];
  let ledgerTotal = 0;

  for (const r of all) {
    const tokens = sumTokens(r && r.tokens);
    ledgerTotal += tokens;
    if (r && r.kind === 'story' && typeof r.id === 'string' && r.id.trim() !== '') {
      const cur = attributedMap.get(r.id) || { storyId: r.id, tokens: 0, records: 0 };
      cur.tokens += tokens;
      cur.records += 1;
      attributedMap.set(r.id, cur);
    } else if (r && r.kind === 'chat' && typeof r.id === 'string' && r.id.trim() !== '') {
      unattributable.push({
        id: r.id,
        key: (r && typeof r.join_key === 'string' && r.join_key.trim() !== '') ? r.join_key : null,
        ts: r && r.ts ? r.ts : null,
        tokens,
        stories: Array.isArray(r && r.stories) ? r.stories.slice() : [],
        declared: r && r.attribution === UNATTRIBUTABLE,
        why: (r && r.attribution === UNATTRIBUTABLE)
          ? 'the writer declared this bracket unattributable and named its constituent stories'
          : 'a chat bracket with no constituent stories recorded — unattributable, constituents unknown',
      });
    } else {
      leaks.push({
        id: (r && r.id) || null,
        kind: (r && r.kind) || null,
        tokens,
        why: 'neither a story bracket nor a chat bracket — this record is in no bucket, and the '
          + 'arithmetic below does not account for it',
      });
    }
  }

  const attributed = [...attributedMap.values()].sort((a, b) => a.storyId.localeCompare(b.storyId));
  const attributedTotal = attributed.reduce((a, r) => a + r.tokens, 0);
  const unattributableTotal = unattributable.reduce((a, r) => a + r.tokens, 0);
  // MINOR-4 — the independent second pass. Deliberately NOT `ledgerTotal` from the bucketing
  // loop: a total computed by the same traversal that fills the buckets cannot contradict them.
  const independentLedgerTotal = all.reduce((sum, r) => sum + sumTokens(r && r.tokens), 0);

  // Which brackets overlap. Not an error: a property of ADR-0079 capture, reported so a reader
  // never reads `ledger` as "spend". TWO kinds, and the second is the one the live ledger has:
  //
  //   chat↔story — a chat bracket naming constituents that were themselves bracketed;
  //   chat↔chat  — consecutive captures of one growing transcript directory (BUG-20260810-11).
  //
  // Only the first was modelled. The live ledger holds zero story brackets, so `overlaps` was
  // empty, `overlapNote` was null, and a 26.6× inflated total printed with no caveat and the
  // word RECONCILES beside it. An overlap model that cannot fire on the production shape is a
  // disclosure that exists only in tests.
  const attributedIds = new Set(attributed.map(r => r.storyId));
  const overlaps = [];
  for (const u of unattributable) {
    const shared = u.stories.filter(id => attributedIds.has(id));
    if (shared.length) overlaps.push({ kind: 'chat-story', chat: u.key || u.id, stories: shared, tokens: u.tokens });
  }
  const cumulative = detectCumulative(all.filter(r => r && r.kind === 'chat'));
  for (const g of cumulative.groups) {
    overlaps.push({
      kind: 'chat-chat', source: g.source, rows: g.rows, sum: g.sum, max: g.max,
      inflation: g.inflation, firstId: g.firstId, lastId: g.lastId,
    });
  }

  return {
    attributed,
    unattributable,
    leaks,
    totals: {
      attributed: attributedTotal,
      unattributable: unattributableTotal,
      ledger: ledgerTotal,
      records: all.length,
    },
    // THE ARITHMETIC PIN (TESTPLAN-29.3.03 TC-03).
    //
    // MINOR-4 (review of E29-CHAT-05) — `ledgerTotal` is now accumulated by a SECOND, INDEPENDENT
    // pass over the records rather than inside the bucketing loop. The old form made the sum
    // clause unfalsifiable: one loop both bucketed and totalled, so `attributed + unattributable
    // === ledger` was implied by `leaks.length === 0` and could never fail on its own. With two
    // passes a record counted twice — or a bucket that double-adds — genuinely disagrees, which
    // is what the comment always claimed. Both halves now mean something.
    reconciles: leaks.length === 0 && (attributedTotal + unattributableTotal) === independentLedgerTotal,
    overlaps,
    // BUG-20260810-11 — the note names the kind of overlap it found, because "brackets overlap"
    // meant something different in each case and only one of them was ever reachable.
    overlapNote: overlaps.length
      ? [
        overlaps.some(o => o.kind === 'chat-story')
          ? 'brackets OVERLAP (chat over story): a chat capture re-sums the whole session, so '
            + 'these chat brackets include turns their constituent stories\' own brackets also '
            + 'counted.'
          : null,
        cumulative.detected ? 'brackets OVERLAP (chat over chat): ' + cumulative.basis + '.' : null,
        'The ledger total is a sum of brackets, not of distinct spend'
          + (cumulative.detected
            ? `; distinct spend is at most ${fmtGrouped(cumulative.upperBound)} tokens under that reading.`
            : '.'),
      ].filter(Boolean).join(' ')
      : null,
    cumulative,
    // The ceiling a reader may quote instead of the inflated sum. Null when nothing is cumulative
    // — an "upper bound" equal to the sum would be a number pretending to add information.
    distinctSpendUpperBound: cumulative.detected ? cumulative.upperBound : null,
    proration: 'none — an unattributable bracket is stated whole and itemised, never divided '
      + 'across its stories (ADR-0190)',
  };
}

/**
 * Per-story estimate-vs-actual, over the attributed side only.
 *
 * FOUR STATES, and the fourth is why this is not one line of arithmetic: both sides present
 * (a signed variance), estimate only ("no actual recorded"), actual only ("no estimate"), and
 * neither (the row does not exist). A story whose actual is unattributable does NOT get a
 * variance computed from a chat bracket — that is the proration this module refuses.
 *
 * @param {object[]} stories `{ id, usage_estimate }` in either supported shape
 * @param {object}   attribution the result of `attributeUsage()`
 */
function estimateVsActual(stories, attribution) {
  const actuals = new Map((attribution && attribution.attributed || []).map(r => [r.storyId, r.tokens]));
  const rows = [];
  const seen = new Set();
  for (const raw of (stories || [])) {
    const s = normaliseStory(raw);
    if (!s || !s.id) continue;
    seen.add(s.id);
    const estimate = (s.usage_estimate !== null && s.usage_estimate > 0) ? s.usage_estimate : null;
    const actual = actuals.has(s.id) && actuals.get(s.id) > 0 ? actuals.get(s.id) : null;
    if (estimate === null && actual === null) continue;
    rows.push(varianceRow(s.id, estimate, actual));
  }
  // A ledger can carry a story id the corpus does not (a renamed or deleted story). Reporting it
  // as "no estimate" is honest; dropping it would hide spend.
  for (const [id, tokens] of actuals) {
    if (seen.has(id) || !(tokens > 0)) continue;
    rows.push(varianceRow(id, null, tokens));
  }
  rows.sort((a, b) => a.id.localeCompare(b.id));
  return rows;
}

function varianceRow(id, estimate, actual) {
  if (estimate !== null && actual !== null) {
    const abs = actual - estimate;
    return {
      id, estimate, actual, state: 'compared',
      varianceAbs: abs,
      variancePct: estimate !== 0 ? (abs / estimate) * 100 : null,
    };
  }
  if (estimate !== null) {
    return { id, estimate, actual: null, state: 'no-actual', varianceAbs: null, variancePct: null };
  }
  return { id, estimate: null, actual, state: 'no-estimate', varianceAbs: null, variancePct: null };
}

module.exports = {
  // primitives (re-exported by usage-reconcile.js for its existing importers)
  readUsageLog,
  sumTokens,
  actualTotalsByStoryId,
  actualTotalsByChatId,
  actualTotalsByChatKey,
  parsePositiveInt,
  // the rollup
  siblingRetroLogPath,
  normaliseStory,
  buildUsageRollup,
  figures,
  // the cumulative reading (BUG-20260810-11)
  detectCumulative,
  cumulativeNote,
  fmtGrouped,
  // attribution (STORY-29.3.03 / ADR-0190)
  UNATTRIBUTABLE,
  attributeUsage,
  estimateVsActual,
  varianceRow,
};
