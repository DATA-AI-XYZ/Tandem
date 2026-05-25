---
type: epic
id: EPIC-NN
title: <human-readable epic title>
status: not-started
created_at: ''
started_at: ''
completed_at: ''
estimate: <S | M | L | XL — or weeks>
priority: P0 | P1 | P2 | P3
okr: OKR-YYYY-Qx-N           # mandatory if no PRD
prd_section: §x.y            # alternative to okr
mockup_refs:                 # optional, list paths or Figma URLs
html_artefacts: []           # optional, repo-relative paths to sibling HTML artefacts (PRDs, audits, exploratory HTML). Validator R15.
decisions: []
---

# EPIC-NN · <title>

## Goal
<2–4 sentences. The user-visible outcome. Plain English.>

## Diagram
<!-- Optional. Delete this section if no diagram adds value. Reach for one when topology,
     a multi-step flow, or a state machine would be clearer than prose. Markdown → Mermaid
     (per ADR-0005); see 91-Templates/DIAGRAM-CHEATSHEET.md for worked examples. -->

```mermaid
flowchart LR
    A[Replace with the epic's flow / topology] --> B[next]
```

## Strategic linkage
- **OKR:** <link or text — which Objective and Key Result this moves>
- **Why now:** <why this quarter, not next>
- **Business outcome:** <metric this should move and by how much>

## In scope
- <bullet>
- <bullet>

## Out of scope
- <bullet — explicit deferrals>
- <bullet>

## Success criteria
- <measurable bullet — a number, a state, or a binary outcome>
- <measurable bullet>

## Features
- [FEAT-NN.M — <title>](../31-Features/EPIC-NN/FEAT-NN.M-<slug>.md)

## Dependencies
- **Other epics:** <or "none">
- **Infrastructure:** <or "none">
- **External:** <vendors, approvals, data — or "none">

## Data touched
- **Reads:** <collections / tables / services>
- **Writes:** <collections / tables / services>
- **New schema:** <or "none">

## Risks
- **<risk>** — mitigation: <one line>
- **<risk>** — mitigation: <one line>

## Decisions
<populated as ADRs are created during execution>
<!-- - [ADR-NNNN — <title>](../40-Decisions/ADR-NNNN-<slug>.md) -->
