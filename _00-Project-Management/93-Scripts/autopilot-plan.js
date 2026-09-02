#!/usr/bin/env node
/**
 * autopilot-plan.js — the run plan an unattended run must write BEFORE it dispatches
 * (STORY-26.4.01, PRD-Autonomous-Execution §B.1).
 *
 * ============================================================================
 * THIS IS THE ONE PLACE IN EPIC-26 WHERE FAILING TO WRITE IS BLOCKING
 * ============================================================================
 * Every other write in this epic inherits `retro-capture.js`'s never-blocking contract: a
 * reflection that cannot be recorded must never strand a story between `in-progress` and
 * `done`. The run plan is the deliberate exception, and the asymmetry is the point —
 * REFLECTION is a nice-to-have, AUTHORISATION is the control. An unattended run that
 * dispatched without a written, reviewable scope is exactly the risk FEAT-26.4 exists to
 * bound, so `runEntry()` refuses to dispatch if the plan could not be written, and the
 * refusal names the path it could not write. Diagnosed at 2am, "could not write
 * <path>: ENOTDIR" is a fix; a hang is not.
 *
 * ---------------------------------------------------------------------------
 * `run_id` ORIGINATES HERE (STORY-26.4.01 risk 2, ADR-0151)
 *
 * The plan is the earliest artefact in a run's life, so the id is generated here and
 * handed to everything downstream. Three surfaces carry the SAME string:
 *
 *   this file's `run_id:` frontmatter field
 *   the checkpoint's `run_id`                          (STORY-26.4.02)
 *   the retro ledger's `run`-level record `id`         (STORY-26.4.03)
 *
 * Shape: `autopilot-<YYYY-MM-DD>-<slug>`. Deliberately human-readable rather than a UUID —
 * the live run in this repo is `autopilot-2026-08-02-epic25-26-27`, and an operator reading
 * a checkpoint at 3am can tell which run it is without a lookup. Uniqueness comes from the
 * slug, which the operator supplies with the scope; two runs on one day with the same scope
 * slug is an operator collision the checkpoint writer refuses (STORY-26.4.02 AC-3), not
 * something a random suffix should paper over.
 *
 * ---------------------------------------------------------------------------
 * SCOPE IS STRUCTURED, NOT PROSE
 *
 * `scope_stories`, `scope_chats` and `tier_plan` are flat YAML lists in the frontmatter, and
 * they are the machine-readable contract STORY-26.4.04's set difference subtracts from. The
 * kit's frontmatter parser is FLAT by design (R20 flags nested keys), so `tier_plan` entries
 * are `<STORY-ID>=<tier>` strings rather than a nested map. Prose in the body is commentary.
 *
 * The rendered plan's BODY comes from `91-Templates/AUTOPILOT-PLAN.template.md` verbatim —
 * only the frontmatter is generated. A missing template therefore BLOCKS too: the alternative
 * is emitting a plan with none of the sections AC-1 requires and calling it a plan.
 *
 * Usage:
 *   node autopilot-plan.js --slug epic25-26-27 --date 2026-08-02 \
 *     --stop-condition "max-phases: 13" --authorised-by "operator (…)" \
 *     --usage-budget "no live signal — degraded pause-and-ask" \
 *     --chat E26-CHAT-03 --story STORY-26.4.01 --tier STORY-26.4.01=high \
 *     [--run-id <id>] [--reports-dir <dir>] [--approvals <path>] [--template <path>]
 *
 * ---------------------------------------------------------------------------
 * THE PLAN CITES A RUN; IT DOES NOT RE-DECIDE ONE (STORY-29.2.04, ADR-0187)
 *
 * `--track <path> --track-run <RUN-NN>` name the run in an emitted autopilot track
 * (`autopilot_runs[]`, ADR-0184) that this plan authorises. The scope, order, tiers and stop
 * condition below them are then a TRANSCRIPTION of that run — `verifyTrackReference()` fails a
 * plan whose copy disagrees with the source, because a plan that re-derives its own tiering is
 * two plans sharing one run id. Both flags or neither: half a citation cannot be followed.
 *
 * A plan with no track reference is PRE-SEAM, not broken. Every plan written before 2026-08-10
 * is one, including this repository's own live run plan, and every reader says so in words
 * (`PRE_SEAM_NOTE`) rather than reporting a failure.
 *
 * Exit codes: 0 = plan written and approval logged · 3 = BLOCKED (plan not written; the
 * message names the path) · 2 = usage error.
 *
 * Dependency-free — Node stdlib only, consistent with every other `93-Scripts/` tool.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// The kit's offset-preserving clock (BUG-20260801-04). `toISOString()` normalises to UTC and
// emits a trailing `Z`, which is the WRONG CALENDAR DAY for part of every day at +01:00 — and
// artefact frontmatter is exactly the "anything a human will read" case that helper exists for.
const localDate = require(path.join(__dirname, 'lib', 'local-date.js'));

const PM_ROOT = path.resolve(__dirname, '..');
const DEFAULT_REPORTS_DIR = path.join(PM_ROOT, '41-Reports');
const DEFAULT_APPROVALS = path.join(PM_ROOT, '10-Inbox', 'APPROVALS.md');
const DEFAULT_TEMPLATE = path.join(PM_ROOT, '91-Templates', 'AUTOPILOT-PLAN.template.md');

// `41-Reports/` is where an orchestrator addresses this file from, and it is the prefix the
// approval line must carry so a reader can follow it. AUTOPILOT-* is R25 root-exempt
// (lib/report-tree.js) precisely because skills hard-code these root paths.
const REPORTS_PREFIX = '41-Reports';

const RUN_ID_RE = /^autopilot-\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*$/;

const EXIT_OK = 0;
const EXIT_USAGE = 2;
const EXIT_BLOCKED = 3;

/** Thrown when the plan could not be written. Carries the path, because the path is the fix. */
class PlanBlocked extends Error {
  constructor(message, blockedPath, cause) {
    super(message);
    this.name = 'PlanBlocked';
    this.path = blockedPath;
    this.cause = cause || null;
  }
}

function safeMessage(err) {
  try {
    if (err && typeof err.message === 'string') return err.message;
    return String(err);
  } catch {
    return '(unprintable error)';
  }
}

// ---------- run identity ----------

/**
 * `autopilot-<YYYY-MM-DD>-<slug>`. PURE — the date is a parameter, never `new Date()`, so a
 * fixture run is reproducible and the id in a test is the id in the assertion.
 */
function makeRunId(date, slug) {
  const d = String(date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    throw new Error(`run_id needs a YYYY-MM-DD date, got ${JSON.stringify(date)}`);
  }
  const s = String(slug || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!s) throw new Error('run_id needs a non-empty scope slug');
  return `autopilot-${d}-${s}`;
}

function planFileName(runId) {
  return `AUTOPILOT-PLAN-${runId}.md`;
}

/**
 * ORDER-PRESERVING DEDUP, and it REPORTS what it dropped (BUG-20260804-25).
 *
 * `scope_stories` and `scope_chats` are SETS wearing a list's clothes — they declare a scope,
 * not a sequence. A repeated id survived write and survived read, and `plan-vs-actual` counted
 * it twice everywhere: on the committed fixture, repeating one id took `estimate_total` from
 * 150000 to 250000, `actual_total` from 268000 to 371000, produced six `per_story` rows for
 * five stories, and put the same id in `planned_not_executed` twice. Every one of those numbers
 * stays plausible, which is why this is a defect and not a curiosity.
 *
 * This is the SAME class `plan-vs-actual` already fixes inside the join (the `seenRows`
 * reference-dedup over a story's two `stage` records), left unfixed one layer out at the plan
 * boundary. Fixing it in `readPlan` rather than in the comparison means every reader of a plan
 * inherits it, not just the one that noticed.
 *
 * Duplicates are RETURNED, never silently swallowed: "the scope was 6 and 5 of them were
 * distinct" is a fact about the plan an operator should see.
 *
 * @returns {{unique: string[], duplicates: string[]}} `duplicates` names each repeated id ONCE,
 *          in first-seen order, however many times it repeated.
 */
function dedupePreservingOrder(items) {
  const seen = new Set();
  const dupeSeen = new Set();
  const unique = [];
  const duplicates = [];
  for (const raw of (Array.isArray(items) ? items : [])) {
    const v = String(raw);
    if (!seen.has(v)) { seen.add(v); unique.push(raw); continue; }
    if (!dupeSeen.has(v)) { dupeSeen.add(v); duplicates.push(raw); }
  }
  return { unique, duplicates };
}

/**
 * The path the approval line carries and a reader follows. Forward slashes always: this
 * string is written into markdown, and a backslash path from a Windows run is not a path a
 * Linux reader (or R26) can resolve.
 */
function planRelPath(runId) {
  return `${REPORTS_PREFIX}/${planFileName(runId)}`;
}

// ---------- rendering ----------

function yamlScalar(v) {
  const s = v === null || v === undefined ? '' : String(v);
  // Single-quoted YAML, matching the kit's own artefacts. `''` escapes an apostrophe.
  return `'${s.replace(/\r?\n/g, ' ').replace(/'/g, "''")}'`;
}

function yamlList(key, items) {
  const list = Array.isArray(items) ? items.filter(x => String(x || '').trim() !== '') : [];
  if (!list.length) return `${key}: []`;
  return [`${key}:`].concat(list.map(x => `  - ${yamlScalar(x)}`)).join('\n');
}

/**
 * Split a template into its frontmatter block and everything after it. Returns null if the
 * file has no frontmatter — which BLOCKS rather than silently emitting a headless plan.
 */
function splitTemplate(text) {
  const m = String(text).match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  return m[1];
}

/**
 * Render the plan document. PURE: spec + template text in, string out. No clock, no fs.
 *
 * The BODY is the template's, unchanged apart from `<run_id>` substitution — so the sections
 * AC-1 requires cannot drift out of the rendered artefact without the template losing them
 * too, and `tests/autopilot-run-plan.test.js :: plan-precedes-dispatch` asserts they survive.
 */
function renderPlan(spec, templateText) {
  const body = splitTemplate(templateText);
  if (body === null) {
    throw new Error('the AUTOPILOT-PLAN template has no frontmatter block — refusing to render');
  }
  const runId = spec.run_id;
  const fm = [
    '---',
    'type: autopilot-plan',
    `id: AUTOPILOT-PLAN-${runId}`,
    `run_id: ${yamlScalar(runId)}`,
    `title: ${yamlScalar(`Run plan — ${runId}`)}`,
    'status: not-started',
    `created_at: ${yamlScalar(spec.created_at || '')}`,
    "started_at: ''",
    "completed_at: ''",
    `authorised_by: ${yamlScalar(spec.authorised_by || '')}`,
    `stop_condition: ${yamlScalar(spec.stop_condition || '')}`,
    `usage_budget: ${yamlScalar(spec.usage_budget || '')}`,
    // STORY-29.2.04 / ADR-0187 — WHICH WRITTEN RUN THIS PLAN AUTHORISES. Two scalars, always
    // emitted (empty for a plan with no track, so "no track existed" and "the field was
    // forgotten" are the same absent-value fact rather than an absent KEY nobody notices —
    // the ADR-0184 stance one artefact over). Everything below them is a TRANSCRIPTION of the
    // named run, never a re-derivation; `verifyTrackReference()` is what makes that checkable.
    `track_path: ${yamlScalar(spec.track_path || '')}`,
    `track_run: ${yamlScalar(spec.track_run || '')}`,
    yamlList('scope_chats', spec.scope_chats),
    yamlList('scope_stories', spec.scope_stories),
    yamlList('tier_plan', spec.tier_plan),
    '---',
    '',
  ].join('\n');
  return fm + body.replace(/<run_id>/g, runId);
}

/**
 * The APPROVALS.md line. References the plan BY REPO-RELATIVE PATH (AC-3) — not by run_id
 * alone, because an id is not something a reader can follow.
 */
function approvalLine(spec) {
  const runId = spec.run_id;
  return `- ${spec.authorised_at || spec.created_at || ''} — autopilot run \`${runId}\`; `
    + `run plan: \`${planRelPath(runId)}\`; stop condition: ${spec.stop_condition || '(none)'}; `
    + `scope: ${(spec.scope_stories || []).length} story/ies across `
    + `${(spec.scope_chats || []).length} chat(s) — by: ${spec.authorised_by || '(unrecorded)'} `
    + '— gated: autopilot entry';
}

// ---------- the blocking write ----------

/**
 * Write the plan. Throws `PlanBlocked` — naming the path — on ANY failure: unreadable
 * template, unmakeable directory, unwritable file. Never returns a partial success.
 */
function writePlan(spec, opts) {
  const options = opts || {};
  const reportsDir = options.reportsDir || DEFAULT_REPORTS_DIR;
  const templatePath = options.templatePath || DEFAULT_TEMPLATE;
  const target = path.join(reportsDir, planFileName(spec.run_id));

  let templateText;
  try {
    templateText = fs.readFileSync(templatePath, 'utf8');
  } catch (err) {
    throw new PlanBlocked(
      `run plan BLOCKED: could not read the plan template at ${templatePath} `
      + `(${safeMessage(err)}) — refusing to dispatch without a plan`, templatePath, err);
  }

  let text;
  try {
    text = renderPlan(spec, templateText);
  } catch (err) {
    throw new PlanBlocked(
      `run plan BLOCKED: could not render the plan from ${templatePath} `
      + `(${safeMessage(err)}) — refusing to dispatch without a plan`, templatePath, err);
  }

  try {
    fs.mkdirSync(reportsDir, { recursive: true });
    fs.writeFileSync(target, text, 'utf8');
  } catch (err) {
    throw new PlanBlocked(
      `run plan BLOCKED: could not write ${target} (${safeMessage(err)}) — `
      + 'refusing to dispatch without a plan', target, err);
  }
  return { path: target, text };
}

function appendApproval(approvalsPath, line) {
  try {
    fs.mkdirSync(path.dirname(approvalsPath), { recursive: true });
    fs.appendFileSync(approvalsPath, line + '\n', 'utf8');
  } catch (err) {
    throw new PlanBlocked(
      `run plan BLOCKED: could not log the approval at ${approvalsPath} `
      + `(${safeMessage(err)}) — an unlogged authorisation is an unauthorised run`,
      approvalsPath, err);
  }
  return { path: approvalsPath, line };
}

// ---------- the entry sequence ----------

/**
 * ============================================================================
 * THE AUTHORISATION CLOCK IS STAMPED BY DEFAULT, NEVER LEFT BLANK (BUG-20260811-03)
 * ============================================================================
 * `--created-at` is optional, and the `|| ''` fallbacks it fed meant an invocation without it
 * still wrote a plan (`created_at: ''`) and still appended an approval line reading
 * `-  — autopilot run …` — the timestamp column simply absent, exit 0, both success lines
 * printed. It happened live at the Run-2 entry gate on 2026-08-11: four plans and four approval
 * lines emitted unstamped.
 *
 * The approval line is the durable record that an unattended run WAS AUTHORISED, and the stamp is
 * the field that distinguishes a live authorisation from one carried over from an earlier run. A
 * plan with no clock is the one artefact in this epic whose absence the whole gate rests on.
 *
 * SO IT DEFAULTS, RATHER THAN REFUSING. Refusing (exit 3) was the alternative and is worse here:
 * it would have blocked a run's entry gate for a reason the operator could not act on, and the
 * flag exists for the legitimate case of a dispatch DELIBERATELY sharing its plan's timestamp
 * — which an explicit `--created-at` still does, unchanged.
 *
 * THE CLOCK IS A PARAMETER, NOT A CALL. `renderPlan()` and `approvalLine()` stay PURE — the same
 * property the file's own header claims for `makeRunId()` — so `runEntry()` resolves the instant
 * ONCE and both surfaces are rendered from it. Stamping inside each renderer would have given the
 * plan and its approval line two different clocks, which is worse than one missing one.
 *
 * `localIso()`, not `toISOString()`: the kit stores timestamps WITH OFFSET
 * (`YYYY-MM-DDTHH:MM:SS±HH:MM`), and a UTC `Z` stamp is the wrong calendar day for part of every
 * day at +01:00 (BUG-20260801-04).
 *
 * @param {object} spec
 * @param {string} [now] the instant to stamp with — supplied by the caller, never read from a
 *        clock inside this function, so it stays testable and pure.
 */
function stampedSpec(spec, now) {
  const has = v => typeof v === 'string' && v.trim() !== '';
  const out = Object.assign({}, spec);
  if (!has(out.created_at)) out.created_at = has(now) ? now.trim() : localDate.localIso();
  return out;
}

/**
 * The entry sequence. WRITE THE PLAN, LOG THE APPROVAL, THEN DISPATCH — in that order, and
 * only in that order.
 *
 * The ordering is recorded in an explicit `journal` of monotonically-sequenced steps rather
 * than left to file mtimes. TESTPLAN-26.4.01's risk section anticipated this: mtime
 * resolution is coarse enough on some filesystems that a plan written milliseconds before
 * dispatch can share a timestamp with it, and a probe comparing two equal mtimes proves
 * nothing. The journal cannot tie.
 *
 * `dispatch` is a seam, not a default behaviour. It is invoked with `{ planPath, journal }`
 * AFTER the plan is on disk; a caller that wants to assert the plan exists at dispatch time
 * checks it from inside the callback, which is the only moment that question is meaningful.
 *
 * @returns {{run_id, planPath, planText, approval, journal, dispatched}}
 * @throws {PlanBlocked} if the plan (or its approval) could not be written. `dispatch` is NOT
 *         called in that case — that is the whole contract.
 */
function runEntry(rawSpec, opts) {
  const options = opts || {};
  // ONE clock, resolved once, for the plan AND its approval line (BUG-20260811-03).
  const spec = stampedSpec(rawSpec, options.now);
  const journal = [];
  let seq = 0;
  const record = (step, detail) => {
    journal.push({ seq: seq++, step, detail: detail === undefined ? null : detail });
  };

  record('entry', spec.run_id);

  const written = writePlan(spec, options);
  record('plan-written', written.path);

  const approvalsPath = options.approvalsPath || DEFAULT_APPROVALS;
  const line = approvalLine(spec);
  appendApproval(approvalsPath, line);
  record('approval-logged', approvalsPath);

  let dispatched = false;
  if (typeof options.dispatch === 'function') {
    record('dispatch', spec.run_id);
    options.dispatch({ planPath: written.path, journal: journal.slice() });
    dispatched = true;
    record('dispatch-returned', spec.run_id);
  }

  return {
    run_id: spec.run_id,
    planPath: written.path,
    planText: written.text,
    approval: { path: approvalsPath, line },
    journal,
    dispatched,
  };
}

// ---------- reading a written plan back ----------

/**
 * Parse a plan file into the fields the comparison and the join need. Uses the kit's shared
 * flat-frontmatter parser rather than a second one — the plan is a kit artefact and must read
 * the same way every other kit artefact does.
 */
function readPlan(planPath) {
  const { parseFrontmatter } = require(path.join(__dirname, 'lib', 'frontmatter.js'));
  let text;
  try {
    text = fs.readFileSync(planPath, 'utf8');
  } catch (err) {
    return { path: planPath, exists: false, error: safeMessage(err), run_id: null };
  }
  const fm = parseFrontmatter(text) || {};
  const asList = v => (Array.isArray(v) ? v.slice() : (v === undefined || v === null || v === '' ? [] : [v]));
  // A scope is a SET. Deduped on read so every reader of a plan gets exact counts, and the
  // duplicates are reported rather than swallowed. See `dedupePreservingOrder` / BUG-20260804-25.
  const stories = dedupePreservingOrder(asList(fm.scope_stories));
  const chats = dedupePreservingOrder(asList(fm.scope_chats));
  return {
    path: planPath,
    exists: true,
    run_id: typeof fm.run_id === 'string' && fm.run_id.trim() ? fm.run_id.trim() : null,
    stop_condition: fm.stop_condition === undefined ? null : fm.stop_condition,
    usage_budget: fm.usage_budget === undefined ? null : fm.usage_budget,
    authorised_by: fm.authorised_by === undefined ? null : fm.authorised_by,
    // STORY-29.2.04 — the named run this plan authorises. ALWAYS present as an object, so a
    // reader never has to distinguish "no key" from "no track"; `referenced` is the one boolean
    // every consumer branches on, and `false` is the PRE-SEAM state, not an error.
    track: {
      path: typeof fm.track_path === 'string' && fm.track_path.trim() ? fm.track_path.trim() : null,
      run: typeof fm.track_run === 'string' && fm.track_run.trim() ? fm.track_run.trim() : null,
      referenced: Boolean(
        typeof fm.track_path === 'string' && fm.track_path.trim()
        && typeof fm.track_run === 'string' && fm.track_run.trim()),
    },
    scope_stories: stories.unique,
    scope_chats: chats.unique,
    // Named once each, in first-seen order. Empty arrays on a clean plan — always present, so
    // "no duplicates" and "nobody looked" are not the same absent key.
    duplicate_stories: stories.duplicates,
    duplicate_chats: chats.duplicates,
    // `<STORY-ID>=<tier>` → { id, tier }. Flat YAML cannot nest (R20), so the pair is
    // encoded in the string and decoded here, once, rather than at every reader.
    tier_plan: asList(fm.tier_plan).map((entry) => {
      const s = String(entry);
      const i = s.indexOf('=');
      return i === -1
        ? { id: s.trim(), tier: null }
        : { id: s.slice(0, i).trim(), tier: s.slice(i + 1).trim() || null };
    }),
    text,
  };
}

// ---------- the track reference, and the no-re-derivation shape check ----------

/**
 * The strategy sidecar a plan cites, or null. `track_path` is written REPO-RELATIVE (the same
 * convention `approvalLine()` uses, so a reader can follow it), and is resolved against the PM
 * root — or against `opts.trackRoot`, which is how a fixture reaches its own temp sidecar
 * without a second search path being hard-coded anywhere.
 *
 * IT LIVES HERE, NOT IN `plan-vs-actual.js`. That file's AC-5 contract is that it opens no
 * files at all: the ledgers are `retro-report`'s and the plan is this module's. The track is
 * something the PLAN points at, so reading it belongs to the plan's reader — and the source
 * grep enforcing AC-5 caught the first draft that put it in the other file.
 *
 * NEVER THROWS: a cited-but-unreadable track is a FINDING, not an exception.
 */
function readTrack(planTrackPath, opts) {
  const explicit = opts && opts.trackPath;
  const rel = explicit || planTrackPath;
  if (!rel) return { path: null, sidecar: null, error: null };
  const roots = [];
  if (path.isAbsolute(rel)) roots.push(rel);
  else {
    if (opts && opts.trackRoot) roots.push(path.resolve(opts.trackRoot, rel));
    roots.push(path.resolve(PM_ROOT, rel));
    roots.push(path.resolve(PM_ROOT, '..', rel));
  }
  for (const candidate of roots) {
    try {
      const sidecar = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      return { path: candidate, sidecar, error: null };
    } catch (err) {
      if (candidate === roots[roots.length - 1]) {
        return { path: candidate, sidecar: null, error: safeMessage(err) };
      }
    }
  }
  return { path: rel, sidecar: null, error: 'no candidate path resolved' };
}

/**
 * What a reader must be told when a plan carries no track reference. VERBATIM, from one
 * constant, because three surfaces print it and a plan authorised before the seam existed is
 * the NORMAL state of every plan already on disk — including this repository's own live
 * `AUTOPILOT-PLAN-autopilot-2026-08-05-epic28-29-32a.md`. It is not a defect, it is not a
 * failure, and it must never read as either.
 */
const PRE_SEAM_NOTE = 'no track reference — pre-seam plan (authorised before STORY-29.2.04 made '
  + 'a plan name a run from the emitted track). Plan-vs-actual still compares the plan to the '
  + 'ledger; what it cannot do is falsify the plan against a written projection, because there '
  + 'is none to falsify it against.';

/** Every finding this check can produce, so a consumer can switch on a token, not a sentence. */
const TRACK_FINDINGS = Object.freeze([
  'incomplete-reference', 'track-unreadable', 'track-has-no-runs', 'track-run-not-found',
  'chats-re-derived', 'order-re-derived', 'tier-re-derived', 'tier-dropped',
  'stop-condition-re-derived',
]);

function sameList(a, b) {
  const x = (Array.isArray(a) ? a : []).map(v => String(v).trim());
  const y = (Array.isArray(b) ? b : []).map(v => String(v).trim());
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/**
 * Does this plan REFERENCE the named run rather than RE-DERIVE it? (STORY-29.2.04 AC-2)
 *
 * ============================================================================
 * WHY "MUST MATCH" AND NOT "MUST BE ABSENT"
 * ============================================================================
 * The obvious reading of "contains no re-derived tier/order fields" is that a plan citing a
 * track should stop carrying `scope_stories` / `tier_plan` at all. It cannot: STORY-26.4.04's
 * set difference subtracts the executed set FROM those lists, and ADR-0151 made them structured
 * for exactly that reason. Deleting them to prove non-derivation would break the one consumer
 * the fields exist for.
 *
 * So the rule is TRANSCRIPTION, not absence: with a track reference, the plan's scope, order,
 * tiers and stop condition are a copy of the named run's, and **any disagreement is a
 * re-derivation**. That is the failure this catches — a plan that read the track, decided it
 * knew better, and wrote its own tiering, which is two plans wearing one run id.
 *
 * @param {object} plan     `readPlan()` output
 * @param {object} sidecar  the parsed strategy sidecar the plan cites, or null if unreadable
 * @returns {{ok, referenced, pre_seam, run_id, note, findings: Array<{code, detail}>}}
 *          `ok` is TRUE for a pre-seam plan. A plan written before the seam existed is not
 *          wrong; reporting it as a failure would make every historic plan red overnight and
 *          teach the reader to ignore the check.
 * NEVER THROWS.
 */
function verifyTrackReference(plan, sidecar) {
  const findings = [];
  const add = (code, detail) => findings.push({ code, detail });
  try {
    const track = (plan && plan.track) || { path: null, run: null, referenced: false };
    if (!track.path && !track.run) {
      return { ok: true, referenced: false, pre_seam: true, run_id: null,
        note: PRE_SEAM_NOTE, findings: [], run: null };
    }
    if (!track.referenced) {
      // HALF a reference is worse than none: it looks like a citation and cannot be followed.
      add('incomplete-reference', `a track reference needs BOTH \`track_path\` and \`track_run\`; `
        + `this plan carries path=${JSON.stringify(track.path)} run=${JSON.stringify(track.run)}`);
      return { ok: false, referenced: true, pre_seam: false, run_id: track.run,
        note: 'the plan cites a track it cannot be followed to', findings, run: null };
    }
    if (!sidecar || typeof sidecar !== 'object') {
      add('track-unreadable', `the plan cites ${track.path}, which could not be read as a `
        + 'strategy sidecar');
      return { ok: false, referenced: true, pre_seam: false, run_id: track.run,
        note: 'the cited track could not be read', findings, run: null };
    }
    const runs = Array.isArray(sidecar.autopilot_runs) ? sidecar.autopilot_runs : null;
    if (!runs || !runs.length) {
      add('track-has-no-runs', `${track.path} carries `
        + `${runs ? 'an EMPTY' : 'no'} \`autopilot_runs\` — there is no run to name`);
      return { ok: false, referenced: true, pre_seam: false, run_id: track.run,
        note: 'the cited track is empty or absent', findings, run: null };
    }
    const run = runs.find(r => r && String(r.id).trim() === track.run);
    if (!run) {
      // NAMES THE AVAILABLE RUNS. A refusal that does not say what you could have said instead
      // is a refusal you cannot act on (the same rule the authorisation seam follows).
      add('track-run-not-found', `${track.path} has no run \`${track.run}\`. Available: `
        + runs.map(r => String(r && r.id)).join(', '));
      return { ok: false, referenced: true, pre_seam: false, run_id: track.run,
        note: 'the plan names a run the track does not contain', findings, run: null };
    }

    const runStories = (Array.isArray(run.stories) ? run.stories : [])
      .map(s => (s && typeof s === 'object' ? String(s.id || '').trim() : String(s).trim()))
      .filter(Boolean);
    if (!sameList(plan.scope_chats, run.chats)) {
      add('chats-re-derived', `\`scope_chats\` ${JSON.stringify(plan.scope_chats)} does not `
        + `transcribe ${track.run}'s chats ${JSON.stringify(run.chats)}`);
    }
    if (!sameList(plan.scope_stories, runStories)) {
      add('order-re-derived', `\`scope_stories\` ${JSON.stringify(plan.scope_stories)} does not `
        + `transcribe ${track.run}'s risk-first order ${JSON.stringify(runStories)}`);
    }
    const trackTier = new Map();
    for (const s of (Array.isArray(run.stories) ? run.stories : [])) {
      if (s && typeof s === 'object' && s.id) trackTier.set(String(s.id).trim(), s.tier || null);
    }
    const planTiered = new Set();
    for (const entry of (Array.isArray(plan.tier_plan) ? plan.tier_plan : [])) {
      planTiered.add(entry.id);
      if (!trackTier.has(entry.id)) {
        add('tier-re-derived', `\`tier_plan\` tiers ${entry.id}, which ${track.run} does not `
          + 'carry — the plan is tiering a story the run never planned');
        continue;
      }
      const declared = trackTier.get(entry.id);
      if (String(entry.tier || '') !== String(declared || '')) {
        add('tier-re-derived', `\`tier_plan\` says ${entry.id}=${entry.tier}; ${track.run} says `
          + `${declared} — a divergent re-derivation, not a transcription`);
      }
    }
    // BOTH DIRECTIONS. The loop above walks the PLAN, so it catches a CHANGED tier and an EXTRA
    // one and never a MISSING one — and an omission is the worst of the three, because it is the
    // only one that leaves no trace in the plan to read. A story the run tiers `high` and the
    // plan does not tier at all runs at the plan body's prose "Default tier"
    // (`91-Templates/AUTOPILOT-PLAN.template.md`), which is precisely the silent downgrade the
    // escalate-on-doubt rule exists to prevent. Its own finding code, so a consumer switching on
    // the token can tell "the plan re-tiered this" from "the plan never mentioned it".
    for (const [id, declared] of trackTier) {
      if (planTiered.has(id)) continue;
      add('tier-dropped', `\`tier_plan\` carries NO entry for ${id}, which ${track.run} tiers `
        + `${declared === null ? '(no tier)' : declared} — an omitted tier is not a `
        + "transcription, and the story would run at the plan body's default tier");
    }
    const planStop = String(plan.stop_condition || '').trim();
    const runStop = String(run.stop_condition || '').trim();
    if (planStop !== runStop) {
      add('stop-condition-re-derived', `the plan stops at ${JSON.stringify(planStop)}; `
        + `${track.run} declares ${JSON.stringify(runStop)}`);
    }

    return {
      ok: findings.length === 0,
      referenced: true,
      pre_seam: false,
      run_id: track.run,
      note: findings.length === 0
        ? `the plan transcribes ${track.run} of ${track.path} and re-derives nothing`
        : `the plan RE-DERIVES ${findings.length} field(s) it should have transcribed`,
      findings,
      run,
    };
  } catch (err) {
    return { ok: false, referenced: false, pre_seam: false, run_id: null,
      note: `the track reference could not be checked (${safeMessage(err)})`,
      findings: [{ code: 'track-unreadable', detail: safeMessage(err) }], run: null };
  }
}

// ---------- the three-way join on run_id ----------

/**
 * The `run`-level ledger record for one run. EXACT EQUALITY on `id`, never a prefix test.
 *
 * A prefix test looks harmless and is not: `autopilot-2026-04-01-alpha-2` starts with
 * `autopilot-2026-04-01-alpha`, so a `startsWith` joiner silently pairs a run with a
 * DIFFERENT run's record — and returns a row, so a probe that counts rows sees a healthy
 * join. `tests/autopilot-run-plan.test.js :: run-id-joins` carries exactly that decoy.
 *
 * Returns ALL matches, not the first: `run` is 1:many in principle (a resumed run appends),
 * and picking an arbitrary one is the shape ADR-0147 exists to forbid.
 */
function selectRunRecords(rollup, runId) {
  if (!rollup || !rollup.byLevel || !Array.isArray(rollup.byLevel.run)) return [];
  return rollup.byLevel.run.filter(e => e && e.id === runId);
}

/**
 * Do the plan, the checkpoint and the ledger agree on `run_id` (AC-4)?
 *
 * Returns the three values ALWAYS — on agreement and on mismatch — because a failure that
 * says "they differ" without saying what each one held is a failure you have to reproduce
 * before you can fix it.
 */
function joinRunIdentity(planPath, checkpointPath, rollup) {
  const plan = readPlan(planPath);
  let checkpointRunId = null;
  let checkpointError = null;
  try {
    const raw = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    checkpointRunId = typeof raw.run_id === 'string' && raw.run_id.trim() ? raw.run_id.trim() : null;
  } catch (err) {
    checkpointError = safeMessage(err);
  }
  const ledgerRecords = plan.run_id ? selectRunRecords(rollup, plan.run_id) : [];
  const ledgerRunId = ledgerRecords.length ? ledgerRecords[0].id : null;
  const values = { plan: plan.run_id, checkpoint: checkpointRunId, ledger: ledgerRunId };
  const agree = Boolean(plan.run_id)
    && plan.run_id === checkpointRunId
    && plan.run_id === ledgerRunId;
  return {
    agree,
    run_id: agree ? plan.run_id : null,
    values,
    ledgerRecords,
    checkpointError,
    detail: agree
      ? `run_id ${plan.run_id} is shared by plan, checkpoint and the run ledger record`
      : `run_id MISMATCH — plan: ${JSON.stringify(values.plan)} · `
        + `checkpoint: ${JSON.stringify(values.checkpoint)} · `
        + `ledger run record: ${JSON.stringify(values.ledger)}`,
  };
}

// ---------- CLI ----------

function usage(msg) {
  if (msg) console.error(msg);
  console.error('usage: node autopilot-plan.js --slug <slug> --date YYYY-MM-DD '
    + '[--run-id <id>] --stop-condition <s> --authorised-by <s> [--usage-budget <s>] '
    + '[--track <sidecar path>] [--track-run <RUN-NN>] '
    + '[--story <id> …] [--chat <id> …] [--tier <STORY-ID>=<low|high> …] '
    + '[--reports-dir <dir>] [--approvals <path>] [--template <path>]');
  return EXIT_USAGE;
}

function main(argv) {
  const args = argv.slice(2);
  const spec = { scope_stories: [], scope_chats: [], tier_plan: [] };
  const opts = {};
  let slug = null;
  let date = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const need = (name) => {
      const v = args[++i];
      if (v === undefined || String(v).indexOf('--') === 0) { usage(`${name} requires a value`); process.exit(EXIT_USAGE); }
      return v;
    };
    if (a === '--slug') slug = need('--slug');
    else if (a === '--date') date = need('--date');
    else if (a === '--run-id') spec.run_id = need('--run-id');
    else if (a === '--stop-condition') spec.stop_condition = need('--stop-condition');
    else if (a === '--authorised-by' || a === '--authorized-by') spec.authorised_by = need(a);
    else if (a === '--usage-budget') spec.usage_budget = need('--usage-budget');
    else if (a === '--track') spec.track_path = need('--track');
    else if (a === '--track-run') spec.track_run = need('--track-run');
    else if (a === '--created-at') spec.created_at = need('--created-at');
    else if (a === '--story') spec.scope_stories.push(need('--story'));
    else if (a === '--chat') spec.scope_chats.push(need('--chat'));
    else if (a === '--tier') spec.tier_plan.push(need('--tier'));
    else if (a === '--reports-dir') opts.reportsDir = need('--reports-dir');
    else if (a === '--approvals') opts.approvalsPath = need('--approvals');
    else if (a === '--template') opts.templatePath = need('--template');
    else return usage(`unknown argument "${a}"`);
  }

  if (!spec.run_id) {
    if (!slug || !date) return usage('either --run-id, or both --slug and --date, are required');
    try { spec.run_id = makeRunId(date, slug); } catch (err) { return usage(safeMessage(err)); }
  }
  if (!spec.stop_condition) return usage('--stop-condition is required — a run without one never starts');

  // STORY-29.2.04 — HALF a track reference is refused at the CLI, before a plan is written.
  // A plan citing a path with no run (or a run with no path) looks like a citation and cannot
  // be followed; catching it here means the artefact on disk is never in that state.
  if (Boolean(spec.track_path) !== Boolean(spec.track_run)) {
    return usage('--track and --track-run go together: a plan cites a run FROM a track, by path '
      + 'AND by run id. Supplying one names a plan nobody can follow back to its projection.');
  }

  // REFUSED, not deduped away (BUG-20260804-25). `readPlan` collapses a duplicate so no reader
  // double-counts one, but a plan whose declared scope repeats an id is an authorisation the
  // operator did not mean to give, and silently rewriting the scope of an unattended run is
  // exactly the kind of helpfulness this file exists to refuse. The message names the id.
  for (const [flag, list] of [['--story', spec.scope_stories], ['--chat', spec.scope_chats]]) {
    const dupes = dedupePreservingOrder(list).duplicates;
    if (dupes.length) {
      return usage(`${flag} repeated: ${dupes.map(d => JSON.stringify(d)).join(', ')} — a run `
        + 'plan\'s scope is a SET, and a repeated id double-counts every plan-side total in '
        + 'plan-vs-actual. Declare each id once.');
    }
  }

  try {
    const result = runEntry(spec, opts);
    console.log(`run plan written: ${result.planPath}`);
    console.log(`approval logged:  ${result.approval.path}`);
    console.log(`run_id:           ${result.run_id}`);
    return EXIT_OK;
  } catch (err) {
    if (err instanceof PlanBlocked) {
      // NON-ZERO, and the path is in the message. This is the deliberate exception to the
      // epic's never-block rule; see the header.
      console.error(safeMessage(err));
      console.error('DISPATCH BLOCKED — no story was dispatched.');
      return EXIT_BLOCKED;
    }
    console.error(`run plan BLOCKED: unexpected failure (${safeMessage(err)})`);
    return EXIT_BLOCKED;
  }
}

if (require.main === module) process.exit(main(process.argv));

module.exports = {
  PlanBlocked,
  RUN_ID_RE,
  makeRunId, planFileName, planRelPath, dedupePreservingOrder,
  renderPlan, approvalLine, stampedSpec,
  writePlan, appendApproval, runEntry, readPlan,
  verifyTrackReference, readTrack, PRE_SEAM_NOTE, TRACK_FINDINGS,
  selectRunRecords, joinRunIdentity,
  main,
  DEFAULT_REPORTS_DIR, DEFAULT_APPROVALS, DEFAULT_TEMPLATE, REPORTS_PREFIX,
  EXIT_OK, EXIT_USAGE, EXIT_BLOCKED,
};
