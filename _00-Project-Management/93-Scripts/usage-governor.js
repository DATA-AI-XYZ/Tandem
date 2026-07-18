#!/usr/bin/env node
/**
 * usage-governor.js — pure decision engine for autopilot's usage governor
 * (STORY-21.3.04 / BACKLOG-0087 Tranche B, ADR-0085).
 *
 * ADR-0085 splits the governor into two halves and this file is ONLY the second one:
 *
 *   1. SIGNAL ACQUISITION (environment-dependent, lives OUTSIDE this file) — reading a live
 *      usage/limit surface is a harness/install-specific concern with no single fixed source.
 *      Whatever obtains that signal (the `autopilot` skill, an operator, a wrapper script)
 *      hands it to this helper as a percent-of-window-consumed + reset-time pair.
 *   2. DECISION LOGIC (this file) — a pure, dependency-free, fixture-testable function that
 *      takes that signal (plus an optional affordability pre-flight pair) and returns exactly
 *      one decision. It never reads any live system itself — that is what makes it unit-
 *      testable with fixtures instead of a real account/limit surface.
 *
 * Different granularity from ADR-0079 (per-story usage capture) — DO NOT CONFLATE:
 *   - ADR-0079 measures ACTUAL TOKENS a specific story/chat consumed, captured after the fact
 *     from session transcripts, for budgeting/estimate-seeding.
 *   - This governor measures HOW MUCH OF THE LIVE ROLLING USAGE WINDOW is consumed RIGHT NOW,
 *     and when it resets — a runtime enforcement signal, not a spend ledger.
 *   A story can look normal on ADR-0079's per-story count while the account is nonetheless
 *   near its window limit (usage elsewhere in the same window), and vice versa. This helper
 *   never reads the ADR-0079 usage log, and usage-capture.js never reads this helper's signal.
 *   `--projected-next` / `--window-budget` MAY be informed by ADR-0079/STORY-21.2.02 per-story
 *   estimates as an input the CALLER supplies — this helper treats them as opaque numbers.
 *
 * Degraded mode (mandated, ADR-0085): when the live signal is missing or invalid, the governor
 * NEVER guesses and NEVER lets the run barrel on — it returns `pause-and-ask` so autopilot
 * pauses at the next atomic boundary and asks the operator. This is a normal decision OUTPUT
 * (exit 0), not a script error.
 *
 * Decision contract:
 *   Inputs:  --percent-used <n> --reset-at <iso> [--threshold <n, default 92>]
 *            [--projected-next <tokens>] [--window-budget <tokens>]
 *   Output:  one line of JSON on stdout —
 *            { "action": "continue" | "pause-before-next" | "pause-now" | "pause-and-ask",
 *              "reason": "...", "resume_at": "<iso>|null" }
 *   Rules, in priority order:
 *     1. Missing/invalid --percent-used, OR missing/invalid --reset-at → "pause-and-ask",
 *        resume_at: null. Degraded mode is an output, not an error — exit 0.
 *     2. percent-used >= threshold (default 92, override with --threshold) → "pause-now".
 *        The governor only decides WHEN to pause; the DRIVER owns atomicity (ADR-0083) —
 *        autopilot finishes (or cleanly rolls back) the CURRENT ATOMIC UNIT, writes the
 *        checkpoint's `paused` block, THEN pauses. resume_at is --reset-at passed through
 *        VERBATIM (never recomputed) — reset-time math across timezones is error-prone, so
 *        this helper trusts the source's own timestamp rather than re-deriving one.
 *     3. Else, if BOTH --projected-next and --window-budget are given and
 *        projected-next > window-budget → "pause-before-next" (affordability pre-flight —
 *        pause BEFORE starting the next unit, not mid-way through it).
 *     4. Else → "continue".
 *
 * Usage:
 *   node usage-governor.js --percent-used 95 --reset-at 2026-07-18T20:00:00Z
 *   node usage-governor.js --percent-used 80 --reset-at <iso> --threshold 75
 *   node usage-governor.js --percent-used 50 --reset-at <iso> --projected-next 50000 --window-budget 10000
 *   node usage-governor.js                                   # no signal -> pause-and-ask
 *
 * Exit codes:
 *   0 — a decision was printed (including the pause-and-ask degraded case — a governor call
 *       must never fail the run it's protecting).
 *
 * Dependency-free — Node stdlib only, consistent with every other `93-Scripts/` tool.
 */

'use strict';

const DEFAULT_THRESHOLD = 92;

// ---------- CLI parsing ----------

function parseArgs(argv) {
  const args = {
    percentUsed: null, resetAt: null, threshold: null,
    projectedNext: null, windowBudget: null, help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--percent-used' && argv[i + 1] !== undefined) args.percentUsed = argv[++i];
    else if (a === '--reset-at' && argv[i + 1] !== undefined) args.resetAt = argv[++i];
    else if (a === '--threshold' && argv[i + 1] !== undefined) args.threshold = argv[++i];
    else if (a === '--projected-next' && argv[i + 1] !== undefined) args.projectedNext = argv[++i];
    else if (a === '--window-budget' && argv[i + 1] !== undefined) args.windowBudget = argv[++i];
    else if (a === '--help') args.help = true;
  }
  return args;
}

// ---------- small parsing helpers (never throw) ----------

function toFiniteNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isValidIso(v) {
  if (!v) return false;
  const d = new Date(v);
  return !Number.isNaN(d.getTime());
}

// ---------- pure decision engine ----------

// The whole governor contract in one pure function: signal + thresholds in, one decision out.
// No I/O, no clock reads, no process access — everything the decision needs is a parameter,
// which is what makes this fixture-testable (ADR-0085).
function decide({ percentUsed: percentUsedRaw, resetAt: resetAtRaw, threshold: thresholdRaw, projectedNext: projectedNextRaw, windowBudget: windowBudgetRaw }) {
  const percentUsed = toFiniteNumber(percentUsedRaw);
  const resetAtValid = isValidIso(resetAtRaw);

  // Rule 1 — degraded mode: no live signal, no guessing. Missing/invalid --percent-used OR
  // missing/invalid --reset-at both mean "the signal isn't usable" — pause-and-ask either way.
  if (percentUsed === null) {
    return {
      action: 'pause-and-ask',
      reason: 'missing or invalid --percent-used — no live usage signal available; degraded mode is pause-and-ask, never a guess',
      resume_at: null,
    };
  }
  if (!resetAtValid) {
    return {
      action: 'pause-and-ask',
      reason: 'missing or invalid --reset-at — no live usage signal available; degraded mode is pause-and-ask, never a guess',
      resume_at: null,
    };
  }

  const thresholdParsed = toFiniteNumber(thresholdRaw);
  const threshold = thresholdParsed === null ? DEFAULT_THRESHOLD : thresholdParsed;

  // Rule 2 — threshold crossed: pause-now. Finish the current atomic unit first (driver's job,
  // ADR-0083) — this helper only decides WHEN. resume_at passes --reset-at through verbatim.
  if (percentUsed >= threshold) {
    return {
      action: 'pause-now',
      reason: `usage at ${percentUsed}% has reached the ${threshold}% pause threshold — finish the current atomic unit, write the checkpoint, then pause (never mid-unit)`,
      resume_at: resetAtRaw,
    };
  }

  // Rule 3 — affordability pre-flight: only evaluated when BOTH figures are supplied.
  const projectedNext = toFiniteNumber(projectedNextRaw);
  const windowBudget = toFiniteNumber(windowBudgetRaw);
  if (projectedNext !== null && windowBudget !== null && projectedNext > windowBudget) {
    return {
      action: 'pause-before-next',
      reason: `projected next-unit usage (${projectedNext} tokens) exceeds the remaining window budget (${windowBudget} tokens) — pause before starting it, not mid-way through it`,
      resume_at: resetAtRaw,
    };
  }

  // Rule 4 — default: keep going.
  return {
    action: 'continue',
    reason: `usage at ${percentUsed}% is below the ${threshold}% threshold and the next unit is affordable (or affordability was not checked)`,
    resume_at: null,
  };
}

// ---------- main ----------

function main(argv) {
  const args = parseArgs(argv);

  if (args.help) {
    console.log('Usage: node usage-governor.js --percent-used <n> --reset-at <iso> [--threshold <n, default 92>] [--projected-next <tokens>] [--window-budget <tokens>]');
    return 0;
  }

  const decision = decide({
    percentUsed: args.percentUsed,
    resetAt: args.resetAt,
    threshold: args.threshold,
    projectedNext: args.projectedNext,
    windowBudget: args.windowBudget,
  });

  console.log(JSON.stringify(decision));
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { main, parseArgs, decide, DEFAULT_THRESHOLD };
