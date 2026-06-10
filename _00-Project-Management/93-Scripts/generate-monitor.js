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

const PM_ROOT = path.resolve(__dirname, '..');
// Resolve logical PM sub-folder names through the layout map (full / flattened /
// custom). PATHS.<logical> → physical folder name for this project. See lib/pm-paths.js.
const { loadPaths } = require('./lib/pm-paths');
const PATHS = loadPaths(PM_ROOT).map;
const MONITOR = path.join(PM_ROOT, PATHS.monitor, 'MONITOR.md');
const CHANGELOG = path.join(PM_ROOT, '..', 'CHANGELOG.md');

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

  return {
    epics, features, stories, testplans, bugs, adrs, backlog, releaseCount, prds,
    storyDone, storyTotal, byEpic, wip, derivedEpicTimestamps,
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

// ---------- upsert ----------

function upsert(text, key, body) {
  const begin = `<!-- pm:monitor:${key}:begin (generated by pm:monitor — do not edit by hand) -->`;
  const end = `<!-- pm:monitor:${key}:end -->`;
  const re = new RegExp(`${begin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  const block = `${begin}\n${body}\n${end}`;
  if (!re.test(text)) {
    console.error(`✗ marker block '${key}' not found in MONITOR.md — add ${begin} … ${end} around the section first.`);
    process.exitCode = 2;
    return text;
  }
  return text.replace(re, block);
}

function main() {
  if (!fs.existsSync(MONITOR)) { console.error(`✗ MONITOR.md not found at ${MONITOR}`); process.exit(2); }
  const c = compute();
  let text = fs.readFileSync(MONITOR, 'utf8');
  text = upsert(text, 'overall', renderOverall(c));
  text = upsert(text, 'rollup', renderRollup(c));
  text = upsert(text, 'counts', renderCounts(c));
  text = upsert(text, 'wip', renderWip(c));
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
    return (d.derivedStartedAt && efm.started_at !== d.derivedStartedAt) ||
           (d.derivedCompletedAt && efm.completed_at !== d.derivedCompletedAt);
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
module.exports = { parseFrontmatter, stripQuotes };
