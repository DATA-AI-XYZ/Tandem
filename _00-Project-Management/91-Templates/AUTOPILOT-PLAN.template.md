---
type: autopilot-plan
id: AUTOPILOT-PLAN-<run_id>
run_id: <run_id>
title: Run plan — <run_id>
status: not-started
created_at: ''
started_at: ''
completed_at: ''
authorised_by: ''
stop_condition: ''
usage_budget: ''
scope_chats:
  - <CHAT-ID>
scope_stories:
  - <STORY-ID>
tier_plan:
  - <STORY-ID>=<low|high>
---

# Run plan — `<run_id>`

> Written **before the first dispatch**, never during and never after (STORY-26.4.01 AC-2). If this
> file could not be written, the run did not start — this is the one place in EPIC-26 where failing
> to write **is** blocking, because an unapproved unattended run is the risk the feature exists to
> control. Reflection capture never blocks; authorisation always does.

## Run identity

- **`run_id`:** `<run_id>` — the single join key. The checkpoint's `run_id`, the retro ledger's
  `run`-level record `id`, and this file's `run_id` frontmatter field are the SAME string, so the
  three surfaces are joinable without a lookup table (STORY-26.4.01 AC-4).
- **Authorised by:** `<operator, how the authorisation was given>`
- **Approval line:** appended to `10-Inbox/APPROVALS.md`, referencing this file by its repo-relative
  path (AC-3).

## Scope

**The scope lists in frontmatter are the machine-readable contract.** `scope_stories` and
`scope_chats` are what the plan-vs-actual comparison (STORY-26.4.04) subtracts the ledger's executed
set from; prose here is commentary on them, never a substitute. A story that is not in
`scope_stories` is out of scope, whatever this section says.

- **Chats:** see `scope_chats`.
- **Stories:** see `scope_stories`.
- **Rationale / ordering:** `<why this order; which strategies the scope came from>`

## Stop condition

`<one of: max-phases: N | max-duration: <duration> | stop-at-end-of-EPIC-NN>`

A run with no stop condition never starts. Restated in the `stop_condition` frontmatter field so the
comparison can read it without parsing prose.

## Model tier plan

**The tier plan in frontmatter is the machine-readable contract.** Each `tier_plan` entry is
`<STORY-ID>=<low|high>`; the comparison reports every story whose ledger-recorded tier diverges from
the tier declared here (STORY-26.4.04 AC-4).

- **Default tier:** `<low|high>`
- **Escalation rule:** `<what always routes to the high tier regardless of size>`
- **Review tier:** `<who reviews — never skipped, per the autopilot model-tiering contract>`

## Usage budget

- **Budget:** `<the run's usage budget, and the units it is expressed in>` (also in the
  `usage_budget` frontmatter field)
- **Governor threshold:** `<percent, default 92>`
- **Degraded-signal stance:** `<what happens when the live usage signal is unavailable>`

## Constraints

- `<anything the run must not do — no tag, no push, no edits outside scope, …>`

## What this plan is measured against

After the run, `93-Scripts/plan-vs-actual.js` joins this plan to the retro ledger on `run_id` and
reports: stories **planned and not executed**, estimate-vs-actual per story and in aggregate, and
tier divergences. That comparison is what makes this document falsifiable rather than decorative —
if nothing ever reads the plan, writing it is theatre.
