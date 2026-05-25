# 93-Scripts

Validation and reporting helpers. Dependency-free Node.js (stdlib only).

## Scripts

### `validate-frontmatter.js`

Lints YAML frontmatter across the PM folder against the rules in `90-Standards/SOP.md`.

**Run:**
```bash
npm run pm:lint
```

### `generate-dashboard.js`

Builds an interactive single-file HTML dashboard at `42-Monitor/DASHBOARD.html` from the current artefact state. Embeds CSS + JS + data inline — no external assets, no build step. Open directly in a browser.

**Run:**
```bash
npm run pm:dash
```

**What it shows:**
- **Overview tab** — KPI cards (in-progress, in-review, blocked, ready, 30-day velocity, avg cycle time, epics-without-OKR), status-distribution bars per artefact type, attention list (stalled stories, blocked work, missing strategic linkage).
- **One tab per artefact type** — Epics, Features, Stories, Testplans, Bugs, Backlog, Decisions, Releases, Retros. Filterable by status pill. Searchable. Click any row to open a side drawer with the full markdown body rendered.

Regenerate whenever artefact state changes — the close-out and weekly-monitor prompts wire this in automatically.

**Wire into the project's root `package.json`:**
```json
{
  "scripts": {
    "pm:lint": "node _00-Project-Management/93-Scripts/validate-frontmatter.js",
    "pm:dash": "node _00-Project-Management/93-Scripts/generate-dashboard.js",
    "pm:all":  "npm run pm:lint && npm run pm:dash"
  }
}
```

**Wire into Husky pre-commit (recommended once stable):**
```bash
npx husky add .husky/pre-commit "npm run pm:all"
```

## Rules enforced

| Rule | Description |
|---|---|
| R0 | Frontmatter present and parseable |
| R1 | `status` is one of the 9 enum values |
| R2 | `created_at` non-empty and ISO 8601 with offset |
| R3 | `status=in-progress` implies `started_at` set |
| R4 | Terminal status (done/wontfix/duplicate/archived) implies `completed_at` set |
| R5 | `status=not-started` implies `started_at` and `completed_at` empty |
| R6 | Story has a paired TESTPLAN at the mirrored path |
| R7 | Testplan's `story:` references an existing STORY file |
| R8 | Bug's `story:` and `testplan:` reference existing files |
| R9 | Epic has `okr:` or `prd_section:` (strategy linkage) |
| R10 | Frontmatter `id:` matches filename's ID portion |
| R11 | Story has `estimate:` in {XS, S, M, L}; XL flagged |
| R12 | Feature's `epic:` references an existing EPIC file |

## Detection library (`lib/`)

Shared by the CLAUDE.md-layer automation (scaffold / audit / git hook in Plan 2).

### `lib/detect-boundaries.js`

Scans a repo for directories that should carry a `CLAUDE.md`, by package
manifest (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `*.csproj`,
`pom.xml`, `build.gradle`, `Gemfile`, `composer.json`) or workspace declaration
(`pnpm-workspace.yaml`, `turbo.json`, `lerna.json`, `go.work`, `nx.json`). Repo
root is always a candidate.

```bash
node _00-Project-Management/93-Scripts/lib/detect-boundaries.js --root . --json
```

Each candidate: `{ path, manifest, framework, scripts }`. Paths are
repo-relative with a leading slash; output is sorted. Skips `node_modules`,
`.git`, build output, dotdirs, and bare folder names listed in `.gitignore`.

### `lib/claude-config.js`

Reads/writes `.claude-pm-config.json` (the persisted include/exclude boundary
decisions) and exposes `decideStatus(cfg, path)` →
`included` | `excluded` | `undecided`.

## Exit codes

- `0` — no violations
- `1` — violations found (numbered report printed)
- `2` — script error (couldn't read PM folder)

## Adding new rules

Add a check inside `checkFile()` in `validate-frontmatter.js`. Use the `violate(filepath, ruleId, message)` helper. Document the new rule here.
