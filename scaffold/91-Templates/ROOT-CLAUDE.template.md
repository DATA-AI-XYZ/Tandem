# CLAUDE.md

<!-- This is the always-on Tier-1 root file: loaded every session, so every line
     costs context on every task. Keep it lean — only rules relevant to almost
     ANY task here. Signpost folder-scoped files in plain words ("when editing X,
     read x/CLAUDE.md"); do NOT use @import (it re-bloats the always-loaded
     context). Place a rule here only when a miss is serious/irreversible;
     recoverable, area-local rules go in a folder-scoped CLAUDE.md. -->

<!-- PM-KIT-BLOCK -->
This repo uses the Tandem. PM artefacts live under `_00-Project-Management/`; read `_00-Project-Management/CLAUDE.md` before touching them. Non-negotiables: closed 9-value status enum, quoted ISO-8601 timestamps, every Story has a paired Testplan, one hat per session. Run `npm run pm:lint` before committing PM edits.

<!-- PROJECT-MAP -->
Top-level layout: see [`CODEBASE-MAP.md`](./CODEBASE-MAP.md) (regenerate with `npm run pm:map`).

<!-- CRITICAL-GOTCHAS -->
- TODO: gotcha 1 (≤4 entries — e.g. dev server port, required env var).
- TODO: gotcha 2.

<!-- REFERENCE-ORDER -->
When unsure of a rule: this file → `_00-Project-Management/CLAUDE.md` → `_00-Project-Management/90-Standards/SOP.md` §16.
