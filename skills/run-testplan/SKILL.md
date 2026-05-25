---
description: Run every test case in a TESTPLAN. Use when the user asks to run a testplan, execute tests, verify a story, or work with a testplan file under _00-Project-Management/33-Testplans/. Runs each TC's Command verbatim, marks PASS/FAIL, and auto-files BUG-YYYYMMDD-NN files for every failure before reporting in chat.
---

# Tandem: run-testplan (QA hat)

Operate as **QA hat**. A story has flipped to `in-review` and its paired testplan needs verification.

## Inputs needed

- Testplan file path — try canonical (`_00-Project-Management/33-Testplans/EPIC-NN/FEAT-NN.M/TESTPLAN-NN.M.PP-*.md`) then flattened (`_00-Project-Management/05-Test/EPIC-NN/FEAT-NN.M/TESTPLAN-NN.M.PP-*.md`).
- If the user didn't supply it, infer from a recently-completed story or ask.

## Load into context

The canonical layout is the scaffold under `_00-Project-Management/` (32-Stories, 33-Testplans, 34-Bugs, 90-Standards, 91-Templates). Older / flattened repos may use alternate names — accept any of the below as a match. If NONE of the candidates exist for a given role, note it in the output (don't fabricate scaffolding) and degrade gracefully.

- **Testplan file** — at the resolved path from "Inputs needed".
- **Paired story** — under `_00-Project-Management/32-Stories/...` (canonical) OR `_00-Project-Management/03-Stories/...` (flattened).
- **SOP / DoD reference** — `_00-Project-Management/90-Standards/SOP.md` if present. If absent, fall back to project-root `CLAUDE.md`.
- **Stack quirks** — `_00-Project-Management/90-Standards/PROJECT-CONTEXT.md` if present. If absent, infer from `package.json` + project-root `CLAUDE.md`.
- **BUG template** — `_00-Project-Management/91-Templates/BUG.template.md` if present. If absent, redraft from a sibling BUG in the same FEAT folder.
- **BUGs folder** (for filing new ones) — `_00-Project-Management/34-Bugs/` (canonical) OR `_00-Project-Management/04-Bug/` (flattened).
- **Project root `CLAUDE.md`** — always loaded.
- **Prior HTML context (`html_context:`)** — if the testplan (or its paired story) frontmatter carries a non-empty `html_context:` array, `Read` every repo-relative path it lists (explorations, annotated diffs, options-comparisons) into context **before** executing the test cases, so test interpretation is grounded in the same architectural reasoning the human reviewer had. Skip entries that don't resolve (validator R16 already flags missing/traversal paths at `pm:lint` — don't double-report, just note the skip). Treat the SOP §11 50 KB guideline as advisory: summarise very large files rather than reading them whole.

Use `Read` / `Glob` to detect existence rather than assuming; treat missing files as "not present" rather than throwing.

## Task

1. **Flip the testplan's status:** `not-started` → `in-progress`. Set `started_at` to now. (Testplans don't use `in-review` — that's the story's status. If you find the testplan already at `in-review` from a prior skill misuse, flip it back to `in-progress` for this run, then on to `done` if all PASS.)

2. **Verify all Preconditions** in the testplan are met. If not, STOP and report.

   **Ingest prior HTML context first.** If the testplan (or its paired story) carries a non-empty `html_context:`, `Read` every listed prior HTML artefact into context now — before any TC runs (see "Load into context" above) — so the expected behaviour is interpreted against the same architectural reasoning the human reviewer had.

3. **Run every TC in order:**
   - Execute the `Command:` exactly as written. **No improvisation.** No "I'll try a slightly different command."
   - Compare actual output to `Expected:`.
   - Update the TC's `Result:` line:
     - `PASS — YYYY-MM-DD` on success.
     - `FAIL — see BUG-YYYYMMDD-NN` on failure (link the bug you file).

4. **If a TC fails — IMMEDIATELY:**
   - File a BUG at `<resolved-bugs-folder>/EPIC-NN/FEAT-NN.M/BUG-YYYYMMDD-NN-<slug>.md` using `BUG.template.md`. Include full repro, environment snapshot, first analysis hypothesis, suggested fix direction. A junior dev should be able to act on it without asking questions.
   - Update the failed TC's `Result:` line to reference the bug.
   - If the failure is critical and blocks the rest of the run, STOP further TC execution. Otherwise continue.
   - A bug filed in chat-only is a process violation — the BUG file must exist on disk before you report the failure in your summary.
   - **Spec-error exception:** if the failure indicates the AC / Expected line is wrong (budget set without measurement, expected vocabulary that contradicts shipped code, etc.) rather than a code defect, file an **ADR** documenting the spec correction in place of a BUG. The ADR linked from the TC's `Result:` line IS the resolution. Don't file both for the same root cause.

5. After all TCs run, update the testplan's "Sign-off" section.

6. **If ALL TCs PASS** — flip testplan status to `done`. Set `completed_at` to now. Recommend `/Tandem:close-out-story` next.

7. **If ANY TC FAILed** — leave testplan as `in-progress`. Story stays `in-review`. The dev needs to fix the bugs and re-run the failed TCs.

## Output rules

- Run TCs serially, not in parallel — easier to attribute failures.
- **Batched-pattern invocation is OK** when commands share a runner (e.g. running multiple jest TCs in one `--testPathPattern` invocation), AS LONG AS the runner's per-file PASS/FAIL output keeps each TC's `Result:` line independently attributable. Don't batch across runners (jest + Playwright + bash scripts in one call); those run separately.
- For UI test commands: capture screenshot artifacts to the resolved reports folder (`41-Reports/` canonical or `_Reports/` flattened) if helpful.
- Trim log output in BUG evidence sections to ≤30 lines, key frames preserved.
- For long-running test suites that produce noisy logs: spawn a fresh agent (SOP §18) and get back the PASS/FAIL summary — don't paste 500 lines of stdout into the main thread.

## Non-negotiable rules from CLAUDE.md

- Frontmatter timestamps.
- Status enum.
- Bug auto-raise on failure — MANDATORY, in the same response as the failure observation.
- Templates rule.

## End-of-run summary (always emit)

- TCs PASSED: X / Y
- TCs FAILED: Y - X
- BUGs filed: <list of paths>
- Testplan status: `done` | `in-progress`
- Recommended next step:
  - All PASS → `/Tandem:close-out-story`
  - Any FAIL → assign bugs to Dev hat; re-run testplan after fixes
