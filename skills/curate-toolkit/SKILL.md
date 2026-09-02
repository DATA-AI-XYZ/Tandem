---
name: curate-toolkit
description: Rank installed AI tools (Skills, Agents, Commands, Plugins) by fit for this project and write relevance overlays under _00-Project-Management/97-AI-Reference/. Reads PROJECT-CONTEXT.md (project type / tech stack) plus the installed inventory and ranks each item HIGH / MED / LOW with a one-line rationale keyed to project type. Use when the user wants to rank or audit which installed tools are relevant vs. off-stack, or invokes /tandem:curate-toolkit.
---

# Tandem: curate-toolkit (PM hat)

Operate as **PM hat**. The user has an installed set of AI tools — Skills, Agents, Commands, Plugins — and needs to know which ones are actually relevant to *this* project, and which are off-stack noise that should be deprioritised or ignored.

This skill reads the project's type and stack, enumerates the installed inventory, and produces a ranked, rationale'd relevance report written as overlays under `_00-Project-Management/97-AI-Reference/`. The ranking is **judgment-led and non-deterministic** — this skill describes the *procedure* and *output shape*, not a fixed ranking.

---

## Load into context

Use `Read` / `Glob` to detect file existence. Treat any missing file as "not present" — never hard-fail on absence.

- **Project context** — `_00-Project-Management/90-Standards/PROJECT-CONTEXT.md`. Read the `## Project type` selector (which checkbox is ticked), `## Tech stack`, and `## Sub-agent mapping` table. This is the primary ranking signal: tools that match the project type / stack rank higher; off-stack tools rank lower.
- **Sub-agent map** (if present) — the `## Sub-agent mapping` table in PROJECT-CONTEXT.md names the preferred sub-agents by `type_of_work`. Cross-reference with the inventory below.
- **Installed inventory** — enumerate consumer-first. The full ordered procedure is in
  **Task step 2** below; do not shortcut it by globbing the repo alone.
- **Existing overlays** — glob `_00-Project-Management/97-AI-Reference/curate-toolkit-*.md` to check whether a prior ranking already exists. If found, note the prior run date and whether a re-rank was requested.
- **Project root `CLAUDE.md`** — for project-specific overrides or exclusions.

---

## Task

### 1 · Resolve the project type and stack

From PROJECT-CONTEXT.md, identify:
- The selected **project type** (web-app, mobile, cli, library, backend-service, data-pipeline, power-platform, automation, other).
- The **primary language(s)** and **framework(s)** from `## Tech stack`.
- The **preferred sub-agents** from `## Sub-agent mapping`.

If PROJECT-CONTEXT.md has not been filled in (all fields are still template placeholders), note this as a gap in the output and proceed with a best-effort ranking based on whatever stack signals are present in the repo.

### 2 · Enumerate the installed inventory — consumer-first, in this order

This skill exists to answer "which of **my installed tools** matter for **this** project". The tools
live where Claude Code installs them — under the **user's** home directory — not in the project being
ranked. An earlier version of this procedure globbed only the project's own directories, so in a
consumer project (one that installs the kit as a plugin and ships no `skills/` tree of its own) it
returned an **empty inventory** — in precisely the situation the command exists for. `BUG-20260721-02`.

Walk these four steps **in order**. Later steps add to the inventory; they never replace what an
earlier step found, except at step 4, which overrides by name.

**Step 1 — user-level installs.** Read `~/.claude/{skills,agents,commands}`:
- **Skills** — `~/.claude/skills/*/SKILL.md`; read `name:` and `description:` from frontmatter.
- **Agents** — `~/.claude/agents/*.md`; read each agent's name and stated purpose.
- **Commands** — `~/.claude/commands/*.md`; read each command's name and stated purpose.

**Step 2 — the installed-plugins registry.** Read the registry that records which plugins are
installed — currently `~/.claude/plugins/installed_plugins.json`. Treat the path as an
implementation detail of Claude Code: if it is not there, look for the equivalent registry rather
than concluding no plugins are installed. Each entry gives a plugin name and the location of its
installed copy.

**Step 3 — each installed plugin's bundled skills and commands.** For every plugin the registry
lists, enumerate the items it *ships* — typically `<plugin>/skills/*/SKILL.md` and
`<plugin>/commands/*.md`. **This step is what puts the kit's own `tandem:*` lifecycle skills into
the inventory of a kit-managed project.** They are installed as plugin-bundled items, so a
procedure that stops at step 1 will never see them, and a project run entirely on `tandem:*` will
report an inventory that does not contain the tools it is actually being run with.

**Step 4 — repo-local paths, LAST, as overrides.** Only now read the project's own
`skills/*/SKILL.md`, `.claude/agents/*.md`, `.claude/commands/*.md` and root `plugin.json`. A
repo-local item with the same name as one found above **replaces** it — that is what "local
override" means. In a consumer project these globs usually match nothing, and that is normal, not
an error. In this kit's own repo they match everything, which is exactly why the defect above
survived: the dev repo only ever exercised the path consumers never hit.

**Self-test — run this before writing anything.** If the Skills inventory does not include any
`tandem:*` entry in a project managed by this kit, **the enumeration is wrong — stop and
re-enumerate** from step 1. Do not proceed to ranking, and do not write an overlay: an overlay
missing the kit's own lifecycle skills is worse than no overlay, because it looks complete. The
usual cause is having run step 4 alone.

For each item found, in any of the four categories — **Skills / Agents / Commands / Plugins** — note:
- Its name / identifier, and which step found it.
- Its stated purpose (from frontmatter `description:` or equivalent).
- Whether it was actually found on disk (present) or only referenced elsewhere (e.g. in `suggested_agents:` frontmatter, the sub-agent map, or a story file) but not installed.

**Gap handling — never hard-fail:** An uninstalled or unknown agent, skill, command, or plugin referenced anywhere in the project (including in `suggested_agents:` frontmatter, the sub-agent map, or any story file) is reported as a **GAP** in the inventory section. A gap is informational — it never hard-fails the resolution or ranking pass. Per the kit's resolution order: a named item that isn't installed causes the executor to degrade gracefully to the next step (discipline fallback → `general-purpose`). This skill mirrors that behaviour: flag the gap, assign a rank of `LOW (gap — not installed)`, and continue. Do not abort.

### 3 · Rank each inventory item

For each item in the combined inventory, assign one of three tiers:

| Tier | Meaning |
|------|---------|
| **HIGH** | Directly relevant to this project type / stack — reach for it routinely. |
| **MED** | Conditionally useful — relevant for specific task types or phases, not every session. |
| **LOW** | Off-stack or not applicable to this project type — deprioritise; may still be used if the need arises. |

Ranking criteria (apply in order; earlier criteria are stronger signals):
0. **Kit self-rank (expectation, with justified exceptions)** — items shipped by this kit itself — the `tandem:*` lifecycle skills, the kit's plugin manifest entry, and its `/…:` command namespace, however they were found (plugin-bundled at step 3, or repo-local at step 4) — **default HIGH**, with the rationale `Kit-native — the planning instrument this project runs on`. The kit is what plans and executes every story in this tree; it must never rank below the tools it is ranking.

   This is an **expectation, not a hard-coded rank**: the judgment-led rule still applies, and a
   `tandem:*` item may be demoted **unless** you can state why. Demote one only if
   PROJECT-CONTEXT.md explicitly excludes the workflow it serves (e.g. `tandem:execute-batch-parallel`
   in a project whose context forbids parallel batches), and record that justified exception in the
   item's rationale so the next run can see the reasoning rather than re-deriving it.
1. **Project-type match** — if the item's purpose is specific to a project type that differs from the current project (e.g. a React-specific skill in a `data-pipeline` project), prefer LOW.
2. **Stack / language match** — if the item references a language, framework, or runtime not in the project's stack, prefer LOW or MED.
3. **Sub-agent map alignment** — if the item matches a preferred sub-agent in the PROJECT-CONTEXT `## Sub-agent mapping` table, prefer HIGH.
4. **General-purpose / cross-cutting** — skills, agents, or commands that apply regardless of stack (e.g. code-review, security-audit, commit-work) default to MED unless stack signals elevate them.
5. **Not installed (gap)** — forced LOW with `(gap — not installed)` note regardless of other signals.

Provide a **one-line rationale** for each ranking, keyed to the project type and stack (e.g. "HIGH — Next.js project; this React skill maps directly to the primary framework").

**Keeping the overlay from ballooning.** Consumer-first enumeration reaches every installed plugin,
and a machine with thirty plugins installed would otherwise produce an overlay nobody reads. The
control is inheritance: **plugin-bundled items inherit the plugin's tier** and are ranked as one
line for the plugin, **unless** an individual item is deliberately **broken out** because its
relevance differs from its plugin's. Break an item out when it earns its own line, not by default.

**`tandem:*` items are always broken out**, one line each, never folded into an inherited plugin
tier. They are the tools the project is actually run with; collapsing them into a single "the kit"
row is how the inventory stops naming what it is made of. If a plugin is ranked LOW but one of its
items is genuinely HIGH here, break that item out too and say why.

**Item ordering (within every category, in the overlay and in the chat report):** kit-native items first, then remaining items HIGH → MED → LOW, alphabetical within a tier. Consumers that render the overlay (e.g. the dashboard's Toolkit views) preserve this order, so the kit's own skills, commands, and plugin entry always surface at the top. Mark each kit-native record with the optional field `display_group: kit` (permitted by the schema's open-world rule) so renderers can group them without re-deriving provenance.

### 4 · Write relevance overlays under `_00-Project-Management/97-AI-Reference/`

Output the ranking as one or more relevance overlay files. The overlay schema and exact field names are defined in ADR-0029 / STORY-04.3.03 — write the overlay to conform to that schema once it is available. Until STORY-04.3.03 delivers the schema, write the overlay in the interim format below and mark the file with `schema: interim` so a later migration pass can upgrade it.

**Interim overlay format** (use until ADR-0029 / STORY-04.3.03 schema lands):

```
---
schema: interim
generated_by: curate-toolkit
generated_at: <ISO 8601 timestamp>
project_type: <value from PROJECT-CONTEXT.md>
---

# Toolkit Relevance Overlay — <project name or repo>

## Skills

| Name | Tier | Rationale |
|------|------|-----------|
| <skill-name> | HIGH / MED / LOW | <one-line rationale keyed to project type> |

## Agents

| Name | Tier | Rationale |
|------|------|-----------|

## Commands

| Name | Tier | Rationale |
|------|------|-----------|

## Plugins

| Name | Tier | Rationale |
|------|------|-----------|

## Gaps (referenced but not installed)

| Item | Type | Referenced in | Rationale |
|------|------|---------------|-----------|
| <name> | skill/agent/command/plugin | <file or table where referenced> | GAP — not installed; degrade to general-purpose fallback |
```

Write the overlay to `_00-Project-Management/97-AI-Reference/curate-toolkit-<YYYYMMDD>.md`. If a file for today already exists, append a numeric suffix (e.g. `-2`).

Create the `_00-Project-Management/97-AI-Reference/` directory if it does not exist.

### 5 · Report in chat

After writing the overlay, report:
- Total items ranked: N (broken down by category).
- HIGH items: list names.
- Gaps (not installed): list names and where they were referenced.
- Path to the written overlay file.
- Any caveats: e.g. "PROJECT-CONTEXT.md is unfilled — ranking used best-effort stack inference."

---

## Non-negotiable rules

- **Judgment-led, non-deterministic** — do not hard-code a fixed ranking. Always re-derive from the current project context. **Single exception:** the kit self-rank default (criterion 0) — kit-native items are HIGH and listed first unless PROJECT-CONTEXT.md explicitly excludes the workflow they serve.
- **Never hard-fail on a missing item** — gaps are informational; they never abort the ranking pass. Degrade gracefully: flag the gap, continue.
- **No consumer project references** — this skill is self-contained. Do not reference specific client names, internal company names, or project-specific paths beyond the kit's standard layout.
- **Overlay schema deferred to STORY-04.3.03** — do not define or extend the overlay schema fields here. Reference ADR-0029 / STORY-04.3.03 for the canonical definition; use the interim format above until it lands.
- **Registration deferred to STORY-04.3.03** — do not wire this skill into the build manifest here. That is STORY-04.3.03's deliverable.

---

## End-of-session summary (always emit)

- Inventory enumerated: Skills N, Agents N, Commands N, Plugins N.
- HIGH: list.
- MED: list.
- LOW: list.
- Gaps (not installed): list with source reference.
- Overlay written to: `_00-Project-Management/97-AI-Reference/curate-toolkit-<YYYYMMDD>.md`.
- PROJECT-CONTEXT.md filled: yes / no (if no, ranking is best-effort).

---

## Next command

`/tandem:curate-toolkit` — re-run after updating PROJECT-CONTEXT.md or installing new tools to refresh the overlay.

Or: `/tandem:execute-story` — to begin executing a story, using the HIGH-ranked sub-agents as the preferred executor pool.

---

## Overlay schema (v1 — ADR-0029 / STORY-04.3.03)

The canonical overlay schema is defined in ADR-0029. This section is the normative reference for
overlay authors (this skill) and overlay consumers (e.g. FEAT-04.6 dashboard renderer).

### Write location

All overlays are written to `_00-Project-Management/97-AI-Reference/` — the directory
`loadFitOverlays` resolves via `PM_ROOT/97-AI-Reference` (`PM_ROOT` = `_00-Project-Management/`;
ADR-0029 §1 correction, BUG-20260527-01). File naming: `curate-toolkit-<YYYYMMDD>.md`. Append `-2`,
`-3`, etc. if a same-day file exists. Create the directory if absent. Never write overlays outside
`_00-Project-Management/97-AI-Reference/`.

### Overlay frontmatter (required)

```yaml
schema: v1
generated_by: curate-toolkit
generated_at: <ISO 8601 timestamp>
project_type: <value from PROJECT-CONTEXT.md § Project type>
```

### Per-item record fields (required for every ranked item)

| Field | Type | Allowed values | Description |
|-------|------|----------------|-------------|
| `id` | string | — | The item's unique identifier (skill name, agent filename, command name, or plugin name). Primary key for consumer lookups. |
| `kind` | string | `skill` / `agent` / `command` / `plugin` | Inventory category. |
| `rank` | string | `HIGH` / `MED` / `LOW` | Relevance tier for this project. |
| `rationale` | string | one-line prose (≤ 120 chars) | Reason for the assigned rank, keyed to project type and stack. |
| `installed` | boolean | `true` / `false` | Whether the item was found on disk at overlay-generation time. |

### Example — normative item placement (Form B; ADR-0029 §4, BUG-20260527-01)

**This is the layout the dashboard parser actually reads.** Per-item records live in the
**body** (not frontmatter) as an `items:` block: each entry is a `- ` line starting at the left
margin (never indented under `items:`), with its fields continued on lines indented 1–4 spaces
directly below. This is the only placement `parseFitItemsFromBody` recognises — any other layout
(including a frontmatter `items:` block sequence) is silently ignored. Write this file to
`_00-Project-Management/97-AI-Reference/curate-toolkit-<YYYYMMDD>.md` (§4 write location above).

```markdown
---
schema: v1
generated_by: curate-toolkit
generated_at: '2026-07-20T09:00:00+01:00'
project_type: web-app
---

## Items

items:
- name: frontend-developer
  kind: agent
  rank: HIGH
  rationale: Core agent — UI work spans every sprint in this React project.
  installed: true
- name: database-optimizer
  kind: agent
  rank: MED
  rationale: Useful once the schema stabilises.
  installed: false
```

### Tier definitions

| Rank | Meaning |
|------|---------|
| `HIGH` | Directly relevant to this project type / stack — reach for it routinely. |
| `MED` | Conditionally useful — relevant for specific task types or phases, not every session. |
| `LOW` | Off-stack or not applicable to this project type — deprioritise. |

### Gap / uninstalled items — explicit gap marker

An item referenced anywhere (in `suggested_agents:` frontmatter, the sub-agent map, a story
file, or any other project artefact) but **not found on disk** is represented in the overlay as
an **explicit gap marker**. It is never omitted.

Gap marker convention:
- `installed: false`
- `rank: LOW`
- `rationale` prefixed with `GAP — not installed;` (e.g. `GAP — not installed; degrade to general-purpose fallback`)

Consumers must never infer the absence of an item as a ranking signal — the gap marker is the
authoritative representation of an uninstalled or unknown item. The gap marker is informational
and never aborts the overlay-generation pass.

### Schema versioning and forward compatibility

- Schema version is `v1` (this ADR). Readers gate on the `schema:` frontmatter field.
- Readers **must** ignore unrecognised fields (open-world assumption).
- Adding optional fields is non-breaking (no version bump needed).
- A breaking change requires bumping to `schema: v2` and a migration pass on existing overlays.
- FEAT-04.6 may extend this schema (e.g. `display_group`, `badge_color`) without migration.

### Registration / discoverability

This skill is registered via the kit's auto-discovery model (ADR-0003): placing
`skills/curate-toolkit/SKILL.md` in the `skills/` directory is sufficient — no `plugin.json`
skills array entry is needed or added. The public Tandem build (`npm run build:tandem`, ADR-0028)
copies the `skills/` tree and rewrites the name token to the public plugin identity (kebab-case,
ADR-0086) — this source file never spells that identity itself; the scrub
gate confirms no internal token survives. Do not add this skill to `plugin.json`.
