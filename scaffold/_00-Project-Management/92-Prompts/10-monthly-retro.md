# Prompt 10 · Monthly Retrospective

**Trigger:** First Monday of the month.

**Hat:** Founder + PM (jointly)

---

## Paste this into Claude

```
You are operating as **Founder + PM hats jointly** for a solo retro.

Load these files into context:
- 42-Monitor/MONITOR.md (last 4 weeks of revision history)
- 14-Retros/RETRO-YYYY-MM.md (the previous month's retro — to check carry-forward)
- 00-Strategy/OKRS-YYYY-Qx.md (current quarter)
- 40-Decisions/ (any ADRs created this month)
- 34-Bugs/ (bugs filed this month)
- 91-Templates/RETRO.template.md
- 90-Standards/SOP.md

Task:
1. Create 14-Retros/RETRO-YYYY-MM.md using RETRO.template.md verbatim.
2. Compute metrics for the period:
   - Stories shipped
   - Bugs filed / fixed (delta)
   - ADRs created
   - Average story cycle time (`completed_at` - `started_at` across done stories)
   - Time stories spent in `blocked` (rough estimate)
3. Auto-draft each section based on what you observe in the data:
   - **What worked** — patterns in shipped stories. Smooth flow, good test coverage,
     clean ADRs, no surprises. Be specific.
   - **What hurt** — patterns in bugs, blocked stories, surprises, missed estimates,
     skipped gates. Be specific. Not "speed" — "I skipped DoR on STORY-01.2.04 to ship
     fast, and we lost 2 days to the missing testplan."
   - **Surprises** — discoveries you wouldn't have predicted at month-start.
   - **Action from last retro** — quote last month's "One change". Did it happen?
     Yes / partial / no — and why.
4. Propose 2-3 candidate "One change" actions for next month. Just propose — don't pick.
5. Compute strategic check:
   - Did this month's work ladder into the current OKRs? Yes / partial / no.
   - If drift detected — flag for the next quarterly review.

Output rules:
- DRAFT the retro file with sections populated. Show me before saving.
- I will edit "What worked / What hurt / Surprises" to my voice — those are subjective.
- The metrics, last-retro carry-forward, and strategic check are objective — Claude can write those.
- The "One change" — I pick. You propose 2-3 candidates, I commit to one.

Honour from CLAUDE.md:
- Frontmatter timestamps
- Status enum
- Templates rule (use RETRO.template.md)

End-of-retro:
- Save 14-Retros/RETRO-YYYY-MM.md.
- Update 42-Monitor/MONITOR.md with a one-line entry: "Retro for <month> filed; one change: <X>."
- Set retro frontmatter status=done, completed_at=now.
- Remind me: the "One change" is tracked in next month's retro under "Action from last retro".
```
