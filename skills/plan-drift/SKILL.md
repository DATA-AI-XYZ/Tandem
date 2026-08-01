---
name: plan-drift
description: Read-only bidirectional review of stories vs. their source requirements — every requirement item (PRD key requirements, epic In-scope bullets, feature ACs) traced to a covering story, and every story's ACs checked against the requirement it links to. Use when the user asks to check for plan drift, audit requirement coverage, find scope creep, run a plan-integrity pass, or before decomposing new work / closing a PRD-backed epic. Writes a dated advisory report; never edits a story, requirement, or status.
---

# Tandem: plan-drift (PM hat)

Operate as **PM hat**. This skill is `critique`'s cross-artefact complement: `critique` reviews one
artefact's internal quality, `pm:lint` checks the frontmatter contract, ADR-0068 reconciles epic↔story
*status* — none of them answer "is every requirement reflected in a story, and is every story still
faithful to the requirement it traces to?" This skill does, in one direction and then the other. It is
**read-only and advisory**: it never edits a story, requirement, PRD, or any `status:` field, and it
never gates a promotion. A human rules on every finding.

## Inputs needed

- **Scope** — one of:
  - Whole repo (default): every PRD under `20-Requirements/` (or equivalent), every Epic under
    `30-Epics/` (or equivalent), every Feature under `31-Features/` (or equivalent), every Story
    under `32-Stories/` (or equivalent) — see "Load into context" below for how folder names resolve
    on a customised layout.
  - A named Epic (e.g. "run plan-drift over EPIC-23") — restricts the requirement inventory to that
    Epic's `prd_section:` PRD, that Epic's own `## In scope` bullets, and the Features/Stories under
    it. Use this for a fast, focused pass; the whole-repo run is the thorough one.
- If the user gives neither, default to whole repo and say so in the report header.

## Load into context

Use `Read` / `Glob` to enumerate — treat a missing file as "not present," never as an error. Folder
names below are the kit defaults; on a customised/flattened layout, resolve them through the project's
layout map (`93-Scripts/lib/pm-paths.js` logical keys) first — same as `critique`'s "or equivalent"
paths and lane B's own `prompts`-dir resolution in this epic's W4 wiring. If a resolved requirement
folder comes back EMPTY after layout resolution, say so explicitly in the report's `## Scope` section
rather than silently reporting a clean pass over nothing — an empty requirement inventory is the worst
failure mode for a coverage tool, because it looks identical to "everything's covered."

- **Requirement sources** (in scope):
  - PRDs under `20-Requirements/**/*.md` (or equivalent) — plain markdown, no frontmatter (the
    validator doesn't scan this folder). Each numbered `## Key requirements` item (`R1`, `R2`, …) and
    each un-resolved `## Open questions` checkbox is one requirement item.
  - Epics under `30-Epics/EPIC-NN-*.md` (or equivalent) — each `## In scope` bullet is one requirement
    item; the `prd_section:` frontmatter line names the PRD it descends from (free text, not a path
    contract — read it as prose).
  - Features under `31-Features/EPIC-NN/FEAT-NN.M-*.md` (or equivalent) — each `## Acceptance
    criteria` bullet is one requirement item; `prd_refs:` frontmatter names the PRD/BACKLOG items it
    descends from.
- **Stories** under `32-Stories/EPIC-NN/FEAT-NN.M/STORY-NN.M.PP-*.md` (or equivalent) — each story's
  `## Acceptance criteria` bullets and its `## References` → `**PRD:**` line (free text: a PRD section
  id like "R7", a BACKLOG id, or "—").
- **Quality standards reference** — `90-Standards/SOP.md` (report/artefact conventions).
- **Project root `CLAUDE.md`** — project-specific overrides, if present.

## Task — bidirectional trace

### Step 1 — build the requirement inventory

List every requirement item in scope: PRD `Rn` key-requirements + unresolved PRD open-question
checkboxes, every Epic `## In scope` bullet, every Feature `## Acceptance criteria` bullet. Each item
gets a file + section pointer (e.g. `20-Requirements/CommandCenter/PRD-command-center-redesign.md ·
Key requirements · R12`).

### Step 2 — Tranche A: requirement → story coverage map

For each requirement item, trace forward through the **existing** linkage chain — no new frontmatter,
no new mandatory field:

`PRD Rn / Epic In-scope bullet` → named in an Epic's `prd_section:` prose or a Feature's `prd_refs:` →
Feature's `## Acceptance criteria` → Feature's `## Stories` list → each linked Story's `## References`
→ `**PRD:**` line (which should name the same `Rn`, the Epic bullet's theme, or the Feature AC it
implements).

A requirement item is **covered** if at least one Story's `**PRD:**` reference (or its Feature's own
ACs, when the Story doesn't re-cite the PRD directly) names it, directly or in substance. A requirement
item is a **coverage gap** if no Story in scope traces to it by name or substance — report it with the
file + section pointer, even if the requirement is *de facto* satisfied by convention elsewhere (e.g. a
cross-cutting technical constraint every story happens to honour but that no story's `**PRD:**` line
actually cites — flag this too; the point is traceability, not just accidental compliance).

Also check: does every Feature's `## Acceptance criteria` bullet have at least one covering Story? Does
every Epic's `## In scope` bullet have at least one covering Feature? Walk both linkage hops.

### Step 3 — Tranche B: story → requirement fidelity check

For each Story whose `**PRD:**` reference resolves to a requirement item, compare the Story's `##
Acceptance criteria` against that requirement's text (the PRD `Rn` clause, the Epic bullet, or the
Feature AC). Flag:

- **Scope-add** — an AC in the Story that goes beyond anything the linked requirement asked for.
- **Scope-drop** — a clause in the linked requirement that no Story AC (or Technical-notes gotcha)
  addresses.
- **Reinterpretation** — the Story's AC covers the requirement's topic but changes its meaning.
- **Stale source** — the requirement document itself has fallen behind a decision already shipped
  downstream: e.g. a PRD `## Open questions` checkbox left unchecked though a linked Story's `decisions:`
  frontmatter (or its `## References` → `**Related ADRs:**` line) shows an ADR already resolved it. This
  is drift in the requirement, not the story — name both the stale PRD line and the resolving ADR/story.

Every finding here is **advisory only** — drift is sometimes a deliberate, good call mid-execution. State
the divergence and let a human rule on it; never mark it as an error or a gate failure.

### Step 4 — compile the report

Write `41-Reports/PLAN-DRIFT-<YYYY-MM-DD>.md` (today's date) — this exact filename pattern is the pinned
contract (TESTPLAN-24.1.01 TC-01 greps for it; the inaugural run, 2026-08-01, fixed it). If a report for
today already exists from an earlier run this session, overwrite it — one report per calendar day, not
one per invocation or per scope. **Known limitation:** because the filename carries no scope marker, a
same-day re-run with a *different* scope (e.g. a whole-repo pass after an earlier Epic-scoped pass)
overwrites the earlier findings rather than merging with them. State the chosen scope prominently in the
report's own `## Scope` section so a reader always knows what the current file does and doesn't cover; if
same-day multi-scope runs become common, revisit the filename contract via ADR rather than silently
changing it (it's load-bearing for TC-01).

## Report format

```markdown
---
title: Plan-drift review — <scope: "whole repo" | "EPIC-NN">
type: report
generated_at: <ISO 8601 now>
---

# PLAN-DRIFT-<YYYY-MM-DD> · <scope>

## Scope
<what was walked: which PRDs, epics, features, stories — and what was explicitly out of scope, e.g.
status reconciliation (ADR-0068's job, not this skill's)>

## Summary
- Requirement items inventoried: N
- Coverage gaps (Tranche A): G
- Fidelity / drift findings (Tranche B): D

## Coverage gaps — no covering story
<one entry per gap>
**<requirement id>** — `<file>` · <section>
<one-line description of the requirement>
No Story in scope traces to this by name or substance. <Suggested next step — e.g. "split into a
story" or "confirm covered by convention and add an explicit PRD reference".>

_(or: "No coverage gaps found." if none.)_

## Fidelity / drift findings — story vs. source requirement
<one entry per finding>
**<STORY-NN.M.PP>** — `<story file path>`
Diverges from: `<requirement file>` · <section/clause>
<one-line description of the divergence — scope-add / scope-drop / reinterpretation / stale source>
<advisory note — never phrased as a required fix>

_(or: "No fidelity findings — every traced story matches its source requirement." if none.)_

## Recommended next step
- If coverage gaps exist → PM hat decides: split a story, or confirm the gap is intentionally deferred
  and note why.
- If drift findings exist → human review; update the story, update the source requirement doc, or
  accept the drift as a deliberate call and say so in the story's Risks section.
- If both are clean → say so plainly; this skill is not obligated to find problems.
```

## Output rules

- **Read-only.** This skill never edits a Story, Feature, Epic, PRD, or BACKLOG file, and never touches
  any `status:` field. The only file it writes is the dated report under `41-Reports/`.
- **No new mandatory fields.** Tracing runs entirely off frontmatter and sections that already exist in
  the kit's templates (`prd_section:`, `prd_refs:`, `## References` → `**PRD:**`, `## In scope`, `##
  Acceptance criteria`). If tracing genuinely can't resolve because the existing linkage is missing on a
  specific artefact, report that artefact as "linkage insufficient" in the coverage-gaps section — do
  **not** add a field to fix it. If linkage proves structurally insufficient across many artefacts (not
  just one gap), propose the minimal addition via an ADR in the same response, and say so in the report;
  do not silently add it.
- **Advisory only.** Every finding is a prompt for human judgement, not an error. Deliberate scope
  changes are a legitimate outcome of execution — the review surfaces drift, it does not adjudicate it.
- **No promotion.** This skill does not flip any `status:`. `refine-backlog` and the DoR/DoD gates keep
  that job.
- **Every requirement item accounted for** — no silent omissions. If an item can't be evaluated (e.g. a
  Feature has no Stories yet because it's `not-started`), say so explicitly rather than dropping it.

## Non-negotiable rules from CLAUDE.md

- Read-only skill: never writes to any file except the dated `41-Reports/PLAN-DRIFT-*.md` report.
- Status enum: never touches `status:` in any file.
- All requirement items accounted for: no check is skipped silently.
