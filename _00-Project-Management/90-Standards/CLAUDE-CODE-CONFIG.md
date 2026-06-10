---
type: standard
id: CLAUDE-CODE-CONFIG
title: Claude Code Configuration Map
status: active
version: 1.0
created_at: '2026-05-21T12:59:19+01:00'
---

# Claude Code Configuration Map

How this PM kit aligns with Anthropic's guidance in [How Claude Code works in large codebases — best practices and where to start](https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start). Read this when you're about to add a hook, a skill, or restructure CLAUDE.md — to avoid drift from the published model.

---

## 1. The blog's 7-step priority order

Anthropic recommends setting up Claude Code infrastructure in this order:

1. **CLAUDE.md files** — load first in every session
2. **Hooks** — enable self-improvement and deterministic enforcement
3. **Skills** — provide on-demand expertise
4. **Plugins** — distribute working setups across repos
5. **LSP integrations** — symbol-level navigation
6. **MCP servers** — connect external tools
7. **Subagents** — split exploration from editing

Lower-numbered layers are prerequisites for higher-numbered ones to be useful. Don't wire MCP before basics are working.

---

## 2. How this kit maps to each layer

### 2.1 CLAUDE.md (layer 1)

**Blog says:** keep root CLAUDE.md lean and layered; initialise in subdirectories, not repo root; load additively as Claude moves through the codebase.

**This kit does:**

| File | Role | Loaded when |
|---|---|---|
| Project root `CLAUDE.md` | Pointers + 4 critical gotchas (timestamp format, status enum, story-testplan pairing, hat protocol). Should be <30 lines. | Every session |
| `_00-Project-Management/CLAUDE.md` | Folder semantics (which folder does what, numbering rules, when to use templates) | When working anywhere under PM folder |
| `90-Standards/SOP.md` | Lifecycle, DoR, DoD, status enum, cadence, frontmatter contract | Loaded by skills + on demand |
| `90-Standards/PROJECT-CONTEXT.md` | Per-client stack quirks (ports, env, gotchas) | Every session, project-specific |
| `90-Standards/DAILY-WORKFLOW.md` | Rhythm + worked example + sizing tree | On demand, when re-orienting |

**Reference order** (SOP §16) explicitly defines which file wins on conflict. Root → PM-folder → SOP → DAILY-WORKFLOW → PROJECT-CONTEXT → template.

**Anti-pattern guard:** if a section of root CLAUDE.md grows past ~5 lines on one topic, move it into a skill or into SOP.md. Root is pointers + non-negotiable gotchas, not expertise.

#### 2.1.1 Three-layer filtering: ignore vs deny vs hooks

Three distinct Claude Code mechanisms control what Claude *sees*, *does*, and *is intercepted on*. Operators routinely conflate the first two — read-exclusion is not the same as tool-permission. Pick the layer by the question you're answering:

| Layer | File | Question it answers | Effect |
|---|---|---|---|
| **`.claudeignore`** | `.claudeignore` (repo root) | "Should Claude **read / grep** this?" | Claude **doesn't read** matched paths — keeps `node_modules/`, build output, secrets, generated dashboards out of context. Does **not** stop a tool from acting on them. |
| **`permissions.deny`** | `.claude/settings.json` | "Should Claude be allowed to **execute** this?" | Claude **can't run** the matched tool call (e.g. `Bash(rm -rf:*)`, `Write(.env*)`) — refuses or prompts. Does **not** hide the file from reads. |
| **Hooks** | `hooks/hooks.json` (or plugin) | "What should run **before/after** a tool call, deterministically?" | Programmatic intercept — e.g. `PostToolUse` runs `pm:lint` after an Edit; a `PreToolUse` hook can block a call by exit code. Code, not a static rule. |

**Decision tree:**

- Want Claude to stop wasting context on a path → **`.claudeignore`** (read-exclusion).
- Want to hard-block an irreversible/destructive command regardless of context → **`permissions.deny`** in `.claude/settings.json` (execution-block).
- Want to *run logic* around a tool call (lint, format, audit, conditional block) → **hook**.

A path can legitimately appear in more than one layer for different reasons: `.env*` is in `.claudeignore` (don't read secrets into context) **and** in `permissions.deny` as `Write(.env*)`/`Edit(.env*)` (don't let Claude clobber the file). They are not redundant — different layers, different failure modes.

**`.claude/settings.json` baseline** ships at `scaffold/.claude/settings.json` (scaffold root, mirroring the `.claudeignore` placement convention) with a destructive-only `permissions.deny` floor (`rm -rf`, `git push --force`, `npm publish`, `.env` writes, `node_modules` writes). Rationale + the trim/expand path live in the file's `_comment` header; the resolution-order and format decisions are in [ADR-0007](../40-Decisions/ADR-0007-claude-settings-deny-baseline.md). Per the [Claude Code settings docs](https://code.claude.com/docs/en/settings), **permissions merge across scopes** (user + project + local) — project deny rules *add to*, never weaken, an operator's own list — and `deny` is evaluated before `ask` before `allow`, first match wins. See also the [large-codebases blog](https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start): "commit `permissions.deny` rules in `.claude/settings.json`." Defaults dated 2026-05-23.

#### 2.1.2 When subdir CLAUDE.md wins

The kit started from a single-app assumption: one central `90-Standards/PROJECT-CONTEXT.md` table holding stack quirks, ports, env, and per-area commands. That breaks in a monorepo / multi-service host project — a session launched in one service shouldn't load the whole central table to learn that service's test/lint commands. The blog's "per-subdirectory test commands" guidance applies here. The rule is **project-type-conditional** (full rationale + alternatives in [ADR-0009](../40-Decisions/ADR-0009-central-vs-distributed-claudemd.md)):

**Decision tree:**

- **Single-app host project** → central `PROJECT-CONTEXT.md` table is canonical. No subdir `CLAUDE.md` needed — adding one just duplicates the table.
- **Monorepo / multi-service** → distribute one `CLAUDE.md` per service/area boundary, created from [`91-Templates/SUBDIR-CLAUDE.template.md`](../../scaffold/91-Templates/SUBDIR-CLAUDE.template.md) (purpose, owners, local test/lint commands, local conventions, `@-mention`-vs-grep guidance, ≤30 lines per §2.1.4). A subdir session then loads only that directory's `CLAUDE.md` plus the lean root — not the whole central table.

The template's command blocks use the `PM-KIT:BEGIN/END managed:commands` marker convention (coordination with FEAT-01.5 scaffold automation) so auto-detected commands can be (re)written without clobbering hand-authored prose.

#### 2.1.3 PROJECT-CONTEXT.md — canonical table vs index

The role of `PROJECT-CONTEXT.md` shifts with the model chosen in §2.1.2:

- **Central model (single-app):** `PROJECT-CONTEXT.md` *is* the canonical table — per-area commands, ports, env, and quirks live in its rows.
- **Distributed model (monorepo):** `PROJECT-CONTEXT.md` becomes the **index** — it stops carrying per-service commands inline and instead points at each service's subdir `CLAUDE.md`. Cross-cutting, project-wide context (shared env, account IDs, the service map itself) still lives centrally; anything local to one service moves into that service's `CLAUDE.md`.

This keeps each session's context scoped: central holds what's true everywhere, subdir holds what's true only there. Same content-economics test as §2.1.4 — a line earns its place at the scope where it applies broadly, and no narrower.

#### 2.1.4 CLAUDE.md content economics — the three tests

Every line in a CLAUDE.md loads into the model's context on every session at that scope, relevant or not. The file is a tax, not a free resource. A line earns its place only if it passes **all three tests**:

1. **Applies broadly at its scope.** Root content must be relevant to almost any task in the repo; subdirectory content to almost any task in that subdirectory. Narrower → push it further down the tree, or into an on-demand skill.
2. **Not discoverable by exploration.** Claude can grep, read files, and traverse the tree. Don't restate what the code already says — encode what it can't tell you: non-obvious conventions, gotchas, "looks like X but is actually Y", which build/test command to use *here*, where to start looking.
3. **Project-specific, not reusable expertise.** If the same advice would apply on someone else's codebase ("how to do a security review", "how to write a good commit message"), it's a **skill**. If it only makes sense in this repo ("auth goes through the legacy adapter in `/internal/auth-v1`"), it's CLAUDE.md.

**Inclusion gate:** *"If I delete this line, what specifically goes wrong, and how often?"* If the honest answer is "nothing, most of the time," it's noise — delete it.

Layering, subdirectory scoping, lean roots, and periodic review (the rest of this section) all fall out of these tests: layering exists because context is finite, subdirectory scoping because relevance is local, periodic review because what counts as "non-obvious" shifts as models improve. The automation in `93-Scripts/claude-scaffold.js` writes only the *discoverable* starter lines (marked `[auto — verify]`); the `fill-claude-md` skill applies these three tests to everything else.

#### 2.1.5 Launch location: root vs subdir trade-offs

§2.1.2 decides *whether* subdir `CLAUDE.md` files exist (monorepo → yes; single-app → no). This subsection decides, given they exist, *where to launch the session* for a given piece of work. The blog's "Initialize in subdirectories" guidance is the source: launch Claude where you'll do the work so the nearest `CLAUDE.md` scopes the session. Trade-offs, per launch location (the table lives here in the config map; the operational rule + exception list live in `DAILY-WORKFLOW.md` §5 "Launch where you'll do the work"):

| | **root-launch** (session at repo root) | **subdir-launch** (session in `apps/<x>/`) |
|---|---|---|
| **Context size** | Loads lean root `CLAUDE.md` only — but every grep/Explore can wander the whole tree, and a central `PROJECT-CONTEXT.md` table carries *all* services' quirks. Larger working set. | Loads root + that subdir's `CLAUDE.md` (≤30 lines, §2.1.4). Only this area's quirks in context. Smaller, sharper working set. |
| **Test scoping** | You must remember the right scoped command (anti-pattern guard, §4 / DAILY-WORKFLOW §10) — easy to fall back to bare `npm test` across the monorepo. | The subdir `CLAUDE.md` "Test commands" block (managed marker, §2.1.2) *is* the scoped command. Tests default to this area. |
| **MCP / skill availability** | All wired MCP servers + all description-matched skills available; nothing path-scoped is suppressed. Best when work needs cross-service tools. | Same MCP set, but `paths`-scoped skills (§2.3.1) auto-load *only* here — you get this area's skills without unrelated ones. |
| **`@-mention` friction** | Every `@path` is repo-root-relative and long; load-bearing files for *this* area aren't pinned by default. | The subdir `CLAUDE.md` already pins this area's load-bearing files (its `@-mention`-vs-grep table); paths are short and local. Less friction. |
| **CLAUDE.md load order** | Root `CLAUDE.md` → `_00-Project-Management/CLAUDE.md` (when under the PM folder). No area file in play. | Root `CLAUDE.md` → nearest-ancestor subdir `CLAUDE.md` (additive, never repeats root — §2.1.2 / SUBDIR-CLAUDE.template.md). Area conventions win for local calls. |

**Decision rule:** files clustered under one path → **subdir-launch** (default for single-area stories). Files scattered, a cross-cutting refactor, a dependency bump, or codebase-map-spanning work → **root-launch** (the exception list in DAILY-WORKFLOW §5). The role of `PROJECT-CONTEXT.md` in each model (canonical table vs index) is §2.1.3; the project-type gate is §2.1.2 + [ADR-0009](../40-Decisions/ADR-0009-central-vs-distributed-claudemd.md). Table placement (why this is §2.1.5, not §2.1.3 as the originating story's AC named): [ADR-0019](../40-Decisions/ADR-0019-subdir-launch-tradeoff-table-placement.md).

### 2.2 Hooks (layer 2)

**Blog says:** use hooks for deterministic enforcement; stop hooks to reflect on the session and propose CLAUDE.md updates; start hooks to load team context dynamically.

**This kit does:**

| Hook | Event | Action | Why |
|---|---|---|---|
| `pm-lint-on-edit` | PostToolUse (Edit/Write under `_00-Project-Management/`) | Run `npm run pm:lint` on the touched file | Stops malformed frontmatter from landing |
| `pm-dash-on-stop` | Stop (if any PM file changed this session) | Run `npm run pm:dash` | Keeps DASHBOARD.html in sync without depending on Claude remembering |

Both ship in the `Tandem` plugin (when installed) and are also documented in `BOOTSTRAP-PROMPT.md` for paste-prompt deployments.

**Anti-pattern guard:** if you find yourself asking Claude to "remember to run pm:dash" or "remember to update MONITOR," that's a hook candidate, not a prompt addition.

### 2.3 Skills (layer 3)

**Blog says:** load specialised workflows on-demand to avoid bloating every session; scope skills to specific paths so they auto-load only in relevant directories; use progressive disclosure.

**This kit does:**

The four hot prompts (06, 07, 08, 09) are also published as model-invoked skills inside the `Tandem` plugin. Plugin skills are **namespaced** (`/Tandem:execute-story`) and **selected by description match** — Claude loads them when the user's task description matches the skill's `description` frontmatter, or when the user invokes them explicitly with `/Tandem:<skill>`.

| Skill | Description hint (what Claude matches on) | Replaces paste-prompt |
|---|---|---|
| `core` | Core PM rules — closed status enum, frontmatter timestamps, DoR/DoD gates, hat protocol. Use when working anywhere under `_00-Project-Management/`. | (formerly inline in root CLAUDE.md) |
| `execute-story` | Use when starting work on a STORY file under `_00-Project-Management/32-Stories/`. Verifies DoR, flips status, reads paired testplan, codes. | `92-Prompts/06-execute-story.md` |
| `run-testplan` | Use when running a TESTPLAN file under `_00-Project-Management/33-Testplans/`. Executes every TC's `Command:`, files BUG on failure. | `92-Prompts/07-run-testplan.md` |
| `close-out-story` | Use when closing out a STORY that has passed all TCs. Runs full DoD, flips status, updates MONITOR, regens dashboard. | `92-Prompts/08-close-out-story.md` |
| `weekly-monitor` | Use on Friday weekly cadence. Summarises the week, updates MONITOR revision history, flags stalled stories. | `92-Prompts/09-weekly-monitor-update.md` |

Skills are invoked two ways:
- **Explicit:** user types `/Tandem:execute-story <story-path>` — guaranteed load.
- **Implicit:** Claude reads task description, matches against skill descriptions, auto-loads.

The remaining six prompts in `92-Prompts/` stay as documentation — they're used too infrequently to justify a skill, and they're more like "fill-out-the-form" templates than auto-loaded expertise.

**Anti-pattern guard:** don't put rules in skills that need to fire on every session — those belong in CLAUDE.md. Don't put paste-once templates in skills — those stay as prompts.

#### 2.3.1 When to path-scope vs description-match a skill

The blog says *"Scope to paths — bind skills to specific directories so they activate only for relevant work."* As of **2026-05-23** the spec supports this via the **`paths`** frontmatter field on `SKILL.md` — glob patterns (comma-separated string or YAML list) that restrict *model-invocation* to sessions touching matching files. Investigation and exact syntax: [ADR-0010](../40-Decisions/ADR-0010-path-scoped-skills.md). The `paths` glob format is the same as `.claude/rules/` path-specific rules (repo-relative globs, `**` recursion, brace expansion like `src/**/*.{ts,tsx}`).

These are **two complementary axes**, not either/or. `description` answers *"is this skill relevant to what the user is doing?"*; `paths` adds *"…and only when working under these directories."* `paths` narrows; it never replaces a good `description`.

**Decision rule:**

| Reach for… | When | Because |
|---|---|---|
| **description-match only** (no `paths`) | The skill is relevant by *task type* regardless of where in the tree the work happens | The whole point of description-match is location-independence — adding `paths` would suppress legitimate activations |
| **description-match + `paths`** | The skill is meaningful *only* inside a specific directory, and would be noise (or wrong) elsewhere | `paths` stops the skill auto-loading on unrelated work, keeping the skill listing relevant per-directory |

**Worked example — description-match-win (this kit's `close-out-story`):**
Closing out a story is relevant to *every* story regardless of which folder its code lives in — a story might touch `apps/api/`, `apps/web/`, or pure docs. The trigger is the *task* ("the testplan is fully PASS, close the story"), not a path. Adding `paths` here would be wrong: it would suppress the skill on perfectly valid close-outs whose changed files happen not to match the glob. So `close-out-story` (and every kit lifecycle skill, including `core`) stays description-matched with **no** `paths` field — the sole exception being the deliberate `path-scope-example` reference skill below. `core` is the sharpest case: its rules should be available the moment the user mentions PM work, *before* any PM file is opened — a `paths: ["_00-Project-Management/**"]` constraint would *delay* its load until a matching file is touched, a regression for a rules-carrying skill.

**Worked example — path-scope-win (hypothetical "Power Platform deployment" skill):**
A skill that documents the steps to package and deploy a Dataverse/Power Platform solution is meaningful *only* under `solutions/`. In a repo that mixes a Power Platform solution with, say, a Next.js front-end, you do **not** want this skill auto-loading while the user edits React components. Path-scope it:

```yaml
---
description: Package and deploy a Dataverse/Power Platform solution. Use when deploying, packaging, or exporting a solution.
paths:
  - "solutions/**/*"
---
```

Now the skill auto-loads only when Claude is working with files under `solutions/`, and stays silent during front-end work — same repo, different directory, correct scoping.

**Worked example — path-scope-win (this kit's real `path-scope-example`):**
The kit now ships one genuinely path-scoped skill, **`skills/path-scope-example/`** — introduced by [STORY-17.2.01](../32-Stories/EPIC-17/FEAT-17.2/STORY-17.2.01-apply-paths-scope-candidate.md) ([ADR-0076](../40-Decisions/ADR-0076-path-scope-reference-candidate.md)) precisely to prove the mechanism on real code. It carries `paths: ["_00-Project-Management/40-Decisions/**/*"]`, so it auto-loads **only** while Claude is editing an ADR under the decisions folder and stays silent everywhere else — a genuinely directory-local concern (ADR numbering/format conventions). Its paired `skills/path-scope-example/activation-test.md` documents both branches (in-scope → activates, out-of-scope → silent). Copy that skill's `paths:` block as the template for your own directory-scoped skills. (It is the *only* path-scoped skill in the kit; every other Tandem skill — `core`, `execute-story`, `close-out-story`, the rest — stays description-matched, for the reasons above.)

**Anti-pattern guard:** don't path-scope a skill carrying always-relevant rules (like `core`) — `paths` delays its load. Don't treat `paths` as a security boundary — it narrows auto-load, not explicit `/plugin:skill` invocation or `permissions` blocking.

### 2.4 Plugins (layer 4)

**Blog says:** distribute working setups via plugins so they don't remain tribal.

**This kit does:**

Two distribution paths, mutually compatible:

| Path | When to use | What it does |
|---|---|---|
| **Plugin** (`claude plugin install github:DATA-AI-XYZ/Tandem`) | New project, you have plugin install access, want zero-friction setup | Drops scaffold + wires hooks + registers skills |
| **Paste-prompt** (`BOOTSTRAP-PROMPT.md`) | New project, plugin not available, or you want full discovery Q&A first | Walks through 4 phases interactively, generates kit files |

Both paths produce an equivalent on-disk result. If both are used (plugin first, then paste-prompt re-run), the paste-prompt will detect the existing `_00-Project-Management/` and prompt to merge/overwrite/abort (BOOTSTRAP-PROMPT §0 Q1).

**Anti-pattern guard:** don't fork the plugin per client. Keep the plugin generic; per-client variation lives in `90-Standards/PROJECT-CONTEXT.md`.

### 2.5 LSP integrations (layer 5)

**Blog says:** run LSP servers so Claude searches by symbol, not by string. Don't assume LSP is automatic — it requires manual setup per language.

**This kit does:**

`PROJECT-CONTEXT.md` has a "LSP servers active" section (per-stack). Skill `pm-execute-story` instructs Claude to prefer symbol-level navigation when an LSP is available; falls back to grep when none is.

**Anti-pattern guard:** don't paste lengthy "use LSP if available" instructions in every story — the skill handles it.

### 2.6 MCP servers (layer 6)

**Blog says:** connect external tools via MCP, but only after layers 1-5 are working.

**This kit does:**

`PROJECT-CONTEXT.md` lists which MCP servers are wired for this client (e.g. Sentry, Linear, Figma, Microsoft Learn, Context7). The kit itself doesn't ship MCP servers — each client decides which to install.

**Anti-pattern guard:** don't wire MCP just because it's available. Each MCP server adds context cost on every session — only wire what you actually use weekly.

### 2.7 Subagents (layer 7)

**Blog says:** split exploration from editing — use lightweight read-only agents for "where is X" lookups so the main thread isn't polluted with grep output.

**This kit does:**

SOP.md §18 (Subagent delegation policy) defines a two-rule heuristic:

- **Explore agent** for "where is X / which files reference Y / what's the file at path Z" lookups. Read-only, returns excerpts.
- **Fresh agent (general-purpose / specialised)** for any task that would require >5 file reads, multi-step research, or running tests on the side.
- **Main thread** for: editing, decision-making, status flips, MONITOR/dashboard updates, any work the main session needs to remember.

**Anti-pattern guard:** don't delegate the decision itself. The user said it well: "never delegate understanding." Agents bring back evidence; the main thread synthesises.

### 2.8 HTML artefact pattern

**Blog says:** [Using Claude Code — the unreasonable effectiveness of HTML](https://claude.com/blog/using-claude-code-the-unreasonable-effectiveness-of-html) — long-form output, side-by-side comparisons, interactive prototypes, and stakeholder-facing material all gain a lot from HTML over raw markdown. Verification agents can ingest prior HTML specs as context.

**This kit does:**

- **Selection rule:** SOP §11.1 codifies when to choose HTML over markdown — `>~100 lines`, navigation, side-by-side comparison, embedded code, SVG-led, or stakeholder-facing.
- **Reference template:** `91-Templates/HTML-ARTEFACT.template.html` — drop-in scaffold with tabs / table / SVG container / light + dark mode / no CDN dependencies. Mirrors `42-Monitor/DASHBOARD.html` aesthetic so artefacts feel consistent.
- **Linking from Epics / Features:** optional `html_artefacts: []` frontmatter array on EPIC + FEATURE templates. Validator R15 enforces each path exists.
- **Allowed storage locations:** `42-Monitor/` (dashboards), `41-Reports/` (audits, exploratory HTML), `20-Requirements/` (long-form PRDs), `90-Standards/` (long-form standards). Other folders stay markdown-only.
- **Diagram convention:** SVG inline inside HTML artefacts; Mermaid inside markdown artefacts. Captured in a separate ADR shipping with STORY-01.1.02.

**Anti-pattern guard:** don't render short artefacts (≤~100 lines, no nav/comparison/SVG need) as HTML — the scaffold overhead and loss of native git-diff are not worth it. Don't build a reusable HTML framework; each artefact is single-purpose and throwaway per the blog's guidance.

---

## 3. Active maintenance

The blog recommends reviewing Claude Code configuration **every 3-6 months as models evolve**. This kit codifies that into SOP.md §4 cadence:

> Quarterly · 2 hours · Quarter start · Founder hat: review OKRs; **review CLAUDE.md + skills + hooks for stale instructions written to compensate for older model limitations**; archive obsolete epics; write next quarter's OKRs.

What to look for during quarterly review:

1. **CLAUDE.md instructions added to work around a model bug** — if the bug's fixed in the current model, delete the workaround.
2. **Skills that fire but never produce useful output** — model may have absorbed the skill's content as default behaviour.
3. **Hooks that never block anything in practice** — likely redundant; remove to reduce noise.
4. **MCP servers not used since last review** — disconnect; reconnect only when needed.
5. **Reference order in CLAUDE.md still matches reality** — if `PROJECT-CONTEXT.md` has grown to override most of SOP.md, the kit has a project-specific fork and needs attention.

Log the review in `14-Retros/RETRO-YYYY-Qx-config.md` (separate from the monthly retro). Capture what was removed, what was added, what stays.

---

## 4. Anti-patterns checklist

Quick scan, quarterly:

- [ ] Root CLAUDE.md is <30 lines and contains only pointers + critical gotchas
- [ ] No reusable expertise lives in root CLAUDE.md (it should be in skills)
- [ ] No "remember to run X" instructions in prompts (those are hook candidates)
- [ ] No skill bodies repeat content already in SOP.md (skills should reference SOP, not re-declare)
- [ ] Test commands in DoD are scoped (no `npm test` on a one-service change)
- [ ] No deterministic enforcement is left to "Claude will remember" — it's a hook or a script
- [ ] LSP setup is documented in PROJECT-CONTEXT.md, not assumed
- [ ] Subagent delegation is happening for >5-file lookups (check recent sessions; if grep results are pasted into main thread, you're not delegating)
- [ ] Don't build reusable HTML editor frameworks. Each interactive tool is single-purpose, throwaway, per Blog 2 ([HTML](https://claude.com/blog/using-claude-code-the-unreasonable-effectiveness-of-html)) — generate it on demand (e.g. `93-Scripts/generate-backlog-board.js`), export back to markdown-in-git, never grow it into a homegrown PM web app. See §2.8 and STORY-01.1.06.

---

## 5. When this doc changes

Update this file when:

- You add a new hook (record it in §2.2)
- You add a new skill (record it in §2.3)
- You change the reference order in CLAUDE.md (record in §2.1)
- A quarterly review produces a new anti-pattern worth tracking (add to §4)
- Anthropic publishes a substantive update to the blog post (re-fetch, diff, update mappings)

Do **not** treat this doc as the source of truth for any rule — those live in SOP.md and the skills themselves. This doc is a *map*, not the territory.
