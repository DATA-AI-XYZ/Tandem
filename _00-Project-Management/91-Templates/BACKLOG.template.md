---
type: backlog
id: BACKLOG-NNNN
title: <short descriptive title>
status: not-started
created_at: ''
started_at: ''
completed_at: ''
estimate: XS | S | M | L
usage_estimate: ''    # optional: approximate TOTAL tokens (input+output+cache_read+cache_creation
                       # summed) expected once this item becomes a story. Single positive integer,
                       # not a coarse band — so per-batch projections can sum it. Validator R23
                       # enforces SHAPE only (same stance as R19): if present and non-empty it must
                       # parse as a positive integer; feasibility is never judged. Absent/empty is
                       # fine. Consumed by `93-Scripts/usage-reconcile.js`. See ADR-0079 / STORY-21.2.02.
priority: P0 | P1 | P2 | P3
type_of_work: frontend | backend | infra | data | docs | tech-debt
captured_from: <story / bug / exploration / review — context that surfaced this>
related: []
# rice_score: <int>   # OPTIONAL. RICE = reach × impact × confidence ÷ effort, rounded.
                       # Bare integer, no quotes. Omit until you actually rank with it.
                       # Written/updated by the interactive board (93-Scripts/generate-backlog-board.js,
                       # STORY-01.1.06) via its "Export → markdown patch" button. Not required by pm:lint.
---

# BACKLOG-NNNN · <title>

## Why this exists
<2–3 sentences. The pain or opportunity. What surfaced this. Today's behaviour vs the better behaviour.>

## Why backlog (not blocker)
<why this isn't a P0 right now. Workaround in place? Stable as-is? Risk acceptable?>

## Work tranches
<break larger backlog items into stages. Each tranche can become a story when promoted.>

### Tranche A — <name> (estimate: <S|M|L>)
- [ ] <bullet>
- [ ] <bullet>

### Tranche B — <name> (estimate: <S|M|L>)
- [ ] <bullet>

## Acceptance — when this can be marked done
- <bullet — what "fixed" looks like>
- <bullet>

## Promotion criteria
<what would cause this to be pulled into a real story?>

- <e.g. "when we hit 100 active users", or "before public launch", or "next time someone touches this file">

## Related
- <stories / bugs / ADRs>
