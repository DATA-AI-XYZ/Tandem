---
name: split-into-features
description: Split an EPIC into Feature files. Use when the user asks to split / decompose / break down an epic into features, asks to create features under an epic, or invokes /Tandem:split-into-features. Operates as PM hat. Reads an Epic file and writes FEAT-NN.M-<slug>.md files in 31-Features/EPIC-NN/, then updates the Epic's Features section with relative links.
---

# Tandem: split-into-features (PM hat)

Operate as **PM hat**. The user has an approved Epic and needs to decompose it into Features that can each ship in 1–2 weeks of solo work.

This skill is the slash-command wrapper for the kit's canonical feature-decomposition prompt. The prompt is the source of truth; this file is the entry point.

## Source of truth

@_00-Project-Management/92-Prompts/03-split-epic-into-features.md

Follow that prompt verbatim. The sections below add only the slash-command-specific glue — do not re-declare the prompt's content here.

## Inputs needed

- Path to the source Epic file (`_00-Project-Management/30-Epics/EPIC-NN-<slug>.md`).
- If the user didn't supply one, ask: "Which Epic file should I decompose? Paste the path or the EPIC-NN id."

## Load into context

Use `Read` / `Glob` to detect existence. Treat missing files as "not present" rather than throwing.

- **Source Epic** — at the resolved path above. Read it fully — especially the `## Features` outline (high-level titles the Epic already proposed) and `## In scope` / `## Out of scope`.
- **SOP** — `_00-Project-Management/90-Standards/SOP.md` for DoR + estimation rules.
- **Project context** — `_00-Project-Management/90-Standards/PROJECT-CONTEXT.md`.
- **Feature template** — `_00-Project-Management/91-Templates/FEATURE.template.md`. Use verbatim — do not redraft section headings from memory.
- **Existing Features under this Epic** — glob `_00-Project-Management/31-Features/EPIC-NN/FEAT-NN.M-*.md` to find the next-free `M` (scan for max M, increment by 1). Create the `EPIC-NN/` subfolder if it doesn't exist yet.
- **Project root `CLAUDE.md`** — for project-specific overrides.

## Task

1. Read the source Epic's `## Features` outline. Each high-level title becomes one FEAT file (unless the user wants a different split — confirm split count up front to avoid under-decomposition).
2. For each feature, find next-free `FEAT-NN.M` by scanning the target `31-Features/EPIC-NN/` folder.
3. Write each `_00-Project-Management/31-Features/EPIC-NN/FEAT-NN.M-<slug>.md` using `FEATURE.template.md` verbatim. Number sequentially within the Epic (.1, .2, .3 …).
4. Fill every section:
   - **Goal** — the slice of the Epic this delivers.
   - **User value** — one sentence on UX improvement.
   - **Scope** — bulleted breakdown.
   - **Acceptance criteria** — testable checkboxes. Each AC must map to ≥1 story later (don't write the stories — `/Tandem:split-into-stories` does that).
   - **Dependencies, Data touched, Risks.**
5. Update the Epic's `## Features` section with relative links to the new FEAT files (`../31-Features/EPIC-NN/FEAT-NN.M-<slug>.md`).
6. Set frontmatter on every Feature: `status: not-started`, `created_at: <ISO 8601 now from system clock>`, other timestamp fields empty strings, `epic: EPIC-NN`.
7. **Show the file tree of what you'll create before writing.** Wait for user approval.

## Output rules

- If a Feature feels > L estimate (1–2 weeks), propose splitting into two Features before writing.
- If two Features overlap heavily, propose merging.
- Under-decomposition risk: if you produce only 1 Feature when the Epic warrants several, **stop and confirm the split count with the user** before writing.
- Do NOT create STORY files — that's the next phase.

## Non-negotiable rules from CLAUDE.md

- Frontmatter timestamps (quoted ISO 8601 with offset, from system clock).
- Status enum (`not-started` on creation).
- Templates rule — use `FEATURE.template.md` verbatim.
- Epic linkage — every Feature's frontmatter `epic:` must point to the source Epic.

## End-of-session summary (always emit)

- Files written: list of `_00-Project-Management/31-Features/EPIC-NN/FEAT-NN.M-<slug>.md` paths
- Total features: N
- Estimated total: <weeks>
- Suggested execution order: which to start with and why
- Epic `## Features` section updated: yes / no

## Next command

`/Tandem:split-into-stories` — decompose each Feature into Stories + paired Testplans.
