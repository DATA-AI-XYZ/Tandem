---
type: inbox-action
needs_action: true
action_status: open        # open | answered | archived
created_at: ''             # ISO 8601 with offset, e.g. 2026-06-06T15:00:00+01:00
answered_at: ''            # set when the founder writes the Answer
target_artefact: ''        # the path/id this decision unblocks (e.g. STORY-15.1.03)
recommendation: ''         # one-line suggested answer (mirrors the Recommendation body)
---

<!--
  Founder-action inbox item (ADR-0063). A clear decision the founder needs to make.
  Lives in 10-Inbox/ while open; the Now-page "Pending action" widget renders the
  Question as the title and surfaces the Recommendation.

  Lifecycle (answer → update → close → archive), per ADR-0063:
    1. open      — needs_action: true; surfaces in the widget.
    2. answered  — write the founder's answer into ## Answer; set answered_at.
    3. archived  — in ONE atomic step: flip needs_action: false, action_status: archived,
                   and MOVE this file to 10-Inbox/archive/. It then drops off the live
                   view but stays readable as a durable founder-decision trail.
  Keep the four sections below, in this order.
-->

## Question
<One clear sentence — the decision to be made.>

## Why this matters
<The reasons / what it blocks / the trade-off. Keep it short.>

## Recommendation
<Claude's suggested answer + rationale. Mirror the one-liner into the `recommendation:` frontmatter.>

## Answer
<Empty until the founder responds. Write the decision here, then set answered_at, flip to archived, and move to 10-Inbox/archive/.>
