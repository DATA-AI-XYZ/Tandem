# Changelog

All notable changes to **Tandem** are tracked here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [1.1.0] — 2026-06-02

**Founder-facing outcomes, a generated documentation set, and a brand-aligned Command Center.** Additive minor release — the status enum, the frontmatter contract, and the existing command names are unchanged, so upgrading is safe.

### Added
- **Founder-facing outcome lines across the whole plan.** Every artefact now carries a plain-English "what you'll be able to do" line, authored automatically as you draft (PRD → feature → story → execution strategy) and surfaced on the Command Center — so the board reads in business terms, not just technical scope.
- **`/Tandem:document`** — generate a coherent documentation set (`overview`, `getting-started`, `architecture`, `decisions`, `features`) from what Tandem already knows about your project, then render it to HTML.
- **`/Tandem:curate-toolkit`** — rank your installed AI tools (skills, agents, commands, plugins) by fit for the project and write relevance overlays into the AI catalogue.
- **`/Tandem:peer-review`** — on-demand code review of a diff, branch, PR, or file, returning blocker / major / minor findings each with a suggested fix.
- **`/Tandem:start-phase` and `/Tandem:close-phase`** — open a phase on its own branch and close it with a retrospective and a gated merge to `main`.
- **Cross-project portability** — a configurable folder layout (so Tandem adapts to projects that don't use the canonical numbering), a self-wiring installer + health-check (`pm:install` / `pm:doctor`), cross-platform Node hooks, and a tiered `CLAUDE.md` model.

### Changed
- **Brand-aligned documentation and Command Center** — palette and typography now follow the Tandem brand, and a published documentation site ships under `docs/`.
- A non-fatal validator warning tier means advisory checks (e.g. a missing outcome line) never block your work.

## [1.0.0] — 2026-05-25

- Initial public release. The full North Star → Done lifecycle as Claude Code skills, a closed-set status enum, mandatory Story ↔ Testplan pairing, Definition-of-Ready / Definition-of-Done gates, ADR-on-the-spot, automatic bug-raising on test failure, and a self-generating interactive Command Center. Stack-agnostic across web, mobile, CLI, library, backend, data-pipeline, Power Platform, and automation project types.
