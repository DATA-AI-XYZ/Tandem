# BOOTSTRAP-PROMPT — paste-prompt installer for the Tandem

This is the **paste-prompt** distribution path for the kit. Use it when you don't have
plugin-install access (`claude plugin install …`) or you want a full interactive
discovery Q&A before any files land. It produces the **same on-disk result** as the
plugin: a `_00-Project-Management/` PM folder, a root `CLAUDE.md`, `.claudeignore`,
`.claude/settings.json`, and a generated `CODEBASE-MAP.md`.

> **Self-contained:** everything this installer needs lives in the
> `Tandem` repo's `_00-Project-Management/` directory — the canonical
> tooling (`93-Scripts/`, driven by `93-Scripts/lib/pm-manifest.json`), templates
> (`91-Templates/`), and standards (`90-Standards/`). There is no separate `scaffold/`
> tree (retired, ADR-0074): `install.js` **materializes** the PM tree + scripts + seed
> files from the manifest at install time.

---

## How to use

1. Open Claude Code (or claude.ai/code) **at the root of the target project**.
2. Make the kit available in one of these ways:
   - the `Tandem` repo is cloned somewhere locally (point Claude at it), **or**
   - clone it: `git clone https://github.com/DATA-AI-XYZ/Tandem`
3. Paste everything in the **PROMPT** block below into Claude and answer the questions.

---

## PROMPT — paste from here

```
You are installing the Tandem into THIS project. The kit's source files live
in the cloned `Tandem` repo under `_00-Project-Management/` (call it
<KIT>). Its `93-Scripts/install.js` materializes the PM tree from `93-Scripts/lib/
pm-manifest.json`. Work through the four phases below in order. Announce the PM hat at
the start. Do not skip the preflight.

### Phase 0 — Preflight (collision detection)

Check the target project root for each of these and report what you find BEFORE writing anything:
- `_00-Project-Management/` — if it exists, ask: **merge** (install is additive — kit-owned files refresh, user-owned files are never overwritten), or **abort**. `install.js` is idempotent + non-destructive, so a re-run is safe.
- root `CLAUDE.md` — if it exists, you will APPEND the kit block under a `<!-- PM-KIT-BLOCK -->` marker (never clobber the operator's content); if absent, create from `<KIT>/91-Templates/ROOT-CLAUDE.template.md`.
- `.claude/settings.json` — if it exists, you will APPEND only the missing `permissions.deny` rules (never overwrite, never weaken); if absent, create from `<KIT>/91-Templates/CLAUDE-SETTINGS.template.json`. (install.js also guard-registers the kit hooks into it.)
- `.claudeignore` — if absent, create the project-root `.claudeignore` from `<KIT>/91-Templates/CLAUDEIGNORE.template`.

Stop and wait for the merge/abort answer if `_00-Project-Management/` already exists.

### Phase 1 — Discovery (drives PROJECT-CONTEXT.md)

Ask these, one batch, then fill `90-Standards/PROJECT-CONTEXT.md` from the answers:

1. **Project identity** — name, client/owner, repo URL, stage (pre-launch / beta / production), primary contact.
2. **Folder layout** — canonical numbered layout (`full`, recommended) or `flattened`? **If the target already has PM folders on disk, auto-detect first**: run `node <KIT>/93-Scripts/lib/pm-paths.js detect <target-pm-dir>` — it prints `full` or `flattened` from the folders that exist, or an explicit `no layout detected — defaulting to 'full'` fallback (never a silent guess; on a tie `full` wins). Pass it as `install.js --layout <full|flattened>` in Phase 2. `install.js` pins the choice in the project root's `.claude-pm-config.json` (`"layout"`) and writes `90-Standards/pm-paths.json`.
3. **Project type** (pick one — drives the gotcha block injected in Phase 3):
   `web-app` · `mobile` · `cli` · `library` · `backend-service` · `data-pipeline` · `power-platform` · `automation` · `other`.
4. **Tech stack** — language(s), framework(s), runtime/version, database, auth, hosting, CI/CD, error tracking, analytics.
5. **Local dev** — dev URL/port, API URL/port, reserved ports to avoid, required env vars, first-time setup commands.
6. **Quality commands** — lint / typecheck / unit / integration / e2e / build, scoped per area where possible (these feed the DoD).
7. **Code intelligence** — any LSP servers to run? `@-mention` hot files? MCP servers used weekly?
8. **Deny additions** — "Any project-specific tools/commands Claude should NEVER run without explicit approval?" → append as `permissions.deny` rules under the operator-additions section of `.claude/settings.json`.

### Phase 2 — Materialize the kit (install.js does the work)

1. Run `node <KIT>/93-Scripts/install.js --target . [--layout <full|flattened>]`. This **materializes** the whole PM tree from the manifest into the target: creates every work-dir, copies the seed files under the kit/user ownership rule (kit-owned overwritten; user-owned written only when absent — never clobbers your work), **ships the `93-Scripts/` tooling**, merges every `pm:*` script into the project's root `package.json` (idempotent), pins the layout in `.claude-pm-config.json` (+ `kitVersion`), writes `90-Standards/pm-paths.json`, guard-registers the kit's Claude Code hooks into `.claude/settings.json` (only when the target has none — ADR-0055), and generates the dashboard. It prints the dashboard path on success.
2. Root `CLAUDE.md`: create from `<KIT>/91-Templates/ROOT-CLAUDE.template.md` (or append its `<!-- PM-KIT-BLOCK -->` under the marker if a CLAUDE.md exists). Keep it ≤30 lines.
3. `.claudeignore`: if absent, create from `<KIT>/91-Templates/CLAUDEIGNORE.template`.
4. `.claude/settings.json`: if absent, create from `<KIT>/91-Templates/CLAUDE-SETTINGS.template.json`; if present, append only the missing deny rules. Then add the Phase-1 Q8 deny rules.

### Phase 3 — Generate + tailor

1. Run `npm run pm:map` to generate `CODEBASE-MAP.md` (fill the purpose/owner columns from what you learned in Phase 1; the row format is in `91-Templates/CODEBASE-MAP.template.md`).
2. Fill `90-Standards/PROJECT-CONTEXT.md`: set the project-type checkbox, paste the stack/ports/env answers, and keep only the gotcha block for the chosen type (mark the rest "n/a for this project type").
3. **Prune and pre-fill the `## Sub-agent mapping` table** in `90-Standards/PROJECT-CONTEXT.md` to match the chosen project type:
   - Keep only the `type_of_work` rows on-stack for the chosen type; drop off-stack rows.
   - Pre-fill on-stack rows with a real specialist agent name where a natural specialist exists.
   - Per-type pruning guide:
     - `data-pipeline` — drop `frontend`; pre-fill `data` with a data/ETL specialist; keep `backend`, `infra`, `docs`.
     - `web-app` — keep all five; pre-fill `frontend` + `backend`.
     - `backend-service` — drop `frontend`; keep `backend`, `infra`, `data`, `docs`.
     - `cli` — drop `frontend`; keep `backend`, `infra`, `docs`; `data` optional.
     - `library` — drop `frontend`; keep `backend`, `docs`; `infra`/`data` optional.
     - `mobile` — keep `frontend` (mobile UI), `backend`, `infra`; `data`/`docs` as needed.
     - `power-platform` — keep `frontend` (Canvas/Model-driven), `backend` (connector/flow), `infra`, `docs`; `data` optional.
     - `automation` — drop `frontend`; keep `backend`, `infra`, `docs`; `data` optional.
     - `other` — keep the rows relevant to the described stack; document the rationale.
   - **`general-purpose` stays the documented fallback**: if no specialist is installed, the executor degrades gracefully; never hard-fails.
   - Pruning is non-destructive; the operator can re-add any dropped row by hand without breaking resolution.
   - Do NOT touch the `## Sub-agent mapping` heading, the `Resolution order` prose, or the section-contract footnote.
4. Fill the root `CLAUDE.md` `<!-- CRITICAL-GOTCHAS -->` (≤4 entries — dev port, a required env var, a stack quirk).

### Phase 4 — Verify

1. `npm run pm:lint` → must report 0 violations. Fix any frontmatter issues it flags.
2. `npm run pm:doctor` → it must report healthy (core scripts wired, layout resolved, kit version current).
3. `npm run pm:dash` → confirm `_00-Project-Management/42-Monitor/DASHBOARD.html` is written.
4. Open `90-Standards/SOP.md` §17 and `90-Standards/DAILY-WORKFLOW.md` to orient on day-to-day use.
5. Report: what was created/merged, the project type chosen, any deny rules added, and the next step (draft the first Epic, or `/Tandem:draft-epic` if the plugin is also installed).
6. Pull future kit improvements with `npm run pm:update` (non-destructive — refreshes kit-owned files only; never your work).

Honour the kit's rules throughout: closed 9-value status enum, quoted ISO-8601 timestamps
(system clock, not chat-stated date), every Story gets a paired Testplan, one hat per session.
```

## PROMPT — paste to here

---

## What you get

| Artefact | Source | Lands at |
|---|---|---|
| PM folder + tooling | materialized by `install.js` from `93-Scripts/lib/pm-manifest.json` | `_00-Project-Management/` |
| Root CLAUDE.md | `91-Templates/ROOT-CLAUDE.template.md` | `CLAUDE.md` (or appended block) |
| Read-exclusions | `91-Templates/CLAUDEIGNORE.template` | `.claudeignore` |
| Permission deny baseline | `91-Templates/CLAUDE-SETTINGS.template.json` | `.claude/settings.json` (or appended rules) |
| Codebase map | generated by `pm:map` | `CODEBASE-MAP.md` |

## Relationship to the plugin path

Both paths produce the same result. Use the **plugin** (`claude plugin install
github:DATA-AI-XYZ/Tandem`) when you have install
access and want zero-friction setup + the model-invoked skills (incl. `/Tandem:install`
and `/Tandem:update`). Use **this paste-prompt** when you don't, or you want the
interactive discovery first. If both are used, this installer's Phase 0 detects the
existing `_00-Project-Management/` and asks before touching it. Either way, `install.js`
materializes the same tree from the same manifest — there is no separate scaffold to drift.
