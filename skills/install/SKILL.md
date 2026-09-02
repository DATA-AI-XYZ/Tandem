---
name: install
description: Wire the Tandem PM kit into a project — materialize the full folder tree + seed files from the manifest, pin the folder layout, merge the pm:* scripts, guard-register hooks, and generate the Command Center dashboard. Use when the user asks to install Tandem, set up the PM kit, onboard a new repo, wire the kit, or invokes /tandem:install. Thin wrapper over the canonical install.js (pm:install) — the script does the deterministic work; this skill handles the conversational choices (layout, PROJECT-CONTEXT) and confirms the result.
---

# Tandem: install (operator setup)

Wire the PM kit into the current project (or a `--target`) so a fresh repo gets the complete
`_00-Project-Management/` tree, seed files, wired `pm:*` scripts, and a working dashboard — in one
command. This skill is the entry point; the deterministic work lives in the canonical
`install.js` script (`pm:install`), so behaviour stays testable and identical whether invoked here
or from the CLI.

## Source of truth
`_00-Project-Management/93-Scripts/install.js`. It is idempotent and additive — re-running it never
overwrites an existing definition or a user-owned file. See ADR-0072 (manifest schema + kit/user
ownership boundary) and ADR-0054 (canonical entrypoint).

**Where that script lives depends on where you are in the install.** Before the install, the
project has no `_00-Project-Management/` at all — the only copy of the script is the one shipped
inside the installed plugin, at
`${CLAUDE_PLUGIN_ROOT}/_00-Project-Management/93-Scripts/install.js`. After the install, the
project has its own copy and the wired `pm:install` script reaches it. Both run the same file; the
difference is only which copy is reachable.

## What it does (delegated to install.js)
1. **Materialize the tree** — create every folder declared in `lib/pm-manifest.json` and copy seed
   files under the kit/user ownership rule (kit-owned overwritten; user-owned written only when
   absent, so an operator's edits survive a re-install).
2. **Pin the layout** — write `.claude-pm-config.json` (`layout`, `kitVersion`) and
   `90-Standards/pm-paths.json` from the detected or chosen preset.
3. **Wire scripts + hooks** — merge the `pm:*` scripts into the host `package.json` and
   guard-register the Claude Code hooks (only when absent — ADR-0055).
4. **Generate HTML** — run the dashboard generator so the Command Center opens with the project's
   own name and working links.

## How to run it
- **Fresh consumer — the first install, from the plugin cache.** The project is empty of kit
  files, so run the copy the plugin ships:
  `node "${CLAUDE_PLUGIN_ROOT}/_00-Project-Management/93-Scripts/install.js" --target .`
  (drop `--target` when the shell's cwd is already the project root). This is the entry point a
  stranger who has only installed the plugin can reach.
- **Post-install variant — once the kit is wired.** The project now owns a copy of the script and
  the merged `pm:*` scripts: `npm run pm:install` re-runs it (idempotent, additive).
- Another project root: `node _00-Project-Management/93-Scripts/install.js --target <dir>`
- Pin a layout instead of auto-detecting: `--layout full|flattened`
- Preview without writing: `--dry-run`

## Conversational steps this skill owns
- **Layout choice** — if the project's layout is ambiguous, confirm `full` vs `flattened` with the
  operator before pinning it (default: auto-detect → `full`).
- **PROJECT-CONTEXT fill** — `90-Standards/PROJECT-CONTEXT.md` is seeded as a user-owned starting
  point; offer to fill in the project's stack quirks / gotchas so later skills have real context.
- **Confirm the result** — after install, surface the generated dashboard path and recommend
  `npm run pm:doctor` to verify the wiring is healthy.

## Non-negotiable rules
- Adds **no** destructive behaviour beyond `install.js`. This skill never deletes or moves a user's
  work; it only orchestrates the script and confirms.
- Keep deterministic logic in the script — the skill only orchestrates + confirms.

## Next
Next: `/tandem:session-start` (orient), then begin planning with
`/tandem:draft-okrs`. Pull kit improvements later with
`/tandem:update`.
