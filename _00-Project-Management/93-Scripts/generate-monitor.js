#!/usr/bin/env node
/**
 * generate-monitor.js
 *
 * Keeps the count-driven rollups in 42-Monitor/MONITOR.md in sync with the live
 * artefact corpus. Recomputes and upserts four managed blocks between markers:
 *   - pm:monitor:overall  — the overall story-completion bar
 *   - pm:monitor:rollup   — the per-epic rollup table
 *   - pm:monitor:counts   — the counts snapshot
 *   - pm:monitor:wip       — the WIP-by-status block
 * Everything outside the markers (header, State, narrative, revision history,
 * BACKLOG-resolution table) is hand-written and never touched.
 *
 * Fixes BUG-20260524-01: MONITOR's hand-authored counts drifted from disk because
 * they were only refreshed on close-out / weekly cadence, never on artefact creation.
 * Now `npm run pm:monitor` (folded into `pm:all`) recomputes them from frontmatter.
 *
 * Dependency-free: Node.js stdlib only (fs, path). Idempotent.
 *
 * Usage:  node _00-Project-Management/93-Scripts/generate-monitor.js
 *         npm run pm:monitor
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { parseFrontmatter, stripQuotes } = require('./lib/frontmatter');

// PM_ROOT defaults to the `_00-Project-Management/` one level up from this script. Override
// with PM_MONITOR_ROOT to run against another PM tree — the PM_DASH_ROOT seam
// generate-dashboard.js already carries, added by STORY-28.3.03 so the anchor guard can be
// proved against a fixture board without planting a corrupted MONITOR.md in the real one.
// Backward-compatible: unset env var = identical behaviour.
const PM_ROOT = process.env.PM_MONITOR_ROOT
  ? path.resolve(process.env.PM_MONITOR_ROOT)
  : path.resolve(__dirname, '..');
// Resolve logical PM sub-folder names through the layout map (full / flattened /
// custom). PATHS.<logical> → physical folder name for this project. See lib/pm-paths.js.
const { loadPaths } = require('./lib/pm-paths');
const PATHS = loadPaths(PM_ROOT).map;
// STORY-28.3.03 / BUG-20260804-01 — the anchors this script writes through, and the
// assertion that each of them is unambiguous. See lib/monitor-anchors.js.
const monitorAnchors = require('./lib/monitor-anchors.js');
const MONITOR = path.join(PM_ROOT, PATHS.monitor, 'MONITOR.md');
const CHANGELOG = path.join(PM_ROOT, '..', 'CHANGELOG.md');

// Usage rollup (STORY-21.2.03 / ADR-0079, converged by STORY-29.3.01 / ADR-0188): actual
// tokens `usage-capture.js` recorded + estimated tokens (`usage_estimate:` frontmatter),
// through THE rollup — the same function `generate-dashboard.js` calls. Reusing the same
// *parser* was never enough: this file had its own rollup body, and that body filtered to
// story-kind records only, so MONITOR asserted "no usage actuals recorded yet" over a ledger
// holding 31 chat-kind ones (BUG-20260805-01). There is now one rollup and no second opinion.
const usageRollup = require('./lib/usage-rollup.js');
const { DEFAULT_LOG_PATH } = require('./usage-capture');
// The ledger this board reports on, resolved the way `generate-dashboard.js` resolves its own:
// from THIS run's PM root (so `PM_MONITOR_ROOT` renders that tree's ledger, not the installed
// kit's), with `PM_USAGE_LOG` — the same env seam `usage-capture.js` writes through and
// `usage-reconcile.js` reads through — taking precedence.
//
// With no env var set this is byte-identical to usage-capture.js's `DEFAULT_LOG_PATH`, which is
// asserted in tests/usage-rollup-consumers.test.js rather than assumed: the path is deliberately
// NOT layout-mapped, because it must be the exact place the writer writes.
const USAGE_LOG_PATH = process.env.PM_USAGE_LOG
  || path.join(PM_ROOT, '41-Reports', 'usage', 'usage-log.jsonl');

const TERMINAL = new Set(['done', 'wontfix', 'duplicate', 'archived']);

// ---------- corpus walk (dependency-free; mirrors validate-frontmatter.js) ----------

function walk(dir, list = []) {
  if (!fs.existsSync(dir)) return list;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name === '__fixtures__') continue; // never count test fixtures
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, list);
    else if (entry.isFile() && entry.name.endsWith('.md')) list.push(full);
  }
  return list;
}


function readAll(subdir) {
  const out = [];
  for (const f of walk(path.join(PM_ROOT, subdir))) {
    const fm = parseFrontmatter(fs.readFileSync(f, 'utf8'));
    if (fm) out.push({ fm, file: f });
  }
  return out;
}

// Releases are tracked in the repo-root CHANGELOG.md (Keep-a-Changelog headings),
// NOT as 13-Releases/*.md files — count distinct semver headings (`## [x.y.z]`),
// excluding the `## [Unreleased]` section. Graceful 0 when CHANGELOG.md is absent
// (e.g. a freshly-scaffolded client project that hasn't started a changelog yet).
function countReleases() {
  if (!fs.existsSync(CHANGELOG)) return 0;
  const txt = fs.readFileSync(CHANGELOG, 'utf8');
  const versions = new Set();
  const re = /^##\s+\[(\d+\.\d+\.\d+)\]/gm;
  let m;
  while ((m = re.exec(txt)) !== null) versions.add(m[1]);
  return versions.size;
}

function bar(done, total) {
  if (total <= 0) return '[░░░░░░░░░░]';
  const filled = Math.round((done / total) * 10);
  return '[' + '█'.repeat(filled) + '░'.repeat(10 - filled) + ']';
}

// ---------- Honest timestamp derivation (reconcile epic times from child stories) ----------
//
// Derives honest timestamps for each epic from its child stories, never from current time.
// These represent the actual work span when children exist. Non-existent for epics with no
// children (guard against synthetic values). Made available in the monitor context but NOT
// written back to epic files — flagging via R21 is the chosen corrective mechanism.
//
// Returns an object: { epicId -> { derivedStartedAt, derivedCompletedAt } }
// Where derivedStartedAt = earliest (min) non-empty started_at among children.
//       derivedCompletedAt = latest (max) non-empty completed_at among children.
function deriveEpicTimestamps(epics, stories) {
  const derived = {};

  for (const epic of epics) {
    const childStories = stories.filter(s => s.fm.epic === epic.fm.id);
    if (childStories.length === 0) {
      // Guard: no children means no derived timestamps.
      continue;
    }

    // Collect non-empty timestamps.
    const startedAts = childStories
      .map(s => s.fm.started_at)
      .filter(t => t && typeof t === 'string' && t.trim() !== '');
    const completedAts = childStories
      .map(s => s.fm.completed_at)
      .filter(t => t && typeof t === 'string' && t.trim() !== '');

    // Derive earliest started_at (min) and latest completed_at (max).
    const derivedStartedAt = startedAts.length > 0 ? startedAts.sort()[0] : null;
    const derivedCompletedAt = completedAts.length > 0 ? completedAts.sort().pop() : null;

    derived[epic.fm.id] = {
      derivedStartedAt,
      derivedCompletedAt,
      childCount: childStories.length,
    };
  }

  return derived;
}

/**
 * epicTimestampDrift — does this epic's own window disagree with its children's?
 *
 * Extracted from main()'s inline filter (BUG-20260827-01) so the advisory's rule is
 * addressable by a test rather than only observable through a console line.
 *
 * `derived` is one value of deriveEpicTimestamps(): { derivedStartedAt, derivedCompletedAt }.
 * `efm` is the epic's own frontmatter.
 */
function epicTimestampDrift(efm, derived) {
  if (!efm || !derived) return false;

  // THE INVARIANT IS CONTAINMENT, NOT EQUALITY (BUG-20260827-01).
  // An epic's window BRACKETS its children: it is opened before the first story starts
  // (planned, then worked) and closed after the last one completes (the close-out is its
  // own act). Both are the normal case. The original rule tested `!==`, which no correctly
  // bracketed epic can satisfy — it reported 9 correct epics for every 1 real violation,
  // and that noise is why BACKLOG-0080's 'classify each by hand' has been open since June.
  //
  // What is genuinely impossible is the reverse ordering, and that is all this now flags.

  // A child cannot start before its parent opened.
  if (derived.derivedStartedAt && efm.started_at && efm.started_at > derived.derivedStartedAt) {
    return true;
  }

  // An epic cannot have finished while a story under it was still running.
  //
  // NO STATUS GUARD HERE, DELIBERATELY. The first draft skipped this arm unless the epic
  // was TERMINAL, reasoning that an open epic has no completion to compare. A mutant that
  // deleted that guard SURVIVED the suite, which was the tell: `efm.completed_at` is `''`
  // on an open epic, so the truthiness check below already short-circuits and the guard was
  // doing nothing. Worse, it would have SUPPRESSED a genuine inconsistency — an epic
  // reverted to a non-terminal status without its `completed_at` being cleared (the kit
  // requires clearing it; this arm is how you find out when that did not happen).
  return Boolean(
    derived.derivedCompletedAt && efm.completed_at && efm.completed_at < derived.derivedCompletedAt
  );
}


// ---------- usage rollup (STORY-21.2.03 / ADR-0079 · converged STORY-29.3.01 / ADR-0188) ----------

/**
 * THE ROLLUP, CALLED — not a second one written here.
 *
 * What this function still owns is the SHAPE ADAPTER: this file carries stories as
 * `{ fm, file }` pairs, the dashboard carries flat records, and the rollup takes either
 * (`normaliseStory`). Everything else — what counts as an actual, what counts as a valid
 * estimate, the no-fabricated-zero rule, the chat census — is `lib/usage-rollup.js`'s.
 *
 * `opts.logPath` exists so a fixture board can be pointed at a fixture ledger.
 */
function computeUsageRollup(stories, opts) {
  const logPath = (opts && opts.logPath) || USAGE_LOG_PATH;
  return usageRollup.buildUsageRollup(stories, { logPath });
}

// ---------- compute ----------

function compute() {
  const epics = readAll(PATHS.epics);
  const features = readAll(PATHS.features);
  const stories = readAll(PATHS.stories);
  const testplans = readAll(PATHS.testplans);
  const bugs = readAll(PATHS.bugs);
  const adrs = readAll(PATHS.decisions);
  const backlog = readAll(PATHS.backlog);
  const releaseCount = countReleases();
  const prds = walk(path.join(PM_ROOT, PATHS.requirements)).filter(f => /PRD-/i.test(path.basename(f)));

  const storyDone = stories.filter(s => s.fm.status === 'done').length;
  const storyTotal = stories.length;

  // per-epic rollup
  const byEpic = new Map(); // epicId -> { feat, story, done, inflight }
  for (const e of epics) {
    byEpic.set(e.fm.id, { epic: e, feat: 0, story: 0, done: 0, inflight: 0 });
  }
  for (const f of features) {
    const r = byEpic.get(f.fm.epic);
    if (r) r.feat++;
  }
  for (const s of stories) {
    const r = byEpic.get(s.fm.epic);
    if (!r) continue;
    r.story++;
    if (s.fm.status === 'done') r.done++;
    if (s.fm.status === 'in-progress' || s.fm.status === 'in-review') r.inflight++;
  }

  // WIP across stories
  const wip = { 'in-progress': 0, 'in-review': 0, 'blocked': 0 };
  for (const s of stories) if (wip[s.fm.status] !== undefined) wip[s.fm.status]++;

  // status tallies
  const tally = (arr) => arr.reduce((m, x) => { const st = x.fm.status || '?'; m[st] = (m[st] || 0) + 1; return m; }, {});

  // Honest timestamp derivation: reconcile epic times from child stories.
  const derivedEpicTimestamps = deriveEpicTimestamps(epics, stories);

  const usage = computeUsageRollup(stories);

  return {
    epics, features, stories, testplans, bugs, adrs, backlog, releaseCount, prds,
    storyDone, storyTotal, byEpic, wip, derivedEpicTimestamps, usage,
    epicStatus: tally(epics), bugOpen: bugs.filter(b => !TERMINAL.has(b.fm.status)).length,
  };
}

// ---------- render blocks ----------

function fmtPct(done, total) { return total > 0 ? ((done / total) * 100).toFixed(1) : '0.0'; }

function renderOverall(c) {
  return '```\n' +
    `ALL  ${bar(c.storyDone, c.storyTotal)}   ${c.storyDone} / ${c.storyTotal} stories (${fmtPct(c.storyDone, c.storyTotal)}%)\n` +
    '```';
}

function epicStatusPill(r) {
  if (r.story > 0 && r.done === r.story) return '🟢 done';
  if (r.inflight > 0 || r.done > 0) return '🟧 in progress';
  return '🟦 planned';
}

function renderRollup(c) {
  const rows = ['| Epic | Status | Features | Stories | Shipped | Bar |', '|---|---|---|---|---|---|'];
  const ids = [...c.byEpic.keys()].sort();
  for (const id of ids) {
    const r = c.byEpic.get(id);
    const title = r.epic.fm.title || id;
    const link = `../${PATHS.epics}/${path.basename(r.epic.file)}`;
    rows.push(`| [${id} — ${title}](${link}) | ${epicStatusPill(r)} | ${r.feat} | ${r.story} | ${r.done} / ${r.story} stories | \`${bar(r.done, r.story)}\` |`);
  }
  return rows.join('\n');
}

function renderCounts(c) {
  const doneEpics = (c.epicStatus['done'] || 0);
  const storyOpen = c.storyTotal - c.storyDone;
  return [
    `- Epics: ${c.epics.length}`,
    `- Features: ${c.features.length}`,
    `- Stories: ${c.storyTotal} (${c.storyDone} done · ${storyOpen} open)`,
    `- Testplans: ${c.testplans.length} (paired 1:1 with stories)`,
    `- PRDs: ${c.prds.length} (\`20-Requirements/\`, not linted)`,
    `- BACKLOG: ${c.backlog.length}`,
    `- Bugs filed: ${c.bugs.length} (${c.bugOpen} open)`,
    `- ADRs: ${c.adrs.length}`,
    `- Releases: ${c.releaseCount} (see CHANGELOG.md)`,
  ].join('\n');
}

function renderWip(c) {
  return [
    `- **in-progress:** ${c.wip['in-progress']} / 2 (limit per SOP §5)`,
    `- **in-review:** ${c.wip['in-review']} / 3 (limit)`,
    `- **blocked:** ${c.wip['blocked']} / 5 (limit)`,
  ].join('\n');
}

// Thousands separator without relying on locale/ICU (dependency-free, stdlib-only stance).
function fmtThousands(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

// Renders one rollup table ('Epic' or 'Feature' keyed) from a buildUsageRollup() payload map
// ({ id: { estimated, actual, coverage } }). Returns null when the map is empty (nothing to
// show for that grouping) rather than an empty table — the caller decides what to say when
// both groupings are empty.
//
// STORY-29.3.01 — reads the PAYLOAD shape (`estimated` / `actual` are null when nothing
// contributed) rather than this file's old accumulator shape. The null IS the dash: a cell is
// only a number when a story put a number in it.
function renderUsageTable(map, keyLabel) {
  const src = map || {};
  const ids = (src instanceof Map ? [...src.keys()] : Object.keys(src)).sort();
  if (ids.length === 0) return null;
  const get = (id) => (src instanceof Map ? src.get(id) : src[id]) || {};
  const rows = [`| ${keyLabel} | Estimated tokens | Actual tokens |`, '|---|---|---|'];
  for (const id of ids) {
    const r = get(id);
    const cov = r.coverage || { storiesWithEstimate: 0, storiesWithActual: 0 };
    const estCell = (r.estimated === null || r.estimated === undefined)
      ? '—'
      : `${fmtThousands(r.estimated)} (${cov.storiesWithEstimate} ${cov.storiesWithEstimate === 1 ? 'story' : 'stories'})`;
    const actCell = (r.actual === null || r.actual === undefined)
      ? '—'
      : `${fmtThousands(r.actual)} (${cov.storiesWithActual} ${cov.storiesWithActual === 1 ? 'story' : 'stories'})`;
    rows.push(`| ${id} | ${estCell} | ${actCell} |`);
  }
  return rows.join('\n');
}

/**
 * CRITICAL HONESTY RULE (STORY-21.2.03 AC-1): absent data renders as absent — never a table of
 * fabricated zeros, and never an absence claim the ledger contradicts.
 *
 * STORY-29.3.01 / BUG-20260805-01 — the three states this block must tell apart, which the old
 * renderer conflated into one sentence:
 *
 *   (a) nothing on disk                        → "no usage actuals recorded yet" is TRUE, say it
 *   (b) records on disk, none attributable     → say what IS on disk, and why it is not attributed
 *   (c) attributable records                   → the tables, plus (b)'s line for the rest
 *
 * The block used to print (a)'s sentence in all three states, over a ledger of 31 records. The
 * figures below come from the same rollup the dashboard renders, so the two boards cannot
 * report different numbers for the same ledger (TESTPLAN-29.3.01 TC-04 measures exactly that).
 */
function renderUsage(c) {
  const u = c.usage || {};
  const led = u.ledger || { found: false, recordCount: 0, storyRecordCount: 0, chatRecordCount: 0, skipped: { total: 0, malformed: 0, shape: 0 } };
  const skip = led.skipped || { total: 0, malformed: 0, shape: 0 };
  const epicTable = renderUsageTable(u.byEpic, 'Epic');
  const featureTable = renderUsageTable(u.byFeature, 'Feature');

  const parts = [];
  if (epicTable) parts.push('**By epic:**\n\n' + epicTable);
  if (featureTable) parts.push('**By feature:**\n\n' + featureTable);

  // The ledger census — always stated when the ledger holds anything, whether or not a single
  // row of it could be attributed to a story. This one line is the difference between a board
  // that says "nothing was recorded" and a board that says what was recorded.
  if (led.recordCount > 0) {
    parts.push(`**Ledger:** ${led.recordCount} record(s) on disk — ` +
      `${led.storyRecordCount} story-level, ${led.chatRecordCount} chat-level` +
      // MAJOR-2 (review of E29-CHAT-05) — a row of an unrecognised kind used to be counted in
      // `recordCount` and then contribute to no figure anywhere, so the only way to notice the
      // gap was to subtract two censuses from a third. Its tokens are now named.
      (led.otherRecordCount > 0
        ? `, ${led.otherRecordCount} of an unrecognised kind (${(led.otherKinds || []).join(', ')}) ` +
          `carrying ${fmtThousands(led.otherTokens)} token(s) that are in NO figure below`
        : '') + '.');
  }

  // The stated-count path (ADR-0124): name the count, the tokens and the reason. Never guess
  // an epic, and never let the absence of an epic become an absence of the record.
  //
  // BUG-20260810-11 — AND NEVER STATE THE TOTAL WITHOUT STATING WHAT IT IS. This block printed
  // "74,078,704,903 tokens" for a ledger whose distinct spend is at most 2,785,764,867: forty
  // cumulative re-sums of one transcript directory, summed. The caveat now travels WITH the
  // figure — one wording, from the rollup, so this board and the dashboard cannot disagree
  // about what the number means any more than they can disagree about its digits.
  if (u.chat) {
    const tok = (u.chat.totalTokens === null || u.chat.totalTokens === undefined)
      ? 'no token figure — none of them carries a non-zero count'
      : `${fmtThousands(u.chat.totalTokens)} tokens (summed across brackets)`;
    parts.push(`**Chat-level usage — counted, not attributed:** ${u.chat.recordCount} record(s) ` +
      `across ${u.chat.idCount} chat id(s), resolving to ${u.chat.keyCount} chat key(s); ${tok}. ` +
      u.chat.reason);
    const note = usageRollup.cumulativeNote(u.chat);
    if (note) parts.push(`⚠️ **Not distinct spend:** ${note}`);
  }

  if (skip.total > 0) {
    parts.push(`_${skip.total} ledger line(s) skipped (${skip.malformed} unparseable, ` +
      `${skip.shape} wrong shape) — the figures above are from the rest._`);
  }

  if (parts.length === 0) {
    // State (a), and ONLY state (a): nothing carries an estimate and the ledger is genuinely
    // empty. This sentence is now unreachable when a single record exists.
    parts.push('_No stories carry a `usage_estimate` yet, and no usage actuals recorded yet._');
  } else if (!u.hasAnyActual && (epicTable || featureTable)) {
    parts.push('_no usage actuals are attributed to a story yet — the per-epic/feature figures ' +
      'above are estimates only; run `usage-capture.js --story` (via `execute-story` / ' +
      '`execute-batch`) to record story-level actuals._');
  }
  return parts.join('\n\n');
}

// ---------- upsert ----------

function upsert(text, key, body) {
  // The marker strings come from lib/monitor-anchors.js so the block this writes and the
  // anchor the guard checks are the same string, not two that match today (STORY-28.3.03).
  const begin = monitorAnchors.markerBegin(key);
  const end = monitorAnchors.markerEnd(key);
  const re = new RegExp(`${begin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  const block = `${begin}\n${body}\n${end}`;
  if (!re.test(text)) {
    console.error(`✗ marker block '${key}' not found in MONITOR.md — add ${begin} … ${end} around the section first.`);
    process.exitCode = 2;
    return text;
  }
  return text.replace(re, block);
}

// One renderer per managed key, keyed by the SAME list the guard reads. A key added to
// MANAGED_KEYS without a renderer here is a loud error rather than a block silently left
// stale (STORY-28.3.03).
const RENDERERS = {
  overall: renderOverall,
  rollup: renderRollup,
  counts: renderCounts,
  wip: renderWip,
  usage: renderUsage,
};

function main() {
  if (!fs.existsSync(MONITOR)) { console.error(`✗ MONITOR.md not found at ${MONITOR}`); process.exit(2); }
  let text = fs.readFileSync(MONITOR, 'utf8');

  // ---- THE ANCHOR GUARD (STORY-28.3.03 / BUG-20260804-01) -------------------------
  // Before the corpus is walked and long before anything is written: every anchor this
  // script resolves must occur exactly once. `upsert()` below uses `String.replace` with
  // a non-global regex, which silently edits the FIRST match — that is precisely how a
  // duplicated MONITOR.md kept accepting writes into one of its two bodies for eight
  // phases while the other body went stale. Refusing costs one run; choosing costs a
  // forked history nobody can reconstruct afterwards.
  const guard = monitorAnchors.assertSingleAnchors(text, { file: MONITOR, who: 'pm:monitor' });
  if (!guard.ok) {
    console.error(guard.message);
    process.exit(2);
  }

  const c = compute();
  for (const key of monitorAnchors.MANAGED_KEYS) {
    const render = RENDERERS[key];
    if (typeof render !== 'function') {
      console.error(`✗ pm:monitor — no renderer for managed block '${key}'; MONITOR.md unchanged.`);
      process.exit(2);
    }
    text = upsert(text, key, render(c));
  }
  if (process.exitCode === 2) { console.error('✗ pm:monitor — aborted (missing markers); MONITOR.md unchanged.'); return; }

  // STORY-09.3.04: Write MONITOR atomically via a temp file + rename.
  // This ensures a crash mid-write cannot leave MONITOR.md in a torn state.
  const monitorDir = path.dirname(MONITOR);
  const tempPath = `${MONITOR}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tempPath, text);
    fs.renameSync(tempPath, MONITOR);
  } catch (err) {
    // If write/rename fails, try to clean up the temp file and report the error.
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch (_) {
      // Ignore cleanup errors.
    }
    console.error(`✗ pm:monitor — failed to write MONITOR.md: ${err.message}`);
    process.exit(2);
  }

  // Consume derivedEpicTimestamps: surface epics whose derived start/complete timestamps
  // differ from what is recorded in their own frontmatter (honest-timestamp advisory).
  // This is the R21 advisory companion — flags drift without writing back to epic files.
  const driftedEpics = Object.entries(c.derivedEpicTimestamps).filter(([id, d]) => {
    const epicRow = c.byEpic.get(id);
    if (!epicRow) return false;
    const efm = epicRow.epic.fm;
    return epicTimestampDrift(efm, d);
  });
  const driftNote = driftedEpics.length > 0
    ? ` | ${driftedEpics.length} epic(s) with timestamp drift vs children: ${driftedEpics.map(([id]) => id).join(', ')}`
    : '';
  console.log(`✓ pm:monitor — refreshed rollups: ${c.epics.length} epics, ${c.features.length} features, ${c.storyTotal} stories (${c.storyDone} done), ${c.testplans.length} testplans, ${c.bugs.length} bugs, ${c.adrs.length} ADRs.${driftNote}`);
}

// STORY-13.2.01: only auto-run when invoked directly (`node generate-monitor.js` / `npm run pm:monitor`).
// When require()d (e.g. by test-monitor-parser.js), expose the parser without regenerating MONITOR.md.
if (require.main === module) {
  main();
}

// Re-export from shared module for backward compatibility with test-monitor-parser.js.
// computeUsageRollup / renderUsage(Table) / fmtThousands also exported (STORY-21.2.03) so
// the usage-rollup logic is unit-testable without spawning the full generator.
module.exports = {
  parseFrontmatter, stripQuotes,
  // BUG-20260827-01 — the drift advisory's rule, exported so a test can address it.
  deriveEpicTimestamps, epicTimestampDrift,
  computeUsageRollup, renderUsage, renderUsageTable, fmtThousands,
  // STORY-29.3.01 — both paths exported so the consumer test can assert they are the SAME path
  // with no env override, rather than trusting the comment that says so.
  USAGE_LOG_PATH, CAPTURE_DEFAULT_LOG_PATH: DEFAULT_LOG_PATH,
};
