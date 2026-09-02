#!/usr/bin/env node
/**
 * reconcile.js — pm:reconcile: derive parent (feature/epic) status + timestamps from children.
 *
 * STORY-35.3.05 — makes the 2026-08-27 hand sweep (commit 652fb172: 18 features + 1 epic
 * reconciled by hand) repeatable, implementing the board-reconciliation rules of
 * BACKLOG-0232 Tranches B–C:
 *
 *   status derivation (from child STORIES only — feature ← story.feature, epic ← story.epic;
 *   parents never derive from each other, so the epic↔feature reading reconciles transitively):
 *     - all children terminal (done/wontfix/duplicate/archived) with >=1 'done'  → done
 *     - all children terminal-or-blocked with >=1 'blocked'                      → blocked
 *       (NOT "any blocked child": any 'in-progress' child means work is moving, so
 *        in-progress beats blocked — the precedence lives in the all-terminal-or-blocked
 *        conjunct below)
 *     - otherwise, any child beyond 'not-started'/'ready'                        → in-progress
 *     - all children still 'not-started'/'ready', or all-terminal with zero 'done'
 *       (a parent over all-wontfix children is a human call)                     → no change
 *
 *   timestamp derivation:
 *     - started_at   = EARLIEST child started_at (any derived non-not-started status)
 *     - completed_at = LATEST child completed_at (only when the derived status is 'done')
 *   Derived stamps are historical (copied from children already on disk), never ahead of the
 *   commit that records them — so R29/W8's timestamp-vs-recording-commit arm stays quiet.
 *
 * Guards (ADR-0278):
 *   - a parent whose OWN status is terminal is settled and never reconciled
 *     (the FEAT-15.1 wontfix-over-done-children class);
 *   - zero-children parents are never reconciled (R21's existing guard, kept);
 *   - writes ONLY the `status` / `started_at` / `completed_at` frontmatter lines on parent
 *     files — `created_at` and everything else stays byte-identical;
 *   - never regenerates the board, never touches MONITOR — one job, mechanically.
 *
 * Usage:
 *   node _00-Project-Management/93-Scripts/reconcile.js                 dry-run over the live corpus
 *   node _00-Project-Management/93-Scripts/reconcile.js --apply         write the derived values
 *   node ...reconcile.js --fixtures-dir <dir> [--apply]                 flat fixtures dir instead
 *   npm run pm:reconcile [-- --apply]
 *
 * Exit codes: 0 — ran (dry-run findings do NOT fail the process) · 2 — usage/script error.
 *
 * Dependency-free — Node stdlib only, matching every sibling script.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('./lib/frontmatter');
// One status vocabulary, one owner: the validator exports the enum it enforces
// (the STORY-26.5.05 stance — a second hand-written copy is how two tools come to
// disagree about what 'wontfix' means). require() is safe: validate-frontmatter.js
// guards its main() behind require.main.
const { TERMINAL_STATUSES } = require('./validate-frontmatter.js');

const PM_ROOT = path.resolve(__dirname, '..');
const { loadPaths } = require('./lib/pm-paths');

// ---------- CLI ----------
let FIXTURES_DIR = null;
let APPLY = false;
function parseArgs(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--fixtures-dir') {
      const val = argv[i + 1];
      // A present-but-valueless flag must NOT silently fall back to the live corpus
      // (same guard as validate-frontmatter.js).
      if (!val || val.startsWith('--')) {
        console.error('✗ --fixtures-dir requires a directory path argument');
        process.exit(2);
      }
      FIXTURES_DIR = path.resolve(val);
      i++;
    } else if (argv[i] === '--apply') {
      APPLY = true;
    }
  }
}

// ---------- corpus ----------
function walk(dir, list = []) {
  if (!fs.existsSync(dir)) return list;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name === '__fixtures__') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, list);
    else if (entry.isFile() && entry.name.endsWith('.md')) list.push(full);
  }
  return list;
}

/** Read every artefact under the scan roots; returns [{ file, fm }] with parseable frontmatter. */
function collectCorpus(fixturesDir, pmRoot) {
  const files = [];
  if (fixturesDir) {
    walk(fixturesDir, files);
  } else {
    const map = loadPaths(pmRoot).map;
    for (const key of ['epics', 'features', 'stories']) {
      walk(path.join(pmRoot, map[key]), files);
    }
  }
  const out = [];
  for (const file of files) {
    const fm = parseFrontmatter(fs.readFileSync(file, 'utf8'));
    if (fm) out.push({ file, fm });
  }
  return out;
}

// ---------- derivation (pure — exported for the paired unit test) ----------

/**
 * Derive a parent's status from its children's statuses.
 * @param {Array<{status:string}|string>} children
 * @returns {string|null} derived status, or null when nothing should change mechanically.
 */
function deriveParentStatus(children) {
  const sts = (children || []).map(c => (typeof c === 'string' ? c : c && c.status));
  if (sts.length === 0) return null; // zero-children guard
  const isTerminal = (s) => TERMINAL_STATUSES.has(s);
  const allTerminal = sts.every(isTerminal);
  const anyDone = sts.some(s => s === 'done');
  if (allTerminal) return anyDone ? 'done' : null; // all-wontfix/duplicate/archived: human call
  // Blocked derivation is NOT "any blocked child" (BACKLOG-0232 Tranche C): the
  // all-terminal-or-blocked conjunct is the blocked-vs-in-progress precedence — one
  // 'in-progress' child defeats it and the parent derives in-progress below.
  const allTerminalOrBlocked = sts.every(s => isTerminal(s) || s === 'blocked');
  const anyBlocked = sts.some(s => s === 'blocked');
  if (allTerminalOrBlocked && anyBlocked) return 'blocked';
  const anyStarted = sts.some(s => s !== 'not-started' && s !== 'ready');
  if (anyStarted) return 'in-progress';
  return null; // every child still not-started/ready — nothing to derive
}

/**
 * Derive the parent's timestamp window from its children.
 * started_at = earliest parseable child started_at; completed_at = latest parseable child
 * completed_at, and ONLY when the derived status is 'done' (a blocked/in-progress parent has
 * no completion instant — TC-03 asserts completed_at stays empty on the blocked fixture).
 * @returns {{ started_at: string|null, completed_at: string|null }}
 */
function deriveParentWindow(children, derivedStatus) {
  let started = null, startedMs = Infinity;
  let completed = null, completedMs = -Infinity;
  for (const c of (children || [])) {
    const s = String((c && c.started_at) || '').trim();
    if (s) {
      const t = Date.parse(s);
      if (!Number.isNaN(t) && t < startedMs) { startedMs = t; started = s; }
    }
    const e = String((c && c.completed_at) || '').trim();
    if (e) {
      const t = Date.parse(e);
      if (!Number.isNaN(t) && t > completedMs) { completedMs = t; completed = e; }
    }
  }
  return {
    started_at: started,
    completed_at: derivedStatus === 'done' ? completed : null,
  };
}

/**
 * Analyse a parsed corpus: returns the pending reconciliations.
 * Pure over its input (no writes). Exported for doctor.js's read-only count and the test.
 * @param {Array<{file:string, fm:Object}>} corpus
 * @returns {Array<{file, id, type, fromStatus, toStatus, started_at, completed_at, fields}>}
 */
function analyse(corpus) {
  const byFeature = new Map();
  const byEpic = new Map();
  for (const { fm } of corpus) {
    if (!fm || fm.type !== 'story') continue;
    const child = {
      id: fm.id, status: fm.status,
      started_at: fm.started_at, completed_at: fm.completed_at,
    };
    if (fm.feature) {
      if (!byFeature.has(fm.feature)) byFeature.set(fm.feature, []);
      byFeature.get(fm.feature).push(child);
    }
    if (fm.epic) {
      if (!byEpic.has(fm.epic)) byEpic.set(fm.epic, []);
      byEpic.get(fm.epic).push(child);
    }
  }

  const pending = [];
  for (const { file, fm } of corpus) {
    if (!fm || !fm.id || !fm.status) continue;
    if (fm.type !== 'feature' && fm.type !== 'epic') continue;
    // Terminal-parent guard (ADR-0278): a settled parent is never reconciled.
    if (TERMINAL_STATUSES.has(fm.status)) continue;
    const children = (fm.type === 'feature' ? byFeature : byEpic).get(fm.id) || [];
    if (children.length === 0) continue; // zero-children guard
    const derived = deriveParentStatus(children);
    if (!derived) continue;
    const window = deriveParentWindow(children, derived);

    const fields = {};
    if (fm.status !== derived) fields.status = derived;
    const curStarted = String(fm.started_at || '').trim();
    if (window.started_at && curStarted !== window.started_at) {
      fields.started_at = window.started_at;
    }
    const curCompleted = String(fm.completed_at || '').trim();
    if (window.completed_at && curCompleted !== window.completed_at) {
      fields.completed_at = window.completed_at;
    }
    if (Object.keys(fields).length === 0) continue;
    pending.push({
      file, id: fm.id, type: fm.type,
      fromStatus: fm.status, toStatus: derived,
      started_at: window.started_at, completed_at: window.completed_at,
      fields,
    });
  }
  return pending;
}

/** Convenience for doctor.js: pending reconciliations over a live PM tree, read-only. */
function analyseTree(pmRoot) {
  return analyse(collectCorpus(null, pmRoot || PM_ROOT));
}

// ---------- writer ----------

/**
 * Rewrite ONLY the named keys' lines inside the file's first frontmatter block.
 * status is written bare; timestamps are written single-quoted (the corpus style).
 * A key line that does not exist is left alone — every kit template carries all three.
 */
function applyFields(file, fields) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  if (lines[0].replace(/\r$/, '') !== '---') return false;
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].replace(/\r$/, '') === '---') { end = i; break; }
  }
  if (end === -1) return false;
  for (let i = 1; i < end; i++) {
    const eol = lines[i].endsWith('\r') ? '\r' : '';
    if (fields.status !== undefined && /^status:/.test(lines[i])) {
      lines[i] = `status: ${fields.status}${eol}`;
    } else if (fields.started_at !== undefined && /^started_at:/.test(lines[i])) {
      lines[i] = `started_at: '${fields.started_at}'${eol}`;
    } else if (fields.completed_at !== undefined && /^completed_at:/.test(lines[i])) {
      lines[i] = `completed_at: '${fields.completed_at}'${eol}`;
    }
  }
  fs.writeFileSync(file, lines.join('\n'));
  return true;
}

// ---------- CLI main ----------

function rel(p) {
  return path.relative(FIXTURES_DIR || PM_ROOT, p).replace(/\\/g, '/');
}

function main() {
  parseArgs(process.argv.slice(2));
  const corpus = collectCorpus(FIXTURES_DIR, PM_ROOT);
  const pending = analyse(corpus);

  if (pending.length === 0) {
    console.log('✓ pm:reconcile — parents agree with their children (0 changes).');
    process.exit(0);
  }

  for (const p of pending) {
    const parts = [];
    if (p.fields.status !== undefined) parts.push(`status ${p.fromStatus} → ${p.toStatus}`);
    if (p.fields.started_at !== undefined) parts.push(`started_at → '${p.fields.started_at}'`);
    if (p.fields.completed_at !== undefined) parts.push(`completed_at → '${p.fields.completed_at}'`);
    const verb = APPLY ? 'reconciled' : 'would reconcile';
    console.log(`  ${verb} ${p.id} (${rel(p.file)}): ${parts.join('; ')}`);
    if (APPLY) applyFields(p.file, p.fields);
  }

  if (APPLY) {
    console.log(`✓ pm:reconcile — ${pending.length} parent(s) reconciled.`);
  } else {
    console.log(`ℹ pm:reconcile — ${pending.length} parent(s) out of sync (dry-run; nothing ` +
      `written). Re-run with --apply to write the derived values.`);
  }
  process.exit(0);
}

module.exports = { deriveParentStatus, deriveParentWindow, analyse, analyseTree, collectCorpus };

if (require.main === module) {
  main();
}
