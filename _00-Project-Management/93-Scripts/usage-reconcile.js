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
    else if (a === '--help') args.help = true;
  }
  return args;
}

// ---------- usage-log reading (tolerant — mirrors usage-capture.js's parser) ----------

// Returns { found, records }. `found` is false only when the file does not exist at all —
// the "no actuals recorded yet" case the story requires. An existing-but-empty/malformed
// file is tolerated the same way usage-capture.js tolerates malformed transcript lines:
// bad lines are skipped, never thrown.
function readUsageLog(logPath) {
  if (!fs.existsSync(logPath)) return { found: false, records: [] };
  let content;
  try {
    content = fs.readFileSync(logPath, 'utf8');
  } catch {
    return { found: false, records: [] };
  }
  const records = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj;
    try { obj = JSON.parse(trimmed); } catch { continue; } // malformed line — skip, tolerant
    if (obj && typeof obj === 'object' && obj.id && obj.tokens) records.push(obj);
  }
  return { found: true, records };
}

function sumTokens(tokens) {
  if (!tokens || typeof tokens !== 'object') return 0;
  return (Number(tokens.input) || 0) + (Number(tokens.output) || 0) +
    (Number(tokens.cache_read) || 0) + (Number(tokens.cache_creation) || 0);
}

// Map<storyId, totalTokens> summed across every 'story'-kind record for that id — a story
// may be executed across more than one captured session, so this is total actual spend so
// far, not a single sample.
function actualTotalsByStoryId(records) {
  const totals = new Map();
  for (const r of records) {
    if (r.kind !== 'story') continue;
    totals.set(r.id, (totals.get(r.id) || 0) + sumTokens(r.tokens));
  }
  return totals;
}

// Map<chatId, totalTokens> — 'chat'-kind records (a whole batch captured as one bracket via
// `usage-capture.js --chat`), summed the same way.
function actualTotalsByChatId(records) {
  const totals = new Map();
  for (const r of records) {
    if (r.kind !== 'chat') continue;
    totals.set(r.id, (totals.get(r.id) || 0) + sumTokens(r.tokens));
  }
  return totals;
}

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

// Positive-integer parse mirroring validate-frontmatter.js's R23 shape rule. An invalid
// usage_estimate (0, negative, non-numeric, decimal) is treated as ABSENT here — R23
// already flags the shape problem at lint time; this reporting script must not crash on it
// or silently coerce it into a fabricated number.
function parsePositiveInt(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  if (!/^[1-9]\d*$/.test(str)) return null;
  return Number(str);
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
  for (const entry of fs.readdirSync(reportsDir)) {
    if (!/^EXECUTION-STRATEGY-.*\.json$/.test(entry)) continue;
    let data;
    try { data = JSON.parse(fs.readFileSync(path.join(reportsDir, entry), 'utf8')); } catch { continue; }
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

// ---------- main ----------

function main(argv) {
  const args = parseArgs(argv);

  if (args.help) {
    console.log('Usage: node usage-reconcile.js [--chat <id>] [--usage-log <path>] [--stories-dir <path>] [--strategy-dir <path>]');
    console.log('       node usage-reconcile.js --seed --estimate-band <XS|S|M|L> --type <type_of_work>');
    console.log('       node usage-reconcile.js --project --chat <id>');
    console.log('       node usage-reconcile.js --project --stories <id,id,...>');
    return 0;
  }

  const usageLogPath = args.usageLog || process.env.PM_USAGE_LOG || DEFAULT_LOG_PATH;
  const storiesDir = args.storiesDir || DEFAULT_STORIES_DIR;
  const reportsDir = args.strategyDir || DEFAULT_REPORTS_DIR;

  const { found, records } = readUsageLog(usageLogPath);
  const actualsByStoryId = actualTotalsByStoryId(records);
  const stories = collectStories(storiesDir);

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
  main, parseArgs, readUsageLog, sumTokens, actualTotalsByStoryId, actualTotalsByChatId,
  collectStories, parsePositiveInt, buildRows, variance, sumRollup, rollupByFeature,
  findChatStoryIds, median, computeSeed, formatStoryLine, formatRollupLine,
  computeProjection, formatProjectionRow, formatProjectionSummary,
  DEFAULT_STORIES_DIR, DEFAULT_REPORTS_DIR, NO_ACTUALS_MESSAGE,
};
