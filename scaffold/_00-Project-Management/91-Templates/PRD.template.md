# PRD-<slug> · <human-readable title>

**Status:** draft | reviewed | approved | superseded
**Date:** YYYY-MM-DD
**Author:** <name / hat>
**Owner:** <name / hat>
**Source:** <which OKR KR, North Star section, or BACKLOG entry triggered this>
**Related Epic(s):** <EPIC-NN if known, else "TBD via /Tandem:draft-epic">

> PRDs in this kit are **lightweight, markdown-only documents**. They have no frontmatter (the validator doesn't scan `20-Requirements/`) and no closed-set status enum — they sit upstream of the Epic/Feature/Story graph and feed it. A PRD describes the problem and the desired end state; the Epic encodes the work commitment.
>
> The 8 H2 sections below are mandatory. Add appendices below as needed; do **not** remove or rename the 8 mandatory headings, since downstream skills and the `draft-prd` testplan grep for them by exact string.

---

## Problem
<What's broken, missing, or painful today. 2–5 sentences. Plain English — describe the user's lived experience, not the technical symptom. If you can't write this without naming a solution, you don't understand the problem yet.>

## Audience
<Who hits this problem. Be specific: roles, contexts, frequency. "Everyone" is not an audience.>

- **Primary:** <role + context — the user this PRD optimises for>
- **Secondary:** <other roles affected, with one line on how>
- **Out of audience:** <roles explicitly NOT in scope, and why>

## Goals
<The user-visible outcomes this PRD commits to delivering. 3–5 bullets. Each phrased as a state the world is in once shipped, not a feature to build.>

- <goal — measurable or directly observable end-state>
- <goal>
- <goal>

## Non-goals
<Explicit deferrals. The "we're NOT solving X" list is how mid-spec creep is resisted. 3–5 bullets minimum.>

- <non-goal — something stakeholders might assume is in scope but isn't>
- <non-goal>
- <non-goal>

## Success metrics
<How we'll know this PRD succeeded after shipping. Quantitative where possible; binary state otherwise. Tie back to the source OKR KR if applicable.>

- **<metric>** — current: <baseline>, target: <number + deadline>
- **<metric>** — current: <baseline>, target: <number + deadline>
- **<qualitative check>** — binary state observable by <date>

## Key requirements
<The "what must be true" list. Not implementation. Each requirement should be testable. Number them so downstream Epics + Stories can reference them.>

1. **R1 — <requirement>** — <one sentence on what it means in practice>
2. **R2 — <requirement>** — <one sentence>
3. **R3 — <requirement>** — <one sentence>
4. **R4 — <requirement>** — <one sentence>

## Constraints
<Hard limits the solution must respect. Technical (stack, infra), business (cost, timeline, regulatory), and operational (team capacity, dependencies). Be explicit — assumed constraints rot fast.>

- **Technical:** <stack / infra / compatibility limits>
- **Business:** <timeline, budget, regulatory>
- **Operational:** <team size, dependencies, on-call capacity>

## Open questions
<Things we don't know yet but need to answer before (or during) Epic drafting. Better to list these honestly than fake certainty.>

- [ ] <question — who needs to answer / how>
- [ ] <question>
- [ ] <question>

---

## Appendices (optional)

Use appendices for material that supports the 8 mandatory sections but doesn't belong inside them — e.g. user research summaries, competitor scans, glossaries, frontmatter contracts for any new artefact types introduced.
