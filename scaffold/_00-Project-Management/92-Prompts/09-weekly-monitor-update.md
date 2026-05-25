# Prompt 09 · Weekly MONITOR update

**Trigger:** Friday 30-min review.

**Hat:** PM

---

## Paste this into Claude

```
You are operating as **PM hat**.

Load these files into context:
- 42-Monitor/MONITOR.md (current state)
- 12-Active/ACTIVE.md
- Last 7 days of activity:
  - Run a quick scan: which files under 30-Epics/, 31-Features/, 32-Stories/, 34-Bugs/
    have `completed_at` within the last 7 days? Which `started_at` within 7 days?
- 14-Retros/ (most recent retro's "One change" — did it happen this week?)
- 90-Standards/SOP.md

Task:
1. Compute the weekly delta:
   - Stories shipped (status went to `done` in the last 7 days)
   - Stories started (status went to `in-progress` in the last 7 days)
   - Stories blocked (currently in `blocked` status)
   - Bugs filed
   - Bugs fixed
   - ADRs created
2. Update 42-Monitor/MONITOR.md:
   - Per-epic and per-feature counts (shipped / total).
   - Progress bars (if used).
   - "Last updated" date.
   - Prepend a revision history entry dated today, summarising the week in 3-5 lines.
3. Audit currents:
   - Any story in `in-progress` for > 5 days? Flag as a stall risk.
   - Any story in `blocked` for > 5 days? Escalate — Founder hat decision needed?
   - Any story in `in-review` for > 3 days? Push to close-out (prompt 08).
4. Backlog hygiene:
   - Anything in `not-started` for > 90 days? Propose `wontfix` or `archived` (SOP §15).
   - Inbox count? If > 20, propose a quick triage pass.
5. Regenerate the interactive dashboard:
   - Run `npm run pm:all` (validator + dashboard together).
   - Confirm `42-Monitor/DASHBOARD.html` reflects the week's changes.
   - If validator fails, fix the violations BEFORE the dashboard run.
6. CLAUDE.md coverage audit:
   - Run `npm run pm:claude-audit -- --report _00-Project-Management/41-Reports/CLAUDE-AUDIT-$(date +%Y-%m-%d).md`.
   - Triage the report:
     - **gap** or **undecided** boundaries — decide include vs exclude, then run
       `npm run pm:claude-scaffold` to address.
     - **incomplete** stubs (still carry `[auto — verify]` / `<fill in>`) — queue
       the `fill-claude-md` skill.
   - The audit is report-only; it never blocks. Note any new boundaries in the
     week summary.

Output rules:
- Single revision-history entry per week, prepended to MONITOR.
- Format: `**YYYY-MM-DD — week summary.** <3-5 lines>.`
- Be specific: not "shipped some stories", but "shipped STORY-01.2.07 + STORY-01.3.01,
  closing FEAT-01.2 except for the sortable-headers AC".
- Flag carry-forwards: "carrying STORY-02.1.04 into next week — blocked on ADR-0012."

Honour from CLAUDE.md:
- Frontmatter timestamps (do not modify any file's timestamps as part of this — only MONITOR)
- Status enum (use the canonical statuses in your summary, not synonyms)
- Dashboard regen (MANDATORY at end of weekly update)

End-of-update summary:
- Shipped this week: N
- Stalled: <list of stories in-progress > 5 days>
- Blocked: <list with reasons>
- Carry-forward to next week: <list>
- Suggestion for Founder hat: <if any strategic drift detected>
```
