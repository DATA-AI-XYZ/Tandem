'use strict';
/**
 * report-tree.js — STORY-27.3.02. The one implementation of "read 41-Reports"
 * (ADR-0141).
 *
 * Six places in this kit read the report corpus. Before this module each one
 * decided for itself what the folder looked like, and five of the six assumed it
 * was FLAT — `readdirSync(reportsDir)` with no recursion, or a hardcoded path to
 * a file at the root. That assumption is true today and stops being true the
 * moment STORY-27.3.03 moves the corpus into topic folders, at which point those
 * five surfaces go quietly empty: an execution-strategy band with no phases, a
 * route table with no routes, a lint check that scans nothing, a usage
 * reconciliation that cannot resolve a chat, a card baseline that is never found.
 * Quietly, because every one of them degrades gracefully on "no files" — the
 * behaviour that makes them robust is the behaviour that hides the breakage.
 *
 * So the fix is not "make five call sites recursive". It is: there is ONE reader,
 * every site calls it, and a sixth site added tomorrow inherits the shape rules
 * rather than re-deciding them.
 *
 * ---------------------------------------------------------------------------
 * THE TAXONOMY (ADR-0141), stated here because this is where it is enforced:
 *
 *   TOPIC FOLDERS ARE DERIVED. Any sub-folder of 41-Reports/ is a report topic.
 *   Its name becomes the record's `section`, and the board renders one section
 *   per sub-folder. A new report kind creates its folder and is sectioned with
 *   NO code change. There is no list of allowed topics anywhere.
 *
 *   LEDGER FOLDERS ARE A REGISTRY. LEDGER_DIRS below is a short, explicit,
 *   code-side list of directories that hold machine-appended ledgers and binary
 *   assets rather than reports. This one cannot be derived: "who writes this
 *   folder, a person or a script?" is not a fact about its name.
 *
 * The two rules are independent, and deliberately overlap:
 *
 *   - Selection is ALSO by document type (REPORT_DOC_EXTS). A .jsonl ledger or a
 *     .png screenshot is excluded wherever it sits, including in a folder nobody
 *     registered.
 *   - The registry excludes a DOCUMENT that lands in a ledger folder — e.g. a
 *     usage/README.md — which the type filter would happily admit.
 *
 * Either rule alone keeps today's corpus correct, which is exactly why both are
 * needed: a check that today's corpus passes is not evidence the rule works.
 * `tests/build-reports-recursive.test.js :: walks-subfolders` exercises both arms
 * separately for that reason.
 * ---------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

// The document types a report can be. Reports are prose or structured sidecars;
// ledgers (.jsonl) and assets (.png) are neither.
const REPORT_DOC_EXTS = ['.md', '.html', '.htm', '.json'];

// THE REGISTRY. Directories directly under the reports root that hold machine
// output, not reports. Matched at depth 1 only: a topic folder is free to
// contain a sub-folder called "usage" and it stays a report topic, because the
// exemption is about these three specific writers, not about the word.
//   usage/       usage-capture.js appends usage-log.jsonl (ADR-0079)
//   retro/       retro-capture.js appends retro-log.jsonl (ADR-0111)
//   screenshots/ smoke/bug capture PNGs
const LEDGER_DIRS = ['usage', 'retro', 'screenshots'];

// THE SECOND REGISTRY (STORY-27.3.03, ADR-0143). LEDGER_DIRS says which FOLDERS
// under the root are not reports; ROOT_EXEMPT says which FILES may legitimately
// sit at the root itself, now that every other report lives in a topic folder.
//
// It cannot be derived, for the same reason LEDGER_DIRS cannot. The question is
// "does something outside this module address this file by a hard-coded root
// path?", and that is a fact about `skills/`, not about the filename:
//
//   AUTOPILOT-*                skills/autopilot/SKILL.md hard-codes
//                              41-Reports/AUTOPILOT-CHECKPOINT.json as the resume
//                              path and 41-Reports/AUTOPILOT-RUN-<date>.md as the
//                              run log. An orchestrator follows that prose
//                              literally; no reader module sits in between, so
//                              this module's shape-agnosticism cannot help it.
//   EXECUTION-STRATEGY-*       skills/execute-batch/SKILL.md globs
//                              41-Reports/EXECUTION-STRATEGY-*.json to find the
//                              plan it is executing.
//   STALE-RUN-DISMISSALS.json  STORY-29.1.04 / ADR-0180. It is not a report at
//                              all — it is the operator's judgement about the
//                              runs whose checkpoints sit BESIDE it, and that
//                              adjacency is the decision: a dismissal lives next
//                              to the checkpoint rather than on it (ADR-0152's
//                              never-rewrite stance). `autopilot-stale-runs.js`
//                              addresses it as `<reports-dir>/<name>`, which is
//                              exactly the hard-coded-root-path property this
//                              registry exists to record. Filing it under a
//                              topic folder would put the control plane in two
//                              places.
//
// The exemption is a PERMISSION, not an obligation: every reader resolves these
// at any depth (resolveReportDoc, findReportDocs), so archiving a closed run's
// sidecar into `execution-strategy/` is legal and the guard stays quiet either
// way. What it forbids is a NEW report kind quietly accumulating at the root,
// which is how the corpus reached 204 loose files the first time.
const ROOT_EXEMPT = [
  /^AUTOPILOT-/,
  /^EXECUTION-STRATEGY-/,
  /^STALE-RUN-DISMISSALS\.json$/,
];

function isRootExempt(name) {
  return ROOT_EXEMPT.some((re) => re.test(String(name)));
}

// Not a corpus assumption — the runaway guard for a symlink loop, which
// statSync would otherwise follow forever.
const MAX_DEPTH = 6;

function isLedgerDir(name) {
  return LEDGER_DIRS.indexOf(String(name)) !== -1;
}

function isReportDoc(name) {
  return REPORT_DOC_EXTS.indexOf(path.extname(String(name)).toLowerCase()) !== -1;
}

/**
 * Walk a reports root and return one entry per report DOCUMENT, at any depth.
 *
 * @param {string} rootDir            the reports root (real or a fixture)
 * @param {{includeLedgers?: boolean, exts?: string[], skipped?: object[]}} [opts]
 *        `includeLedgers` disables the registry (used by nothing in the product;
 *        it exists so a test can prove the registry is what excludes a document
 *        rather than the type filter). `exts` narrows the type filter.
 *        `skipped` is a diagnostics SINK: pass an array and every report DOCUMENT
 *        dropped by the registry is pushed onto it as `{ path, reason }` — the
 *        shape both diagnostics consumers destructure (the board's `#diag` block
 *        and generate-dashboard's console tail). `path` is absolute here because
 *        this module has no idea where the project root is; the caller re-bases
 *        it, which is the same division duplicateBasenames() already uses.
 *        Omit the sink and nothing is collected — the walk pays only for a
 *        diagnostic somebody asked for.
 * @returns {{full: string, name: string, section: string, depth: number}[]}
 *        `section` is the FIRST path segment below rootDir, or '' for a file
 *        sitting directly in it. First segment, not the immediate parent, so a
 *        deeply nested file still belongs to exactly one section — "one section
 *        per sub-folder" is the AC, and the immediate parent would give one
 *        section per LEVEL.
 */
// A report DOCUMENT that lands in a ledger folder is a MISTAKE, not a ledger:
// the type filter would happily admit it and only the registry keeps it out, so
// it disappears from the board with nothing said. `retro/` (the ledger) and
// `retros` (the obvious name for a retro TOPIC folder) are one keystroke apart,
// and STORY-27.3.03 is about to create topic folders — so the day this happens is
// the day it needs to be visible, not the day someone notices a report missing.
//
// Collected only when the caller supplies a sink. The registry still excludes the
// file either way; this changes nothing about selection, only about silence.
function collectLedgerDocs(dir, ledgerName, exts, sink, depth) {
  if (depth > MAX_DEPTH) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    let isDir = entry.isDirectory();
    let isFile = entry.isFile();
    if (!isDir && !isFile) {
      try { const st = fs.statSync(full); isDir = st.isDirectory(); isFile = st.isFile(); }
      catch { continue; }
    }
    if (isDir) { collectLedgerDocs(full, ledgerName, exts, sink, depth + 1); continue; }
    if (!isFile) continue;
    if (exts.indexOf(path.extname(entry.name).toLowerCase()) === -1) continue;
    sink.push({
      path: full,
      reason: 'report document inside the ledger folder "' + ledgerName + '/" — ledger folders hold '
        + 'machine-appended logs and binary assets (ADR-0141), so this file is NOT read as a report '
        + 'and does not appear on the board. If it is a report, move it to a topic folder; note that '
        + '"' + ledgerName + '/" is the ledger and a similarly-named topic folder is a different thing.',
    });
  }
}

function walkReportDocs(rootDir, opts) {
  const o = opts || {};
  const exts = o.exts || REPORT_DOC_EXTS;
  const sink = Array.isArray(o.skipped) ? o.skipped : null;
  const out = [];
  if (!rootDir) return out;

  function rec(dir, depth, section) {
    if (depth > MAX_DEPTH) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; } // unreadable directory yields nothing, never a throw
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (!isDir && !isFile) {
        // A symlink or an odd dirent — resolve it once rather than guessing.
        try {
          const st = fs.statSync(full);
          isDir = st.isDirectory();
          isFile = st.isFile();
        } catch { continue; }
      }
      if (isDir) {
        if (depth === 0 && !o.includeLedgers && isLedgerDir(entry.name)) {
          if (sink) collectLedgerDocs(full, entry.name, exts, sink, 1);
          continue;
        }
        rec(full, depth + 1, depth === 0 ? entry.name : section);
        continue;
      }
      if (!isFile) continue;
      if (exts.indexOf(path.extname(entry.name).toLowerCase()) === -1) continue;
      out.push({ full, name: entry.name, section, depth });
    }
  }

  rec(rootDir, 0, '');
  return out;
}

/**
 * Every document in the tree whose BASENAME matches `pred`, at any depth.
 * The shape-agnostic replacement for `readdirSync(reportsDir).filter(...)`.
 *
 * Ordering is deterministic — section first ('' before named, so a root file
 * still wins), then basename — so two callers reading the same tree see the same
 * order regardless of readdir order on the day.
 */
function findReportDocs(rootDir, pred, opts) {
  return walkReportDocs(rootDir, opts)
    .filter((e) => pred(e.name, e))
    .sort((a, b) => (a.section === b.section
      ? a.name.localeCompare(b.name)
      : a.section.localeCompare(b.section)));
}

/**
 * Resolve ONE named document — a config or baseline addressed by filename that
 * used to be reached by a hardcoded root-level path.
 *
 * Returns the full path, or null. A root-level hit wins over a nested one (the
 * walk's own ordering guarantees it), so moving a file into a folder is a no-op
 * for correctness and moving it BACK is too.
 */
function resolveReportDoc(rootDir, basename, opts) {
  const hits = findReportDocs(rootDir, (n) => n === basename, opts);
  return hits.length ? hits[0].full : null;
}

/**
 * Duplicate basenames across sections — BACKLOG-0132 Tranche A.
 *
 * A flat directory made this impossible; folders make it routine. It is no
 * longer a correctness bug (records key on their relative path, Tranche B), but
 * it is still worth SAYING: two files called PHASE-2026-08-03.md in different
 * folders are almost certainly a naming accident, and the day one appears is the
 * day to see it. Returns [{ name, files: [...] }], empty when there are none.
 */
function duplicateBasenames(entries) {
  const byName = new Map();
  for (const e of entries) {
    if (!byName.has(e.name)) byName.set(e.name, []);
    byName.get(e.name).push(e.full);
  }
  const dups = [];
  for (const [name, files] of byName) {
    if (files.length > 1) dups.push({ name, files });
  }
  return dups.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * THE FLAT-ROOT GUARD (STORY-27.3.04, ADR-0143).
 *
 * Every report DOCUMENT sitting directly in `rootDir` whose basename is not
 * root-exempt. Returns [{ path, name, reason }] — the same `{path, reason}`
 * shape the ledger-skip diagnostics already use, so both feed one channel.
 *
 * WHY A GUARD AT ALL. STORY-27.3.03 moved 193 documents out of this directory.
 * Nothing stops the next report landing back in it: ten skills write here, and a
 * skill whose documented path was missed produces ONE stray file, which looks
 * like nothing. The corpus reached 204 loose documents one indistinguishable
 * file at a time. The guard is what makes the 194th loud.
 *
 * Note what is NOT consulted: the file's KIND. A stray is defined by where it
 * sits and whether it is exempt, never by whether its name looks like a report
 * this module recognises — a rule keyed on the known prefixes would wave through
 * exactly the new report kind nobody has taught a folder to yet, which is the
 * case most likely to go wrong.
 */
function strayRootReports(rootDir) {
  let entries;
  try { entries = fs.readdirSync(rootDir, { withFileTypes: true }); }
  catch { return []; }
  const out = [];
  for (const entry of entries) {
    const full = path.join(rootDir, entry.name);
    let isFile = entry.isFile();
    if (!isFile && !entry.isDirectory()) {
      try { isFile = fs.statSync(full).isFile(); } catch { continue; }
    }
    if (!isFile) continue;
    if (!isReportDoc(entry.name)) continue;   // .txt / .jsonl / .png are not reports
    if (isRootExempt(entry.name)) continue;   // the autopilot control plane (ADR-0143)
    out.push({
      path: full,
      name: entry.name,
      reason: 'report document at the FLAT ROOT of 41-Reports/. Since STORY-27.3.03 the root holds '
        + 'topic folders plus the autopilot control plane only (ADR-0143). Move it into the folder '
        + 'for its kind — reviews/, phases/, audits/, execution-strategy/, explorations/, boards/, '
        + 'baselines/ — or create a new folder: any sub-folder is a topic and needs no code change. '
        + 'If this file genuinely belongs at the root, add its pattern to ROOT_EXEMPT with the reason.',
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = {
  REPORT_DOC_EXTS,
  LEDGER_DIRS,
  ROOT_EXEMPT,
  strayRootReports,
  MAX_DEPTH,
  isLedgerDir,
  isRootExempt,
  isReportDoc,
  walkReportDocs,
  findReportDocs,
  resolveReportDoc,
  duplicateBasenames,
};
