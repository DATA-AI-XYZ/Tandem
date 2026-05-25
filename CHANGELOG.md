# Changelog

All notable changes to `Tandem` are tracked here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions follow [SemVer](https://semver.org/).

## [Unreleased]

---

## [2.2.0] — 2026-05-24

**PM dashboard upgrade — AI-catalogue depth + Implementation polish.** The generated dashboard (`pm:dash`) now surfaces what skills, sub-agents and plugins actually *do*: skill sub-commands, sub-agent trigger examples, and per-item descriptions inside plugins — all with in-drawer drill-down. The Implementation-strategy cards also get readable borders and fixed code-block wrapping. Folds in the previously-unreleased `.claude/settings.json` baseline and the `batch-plan → execution-strategist` rename. Minor bump — additive dashboard features; the frontmatter contract and skill APIs are unchanged.

### Added

- **PM dashboard — skill sub-commands.** Skills that ship a `reference/*.md` set (e.g. `impeccable`, 36 refs) now render a "Sub-commands · N" grid in the drawer; each card drills down to that reference's full body in the same drawer. `generate-dashboard.js` gains `scanSkillSubItems()`.
- **PM dashboard — sub-agent trigger detail.** Sub-agent drawers now show a Tools line and "Trigger examples · N" (Context / User says / Why it fits), parsed from the `<example>` blocks in the agent description (`extractAgentExamples()`, plus `decodeYamlEscapes()` for the `\n`-escaped frontmatter strings). A clean Description / Upstream-description block now heads every skill / agent / command / plugin drawer.
- **PM dashboard — plugin bundle inventory.** Plugin drawers replace the flat comma-separated name list with grouped, clickable cards — Skills / Subagents / Slash commands / Hooks — each carrying its own description; clicking opens the full item (or a name+blurb stub if it isn't in the catalogue).
- **PM dashboard — SOP path explorer.** The SOP plugin drawer's single hard-coded session timeline becomes a selectable **Paths** view — *End-to-end Developer / Planning / QA / Learning*. Each path is a numbered step timeline where every step shows its slash command (`/Tandem:<skill>`) as a chip that drills into that skill's drawer, plus a recurring-cadence footer (`weekly-monitor` / `monthly-retro`). `SOP_SESSION_FLOW` → `SOP_PATHS` + `SOP_CADENCE`.
- Added `.claude/settings.json` baseline (closes BACKLOG-0008). Ships at `scaffold/.claude/settings.json` (scaffold root, mirroring the `.claudeignore` placement convention) with a destructive-only `permissions.deny` floor — `Bash(rm -rf:*)`, `Bash(git push --force*)`, `Bash(git push --force-with-lease*)`, `Bash(npm publish*)`, `Write(.env*)`, `Write(node_modules/**)`, `Edit(.env*)`, `Edit(node_modules/**)`. Strict JSON with a `$schema` reference and an explanatory `_comment` header (Anthropic docs don't document comment tolerance). `CLAUDE-CODE-CONFIG.md` §2.1.1 "Three-layer filtering: ignore vs deny vs hooks" documents the read-exclusion vs execution-block vs hook-intercept distinction with a decision tree; `PROJECT-CONTEXT.md` "Claude Code exclusions" cross-references it. Format, deny-scope, and existing-file merge behaviour captured in [ADR-0007]. BOOTSTRAP-PROMPT.md integration (cross-repo paste-prompt source) deferred — source repo not reachable from this worktree.

### Changed

- **PM dashboard — Implementation cards + symlink-aware scanning.** Implementation-strategy chat-cards now have a clearly visible border (blue when executed) and a stronger shadow; the trigger/verify code blocks wrap on whitespace (`word-break:normal; overflow-wrap:break-word`) instead of splitting words mid-token. Fixed a pre-existing scanner bug: `scanSkillsRoot` / `scanAgentsRoot` / `scanCommandsRoot` silently skipped **symlinked** entries, so 14 of 39 home skills (incl. `impeccable`, `brandkit`, the design skills) never appeared in the AI catalogue — now resolved via `direntIsDir` / `direntIsFile`. The working `generate-dashboard.js` is synced into `scaffold/` (previously 991 lines behind — no AI catalogue or Implementation view).
- **Renamed the unreleased `batch-plan` skill → `execution-strategist`**, and its output report `BATCH-PLAN-*.md` → `EXECUTION-STRATEGY-*.md`. The FEAT-02.3 planner is reframed as an "execution strategist": invoked on a planned epic, it groups the stories worth executing together in one fresh chat. Folder, `plugin.json` entry, every `/Tandem:batch-plan` reference, and the paired `STORY`/`TESTPLAN-02.3.02` renamed across live + `scaffold/`. The runner `execute-batch` and the `BATCH-…` unit IDs are deliberately kept (the strategy *contains* batches; `execute-batch` *runs* one). **No published-API break** — `batch-plan` never shipped in a release. Grouping behaviour unchanged. See [ADR-0022].

### Fixed

- **PM dashboard — second hardening pass (`polish` + `harden` + `adapt`).** Nav is now a proper **ARIA tab pattern** (`role=tablist/tab`, `aria-selected`, roving `tabindex`, Arrow/Home/End keys) with `role=tabpanel` sections; an `aria-live` region + visible **"N of M"** counts announce filter results; an injected `sr-only` `<h2>` per section fixes the heading hierarchy. Tokenised the last hardcoded colours (`--code-bg`, `--yellow-ink` — the latter also fixes dark-mode amber-label contrast), dropped the mask `backdrop-filter` blur, and added `@media (pointer:coarse)` 44px touch targets (desktop stays dense). OKLCH migration was deliberately **not** done: the brand is hex-defined in the guidelines, which (per impeccable's own priority rules) overrides the generic OKLCH law. Audit 13 → ~15/20 after the first pass; this takes the weak dimensions toward 4.
- **PM dashboard — accessibility + UX hardening (impeccable audit pass).** Rows, AI cards, plan-tree heads and filter pills are now keyboard-operable (`role`/`tabindex`/Enter-Space via a shared `activate()`); the drawer moves focus in, makes the background `inert`, and restores focus on close. Overview was reworked: the 7-tile hero-metric wall is replaced by a "what needs me" lead (one completion-% number + WIP) over promoted In-progress/Blocked panels, counts demoted to a compact stat strip. The Plan open-detail interaction is unified (the chevron button toggles expand with `aria-expanded`; the title opens the drawer; the hidden shift/double-click is gone). WCAG-AA contrast fixed (status-pill text → `--ink`, darkened `--ink-faint`); the side-stripe callout border and all `#fff` literals removed; small touch targets bumped to ≥24px. The scroll-reveal `IntersectionObserver` + body-wide `MutationObserver` were removed (perf + de-noise) and embedded reference bodies are soft-capped (payload 5.1 MB → 4.8 MB). The dead `MARK EXECUTED` badge is relabelled `NOT EXECUTED`, and an inline legend explains the Implementation-view jargon.

### Decisions captured

- **[ADR-0022] — Rename `batch-plan` → `execution-strategist`; keep `execute-batch` runner + `BATCH-…` IDs.** Skill + its report renamed to match the operator's "execution strategist" framing; the runner side is intentionally unchanged (cheap to align later since `execute-batch` is unbuilt). Noun-form slug accepted as a deliberate divergence from the kit's verb-form skill names (`draft-epic`, `execute-story`, …).
- **[ADR-0007] — Destructive-only `permissions.deny` baseline, strict JSON (not JSONC), append-missing-rules on existing settings.json.** Permissions merge across scopes (project deny rules only ever tighten an operator's config), deny evaluated before ask before allow. Alternatives rejected: broader deny list (too aggressive), JSONC header (comment tolerance undocumented), overwrite/skip on existing files (destructive / leaves gaps).

---

## [2.1.0] — 2026-05-23

**EPIC-02 FEAT-02.1 + FEAT-02.2 — planning + decomposition slash commands.** Closes the kit's "fresh-chat-per-phase" model gap by shipping all 6 upstream lifecycle phases as slash commands. The full North Star → Done lifecycle is now invokable via 10 slash commands (plus `core` + `session-start` + `reflect`). Minor bump — purely additive; existing skills and frontmatter contract unchanged.

### Added

- **`/Tandem:draft-okrs`** (Founder hat) — drafts quarterly OKRs from a North Star. Wraps `92-Prompts/01-draft-okrs-from-northstar.md` via `@-mention`. Resolves [STORY-02.1.01].
- **`/Tandem:draft-prd`** (Founder → PM hat) — drafts a PRD from an OKR, notes, or BACKLOG entry. **Net-new content** (no source prompt to lift); documents a 5-step synthesis flow (read & cluster → frame problem → draft → confirm → save). Ships with a real pilot PRD for [BACKLOG-0010] at `20-Requirements/PRD-html-output-convention.md` proving the flow end-to-end. Resolves [STORY-02.1.02].
- **`/Tandem:draft-epic`** (PM hat) — drafts an Epic from an OKR KR or PRD section. Enforces strategy-linkage rule (aborts if `okr:` or `prd_section:` cannot be set). Wraps `92-Prompts/02-draft-epic-from-okr-or-prd.md`. Resolves [STORY-02.1.03].
- **`/Tandem:split-into-features`** (PM hat) — decomposes an Epic into FEAT files in `31-Features/EPIC-NN/`, updates the parent Epic's `## Features` section with relative links. Wraps `92-Prompts/03-split-epic-into-features.md`. Resolves [STORY-02.2.01].
- **`/Tandem:split-into-stories`** (PM hat) — decomposes a Feature into Stories AND paired Testplans in the **same response**. Structurally enforces SOP §11 "Story → Testplan pairing — MANDATORY" — aborts (writes nothing) if it cannot produce both. Wraps `92-Prompts/04-split-feature-into-stories.md`. Resolves [STORY-02.2.02].
- **`/Tandem:refine-backlog`** (PM hat) — DoR gate. Walks the SOP §6 checklist on a BACKLOG entry or `not-started` Story; either promotes to `ready` or stops, lists gaps, asks. **Never silently promotes** — the gap-list path is the load-bearing differentiator vs. the paste-prompt. Wraps `92-Prompts/05-refine-backlog-to-ready.md`. Resolves [STORY-02.2.03].
- **`91-Templates/PRD.template.md`** — new PRD template with 8 mandatory H2 sections (Problem, Audience, Goals, Non-goals, Success metrics, Key requirements, Constraints, Open questions). Plain markdown, no frontmatter — matches existing kit convention (`PRD-PM-Dashboard.md`); validator does not scan `20-Requirements/`.
- **`20-Requirements/PRD-html-output-convention.md`** — pilot PRD that exercises the new `draft-prd` skill on [BACKLOG-0010]. Real spec covering 6 numbered requirements + 5 open questions; closes the BACKLOG-0010 promotion path.
- **`.claude-plugin/plugin.json` `skills` array** — explicit list of all 13 skills shipped by this plugin. Decorative for Anthropic's auto-discovery; load-bearing for the kit's own testplan TCs that grep `plugin.json` for each skill name. See [ADR-0003].
- **EPIC-02 dogfood evidence** — all 6 stories closed `done` through the full SOP lifecycle in this repo's own `_00-Project-Management/`. 27 + 14 = 41 testplan TCs PASS across all 6 paired testplans. Proves the kit can plan + execute itself.

### Changed

- **`README.md`** — updated install-effects line ("Registers 5 skills" → "Registers 13 skills"), expanded the skills tree, and added 6 new rows to the Skills table.
- **Existing skills (`execute-story`, `close-out-story`, `run-testplan`, `session-start`)** — added flattened-layout fallback handling so they work against both canonical (`12-Active/`, `32-Stories/`, etc.) and flattened (`00-Active/`, `03-Stories/`, etc.) PM folder structures encountered in older / forked projects.
- **`.claude-plugin/marketplace.json`** — added `owner` block (name + email) and per-plugin `version` field; matched author shape across both files.
- **`_00-Project-Management/93-Scripts/generate-dashboard.js`** — minor tweaks (uncommitted improvements bundled into this release).

### Decisions captured

- **[ADR-0003] — Explicit skills array in `.claude-plugin/plugin.json`.** Decorative for Anthropic auto-discovery; load-bearing for the kit's own testplan TCs and plugin self-documentation. Alternative considered: amend the testplans to glob `skills/*/SKILL.md` instead. Chosen approach scales as more skills ship in future releases.

### Migration notes

- **No breaking changes.** Existing skills, frontmatter contract, validator rules, and hooks all unchanged.
- **`/plugin update Tandem`** (marketplace install) followed by a session restart pulls the 6 new skills.
- Local-dev installs (`claude --plugin-dir`) only need a session restart — `skills/` is re-scanned at session start.

---

## [2.0.0] — 2026-05-21

**Public-ready release.** Resolves the entire post-v1.1.0 BACKLOG (5 items shipped, 2 deliberately deferred with ADRs). The kit is now ready to be installed on any of 8 project types and to be flipped from a private org repo to a public marketplace plugin.

### Why major version bump

- **Ecosystem visibility change.** Repo visibility flip from private to public is the kind of change SemVer reserves a major bump for — even though no installable behaviour broke, the install audience and trust model fundamentally change.
- **Frontmatter contract change.** STORY artefacts now require an `ai_review` field (R14). Existing stories created under v1.x without this field will fail `pm:lint` when their status flips to `done`. Migration: add `ai_review: pending` to existing story frontmatter; set the terminal value before close-out.
- **Project-type adaptation.** The `BOOTSTRAP-PROMPT.md` discovery questions and the `PROJECT-CONTEXT.md` template are no longer web-app-scoped. Adopters of v1.x for non-web projects may have made manual edits that v2.0.0's per-type sections now subsume.

### Added

- **`scaffold/_00-Project-Management/90-Standards/SOP.md` §19 — When to outgrow this kit.** Boundary condition documented: migrate to Linear/Jira/GitHub Projects when headcount on any project reaches 3+ active contributors. Resolves [BACKLOG-0006].
- **PROJECT-CONTEXT.md "Project type" selector** + 5 per-type sections (UI-only design system, library distribution, data-pipeline schedule, Power Platform environment, CLI distribution). Each section explicitly labels which project types it applies to. Resolves [BACKLOG-0007].
- **PROJECT-CONTEXT.md "Code-intelligence plugins" subsection** under LSP (separates linters/formatters from LSP servers) **and** **"`@-mention` conventions"** section (which files Claude should pull by path vs grep). Resolves [BACKLOG-0002].
- **`ai_review` + `ai_review_skip_reason` frontmatter fields** in STORY template (per SOP §7 DoD AI-code review requirement). Resolves [BACKLOG-0003].
- **Validator R14** — when `status: done` on a story, `ai_review` must be `completed-YYYY-MM-DD`, `skipped-trivial` (with non-empty `ai_review_skip_reason`), or `n-a`. `pm:lint` blocks otherwise. Closes the v1.1.0 governance gap (text-only AI-code-review rule).
- **BOOTSTRAP-PROMPT.md project-type discovery question (Q1b)** + 8 per-type gotcha blocks: `WEB-APP-GOTCHAS`, `MOBILE-GOTCHAS`, `CLI-GOTCHAS`, `LIBRARY-GOTCHAS`, `BACKEND-SERVICE-GOTCHAS`, `DATA-PIPELINE-GOTCHAS`, `POWER-PLATFORM-GOTCHAS`, `AUTOMATION-GOTCHAS`. Each block has 4–7 entries calibrated to that stack's common bites.
- **Marketplace prep files** (resolves [BACKLOG-0004]):
  - `CONTRIBUTING.md` — contribution workflow + AI-authorship disclosure rule
  - `SECURITY.md` — threat model + vulnerability disclosure policy
  - `.github/ISSUE_TEMPLATE/bug_report.md`, `.github/ISSUE_TEMPLATE/feature_proposal.md`
  - `.github/PULL_REQUEST_TEMPLATE.md`
  - `.claude-plugin/marketplace.json` — DATA-AI-XYZ marketplace listing
- **ADR-0001 + ADR-0002** in the plugin's own `_00-Project-Management/40-Decisions/` documenting the two deliberate deferrals (progressive disclosure, SessionStart hooks).

### Changed

- **STORY template DoD checklist** now includes the AI-code-review item that points at the new `ai_review` frontmatter field.
- **README structure tree** updated to show the new top-level files (`CONTRIBUTING.md`, `SECURITY.md`, `.github/`, `.claude-plugin/marketplace.json`).
- **BOOTSTRAP-PROMPT.md Phase 0 discovery questions** now include Q1b (project type) — drives which gotcha block(s) get injected into the deployed `PROJECT-CONTEXT.md`.

### Resolved as `wontfix` (with rationale)

- **BACKLOG-0001 → wontfix** (ADR-0001). Progressive-disclosure refactor of skills deferred — current skills (≤150 lines) are below the threshold where it would measurably help. Revisit when any skill grows past 200 lines.
- **BACKLOG-0005 → wontfix** (ADR-0002). SessionStart-hook + Stop-reflection-hook conversion deferred — Anthropic plugin docs publicly demonstrate `PostToolUse` and `Stop` events only; shipping speculative hooks risks silent failure on external installs. Manual `/Tandem:session-start` and `/Tandem:reflect` skills remain the substitution.

### Migration from v1.1.0

If your project already uses v1.1.0:

1. **Add `ai_review: pending` to all existing STORY frontmatter.** Existing `done` stories won't fail R14 until you re-run `pm:lint`, but should be marked `n-a` (work pre-dated this rule) to keep history clean.
2. **No action needed for non-web projects** — the new per-type PROJECT-CONTEXT.md sections are additive. Existing customisations stay.
3. **No action needed for hooks or skills** — the v2.0.0 release does not change `hooks/hooks.json` or any shipped skill body.

### Resolved (full list)

| ID | Title | Resolution |
|---|---|---|
| [BACKLOG-0001](_00-Project-Management/11-Backlog/BACKLOG-0001-progressive-disclosure-in-skills.md) | Progressive disclosure in skills | `wontfix` ([ADR-0001](_00-Project-Management/40-Decisions/ADR-0001-defer-progressive-disclosure-in-skills.md)) |
| [BACKLOG-0002](_00-Project-Management/11-Backlog/BACKLOG-0002-at-mention-and-code-intel-guidance.md) | @-mention + code-intel guidance | `done` |
| [BACKLOG-0003](_00-Project-Management/11-Backlog/BACKLOG-0003-ai-code-review-enforcement-r14.md) | AI-code-review enforcement (R14) | `done` |
| [BACKLOG-0004](_00-Project-Management/11-Backlog/BACKLOG-0004-marketplace-publishing-path.md) | Marketplace publishing path | `done` |
| [BACKLOG-0005](_00-Project-Management/11-Backlog/BACKLOG-0005-sessionstart-hook-when-stable.md) | SessionStart hook conversion | `wontfix` ([ADR-0002](_00-Project-Management/40-Decisions/ADR-0002-defer-sessionstart-hook-pending-anthropic-stability.md)) |
| [BACKLOG-0006](_00-Project-Management/11-Backlog/BACKLOG-0006-outgrow-kit-section-19.md) | SOP §19 outgrow rule | `done` |
| [BACKLOG-0007](_00-Project-Management/11-Backlog/BACKLOG-0007-project-type-adaptation.md) | Project-type adaptation | `done` |

EPIC-01 is now `done` (all child BACKLOG items resolved).

---

## [1.1.0] — 2026-05-21

Closes the gaps identified in the post-v1.0.0 audit against [Anthropic's Claude Code best-practices blog](https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start). All 6 high-priority gaps addressed.

### Added

- **`session-start` skill** — invoked at session start to load active context (12-Active/ACTIVE.md + last 5 ADRs + MONITOR revision history + in-progress/blocked/stale-in-review stories). Implements the blog's "start hooks load team-specific context dynamically" pattern as a manual skill (less noisy than auto-firing on every session).
- **`reflect` skill** — invoked at the end of a substantive session to propose updates to CLAUDE.md / SOP.md / PROJECT-CONTEXT.md / skills / hooks based on what happened. Implements the blog's "stop hooks reflect on what happened and propose CLAUDE.md updates" pattern as a manual skill (user reviews and approves each proposal before any file edit).
- **`.claudeignore` template** at `scaffold/_00-Project-Management/.claudeignore` — sensible defaults for excluding `node_modules/`, build outputs, `.env*`, generated dashboards, etc. from Claude's read/grep surface. Customisable per project via PROJECT-CONTEXT.md "Claude Code exclusions" section.
- **PROJECT-CONTEXT.md template — three new sections:**
  - "LSP servers active" — table of language → LSP server → install command → status. Closes the blog's layer-5 "LSP for symbol-level navigation" recommendation.
  - "MCP servers wired" — table of server → purpose → auth scope → last reviewed date. Closes the blog's layer-6 "MCP servers" recommendation. Quarterly config-review (SOP §4) disconnects unused servers.
  - "Claude Code exclusions" — explicit per-project documentation of what `.claudeignore` excludes and why.
- **R13 — WIP-limit validation** in `93-Scripts/validate-frontmatter.js`. Counts stories grouped by status and emits a violation when:
  - `in-progress` > 2 (per SOP §5)
  - `in-review` > 3
  - `blocked` > 5
  Enforces SOP §5 Kanban discipline programmatically.

### Changed

- **PROJECT-CONTEXT.md "Quality commands"** restructured from a flat list to a table with an `Area / module` column. The "All / repo-wide" row remains as the DoD fallback; per-area rows let the `close-out-story` skill run scoped tests instead of the full suite (closes the blog's "running full test suites when Claude changed one service" anti-pattern).
- **SOP.md §7 Definition of Done** adds a new checklist item: **AI-code review pass**. If Claude authored more than a trivial diff (>50 net lines across >2 files), spawn a fresh `code-reviewer` agent before flipping to `done`. Closes the blog's "required code review for AI-generated code" governance recommendation.
- **`close-out-story` skill** updated DoD checklist to include the AI-code review step at position 6 (existing items 6/7 renumbered to 7/8).
- **README.md** structure tree + skills table updated to reflect the new 7 skills (was 5) and the new `.claudeignore` location.

### Not changed (deliberate)

- **Stop hook still only runs `pm:dash`** — not extended to auto-propose CLAUDE.md updates. The blog's "stop hook reflects on session" pattern is implemented as the `reflect` skill instead, because an auto-firing Stop hook would trigger on every trivial 2-message session and become noise. User invokes `reflect` deliberately when a session was substantive.
- **No SessionStart hook added.** The Anthropic plugin docs publicly document `PostToolUse` and `Stop` events. `SessionStart` may also be supported, but rather than depend on an event whose support is uncertain, this release ships the orientation behaviour as the explicit `session-start` skill. Revisit in a future release if SessionStart's stability is confirmed.
- **No automatic Naming-convention check in validator.** SOP §12 already enforces these via the R10 filename-id-matches-frontmatter rule; the templates handle the rest. Adding more naming checks risks false positives.

### Migration notes (from v1.0.0)

The `.claudeignore` location moved from "not shipped" to `scaffold/_00-Project-Management/.claudeignore`. On install in an existing project that already has a `.claudeignore` at repo root, the install does NOT overwrite — review and merge manually.

R13 (WIP limits) may flag existing projects that have legitimately accumulated >2 `in-progress` stories. Either close some to `done`/`in-review`/`blocked` before re-running `pm:lint`, or temporarily increase the limit in `validate-frontmatter.js` (constant `WIP_LIMITS`) for migration — but raise it for migration only, not permanently.

---

## [1.0.0] — 2026-05-21

Initial release. Greenfield PM Operating Kit packaged as a Claude Code plugin.

### Added

- **5 model-invoked skills:** `core`, `execute-story`, `run-testplan`, `close-out-story`, `weekly-monitor` — all namespaced under `/Tandem:*`.
- **2 hooks** (`hooks/hooks.json`):
  - `PostToolUse` (Edit/Write under `_00-Project-Management/*`) → runs `npm run pm:lint`.
  - `Stop` (when any PM file changed in session) → runs `npm run pm:dash` to regen the interactive dashboard.
- **`scaffold/_00-Project-Management/`** — the full PM kit (CLAUDE.md, SOP.md with 18 sections, DAILY-WORKFLOW.md, CLAUDE-CODE-CONFIG.md, PROJECT-CONTEXT.md template, 9 artefact templates, 10 lifecycle prompts, `pm:lint` + `pm:dash` Node scripts).
- Implements priorities 1–4 + 7 from the [Claude Code best-practices blog](https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start):
  - **(1) CLAUDE.md lean + layered** — slim root pointer + folder-local + SOP.md + PROJECT-CONTEXT.md.
  - **(2) Hooks** — deterministic lint + dash regen.
  - **(3) Skills** — model-invoked workflows.
  - **(4) Plugins** — this repo.
  - **(7) Subagents** — SOP.md §18 codifies main-thread vs Explore-agent vs fresh-agent split.
- Quarterly **config-review** cadence row in SOP §4 (the blog's "review every 3–6 months" recommendation).
- `CLAUDE-CODE-CONFIG.md` — reference doc mapping the blog's 7 priorities to this kit's choices.

### Distribution

- Plugin install path: `claude plugin install github:DATA-AI-XYZ/Tandem`
- Paste-prompt path (for environments without plugin access): `BOOTSTRAP-PROMPT.md` at this repo's root.

[Unreleased]: https://github.com/DATA-AI-XYZ/Tandem/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/DATA-AI-XYZ/Tandem/compare/v1.1.0...v2.0.0
[1.1.0]: https://github.com/DATA-AI-XYZ/Tandem/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/DATA-AI-XYZ/Tandem/releases/tag/v1.0.0
