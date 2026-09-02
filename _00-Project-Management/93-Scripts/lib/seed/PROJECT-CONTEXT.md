---
type: standard
id: PROJECT-CONTEXT
title: Project Context — Stack, Conventions, Gotchas
status: not-started        # flip to 'active' once filled in
created_at: ''
started_at: ''
completed_at: ''
---

# Project Context

Per-client / per-project specifics. The kit is generic; this file is where the unique-to-this-project bits live. Fill this in **before** drafting the first Epic.

**Nothing below is filled in.** Every `_<angle-bracketed>_` value is a placeholder — replace it with what is true for *this* project, and delete the example rows. A statement left as an example is worse than a blank: sessions reground off this file and will act on whatever it says.

---

## Project type

**Select one** (drives which sections below apply):

- [ ] **web-app** — browser frontend ± server backend (React, Vue, Svelte, Next.js, etc.)
- [ ] **mobile** — iOS / Android / React Native / Flutter
- [ ] **cli** — command-line tool, no GUI
- [ ] **library** — package consumed by other projects (npm, PyPI, crates.io, NuGet)
- [ ] **backend-service** — API / worker / job runner with no user-facing UI of its own
- [ ] **data-pipeline** — ETL / ELT, dbt, Airflow, Dagster, batch processing
- [ ] **power-platform** — Power BI / Power Apps / Power Automate / Dataverse
- [ ] **automation** — internal scripts, scheduled jobs, no end-user surface
- [ ] **other** — describe: _<one line>_

Sections marked **[UI-only]** apply only to web-app, mobile, or power-platform. Sections marked **[lib-only]** apply only to library. Skip non-applicable sections; don't delete them — leave a note that says "n/a for this project type."

---

## Project identity

- **Project name:** _<fill in>_
- **Client / owner:** _<fill in>_
- **Repository URL:** _<fill in>_
- **Project stage:** _pre-launch | beta | production_
- **Primary contact:** _<email>_

---

## Tech stack

- **Language(s):** _<e.g. TypeScript, Python, Go>_
- **Framework(s):** _<e.g. Next.js 14, FastAPI, Gin>_
- **Runtime / version:** _<e.g. Node 20.x, Python 3.12>_
- **Database:** _<e.g. Postgres 16, Firestore, DynamoDB>_
- **Auth:** _<e.g. Auth0, Firebase Auth, custom JWT>_
- **Hosting:** _<e.g. Vercel, Cloudflare Pages, AWS ECS>_
- **CI/CD:** _<e.g. GitHub Actions, CircleCI>_
- **Error tracking:** _<e.g. Sentry project URL>_
- **Analytics:** _<e.g. PostHog, GA4>_
- **Dependencies:** _<runtime deps this project actually carries, or "none">_

> The kit's own tooling runs on **Node ≥ 18** regardless of what this project is written in. That is a requirement of the `pm:*` scripts, not a statement about your stack — a Python or .NET project records its own runtime above and still needs Node present to run the board.

---

## LSP servers active

Per the [Claude Code best-practices blog](https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start), running LSP servers lets Claude navigate by **symbol** instead of by string. Document which are active so future sessions know.

| Language | LSP server | Binary location / install command | Status |
|---|---|---|---|
| _<e.g. TypeScript>_ | _<typescript-language-server>_ | _<npm i -g typescript-language-server>_ | _<active \| not-yet>_ |
| _<e.g. Python>_ | _<pyright>_ | _<pip install pyright>_ | _<active \| not-yet>_ |

If no LSP is set up: Claude will fall back to `grep` / `Glob`. Symbol-level features (rename-across-refs, find-implementations, go-to-def) won't work without an LSP.

### Code-intelligence plugins (separate from LSP)

Tools that improve code awareness beyond LSP — linters with semantic understanding, formatters, language-specific Claude integrations. Worth documenting which are configured.

| Tool | Purpose | Config file |
|---|---|---|
| _<e.g. ESLint typescript-eslint>_ | _<semantic TS rules beyond `tsc`>_ | _<eslint.config.js>_ |
| _<e.g. Prettier>_ | _<formatting>_ | _<prettierrc>_ |
| _<e.g. ruff (Python)>_ | _<fast Python linter + formatter>_ | _<pyproject.toml>_ |
| _<e.g. clippy (Rust)>_ | _<idiom + lint>_ | _<built-in>_ |

### `@-mention` conventions

When Claude should prefer `@path/to/file` over grep:

- **Always @-mention:** _<list of "hot" files Claude should pull by path, e.g. `src/config/app.ts`, `prisma/schema.prisma`>_
- **Never @-mention (use grep instead):** _<files too large or volatile to load fully, e.g. `package-lock.json`, generated migrations>_

---

## MCP servers wired

Per the blog priority order, MCP servers should be wired **after** layers 1–5 (CLAUDE.md, hooks, skills, plugins, LSP) are stable. Each MCP server adds context cost on every session — only wire what you use weekly.

| Server | Purpose | Auth scope | Reviewed (date) |
|---|---|---|---|
| _<e.g. Sentry>_ | _<error/replay lookup for production incidents>_ | _<org-level read>_ | _<YYYY-MM-DD>_ |
| _<e.g. Microsoft Learn>_ | _<Azure/M365 docs grounding>_ | _<read-only>_ | _<YYYY-MM-DD>_ |
| _<e.g. Linear>_ | _<ticket reference (only if migrated off this kit)>_ | _<workspace read>_ | _<YYYY-MM-DD>_ |

Quarterly config-review (SOP §4): disconnect any MCP server not used since last review. Reconnect only when actually needed.

---

## Sub-agent mapping

Default `type_of_work → sub-agent` mapping used by `execute-story` and `execution-strategist` to pick a specialist. **These are suggestions — tune to your installed agents.** A story may override a row with its own `suggested_agents:` frontmatter.

> **Operator-editable.** Prune this table to the chosen project type (e.g. a `data-pipeline` project drops the `frontend` row and pre-fills the `data` row with a real specialist such as `data-engineer`, not the generic `general-purpose` placeholder). Any pruned row can be re-added by hand at any time without breaking the resolution chain — the map is advisory, not enforced. `general-purpose` remains the documented fallback so a missing or uninstalled specialist never hard-fails.

| `type_of_work` | Preferred sub-agent(s) — edit to match your install |
|---|---|
| `frontend` | `frontend-developer` / `react-expert` (or your UI specialist) |
| `backend` | `fullstack-developer` / `javascript-pro` (or your server specialist) |
| `infra` | `deployment-engineer` (CI/CD, build, release) |
| `data` | `general-purpose` (or a data / ETL specialist if installed) |
| `docs` | `technical-writer` (or `general-purpose`) |

**Resolution order:** a story's `suggested_agents:` (if set) → this map for its `type_of_work` → discipline-only / `general-purpose` fallback. An agent named here (or in `suggested_agents`) that **isn't installed** never hard-fails — the executor degrades to the next step. Specialist needs beyond the five disciplines (e.g. security, performance) belong in a story's `suggested_agents:` (e.g. `security-engineer`, `performance-engineer`), not a new `type_of_work` value. See SOP §11.3.

**Pruning reference — map shapes by project type:**

- **`data-pipeline`** — drops the `frontend` row (no UI surface); pre-fills the `data` row with a data/ETL specialist (e.g. `data-engineer`). Keeps `backend`, `infra`, `docs`.
- **`web-app`** — all five rows kept; `frontend` and `backend` pre-filled with UI/server specialists.
- **`backend-service`** — drops `frontend`; keeps `backend`, `infra`, `data`, `docs`.
- **`cli`** — drops `frontend`; keeps `backend` (implementation), `infra` (release packaging), `docs`; `data` optional.
- **`library`** — drops `frontend`; keeps `backend`, `docs`, `infra` (publishing); `data` optional.
- **`mobile`** — keeps `frontend` (mobile UI), `backend`, `infra`; `data`/`docs` as needed.
- **`power-platform`** — keeps `frontend` (Canvas/Model-driven), `backend`, `infra`, `docs`; `data` optional.
- **`automation`** — drops `frontend`; keeps `backend`, `infra`, `docs`; `data` optional.

A fresh install ships all five rows above as defaults and is never pre-pruned — prune it yourself once the project type is settled.

---

## Local development

- **Dev URL / port:** _<e.g. http://localhost:3000, or n/a — no server>_
- **API URL / port:** _<e.g. http://localhost:8080, or n/a>_
- **Reserved ports to avoid:** _<e.g. none, or 3000–3010 if on Windows + Hyper-V>_
- **Required env vars:** _<list, or point at .env.example, or "none">_
- **First-time setup:** _<commands to get a fresh clone running — use this project's own toolchain, not necessarily npm>_

```bash
# example — replace with this project's real commands
npm install
cp .env.example .env.local   # fill in secrets
npm run dev
```

---

## Quality commands — scoped per area

The DoD references these. **Scope each command to the smallest area that gives signal.** Running the full test suite on a one-service change is the blog's anti-pattern (causes timeouts, burns minutes that compound weekly). Define per-area variants so the close-out-story skill can pick the right one.

Cells take **this project's own toolchain** — `npm`, `pnpm`, `cargo`, `go`, `dotnet`, `uv`, `gradle`, `make`, or nothing at all. A cell that names a command this project does not have is worse than `n/a`: the DoD will cite it and it will fail. Write `n/a — <why>` when a column genuinely does not apply.

| Area / module | Lint | Type check | Unit tests | Integration | E2E | Build |
|---|---|---|---|---|---|---|
| **All / repo-wide** (DoD fallback) | _<lint command, or `n/a — no linter`>_ | _<type-check command, or `n/a — untyped`>_ | _<test command>_ | _<integration command, or n/a>_ | _<E2E command, or n/a>_ | _<build command, or `n/a — nothing to compile`>_ |
| _<e.g. `src/auth/`>_ | _<scoped lint>_ | _<scoped type check>_ | _<scoped tests>_ | _<n/a>_ | _<scoped E2E>_ | _<n/a — full build only>_ |
| _<**monorepo** e.g. `packages/api/`>_ | _<per-package lint>_ | _<per-package type check>_ | _<per-package tests>_ | _<n/a>_ | _<n/a>_ | _<per-package build>_ |

**PM lint** (always repo-wide): `npm run pm:lint`
**Board regen** (always repo-wide): `npm run pm:dash`

Rule of thumb: if a story only touches files under one area row, use that area's commands in the DoD checklist, not the "All" row. **In a monorepo, always scope to the affected package(s)** — the per-filter command is the rule, not the exception. See "Monorepo layout" below for the package map these rows scope to.

---

## Monorepo layout (if applicable)

> **[monorepo-only — skip if single-app]** If this project is a single application, write "n/a — single-app" here and skip to the next section. This section is canonical only for monorepos / multi-service host projects (per `CLAUDE-CODE-CONFIG.md` §2.1.2).

In a monorepo, this file stops being the canonical per-area table and becomes the **index**: project-wide context (shared env, account IDs, the package map below) stays here; anything local to one service moves into that service's own `CLAUDE.md`, dropped from `91-Templates/SUBDIR-CLAUDE.template.md` (purpose, owners, local test/lint commands, local conventions, `@-mention`-vs-grep guidance, ≤30 lines). See "Per-service `CLAUDE.md` index" at the end of this section.

- **Package manager:** _<pnpm | yarn | npm | bun | cargo | go | uv | poetry | gradle | maven | dotnet — pin the version>_
- **Workspace tool:** _<pnpm/yarn/npm workspaces | turbo | nx | lerna | bazel | cargo workspaces | `go work` | gradle multi-module | uv workspace | dotnet solution — and the config file>_
- **Workspace glob:** _<e.g. `packages/*`, `apps/*` + `packages/*`, `crates/*`, `./...`>_

### Service boundaries

One row per package/service. `package` = workspace name; `purpose` = one line; `consumers` = who imports it (other packages or "end-user" for deployables).

| Package | Purpose | Consumers |
|---|---|---|
| _<e.g. `@org/shared`>_ | _<shared types, constants, utilities>_ | _<all other packages>_ |
| _<e.g. `@org/database`>_ | _<schema + migrations; generates types into the app>_ | _<`@org/api`, `@org/web`>_ |
| _<e.g. `@org/api`>_ | _<backend service / worker>_ | _<end-user (deployable)>_ |
| _<e.g. `@org/web`>_ | _<frontend app>_ | _<end-user (deployable)>_ |

### Cross-service dependencies

- **Internal dependency edges:** _<list the `x → y` edges, or point at the workspace graph command>_
- **Shared config:** _<where shared lint/format/type config lives, e.g. `tooling/` or root>_
- **Version policy for internal deps:** _<workspace-local (always latest) | pinned | other>_

### Build-order rules

- **Dependency-ordered build:** _<e.g. "the workspace tool resolves order from the graph; never build a consumer before its dependency">_
- **Compile-before-consume packages:** _<which packages emit artefacts that must exist before consumers build/type-check>_
- **Codegen steps:** _<e.g. "the database package generates types into the web app — run codegen before type-checking web">_

#### Cross-service dependency: order matters

For **compiled** workspaces (TypeScript project refs, Rust crates, Go modules, Gradle modules, .NET projects), a consumer can't type-check or build until its dependency's artefacts exist. List the edges where order is load-bearing — get this wrong and you get phantom "cannot find module" errors that look like missing deps but are really a stale/absent build output.

| Lang | Consumer | Dependency | Build-before |
|---|---|---|---|
| _<e.g. TypeScript>_ | _<`@org/web`>_ | _<`@org/shared`>_ | _<the command that emits the artefact web consumes>_ |
| _<e.g. Rust>_ | _<`app`>_ | _<`core`>_ | _<`cargo build -p core`>_ |

(Interpreted-only workspaces — pure JS or pure Python, no emit — can usually skip this table: there's no artefact to build before consuming. Keep it only if a codegen step creates a real ordering constraint.)

#### Per-service `CLAUDE.md` index

Monorepos drop one `CLAUDE.md` per service (from `91-Templates/SUBDIR-CLAUDE.template.md`); this file is the index pointing at them. A session launched inside a service loads only that service's `CLAUDE.md` plus the lean root — not this whole file (`CLAUDE-CODE-CONFIG.md` §2.1.3).

| Package | Subdir `CLAUDE.md` path | Notes |
|---|---|---|
| _<e.g. `@org/web`>_ | _<`apps/web/CLAUDE.md`>_ | _<local conventions: e.g. "tests here use Playwright, not Jest">_ |
| _<e.g. `@org/shared`>_ | _<`packages/shared/CLAUDE.md`>_ | _<compiled lib — its build output must exist before consumers build>_ |

---

## Visual / design system [UI-only]

Skip if project type is `cli`, `library`, `backend-service`, `data-pipeline`, or `automation`.

- **Design tokens file:** _<path, e.g. src/styles/tokens.css>_
- **Component library / Storybook:** _<URL or path>_
- **Brand guidelines:** _<path or URL>_
- **Visual regression test setup:** _<framework, e.g. Playwright pixel diff, Percy>_

---

## Library distribution [lib-only]

Skip if project type is not `library`.

- **Registry:** _<npm | PyPI | crates.io | NuGet | Maven Central | other>_
- **Package name:** _<published name>_
- **Versioning policy:** _<SemVer strict | calendar versioning | other>_
- **Public API surface:** _<one paragraph describing what's exported; what's internal>_
- **Breaking-change criteria:** _<what triggers a major bump>_
- **Consumer projects:** _<list of known consumers, internal or external>_

---

## Pipeline schedule [data-pipeline-only]

Skip if project type is not `data-pipeline`.

- **Orchestrator:** _<Airflow | Dagster | Prefect | dbt Cloud | cron | other>_
- **Trigger:** _<cron schedule | event-based | on-demand>_
- **Source systems:** _<list>_
- **Sink / destination:** _<list>_
- **SLA:** _<latency requirements, e.g. "daily by 8am UTC">_
- **Idempotency strategy:** _<how reruns are safe>_
- **Backfill procedure:** _<how to replay a date range>_

---

## Power Platform environment [power-platform-only]

Skip if project type is not `power-platform`.

- **Environments:** _<Dev / Test / Prod tenant URLs>_
- **Solution name:** _<solution containing the artefacts>_
- **Connectors used:** _<list, with auth types — custom connector, certified, etc.>_
- **DLP policies in effect:** _<link or summary — what crosses the business/non-business line>_
- **Dataverse tables touched:** _<list>_
- **Power Automate flows:** _<count + naming convention>_
- **Power Apps screens:** _<count if Canvas, count + entities if Model-driven>_

---

## CLI distribution [cli-only]

Skip if project type is not `cli`.

- **Binary name:** _<command users invoke>_
- **Distribution channel:** _<homebrew | apt | choco | curl-bash installer | npm global | other>_
- **Supported platforms:** _<macOS | Linux | Windows — list arches>_
- **Shell completion:** _<bash | zsh | fish | pwsh — which generated, where>_
- **Config file location:** _<XDG path | $HOME/.<tool> | other>_

---

## Known stack gotchas

Document anything that has bitten **you, on this project**, and would bite a junior dev. Each entry: symptom → cause → fix. Start empty and add entries as they happen — an inherited list from another project is noise a session will act on.

- _<symptom>_ — caused by _<root cause>_. Fix: _<commands or doc link>_.

Shape to aim for (illustrations only — delete them):
- A runtime is missing from the shell PATH the tests run under. Symptom: `command not found` / exit 127. Fix: put it on PATH before re-running, or invoke its absolute binary — never silently substitute a different command.
- A generated file is committed by hand and the next regeneration conflicts. Fix: gitignore it and regenerate locally.

---

## Conventions

- **Commit messages:** _<Conventional Commits | semantic | freeform>_
- **Branch naming:** _<feature/<slug> | <author>/<slug> | none>_
- **PR review:** _<solo merge | requires Claude review | other>_
- **Deployment trigger:** _<merge to main | manual | tag>_

---

## External integrations

- **Payments:** _<provider + docs URL, or none>_
- **Email:** _<provider + sender domain, or none>_
- **SMS:** _<provider, or none>_
- **Storage:** _<provider + bucket(s), or none>_
- **CDN:** _<provider, or none>_

---

## Claude Code exclusions

What Claude should NOT read or grep when working in this project. Lives in `.claudeignore` at the repo root (template ships with the kit at `_00-Project-Management/.claudeignore`).

> **Read-exclusion is not execution-block.** `.claudeignore` only stops Claude *reading* these paths — it does not stop a tool acting on them. To hard-block destructive *commands* (e.g. `rm -rf`, `git push --force`, `.env` writes) use `.claude/settings.json` `permissions.deny` (a baseline ships at `91-Templates/CLAUDE-SETTINGS.template.json`). For the full three-layer model — ignore (don't read) vs deny (can't execute) vs hooks (programmatic intercept) — see `90-Standards/CLAUDE-CODE-CONFIG.md` §2.1.1 "Three-layer filtering".

- **Generated / build output:** _<e.g. `dist/`, `build/`, `out/`, `target/`, `bin/`, `obj/`, `.next/`, `coverage/`>_
- **Third-party deps:** _<e.g. `node_modules/`, `.venv/`, `vendor/`, `__pycache__/`, `.gradle/`>_
- **Secrets / local-only:** _<e.g. `.env*`, `*.pem`, `*.key`>_
- **Large data fixtures:** _<e.g. `tests/fixtures/large-*.json`>_
- **Auto-generated boards:** _<`_00-Project-Management/42-Monitor/DASHBOARD.html`>_

Review `.claudeignore` quarterly. Bloat in main-thread context usually traces back to a missing exclusion.

---

## Out-of-scope / explicit non-goals

What this project will explicitly NOT do, to prevent scope creep. Founder-hat decision — lift these from `00-Strategy/NORTH-STAR.md` once it exists rather than inventing them here.

- _<bullet>_

---

## Deviations from the standard SOP

If anything in the standard kit doesn't fit this project, document the deviation here with rationale. Don't silently bend the rules.

- _<rule>_ — deviation: _<what>_. Reason: _<why>_. Decided: _<YYYY-MM-DD>_.

---

## Last reviewed

Update each quarter or whenever the stack changes.

- _<YYYY-MM-DD>_ — _<one-line summary of what changed>_
