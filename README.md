<div align="center">

# Tandem

**An opinionated project-management operating system for solo founders working with Claude Code.**

Closed-set status enum · Story↔Testplan pairing · DoR/DoD gates · ADR-on-the-spot · automatic bug-raising on test failure · a generated, interactive Command Center.

[![version](https://img.shields.io/badge/version-1.0.0-1A1714)](https://github.com/DATA-AI-XYZ/Tandem/releases)
[![license](https://img.shields.io/badge/license-MIT-2D6CDF)](LICENSE)
[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-D63031)](https://code.claude.com/docs/en/plugins)

[**▶ Live demo — the Tandem Command Center**](https://data-ai-xyz.github.io/Tandem/)

</div>

---

## What is Tandem?

Tandem turns the loose, ad-hoc way most people plan work with an AI assistant into a **governed lifecycle** that lives entirely in your repo as markdown. You drive the whole thing from slash commands — `North Star → OKRs → PRD → Epic → Feature → Story → Testplan → execute → close → monitor` — and Claude enforces the rules at every gate so plans can't silently rot.

It installs a `_00-Project-Management/` folder into your project, registers a set of `/Tandem:*` skills, and wires two hooks that keep everything honest: a linter that runs on every edit, and a generator that rebuilds an interactive HTML **Command Center** whenever your plan changes.

It's **stack-agnostic** — the bootstrap asks what you're building (web, mobile, CLI, library, backend, data-pipeline, Power Platform, or automation) and tailors the guidance to match.

## Why it's different

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
/plugin install Tandem@DATA-AI-XYZ

# 3. Bootstrap it into your project (drops _00-Project-Management/, wires hooks, seeds CLAUDE.md)
/Tandem:session-start
```

On install Tandem will:

1. Drop the `_00-Project-Management/` scaffold into your project root (if absent).
2. Register the `/Tandem:*` skills covering the full North Star → Done lifecycle.
3. Enable two hooks — lint-on-edit and Command-Center-regen-on-stop.
4. Insert a slim PM rules block into your root `CLAUDE.md` (idempotent, under a managed marker).

> No plugin access? Tandem also ships a paste-prompt installer — see [`BOOTSTRAP-PROMPT.md`](BOOTSTRAP-PROMPT.md).

## Slash commands

| Command | Hat | When to use |
|---|---|---|
| `/Tandem:session-start` | any | Orient at the start of a session: read active work, recent ADRs, the board; announce the next step |
| `/Tandem:draft-okrs` | Founder | Draft quarterly OKRs from a North Star |
| `/Tandem:draft-prd` | Founder→PM | Draft a PRD from an OKR or raw notes |
| `/Tandem:draft-epic` | PM | Draft an Epic from an OKR key result or PRD section |
| `/Tandem:split-into-features` | PM | Decompose an Epic into Features |
| `/Tandem:split-into-stories` | PM | Decompose a Feature into Stories + paired Testplans |
| `/Tandem:refine-backlog` | PM | DoR gate — promote to *ready* or list the gaps; never silently promotes |
| `/Tandem:execution-strategist` | PM | Plan how to execute an Epic — group stories into batches with lanes & sub-agents |
| `/Tandem:execute-story` | Dev | Pull a *ready* Story into active work |
| `/Tandem:execute-batch` | Dev | Run a whole strategy "batch" of stories end-to-end |
| `/Tandem:run-testplan` | QA | Run every test case; auto-file BUGs on failure |
| `/Tandem:close-out-story` | QA→PM | DoD gate (incl. AI-code review) + board update |
| `/Tandem:weekly-monitor` | PM | Friday weekly summary; flag stalls and blocks |
| `/Tandem:monthly-retro` | Founder/PM | Monthly retrospective |
| `/Tandem:fill-claude-md` | any | Author/refresh `CLAUDE.md` files across the codebase |
| `/Tandem:reflect` | any | End-of-session reflection: propose improvements (you approve before applying) |
| `/Tandem:core` | — | Force-load the core PM rules (usually auto-loaded) |

Skills are model-invoked — Claude auto-loads them when your task matches — but explicit invocation always works.

## The Command Center

The headline feature. A single self-contained HTML file, regenerated from your markdown plan, with tabs for the plan tree, the monitor board, the execution strategy, and a glossary. It's built to be glanceable and stays current automatically (the Stop hook regenerates it whenever a PM file changes).

**[▶ Open the live demo](https://data-ai-xyz.github.io/Tandem/)** — rendered from a fabricated sample project ("TaskFlow"), so it's safe to share and explore.

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
├── skills/                    The /Tandem:* skills (full lifecycle)
├── hooks/                     PostToolUse (lint) + Stop (Command-Center regen)
├── scaffold/                  ← TEMPLATE copied into your project on install
├── docs/                      Live-demo Command Center (GitHub Pages)
├── BOOTSTRAP-PROMPT.md        Paste-prompt installer (no-plugin path)
├── CONTRIBUTING.md · SECURITY.md · CHANGELOG.md · LICENSE
└── README.md
```

## Project types supported

`web-app` · `mobile` · `cli` · `library` · `backend-service` · `data-pipeline` · `power-platform` · `automation` — the bootstrap injects the matching gotchas and per-type guidance.

## Contributing & security

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — how to propose changes.
- [`SECURITY.md`](SECURITY.md) — threat model and responsible disclosure.

## License

[MIT](LICENSE) · Maintained by DATA-AI-XYZ · `hello@dataxyzconnect.com`
