'use strict';
/**
 * migrate-reports.js — STORY-27.3.03 (BACKLOG-0103 Tranche C).
 *
 * Moves the flat `41-Reports/` corpus into the topic folders ADR-0141 describes.
 * Run once; kept afterwards because the MAPPING is the durable artefact — it is
 * what "where does this kind of report live" means, and STORY-27.3.04 teaches the
 * writer skills the same answers.
 *
 *   node migrate-reports.js --dry-run   # writes 41-Reports/MIGRATION-DRYRUN.txt, moves nothing
 *   node migrate-reports.js --apply     # git mv, one file at a time
 *
 * --------------------------------------------------------------------------
 * THREE RULES THIS SCRIPT ENFORCES, EACH OF WHICH EXISTS BECAUSE THE OBVIOUS
 * ALTERNATIVE FAILS SILENTLY:
 *
 * 1. EVERY FILE MUST MATCH AN EXPLICIT RULE. There is no catch-all bucket. A
 *    filename no rule claims is a HARD STOP, not a file quietly swept into
 *    `audits/`. A catch-all would have made this script pass on a corpus it had
 *    never seen, which is the same class of mistake as a probe that cannot fail.
 *
 * 2. `git mv`, ONE FILE AT A TIME. History follows the file (AC-2) and the moves
 *    stage atomically. A shell `mv` + `git add` looks identical in the tree and
 *    loses the rename detection that `git log --follow` needs.
 *
 * 3. THE CONTROL PLANE DOES NOT MOVE. See ROOT_CONTROL_PLANE below.
 * --------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PM_ROOT = path.join(__dirname, '..');
const REPO_ROOT = path.join(PM_ROOT, '..');
const REPORTS_DIR = path.join(PM_ROOT, '41-Reports');
const DRYRUN_PATH = path.join(REPORTS_DIR, 'MIGRATION-DRYRUN.txt');

// ADR-0141's registry. These three are machine-append ledgers and binary assets,
// not reports; they are already folders and they are NOT touched.
const LEDGER_DIRS = require('./lib/report-tree.js').LEDGER_DIRS;

/**
 * THE CONTROL PLANE — files that stay at the flat root.
 *
 * `skills/autopilot/SKILL.md` hard-codes `41-Reports/AUTOPILOT-CHECKPOINT.json`
 * as the resume path and `41-Reports/AUTOPILOT-RUN-<date>.md` as the run log;
 * `skills/execute-batch/SKILL.md` globs `41-Reports/EXECUTION-STRATEGY-*.json`.
 * Those are prose instructions an agent follows LITERALLY — no reader module sits
 * between the path and the read, so the shape-agnostic reader (ADR-0141) cannot
 * save them. A run is executing this migration right now out of exactly these
 * files.
 *
 * The exemption is stated as a FAMILY, not as a list of today's filenames: root
 * placement is legal for the whole family, so a sidecar archived into
 * `execution-strategy/` later is legal too and the guard stays quiet either way.
 * What the migration actually archives is narrower — see ARCHIVE_EXCEPT below.
 */
// ONE definition, in lib/report-tree.js beside LEDGER_DIRS. A copy here would be
// the "fixed in one place, not its sibling" failure that has already cost this
// phase five separate defects: the migration and the guard that polices its
// result would drift, and the drift would look like a passing test.
const ROOT_CONTROL_PLANE = require('./lib/report-tree.js').ROOT_EXEMPT;

/**
 * Of the control-plane family, the sidecars the IN-FLIGHT run addresses by path
 * are the ones that must not move today. Everything older is a closed run's
 * record and is archived. This is a one-time migration boundary, not a standing
 * rule — nothing asserts it afterwards.
 */
const ARCHIVE_EXCEPT = [
  /^AUTOPILOT-/,                        // the whole autopilot control plane
  /^EXECUTION-STRATEGY-2026-08-01/,     // the EPIC-27 run in flight
];

/**
 * THE MAPPING. Ordered; first match wins. Every rule is a named prefix family —
 * no regex here means "anything else".
 */
const RULES = [
  { dir: 'reviews',            test: (n) => /^AI-CODE-REVIEW-/i.test(n) || /^PEER-REVIEW-/i.test(n) },
  { dir: 'phases',             test: (n) => /^PHASE-/i.test(n) },
  { dir: 'execution-strategy', test: (n) => /^EXECUTION-STRATEGY-/i.test(n) },
  { dir: 'explorations',       test: (n) => /^EXPLORATION-/i.test(n) },
  { dir: 'boards',             test: (n) => /^BACKLOG-BOARD/i.test(n) },
  { dir: 'baselines',          test: (n) => /^card-grid-baseline/i.test(n) },
  { dir: 'audits',             test: (n) => /^IA-DRIFT-AUDIT-/i.test(n)
                                          || /^EPIC-TIMESTAMP-AUDIT-/i.test(n)
                                          || /^COMMAND-DISPLAY-AUDIT-/i.test(n)
                                          || /^PARITY-INVENTORY-/i.test(n)
                                          || /^REMEDIATION-/i.test(n)
                                          || /^PLAN-DRIFT-/i.test(n)
                                          || /^WORKED-EXAMPLE-/i.test(n) },
];

// Bookkeeping produced by this script; not a report and never moved.
const SCRIPT_ARTEFACTS = [/^MIGRATION-DRYRUN\.txt$/];

function isControlPlane(name) {
  return ROOT_CONTROL_PLANE.some((re) => re.test(name));
}

function stays(name) {
  if (SCRIPT_ARTEFACTS.some((re) => re.test(name))) return 'script bookkeeping';
  if (ARCHIVE_EXCEPT.some((re) => re.test(name))) return 'control plane, in flight';
  // The shared registry, consulted for real. Until BUG-20260804-10 this function
  // asked ARCHIVE_EXCEPT only, and `isControlPlane` — the whole point of importing
  // ROOT_EXEMPT from the module the GUARD reads — was exported but never called.
  // ARCHIVE_EXCEPT's strategy arm is pinned to `EXECUTION-STRATEGY-2026-08-01`, so a
  // later run's sidecar (`EXECUTION-STRATEGY-2026-09-15.json`) matched no exception,
  // fell through to RULES, and would have been moved into `execution-strategy/` —
  // out from under `skills/execute-batch`, which globs it at the root by hard-coded
  // path. That is the exact "fixed in one place, not its sibling" drift the header
  // above claims this import prevents.
  if (isControlPlane(name)) return 'control plane (ROOT_EXEMPT, ADR-0143)';
  return null;
}

/** Destination folder for a root-level report, or null when it stays put. */
function destinationFor(name) {
  if (stays(name)) return null;
  for (const rule of RULES) if (rule.test(name)) return rule.dir;
  return undefined; // undefined ≠ null: unclassified, and that is a hard stop
}

function rootFiles() {
  return fs.readdirSync(REPORTS_DIR, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort();
}

function plan() {
  const moves = [];
  const kept = [];
  const unclassified = [];
  for (const name of rootFiles()) {
    const dest = destinationFor(name);
    if (dest === undefined) { unclassified.push(name); continue; }
    if (dest === null) { kept.push({ name, why: stays(name) }); continue; }
    moves.push({ from: name, to: dest + '/' + name });
  }
  return { moves, kept, unclassified };
}

function relFromRepo(p) {
  return path.relative(REPO_ROOT, p).replace(/\\/g, '/');
}

/* ---------------------------------------------------------------------------
 * --rewrite-refs — AC-4.
 *
 * Moving a file breaks every `41-Reports/<name>` reference to it, and nothing in
 * the toolchain notices: `pm:lint` has no link checker, so the breakage is
 * SILENT. 386 references broke on the move; they are rewritten here, from the
 * committed dry-run listing rather than from a fresh guess, so the rewrite and
 * the move can never describe different worlds.
 *
 * The match is `41-Reports/<basename>` where <basename> is a WHOLE path segment.
 * `41-Reports/reviews/AI-CODE-REVIEW-x.md` is therefore left alone — the segment
 * after the slash is `reviews`, not the basename — so the pass is idempotent and
 * an already-correct reference is not mangled into `reviews/reviews/`.
 *
 * The pre-migration manifest is EXCLUDED. It is the only record of the old world
 * and rewriting its paths would quietly make count-parity compare the new corpus
 * against itself.
 * ------------------------------------------------------------------------- */
const REWRITE_EXTS = /\.(md|html|htm|json|js|txt|yml|yaml)$/i;
const REWRITE_SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', '.playwright-mcp']);
const REWRITE_SKIP_FILES = [
  /report-migration-baseline\.json$/,   // the old world, deliberately frozen
  /MIGRATION-DRYRUN\.txt$/,             // the mapping itself
  /42-Monitor\/DASHBOARD\.html$/,       // generated; `pm:dash` re-emits it from the tree
];

function loadMoveMap() {
  if (!fs.existsSync(DRYRUN_PATH)) {
    console.error('BLOCKED: no dry-run listing at ' + relFromRepo(DRYRUN_PATH));
    process.exit(1);
  }
  const map = new Map();
  for (const line of fs.readFileSync(DRYRUN_PATH, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [from, to] = line.split(' -> ');
    map.set(from, to);
  }
  return map;
}

function rewriteRefs(write) {
  const map = loadMoveMap();
  const changed = [];
  let total = 0;
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!REWRITE_SKIP_DIRS.has(e.name)) walk(p); continue; }
      if (!REWRITE_EXTS.test(e.name)) continue;
      if (REWRITE_SKIP_FILES.some((re) => re.test(p.replace(/\\/g, '/')))) continue;
      let text;
      try { text = fs.readFileSync(p, 'utf8'); } catch { continue; }
      let out = text, n = 0;
      for (const [from, to] of map) {
        if (out.indexOf('41-Reports/' + from) === -1) continue;
        const parts = out.split('41-Reports/' + from);
        n += parts.length - 1;
        out = parts.join('41-Reports/' + to);
      }
      if (n) {
        total += n;
        changed.push({ file: relFromRepo(p), n });
        if (write) fs.writeFileSync(p, out);
      }
    }
  })(REPO_ROOT);
  console.log((write ? 'rewrote ' : 'would rewrite ') + total + ' reference(s) in ' + changed.length + ' file(s)');
  const byArea = {};
  for (const c of changed) {
    const area = c.file.split('/').slice(0, 2).join('/');
    byArea[area] = (byArea[area] || 0) + c.n;
  }
  for (const [a, n] of Object.entries(byArea).sort((x, y) => y[1] - x[1])) console.log('  ' + String(n).padStart(4) + '  ' + a);
}

function main() {
  if (process.argv.includes('--rewrite-refs')) {
    rewriteRefs(!process.argv.includes('--dry'));
    return;
  }
  const apply = process.argv.includes('--apply');
  const dry = process.argv.includes('--dry-run');
  if (apply === dry) {
    console.error('usage: migrate-reports.js --dry-run | --apply | --rewrite-refs [--dry]');
    process.exit(2);
  }

  const { moves, kept, unclassified } = plan();

  if (unclassified.length) {
    console.error('BLOCKED: ' + unclassified.length + ' file(s) match no mapping rule. Classify them '
      + 'deliberately — this script has no catch-all bucket on purpose:');
    unclassified.forEach((n) => console.error('  ' + n));
    process.exit(1);
  }

  // The listing is source -> destination, one per line, and is what AC-1's
  // "reviewed dry run" is reviewed FROM.
  const listing = moves.map((m) => m.from + ' -> ' + m.to).join('\n') + '\n';

  if (dry) {
    fs.writeFileSync(DRYRUN_PATH, listing);
    console.log('planned moves : ' + moves.length);
    console.log('kept at root  : ' + kept.length);
    for (const k of kept) console.log('  keep ' + k.name + '   [' + k.why + ']');
    console.log('ledger folders untouched: ' + LEDGER_DIRS.join(', '));
    const byDir = {};
    for (const m of moves) byDir[m.to.split('/')[0]] = (byDir[m.to.split('/')[0]] || 0) + 1;
    console.log('destinations  : ' + Object.entries(byDir).map(([d, n]) => d + '=' + n).join(' '));
    console.log('listing       : ' + relFromRepo(DRYRUN_PATH));
    return;
  }

  // --apply. The dry run must already exist and must still describe THIS plan;
  // otherwise "reviewed before execution" is a claim with nothing behind it.
  if (!fs.existsSync(DRYRUN_PATH)) {
    console.error('BLOCKED: no dry-run listing at ' + relFromRepo(DRYRUN_PATH) + ' — run --dry-run first.');
    process.exit(1);
  }
  if (fs.readFileSync(DRYRUN_PATH, 'utf8').replace(/\r\n/g, '\n') !== listing) {
    console.error('BLOCKED: the committed dry-run listing no longer matches the plan this script '
      + 'would execute. Re-run --dry-run, review the difference, then --apply.');
    process.exit(1);
  }

  for (const dir of new Set(moves.map((m) => m.to.split('/')[0]))) {
    fs.mkdirSync(path.join(REPORTS_DIR, dir), { recursive: true });
  }

  let done = 0;
  for (const m of moves) {
    const from = relFromRepo(path.join(REPORTS_DIR, m.from));
    const to = relFromRepo(path.join(REPORTS_DIR, m.to));
    execFileSync('git', ['mv', from, to], { cwd: REPO_ROOT, stdio: 'pipe' });
    done += 1;
  }
  console.log('moved ' + done + ' file(s) with git mv; ' + kept.length + ' kept at root.');
}

if (require.main === module) main();

module.exports = { RULES, ROOT_CONTROL_PLANE, ARCHIVE_EXCEPT, destinationFor, isControlPlane, plan };
