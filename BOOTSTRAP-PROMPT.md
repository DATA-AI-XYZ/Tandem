# BOOTSTRAP-PROMPT — paste-prompt installer for the Tandem

This is the **paste-prompt** distribution path for the kit. Use it when you don't have
plugin-install access (`claude plugin install …`) or you want a full interactive
discovery Q&A before any files land. It produces the **same on-disk result** as the
plugin: a `_00-Project-Management/` PM folder, a root `CLAUDE.md`, `.claudeignore`,
`.claude/settings.json`, and a generated `CODEBASE-MAP.md`.

> **Self-contained:** everything this installer needs lives in the
> `Tandem` repo's `scaffold/` directory. It does not depend on any
> other project.

---

## How to use

1. Open Claude Code (or claude.ai/code) **at the root of the target project**.
2. Make the kit's `scaffold/` available in one of these ways:
   - the `Tandem` repo is cloned somewhere locally (point Claude at its `scaffold/`), **or**
   - clone it: `git clone https://github.com/DATA-AI-XYZ/Tandem`
3. Paste everything in the **PROMPT** block below into Claude and answer the questions.

---

## PROMPT — paste from here

```
You are installing the Tandem into THIS project. The kit's source files
live in the `Tandem` repo under `scaffold/`. Work through the four
phases below in order. Announce the PM hat at the start. Do not skip the preflight.

### Phase 0 — Preflight (collision detection)

Check the target project root for each of these and report what you find BEFORE writing anything:
- `_00-Project-Management/` — if it exists, ask: **merge** (add missing files only, never overwrite), **overwrite** (replace kit files, keep my artefacts), or **abort**.
- root `CLAUDE.md` — if it exists, you will APPEND the kit block under a `<!-- PM-KIT-BLOCK -->` marker (never clobber the operator's content); if absent, create from `scaffold/91-Templates/ROOT-CLAUDE.template.md`.
- `.claude/settings.json` — if it exists, you will APPEND only the missing `permissions.deny` rules (never overwrite, never weaken); if absent, copy `scaffold/.claude/settings.json`.
- `.claudeignore` — if absent, copy `scaffold/_00-Project-Management/.claudeignore` to the project root.

Stop and wait for the merge/overwrite/abort answer if `_00-Project-Management/` already exists.

### Phase 1 — Discovery (drives PROJECT-CONTEXT.md)

Ask these, one batch, then fill `90-Standards/PROJECT-CONTEXT.md` from the answers:

1. **Project identity** — name, client/owner, repo URL, stage (pre-launch / beta / production), primary contact.
2. **Project type** (pick one — drives the gotcha block injected in Phase 3):
   `web-app` · `mobile` · `cli` · `library` · `backend-service` · `data-pipeline` · `power-platform` · `automation` · `other`.
3. **Tech stack** — language(s), framework(s), runtime/version, database, auth, hosting, CI/CD, error tracking, analytics.
4. **Local dev** — dev URL/port, API URL/port, reserved ports to avoid, required env vars, first-time setup commands.
5. **Quality commands** — lint / typecheck / unit / integration / e2e / build, scoped per area where possible (these feed the DoD).
6. **Code intelligence** — any LSP servers to run? `@-mention` hot files? MCP servers used weekly?
7. **Deny additions** — "Any project-specific tools/commands Claude should NEVER run without explicit approval?" → append as `permissions.deny` rules under the operator-additions section of `.claude/settings.json`.

### Phase 2 — Drop the scaffold

1. Copy the entire `scaffold/_00-Project-Management/` tree into the project root as `_00-Project-Management/` (honour the Phase-0 merge/overwrite choice — in merge mode, add missing files only).
2. Root `CLAUDE.md`: create from `scaffold/91-Templates/ROOT-CLAUDE.template.md` (or append its `<!-- PM-KIT-BLOCK -->` under the marker if a CLAUDE.md exists). Keep it ≤30 lines.
3. `.claudeignore`: copy from `scaffold/_00-Project-Management/.claudeignore` to the project root if absent.
4. `.claude/settings.json`: copy `scaffold/.claude/settings.json` (or append-missing-deny-rules if it exists), then add the Phase-1 Q7 deny rules.
5. Wire npm scripts into the project's `package.json` (create one if absent): `pm:lint`, `pm:dash`, `pm:map`, `pm:all` — pointing at `_00-Project-Management/93-Scripts/`. If the kit ships its scripts under `_00-Project-Management/93-Scripts/package.json`, mirror those entries.

### Phase 3 — Generate + tailor

1. Run `npm run pm:map` to generate `CODEBASE-MAP.md` (fill the purpose/owner columns from what you learned in Phase 1).
2. Fill `90-Standards/PROJECT-CONTEXT.md`: set the project-type checkbox, paste the stack/ports/env answers, and add the gotcha block for the chosen type (see the type list in PROJECT-CONTEXT.md's per-type sections — keep only the relevant one, mark the rest "n/a for this project type").
3. Fill the root `CLAUDE.md` `<!-- CRITICAL-GOTCHAS -->` (≤4 entries — the things that would bite a new contributor: dev port, a required env var, a stack quirk).

### Phase 4 — Verify

1. `npm run pm:lint` → must report 0 violations. Fix any frontmatter issues it flags.
2. `npm run pm:dash` → confirm `_00-Project-Management/42-Monitor/DASHBOARD.html` is written.
3. Open `90-Standards/SOP.md` §17 and `90-Standards/DAILY-WORKFLOW.md` to orient on day-to-day use.
4. Report: what was created/merged, the project type chosen, any deny rules added, and the next step (draft the first Epic, or `/Tandem:draft-epic` if the plugin is also installed).

Honour the kit's rules throughout: closed 9-value status enum, quoted ISO-8601 timestamps
(system clock, not chat-stated date), every Story gets a paired Testplan, one hat per session.
```

## PROMPT — paste to here

---

## What you get

| Artefact | Source | Lands at |
|---|---|---|
| PM folder | `scaffold/_00-Project-Management/` | `_00-Project-Management/` |
| Root CLAUDE.md | `scaffold/91-Templates/ROOT-CLAUDE.template.md` | `CLAUDE.md` (or appended block) |
| Read-exclusions | `scaffold/_00-Project-Management/.claudeignore` | `.claudeignore` |
| Permission deny baseline | `scaffold/.claude/settings.json` | `.claude/settings.json` (or appended rules) |
| Codebase map | generated by `pm:map` | `CODEBASE-MAP.md` |

## Relationship to the plugin path

Both paths produce the same result. Use the **plugin** (`claude plugin install
github:DATA-AI-XYZ/Tandem`) when you have install
access and want zero-friction setup + the model-invoked skills. Use **this paste-prompt**
when you don't, or you want the interactive discovery first. If both are used, this
installer's Phase 0 detects the existing `_00-Project-Management/` and asks before touching it.
