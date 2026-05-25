# Prompt 06 · Execute Story (Dev hat)

**Trigger:** Daily check-in. A Ready story is being pulled into active work.

**Hat:** Dev

---

## Paste this into Claude

```
You are operating as **Dev hat**.

Load these files into context:
- The story: <PATH TO STORY-NN.M.PP-*.md>
- Its paired testplan: <PATH TO TESTPLAN-NN.M.PP-*.md>
- Its feature and epic (for context)
- 90-Standards/SOP.md (§7 DoD checklist)
- 90-Standards/PROJECT-CONTEXT.md (stack, lint commands, port conventions)
- 91-Templates/ADR.template.md (in case a decision needs recording)
- 91-Templates/BUG.template.md (in case a defect is observed)
- Project root CLAUDE.md

Task:
0. **Launch location check (before anything else).** If the story's `files_touched:` all live under one path X, consider launching Claude in `<repo-root>/X/` so its subdir CLAUDE.md (from SUBDIR-CLAUDE.template.md) sets test/lint scope. Skip for cross-cutting work (refactors, dependency bumps, codebase-map-spanning changes). See DAILY-WORKFLOW.md §5 + CLAUDE-CODE-CONFIG.md §2.1.5.
1. **Verify the DoR is satisfied.** If not — STOP, list the gap, ask. Don't proceed.
2. Flip story status: `ready` → `in-progress`. Set `started_at` to now (ISO 8601 + offset).
   Atomic edit. Update `12-Active/ACTIVE.md` index to include this story.
3. Implement the story:
   - Work the acceptance criteria one at a time.
   - For each AC, write the code AND wire the corresponding TC's setup.
   - Tests should run via the commands documented in the TESTPLAN.
4. **Whenever you make a non-obvious decision** (library choice, threshold, schema field name,
   deferred sub-feature), STOP coding and:
   a. Find the next free ADR-NNNN.
   b. Create 40-Decisions/ADR-NNNN-<slug>.md using ADR.template.md.
   c. Add the ADR ID to the story's `decisions:` frontmatter array.
   d. Resume coding.
5. **Whenever you observe a defect** (yours or pre-existing), STOP and:
   a. File a BUG at 34-Bugs/EPIC-NN/FEAT-NN.M/BUG-YYYYMMDD-NN-<slug>.md.
   b. Decide: fix-now (block this story) or fix-later (link from BACKLOG).
6. When all ACs implemented and self-review done, flip status to `in-review`.
   Do NOT set completed_at yet (that's the DoD gate via prompt 08).

Output rules:
- Tick AC checkboxes in the story file as you complete them.
- Update TC `Result:` lines in the TESTPLAN as you run them.
- Commit messages reference the story ID: "STORY-NN.M.PP — <imperative>".
- If you hit a `blocked` situation, flip to `blocked`, note the reason, return to me.

Honour from CLAUDE.md:
- Frontmatter timestamps (started_at on in-progress; NOT completed_at yet)
- Status enum
- ADR on the spot (MANDATORY for non-obvious decisions)
- Bug auto-raise (MANDATORY for any defect)
- Templates rule

End-of-session summary:
- ACs ticked: X / Y
- TCs run: X / Y (PASS / FAIL counts)
- ADRs created: <list>
- BUGs filed: <list>
- Status now: <in-progress / in-review / blocked>
- Next step: <prompt 07 if in-review, fix block if blocked>
```
