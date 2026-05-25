# Prompt 04 · Split Feature into Stories (+ paired Testplans)

**Trigger:** A Feature exists and is ready to be decomposed into work.

**Hat:** PM

---

## Paste this into Claude

```
You are operating as **PM hat**.

Load these files into context:
- The Feature: <PATH TO FEAT-NN.M-*.md>
- Its Epic: <PATH TO EPIC-NN-*.md>
- 90-Standards/SOP.md (DoR, estimation, status enum)
- 90-Standards/PROJECT-CONTEXT.md (for runnable test command conventions)
- 91-Templates/STORY.template.md
- 91-Templates/TESTPLAN.template.md
- Project root CLAUDE.md

Task:
1. Read the Feature's "## Acceptance criteria". Each criterion ~ 1 story.
   If an AC implies > L work, split into multiple stories.
2. For each derived story, create TWO files in the same response:
   a. STORY file at 32-Stories/EPIC-NN/FEAT-NN.M/STORY-NN.M.PP-<slug>.md
      — using STORY.template.md verbatim. Fill As/I want/So that, AC checkboxes,
        technical notes, dependencies, references.
   b. Paired TESTPLAN at 33-Testplans/EPIC-NN/FEAT-NN.M/TESTPLAN-NN.M.PP-<slug>.md
      — using TESTPLAN.template.md verbatim. Map every AC -> >= 1 TC with a runnable
        Command. Use commands appropriate to the stack (see PROJECT-CONTEXT.md).
3. Number stories sequentially within the feature (.01, .02, .03 …).
4. Update the Feature's "## Stories" section with relative links to the new stories.
5. Set status=not-started, created_at=now for every new file.

Output rules:
- Show me the file tree of what you'll create BEFORE writing. Wait for approval.
- If any AC is not testable by a machine, flag it: "AC-3 'looks good' is not testable.
  Suggest rewriting as 'matches mockup screenshot within 5% pixel delta' or similar."
  Don't write a TC for it; ask me first.
- If a story estimates to XL, propose splitting before creating.
- Do NOT mark any story `ready` — that requires the DoR gate via prompt 05.

Honour from CLAUDE.md:
- Frontmatter timestamps
- Status enum
- Story-Testplan pairing (MANDATORY — both files in the same response)
- Templates rule
- Project-specific test conventions from PROJECT-CONTEXT.md (ports, commands, etc.)

After saving, summarise:
- Stories created: N
- Estimated total: <days/weeks>
- ACs that I flagged as not-machine-testable: <list, or "none">
- Suggested first story to pull: STORY-NN.M.PP (lowest dependency, smallest)
```
