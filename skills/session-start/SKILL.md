---
name: session-start
description: Load active project context at the start of a Claude Code session. Use when the user opens a session and asks "what's going on", "what's next", "where did we leave off", or invokes /tandem:session-start. Reads the active WIP index (ACTIVE.md), the most recent ADRs, the MONITOR revision history, and any stories in `in-progress` or `blocked` — then announces the suggested hat and next step.
---

# Tandem: session-start (orientation)

Use at the start of a working session to re-orient. The blog's "start hooks load team-specific context dynamically" recommendation, implemented as a manual skill (less noisy than a hook that fires on every session, including 2-message ones).

## Pre-flight — is the kit wired?

Before loading context, run the cheap wiring gate: `node _00-Project-Management/93-Scripts/doctor.js --gate` (npm: `npm run pm:doctor -- --gate`). It is **silent on success**; if it exits non-zero with **kit not wired — run `npm run pm:install`**, surface that first and recommend `npm run pm:install` before orienting — the kit isn't wired yet, so the folders/scripts this skill reads may be missing. (STORY-12.2.03)

## What to load

Folder locations are resolved through the path map (`pm-paths.js` / `pm-paths.json`) rather than hardcoded, ensuring consistent references across all skills regardless of whether the repo uses the canonical or flattened layout. The script `node _00-Project-Management/93-Scripts/lib/pm-paths.js resolve <role>` prints the physical folder for any logical role (e.g., `resolve stories`, `resolve decisions`, `resolve active`, `resolve monitor`).

1. **Active WIP index** — resolve the `active` folder via the path map; it typically maps to `12-Active` (canonical) or `00-Active` (flattened). Read `ACTIVE.md` from the resolved folder.
   - Falls back to: scan stories with `status: in-progress` directly (slower but always works).

2. **Monitor / revision history** — resolve the `monitor` folder via the path map; it typically maps to `42-Monitor` (canonical) or `00-Monitor` (flattened). Read `MONITOR.md` from the resolved folder.
   - If the file does not exist, note "no monitor file found".

3. **Last 5 ADRs by filename**, sorted descending by NNNN — resolve the `decisions` folder via the path map; it maps to this repo's canonical decisions folder, or to `06-ADR` under a flattened layout. Glob `ADR-*.md` under that resolved folder.
   - If the folder does not exist, note "no ADR folder yet — first ADR will need to create it."

4. **Stories folder** — resolve the `stories` folder via the path map; it maps to this repo's canonical stories folder, or to `03-Stories` under a flattened layout. Glob `STORY-*.md` recursively under that resolved folder.
   - From that folder, surface:
     - `status: in-progress` — list paths + AC tick state.
     - `status: blocked` — list paths + reason.
     - `status: in-review` aged > 3 days — flag for close-out.

5. **Unfinished autopilot run** — ask the checkpoint, not the board, whether a previous
   unattended run is still open. Answered **from the checkpoint alone** (STORY-26.4.02 AC-6):

   ```bash
   node _00-Project-Management/93-Scripts/autopilot-checkpoint.js --unfinished
   ```

   It prints `unfinished run present: <run_id> (paused|running|halted)` or `no unfinished run`,
   and **always exits 0** — orientation must never be blocked by a checkpoint probe, so read its
   stdout and never its exit code. A `halted` run is the one worth surfacing loudest: before
   ADR-0152 a run that reached its stop condition and a run whose session died at 3am produced
   indistinguishable checkpoints. If a run is reported open, name it in the orientation block and
   point at `41-Reports/AUTOPILOT-CHECKPOINT-<run_id>.json`; a checkpoint reported *unreadable* is
   not the same as "nothing to resume" and must be surfaced rather than skipped.

6. **Stale paused run** — step 5 says *whether* a run is open; this says whether it has been
   open too long. Run it in the same breath (STORY-26.5.02, ADR-0159):

   ```bash
   node _00-Project-Management/93-Scripts/autopilot-stale-runs.js
   ```

   It prints `stale paused run(s): <run_id> (<reason>, <age>)` or `no stale paused run`, and
   **always exits 0** — like the checkpoint probe, read its stdout and never its exit code.
   A run an operator has already judged is not listed by default; the line says how many are
   hidden, and `--include-dismissed` shows them with their reasons (STORY-29.1.04, ADR-0180).

For multi-file scans (step 4), delegate to an Explore agent (SOP §18) and ingest the summary — do not paste raw file contents into the main thread. **Use the Explore scan only for the in-progress / blocked / stale-in-review *list*, NOT for project-wide totals** — a broad fan-out scan can silently undercount or sample a subset of the stories folder. Take any shipped / total / blocked / in-progress *counts* from the resolved MONITOR (the maintained source of truth), per the tiebreaker rule in "Output rules" below. (Precedent: a session-start Explore scan once under-reported the story/epic totals and missed a blocked story vs the MONITOR's authoritative count — which is why project-wide counts come from the MONITOR and only the WIP list comes from the scan.)

**Layout detection rule:** check existence with `Bash ls`, `Glob`, or `Read` (which returns an error for missing files — treat that as "not present" rather than throwing). Do not assume any single layout. The orientation must work whether the repo uses the canonical SOP scaffold OR a project-specific flattened variant.

## Stale paused runs — reported here, never acted on

A run that paused and never came back is invisible until somebody happens to open its
checkpoint. `autopilot-stale-runs.js` (step 6 above) makes it part of orientation. Two things
count as stale, and the notice names which:

- **`overdue-scheduled-resume`** — the run recorded a `resume_scheduled` (or the older
  `paused.resume_at`) and that instant has passed. Staleness is measured from it.
- **`paused-without-schedule`** — the run was paused with no resume time at all and the pause
  is older than the threshold (default 24h, `--max-paused-age-hours <n>`). This is the arm the
  one real archived pause in this repository lands on, which is why it exists (ADR-0159).

A `running`, `completed` or `halted` run is **never** reported here. `halted` is surfaced by
step 5 instead, and loudly — the two probes answer different questions and neither substitutes
for the other.

### A judged run stays quiet until the facts change (ADR-0180)

A notice that is always present is a notice nobody reads. When a pause is deliberate — this
repository's one archived pause is held at an operator confirmation gate for a deferred release
— record the judgement ONCE, with a reason and an actor:

```bash
node _00-Project-Management/93-Scripts/autopilot-stale-runs.js --dismiss <run_id> --reason "<why>" [--by "<who>"]
```

The reason is REQUIRED (a reason-less dismissal exits 2). So is the ACTOR, which defaults to
`git config user.name` — `--by` overrides it, and a dismissal that can name neither refuses
rather than recording a judgement nobody can be asked about (BUG-20260810-04). If an agent
records the judgement on an operator's behalf, say so IN `--by`: the store's job is to answer
who-dismissed-why, and "the Dev hat, on the operator's word" is a different fact from "the
operator". Both are written to
`41-Reports/STALE-RUN-DISMISSALS.json` — BESIDE the checkpoint, never on it, so nothing here
rewrites a run's own record. The dismissal is keyed to the EVIDENCE it was shown: the run, which
staleness arm fired, when the pause began and what resume was scheduled. **A run that resumes
and pauses again, trips the other arm, or a DIFFERENT run going stale, all surface regardless** —
that is the blanket mute BACKLOG-0147 named as the failure mode, and the evidence key is what
prevents it. Dismissing is a separate, deliberate command; session-start never writes one.

**This step is read-only, and deliberately so.** Session-start REPORTS a stale run and stops
there: it takes no action on the checkpoint, does not restart the work, and changes nothing
about the run's recorded state. Deciding what happens next is the operator's, in a session
opened for that purpose — a paused run may be paused on purpose, and orientation is not the
place to find out. Name the `run_id`, the reason, the age, and the checkpoint path; then move
on to the rest of the orientation block.

## What to output

A short orientation block:

```
📌 Session-start orientation — <ISO date>

Active WIP:
  - STORY-NN.M.PP-<slug> (in-progress, 3/5 ACs ticked, started <date>)
  - STORY-NN.M.PP-<slug> (in-review, all ACs ticked, awaiting testplan run)

Blocked (1):
  - STORY-NN.M.PP-<slug> — blocked on ADR-NNNN since <date>

Stale in-review (1):
  - STORY-NN.M.PP-<slug> — in-review for 5 days, run /tandem:close-out-story

Recent ADRs:
  - ADR-NNNN — <title> (<date>)

Last week (from MONITOR):
  - <copy the most recent revision-history line>

Suggested hat: <Dev | PM | QA | Founder>
Suggested next step: <one specific action>
```

## Output rules

- ≤ 25 lines total. This is orientation, not a status report.
- Do not modify any artefact during session-start — read-only.
- If the resolved ACTIVE / monitor file is empty (or none exists), say so and recommend the user pull a Ready story.
- If the resolved monitor file hasn't been updated in > 7 days, flag it.
- **MONITOR is the tiebreaker over the fan-out story scan.** If the step-4 `Explore` story scan disagrees with the resolved monitor file (different shipped/blocked/in-progress counts, missing a story the monitor lists as blocked, or status values that don't match the project's enum) AND the monitor was updated within 7 days, treat the **monitor as authoritative**, surface the discrepancy in one line, and base the "Blocked / In-progress" lists on the monitor. A broad fan-out scan can silently undercount or sample a subset; the monitor is the maintained source of truth.
- If the repo's folder layout differs from the canonical scaffold, name the resolved paths in a short note at the top of the output (one line, e.g. "Layout: 00-Monitor + 03-Stories + 06-ADR (flattened variant)") so subsequent skills + the user know what's actually being read.

## Non-negotiable rules from CLAUDE.md

- Subagent delegation (SOP §18) for multi-file scans.
- Status enum — never invent values when summarising.
- Do not regenerate the dashboard at session start (that's the Stop hook's job).

## Join this chat to the conversation Mode

This chat opts in to the project's global Mode as part of session start:

1. Get the current state and join:
   `node _00-Project-Management/93-Scripts/mode.js join --session <session_id>`
   `node _00-Project-Management/93-Scripts/mode.js get --json`
2. Lead the session announcement with the active mode, e.g.
   *"Tandem mode: **DEV** (set by you, 2026-06-03). I'll nudge on planning requests."*
   If mode is `neutral`, say so and note the user can set one with `/mode <plan|dev|dual|neutral>`.

Use the session ID from the session context as `<session_id>`.

## End-of-session-start

Always end with a single concrete suggested next action — not a menu. The user can override; the default should be obvious.
