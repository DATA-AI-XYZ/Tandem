<!-- Copy to <subdir>/CLAUDE.md. This is a Tier-2 folder-scoped file: auto-loaded
     when a file in this folder is touched. ADDITIVE to root CLAUDE.md — it carries
     only what's true HERE; never repeat root content. If this folder only
     occasionally needs a rule whose real home is elsewhere, make it a Tier-3 thin
     pointer instead (a one-line "for X, see <the rule's single home>") rather than
     a full section. Never use @import — plain-text pointers only. Keep ≤30 lines
     (CLAUDE-CODE-CONFIG §2.1.4 content economics). Distributed model per ADR-0009:
     use this when the repo is a monorepo / multi-service host project. -->
## Purpose
<one line: what this subdirectory is and what kind of change belongs here>

## Owners
<one line: team / person / Slack channel responsible for this area>

## Test commands
<!-- PM-KIT:BEGIN managed:commands — auto-detected on scaffold; verify each, keep or delete -->
```bash
# e.g. npm test --workspace=web
```
<!-- PM-KIT:END managed:commands -->

## Lint commands
```bash
# e.g. npm run lint --workspace=web
```

## Local conventions
- <local rule only — additive to root, e.g. "tests here use Playwright, not Jest">
- <local rule>

## @-mention vs grep guidance
| Use | When |
|---|---|
| `@path/to/file` | The file is load-bearing for almost every task here — pin it |
| grep / Explore agent | One-off lookup — don't pin, search on demand (SOP §18) |
