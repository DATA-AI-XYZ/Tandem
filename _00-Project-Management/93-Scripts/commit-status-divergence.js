#!/usr/bin/env node
/**
 * commit-status-divergence.js — code landed, the board never noticed (STORY-26.5.05,
 * PRD-Autonomous-Execution §B.3.5).
 *
 * ============================================================================
 * THE FAILURE THIS RUN HAS ACTUALLY SEEN
 * ============================================================================
 * A chat commits a story's work and then halts — or a session ends — before the status flip
 * lands. The code is on the branch; the board still says the story has not been picked up. The
 * next run reads the board, believes it, and does the work again. Re-executing work that
 * already landed is the worst outcome available here, which is why this file **only ever
 * reports**.
 *
 * IT WRITES NOTHING BUT A LEDGER LINE. There is no `writeFileSync` here, no story path is ever
 * opened for writing, and no git command it runs can change a byte of the repository. The
 * divergence is handed to a person.
 *
 * ============================================================================
 * THE DISTINGUISHING RULE (AC-5), STATED ONCE, HERE
 * ============================================================================
 * A commit naming a story is not by itself a defect — most commits name the story they close.
 * What separates the cases is the **status the board is carrying**, and the vocabulary comes
 * from `validate-frontmatter.js` rather than from a second copy written out here:
 *
 *   CLOSED     `done` · `wontfix` · `duplicate` · `archived`  (the linter's TERMINAL_STATUSES)
 *              The commit is the work landing, or the closure being recorded. NOT a divergence.
 *
 *   WIP        `in-progress` · `in-review`
 *              A live session's checkpoint commit. Work is in flight and the flip has not
 *              happened YET, which is different from never happening. Reported separately, in
 *              its own list, never in the divergence list.
 *
 *   DIVERGENT  `not-started` · `ready` · `blocked`
 *              Code landed for work the board says nobody has started, or that is stopped.
 *              This is the one a person has to look at.
 *
 * `wontfix` earns its place in CLOSED from real history, not from taste: `STORY-15.1.02` has a
 * commit named after it (`a040bfcf22`) whose whole purpose was to close it as obsolete. A rule
 * of "anything not `done`" flags that commit, and a detector that cries wolf on a correct
 * closure is a detector people switch off.
 *
 * ============================================================================
 * WHY THE MATCH IS NOT SCOPED TO THE COMMIT'S TOUCHED PATHS (ADR-0155)
 * ============================================================================
 * The paired testplan suggests scoping the match to the files a commit touched, to avoid
 * flagging a commit that merely MENTIONS a story. It is deliberately not done, because in the
 * target case **the story's own artefact file is exactly what the commit did NOT touch** — that
 * is what "the status never flipped" means. Filtering on touched paths would suppress precisely
 * the population this file exists to find.
 *
 * Instead the evidence is REPORTED and left to the reader: every detection carries
 * `touched_story_file`, so a triager can see at a glance whether the commit went near the
 * artefact. The match itself is on the commit SUBJECT only (never the body), which is the
 * convention this repository actually keeps — measured, not assumed: 111 distinct story ids
 * appear in the subjects of the last 400 commits.
 *
 * Usage:
 *   node commit-status-divergence.js [--cwd <repo>] [--stories <dir>] [--limit <n commits>]
 *                                    [--run-id <id>] [--phase EPIC-NN] [--out <ledger>] [--json]
 *
 * Exit codes:
 *   0 — no divergence found
 *   2 — usage error
 *   5 — divergences found. **This is a flag for triage, not a halt**: nothing was corrected and
 *       nothing may be done again on the strength of it.
 *
 * Dependency-free — Node stdlib only, consistent with every other `93-Scripts/` tool.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { parseFrontmatter } = require(path.join(__dirname, 'lib', 'frontmatter.js'));
const validator = require(path.join(__dirname, 'validate-frontmatter.js'));
const decisionCapture = require(path.join(__dirname, 'autopilot-decision-capture.js'));

const EXIT_OK = 0;
const EXIT_USAGE = 2;
const EXIT_DIVERGENCE = 5;

const DEFAULT_LIMIT = 400;

/** THE LINTER'S OWN SET, not a copy of it. See the header. */
const CLOSED_STATUSES = Object.freeze(Array.from(validator.TERMINAL_STATUSES));

/**
 * Work in flight. The flip has not happened YET, which is not the same as never.
 *
 * THE ONE HAND-WRITTEN LIST IN THIS FILE, AND THE ONLY ONE THAT CAN DRIFT. `CLOSED_STATUSES`
 * is the linter's own set and `DIVERGENT_STATUSES` is derived by subtraction, so both follow a
 * change to the linter automatically. This list does not: rename `in-review` in
 * `validate-frontmatter.js` and `in-review` stops being a member of the enum while remaining in
 * this list, the renamed value lands in the DIVERGENT set by subtraction, and every story in
 * that state is reported to an operator as work that landed without a status flip. The
 * classifier ships wrong and the report is confidently false.
 *
 * So the subset relation is ASSERTED AT LOAD, below, and named as the cause rather than left to
 * surface as a puzzling failure three files away.
 */
const WIP_STATUSES = Object.freeze(['in-progress', 'in-review']);

/**
 * Which members of `wip` the linter's enum does not know. PURE and exported, so the drift can
 * be probed without renaming anything in the real linter.
 *
 * @param {Iterable<string>} statusEnum the linter's `STATUS_ENUM`
 * @param {string[]} wip the WIP list to check
 * @returns {string[]} the drifted members, in order; empty means the subset holds
 */
function vocabularyDrift(statusEnum, wip) {
  const known = new Set(statusEnum || []);
  return (wip || []).filter(s => !known.has(s));
}

// ASSERTED AT LOAD, NOT IN A TEST. A drifted vocabulary makes every classification this module
// produces suspect, and a report built on it is worse than no report: it is a confident wrong
// answer handed to an operator mid-run. Failing loudly at require time, naming the two lists
// and the drifted value, is the only outcome that leads to the right fix.
const WIP_DRIFT = vocabularyDrift(validator.STATUS_ENUM, WIP_STATUSES);
if (WIP_DRIFT.length) {
  throw new Error(
    `commit-status-divergence: WIP_STATUSES has drifted from the linter's STATUS_ENUM — `
    + `${JSON.stringify(WIP_DRIFT)} ${WIP_DRIFT.length === 1 ? 'is' : 'are'} no longer in `
    + `${JSON.stringify([...validator.STATUS_ENUM])}. Every status the linter accepts must fall `
    + 'in exactly one of CLOSED / WIP / DIVERGENT; a stale WIP entry silently moves the renamed '
    + 'status into the DIVERGENT set and reports every story in it as a divergence. Update '
    + 'WIP_STATUSES to match the linter.');
}

/**
 * Everything else the linter accepts. DERIVED by subtraction, so a status added to the linter
 * lands in the divergent set automatically and is never silently ignored — the alternative,
 * a third hand-written list, is how the ninth enum value ends up covered by nobody.
 */
const DIVERGENT_STATUSES = Object.freeze(Array.from(validator.STATUS_ENUM)
  .filter(s => CLOSED_STATUSES.indexOf(s) === -1 && WIP_STATUSES.indexOf(s) === -1));

const CLASSES = Object.freeze(['closed', 'wip', 'divergent', 'unknown-status', 'no-artefact']);

const STORY_ID_RE = /STORY-\d+\.\d+\.\d+/g;

/** The rule, in one sentence, for the ledger and for an operator. */
const RULE = 'a commit naming a story diverges when the board carries '
  + `${DIVERGENT_STATUSES.join(' / ')}; ${WIP_STATUSES.join(' / ')} is work in flight and is `
  + `reported separately; ${CLOSED_STATUSES.join(' / ')} is closed and is never flagged. `
  + 'Matched on the commit subject; NOT scoped to touched paths, because in the target case the '
  + 'story file is exactly what the commit did not touch (ADR-0155).';

function safeMessage(err) {
  try {
    if (err && typeof err.message === 'string') return err.message;
    return String(err);
  } catch {
    return '(unprintable error)';
  }
}

/** @returns {string[]} distinct story ids named in `text`, in order of first appearance. */
function storyIdsIn(text) {
  const out = [];
  const s = typeof text === 'string' ? text : '';
  STORY_ID_RE.lastIndex = 0;
  let m;
  while ((m = STORY_ID_RE.exec(s)) !== null) {
    if (out.indexOf(m[0]) === -1) out.push(m[0]);
  }
  return out;
}

/** @returns {string} one of CLASSES. */
function classify(status) {
  if (status === null || status === undefined) return 'no-artefact';
  const s = String(status).trim();
  if (CLOSED_STATUSES.indexOf(s) !== -1) return 'closed';
  if (WIP_STATUSES.indexOf(s) !== -1) return 'wip';
  if (DIVERGENT_STATUSES.indexOf(s) !== -1) return 'divergent';
  // A status the linter would reject. NOT quietly treated as divergent: "the board says
  // something we do not understand" is a different report from "the board says ready".
  return 'unknown-status';
}

/**
 * Read every story's `id` + `status` under `root`.
 * Handles CRLF and LF alike — the shared parser does, and this corpus is overwhelmingly CRLF.
 * NEVER THROWS: an unreadable or frontmatter-less file is skipped, not fatal.
 */
function readStoryStatuses(root) {
  const map = new Map();
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/^STORY-.*\.md$/.test(e.name)) continue;
      let fm = null;
      try {
        fm = parseFrontmatter(fs.readFileSync(p, 'utf8'));
      } catch { continue; }
      if (!fm || !fm.id) continue;
      const id = String(fm.id).trim();
      if (id === '') continue;
      map.set(id, {
        status: fm.status === undefined || fm.status === null ? null : String(fm.status).trim(),
        file: p,
      });
    }
  };
  walk(root);
  return map;
}

/** Run git, read-only. NEVER THROWS; returns null on any failure. */
function git(args, opts) {
  const options = opts || {};
  let res;
  try {
    res = spawnSync(options.gitBin || 'git', args, {
      cwd: options.cwd || process.cwd(),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      env: Object.assign({}, process.env, { GIT_PAGER: 'cat', GIT_OPTIONAL_LOCKS: '0' }),
    });
  } catch { return null; }
  if (res.error || res.status !== 0) return null;
  return String(res.stdout || '');
}

/**
 * The commits on the current branch, newest first, with the story ids named in their subjects.
 * Bounded by `--limit` — a full-history walk is not needed to see the recent divergence a run
 * just produced, and the testplan's own review checklist asks for a bounded range.
 */
function readCommits(opts) {
  const options = opts || {};
  const limit = Number.isFinite(Number(options.limit)) && Number(options.limit) > 0
    ? Math.floor(Number(options.limit)) : DEFAULT_LIMIT;
  const out = git(['log', `--max-count=${limit}`, '--format=%H%x09%s'], options);
  if (out === null) return { ok: false, commits: [], error: 'git log could not be read' };
  const commits = [];
  for (const line of out.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const tab = line.indexOf('\t');
    const sha = tab === -1 ? line : line.slice(0, tab);
    const subject = tab === -1 ? '' : line.slice(tab + 1);
    commits.push({ sha, subject, ids: storyIdsIn(subject) });
  }
  return { ok: true, commits, error: null };
}

/** Advisory evidence only — never a filter. See the header and ADR-0155. */
function commitTouched(sha, file, opts) {
  const out = git(['show', '--name-only', '--format=', sha], opts);
  if (out === null) return null;
  const norm = String(file).split(path.sep).join('/');
  return out.split(/\r?\n/).some(l => l.trim() !== '' && norm.endsWith(l.trim()));
}

/**
 * Scan and classify. Pure reporting — nothing here writes to the repository.
 *
 * @returns {{ok, scanned, rule, divergences, wip, closed, unknown, missing, error}}
 */
function scan(opts) {
  const options = opts || {};
  const cwd = options.cwd || process.cwd();
  const storiesRoot = options.storiesRoot
    || path.join(cwd, '_00-Project-Management', '32-Stories');
  const statuses = readStoryStatuses(storiesRoot);
  const read = readCommits(options);

  const seen = new Map(); // id -> first (newest) commit naming it
  for (const c of read.commits) {
    for (const id of c.ids) if (!seen.has(id)) seen.set(id, c);
  }

  const buckets = { divergences: [], wip: [], closed: [], unknown: [], missing: [] };
  for (const [id, commit] of seen) {
    const artefact = statuses.get(id) || null;
    const status = artefact ? artefact.status : null;
    const cls = classify(status);
    const detection = {
      story: id,
      commit: commit.sha,
      short: commit.sha.slice(0, 10),
      subject: commit.subject,
      status: status === null ? null : status,
      class: cls,
      file: artefact ? path.relative(cwd, artefact.file).split(path.sep).join('/') : null,
      touched_story_file: null,
    };
    if (cls === 'divergent') {
      // Evidence, gathered only for the ones a person will read. `git show` per commit is not
      // free, and gathering it for 111 closed stories would make the scan cost about the
      // detections nobody has to look at.
      detection.touched_story_file = artefact
        ? commitTouched(commit.sha, artefact.file, options) : null;
      buckets.divergences.push(detection);
    } else if (cls === 'wip') buckets.wip.push(detection);
    else if (cls === 'closed') buckets.closed.push(detection);
    else if (cls === 'unknown-status') buckets.unknown.push(detection);
    else buckets.missing.push(detection);
  }

  return Object.assign({
    ok: read.ok,
    error: read.error,
    scanned: read.commits.length,
    storiesKnown: statuses.size,
    referenced: seen.size,
    rule: RULE,
  }, buckets);
}

/** AC-4 — the detection list at `run` level, through the single writer. Never throws. */
function recordDetections(result, ctx) {
  const context = ctx || {};
  const argv = ['--level', 'run', '--id', context.runId || 'autopilot-unknown-run'];
  if (context.phase) argv.push('--phase', context.phase);
  if (context.chat) argv.push('--chat', context.chat);
  const listed = result.divergences
    .map(d => `${d.story}@${d.short}(${d.status})`).join(', ');
  argv.push('--stop-reason',
    `commit-status-divergence: ${result.divergences.length} divergence(s)`
    + `${listed ? ` — ${listed}` : ''}; ${result.wip.length} in-progress WIP not flagged; `
    + `${result.scanned} commit(s) scanned. FLAG FOR TRIAGE ONLY — nothing corrected. ${result.rule}`);
  try {
    // THE RUN CONTEXT GOES WITH THE RECORD (STORY-29.1.01). This tool was the one gate that did
    // NOT pollute the ledger ad-hoc — because it only records when `--run-id` is given at all
    // (BUG-20260804-39 named it as the model) — and it now shares the family's rule anyway, so
    // there is one answer to "where does a gate record go" rather than one and an exception.
    return decisionCapture.capture(argv, {
      out: context.out, runId: context.runId, reportsDir: context.reportsDir,
    });
  } catch (err) {
    return {
      captured: false, refused: false, code: null, stdout: '', stderr: '',
      warnings: [`divergence capture threw: ${safeMessage(err)}`], argv,
    };
  }
}

/** The operator-facing report (AC-2): story, commit, observed status — all three, always. */
function formatReport(result) {
  const lines = [];
  lines.push(`commit-status-divergence: ${result.scanned} commit(s) scanned, `
    + `${result.referenced} story id(s) referenced.`);
  if (result.divergences.length === 0) {
    lines.push('no divergence: every story named by a commit is closed or in flight.');
  } else {
    lines.push(`${result.divergences.length} DIVERGENCE(S) — FOR TRIAGE, NOT FOR ACTION:`);
    for (const d of result.divergences) {
      lines.push(`  ${d.story}  status=${d.status}  commit=${d.short}  `
        + `story-file-touched=${d.touched_story_file === null ? 'unknown' : d.touched_story_file}`);
      lines.push(`    ${d.subject}`);
    }
  }
  if (result.wip.length) {
    lines.push(`${result.wip.length} story/ies in flight (not a divergence): `
      + result.wip.map(d => `${d.story}(${d.status})`).join(', '));
  }
  if (result.unknown.length) {
    lines.push(`${result.unknown.length} with a status the linter would reject: `
      + result.unknown.map(d => `${d.story}(${d.status})`).join(', '));
  }
  if (result.missing.length) {
    lines.push(`${result.missing.length} named by a commit with no story artefact: `
      + result.missing.map(d => d.story).join(', '));
  }
  lines.push(`rule: ${result.rule}`);
  return lines.join('\n');
}

// ---------- CLI ----------

function usage(msg) {
  if (msg) console.error(msg);
  console.error('usage: node commit-status-divergence.js [--cwd <repo>] [--stories <dir>] '
    + '[--limit <n>] [--run-id <id>] [--phase EPIC-NN] [--chat CHAT-NN] [--out <ledger>] '
    + '[--reports-dir <path>] [--json]');
  console.error('  --out <ledger> writes the run-level record somewhere other than the '
    + 'production 41-Reports/retro/retro-log.jsonl — use it for any ad-hoc invocation. Without '
    + 'it, a --run-id this repository has no run plan and no checkpoint for records NOTHING '
    + '(STORY-29.1.01).');
  return EXIT_USAGE;
}

function main(argv) {
  const args = argv.slice(2);
  const flags = Object.create(null);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') { flags.json = true; continue; }
    if (a.indexOf('--') !== 0) return usage(`unexpected argument "${a}"`);
    const v = args[i + 1];
    if (v === undefined || String(v).indexOf('--') === 0) { flags[a.slice(2)] = ''; continue; }
    flags[a.slice(2)] = v;
    i++;
  }

  const result = scan({
    cwd: flags.cwd, storiesRoot: flags.stories, limit: flags.limit,
  });
  if (!result.ok) {
    console.error('commit-status-divergence: git history could not be read — nothing was checked.');
    return EXIT_USAGE;
  }

  let capture = null;
  if (flags['run-id']) {
    capture = recordDetections(result, {
      runId: flags['run-id'], phase: flags.phase, chat: flags.chat, out: flags.out,
      reportsDir: flags['reports-dir'],
    });
  }

  // WHY NOTHING WAS WRITTEN, WHATEVER THE OUTPUT FORMAT (STORY-29.1.01).
  if (capture && !capture.captured) {
    try {
      process.stderr.write('⚠ commit-status-divergence: the run-level record was NOT written '
        + `(${capture.skipped || (capture.refused ? 'REFUSED' : 'not captured')}) — `
        + `${capture.warnings.join('; ') || 'no reason given'}\n`);
    } catch { /* a diagnostic must not take the scan down */ }
  }

  if (flags.json) {
    console.log(JSON.stringify({
      scanned: result.scanned, referenced: result.referenced,
      divergences: result.divergences, wip: result.wip,
      unknown: result.unknown, missing: result.missing,
      rule: result.rule, recorded: capture ? capture.captured : null,
      not_recorded_because: !capture || capture.captured
        ? null : (capture.skipped || (capture.refused ? 'refused' : 'capture-failed')),
    }, null, 2));
  } else {
    console.log(formatReport(result));
  }

  return result.divergences.length === 0 ? EXIT_OK : EXIT_DIVERGENCE;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = {
  CLOSED_STATUSES, WIP_STATUSES, DIVERGENT_STATUSES, CLASSES, RULE, vocabularyDrift,
  EXIT_OK, EXIT_USAGE, EXIT_DIVERGENCE, DEFAULT_LIMIT,
  storyIdsIn, classify, readStoryStatuses, readCommits, scan, recordDetections,
  formatReport, main,
};
