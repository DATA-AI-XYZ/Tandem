# Prompt 08 · Close-out Story (DoD gate)

**Trigger:** Testplan is `done` (all TCs PASS). Time to gate the story through DoD.

**Hat:** QA → handing back to PM for MONITOR update

---

## Paste this into Claude

```
You are operating as **QA hat** transitioning to **PM hat** for the MONITOR update.

Load these files into context:
- The story: <PATH TO STORY-NN.M.PP-*.md>
- Its testplan: <PATH TO TESTPLAN-NN.M.PP-*.md>
- 90-Standards/SOP.md (§7 Definition of Done)
- 90-Standards/PROJECT-CONTEXT.md (quality gate commands)
- 42-Monitor/MONITOR.md (for update)
- 12-Active/ACTIVE.md (to remove this story from WIP)
- Project root CLAUDE.md

Task — run the DoD checklist verbatim. For each item, mark PASS / FAIL with evidence.

DoD checklist:
1. [ ] All AC checkboxes in the story file are ticked.
2. [ ] All TCs in the testplan have `Result: PASS — YYYY-MM-DD` (or FAIL linked to a `wontfix`/accepted BUG).
3. [ ] Project quality commands pass (from PROJECT-CONTEXT.md):
   - [ ] Lint
   - [ ] Type check
   - [ ] Unit tests
   - [ ] Build
4. [ ] No new errors in the error tracker after smoke run (if applicable).
5. [ ] If UI: visual contract tests green (per PROJECT-CONTEXT.md).
6. [ ] All ADRs created during execution are present in 40-Decisions/ and linked from
      the story's `decisions:` array.
7. [ ] Any tech debt observed during this work has a corresponding BACKLOG-NNNN file.

If ANY item FAILs:
- STOP. Do not flip status to `done`.
- List the gap clearly in chat.
- For each gap, propose the smallest fix to address it.
- Ask me before continuing.

If ALL items PASS:
- Flip story status `in-review` → `done`. Set `completed_at` to now (ISO 8601 + offset).
  Atomic edit — status + timestamp in the same write.
- Remove the story from 12-Active/ACTIVE.md.
- Update 42-Monitor/MONITOR.md in the SAME response:
  - Increment the shipped count (and any per-epic/per-feature counts).
  - Tick the bar character (░ → █) if your MONITOR uses progress bars.
  - Prepend a one-line entry to the revision history with today's ISO date and the
    story ID + short outcome.
- Regenerate the interactive dashboard:
  - Run `npm run pm:dash` (or `npm run pm:all` to lint + dash together).
  - Confirm `42-Monitor/DASHBOARD.html` is updated.

Output rules:
- DoD is non-negotiable. "Tests are flaky so I'll skip" is not allowed — file a BUG
  or BACKLOG entry instead, and don't close the story until that's addressed.
- Show the DoD result table BEFORE flipping status, so I can override if needed.
- If a TC failed earlier but the bug was accepted as `wontfix` or pushed to BACKLOG,
  link the decision explicitly in the close-out note on MONITOR.

Honour from CLAUDE.md:
- Frontmatter timestamps (completed_at set in the SAME edit as status=done)
- Status enum
- DoD gate (MANDATORY)
- Monitor on completion (MANDATORY — same response)
- Dashboard regen (MANDATORY — `npm run pm:dash` after status flip)

End-of-close-out summary:
- DoD result: PASS / FAIL with gaps
- Story status now: <done | still in-review>
- MONITOR updated: yes / no
- Decisions captured: <list of ADRs>
- Tech debt captured: <list of BACKLOG entries>
- Next Ready story to pull: <suggestion>
```
