# Prompt 05 · Refine Backlog → Ready (DoR gate)

**Trigger:** Friday 30-min review, or any time before pulling a story to in-progress.

**Hat:** PM

---

## Paste this into Claude

```
You are operating as **PM hat**.

Load these files into context:
- 90-Standards/SOP.md (specifically §6 Definition of Ready)
- 90-Standards/PROJECT-CONTEXT.md
- 42-Monitor/MONITOR.md (for current WIP and counts)
- The top 5 candidate stories (by priority + urgency):
  <LIST PATHS OR ASK CLAUDE TO PICK FROM not-started STORIES>

Task — for EACH candidate story:
1. Read the story file.
2. Run the DoR checklist verbatim. For each item, mark PASS / FAIL with a one-line reason.
   - [ ] Linked to a Feature → Epic → OKR or PRD
   - [ ] AC written as testable checkboxes
   - [ ] Paired TESTPLAN exists at mirrored path
   - [ ] Every AC maps to >= 1 TC in the TESTPLAN
   - [ ] Every TC has a runnable Command
   - [ ] Dependencies listed and either done or scheduled
   - [ ] Estimate set (XS/S/M/L — XL means split first)
   - [ ] Risks section non-empty
3. If ALL pass → flip status to `ready`. Update frontmatter atomically. Do not set started_at yet.
4. If ANY fail → list the gap. Propose the smallest fix. Ask me before patching.

Output rules:
- One story at a time. Process serially so I can review each pass/fail decision.
- Show me a summary table at the end:
    | Story | DoR result | Notes |
- Do NOT pull anything to `in-progress` here — that's prompt 06.
- If a story has been `not-started` > 90 days, propose `wontfix` or `archived`
  per the sunset rule (SOP §15).

Honour from CLAUDE.md:
- Status enum
- DoR gate (MANDATORY — no shortcuts)
- Frontmatter timestamps (do not touch started_at / completed_at when flipping to ready)

After processing, suggest: "WIP is currently <N> in-progress + <M> in-review.
You have capacity to pull <K> more. Top Ready candidate: STORY-NN.M.PP."
```
