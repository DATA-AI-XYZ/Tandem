# PM Folder Rules

Claude reads this file before touching anything under `_00-Project-Management/`. It supplements (does not replace) the rules in the project root `CLAUDE.md`.

## Folder semantics

| Folder | Purpose | Who writes here |
|---|---|---|
| `00-Strategy/` | Vision, OKRs, customer journey, risk register | Founder hat |
| `10-Inbox/` | Unrefined quick capture | Anyone, any hat |
| `11-Backlog/` | Refined, prioritised items not yet ready | PM hat |
| `12-Active/ACTIVE.md` | Live WIP index — pointers to stories | PM/Dev hats |
| `13-Releases/` | Release notes, milestone bundles | PM hat |
| `14-Retros/` | Monthly retrospectives | Founder/PM hats |
| `20-Requirements/` | PRDs, MANIFEST, original specs | Founder hat |
| `30-Epics/` | EPIC-NN-slug.md (one per epic) | PM hat |
| `31-Features/EPIC-NN/` | FEAT-NN.M-slug.md (one per feature) | PM hat |
| `32-Stories/EPIC-NN/FEAT-NN.M/` | STORY-NN.M.PP-slug.md | PM/Dev hats |
| `33-Testplans/EPIC-NN/FEAT-NN.M/` | TESTPLAN-NN.M.PP-slug.md (mirrors stories) | PM/QA hats |
| `34-Bugs/EPIC-NN/FEAT-NN.M/` | BUG-YYYYMMDD-NN-slug.md | QA hat |
| `40-Decisions/` | ADR-NNNN-slug.md (flat, sequential) | Dev hat (on-the-spot) |
| `41-Reports/` | Generated audits, diffs, snapshots | Any hat |
| `41-Reports/*.html` | HTML audits, side-by-side comparisons, exploratory HTML (`.html` sits alongside `.md` here) | Any hat |
| `42-Monitor/MONITOR.md` | Single board, status pills, revision history | PM hat |
| `42-Monitor/*.html` | HTML dashboards (e.g. `DASHBOARD.html`, generator-owned) | PM hat (script) |
| `20-Requirements/*.html` | Long-form PRDs and stakeholder-facing specs rendered as HTML (`.html` sits alongside `.md` here) | Founder hat |
| `90-Standards/` | SOP, DoR, DoD, status enum, project context | Read-only at runtime; PM hat edits |
| `91-Templates/` | One template per artefact type | Read-only at runtime |
| `92-Prompts/` | Claude lifecycle prompts | Read at session start |
| `93-Scripts/` | Validator, link checker, report generator | Run via npm scripts |

## Stories never move folders

Status changes; folder doesn't. A story file at `32-Stories/EPIC-01/FEAT-01.2/STORY-01.2.07-foo.md` stays there from creation through done/archived. Only the `status:` field in frontmatter changes. The `12-Active/ACTIVE.md` index lists paths to currently `in-progress` items.

## Numbering rules

- Epic IDs: `EPIC-NN` where `NN` is sequential within the project (01, 02, 03 …). Pad to 2 digits.
- Feature IDs: `FEAT-NN.M` where `NN` is the epic, `M` is the feature within the epic.
- Story IDs: `STORY-NN.M.PP` where `PP` is the story within the feature.
- Testplan IDs: `TESTPLAN-NN.M.PP` — mirrors the story exactly.
- Bug IDs: `BUG-YYYYMMDD-NN` where `NN` is the sequential bug filed that day within that feature folder.
- ADR IDs: `ADR-NNNN`, sequential across the whole project, no folder grouping.

## When you create a new artefact

1. Start from `91-Templates/<TYPE>.template.md`. Do not redraft section headings.
2. Set `created_at` to the system clock as ISO 8601 with offset.
3. Leave `started_at` and `completed_at` empty.
4. Default `status: not-started`.
5. Fill in relationship frontmatter: `epic:`, `feature:`, `story:`, `testplan:` as applicable.
6. If creating a Story: create the paired Testplan in the same response.
7. Run `npm run pm:lint` mentally before saving — if any rule would fail, fix it first.

## When you change a status

1. Verify the gate (DoR for entering in-progress, DoD for entering done).
2. If gate fails, stop. List the missing items in chat. Ask before continuing.
3. Update the timestamp atomically with the status flip — same edit, no separate save.
4. If flipping to `done`, update `42-Monitor/MONITOR.md` in the same response.
5. After any status flip — or whenever you create / delete artefacts in a session — regenerate the dashboard: `npm run pm:dash`. The HTML at `42-Monitor/DASHBOARD.html` is the live, interactive view of the markdown plan. It must stay current.

## When you make a decision worth remembering

Create `40-Decisions/ADR-NNNN-<slug>.md` in the same response. Find the next free `NNNN` by globbing existing ADRs. Use `91-Templates/ADR.template.md`. Link from the story's `decisions:` frontmatter array.

## When you spot a defect

File a BUG at `34-Bugs/EPIC-NN/FEAT-NN.M/BUG-<YYYYMMDD-NN>-<slug>.md` in the same response, before reporting the defect in chat. Use `91-Templates/BUG.template.md`. Write it so a junior dev can reproduce in under 5 minutes.

## Reference order

When a task asks you to do something PM-related and you're unsure of the rule:
1. Project root `CLAUDE.md` (this project's overrides)
2. This file (`_00-Project-Management/CLAUDE.md` — folder semantics)
3. `90-Standards/SOP.md` (lifecycle, DoR, DoD, cadence)
4. `90-Standards/PROJECT-CONTEXT.md` (client-specific quirks)
5. The relevant template in `91-Templates/`
