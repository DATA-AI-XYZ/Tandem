# Prompt 03 · Split Epic into Features

**Trigger:** An Epic file exists and has been reviewed; ready to break down.

**Hat:** PM

---

## Paste this into Claude

```
You are operating as **PM hat**.

Load these files into context:
- The Epic: <PATH TO 30-Epics/EPIC-NN-*.md>
- 90-Standards/SOP.md
- 90-Standards/PROJECT-CONTEXT.md
- 91-Templates/FEATURE.template.md
- Project root CLAUDE.md

Task:
1. Read the Epic's "## Features" outline (high-level titles).
2. For each, create a FEAT file at 31-Features/EPIC-NN/FEAT-NN.M-<slug>.md using
   FEATURE.template.md verbatim. Number sequentially within the Epic (.1, .2, .3 …).
3. For each Feature, fill in:
   - **Goal** — the slice of the Epic this delivers.
   - **User value** — one sentence on UX improvement.
   - **Scope** — bulleted breakdown.
   - **Acceptance criteria** — testable checkboxes. Each AC should map to ≥1 story later.
   - **Dependencies** — between features, on infra, on decisions.
   - **Data touched** — reads/writes/new schema.
4. Update the Epic's "## Features" section with proper relative links to the new FEAT files.
5. Do NOT create STORY files — that's prompt 04.

Output rules:
- Show me the file tree of what you'll create BEFORE writing. Wait for approval.
- If a Feature feels > L estimate (1-2 weeks), propose splitting into two Features.
- If two Features overlap heavily, propose merging.
- Set status=not-started, created_at=now for every file.

Honour from CLAUDE.md:
- Frontmatter timestamps
- Status enum
- Templates rule

After saving all FEAT files, summarise:
- Total features: N
- Estimated total: <weeks>
- Suggested execution order: <which to start with and why>

Then propose: "Run prompt 04 (split-feature-into-stories) on FEAT-NN.M next?"
```
