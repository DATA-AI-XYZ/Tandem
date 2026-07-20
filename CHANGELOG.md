# Changelog

All notable changes to **Tandem** are tracked here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [2.7.1] — 2026-07-20

**Hotfix — the marketplace now syncs in Claude Cowork / claude.ai.** Adding the repo as a custom marketplace in the Claude desktop app failed with *"Marketplace sync failed"* even though Claude Code CLI installs worked. Two causes, both fixed: the manifests carried a `$schema` URL that claude.ai tries (and fails) to resolve, and the plugin/marketplace names were not kebab-case, which claude.ai rejects (the CLI tolerates both).

### Changed
- **One-time identity rename (the only breaking bit):** the plugin's machine name is now `tandem` and the marketplace name is `data-ai-xyz` (previously capitalized as **Tandem** / **DATA-AI-XYZ**). Skill invocations become `/tandem:*` accordingly. The GitHub repo URL is unchanged — you still add the marketplace with `/plugin marketplace add DATA-AI-XYZ/Tandem`.
- **Existing installs:** the old-name install won't update in place. Remove it, re-add the marketplace, then `/plugin install tandem@data-ai-xyz`. Your project's PM files, board, and history are untouched; `npm run pm:update` works as before afterwards.

### Fixed
- Shipped manifests no longer carry a `$schema` key, so claude.ai's server-side sync no longer aborts trying to resolve it.

## [2.7.0] — 2026-07-18

**Autopilot & plan-by-usage budgeting.** Tandem can now run your whole plan unattended and tell you what every piece of work actually costs. Upgrading is safe: the status enum, the frontmatter contract, and every existing command name are unchanged — one new command (`/tandem:autopilot`) and one new optional story field (`usage_estimate`) are added.

### Added
- **`/tandem:autopilot`** — one command runs the existing plan end-to-end: opens each phase, runs every batch in its own fresh-context sub-agent, closes the phase. A durable checkpoint means re-running never redoes finished work (your board is always the ground truth); any failed test or raised bug halts the run and reports. Entry requires your explicit authorisation, every run is bounded by a stop condition, and a full run log is written to your reports folder.
- **Usage governor** — autopilot watches your Claude usage window and, at a configurable threshold (default 92%), finishes the current unit, checkpoints, pauses, and schedules its own resume for the window reset. No usage signal available? It pauses and asks — it never guesses.
- **Quality-first model tiering** — orchestration and every review pass run on the highest-capability model; implementation may be assigned to cheaper models per story by complexity and risk, with automatic escalation for anything ambiguous. Review is never skipped.
- **Usage tracking & budgeting** — executions record the actual tokens they burned, attributed to the story or batch that caused them; stories can carry a `usage_estimate` that reconciles against actuals; the board and Command Center roll usage up by feature/epic; a pre-batch projection answers "can I afford this now?". Surfaces with no data yet say so honestly — never zeros pretending to be measurements.
- **Plain-English deliverables on the roadmap** — each epic's "what you'll see" line now renders on the timeline, so a non-technical reader can tell what lands at every milestone. Nothing is fabricated for internal-only work.
- **"What each thing is for"** — a per-item purpose reference covering every folder, standard file, script, and skill, with a sync guard that warns (never fails) when something new lacks its line.
- **Autonomous-run playbook** — the subagent-per-batch orchestration pattern (sequential batches, fresh context per batch, failure halts the chain, hat separation preserved) is now documented standard practice, including how it composes with parallel-lane execution.

### Fixed
- **The Tandem tab no longer tells you to run a developer-only build script** in projects that merely use the kit — it now explains itself appropriately (the old instruction was un-followable outside Tandem's own repo).
- **README rendering in the Command Center** — HTML comments stay hidden, badges/images render as images, and raw layout tags no longer appear as literal text.
- **Toolkit tab honesty & readability** — the cost rollup label no longer reads as a single item exceeding the plugin total; the two unrelated "Other" groups are now distinguishable ("Unranked" for unranked items); token counts are readable (`~1,344 tok`, `~378K tok`); item descriptions never show a stray `|` or a raw `#` heading.
- **Cost-filter controls** — aligned as one control row, group headers separated, the section label wraps instead of clipping, and the active sort direction is visibly indicated.

### Changed
- **Consumer repos no longer track the generated Command Center HTML** — installs now gitignore it automatically (it is fully regenerable), so phase-close merges can never fail on it and `git add` mistakes are impossible by design. Delete one gitignore line if you genuinely want it committed.
- Install previews (`--dry-run`) now report exactly what a real install materialises, and custom folder-path overrides survive re-installs instead of being silently reset.
- A broken or missing version number now stops a release build loudly instead of quietly shipping a stale default.

## [2.6.1] — 2026-06-12

**Hotfix — `pm:lint` works out of the box in your project again.** A patch release with a single guard; the status enum, the frontmatter contract, and every command name are unchanged.

### Fixed
- **Version-parity check no longer fails in projects that use Tandem.** Previously, running `npm run pm:lint` in a project that merely installs the kit failed on every run, because the check compared your app's `package.json` version against the kit version and demanded they match — but they are independent by design. The check now only enforces that match inside Tandem's own repo; in your project it simply passes. If you applied a local workaround to the validator, you can drop it after updating.

## [2.6.0] — 2026-06-10

**Prod-clean installs and stronger planning gates.** This release also realigns the public version number with Tandem's internal release line — the jump from `1.1.0` to `2.6.0` reflects that single shared lineage, not 1.4 majors of breaking change. Upgrading is safe: the status enum, the frontmatter contract, and every command name are unchanged.

### Fixed
- **Clean installs for everyone.** A fresh install now carries the Tandem org identity and the current version — no developer email, internal repo name, or broken hook in your project. Seeded standards docs use the published `Tandem` namespace and the `github:DATA-AI-XYZ/Tandem` install URL, and the post-tool / stop hooks run without `MODULE_NOT_FOUND` on every Write / Edit / Stop.

### Added
- **Planning & verify-gate guards.** `refine-backlog` refuses to promote a story whose premise about another artefact is false; generated testplans assert real signal instead of restating their own prose; and a verify command piped into `| tail` / `| head` (which can never fail) is flagged by the validator.
- **Version-parity gate** now also covers the kit version, so a drifted version can never silently ship or let the health-check mis-report "update available".

### Changed
- **Name-independent Command Center.** The dashboard detects the Tandem plugin by a stable behavioural signal rather than its marketplace name, so the command-flow panel and drawer timeline render regardless of how the plugin was installed.

## [1.1.0] — 2026-06-02

**Founder-facing outcomes, a generated documentation set, and a brand-aligned Command Center.** Additive minor release — the status enum, the frontmatter contract, and the existing command names are unchanged, so upgrading is safe.

### Added
- **Founder-facing outcome lines across the whole plan.** Every artefact now carries a plain-English "what you'll be able to do" line, authored automatically as you draft (PRD → feature → story → execution strategy) and surfaced on the Command Center — so the board reads in business terms, not just technical scope.
- **`/tandem:document`** — generate a coherent documentation set (`overview`, `getting-started`, `architecture`, `decisions`, `features`) from what Tandem already knows about your project, then render it to HTML.
- **`/tandem:curate-toolkit`** — rank your installed AI tools (skills, agents, commands, plugins) by fit for the project and write relevance overlays into the AI catalogue.
- **`/tandem:peer-review`** — on-demand code review of a diff, branch, PR, or file, returning blocker / major / minor findings each with a suggested fix.
- **`/tandem:start-phase` and `/tandem:close-phase`** — open a phase on its own branch and close it with a retrospective and a gated merge to `main`.
- **Cross-project portability** — a configurable folder layout (so Tandem adapts to projects that don't use the canonical numbering), a self-wiring installer + health-check (`pm:install` / `pm:doctor`), cross-platform Node hooks, and a tiered `CLAUDE.md` model.

### Changed
- **Brand-aligned documentation and Command Center** — palette and typography now follow the Tandem brand, and a published documentation site ships under `docs/`.
- A non-fatal validator warning tier means advisory checks (e.g. a missing outcome line) never block your work.

## [1.0.0] — 2026-05-25

- Initial public release. The full North Star → Done lifecycle as Claude Code skills, a closed-set status enum, mandatory Story ↔ Testplan pairing, Definition-of-Ready / Definition-of-Done gates, ADR-on-the-spot, automatic bug-raising on test failure, and a self-generating interactive Command Center. Stack-agnostic across web, mobile, CLI, library, backend, data-pipeline, Power Platform, and automation project types.
