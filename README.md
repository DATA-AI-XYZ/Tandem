<div align="center">

# Tandem

**Tandem — the Claude Code project-management plugin.** Your co-pilot for shipping ideas without the chaos.

[![version](https://img.shields.io/badge/version-2.7.1-1A1714)](https://github.com/DATA-AI-XYZ/Tandem/releases)
[![license](https://img.shields.io/badge/license-MIT-2D6CDF)](LICENSE)
[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-D63031)](https://code.claude.com/docs/en/plugins)

[**▶ Live demo — the Tandem Command Center**](https://data-ai-xyz.github.io/Tandem/)

</div>

---

Tandem is a Claude Code plugin that takes you from idea to production — without the chaos. You drive the whole plan with slash commands; Tandem makes sure nothing slips: no stories go in-progress without a testplan, no work ships without passing its gates, no decision disappears into the chat log. The result is a team-quality delivery rhythm, at solo-founder pace.

---

## How it works

Tandem installs a `_00-Project-Management/` scaffold into your project and registers a set of `/tandem:*` skills that cover the full North Star → Done lifecycle. Two hooks keep everything honest: a linter that runs on every PM file edit, and a generator that rebuilds an interactive HTML **Command Center** whenever your plan changes. Both hooks run a single stdlib-only Node entrypoint (`node ${CLAUDE_PLUGIN_ROOT}/_00-Project-Management/93-Scripts/hook.js`) directly — no `npm` step is involved.

It's **stack-agnostic** — the bootstrap asks what you're building (web, mobile, CLI, library, backend, data-pipeline, Power Platform, or automation) and tailors the guidance to match.

**New in 2.7:** Tandem can now run your whole plan **hands-free** — `/tandem:autopilot` drives every phase and batch unattended, checkpoints as it goes, halts on any failure, pauses itself near your Claude usage limit and resumes when the window resets. And every execution now records what it actually cost: stories carry usage estimates, actuals reconcile against them, and the board answers "can I afford to run this batch now?" before you start.

### Why it's different from "AI project management"

Most "AI project management" is a chat log. Tandem is a contract:

- **Closed-set status enum** — exactly nine statuses, never invented ad-hoc, so every board reads the same.
- **Story ↔ Testplan pairing (enforced)** — you cannot create a Story without a paired Testplan where every acceptance criterion maps to a runnable test case. No "trust me, it works."
- **DoR / DoD gates** — work can't enter *in-progress* without meeting Definition of Ready, and can't reach *done* without Definition of Done. The gates are checked, not assumed.
- **ADR-on-the-spot** — every non-obvious decision becomes an Architecture Decision Record in the same edit, so the *why* is never lost.
- **Auto bug-raising** — the moment a test case fails, a structured BUG file is filed before the failure is even reported back to you.
- **A living Command Center** — a single self-contained HTML view of your entire plan, regenerated automatically. (That's the [live demo](https://data-ai-xyz.github.io/Tandem/) above.)

## The lifecycle

```mermaid
flowchart LR
  NS[North Star] --> OKR[OKRs]
  OKR --> PRD[PRD]
  PRD --> E[Epic]
  E --> F[Feature]
  F --> S[Story]
  S --> TP[Testplan]
  TP --> X[execute-story]
  X --> R[run-testplan]
  R --> C[close-out-story]
  C --> M[(Command Center)]
  M -. weekly / monthly review .-> OKR
```

Every arrow is a slash command. Every box is a markdown artefact in your repo.

## Install

```bash
# 1. Add the Tandem marketplace
/plugin marketplace add DATA-AI-XYZ/Tandem

# 2. Install the plugin
/plugin install tandem@data-ai-xyz

# 3. Bootstrap it into your project (drops _00-Project-Management/, wires hooks, seeds CLAUDE.md)
/tandem:session-start
```

On install Tandem will:

1. Drop the `_00-Project-Management/` scaffold into your project root (if absent).
2. Register the `/tandem:*` skills covering the full North Star → Done lifecycle.
3. Enable two hooks — lint-on-edit and Command-Center-regen-on-stop.
4. Insert a slim PM rules block into your root `CLAUDE.md` (idempotent, under a managed marker).

> No plugin access? Tandem also ships a paste-prompt installer — see [`BOOTSTRAP-PROMPT.md`](BOOTSTRAP-PROMPT.md).

## Updating

> **One-time step for 2.7.1:** this release renames the plugin's machine identity to kebab-case (`tandem@data-ai-xyz`) so the claude.ai / Cowork marketplace sync accepts it (the skill prefix changes from `Tandem` to `tandem` with it). An install made under the old capitalized name won't update in place — remove it, then re-add the marketplace and run `/plugin install tandem@data-ai-xyz`. Your project's PM files are untouched.

Two layers keep you current — the **plugin** and your project's **kit files**:

1. **Update the plugin** (interactive — the CLI has no update command): in any Claude Code session run `/plugin`, update the `data-ai-xyz` marketplace, then update/reinstall **tandem**. `claude plugin list` should then show the new version.
2. **Refresh your project**: inside each project that uses Tandem, run `npm run pm:update` — it non-destructively refreshes the kit's scripts/templates to the plugin's version and never touches your stories, decisions, or board.
3. **Restart your session**: after updating the plugin, restart Claude Code — until you do, hook errors mentioning the old version's cache path are expected and harmless.

## Slash commands

| Command | Hat | When to use |
|---|---|---|
| `/tandem:session-start` | any | Orient at the start of a session: read active work, recent ADRs, the board; announce the next step |
| `/tandem:draft-okrs` | Founder | Draft quarterly OKRs from a North Star |
| `/tandem:draft-prd` | Founder→PM | Draft a PRD from an OKR or raw notes |
| `/tandem:draft-epic` | PM | Draft an Epic from an OKR key result or PRD section |
| `/tandem:split-into-features` | PM | Decompose an Epic into Features |
| `/tandem:split-into-stories` | PM | Decompose a Feature into Stories + paired Testplans |
| `/tandem:refine-backlog` | PM | DoR gate — promote to *ready* or list the gaps; never silently promotes |
| `/tandem:execution-strategist` | PM | Plan how to execute an Epic — group stories into batches with lanes & sub-agents |
| `/tandem:execute-story` | Dev | Pull a *ready* Story into active work |
| `/tandem:execute-batch` | Dev | Run a whole strategy "batch" of stories end-to-end |
| `/tandem:autopilot` | PM | **New in 2.7** — run the whole plan unattended: phase → batches → close, with checkpoint/resume, a usage governor that pauses near your Claude limit and resumes on reset, and quality-first model tiering |
| `/tandem:run-testplan` | QA | Run every test case; auto-file BUGs on failure |
| `/tandem:close-out-story` | QA→PM | DoD gate (incl. AI-code review) + board update |
| `/tandem:weekly-monitor` | PM | Friday weekly summary; flag stalls and blocks |
| `/tandem:monthly-retro` | Founder/PM | Monthly retrospective |
| `/tandem:fill-claude-md` | any | Author/refresh `CLAUDE.md` files across the codebase |
| `/tandem:reflect` | any | End-of-session reflection: propose improvements (you approve before applying) |
| `/tandem:core` | — | Force-load the core PM rules (usually auto-loaded) |

Skills are model-invoked — Claude auto-loads them when your task matches — but explicit invocation always works.

## The Command Center

The headline feature. A single self-contained HTML file, regenerated from your markdown plan, with tabs for the plan tree, the monitor board, the execution strategy, and a glossary. It's built to be glanceable and stays current automatically (the Stop hook regenerates it whenever a PM file changes).

**[▶ Open the live demo](https://data-ai-xyz.github.io/Tandem/)** — generated from a fabricated sample project (not real data), so it's safe to share and explore.

<!-- Screenshots live under docs/ once generated:
![Tandem Command Center — light](docs/screenshot-light.png)
![Tandem Command Center — dark](docs/screenshot-dark.png)
-->

## What's inside

```
Tandem/
├── .claude-plugin/
│   ├── plugin.json            Manifest (name: Tandem)
│   └── marketplace.json       DATA-AI-XYZ marketplace listing
├── skills/                    The /tandem:* skills (full lifecycle)
├── hooks/                     PostToolUse (lint) + Stop (Command-Center regen)
├── docs/                      Live-demo Command Center (GitHub Pages)
├── BOOTSTRAP-PROMPT.md        Paste-prompt installer (no-plugin path)
├── CONTRIBUTING.md · SECURITY.md · CHANGELOG.md · LICENSE
└── README.md
```

## Project types supported

`web-app` · `mobile` · `cli` · `library` · `backend-service` · `data-pipeline` · `power-platform` · `automation` — the bootstrap injects the matching gotchas and per-type guidance.

## Contributing & security

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — how to propose changes.
- [`SECURITY.md`](SECURITY.md) — responsible disclosure.

## License

[MIT](LICENSE) — provided **"as is"**, without warranty of any kind (see [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md)).

## Disclaimer

"Claude" and "Claude Code" are trademarks of Anthropic, PBC. Tandem is an independent project and is **not affiliated with, endorsed by, or sponsored by Anthropic**. Tandem runs locally; its scripts and hooks make **no network calls** and collect **no telemetry**. It creates and edits files under your project's `_00-Project-Management/` tree — review what it does and use it at your own risk. See [NOTICE.md](NOTICE.md) for full details.

## Contact

- Web: <https://www.dataxyzconnect.com>
- Email: info@dataxyzconnect.com · Maintained by DATA-AI-XYZ
