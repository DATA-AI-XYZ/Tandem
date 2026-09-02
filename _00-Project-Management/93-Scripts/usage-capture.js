#!/usr/bin/env node
/**
 * usage-capture.js — capture & attribute actual Claude usage at the execute-story /
 * execute-batch seam (STORY-21.2.01 / BACKLOG-0086 Tranche A).
 *
 * Reads Claude Code session transcript JSONL files and sums each `assistant` message's
 * `usage` fields (input / output / cache-read / cache-creation tokens, plus model id)
 * into one record attributed to a story or chat id — see ADR-0079 for the source/unit/
 * attribution-boundary decisions this implements.
 *
 * Data source (ADR-0079): the current project's transcript directory under
 * `~/.claude/projects/<encoded-cwd>/*.jsonl` by default — tolerant discovery, since the
 * encoding/layout is a harness implementation detail that has shifted before. An explicit
 * `--source <path>` (a single .jsonl file OR a directory of .jsonl files) always overrides
 * discovery.
 *
 * Unit (ADR-0079): raw token counts broken out — input_tokens, output_tokens,
 * cache_read_input_tokens, cache_creation_input_tokens — plus the model id(s) seen. NO
 * derived dollar cost; that is deferred to BACKLOG-0086 Tranche B/C.
 *
 * Attribution boundary (ADR-0079): every `assistant` usage record found in the source
 * file(s) is summed into the named `--story`/`--chat` bracket, optionally narrowed to
 * records at/after `--since <iso>`. Sub-agent (sidechain) turns are NOT excluded — the
 * transcript marks them `isSidechain: true` but this helper does not re-attribute them;
 * their spend counts toward the bracket that dispatched them (a documented approximation,
 * not exact accounting).
 *
 * This measures EXECUTION spend (tokens actually burned running a story/chat) — it is NOT
 * FEAT-11.3's static context-load "tax" (generate-dashboard.js's chars/4 heuristic over an
 * artefact's loaded-content string, estimated before any work happens). Never conflate the
 * two figures.
 *
 * Usage:
 *   node _00-Project-Management/93-Scripts/usage-capture.js --story STORY-21.2.01
 *   node _00-Project-Management/93-Scripts/usage-capture.js --chat E29-CHAT-02
 *   node _00-Project-Management/93-Scripts/usage-capture.js --chat CHAT-01 --phase EPIC-29
 *   node _00-Project-Management/93-Scripts/usage-capture.js --chat CHAT-01 --since 2026-07-18T00:00:00Z
 *   node _00-Project-Management/93-Scripts/usage-capture.js --story STORY-21.2.01 --source <file-or-dir>
 *   node _00-Project-Management/93-Scripts/usage-capture.js --story STORY-21.2.01 --out <log-file>   # test override
 *   node _00-Project-Management/93-Scripts/usage-capture.js --chat E29-CHAT-05 --stories STORY-A,STORY-B
 *   PM_USAGE_LOG=<log-file> node _00-Project-Management/93-Scripts/usage-capture.js --story STORY-21.2.01
 *
 * Output: appends one JSON line to `_00-Project-Management/41-Reports/usage/usage-log.jsonl`
 * (created on demand) — `{ ts, id, kind, model, tokens:{input,output,cache_read,cache_creation}, source }`
 * — plus `join_key` / `run_id` (STORY-29.1.03, ADR-0179: the one key the retro ledger writes
 * too) and a one-line human summary on stdout.
 *
 * STORY-29.3.03 / ADR-0190 — WHERE A STORY BOUNDARY IS OBSERVABLE, BRACKET THE STORY. On a
 * serial lane the boundary is real: `--story <id> --since <the previous boundary>` records what
 * that story cost. Where it is NOT observable — parallel lanes, interleaved work — the chat
 * bracket is written with `--stories <the constituents>`, which stamps the record
 * `attribution: "unattributable-to-story"` and lists them. The remainder is stated whole and
 * itemised; it is NEVER divided by the story count, because a prorated figure looks measured
 * and is not.
 *
 * Exit-code contract (a metric must NEVER fail a run):
 *   0 — record captured and appended, OR graceful no-op (source unavailable/empty) — prints
 *       "usage source unavailable — skipped (no-op)" and exits 0 in the no-op case.
 *   2 — usage error: missing/conflicting --story/--chat, a malformed id, or `--stories` on a
 *       story bracket / with no usable id.
 *
 * Tolerant JSONL parser: malformed lines are skipped, never thrown. Dependency-free — Node
 * stdlib only, consistent with every other `93-Scripts/` tool.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// THE JOIN KEY, FROM THE ONE MODULE THAT DEFINES IT (STORY-29.1.03, ADR-0179). Guarded for the
// same reason `retro-capture.js` guards its schema require: an unguarded top-level require
// exits 1 on a partial install, and this script's whole contract is that a metric never fails
// the run it measures. With no module loaded the record is written WITHOUT the key rather than
// not written — the key is additive, and losing it costs a join, not a measurement.
let ledgerJoin = null;
try {
  ledgerJoin = require(path.join(__dirname, 'lib', 'ledger-join.js'));
} catch { /* the key is additive; a capture without it is still a capture */ }

const PM_ROOT = path.resolve(__dirname, '..');
const DEFAULT_LOG_PATH = path.join(PM_ROOT, '41-Reports', 'usage', 'usage-log.jsonl');
const NOOP_MESSAGE = 'usage source unavailable — skipped (no-op)';

// ---------- CLI parsing ----------

function parseArgs(argv) {
  const args = {
    story: null, chat: null, source: null, since: null, out: null, help: false,
    // STORY-29.1.03. `--phase` exists ONLY to qualify a bare `--chat CHAT-04` into the
    // canonical `E25-CHAT-04` the retro ledger writes; it is never recorded on its own.
    // `--run` records the run beside the key. Both optional, both additive.
    phase: null, run: null,
    // STORY-29.3.03. `--stories` names the stories a CHAT bracket covered, when the bracket
    // could not be split between them. It is the honest remainder, itemised — never a licence
    // to divide the tokens by the story count. See ADR-0190.
    stories: null,
    // BUG-20260818-01. Anything the parser did not understand, collected here and refused by
    // main() with exit 2 BEFORE any source is resolved. The incident: a probe's mistyped
    // `--transcript-dir <fixture>` was silently ignored, the tool fell back to default
    // transcript discovery (~/.claude/projects), and a 3-billion-token row of the operator's
    // REAL spend was written as a fixture chat's — exit 0, reading as a success. An argument
    // that is not understood must never be a fallback to measuring production data.
    errors: [],
  };
  // Every option that consumes the NEXT token as its value. A missing or flag-shaped next
  // token is a usage error, not "same as absent" — `--source` with nothing after it was
  // silently identical to not passing it at all, which is the same defect one flag along.
  const VALUE_FLAGS = {
    '--story': 'story', '--chat': 'chat', '--source': 'source', '--since': 'since',
    '--out': 'out', '--phase': 'phase', '--run': 'run', '--stories': 'stories',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help') { args.help = true; continue; }
    const key = Object.prototype.hasOwnProperty.call(VALUE_FLAGS, a) ? VALUE_FLAGS[a] : null;
    if (key) {
      const v = argv[i + 1];
      if (v === undefined || String(v).indexOf('--') === 0) {
        args.errors.push(`✗ usage-capture: ${a} requires a value`);
        continue; // do not consume the next token — it may be a real flag
      }
      args[key] = argv[++i];
      continue;
    }
    args.errors.push(`✗ usage-capture: unknown argument '${a}'`);
  }
  return args;
}

/** `--stories A,B ,C` → ['A','B','C']. Empty entries dropped; order preserved; duplicates kept
 *  out (a story named twice is one constituent, not two). */
function parseStoryList(value) {
  if (typeof value !== 'string') return [];
  const seen = new Set();
  const out = [];
  for (const part of value.split(',')) {
    const id = part.trim();
    if (id === '' || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

// ---------- default transcript-dir discovery (best-effort, tolerant) ----------

// Encode a cwd the way Claude Code's project-transcript directory names have been observed
// to encode it: separators and the drive-letter colon collapse to '-'. Casing of the drive
// letter has varied across sessions, so both are tried, then a fuzzy fallback scans
// ~/.claude/projects/ for a directory name containing the repo's basename.
function defaultTranscriptDir() {
  let projectsRoot;
  try {
    projectsRoot = path.join(os.homedir(), '.claude', 'projects');
    if (!fs.existsSync(projectsRoot) || !fs.statSync(projectsRoot).isDirectory()) return null;
  } catch {
    return null;
  }

  const cwd = process.cwd();
  const encoded = cwd.replace(/\\/g, '-').replace(/:/g, '-').replace(/\//g, '-');
  const candidates = new Set([
    encoded,
    encoded.length ? encoded[0].toLowerCase() + encoded.slice(1) : encoded,
    encoded.length ? encoded[0].toUpperCase() + encoded.slice(1) : encoded,
  ]);
  for (const c of candidates) {
    const p = path.join(projectsRoot, c);
    try {
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;
    } catch { /* skip */ }
  }

  // Fuzzy fallback: any project dir whose name contains the repo folder's basename,
  // most-recently-modified first.
  let entries;
  try {
    entries = fs.readdirSync(projectsRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  const base = path.basename(cwd).toLowerCase();
  const dirs = entries.filter(e => e.isDirectory()).map(e => e.name)
    .filter(name => name.toLowerCase().includes(base));
  if (dirs.length === 0) return null;
  dirs.sort((a, b) => {
    let at = 0, bt = 0;
    try { at = fs.statSync(path.join(projectsRoot, a)).mtimeMs; } catch { /* 0 */ }
    try { bt = fs.statSync(path.join(projectsRoot, b)).mtimeMs; } catch { /* 0 */ }
    return bt - at;
  });
  return path.join(projectsRoot, dirs[0]);
}

// ---------- source resolution ----------

// Given a source path (file or dir), return the list of .jsonl files to read. Never throws —
// an unreadable/missing path resolves to an empty list, which the caller treats as no-op.
function resolveSourceFiles(sourcePath) {
  if (!sourcePath) return [];
  let stat;
  try {
    stat = fs.statSync(sourcePath);
  } catch {
    return [];
  }
  if (stat.isFile()) return [sourcePath];
  if (stat.isDirectory()) {
    let entries;
    try {
      entries = fs.readdirSync(sourcePath);
    } catch {
      return [];
    }
    return entries
      .filter(f => f.toLowerCase().endsWith('.jsonl'))
      .map(f => path.join(sourcePath, f));
  }
  return [];
}

// ---------- tolerant JSONL usage extraction ----------

// Sums usage fields + collects model ids from every `assistant` record with a `usage` block
// across the given files, optionally narrowed to records at/after `sinceIso`. Malformed
// lines/records are silently skipped (tolerant parser) — never throws.
function extractUsage(files, sinceIso) {
  const totals = { input: 0, output: 0, cache_read: 0, cache_creation: 0 };
  const models = new Set();
  let sinceMs = null;
  if (sinceIso) {
    const d = new Date(sinceIso);
    if (!Number.isNaN(d.getTime())) sinceMs = d.getTime();
  }
  let recordCount = 0;

  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue; // unreadable file — skip, tolerant
    }
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let obj;
      try {
        obj = JSON.parse(trimmed);
      } catch {
        continue; // malformed line — skip
      }
      if (!obj || obj.type !== 'assistant') continue;
      const msg = obj.message;
      if (!msg || typeof msg !== 'object' || !msg.usage) continue;
      if (sinceMs !== null) {
        const ts = obj.timestamp ? new Date(obj.timestamp).getTime() : NaN;
        if (!Number.isNaN(ts) && ts < sinceMs) continue;
      }
      const u = msg.usage;
      totals.input += Number(u.input_tokens) || 0;
      totals.output += Number(u.output_tokens) || 0;
      totals.cache_read += Number(u.cache_read_input_tokens) || 0;
      totals.cache_creation += Number(u.cache_creation_input_tokens) || 0;
      if (msg.model) models.add(String(msg.model));
      recordCount += 1;
    }
  }

  return { totals, models: Array.from(models).sort(), recordCount };
}

// ---------- main ----------

function main(argv) {
  const args = parseArgs(argv);

  if (args.help) {
    console.log('Usage: node usage-capture.js (--story <id> | --chat <id>) [--phase <EPIC-NN>] [--run <run_id>] [--stories <id,id,...>] [--source <path>] [--since <iso>] [--out <path>]');
    return 0;
  }

  // BUG-20260818-01 — an unrecognised or valueless argument is a usage error: exit 2, name
  // it, measure nothing, write nothing. This is the contract every sibling in 93-Scripts/
  // already keeps (run-suite.js, autopilot-plan.js, autopilot-checkpoint.js all exit 2 on an
  // unknown flag), and the alternative was measuring the operator's real transcripts.
  if (args.errors.length) {
    console.error('Usage: node usage-capture.js (--story <id> | --chat <id>) [--phase <EPIC-NN>] [--run <run_id>] [--stories <id,id,...>] [--source <path>] [--since <iso>] [--out <path>]');
    for (const e of args.errors) console.error(e);
    return 2;
  }

  if (!args.story && !args.chat) {
    console.error('✗ usage-capture: give one of --story <id> or --chat <id>');
    return 2;
  }
  if (args.story && args.chat) {
    console.error('✗ usage-capture: give only ONE of --story or --chat, not both');
    return 2;
  }
  const kind = args.story ? 'story' : 'chat';
  const id = args.story || args.chat;
  if (!/^\S+$/.test(id)) {
    console.error(`✗ usage-capture: '${id}' is not a valid ${kind} id`);
    return 2;
  }
  // STORY-29.3.03 — `--stories` describes what a CHAT bracket could not be split between. On a
  // story bracket it would be a contradiction (the bracket already names its story), and a
  // contradiction accepted silently is how a ledger acquires a field that means two things.
  const constituents = parseStoryList(args.stories);
  if (args.stories !== null && kind === 'story') {
    console.error('✗ usage-capture: --stories describes a CHAT bracket\'s constituent stories; '
      + 'a --story bracket already names its story');
    return 2;
  }
  if (args.stories !== null && constituents.length === 0) {
    console.error('✗ usage-capture: --stories was given no usable story id');
    return 2;
  }

  let sourceDescription;
  let sourceFiles;
  if (args.source) {
    sourceDescription = args.source;
    sourceFiles = resolveSourceFiles(args.source);
  } else {
    const dir = defaultTranscriptDir();
    // STORY-21.2.03 AC-4 (prod-clean fix): `dir` is an absolute path under the OS home dir,
    // AND Claude Code's encoded-cwd directory-naming convention bakes the literal username
    // into the LEAF folder name too (e.g. `C--Users-<username>-source-repos-...`) — so even
    // path.basename(dir) still leaks dev identity, not just the parent path. Record a fixed,
    // non-identifying description of HOW the source was resolved instead of WHERE on this
    // machine it lives. An explicit `--source <path>` (test overrides, deliberate operator
    // input, handled in the branch above) is recorded as-given — that's the caller's own
    // path, not a captured leak, and existing tests assert it round-trips verbatim.
    sourceDescription = dir
      ? 'default transcript discovery (~/.claude/projects)'
      : '(default transcript dir not found under ~/.claude/projects)';
    sourceFiles = dir ? resolveSourceFiles(dir) : [];
  }

  if (sourceFiles.length === 0) {
    console.log(NOOP_MESSAGE);
    return 0;
  }

  const { totals, models, recordCount } = extractUsage(sourceFiles, args.since);

  if (recordCount === 0) {
    console.log(NOOP_MESSAGE);
    return 0;
  }

  const record = {
    ts: new Date().toISOString(),
    id,
    kind,
    model: models,
    tokens: {
      input: totals.input,
      output: totals.output,
      cache_read: totals.cache_read,
      cache_creation: totals.cache_creation,
    },
    source: sourceDescription,
  };

  // THE WINDOW, RECORDED (BUG-20260810-12). `--since` narrows what this row measures, and the row
  // never said so — so two DISJOINT windows over one transcript directory were indistinguishable
  // from two cumulative re-sums of the whole of it: same `source`, non-decreasing totals, which is
  // exactly the signature `usage-rollup.detectCumulative()` reads. It took `max(rowTotal)` as the
  // distinct-spend ceiling, and for windows of 100 then 300 that reports 300 against a true spend
  // of 400 — the ceiling UNDERSTATES, which a ceiling must never do.
  //
  // WRITTEN ONLY WHEN THERE IS A WINDOW. An absent `since` is what every row already on disk has,
  // and it must keep meaning what it means today — "this row measured everything the source held"
  // (ADR-0165: old rows are records, and this change is additive with no migration).
  if (typeof args.since === 'string' && args.since.trim() !== '') record.since = args.since.trim();

  // THE JOIN KEY — THE SAME FIELD, FROM THE SAME MODULE, THAT `retro-capture.js` WRITES
  // (STORY-29.1.03, closing BACKLOG-0144). The two ledgers previously agreed on nothing: this
  // writer was handed `CHAT-01` for 31 of its 36 rows while the retro writer was handed
  // `E27-CHAT-05`, so 14 of 22 chats had no counterpart to join to and the ones that did
  // joined 1:5. Composing the key HERE, from the same `compose()` the other writer calls,
  // is what makes the two ledgers name one chat one way.
  //
  // Written even when it is NULL — an unqualifiable bare `--chat CHAT-04` with no `--phase`
  // records the absence rather than omitting the key, so a reader can tell "this writer did
  // not know" from "this record predates the field".
  if (ledgerJoin) {
    try {
      record[ledgerJoin.KEY_FIELD] = ledgerJoin.compose({ id, phase: args.phase });
      record[ledgerJoin.RUN_FIELD] = (typeof args.run === 'string' && args.run.trim() !== '')
        ? args.run.trim() : ledgerJoin.UNATTRIBUTED_RUN;
    } catch { /* additive: a key that cannot be composed must not cost the measurement */ }
    // THE SIBLING OF `retro-capture.js`'s SAME FALLBACK (BUG-20260811-02). This writer takes the
    // identical `--run`-or-marker path, and the live incident produced one bad row in EACH ledger
    // for the same chat — so warning in one writer and not the other would leave half the defect
    // in place. One helper, both writers.
    if (record[ledgerJoin.RUN_FIELD] === ledgerJoin.UNATTRIBUTED_RUN) {
      try {
        const msg = require(path.join(__dirname, 'lib', 'run-attribution.js'))
          .missingRunWarning({ unit: `${kind} ${id}`, marker: ledgerJoin.UNATTRIBUTED_RUN });
        if (msg) console.error(`usage-capture: ${msg}`);
      } catch { /* additive: a warning must never cost the measurement */ }
    }
  }

  // STORY-29.3.03 / ADR-0190 — THE EXPLICIT REMAINDER.
  //
  // A chat bracket whose constituent stories are known but whose spend cannot be split between
  // them says so, in the record, by name. The alternative — dividing the tokens by the story
  // count — would produce per-story numbers that look measured and are not, which is worse than
  // the absence it replaces. `attribution` is written only when the caller states the
  // constituents: a bare `--chat` capture is unattributable too, but with UNKNOWN constituents,
  // and inventing an empty list would claim knowledge the writer does not have.
  if (kind === 'chat' && constituents.length > 0) {
    record.attribution = 'unattributable-to-story';
    record.stories = constituents;
  }

  const logPath = args.out || process.env.PM_USAGE_LOG || DEFAULT_LOG_PATH;
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify(record) + '\n');
  } catch (err) {
    // Writing the log is best-effort too — a metric must never fail the run it's measuring.
    console.log(`usage capture: could not write log (${err.message}) — reporting only`);
    console.log(`usage: ${kind} ${id} — ${totals.input} in / ${totals.output} out / ${totals.cache_read} cache_read / ${totals.cache_creation} cache_creation tokens (model: ${models.join(', ') || 'unknown'})`);
    return 0;
  }

  const remainder = record.attribution
    ? ` [unattributable-to-story across ${constituents.length}: ${constituents.join(', ')} — counted whole, never split]`
    : '';
  console.log(`usage: ${kind} ${id} — ${totals.input} in / ${totals.output} out / ${totals.cache_read} cache_read / ${totals.cache_creation} cache_creation tokens (model: ${models.join(', ') || 'unknown'}) -> ${logPath}${remainder}`);
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { main, parseArgs, parseStoryList, resolveSourceFiles, extractUsage, defaultTranscriptDir, DEFAULT_LOG_PATH, NOOP_MESSAGE };
