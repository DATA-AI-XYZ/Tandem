'use strict';
/**
 * batch-evidence.js — the delivery-batch evidence reader (STORY-36.1.01 · ADR-0305).
 *
 * WHAT THIS ANSWERS
 * -----------------
 * For every delivery batch an execution-strategy sidecar declares (`delivery_batches[]`),
 * this module answers four questions from RECORDED evidence and never from a guess:
 *
 *   1. EXECUTION MODE — how the batch is being run. Only a batch record's entry
 *      authorisation can make it `human-gated`; only a written run plan can make it
 *      `autopilot-authorised`. The strategist's emitted autopilot track is reported as a
 *      PROPOSAL beside it, never as the mode (ADR-0305 §2).
 *   2. APPROVAL STATE — per review slice and for the batch's acceptance, bound to the
 *      commits Codex reviewed: S (planning) and P (product), plus R, the commit that
 *      records the approval. The administrative close-out between S and R is checked
 *      against a closed allowlist; anything outside it is a substantive change
 *      (ADR-0305 §3–§5).
 *   3. LANDING — proved by git ancestry of the reviewed commits on the two `main`
 *      branches. An expected unborn product `main` is Not landed; evidence that cannot be
 *      read is Unknown, never Landed (ADR-0305 §6).
 *   4. CURRENT STATE — what changed after the record, shown beside it and never mixed
 *      into it: after landing, the delivery record is historical and later maintenance
 *      cannot turn it stale (ADR-0305 §5).
 *
 * WHERE THE EVIDENCE LIVES
 * ------------------------
 *   - The sidecar's `delivery_batches[]` (the approved plan).
 *   - The BATCH RECORD: one fenced block, ```json batch-record, inside the batch's report
 *     under the reports role's `phases/` folder. JSON, not frontmatter, because the kit's
 *     frontmatter is flat by rule (ADR-0041, R20) and an approval entry is a structured
 *     list. Validator R34 owns its shape.
 *   - Git, in the planning repository (the PM tree's own) and in the product repository
 *     named by the record's `product_repo_env` environment variable.
 *
 * NEVER THROWS. The generator's contract is that a malformed artefact degrades the board
 * rather than failing generation, so every failure becomes a named state with its basis.
 *
 * Node stdlib only.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseFrontmatter } = require('./frontmatter.js');
const { localIso } = require('./local-date.js');

let pmPaths = null;
try { pmPaths = require('./pm-paths.js'); } catch { pmPaths = null; }

/* =========================================================================
 * Vocabulary
 * ======================================================================= */

/** The record block's fence. One per batch report. */
const RECORD_FENCE_RE = /^```json[ \t]+batch-record[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm;

const APPROVAL_KINDS = Object.freeze(['slice', 'slice+acceptance', 'acceptance', 'renewal', 'rebind']);
const ACCEPTANCE_KINDS = Object.freeze(['slice+acceptance', 'acceptance']);
const SLICE_KINDS = Object.freeze(['slice', 'slice+acceptance']);
const EXECUTION_VALUES = Object.freeze(['human-gated', 'autopilot']);
const HOLD_STATES = Object.freeze(['open', 'closed']);
const REREVIEW_STATES = Object.freeze(['queued', 'in-re-review', 're-approved']);
const SHA_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?([+-]\d{2}:\d{2}|Z)$/;
/** The only environment variable names a record may ask the reader to read. */
const PRODUCT_REPO_ENV_RE = /^[A-Z][A-Z0-9_]*_REPO$/;

/**
 * The Phases view's grouping for a sidecar that carries delivery batches. A phase is
 * grouped by HOW ITS BATCHES ARE RUN, from recorded authorisation — never by the planned
 * run kind, which for a strategist sidecar claims every chat for an autopilot run whether
 * or not anyone authorised one (ADR-0305 §2). Keys are prefixed so they can never collide
 * with ADR-0197's `autopilot` / `batch` / `unclassified`.
 */
const EXECUTION_GROUPS = Object.freeze([
  {
    key: 'execution-human-gated',
    label: 'Human-gated',
    basis: 'every started batch in this phase records an entry authorisation and is run '
      + 'through human review gates',
  },
  {
    key: 'execution-autopilot-authorised',
    label: 'Autopilot, authorised',
    basis: 'every started batch in this phase records autopilot execution and a written run '
      + 'plan that names its run',
  },
  {
    key: 'execution-not-started',
    label: 'Not started',
    basis: 'no batch in this phase has a batch record, so none has recorded an entry',
  },
  {
    key: 'execution-mixed',
    label: 'Mixed',
    basis: 'the started batches in this phase record different execution modes',
  },
  {
    key: 'execution-unverified',
    label: 'Unverified',
    basis: 'a batch record in this phase claims an execution mode its evidence does not '
      + 'support',
  },
]);

const MODE_GROUP = Object.freeze({
  'human-gated': 'execution-human-gated',
  'autopilot-authorised': 'execution-autopilot-authorised',
  'not-started': 'execution-not-started',
  unverified: 'execution-unverified',
});

/* =========================================================================
 * Small helpers
 * ======================================================================= */

function str(v) { return v == null ? '' : String(v); }
function arr(v) { return Array.isArray(v) ? v : []; }
function short(sha) { return str(sha).slice(0, 7); }
function lf(text) { return str(text).replace(/\r\n/g, '\n'); }

/** Stable JSON: keys sorted at every depth, so two equal entries compare equal. */
function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

function rolePaths(pmRoot) {
  const canonicalMap = {
    stories: '32-Stories', testplans: '33-Testplans', bugs: '34-Bugs', features: '31-Features',
    reports: '41-Reports', monitor: '42-Monitor', active: '12-Active',
  };
  if (!pmPaths || typeof pmPaths.loadPaths !== 'function') return canonicalMap;
  try {
    const m = pmPaths.loadPaths(pmRoot) || {};
    return Object.assign({}, canonicalMap, ...Object.keys(canonicalMap)
      .filter((k) => typeof m[k] === 'string' && m[k])
      .map((k) => ({ [k]: m[k] })));
  } catch { return canonicalMap; }
}

function posix(p) { return str(p).replace(/\\/g, '/'); }

/* =========================================================================
 * Git
 * ======================================================================= */

function makeGit(runner) {
  const run = runner || spawnSync;
  return function git(cwd, args) {
    let r;
    try {
      r = run('git', ['-C', cwd, '-c', 'core.quotepath=off', ...args], {
        encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true,
      });
    } catch (e) {
      return { status: null, stdout: '', stderr: String(e && e.message), error: e };
    }
    return {
      status: typeof r.status === 'number' ? r.status : null,
      stdout: str(r.stdout),
      stderr: str(r.stderr),
      error: r.error || null,
    };
  };
}

/** A repository handle: its cwd, whether git can read it, and the PM tree's prefix in it. */
/**
 * `shown` is how a basis NAMES the location — never the location itself. A basis is
 * written into the board's payload, and the product location comes from an environment
 * variable, so echoing it would put that variable's value on the board (the security
 * finding on the first cut of this module). The variable's NAME is safe to show; its
 * value is not, whatever it holds.
 */
function openRepo(git, cwd, label, shown) {
  const where = shown || 'its configured path';
  if (!cwd) return { ok: false, label, cwd: '', basis: label + ' repository path is not set' };
  let exists = false;
  try { exists = fs.statSync(cwd).isDirectory(); } catch { exists = false; }
  if (!exists) return { ok: false, label, cwd, basis: label + ' repository path does not exist (' + where + ')' };
  const r = git(cwd, ['rev-parse', '--show-prefix']);
  const top = git(cwd, ['rev-parse', '--show-toplevel']);
  if (r.status !== 0 || top.status !== 0) {
    return { ok: false, label, cwd, basis: label + ' repository is not readable by git (' + where + ')' };
  }
  // Every command runs from the TOP LEVEL with full paths: pathspecs after `--` resolve
  // against the working directory, so running from inside the PM tree would silently
  // look for `<prefix><prefix>…` and find nothing.
  return { ok: true, label, cwd: top.stdout.trim(), prefix: r.stdout.trim(), basis: '' };
}

function refSha(git, repo, ref) {
  if (!repo.ok) return null;
  const r = git(repo.cwd, ['rev-parse', '--verify', '-q', ref + '^{commit}']);
  return r.status === 0 ? r.stdout.trim() : null;
}

/**
 * A ref's state: `present` (it names a commit), `missing` (no such ref — an unborn
 * branch), or `corrupt` (the ref exists but names no commit). A corrupt ref is never
 * read as unborn: that would turn unreadable evidence into "Not landed".
 */
function refState(git, repo, ref) {
  if (!repo.ok) return { state: 'unreadable', sha: null };
  const r = git(repo.cwd, ['rev-parse', '--verify', '-q', ref]);
  if (r.status !== 0) return { state: 'missing', sha: null };
  const sha = r.stdout.trim();
  if (git(repo.cwd, ['cat-file', '-e', sha + '^{commit}']).status !== 0) return { state: 'corrupt', sha };
  return { state: 'present', sha };
}

function commitExists(git, repo, sha) {
  if (!repo.ok || !SHA_RE.test(str(sha))) return false;
  return git(repo.cwd, ['cat-file', '-e', sha + '^{commit}']).status === 0;
}

/**
 * Is `a` an ancestor of `b`? `yes` / `no` / `unknown`, by `merge-base --is-ancestor`'s
 * own exit codes: 0 means yes, 1 means no, and anything else is Unknown — never a
 * guess in either direction (ADR-0305 §6).
 */
function ancestry(git, repo, a, b) {
  if (!repo.ok) return { state: 'unknown', basis: repo.basis };
  if (!commitExists(git, repo, a)) return { state: 'unknown', basis: 'commit ' + short(a) + ' is not in the ' + repo.label + ' repository' };
  const r = git(repo.cwd, ['merge-base', '--is-ancestor', a, b]);
  if (r.status === 0) return { state: 'yes', basis: '' };
  if (r.status === 1) return { state: 'no', basis: '' };
  return { state: 'unknown', basis: 'git merge-base exited ' + r.status + ' for ' + short(a) + ' against ' + b };
}

/**
 * A file at a commit, told apart three ways: `present` (with its text), `absent` (the
 * commit has no such path), or `unreadable` (git could not answer). `git show` fails the
 * same way for a missing path and a failed read, so the tree is asked first. A failed
 * read is never treated as an empty or missing file: that would turn "could not check"
 * into "nothing changed" (Codex's development review, finding 1).
 */
function readAt(git, repo, commit, pmRel) {
  if (!repo.ok) return { state: 'unreadable' };
  const t = git(repo.cwd, ['ls-tree', commit, '--', repo.prefix + pmRel]);
  if (t.status !== 0) return { state: 'unreadable' };
  if (!t.stdout.trim()) return { state: 'absent' };
  const r = git(repo.cwd, ['show', commit + ':' + repo.prefix + pmRel]);
  return r.status === 0 ? { state: 'present', text: r.stdout } : { state: 'unreadable' };
}

/** Paths under `pmDir` at `commit`, or `null` when git could not list them. */
function lsTree(git, repo, commit, pmDir) {
  if (!repo.ok) return null;
  const r = git(repo.cwd, ['ls-tree', '-r', '--name-only', commit, '--', repo.prefix + pmDir]);
  if (r.status !== 0) return null;
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean)
    .map((p) => (p.startsWith(repo.prefix) ? p.slice(repo.prefix.length) : p));
}

/** `git diff --name-status` between two commits, as {status, pmRel|null, repoPath}. */
function nameStatus(git, repo, a, b) {
  const r = git(repo.cwd, ['diff', '--name-status', '--no-renames', a, b]);
  if (r.status !== 0) return null;
  return r.stdout.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const parts = l.split('\t');
    const repoPath = parts[parts.length - 1];
    const inside = repoPath.startsWith(repo.prefix);
    return { status: parts[0].charAt(0), repoPath, pmRel: inside ? repoPath.slice(repo.prefix.length) : null };
  });
}

function revList(git, repo, args) {
  const r = git(repo.cwd, ['rev-list', ...args]);
  if (r.status !== 0) return null;
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}

/* =========================================================================
 * Records
 * ======================================================================= */

/**
 * Parse every batch-record block in a document. Returns {records, problems}; a document
 * with more than one block is a problem (one batch report holds one record).
 */
function parseRecordText(text) {
  const records = [];
  const problems = [];
  const body = str(text);
  RECORD_FENCE_RE.lastIndex = 0;
  let m;
  let count = 0;
  while ((m = RECORD_FENCE_RE.exec(body)) !== null) {
    count += 1;
    try {
      const obj = JSON.parse(m[1]);
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) problems.push('the batch-record block is not a JSON object');
      else records.push(obj);
    } catch (e) {
      problems.push('the batch-record block is not valid JSON (' + str(e && e.message).slice(0, 120) + ')');
    }
  }
  if (count > 1) problems.push('the document carries ' + count + ' batch-record blocks; one report holds one record');
  return { records, problems };
}

function walkMd(dir) {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkMd(full));
    else if (/\.md$/i.test(e.name)) out.push(full);
  }
  return out;
}

/**
 * The batch a report that could NOT be parsed belongs to, if it can still be told: the
 * `"batch"` key in the raw block, else a `B<n>` in the file name. A malformed record is
 * shown on its batch with its diagnostic; it never simply disappears (Codex's development
 * review, finding 3). '' when neither says.
 */
function claimedBatch(text, rel) {
  const m = /"batch"\s*:\s*"([^"\\]{1,40})"/.exec(str(text));
  if (m) return m[1];
  const f = /(?:^|[^A-Za-z0-9])(B\d+)(?=[^A-Za-z0-9]|$)/.exec(str(rel).split('/').pop());
  return f ? f[1] : '';
}

/**
 * Entries for one report: one per parsed record, and an UNREADABLE entry (`rec: null`)
 * when the report holds a record block that does not parse, or a record that names no
 * batch. An unreadable entry carries its diagnostic and the batch it claims, if any.
 */
function reportEntries(text, rel, source) {
  const parsed = parseRecordText(text);
  const out = [];
  for (const rec of parsed.records) {
    if (!str(rec.batch).trim()) {
      out.push({ rec: null, rel, source, claimed: claimedBatch('', rel),
        problems: parsed.problems.concat(['the batch record names no `batch`']) });
    } else out.push({ rec, rel, source, problems: parsed.problems });
  }
  if (!parsed.records.length && parsed.problems.length) {
    out.push({ rec: null, rel, source, claimed: claimedBatch(text, rel), problems: parsed.problems });
  }
  return out;
}

/** Batch records in the board's own tree (the working files the board is built from). */
function recordsInTree(pmRoot, roles) {
  const dir = path.join(pmRoot, roles.reports, 'phases');
  const out = [];
  for (const file of walkMd(dir)) {
    const rel = posix(path.relative(pmRoot, file));
    let text = null;
    try { text = fs.readFileSync(file, 'utf8'); } catch { text = null; }
    if (text == null) {
      out.push({ rec: null, rel, source: 'tree', claimed: claimedBatch('', rel), problems: ['the report cannot be read'] });
      continue;
    }
    if (text.indexOf('batch-record') === -1) continue;
    out.push(...reportEntries(text, rel, 'tree'));
  }
  return out;
}

/**
 * Batch records in another commit's tree (planning `main`, when the board's tree lacks
 * one). `{entries, unreadable}`: `unreadable` names what git could not read, because a
 * listing that failed must not read as "no record on main".
 */
function recordsAtRef(git, repo, ref, roles) {
  const out = { entries: [], unreadable: [] };
  if (!repo.ok) { out.unreadable.push(repo.basis); return out; }
  const rels = lsTree(git, repo, ref, roles.reports + '/phases');
  if (rels === null) { out.unreadable.push('the batch reports on planning main'); return out; }
  for (const rel of rels) {
    if (!/\.md$/i.test(rel)) continue;
    const doc = readAt(git, repo, ref, rel);
    if (doc.state === 'unreadable') {
      out.entries.push({ rec: null, rel, source: 'main', claimed: claimedBatch('', rel), problems: ['the report on planning main cannot be read'] });
      continue;
    }
    if (doc.state !== 'present' || doc.text.indexOf('batch-record') === -1) continue;
    out.entries.push(...reportEntries(doc.text, rel, 'main'));
  }
  return out;
}

/* =========================================================================
 * The plan: delivery batches out of a sidecar entry
 * ======================================================================= */

function storyId(s) { return str(s && typeof s === 'object' ? s.id : s); }

/** Normalise one sidecar's batches. Returns Map<batchId, batch>. */
function batchesOf(entry) {
  const out = new Map();
  const phases = arr(entry && entry.phases);
  const chatPhase = new Map();
  const chatById = new Map();
  phases.forEach((p, idx) => {
    for (const c of arr(p && p.chats)) {
      const id = str(c && c.id);
      if (id) { chatPhase.set(id, idx); chatById.set(id, c); }
    }
  });
  for (const b of arr(entry && entry.delivery_batches)) {
    const id = str(b && b.id);
    if (!id) continue;
    let phaseIndex = phases.findIndex((p) => arr(p && p.delivery_batches).map(str).includes(id));
    const slices = arr(b.slices).map((s, i) => ({
      label: str(s && s.label) || (id + '.' + (i + 1)),
      chat: str(s && s.chat),
      stories: arr(s && s.stories).map(storyId).filter(Boolean),
    }));
    if (phaseIndex < 0) {
      const first = slices.map((s) => chatPhase.get(s.chat)).find((v) => Number.isInteger(v));
      phaseIndex = Number.isInteger(first) ? first : -1;
    }
    out.set(id, {
      id,
      phaseIndex,
      stories: arr(b.stories).map(storyId).filter(Boolean),
      slices,
      chats: slices.map((s) => s.chat).filter(Boolean),
      chatById,
    });
  }
  return out;
}

/* =========================================================================
 * The permitted close-out delta (S..R) — ADR-0305 §4
 * ======================================================================= */

function splitDoc(text) {
  const t = lf(text);
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(t);
  if (!m) return { fm: {}, body: t };
  const fm = parseFrontmatter(t) || {};
  return { fm, body: t.slice(m[0].length) };
}

function fmKeys(fm) { return Object.keys(fm || {}).filter((k) => !k.startsWith('_')); }
function emptyVal(v) { return v == null || str(v).trim() === '' || str(v).trim() === "''"; }

/** Line ranges of a `## <title>` section, by a case-insensitive title test. */
function sectionOf(lines, titleRe) {
  const ranges = [];
  let inSec = false;
  for (let i = 0; i < lines.length; i++) {
    const h = /^##\s+(.*?)\s*$/.exec(lines[i]);
    if (h) inSec = titleRe.test(h[1]);
    if (inSec) ranges.push(i);
  }
  return new Set(ranges);
}

const CHECKBOX_RE = /^(\s*[-*]\s+)\[ \](.*)$/;
const SIGNOFF_LABEL_RE = /^(\s*[-*]\s+(?:\*\*)?(?:code review|date completed)(?:\*\*)?\s*:)/i;

function bodyViolations(kind, oldBody, newBody) {
  const a = lf(oldBody).split('\n');
  const b = lf(newBody).split('\n');
  if (kind === 'bug' || kind === 'feature') {
    return lf(oldBody) === lf(newBody) ? [] : ['the body changed'];
  }
  if (a.length !== b.length) return ['body lines were added or removed (' + a.length + ' → ' + b.length + ')'];
  const out = [];
  const dod = kind === 'story' ? sectionOf(a, /^dod checklist$/i) : null;
  const signoff = kind === 'testplan' ? sectionOf(a, /^sign-?off$/i) : null;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (kind === 'story') {
      const m = CHECKBOX_RE.exec(a[i]);
      const ok = dod.has(i) && m && (b[i] === m[1] + '[x]' + m[2] || b[i] === m[1] + '[X]' + m[2]);
      if (!ok) out.push('body line ' + (i + 1) + ' changed outside a DoD checkbox tick');
    } else if (kind === 'testplan') {
      const ma = SIGNOFF_LABEL_RE.exec(a[i]);
      const mb = SIGNOFF_LABEL_RE.exec(b[i]);
      const ok = signoff.has(i) && ma && mb && ma[1] === mb[1];
      if (!ok) out.push('body line ' + (i + 1) + ' changed outside the Sign-off values');
    }
  }
  return out;
}

function frontmatterViolations(kind, oldFm, newFm, ctx) {
  const out = [];
  const keys = new Set([...fmKeys(oldFm), ...fmKeys(newFm)]);
  for (const k of keys) {
    const a = oldFm[k];
    const b = newFm[k];
    if (canonical(a) === canonical(b)) continue;
    let ok = false;
    if (kind === 'story') {
      if (k === 'status') ok = str(a) === 'in-review' && (str(b) === 'done' || str(b) === 'blocked');
      else if (k === 'completed_at') ok = emptyVal(a) && ISO_RE.test(str(b)) && str(newFm.status) === 'done';
      else if (k === 'ai_review') {
        const m = /^completed-(\d{4}-\d{2}-\d{2})$/.exec(str(b));
        ok = str(a) === 'pending' && !!m && (!ctx.sDate || m[1] >= ctx.sDate);
      } else if (k === 'ai_review_artefact') {
        const p = posix(str(b));
        const pmRel = ctx.prefix && p.startsWith(ctx.prefix) ? p.slice(ctx.prefix.length) : p;
        ok = emptyVal(a) && ctx.addedReviews.has(pmRel);
      }
    } else if (kind === 'testplan') {
      if (k === 'status') ok = str(b) === 'done' && str(a) !== 'done';
      else if (k === 'completed_at') ok = emptyVal(a) && ISO_RE.test(str(b));
    } else if (kind === 'bug') {
      if (k === 'status') ok = str(a) === 'in-review' && str(b) === 'done';
      else if (k === 'completed_at') ok = emptyVal(a) && ISO_RE.test(str(b));
    } else if (kind === 'feature') {
      ok = k === 'status' || k === 'completed_at';
    }
    if (!ok) out.push('frontmatter `' + k + '` changed from ' + JSON.stringify(a == null ? null : a) + ' to ' + JSON.stringify(b == null ? null : b));
  }
  return out;
}

/**
 * The scope's files at a commit: stories, testplans, bugs naming them, their features.
 * `{files, unreadable}`. A listing or read git could not perform is NAMED in
 * `unreadable`, never treated as an empty result: an empty file set would let a failed
 * read pass for "nothing in scope changed" (Codex's development review, finding 1).
 */
function scopeFilesAt(ctx, commit, scope) {
  const key = commit + '|' + scope.join(',');
  if (ctx.cache.scopeFiles.has(key)) return ctx.cache.scopeFiles.get(key);
  const { git, plan, roles } = ctx;
  const files = new Map();
  const unreadable = [];
  const at = ' at ' + short(commit);
  const ids = new Set(scope);
  const storyList = lsTree(git, plan, commit, roles.stories);
  const tpList = lsTree(git, plan, commit, roles.testplans);
  if (storyList === null) unreadable.push('the story files' + at);
  if (tpList === null) unreadable.push('the testplan files' + at);
  const storyFiles = (storyList || []).filter((p) => /\.md$/i.test(p));
  const tpFiles = (tpList || []).filter((p) => /\.md$/i.test(p));
  const features = new Set();
  for (const p of storyFiles) {
    const base = p.split('/').pop();
    const id = (/^(STORY-\d+\.\d+\.\d+)/.exec(base) || [])[1];
    if (id && ids.has(id)) {
      files.set(p, 'story');
      const doc = readAt(git, plan, commit, p);
      if (doc.state !== 'present') { unreadable.push(p + at); continue; }
      const fm = splitDoc(doc.text).fm;
      if (fm.feature) features.add(str(fm.feature));
    }
  }
  for (const p of tpFiles) {
    const base = p.split('/').pop();
    const id = (/^TESTPLAN-(\d+\.\d+\.\d+)/.exec(base) || [])[1];
    if (id && ids.has('STORY-' + id)) files.set(p, 'testplan');
  }
  if (ids.size) {
    const alt = Array.from(ids).map((s) => s.replace(/\./g, '\\.')).join('|');
    const r = git(plan.cwd, ['grep', '-l', '-E', '^story:[[:space:]]*[\'"]?(' + alt + ')[\'"]?[[:space:]]*$',
      commit, '--', plan.prefix + roles.bugs]);
    // git grep: 0 found, 1 found nothing, anything else is a failed read.
    if (r.status === 0) {
      for (const line of r.stdout.split('\n').map((s) => s.trim()).filter(Boolean)) {
        const repoPath = line.startsWith(commit + ':') ? line.slice(commit.length + 1) : line;
        const pmRel = repoPath.startsWith(plan.prefix) ? repoPath.slice(plan.prefix.length) : repoPath;
        files.set(pmRel, 'bug');
      }
    } else if (r.status !== 1) unreadable.push('the bugs naming the scope' + at);
  }
  if (features.size) {
    const featList = lsTree(git, plan, commit, roles.features);
    if (featList === null) unreadable.push('the feature files' + at);
    for (const p of featList || []) {
      const base = p.split('/').pop();
      const id = (/^(FEAT-\d+\.\d+)/.exec(base) || [])[1];
      if (id && features.has(id)) files.set(p, 'feature');
    }
  }
  const out = { files, unreadable };
  ctx.cache.scopeFiles.set(key, out);
  return out;
}

function recordPathsOf(ctx, recordRel) {
  const { roles } = ctx;
  return new Set([
    posix(recordRel),
    roles.monitor + '/MONITOR.md',
    roles.active + '/ACTIVE.md',
  ]);
}

/**
 * Check S..R against the permitted close-out delta. Two checks, as ADR-0305 §4 states
 * them: each commit in the range touches only permitted paths, and the combined diff
 * changes only permitted fields in the permitted direction.
 */
function closeoutCheck(ctx, S, R, scope, recordRel) {
  const key = ['closeout', S, R, scope.join(','), recordRel].join('|');
  if (ctx.cache.closeout.has(key)) return ctx.cache.closeout.get(key);
  const { git, plan, roles } = ctx;
  const violations = [];
  // Reads the verdict depends on that git could not perform. Any one of them makes the
  // close-out unverified: never clean, and never a violation either (finding 1).
  const unreadable = [];
  const result = () => {
    const v = { ok: violations.length === 0 && unreadable.length === 0, violations, unreadable };
    ctx.cache.closeout.set(key, v);
    return v;
  };
  const anc = ancestry(git, plan, S, R);
  if (anc.state !== 'yes') {
    if (anc.state === 'no') violations.push('the record commit ' + short(R) + ' does not descend from the reviewed commit ' + short(S));
    else unreadable.push('the ancestry of the record commit (' + anc.basis + ')');
    return result();
  }
  const scoped = scopeFilesAt(ctx, S, scope);
  if (scoped.unreadable.length) {
    // Without the full scope the permitted set is incomplete, and every in-scope file
    // would look like an out-of-scope change. Neither clean nor invalidated: unverified.
    unreadable.push(...scoped.unreadable);
    return result();
  }
  const fileClass = scoped.files;
  const records = recordPathsOf(ctx, recordRel);
  const retroRel = roles.reports + '/retro/retro-log.jsonl';
  const reviewRe = new RegExp('^' + roles.reports.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    + '/reviews/AI-CODE-REVIEW-(STORY-\\d+\\.\\d+\\.\\d+)-[^/]+\\.html$');
  const permittedPath = (pmRel) => {
    if (pmRel == null) return false;
    if (records.has(pmRel) || pmRel === retroRel || fileClass.has(pmRel)) return true;
    const m = reviewRe.exec(pmRel);
    return !!(m && scope.includes(m[1]));
  };

  const commits = revList(git, plan, ['--reverse', '--ancestry-path', S + '..' + R]);
  if (commits === null) unreadable.push('the commits from ' + short(S) + ' to ' + short(R));
  for (const c of commits || []) {
    const parents = revList(git, plan, ['--parents', '-n', '1', c]);
    if (parents === null) { unreadable.push('the parent of commit ' + short(c)); continue; }
    const parent = str(parents[0]).split(' ')[1];
    if (!parent) { violations.push('commit ' + short(c) + ' has no parent to compare'); continue; }
    const changes = nameStatus(git, plan, parent, c);
    if (changes === null) { unreadable.push('the files commit ' + short(c) + ' changes'); continue; }
    for (const ch of changes) {
      if (!permittedPath(ch.pmRel)) {
        violations.push('commit ' + short(c) + ' changes ' + (ch.pmRel || ch.repoPath)
          + ', which is outside the permitted close-out set');
      }
    }
  }

  const sDateRaw = git(plan.cwd, ['show', '-s', '--format=%cI', S]);
  if (sDateRaw.status !== 0) unreadable.push('the date of the reviewed commit ' + short(S));
  const sDate = sDateRaw.status === 0 ? sDateRaw.stdout.trim().slice(0, 10) : '';
  const total = nameStatus(git, plan, S, R);
  if (total === null) unreadable.push('the combined diff from ' + short(S) + ' to ' + short(R));
  const addedReviews = new Set((total || []).filter((t) => t.status === 'A' && t.pmRel && reviewRe.test(t.pmRel))
    .map((t) => t.pmRel));
  // Both sides of a modified file must be read; a failed read is named, never compared as empty.
  const bothSides = (pmRel) => {
    const a = readAt(git, plan, S, pmRel);
    const b = readAt(git, plan, R, pmRel);
    if (a.state !== 'present' || b.state !== 'present') {
      unreadable.push(pmRel + ' at ' + short(a.state !== 'present' ? S : R));
      return null;
    }
    return { before: a.text, after: b.text };
  };
  for (const t of total || []) {
    if (!permittedPath(t.pmRel)) continue; // already named per commit
    if (records.has(t.pmRel)) {
      if (t.status === 'D') violations.push(t.pmRel + ' was deleted in the close-out');
      continue;
    }
    if (t.pmRel === retroRel) {
      // Added in the close-out is an append to an empty log; deleted is a rewrite.
      if (t.status === 'A') continue;
      if (t.status === 'D') { violations.push(retroRel + ' was rewritten; it is append-only'); continue; }
      const sides = bothSides(retroRel);
      if (sides && !lf(sides.after).startsWith(lf(sides.before))) violations.push(retroRel + ' was rewritten; it is append-only');
      continue;
    }
    if (reviewRe.test(t.pmRel)) {
      if (t.status !== 'A') violations.push(t.pmRel + ' existed at the reviewed commit and was changed');
      continue;
    }
    const kind = fileClass.get(t.pmRel);
    if (t.status !== 'M') { violations.push(t.pmRel + ' was ' + (t.status === 'D' ? 'deleted' : 'added') + ' in the close-out'); continue; }
    const sides = bothSides(t.pmRel);
    if (!sides) continue;
    const before = splitDoc(sides.before);
    const after = splitDoc(sides.after);
    for (const v of frontmatterViolations(kind, before.fm, after.fm, { sDate, addedReviews, prefix: plan.prefix })) {
      violations.push(t.pmRel + ': ' + v);
    }
    for (const v of bodyViolations(kind, before.body, after.body)) violations.push(t.pmRel + ': ' + v);
  }
  return result();
}

/* =========================================================================
 * Approval entries
 * ======================================================================= */

/** Resolve renewal/rebind `of` chains to the entry kind, slice and scope they apply to. */
function effectiveEntries(approvals) {
  const list = arr(approvals);
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const e = list[i] || {};
    const kind = str(e.kind);
    let eff = { kind, slice: str(e.slice), scope: arr(e.scope).map(str), problems: [] };
    if (!APPROVAL_KINDS.includes(kind)) eff.problems.push('unknown approval kind "' + kind + '"');
    if (kind === 'renewal' || kind === 'rebind') {
      const of = Number(e.of);
      const target = Number.isInteger(of) && of >= 0 && of < i ? out[of] : null;
      if (!target) {
        eff.problems.push(kind + ' entry ' + i + ' names no earlier entry in `of`');
      } else {
        eff = {
          kind: target.kind,
          slice: e.slice ? str(e.slice) : target.slice,
          scope: arr(e.scope).length ? arr(e.scope).map(str) : target.scope,
          problems: [],
          renews: kind === 'renewal' ? of : null,
          rebinds: kind === 'rebind' ? of : null,
        };
        if (kind === 'rebind') {
          const t = list[of] || {};
          for (const f of ['by', 'ref', 'planning_reviewed', 'product_reviewed']) {
            if (str(e[f]) !== str(t[f])) eff.problems.push('rebind entry ' + i + ' does not repeat `' + f + '` of entry ' + of);
          }
        }
      }
    }
    out.push(eff);
  }
  return out;
}

/**
 * R: the first commit after S on the ancestry path to `ref` whose record holds the entry.
 * `{sha, unreadable}`: `sha` null with `unreadable` '' means provably not on that path; a
 * history or file read git could not perform is named in `unreadable` instead.
 */
function introducingCommit(ctx, entry, S, ref, recordRel) {
  const { git, plan } = ctx;
  if (!ref) return { sha: null, unreadable: '' };
  const key = ['intro', canonical(entry), ref, recordRel].join('|');
  if (ctx.cache.intro.has(key)) return ctx.cache.intro.get(key);
  const want = canonical(entry);
  const r = git(plan.cwd, ['log', '--format=%H', '--reverse', '--ancestry-path', S + '..' + ref, '--',
    plan.prefix + recordRel]);
  let found = { sha: null, unreadable: '' };
  if (r.status !== 0) found = { sha: null, unreadable: 'the history of ' + recordRel + ' after ' + short(S) };
  else {
    for (const c of r.stdout.split('\n').map((s) => s.trim()).filter(Boolean)) {
      const doc = readAt(git, plan, c, recordRel);
      if (doc.state === 'absent') continue; // the commit deleted the report
      if (doc.state !== 'present') { found = { sha: null, unreadable: recordRel + ' at ' + short(c) }; break; }
      const parsed = parseRecordText(doc.text);
      const has = parsed.records.some((rec) => arr(rec.approvals).some((a) => canonical(a) === want));
      if (has) { found = { sha: c, unreadable: '' }; break; }
    }
  }
  ctx.cache.intro.set(key, found);
  return found;
}

function ledgerNote(record, story) {
  const hit = arr(record && record.rereview).filter((x) => str(x && x.story) === story).pop();
  if (!hit) return '';
  return ' (re-review ledger: ' + str(hit.state) + (hit.change ? ', change ' + short(hit.change) : '')
    + (hit.group ? ', group ' + str(hit.group) : '') + ')';
}

function storyOfPath(pmRel) {
  const base = str(pmRel).split('/').pop();
  const m = /^(STORY-\d+\.\d+\.\d+)/.exec(base) || /^TESTPLAN-(\d+\.\d+\.\d+)/.exec(base);
  if (!m) return '';
  return m[1].startsWith('STORY-') ? m[1] : 'STORY-' + m[1];
}

/* =========================================================================
 * Landing — ADR-0305 §6
 * ======================================================================= */

/**
 * `acceptance` is the recorded entry; `accEval` is its evaluation, which carries R (the
 * commit that records it). Planning has landed only when R is on planning main: S on
 * main with the record still on the delivery branch is not a landing (Codex's
 * development review, finding 2). R descends from S, so R on main also puts S there.
 */
function evalLanding(ctx, record, acceptance, accEval) {
  const { git, plan } = ctx;
  const mainRef = str(record && record.main_branch) || 'main';
  const manifest = (record && record.manifest) || {};
  const out = {
    state: 'not-prepared',
    planning: { state: 'not-prepared', basis: '', main: null },
    product: { state: 'not-prepared', basis: '', main: null },
    checkedAt: ctx.now,
  };
  if (!acceptance) {
    out.planning.basis = out.product.basis = 'no acceptance is recorded, so there is no reviewed commit to look for';
    return out;
  }
  if (!manifest || (!manifest.planning_main_before && !manifest.product_main_before)) {
    out.planning.basis = out.product.basis = 'the record carries no landing manifest';
    return out;
  }
  const S = str(acceptance.planning_reviewed);
  const P = str(acceptance.product_reviewed);

  // Planning side.
  const pRef = refState(git, plan, 'refs/heads/' + mainRef);
  const pMain = pRef.state === 'present' ? pRef.sha : null;
  out.planning.main = pMain;
  if (!plan.ok) out.planning = { state: 'unknown', basis: plan.basis, main: null };
  else if (pRef.state === 'corrupt') out.planning = { state: 'unknown', basis: 'planning ' + mainRef + ' names a missing object (' + short(pRef.sha) + ')', main: null };
  else if (!pMain) out.planning = { state: 'unknown', basis: 'planning ' + mainRef + ' is missing', main: null };
  else {
    const R = accEval && accEval.R;
    const where = ' planning ' + mainRef + ' ' + short(pMain);
    if (R) {
      const a = ancestry(git, plan, R, pMain);
      out.planning.state = a.state === 'yes' ? 'landed' : a.state === 'no' ? 'not-landed' : 'unknown';
      out.planning.basis = a.state === 'yes'
        ? 'record commit ' + short(R) + ' (reviewed ' + short(S) + ') is in' + where
        : a.state === 'no'
          ? 'record commit ' + short(R) + ' is not in' + where
          : a.basis;
    } else if (accEval && arr(accEval.unreadable).length) {
      out.planning.state = 'unknown';
      out.planning.basis = 'cannot read ' + accEval.unreadable.join('; ');
    } else {
      // No commit records the entry on main or on the branch: landing cannot be proved.
      const a = ancestry(git, plan, S, pMain);
      out.planning.state = a.state === 'unknown' ? 'unknown' : 'not-landed';
      out.planning.basis = a.state === 'yes'
        ? 'reviewed planning commit ' + short(S) + ' is in' + where + ', but no commit there records this acceptance'
        : a.state === 'no'
          ? 'reviewed planning commit ' + short(S) + ' is not in' + where
          : a.basis;
    }
  }

  // Product side.
  const prod = ctx.product(record);
  if (!prod.ok) out.product = { state: 'unknown', basis: prod.basis, main: null };
  else {
    const prodRef = refState(git, prod, 'refs/heads/' + mainRef);
    const prodMain = prodRef.state === 'present' ? prodRef.sha : null;
    out.product.main = prodMain;
    if (prodRef.state === 'corrupt') {
      out.product = { state: 'unknown', basis: 'product ' + mainRef + ' names a missing object (' + short(prodRef.sha) + ')', main: null };
    } else if (!prodMain) {
      if (str(manifest.product_main_before) === 'unborn') {
        out.product = { state: 'not-landed', basis: 'product ' + mainRef + ' is unborn, as the manifest expected', main: null };
      } else {
        out.product = {
          state: 'unknown',
          basis: 'product ' + mainRef + ' is missing; the manifest expected '
            + (manifest.product_main_before ? short(manifest.product_main_before) : 'a commit'),
          main: null,
        };
      }
    } else {
      const a = ancestry(git, prod, P, prodMain);
      out.product.state = a.state === 'yes' ? 'landed' : a.state === 'no' ? 'not-landed' : 'unknown';
      out.product.basis = a.state === 'yes'
        ? 'reviewed product commit ' + short(P) + ' is in product ' + mainRef + ' ' + short(prodMain)
        : a.state === 'no'
          ? 'reviewed product commit ' + short(P) + ' is not in product ' + mainRef + ' ' + short(prodMain)
          : a.basis;
    }
  }

  const sides = [out.planning.state, out.product.state];
  if (sides.includes('unknown')) out.state = 'unknown';
  else if (sides.every((s) => s === 'landed')) out.state = 'landed';
  else if (sides.includes('landed')) out.state = 'partially-landed';
  else out.state = 'not-landed';
  return out;
}

/* =========================================================================
 * Execution mode — ADR-0305 §2
 * ======================================================================= */

function proposedRunsFor(entry, batch) {
  const chats = new Set(batch.chats);
  return arr(entry && entry.autopilot_runs)
    .filter((r) => arr(r && r.chats).map(str).some((c) => chats.has(c)))
    .map((r) => str(r.id))
    .filter(Boolean);
}

function evalExecution(ctx, record, batch, proposedRuns) {
  if (!record) {
    return { mode: 'not-started', basis: 'no batch record, so no entry authorisation is recorded' };
  }
  const exec = str(record.execution);
  const entry = record.entry || {};
  const who = str(entry.by);
  const at = str(entry.at);
  const ref = str(entry.ref);
  if (exec === 'human-gated') {
    if (!who || !at || !ref) {
      return { mode: 'unverified', basis: 'human-gated is claimed without a complete entry authorisation (by, at, ref)' };
    }
    return { mode: 'human-gated', basis: 'entry authorised by ' + who + ' at ' + at + ' (' + ref + ')', by: who, at, ref };
  }
  if (exec === 'autopilot') {
    const planRel = posix(str(record.run_plan));
    if (!planRel) return { mode: 'unverified', basis: 'autopilot claimed, no run plan' };
    const abs = path.join(ctx.pmRoot, planRel);
    let plan = null;
    try {
      // eslint-disable-next-line global-require
      const reader = require('../autopilot-plan.js');
      plan = typeof reader.readPlan === 'function' ? reader.readPlan(abs) : null;
    } catch { plan = null; }
    if (!plan || !plan.exists) return { mode: 'unverified', basis: 'autopilot claimed, but run plan ' + planRel + ' is not readable' };
    const scope = new Set(arr(plan.scope_chats).map(str));
    const names = proposedRuns.includes(str(plan.run_id)) || batch.chats.some((c) => scope.has(c));
    if (!names) return { mode: 'unverified', basis: 'autopilot claimed, but run plan ' + planRel + ' does not name this batch\'s run' };
    return { mode: 'autopilot-authorised', basis: 'run plan ' + planRel + ' names run ' + str(plan.run_id), runPlan: planRel, by: who, at, ref };
  }
  return { mode: 'unverified', basis: 'the record names no known execution mode ("' + exec + '")' };
}

/* =========================================================================
 * Approval evaluation — ADR-0305 §3–§5 and C1
 * ======================================================================= */

function evalEntry(ctx, args) {
  const { git, plan } = ctx;
  const { record, recordRel, entry, eff, strategyBatch, isAcceptance, batchHasAcceptance } = args;
  const S = str(entry.planning_reviewed);
  const P = str(entry.product_reviewed);
  const reasons = [];
  const notes = [];
  const out = {
    S, P, R: null, state: 'unverified', mode: 'pre-landing', reasons, notes, unreadable: [],
    closeout: { ok: false, violations: [], unreadable: [] },
  };
  if (eff.problems.length) {
    // A malformed entry cannot be evaluated against anything; it is never Current.
    reasons.push(...eff.problems);
    return out;
  }
  if (!SHA_RE.test(S) || !SHA_RE.test(P)) {
    reasons.push('the entry does not name 40-character reviewed commits for both repositories');
    out.state = 'unverified';
    return out;
  }
  if (!plan.ok) { reasons.push(plan.basis); return out; }
  if (!commitExists(git, plan, S)) {
    reasons.push('reviewed planning commit ' + short(S) + ' is not in the planning repository');
    return out;
  }

  // Scope: the entry's scope against the plan's membership (slice or whole batch).
  const planned = isAcceptance ? strategyBatch.stories
    : ((strategyBatch.slices.find((s) => s.label === eff.slice) || {}).stories || []);
  const sameScope = eff.scope.length === planned.length && eff.scope.every((s, i) => s === planned[i]);
  const scopeProblem = !sameScope && !entry.scope_amended_by
    ? 'the scope differs from the published strategy (' + (eff.scope.join(', ') || 'none')
      + ' against ' + (planned.join(', ') || 'none') + ')'
    : '';
  if (!sameScope && entry.scope_amended_by) notes.push('scope amended under ' + str(entry.scope_amended_by));

  // Where R is searched: planning main first, then the planning branch. S reaching main is
  // not enough to stop looking on the branch: until R ITSELF is on main, the record may
  // live only on the branch (Codex's development review, finding 2).
  const mainRef = str(record.main_branch) || 'main';
  const pMain = refSha(git, plan, 'refs/heads/' + mainRef);
  const sOnMain = pMain ? ancestry(git, plan, S, pMain).state : 'unknown';
  const branch = str((record.branches || {}).planning);
  const H = branch ? refSha(git, plan, 'refs/heads/' + branch) : null;
  let found = pMain ? introducingCommit(ctx, entry, S, pMain, recordRel) : { sha: null, unreadable: '' };
  if (!found.sha && !found.unreadable && H && H !== pMain) found = introducingCommit(ctx, entry, S, H, recordRel);
  out.unreadable = found.unreadable ? [found.unreadable] : [];
  out.R = found.sha;
  if (!out.R) {
    reasons.push(found.unreadable
      ? 'cannot read ' + found.unreadable
      : H
        ? 'no commit after ' + short(S) + ' on planning ' + mainRef + ' or ' + branch + ' records this entry'
        : 'planning branch ' + (branch || '(unnamed)') + ' is missing and the batch has not landed');
    out.state = 'unverified';
    return out;
  }

  const scopeForAllowlist = eff.scope.length ? eff.scope : planned;
  out.closeout = closeoutCheck(ctx, S, out.R, scopeForAllowlist, recordRel);
  const invalid = [];
  if (out.closeout.violations.length) invalid.push(...out.closeout.violations);
  if (scopeProblem) invalid.push(scopeProblem);
  // A read the verdict needs and git could not perform: never Current, never Accepted.
  const unreadable = out.closeout.unreadable.map((u) => 'cannot read ' + u);
  out.unreadable.push(...out.closeout.unreadable);

  // HISTORICAL: S and R on planning main and P on product main. Judged from S, P, R alone.
  const prod = ctx.product(record);
  const prodRef = prod.ok ? refState(git, prod, 'refs/heads/' + mainRef) : { state: 'unreadable', sha: null };
  const prodMain = prodRef.state === 'present' ? prodRef.sha : null;
  const rOnMain = pMain ? ancestry(git, plan, out.R, pMain).state : 'unknown';
  const pOnMain = prodMain ? ancestry(git, prod, P, prodMain).state
    : (prodRef.state === 'missing' ? 'no' : 'unknown');
  if (isAcceptance && sOnMain === 'yes' && rOnMain === 'yes' && pOnMain === 'yes') {
    out.mode = 'historical';
    if (invalid.length) { out.state = 'invalidated'; reasons.push(...invalid, ...unreadable); }
    else if (unreadable.length) { out.state = 'unverified'; reasons.push(...unreadable); }
    else out.state = 'historical';
    return out;
  }
  if (isAcceptance && sOnMain === 'yes' && rOnMain === 'yes' && pOnMain === 'unknown') {
    out.mode = 'historical';
    reasons.push(...invalid, ...unreadable);
    reasons.push('cannot confirm the product side: ' + (prod.ok ? 'product ancestry unknown' : prod.basis));
    out.state = invalid.length ? 'invalidated' : 'unverified';
    return out;
  }

  // PRE-LANDING.
  const unverified = unreadable.slice();
  let rebind = false;
  if (!H) {
    unverified.push('planning branch ' + (branch || '(unnamed)') + ' is missing and the batch has not landed');
  } else if (!isAcceptance && !batchHasAcceptance) {
    // C1: an in-progress slice. Later authorised slices move both heads on; that alone
    // never invalidates this approval.
    const anc = ancestry(git, plan, out.R, H);
    if (anc.state === 'no') invalid.push('planning branch ' + branch + ' no longer contains the record commit ' + short(out.R));
    else if (anc.state === 'unknown') unverified.push(anc.basis);
    else {
      const scoped = scopeFilesAt(ctx, out.R, scopeForAllowlist);
      unverified.push(...scoped.unreadable.map((u) => 'cannot read ' + u));
      out.unreadable.push(...scoped.unreadable);
      const files = Array.from(scoped.files.entries())
        .filter(([, kind]) => kind === 'story' || kind === 'testplan' || kind === 'bug')
        .map(([p]) => p);
      if (files.length) {
        const r = git(plan.cwd, ['log', '--format=%H', out.R + '..' + H, '--', ...files.map((p) => plan.prefix + p)]);
        const changed = git(plan.cwd, ['diff', '--name-only', out.R, H, '--', ...files.map((p) => plan.prefix + p)]);
        if (changed.status === 0) {
          for (const repoPath of changed.stdout.split('\n').map((s) => s.trim()).filter(Boolean)) {
            const pmRel = repoPath.startsWith(plan.prefix) ? repoPath.slice(plan.prefix.length) : repoPath;
            const commits = r.status === 0 ? r.stdout.split('\n').filter(Boolean).map(short) : [];
            invalid.push(pmRel + ' changed after the approval' + (commits.length ? ' (' + commits.join(', ') + ')' : '')
              + ledgerNote(record, storyOfPath(pmRel)));
          }
        } else unverified.push('cannot diff the slice\'s files after ' + short(out.R));
      }
    }
  } else if (H !== out.R) {
    const anc = ancestry(git, plan, out.R, H);
    if (anc.state !== 'yes') {
      if (anc.state === 'no') invalid.push('planning branch ' + branch + ' no longer contains the record commit ' + short(out.R));
      else unverified.push(anc.basis);
    } else {
      const records = recordPathsOf(ctx, recordRel);
      const retroRel = ctx.roles.reports + '/retro/retro-log.jsonl';
      const failed = [];
      const after = revList(git, plan, ['--reverse', out.R + '..' + H]);
      if (after === null) failed.push('the commits after the record commit ' + short(out.R));
      let substantive = false;
      for (const c of after || []) {
        const parents = revList(git, plan, ['--parents', '-n', '1', c]);
        const parent = parents === null ? '' : str(parents[0]).split(' ')[1];
        const changes = parent ? nameStatus(git, plan, parent, c) : null;
        if (changes === null) { failed.push('the files commit ' + short(c) + ' changes'); continue; }
        for (const ch of changes) {
          if (ch.pmRel === retroRel && ch.status === 'M') {
            const a = readAt(git, plan, parent, retroRel);
            const b = readAt(git, plan, c, retroRel);
            if (a.state !== 'present' || b.state !== 'present') { failed.push(retroRel + ' at ' + short(c)); continue; }
            if (lf(b.text).startsWith(lf(a.text))) continue;
          }
          if (!records.has(ch.pmRel) || ch.status === 'D') {
            substantive = true;
            invalid.push('commit ' + short(c) + ' changes ' + (ch.pmRel || ch.repoPath) + ' after the record commit'
              + ledgerNote(record, storyOfPath(ch.pmRel)));
          }
        }
      }
      if (failed.length) { unverified.push(...failed.map((u) => 'cannot read ' + u)); out.unreadable.push(...failed); }
      // A rebind restores only an approval whose later commits were all READ and found to be records-only.
      else if (!substantive) rebind = true;
    }
  }

  // Product side before landing.
  if (!prod.ok) unverified.push(prod.basis);
  else {
    const pBranch = str((record.branches || {}).product);
    const pHead = pBranch ? refSha(git, prod, 'refs/heads/' + pBranch) : null;
    if (!commitExists(git, prod, P)) unverified.push('reviewed product commit ' + short(P) + ' is not in the product repository');
    else if (!pHead) {
      if (pOnMain !== 'yes') unverified.push('product branch ' + (pBranch || '(unnamed)') + ' is missing and the product side has not landed');
    } else if (!isAcceptance && !batchHasAcceptance) {
      const a = ancestry(git, prod, P, pHead);
      if (a.state === 'no') invalid.push('product branch ' + pBranch + ' no longer contains the reviewed commit ' + short(P));
      else if (a.state === 'unknown') unverified.push(a.basis);
    } else if (pHead !== P && pOnMain !== 'yes') {
      const a = ancestry(git, prod, P, pHead);
      if (a.state === 'yes') {
        const later = revList(git, prod, [P + '..' + pHead]);
        invalid.push((later === null ? 'one or more' : later.length) + ' product commit(s) after the reviewed commit '
          + short(P) + ' on ' + pBranch);
      } else if (a.state === 'no') invalid.push('product branch ' + pBranch + ' no longer contains the reviewed commit ' + short(P));
      else unverified.push(a.basis);
    }
  }

  if (invalid.length) { out.state = 'invalidated'; reasons.push(...invalid, ...unverified); }
  else if (unverified.length) { out.state = 'unverified'; reasons.push(...unverified); }
  else if (rebind) {
    out.state = 'rebind-required';
    reasons.push('only record files changed after the record commit ' + short(out.R)
      + '; a rebind entry restores it without a review');
  } else out.state = 'current';
  return out;
}

/**
 * Files changed after R, for the current-state block. Informational, never staleness.
 * `{changes, unreadable}`: a read git could not perform is named, not shown as "no change".
 */
function changedSince(ctx, R, scope) {
  const { git, plan } = ctx;
  const none = { changes: [], unreadable: [] };
  if (!R || !plan.ok) return none;
  const head = refSha(git, plan, 'HEAD');
  if (!head) return none;
  const anc = ancestry(git, plan, R, head);
  if (anc.state === 'no') return none;
  if (anc.state !== 'yes') return { changes: [], unreadable: ['the ancestry of the record commit (' + anc.basis + ')'] };
  const scoped = scopeFilesAt(ctx, R, scope);
  const unreadable = scoped.unreadable.slice();
  const files = Array.from(scoped.files.entries())
    .filter(([, kind]) => kind === 'story' || kind === 'testplan')
    .map(([p]) => p);
  const changes = [];
  for (const p of files) {
    const r = git(plan.cwd, ['log', '--format=%H%x09%cI', R + '..' + head, '--', plan.prefix + p]);
    if (r.status !== 0) { unreadable.push('the history of ' + p + ' after ' + short(R)); continue; }
    const commits = r.stdout.split('\n').map((s) => s.trim()).filter(Boolean)
      .map((l) => { const [sha, at] = l.split('\t'); return { sha: short(sha), at }; });
    if (commits.length) changes.push({ path: p, commits });
  }
  return { changes, unreadable };
}

/* =========================================================================
 * The reader
 * ======================================================================= */

function rollUpPhase(modes) {
  const started = modes.filter((m) => m !== 'not-started');
  if (!started.length) return 'execution-not-started';
  const distinct = Array.from(new Set(started));
  if (distinct.length === 1) return MODE_GROUP[distinct[0]] || 'execution-unverified';
  return 'execution-mixed';
}

/**
 * Evaluate every delivery batch of every sidecar that declares them.
 *
 * @param {object} o
 * @param {object} o.strategy   the generator's `executionStrategy` ({epics: [...]})
 * @param {string} o.pmRoot     the PM root the board is built from
 * @param {object[]} [o.stories] the live story records ({id, status, ...}), for the
 *                               "work recorded, entry not recorded" flag
 * @param {object} [o.env]      environment for `product_repo_env` (default process.env)
 * @param {function} [o.runner] injectable spawnSync, for tests
 * @param {string} [o.now]      the check time to stamp (default: now, offset-preserving)
 * @returns {object} `{checkedAt, builtFrom, strategies: [...]}`. Never throws.
 */
function evaluate(o) {
  const opts = o || {};
  const now = str(opts.now) || localIso(new Date());
  const empty = { checkedAt: now, builtFrom: null, strategies: [] };
  try {
    const epics = arr(opts.strategy && opts.strategy.epics);
    const withBatches = epics.filter((e) => Array.isArray(e && e.delivery_batches));
    if (!withBatches.length) return empty;
    const pmRoot = path.resolve(str(opts.pmRoot) || '.');
    const git = makeGit(opts.runner);
    const env = opts.env || process.env;
    const roles = rolePaths(pmRoot);
    const plan = openRepo(git, pmRoot, 'planning', 'the PM root');
    const productRepos = new Map();
    const ctx = {
      pmRoot, git, env, roles, plan, now,
      cache: { scopeFiles: new Map(), closeout: new Map(), intro: new Map() },
      product(record) {
        const varName = str(record && record.product_repo_env);
        if (!varName) return { ok: false, label: 'product', basis: 'the record names no product_repo_env' };
        // A record is corpus data, and it chooses which environment variable is read. Only a
        // `*_REPO` name is read, so a record cannot point the reader at an arbitrary variable,
        // and nothing read from the environment is ever echoed (see openRepo).
        if (!PRODUCT_REPO_ENV_RE.test(varName)) {
          return { ok: false, label: 'product', basis: 'product_repo_env "' + varName
            + '" is not a *_REPO variable name, so it is not read' };
        }
        const cwd = str(env[varName]);
        if (!cwd) return { ok: false, label: 'product', basis: 'environment variable ' + varName + ' is not set' };
        if (!productRepos.has(cwd)) productRepos.set(cwd, openRepo(git, cwd, 'product', 'the path in ' + varName));
        return productRepos.get(cwd);
      },
    };
    const builtFrom = plan.ok
      ? { branch: git(pmRoot, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim(), head: refSha(git, plan, 'HEAD') }
      : { branch: '', head: null, basis: plan.basis };

    const statusOf = new Map(arr(opts.stories).filter((s) => s && s.id).map((s) => [str(s.id), str(s.status)]));

    // Records: the board's tree first; planning main's tree for any batch the tree lacks.
    // A report the reader cannot parse stays on the batch it claims and is SHOWN there; it
    // is never skipped, and it never lets an older record on main stand in for it. A
    // report that cannot be attributed to any batch makes every batch without its own
    // readable record Unverified, because it may be any of theirs (finding 3).
    const treeRecords = recordsInTree(pmRoot, roles);
    const orphans = (list) => list.filter((r) => !r.rec && !r.claimed);
    let main = null;
    const mainEntries = () => {
      if (main === null) {
        const ref = refState(git, plan, 'refs/heads/main');
        if (ref.state === 'present') main = recordsAtRef(git, plan, ref.sha, roles);
        else if (ref.state === 'missing') main = { entries: [], unreadable: [] };
        else main = { entries: [], unreadable: ['planning main (' + (ref.state === 'corrupt' ? 'it names a missing object' : 'unreadable') + ')'] };
      }
      return main;
    };
    const recordFor = (strategyFile, batchId) => {
      const match = (r) => (r.rec
        ? str(r.rec.batch) === batchId && (!r.rec.strategy || path.basename(str(r.rec.strategy)) === strategyFile)
        : r.claimed === batchId);
      const t = treeRecords.filter(match);
      if (t.length) return { found: t, blockers: [] };
      const blockers = orphans(treeRecords).map((r) => 'the batch report ' + r.rel
        + ' in the board\'s tree cannot be read and names no batch (' + r.problems.join('; ') + '), so it may be this batch\'s record');
      const m = mainEntries();
      blockers.push(...m.unreadable.map((u) => 'cannot read ' + u + ', so a record there cannot be ruled out'));
      if (!blockers.length) blockers.push(...orphans(m.entries).map((r) => 'the batch report ' + r.rel
        + ' on planning main cannot be read and names no batch (' + r.problems.join('; ') + '), so it may be this batch\'s record'));
      return { found: m.entries.filter(match), blockers };
    };

    const strategies = [];
    for (const entry of withBatches) {
      const file = path.basename(str(entry.file));
      const batches = batchesOf(entry);
      const outBatches = {};
      const phaseModes = new Map();
      for (const b of batches.values()) {
        const lookup = recordFor(file, b.id);
        const found = lookup.found;
        const problems = [];
        if (found.length > 1) problems.push(found.length + ' batch records name ' + b.id + '; the first is used');
        // An unreadable report for this batch wins over any readable one beside it: the
        // board cannot tell which is current, so it says so rather than choosing.
        const hit = found.find((r) => !r.rec) || found[0] || null;
        const unreadableRecord = !!(hit && !hit.rec);
        const blocked = !hit && lookup.blockers.length > 0;
        const record = hit && hit.rec ? hit.rec : null;
        if (hit) problems.push(...arr(hit.problems));
        problems.push(...lookup.blockers);
        const proposedRuns = proposedRunsFor(entry, b);
        let execution = evalExecution(ctx, record, b, proposedRuns);
        if (unreadableRecord) {
          execution = { mode: 'unverified', basis: 'the batch record in ' + hit.rel + ' cannot be read: ' + arr(hit.problems).join('; ') };
        } else if (blocked) execution = { mode: 'unverified', basis: lookup.blockers[0] };
        const workMoving = b.stories.some((s) => ['in-progress', 'in-review', 'done', 'blocked'].includes(statusOf.get(s)));
        const effs = effectiveEntries(record && record.approvals);
        const list = arr(record && record.approvals);
        const accIdx = effs.map((e, i) => (ACCEPTANCE_KINDS.includes(e.kind) ? i : -1)).filter((i) => i >= 0).pop();
        const hasAcceptance = Number.isInteger(accIdx);
        const evaluated = list.map((entryObj, i) => {
          const eff = effs[i];
          const isAcceptance = ACCEPTANCE_KINDS.includes(eff.kind);
          const base = {
            index: i, kind: str(entryObj.kind), effectiveKind: eff.kind, slice: eff.slice, scope: eff.scope,
            by: str(entryObj.by), at: str(entryObj.at), ref: str(entryObj.ref),
            evidence: entryObj.evidence || null, renews: eff.renews == null ? null : eff.renews,
            rebinds: eff.rebinds == null ? null : eff.rebinds,
          };
          const recorded = { S: str(entryObj.planning_reviewed), P: str(entryObj.product_reviewed), R: null,
            closeout: { ok: true, violations: [] }, notes: [] };
          const latestOfItsKind = isAcceptance ? i === accIdx
            : i === effs.map((e, j) => (e.slice === eff.slice && SLICE_KINDS.includes(e.kind) ? j : -1)).filter((j) => j >= 0).pop();
          if (!latestOfItsKind) {
            return Object.assign(base, recorded, { state: 'superseded', mode: 'superseded',
              reasons: ['a later entry of the same kind supersedes it'] });
          }
          if (!isAcceptance && hasAcceptance) {
            // C1's end: once the batch has an acceptance entry, the batch-level rules apply to
            // THAT entry and the slice entries before it stay in the record as history.
            return Object.assign(base, recorded, { state: 'history', mode: 'history',
              reasons: ['kept as history: the batch\'s acceptance entry ' + accIdx + ' governs'] });
          }
          const ev = evalEntry(ctx, {
            record, recordRel: hit.rel, entry: entryObj, eff, strategyBatch: b,
            isAcceptance, batchHasAcceptance: hasAcceptance,
          });
          return Object.assign(base, ev);
        });
        const acc = hasAcceptance ? evaluated[accIdx] : null;
        const acceptance = acc
          ? {
            state: acc.state, entryIndex: accIdx, mode: acc.mode, reasons: acc.reasons,
            renewed: effs.some((e, i) => i !== accIdx && i < accIdx && ACCEPTANCE_KINDS.includes(e.kind)),
            supersedes: evaluated.filter((e, i) => i < accIdx && ACCEPTANCE_KINDS.includes(effs[i].kind)).map((e) => e.at),
          }
          : { state: 'not-accepted', entryIndex: null, mode: '', reasons: [], renewed: false, supersedes: [] };
        const slices = {};
        for (const s of b.slices) {
          const idx = effs.map((e, j) => (e.slice === s.label && SLICE_KINDS.includes(e.kind) ? j : -1)).filter((j) => j >= 0).pop();
          if (hasAcceptance) {
            slices[s.label] = { entryIndex: Number.isInteger(idx) ? idx : null, state: acc.state, mode: acc.mode,
              viaAcceptance: true, reasons: acc.reasons };
          } else {
            slices[s.label] = Number.isInteger(idx)
              ? { entryIndex: idx, state: evaluated[idx].state, mode: evaluated[idx].mode, viaAcceptance: false,
                reasons: evaluated[idx].reasons }
              : { entryIndex: null, state: 'not-approved', mode: '', viaAcceptance: false, reasons: [] };
          }
        }
        const landing = evalLanding(ctx, record, acc ? list[accIdx] : null, acc);
        const since = acc && acc.R ? changedSince(ctx, acc.R, acc.scope || b.stories) : { changes: [], unreadable: [] };
        const holdsRecorded = {};
        for (const h of arr(record && record.holds)) {
          if (h && h.hold) holdsRecorded[str(h.hold)] = { hold: str(h.hold), state: str(h.state), at: str(h.at), ref: str(h.ref) };
        }
        outBatches[b.id] = {
          id: b.id,
          phaseIndex: b.phaseIndex,
          record: hit
            ? { found: true, readable: !unreadableRecord, source: hit.source, path: hit.rel, problems }
            : { found: false, readable: false, source: null, path: '', problems },
          execution: Object.assign({ label: (EXECUTION_GROUPS.find((g) => g.key === MODE_GROUP[execution.mode]) || {}).label || '' }, execution),
          proposedRuns,
          workWithoutEntry: !record && !unreadableRecord && !blocked && workMoving,
          entryGatesConfirmed: arr(record && record.entry_gates_confirmed).map(str),
          holds: Object.values(holdsRecorded),
          approvals: evaluated,
          acceptance,
          slices,
          landing,
          rereview: arr(record && record.rereview),
          changedSinceRecord: since.changes,
          changedSinceUnreadable: since.unreadable,
        };
        if (unreadableRecord || blocked) {
          // Nothing about this batch can be read from a record, so nothing is claimed:
          // not "Not accepted", not "Landing not prepared" — Unverified, with the reason.
          const why = execution.basis;
          const o = outBatches[b.id];
          o.acceptance = { state: 'unverified', entryIndex: null, mode: '', reasons: [why], renewed: false, supersedes: [] };
          for (const s of b.slices) o.slices[s.label] = { entryIndex: null, state: 'unverified', mode: '', viaAcceptance: false, reasons: [why] };
          o.landing = { state: 'unknown', checkedAt: now,
            planning: { state: 'unknown', basis: why, main: null }, product: { state: 'unknown', basis: '', main: null } };
        }
        if (!phaseModes.has(b.phaseIndex)) phaseModes.set(b.phaseIndex, []);
        phaseModes.get(b.phaseIndex).push(execution.mode);
      }
      const phases = arr(entry.phases).map((p, idx) => {
        const modes = phaseModes.get(idx) || [];
        const key = modes.length ? rollUpPhase(modes) : 'execution-not-started';
        const g = EXECUTION_GROUPS.find((x) => x.key === key) || EXECUTION_GROUPS[2];
        return { index: idx, group: g.key, label: g.label, basis: g.basis, batches: modes.length };
      });
      strategies.push({ file, epic: str(entry.epic), batches: outBatches, phases });
    }
    return { checkedAt: now, builtFrom, strategies };
  } catch (e) {
    return Object.assign(empty, { error: 'batch evidence could not be evaluated: ' + str(e && e.message) });
  }
}

module.exports = {
  evaluate,
  parseRecordText,
  batchesOf,
  effectiveEntries,
  closeoutCheck,
  EXECUTION_GROUPS,
  APPROVAL_KINDS,
  ACCEPTANCE_KINDS,
  SLICE_KINDS,
  EXECUTION_VALUES,
  HOLD_STATES,
  REREVIEW_STATES,
  SHA_RE,
  SHA256_RE,
  ISO_RE,
  RECORD_FENCE_RE,
  PRODUCT_REPO_ENV_RE,
};
