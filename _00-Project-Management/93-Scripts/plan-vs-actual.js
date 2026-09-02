#!/usr/bin/env node
/**
 * plan-vs-actual.js — what the run plan said, against what the ledger records
 * (STORY-26.4.04, PRD-Autonomous-Execution §B.4).
 *
 * ============================================================================
 * THE OMISSION IS THE POINT
 * ============================================================================
 * A comparison that reports what ran is a summary. The thing an operator cannot get any other
 * way is what was PLANNED AND DID NOT RUN — and it must be named explicitly, never left to be
 * inferred from a shorter list, because a list that is quietly one item shorter than expected
 * reads exactly like a list of the right length.
 *
 * ---------------------------------------------------------------------------
 * IT IS NOT A THIRD READER (AC-5)
 *
 * The plan is read by `autopilot-plan.readPlan()`; the two ledgers are read and joined by
 * `retro-report.build()`; the `run`-record selection is `autopilot-plan.selectRunRecords()`.
 * This file contains no `fs.readFileSync` of either ledger and no second join. If the
 * aggregator's join changes, this changes with it — which is the whole reason AC-5 exists.
 *
 * ---------------------------------------------------------------------------
 * PURE, AND HONEST WHEN INPUTS ARE MISSING (AC-6)
 *
 * `compare()` takes three paths and reads nothing else. No clock — so fixture output is
 * byte-comparable across runs, matching STORY-26.2.01's purity stance.
 *
 * A missing plan or a plan with no ledger records produces a comparison that STATES WHAT IS
 * MISSING and marks itself `complete: false`. It never throws, and it never presents itself as
 * a finished answer. In particular:
 *
 *   AN ACCURACY FIGURE OVER AN EMPTY SET IS `null`, NOT 100%. `0 of 0 estimates were accurate`
 *   is arithmetically 0/0, and every convenient reading of it (100%, 0%) is a claim about a
 *   measurement nobody made. `estimate_accuracy.rate` is null whenever `compared` is 0, and the
 *   renderer prints "no estimates to compare" rather than a number.
 *
 * ---------------------------------------------------------------------------
 * AC-3 IS FIXTURE-PROVEN AND PRODUCTION-VACUOUS TODAY. BOTH OPERANDS ARE EMPTY.
 *
 * The empty-set handling above is not a defensive edge case here — it is the ONLY path this
 * repository can currently take, and the artefacts have to say so or AC-3 reads as measured.
 * Counted 2026-08-04:
 *
 *   ESTIMATE side   83 of 295 stories carry a `usage_estimate:` key; 0 of 295 carry a NUMBER.
 *   ACTUAL side     `41-Reports/usage/usage-log.jsonl` holds 28 rows, ALL `kind: "chat"`, and
 *                   NOT ONE carries a `STORY-` id — `usage-capture.js` brackets chats, not
 *                   stories. There is no story-keyed row for the join to find.
 *   RESULT          47 of 47 story-level retro entries join to zero usage rows. Per-story
 *                   `actual` is `null` for every story in this repository BY CONSTRUCTION.
 *
 * So `estimate_accuracy.rate` is null in production not because nothing was compared yet, but
 * because nothing CAN be compared until per-story usage attribution exists — BACKLOG-0146. The
 * committed fixture `tests/fixtures/autopilot/usage-log-plan-vs-actual-ASPIRATIONAL.jsonl` is
 * named for that reason: its three `kind: "story"` rows are a shape the live corpus does not
 * contain. `usage-log-chat-keyed-REALISTIC.jsonl` beside it carries the shape that does, and
 * `tests/plan-vs-actual.test.js :: estimate-accuracy` asserts the honest-null path against it.
 *
 * The same disclosure applies one story over: the live ledger holds ZERO `run`-level records
 * and no `AUTOPILOT-PLAN-*.md` has ever been written, so STORY-26.4.01 AC-4's
 * `joinRunIdentity(plan, checkpoint, ledger)` has never succeeded against real data either.
 * A plan is deliberately NOT backfilled: its `created_at` would post-date the work it purports
 * to authorise, which is exactly the false authorisation AC-2 exists to prevent.
 *
 * ---------------------------------------------------------------------------
 * WHAT "EXECUTED" MEANS HERE, AND WHAT IT CANNOT MEAN
 *
 * A `story` retro record carries `phase` and `chat`, not `run_id` — the run only owns the
 * `run` and `pause` levels. So the executed set is computed by asking, for each story the plan
 * DECLARED, whether the ledger holds a `story` record with that id. That makes
 * `planned_not_executed` exact, which is AC-2.
 *
 * The reverse set — executed but not planned — is best-effort and SAYS SO: it is scoped by the
 * plan's declared `scope_chats`, and chat ids are recycled once per phase (BACKLOG-0144, "the
 * key is not a key"), so it can over-report. That caveat travels with the field rather than
 * living in a comment nobody reads.
 *
 * Usage:
 *   node plan-vs-actual.js --plan <path> [--retro <path>] [--usage <path>] [--json]
 *
 * Exit codes: 0 = a comparison was produced (a PARTIAL comparison is still a success — saying
 * "the plan is missing" is the useful answer) · 2 = usage error.
 *
 * Dependency-free — Node stdlib only, consistent with every other `93-Scripts/` tool.
 */

'use strict';

const path = require('path');

const report = require(path.join(__dirname, 'retro-report.js'));
const planMod = require(path.join(__dirname, 'autopilot-plan.js'));
// STORY-29.1.03 / ADR-0179 — the ONE join-key helper, reached through the aggregator's own
// schema so this file cannot end up reading a different copy of the rules from the join it
// consumes. It is used for exactly one thing here: canonicalising a chat id before comparing
// two of them. It does NOT introduce a second join — the join stays `report.build()`'s.
const ledgerJoin = require(path.join(__dirname, 'lib', 'retro-schema.js')).ledgerJoin;

const EXIT_OK = 0;
const EXIT_USAGE = 2;

// Said once, carried on the output, so a consumer cannot render the reverse set as though it
// were as exact as the forward one.
const REVERSE_SET_CAVEAT =
  'best-effort: scoped by the plan\'s declared scope_chats. Since STORY-29.1.03 both sides are '
  + 'canonicalised through the ledger join key, so a plan and a record that spelled one chat two '
  + 'ways now match (BACKLOG-0144); a plan that declares the BARE `CHAT-NN` form still cannot be '
  + 'told apart from the same chat number in another phase, so this set can over-report. '
  + '`planned_not_executed` is exact; this is not.';

const NO_PLAN = 'no run plan was found, so there is nothing to compare the ledger against';
const NO_RECORDS = 'the plan was read but the ledger holds no records for this run';

// ---------- STORY-29.2.04 — the track side ----------

// The cited track is read by `autopilot-plan.readTrack()` — the module that already owns
// reading a plan and everything the plan points at. THIS FILE OPENS NO FILES AT ALL (AC-5):
// the two ledgers are `retro-report.build()`'s, the plan and its track are `autopilot-plan`'s.
// The assertion that keeps it that way is a source grep in
// `tests/plan-vs-actual.test.js :: joins-on-run-id` for any stdlib read call below `use
// strict`. It fired on the first draft of this section, which is exactly what it is for —
// and it fires on a COMMENT naming one, so this note describes the call without spelling it.

/** A track story entry -> its id, whichever spelling the emission used. */
function trackStoryId(entry) {
  if (entry && typeof entry === 'object') return String(entry.id || '').trim();
  return String(entry === null || entry === undefined ? '' : entry).trim();
}

/**
 * VARIANCE AGAINST THE TRACK'S OWN PROJECTIONS (AC-4).
 *
 * Every row carries `planned`, `actual`, a `verdict` token and a `provenance` string naming
 * where EACH side came from — the ADR-0149 stance. A row whose planned side does not exist
 * renders `no-projection`, which is a DIFFERENT verdict from `match`; a fabricated match is the
 * exact failure this section exists to prevent, and it is the one that reads best.
 *
 * @param {object} run        the named run from the track
 * @param {object[]} track    every run in the track (to detect a story that moved runs)
 * @param {Map} storiesById   story id -> its ledger entries
 * @param {object} aggregate  `estimate_accuracy`, for the actual-usage total
 */
function trackVariance(run, track, storiesById, aggregate) {
  const rows = [];
  const runOf = new Map();
  for (const r of (Array.isArray(track) ? track : [])) {
    for (const c of (Array.isArray(r && r.chats) ? r.chats : [])) runOf.set(String(c).trim(), String(r.id));
    for (const s of (Array.isArray(r && r.stories) ? r.stories : [])) {
      const id = trackStoryId(s);
      if (id && !runOf.has(id)) runOf.set(id, String(r.id));
    }
  }

  const declared = Array.isArray(run.stories) ? run.stories : [];
  for (const s of declared) {
    const id = trackStoryId(s);
    const entries = storiesById.get(id) || [];
    const executed = entries.length > 0;
    const plannedTier = (s && typeof s === 'object' && s.tier) ? String(s.tier) : null;
    const withTier = entries.find(e => typeof e.retro.tier === 'string');
    const actualTier = withTier ? withTier.retro.tier : null;

    // TIER — the projection is the TRACK's, not the plan's. That is the whole point of the
    // reference: the plan transcribes, the track projects, and the ledger records.
    let verdict;
    if (plannedTier === null) verdict = 'no-projection';
    else if (actualTier === null) verdict = executed ? 'no-recorded-tier' : 'not-executed';
    else if (plannedTier === actualTier) verdict = 'tier-honoured';
    else if (plannedTier === 'low' && actualTier === 'high') verdict = 'tier-escalated';
    else verdict = 'tier-diverged';
    rows.push({
      kind: 'tier', id,
      planned: plannedTier, actual: actualTier, verdict,
      provenance: `planned: ${plannedTier === null ? 'the run declares no tier' : `${run.id}.stories[].tier`}`
        + ` · actual: ${actualTier === null ? 'no ledger record carries a tier' : 'retro ledger `tier`'}`,
    });

    // MOVED RUNS — the story executed under a chat some OTHER run of this track owns.
    const chats = entries.map(e => e.chat).filter(c => typeof c === 'string');
    const foreign = chats
      .map(c => ledgerJoin.qualify(c, (entries.find(e => e.chat === c) || {}).phase) || c)
      .map(c => runOf.get(c) || runOf.get(String(c).replace(/^E\d+-/, '')))
      .filter(r => r && r !== String(run.id));
    if (foreign.length) {
      rows.push({
        kind: 'membership', id,
        planned: String(run.id), actual: foreign[0], verdict: 'story-moved-runs',
        provenance: `planned: ${run.id}.stories[] · actual: the ledger records it on a chat `
          + `${foreign[0]} owns`,
      });
    }
  }

  // USAGE — `projected_usage.tokens` is EXPLICITLY nullable (ADR-0184), and a null projection
  // renders "no projection", never a zero and never a match.
  const projection = run.projected_usage && typeof run.projected_usage === 'object'
    ? run.projected_usage : {};
  const projected = typeof projection.tokens === 'number' ? projection.tokens : null;
  const actual = aggregate && typeof aggregate.actual_total === 'number'
    ? aggregate.actual_total : null;
  const usage = {
    projected,
    projected_basis: typeof projection.basis === 'string' ? projection.basis : null,
    counted: typeof projection.counted === 'number' ? projection.counted : null,
    missing_estimates: typeof projection.missing_estimates === 'number'
      ? projection.missing_estimates : null,
    actual,
    variance: (projected !== null && actual !== null) ? actual - projected : null,
    ratio: (projected !== null && projected !== 0 && actual !== null) ? actual / projected : null,
    verdict: projected === null
      ? 'no-projection'
      : (actual === null ? 'no-actual' : 'compared'),
  };
  rows.push({
    kind: 'usage', id: String(run.id),
    planned: projected, actual, verdict: usage.verdict,
    provenance: `planned: ${run.id}.projected_usage.tokens`
      + `${projected === null ? ' (explicit null — nothing to sum)' : ''}`
      + ` · actual: the usage ledger, summed over the plan's stories`,
  });

  const stop = {
    track: typeof run.stop_condition === 'string' ? run.stop_condition : null,
    verdict: 'recorded',
  };

  const byVerdict = {};
  for (const r of rows) byVerdict[r.verdict] = (byVerdict[r.verdict] || 0) + 1;
  return {
    rows,
    usage,
    stop_condition: stop,
    counts: byVerdict,
    // The rows a reader must look at. `no-projection` is deliberately NOT one — it is an
    // honest absence, not a divergence, and mixing them would make the divergence count a
    // number nobody can act on.
    divergences: rows.filter(r => r.verdict === 'tier-escalated' || r.verdict === 'tier-diverged'
      || r.verdict === 'story-moved-runs'),
  };
}

/** Total tokens on one usage row, whatever subset of the four counters it carries. */
function usageTotal(row) {
  const t = row && row.tokens;
  if (!t || typeof t !== 'object') return null;
  const parts = ['input', 'output', 'cache_read', 'cache_creation']
    .map(k => (typeof t[k] === 'number' && Number.isFinite(t[k]) ? t[k] : 0));
  return parts.reduce((a, b) => a + b, 0);
}

/**
 * Compare one run's plan to the ledger. PURE given the three paths.
 *
 * @param {string} planPath   the AUTOPILOT-PLAN-<run_id>.md to compare (may not exist)
 * @param {string} retroPath  retro-log.jsonl (may not exist)
 * @param {string} usagePath  usage-log.jsonl (may not exist)
 */
function compare(planPath, retroPath, usagePath, opts) {
  const options = opts || {};
  const missing = [];

  // ---- the plan side ------------------------------------------------------
  const plan = planPath ? planMod.readPlan(planPath) : { exists: false, run_id: null };
  if (!plan.exists) missing.push(NO_PLAN);
  else if (!plan.run_id) missing.push('the plan carries no run_id, so it cannot be joined to the ledger');

  // ---- the ledger side, through the aggregator's join ---------------------
  const rollup = report.build(retroPath, usagePath);

  const runId = plan.run_id || null;
  const runRecords = runId ? planMod.selectRunRecords(rollup, runId) : [];
  if (runId && runRecords.length === 0) {
    missing.push(`no \`run\`-level ledger record carries run_id ${runId}`);
  }

  const plannedStories = Array.isArray(plan.scope_stories) ? plan.scope_stories.slice() : [];
  const plannedChats = Array.isArray(plan.scope_chats) ? plan.scope_chats.slice() : [];

  // Every story-level record, indexed by id. `byLevel` is the aggregator's own bucketing.
  const storyEntries = rollup.byLevel && Array.isArray(rollup.byLevel.story)
    ? rollup.byLevel.story : [];
  const storiesById = new Map();
  for (const e of storyEntries) {
    if (!storiesById.has(e.id)) storiesById.set(e.id, []);
    storiesById.get(e.id).push(e);
  }

  // ---- AC-2 — the set difference, stated explicitly -----------------------
  const executed = [];
  const plannedNotExecuted = [];
  for (const id of plannedStories) {
    if (storiesById.has(id)) executed.push(id);
    else plannedNotExecuted.push(id);
  }
  if (plannedStories.length === 0 && plan.exists) {
    missing.push('the plan declares no stories in `scope_stories`, so there is no scope to '
      + 'subtract the executed set from');
  }
  if (plan.exists && storyEntries.length === 0) missing.push(NO_RECORDS);

  const plannedSet = new Set(plannedStories);
  const chatSet = new Set(plannedChats);
  // ONE SPELLING FOR ONE CHAT, BEFORE ANY COMPARISON (STORY-29.1.03, ADR-0179). A plan may
  // declare `E27-CHAT-02` while the ledger record says `chat: "CHAT-02", phase: "EPIC-27"`, or
  // the other way round — two spellings of one chat is precisely BACKLOG-0144, and comparing
  // the raw strings is how a chat in scope was read as out of scope. Both sides go through the
  // ledger's OWN key rule; nothing is re-derived here.
  const plannedCanonical = new Set(
    plannedChats.map(c => ledgerJoin.qualify(c, null)).filter(c => c !== null));
  const inPlannedChat = (e) => {
    if (e.chat === null || e.chat === undefined) return false;
    if (chatSet.has(e.chat)) return true;
    const canonical = ledgerJoin.qualify(e.chat, e.phase);
    return canonical !== null && plannedCanonical.has(canonical);
  };
  const executedNotPlanned = [...storiesById.keys()]
    .filter(id => !plannedSet.has(id))
    .filter(id => storiesById.get(id).some(inPlannedChat))
    .sort();

  // ---- AC-3 — estimate vs actual, per story and in aggregate --------------
  const perStory = [];
  for (const id of plannedStories) {
    const entries = storiesById.get(id) || [];
    // The estimate is written on the `dispatch` record (ADR-0153); fall back to any record
    // that carries one, so a ledger written before `stage` existed still reports.
    const withEstimate = entries.find(e => typeof e.retro.usage_estimate === 'number');
    const estimate = withEstimate ? withEstimate.retro.usage_estimate : null;
    // The ACTUAL comes from the usage side of the aggregator's own join — not a second read.
    //
    // FOLD BEFORE JOINING, NEVER AFTER (retro-schema joinSemanticsNotes). A story now leaves
    // TWO retro records (ADR-0153, `stage: dispatch` and `stage: close`) and the join attaches
    // the SAME usage row to both, so concatenating the two entries' `usage` arrays counts every
    // token twice. Caught by a hand-computed fixture total: 103000 was being reported as
    // 206000 — a plausible number, wrong by exactly the factor nobody would question.
    //
    // De-duplicated by REFERENCE, because `retro-report.build()` hands out the same row object
    // to every entry that matched it. Two genuinely separate invocations are two objects and
    // are both counted, which is the behaviour ADR-0147 wants preserved.
    const seenRows = new Set();
    const usageRows = [];
    for (const e of entries) {
      for (const row of (e.usage || [])) {
        if (seenRows.has(row)) continue;
        seenRows.add(row);
        usageRows.push(row);
      }
    }
    const totals = usageRows.map(usageTotal).filter(v => typeof v === 'number');
    const actual = totals.length ? totals.reduce((a, b) => a + b, 0) : null;
    const verdicts = entries
      .map(e => e.retro.estimate_vs_actual)
      .filter(v => typeof v === 'string');
    perStory.push({
      id,
      executed: entries.length > 0,
      // NULL, not 0. An unestimated story is unestimated; a zero is a measurement nobody made.
      estimate,
      estimated: estimate !== null,
      actual,
      variance: (estimate !== null && actual !== null) ? actual - estimate : null,
      estimate_vs_actual: verdicts.length ? verdicts[verdicts.length - 1] : null,
      usage_rows: usageRows.length,
    });
  }

  const estimated = perStory.filter(s => s.estimated);
  const comparable = perStory.filter(s => s.estimate !== null && s.actual !== null);
  const actuals = perStory.filter(s => s.actual !== null);
  const aggregate = {
    stories_planned: plannedStories.length,
    stories_executed: executed.length,
    // Counted, never summed over nulls: an aggregate of estimates is only over the stories
    // that HAVE one, and the count is reported beside the total so the denominator is visible.
    estimated_count: estimated.length,
    unestimated_count: perStory.length - estimated.length,
    estimate_total: estimated.length ? estimated.reduce((n, s) => n + s.estimate, 0) : null,
    actual_total: actuals.length ? actuals.reduce((n, s) => n + s.actual, 0) : null,
    compared: comparable.length,
    // 0/0 IS NOT 100%. Null when nothing could be compared, and the renderer says so in words.
    rate: comparable.length
      ? comparable.filter(s => s.variance !== null && Math.abs(s.variance) <= s.estimate * 0.2).length
        / comparable.length
      : null,
  };

  // ---- AC-4 — tier divergence --------------------------------------------
  const tierPlan = Array.isArray(plan.tier_plan) ? plan.tier_plan : [];
  const declaredTier = new Map(tierPlan.map(t => [t.id, t.tier]));
  const tierRows = [];
  const tierDivergences = [];
  for (const id of plannedStories) {
    const planned = declaredTier.has(id) ? declaredTier.get(id) : null;
    const entries = storiesById.get(id) || [];
    const withTier = entries.find(e => typeof e.retro.tier === 'string');
    const actualTier = withTier ? withTier.retro.tier : null;
    const reasonEntry = entries.find(e => typeof e.retro.tier_reason === 'string');
    const row = {
      id, planned_tier: planned, actual_tier: actualTier,
      reason: reasonEntry ? reasonEntry.retro.tier_reason : null,
      // Only a real disagreement is a divergence. "Not planned" and "not executed" are
      // different facts and neither is a divergence — reporting them as one would make the
      // divergence count meaningless the first time a plan omitted a story's tier.
      diverged: planned !== null && actualTier !== null && planned !== actualTier,
      comparable: planned !== null && actualTier !== null,
    };
    tierRows.push(row);
    if (row.diverged) tierDivergences.push(row);
  }

  // ---- STORY-29.2.04 — the named run, and variance against ITS projections -
  //
  // A PRE-SEAM PLAN IS NOT A FAILURE, AND IS NOT ADDED TO `missing`.
  // Every run plan written before 2026-08-10 carries no track reference — including this
  // repository's own live `AUTOPILOT-PLAN-autopilot-2026-08-05-epic28-29-32a.md`, authorised
  // before the seam existed. Folding that into `missing` would mark every historic comparison
  // PARTIAL and teach the reader that the warning means nothing. It is reported in its own
  // section, in words, and `complete` is unchanged: the plan-to-ledger comparison IS complete;
  // what is unavailable is a written projection to falsify it against.
  const planTrack = (plan.exists && plan.track) ? plan.track : { path: null, run: null, referenced: false };
  const loaded = plan.exists
    ? planMod.readTrack(planTrack.path, options)
    : { path: null, sidecar: null, error: null };
  const shape = planMod.verifyTrackReference(plan.exists ? plan : { track: planTrack }, loaded.sidecar);
  const trackRuns = loaded.sidecar && Array.isArray(loaded.sidecar.autopilot_runs)
    ? loaded.sidecar.autopilot_runs : [];
  const namedRun = shape.run || null;
  const track = {
    referenced: shape.referenced,
    pre_seam: shape.pre_seam,
    // A MISSING plan is not a PRE-SEAM plan. Without this the section printed the pre-seam note
    // verbatim — "authorised before STORY-29.2.04 made a plan name a run" — describing an
    // authorisation that never existed, one line under a banner saying no run plan was found.
    // Two sentences that disagree teach a reader to trust neither.
    plan_missing: !plan.exists,
    path: planTrack.path,
    resolved_path: loaded.path,
    run_id: planTrack.run,
    read_error: loaded.error,
    // Named, so a refusal or a miss can say what WAS available instead of just what was not.
    available_runs: trackRuns.map(r => String(r && r.id)),
    found: Boolean(namedRun),
    shape: { ok: shape.ok, note: shape.note, findings: shape.findings },
    variance: namedRun ? trackVariance(namedRun, trackRuns, storiesById, aggregate) : null,
  };

  const complete = plan.exists && Boolean(runId) && runRecords.length > 0
    && storyEntries.length > 0 && plannedStories.length > 0;

  return {
    complete,
    missing,
    run_id: runId,
    track,
    plan: {
      path: plan.path || (planPath || null),
      exists: Boolean(plan.exists),
      stop_condition: plan.exists ? plan.stop_condition : null,
      usage_budget: plan.exists ? plan.usage_budget : null,
      scope_stories: plannedStories,
      scope_chats: plannedChats,
      tier_plan: tierPlan,
    },
    ledger: {
      retro_path: rollup.retro.path,
      usage_path: rollup.usage.path,
      retro_exists: rollup.retro.exists,
      usage_exists: rollup.usage.exists,
      skipped: rollup.counts.skipped,
      run_records: runRecords.map(e => ({ id: e.id, ts: e.ts, retro: e.retro })),
    },
    executed,
    // THE FIELD THIS WHOLE STORY EXISTS FOR. Its own key, always present, even when empty —
    // an absent key would be indistinguishable from "nothing was missed".
    planned_not_executed: plannedNotExecuted,
    executed_not_planned: executedNotPlanned,
    executed_not_planned_caveat: REVERSE_SET_CAVEAT,
    estimate_accuracy: aggregate,
    per_story: perStory,
    tier: { rows: tierRows, divergences: tierDivergences },
  };
}

// ---------- rendering ----------

/**
 * STORY-29.2.04 AC-4 — the plan against the run it NAMED.
 *
 * The pre-seam case leads this section rather than hiding at the end of it: for every plan
 * currently on disk in this repository, including the live one, this is the whole answer, and
 * an operator must be able to tell "the plan was not falsified" from "the plan could not be
 * falsified because nobody wrote a projection".
 */
function renderTrack(cmp) {
  const t = cmp.track || { referenced: false, pre_seam: true };
  const lines = ['### Plan vs the named run', ''];

  // THREE states, not two. "There is no plan" and "the plan predates the seam" are different
  // answers, and only one of them describes an authorisation that happened.
  if (t.plan_missing) {
    lines.push('- **track reference:** _no plan, so no track reference to read. This is not a '
      + 'pre-seam plan — a pre-seam plan was authorised, in writing, before the seam existed; '
      + 'here no plan was found at all (see the banner above)._');
    return lines.join('\n');
  }

  if (!t.referenced) {
    lines.push(`- **track reference:** _${planMod.PRE_SEAM_NOTE}_`);
    return lines.join('\n');
  }
  lines.push(`- **track:** \`${t.path}\` · **run:** \`${t.run_id}\``);
  if (!t.found) {
    lines.push(`- **NOT RESOLVED** — ${t.shape.note}`);
    for (const f of t.shape.findings) lines.push(`  - \`${f.code}\` — ${f.detail}`);
    if (t.available_runs.length) {
      lines.push(`- runs the track DOES carry: ${t.available_runs.map(r => `\`${r}\``).join(', ')}`);
    }
    return lines.join('\n');
  }
  lines.push(`- **shape:** ${t.shape.ok ? 'transcription — nothing re-derived' : '**RE-DERIVED**'}`);
  for (const f of t.shape.findings) lines.push(`  - \`${f.code}\` — ${f.detail}`);

  const v = t.variance;
  const u = v.usage;
  lines.push('', '#### Usage vs the run\'s projection', '');
  if (u.verdict === 'no-projection') {
    // NOT "0", and NOT "on budget". ADR-0184 made the null explicit precisely so this line can
    // be written honestly, and the missing-estimate count is what makes it actionable.
    lines.push(`**No projection to compare against** — \`projected_usage.tokens\` is explicit `
      + `null${u.missing_estimates === null ? '' : ` over ${u.missing_estimates} unestimated `
        + `story/ies (${u.counted === null ? '?' : u.counted} counted)`}. `
      + `Actual: ${u.actual === null ? '_no usage row_' : u.actual}. `
      + 'A run with no projection cannot be over or under it.');
    if (u.projected_basis) lines.push('', `_basis: ${u.projected_basis}_`);
  } else if (u.verdict === 'no-actual') {
    lines.push(`Projected **${u.projected}**; **no actual** — the usage ledger holds no row for `
      + 'any of this run\'s stories, so the projection is untested rather than met.');
  } else {
    const pct = u.ratio === null ? null : Math.round((u.ratio - 1) * 100);
    lines.push(`Projected **${u.projected}**, actual **${u.actual}** — variance **${u.variance}**`
      + `${pct === null ? '' : ` (${pct >= 0 ? '+' : ''}${pct}%)`}.`);
  }

  lines.push('', '#### Variance rows', '');
  lines.push('| what | id | planned | actual | verdict | provenance |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of v.rows) {
    lines.push(`| ${r.kind} | \`${r.id}\` | ${r.planned === null ? '_no projection_' : r.planned} `
      + `| ${r.actual === null ? '_not recorded_' : r.actual} | \`${r.verdict}\` `
      + `| ${r.provenance} |`);
  }
  lines.push('');
  lines.push(v.divergences.length
    ? `**${v.divergences.length} divergence(s)** from the written plan: `
      + v.divergences.map(d => `\`${d.id}\` (${d.verdict})`).join(', ')
    : 'No divergence from the written plan across the rows that could be compared — rows marked '
      + '`no-projection` are NOT among them, and are not evidence of agreement.');
  return lines.join('\n');
}

/**
 * The markdown a phase report or a run log pastes in. Emits exactly one `##` heading of its
 * own, additively, matching `renderPhaseRecall`'s stance.
 *
 * A PARTIAL COMPARISON SAYS SO IN ITS FIRST LINE, not in a footnote. AC-6's risk note is that
 * a partial comparison reads as a complete one; the mitigation has to be somewhere a reader
 * cannot skip.
 */
function render(cmp) {
  const lines = ['## Plan vs actual', ''];
  if (!cmp.complete) {
    lines.push('> **PARTIAL COMPARISON — this is not a complete answer.** Missing input:');
    for (const m of cmp.missing) lines.push(`> - ${m}`);
    lines.push('');
  }
  lines.push(`- **run_id:** ${cmp.run_id ? `\`${cmp.run_id}\`` : '_unknown — no plan_'}`);
  lines.push(`- **stop condition:** ${cmp.plan.stop_condition || '_not recorded_'}`);
  lines.push(`- **planned:** ${cmp.plan.scope_stories.length} story/ies across `
    + `${cmp.plan.scope_chats.length} chat(s)`);
  lines.push(`- **executed:** ${cmp.executed.length}`);
  lines.push('');

  lines.push('### Planned and NOT executed', '');
  if (cmp.planned_not_executed.length === 0) {
    lines.push('None — every planned story has a ledger record.');
  } else {
    for (const id of cmp.planned_not_executed) lines.push(`- \`${id}\` — **no ledger record**`);
  }
  lines.push('');

  if (cmp.executed_not_planned.length) {
    lines.push('### Executed and not planned', '');
    for (const id of cmp.executed_not_planned) lines.push(`- \`${id}\``);
    lines.push('', `_${cmp.executed_not_planned_caveat}_`, '');
  }

  lines.push('### Estimate vs actual', '');
  const a = cmp.estimate_accuracy;
  if (a.rate === null) {
    // NOT "100%". See the header.
    lines.push(`No estimates could be compared (${a.estimated_count} estimated, `
      + `${a.unestimated_count} unestimated, ${a.compared} comparable) — **there is no accuracy `
      + 'figure to report**, which is different from a perfect one.');
  } else {
    lines.push(`${a.compared} of ${a.stories_planned} planned story/ies had both an estimate `
      + `and an actual; ${(a.rate * 100).toFixed(0)}% landed within 20%.`);
  }
  lines.push('');
  lines.push('| story | estimate | actual | variance | verdict |');
  lines.push('|---|---|---|---|---|');
  for (const s of cmp.per_story) {
    lines.push(`| \`${s.id}\` | ${s.estimated ? s.estimate : '_unestimated_'} `
      + `| ${s.actual === null ? '_no usage row_' : s.actual} `
      + `| ${s.variance === null ? '—' : s.variance} `
      + `| ${s.estimate_vs_actual || '—'} |`);
  }
  lines.push('');

  lines.push(renderTrack(cmp), '');

  lines.push('### Tier plan vs actual', '');
  if (cmp.tier.divergences.length === 0) {
    const comparable = cmp.tier.rows.filter(r => r.comparable).length;
    lines.push(comparable === 0
      ? 'No story had both a declared tier and a recorded tier, so **no divergence could be '
        + 'detected either way** — this is not agreement.'
      : `No divergence across ${comparable} comparable story/ies.`);
  } else {
    for (const r of cmp.tier.divergences) {
      lines.push(`- \`${r.id}\` — planned **${r.planned_tier}**, ran **${r.actual_tier}**`
        + (r.reason ? ` (reason: ${r.reason})` : ''));
    }
  }
  return lines.join('\n');
}

// ---------- CLI ----------

function usage(msg) {
  if (msg) console.error(msg);
  console.error('usage: node plan-vs-actual.js --plan <path> [--retro <path>] [--usage <path>] '
    + '[--track <sidecar path>] [--track-root <dir>] [--json]');
  process.exit(EXIT_USAGE);
}

function main(argv) {
  const args = argv.slice(2);
  let planPath = null;
  let retroPath;
  let usagePath;
  let trackPath;
  let trackRoot;
  let asJson = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const need = (name) => {
      const v = args[++i];
      if (v === undefined || String(v).indexOf('--') === 0) usage(`${name} requires a value`);
      return v;
    };
    if (a === '--plan') planPath = need('--plan');
    else if (a === '--retro') retroPath = need('--retro');
    else if (a === '--usage') usagePath = need('--usage');
    // STORY-29.2.04 — override the track the PLAN cites. For a fixture, or for reading a plan
    // whose cited sidecar has moved; the plan's own citation is the default and is preferred.
    else if (a === '--track') trackPath = need('--track');
    else if (a === '--track-root') trackRoot = need('--track-root');
    else if (a === '--json') asJson = true;
    else usage(`unknown argument "${a}"`);
  }
  if (!planPath) usage('--plan is required');

  const cmp = compare(planPath, retroPath, usagePath, { trackPath, trackRoot });
  if (asJson) console.log(JSON.stringify(cmp, null, 2));
  else console.log(render(cmp));
  // A PARTIAL comparison is still a success — "the plan is missing" is the useful answer.
  return EXIT_OK;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = {
  compare, render, renderTrack, usageTotal,
  trackVariance, trackStoryId,
  REVERSE_SET_CAVEAT, NO_PLAN, NO_RECORDS,
  EXIT_OK, EXIT_USAGE, main,
};
