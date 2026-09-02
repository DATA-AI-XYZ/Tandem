#!/usr/bin/env node
/**
 * retro-shipped.js — derives a retro's `## What shipped` section (STORY-27.4.03, ADR-0146).
 *
 * WHY THIS IS A SCRIPT AND NOT SKILL PROSE
 *
 * STORY-27.4.03 AC-4 says the shipped list "is never hand-maintained — it is derived on every
 * run, not carried forward". Prose in a SKILL.md cannot be held to that: the only probe you can
 * write against an instruction is "does the instruction exist", and a presence check cannot tell
 * a derived list from one copied out of last month's retro. Putting the derivation in a script
 * makes the property testable the way the story states it — change the board, re-run, see the
 * output change. `skills/monthly-retro/SKILL.md` calls this file and pastes its output.
 *
 * THE ONE-QUERY RULE (AC-1)
 *
 * AC-1 asks for the shipped list to reuse "the data it already gathers for Metrics — so a
 * discrepancy between the two would be visible in the same document". A weaker reading would run
 * two queries and compare them. This file does something stronger: `storiesShipped` is
 * `shipped.filter(...).length` — literally derived FROM the list, not alongside it. The two
 * cannot disagree, because there is only one of them. A disagreement would require the renderer
 * to drop an item it was handed, which is what `derives-and-agrees` checks by parsing the
 * rendered markdown back and counting.
 *
 * WINDOW SEMANTICS
 *
 * An artefact is in-window when the DATE PART of its timestamp falls within the month. Timestamps
 * in this corpus carry a `+01:00` offset and are written by hand as often as by tooling; parsing
 * them into instants and comparing against month boundaries in some other zone would silently
 * move items across the boundary at the ends of the month. String-prefix comparison on `YYYY-MM`
 * is what a reader does when they look at the file, so it is what this does.
 *
 * Only TERMINAL-SUCCESS artefacts ship. A story `completed_at` in-window but `status: wontfix`
 * did not ship, and neither did one still `in-progress` that happens to carry a stale timestamp.
 *
 * Usage:
 *   node _00-Project-Management/93-Scripts/retro-shipped.js 2026-07
 *   node _00-Project-Management/93-Scripts/retro-shipped.js 2026-07 --pm-root <path>   (tests)
 *   node _00-Project-Management/93-Scripts/retro-shipped.js 2026-07 --json
 *
 * Exit codes: 0 = derived (an empty month is a success, not an error) · 2 = usage error.
 *
 * Dependency-free — Node stdlib only, consistent with every other `93-Scripts/` tool.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_PM_ROOT = path.resolve(__dirname, '..');

// The statuses that mean "this shipped". `wontfix`, `duplicate` and `archived` are terminal but
// are NOT ships — they are the closed set's ways of saying the work went nowhere or elsewhere.
const SHIPPED_STATUSES = new Set(['done']);

// The wording an empty period gets. Stated once, here, because `empty-month-honest` asserts a
// month with nothing in it SAYS so rather than rendering a blank section that reads as an
// omission (STORY-27.4.03 AC-3).
const NOTHING_SHIPPED = 'Nothing shipped in this period.';

function usage(msg) {
  if (msg) console.error(msg);
  console.error('usage: node retro-shipped.js <YYYY-MM> [--pm-root <path>] [--json]');
  process.exit(2);
}

/* --- minimal frontmatter reader ------------------------------------------
   Flat `key: value` only, which is all this needs. Deliberately not a YAML
   parser: the fields read here (id, title, status, completed_at, created_at)
   are scalars in every template in `91-Templates/`. */
function readFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    out[kv[1]] = kv[2].trim().replace(/^['"]|['"]$/g, '').trim();
  }
  return out;
}

function walkMd(dir) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkMd(full));
    else if (/\.md$/i.test(e.name)) out.push(full);
  }
  return out;
}

function inMonth(ts, month) {
  return typeof ts === 'string' && ts.slice(0, 7) === month;
}

function monthBounds(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''))) return null;
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { periodStart: `${month}-01`, periodEnd: `${month}-${String(lastDay).padStart(2, '0')}` };
}

/**
 * The single in-window query. Everything a retro says about the period is derived from what this
 * returns — there is no second walk.
 */
function deriveWindow(month, pmRoot) {
  const bounds = monthBounds(month);
  if (!bounds) throw new Error(`not a YYYY-MM month: ${month}`);
  const root = pmRoot || DEFAULT_PM_ROOT;

  const shipped = [];
  for (const file of walkMd(path.join(root, '32-Stories'))) {
    const fm = readFrontmatter(fs.readFileSync(file, 'utf8'));
    if (!fm || !fm.id) continue;
    if (!SHIPPED_STATUSES.has(String(fm.status || '').toLowerCase())) continue;
    if (!inMonth(fm.completed_at, month)) continue;
    shipped.push({
      id: fm.id,
      title: fm.title || '',
      epic: fm.epic || '',
      completed_at: fm.completed_at,
      file: path.relative(root, file).split(path.sep).join('/'),
    });
  }
  shipped.sort((a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true }));

  const bugsFiled = [];
  const bugsFixed = [];
  for (const file of walkMd(path.join(root, '34-Bugs'))) {
    const fm = readFrontmatter(fs.readFileSync(file, 'utf8'));
    if (!fm || !fm.id) continue;
    if (inMonth(fm.created_at, month)) bugsFiled.push(fm.id);
    if (String(fm.status || '').toLowerCase() === 'done' && inMonth(fm.completed_at, month)) bugsFixed.push(fm.id);
  }

  const adrs = [];
  for (const file of walkMd(path.join(root, '40-Decisions'))) {
    const fm = readFrontmatter(fs.readFileSync(file, 'utf8'));
    if (!fm || !fm.id) continue;
    if (inMonth(fm.created_at, month)) adrs.push(fm.id);
  }

  return {
    month,
    periodStart: bounds.periodStart,
    periodEnd: bounds.periodEnd,
    shipped,
    metrics: {
      // DERIVED FROM `shipped`, not counted by a second query. See the header note.
      storiesShipped: shipped.length,
      bugsFiled: bugsFiled.length,
      bugsFixed: bugsFixed.length,
      adrsCreated: adrs.length,
    },
  };
}

/** The markdown body for `## What shipped`. Never returns an empty string. */
function renderWhatShipped(result) {
  if (!result || !result.shipped || result.shipped.length === 0) return NOTHING_SHIPPED;
  const byEpic = new Map();
  for (const s of result.shipped) {
    const key = s.epic || 'Unassigned';
    if (!byEpic.has(key)) byEpic.set(key, []);
    byEpic.get(key).push(s);
  }
  const epics = [...byEpic.keys()].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const lines = [];
  for (const epic of epics) {
    if (epics.length > 1 || epic !== 'Unassigned') lines.push(`**${epic}**`);
    for (const s of byEpic.get(epic)) lines.push(`- ${s.id} — ${s.title || '(no title)'}`);
    lines.push('');
  }
  return lines.join('\n').trim();
}

function main(argv) {
  const args = argv.slice(2);
  let month = null;
  let pmRoot = null;
  let asJson = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--pm-root') { pmRoot = args[++i]; if (!pmRoot) usage('--pm-root requires a path'); }
    else if (a === '--json') asJson = true;
    else if (a.indexOf('--') === 0) usage(`unknown argument "${a}"`);
    else if (month === null) month = a;
    else usage(`unexpected argument "${a}"`);
  }
  if (!month) usage('a target month (YYYY-MM) is required');
  if (!monthBounds(month)) usage(`not a YYYY-MM month: ${month}`);

  const result = deriveWindow(month, pmRoot);
  if (asJson) { console.log(JSON.stringify(result, null, 2)); return 0; }

  console.log(`## What shipped`);
  console.log('');
  console.log(renderWhatShipped(result));
  console.log('');
  console.log(`<!-- derived ${result.month} · stories shipped: ${result.metrics.storiesShipped}`
    + ` · bugs filed/fixed: ${result.metrics.bugsFiled}/${result.metrics.bugsFixed}`
    + ` · ADRs: ${result.metrics.adrsCreated} -->`);
  return 0;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = {
  deriveWindow, renderWhatShipped, monthBounds, readFrontmatter,
  NOTHING_SHIPPED, SHIPPED_STATUSES, DEFAULT_PM_ROOT,
};
