---
description: Load active project context at the start of a Claude Code session. Use when the user opens a session and asks "what's going on", "what's next", "where did we leave off", or invokes /Tandem:session-start. Reads 12-Active/ACTIVE.md, the most recent ADRs, the MONITOR revision history, and any stories in `in-progress` or `blocked` — then announces the suggested hat and next step.
---

# Tandem: session-start (orientation)

Use at the start of a working session to re-orient. The blog's "start hooks load team-specific context dynamically" recommendation, implemented as a manual skill (less noisy than a hook that fires on every session, including 2-message ones).

## What to load

The canonical layout is the scaffold under `_00-Project-Management/` (12-Active, 32-Stories, 40-Decisions, 42-Monitor, etc.). Older / flattened repos may use alternate names — accept any of the below as a match, in order. If NONE of the candidates exist, note it in the orientation block and move on (don't fabricate scaffolding).

1. **Active WIP index** — try in order:
   - `_00-Project-Management/12-Active/ACTIVE.md`  (canonical)
   - `_00-Project-Management/00-Active/ACTIVE.md`  (flattened-numbering variant)
   - Falls back to: scan stories with `status: in-progress` directly (slower but always works).

2. **Monitor / revision history** — try in order:
   - `_00-Project-Management/42-Monitor/MONITOR.md`  (canonical)
   - `_00-Project-Management/00-Monitor/MONITOR.md`
   - `_00-Project-Management/00-Monitor/STORY-MONITOR.md`  (Curated Lagos / older naming)
   - Read the top of whichever exists; if none, note "no monitor file found".

3. **Last 5 ADRs by filename**, sorted descending by NNNN, from the FIRST folder that exists:
   - `_00-Project-Management/40-Decisions/ADR-*.md`  (canonical)
   - `_00-Project-Management/06-ADR/ADR-*.md`  (flattened-numbering variant — e.g. Curated Lagos)
   - If neither folder exists, note "no ADR folder yet — first ADR will need to create it."

4. **Stories folder** — try in order; first match wins:
   - `_00-Project-Management/32-Stories/**/STORY-*.md`  (canonical)
   - `_00-Project-Management/03-Stories/**/STORY-*.md`  (flattened-numbering variant)
   - From that folder, surface:
     - `status: in-progress` — list paths + AC tick state.
     - `status: blocked` — list paths + reason.
     - `status: in-review` aged > 3 days — flag for close-out.

For multi-file scans (step 4), delegate to an Explore agent (SOP §18) and ingest the summary — do not paste raw file contents into the main thread.

**Layout detection rule:** check existence with `Bash ls`, `Glob`, or `Read` (which returns an error for missing files — treat that as "not present" rather than throwing). Do not assume any single layout. The orientation must work whether the repo uses the canonical SOP scaffold OR a project-specific flattened variant.

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
  - STORY-NN.M.PP-<slug> — in-review for 5 days, run /Tandem:close-out-story

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
- If the repo's folder layout differs from the canonical scaffold, name the resolved paths in a short note at the top of the output (one line, e.g. "Layout: 00-Monitor + 03-Stories + 06-ADR (flattened variant)") so subsequent skills + the user know what's actually being read.

## Non-negotiable rules from CLAUDE.md

- Subagent delegation (SOP §18) for multi-file scans.
- Status enum — never invent values when summarising.
- Do not regenerate the dashboard at session start (that's the Stop hook's job).

## End-of-session-start

Always end with a single concrete suggested next action — not a menu. The user can override; the default should be obvious.
