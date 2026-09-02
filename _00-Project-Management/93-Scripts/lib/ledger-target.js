'use strict';
/**
 * ledger-target.js — WHERE DOES THIS GATE'S RECORD GO? Asked once, in one place, for the
 * whole gate-tool family (STORY-29.1.01, closing BUG-20260804-37 and BUG-20260804-39).
 *
 * ============================================================================
 * THE DEFECT WAS A DEFAULT, NOT A FLAG
 * ============================================================================
 * `autopilot-entry-probe.js`, `autopilot-halt-ack.js`, `autopilot-branch-assert.js` and
 * `commit-status-divergence.js` all record through `autopilot-decision-capture.capture()`,
 * which spawns `retro-capture.js`, whose destination DEFAULTS to the production calibration
 * ledger `41-Reports/retro/retro-log.jsonl`. So the natural way to check whether a gate still
 * refuses — run it, read its exit code, pass no `--out` — wrote a fabricated `run` record into
 * the one dataset three components read as fact. It happened: the ledger carries a
 * `"id":"verify-junk"` line from 2026-08-04T14:06:58.443Z (BUG-20260804-37), and BUG-20260804-39
 * found the same door open on two more tools.
 *
 * BUG-20260804-39 said the choice must be made ONCE, in a shared seam, "not per script — a
 * per-script `--dry-run` would be the fourth place this decision is spelled, which is the drift
 * ADR-0109 exists to prevent". This module is that seam. There is no per-tool flag.
 *
 * ============================================================================
 * THE RULE: A PRODUCTION WRITE NEEDS A RUN THE REPOSITORY CAN VOUCH FOR
 * ============================================================================
 *   `--out <path>` given            -> `explicit`   · write there, no questions asked
 *   no `--out`, run context proven  -> `production` · write the DEFAULT ledger (see below)
 *   no `--out`, nothing proves it   -> `refused`    · write NOWHERE, and say where it would have
 *
 * ============================================================================
 * THE DEFAULT FOLLOWS THE REPORTS DIR IT WAS POINTED AT (BUG-20260810-05)
 * ============================================================================
 * `--dir` / `--reports-dir` relocated WHERE THE VOUCH WAS LOOKED FOR and not where the record
 * was WRITTEN. So a fully scratch-directed invocation — a temp dir holding a real plan or
 * checkpoint, which is exactly what a test fixture or a rehearsal looks like — vouched itself
 * against the scratch dir and then wrote the REAL `41-Reports/retro/retro-log.jsonl`. The tool
 * was told "work over there" and it half-listened, which is worse than not listening: the
 * caller's evidence that it was isolated (their own dir, their own plan) was the very thing
 * that authorised the production write.
 *
 * THE PRECEDENCE, IN ORDER, AND IT IS THE WHOLE RULE:
 *
 *   1. `--out <path>`          explicit, verbatim, always wins. Any run id, any dir.
 *   2. `PM_RETRO_LOG`          the writer's own env override. An operator who has already
 *                              redirected the ledger has said where records go; the reports dir
 *                              does not get to argue with that. (It still does NOT authorise an
 *                              unvouched write — see `productionLedgerPath()` below.)
 *   3. reports dir REDIRECTED  the ledger follows it: `<reportsDir>/retro/retro-log.jsonl`,
 *                              the same sub-path production uses, derived from the production
 *                              constants rather than retyped.
 *   4. otherwise               the production ledger. Reached when the reports dir IS the
 *                              production one, or when none was given at all.
 *
 * Rule 3 fails in the safe direction twice over: a scratch dir gets a scratch ledger, and if the
 * sub-path cannot be derived the answer falls back to production rather than to a guess.
 *
 * "Proven" is an ARTEFACT ON DISK, never a shape rule:
 *
 *   run-plan     `41-Reports/AUTOPILOT-PLAN-<run_id>.md`, written by `autopilot-plan.js` BEFORE
 *                the entry probe runs. It is the authorisation document (ADR-0151) and the one
 *                blocking write in the whole skill — if it is not there, the run was never
 *                authorised, so nothing it claims to have decided belongs on the ledger.
 *   checkpoint   a record whose `run_id` matches, found by `readCheckpointForRun()` (ADR-0157).
 *                Present from the first atomic boundary onwards, which is every gate after entry.
 *
 * BUG-20260804-37 proposed a run-id SHAPE rule instead (`autopilot-<YYYY-MM-DD>-<slug>`) and
 * immediately noted its cost: "two spellings of a format is the defect ADR-0109 exists to
 * prevent". An artefact lookup has no second spelling to maintain, it cannot be satisfied by
 * typing a plausible string, and it fails in the safe direction — an unrecognised run writes
 * nowhere rather than writing something nobody can trace. `verify-junk` has neither artefact.
 *
 * ============================================================================
 * WHY REFUSING IS NOT THE SAME AS BEING QUIET
 * ============================================================================
 * A refusal returns the production path it declined to use, so the caller can print it. The
 * gate's OWN verdict and exit code are untouched: `--out`-less verification is the invocation
 * whose whole point is the exit code (BUG-20260804-37 named that as the contributing factor),
 * and a resolver that changed the verdict would break the thing it is protecting.
 *
 * ============================================================================
 * ONE SPELLING OF THE PRODUCTION PATH, INCLUDING ITS ENV OVERRIDE
 * ============================================================================
 * `PRODUCTION_LEDGER` is read off `retro-capture.js` rather than retyped, and
 * `productionLedgerPath()` honours `PM_RETRO_LOG` exactly as that writer does — otherwise this
 * module could refuse to write to a path the writer would never have used, and the message
 * naming "where it would have written" would be a lie.
 *
 * NEVER THROWS. A resolver that could take a gate down while deciding where to file the gate's
 * record would be worse than the pollution it prevents.
 *
 * Node stdlib only.
 */

const path = require('path');
const fs = require('fs');

const retroCapture = require(path.join(__dirname, '..', 'retro-capture.js'));
const checkpoint = require(path.join(__dirname, '..', 'autopilot-checkpoint.js'));
const plan = require(path.join(__dirname, '..', 'autopilot-plan.js'));

/** The production calibration ledger. ONE spelling — read off the writer that owns it. */
const PRODUCTION_LEDGER = retroCapture.DEFAULT_LOG_PATH;

/** The reports dir the production ledger lives under. Read off the checkpoint module, which
 *  owns that constant, so "is this dir the production one" has one spelling too. */
const PRODUCTION_REPORTS_DIR = checkpoint.DEFAULT_REPORTS_DIR;

/**
 * The ledger's place INSIDE a reports dir — `retro/retro-log.jsonl` — derived rather than
 * retyped, so a future move of the production ledger carries the redirected default with it.
 * `null` when the production ledger does not live under the production reports dir at all, in
 * which case there is no sub-path to reuse and rule 3 stands down (see the header).
 */
const LEDGER_SUBPATH = (() => {
  try {
    const rel = path.relative(PRODUCTION_REPORTS_DIR, PRODUCTION_LEDGER);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return rel;
  } catch {
    return null;
  }
})();

/** Two directory paths naming the same place. Case-insensitive on Windows, where the whole of
 *  this repository lives and where `C:\…\41-Reports` and `c:\…\41-reports` are one directory. */
function sameDir(a, b) {
  try {
    const A = path.resolve(String(a));
    const B = path.resolve(String(b));
    return process.platform === 'win32' ? A.toLowerCase() === B.toLowerCase() : A === B;
  } catch {
    return false;
  }
}

/**
 * WHERE A VOUCHED WRITE GOES when no `--out` was given — rules 2, 3 and 4 of the header.
 *
 * @param {string} [reportsDir]
 * @returns {{path: string, source: 'env'|'reports-dir'|'production'}}
 * NEVER THROWS.
 */
function defaultLedgerPath(reportsDir) {
  const env = process.env.PM_RETRO_LOG;
  if (typeof env === 'string' && env.trim() !== '') {
    return { path: env.trim(), source: 'env' };
  }
  let dir = '';
  try {
    dir = typeof reportsDir === 'string' ? reportsDir.trim() : '';
  } catch {
    dir = '';
  }
  if (dir === '' || LEDGER_SUBPATH === null || sameDir(dir, PRODUCTION_REPORTS_DIR)) {
    return { path: PRODUCTION_LEDGER, source: 'production' };
  }
  return { path: path.join(path.resolve(dir), LEDGER_SUBPATH), source: 'reports-dir' };
}

/** Every answer this module can give. Enumerated so a reader can count them and a probe can
 *  walk them; free text could do neither. */
const MODES = Object.freeze(['explicit', 'production', 'refused']);

/** How a run context was proven. `none` is an honest absence, not a missing feature. */
const CONTEXT_SOURCES = Object.freeze(['run-plan', 'checkpoint', 'none']);

/** What a refused capture reports as its reason, in the `not_recorded_because` field the gate
 *  tools already carry (ADR-0162). One token so a reader can count refusals. */
const NO_RUN_CONTEXT = 'no-run-context';

function safeMessage(err) {
  try {
    if (err && typeof err.message === 'string') return err.message;
    return String(err);
  } catch {
    return '(unprintable error)';
  }
}

/**
 * The production ledger this write would actually land in, env override included.
 * Mirrors `retro-capture.js`'s own resolution order for everything below `--out`.
 *
 * ---------------------------------------------------------------------------
 * `PM_RETRO_LOG` MOVES THE TARGET, IT DOES NOT RELAX THE REFUSAL (review MINOR-7)
 *
 * Honouring the env var HERE is what stops a refusal naming a path the writer would never have
 * used. It deliberately does NOT follow that an operator who has redirected the ledger may now
 * write an unvouched record to it: the redirect is a DESTINATION, not an authorisation, and the
 * two are exactly the things ADR-0177 separates. `PM_RETRO_LOG` is set by tests and by session
 * tooling, so treating it as consent would mean the vouching could be switched off by an
 * environment variable — the widest possible bypass, and one nobody would see.
 *
 * `--out <path>` is the escape hatch, because it is per-invocation, explicit, and visible in the
 * command an operator typed. It always wins, for any run id.
 *
 * Do not "fix" this without re-reading `tests/gate-ledger-default.test.js`: that suite drives the
 * PRODUCTION branch of this resolver through `PM_RETRO_LOG`, so a change here that let the
 * redirect authorise a write would make the refusal arms unprovable rather than merely wrong.
 */
function productionLedgerPath() {
  const env = process.env.PM_RETRO_LOG;
  return (typeof env === 'string' && env.trim() !== '') ? env.trim() : PRODUCTION_LEDGER;
}

/**
 * Can this repository vouch for `runId`? NEVER THROWS.
 *
 * @param {string} reportsDir defaults to `41-Reports/`
 * @param {string} runId
 * @returns {{authorised: boolean, source: string, evidence: string|null}}
 */
function runContext(reportsDir, runId) {
  const none = { authorised: false, source: 'none', evidence: null };
  const id = typeof runId === 'string' ? runId.trim() : '';
  if (id === '') return none;

  const dir = reportsDir || checkpoint.DEFAULT_REPORTS_DIR;

  // THE AUTHORISATION DOCUMENT FIRST. It exists before the entry probe runs, which is the one
  // gate that fires before any checkpoint has been written.
  //
  // A FILE WITH SOMETHING IN IT, not merely a name on disk (review MINOR-1). This was
  // `existsSync` alone, so a zero-byte plan, and a DIRECTORY carrying the plan's name, both
  // vouched for a run. "Proven is an ARTEFACT ON DISK, never a shape rule" is why this does not
  // parse the plan — but an empty authorisation document authorises nothing, and a directory is
  // not a document at all. Still no shape rule: one stat, no read.
  try {
    const planPath = path.join(dir, plan.planFileName(id));
    const st = fs.statSync(planPath);
    if (st.isFile() && st.size > 0) {
      return { authorised: true, source: 'run-plan', evidence: planPath };
    }
  } catch { /* an absent plan, or an unreadable reports dir, is simply not evidence */ }

  // THE RUN'S OWN RECORD. Matched on the `run_id` INSIDE the file, never on the filename
  // (BUG-20260804-26) — `readCheckpointForRun` owns that rule and this module does not restate it.
  try {
    const rec = checkpoint.readCheckpointForRun(dir, id);
    if (rec && rec.ok && rec.run_id === id) {
      return { authorised: true, source: 'checkpoint', evidence: rec.path };
    }
  } catch { /* readCheckpointForRun is contracted never to throw; belt-and-braces */ }

  return none;
}

/**
 * WHERE THIS RECORD GOES.
 *
 * @param {{out?: string, runId?: string, reportsDir?: string}} opts
 * @returns {{mode: string, path: string|null, runId: string|null, source: string,
 *            evidence: string|null, productionPath: string, defaultPath: string,
 *            defaultSource: string, why: string}}
 *          `path` is null for `refused`. `defaultPath` is the destination a VOUCHED write would
 *          use for THIS invocation — the one a refusal names, because it is the file that was
 *          spared. `productionPath` stays what its name says: the production ledger (env
 *          override included), which for a redirected reports dir is NOT where the write would
 *          have gone. Keeping the two apart is BUG-20260810-05: one field answering both
 *          questions is how a scratch invocation came to name, and write, production.
 * NEVER THROWS.
 */
function resolve(opts) {
  const options = opts || {};
  const productionPath = productionLedgerPath();
  const fallback = defaultLedgerPath(options.reportsDir);
  const defaultPath = fallback.path;
  const defaultSource = fallback.source;
  let out = '';
  try {
    out = typeof options.out === 'string' ? options.out.trim() : '';
  } catch {
    out = '';
  }

  if (out !== '') {
    return {
      mode: 'explicit',
      path: out,
      runId: typeof options.runId === 'string' ? options.runId.trim() || null : null,
      source: 'none',
      evidence: null,
      productionPath,
      defaultPath,
      defaultSource,
      why: `--out was given, so the record goes to ${out}`,
    };
  }

  let ctx;
  try {
    ctx = runContext(options.reportsDir, options.runId);
  } catch (err) {
    ctx = { authorised: false, source: 'none', evidence: `lookup failed: ${safeMessage(err)}` };
  }

  const id = typeof options.runId === 'string' ? options.runId.trim() : '';
  if (ctx.authorised) {
    // THE VOUCH AND THE WRITE NOW LOOK AT THE SAME DIRECTORY. `defaultPath` follows the reports
    // dir the vouch was found in, so a run proven by a plan in a scratch dir records there —
    // never in production (BUG-20260810-05).
    return {
      mode: 'production',
      path: defaultPath,
      runId: id || null,
      source: ctx.source,
      evidence: ctx.evidence,
      productionPath,
      defaultPath,
      defaultSource,
      why: `run ${id} is an authorised run (${ctx.source}: ${ctx.evidence}), so its record goes `
        + `to ${defaultPath}`
        + (defaultSource === 'reports-dir'
          ? ` — the ledger follows the reports dir it was pointed at, so the production ledger `
            + `(${productionPath}) is NOT written`
          : ''),
    };
  }

  return {
    mode: 'refused',
    path: null,
    runId: id || null,
    source: 'none',
    evidence: null,
    productionPath,
    defaultPath,
    defaultSource,
    // WHERE IT WOULD HAVE WRITTEN, in the message, because that is the whole content of the
    // finding: nobody knew a verification invocation had a destination at all. It names
    // `defaultPath` — the file actually spared — rather than the production ledger, which for a
    // redirected reports dir was never the destination (BUG-20260810-05).
    why: `no run context: ${id === '' ? 'no run id was supplied' : `nothing on disk records a run `
      + `called ${JSON.stringify(id)} (no ${plan.planFileName(id)} and no checkpoint)`}, so this `
      + `record was NOT written to the ledger it would have gone to `
      + `(${defaultPath}). Pass --out <path> for an ad-hoc invocation, or run it under a real `
      + 'run id.',
  };
}

module.exports = {
  MODES, CONTEXT_SOURCES, NO_RUN_CONTEXT, PRODUCTION_LEDGER,
  PRODUCTION_REPORTS_DIR, LEDGER_SUBPATH, sameDir, defaultLedgerPath,
  productionLedgerPath, runContext, resolve,
};
