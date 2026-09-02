---
type: retro
id: RETRO-YYYY-MM
title: Retrospective — <month> <year>
status: not-started
created_at: ''
started_at: ''
completed_at: ''
period_start: YYYY-MM-01
period_end: YYYY-MM-DD
---

# RETRO-YYYY-MM · <month> <year>

## Summary
<2–4 sentences of plain past-tense prose saying what this period was about. Objective register — the
same register as Metrics, not the operator's subjective voice; "What worked / What hurt / Surprises"
are where opinion belongs. Auto-drafted by `monthly-retro` from the in-window data, then edited.

**The first sentence must stand alone as the whole gist**, because that is what the Cadence → Retros
card shows when the card is expanded (it clamps at ~220 characters). Naming epics, stories and ADRs
is expected here — this is an internal record, not a founder-facing surface, so the `write-outcomes`
voice deliberately does NOT apply (ADR-0146).>

<one paragraph>

## Period
- From: YYYY-MM-DD
- To: YYYY-MM-DD

## What shipped
<what actually shipped in the window, by id and name — not how many. **Derived on every run** from
the same in-window query that feeds Metrics, never hand-maintained and never carried forward from
the previous retro (ADR-0146; `monthly-retro` auto-drafts it).

An empty period is valid output and must say so in as many words — "Nothing shipped in this period."
— rather than leaving this section blank, which reads as an omission.>

- <ID — title>
- <ID — title>

## Metrics

| Metric | This period | Last period | Δ |
|---|---|---|---|
| Stories shipped | _<count>_ | _<count>_ | _<±>_ |
| Bugs filed | _<count>_ | _<count>_ | _<±>_ |
| Bugs fixed | _<count>_ | _<count>_ | _<±>_ |
| ADRs created | _<count>_ | _<count>_ | _<±>_ |
| Rework rate (stories needing a second pass) | _<count / %>_ | _<count / %>_ | _<±>_ |
| First-pass close rate (done with no failed TC) | _<%>_ | _<%>_ | _<±>_ |
| Bugs per shipped story | _<ratio>_ | _<ratio>_ | _<±>_ |

> **Cycle time and time-in-`blocked` were retired from this table on 2026-08-01 (ADR-0107).**
> Under orchestrated execution `started_at` and `completed_at` are stamped minutes apart by the
> same run, so their difference measured an agent's execution window, not lead time — and `status:`
> carries no history, so time-in-`blocked` was never measurable at all. The three rows above are
> **difficulty** signals rather than clock signals: they are structurally immune to orchestration
> compressing the clock. Do not reinstate a duration row sourced from frontmatter timestamps.

## What worked
<what to keep doing. Be specific — not "communication", but "the Friday 30-min refinement caught 3 stories that would have been pulled with missing dependencies".>

- <bullet>
- <bullet>
- <bullet>

## What hurt
<what to stop or change. Be specific — not "speed", but "I shipped 4 stories without ADRs and now can't reconstruct two decisions".>

- <bullet>
- <bullet>
- <bullet>

## Surprises
<things that happened you didn't predict. Discoveries about users, stack, self. These often turn into ADRs or strategy updates.>

- <bullet>
- <bullet>

## Action from last retro — did it happen?
<carry-forward the One Change from `RETRO-<previous>.md`. Did it work? Yes / partially / no — and why.>

- **Last retro's change:** <…>
- **Outcome:** <…>

## One change for next period
<a single, concrete, owned action. Not a list. Not a hope. One thing.>

> Example: "Run `npm run pm:lint` as a Husky pre-commit hook by week 2 of next month."

- **The change:** <…>
- **Owner:** <hat — Founder / PM / Dev / QA>
- **Done when:** <observable condition>
- **Review:** in next month's retro

## Strategic check
<does the work this period still ladder into the current OKRs? If not, raise to Founder hat next session.>

- **Drift detected?** Yes | No
- **If yes — what's drifting:** <…>
