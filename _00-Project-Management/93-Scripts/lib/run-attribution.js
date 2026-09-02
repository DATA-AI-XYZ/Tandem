'use strict';
/**
 * run-attribution.js — "you forgot `--run`", SAID OUT LOUD (BUG-20260811-02).
 *
 * ============================================================================
 * THE DEFECT IS A SILENCE, NOT A MARKER
 * ============================================================================
 * `retro-capture.js` and `usage-capture.js` both take the owning run as an explicit
 * `--run <run_id>` flag, and both fall back to the literal `unattributed-run` when it is absent.
 * The MARKER is right and stays: a marker beats a fabricated or guessed id, and "captured outside
 * a run" is a real thing that must remain sayable (ADR-0179).
 *
 * What was wrong is that the fallback was INDISTINGUISHABLE FROM SUCCESS. Exit 0, a success line
 * on stdout, nothing on stderr, nothing in `pm:lint` — and the row is then invisible to every
 * consumer that filters or joins by `run_id`. It has already caught two different operators: a
 * story implementer on 2026-08-10 (`STORY-32.1.01`) and the ORCHESTRATOR on 2026-08-11
 * (`E32-CHAT-01`), the latter while writing a run artefact that claimed "retro + usage captured
 * with `--run`" — true of one line in three. Remembering is not a workable control.
 *
 * ============================================================================
 * IT WARNS ON EVIDENCE, NOT ON ABSENCE — WHICH IS WHY IT IS QUIET TODAY
 * ============================================================================
 * A warning that fired on every unattributed capture would fire on the ones that are CORRECT, and
 * a warning nobody has to act on is a warning nobody acts on. So this asks a narrower question:
 * **is a run in flight right now that this capture could have named?**
 *
 *   the live checkpoint is readable, carries a `run_id`, and its state is NON-TERMINAL
 *   (`running` or `paused`) -> a run is under way, `--run` was almost certainly forgotten, SAY SO
 *   anything else -> silence. No checkpoint, an unreadable one, or a run that has RECORDED its
 *   ending means there is no run to have forgotten, and `unattributed-run` is the honest answer.
 *
 * `paused` counts as in flight deliberately: a paused run is resumable and its captures still
 * belong to it. A `completed` / `halted` run does not — which is why this is silent in this
 * repository today, where the live record carries a recorded `completed`.
 *
 * ============================================================================
 * IT WARNS. IT DOES NOT ATTRIBUTE.
 * ============================================================================
 * DERIVING the id from the checkpoint is the better end state and is deliberately NOT done here:
 * neither writer takes a reports-dir argument, so a capture redirected to a scratch ledger would
 * silently inherit the PRODUCTION run's id — a fabricated attribution, which is worse than the
 * absence it replaces and is the exact class of defect ADR-0179's marker exists to prevent. That
 * half wants a `--no-run` escape hatch and a declared reports dir designed properly, and is
 * carried as BACKLOG-0183.
 *
 * NEVER THROWS, and never changes an exit code. Both writers are contracted to exit 0 whatever
 * happens (ADR-0110); a helper that could break that while complaining about bookkeeping would be
 * worse than the bookkeeping.
 *
 * Node stdlib only.
 */

const path = require('path');

/** The run this repository is currently executing, or `null`. See the header for what counts. */
function inFlightRun(reportsDir) {
  let checkpoint;
  try {
    checkpoint = require(path.join(__dirname, '..', 'autopilot-checkpoint.js'));
  } catch {
    return null;
  }
  try {
    const dir = reportsDir || checkpoint.DEFAULT_REPORTS_DIR;
    const rec = checkpoint.readCheckpoint(path.join(dir, checkpoint.LIVE_NAME));
    if (!rec || !rec.ok || !rec.run_id) return null;
    // A run that RECORDED its ending is not one anybody could still be capturing against.
    // `isTerminal()` is the module's own predicate — asking it here rather than restating the
    // state list is what stops the two drifting (ADR-0161's argument, one module over).
    if (checkpoint.isTerminal(rec.state)) return null;
    return { run_id: rec.run_id, state: rec.state, state_source: rec.state_source };
  } catch {
    return null;
  }
}

/**
 * The line to print on stderr when a capture falls back to `unattributed-run`, or `null` when
 * there is nothing to complain about.
 *
 * @param {{writer: string, unit?: string, marker: string, reportsDir?: string}} opts
 */
function missingRunWarning(opts) {
  const o = opts || {};
  const live = inFlightRun(o.reportsDir);
  if (live === null) return null;
  const unit = typeof o.unit === 'string' && o.unit.trim() !== '' ? o.unit.trim() : 'this record';
  return `no --run given, so ${unit} was recorded as \`${o.marker}\` — but run `
    + `\`${live.run_id}\` is ${live.state} on the live checkpoint right now. An unattributed row `
    + 'is invisible to every run-scoped report and every usage↔retro join. If it belongs to that '
    + `run, re-capture with  --run ${live.run_id}  (do NOT edit the written row: ADR-0165 — an `
    + 'executed record is a record). If it genuinely belongs to no run, the marker is correct and '
    + 'this warning can be ignored.';
}

module.exports = { inFlightRun, missingRunWarning };
