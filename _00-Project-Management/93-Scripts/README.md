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
- **Nine grouped views** — Now, Capture, Plan, Build, Cadence, Decisions, Docs, Tandem, Toolkit — with sub-views per artefact type (Epics, Features, Stories, Testplans, Bugs, Backlog, Decisions, Releases, Retros). Filterable by slicer band, searchable; click any card to open a side drawer with the full markdown body rendered.

> Corrected 2026-08-01. This section previously described an "Overview tab" with KPI cards including
> "30-day velocity", "avg cycle time" and "epics-without-OKR". None of those strings exist in the
> generator — the description predated the dashboard restructures (ADR-0048 / ADR-0094), and
> cycle time was retired outright by ADR-0107.

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

> ⚠ **This R-table is incomplete.** The validator carries rules beyond R12 (through R25) that were
> added by later stories and never backfilled here. Read `validate-frontmatter.js` for the
> authoritative set. Tracked in BACKLOG-0106 alongside the other doc-drift findings.

### Warn tier (advisory — never fails `pm:lint`, ADR-0061)

These surface in `pm:lint` output and are counted separately from violations. **None affects the
exit code**, so none can block a phase merge — by design.

| Rule | Description |
|---|---|
| W1 | Artefact missing the founder-facing `outcome:` line |
| W2 | An `EXECUTION-STRATEGY-*.json` `verify` block pipes a gate into `tail`/`head` (masks exit status), or still calls the retired `pm:mirror` |
| W3 | (see `validate-frontmatter.js`) |
| W4 | Model-fragile prompt phrase in `skills/**/SKILL.md` or a prompt file — phrase list in `lib/prompt-lint-phrases.json` |
| W5 | Testplan TC command is non-portable (drive-lettered path, `/tmp`, `~/`), destructive-by-default (`rm -rf` at a literal path, force-push, hard reset), or masks its own exit status — pattern list in `lib/testplan-command-patterns.json` |
| W6 | A `duplicate` / `wontfix` artefact never states **where the work went** — no supersession sentence naming another artefact, and no `superseded_by:` field. `done` and `archived` are deliberately not checked |
| W7 | A story is `done` with `ai_review: deferred-chat-review` (ADR-0121) but `ai_review_artefact:` is still empty — a chat review that was promised and never landed. No age threshold; it goes quiet when close-out fills the field |
| W8 | Timestamp sanity (ADR-0123): `completed_at`/`started_at` in the future, `completed_at` earlier than `started_at`, `completed_at` set on a non-terminal status, or either field present but unparseable. Values are **parsed** (`Date.parse`), never string-compared — these are ISO 8601 *with offsets*, and lexical order is not instant order across an offset boundary |

**W5** was the committed One change from `RETRO-2026-07` — first proposed in `RETRO-2026-05` and left
unowned for three months, during which the same defect class produced BUG-20260608-01/02,
BUG-20260609-01/02 and BUG-20260801-01/02/03. Both W4 and W5 keep their match lists in `lib/*.json`
so extending them never touches validator code. Tests: `tests/testplan-command-lint.test.js`.

**W7 and W8** exist because the validator had always checked that a field was *present and
well-formed* and never that its value was *possible* — see ADR-0123. Neither can be fatal by
design: the window between closing a story and writing its chat review is legitimate (W7), and one
skewed machine clock must not block a merge (W8). W8's shape logic is the pure exported
`checkTimestampSanity(fm, nowMs)`, with the clock injectable so a future-timestamp test is
deterministic rather than racing wall time. Tests: `tests/lint-warn-rules.test.js`; fixtures in
`__fixtures__/lint-warn-timestamps/` (four deliberately-bad artefacts plus a positive control that
pins the offset-boundary case).

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
