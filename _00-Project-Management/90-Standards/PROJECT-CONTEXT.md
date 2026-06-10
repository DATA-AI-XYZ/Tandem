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

> **Operator-editable.** Bootstrap prunes this table to the chosen project type (e.g. a `data-pipeline` project drops the `frontend` row and pre-fills the `data` row with a real specialist such as `data-engineer`, not the generic `general-purpose` placeholder). Any pruned row can be re-added by hand at any time without breaking the resolution chain — the map is advisory, not enforced. `general-purpose` remains the documented fallback so a missing or uninstalled specialist never hard-fails.

| `type_of_work` | Preferred sub-agent(s) — edit to match your install |
|---|---|
| `frontend` | `frontend-developer` / `react-expert` (or your UI specialist) |
| `backend` | `fullstack-developer` / `javascript-pro` (or your server specialist) |
| `infra` | `deployment-engineer` (CI/CD, build, release) |
| `data` | `general-purpose` (or a data / ETL specialist if installed) |
| `docs` | `technical-writer` (or `general-purpose`) |

**Resolution order:** a story's `suggested_agents:` (if set) → this map for its `type_of_work` → discipline-only / `general-purpose` fallback. An agent named here (or in `suggested_agents`) that **isn't installed** never hard-fails — the executor degrades to the next step. Specialist needs beyond the five disciplines (e.g. security, performance) belong in a story's `suggested_agents:` (e.g. `security-engineer`, `performance-engineer`), not a new `type_of_work` value. See SOP §11.3 / ADR-0023.

**Bootstrap pruning reference — produced map shapes by project type:**

- **`data-pipeline`** — drops the `frontend` row (no UI surface); pre-fills the `data` row with a data/ETL specialist (e.g. `data-engineer`). Keeps `backend`, `infra`, `docs`.
- **`web-app`** — all five rows kept; `frontend` and `backend` pre-filled with UI/server specialists.
- **`backend-service`** — drops `frontend`; keeps `backend`, `infra`, `data`, `docs`.
- **`cli`** — drops `frontend`; keeps `backend` (implementation), `infra` (release packaging), `docs`; `data` optional.
- **`library`** — drops `frontend`; keeps `backend`, `docs`, `infra` (publishing); `data` optional.
- **`mobile`** — keeps `frontend` (mobile UI), `backend`, `infra`; `data`/`docs` as needed.
- **`power-platform`** — keeps `frontend` (Canvas/Model-driven), `backend`, `infra`, `docs`; `data` optional.
- **`automation`** — drops `frontend`; keeps `backend`, `infra`, `docs`; `data` optional.

The unbootstrapped scaffold ships all five rows above as defaults. Bootstrap edits this table in-place; the committed scaffold is never pre-pruned.

---

## Local development

- **Dev URL / port:** _<e.g. http://localhost:3000>_
- **API URL / port:** _<e.g. http://localhost:8080>_
- **Reserved ports to avoid:** _<e.g. none, or 3000–3010 if on Windows + Hyper-V>_
- **Required env vars:** _<list, or point at .env.example>_
- **First-time setup:** _<commands to get a fresh clone running>_

```bash
# example
npm install
cp .env.example .env.local   # fill in secrets
npm run dev
```

---

## Quality commands — scoped per area

The DoD references these. **Scope each command to the smallest area that gives signal.** Running the full test suite on a one-service change is the blog's anti-pattern (causes timeouts, burns minutes that compound weekly). Define per-area variants so the close-out-story skill can pick the right one.

| Area / module | Lint | Type check | Unit tests | Integration | E2E | Build |
|---|---|---|---|---|---|---|
| **All / repo-wide** (DoD fallback) | _<`npm run lint`>_ | _<`npm run typecheck`>_ | _<`npm test`>_ | _<`npm run test:integration`>_ | _<`npx playwright test`>_ | _<`npm run build`>_ |
| _<e.g. `src/auth/`>_ | _<`npm run lint -- src/auth`>_ | _<`tsc --noEmit -p src/auth/tsconfig.json`>_ | _<`npm test -- --testPathPattern=auth`>_ | _<n/a>_ | _<`npx playwright test tests/auth.spec.ts`>_ | _<n/a — full build only>_ |
| _<e.g. `src/admin/`>_ | _<`npm run lint -- src/admin`>_ | _<…>_ | _<`npm test -- --testPathPattern=admin`>_ | _<…>_ | _<`npx playwright test tests/admin.spec.ts`>_ | _<n/a>_ |
| _<**monorepo** e.g. `packages/api/` (pnpm)>_ | _<`pnpm --filter @org/api lint`>_ | _<`pnpm --filter @org/api type-check`>_ | _<`pnpm --filter @org/api test`>_ | _<n/a>_ | _<n/a>_ | _<`pnpm --filter @org/api build`>_ |
| _<**monorepo** e.g. `apps/web/` (turbo / nx)>_ | _<`turbo run lint --filter=web`>_ | _<`turbo run type-check --filter=web`>_ | _<`turbo run test --filter=web`>_ | _<…>_ | _<`turbo run test:e2e --filter=web`>_ | _<`turbo run build --filter=web`>_ |

**PM lint** (always repo-wide): `npm run pm:lint`
**Dashboard regen** (always repo-wide): `npm run pm:dash`

Rule of thumb: if a story only touches files under one area row, use that area's commands in the DoD checklist, not the "All" row. **In a monorepo, always scope to the affected package(s)** — the per-filter command is the rule, not the exception (running the whole `turbo run test` graph on a one-package change is the blog's anti-pattern). See "Monorepo layout" below for the package map these rows scope to.

---

## Monorepo layout (if applicable)

> **[monorepo-only — skip if single-app]** If this project is a single application, write "n/a — single-app" here and skip to the next section. This section is canonical only for monorepos / multi-service host projects (per `CLAUDE-CODE-CONFIG.md` §2.1.2 and [ADR-0009](../40-Decisions/ADR-0009-central-vs-distributed-claudemd.md)).

In a monorepo, this file stops being the canonical per-area table and becomes the **index**: project-wide context (shared env, account IDs, the package map below) stays here; anything local to one service moves into that service's own `CLAUDE.md`, dropped from the kit's `scaffold/91-Templates/SUBDIR-CLAUDE.template.md` (purpose, owners, local test/lint commands, local conventions, `@-mention`-vs-grep guidance, ≤30 lines). See "Per-service `CLAUDE.md` index" at the end of this section.

- **Package manager:** _<pnpm | yarn | npm | bun — pin the version, e.g. `pnpm@8.12.1`>_
- **Workspace tool:** _<pnpm workspaces | yarn workspaces | npm workspaces | turbo | nx | lerna | bazel — and the config file, e.g. `pnpm-workspace.yaml` + `turbo.json`>_
- **Workspace glob:** _<e.g. `packages/*`, `apps/*` + `packages/*`>_

### Service boundaries

One row per package/service. `package` = workspace name; `purpose` = one line; `consumers` = who imports it (other packages or "end-user" for deployables).

| Package | Purpose | Consumers |
|---|---|---|
| _<e.g. `@org/shared`>_ | _<shared TS types, constants, utilities — compiled to `dist/`>_ | _<all other packages>_ |
| _<e.g. `@org/database`>_ | _<schema + migrations; generates types into the app>_ | _<`@org/api`, `@org/web`>_ |
| _<e.g. `@org/api`>_ | _<backend service / worker>_ | _<end-user (deployable)>_ |
| _<e.g. `@org/web`>_ | _<frontend app>_ | _<end-user (deployable)>_ |

### Cross-service dependencies

- **Internal dependency edges:** _<list the `@org/x → @org/y` edges, or "see workspace graph: `pnpm ls -r --depth -1`">_
- **Shared config:** _<where shared `tsconfig`, `eslint`, `prettier` live, e.g. `tooling/` or root>_
- **Version policy for internal deps:** _<`workspace:*` (always latest local) | pinned | other>_

### Build-order rules

- **Dependency-ordered build:** _<e.g. "`turbo run build` resolves order from the graph; never build a consumer before its dependency">_
- **Compile-before-consume packages:** _<which packages emit artefacts (e.g. `@org/shared` → `dist/`) that must exist before consumers build/type-check>_
- **Codegen steps:** _<e.g. "`@org/database` generates types into `@org/web` — run `db:types:generate` before type-checking web">_

#### Cross-service dependency: order matters

For **compiled** monorepos (TypeScript project refs, Rust crates, Go modules, etc.), a consumer can't type-check or build until its dependency's artefacts exist. List the edges where order is load-bearing — get this wrong and you get phantom "cannot find module `@org/shared`" errors that look like missing deps but are really a stale/absent build output.

| Lang | Consumer | Dependency | Build-before |
|---|---|---|---|
| _<e.g. TypeScript>_ | _<`@org/web`>_ | _<`@org/shared`>_ | _<`pnpm --filter @org/shared build` (emits `dist/` consumed by web)>_ |
| _<e.g. TypeScript>_ | _<`@org/web`>_ | _<`@org/database` (codegen)>_ | _<`pnpm --filter @org/database types:generate`>_ |

(Interpreted-only monorepos — pure JS, no emit — can usually skip this table: there's no artefact to build before consuming. Keep it only if a codegen step creates a real ordering constraint.)

#### Per-service `CLAUDE.md` index

Monorepos drop one `CLAUDE.md` per service (from `scaffold/91-Templates/SUBDIR-CLAUDE.template.md`); this file is the index pointing at them. A session launched inside a service loads only that service's `CLAUDE.md` plus the lean root — not this whole file (`CLAUDE-CODE-CONFIG.md` §2.1.3).

| Package | Subdir `CLAUDE.md` path | Notes |
|---|---|---|
| _<e.g. `@org/web`>_ | _<`apps/web/CLAUDE.md`>_ | _<local conventions: e.g. "tests here use Playwright, not Jest">_ |
| _<e.g. `@org/shared`>_ | _<`packages/shared/CLAUDE.md`>_ | _<compiled lib — `dist/` must exist before consumers build>_ |

> **Worked example (a pnpm + turbo monorepo).** `pnpm@8.12.1` + `turbo`, workspace glob `packages/*`. Packages: `@acme/shared` (TS types/utils → `tsc` to `dist/`, consumed by all), `@acme/database` (schema + `types:generate` into webapp), `@acme/webapp` (Next.js deployable), `@acme/workflows` (automation). Build order: `turbo run build --filter=shared` first (webapp can't type-check until `@acme/shared/dist` exists), then `db:types:generate`, then `webapp:build`. Scoped command example: `pnpm --filter @acme/webapp test:e2e`. Each package would carry its own `CLAUDE.md`; this file indexes them.

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

Document anything that has bitten you and would bite a junior dev. Each entry: symptom → cause → fix.

- _<symptom>_ — caused by _<root cause>_. Fix: _<commands or doc link>_.
- `npm run pm:smoke` exits 2 / "no browser found" or "needs Node >=22" — the headless dashboard smoke (`93-Scripts/smoke-dashboard.js`) drives the **already-installed system Chrome/Chromium/Edge** over the DevTools Protocol with **zero npm dependencies** (no Puppeteer/Playwright — see [ADR-0038](../40-Decisions/ADR-0038-zero-dep-cdp-headless-smoke.md)). It needs (a) a Chrome/Chromium/Edge binary on the runner — override the path with `SMOKE_CHROME=<path>` — and (b) Node ≥22 (it uses the global `WebSocket`). On a browserless runner it exits **2 = BLOCKED** (not a render failure), which is why `pm:smoke` is deliberately **not** chained into `pm:all`. Run it as `npm run pm:dash && npm run pm:smoke`.
- A test-command runtime (`node` / `npm` / a linter) may not be on the shell PATH the test runs under — notably **Git Bash on Windows** *and* (observed 2026-06-01) the **default PowerShell session** on this box, both of which omit the Node install dir `C:\Program Files\nodejs`. Symptom: `exit 127` / `command not found` (Git Bash) or `npm: The term 'npm' is not recognized` (PowerShell). Fix: put the runtime on PATH **before re-running** — bash `export PATH="/c/Program Files/nodejs:$PATH"`, PowerShell `$env:PATH = 'C:\Program Files\nodejs;' + $env:PATH` — or invoke its absolute binary. Practical split for the pm:* / testplan render TCs: **run the render (`npm run pm:docs` / `pm:dash`) in PowerShell with the PATH prepended, run the POSIX-`grep` assertions in Git Bash.** Never silently substitute a different command (a testplan `Command:` must run verbatim; resolving the runtime is environment setup, not improvising the command).
- A doc that gets shipped must not relative-link a non-shipped artefact. If a build/packaging step ships only a subset of the repo (e.g. a `skills/` bundle **without** `_00-Project-Management/`), any doc in that subset must reference ADRs / reports by **ID in prose** (e.g. "ADR-0045"), not a relative path link into the non-shipped folder — the link dangles wherever the target file isn't present.
- A static-analysis testplan TC that greps `93-Scripts/generate-dashboard.js` source matches **comment text, not just code** — caused by source-text assertions (`src.search(/…/)` + a char-window, or a bare `/tokenCost\s*\(/` test) being blind to whether a hit is code or a doc comment. Symptom: a TC FAILs (or false-PASSes) against a *correct* implementation because of comment wording. Fix: anchor source windows on the **function definition** (`indexOf('function foo')`), not the first textual mention; and when authoring the helper's doc comment, **don't write the exact token the TC greps for** (e.g. don't put `foo()` or `foo (` in a comment a `/foo\s*\(/` guard scans). Precedent: BUG-20260528-01/02, BUG-20260531-01.
- Bulk-editing markdown frontmatter / checkboxes / sections with Perl: two traps on this **CRLF** repo. (1) Referencing outer `$1`/`$2` **after** an inner `s|…|…|g` in the same replacement silently clobbers them (Perl resets capture vars on every match) — it once dropped a `## Technical notes` heading. (2) `\n`-anchored regexes miss because lines end `\r\n`. Fix: prefer the **Edit tool** for surgical changes; for a `done` story, a whole-file `- [ ] → - [x]` pass is safe; if you must use Perl, don't reuse captures across an inner `s///`, and match line ends as `\r?\n`. Always re-read the file after a bulk edit to confirm headings survived.

Examples of what goes here (from prior projects, replace with actuals):
- Node/npm not on PATH in bash sessions — bash PATH doesn't include `/c/Program Files/nodejs`. Fix: `export PATH="/c/Program Files/nodejs:$PATH"`.
- Specific ESLint plugin not installed — suppressing the rule causes lint errors. Always restructure the code instead.
- Firebase CLI uses cached OAuth, ignores `GOOGLE_APPLICATION_CREDENTIALS`. Reauth via `firebase login --reauth` when cache expires.

---

## Conventions

- **Commit messages:** _<Conventional Commits | semantic | freeform>_
- **Branch naming:** _<feature/<slug> | <author>/<slug> | none>_
- **PR review:** _<solo merge | requires Claude review | other>_
- **Deployment trigger:** _<merge to main | manual | tag>_

---

## External integrations

- **Payments:** _<provider + docs URL>_
- **Email:** _<provider + sender domain>_
- **SMS:** _<provider>_
- **Storage:** _<provider + bucket(s)>_
- **CDN:** _<provider>_

---

## Claude Code exclusions

What Claude should NOT read or grep when working in this project. Lives in `.claudeignore` at the repo root (template ships with the kit at `_00-Project-Management/.claudeignore`).

> **Read-exclusion is not execution-block.** `.claudeignore` only stops Claude *reading* these paths — it does not stop a tool acting on them. To hard-block destructive *commands* (e.g. `rm -rf`, `git push --force`, `.env` writes) use `.claude/settings.json` `permissions.deny` (baseline ships at `scaffold/.claude/settings.json`). For the full three-layer model — ignore (don't read) vs deny (can't execute) vs hooks (programmatic intercept) — see `90-Standards/CLAUDE-CODE-CONFIG.md` §2.1.1 "Three-layer filtering".

- **Generated code:** _<e.g. `dist/`, `build/`, `.next/`, `coverage/`>_
- **Third-party deps:** _<e.g. `node_modules/`, `.venv/`, `vendor/`>_
- **Secrets / local-only:** _<e.g. `.env*`, `*.pem`, `*.key`>_
- **Large data fixtures:** _<e.g. `tests/fixtures/large-*.json`>_
- **Auto-generated dashboards:** _<`_00-Project-Management/42-Monitor/DASHBOARD.html`>_

Review `.claudeignore` quarterly. Bloat in main-thread context usually traces back to a missing exclusion.

---

## Out-of-scope / explicit non-goals

What this project will explicitly NOT do, to prevent scope creep. Founder-hat decision.

- _<bullet>_

---

## Deviations from the standard SOP

If anything in the standard kit doesn't fit this project, document the deviation here with rationale. Don't silently bend the rules.

- _<rule>_ — deviation: _<what>_. Reason: _<why>_. Decided: _<YYYY-MM-DD>_.

---

## Last reviewed

Update each quarter or whenever the stack changes.

- _<YYYY-MM-DD>_ — _<one-line summary of what changed>_
