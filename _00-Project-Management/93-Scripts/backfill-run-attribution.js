'use strict';
/**
 * backfill-run-attribution.js — complete an ABSENT or FALSE attribution key, with provenance.
 *
 * Authorised by ADR-0216, ruled by the operator at the autopilot-2026-08-11-e31-run01 entry gate,
 * remediating BUG-20260818-03(a). Read ADR-0216 before changing anything here: this script edits
 * rows that ADR-0165 otherwise protects, and the ONLY thing that makes that defensible is the
 * narrowness enforced below.
 *
 * ============================================================================
 * WHAT IT MAY MOVE — AND THE ASSERTION THAT PROVES IT
 * ============================================================================
 * run_id, join_key, run_id_source. Nothing else. Every other field is compared key-by-key,
 * value-by-value (JSON-canonical) between the parsed input row and the output row, and the script
 * REFUSES TO WRITE if any of them moved. ADR-0216 clause 2: a promise in a commit message is not a
 * control, the assertion is.
 *
 * One line in, one line out. Line count, order, and every untouched row's bytes are preserved.
 *
 * ============================================================================
 * KEYED ON ts, NEVER ON id (BUG-20260818-03's explicit caution)
 * ============================================================================
 * Usage rows carry the bare CHAT-NN form, and CHAT-05 appears five times in this ledger belonging
 * to entirely different epics. A backfill keyed on id would corrupt four rows to repair one.
 * ts is the only field that is unique per row and independent of the defect.
 *
 * ============================================================================
 * TWO SIGNALS, AND AMBIGUITY IS LEFT ALONE
 * ============================================================================
 *   ts window   — the row's ts falls between a run's start and its recorded terminal instant
 *   plan scope  — the run plan's scope_chats / scope_stories names the row's unit
 *
 * Both agree on exactly one run  -> repair, run_id_source "derived:scope+window"
 * Scope names exactly one run, no truthful window
 *                                -> repair, run_id_source "derived:scope" (weaker, and says so)
 * Row carries a FALSE run_id     -> repair, run_id_source "corrected:<prior>" (prior preserved)
 * Zero runs, or more than one    -> LEAVE EXACTLY AS IS.
 *
 * That last line is the important one. An honest unattributed-run beats a guessed attribution —
 * the whole point of ADR-0179's marker. This script would rather do nothing than invent.
 *
 * The no-truthful-window case is real, not hypothetical: e30-run02's checkpoint was never written
 * until its close, so its recorded started_at POST-DATES its own work. Its rows therefore fall
 * outside its own window, and scope-uniqueness is all that carries them.
 *
 * Usage: node backfill-run-attribution.js [--apply] [--reports-dir <path>]
 *        Dry-run by default. --apply writes. Exit 0 clean, 1 on a refusal.
 *
 * Node stdlib only.
 */

const fs = require('fs');
const path = require('path');

const PM_ROOT = path.join(__dirname, '..');
const DEFAULT_REPORTS = path.join(PM_ROOT, '41-Reports');

/** Fields this script is permitted to add or change. Anything else moving is a refusal. */
const MUTABLE = Object.freeze(['run_id', 'join_key', 'run_id_source']);

const BARE_CHAT = /^CHAT-(\d+)$/i;
const QUALIFIED_CHAT = /^E(\d+)-CHAT-(\d+)$/i;
const STORY_ID = /^STORY-(\d+)\.\d+\.\d+$/i;
const PHASE_ID = /^EPIC-(\d+)-P\d+$/i;

const strip = s => String(s).trim().replace(/^['"]|['"]$/g, '');
const norm = v => String(v === undefined || v === null ? '' : v).trim().toUpperCase();

function isoOrNull(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Read every run plan on disk -> { run_id: { scope:Set, epics:Set, start?, end? } }. */
function readRuns(reportsDir) {
  const runs = {};
  let names;
  try { names = fs.readdirSync(reportsDir); } catch { return runs; }

  for (const name of names.filter(n => /^AUTOPILOT-PLAN-.+\.md$/.test(n))) {
    let text;
    try { text = fs.readFileSync(path.join(reportsDir, name), 'utf8'); } catch { continue; }
    const m = /^run_id:\s*(.+)$/m.exec(text);
    if (!m) continue;
    const runId = strip(m[1]);
    if (!runId) continue;

    const scope = new Set();
    const epics = new Set();
    for (const key of ['scope_chats', 'scope_stories']) {
      const block = new RegExp('^' + key + ':\\s*\\r?\\n((?:[ \\t]*-[ \\t].*\\r?\\n)*)', 'm').exec(text);
      if (!block) continue;
      for (const line of block[1].split(/\r?\n/)) {
        const e = /^[ \t]*-[ \t]*(.*)$/.exec(line);
        if (!e) continue;
        const v = norm(strip(e[1]));
        if (!v) continue;
        scope.add(v);
        // The run's epic set comes from the ids that CARRY an epic. A bare CHAT-NN carries none —
        // which is exactly why it cannot identify a run on its own.
        const q = QUALIFIED_CHAT.exec(v) || STORY_ID.exec(v);
        if (q) epics.add(Number(q[1]));
      }
    }
    if (scope.size) runs[runId] = { scope, epics };
  }

  // Windows, from whichever checkpoint records them.
  for (const name of names.filter(n => /^AUTOPILOT-CHECKPOINT.*\.json$/.test(n))) {
    let c;
    try { c = JSON.parse(fs.readFileSync(path.join(reportsDir, name), 'utf8')); } catch { continue; }
    if (!c || !c.run_id || !runs[c.run_id]) continue;
    const r = runs[c.run_id];
    const s = isoOrNull(c.started_at);
    const e = isoOrNull(c.terminal && c.terminal.at);
    if (s) r.start = r.start && r.start < s ? r.start : s;
    if (e) r.end = r.end && r.end > e ? r.end : e;
  }
  return runs;
}

/** Does run declare the unit id in its plan scope? Handles bare<->qualified chat forms. */
function scopeDeclares(run, id) {
  const v = norm(id);
  if (!v) return false;
  if (run.scope.has(v)) return true;

  const q = QUALIFIED_CHAT.exec(v);
  if (q) {
    // E30-CHAT-07 matches a bare CHAT-07 only when this run actually works on epic 30.
    return run.scope.has('CHAT-' + q[2]) && run.epics.has(Number(q[1]));
  }
  const b = BARE_CHAT.exec(v);
  if (b) {
    for (const s of run.scope) {
      const qq = QUALIFIED_CHAT.exec(s);
      if (qq && Number(qq[2]) === Number(b[1]) && run.epics.has(Number(qq[1]))) return true;
    }
  }
  return false;
}

/** A phase row (EPIC-29-P1) is in no scope list; it belongs to a run working that epic. */
function epicOf(id) {
  const p = PHASE_ID.exec(norm(id));
  return p ? Number(p[1]) : null;
}

function inWindow(run, ts) {
  if (!run.start || !run.end || !ts) return false;
  return ts >= run.start && ts <= run.end;
}

/**
 * The row's units, SPLIT BY STRENGTH — because a union over all of them is wrong.
 *
 * A retro story row carries BOTH id: "STORY-30.4.01" (globally unique) and chat: "CHAT-05" (bare,
 * and therefore not). Matching on the union let the weak field drag in a spurious candidate: bare
 * CHAT-05 also matches E29-CHAT-05 in the 08-05 run, so a row whose own id names exactly one run
 * resolved as "ambiguous" and was left unrepaired. The strong unit must win outright when one
 * exists — that is the whole lesson of BUG-20260810-07/08, applied to the matcher rather than
 * only to the key.
 */
function unitsOf(rec) {
  const all = [rec.id, rec.join_key, rec.chat].filter(v => typeof v === 'string' && v.trim() !== '');
  const strong = all.filter(v => STORY_ID.test(norm(v)) || QUALIFIED_CHAT.test(norm(v)));
  const weak = all.filter(v => BARE_CHAT.test(norm(v)));
  return { strong, weak };
}

/**
 * The epic this row itself declares, from its own `phase` field (`EPIC-30`) or from a strong unit.
 * Free disambiguation that was being thrown away: a row stamped EPIC-30 cannot belong to a run
 * that works only epics 28/29/32, however its bare chat id happens to collide.
 */
function declaredEpic(rec) {
  const p = /^EPIC-0*(\d+)/i.exec(norm(rec.phase));
  if (p) return Number(p[1]);
  for (const v of [rec.id, rec.join_key]) {
    const m = STORY_ID.exec(norm(v)) || QUALIFIED_CHAT.exec(norm(v));
    if (m) return Number(m[1]);
  }
  return null;
}

/** Does this run own this row on the SCOPE signal alone? */
function ownsByScope(run, rec) {
  const phaseEpic = epicOf(rec.id);
  if (phaseEpic !== null) return run.epics.has(phaseEpic);

  const { strong, weak } = unitsOf(rec);
  // A strong unit is globally unique, so it answers on its own and a weak one may not override it.
  if (strong.length) return strong.some(u => scopeDeclares(run, u));

  // Only bare forms left. They collide across epics, so the row's own declared epic must agree.
  if (!weak.length) return false;
  const epic = declaredEpic(rec);
  if (epic !== null && !run.epics.has(epic) && !run.scope.has(norm(rec.id))) return false;
  return weak.some(u => scopeDeclares(run, u));
}

/** Resolve the run a row belongs to. Returns { runId, source } or null when ambiguous. */
function resolve(runs, rec) {
  const ts = isoOrNull(rec.ts);
  const phaseEpic = epicOf(rec.id);

  const byScope = [];
  const byWindow = [];
  for (const [runId, run] of Object.entries(runs)) {
    if (ownsByScope(run, rec)) byScope.push(runId);
    if (inWindow(run, ts)) byWindow.push(runId);
  }

  const both = byScope.filter(r => byWindow.includes(r));
  if (both.length === 1) return { runId: both[0], source: 'derived:scope+window' };
  // A phase row has no scope entry that makes it unique — scope-only would be epic-wide, and an
  // epic can span runs. Refuse rather than spread a phase row across a guess.
  if (byScope.length === 1 && phaseEpic === null) return { runId: byScope[0], source: 'derived:scope' };
  return null;
}

/** The epic-qualified join key for a bare chat id, once the owning run (and so the epic) is known. */
function qualifiedKey(rec, runs, runId) {
  const b = BARE_CHAT.exec(norm(rec.id));
  if (!b) return undefined;
  const epics = [...runs[runId].epics];
  if (epics.length !== 1) return undefined;   // an ambiguous epic cannot qualify anything
  return 'E' + epics[0] + '-CHAT-' + b[1];
}

function processLedger(file, runs, apply, report) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return 0; }
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const out = [];
  let changed = 0;

  lines.forEach((line, i) => {
    if (line.trim() === '') { out.push(line); return; }
    let rec;
    try { rec = JSON.parse(line); } catch { out.push(line); return; }   // malformed stays malformed

    const cur = Object.prototype.hasOwnProperty.call(rec, 'run_id') ? rec.run_id : undefined;
    if (cur === undefined) { out.push(line); return; }        // pre-field history, never touched

    const resolved = resolve(runs, rec);
    let source = null;

    if (cur === 'unattributed-run') {
      if (!resolved) { out.push(line); return; }              // ambiguous -> leave alone
      source = resolved.source;
    } else {
      // A row that already names a run: repair ONLY when that run's plan demonstrably does not
      // declare it — a FALSE attribution (ADR-0216 clause 6), not merely a different one.
      const owner = runs[cur];
      if (!owner || ownsByScope(owner, rec)) { out.push(line); return; }
      if (!resolved || resolved.runId === cur) { out.push(line); return; }
      source = 'corrected:' + cur;
    }

    const next = JSON.parse(line);                             // fresh parse; never share a ref
    next.run_id = resolved.runId;
    next.run_id_source = source;
    if (next.join_key === null || next.join_key === undefined) {
      const k = qualifiedKey(rec, runs, resolved.runId);
      if (k) next.join_key = k;
    }

    // ---- ADR-0216 clause 2: PROVE nothing but the mutable three moved. ----------------------
    const before = JSON.parse(line);
    const keys = new Set([...Object.keys(before), ...Object.keys(next)]);
    for (const k of keys) {
      if (MUTABLE.includes(k)) continue;
      if (JSON.stringify(before[k]) !== JSON.stringify(next[k])) {
        throw new Error(
          'REFUSING TO WRITE: ' + path.basename(file) + ' line ' + (i + 1) +
          ' would change immutable field ' + k + ': ' +
          JSON.stringify(before[k]) + ' -> ' + JSON.stringify(next[k]));
      }
    }

    report.push({
      file: path.basename(file), line: i + 1, id: rec.id, ts: rec.ts,
      from: cur, to: next.run_id, source,
      join_key: before.join_key === next.join_key
        ? undefined
        : JSON.stringify(before.join_key) + ' -> ' + JSON.stringify(next.join_key),
    });
    out.push(JSON.stringify(next));
    changed += 1;
  });

  if (changed && apply) fs.writeFileSync(file, out.join(eol));
  return changed;
}

function main(argv) {
  const apply = argv.includes('--apply');
  const di = argv.indexOf('--reports-dir');
  const reportsDir = di !== -1 && argv[di + 1] ? argv[di + 1] : DEFAULT_REPORTS;

  const runs = readRuns(reportsDir);
  if (Object.keys(runs).length === 0) {
    console.error('no run plans found under ' + reportsDir + ' — nothing can be derived');
    return 1;
  }

  const report = [];
  let total = 0;
  for (const rel of [['retro', 'retro-log.jsonl'], ['usage', 'usage-log.jsonl']]) {
    total += processLedger(path.join(reportsDir, rel[0], rel[1]), runs, apply, report) || 0;
  }

  const bySource = {};
  for (const r of report) bySource[r.source] = (bySource[r.source] || 0) + 1;

  console.log((apply ? 'APPLIED' : 'DRY RUN') + ' — ' + total + ' row(s) repaired\n');
  for (const r of report) {
    console.log('  ' + r.file + ':' + r.line + '  ' + String(r.id).padEnd(16) + ' ' + r.ts);
    console.log('      run_id: ' + JSON.stringify(r.from) + ' -> ' + JSON.stringify(r.to) + '   [' + r.source + ']');
    if (r.join_key) console.log('      join_key: ' + r.join_key);
  }
  console.log('\n  by provenance: ' + JSON.stringify(bySource, null, 0));
  if (!apply) console.log('\n  re-run with --apply to write.');
  return 0;
}

if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = { readRuns, scopeDeclares, ownsByScope, resolve, MUTABLE };
