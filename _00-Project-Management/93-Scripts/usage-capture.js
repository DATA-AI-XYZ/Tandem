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
 *   node _00-Project-Management/93-Scripts/usage-capture.js --chat CHAT-01 --since 2026-07-18T00:00:00Z
 *   node _00-Project-Management/93-Scripts/usage-capture.js --story STORY-21.2.01 --source <file-or-dir>
 *   node _00-Project-Management/93-Scripts/usage-capture.js --story STORY-21.2.01 --out <log-file>   # test override
 *   PM_USAGE_LOG=<log-file> node _00-Project-Management/93-Scripts/usage-capture.js --story STORY-21.2.01
 *
 * Output: appends one JSON line to `_00-Project-Management/41-Reports/usage/usage-log.jsonl`
 * (created on demand) — `{ ts, id, kind, model, tokens:{input,output,cache_read,cache_creation}, source }`
 * — plus a one-line human summary on stdout.
 *
 * Exit-code contract (a metric must NEVER fail a run):
 *   0 — record captured and appended, OR graceful no-op (source unavailable/empty) — prints
 *       "usage source unavailable — skipped (no-op)" and exits 0 in the no-op case.
 *   2 — usage error: missing/conflicting --story/--chat, or a malformed id.
 *
 * Tolerant JSONL parser: malformed lines are skipped, never thrown. Dependency-free — Node
 * stdlib only, consistent with every other `93-Scripts/` tool.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const PM_ROOT = path.resolve(__dirname, '..');
const DEFAULT_LOG_PATH = path.join(PM_ROOT, '41-Reports', 'usage', 'usage-log.jsonl');
const NOOP_MESSAGE = 'usage source unavailable — skipped (no-op)';

// ---------- CLI parsing ----------

function parseArgs(argv) {
  const args = { story: null, chat: null, source: null, since: null, out: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--story' && argv[i + 1]) args.story = argv[++i];
    else if (a === '--chat' && argv[i + 1]) args.chat = argv[++i];
    else if (a === '--source' && argv[i + 1]) args.source = argv[++i];
    else if (a === '--since' && argv[i + 1]) args.since = argv[++i];
    else if (a === '--out' && argv[i + 1]) args.out = argv[++i];
    else if (a === '--help') args.help = true;
  }
  return args;
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
    console.log('Usage: node usage-capture.js (--story <id> | --chat <id>) [--source <path>] [--since <iso>] [--out <path>]');
    return 0;
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

  console.log(`usage: ${kind} ${id} — ${totals.input} in / ${totals.output} out / ${totals.cache_read} cache_read / ${totals.cache_creation} cache_creation tokens (model: ${models.join(', ') || 'unknown'}) -> ${logPath}`);
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { main, parseArgs, resolveSourceFiles, extractUsage, defaultTranscriptDir, DEFAULT_LOG_PATH, NOOP_MESSAGE };
