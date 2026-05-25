# Prompt 07 · Run Testplan (QA hat)

**Trigger:** Story flipped to `in-review`. Time to verify with the paired TESTPLAN.

**Hat:** QA

---

## Paste this into Claude

```
You are operating as **QA hat**.

Load these files into context:
- The testplan: <PATH TO TESTPLAN-NN.M.PP-*.md>
- Its paired story: <PATH TO STORY-NN.M.PP-*.md>
- 90-Standards/SOP.md
- 90-Standards/PROJECT-CONTEXT.md (test runner, ports, env vars)
- 91-Templates/BUG.template.md (you will use this if a TC fails)
- Project root CLAUDE.md

Task:
1. Flip the testplan's status: `not-started` → `in-progress`. Set `started_at` to now.
2. Verify all Preconditions in the testplan are met. If not, stop and report.
3. Run every TC in order:
   a. Execute the `Command:` exactly as written. No improvisation.
   b. Compare actual output to `Expected:`.
   c. Update the TC's `Result:` line:
      - `PASS — YYYY-MM-DD` on success.
      - `FAIL — see BUG-YYYYMMDD-NN` on failure (link the bug you'll file).
4. **If a TC fails — IMMEDIATELY:**
   a. STOP further TC execution if the failure is critical / blocks the rest.
   b. Otherwise continue to the next TC (you can complete the run, just file bugs).
   c. File a BUG at 34-Bugs/EPIC-NN/FEAT-NN.M/BUG-YYYYMMDD-NN-<slug>.md.
      Use BUG.template.md verbatim. Include full repro, first analysis, fix direction.
      A junior dev should be able to act on the bug without asking questions.
   d. Update the failed TC's `Result:` line to reference the bug.
5. After all TCs run, update the testplan's "Sign-off" section.
6. If ALL TCs PASS — flip testplan status to `done`. Set `completed_at` to now.
   Recommend prompt 08 (close-out-story) next.
7. If ANY TC FAILed — leave testplan as `in-progress`. Story stays `in-review`.
   The dev needs to fix the bugs and re-run the failed TCs.

Output rules:
- Run TCs serially, not in parallel — easier to attribute failures.
- For UI test commands: capture screenshot artifacts to 41-Reports/ if helpful.
- Trim log output in BUG evidence sections to ≤30 lines, key frames preserved.
- A bug filed in chat-only is a process violation — the BUG file must exist before
  you report the failure in your summary.

Honour from CLAUDE.md:
- Frontmatter timestamps
- Status enum
- Bug auto-raise on failure (MANDATORY)
- Templates rule

End-of-run summary:
- TCs PASSED: X / Y
- TCs FAILED: Y - X
- BUGs filed: <list of paths>
- Testplan status: <done | in-progress>
- Recommended next step:
  - All PASS → prompt 08 (close-out-story)
  - Any FAIL → assign bugs to dev hat; re-run testplan after fixes
```
