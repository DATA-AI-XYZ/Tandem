---
name: document
description: Author the project's default markdown documentation set from accumulated PM knowledge. Use when the user asks to generate the project documentation set, write project documentation, or invokes /tandem:document. Reads PROJECT-CONTEXT.md, epics/features/stories, ADRs, and the codebase — then authors one markdown file per doc into the documentation/ folder. Authors markdown only; HTML rendering is a separate step.
---

# Tandem: document (Technical Writer hat)

Operate as **Technical Writer hat**. The user wants a coherent, shareable documentation set synthesised from what Tandem already knows about the project — no separate doc-writing pass required.

## Default doc set

Author **exactly these five markdown files**, one per document, using these verbatim names as the output filenames:

| # | Document | Output file |
|---|----------|-------------|
| 1 | Overview | `documentation/overview.md` |
| 2 | Getting started | `documentation/getting-started.md` |
| 3 | Architecture | `documentation/architecture.md` |
| 4 | Decisions (digest) | `documentation/decisions.md` |
| 5 | Features (& usage) | `documentation/features.md` |

All output files are written into the **`documentation/` folder** at the project root, one `.md` per doc. Do not create subfolders inside `documentation/` — flat layout.

### The folder is not this skill's to own

`documentation/` may hold documents this skill does not write. A project can hand-author a
guide, a convention page, a per-item reference — and several do. **Never overwrite, rewrite or
delete a file that is not in the table above**, and never treat "the folder has eleven files and
I author five" as a defect to correct.

That distinction has to reach the reader, not just this instruction, because the board renders
this folder as the Project Wiki and prints a provenance line under every page. So each document
records who writes it, in its own anchor block:

- `produced_by: /tandem:document` — on the five in the table, written by this skill.
- `produced_by: hand` — on a document a person maintains.

A page that claims the wrong producer is not a cosmetic error: it sends a reader whose document
has flagged to a command that will not touch it, and that will reset five other pages on the way
past. The board previously printed one producer over all eleven and did exactly that
(BUG-20260818-09, ADR-0220).

## Sources (read before authoring)

Read the following in order, resolving paths against the project root. Treat a missing file as "not present" (note the gap in the relevant section) rather than throwing.

1. **`PROJECT-CONTEXT.md`** — canonical project identity: name, purpose, tech stack, audience, deployment. This drives the Overview and Getting started sections.
2. **Epics** (`_00-Project-Management/30-Epics/EPIC-*.md`) — strategic scope. Skim titles + `## In scope` sections.
3. **Features** (`_00-Project-Management/31-Features/**/*.md`) — feature-level capabilities. Drives the Features (& usage) doc.
4. **Stories** (`_00-Project-Management/32-Stories/**/*.md`) — implementation detail and done/not-done status. Informs accuracy of the Getting started and Features docs.
5. **ADRs** (`_00-Project-Management/40-Decisions/ADR-*.md`) — architectural decisions. Drives the Decisions (digest) and Architecture docs. Read all; summarise the most consequential ones.
6. **Codebase** — the source tree itself. Read entry points, key modules, README fragments (if any). Drives the Architecture and Getting started docs. Limit scope: entry-point files, major module directories, config files — do not attempt to read every file.

## Per-document authoring guide

### 1 · Overview (`documentation/overview.md`)
- What the project is, who it is for, and why it exists.
- One-paragraph project statement sourced from PROJECT-CONTEXT.md.
- Key capabilities list (3–7 bullets, sourced from epics/features).
- Current project status (active / beta / archived) — infer from MONITOR if present.

### 2 · Getting started (`documentation/getting-started.md`)
- Prerequisites (runtime, env vars, credentials) — sourced from PROJECT-CONTEXT.md and codebase config files.
- Install / setup steps — numbered list, runnable commands.
- First run — the single command that proves the project is working.
- Troubleshooting tips — at most 3 common failure modes from stories/bugs if present.

### 3 · Architecture (`documentation/architecture.md`)
- System diagram described in prose or Mermaid (prefer Mermaid if the structure is clear from the codebase).
- Key components and their responsibilities — sourced from codebase + ADRs.
- Data flow — how a request/event moves through the system.
- External dependencies — services, APIs, storage — sourced from PROJECT-CONTEXT.md and config files.
- Link to relevant ADRs inline (e.g. "see ADR-0003 for why X was chosen").

### 4 · Decisions (digest) (`documentation/decisions.md`)
- Introduction: what ADRs are and how to read them.
- One row per ADR in a markdown table: `| ADR | Title | Status | Date | Summary (one line) |`.
- Sort by ADR number descending (most recent first).
- Source: all files matching `_00-Project-Management/40-Decisions/ADR-*.md`. If none exist yet, write a placeholder row.

### 5 · Features (& usage) (`documentation/features.md`)
- One `##` section per major feature, sourced from the Features files.
- Each section: brief description, how to invoke / configure, example (code block or command).
- Status column: note if a feature is in-progress or planned vs. shipped — infer from story statuses.

## Source anchors (MANDATORY — one block per document)

Every document ends with a **source-anchor block**: the machine-checkable list of things in the
repo the document's claims rest on. Without it the board cannot check the document at all, and
renders it as **"unassessable"** rather than as current — which is the honest answer, and a
visible one.

Write it as the LAST thing in the file, verbatim in this shape:

```
<!-- tandem:anchors v1
generated_at: <ISO 8601 with offset, when this document's BODY was last authored>
produced_by: /tandem:document
body_sha: <run `node _00-Project-Management/93-Scripts/wiki-anchor-stamp.js` to fill this in>
file: <repo-relative path this document describes>
script: <npm script name, e.g. pm:dash>
view: <board view key, e.g. build:story>
command: </tandem:<skill>>
adr: ADR-NNNN
-->
```

Rules:

- **HTML comment, not frontmatter.** The kit's markdown parser strips HTML comments, so the
  block is invisible on the board and in `pm:docs` output. Frontmatter would change what every
  other reader of these files expects.
- **One `<kind>: <value>` per line.** Repeat a kind as many times as you need. The five kinds
  are `file`, `script`, `view`, `command`, `adr` — any other key is reported as a malformed
  anchor line rather than ignored.
- **Anchor what the document actually asserts**, not everything it mentions. If a section says
  "run `npm run pm:lint` before pushing", anchor `script: pm:lint`. If it names a file by path,
  anchor that path. If a claim rests on a decision, anchor the ADR.
- **Never anchor something you have not verified exists.** A dead anchor is a flag on the
  document, which is the point — but inventing one turns the signal into noise on day one.
- **`generated_at` is load-bearing, and it is a fact about the BODY — not about this run.**
  It is the day the document's prose was last authored. If you re-run over a document whose
  text you did not change, **carry its existing `generated_at` forward unchanged**. Writing
  `now` on an unchanged document moves it past every recorded event and silences every
  staleness flag on it — do that across the set and one re-run mutes the whole project, with no
  reason, no actor and no record. That really happened (ADR-0220), which is why the clock is
  now derived by a script rather than typed:

  ```bash
  node _00-Project-Management/93-Scripts/wiki-anchor-stamp.js documentation/<file>.md
  ```

  It reads the file's history, sets `generated_at` to the last commit that actually changed the
  body, records `body_sha` beside it, and **refuses** to advance a clock whose body has not
  moved. Run it after authoring; do not hand-write `body_sha`.

- **`produced_by` is mandatory on anything this skill writes** — `/tandem:document`, verbatim.
  A document you did not write keeps whatever it already declares.
- Aim for **3–10 anchors** per document. One anchor is a document claiming almost nothing;
  thirty is a document claiming the whole repo, and every unrelated event will touch it.

## Authoring rules

- **Markdown only** — author `.md` files. Do not generate HTML, CSS, or any rendered output. HTML rendering is handled by a separate later step.
- **Self-contained output** — each doc must be readable standalone. Cross-link between docs with relative markdown links (e.g. `[Architecture](architecture.md)`).
- **Prose quality** — use plain English, active voice, present tense. No marketing filler.
- **No invention** — if a fact is not in the sources, say "not yet documented" rather than guessing. Accuracy over completeness.
- **Touch only the five** — a `.md` in `documentation/` that is not in the Default doc set table belongs to someone else. Read it if it helps you cross-link; never write to it.
- **SELF-CONTAINED SKILL** — this skill contains no references to any specific consumer project or company. Keep output project-neutral in structure; project-specific content comes entirely from the sources above.

## Execution steps

1. Read all sources listed above (parallelise reads where possible).
2. For each of the five documents, draft content in memory, then write to `documentation/<filename>.md`.
2b. **Append the source-anchor block** to each file before writing it — see "Source anchors"
    above, including `produced_by: /tandem:document`. A document written without a block renders
    as *unassessable* on the board's Project Wiki.
2c. **Stamp the clock with the script, not by hand:**
    `node _00-Project-Management/93-Scripts/wiki-anchor-stamp.js documentation/overview.md documentation/getting-started.md documentation/architecture.md documentation/decisions.md documentation/features.md`
    It sets `generated_at` from each file's real last body change and records `body_sha`. A
    non-zero exit means it refused to write something — read the reason; do not edit around it.
3. If the `documentation/` folder does not exist, create it before writing.
4. After writing all five files, emit a short summary:
   - Files written: list with relative paths.
   - Files in `documentation/` this skill did NOT write, and left alone: list, or "none".
   - Sources read: list with any gaps noted.
   - Sections marked "not yet documented": list, or "none".
   - Source anchors emitted per document: count per file.
   - Clock: which documents the stamper moved, and which it carried forward unchanged.

## Output rules

- Write all five docs in a single response — do not ask for confirmation between docs.
- Never delete or rewrite a `documentation/*.md` outside the five.
- If a source file is missing, note the gap inside the relevant doc section and continue — do not abort.
- Do not modify any PM artefact (stories, ADRs, MONITOR) during this skill.

## Next command

`STORY-04.4.02` shipped the HTML rendering as the `pm:docs` script (`93-Scripts/generate-docs.js`): after authoring, run `npm run pm:docs` to render the `documentation/*.md` files as a styled HTML site.
