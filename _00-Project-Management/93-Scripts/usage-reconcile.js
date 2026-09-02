#!/usr/bin/env node
/**
 * usage-reconcile.js — estimate-vs-actual reconciliation for the usage-estimate loop
 * (STORY-21.2.02 / ADR-0079, BACKLOG-0086 Tranche B).
 *
 * Three independent surfaces in one dependency-free script:
 *
 *   1. RECONCILE (default) — reads a story's `usage_estimate:` frontmatter (the optional
 *      approximate TOTAL-token figure a story is expected to consume — STORY-21.2.02 /
 *      validate-frontmatter.js R23) alongside the ACTUAL tokens `usage-capture.js` recorded
 *      for that story id in `41-Reports/usage/usage-log.jsonl` (ADR-0079's source/unit/
 *      attribution decisions). Prints one line per story carrying either figure — estimate,
 *      actual, variance (absolute tokens + %) — plus a rollup: by FEATURE prefix by default,
 *      or by CHAT (`--chat <id>`, resolved against the `41-Reports/EXECUTION-STRATEGY-*.json`
 *      sidecars execution-strategist emits) when given.
 *
 *   2. SEED (`--seed --estimate-band <XS|S|M|L> --type <type_of_work>`) — suggests a NEW
 *      story's `usage_estimate` as the MEDIAN of actual totals across DONE stories sharing
 *      the same `estimate` band and `type_of_work` (joining usage-log ids to story files).
 *      With no matching history it prints an explicit "no history — no seed" line and NEVER
 *      fabricates a number.
 *
 *   3. PROJECT (`--project --chat <id>` or `--project --stories <id,id,...>`) — a PRE-BATCH
 *      spend projection (STORY-21.2.03 / BACKLOG-0086 Tranche D): sums `usage_estimate` over
 *      a named chat's READY stories (chat → member-story-ids resolved via the same
 *      `EXECUTION-STRATEGY-*.json` sidecar mechanism RECONCILE's `--chat` uses), or over an
 *      explicit comma-separated story-id list (the fallback when no sidecar / a manual
 *      selection is wanted — used as given, no status filter). Prints the projected spend
 *      (sum of whatever estimates exist) AND how many of the named stories lack a
 *      `usage_estimate` (coverage honesty) — never fabricates a number for a story that has
 *      none, and never silently treats a partial sum as a complete one.
 *
 * Usage:
 *   node usage-reconcile.js
 *   node usage-reconcile.js --chat CHAT-01
 *   node usage-reconcile.js --seed --estimate-band M --type data
 *   node usage-reconcile.js --project --chat CHAT-01
 *   node usage-reconcile.js --project --stories STORY-01.1.01,STORY-01.1.02
 *   node usage-reconcile.js --usage-log <path> --stories-dir <path> [--strategy-dir <path>]  # test overrides
 *   PM_USAGE_LOG=<path> node usage-reconcile.js   # same env var usage-capture.js appends to
 *
 * Exit codes:
 *   0 — reconciliation/seed/projection printed (including the graceful "no actuals recorded
 *       yet" / "no history — no seed" / "chat not found" / "no estimates" cases — a
 *       reporting tool must never fail the run it reports on)
 *   2 — usage error (bad/missing CLI args, e.g. --seed without both --estimate-band and
 *       --type, or --project without exactly one of --chat/--stories)
 *
 * Dependency-free — Node stdlib only, consistent with every other `93-Scripts/` tool.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('./lib/frontmatter');
const { loadPaths } = require('./lib/pm-paths');
// STORY-27.3.02 / ADR-0141 — the shared shape-agnostic 41-Reports reader.
const reportTree = require('./lib/report-tree.js');
// STORY-29.1.03 / ADR-0179 — the ONE join-key helper. This file is one of the three consumers
// AC-4 names; it reads the key rather than re-deriving one.
const ledgerJoin = require('./lib/ledger-join.js');
// STORY-29.3.01 / ADR-0188 — THE rollup module. The tolerant ledger primitives below used to be
// defined in this file and imported from it by both generators; they now live in one place with
// the rollup that consumes them, and are re-exported here so every existing importer of
// `usage-reconcile` keeps working unchanged.
const usageRollup = require('./lib/usage-rollup.js');
const {
  readUsageLog, sumTokens, actualTotalsByStoryId, actualTotalsByChatId, actualTotalsByChatKey,
  parsePositiveInt,
} = usageRollup;
const { DEFAULT_LOG_PATH } = require('./usage-capture');

const PM_ROOT = path.resolve(__dirname, '..');
const PATHS = loadPaths(PM_ROOT).map;
const DEFAULT_STORIES_DIR = path.join(PM_ROOT, PATHS.stories);
const DEFAULT_REPORTS_DIR = path.join(PM_ROOT, PATHS.reports);

const ESTIMATE_BANDS = new Set(['XS', 'S', 'M', 'L']);
const NO_ACTUALS_MESSAGE =
  'no actuals recorded yet (41-Reports/usage/usage-log.jsonl not found — run usage-capture.js first)';

// ---------- CLI parsing ----------

function parseArgs(argv) {
  const args = {
    chat: null, seed: false, estimateBand: null, type: null,
    usageLog: null, storiesDir: null, strategyDir: null, help: false,
    project: false, stories: null,
    // STORY-29.3.03 — the attribution surface: what attached to a story, what could not, and
    // the arithmetic that proves nothing fell between the two.
    attribution: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--chat' && argv[i + 1]) args.chat = argv[++i];
    else if (a === '--seed') args.seed = true;
    else if (a === '--estimate-band' && argv[i + 1]) args.estimateBand = argv[++i];
    else if (a === '--type' && argv[i + 1]) args.type = argv[++i];
    else if (a === '--usage-log' && argv[i + 1]) args.usageLog = argv[++i];
    else if (a === '--stories-dir' && argv[i + 1]) args.storiesDir = argv[++i];
    else if (a === '--strategy-dir' && argv[i + 1]) args.strategyDir = argv[++i];
    else if (a === '--project') args.project = true;
    else if (a === '--stories' && argv[i + 1]) args.stories = argv[++i];
    else if (a === '--attribution') args.attribution = true;
    else if (a === '--help') args.help = true;
  }
  return args;
}

// ---------- usage-log reading ----------
//
// STORY-29.3.01 — `readUsageLog`, `sumTokens`, `actualTotalsByStoryId`,
// `actualTotalsByChatId`, `actualTotalsByChatKey` and `parsePositiveInt` were DEFINED here and
// imported from here by `generate-monitor.js` and `generate-dashboard.js`. They now live in
// `lib/usage-rollup.js` beside the rollup that composes them — one module owning "what counts
// as an actual" — and are destructured at the top of this file and re-exported at the bottom.
// Every existing `require('./usage-reconcile')` call site is unchanged by the move.

// ---------- story frontmatter collection ----------

function walkMd(dir, list = []) {
  if (!fs.existsSync(dir)) return list;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkMd(full, list);
    else if (entry.isFile() && entry.name.endsWith('.md')) list.push(full);
  }
  return list;
}

function collectStories(storiesDir) {
  const out = [];
  for (const f of walkMd(storiesDir)) {
    let content;
    try { content = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const fm = parseFrontmatter(content);
    if (!fm || fm.type !== 'story' || !fm.id) continue;
    out.push({
      id: fm.id,
      feature: fm.feature || null,
      status: fm.status || null,
      estimate: fm.estimate || null,          // XS/S/M/L/XL band
      type_of_work: fm.type_of_work || null,
      usage_estimate: parsePositiveInt(fm.usage_estimate), // token figure, or null
    });
  }
  return out;
}

// ---------- reconciliation rows ----------

function variance(estimate, actual) {
  if (estimate === null || actual === null) return { abs: null, pct: null };
  const abs = actual - estimate;
  const pct = estimate !== 0 ? (abs / estimate) * 100 : null;
  return { abs, pct };
}

function buildRows(stories, actualsByStoryId) {
  const rows = [];
  for (const s of stories) {
    const actual = actualsByStoryId.has(s.id) ? actualsByStoryId.get(s.id) : null;
    if (s.usage_estimate === null && actual === null) continue; // nothing to reconcile
    const v = variance(s.usage_estimate, actual);
    rows.push({
      id: s.id, feature: s.feature, status: s.status,
      estimate: s.usage_estimate, actual, varianceAbs: v.abs, variancePct: v.pct,
    });
  }
  rows.sort((a, b) => a.id.localeCompare(b.id));
  return rows;
}

function fmtNum(n) {
  return (n === null || n === undefined) ? '—' : String(n);
}

function fmtVariance(abs, pct) {
  if (abs === null) return '—';
  const sign = abs > 0 ? '+' : '';
  const pctStr = pct === null ? '' : ` (${sign}${pct.toFixed(1)}%)`;
  return `${sign}${abs}${pctStr}`;
}

function formatStoryLine(row) {
  return `  ${row.id}  estimate=${fmtNum(row.estimate)}  actual=${fmtNum(row.actual)}  ` +
    `variance=${fmtVariance(row.varianceAbs, row.variancePct)}`;
}

// ---------- rollups ----------

function sumRollup(rows) {
  let estimateSum = null, actualSum = null, n = 0;
  for (const r of rows) {
    n += 1;
    if (r.estimate !== null) estimateSum = (estimateSum || 0) + r.estimate;
    if (r.actual !== null) actualSum = (actualSum || 0) + r.actual;
  }
  const v = variance(estimateSum, actualSum);
  return { estimateSum, actualSum, varianceAbs: v.abs, variancePct: v.pct, count: n };
}

function formatRollupLine(label, rollup) {
  return `  ${label}  estimate=${fmtNum(rollup.estimateSum)}  actual=${fmtNum(rollup.actualSum)}  ` +
    `variance=${fmtVariance(rollup.varianceAbs, rollup.variancePct)}  ` +
    `(${rollup.count} ${rollup.count === 1 ? 'story' : 'stories'})`;
}

// Rollup grouped by FEATURE prefix (the story's `feature:` frontmatter, e.g. FEAT-21.2) —
// the default "per-batch" grouping when --chat is not given.
function rollupByFeature(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = r.feature || '(no feature)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const lines = [];
  for (const [feature, groupRows] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(formatRollupLine(feature, sumRollup(groupRows)));
  }
  return lines;
}

// Resolve a CHAT id's member story ids from the `41-Reports/EXECUTION-STRATEGY-*.json`
// sidecars execution-strategist emits (phases[].chats[].id / .stories[].id). Returns null
// when the chat id isn't found in any sidecar (caller reports that explicitly).
function findChatStoryIds(reportsDir, chatId) {
  if (!fs.existsSync(reportsDir)) return null;
  // STORY-27.3.02 — reader site 5 of 6. Was a flat `readdirSync`. `--chat` would
  // have started reporting "chat id not found in any sidecar" for every chat the
  // moment the sidecars moved — an answer indistinguishable from a genuinely
  // unknown chat id.
  for (const found of reportTree.findReportDocs(reportsDir, (n) => /^EXECUTION-STRATEGY-.*\.json$/.test(n))) {
    let data;
    try { data = JSON.parse(fs.readFileSync(found.full, 'utf8')); } catch { continue; }
    const phases = Array.isArray(data && data.phases) ? data.phases : [];
    for (const phase of phases) {
      const chats = Array.isArray(phase && phase.chats) ? phase.chats : [];
      for (const chat of chats) {
        if (chat && chat.id === chatId) {
          const stories = Array.isArray(chat.stories) ? chat.stories : [];
          return stories.map(s => (typeof s === 'string' ? s : (s && s.id))).filter(Boolean);
        }
      }
    }
  }
  return null;
}

// ---------- project mode (STORY-21.2.03 / BACKLOG-0086 Tranche D) ----------

// Sums usage_estimate over a fixed list of story ids. Coverage-honest: a story id with no
// matching story file, OR a story file whose usage_estimate is absent/invalid, is counted as
// "lacking" and contributes NOTHING to the sum — never fabricated as 0-is-a-measurement.
// `sum` is the total of whatever estimates DO exist, so callers must read `lacking` alongside
// it to know whether `sum` is complete or partial.
function computeProjection(stories, storyIds) {
  const byId = new Map(stories.map(s => [s.id, s]));
  let sum = 0;
  let withEstimate = 0;
  let lacking = 0;
  const rows = [];
  for (const id of storyIds) {
    const s = byId.get(id);
    const estimate = s ? s.usage_estimate : null;
    if (estimate !== null && estimate !== undefined) {
      sum += estimate;
      withEstimate += 1;
    } else {
      lacking += 1;
    }
    rows.push({ id, estimate: (estimate === undefined ? null : estimate), known: !!s });
  }
  return { sum, withEstimate, lacking, total: storyIds.length, rows };
}

function formatProjectionRow(row) {
  if (!row.known) return `  ${row.id}  (unknown story id — not found under the stories dir; lacking)`;
  if (row.estimate === null) return `  ${row.id}  (no usage_estimate — lacking, not included in projected spend)`;
  return `  ${row.id}  estimate=${row.estimate}`;
}

function formatProjectionSummary(label, proj) {
  return `projection for ${label}: ${proj.total} stor${proj.total === 1 ? 'y' : 'ies'} ` +
    `(${proj.withEstimate} with usage_estimate, ${proj.lacking} lacking) — ` +
    `projected spend: ${proj.sum} tokens` +
    (proj.lacking > 0 ? ' (PARTIAL — lacking stories excluded from this sum)' : '');
}

// ---------- seed mode ----------

function median(nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

// Seeds a new story's usage_estimate from historical actuals of similarly-shaped DONE
// stories (same `estimate` band + `type_of_work` — SOP §11's existing agent/effort-shape
// join keys, reused here for the same "similar-shaped story" notion). NEVER fabricates: a
// band/type combination with zero recorded actuals returns ok:false with an explicit
// "no history — no seed" message rather than guessing a number.
function computeSeed(stories, actualsByStoryId, estimateBand, typeOfWork) {
  const matches = stories.filter(s =>
    s.status === 'done' && s.estimate === estimateBand && s.type_of_work === typeOfWork);
  const samples = [];
  for (const s of matches) {
    if (actualsByStoryId.has(s.id)) samples.push({ id: s.id, actual: actualsByStoryId.get(s.id) });
  }
  if (samples.length === 0) {
    return {
      ok: false,
      message: `no history — no seed (no DONE story with estimate=${estimateBand} ` +
        `type_of_work=${typeOfWork} has recorded actuals in usage-log.jsonl; run more ` +
        `stories of this shape through usage-capture.js first)`,
    };
  }
  return { ok: true, seedValue: median(samples.map(s => s.actual)), samples };
}

// ---------- attribution mode (STORY-29.3.03 / ADR-0190) ----------

function fmtTok(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

/**
 * The attribution report. Three sections and a proof, in that order because that is the order a
 * reader needs them: what attached to a story, what could not, and whether the two together
 * account for the whole ledger.
 *
 * The unattributable section is ITEMISED — one line per bracket, with its constituent stories
 * named when the writer knew them. A single "remainder: N tokens" line would be arithmetically
 * identical and useless: the point of stating a remainder is that someone can look at what is
 * in it and decide whether the boundary could be made observable next time.
 */
function formatAttribution(attribution, varianceRows) {
  const lines = [];
  const t = attribution.totals;

  lines.push(`usage attribution — ${t.records} ledger record(s)`);
  lines.push('');
  lines.push(`ATTRIBUTED TO A STORY — ${attribution.attributed.length} stor(y/ies), ${fmtTok(t.attributed)} tokens`);
  if (attribution.attributed.length === 0) {
    lines.push('  (none — no story-kind record on this ledger; a story bracket is written by '
      + '`usage-capture.js --story` at a story boundary)');
  } else {
    for (const r of attribution.attributed) {
      lines.push(`  ${r.storyId}  ${fmtTok(r.tokens)} tokens  (${r.records} bracket${r.records === 1 ? '' : 's'})`);
    }
  }

  lines.push('');
  lines.push(`UNATTRIBUTABLE — ${attribution.unattributable.length} bracket(s), ${fmtTok(t.unattributable)} tokens`);
  if (attribution.unattributable.length === 0) {
    lines.push('  (none)');
  } else {
    for (const u of attribution.unattributable) {
      const across = u.stories.length
        ? `across [${u.stories.join(', ')}] — NOT SPLIT`
        : 'constituent stories not recorded';
      lines.push(`  ${u.key || u.id}  ${fmtTok(u.tokens)} tokens  ${across}`);
    }
    lines.push(`  proration: ${attribution.proration}`);
  }

  if (attribution.leaks.length) {
    lines.push('');
    lines.push(`UNACCOUNTED — ${attribution.leaks.length} record(s) in NEITHER bucket:`);
    for (const l of attribution.leaks) {
      lines.push(`  ${l.id || '(no id)'} kind=${l.kind === null ? '(none)' : l.kind}  ${fmtTok(l.tokens)} tokens`);
    }
  }

  lines.push('');
  // BUG-20260810-11 — RECONCILES ANSWERS ONE QUESTION, AND IT IS NOT "IS THIS SPEND".
  //
  // The word used to sit, bare, beside a total inflated 26.6× by cumulative re-sums. It was
  // true — the buckets do account for every record — and it read as an endorsement of the
  // figure. It is now qualified whenever the total is known to be bracket-inflated, and the
  // distinct-spend ceiling is printed on the next line rather than left in a payload.
  const bracketed = attribution.cumulative && attribution.cumulative.detected;
  const verdict = attribution.reconciles
    ? (bracketed
      ? 'RECONCILES AS A SUM OF BRACKETS (every record is accounted for; the total is NOT distinct spend — see NOTE)'
      : 'RECONCILES')
    : 'DOES NOT RECONCILE';
  lines.push(`TOTALS: attributed ${fmtTok(t.attributed)} + unattributable ${fmtTok(t.unattributable)} `
    + `= ${fmtTok(t.attributed + t.unattributable)} · ledger ${fmtTok(t.ledger)} — ${verdict}`);
  if (attribution.distinctSpendUpperBound !== null && attribution.distinctSpendUpperBound !== undefined) {
    lines.push(`DISTINCT SPEND: at most ${fmtTok(attribution.distinctSpendUpperBound)} tokens `
      + '(the sum above counts the same tokens repeatedly)');
  }
  if (attribution.overlapNote) lines.push(`NOTE: ${attribution.overlapNote}`);

  lines.push('');
  lines.push(`ESTIMATE vs ACTUAL — ${varianceRows.length} row(s) where either side exists`);
  if (varianceRows.length === 0) {
    lines.push('  (no story carries an estimate or an attributed actual yet)');
  } else {
    for (const r of varianceRows) {
      if (r.state === 'compared') {
        const sign = r.varianceAbs > 0 ? '+' : '';
        const pct = r.variancePct === null ? '' : ` (${sign}${r.variancePct.toFixed(1)}%)`;
        lines.push(`  ${r.id}  estimate=${fmtTok(r.estimate)}  actual=${fmtTok(r.actual)}  `
          + `variance=${sign}${fmtTok(r.varianceAbs)}${pct}`);
      } else if (r.state === 'no-actual') {
        lines.push(`  ${r.id}  estimate=${fmtTok(r.estimate)}  actual=— (no actual recorded — `
          + 'no story bracket for it; a chat bracket is never split to fill this)');
      } else {
        lines.push(`  ${r.id}  estimate=— (no estimate)  actual=${fmtTok(r.actual)}`);
      }
    }
  }
  return lines.join('\n');
}

// ---------- main ----------

function main(argv) {
  const args = parseArgs(argv);

  if (args.help) {
    console.log('Usage: node usage-reconcile.js [--chat <id>] [--usage-log <path>] [--stories-dir <path>] [--strategy-dir <path>]');
    console.log('       node usage-reconcile.js --seed --estimate-band <XS|S|M|L> --type <type_of_work>');
    console.log('       node usage-reconcile.js --project --chat <id>');
    console.log('       node usage-reconcile.js --project --stories <id,id,...>');
    console.log('       node usage-reconcile.js --attribution');
    return 0;
  }

  const usageLogPath = args.usageLog || process.env.PM_USAGE_LOG || DEFAULT_LOG_PATH;
  const storiesDir = args.storiesDir || DEFAULT_STORIES_DIR;
  const reportsDir = args.strategyDir || DEFAULT_REPORTS_DIR;

  const { found, records } = readUsageLog(usageLogPath);
  const actualsByStoryId = actualTotalsByStoryId(records);
  const stories = collectStories(storiesDir);

  if (args.attribution) {
    if (!found) console.log(NO_ACTUALS_MESSAGE);
    const attribution = usageRollup.attributeUsage(records);
    const varianceRows = usageRollup.estimateVsActual(stories, attribution);
    console.log(formatAttribution(attribution, varianceRows));
    // Exit 0 even when the arithmetic does not reconcile: this is a REPORT, and a reporting
    // tool must never fail the run it reports on (the file's standing contract). The verdict is
    // in the output, in words, where a reader sees it.
    return 0;
  }

  if (args.project) {
    if ((!args.chat && !args.stories) || (args.chat && args.stories)) {
      console.error('✗ usage-reconcile --project: give exactly ONE of --chat <id> or --stories <id,id,...>');
      return 2;
    }
    if (args.chat) {
      const chatStoryIds = findChatStoryIds(reportsDir, args.chat);
      if (chatStoryIds === null) {
        console.log(`chat '${args.chat}' was not found in any EXECUTION-STRATEGY-*.json sidecar under ${path.relative(PM_ROOT, reportsDir)}`);
        return 0;
      }
      const byId = new Map(stories.map(s => [s.id, s]));
      const readyIds = chatStoryIds.filter(id => byId.has(id) && byId.get(id).status === 'ready');
      if (readyIds.length === 0) {
        console.log(`chat '${args.chat}' has 0 READY member stor(y/ies) to project — nothing to project ` +
          `(${chatStoryIds.length} member stor${chatStoryIds.length === 1 ? 'y' : 'ies'} total).`);
        return 0;
      }
      const proj = computeProjection(stories, readyIds);
      console.log(formatProjectionSummary(`chat ${args.chat} (READY stories only)`, proj));
      for (const row of proj.rows) console.log(formatProjectionRow(row));
      return 0;
    }
    // --stories <id,id,...>: explicit list, used as-given (no status filter — the operator
    // named exactly what they want projected).
    const storyIds = args.stories.split(',').map(s => s.trim()).filter(Boolean);
    if (storyIds.length === 0) {
      console.error('✗ usage-reconcile --project --stories: give at least one non-empty story id');
      return 2;
    }
    const proj = computeProjection(stories, storyIds);
    console.log(formatProjectionSummary(`${storyIds.length} named stor${storyIds.length === 1 ? 'y' : 'ies'}`, proj));
    for (const row of proj.rows) console.log(formatProjectionRow(row));
    return 0;
  }

  if (args.seed) {
    if (!args.estimateBand || !args.type) {
      console.error('✗ usage-reconcile --seed: give both --estimate-band <XS|S|M|L> and --type <type_of_work>');
      return 2;
    }
    if (!ESTIMATE_BANDS.has(args.estimateBand)) {
      console.error(`✗ usage-reconcile --seed: --estimate-band must be one of ${[...ESTIMATE_BANDS].join(', ')} (got '${args.estimateBand}')`);
      return 2;
    }
    if (!found) console.log(NO_ACTUALS_MESSAGE);
    const seed = computeSeed(stories, actualsByStoryId, args.estimateBand, args.type);
    if (!seed.ok) {
      console.log(seed.message);
      return 0;
    }
    console.log(`seed suggestion for estimate=${args.estimateBand} type_of_work=${args.type}: ` +
      `${seed.seedValue} tokens (median of ${seed.samples.length} sample(s): ` +
      `${seed.samples.map(s => `${s.id}=${s.actual}`).join(', ')})`);
    return 0;
  }

  // ---- reconcile mode ----
  if (!found) console.log(NO_ACTUALS_MESSAGE);

  const rows = buildRows(stories, actualsByStoryId);
  if (rows.length === 0) {
    console.log('no stories carry a usage_estimate or a recorded actual yet — nothing to reconcile.');
    return 0;
  }

  console.log(`usage-reconcile — ${rows.length} stor${rows.length === 1 ? 'y' : 'ies'} with an estimate and/or actual:\n`);
  for (const row of rows) console.log(formatStoryLine(row));

  if (args.chat) {
    const chatStoryIds = findChatStoryIds(reportsDir, args.chat);
    console.log(`\nRollup (by chat ${args.chat}):`);
    if (chatStoryIds === null) {
      console.log(`  chat '${args.chat}' was not found in any EXECUTION-STRATEGY-*.json sidecar under ${path.relative(PM_ROOT, reportsDir)}`);
    } else {
      const chatRows = rows.filter(r => chatStoryIds.includes(r.id));
      console.log(formatRollupLine(args.chat, sumRollup(chatRows)));
      const chatActuals = actualTotalsByChatId(records);
      if (chatActuals.has(args.chat)) {
        console.log(`  (chat-level capture on record: ${chatActuals.get(args.chat)} tokens — see usage-capture.js --chat)`);
      }
    }
  } else {
    console.log('\nRollup (by feature):');
    for (const line of rollupByFeature(rows)) console.log(line);
  }

  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = {
  main, parseArgs, ledgerJoin,
  // STORY-29.3.01 — re-exported from lib/usage-rollup.js, their new home. Named here so the
  // existing importers (`generate-monitor.js`, `generate-dashboard.js`, three test files) did
  // not have to change in the same commit that moved them.
  readUsageLog, sumTokens, actualTotalsByStoryId, actualTotalsByChatId, actualTotalsByChatKey,
  usageRollup,
  collectStories, parsePositiveInt, buildRows, variance, sumRollup, rollupByFeature,
  findChatStoryIds, median, computeSeed, formatStoryLine, formatRollupLine,
  computeProjection, formatProjectionRow, formatProjectionSummary,
  formatAttribution, fmtTok,
  DEFAULT_STORIES_DIR, DEFAULT_REPORTS_DIR, NO_ACTUALS_MESSAGE,
};
