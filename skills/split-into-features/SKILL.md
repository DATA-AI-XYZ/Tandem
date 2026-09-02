---
name: split-into-features
description: Split an EPIC into Feature files. Use when the user asks to split / decompose / break down an epic into features, asks to create features under an epic, or invokes /tandem:split-into-features. Operates as PM hat. Reads an Epic file and writes FEAT-NN.M-<slug>.md files in 31-Features/EPIC-NN/, then updates the Epic's Features section with relative links.
---

# Tandem: split-into-features (PM hat)

Operate as **PM hat**. The user has an approved Epic and needs to decompose it into Features that can each ship in 1–2 weeks of solo work.

This skill is the slash-command wrapper for the kit's canonical feature-decomposition prompt. The prompt is the source of truth; this file is the entry point.

## Source of truth

@_00-Project-Management/92-Prompts/03-split-epic-into-features.md

Follow that prompt verbatim. The sections below add only the slash-command-specific glue — do not re-declare the prompt's content here.

## Inputs needed

- Path to the source Epic file under the `epics` folder (resolve via the path map: `node _00-Project-Management/93-Scripts/lib/pm-paths.js resolve epics`; e.g. `_00-Project-Management/01-EPIC/EPIC-NN-<slug>.md`).
- If the user didn't supply one, ask: "Which Epic file should I decompose? Paste the path or the EPIC-NN id."

## Load into context

Use `Read` / `Glob` to detect existence. Treat missing files as "not present" rather than throwing. Folder locations are resolved through the path map (`pm-paths.js` / `pm-paths.json`) rather than hardcoded.

- **Source Epic** — at the resolved path above. Read it fully — especially the `## Features` outline (high-level titles the Epic already proposed) and `## In scope` / `## Out of scope`.
- **SOP** — `_00-Project-Management/90-Standards/SOP.md` for DoR + estimation rules.
- **Project context** — `_00-Project-Management/90-Standards/PROJECT-CONTEXT.md`.
- **Feature template** — resolve the `templates` folder via the path map and read `FEATURE.template.md`. Use verbatim — do not redraft section headings from memory.
- **Existing Features under this Epic** — resolve the `features` folder via the path map and glob `EPIC-NN/FEAT-NN.M-*.md` to find the next-free `M` (scan for max M, increment by 1). Create the `EPIC-NN/` subfolder if it doesn't exist yet.
- **Project root `CLAUDE.md`** — for project-specific overrides.

## Task

1. Read the source Epic's `## Features` outline. Each high-level title becomes one FEAT file (unless the user wants a different split — confirm split count up front to avoid under-decomposition).
   - **Split gate (artefact economy — `90-Standards/ARTEFACT-ECONOMY.md`):** a Feature is earned only by a shippable slice with its own acceptance criteria that genuinely needs ≥2 stories; otherwise fold it into a sibling or keep it a single Story. Fewest Features that carry the Epic's claims.
2. For each feature, find next-free `FEAT-NN.M` by scanning the target `EPIC-NN/` folder within the resolved `features` folder.
3. Write each Feature file under the resolved `features` folder, organized as `EPIC-NN/FEAT-NN.M-<slug>.md`, using `FEATURE.template.md` verbatim. Number sequentially within the Epic (.1, .2, .3 …).
   - **Apply `write-outcomes` for each Feature, inline-first:** After writing each FEAT file, apply the `write-outcomes` rules inline to the Feature's title and technical body to produce the outcome line; dispatch a sub-agent only under ADR-0105 — write-outcomes runs inline first, rather than dispatching a sub-agent per artefact's named conditions (this producer's own context is near its limit, or an isolation-worthy batch run). Write the single line (plain text, no markdown) into the Feature's `outcome:` frontmatter field.
4. Fill every section:
   - **Goal** — the slice of the Epic this delivers.
   - **User value** — one sentence on UX improvement.
   - **Scope** — bulleted breakdown.
   - **Acceptance criteria** — testable checkboxes. Each AC must map to ≥1 story later (don't write the stories — `/tandem:split-into-stories` does that).
   - **Dependencies, Data touched, Risks.**
5. Update the Epic's `## Features` section with relative links to the new FEAT files (relative from the resolved `epics` folder to the resolved `features` folder, e.g. `../31-Features/EPIC-NN/FEAT-NN.M-<slug>.md` in a canonical layout).
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

- Files written: list of Feature file paths under the resolved `features` folder (e.g. `_00-Project-Management/31-Features/EPIC-NN/FEAT-NN.M-<slug>.md`)
- Total features: N
- Estimated total: <weeks>
- Suggested execution order: which to start with and why
- Epic `## Features` section updated: yes / no

## Next command

Next: `/tandem:split-into-stories` — decompose each Feature into Stories + paired Testplans.
