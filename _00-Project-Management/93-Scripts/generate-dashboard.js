#!/usr/bin/env node
/**
 * generate-dashboard.js — the board's DATA PRODUCER (STORY-33.9.05 / ADR-0277).
 *
 * Emits the `window.__DATA` payload the Command Center renders, as raw redacted
 * JSON. It renders NO document: the board itself is assembled by
 * `build-board.js` (`npm run pm:dash`), which spawns this producer as a child.
 *
 * What it does:
 *   - Walks the SCAN_DIRS under _00-Project-Management/ (strategy, epics,
 *     features, stories, testplans, bugs, ADRs, backlog, releases, retros)
 *   - Scans the AI Catalogue from ~/.claude/ and project .claude/ — unless the
 *     render is EXTERNAL (PM_DASH_ROOT pointing at a tree that is not this one),
 *     in which case the local scan is skipped so nothing about this machine leaks
 *   - Merges curated overlays from 97-AI-Reference/, builds every payload
 *     collection (bodyHtml via mdToHtml, usage rollups, phase/track data,
 *     known routes, about facts, cross-ref resolution), then redacts host paths
 *     as the LAST step (ADR-0238)
 *   - Exports the port's single-source config surface (SLICE_BANDS, SORT_KEYS,
 *     RAIL_GROUPS, the lifted client contracts PAGE_SIZE / STREAM_* / NO_SCOPE /
 *     LEGACY_ROUTES, …) — board/lib and the test suites read THIS module for
 *     those facts; there is no second copy
 *
 * History: until STORY-33.9.05 this file also carried the original hand-rolled
 * board renderer (~5,200 lines). That half retired through ADR-0139's
 * annotate-then-delete — the record is
 * 41-Reports/audits/deletion-record-EPIC-33-2026-08-28.md — and the shipped
 * board is the Preact port (board/src) delivered as assets/board-runtime.js.
 *
 * Node.js stdlib (fs, path, os). No third-party packages.
 *
 * Usage:
 *   node _00-Project-Management/93-Scripts/generate-dashboard.js --payload-out <file>
 *   (bare invocation exits 2 — ADR-0135; to build the board, run `npm run pm:dash`)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
// The kit's folder-layout map. Required here rather than inline further down so the module
// dependency is visible in the header block with the rest (ADR-0267 established the pattern;
// the board's OUT_FILE moved to build-board.js with the STORY-33.9.05 retirement — this file
// keeps the map for parseMonitor()'s role-resolved MONITOR.md read).
const { loadPaths, monitorDir } = require('./lib/pm-paths.js');

/* ============================================================
 * Config
 * ============================================================ */

// PM_ROOT defaults to the `_00-Project-Management/` two levels up from this script. Override with
// PM_DASH_ROOT to render any other PM tree (used by the Tandem demo build to render demo-fixture/
// without copying the generator). Backward-compatible: unset env var = identical behaviour.
const PM_ROOT = process.env.PM_DASH_ROOT
  ? path.resolve(process.env.PM_DASH_ROOT)
  : path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PM_ROOT, '..');
// ---------------------------------------------------------------------------
// THE BOARD'S DESTINATION LEFT THIS FILE (STORY-33.9.05).
//
// ADR-0267's third freeze exception put a role-resolved OUT_FILE here so the generator's
// document landed where the layout map said (BUG-20260819-01). With the renderer retired,
// this file writes NO document: the board's destination is `dashboardOutPath()` as called
// by `build-board.js` (`pm:dash`), the same shared resolver install/update report. The
// history and the flattened-layout reasoning live in ADR-0267 and
// `tests/delivery-layout-role.test.js`. `parseMonitor()`'s role-resolved MONITOR.md read
// below is unchanged; BUG-20260827-03 (the report-source table's literal) stands tracked.
// When rendering an explicit external PM root (the Tandem demo build), skip the local ~/.claude
// scan / machine-absolute paths — they would leak the builder's username/inventory into a public dashboard.
// EXTERNAL means "rendering a tree that is not my own", not "PM_DASH_ROOT is set".
// The presence check dates from when PM_DASH_ROOT only ever pointed at FOREIGN trees
// (the demo fixture, another project). STORY-33.10.02's assembly lane then began setting
// it on EVERY spawn — including the kit's and a consumer's render of their own tree —
// which silently flipped those renders into the external leak-guard mode and emptied
// their AI catalogue (measured at the STORY-33.9.05 cutover: ai 5,858,082 B → 367 B).
// A same-tree render is not external: the leak-guard (STORY-23.6.02 AC-3 / ADR-0106)
// exists so a DEMO/foreign render never scans this machine's ~/.claude — a tree
// rendering ITSELF scanning its own machine is the product feature, not the leak.
// Same-tree comparison is CANONICAL, not textual (review M1): drive-letter case, DOS 8.3
// short names (the tilde-suffixed forms) and junctions all spell one directory many ways
// on Windows, and
// a spelling mismatch here silently re-creates BUG-20260828-04's empty catalogue. realpath
// resolves the spellings; the case-fold covers case-insensitive filesystems; the fallback
// to resolve() keeps a not-yet-existing root comparable instead of throwing.
function canonicalDir(p) {
  let out;
  try { out = fs.realpathSync.native(p); } catch (_e) { out = path.resolve(p); }
  return process.platform === 'win32' ? String(out).toLowerCase() : String(out);
}
const EXTERNAL_ROOT = !!process.env.PM_DASH_ROOT
  && canonicalDir(process.env.PM_DASH_ROOT) !== canonicalDir(path.resolve(__dirname, '..'));

// ============================================================================
// THE CONTEXT-ECONOMICS CROSS-LINK IS EMITTED ONLY WHERE IT RESOLVES (BUG-20260811-01)
// ============================================================================
// Two chrome surfaces link the context-economics doc — the AI · Glossary entry for "Context-load
// cost" and the AI · Catalogue cost legend's "what is this?". Both were emitted unconditionally,
// with a `title="Forward reference — authored in FEAT-11.4"` recording that they were authored as
// a deliberate forward reference while the doc was still pending IN THIS REPO. FEAT-11.4 shipped;
// the attribute is stale here and was never true for a consumer, where `documentation/` is not
// scaffolded by any install path (`lib/pm-manifest.json` has no such folder, and `install.js`
// renders docs only `if (fs.existsSync(docsSrc))`). So on every freshly-installed project both
// links 404, and they do it on the one surface a confused operator reaches for.
//
// Everything else in this generator that touches `documentation/` already asks first — `buildDocs()`
// degrades to an empty list and the Docs view renders an empty state pointing at `npm run pm:docs`.
// These two sites are the asymmetry, not a different policy.
//
// TWO WAYS THE TARGET IS REACHABLE, AND THE SECOND IS NOT A SPECIAL CASE:
//   1. this tree carries `documentation/context-economics.html` (the dev repo, or a consumer that
//      ran `pm:docs`), so `../../documentation/context-economics.html` from `42-Monitor/` resolves;
//   2. the published Tandem docs build, where the board IS `docs/index.html`, the doc pages are its
//      siblings, and `scripts/release-tandem.js` rewrites this href to a bare filename. Its signal
//      is `PM_DASH_TANDEM_DOCS_BASE` — tested for PRESENCE, not truthiness, because the empty
//      string is the meaningful published value (ADR-0088), which is exactly how `buildDocs()`
//      decides the same question two thousand lines down. A consumer's own `pm:dash` never sets it.
//
// THE HREF STRING IS SPELLED ONCE, HERE. `release-tandem.js` rewrites it by LITERAL MATCH in two
// forms (plain, and JSON-escaped inside an embedded bodyHtml), so a markup change at either site
// can silently break the one build where these links currently work.
const CONTEXT_ECONOMICS_HREF = '../../documentation/context-economics.html';
const HAS_CONTEXT_ECONOMICS_DOC = fs.existsSync(
  path.join(REPO_ROOT, 'documentation', 'context-economics.html'),
) || process.env.PM_DASH_TANDEM_DOCS_BASE !== undefined;
/** The anchor, or nothing at all. Never a link to a page that is not there. */
function contextEconomicsLink(text) {
  return HAS_CONTEXT_ECONOMICS_DOC
    ? `<a href="${CONTEXT_ECONOMICS_HREF}" target="_blank" rel="noopener">${text}</a>`
    : '';
}

// Usage rollup (STORY-21.2.03 / ADR-0079): reuses the SAME tolerant log reader / positive-int
// shape check as generate-monitor.js / usage-reconcile.js (STORY-21.2.02) rather than
// re-implementing the parsing, so all three surfaces never drift on what counts as "an
// actual" or "a valid estimate". The usage-log path is computed from THIS script's own
// PM_ROOT (honours PM_DASH_ROOT) rather than usage-capture.js's DEFAULT_LOG_PATH, which is
// pinned to the kit's own physical location regardless of which PM tree is being rendered.
// STORY-29.3.01 / ADR-0188 — THE usage rollup, and the ledger primitives it is built from.
// This file used to hold its own copy of the rollup body; `generate-monitor.js` held a second,
// older one that had never been taught about chat-kind records (BUG-20260805-01). Both now call
// `usageRollup.buildUsageRollup()`, which is the only place the figures are computed. The
// corpus reader below still needs `parsePositiveInt` — the same one the rollup uses, so a story
// whose estimate is dropped as invalid is dropped identically on both sides.
const usageRollup = require('./lib/usage-rollup.js');
const { parsePositiveInt } = usageRollup;
// STORY-29.1.03 — the retro ledger's own tolerant reader. Since the rollup moved, this file
// reads it only for the surfaces that render retro data; the rollup resolves its own anchors.
const retroReport = require('./retro-report');
// BUG-20260801-04 — displayed dates must be LOCAL, never UTC-normalised. See lib/local-date.js.
const { localIso, localDay } = require('./lib/local-date.js');
// STORY-25.2.04 / ADR-0115 — ONE unquote implementation, shared with
// generate-monitor.js and validate-frontmatter.js.
const { unquoteScalar } = require('./lib/frontmatter.js');
// STORY-28.3.01 / ADR-0175 — the same move for the artefact-ID grammar: one
// definition, shared with validate-frontmatter.js and generate-backlog-board.js.
const artefactId = require('./lib/artefact-id.js');
// STORY-28.3.03 / BUG-20260804-01 — the MONITOR.md anchor contract, shared with
// generate-monitor.js and the R31 lint arm.
const monitorAnchors = require('./lib/monitor-anchors.js');
// STORY-29.2.03 / ADR-0186 — the executed-truth reconciliation between the chat track and the
// autopilot track, and the run-kind derivation. Read-only: it writes nothing and rewrites no
// sidecar. `autopilot-plan.js` is required for its plan READER only (`readPlan`), so the
// executed side can honour a written run scope; nothing here ever writes a plan.
const trackReconcile = require('./lib/track-reconcile.js');
const autopilotPlan = require('./autopilot-plan.js');
// STORY-27.3.02 / ADR-0141 — the shape-agnostic report-corpus reader shared by
// every site that reads 41-Reports.
const reportTree = require('./lib/report-tree.js');
// STORY-31.1.02 - the anchor schema, the two drift checks and the dismissal store. All the
// judgement lives there so it is drivable from tests/wiki-drift.test.js without building a
// board; this file supplies the repo it resolves against and renders the verdict.
const wikiDrift = require('./lib/wiki-drift.js');
const USAGE_LOG_PATH = path.join(PM_ROOT, '41-Reports', 'usage', 'usage-log.jsonl');

// PM corpus scan map (PRD §10.1). Missing dirs are skipped silently.
// v1.1: `inbox` added (10-Inbox) for the Capture tab + Now-page pending-action widget.
const SCAN_DIRS = {
  strategy: '00-Strategy',
  inbox:    '10-Inbox',
  backlog:  '11-Backlog',
  release:  '13-Releases',
  retro:    '14-Retros',
  epic:     '30-Epics',
  feature:  '31-Features',
  story:    '32-Stories',
  testplan: '33-Testplans',
  bug:      '34-Bugs',
  adr:      '40-Decisions',
};

// Closed status enum. Order drives filter pill stack and row sort.
// `active` is allowed only on strategy artefacts (ADR-0003 escape hatch).
const STATUS_ORDER = [
  'in-progress', 'in-review', 'ready', 'blocked', 'active',
  'not-started', 'done', 'wontfix', 'duplicate', 'archived',
];

const HOME_CLAUDE = path.join(os.homedir(), '.claude');
const PROJ_CLAUDE = path.join(REPO_ROOT, '.claude');

// Built-in harness sub-agents that always exist regardless of disk state.
const HARNESS_AGENTS = [
  {
    name: 'Explore',
    description: 'Fast read-only search agent for locating code by pattern or symbol. Use for "where is X defined" / "which files reference Y" questions.',
    category: 'Search & Planning',
    source: 'harness',
    builtIn: true,
    tools: 'Read, Glob, Grep, Bash (read-only)',
    body: 'Built-in Claude Code sub-agent. Read-only by design — cannot edit or write files. Best for narrow lookups; will miss content past its read window so do not delegate full reviews to it.',
  },
  {
    name: 'general-purpose',
    description: 'Catch-all research agent for multi-step exploration when the target is not yet known.',
    category: 'Search & Planning',
    source: 'harness',
    builtIn: true,
    tools: 'All tools',
    body: 'Built-in Claude Code sub-agent. Use for open-ended research that may require several rounds of globbing/grepping. Prefer Explore for read-only lookups; reach for general-purpose when synthesis is required.',
  },
  {
    name: 'Plan',
    description: 'Software architect agent that produces implementation plans without writing code.',
    category: 'Search & Planning',
    source: 'harness',
    builtIn: true,
    tools: 'All tools except Edit/Write',
    body: 'Built-in Claude Code sub-agent. Returns step-by-step plans, identifies critical files, weighs trade-offs. Useful before non-trivial implementation; never lets the plan replace conversation alignment.',
  },
  {
    name: 'claude',
    description: 'Default catch-all agent when no more specific subagent name is typed.',
    category: 'Search & Planning',
    source: 'harness',
    builtIn: true,
    tools: 'All tools',
    body: 'Built-in Claude Code sub-agent. Equivalent to no subagent_type — runs with the full toolbelt and no domain bias.',
  },
];

// Category rules (PRD §11.4). First match wins. Items that match nothing land in "Other".
const CATEGORY_RULES = [
  [/^(Explore|general-purpose|Plan|claude)$/i, 'Search & Planning'],
  [/^anti-drift|writing-plans|concise-planning|create-plan|^plan(ner|ning)?$/i, 'Planning & Anti-Drift'],
  [/^power-bi-/i, 'Power BI'],
  [/^power-platform/i, 'Power Platform'],
  [/^react|frontend-developer|web-vitals|web-accessibility/i, 'Frontend & Web'],
  [/^javascript|^js-|fullstack-developer|^typescript/i, 'Languages'],
  [/design-taste|brandkit|imagegen|impeccable|industrial-brutalist|minimalist-ui|emil-design|gpt-taste|high-end-visual|redesign-existing|stitch-design|image-to-code|ui-designer|ui-ux-designer|figma|draw-io|mermaid-diagrams|diagram-architect/i, 'Design & UX'],
  [/prompt-engineer|^llm-|^ai-|^mcp-|claude-code-guide|claude-api/i, 'AI & Prompting'],
  [/test|playwright|coverage|jest|spec/i, 'Testing'],
  [/debug|error|find-bugs|systematic-debug|error-resolver|error-detective/i, 'Debugging'],
  [/security|secrets|vulnerab/i, 'Security'],
  [/seo/i, 'SEO'],
  [/refactor|clean-code|code-simplifier|unused-code/i, 'Refactoring'],
  [/code-review|review|find-bugs/i, 'Code Review'],
  [/commit|git-|github|pr-|create-pr|push|branch/i, 'Git & GitHub'],
  [/deploy|build-engineer|deployment/i, 'Build & Deploy'],
  [/documentation|technical-writer|content-marketer|product-manager/i, 'Docs & Content'],
  [/obsidian|notion/i, 'Knowledge Base'],
  [/powershell|bash|shell|terminal/i, 'Shell & Scripting'],
  [/performance|web-vitals|react-performance/i, 'Performance'],
  [/tandem:|pm-kit|project-management/i, 'PM Kit'],
  [/^verify|verification-before-completion/i, 'Verification'],
  [/best-practices|standards/i, 'Best Practices'],
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Copy voice & tone guide
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// Hand-authored UI copy throughout this file (glossary terms, view-renderer strings,
// empty-state labels, and field names) must follow three principles:
//
// 1. INFORMATIVE — Copy names a real thing, not an abstraction. "Unique identifier
//    for this artefact" beats "ID".
//
// 2. DESCRIPTIVE — Copy breaks down the parts. Instead of generic labels, show the
//    source, the why (purpose/value), and the what (action/thing).
//
// 3. PLAIN ENGLISH — Short sentences. No jargon. No filler. If a reader isn't
//    familiar with the term, the copy explains it in one line.
//
// Core rule: Explain the why, not only the what. "Status: which stage the artefact
// is in and why you care (in-progress means edits are live)" beats "Status: current
// workflow state". The why gives context; the what is just naming.
//
// When adding view intros, extended glossary, or cryptic labels in future stories,
// use this voice so the interface speaks in one tone.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Glossary entries (PRD Appendix C, condensed for the AI · Glossary sub-tab).
const GLOSSARY = [
  ['ADR', 'Architecture Decision Record. A short note explaining a load-bearing choice and the alternatives rejected. Stored under <code>40-Decisions/</code>.'],
  ['AI Catalogue', 'The tab group that scans <code>~/.claude/</code> and <code>.claude/</code> for skills, sub-agents, slash commands and plugins.'],
  ['BUG', 'A defect filed under <code>34-Bugs/EPIC-NN/FEAT-NN.M/</code>. Auto-raised when a testplan TC fails or a defect is found in exploration. Sequential ID per day: <code>BUG-YYYYMMDD-NN</code>.'],
  ['Context-load cost (context tax)', 'An estimate of how many tokens an AI artefact (skill, sub-agent, command or plugin) costs to LOAD into the context window when it is read — the kit context tax. Shown as <code>~N tok</code> on each AI-catalogue card, summed per kind, plus a plugin total. Computed as roughly <code>chars / 4</code>; it is not a per-invocation <strong>completion cost</strong> (the dollar price a model charges to run a request) — it measures context weight, not money.'
    // BUG-20260811-01 — the sentence goes with the link. A reader told to "see the
    // context-economics doc" when no such doc exists is worse off than one who was never told.
    + (HAS_CONTEXT_ECONOMICS_DOC
      ? ` See the ${contextEconomicsLink('context-economics doc')} for the full definition.` : '')],
  ['DoD', 'Definition of Done. The checklist a story must pass before flipping to <code>status: done</code>.'],
  ['DoR', 'Definition of Ready. The checklist a story must pass before flipping to <code>status: in-progress</code>.'],
  ['Drawer', 'The right-side panel that opens when you click a row. Shows the rendered markdown body and cross-references.'],
  ['Epic', 'Top-level unit of work. Identifier: <code>EPIC-NN</code>.'],
  ['Feature', 'A slice of an epic. Identifier: <code>FEAT-NN.M</code>.'],
  ['Frontmatter', 'The YAML block at the top of every markdown file, between two <code>---</code> lines, holding the artefact\'s metadata.'],
  ['Hat protocol', 'The convention that one operator switches roles explicitly: Founder, PM, Dev, QA.'],
  ['KR', 'Key Result. A measurable target under an Objective. Part of OKR.'],
  ['MONITOR', '<code>42-Monitor/MONITOR.md</code>. The single board updated weekly and on every story close-out.'],
  ['OKR', 'Objectives and Key Results. The goal-setting framework. Lives under <code>00-Strategy/</code>.'],
  ['phase/<id>', 'A short-lived feature branch cut off <code>main</code> to run one batched chat (ADR-0045). Opened with <code>/start-phase</code>, closed back to <code>main</code> with <code>/close-phase</code>.'],
  ['PM kit', 'The folder system, templates, hooks and scripts under <code>_00-Project-Management/</code>.'],
  ['PRD', 'Product Requirements Document.'],
  ['Retro', 'Retrospective. A monthly review under <code>14-Retros/</code>.'],
  ['Scrub gate', 'The pre-publish blocklist that strips private artefacts before the public Tandem build ships. Refuses to publish if any binary, symlink, or private-path leak slips through.'],
  ['SOP', 'Standard Operating Procedure. <code>90-Standards/SOP.md</code>.'],
  ['Status enum', 'The closed set of 9 values <code>status:</code> may take: <code>not-started</code>, <code>ready</code>, <code>in-progress</code>, <code>in-review</code>, <code>done</code>, <code>blocked</code>, <code>wontfix</code>, <code>duplicate</code>, <code>archived</code>. Invented values are rejected by <code>pm:lint</code>.'],
  ['Story', 'The unit of executable work. Identifier: <code>STORY-NN.M.PP</code>. Paired with a TESTPLAN.'],
  ['Sub-agent', 'A focused Claude agent dispatched by an orchestrating skill — e.g. technical-writer for docs, frontend-developer for UI code. Listed in a story\'s <code>suggested_agents:</code> frontmatter.'],
  ['Sub-tab', 'A second-row tab nested inside a group tab.'],
  ['Tandem', 'The public-facing release pipeline that builds the plugin from this repo and publishes it (ADR-0028). Triggered by <code>npm run build:tandem</code> with a scrub gate.'],
  ['TESTPLAN', 'The test plan paired 1:1 with a story. Lives at the mirrored path under <code>33-Testplans/</code>.'],
  ['WCAG', 'Web Content Accessibility Guidelines. The accessibility standard targeted at AA.'],
  ['WIP', 'Work In Progress. The set of items currently in <code>in-progress</code>, <code>in-review</code> or <code>blocked</code>.'],
  ['WIP limit', 'SOP §5: at most 2 stories <code>in-progress</code> simultaneously. Forces sequential execution within a chat and prevents context-thrashing across parallel tracks.'],
  ['YAML', 'Yet Another Markup Language. The frontmatter format.'],
];

// Hand-authored command process flow for the Tandem plugin.
// Surfaced on the Toolkit → Plugin tab so the kit's slash commands are documented
// in the order they're actually invoked through a story's lifecycle.
// Each command name matches a skill directory under /skills/, so clicking opens
// its ai-skill drawer (openDrawer("ai-skill", "<name>")).
const SOP_COMMAND_PROCESS_FLOW = {
  phases: [
    {
      key: 'bootstrap', label: 'Bootstrap', hat: 'any',
      desc: 'Every Claude Code session starts here.',
      commands: [
        { name: 'session-start', note: 'load ACTIVE.md + recent ADRs' },
        { name: 'core',          note: 'auto-loaded rules', ambient: true },
      ],
    },
    {
      key: 'strategy', label: 'Strategy', hat: 'Founder',
      desc: 'Set direction. Run quarterly or when North Star shifts.',
      commands: [
        { name: 'draft-okrs' },
        { name: 'draft-prd' },
      ],
    },
    {
      key: 'decompose', label: 'Decompose', hat: 'PM',
      desc: 'Epic → Feature → Story (with paired Testplan).',
      commands: [
        { name: 'draft-epic' },
        { name: 'split-into-features' },
        { name: 'split-into-stories', note: 'pairs testplan' },
        { name: 'critique', advisory: true },
        { name: 'fill-claude-md', note: 'one-shot setup', ambient: true },
      ],
    },
    {
      key: 'refine', label: 'Refine', hat: 'PM', gate: 'DoR',
      desc: 'Pass the Definition of Ready gate. Promotes to status: ready.',
      commands: [
        { name: 'refine-backlog' },
      ],
    },
    {
      key: 'plan-exec', label: 'Plan execution', hat: 'PM / Dev',
      desc: 'Group ready stories into executable chats.',
      commands: [
        { name: 'execution-strategist', note: 'dry-run only' },
        { name: 'start-phase' },
      ],
    },
    {
      key: 'execute', label: 'Execute', hat: 'Dev / QA',
      desc: 'Implement, test, peer-review. Status: in-progress → in-review.',
      commands: [
        { name: 'execute-batch', note: 'one chat = N stories' },
        { name: 'execute-story', note: 'single story' },
        { name: 'run-testplan', note: 'auto-files BUG-* on failure' },
        { name: 'peer-review', advisory: true },
      ],
    },
    {
      key: 'close', label: 'Close', hat: 'Dev / QA', gate: 'DoD',
      desc: 'Pass the Definition of Done gate. Status: done. Regenerates dashboard.',
      commands: [
        { name: 'close-out-story' },
        { name: 'close-phase' },
      ],
    },
  ],
  cadence: {
    label: 'Cadence rail',
    desc: 'Runs continuously alongside the main flow — not blocked by it.',
    commands: [
      { name: 'weekly-monitor', when: 'Friday' },
      { name: 'monthly-retro', when: 'End of month' },
      { name: 'reflect', when: 'End of session' },
      { name: 'document', when: 'After a decision worth keeping' },
      { name: 'curate-toolkit', when: 'When skills drift from need' },
    ],
  },
};

// Hand-authored timeline for the Tandem plugin drawer.
const SOP_SESSION_FLOW = {
  spine: [
    { kind: 'lifecycle', label: 'chat-open', detail: 'Operator opens a Claude Code session in the project root.' },
    { kind: 'skill',     label: 'session-start', detail: 'Reads <code>ACTIVE.md</code>, the most recent ADRs and the MONITOR revision history. Announces suggested hat and next step.' },
    { kind: 'skill',     label: 'execute-story', detail: 'Verifies Definition of Ready, flips story to <code>in-progress</code>, implements ACs one at a time. Files ADRs and BUGs as they arise.' },
    { kind: 'skill',     label: 'run-testplan', detail: 'Executes every TC\'s Command verbatim, marks PASS/FAIL, auto-files <code>BUG-YYYYMMDD-NN</code> for each failure.' },
    { kind: 'skill',     label: 'close-out-story', detail: 'Runs DoD gate. Flips status to <code>done</code>, updates MONITOR, regenerates this dashboard.' },
    { kind: 'skill',     label: 'reflect', detail: 'Proposes CLAUDE.md / SOP.md / PROJECT-CONTEXT.md updates based on what happened.' },
    { kind: 'lifecycle', label: 'chat-close', detail: 'Hooks fire on Stop. Frontmatter linted; dashboard regenerated.' },
  ],
  aside: {
    label: 'Friday cadence',
    items: [
      { kind: 'skill', label: 'weekly-monitor', detail: '7-day delta, MONITOR revision history bumped, stalled stories flagged, backlog hygiene, dashboard regenerated.' },
    ],
  },
};

/* ============================================================
 * Helpers
 * ============================================================ */

function existsDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function walk(dir, list, predicate) {
  list = list || [];
  predicate = predicate || ((n) => n.endsWith('.md'));
  if (!existsDir(dir)) return list;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return list; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) walk(full, list, predicate);
      else if (entry.isFile() && predicate(entry.name)) list.push(full);
      else if (entry.isSymbolicLink()) {
        const stat = fs.statSync(full);
        if (stat.isDirectory()) walk(full, list, predicate);
        else if (stat.isFile() && predicate(entry.name)) list.push(full);
      }
    } catch { /* unreadable — skip */ }
  }
  return list;
}

function readFileSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function parseFrontmatterAndBody(content) {
  if (!content) return { fm: null, body: '' };
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { fm: null, body: content };
  const block = m[1];
  const body = m[2] || '';
  const fm = {};
  let key = null;
  let listBuf = null;
  const lines = block.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    // Block-list continuation: "  - value"
    if (key && /^\s+-\s+/.test(line)) {
      listBuf = listBuf || [];
      let v = line.replace(/^\s+-\s+/, '').trim();
      v = unquote(v);
      listBuf.push(v);
      fm[key] = listBuf.slice();
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    key = kv[1];
    listBuf = null;
    let value = kv[2].trim();
    if (!value) { fm[key] = ''; continue; }

    // BUG-20260618-03 Case D — YAML block scalar (`description: |` literal,
    // or `description: >` folded; optional chomping +/- and a rare leading
    // indent-indicator digit). Without this, the value is left as the bare
    // indicator string (fm.description === '|') and the block body is
    // silently dropped — a drawer then renders a literal "|" instead of the
    // description. Consume the following more-indented lines as the scalar's
    // real text. Deliberately narrow (single style, no anchors/tags/nested
    // block scalars) — this is a display-layer parser, not a YAML engine.
    const blockScalar = value.match(/^([|>])([+-]?)\d*$/);
    if (blockScalar) {
      const style = blockScalar[1];
      const collected = [];
      let blockIndent = null;
      let j = i + 1;
      for (; j < lines.length; j++) {
        const l = lines[j];
        if (l.trim() === '') { collected.push(''); continue; }
        const indent = l.match(/^\s*/)[0].length;
        if (blockIndent === null) {
          if (indent === 0) break; // nothing indented under the key — empty block
          blockIndent = indent;
        } else if (indent < blockIndent) {
          break; // dedent — block scalar body ends here
        }
        collected.push(l.slice(blockIndent));
      }
      while (collected.length && collected[collected.length - 1] === '') collected.pop();
      fm[key] = style === '|' ? collected.join('\n') : collected.join(' ').replace(/\s+/g, ' ').trim();
      i = j - 1; // resume the outer loop at the first unconsumed line
      continue;
    }

    if (/^\[.*\]$/.test(value)) {
      const inner = value.slice(1, -1).trim();
      fm[key] = inner ? inner.split(',').map(s => unquote(s.trim())) : [];
    } else {
      fm[key] = unquote(value);
    }
  }
  return { fm, body };
}

// STORY-25.2.04 / ADR-0115: this was a second, drifting copy of the same logic.
// It now delegates to the canonical helper in lib/frontmatter.js, which both
// readers import — so the two can no longer disagree about what an artefact says.
const unquote = unquoteScalar;

function rel(p) {
  return path.relative(REPO_ROOT, p).replace(/\\/g, '/');
}

// STORY-28.3.01 / ADR-0175 — the id grammar lives in lib/artefact-id.js and this
// reader no longer restates it. It and validate-frontmatter.js's reader disagreed
// about RELEASE ids once already (BUG-20260803-01: fifteen correct release records
// failed a linter that read their filenames differently from the board that
// rendered them), and the repair at the time was a comment asking the next author
// to keep the two literals byte-identical.
const fileIdFromName = artefactId.fileIdFromName;

function ageDays(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

// STORY-23.1.03 / ADR-0093 — read PROJECT-CONTEXT.md's "Project name:" field.
// Placeholder-aware: the template ships with `_<fill in>_` (and the field can
// be left blank) until an operator fills it in — either must resolve to "no
// value here", not a literal placeholder string leaking into the header.
// Never throws; returns null on any miss.
function resolveProjectContextName() {
  try {
    const pcPath = path.join(PM_ROOT, '90-Standards', 'PROJECT-CONTEXT.md');
    if (!fs.existsSync(pcPath)) return null;
    const text = fs.readFileSync(pcPath, 'utf8');
    const m = /^-\s*\*\*Project name:\*\*\s*(.+?)\s*$/m.exec(text);
    if (!m) return null;
    const val = m[1].trim();
    if (!val || /^_.*_$/.test(val)) return null; // unfilled `_<fill in>_` template marker
    return val;
  } catch (_e) {
    return null;
  }
}

// STORY-15.2.04 / ADR-0070, extended by STORY-23.1.03 / ADR-0093 — resolve the
// display name for this project.
// Precedence: .claude-pm-config.json `projectName` > PROJECT-CONTEXT.md
// "Project name:" (skip if unfilled) > host package.json `name` > repo folder
// basename (hyphens/underscores → spaces). Never throws.
function resolveProjectName() {
  // (a) .claude-pm-config.json
  try {
    const cfgPath = path.join(REPO_ROOT, '.claude-pm-config.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (cfg && typeof cfg.projectName === 'string' && cfg.projectName.trim()) {
        return cfg.projectName.trim();
      }
    }
  } catch (_e) { /* ignore */ }
  // (b) PROJECT-CONTEXT.md "Project name:" field
  const fromContext = resolveProjectContextName();
  if (fromContext) return fromContext;
  // (c) host package.json name
  try {
    const pkgPath = path.join(REPO_ROOT, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg && typeof pkg.name === 'string' && pkg.name.trim()) {
        return pkg.name.trim();
      }
    }
  } catch (_e) { /* ignore */ }
  // (d) repo folder basename humanized
  return path.basename(REPO_ROOT).replace(/[-_]+/g, ' ').trim() || 'My Project';
}

// STORY-23.1.03 AC-4 — Tandem identity badge: inline the pinned asset when
// present, otherwise recreate the circular triangle mark inline. Both paths
// yield an element carrying class="logo-badge" so the rail head always has a
// badge (the operator still owes the final SVG/PNG — this ships the slot +
// fallback so the brand story isn't blocked on that asset, per the story's
// own Gotcha note). Resolved relative to __dirname (not PM_ROOT) because the
// asset ships with the generator itself, like the vendored font files.
const BADGE_ASSET_PATH = path.join(__dirname, 'assets', 'tandem-badge.svg');
const BUILTIN_BADGE_SVG = '<svg class="logo-badge" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Tandem badge"><circle cx="100" cy="100" r="100" fill="#1C1713"/><polygon points="50.0,142.0 148.0,142.0 128.0,50.0" fill="none" stroke="#2E6CE7" stroke-width="4.5" stroke-linejoin="round"/><polygon points="71.1,131.0 133.8,131.0 121.0,72.1" fill="none" stroke="#F5B726" stroke-width="4.5" stroke-linejoin="round"/><polygon points="91.1,120.5 120.5,120.5 114.5,92.9" fill="none" stroke="#D72D2D" stroke-width="4.5" stroke-linejoin="round"/></svg>';

// STORY-27.1.02 — the class-injection transform, lifted out of resolveBadgeMarkup()
// so fixtures can drive it directly. There is still exactly ONE implementation:
// resolveBadgeMarkup() calls this, so tests/badge-markup.test.js exercises the
// shipped path rather than a copy of it (the phase-band-source.test.js precedent).
//
// The append pattern captures the quote character and back-references it, so an
// operator SVG authored with class='…' is handled identically to class="…". The
// DETECTION regex above it was always quote-agnostic; only the append was
// double-quote-only, which is why a single-quoted asset silently kept its own
// classes and lost the sizing and ring.
//
// The trailing (?=[\s/>]) is a deliberate addition to the pattern STORY-27.1.02
// AC-1 suggests, and it is what keeps a MALFORMED asset from being corrupted.
// Given `<svg class="mark viewBox="0 0 24 24">` (unbalanced quotes), the value
// capture happily runs to the next quote and, without the lookahead, the rewrite
// produces `<svg class="mark viewBox= logo-badge"0 0 24 24">` — silently mangled
// operator input. The lookahead requires the closing quote to actually end an
// attribute, so a malformed tag matches nothing and is returned untouched.
// ADR-0137 records the trade-off: untouched means no ring, which is visible and
// recoverable; mangled means broken markup, which is neither.
//
// STORY-30.6.02 / BACKLOG-0139 — the attribute boundary is WHITESPACE, not `\b`.
//
// `\bclass` also matches inside `data-class`, because a word boundary sits after
// the hyphen. Combined with a greedy `[^>]*`, the pattern bound to the LAST
// class-suffixed attribute in the tag, so
//
//     <svg class="mark" data-class="decoy" viewBox="0 0 24 24">
//
// came out as `data-class="decoy logo-badge"`: the operator's data attribute
// edited, and the badge left with no sizing and no ring. With the decoy BEFORE
// the real class the greedy match landed correctly, so the defect was
// ordering-dependent — which is exactly the kind that survives review, and did.
//
// `[^>]*\sclass` requires real whitespace before the attribute name, so
// `data-class` can no longer match. `<svgclass=` is not reachable, so nothing
// legitimate needed `\b`.
//
// GREEDY vs NON-GREEDY, re-checked as BACKLOG-0139's tranche asked. Greedy existed
// only to skip the `data-class` decoy. With the boundary correct the two agree on
// every well-formed tag, and NON-greedy is the clearer statement of the intent:
// "the FIRST real class attribute". A tag with two genuine `class=` attributes is
// invalid HTML and the parser would keep the first, so first is also the right
// answer there.
//
// The trailing (?=[\s/>]) stays, and so does its reason (ADR-0137): given
// `<svg class="mark viewBox="0 0 24 24">` (unbalanced quotes) the value capture
// would otherwise run to the next quote and produce silently mangled operator
// input. The lookahead requires the closing quote to actually end an attribute, so
// a malformed tag matches nothing and is returned untouched — no ring, which is
// visible and recoverable, rather than broken markup, which is neither.
function applyBadgeClass(raw) {
  if (/<svg\b[^>]*?\sclass\s*=/.test(raw)) {
    return raw.replace(/(<svg\b[^>]*?\sclass\s*=\s*)(["'])([^"']*)\2(?=[\s/>])/, function (m, pre, q, cls) {
      return (' ' + cls + ' ').indexOf(' logo-badge ') !== -1 ? m : pre + q + cls + ' logo-badge' + q;
    });
  }
  return raw.replace(/<svg\b/, '<svg class="logo-badge"');
}

function resolveBadgeMarkup() {
  try {
    if (fs.existsSync(BADGE_ASSET_PATH)) {
      const raw = fs.readFileSync(BADGE_ASSET_PATH, 'utf8').trim();
      if (raw) {
        // Ensure the inlined asset carries the logo-badge contract class
        // regardless of what the source SVG file authored.
        const out = applyBadgeClass(raw);
        // A tag that declares a class but comes back unchanged is the malformed
        // case above: the badge will render without its sizing and ring. Say so
        // rather than leaving the operator to wonder why their asset looks wrong.
        //
        // BUG-20260803-04, two defects in the first cut of this check:
        //   1. It scanned the WHOLE document for "logo-badge". A child element or
        //      a <title> carrying that string suppressed the warning even though
        //      the root tag was never rewritten. Scoped to the root tag now, using
        //      the same `\bclass` semantics applyBadgeClass() itself targets so the
        //      warning fires exactly when that function's contract failed.
        //   2. It pushed a STRING. Both consumers of diagnostics.warnings — the
        //      console printer in main() and the in-page diagnostics banner in
        //      emitHtml() — read `.path` / `.reason`, so the message rendered as
        //      "Warning: undefined  (undefined)" on stderr and as an EMPTY bullet
        //      under "1 file(s) raised a warning." on the board. ADR-0137 accepts
        //      an unstyled badge specifically because the failure is "named in
        //      diagnostics"; it was not.
        // BUG-20260824-05 — ANCHOR ON THE TAG, NOT ON THE FIRST ">".
        //
        // This sliced from byte 0 to the first ">" and called that the root tag. An SVG that
        // opens with an XML prolog or a doctype puts a ">" before <svg ever starts, so the
        // slice was the PROLOG — which of course carries no class — and the warning fired
        // saying the badge could not be given its contract class, immediately after
        // applyBadgeClass() had successfully given it exactly that. A warning that
        // contradicts the transform it is checking teaches a reader to ignore warnings.
        //
        // Anchoring on /<svg\b/ is the same intent, correctly expressed, and it keeps
        // BUG-20260803-04's narrowing to the root tag intact.
        const svgAt = out.search(/<svg\b/i);
        const rootTag = svgAt === -1 ? '' : out.slice(svgAt, out.indexOf('>', svgAt) + 1);
        if (!/\bclass\s*=\s*(["'])(?:[^"']*\s)?logo-badge(?:\s[^"']*)?\1/.test(rootTag)) {
          diagnostics.warnings.push({
            path: rel(BADGE_ASSET_PATH),
            reason: 'the root <svg> tag could not be given the logo-badge contract class '
              + '(unbalanced quotes in its class attribute, or no <svg> root at all) — the asset is '
              + 'inlined verbatim and the badge will render without its sizing and ring. '
              + 'See STORY-27.1.02 / ADR-0137.',
          });
        }
        return out;
      }
    }
  } catch (_e) { /* fall through to built-in recreation */ }
  return BUILTIN_BADGE_SVG;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// STORY-21.4.01 (BACKLOG-0082 / ADR-0084) — plain-English "what you'll see"
// deliverable line for the Plan → Roadmap timeline. Built server-side (same
// pre-render pattern as mdToHtml's bodyHtml, see buildPmCorpus) so the
// ADR-0059 thin-input rule is enforced in exactly one place and is directly
// unit-testable via the module.exports test seam, rather than being
// re-implemented inside the client-side render template. An empty/absent/
// whitespace-only outcome MUST render NOTHING — no placeholder sentence, no
// fabricated line — the caller receives an empty string and renders no
// element at all.
function buildDeliverableLine(outcome, cssClass) {
  const text = (outcome == null ? '' : String(outcome)).trim();
  if (!text) return '';
  return '<p class="' + cssClass + '"><span class="lab">What you\'ll see</span> ' + escapeHtml(text) + '</p>';
}

// Shared allow-list for both the link (`[txt](href)`) and image
// (`![alt](src)`) inline rules in mdToHtml()'s inline() — STORY-21.5.02
// requires the image rule to reuse the SAME list verbatim so a `javascript:`
// (or any other non-allow-listed scheme) is rejected identically for both.
const SAFE_HREF_RE = /^(https?:|mailto:|#|\.\.?\/)/;

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ============================================================
// tokenCost(content) — context-load token-cost estimator.
//
// METHOD (documented + reviewable — AC-1): a dependency-free
// heuristic, Math.ceil(chars / 4). The "~4 characters per token"
// rule-of-thumb approximates how modern BPE tokenizers split
// English prose and code, and is the standard cheap estimate.
// We deliberately choose the heuristic over vendoring a real
// tokenizer because this is a CONTEXT-LOAD ("context tax") figure
// — how much of the context window an artefact costs to LOAD into
// an agent — NOT a per-invocation/$ billing figure, so cheap +
// dependency-free + reproducible beats exact. Node stdlib only,
// consistent with the 93-Scripts/ contract.
//
// PER-SCOPE COUNTING RULE (AC-2) — what loaded content the
// CONSUMER (STORY-11.3.02's buildAiCatalogue) assembles into the
// string handed to this helper, per artefact kind:
//   • command / skill = its SKILL.md (or command .md) body
//                       + any always-loaded reference content
//   • sub-agent       = its definition body
//   • plugin          = the sum of what it auto-loads (its
//                       bundled skills/agents/commands)
// This helper does NOT re-walk the disk or re-assemble that string
// — it takes the already-assembled loaded-content string and
// returns its token cost, so it stays a pure, unit-testable
// function of its argument.
//
// TOTAL + DETERMINISTIC (AC-4): '', null, undefined, and
// whitespace-only inputs return 0 (the documented floor); the same
// input always yields the same value; the return is always a
// non-negative integer. Single pass over the string (O(n)).
// ============================================================
function tokenCost(content) {
  if (content == null) return 0;
  const s = String(content).trim();
  if (s === '') return 0;
  return Math.ceil(s.length / 4);
}




// STORY-21.5.02 / BUG-20260618-02: block-level pre-pass that strips HTML
// comments (<!-- ... -->, including multi-line) BEFORE any escaping/inline
// processing runs, so no comment text ever reaches the rendered output.
// Fence-aware: mirrors mdToHtml's own fence open/close detection so the
// strip never reaches inside a ``` fenced block — a README's code sample may
// legitimately contain literal <!-- or <div> text and must survive verbatim.
// Unterminated <!-- (no matching --> before EOF) is stripped to end-of-line
// only, so it never swallows the rest of the document.
function stripHtmlCommentsOutsideFences(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let inFence = false;
  let buf = [];

  function flushBuf() {
    if (!buf.length) return;
    let text = buf.join('\n');

    // ========================================================================
    // AN INLINE CODE SPAN IS LITERAL TOO, NOT ONLY A FENCED BLOCK (BUG-20260817-12)
    // ========================================================================
    // This pre-pass was built for a BLOCK-level problem (STORY-21.5.02) and carved out fenced
    // blocks because that is where the counter-example lived — its own comment says a code sample
    // "may legitimately contain literal `<!--` or `<div>` text and must survive verbatim". An
    // inline span is the same claim at a smaller scale, and it was never considered: an artefact
    // writing `` `<!-- PM-KIT-BLOCK -->` `` in backticks, meaning "show this marker literally", had
    // the whole span deleted and rendered as two stray backticks. Worse, with the markers in two
    // different spans (`` `<!--` / `-->` ``) the strip ran from the first to the second and took
    // the prose BETWEEN them with it.
    //
    // SPANS ARE LIFTED OUT, NOT SEGMENTED AROUND. Splitting the text on spans and running the
    // comment regexes over the gaps would protect the spans — and would then FAIL TO STRIP a
    // genuine comment that happens to contain one (`<!-- see `foo` -->`), because its two markers
    // would land in different segments. Substituting a placeholder keeps the comment regexes
    // whole: a real comment still matches across the placeholder and takes it with it, which is
    // correct — content inside a comment is comment.
    //
    // ONE GRAMMAR, NOT A FOURTH ANSWER. `` `[^`\n]+` `` is the span shape `inline()`,
    // `lastIndexOutsideCode()` and `balanceInlineMarkers()` already assume, narrowed to a single
    // line: this buffer is MULTI-LINE (that is what makes multi-line comment stripping possible),
    // and a grammar that let a span run across a blank line would protect text no later reader
    // considers a span. An unpaired backtick is not a span here either, exactly as it is not there.
    //
    // NUL is the placeholder `inline()` already uses for the same job, and it strips any stray one
    // before its own extraction — so nothing here can survive into the output as a NUL. Pre-existing
    // NULs are removed first so a hostile artefact cannot forge a placeholder index.
    const spans = [];
    text = text.replace(/\u0000/g, '').replace(/`[^`\n]+`/g, (span) => {
      spans.push(span);
      return `\u0000${spans.length - 1}\u0000`;
    });

    // Balanced comments first (non-greedy so adjacent comments don't merge).
    text = text.replace(/<!--[\s\S]*?-->/g, '');
    // Any remaining (unterminated) <!-- is stripped to end-of-line only.
    text = text.replace(/<!--.*$/gm, '');

    // Restore whatever placeholders the comment passes did not consume.
    text = text.replace(/\u0000(\d+)\u0000/g, (whole, n) => {
      const span = spans[Number(n)];
      return span === undefined ? whole : span;
    });

    out.push(text);
    buf = [];
  }

  for (const line of lines) {
    if (inFence) {
      if (line.trim().startsWith('```')) inFence = false;
      out.push(line); // fence contents/close line untouched
      continue;
    }
    if (/^```(\w*)\s*$/.test(line)) {
      flushBuf();
      out.push(line); // fence-open line untouched
      inFence = true;
      continue;
    }
    buf.push(line);
  }
  flushBuf();
  return out.join('\n');
}

/* ============================================================
 * Cross-reference resolution (STORY-23.3.02)
 *
 * function resolveCrossRefs(html, idIndex, selfId) — build-time link
 * resolution: scans an already-rendered bodyHtml string for artefact-ID
 * patterns (STORY-/FEAT-/EPIC-/TESTPLAN-/BUG-/ADR-) and wraps any that
 * resolve against idIndex in a `.xref-pill.xref-inline` button the client's
 * existing wireDrawerLinks() already knows how to bind (same class the
 * frontmatter-derived cross-reference pills use, so one click handler covers
 * both). Runs ONCE per item, at build time, against the compiled artefact
 * index — never at click time against the filesystem (the board is offline).
 * IDs that don't resolve, and the item's own id, are left as inert plain
 * text: no dead link, no console error, nothing to click.
 *
 * Tag-aware by construction: splits on `<...>` boundaries and only rewrites
 * text OUTSIDE tags, so attribute values and tag names are never touched —
 * the XSS discipline the drawer's body pipeline already relies on (bodyHtml
 * is markdown-escaped by mdToHtml before this ever runs; this pass only ever
 * *wraps* already-escaped substrings in a fixed-shape element, never injects
 * unescaped content).
 *
 * Fence-aware (CHAT-04 review, anno-5): also tracks <pre> depth and skips
 * rewriting text runs inside <pre>...</pre> — code blocks are the one place
 * in an artefact where text is meant to be literal (shell transcripts,
 * mermaid/PlantUML source, Command: fences meant to be copied verbatim), and
 * splicing a clickable button into them is exactly wrong there.
 * ============================================================ */
const XREF_ID_RE = /\b(STORY|TESTPLAN|FEAT|EPIC|BUG|ADR)-[A-Za-z0-9.]+\b/g;

function resolveCrossRefs(html, idIndex, selfId) {
  if (!html || !idIndex) return html || '';
  // Split on tags, keeping the delimiters — odd indices are the literal `<...>`
  // tags (left untouched); even indices are the text runs we may rewrite.
  const parts = html.split(/(<[^>]+>)/);
  let preDepth = 0;
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      // A literal tag — track <pre> nesting, never rewritten either way.
      if (/^<pre\b/i.test(parts[i])) preDepth++;
      else if (/^<\/pre>/i.test(parts[i])) preDepth = Math.max(0, preDepth - 1);
      continue;
    }
    if (preDepth > 0) continue; // inside a code fence — leave text verbatim
    const seg = parts[i];
    if (!seg || seg.indexOf('-') === -1) continue; // fast skip: every ID pattern needs a hyphen
    parts[i] = seg.replace(XREF_ID_RE, (m) => {
      if (m === selfId) return m; // no self-link
      const type = idIndex.get(m);
      if (!type) return m; // unresolvable — stays inert plain text
      return '<button type="button" class="xref-pill xref-inline" data-xref-type="' + type + '" data-xref-id="' + m + '">' + m + '</button>';
    });
  }
  return parts.join('');
}

// STORY-25.2.01: flushBlockquote() re-enters mdToHtml(), so a quote carrying a
// heading, a list or another quote keeps that structure. The recursion is
// bounded: past MD_MAX_BLOCKQUOTE_DEPTH the remaining block is emitted as
// escaped text instead of recursing again. Input can only nest as deep as the
// number of leading `>` characters (each level strips one), so this cap is a
// belt-and-braces guard against a malformed document rather than a live risk —
// but an unbounded reentrant parser is exactly the shape that turns a hostile
// artefact body into a generator hang, and the cost of the cap is one integer.
const MD_MAX_BLOCKQUOTE_DEPTH = 6;

// Minimal markdown → HTML. Handles headings, paragraphs, fenced code, inline
// code, lists (ul/ol, nested, task lists), blockquotes, tables, links,
// bold/italic, hr, images, and a small allow-listed raw-HTML block passthrough
// (STORY-21.5.02).
//
// PUBLIC ARITY IS ONE, deliberately. The blockquote recursion needs a depth
// counter, but exposing it on the exported function would make
// `arr.map(mdToHtml)` pass the array index as the depth — and any index >=
// MD_MAX_BLOCKQUOTE_DEPTH would silently switch that item's quotes to the
// escaped-text fallback. The counter lives on the private inner function
// instead, where no caller can reach it. (Caught in AI review of STORY-25.2.01;
// latent only — all 12 current call sites pass one argument.)
function mdToHtml(md) {
  return mdToHtmlAtDepth(md, 0);
}

function mdToHtmlAtDepth(md, depth) {
  if (!md) return '';
  md = stripHtmlCommentsOutsideFences(md);
  const lines = md.split(/\r?\n/);
  let out = '';
  let inCode = false;
  let codeBuf = [];
  let codeLang = '';
  // STORY-25.2.01: a stack, not a boolean — one frame per open list level, so
  // nested lists open and close in the right order and a nested <ul>/<ol> is
  // emitted INSIDE its parent's still-open <li> rather than as an invalid
  // sibling. `liOpen` is what makes that possible: an <li> is not closed until
  // we know whether a deeper list follows it.
  let listStack = [];
  let para = [];
  let table = null;
  let blockquote = [];

  // STORY-30.4.02 / BACKLOG-0115 / BACKLOG-0117 / BUG-20260817-08.
  //
  // CODE SPANS ARE EXTRACTED BEFORE ANY OTHER INLINE RULE RUNS, and restored last.
  // This is the standard GFM ordering, and it is the whole fix for BUG-20260817-08.
  //
  // Before: every rule was an independent regex pass over the same string, so the
  // bold rule matched straight through markup the code rule had already emitted.
  // A line the corpus writes constantly —
  //     scanning `skills/**/SKILL.md` and `92-Prompts/**/*.md`
  // — became CROSSED, not nested:
  //     scanning <code>skills/<strong>/SKILL.md</code> and <code>92-Prompts/</strong>/*.md</code>
  // because `\*\*([^*]+)\*\*` happily spanned from the `**` inside the first code
  // span to the one inside the second. 20 of 1,533 shipped bodies were affected.
  //
  // Tokenising makes the precedence structural rather than a matter of which regex
  // happens to run first: once a code span is a placeholder, no emphasis rule can
  // see inside it or reach across it, and content inside backticks stays literal
  // by construction.
  //
  // PLACEHOLDER SAFETY. The placeholder is NUL-delimited (`\u0000<n>\u0000`), and
  // every NUL in the input is stripped BEFORE the first span is extracted — so the
  // only NULs in the string are ones this function put there, and no artefact can
  // forge a placeholder to have arbitrary HTML substituted into its body. (The
  // bug's Option A names exactly this risk.) NUL is not valid in the corpus'
  // markdown anyway; stripping it costs nothing and turns "no artefact can write
  // this" from an assumption into an invariant.
  //
  // ESCAPING IS UNCHANGED AND STILL FIRST. escapeHtml() runs before extraction, so
  // code-span content is escaped exactly as it was, and the restored `<code>` holds
  // the same bytes it always did. The XSS cases run in the same breath (the story's
  // gotcha), plus an adversarial case that puts markup inside a code span.
  function inline(s) {
    s = escapeHtml(s).replace(/\u0000/g, '');

    // 1. Extract code spans. `[^`]+` is the same span shape lastIndexOutsideCode()
    // and balanceInlineMarkers() already assume, so all three agree on what a code
    // span is — the ADR-0161 discipline applied to this grammar.
    const codeSpans = [];
    s = s.replace(codeSpanRe(), (_, ticks, body) => {
      codeSpans.push('<code>' + codeSpanBody(body) + '</code>');
      return '\u0000' + (codeSpans.length - 1) + '\u0000';
    });

    // 2. Emphasis, over a string that now contains no code spans.
    //
    // `***both***` first, because neither of the two rules below can produce nested
    // emphasis from it on their own: the bold rule would stop at the third asterisk
    // and leave a stray one for the italic rule to pair with a DIFFERENT asterisk,
    // which is how a crossed <strong>/<em> pair gets built.
    s = s.replace(/\*\*\*(?!\s)([^*\n]+?)(?<!\s)\*\*\*/g, '<strong><em>$1</em></strong>');

    // Bold, widened from `[^*]+` to "any non-asterisk, or an asterisk that is not
    // part of a `**`". That single change is what makes BACKLOG-0115's case work:
    // `**bold *italic* bold**` previously failed to match at all — the inner `*`
    // disqualified the content — and rendered as four literal asterisks. `****`
    // still does not match (an asterisk followed by an asterisk is excluded), which
    // balanceInlineMarkers() documents itself as relying on.
    s = s.replace(/\*\*((?:[^*]|\*(?!\*))+)\*\*/g, '<strong>$1</strong>');

    // Asterisk italic. New — the parser had only the underscore form, so `*text*`
    // rendered as literal asterisks everywhere.
    //
    // Deliberately strict, in three ways that each prevent a specific misfire:
    //   - the opener may not follow a word character or another `*`, and the closer
    //     may not precede one, so `a*b*c` and leftover `**` are not emphasis;
    //   - the content may not begin or end with whitespace, so `2 * 3 = 6` and
    //     `- item * note` are untouched (GFM's flanking rule, in miniature);
    //   - THE CONTENT MAY NOT CONTAIN `<`. This is the anti-crossing guard: at this
    //     point the only `<` in the string are tags THIS function emitted, so
    //     forbidding them means an <em> can never open inside a <strong> and close
    //     outside it. The cost is that `*italic with **bold** inside*` renders its
    //     asterisks literally instead of nesting — the underscore form `_…_` handles
    //     that case, and a literal asterisk is a fidelity miss, whereas crossed tags
    //     are malformed output. This story exists to remove crossed tags; trading
    //     one back for a nicer render of a shape no AC asks for would be a poor deal.
    s = s.replace(/(^|[^\w*])\*(?!\s)([^*<\n]*[^\s*<]|[^\s*<])\*(?![\w*])/g, '$1<em>$2</em>');

    // Underscore italic, unchanged. It DOES allow `<` in its content — deliberately,
    // and safely: `_` delimiters cannot pair across a tag the way a leftover `*` can,
    // so `_a **b** c_` nests correctly and is worth keeping.
    s = s.replace(/(^|\s|\()_([^_\n]+)_(?=$|\s|[.,;:!?\)])/g, '$1<em>$2</em>');
    // Image rule MUST precede the link rule: `![alt](src)` shares the link
    // rule's `[txt](href)` shape, so an un-consumed image would half-match
    // the link regex below and leave a dangling `!` + hyperlink
    // (BUG-20260618-02, Case B). Same safeHref allow-list as the link rule;
    // a rejected scheme (e.g. javascript:) falls back to plain alt text.
    s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function (_, alt, src) {
      if (SAFE_HREF_RE.test(src)) return '<img alt="' + alt + '" src="' + src + '">';
      return alt;
    });
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, txt, href) {
      const safeHref = SAFE_HREF_RE.test(href) ? href : '#';
      return '<a href="' + safeHref + '"' + (safeHref.startsWith('http') ? ' target="_blank" rel="noopener"' : '') + '>' + txt + '</a>';
    });

    // 3. Restore the code spans, LAST — after emphasis, images and links, so no
    // rule above could see into one or match across one.
    //
    // A placeholder that reached a place the restore cannot re-enter — an `href`
    // attribute, say, from the pathological `[a](`b`)` — was already discarded by
    // SAFE_HREF_RE (that href is not on the allow-list, so it became `#`). The span
    // is then simply dropped rather than substituted somewhere it would be markup.
    // The index is always one this function pushed, so `codeSpans[i]` cannot be
    // undefined; the `|| ''` is a belt-and-braces guard, not a live path.
    if (codeSpans.length) {
      s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => codeSpans[Number(i)] || '');
    }
    return s;
  }
  function flushPara() {
    if (para.length) {
      out += '<p>' + inline(para.join(' ')) + '</p>\n';
      para = [];
    }
  }
  function openList(tag, cls, indent) {
    out += '<' + tag + (cls ? ' class="' + cls + '"' : '') + '>\n';
    listStack.push({ tag: tag, cls: cls, indent: indent, liOpen: false });
  }
  function closeTopList() {
    const f = listStack.pop();
    if (f.liOpen) out += '</li>\n';
    out += '</' + f.tag + '>\n';
  }
  function closeList() {
    while (listStack.length) closeTopList();
  }
  // Emit one list item at `indent` columns, in a `tag` list carrying `cls`.
  // The class is always one of this function's own literals — never author
  // input — so it cannot carry an injected attribute (see the `task-list`
  // cases in md-to-html.test.js sanitisation).
  function emitListItem(indent, tag, cls, innerHtml) {
    flushPara();
    while (listStack.length && indent < listStack[listStack.length - 1].indent) closeTopList();
    const top = listStack.length ? listStack[listStack.length - 1] : null;
    if (!top || indent > top.indent) {
      // Deeper (or the first list): nest inside the parent's open <li>.
      openList(tag, cls, indent);
    } else if (top.tag !== tag || top.cls !== cls) {
      // Same level, different kind (ul↔ol, plain↔task): close and reopen.
      closeTopList();
      openList(tag, cls, indent);
    } else if (top.liOpen) {
      out += '</li>\n';
      top.liOpen = false;
    }
    const frame = listStack[listStack.length - 1];
    out += '<li>' + innerHtml;
    frame.liOpen = true;
  }
  // A tab expands to 4 columns, matching CommonMark/GFM — which also makes a
  // tab and four spaces interchangeable, so a document that mixes the two
  // nests the way its author saw it in their editor. (2 was the first choice
  // and would have collided tab-indented children with 2-space-indented ones.)
  function indentWidth(ws) {
    return ws.replace(/\t/g, '    ').length;
  }
  function flushTable() {
    if (!table) return;
    out += '<div class="md-table-wrap"><table class="md-table"><thead><tr>';
    for (const h of table.headers) out += '<th>' + inline(h) + '</th>';
    out += '</tr></thead><tbody>';
    for (const row of table.rows) {
      out += '<tr>';
      for (const cell of row) out += '<td>' + inline(cell) + '</td>';
      out += '</tr>';
    }
    out += '</tbody></table></div>\n';
    table = null;
  }
  // STORY-25.2.01: the collected quote body is re-parsed as markdown instead of
  // being joined with spaces and run through inline(). Joining with '\n' (not
  // ' ') is load-bearing — the recursive pass needs the original line structure
  // to see headings, list items and nested `>` levels at all.
  function flushBlockquote() {
    if (!blockquote.length) return;
    const inner = blockquote.join('\n');
    blockquote = [];
    if (depth >= MD_MAX_BLOCKQUOTE_DEPTH) {
      // The one place the parser dumps a whole un-parsed block into output.
      // escapeHtml() here is load-bearing, not cosmetic — md-to-html.test.js
      // depth-cap asserts it with a hostile fixture.
      out += '<blockquote><p>' + escapeHtml(inner) + '</p></blockquote>\n';
      return;
    }
    out += '<blockquote>\n' + mdToHtmlAtDepth(inner, depth + 1) + '</blockquote>\n';
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inCode) {
      if (line.trim().startsWith('```')) {
        out += '<pre><code class="lang-' + escapeHtml(codeLang) + '">' + escapeHtml(codeBuf.join('\n')) + '</code></pre>\n';
        inCode = false; codeBuf = []; codeLang = '';
      } else { codeBuf.push(line); }
      continue;
    }
    const codeStart = line.match(/^```(\w*)\s*$/);
    if (codeStart) { flushPara(); closeList(); flushTable(); flushBlockquote(); inCode = true; codeLang = codeStart[1]; continue; }
    // STORY-21.5.02 / BUG-20260618-02: known-safe raw block HTML passthrough.
    // A line consisting solely of an allow-listed container tag (<div ...>,
    // </div>, <p ...>, </p> — the family Tandem's own README uses for
    // centering) is emitted verbatim instead of falling into the
    // paragraph -> inline() -> escapeHtml() path, where it would otherwise
    // render as visible escaped literal text. Anything NOT on this small
    // allow-list (e.g. <script>) intentionally falls through to normal
    // paragraph handling below and stays escaped.
    // BUG-20260731-03: the tag name and its attribute string are captured
    // separately so the attribute string can be filtered — only `class` is
    // re-emitted (the README-centering use case); on*=, style=, id=, and any
    // other attribute (incl. arbitrary data-*) are dropped. Without this,
    // every attribute an author put on the line rode through unfiltered
    // (e.g. onclick=) straight into bodyHtml, which every drawer render path
    // assigns into body.innerHTML.
    const rawHtml = line.match(/^\s*(<\/?(?:div|p))(\s[^<>]*)?>\s*$/i);
    if (rawHtml) {
      flushPara(); closeList(); flushTable(); flushBlockquote();
      const attrs = rawHtml[2] || '';
      const cls = attrs.match(/\sclass\s*=\s*"([A-Za-z0-9 _-]*)"/i);
      out += rawHtml[1] + (cls ? ' class="' + cls[1] + '"' : '') + '>\n';
      continue;
    }
    // Table detection: header line followed by separator
    if (line.indexOf('|') !== -1 && i + 1 < lines.length && /^\s*\|?\s*:?-+:?(\s*\|\s*:?-+:?)+\s*\|?\s*$/.test(lines[i + 1])) {
      flushPara(); closeList(); flushBlockquote();
      const headers = line.split('|').map(s => s.trim()).filter((_, idx, a) => !(idx === 0 && a[0] === '') && !(idx === a.length - 1 && a[a.length - 1] === ''));
      table = { headers, rows: [] };
      i++; // skip separator
      while (i + 1 < lines.length && lines[i + 1].indexOf('|') !== -1 && lines[i + 1].trim() !== '') {
        i++;
        const cells = lines[i].split('|').map(s => s.trim()).filter((_, idx, a) => !(idx === 0 && a[0] === '') && !(idx === a.length - 1 && a[a.length - 1] === ''));
        table.rows.push(cells);
      }
      flushTable();
      continue;
    }
    if (/^---+\s*$/.test(line)) { flushPara(); closeList(); flushBlockquote(); out += '<hr>\n'; continue; }
    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) { flushPara(); closeList(); flushBlockquote(); out += '<h' + h[1].length + '>' + inline(h[2]) + '</h' + h[1].length + '>\n'; continue; }
    const bq = line.match(/^>\s?(.*)$/);
    if (bq) { flushPara(); closeList(); blockquote.push(bq[1]); continue; }
    if (blockquote.length) flushBlockquote();
    // STORY-25.2.01 AC-2: the task-list branch MUST be tested before the plain
    // `ul` branch. Order is the whole trick — `- [ ] foo` also matches the
    // bullet regex, and whichever branch runs first wins, so a task item tested
    // second renders as a bullet whose visible text starts with a literal "[ ]".
    // The checkbox is synthesised from fixed literals (never from the marker or
    // the label), so there is no attribute an author can inject into it.
    // The label is optional: a bare `- [x]` is a checked box with no text in
    // GFM, and without `(?:...)?` it would fall through to the bullet branch and
    // render the marker as the literal text "[x]".
    // aria-hidden: the box is decorative — always `disabled`, never interactive
    // — so a screen reader should read the item's text, not announce an unnamed
    // dimmed checkbox in front of it.
    const task = line.match(/^(\s*)[-*]\s+\[([ xX])\](?:\s+(.*))?$/);
    if (task) {
      const checked = task[2] !== ' ';
      emitListItem(indentWidth(task[1]), 'ul', 'task-list',
        '<input type="checkbox" disabled aria-hidden="true"' + (checked ? ' checked' : '') + '> ' + inline(task[3] || ''));
      continue;
    }
    const ul = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (ul) {
      emitListItem(indentWidth(ul[1]), 'ul', '', inline(ul[2]));
      continue;
    }
    const ol = line.match(/^(\s*)\d+\.\s+(.+)$/);
    if (ol) {
      emitListItem(indentWidth(ol[1]), 'ol', '', inline(ol[2]));
      continue;
    }
    if (line.trim() === '') { flushPara(); closeList(); continue; }
    para.push(line);
  }
  flushPara(); closeList(); flushBlockquote(); flushTable();
  if (inCode) out += '<pre><code>' + escapeHtml(codeBuf.join('\n')) + '</code></pre>\n';
  return out;
}

function asArray(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim()) return [v];
  return [];
}

// Extract the trimmed text under a `## <heading>` markdown section, up to the next
// heading (any level) or EOF. Used for founder-action inbox items (ADR-0063) so the
// Now-page Pending-action widget can surface the Question + Recommendation. Returns ''.
function extractSection(md, heading) {
  if (!md) return '';
  const re = new RegExp('^##\\s+' + heading + '\\b[^\\n]*(?:\\n|$)', 'im');
  const m = re.exec(md);
  if (!m) return '';
  const rest = md.slice(m.index + m[0].length);
  const next = rest.search(/^#{1,6}\s+/m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

/* ------------------------------------------------------------
 * STORY-25.5.02 — what an expanded card says, per type.
 *
 * The section that DEFINES each artefact, read from the body — deliberately not
 * `outcome:`, which 210 artefacts do not carry (that backfill is BACKLOG-0104
 * Tranche D and is out of scope for EPIC-25).
 *
 * Declared as data rather than a switch in the builder so the paired test can
 * read the SAME table it renders from, and so a type added later cannot get a
 * card without also getting an answer to "what does expanding it show?".
 * ------------------------------------------------------------ */
const CARD_SLOT_SPEC = {
  epic: [{ key: 'goal', label: 'Goal', heading: 'Goal' }],
  feature: [
    { key: 'goal', label: 'Goal', heading: 'Goal' },
    { key: 'user-value', label: 'User value', heading: 'User value' },
  ],
  story: [
    { key: 'as', label: 'As', heading: 'As' },
    { key: 'i-want', label: 'I want', heading: 'I want' },
    { key: 'so-that', label: 'So that', heading: 'So that' },
  ],
  testplan: [{ key: 'scope', label: 'Scope', heading: 'Scope' }],
  // STORY-25.5.03 / ADR-0129. `severity` reads FRONTMATTER (every bug has it);
  // `impact` reads a new BODY SECTION, write-forward — the 88 existing bugs
  // render the ADR-0128 absent-wording rather than being backfilled.
  bug: [
    { key: 'summary', label: 'Summary', heading: 'Summary' },
    { key: 'severity', label: 'Severity', field: 'severity' },
    { key: 'impact', label: 'Impact', heading: 'Impact' },
  ],
  // STORY-27.4.03 / ADR-0146. The retro's own `## Summary` — the section that
  // says what the period WAS, which is the whole reason FEAT-27.4 added it. This
  // is the first carded type outside Build: retro tiles are painted by
  // decisionsRenderer(), not by workTileHtmlSsr()/tileHtml(), so the disclosure
  // pair had to be wired there too rather than inherited.
  //
  // Write-forward, exactly like bug `impact` (ADR-0129): the two retros that
  // predate the template change render the ADR-0128 absent-wording until
  // STORY-27.4.03's backfill lands, and that is honest rather than blank.
  retro: [{ key: 'summary', label: 'Summary', heading: 'Summary' }],
};

// The agreed wording for a section that genuinely is not in the artefact.
// AC-2: render this rather than a blank, and TESTPLAN-25.5.02 TC-02 accepts it
// as real content. Every artefact in the corpus today HAS its section, so this
// path is unexercised by live data and is covered by the fixture test instead.
const SLOT_NOT_RECORDED = 'Not recorded in the artefact.';

// Node-side twin of the client's paSummarise() (see the emitted bundle). Same
// cut rule, character for character: strip fences, collapse whitespace, cut on a
// word boundary past 60% of the limit, single-ellipsis. A twin rather than a
// second pattern — the same Node/client pairing as escapeHtml/escHtml and
// filterAttrs/filterAttrsFor, which ADR-0038 sanctions because the harness has
// no module loader shared between Node and the page. monitorLead() is NOT reused
// here: it emits markdown, and a card slot needs plain text.
function paSummariseNode(txt, max) {
  const s = String(txt == null ? '' : txt).replace(/```+[a-z]*/gi, ' ').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  let cut = s.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  if (sp > max * 0.6) cut = cut.slice(0, sp);
  return `${cut.replace(/[\s,.;:—-]+$/, '')}…`;
}

const SLOT_PART_CHARS = 220;

// The parts an expanded card of this type shows. Exported so
// tests/card-expanded-content.test.js verdicts the SHIPPED mapping rather than
// a re-typed copy that could agree with itself while both drift from the cards.
// STORY-25.5.03 added the third argument. A part reads EITHER a body section
// (`heading`) or a frontmatter field (`field`) — bug severity lives in
// frontmatter and every bug has it, while impact is prose and belongs in the
// body. Both funnel through the same recorded/absent handling, so a missing
// field states itself exactly like a missing section does.
function cardSlotParts(typeKey, body, fm) {
  const spec = CARD_SLOT_SPEC[typeKey];
  if (!spec) return [];
  return spec.map((part) => {
    const raw = part.field
      ? String((fm && fm[part.field]) == null ? '' : fm[part.field])
      : extractSection(body, part.heading);
    const recorded = !!raw.trim();
    return {
      key: part.key,
      label: part.label,
      recorded,
      text: recorded ? paSummariseNode(raw, SLOT_PART_CHARS) : SLOT_NOT_RECORDED,
    };
  });
}

/* ============================================================
 * PM Corpus
 * ============================================================ */

const diagnostics = { unparseable: [], warnings: [] };

// Fallback title for artefacts whose frontmatter omits `title:` — derived from the body's
// first H1 with any leading "<ID> · " prefix stripped so the symptom/subject stands alone.
// The frontmatter field remains the contract (validator R24, BUG-20260731-01); this keeps
// legacy or hand-dropped files readable on the board instead of "(no title)".
function titleFromBody(body) {
  const m = /^#\s+(.+?)\s*$/m.exec(body || '');
  if (!m) return null;
  const stripped = m[1].replace(/^[A-Z][A-Z0-9]*-[^\s·]+\s*·\s*/, '').trim();
  return stripped || null;
}

function buildPmCorpus() {
  const all = {};
  for (const [type, subdir] of Object.entries(SCAN_DIRS)) {
    all[type] = [];
    const root = path.join(PM_ROOT, subdir);
    if (!existsDir(root)) continue;
    const files = walk(root);
    for (const f of files) {
      // ADR-0063: answered founder-action items are moved to 10-Inbox/archive/ and must
      // drop off the live view. Exclude the archive subtree from the corpus entirely so
      // archived items appear in neither the Pending-action widget nor the Capture tab
      // (and their bodyHtml never leaks into the embedded data blob), yet stay on disk.
      if (type === 'inbox' && /[\\/]archive[\\/]/.test(f)) continue;
      const content = readFileSafe(f);
      if (content == null) {
        diagnostics.unparseable.push({ path: rel(f), reason: 'unreadable' });
        continue;
      }
      const { fm, body } = parseFrontmatterAndBody(content);
      if (!fm) {
        // 10-Inbox is free-form quick-capture (CLAUDE.md folder semantics) — a note
        // without frontmatter is legitimate there (e.g. APPROVALS.md), not an error.
        // Skip silently rather than reporting it as unparseable (BUG-20260606-01).
        if (type !== 'inbox') diagnostics.unparseable.push({ path: rel(f), reason: 'no frontmatter' });
        continue;
      }
      const record = {
        type,
        id: fm.id || fileIdFromName(f) || path.basename(f, '.md'),
        title: fm.title || titleFromBody(body) || '(no title)',
        status: (fm.status || 'not-started').toString().trim().toLowerCase(),
        epic: fm.epic || null,
        feature: fm.feature || null,
        story: fm.story || null,
        testplan: fm.testplan || null,
        estimate: fm.estimate || null,
        priority: fm.priority || null,
        severity: fm.severity ? String(fm.severity).toLowerCase() : null,
        okr: fm.okr || null,
        prd_section: fm.prd_section || null,
        outcome: fm.outcome || null,
        prd_refs: fm.prd_refs || null,
        mockup_refs: fm.mockup_refs || null,
        adr_status: fm.adr_status || null,
        type_of_work: fm.type_of_work || null,
        decisions: asArray(fm.decisions),
        related: asArray(fm.related),
        decision: fm.decision || null,
        context_story: fm.context_story || null,
        discovered_in: fm.discovered_in || null,
        captured_from: fm.captured_from || null,
        created_at: fm.created_at || '',
        started_at: fm.started_at || '',
        completed_at: fm.completed_at || '',
        version: fm.version || null,
        ai_review: fm.ai_review || null,
        file: rel(f),
        bodyHtml: mdToHtml(body.trim()),
      };
      record.ageDays = ageDays(record.created_at);
      // STORY-25.5.02 — the expanded-card slot, computed ONCE here and carried on
      // the record, so the server-rendered (story/testplan/bug) and
      // client-rendered (epic/feature) builders render byte-identical content
      // instead of each deriving it. Empty array for types with no card.
      record.cardSlot = cardSlotParts(type, body, fm);
      // `cycleDays` was removed 2026-08-01 (ADR-0107). It was write-only — serialized into
      // window.__DATA for every record and read by nothing — and under orchestrated execution
      // started_at/completed_at are stamped minutes apart by the same run, so a day-floored
      // difference was always 0. Difficulty signals replace clock signals; see ADR-0107.
      // Founder-action inbox items (ADR-0063): carry the action fields + the parsed
      // Question / Recommendation so the Now-page Pending-action widget can render them.
      if (type === 'inbox') {
        record.needs_action = fm.needs_action === true || fm.needs_action === 'true';
        record.action_status = fm.action_status ? String(fm.action_status).toLowerCase() : null;
        record.target_artefact = fm.target_artefact || null;
        record.answered_at = fm.answered_at || '';
        record.recommendation = fm.recommendation || null;
        record.question = extractSection(body, 'Question');
        record.recommendationText = extractSection(body, 'Recommendation') || record.recommendation || '';
      }
      // STORY-21.2.03 — carry the optional usage_estimate (approximate total tokens; R23
      // shape-checked) so buildUsageRollup() can roll it up per epic/feature without a
      // second corpus walk. parsePositiveInt: an absent/invalid value is null, never a
      // fabricated 0 — consistent with usage-reconcile.js / generate-monitor.js.
      if (type === 'story') {
        record.usage_estimate = parsePositiveInt(fm.usage_estimate);
      }
      all[type].push(record);
    }
    all[type].sort((a, b) => {
      const ia = STATUS_ORDER.indexOf(a.status);
      const ib = STATUS_ORDER.indexOf(b.status);
      const sa = ia === -1 ? 999 : ia;
      const sb = ib === -1 ? 999 : ib;
      if (sa !== sb) return sa - sb;
      return String(a.id).localeCompare(String(b.id), 'en', { numeric: true });
    });
  }
  return all;
}

/* ============================================================
 * MONITOR parser — pulls the latest revision-history entries
 * ============================================================ */

// STORY-25.2.02. A MONITOR entry's title and summary are markdown authored by
// hand: `**bold**` marks defect names and backticks mark file paths. The Now
// panel used to print them with escHtml(), so a reader saw the markers instead
// of the emphasis they encode. Rendering happens HERE, at build time, for the
// same reason every artefact body's `bodyHtml` does: mdToHtml() is Node-side,
// and the client has no markdown parser (porting one would mean a second
// sanitisation posture to audit — see ADR-0113).
const MONITOR_LEAD_CHARS = 300;

// Render a single markdown line as INLINE html — mdToHtml wraps a lone
// paragraph in <p>, which is wrong inside a <dd> or a clamped lead.
//
// If the render is anything OTHER than exactly one paragraph, this returns the
// source fully escaped rather than the block markup. That is a security
// boundary, not tidiness (BLOCKER found in AI review of STORY-25.2.02):
// monitorLead() strips fence markers, and a fence is precisely how an author
// says "this is literal text, not markup". Stripping it turned
//     ```<div class="x">```
// — which mdToHtml alone renders as escaped code — into a bare line matching the
// raw-block passthrough, so a LIVE <div> was emitted, unclosed, into the panel.
// The browser then reparented the expander into the summary and the panel
// swallowed the next sibling panel. No XSS reached (script stayed escaped,
// onclick was dropped by the BUG-20260731-03 filter) but it was a new input path
// into the raw-HTML branch, and the blast radius is whatever that allow-list
// ever grows to. An inline slot emits inline markup or nothing.
function mdInlineHtml(md) {
  const html = mdToHtml(md).trim();
  const m = html.match(/^<p>([\s\S]*)<\/p>$/);
  // `<p` not `<p>` — the raw-block variant is `<p class="...">`.
  const inner = m && m[1].indexOf('<p') === -1 ? m[1] : null;
  return inner === null ? escapeHtml(String(md == null ? '' : md)) : inner;
}

// Index of the last occurrence of `needle` that does NOT sit inside a backtick
// code span. Code spans are matched the same way inline() matches them, so this
// agrees with what mdToHtml will actually do.
/**
 * THE code-span shape, defined ONCE (BUG-20260825-07, under ADR-0270's exception).
 *
 * It used to be the literal single-backtick form re-typed in three places, and inline()'s comment
 * said so proudly: all three agreed. They agreed on something WRONG. CommonMark opens a code span
 * with a run of N backticks and closes it on the next run of exactly N -- which is how an author
 * quotes a backtick. Under the single-backtick shape a double-backtick span read as an EMPTY span
 * followed by loose text, and the quoted content escaped onto the page for the emphasis rules to
 * chew on. ADR-0206's own body rendered a double-quoted glob with its asterisks turned into bold:
 * BUG-20260817-08 reappearing, because the code span meant to protect it never formed.
 *
 * A fresh RegExp per call, because every consumer uses /g and would otherwise share lastIndex.
 *
 *   (tick+)        an opening run; greedy, so it takes the WHOLE run
 *   ([sS]*?)       the body, lazy, so the FIRST valid closing run wins
 *   backref+guards a closing run of exactly N -- not part of a longer one on either side
 */
// NOTE: the backticks are written as \x60 rather than literally. probe-literal-guard.test.js
// pairs backticks across the whole file to catch a template literal that a stray one closes and
// reopens, and it cannot tell a regex from a template. Three literal ticks here made the
// scanner mis-pair everything after this line and blame an innocent comment 50 lines down.
// \x60 is the same character to the regex engine and invisible to the scanner.
function codeSpanRe() { return /(\x60+)([\s\S]*?)(?<!\x60)\1(?!\x60)/g; }

/**
 * CommonMark strips ONE leading and ONE trailing space when both are present and the content is
 * not all spaces. That rule is what lets a span hold a backtick at its own edge.
 */
function codeSpanBody(body) {
  if (body.length >= 2 && body[0] === ' ' && body[body.length - 1] === ' ' && body.trim() !== '') {
    return body.slice(1, -1);
  }
  return body;
}
function lastIndexOutsideCode(s, needle) {
  const spans = [];
  const re = codeSpanRe();
  let m;
  while ((m = re.exec(s)) !== null) spans.push([m.index, m.index + m[0].length]);
  const inSpan = (i) => spans.some(([a, b]) => i >= a && i < b);
  for (let i = s.length - needle.length; i >= 0; i--) {
    if (s.startsWith(needle, i) && !inSpan(i)) return i;
  }
  return -1;
}

// Cutting markdown at a character budget can split an inline marker pair, and a
// dangling `**` renders as the literal text this story exists to remove. Repair
// the cut rather than the assertion: close the pair when there is content to
// close, drop the opener when there is not.
//
// Closing an EMPTY pair would produce `****`, which mdToHtml's `\*\*([^*]+)\*\*`
// deliberately does not match — so it would survive as visible `**`. Same for a
// tail that itself contains a `*`.
//
// CODE SPANS ARE EXCLUDED FROM THE COUNT, and that is load-bearing. inline()
// substitutes code BEFORE bold, so a `**` inside backticks is never a bold
// delimiter — it is literal code text, and rendering it literally is CORRECT.
// Counting it made this function "close" a pair mdToHtml cannot see; the bold
// rule then matched across the </code> boundary and emitted mis-nested markup:
//   a `x ** y` z   ->   a <code>x <strong> y</code> z</strong>
// i.e. the repair turned a correct render into broken HTML. (Found in self-review
// of STORY-25.2.02; not reachable from the current corpus, but latent.)
function balanceInlineMarkers(s) {
  let out = s;
  // Backticks first, so the code spans the bold pass must skip are well-formed.
  if (((out.match(/`/g) || []).length) % 2 === 1) {
    const i = out.lastIndexOf('`');
    out = (i === out.length - 1) ? out.slice(0, i) : out + '`';
  }
  const outsideCode = out.replace(codeSpanRe(), '');
  if (((outsideCode.match(/\*\*/g) || []).length) % 2 === 1) {
    const i = lastIndexOutsideCode(out, '**');
    if (i !== -1) {
      const tail = out.slice(i + 2);
      out = (tail.trim().length && tail.indexOf('*') === -1) ? out + '**' : out.slice(0, i);
    }
  }
  return out.trim();
}

// The panel leads with the entry's first sentence, or a word-boundary cut at
// ~MONITOR_LEAD_CHARS when the first sentence is longer than that. Mirrors the
// client's paSummarise() cut rule (BUG-20260801-05) rather than inventing a
// second clamp treatment; it cannot literally reuse it, because paSummarise is
// client-side and produces plain text, while this must produce markdown that is
// still renderable.
//
// Degrades to "first block" rather than an empty lead when an entry opens with a
// fence or a table — the risk the story's own Risks section names.
// Abbreviations that end in a full stop but not a sentence. Without this,
// "…e.g. the ones the drawer renders." cut the lead at "e.g." — and the
// first-sentence branch appends no ellipsis, so the reader could not tell.
const MD_ABBREV_RE = /\b(?:e\.g|i\.e|etc|vs|cf|approx|no|fig|al|Dr|Mr|Mrs|Ms|St|Jr|Sr)\.$/i;

function monitorLead(md, max) {
  const raw = String(md == null ? '' : md).replace(/\s+/g, ' ').trim();
  const s = String(md == null ? '' : md).replace(/```+[a-z]*/gi, ' ').replace(/\s+/g, ' ').trim();
  // `truncated` drives whether the expander renders at all, so it must answer
  // "is anything hidden?", NOT "did I clip on length?". The fence strip and the
  // whitespace collapse both alter the lead without changing its length — and a
  // false `false` silently loses the full entry with no way to reach it.
  const hidden = (lead) => lead !== raw;
  if (!s) return { lead: '', truncated: false };
  if (s.length <= max) return { lead: s, truncated: hidden(s) };
  // Require the terminator to be followed by a sentence-opening character, and
  // reject a known abbreviation, before treating it as a sentence end.
  const firstSentence = s.slice(0, max + 1).match(/^[\s\S]*?[.!?](?=\s+[A-Z\d“"(\[`*])/);
  if (firstSentence && firstSentence[0].trim().length >= 60 && !MD_ABBREV_RE.test(firstSentence[0].trim())) {
    return { lead: balanceInlineMarkers(firstSentence[0].trim()), truncated: true };
  }
  let cut = s.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  if (sp > max * 0.6) cut = cut.slice(0, sp);
  // Never cut a surrogate pair in half — MONITOR entries are full of emoji, and
  // a lone high surrogate renders as a replacement character.
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return { lead: balanceInlineMarkers(cut.replace(/[\s,.;:—-]+$/, '')) + '…', truncated: true };
}

/**
 * MONITOR.md text -> the shipped entry objects. STORY-30.4.03 / BACKLOG-0116.
 *
 * SINGLE PASS, AND ONLY THE RENDERED FORM SHIPS. Each entry used to carry BOTH
 * `title`/`summary` (raw markdown) AND the three rendered fields. The raw pair is
 * a build-time input that then rode into the browser as dead weight:
 *
 *   - `summary` had **zero** readers, anywhere, client or server.
 *   - `title` was read only by a `e.titleHtml || escHtml(e.title || "")` fallback
 *     that could not fire. `mdInlineHtml()` returns escaped source when the render
 *     is not a single paragraph, so it is never empty for a non-empty title, and
 *     the entry regex of the day (`[^*]+`) could not produce an empty one.
 *
 * That was 575 KB of a 30 MB board: a second copy of text nobody read, and the
 * "escape-then-parse leg" BACKLOG-0116 was filed about — a payload carrying the
 * source alongside the render is a standing invitation for a consumer to start
 * re-rendering it and for the two surfaces to drift.
 *
 * THE CONSUMER INVENTORY IS TWO: the Now panel and Cadence › Monitor. Both read
 * the rendered fields only. `monitorEntries` is not fed to the command palette's
 * search index (checked), so there is no third reader.
 *
 * `date` and `truncated` stay and are not markdown: `date` is a plain scalar the
 * client escapes at render time, and `truncated` chooses the expander's wording.
 *
 * Extracted from `parseMonitor()` as a pure text -> entries function so
 * `mdtohtml.test.js --case monitor-single-pass` can drive the SHIPPED builder over
 * a fixture entry, rather than asserting against a re-typed copy of it or needing
 * a fixture PM root in a child process (the phase-band-source.test.js precedent).
 */
// The weaker "looks like a revision entry" shape: a line opening `**YYYY-MM-DD — `.
// BUG-20260831-02's loud gate counts THESE and requires every one to reach the
// board. The full entry shape used to be a single regex whose title group was
// `[^*]+`, so one `*` anywhere in the headline (a glob in a code span such as
// `lib/smoke-*.js`, an inner `**bold**`) made the whole line fail to match and
// the entry silently vanished while pm:dash, pm:monitor and pm:lint all stayed
// green. The gm twin below uses `[^\S\n]*` instead of `\s*` so the count stays
// line-local (a `\s*` under /m could swallow a newline and count a shape the
// per-line parser can never see).
const MONITOR_ENTRY_OPEN_RE = /^\*\*(\d{4}-\d{2}-\d{2})\s*—\s*/;
const MONITOR_ENTRY_WEAK_RE = /^\*\*\d{4}-\d{2}-\d{2}[^\S\n]*—/gm;

/**
 * Split the remainder of a revision line (everything after `**YYYY-MM-DD — `)
 * into { title, summary } at the closing `**` of the LEADING bold run, or
 * return null when that run never closes (the loud gate's case).
 *
 * Neither a lazy nor a greedy regex can find that boundary (BUG-20260831-02):
 *   lazy   `([\s\S]*?)\*\*` breaks a headline containing `**inner bold**` —
 *          it stops at the inner run's OPENER and dumps the rest into the summary;
 *   greedy `([\s\S]*)\*\*`  breaks a SUMMARY containing `**bold**` — it swallows
 *          the real terminator and splits at the last `**` on the line.
 * So this walks the `**` occurrences with markdown's flanking rule: a `**`
 * that has whitespace (or nothing) before it and none after it OPENS an inner
 * run; every other `**` CLOSES the innermost open run, and closing the leading
 * run (depth 0) is the title/summary boundary. A `**` inside a backtick code
 * span is literal code text and never a delimiter — the same exclusion
 * balanceInlineMarkers()/lastIndexOutsideCode() already apply, and what lets a
 * recursive doublestar glob (`**` + slash + `*.md`) sit in a headline.
 *
 * Backward-compatible by construction: every title the old `[^*]+` regex
 * accepted contains no `*` at all, so the first `**` closes at depth 1 and the
 * split lands on exactly the byte the old regex chose.
 */
function splitMonitorHeadline(rest) {
  let depth = 1;
  let inCode = false;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (ch === '`') { inCode = !inCode; continue; }
    if (inCode || ch !== '*' || rest[i + 1] !== '*') continue;
    const prev = i > 0 ? rest[i - 1] : '';
    const next = i + 2 < rest.length ? rest[i + 2] : '';
    const canClose = prev !== '' && !/\s/.test(prev);
    const canOpen = next !== '' && !/\s/.test(next);
    if (canOpen && !canClose) { depth += 1; i += 1; continue; }
    depth -= 1;
    if (depth === 0) return { title: rest.slice(0, i), summary: rest.slice(i + 2) };
    i += 1;
  }
  return null;
}

function buildMonitorEntries(text) {
  const entries = [];
  if (!text) return entries;
  const unparsed = [];
  for (const line of String(text).split(/\r?\n/)) {
    const open = MONITOR_ENTRY_OPEN_RE.exec(line);
    if (!open) continue;
    const split = splitMonitorHeadline(line.slice(open[0].length));
    if (!split) { unparsed.push(open[1]); continue; }
    const title = split.title.trim();
    const summary = split.summary.trim();
    const { lead, truncated } = monitorLead(summary, MONITOR_LEAD_CHARS);
    entries.push({
      date: open[1],
      // Pre-rendered at build time (STORY-25.2.02 / ADR-0114). Every entry gets
      // them, not just entries[0]: a builder that silently falls back to escaped
      // text for some entries is the kind of partial contract that reads as working.
      titleHtml: mdInlineHtml(title),
      leadHtml: mdInlineHtml(lead),
      summaryHtml: mdToHtml(summary),
      truncated,
    });
  }
  // ---- THE LOUD GATE (BUG-20260831-02, Option A — un-bypassable) ------------
  // Every line that LOOKS like an entry must have BECOME one. The count runs
  // against the weaker shape independently of the loop above, so a future
  // parser regression that skips a line it should have seen still trips here.
  // A shortfall THROWS — the pm:dash call site turns it into a failed build
  // (exit 2) before DASHBOARD.html is opened, exactly like the anchor guard;
  // an entry written to MONITOR.md but absent from the board with all tools
  // green is the failure mode this bug exists to make impossible.
  const weak = (String(text).match(MONITOR_ENTRY_WEAK_RE) || []).length;
  if (unparsed.length > 0 || entries.length + unparsed.length !== weak) {
    const shortfall = Math.max(unparsed.length, weak - entries.length);
    const names = unparsed.length
      ? unparsed.join(', ')
      : '(count drift: ' + entries.length + ' parsed vs ' + weak + ' entry-shaped lines)';
    const err = new Error(
      'MONITOR revision entry parse shortfall: ' + shortfall
      + ' line(s) opening "**YYYY-MM-DD — " never became a board entry — ' + names
      + '. Each such headline must close its leading bold run with "**" before the summary; '
      + 'fix the line(s) in MONITOR.md. (BUG-20260831-02)');
    err.monitorGate = true;
    err.dates = unparsed.slice();
    throw err;
  }
  return entries;
}

function parseMonitor() {
  // BUG-20260827-03 — READ THE ROLE THE WRITE RESOLVES, under ADR-0270.
  //
  // ADR-0267 moved OUT_FILE onto the monitor logical role and said, in terms, that it was
  // NOT opening this read. That was the right scope for that exception and the wrong end state:
  // the generator then WROTE the board to 00-Monitor/ on a flattened install while still
  // READING MONITOR.md from a 42-Monitor/ that does not exist there, so the board shipped
  // with an empty monitor panel and no error. Write-resolved and read-hardcoded is the exact
  // split ADR-0267 existed to close, one file further in.
  //
  // monitorDir() is the SAME resolver dashboardOutPath() uses, so the two cannot disagree.
  // On the default layout it returns 42-Monitor, making this a byte-for-byte no-op there.
  const p = path.join(PM_ROOT, monitorDir(loadPaths(PM_ROOT).map), 'MONITOR.md');
  const text = readFileSafe(p);
  if (!text) return { found: false, entries: [], wip: {}, lastUpdated: null };

  // ---- THE ANCHOR GUARD (STORY-28.3.03 / BUG-20260804-01) -------------------------
  // The dashboard is a WRITER too — of the board rendered FROM this file — and it
  // resolves the same anchors by first match: `Last updated` below reads `text.match()`
  // with no `g`, and the entry scan walks whichever body it meets. During the 2026-08-04
  // fork the panel showed one copy's history while a reader scrolling the markdown saw
  // the other, and the header said a date from the stale half. Refusing to render is the
  // only honest answer to a source document that says two things: a board built from an
  // ambiguous MONITOR.md is a confident-looking wrong answer, which is worse than no
  // board. Nothing has been written at this point — `parseMonitor()` runs at the top of
  // main(), long before OUT_FILE is opened — so the previous DASHBOARD.html survives
  // untouched for whoever is repairing the board.
  const guard = monitorAnchors.assertSingleAnchors(text, { file: p, who: 'pm:dash' });
  if (!guard.ok) {
    console.error(guard.message);
    console.error('  DASHBOARD.html was NOT regenerated; the existing one is unchanged.');
    process.exit(2);
  }

  // BUG-20260831-02 — the entry builder now THROWS when a line that looks like a
  // revision entry (`**YYYY-MM-DD — …`) fails to parse, instead of silently
  // dropping it from the board. Same posture as the anchor guard above: nothing
  // has been written yet, so refusing to build leaves the previous board intact.
  let entries;
  try {
    entries = buildMonitorEntries(text);
  } catch (e) {
    if (!e || e.monitorGate !== true) throw e;
    console.error('pm:dash: ' + e.message);
    console.error('  file: ' + p);
    console.error('  DASHBOARD.html was NOT regenerated; the existing one is unchanged.');
    process.exit(2);
  }
  // WIP line: "- **in-progress:** 0 / 2 (limit per SOP §5)"
  const wip = {};
  const wipRe = /\*\*(in-progress|in-review|blocked):\*\*\s+(\d+)\s*\/\s*(\d+)/g;
  let w;
  while ((w = wipRe.exec(text)) !== null) {
    wip[w[1]] = { current: Number(w[2]), limit: Number(w[3]) };
  }
  const lastM = text.match(/Last updated\s*\|\s*([0-9-]+)/);
  return {
    found: true,
    // v1.1: keep ALL entries so Cadence → Monitor can render full revision history.
    // The Now-page widget continues to read entries[0] (the latest).
    entries,
    wip,
    lastUpdated: lastM ? lastM[1] : null,
    bodyHtml: mdToHtml(text),
    file: rel(p),
  };
}

/* ============================================================
 * AI Catalogue
 * ============================================================ */

function categorise(name, kind) {
  if (!name) return 'Other';
  for (const [re, cat] of CATEGORY_RULES) {
    if (re.test(name)) return cat;
  }
  // Defaults by kind
  if (kind === 'command') return 'Commands';
  return 'Other';
}

// A skill may expose "sub-commands" as reference/*.md files (the impeccable
// pattern). Each becomes a drill-down card in the drawer.
function scanSkillSubItems(skillDir) {
  const out = [];
  const refDir = path.join(skillDir, 'reference');
  if (!existsDir(refDir)) return out;
  let entries;
  try { entries = fs.readdirSync(refDir, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    const refContent = readFileSafe(path.join(refDir, e.name));
    if (refContent == null) continue;
    const slug = e.name.replace(/\.md$/, '');
    const { fm: rfm, body: rbody } = parseFrontmatterAndBody(refContent);
    const src = rbody && rbody.trim() ? rbody : refContent;
    const h1 = src.match(/^#\s+(.+)$/m);
    const title = (rfm && rfm.title) || (h1 ? h1[1].trim() : slug);
    const para = src.split(/\r?\n/).find(l => l.trim() && !/^[#>-]|^---/.test(l.trim()));
    out.push({
      slug,
      title,
      desc: truncate(para || '', 200),
      bodyHtml: mdToHtml(src.slice(0, 6000).trim()),
    });
  }
  out.sort((a, b) => a.slug.localeCompare(b.slug));
  return out;
}

function readSkillDir(skillDir, source) {
  const skillMd = path.join(skillDir, 'SKILL.md');
  const content = readFileSafe(skillMd);
  if (content == null) return null;
  const { fm, body } = parseFrontmatterAndBody(content);
  const name = (fm && fm.name) || path.basename(skillDir);
  // BUG-20260618-03 Cases D/E — resolveDescription guards a bare block-scalar
  // indicator and skips to the first prose line (not a raw heading) when absent.
  const fullDescription = resolveDescription(fm, body);
  return {
    kind: 'skill',
    name,
    description: truncate(fullDescription, 260),
    fullDescription,
    source,                  // 'user' | 'project' | 'plugin:NAME'
    file: skillDir.replace(/\\/g, '/'),
    body: body || '',
    bodyHtml: mdToHtml((body || '').trim()),
    subItems: scanSkillSubItems(skillDir),
    category: categorise(name, 'skill'),
  };
}

function readAgentFile(fp, source) {
  const content = readFileSafe(fp);
  if (content == null) return null;
  const { fm, body } = parseFrontmatterAndBody(content);
  const name = (fm && fm.name) || path.basename(fp, '.md');
  // BUG-20260618-03 Cases D/E — resolveDescription guards a bare block-scalar
  // indicator and skips to the first prose line (not a raw heading) when absent.
  const rawDesc = resolveDescription(fm, body);
  // Card blurb: the prose before the first <example>/Specifically marker.
  const blurb = rawDesc.split(/<example>|Specifically:/i)[0].trim();
  const description = truncate(blurb || rawDesc, 220);
  return {
    kind: 'agent',
    name,
    description,
    fullDescription: rawDesc,
    examples: extractAgentExamples(rawDesc),
    source,
    tools: (fm && fm.tools) || '',
    model: (fm && fm.model) || '',
    file: fp.replace(/\\/g, '/'),
    body: body || '',
    bodyHtml: mdToHtml((body || '').trim()),
    category: categorise(name, 'agent'),
  };
}

function readCommandFile(fp, source) {
  const content = readFileSafe(fp);
  if (content == null) return null;
  const { fm, body } = parseFrontmatterAndBody(content);
  const baseName = path.basename(fp, '.md');
  const name = (fm && fm.name) || baseName;
  // BUG-20260618-03 Cases D/E — resolveDescription guards a bare block-scalar
  // indicator and skips to the first prose line (never a raw heading) when
  // absent, ending in a neutral placeholder rather than the bare baseName.
  const description = resolveDescription(fm, body);
  // STORY-11.1.04 / ADR-0047: extract the lifecycle "next command" pointer from the command body
  // (the `Next: `/<plugin>:<x>`` form authored in STORY-11.1.03). Absent → '' → the card renders no
  // next-command element (graceful: the kit's lifecycle commands ship as skills, so a command card
  // may not exist in every environment). Derived from the body's Next: pointer, not a hardcoded chain.
  const nextMatch = (body || '').match(/Next:\s*`?(\/[A-Za-z0-9_-]+:[a-z][a-z-]+)`?/);
  const nextCommand = nextMatch ? nextMatch[1] : '';
  return {
    kind: 'command',
    name,
    description,
    nextCommand,
    source,
    allowedTools: (fm && (fm['allowed-tools'] || fm.allowed_tools)) || '',
    argumentHint: (fm && (fm['argument-hint'] || fm.argument_hint)) || '',
    file: fp.replace(/\\/g, '/'),
    body: body || '',
    bodyHtml: mdToHtml((body || '').trim()),
    category: categorise(name, 'command'),
  };
}

function truncate(s, n) {
  const t = String(s || '').trim();
  n = n || 200;
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

// Frontmatter values are often quoted strings carrying literal escape
// sequences ("...Specifically:\\n\\n<example>..."). Turn them back into real
// whitespace so descriptions and examples render cleanly.
function decodeYamlEscapes(s) {
  if (!s) return '';
  return String(s)
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'");
}

const NO_DESCRIPTION_PLACEHOLDER = 'No description provided.';

// firstProseLine(body) — BUG-20260618-03 Case E: the naive firstLine(body)
// fallback could return a raw markdown line verbatim (a command with no
// `description:` and a body starting `# File Analysis Tool` rendered that
// heading, `#` and all, as the drawer description). Walk the body line by
// line, skipping blank/heading/blockquote/list-marker/rule lines, and return
// the first genuine prose line with leading markdown tokens stripped. Empty
// string when no prose line exists — callers apply NO_DESCRIPTION_PLACEHOLDER.
function firstProseLine(body) {
  if (!body) return '';
  const lines = String(body).split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;                              // blank
    if (/^#{1,6}(\s|$)/.test(line)) continue;          // heading
    if (/^>/.test(line)) continue;                     // blockquote
    if (/^([-*+]|\d+[.)])\s/.test(line)) continue;     // list marker
    if (/^(---+|===+|\*\*\*+)$/.test(line)) continue;  // rule / setext underline
    const stripped = line.replace(/^[#>\s]+/, '').replace(/^[*_`]+/, '').trim();
    if (stripped) return truncate(stripped, 220);
  }
  return '';
}

// resolveDescription(fm, body) — BUG-20260618-03 Cases D+E: the single
// source of truth every card/drawer description read runs through.
//   D: guards against a raw block-scalar indicator ('|', '>', with optional
//      chomping/indent modifiers) surviving as fm.description — belt-and-
//      suspenders on top of parseFrontmatterAndBody's own block-scalar
//      support, in case a caller ever hands in an fm object built elsewhere.
//   E: when there is no usable description, resolves to the first prose
//      line of the body (see firstProseLine) instead of a raw heading/list/
//      blockquote line, falling back to a neutral placeholder when the body
//      has no prose at all.
function resolveDescription(fm, body) {
  const raw = decodeYamlEscapes((fm && fm.description) || '');
  const isBareBlockScalarIndicator = /^[|>][+-]?\d*$/.test(raw.trim());
  if (raw && !isBareBlockScalarIndicator) return raw;
  return firstProseLine(body) || NO_DESCRIPTION_PLACEHOLDER;
}

// Sub-agent descriptions embed <example> blocks (Context / user / assistant /
// <commentary>). Pull them out so the drawer can show concrete triggers.
function extractAgentExamples(desc) {
  const out = [];
  if (!desc) return out;
  const re = /<example>([\s\S]*?)<\/example>/gi;
  let m;
  while ((m = re.exec(desc)) !== null && out.length < 4) {
    const block = m[1].trim();
    const grab = (rx) => { const g = block.match(rx); return g ? g[1].trim().replace(/^["']|["']$/g, '') : ''; };
    out.push({
      context: grab(/Context:\s*([\s\S]*?)(?:user:|$)/i),
      user: grab(/user:\s*([\s\S]*?)(?:assistant:|<commentary>|$)/i),
      commentary: grab(/<commentary>([\s\S]*?)<\/commentary>/i),
    });
  }
  return out;
}

// Many ~/.claude/skills entries are symlinks (managed skill sets). A bare
// dirent.isDirectory()/isFile() returns false for a symlink, so resolve it.
function direntIsDir(parent, entry) {
  if (entry.isDirectory()) return true;
  if (entry.isSymbolicLink()) { try { return fs.statSync(path.join(parent, entry.name)).isDirectory(); } catch { return false; } }
  return false;
}
function direntIsFile(parent, entry) {
  if (entry.isFile()) return true;
  if (entry.isSymbolicLink()) { try { return fs.statSync(path.join(parent, entry.name)).isFile(); } catch { return false; } }
  return false;
}

function scanSkillsRoot(root, source) {
  const out = [];
  if (!existsDir(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!direntIsDir(root, entry)) continue;
    const skill = readSkillDir(path.join(root, entry.name), source);
    if (skill) out.push(skill);
  }
  return out;
}

function scanAgentsRoot(root, source) {
  const out = [];
  if (!existsDir(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.name.endsWith('.md') || !direntIsFile(root, entry)) continue;
    const agent = readAgentFile(path.join(root, entry.name), source);
    if (agent) out.push(agent);
  }
  return out;
}

function scanCommandsRoot(root, source, prefix) {
  const out = [];
  if (!existsDir(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name.endsWith('.md') && direntIsFile(root, entry)) {
      const cmd = readCommandFile(path.join(root, entry.name), source);
      if (cmd) {
        if (prefix) cmd.name = prefix + ':' + cmd.name;
        out.push(cmd);
      }
    } else if (direntIsDir(root, entry)) {
      // Nested commands: namespace under the directory name.
      const child = scanCommandsRoot(path.join(root, entry.name), source, (prefix ? prefix + ':' : '') + entry.name);
      for (const c of child) out.push(c);
    }
  }
  return out;
}

function readPluginsIndex() {
  const idxPath = path.join(HOME_CLAUDE, 'plugins', 'installed_plugins.json');
  const text = readFileSafe(idxPath);
  if (!text) return [];
  let json;
  try { json = JSON.parse(text); } catch { diagnostics.warnings.push({ path: rel(idxPath), reason: 'malformed JSON' }); return []; }
  const plugins = [];
  const map = json && json.plugins ? json.plugins : {};
  for (const key of Object.keys(map)) {
    const entries = Array.isArray(map[key]) ? map[key] : [map[key]];
    for (const e of entries) {
      if (!e || !e.installPath) continue;
      plugins.push({ key, installPath: e.installPath, version: e.version, scope: e.scope, installedAt: e.installedAt });
    }
  }
  return plugins;
}

function readMarketplaces() {
  const idxPath = path.join(HOME_CLAUDE, 'plugins', 'known_marketplaces.json');
  const text = readFileSafe(idxPath);
  if (!text) return [];
  let json;
  try { json = JSON.parse(text); } catch { return []; }
  return Object.keys(json).map(k => ({
    name: k,
    source: (json[k] && json[k].source) ? json[k].source : null,
    lastUpdated: json[k] && json[k].lastUpdated,
  }));
}

function buildPluginRecord(entry) {
  const installPath = entry.installPath;
  const manifestPath = path.join(installPath, '.claude-plugin', 'plugin.json');
  let manifest = {};
  const t = readFileSafe(manifestPath);
  if (t) { try { manifest = JSON.parse(t); } catch { /* ignore */ } }
  const skills = scanSkillsRoot(path.join(installPath, 'skills'), 'plugin:' + (manifest.name || entry.key));
  const agents = scanAgentsRoot(path.join(installPath, 'agents'), 'plugin:' + (manifest.name || entry.key));
  const commands = scanCommandsRoot(path.join(installPath, 'commands'), 'plugin:' + (manifest.name || entry.key), '');
  const hooksPath = path.join(installPath, 'hooks', 'hooks.json');
  let hooksDoc = null;
  const hooksText = readFileSafe(hooksPath);
  if (hooksText) {
    try { hooksDoc = JSON.parse(hooksText); } catch { /* ignore */ }
  }
  const readme = readFileSafe(path.join(installPath, 'README.md'));
  return {
    kind: 'plugin',
    name: manifest.name || entry.key,
    description: manifest.description || '',
    // BUG-20260801-02 (m3) — normalise the "unknown" version sentinel once, here, at
    // the record source: marketplace installs whose manifest omits a version carry the
    // literal string "unknown" in entry.version, which used to render as a live
    // "vunknown" badge on 9/21 tiles (and in the drawer). Both the tile's truthy check
    // and the drawer's `if(item.version)` skip a falsy '' cleanly, so normalising here
    // fixes both surfaces without touching either renderer.
    version: (() => { const v = manifest.version || entry.version || ''; return v === 'unknown' ? '' : v; })(),
    author: (manifest.author && manifest.author.name) || (typeof manifest.author === 'string' ? manifest.author : ''),
    homepage: manifest.homepage || '',
    repository: manifest.repository || '',
    license: manifest.license || '',
    marketplaceKey: entry.key,
    installPath: installPath.replace(/\\/g, '/'),
    installedAt: entry.installedAt || null,
    bundles: {
      skills: skills.map(s => ({ name: s.name, description: s.description })),
      agents: agents.map(a => ({ name: a.name, description: a.description })),
      commands: commands.map(c => ({ name: c.name, description: c.description })),
      hooks: hooksDoc ? Object.keys(hooksDoc.hooks || hooksDoc) : [],
    },
    readmeHtml: readme ? mdToHtml(readme) : '',
    category: categorise(manifest.name || entry.key, 'plugin'),
  };
}

function loadOverlays(kind) {
  const dir = path.join(PM_ROOT, '97-AI-Reference', kind + 's');
  if (!existsDir(dir)) return new Map();
  const map = new Map();
  for (const f of walk(dir)) {
    const text = readFileSafe(f);
    if (!text) continue;
    const { fm, body } = parseFrontmatterAndBody(text);
    if (!fm || !fm.name) continue;
    map.set(fm.name, {
      name: fm.name,
      // Curated card description for a (often third-party) catalogue item — ADR-0046.
      // Read onto the overlay record so the renderer can prefer it over the item's own
      // it.description (forward-compatible extension of the ADR-0029 overlay schema).
      description: fm.description || '',
      when_to_use: fm.when_to_use || '',
      when_not_to_use: fm.when_not_to_use || '',
      priority: fm.priority || '',
      related: asArray(fm.related),
      tags: asArray(fm.tags),
      last_reviewed: fm.last_reviewed || '',
      file: rel(f),
      bodyHtml: mdToHtml((body || '').trim()),
    });
  }
  return map;
}

function applyOverlays(items, overlays) {
  let applied = 0;
  for (const it of items) {
    const ov = overlays.get(it.name);
    if (!ov) continue;
    applied++;
    it.curated = true;
    it.overlay = ov;
    if (ov.priority === 'must-know') it.mustKnow = true;
  }
  return applied;
}

// loadFitOverlays — reads ADR-0029 per-run relevance overlays from 97-AI-Reference/.
// Each overlay file (curate-toolkit-*.md) may contain items in two forms:
//   1. A YAML frontmatter `items:` list where each entry has name/id, kind, rank, rationale.
//   2. A single-item file where the frontmatter itself carries name/id, kind, rank, rationale.
// Returns a Map keyed by "<kind>:<name>" → { name, kind, rank, rationale, installed }.
// Graceful fallback: if 97-AI-Reference/ does not exist or is empty, returns an empty Map
// (no-overlay path) — callers MUST NOT crash on an empty Map (items degrade to "Other").
// STORY-30.5.04 — OVERLAY FILES ARE READ NEWEST-FIRST, and the first entry for a
// (kind, name) still wins. Those two together are what make a RE-CURATION take effect.
//
// Before this, the order was readdirSync order, so `curate-toolkit-20260718.md` was read
// before `curate-toolkit-20260801.md` and would be read before any file dated later still.
// Re-running curate-toolkit therefore could not change the rank of any item an OLDER
// overlay already ranked — the new file only ever filled gaps. BUG-20260805-02 asks for a
// re-curation, and a re-curation that cannot supersede is not one.
//
// `generated_at` is the sort key, with the filename as the tiebreak and a missing/garbled
// date sorting OLDEST (it cannot claim to supersede a dated file by omitting its date).
function loadFitOverlays() {
  const dir = path.join(PM_ROOT, '97-AI-Reference');
  const map = new Map();
  if (!existsDir(dir)) return map; // no-overlay fallback — graceful, empty Map
  const parsed = [];
  for (const f of walk(dir)) {
    const text = readFileSafe(f);
    if (!text) continue;
    const p = parseFrontmatterAndBody(text);
    if (!p.fm) continue;
    const when = Date.parse(String(p.fm.generated_at || '')) || 0;
    parsed.push({ f, fm: p.fm, body: p.body, when });
  }
  parsed.sort((a, b) => (b.when - a.when) || String(b.f).localeCompare(String(a.f)));
  for (const entry of parsed) {
    const fm = entry.fm; const body = entry.body;
    // Form 1: frontmatter contains an `items:` array (curate-toolkit batch file).
    // Since our YAML parser handles inline arrays but not block-sequence objects,
    // we parse the body for item entries as a secondary strategy.
    // Try to extract items from body as "- name: ... kind: ... rank: ..." blocks.
    const bodyItems = parseFitItemsFromBody(body || '');
    if (bodyItems.length > 0) {
      for (const item of bodyItems) {
        if (!item.name || !item.kind || !item.rank) continue;
        const key = item.kind + ':' + item.name;
        if (!map.has(key)) map.set(key, item);
      }
      continue;
    }
    // Form 2: single-item file — frontmatter itself is the item record.
    const name = fm.name || fm.id;
    const kind = fm.kind;
    const rank = (fm.rank || '').toString().toUpperCase();
    if (!name || !kind || !rank) continue;
    const key = kind + ':' + name;
    if (!map.has(key)) {
      map.set(key, {
        name,
        kind,
        rank,
        rationale: fm.rationale || '',
        installed: fm.installed !== false,
        display_group: fm.display_group || '',
      });
    }
  }
  return map;
}

// parseFitItemsFromBody — minimal parser for YAML-style item blocks in the body of a
// curate-toolkit overlay file.  Handles the pattern:
//   - name: foo
//     kind: skill
//     rank: HIGH
//     rationale: "…"
//     installed: true
// Returns an array of plain objects.  Unknown lines and comment lines are ignored.
function parseFitItemsFromBody(body) {
  const items = [];
  if (!body) return items;
  let cur = null;
  for (const line of body.split(/\r?\n/)) {
    const listStart = line.match(/^-\s+(\w[\w-]*):\s*(.*)$/);
    const cont = line.match(/^\s{1,4}(\w[\w-]*):\s*(.*)$/);
    if (listStart) {
      if (cur) items.push(cur);
      cur = {};
      cur[listStart[1]] = unquote(listStart[2].trim());
    } else if (cont && cur) {
      cur[cont[1]] = unquote(cont[2].trim());
    } else if (line.trim() === '' && cur) {
      // blank line — may or may not end the item; keep accumulating
    }
  }
  if (cur) items.push(cur);
  return items.map(function(raw) {
    const name = raw.name || raw.id || '';
    const kind = raw.kind || '';
    const rank = (raw.rank || '').toString().toUpperCase();
    const rationale = raw.rationale || '';
    const installed = raw.installed !== 'false' && raw.installed !== false;
    // STORY-23.6.02 / ADR-0029 §2 forward-compatible extension — curate-toolkit
    // (skills/curate-toolkit/SKILL.md, 2026-07-31) marks kit-native records with
    // this optional field so renderers can group them without re-deriving
    // provenance. Open-world: absent on every pre-existing overlay entry.
    const display_group = raw.display_group || '';
    return { name, kind, rank, rationale, installed, display_group };
  });
}

// applyFitRanks — joins ADR-0029 fit overlays onto AI items by (kind, name).
// Sets it.fitRank = 'HIGH'|'MED'|'LOW' when a matching overlay item is found.
// Items with no overlay match are left without fitRank (undefined/falsy) — they
// degrade to the "Other" group at render time without crashing.
function applyFitRanks(items, kind, fitOverlays) {
  for (const it of items) {
    const key = kind + ':' + it.name;
    const entry = fitOverlays.get(key);
    if (!entry) continue; // no-overlay fallback — item still renders in "Other"
    const r = entry.rank;
    if (r === 'HIGH' || r === 'MED' || r === 'LOW') it.fitRank = r;
    // STORY-23.6.02 — kit-first pinning is PURELY overlay-driven (AC-3: no overlay
    // present -> no pinned group, ever). Only 'kit' is a recognised value; any other
    // string is ignored (open-world, forward-compatible per ADR-0029 §2).
    if (entry.display_group === 'kit') it.displayGroup = 'kit';
  }
}

// BUG-20260618-03 Case B — the CATEGORY facet's catch-all ("Other", from
// categorise()) and the ADR-0029 fit-rank group for items with no relevance
// overlay used to share the literal label "Other", so two unrelated counts
// (107 vs 167) read as the same ambiguous bucket. categorise()'s catch-all
// intentionally STAYS "Other" (untouched); only the fit-rank group's display
// label changes. Carried in the __DATA payload (not hardcoded in the client
// bundle) so it is one source of truth for every render site that shows it.
const FIT_UNRANKED_LABEL = 'Unranked';

/* STORY-30.5.04 — the fit-tier vocabulary, declared ONCE in Node.
 *
 * It has two consumers that cannot share a module: the client bundle (a plain string blob,
 * ADR-0038) and buildToolkitPluginsSectionHtml() below, because Toolkit > Plugins is
 * server-baked and does NOT go through aiCatRenderer. Ordering only the client renderer
 * would have left one of the four sub-views AC-2 names unordered while the other three
 * were fixed — a one-of-a-pair hazard by construction, and the reason this array is
 * INJECTED into the bundle rather than re-typed there.
 */
const FIT_TIERS = ['HIGH', 'MED', 'LOW'];
const FIT_TIER_LABELS = { HIGH: 'High fit for this project', MED: 'Medium fit', LOW: 'Low fit' };

// Bucket a list into FIT_TIERS order with unranked last, PRESERVING the incoming order
// inside each bucket — that order is the caller's secondary sort (cost, or the catalogue's
// curated/must-know/name sequence), and bucketing keeps it for free where a comparator
// returning 0 on a tie would depend on Array#sort stability for the same guarantee.
function fitTierGroups(list, unrankedLabel) {
  const buckets = [];
  for (let b = 0; b <= FIT_TIERS.length; b++) buckets.push([]);
  for (const it of (list || [])) {
    const i = FIT_TIERS.indexOf(it && it.fitRank);
    buckets[i === -1 ? FIT_TIERS.length : i].push(it);
  }
  return buckets.map((items, i) => ({
    tier: i < FIT_TIERS.length ? FIT_TIERS[i] : 'unranked',
    label: i < FIT_TIERS.length ? FIT_TIER_LABELS[FIT_TIERS[i]] : unrankedLabel,
    items,
  }));
}

function buildAiCatalogue() {
  if (EXTERNAL_ROOT) {
    // Demo/external-root mode: skip the local ~/.claude scan and emit a path-free, empty catalogue
    // so no machine username or absolute paths leak into a publicly shared dashboard.
    return {
      skills: [], agents: [], commands: [], plugins: [], marketplaces: [],
      overlayCounts: { skills: 0, agents: 0, commands: 0, plugins: 0 },
      costByKind: { skills: 0, agents: 0, commands: 0, plugins: 0 },
      pluginTotal: 0,
      totalCost: 0,
      scanRoots: { user: '~/.claude', project: './.claude' },
      counts: { skills: 0, agents: 0, commands: 0, plugins: 0 },
      fitGroupLabel: FIT_UNRANKED_LABEL,
    };
  }
  const skills = []
    .concat(scanSkillsRoot(path.join(HOME_CLAUDE, 'skills'), 'user'))
    .concat(scanSkillsRoot(path.join(PROJ_CLAUDE, 'skills'), 'project'));
  const agents = HARNESS_AGENTS.slice()
    .concat(scanAgentsRoot(path.join(HOME_CLAUDE, 'agents'), 'user'))
    .concat(scanAgentsRoot(path.join(PROJ_CLAUDE, 'agents'), 'project'));
  const commands = []
    .concat(scanCommandsRoot(path.join(HOME_CLAUDE, 'commands'), 'user', ''))
    .concat(scanCommandsRoot(path.join(PROJ_CLAUDE, 'commands'), 'project', ''));
  const pluginIndex = readPluginsIndex();
  const plugins = pluginIndex.map(buildPluginRecord);
  const marketplaces = readMarketplaces();

  // Fold plugin-bundled items into the main lists so they appear in
  // Skills/Agents/Commands as well.
  for (const pl of plugins) {
    const skillsRoot = path.join(pl.installPath, 'skills');
    const agentsRoot = path.join(pl.installPath, 'agents');
    const commandsRoot = path.join(pl.installPath, 'commands');
    const bundledSkills = scanSkillsRoot(skillsRoot, 'plugin:' + pl.name);
    const bundledAgents = scanAgentsRoot(agentsRoot, 'plugin:' + pl.name);
    const bundledCommands = scanCommandsRoot(commandsRoot, 'plugin:' + pl.name, pl.name);
    // Bundled commands are namespaced with the plugin name as prefix
    for (const s of bundledSkills) { s.pluginName = pl.name; skills.push(s); }
    for (const a of bundledAgents) { a.pluginName = pl.name; agents.push(a); }
    for (const c of bundledCommands) { c.pluginName = pl.name; commands.push(c); }
    // STORY-11.3.02 — per-plugin context-load cost = the sum of what the plugin auto-loads
    // (its bundled skills + agents + commands), via the shared tokenCost helper (STORY-11.3.01).
    pl.tokenCost = bundledSkills.concat(bundledAgents, bundledCommands)
      .reduce((acc, it) => acc + tokenCost(it.body || ''), 0);
  }

  // De-duplicate skills/agents/commands by (name, source).
  function dedup(list) {
    const seen = new Set();
    const out = [];
    for (const it of list) {
      const key = it.name + '\0' + (it.source || '');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(it);
    }
    return out;
  }

  const allSkills = dedup(skills);
  const allAgents = dedup(agents);
  const allCommands = dedup(commands);

  // Re-categorise everything with the unified rule set.
  for (const s of allSkills) s.category = categorise(s.name, 'skill');
  for (const a of allAgents) a.category = categorise(a.name, 'agent');
  for (const c of allCommands) c.category = categorise(c.name, 'command');

  // STORY-11.3.02 — attach a per-item context-load token cost via the shared tokenCost helper
  // (STORY-11.3.01), computed ONCE here at scan time — NOT recomputed inline at render time.
  // Per-scope loaded content (the per-scope rule documented on tokenCost): skill = its SKILL.md
  // body; sub-agent = its definition body; command = its command body — i.e. the always-loaded
  // content per kind. The browser sorts/filters on these precomputed numbers (no JS recompute).
  for (const it of allSkills)   it.tokenCost = tokenCost(it.body || '');
  for (const it of allAgents)   it.tokenCost = tokenCost(it.body || '');
  for (const it of allCommands) it.tokenCost = tokenCost(it.body || '');

  // Overlays
  const overlayCounts = {
    skills:   applyOverlays(allSkills,   loadOverlays('skill')),
    agents:   applyOverlays(allAgents,   loadOverlays('agent')),
    commands: applyOverlays(allCommands, loadOverlays('command')),
    plugins:  applyOverlays(plugins,     loadOverlays('plugin')),
  };

  // Fit ranks (ADR-0029 relevance overlays from 97-AI-Reference/).
  // Graceful fallback: loadFitOverlays() returns an empty Map when no overlays exist,
  // so applyFitRanks is a no-op and all items render in the "Other" group without badges.
  const fitOverlays = loadFitOverlays();
  applyFitRanks(allSkills,   'skill',   fitOverlays);
  applyFitRanks(allAgents,   'agent',   fitOverlays);
  applyFitRanks(allCommands, 'command', fitOverlays);
  applyFitRanks(plugins,     'plugin',  fitOverlays);

  // Sort: curated first, then must-know, then name.
  function sortItems(list) {
    list.sort((a, b) => {
      const ca = a.curated ? 0 : 1;
      const cb = b.curated ? 0 : 1;
      if (ca !== cb) return ca - cb;
      const ma = a.mustKnow ? 0 : 1;
      const mb = b.mustKnow ? 0 : 1;
      if (ma !== mb) return ma - mb;
      return String(a.name).localeCompare(String(b.name));
    });
  }
  sortItems(allSkills); sortItems(allAgents); sortItems(allCommands); sortItems(plugins);

  // STORY-11.3.02 — context-load cost rollups (sum the precomputed per-item costs):
  //  • costByKind — a per-kind rollup (skills/agents/commands/plugins);
  //  • pluginTotal — a DISTINCT figure: the sum of what installed plugins auto-load;
  //  • totalCost — the whole-catalogue grand total (skills + agents + commands).
  const sumCost = (list) => list.reduce((acc, it) => acc + (it.tokenCost || 0), 0);
  const costByKind = {
    skills: sumCost(allSkills),
    agents: sumCost(allAgents),
    commands: sumCost(allCommands),
    plugins: plugins.reduce((acc, pl) => acc + (pl.tokenCost || 0), 0),
  };
  const pluginTotal = costByKind.plugins;
  // totalCost deliberately EXCLUDES pluginTotal: plugin-bundled skills/agents/commands are already
  // folded into allSkills/allAgents/allCommands above, so they are counted once under their kind.
  // Adding pluginTotal here would double-count them. pluginTotal stays a separate, distinct figure.
  const totalCost = costByKind.skills + costByKind.agents + costByKind.commands;

  return {
    skills: allSkills,
    agents: allAgents,
    commands: allCommands,
    plugins,
    marketplaces,
    overlayCounts,
    costByKind,
    pluginTotal,
    totalCost,
    scanRoots: {
      user: HOME_CLAUDE.replace(/\\/g, '/'),
      project: PROJ_CLAUDE.replace(/\\/g, '/'),
    },
    counts: {
      skills: allSkills.length,
      agents: allAgents.length,
      commands: allCommands.length,
      plugins: plugins.length,
    },
    fitGroupLabel: FIT_UNRANKED_LABEL,
  };
}

/* ============================================================
 * Counts
 * ============================================================ */

function computeCounts(pm) {
  const counts = {};
  for (const type of Object.keys(pm)) {
    counts[type] = {
      total: pm[type].length,
      byStatus: {},
    };
    for (const r of pm[type]) {
      const k = r.status || 'not-started';
      counts[type].byStatus[k] = (counts[type].byStatus[k] || 0) + 1;
    }
  }
  return counts;
}

// CHAT-04 review (anno-4): the Plan view's own client renderer (RENDERERS.plan)
// only ever reads these fields off epic/feature/story/testplan nodes — never
// bodyHtml/readmeHtml — and resolves the FULL record through findArtefact()
// against D.story/D.testplan/etc when a tile is actually clicked open. Storing
// full object references here (as before) meant JSON.stringify(data) emitted
// every epic/feature/story body a second time inside data.plan — ~3.8 MB
// (~21% of window.__DATA) of byte-identical duplication with zero read benefit.
function planEpicLite(e) { return { id: e.id, title: e.title, status: e.status, okr: e.okr, prd_section: e.prd_section, deliverableHtml: e.deliverableHtml }; }
function planFeatureLite(f) { return { id: f.id, title: f.title, status: f.status, deliverableHtml: f.deliverableHtml }; }
function planStoryLite(s) { return { id: s.id, title: s.title, status: s.status }; }

function buildPlanTree(pm) {
  // Group features by epic, stories by feature, testplans by story.
  const byEpic = new Map();
  for (const e of pm.epic) {
    // STORY-21.4.01 — pre-render the epic's "what you'll see" deliverable
    // line once here (thin-input rule enforced inside buildDeliverableLine),
    // so the Plan → Roadmap timeline renderer only has to inject it verbatim.
    e.deliverableHtml = buildDeliverableLine(e.outcome, 'epic-deliverable');
    byEpic.set(e.id, { epic: planEpicLite(e), features: [] });
  }
  const orphanFeats = [];
  for (const f of pm.feature) {
    // STORY-21.4.01 — same pre-render, feature grain (the timeline has no
    // separate phase axis; per ADR-0084, epic+feature grain satisfies the
    // "deliverable per phase" AC).
    f.deliverableHtml = buildDeliverableLine(f.outcome, 'feat-deliverable');
    const ep = byEpic.get(f.epic);
    const node = { feature: planFeatureLite(f), stories: [] };
    if (ep) ep.features.push(node);
    else orphanFeats.push(node);
  }
  const storyByFeat = new Map();
  for (const s of pm.story) {
    const k = s.feature || '';
    if (!storyByFeat.has(k)) storyByFeat.set(k, []);
    storyByFeat.get(k).push(s);
  }
  for (const ep of byEpic.values()) {
    for (const fn of ep.features) {
      fn.stories = (storyByFeat.get(fn.feature.id) || []).map(planStoryLite);
    }
  }
  // Map testplans to stories by id mirror — only the id is ever read
  // (RENDERERS.plan renders `tp.id` as a linked badge on the story tile;
  // the drawer resolves the full testplan record via findArtefact when clicked).
  const tpByStory = new Map();
  for (const tp of pm.testplan) {
    const sid = tp.id.replace(/^TESTPLAN-/, 'STORY-');
    tpByStory.set(sid, { id: tp.id });
  }
  return { byEpic: Array.from(byEpic.values()), orphanFeats, tpByStory: Object.fromEntries(tpByStory) };
}

/* ============================================================
 * Reports — scan 41-Reports/ (all files), 20-Requirements/*.html,
 * 42-Monitor/*.html; classify each by filename prefix into one of five
 * kind buckets: Explorations, Code Reviews, Execution Strategies, Boards,
 * Other. Returns an array of report records for the Reports view renderer.
 * Degrades gracefully when a scanned directory does not exist.
 * ============================================================ */

// v1.1 buckets. Order matters for `classifyReport` (first match wins) and for the
// downstream split into Build → Phases (Execution Strategies), Cadence → Reviews
// (Code Reviews), and Cadence → Audits (everything else).
const REPORT_KINDS = [
  { key: 'Execution Strategies', test: (n) => /^EXECUTION-STRATEGY-/i.test(n) },
  { key: 'Code Reviews',         test: (n) => /^AI-CODE-REVIEW-/i.test(n) },
  { key: 'Phase Retros',         test: (n) => /^PHASE-/i.test(n) },
  { key: 'Remediation',          test: (n) => /^REMEDIATION-/i.test(n) },
  { key: 'Explorations',         test: (n) => /^EXPLORATION-/i.test(n) },
  { key: 'Boards',               test: (n) => /BOARD/i.test(n) },
];

function classifyReport(filename) {
  const name = path.basename(filename);
  for (const k of REPORT_KINDS) {
    if (k.test(name)) return k.key;
  }
  return 'Other';
}

/* ------------------------------------------------------------
 * STORY-25.5.04 — what a report card says.
 *
 * Before this, a report card showed its filename and a file-extension badge,
 * which is what BUG-20260801-19 was filed about: 47 audit cards that could only
 * be told apart by reading 47 raw filenames. Each record now carries a `title`,
 * a `date` and a `summary`, derived at build time.
 * ------------------------------------------------------------ */

const REPORT_SUMMARY_CHARS = 240;

function reportExt(name) {
  const m = String(name || '').match(/\.([^.]+)$/);
  return m ? m[1].toLowerCase() : '';
}

function stripHtmlTags(s) {
  return String(s == null ? '' : s)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#0?39;/g, "'").replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// The last resort when a document carries no title of its own. Deliberately not
// the RAW filename — that is the defect being fixed, and a raw name would also
// re-introduce the trailing `.md` / `.html` that TC-03 bans. The extension and a
// trailing ISO date are dropped; the date has its own slot on the card.
function humaniseReportName(name) {
  const base = String(name || '');
  let s = base.replace(/\.[^.]+$/, '');
  s = s.replace(/[-_]?\d{4}-\d{2}-\d{2}(?:-\d+)?$/, '');
  s = s.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s || base;
}

// `.md` → the H1. `.html` → <title>, then <h1>. Anything else, or a file that
// could not be read, or one whose heading is empty → the humanised filename.
// Never returns an empty string: TC-01 asserts a non-empty title on every record.
function reportTitle(name, text) {
  const ext = reportExt(name);
  if (text) {
    if (ext === 'html' || ext === 'htm') {
      const t = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const tt = t ? stripHtmlTags(t[1]) : '';
      if (tt) return tt;
      const h = text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
      const ht = h ? stripHtmlTags(h[1]) : '';
      if (ht) return ht;
    } else if (ext === 'md') {
      const m = text.match(/^#\s+(.+?)\s*$/m);
      const mt = m ? String(m[1]).replace(/\s+/g, ' ').trim() : '';
      if (mt) return mt;
    }
  }
  return humaniseReportName(name) || String(name || '');
}

// Parsed from the FILENAME, rendered through lib/local-date.js. That module
// formats a Date and has no filename parser in it, so the parse is local and only
// the rendering is shared — same local-not-UTC contract as BUG-20260801-04.
// A filename with no ISO date, or with one that is not a real calendar date,
// yields '' and the card renders without a date rather than showing an invalid one.
function reportDate(name) {
  const m = String(name || '').match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (Number.isNaN(dt.getTime())) return '';
  // Rejects 2026-13-01 and 2026-02-30, which Date silently rolls over.
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return '';
  return localDay(dt);
}

// The first block of prose. Frontmatter, headings, list items, tables, fenced
// code, images, HTML comments and thematic breaks are all skipped — every one of
// them appears above the opening paragraph somewhere in this corpus.
function firstProseParagraph(md) {
  const body = String(md == null ? '' : md).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  for (const block of body.split(/\r?\n\s*\r?\n/)) {
    const t = block.trim();
    if (!t) continue;
    if (/^#{1,6}\s/.test(t)) continue;
    if (/^(?:[-*+]\s|\d+[.)]\s)/.test(t)) continue;
    if (/^\|/.test(t)) continue;
    if (/^(?:```|~~~)/.test(t)) continue;
    if (/^!\[/.test(t)) continue;
    if (/^<!--/.test(t)) continue;
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(t)) continue;
    return t;
  }
  return '';
}

/*
 * THE PER-KIND SUMMARY RULE (STORY-25.5.04 AC-2) — stated here, at the call site:
 *
 *   Phase Retros    → the `## What shipped` section.
 *                     A phase retro opens with an H1 and a metadata bullet list
 *                     (Phase / Closed / Done-gate / Branch), so the generic rule
 *                     below lands inside the per-feature breakdown rather than on
 *                     what the phase actually delivered. Every phase retro in the
 *                     corpus carries the heading; one that does not falls through
 *                     to the generic rule rather than to nothing.
 *   everything else → the first prose paragraph.
 *
 * A file with neither — a `.json` sidecar, a zero-byte file, one that could not
 * be read at all — gets SLOT_NOT_RECORDED, the same wording ADR-0128 settled for
 * an absent card section. There is no third wording, and no card is dropped.
 */
function reportSummary(name, kind, text) {
  if (!text) return SLOT_NOT_RECORDED;
  const ext = reportExt(name);
  let raw = '';
  if (ext === 'html' || ext === 'htm') {
    // The whole rendered text STARTS with <title> and <h1>, so summarising it
    // verbatim made 84 of 84 html cards repeat their own title inside their own
    // summary — the card said the same thing twice and the summary bought the
    // reader nothing. Drop the title/h1 region, then take the first real block.
    const head = text.match(/<h1[^>]*>[\s\S]*?<\/h1>/i);
    let body = text;
    if (head) body = text.slice(head.index + head[0].length);
    else body = text.replace(/<head[\s\S]*?<\/head>/i, ' ');
    const blocks = [...body.matchAll(/<(p|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
      .map((m) => stripHtmlTags(m[2])).filter(Boolean);
    const title = reportTitle(name, text);
    // Skip any leading block that merely restates the title.
    raw = blocks.find((b) => b && b.replace(/\s+/g, ' ').trim() !== String(title).replace(/\s+/g, ' ').trim()) || '';
    if (!raw) raw = stripHtmlTags(body);
  } else if (ext === 'md') {
    const body = String(text).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
    if (kind === 'Phase Retros') raw = extractSection(body, 'What shipped');
    if (!raw) raw = firstProseParagraph(body);
  } else {
    raw = firstProseParagraph(text);
  }
  const clean = String(raw || '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/[*_`]+/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return clean ? paSummariseNode(clean, REPORT_SUMMARY_CHARS) : SLOT_NOT_RECORDED;
}

// The document extensions a report can be. AC-5 requires the reader to survive
// EPIC-27 FEAT-27.3 moving this corpus into folders, so the 41-Reports scan
// recurses — and recursion needs a rule for what counts, or the machine sidecars
// under retro/ and usage/ (`.jsonl`) and the bug screenshots (`.png`) would all
// become report cards. Selecting by DOCUMENT TYPE rather than by folder name is
// what keeps the reader shape-agnostic: it excludes those files wherever they
// sit, and admits a real report wherever it is moved to. On today's flat corpus
// this filter is a no-op — every one of the 196 files is .md, .html or .json.
// STORY-27.3.02 — this list, the ledger registry and the walk all moved to
// lib/report-tree.js, which is now the ONE implementation the six reader sites
// share (ADR-0141). Re-exported here because callers and tests already import it
// from this module; the value is the module's, never a second copy.
const REPORT_DOC_EXTS = reportTree.REPORT_DOC_EXTS;

/**
 * Every record carries `title`, `date` and `summary` (STORY-25.5.04).
 *
 * THE PER-KIND SUMMARY RULE, restated here at the call site because this is
 * where a reader arrives: a phase retro is summarised from its
 * `## What shipped` section; everything else from its first prose paragraph;
 * a file with neither gets SLOT_NOT_RECORDED. The reasoning — why a retro needs
 * its own rule at all — is on reportSummary() above, which implements it.
 *
 * @param {{reportsDir?: string}} [opts] `reportsDir` re-points the 41-Reports scan
 *   at a fixture directory and drops the two PM-root-relative sources, so a test
 *   can verdict the SHIPPED reader over a corpus it controls (TC-04, TC-05).
 */
// STORY-30.2.03 — the drawer body for ONE report record, decided by extension and
// by nothing else. This is the single writer: `.md`, `.json` and `.html` records all
// come through here, so "the rule for .json" is a branch in one function rather than
// a behaviour spread over the call sites that happen to list one.
//
//   .md    -> rendered markdown, frontmatter stripped (what the Audits route shows)
//   .json  -> pretty-printed, capped, in a code block (ADR-0198). Sidecars are the
//             bulk of the corpus; silence on them was the reported defect.
//   .html  -> '' by design. The body is the FILE, rendered at open time in a
//             sandboxed frame (ADR-0199) — inlining 2.9 MB of audit HTML into the
//             data blob would be paid by every board load, not by the reader who
//             opens one.
const REPORT_JSON_BODY_CAP = 20000;
function reportBodyHtml(name, text) {
  if (text == null) return '';
  if (/\.(md|markdown)$/i.test(name)) {
    const { body } = parseFrontmatterAndBody(text);
    return mdToHtml((body || text || '').trim());
  }
  if (/\.json$/i.test(name)) {
    let pretty = text;
    let note = '';
    try {
      pretty = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      // Not valid JSON. Show it verbatim and SAY so — a sidecar that does not parse
      // is worth seeing as itself rather than being silently reformatted or dropped.
      note = '<p class="drawer-json-note">This file is not valid JSON — shown exactly as it is on disk.</p>';
    }
    const truncated = pretty.length > REPORT_JSON_BODY_CAP;
    const shown = truncated ? pretty.slice(0, REPORT_JSON_BODY_CAP) : pretty;
    return note
      + '<pre><code class="lang-json">' + escapeHtml(shown) + '</code></pre>'
      + (truncated
        ? '<p class="drawer-json-note">Showing the first ' + REPORT_JSON_BODY_CAP.toLocaleString('en-US')
          + ' of ' + pretty.length.toLocaleString('en-US') + ' characters.</p>'
        : '');
  }
  return '';
}

function buildReports(opts) {
  const fixtureDir = opts && opts.reportsDir;
  // Paths relative to PM_ROOT that we scan for report artefacts.
  //
  // STORY-27.3.02 — `sectionRoot` is what a file sitting DIRECTLY in this source
  // is sectioned as. The 41-Reports source uses '' (the "Unfiled" group) because
  // its sub-folders are the sections; the other two are single flat folders that
  // are themselves a section, so they say so. Every value here is derived from
  // the path, not from a list of allowed section names.
  const sources = fixtureDir ? [{ dir: fixtureDir, glob: null, recursive: true, sectionRoot: '' }] : [
    // 1. Every document under 41-Reports/, at any depth (including .json, .md, .html)
    { dir: path.join(PM_ROOT, '41-Reports'),       glob: null,    recursive: true,  sectionRoot: '' },
    // 2. *.html only inside 20-Requirements/
    { dir: path.join(PM_ROOT, '20-Requirements'),  glob: '.html', recursive: false, sectionRoot: '20-Requirements' },
    // 3. *.html only inside 42-Monitor/
    { dir: path.join(PM_ROOT, '42-Monitor'),       glob: '.html', recursive: false, sectionRoot: '42-Monitor' },
  ];

  const seen = new Set();
  const reports = [];
  const walked = [];

  for (const src of sources) {
    if (!existsDir(src.dir)) continue; // degrade gracefully — dir missing → empty, no crash
    let entries;
    if (src.recursive) {
      // ONE reader (ADR-0141): topic folders derived, ledger folders registered,
      // selection by document type. The section a record carries is decided here
      // and nowhere else.
      // The sink is passed on EVERY call, fixture runs included, so the wiring is
      // exercised by the test that owns it rather than only by production
      // (phase-band-source.test.js's before/added precedent). `path` arrives
      // absolute from the lib and is re-based here, where PM_ROOT is known.
      const ledgerSkips = [];
      entries = reportTree.walkReportDocs(src.dir, { skipped: ledgerSkips });
      for (const s of ledgerSkips) diagnostics.warnings.push({ path: rel(s.path), reason: s.reason });
      walked.push(...entries);
    } else {
      let dirents;
      try { dirents = fs.readdirSync(src.dir, { withFileTypes: true }); }
      catch { continue; }
      entries = dirents.filter((e) => direntIsFile(src.dir, e))
        .map((e) => ({ full: path.join(src.dir, e.name), name: e.name, section: '' }));
    }
    for (const entry of entries) {
      const fullPath = entry.full;
      const name = entry.name;
      // Apply extension filter when set
      if (src.glob && !name.endsWith(src.glob)) continue;
      // De-duplicate (a file could theoretically appear in two scans)
      const relPath = rel(fullPath);
      if (seen.has(relPath)) continue;
      seen.add(relPath);

      // The containing sub-folder, or the source's own root label. Folder-driven
      // by construction: nothing here reads the FILENAME to decide a section, so
      // a file whose name says one thing and whose folder says another is
      // sectioned by the folder (TESTPLAN-27.3.02 TC-04).
      const section = entry.section || src.sectionRoot || '';
      const kind = classifyReport(name);
      // Build a sensible relative href from the generated DASHBOARD.html
      // (which lives in 42-Monitor/). STORY-04.6.05 will handle Pages resolution;
      // here we emit a relative path from the 42-Monitor/ output directory.
      const dashboardDir = path.join(PM_ROOT, '42-Monitor');
      const href = path.relative(dashboardDir, fullPath).replace(/\\/g, '/');

      // The added file-reading pass. readFileSafe returns null rather than
      // throwing, and every derived field has a documented fallback, so an
      // unreadable or oddly-shaped report degrades to a filename-derived card
      // instead of breaking the view or dropping the card (AC-4).
      const text = readFileSafe(fullPath);
      reports.push({
        // BACKLOG-0132 Tranche B — the record's IDENTITY is its relative path,
        // not its basename. A flat directory made two reports with the same
        // basename impossible; folders make it routine, and every consumer that
        // resolved a card back to its artefact by `name` would then open
        // whichever of the two sorted first. `file` was already unique and
        // already on the record; `id` is that value under the key every other
        // artefact type uses, so the generic consumers (the search index reads
        // `it.id || it.name`) pick it up without a special case.
        id: relPath,
        // BUG-20260804-01 — the DISPLAY name, carried beside the identity so the
        // two never have to be the same value. `id` is a path because resolution
        // needs one; a reader wants the filename. Consumers that show an id to a
        // human (the drawer eyebrow, the palette's id column) read `label` first;
        // consumers that RESOLVE read `id` and must never fall back to this.
        label: name,
        name,
        kind,
        section,
        href,
        file: relPath,
        title: reportTitle(name, text),
        date: reportDate(name),
        summary: reportSummary(name, kind, text),
        // Computed here rather than in splitReports() so the file is read once.
        // null for everything that is not a code review, and for a review whose
        // verdict cannot be parsed — AC-4's degradation, carried on the record.
        verdict: kind === 'Code Reviews' ? parseReviewVerdict(text, name) : null,
        // STORY-30.2.03 — carried here only so main() can lift it into ONE map;
        // it is deleted from the record before the data blob is assembled. See
        // the note at that lift for why it must not travel on the record.
        bodyHtml: reportBodyHtml(name, text),
      });
    }
  }

  // BACKLOG-0132 Tranche A — SAY it when two reports share a basename across
  // folders. Records key on their path now, so this is no longer a correctness
  // bug; it is a naming accident worth seeing on the day it appears rather than
  // the day someone cites the wrong file. Diagnostics-channel, never a throw:
  // the board still builds, and a duplicate basename is legal.
  if (!fixtureDir) {
    for (const dup of reportTree.duplicateBasenames(walked)) {
      diagnostics.warnings.push({
        path: rel(dup.files[0]),
        reason: `duplicate report basename "${dup.name}" in ${dup.files.length} folders (`
          + dup.files.map((f) => rel(f)).join(', ')
          + ') — records key on the path so both open correctly, but the names are ambiguous to a reader',
      });
    }
  }

  // Sort: by kind order, then alphabetically by name within each kind.
  const KIND_ORDER = ['Explorations', 'Code Reviews', 'Execution Strategies', 'Boards', 'Other'];
  reports.sort((a, b) => {
    const ia = KIND_ORDER.indexOf(a.kind), ib = KIND_ORDER.indexOf(b.kind);
    if (ia !== ib) return ia - ib;
    return a.name.localeCompare(b.name);
  });

  return reports;
}

/* ============================================================
 * Docs view (STORY-04.6.05) — surface the FEAT-04.4 documentation/ HTML
 * output (rendered by generate-docs.js at project root). Each *.html becomes
 * a tile that opens in a new tab. Mirrors buildReports(); degrades gracefully
 * to an empty list when documentation/ is absent (e.g. the demo fixture).
 * The release build (release-tandem.js) ships these *.html into docs/ so the
 * tile links resolve on GitHub Pages.
 * ============================================================ */

function buildDocs() {
  // documentation/ lives at project root (REPO_ROOT), beside _00-Project-Management/ —
  // same convention generate-docs.js uses (REPO_ROOT/documentation).
  const dir = path.join(REPO_ROOT, 'documentation');
  const docs = [];
  if (!existsDir(dir)) return docs; // degrade gracefully — dir missing → empty, no crash

  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return docs; }

  // Href is relative to the generated DASHBOARD.html (which lives in 42-Monitor/).
  const dashboardDir = path.join(PM_ROOT, '42-Monitor');

  for (const entry of entries) {
    if (!direntIsFile(dir, entry)) continue;
    const name = entry.name;
    if (!name.endsWith('.html')) continue; // only the rendered HTML, not the *.md sources
    const fullPath = path.join(dir, name);
    const href = path.relative(dashboardDir, fullPath).replace(/\\/g, '/');
    docs.push({ name, href, file: rel(fullPath) });
  }

  docs.sort((a, b) => a.name.localeCompare(b.name));
  return docs;
}

/* ============================================================
 * STORY-31.1.01 — THE PROJECT WIKI (BACKLOG-0156 Tranche A)
 *
 * The docs stop living only in the repo where nobody reads them.
 *
 * WHY THIS IS NOT buildDocs(). buildDocs() lists the RENDERED documentation/*.html
 * as new-tab tiles; its renderer has been unreachable since the ADR-0048 rail
 * redesign (LEGACY_ROUTES sent "docs" to toolkit:prompts) and a tile that leaves
 * the board is not a wiki. This reads the *.md SOURCES and renders them through
 * mdToHtml — THE canonical parser, the same one the drawer and generate-docs.js
 * use since STORY-30.4.01 / ADR-0205 — so the reading surface has drawer-grade
 * fidelity by construction rather than by a second parser that agrees today.
 *
 * SELF-RESOLVING, NEVER A HAND-LIST. The doc set is whatever is in the folder.
 * `/tandem:document` names five files today; a project that authors a sixth gets
 * a sixth entry with no edit here. A curated list is the drift this epic exists
 * to detect, one layer up.
 * ============================================================ */

// The producing command, ONE spelling. It is the command that authors the kit's DEFAULT doc
// set, and it is named where that is the right thing to say: the empty state (a project with
// no documentation/ folder gets the set by running it) and the anchor-block instruction.
//
// IT IS NOT A PER-DOCUMENT PROVENANCE CLAIM, and printing it as one was a defect this board
// shipped (BUG-20260818-09). `/tandem:document` authors five files; this repo's wiki renders
// eleven, six of which are hand-authored and would be untouched by a re-run — so the footer
// stated a falsehood on six pages and, when one of them flagged, offered a remediation that
// would reset the other five and not touch the flagged one. Provenance is now declared BY THE
// DOCUMENT, in its anchor block's `produced_by:`, and rendered per document (ADR-0220).
const WIKI_PRODUCER_COMMAND = '/tandem:document';

// The `produced_by:` value a document uses to say a person maintains it. Read from the
// library so the board and the checker cannot disagree about what the word is.
const WIKI_HAND_AUTHORED = wikiDrift.PRODUCED_BY_HAND;

function wikiSlug(name) {
  return String(name).replace(/\.md$/i, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'doc';
}

// The doc's own H1 where it has one, its filename otherwise. Never invented.
function wikiTitle(body, fallback) {
  const m = String(body || '').match(/^#[ \t]+(.+?)[ \t]*$/m);
  return m ? m[1].trim() : fallback;
}

/**
 * Every `documentation/*.md`, rendered.
 *
 * Returns `{ dir, present, docs: [...] }` — `present` is a DIFFERENT fact from an
 * empty `docs` array (a folder that is absent versus a folder that is empty), and
 * the empty state says so rather than showing one message for two situations.
 */
// Every addressable board route, as the strings an operator would write in a hash. DERIVED
// from the rail and the sub-nav - the same two objects buildSubTabs() reads - so a doc naming
// a view that has been renamed goes dead the moment the rename lands, and a doc naming a view
// that exists never flags because someone forgot to update a list here.
function wikiViewVocabulary() {
  const out = [];
  for (const g of RAIL_GROUPS) {
    out.push(g[0]);
    for (const sub of (SUB_NAV_GROUPS[g[0]] || [])) out.push(g[0] + ':' + sub[0]);
  }
  return out;
}

function buildWiki() {
  const dir = path.join(REPO_ROOT, 'documentation');
  const out = { dir: rel(dir), present: existsDir(dir), docs: [] };
  if (!out.present) return out;

  // STORY-31.1.02 - the resolution context and the event corpus are built ONCE, not per doc.
  const ctx = wikiDrift.buildResolveContext(REPO_ROOT, { views: wikiViewVocabulary(), adrDir: path.join(PM_ROOT, '40-Decisions') });
  const events = wikiDrift.collectEvents(PM_ROOT);
  // The operator's judgements, read from beside the reports they concern. Read-only: a board
  // build must never acquire a side effect, so nothing here writes.
  const judged = wikiDrift.dismissals.read(path.join(PM_ROOT, '41-Reports'));
  out.dismissalStore = { path: rel(judged.path), error: judged.error, count: judged.dismissals.length };

  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return out; }

  for (const entry of entries) {
    if (!direntIsFile(dir, entry)) continue;
    if (!/\.md$/i.test(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const src = readFileSafe(full);
    if (src == null) continue;
    // documentation/*.md carry no frontmatter today, but a producer that starts
    // emitting some must not have it rendered as a paragraph of YAML.
    const parsed = parseFrontmatterAndBody(src);
    const body = (parsed.body || '').trim();
    let mtime = '';
    try { mtime = localIso(fs.statSync(full).mtime); } catch { /* unreadable stat is not fatal */ }
    const slug = wikiSlug(entry.name);
    // Assessed against the RAW source, not the stripped body: the anchor block is an HTML
    // comment, and parseFrontmatterAndBody would have left it alone but mdToHtml would not.
    const drift = wikiDrift.assessDoc({ name: entry.name, file: rel(full), text: src }, ctx, events);
    // A flag an operator has judged keeps its place and its evidence - it is rendered as
    // dismissed-with-reason, never deleted. Deleting it would make "nobody has looked at this"
    // and "somebody decided it was fine" the same page.
    drift.flags = drift.flags.map(function (f) {
      const record = wikiDrift.dismissals.isDismissed(judged.dismissals, wikiDrift.flagVerdict(slug, f));
      if (!record) return f;
      return Object.assign({}, f, {
        dismissed: true,
        dismissedBy: wikiDrift.actorOf(record),
        dismissedReason: String(record.reason || ''),
        dismissedAt: String(record.dismissed_at || ''),
      });
    });
    const live = drift.flags.filter(function (f) { return !f.dismissed; });
    // The STATE follows the live flags. A document whose only flag has been dismissed reads as
    // current, because an operator said so - and the dismissal is still on the page saying who
    // and why. An unassessable document stays unassessable even if its one flag was dismissed:
    // dismissing "nothing has checked this" would be a way of marking it green by hand.
    drift.state = drift.state === 'unassessable' ? 'unassessable' : (live.length ? 'flagged' : 'current');
    drift.liveFlagCount = live.length;
    out.docs.push({
      slug,
      name: entry.name,
      title: wikiTitle(body, entry.name),
      file: rel(full),
      mtime,
      // NIT: counted off the COMMENT-STRIPPED body, so the anchor block's dozen lines are
      // not sold to the reader as a dozen words of documentation.
      words: wikiDrift.strippedBody(body).split(/\s+/).filter(Boolean).length,
      bodyHtml: mdToHtml(body),
      drift,
    });
  }

  out.docs.sort((a, b) => a.name.localeCompare(b.name));
  // The flag census, counted off the SAME array the view renders - one derivation, so the
  // summary line and the documents beneath it cannot disagree.
  out.census = { current: 0, flagged: 0, unassessable: 0, dismissed: 0, liveFlags: 0 };
  for (const d of out.docs) {
    const st = (d.drift && d.drift.state) || 'unassessable';
    out.census[st] = (out.census[st] || 0) + 1;
    out.census.liveFlags += (d.drift && d.drift.liveFlagCount) || 0;
    out.census.dismissed += ((d.drift && d.drift.flags) || []).filter(function (f) { return f.dismissed; }).length;
  }
  return out;
}

/* ============================================================
 * Execution Strategy — read the execution-strategist's JSON sidecars
 * (41-Reports/EXECUTION-STRATEGY-*.json) and pick one per epic for the
 * "Implementation" view (FEAT-03.3). Selection prefers the strategy that
 * covers the MOST stories, with newest mtime as the tie-break — so a
 * focused single-feature re-run can't shadow a fuller whole-epic plan
 * just by being newer (ADR-0049 / BUG fix).
 * ============================================================ */

// Distinct story IDs a strategy covers, across every phase + chat.
function countStrategyStories(json) {
  const ids = new Set();
  const phases = Array.isArray(json && json.phases) ? json.phases : [];
  for (const p of phases) {
    const buckets = [p && p.stories, ...(Array.isArray(p && p.chats) ? p.chats.map((c) => c && c.stories) : [])];
    for (const list of buckets) {
      if (!Array.isArray(list)) continue;
      for (const s of list) {
        const id = (s && typeof s === 'object') ? (s.id || JSON.stringify(s)) : s;
        if (id != null && id !== '') ids.add(String(id));
      }
    }
  }
  return ids.size;
}

// STORY-25.3.04 — `dir` is a parameter (defaulting to the real folder) so
// tests/phase-band-source.test.js can drive the SHIPPED reader over a fixture
// set instead of re-implementing it. A test that re-implements the reader can
// only ever prove the re-implementation right (TESTPLAN-25.3.04 TC-02/TC-05).
function buildExecutionStrategy(dir) {
  dir = dir || path.join(PM_ROOT, '41-Reports');
  const out = { epics: [] };
  if (!existsDir(dir)) return out;
  // STORY-27.3.02 — reader site 2 of 6. Was `readdirSync(dir)`, flat: the day
  // STORY-27.3.03 moves the sidecars into a folder, the Build · Phases band
  // would render "no execution strategy yet" and look like a plan that was never
  // written rather than one that was moved.
  let entries;
  try { entries = reportTree.findReportDocs(dir, (n) => /^EXECUTION-STRATEGY-.*\.json$/i.test(n)); }
  catch { return out; }
  const byEpic = new Map();
  for (const entry of entries) {
    const fp = entry.full;
    const text = readFileSafe(fp);
    if (text == null) {
      // AC-5: an unreadable sidecar is skipped, by name, never silently.
      diagnostics.warnings.push({ path: rel(fp), reason: 'unreadable EXECUTION-STRATEGY sidecar — skipped' });
      continue;
    }
    let json;
    try { json = JSON.parse(text); }
    catch { diagnostics.warnings.push({ path: rel(fp), reason: 'malformed EXECUTION-STRATEGY JSON' }); continue; }
    // AC-5: a sidecar with no usable `phases[]` contributes no phases. It is
    // still a real, parseable plan file, so it keeps its epic row (the Phases
    // view already renders such an epic as simply having no phases) — but the
    // omission is NAMED, because "the band lost some pills" and "that sidecar
    // never had any" are indistinguishable from the rendered board.
    if (!Array.isArray(json.phases) || !json.phases.length) {
      diagnostics.warnings.push({ path: rel(fp), reason: 'EXECUTION-STRATEGY sidecar declares no phases[] — contributes no Phase pills' });
    }
    const epic = json.epic || '(unknown)';
    let mtime = 0;
    try { mtime = fs.statSync(fp).mtimeMs; } catch { /* keep 0 */ }
    const stories = countStrategyStories(json);
    const prev = byEpic.get(epic);
    // More coverage wins; equal coverage → newer file wins. A narrow re-run
    // (fewer stories) never displaces a fuller plan even if it is newer.
    if (!prev || stories > prev.stories || (stories === prev.stories && mtime >= prev.mtime)) {
      byEpic.set(epic, { mtime, stories, strategy: json, file: rel(fp) });
    }
  }
  out.epics = Array.from(byEpic.entries())
    .map(([epic, v]) => ({
      epic,
      file: v.file,
      generated_at: v.strategy.generated_at || '',
      note: v.strategy.note || '',
      phases: Array.isArray(v.strategy.phases) ? v.strategy.phases : [],
      // STORY-29.2.03 — the SECOND grouping of the same corpus (ADR-0182/0184). `null` when
      // the sidecar carries no `autopilot_runs` key at all, `[]` when it emitted an empty
      // track: ADR-0184 is explicit that those are different facts, and collapsing them here
      // would make "this producer emitted no track" indistinguishable from "this epic has
      // nothing to run" at every reader downstream.
      autopilot_runs: Array.isArray(v.strategy.autopilot_runs) ? v.strategy.autopilot_runs : null,
    }))
    .sort((a, b) => String(a.epic).localeCompare(String(b.epic), 'en', { numeric: true }));
  return out;
}

/* ============================================================
 * STORY-29.2.03 — ONE executed truth across the two tracks, and the run-kind of
 * every phase and chat. The rule lives in `lib/track-reconcile.js` (ADR-0186);
 * this is the wiring that hands it the three inputs it joins: the sidecars, the
 * LIVE story records this same generation pass scanned, and the retro ledger.
 *
 * Nothing is written. The sidecars are frozen snapshots and stay byte-identical.
 * ============================================================ */

// The written run plans, as `{run_id, chats}` scopes. A plan is an AUTHORISATION, so
// `executedRunKind()` only honours one whose run also left a `run`-level ledger record —
// this reader supplies the scopes and lets that rule decide.
function readRunScopes(dir) {
  const base = dir || path.join(PM_ROOT, '41-Reports');
  if (!existsDir(base)) return [];
  let entries;
  try { entries = reportTree.findReportDocs(base, (n) => /^AUTOPILOT-PLAN-.*\.md$/i.test(n)); }
  catch { return []; }
  const out = [];
  for (const entry of entries) {
    try {
      const plan = autopilotPlan.readPlan(entry.full);
      if (plan && plan.exists && plan.run_id) {
        out.push({ run_id: plan.run_id, chats: plan.scope_chats, stories: plan.scope_stories });
      }
    } catch { /* an unreadable plan contributes no scope, and never fails the board */ }
  }
  return out;
}

function buildTrackReconciliation(executionStrategy, storyRecords, opts) {
  const options = opts || {};
  const statusMap = new Map();
  for (const s of (storyRecords || [])) {
    if (s && s.id) statusMap.set(s.id, s.status || '');
  }
  let retroRecords = [];
  try {
    const retroPath = options.retroLogPath
      || path.join(PM_ROOT, '41-Reports', 'retro', 'retro-log.jsonl');
    retroRecords = retroReport.readLedger(retroPath, null).records;
  } catch { retroRecords = []; }
  const runScopes = options.runScopes || readRunScopes(options.reportsDir);

  const byEpic = new Map();
  for (const e of ((executionStrategy && executionStrategy.epics) || [])) {
    byEpic.set(e.epic, trackReconcile.reconcile({
      sidecar: {
        epic: e.epic,
        phases: e.phases,
        // Only pass the key through when the sidecar HAD one — see the note above.
        ...(e.autopilot_runs === null ? {} : { autopilot_runs: e.autopilot_runs }),
      },
      storyStatus: statusMap,
      retroRecords,
      runScopes,
    }));
  }
  return byEpic;
}

/* ============================================================
 * STORY-23.4.01/02 — Build → Phases: flatten every epic's execution-
 * strategy phases into one server-rendered, three-level (phase → chat →
 * story) list. Unlike the old per-epic "impl" selector, `id` is
 * self-contained ("<epicId>:phase<index>") so findArtefact("phase", id)
 * (STORY-23.3.02) resolves it with no per-epic scoping needed —
 * every phase across every epic renders flat, in epic then phase order.
 * ============================================================ */
/* ============================================================
 * STORY-30.1.04 (ADR-0196) — CANONICAL PHASE IDENTITY.
 *
 * A phase had exactly one name in the sidecar — a free-text `name` — and the
 * board rendered it verbatim. Two thirds of the corpus spells that name
 * "Foundations" or "Reading surfaces": readable as a heading, useless as a
 * FILTER, because the vocabulary the operator actually uses is "Phase 1",
 * "Phase 2". Half the corpus already encodes the number inside the string
 * ("Phase 1 · Ledger and checkpoint correctness") and half does not, so the
 * number existed as a spelling convention that nothing enforced and nothing
 * read.
 *
 * IDENTITY IS NOW A RESOLVED RECORD, AND EVERY ANSWER NAMES ITS BASIS. Two
 * halves, resolved independently so a sidecar that declares one and not the
 * other is not thrown back to the weakest answer for both:
 *
 *   number   declared   `number:` in the sidecar (the strategist's contract)
 *            derived    parsed out of a `Phase N …` name
 *            positional the 1-based index of the phase within its own sidecar.
 *                       This is a FACT, not a guess: it IS the Nth phase of
 *                       that plan. It is the weakest answer because the plan
 *                       never said so, which is why `identity_source` records it
 *                       and why the strategist's own gate refuses it going
 *                       forward.
 *   title    declared   `title:` in the sidecar
 *            derived    the remainder of a `Phase N · <title>` name
 *            name       the whole `name`, when it carries no number prefix
 *            id         the phase id — the LAST RESORT, and visibly one. A blank
 *                       label is the one outcome AC-2 forbids, so the fallback
 *                       is the only remaining unique thing rather than "".
 *
 * THE LABEL IS ALWAYS `Phase N — <title>`, on every phase in the corpus,
 * legacy included. Nothing here is hardcoded per epic and nothing consults a
 * list of known phase names.
 *
 * `description` is carried through when the producer emits one and is empty
 * otherwise. It is NOT back-filled from `outcome`: an outcome is the
 * founder-facing "what you'll have" line (FEAT-14.2), a different claim, and
 * silently promoting one into the other would put a sentence in a tooltip that
 * nobody wrote for it.
 * ============================================================ */
// `Phase 1 · Foundations` / `Phase 2 — Wiring` / `Phase 3: Gate` / `Phase 4 Gate`.
// The separator run is OPTIONAL, so a bare `Phase 4 Gate` parses too; the
// remainder is whatever follows it. Leading zeros are tolerated (`Phase 01`).
const PHASE_NAME_RE = /^\s*phase\s+0*(\d+)\s*(?:[·:.—–‒-]+\s*)?(.*)$/i;

function phaseIdentityNumber(phase, index, nameMatch) {
  const raw = phase && phase.number;
  const n = typeof raw === 'string' ? Number(raw.trim()) : raw;
  if (Number.isInteger(n) && n > 0) return { number: n, source: 'declared' };
  if (nameMatch) return { number: Number(nameMatch[1]), source: 'derived' };
  return { number: index + 1, source: 'positional' };
}

function phaseIdentityTitle(phase, nameMatch, rawName, id) {
  const declared = typeof (phase && phase.title) === 'string' ? phase.title.trim() : '';
  if (declared) return { title: declared, source: 'declared' };
  if (nameMatch) {
    const rest = String(nameMatch[2] || '').trim();
    // A name that is ONLY `Phase 3` names its position and nothing else. Echoing
    // it back as the title would render "Phase 3 — Phase 3"; the id is the
    // honest fallback and is visibly one.
    if (rest) return { title: rest, source: 'derived' };
    return { title: id, source: 'id' };
  }
  if (rawName) return { title: rawName, source: 'name' };
  return { title: id, source: 'id' };
}

/**
 * @param {object} phase   the raw sidecar phase record
 * @param {number} index   its 0-based position within its own sidecar
 * @param {string} id      the flattened phase id (`<epicKey>:phaseN`)
 * @returns {{number, title, description, label, number_source, title_source, identity_source,
 *            identity_basis}}
 */
function phaseIdentity(phase, index, id) {
  const rawName = String((phase && phase.name) || '').trim();
  const nameMatch = PHASE_NAME_RE.exec(rawName);
  const num = phaseIdentityNumber(phase, index, nameMatch);
  const tit = phaseIdentityTitle(phase, nameMatch, rawName, id);
  const description = String((phase && phase.description) || '').trim();
  // The weaker of the two halves is what the record is worth: a phase whose
  // number was declared but whose title fell back to its id has NOT been named.
  const RANK = { declared: 3, derived: 2, name: 1, positional: 0, id: 0 };
  const identitySource = RANK[num.source] <= RANK[tit.source] ? num.source : tit.source;
  return {
    number: num.number,
    title: tit.title,
    description,
    label: 'Phase ' + num.number + ' — ' + tit.title,
    number_source: num.source,
    title_source: tit.source,
    identity_source: identitySource,
    identity_basis: 'number ' + num.source + ' · title ' + tit.source,
  };
}

function flattenPhases(executionStrategy, reconciliation) {
  const epics = (executionStrategy && executionStrategy.epics) || [];
  const out = [];
  for (const e of epics) {
    const list = Array.isArray(e.phases) ? e.phases : [];
    // STORY-29.2.03 — the reconciled view of this epic, if the caller computed one. Absent is
    // a supported state: `flattenPhases()` is called from tests/phase-band-source.test.js with
    // one argument, and a phase with no reconciliation renders `unclassified` — which is the
    // honest answer, not a degraded one.
    const rec = reconciliation instanceof Map ? reconciliation.get(e.epic) : null;
    const recPhases = (rec && Array.isArray(rec.phases)) ? rec.phases : [];
    const recChats = new Map(((rec && rec.chats) || []).map((c) => [c.id, c]));
    list.forEach((p, idx) => {
      const rp = recPhases[idx];
      const chats = Array.isArray(p && p.chats) ? p.chats : [];
      const id = e.epic + ':phase' + idx;
      // STORY-30.1.04 — resolved ONCE here, so the band, the tiles and the drawer
      // all read the same record. A second derivation at a render site is how the
      // pill and the tile it filters come to disagree about what a phase is called.
      const ident = phaseIdentity(p, idx, id);
      out.push({
        id,
        epic: e.epic,
        name: (p && p.name) || '',
        number: ident.number,
        title: ident.title,
        description: ident.description,
        label: ident.label,
        identity_source: ident.identity_source,
        identity_basis: ident.identity_basis,
        outcome: (p && p.outcome) || '',
        chats,
        // AC-3 — the phase's run-kind, planned from the track and executed from the ledger,
        // `unclassified` when neither can speak. Never a guess.
        run_kind: (rp && rp.run_kind) || 'unclassified',
        reconciled_state: (rp && rp.state) || '',
        // Per-chat reconciliation, keyed by chat id, so the chat tile can render its own
        // run-kind and its covered-by-reference basis without re-deriving either.
        chat_reconciliation: chats.reduce((acc, c) => {
          const r = recChats.get((c && c.id) || '');
          if (r) {
            acc[r.id] = {
              state: r.state,
              state_basis: r.state_basis,
              run_kind: r.run_kind.kind,
              run_kind_source: r.run_kind.source,
              run_kind_basis: r.run_kind.basis,
              reconciled_by: r.reconciled_by,
            };
          }
          return acc;
        }, {}),
      });
    });
  }
  return out;
}







/* ============================================================
 * STORY-30.1.05 (ADR-0197) — the AUTOPILOT / BATCH display grouping.
 *
 * THIS IS A PRESENTATION OF `run_kind`, NOT A SECOND DERIVATION. The kind is
 * decided once, in `lib/track-reconcile.js` (ADR-0186), from the sidecar's two
 * tracks and the retro ledger's run ids; `flattenPhases()` rolls it to the phase
 * and puts it on the record. This function reads THAT FIELD and nothing else —
 * no ledger, no sidecar, no re-parse. STORY-30.1.05 AC-4 asks for exactly that
 * ("the classification reader consumes the shared field, no second derivation"),
 * and `tests/track-reconciliation.test.js --case display-consumes-shared-field`
 * proves it by MUTATING `run_kind` on a phase record and watching the tile move
 * groups while the reconciliation underneath is untouched.
 *
 * THE VOCABULARY IS ADR-0186'S, AND IT IS ASYMMETRIC ON PURPOSE.
 *
 *   autopilot      positive evidence, from EITHER side: a ledger record naming a
 *                  real run, a written run plan for a run that demonstrably ran,
 *                  or a chat the sidecar's own emitted track claims.
 *   batch          PLANNED-side evidence only: a track WAS emitted and no run
 *                  claims this chat, so the plan is for a human session to batch
 *                  it. There is NO executed `batch`, and this display does not
 *                  invent one.
 *   unclassified   everything the record cannot name. THREE different facts land
 *                  here and the tile says which, because collapsing them is how a
 *                  view starts lying:
 *                    · no signal at all — no track key, no ledger record;
 *                    · `unattributed` — the ledger says `run_id:
 *                      "unattributed-run"`, the kit's honest marker for "the
 *                      capture was not told a run". Reading THAT as Batch is the
 *                      single mistake ADR-0186 §4 names, and it would have
 *                      mislabelled E29-CHAT-02/03 — two real autopilot chats;
 *                    · `mixed` — the phase's chats disagree. Not "nobody looked":
 *                      two people looked and got different answers.
 *
 * A phase is a ROLL-UP, so `mixed` is reachable here and is not reachable at
 * chat level. It groups under Unclassified because the group answers "can the
 * board name ONE kind for this phase?" and the answer is no — but the tile keeps
 * its own `mixed` badge and its basis in the title attribute, so the reader is
 * never told "no signal" about a phase that has two.
 * ============================================================ */
const PHASE_DISPLAY_GROUPS = [
  { key: 'autopilot', label: 'Autopilot' },
  { key: 'batch', label: 'Batch' },
  { key: 'unclassified', label: 'Unclassified' },
];

const PHASE_GROUP_BASIS = {
  autopilot: 'a run id in the retro ledger, or a chat this sidecar\'s own autopilot track claims',
  batch: 'this sidecar emitted an autopilot track and no run claims this work — planned as a '
    + 'human-session batch',
  unclassified: 'nothing in the record names a kind for this phase',
  mixed: 'this phase\'s chats do not agree on a kind — two answers, not none',
  unattributed: 'the ledger record carries the honest "not told a run" marker, which is NOT a '
    + 'claim that a human ran it (ADR-0186 §4)',
};

/**
 * @param {string} runKind one of ADR-0186's kinds, as rolled up onto the phase record
 * @returns {{group: string, label: string, basis: string, kind: string}}
 */
function phaseDisplayGroup(runKind) {
  const kind = String(runKind || '').trim() || 'unclassified';
  const known = PHASE_DISPLAY_GROUPS.filter((g) => g.key === kind)[0];
  const group = known ? known.key : 'unclassified';
  const label = (known || PHASE_DISPLAY_GROUPS[2]).label;
  return {
    group,
    label,
    kind,
    basis: PHASE_GROUP_BASIS[kind] || PHASE_GROUP_BASIS.unclassified,
  };
}


/**
 * The reconciled autopilot runs across every epic, as ONE flat, JSON-serialisable list — the
 * same reshape `flattenPhases()` performs for the chat track, and for the same reason: the
 * renderer and the client both read a list, not a Map.
 */
function flattenAutopilotTrack(reconciliation) {
  const out = [];
  if (!(reconciliation instanceof Map)) return out;
  for (const [epic, rec] of reconciliation) {
    for (const run of ((rec && rec.runs) || [])) {
      out.push({
        id: run.id,
        epic,
        title: run.title,
        chats: run.chats,
        stories: run.stories,
        state: run.state,
        state_basis: run.state_basis,
        stories_done: run.stories_done,
        stories_total: run.stories_total,
        reconciled_by: run.reconciled_by,
        run_kind: run.run_kind.kind,
        run_kind_source: run.run_kind.source,
        run_kind_basis: run.run_kind.basis,
      });
    }
  }
  return out;
}




/* ============================================================
 * STORY-25.3.02 (ADR-0119) — the uniform FILTER CONTRACT.
 *
 * Every filterable item on every Build sub-view carries the same four
 * attributes, and the client filter walks exactly one selector for them:
 *
 *   data-filter-item="<type>"   the marker applySlice() selects on
 *   data-epic="…"               epic id(s), or the NO_SCOPE sentinel
 *   data-feature="…"            feature id(s), or the NO_SCOPE sentinel
 *   data-status="…"             the single status the item DISPLAYS
 *
 * Multi-valued by design where an item legitimately spans several: a phase
 * groups whole epics, so its data-epic is a space-separated list and matching
 * is ANY-OF. Status is never a list — it is the one status the tile shows, so
 * "filter by done" selects the items the reader can see are done.
 *
 * The selector name deliberately avoids the substrings "slice-", "pill" and
 * "band": TESTPLAN-25.3.02 TC-02 discards those when counting how many item
 * selectors applySlice() walks, and a name containing one would be filtered out
 * of its own check — a vacuous pass.
 * ============================================================ */
const NO_SCOPE = '—';

// One space-separated attribute value, or the sentinel. Never empty: an empty
// attribute reads as "not emitted" to --assert-item-attrs, and "this item has
// no feature" is a real answer that must be distinguishable from a bug.
function scopeAttr(values) {
  const seen = [...new Set((values || []).map((v) => String(v || '').trim()).filter(Boolean))];
  return seen.length ? escapeHtml(seen.join(' ')) : NO_SCOPE;
}


/* ------------------------------------------------------------
 * STORY-25.5.01 (ADR-0127) — the card disclosure.
 *
 * Emitted from ONE place per side (here for the server-rendered
 * story/testplan/bug grids, and a byte-comparable twin in the client bundle for
 * the epic/feature grids) so the two card builders cannot drift — the same
 * reason filterAttrs()/filterAttrsFor() are paired.
 *
 * A <button> carrying aria-expanded, NOT <details>/<summary>. <details> gives
 * keyboard behaviour free, but <summary> swallows the click before the tile's
 * delegated handler sees it and cannot be nested inside the existing
 * .tile-head/.tile-title flex without restructuring every card. A native button
 * also gets Enter AND Space activation from the platform, which is what makes
 * --assert-keyboard-toggle pass without a bespoke keydown handler. ADR-0127.
 * ------------------------------------------------------------ */
function slotDomId(typeKey, id) {
  return 'cs-' + typeKey + '-' + String(id == null ? '' : id).replace(/[^A-Za-z0-9_.-]/g, '-');
}

function cardDiscloseBtnHtml(typeKey, id) {
  return '<button type="button" class="card-disclose" aria-expanded="false"'
    + ' aria-controls="' + slotDomId(typeKey, id) + '"'
    + ' aria-label="Show details" title="Show details"></button>';
}
// `hidden` rather than a CSS class: it collapses the slot to display:none with
// no stylesheet dependency, which is what keeps collapsed grid height identical
// to the pre-change build (TESTPLAN-25.5.01 TC-05) and keeps the slot invisible
// to the shared __smokeVisible() helper rather than merely transparent.
function cardSlotHtml(typeKey, id, innerHtml) {
  return '<div class="card-slot" id="' + slotDomId(typeKey, id) + '" hidden>' + (innerHtml || '') + '</div>';
}

// STORY-25.5.02 — the slot's contents. `.pa-rec` is REUSED verbatim as the clamp
// (AC-3: no third clamp pattern), and the label takes the `.lab` treatment
// `.chat-outcome`/`.drawer-outcome` already define. TESTPLAN-25.5.02 TC-03
// asserts no clamp selector outside the pre-existing seven appears in the CSS,
// so borrowing rather than authoring is load-bearing, not tidiness.
//
// data-slot-part is the contract --assert-slot-contains-all reads.
function cardSlotInnerHtml(parts) {
  if (!parts || !parts.length) return '';
  return parts.map((p) => '<div class="cs-part" data-slot-part="' + escapeHtml(p.key) + '">'
    + '<span class="lab">' + escapeHtml(p.label) + '</span>'
    + '<div class="meta pa-rec' + (p.recorded ? '' : ' cs-absent') + '">' + escapeHtml(p.text) + '</div>'
    + '</div>').join('');
}

/* ============================================================
 * STORY-30.1.03 — the SORT KEY matrix, the same shape and for the same reason
 * as ADR-0118's band matrix: which keys a Build list offers is DATA, keyed by
 * the real sub-view keys, read by the SSR control builder, by the client
 * renderer, and by --sort-walk. A list without a row here offers no sort
 * control at all — loudly absent rather than silently defaulting.
 *
 * STORY-34.2.01 (ADR-0288) EXTENDS this declaration with the temporal keys and
 * makes attention order the DEFAULT. Five facts about the shape below, each of
 * which is load-bearing:
 *
 * 1. `SORT_KEYS` STAYS KEYED BY BUILD SUB-VIEW, and holds ONLY the three
 *    `[id^="build-"]` card lists. That is not conservatism — it is the walk's
 *    domain. `--sort-walk --case keys` iterates `Object.keys(SORT_KEYS)`, calls
 *    `sGoSub(sub)` (which resolves `.sub-pill[data-sub="build-<sub>"]`) and then
 *    reads `.tile[data-type]` inside `[id^="build-"]`. A row for a view that is
 *    not a Build sub-view rendering a card grid would make the walk fail on a
 *    board that is behaving perfectly. The four views that gain sort in this
 *    story and render the RECORD TABLE instead live in `SORT_VIEWS` below.
 * 2. THE ORDER OF EACH ARRAY IS A SUBSEQUENCE OF ONE CANONICAL ORDER
 *    (attention, last-moved, age, id, epic, feature, story, severity, priority,
 *    created). The control BAKES the union and PRUNES to the row, and the walk
 *    requires the visible keys to equal the row **in order**; that holds only
 *    while every row is a subsequence of the union derived by walking these
 *    rows in their own order. Insert a key out of canonical position and the
 *    walk fails on sequence while membership still passes.
 * 3. THE FIRST KEY IS NO LONGER "never a default". `SORT_DEFAULTS` below names
 *    the order each list OPENS in — the PRD R5 claim that page one answers
 *    "what needs me?" at any corpus size. What has NOT changed is that CLEARING
 *    the sort returns the list to the generator's emission order: cleared and
 *    default are different states, and `--sort-walk --case keys` clears first
 *    and then requires that order back.
 * 4. `attention`, NOT `status`. The urgency order is what the mockup's R5
 *    contract calls "Status" and this table LABELS "Status" — but the key names
 *    the attribute the comparator reads (`sort-state.js` rule 1), and
 *    `data-status` is already spoken for: it is the filter contract's status
 *    band (`filterAttrs`, ADR-0119). Two meanings on one attribute would make
 *    the slice and the sort disagree about the same string.
 * 5. `SORT_KEY_LABEL` IS NOW EXPORTED. It was withheld while the file was
 *    frozen, which is why `lib/sort-keys.mjs` derives labels by title-casing
 *    (ADR-0252). Title-casing reproduced all three of the old values; it cannot
 *    reproduce "Last moved" from `last-moved` or "ID" from `id`. The freeze
 *    reached its terminus at STORY-33.9.05 (ADR-0271) and this block is the
 *    exports half, so the table becomes data like everything beside it.
 * ============================================================ */
const SORT_KEYS = {
  story: ['attention', 'last-moved', 'age', 'id', 'epic', 'feature'],
  testplan: ['attention', 'last-moved', 'age', 'id', 'epic', 'feature', 'story'],
  bug: ['attention', 'last-moved', 'age', 'id', 'epic', 'feature', 'story', 'severity'],
};
const SORT_DIRS = ['asc', 'desc'];
const SORT_KEY_LABEL = {
  attention: 'Status',
  'last-moved': 'Last moved',
  age: 'Age',
  id: 'ID',
  epic: 'Epic',
  feature: 'Feature',
  story: 'Story',
  severity: 'Severity',
  priority: 'Priority',
  created: 'Created',
};

/*
 * The RECORD-TABLE views that gain a sort where they had none (STORY-34.2.01
 * AC-2), keyed by VIEW KEY (`group` or `group:sub`) because that is what
 * identifies them — two of the four are not Build sub-views at all.
 *
 * Separate from SORT_KEYS for the reason given at (1) above, not because the
 * matrix is two matrices: `lib/sort-keys.mjs` derives ONE union across both, so
 * the control still bakes one row of keys and the labels still come from one
 * table. Whether `--sort-walk` should also drive these four is a probe-scope
 * question the walk's own owner answers (STORY-34.2.02 AC-5), not something
 * this declaration decides by widening a key set the walk enumerates.
 */
const SORT_VIEWS = {
  'build:epic': ['attention', 'last-moved', 'age', 'id'],
  'build:feature': ['attention', 'last-moved', 'age', 'id', 'epic'],
  // Backlog before Decisions, because the derived union takes each key at its
  // FIRST appearance and `priority` has to reach it before `created` — see (2)
  // above. Declaration order here is the union's order for the keys only these
  // two rows introduce, so it is part of the contract rather than a listing.
  'capture:backlog': ['attention', 'last-moved', 'age', 'id', 'priority', 'created'],
  decisions: ['attention', 'id', 'created'],
};

/*
 * WHICH ORDER EACH LIST OPENS IN — `"<key>:<dir>"`, the same spelling the `sort=`
 * hash term carries, so a default and a shared link are the same vocabulary.
 *
 * Keyed by VIEW KEY throughout, including the three Build card lists, so there
 * is one lookup rather than one per list family.
 *
 * A view with no row here opens UNSORTED, which is the pre-STORY-34.2.01
 * behaviour and still the right answer for a list whose payload order already
 * means something.
 */
const SORT_DEFAULTS = {
  'build:story': 'attention:asc',
  'build:testplan': 'attention:asc',
  'build:bug': 'attention:asc',
  'build:epic': 'attention:asc',
  'build:feature': 'attention:asc',
  decisions: 'created:desc',
  'capture:backlog': 'priority:asc',
};

/*
 * THE URGENCY RANKINGS — the ordinal halves of the two keys that are not
 * lexical. Both are DATA for the same reason the matrix is: the ranking IS the
 * claim of AC-3 ("status urgency, then last moved descending, then ID"), and a
 * ranking re-typed in the renderer could not be read by anything that checks it.
 *
 * STATUS_URGENCY is the mockup's R5 order verbatim for the six statuses it
 * ranks (`in-progress, in-review, ready, blocked, not-started, done` —
 * mockup-v1.html:1234), extended with the three terminal statuses the mockup
 * does not carry. The mockup sends an unranked status to 99, i.e. after `done`;
 * spelling that out puts them in the validator's own TERMINAL order rather than
 * leaving three of the nine enum values ordered by an accident. See ADR-0288.
 *
 * SEVERITY_URGENCY is BUG.template.md's declared vocabulary
 * (`critical | high | medium | low`) with the two out-of-template values the
 * live corpus actually carries (`major`, `minor`) slotted either side of
 * `medium`. Most severe first, so ascending is the useful direction.
 */
const STATUS_URGENCY = [
  'in-progress', 'in-review', 'ready', 'blocked', 'not-started',
  'done', 'wontfix', 'duplicate', 'archived',
];
const SEVERITY_URGENCY = ['critical', 'high', 'major', 'medium', 'minor', 'low'];



/* ============================================================
 * STORY-23.6.01 / STORY-23.6.02 (ADR-0102) — Toolkit · Plugins sub-view +
 * kit-first overlay pinning for Skills/Commands/Plugins. Same ADR-0099
 * rationale as buildWorkGroupsHtml above: the paired testplans are
 * static-analysis literal-text greps against the generated DASHBOARD.html,
 * so this is real interpolated HTML baked server-side at generation time —
 * a client RENDERERS string-concat is invisible to a raw-file probe.
 * ============================================================ */

// The literal header a kit-pinned group renders under, wherever it appears
// (Skills/Commands baked-SSR pinned group; Plugins baked-SSR pinned group;
// the client aiCatRenderer's own re-render of the same group on interaction —
// see BROWSER_JS below). One constant; every call site quotes it explicitly
// so each wiring point documents itself rather than hiding behind an opaque
// shared reference.
const KIT_PINNED_LABEL = 'Tandem kit — ranked first';





/* ============================================================
 * STORY-25.3.01 (ADR-0118) — the per-sub-view BAND MATRIX.
 *
 * Which slicer bands each Build sub-view offers is DATA, not control flow:
 * one object, keyed by the real `SUB_NAV_GROUPS.build` sub keys (singular —
 * `epic`, not `epics`; the plural forms are hash aliases only, see
 * LEGACY_ROUTES). Every consumer — the SSR panel builder, the client-side
 * renderSlicerPanel(), and smoke-dashboard.js's --band-matrix-walk — reads
 * THIS object. Adding a sub-view without a row here renders no bands at all,
 * loudly, rather than inheriting a silent default.
 *
 * BAND_ORDER is the vocabulary AND the render order. `phase` is deliberately
 * present in the vocabulary but granted to no sub-view yet: STORY-25.3.04
 * builds the Phase band from the execution-strategy sidecars and fills the
 * slot. Reserving it here is what stops that story from re-shaping the config.
 * ============================================================ */
// STORY-25.3.03 — the plural hash aliases the Build sub-nav accepts, as one
// object. LEGACY_ROUTES' five `build:<plural>` lines are generated from it, and
// smoke-dashboard.js requires it so a probe can resolve an alias EXACTLY when
// proving a `--hash` landed where it asked. Irregular plurals are the reason it
// has to be a table: no trailing-`s` rule turns `stories` into `story`.
const SUB_ALIASES = {
  stories: 'story',
  testplans: 'testplan',
  bugs: 'bug',
  epics: 'epic',
  features: 'feature',
};

const BAND_ORDER = ['status', 'epic', 'feature', 'phase'];
// A band whose pill list is DERIVED from another band's active term has no
// pills to offer until that term is set, and AC-4 says a band with no pills is
// not rendered at all. Stating the dependency as data (rather than leaving the
// Feature band as a hardcoded exception inside the walk probe) is what lets
// --band-matrix-walk compute the expected band set for BOTH the unsliced and
// the epic-selected state instead of special-casing one band by name.
// STORY-25.3.04 deliberately does NOT add `phase: 'epic'` here. The Phase band's
// pills come from the sidecars, not from another band's active term, so it is
// populatable unsliced — and AC-1 asks for the band on a bare
// `#group=build&sub=phases` with no epic picked. Scoping the phase list to a
// selected epic is a nice-to-have for the 51-pill panel and is BACKLOG-0124, not
// a dependency.
const BAND_REQUIRES = { feature: 'epic' };
// MINOR-3 (independent review, CHAT-05). The client's validSliceValues() has one
// arm per band and returns {} for anything it does not know — which REJECTS every
// value of that band, silently. Fail-safe rather than fail-open, but silent
// either way: a band added to BAND_ORDER without a matching arm would simply
// never restore from a hash, with nothing to say so. This list is the arms that
// exist, asserted against BAND_ORDER at build time below, so the divergence
// surfaces at `pm:dash` instead of in a browser three weeks later.
const CLIENT_VALIDATED_BANDS = ['status', 'epic', 'feature', 'phase'];
// Bands whose pill list is a CLOSED vocabulary: every value an item can display
// must be offered as a pill. `status` is closed because it is censused from the
// artefact status enum across all Build sub-views. `epic` and `feature` are NOT
// closed — items legitimately carry values with no pill (a bug filed under the
// "exploratory" pseudo-epic, the NO_SCOPE sentinel), and the Feature band is
// deliberately scoped to the selected epic. --assert-band-vocabulary verdicts
// only the closed ones; listing them here rather than hardcoding "status" in
// the probe keeps that judgement with the matrix it belongs to.
// Added for MAJOR-2 (independent review, 2026-08-02): nothing in the suite
// checked band VOCABULARY, only band presence, so a status displayed on three
// sub-views with no pill to select it went unnoticed.
// STORY-25.3.04 adds `phase`. It IS closed, and for a stronger reason than
// status: the band's pills and the phase tiles' `data-phase` values are both
// derived from the SAME flattenPhases() list in the same generation pass, so
// "every displayed phase has a pill" is an invariant by construction — which is
// exactly the kind of invariant worth pinning, because the only way it can break
// is a drift between buildPhaseBandPills() and buildPhaseGroupsHtml(), silently.
// The union-vs-per-sub-view tension ADR-0119 §3b records for `status` does not
// arise here: the matrix grants `phase` to ONE sub-view, so there is only ever
// one vocabulary and nothing for navigation to remove a set term from.
const BAND_VOCABULARY_CLOSED = ['status', 'phase'];
const SLICE_BANDS = {
  // STORY-30.1.04 AC-1 (ADR-0196) — Phases offers the PHASE BAND AND NOTHING
  // ELSE. Both removals are decisions:
  //
  //   `epic`   a phase spans whole epics (five in this corpus come from the
  //            composite key "EPIC-15 + EPIC-16"), so the Epic band asked the
  //            reader to narrow a list of things-that-span-epics by one epic —
  //            BACKLOG-0124's "51 raw pills" complaint was the symptom, the
  //            band being the wrong question was the cause.
  //   `status` a phase's status is a ROLL-UP computed at render time from its
  //            chats' stories, not a field anyone set. With canonical identity
  //            the Phase band alone answers the question this view is for, and
  //            a second band whose vocabulary is derived two joins away is
  //            noise on the one sub-view that had the most of it.
  //
  // The global Clear moved OUT of the Status band for this (buildSlicerPanelHtml
  // below): it was hosted there on the reasoning that Status is granted to every
  // sub-view, and that stopped being true here.
  // STORY-25.3.04 AC-4 — the Phase band is granted HERE AND NOWHERE ELSE, and
  // that is a decision, not an omission. A story does not belong to a phase in
  // the data model: phases own chats, chats list story ids, the same story can
  // be listed by more than one chat across sidecar revisions, and the sidecars
  // are frozen snapshots that lag the live records. Deriving a per-story phase
  // would be a new many-to-many join whose ambiguity BUG-20260801-11 already
  // records for usage attribution — "do not let the first matching phase win".
  // A phase-filtered Stories list would therefore be confidently wrong rather
  // than merely unavailable. ADR-0120.
  phases: ['phase'],
  // AC-3: Epics offers NO Feature band — a feature is below an epic, so the
  // band would ask the reader to narrow an epic list by one of its children.
  epic: ['status', 'epic'],
  // A feature tile IS the feature, so a Feature band here is self-referential.
  feature: ['status', 'epic'],
  // The three work lists carry a real epic -> feature lineage per item.
  story: ['status', 'epic', 'feature'],
  testplan: ['status', 'epic', 'feature'],
  bug: ['status', 'epic', 'feature'],
};

/* ------------------------------------------------------------------
 * STORY-25.3.04 (ADR-0120) — the Phase band's pills.
 *
 * Sourced from the SAME flattenPhases() list Build · Phases server-renders, so
 * the band and the tiles can never disagree about which phases exist. Nothing
 * here is hardcoded: no phase-name array, no epic list.
 *
 * THE SLICE VALUE IS NOT THE PHASE ID. A slice term is a TOKEN in a
 * space-separated ANY-OF attribute (ADR-0119: `attrHasTerm` pads the haystack
 * and looks for " <want> "), so a value containing a space is not one token but
 * several. Five phases in this corpus come from the composite sidecar key
 * "EPIC-15 + EPIC-16", whose ids therefore read as THREE tokens — "EPIC-15",
 * "+", "EPIC-16:phase0". Single-valued exact matching happened to still work,
 * which is what makes it dangerous: the bug is invisible until data-phase ever
 * carries two values, and --assert-band-vocabulary is what surfaced it (the
 * band "displayed" seven token values it offered no pill for). Caught only
 * because `phase` was declared a CLOSED vocabulary — the argument for declaring
 * it, made concrete within the hour.
 *
 * The value is therefore the id with whitespace removed, de-collided in stable
 * order if two distinct ids ever strip to the same token (two epic keys
 * differing only in whitespace — a data pathology, but the rule has to be total,
 * and a silent shared value would filter to the wrong phases). The DRAWER id
 * (`p.id`, used by findArtefact and the Open button) is untouched: it is an
 * artefact identity, not a filter token, and the two answer different questions.
 *
 * DISAMBIGUATION (AC-2). Phase names repeat across the sidecars — at the
 * 2026-08-02 baseline "Foundations" is declared by both EPIC-20 and EPIC-23, and
 * a naive census by NAME would merge them into one pill that filters to the
 * wrong tiles. Three tiers, applied in order, each only where the previous one
 * is not already unique:
 *
 *   1. VALUE is always `p.id` ("<epicKey>:phase<index>"), which flattenPhases()
 *      makes unique by construction. Two same-named phases are therefore always
 *      two pills, never one, regardless of what the label says.
 *   2. LABEL is the bare phase name when that name occurs once in the corpus,
 *      and `<name> · <epicKey>` when it does not. The qualifier is the epic
 *      rather than the strategy filename because the epic is what the phase's
 *      own header chips already display, so the reader can match pill to tile.
 *   3. If two phases inside ONE epic key also share a name (no epic qualifier
 *      can separate them), the label falls back to the id, which is the only
 *      remaining unique thing. Not reachable in the current corpus; present so
 *      the rule is total rather than "true of today's data".
 *
 * `title` always carries the unqualified "<epicKey> · <name>", so hovering any
 * pill answers "which epic is this?" even on the un-suffixed majority.
 * ------------------------------------------------------------------ */
// id -> filter token. One definition, consumed by the pills AND by the phase
// tiles, so the two can never disagree about what the token for a phase is.
// MINOR-5 (independent review, CHAT-05). The strip was whitespace-only, so the
// rule was total for the one hostile character the corpus happens to contain and
// silent about the rest. A COMMA in a sidecar epic key would produce a token
// that the hash's own term separator splits in half, so the phase term would
// vanish from every shared link with nothing to say so; `&` and `=` would do the
// same to the per-band top-level key form (ADR-0122).
//
// The token is now an allow-list: keep only characters that are safe in a hash
// term. `:` is deliberately kept — it is the id's own separator and
// applySliceFromHash splits on the FIRST colon only, so a colon inside the value
// survives. `+` is kept so the composite key stays readable.
//
// Zero churn on today's corpus, checked: the only key carrying anything unsafe
// is "EPIC-15 + EPIC-16", whose token is "EPIC-15+EPIC-16:phase0" under both the
// old rule and this one, so no shared link changes meaning.
const PHASE_TOKEN_UNSAFE = /[^A-Za-z0-9:+._-]/g;

function phaseSliceMap(phases) {
  const map = new Map();
  const used = new Set();
  for (const p of (phases || [])) {
    if (!p || !p.id) continue;
    const base = String(p.id).replace(PHASE_TOKEN_UNSAFE, '');
    let value = base;
    if (used.has(value)) {
      let n = 2;
      while (used.has(base + '~' + n)) n += 1;
      value = base + '~' + n;
      diagnostics.warnings.push({
        path: 'EXECUTION-STRATEGY sidecars',
        reason: 'two phase ids collapse to the same hash-safe slice token ("' + base
          + '") — disambiguated as "' + value + '". Two epic keys differ only in characters the '
          + 'token strips (whitespace, comma, ampersand, equals, ...).',
      });
    }
    used.add(value);
    map.set(String(p.id), value);
  }
  return map;
}

// STORY-30.1.04 — the canonical label of an already-flattened phase. Recomputed
// from the raw record only when a caller hands us a phase that never went
// through flattenPhases() (tests do); the shipped path reads the resolved field,
// so the pill and the tile cannot derive two different labels for one phase.
function phaseLabelOf(p) {
  const declared = String((p && p.label) || '').trim();
  if (declared) return declared;
  const id = String((p && p.id) || '');
  const idx = (/:phase(\d+)$/.exec(id) || [])[1];
  return phaseIdentity(p, idx === undefined ? 0 : Number(idx), id).label;
}

function phaseBandEntries(phases) {
  const list = (phases || []).filter((p) => p && p.id);
  const values = phaseSliceMap(list);
  // The census is over the CANONICAL LABEL, not the raw name. "Phase 1 —
  // Foundations" occurring twice is the collision a reader can see; two phases
  // both spelled "Foundations" that resolve to different numbers are not one.
  const byName = new Map();
  for (const p of list) {
    const n = phaseLabelOf(p);
    byName.set(n, (byName.get(n) || 0) + 1);
  }
  const staged = list.map((p) => {
    const name = phaseLabelOf(p);
    return { p, name, label: byName.get(name) > 1 ? name + ' · ' + p.epic : name };
  });
  const byLabel = new Map();
  for (const s of staged) byLabel.set(s.label, (byLabel.get(s.label) || 0) + 1);
  return staged.map((s) => ({
    id: String(s.p.id),
    value: values.get(String(s.p.id)),
    label: byLabel.get(s.label) > 1 ? String(s.p.id) : s.label,
    // The hover answers "which epic is this, and what is the phase about?" — the
    // description when the producer wrote one, silence when it did not.
    title: String(s.p.epic) + ' · ' + s.name
      + (String((s.p && s.p.description) || '').trim()
        ? ' — ' + String(s.p.description).trim() : ''),
  }));
}


/* ------------------------------------------------------------------
 * STORY-30.1.01 (ADR-0194) — the dropdown multi-select control.
 *
 * The band matrix (ADR-0118) and the filter contract (ADR-0119) and the hash
 * format (ADR-0122) are all UNCHANGED. Only the presentation moves: a band's
 * values are no longer a flat wrapping row of `.slice-pill` buttons but a
 * bounded disclosure — a labelled trigger carrying a selected-count badge, and
 * a menu of `.slice-opt` checkboxes with a per-band Clear.
 *
 * Why the option is a `<button role="checkbox">` and not an `<input>`: every
 * existing consumer (renderSlicerPanel, the walk probes) toggles by clicking an
 * element and reads a single ARIA attribute off it. A native checkbox would
 * need a label association, a change listener AND a click listener, and its
 * `checked` property would become a second source of truth next to STATE.slice
 * — which is the exact drift ADR-0122 exists to prevent. `aria-checked` is
 * rendered FROM state on every pass, so it can never disagree with it.
 *
 * `aria-pressed` is kept alongside `aria-checked` on purpose, and they are
 * written together from one predicate. `aria-pressed` is the shipped contract
 * three probe families read (ADR-0119's honoured-pill verdict among them);
 * dropping it would have been a probe migration disguised as a markup change.
 * ------------------------------------------------------------------ */
function sliceOptionHtml(band, value, label, title, leadHtml) {
  return '<button type="button" class="slice-opt" role="checkbox" aria-checked="false" aria-pressed="false"'
    + ' data-slice-item="' + band + '" data-' + band + '="' + escapeHtml(value) + '"'
    + (title ? ' title="' + escapeHtml(title) + '"' : '') + '>'
    + '<span class="slice-box" aria-hidden="true"></span>'
    + (leadHtml || '')
    + '<span class="slice-opt-lab">' + escapeHtml(label) + '</span>'
    + '</button>';
}

// The disclosure itself. `data-slice-trigger` / `data-slice-menu` /
// `data-slice-badge` / `data-slice-clear-band` are the four contract hooks the
// client and the probes address; every one of them carries the BAND NAME as its
// value, so no consumer has to match on a class to know which band it is
// looking at.
function sliceDropdownHtml(band, label, optionsHtml, noteHtml) {
  const menuId = 'sliceMenu-' + band;
  const trigId = 'sliceTrig-' + band;
  return '<div class="slice-dd" data-dd-band="' + band + '">'
    + '<button type="button" class="slice-dd-trigger" id="' + trigId + '" data-slice-trigger="' + band + '"'
    + ' aria-expanded="false" aria-haspopup="true" aria-controls="' + menuId + '">'
    + '<span class="dd-lab">' + escapeHtml(label) + '</span>'
    + '<span class="dd-badge" data-slice-badge="' + band + '" hidden>0</span>'
    + '<span class="dd-caret" aria-hidden="true">▾</span>'
    + '</button>'
    + '<div class="slice-dd-menu" id="' + menuId + '" data-slice-menu="' + band + '" role="group"'
    + ' aria-labelledby="' + trigId + '" hidden>'
    + '<div class="slice-opts">' + optionsHtml + (noteHtml || '') + '</div>'
    + '<button type="button" class="slice-dd-clear" data-slice-clear-band="' + band + '" disabled>Clear '
    + escapeHtml(label) + '</button>'
    + '</div></div>';
}

// MINOR-3 build-time guard. Runs at module load, so `npm run pm:dash` is where
// a band without a client-side validator arm is caught — loudly, once — rather
// than in a browser that silently drops every one of its hash values.
(function assertEveryBandIsValidated() {
  const missing = BAND_ORDER.filter((b) => CLIENT_VALIDATED_BANDS.indexOf(b) === -1);
  const extra = CLIENT_VALIDATED_BANDS.filter((b) => BAND_ORDER.indexOf(b) === -1);
  if (missing.length || extra.length) {
    throw new Error(
      'BAND_ORDER and CLIENT_VALIDATED_BANDS disagree — validSliceValues() would silently reject '
      + 'every hash value of an unvalidated band.'
      + (missing.length ? ' No validator arm for: ' + missing.join(', ') + '.' : '')
      + (extra.length ? ' Validator arm for a band that no longer exists: ' + extra.join(', ') + '.' : '')
      + ' Add the arm in the client validSliceValues() and list the band in CLIENT_VALIDATED_BANDS.');
  }
})();

// Every band the matrix grants to at least one sub-view — the set the SSR
// panel has to bake, because the client only ever prunes, never invents.
function bandsInMatrix() {
  const used = new Set();
  for (const k of Object.keys(SLICE_BANDS)) for (const b of SLICE_BANDS[k]) used.add(b);
  return BAND_ORDER.filter((b) => used.has(b));
}



/* ============================================================
 * v1.1 — Specs / Templates / Prompts / Scripts builders (ADR-0048)
 *
 * These four sources don't carry artefact frontmatter; they're reference
 * material surfaced as tiles. Each builder scans a single PM-kit folder,
 * reads the first heading (or filename if no heading) for the tile title,
 * and pre-renders the body to HTML for the drawer. Missing folders are
 * skipped silently (consistent with FR-G1).
 * ============================================================ */

// Read the first H1/H2 (`# ` or `## `) from markdown; fall back to filename.
function firstHeading(text, fallback) {
  if (text) {
    const m = text.match(/^\s*#{1,2}\s+(.+?)\s*$/m);
    if (m) return m[1].trim();
  }
  return fallback;
}

// Generic "reference folder" scanner: one tile per file. Used for Templates / Prompts / Scripts.
function buildReferenceFolder(subdir, options) {
  options = options || {};
  const dir = path.join(PM_ROOT, subdir);
  if (!existsDir(dir)) return [];
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (!direntIsFile(dir, entry)) continue;
    const name = entry.name;
    if (options.extensions && !options.extensions.some((e) => name.endsWith(e))) continue;
    const fp = path.join(dir, name);
    const text = readFileSafe(fp);
    const looksLikeMd = /\.(md|markdown)$/i.test(name);
    const looksLikeHtml = /\.html?$/i.test(name);
    const looksLikeText = looksLikeMd || /\.(js|cjs|mjs|sh|ps1|json|ya?ml|toml|txt)$/i.test(name);
    const id = name.replace(/\.[^.]+$/, '');
    const title = firstHeading(looksLikeMd ? text : null, id);
    let bodyHtml = '';
    if (looksLikeMd) {
      const { body } = parseFrontmatterAndBody(text);
      bodyHtml = mdToHtml(body || text || '');
    } else if (looksLikeHtml) {
      // Don't inline arbitrary HTML — link out via href (drawer iframe).
      bodyHtml = '';
    } else if (looksLikeText && text != null) {
      // Show the source as a code block.
      const lang = (name.match(/\.([^.]+)$/) || [, ''])[1];
      bodyHtml = '<pre><code class="lang-' + escapeHtml(lang) + '">' + escapeHtml(text.slice(0, 8000)) + '</code></pre>';
    }
    out.push({
      id,
      title,
      file: rel(fp),
      ext: (name.match(/\.[^.]+$/) || [''])[0].slice(1),
      bodyHtml,
      // href for iframe-style open (relative to DASHBOARD.html in 42-Monitor/).
      href: looksLikeHtml ? path.relative(path.join(PM_ROOT, '42-Monitor'), fp).replace(/\\/g, '/') : '',
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  return out;
}

// Specs: scan 20-Requirements/ recursively for .md and .html (PRDs + HTML specs).
function buildSpecs() {
  const dir = path.join(PM_ROOT, '20-Requirements');
  if (!existsDir(dir)) return [];
  const files = walk(dir, [], (n) => /\.(md|html?)$/i.test(n));
  const dashboardDir = path.join(PM_ROOT, '42-Monitor');
  const out = files.map((fp) => {
    const name = path.basename(fp);
    const text = readFileSafe(fp);
    const looksLikeMd = /\.md$/i.test(name);
    const id = name.replace(/\.[^.]+$/, '');
    let title = id, bodyHtml = '';
    if (looksLikeMd && text) {
      const { body } = parseFrontmatterAndBody(text);
      title = firstHeading(text, id);
      bodyHtml = mdToHtml(body || text);
    }
    return {
      id,
      title,
      file: rel(fp),
      ext: (name.match(/\.[^.]+$/) || [''])[0].slice(1),
      bodyHtml,
      href: /\.html?$/i.test(name)
        ? path.relative(dashboardDir, fp).replace(/\\/g, '/')
        : '',
    };
  });
  out.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  return out;
}

function buildTemplates() { return buildReferenceFolder('91-Templates', { extensions: ['.md', '.html'] }); }
function buildPrompts()   { return buildReferenceFolder('92-Prompts',   { extensions: ['.md'] }); }
function buildScripts()   { return buildReferenceFolder('93-Scripts',   { extensions: ['.js', '.cjs', '.mjs', '.sh', '.ps1', '.md'] }); }

// isKitRepo signal (BUG-20260618-01, STORY-21.5.01). Gates the Tandem tab so a consumer
// install never sees kit-dev-only instructions. Mirrors the "am I the kit's own dev
// repo?" guard shipped for the VERSION-PARITY consumer fix in v2.6.1 — see
// checkVersionParity() in validate-frontmatter.js, which treats the kit's own
// .claude-plugin manifests as the unambiguous "this is the kit repo" signature (a
// consumer install never has them). Widened here per this story's AC with two more
// kit-only markers — a defined `build:tandem` npm script and an already-built
// dist/tt/ — so the kit repo still classifies correctly even before its first build
// (see Risks/unknowns in STORY-21.5.01).
function detectIsKitRepo() {
  const pluginPath = path.join(REPO_ROOT, '.claude-plugin', 'plugin.json');
  const marketplacePath = path.join(REPO_ROOT, '.claude-plugin', 'marketplace.json');
  if (fs.existsSync(pluginPath) || fs.existsSync(marketplacePath)) return true;
  if (existsDir(path.join(REPO_ROOT, 'dist', 'tt'))) return true;
  try {
    const pkgText = readFileSafe(path.join(REPO_ROOT, 'package.json'));
    if (pkgText) {
      const pkg = JSON.parse(pkgText);
      if (pkg && pkg.scripts && typeof pkg.scripts['build:tandem'] === 'string') return true;
    }
  } catch (_e) { /* malformed package.json — treat as consumer, not kit */ }
  return false;
}

// Public site, used only by the last-resort fallback panel below. The per-origin doc hrefs are
// DERIVED from the scanned manifest (pagesBaseFromRepo) rather than this constant, so a fork links
// itself. Declared here, above its first use — `const` has no hoisting, and referencing it from the
// empty-state literal before this line is a module-load ReferenceError.
const TANDEM_PUBLIC_SITE = 'https://data-ai-xyz.github.io/Tandem/';

// Empty-state copy for the Tandem tab when NO package source resolves at all (ADR-0090 — with the
// resolution chain in place this is now a genuine last resort, not the normal consumer path).
// Computed server-side (rather than hard-coded in the client bundle) so the kit-dev instruction
// text physically cannot appear anywhere in a consumer-context build — see the AC on
// BUG-20260618-01: a consumer install must never be told to run a script it doesn't have.
const TANDEM_KIT_DEV_EMPTY_STATE = '<div class="panel"><h3>Tandem plugin</h3><div class="empty">No Tandem build found at <code>dist/tt/</code>. Run <code>npm run build:tandem</code> to publish the plugin and regenerate this dashboard.</div></div>';
// Consumer fallback: BUG-20260729-01 — the old copy ("Not applicable — the Tandem build pipeline
// runs only in the kit's source repo") described an internal concern the reader cannot act on, and
// rendered as a single 122px line. Point at the published documentation instead, so the tab is
// worth opening even when no installed package could be located.
const TANDEM_CONSUMER_EMPTY_STATE =
  '<div class="panel"><h3>Tandem plugin</h3>' +
  '<div class="empty">Couldn\'t locate the installed Tandem plugin on this machine, so there\'s nothing local to describe here. The documentation is published:</div>' +
  '<div class="tandem-docs" style="margin-top:0.85rem;">' +
  '<a class="tandem-doc" href="' + TANDEM_PUBLIC_SITE + 'guide.html" target="_blank" rel="noopener">Guide ↗</a>' +
  '<a class="tandem-doc" href="' + TANDEM_PUBLIC_SITE + 'playbook.html" target="_blank" rel="noopener">Playbook ↗</a>' +
  '<a class="tandem-doc" href="' + TANDEM_PUBLIC_SITE + '" target="_blank" rel="noopener">Live demo ↗</a>' +
  '</div></div>';

function buildTandemEmptyStateHtml(isKitRepo) {
  return isKitRepo ? TANDEM_KIT_DEV_EMPTY_STATE : TANDEM_CONSUMER_EMPTY_STATE;
}

// Turn a shipped doc filename into a human label: `getting-started.html` → "Getting started".
// Used for the Tandem tab's bundled-docs panel and the Start-here rail (STORY-22.1.02) so the
// public page reads as documentation rather than as a directory listing.
/* ------------------------------------------------------------------
 * Tandem package source resolution (ADR-0090)
 *
 * The tab's job is to describe THE PLUGIN YOU HAVE. A build output is only one place that can
 * live; on a consumer machine the plugin is installed in the Claude Code plugin cache. Before
 * this chain existed, `buildTandemPackage()` scanned `dist/tt` only, so every consumer install
 * rendered a one-line "Not applicable" panel (BUG-20260729-01).
 * ------------------------------------------------------------------ */

// Cache layout: ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/ (ADR-0086 identity).
const TANDEM_CACHE_MARKETPLACE = 'data-ai-xyz';
const TANDEM_CACHE_PLUGIN = 'tandem';

// Compare dotted versions numerically. Non-semver / missing sorts lowest rather than throwing —
// discovery must degrade, never break the board.
function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function readPluginVersion(root) {
  const txt = readFileSafe(path.join(root, '.claude-plugin', 'plugin.json'));
  if (!txt) return null;
  try { return JSON.parse(txt).version || null; } catch { return null; }
}

function hasPluginManifest(root) {
  return !!root && fs.existsSync(path.join(root, '.claude-plugin', 'plugin.json'));
}

// github.com/<owner>/<repo> -> https://<owner>.github.io/<repo>/ (GitHub Pages convention).
// Returns null for anything that isn't a GitHub URL, so callers fall back to relative hrefs.
function pagesBaseFromRepo(repoUrl) {
  const m = String(repoUrl || '').match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (!m) return null;
  return 'https://' + m[1].toLowerCase() + '.github.io/' + m[2] + '/';
}

// Highest-semver installed version in the plugin cache. Best-effort: any failure yields no
// candidate. Sorted by VERSION, never mtime — a re-download or a copy rewrites mtimes.
function discoverCachedPlugin() {
  let home;
  try { home = os.homedir(); } catch { return null; }
  if (!home) return null;
  const base = path.join(home, '.claude', 'plugins', 'cache', TANDEM_CACHE_MARKETPLACE, TANDEM_CACHE_PLUGIN);
  if (!existsDir(base)) return null;
  let entries = [];
  try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { return null; }
  const found = entries
    .filter((e) => direntIsDir(base, e))
    .map((e) => ({ root: path.join(base, e.name), version: e.name }))
    .filter((c) => hasPluginManifest(c.root))
    .sort((a, b) => compareVersions(b.version, a.version));
  return found[0] || null;
}

// Ordered resolution. Returns { root, origin } or null. `origin` decides how hrefs and sourceDir
// are emitted, so it is carried into the payload rather than recomputed client-side.
function resolveTandemSource() {
  const override = process.env.PM_DASH_TANDEM_DIST;
  if (override && override.trim()) return { root: path.resolve(override), origin: 'override' };

  // Kit-dev: the repo itself and its last build are both candidates. Pick the HIGHER VERSION —
  // a stale dist/tt used to win by default and made the dev board advertise an old release.
  const local = [];
  if (hasPluginManifest(REPO_ROOT)) local.push({ root: REPO_ROOT, origin: 'kit-repo', version: readPluginVersion(REPO_ROOT) });
  const dist = path.join(REPO_ROOT, 'dist', 'tt');
  if (hasPluginManifest(dist)) local.push({ root: dist, origin: 'dist', version: readPluginVersion(dist) });
  if (local.length) {
    local.sort((a, b) => compareVersions(b.version, a.version));
    return local[0];
  }

  // Consumer: the installed plugin. CLAUDE_PLUGIN_ROOT is exported into the hook environment;
  // the cache probe covers a manual `npm run pm:dash`, where that variable is absent.
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (pluginRoot && pluginRoot.trim() && hasPluginManifest(pluginRoot)) {
    return { root: path.resolve(pluginRoot), origin: 'plugin-root' };
  }
  const cached = discoverCachedPlugin();
  if (cached) return { root: cached.root, origin: 'plugin-cache', version: cached.version };
  return null;
}

// Acronyms that must not be sentence-cased into "Html" / "Adr" on a public page.
const DOC_TITLE_ACRONYMS = new Set(['html', 'css', 'api', 'cli', 'adr', 'okr', 'prd', 'ai', 'pm', 'sop', 'ui', 'dor', 'dod']);
function docTitleFromFilename(name) {
  const base = String(name || '').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
  if (!base) return String(name || '');
  const words = base.split(/\s+/).map((w) => (DOC_TITLE_ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w));
  return words[0].charAt(0).toUpperCase() + words[0].slice(1) + (words.length > 1 ? ' ' + words.slice(1).join(' ') : '');
}

// Scan the Tandem build output for the published plugin's manifest, skill set, hook registry,
// and bundled docs. Drives the Tandem tab so the dashboard reflects what's actually shipped
// rather than the source tree.
//
// The dist root defaults to `REPO_ROOT/dist/tt` (the kit-dev build location, ADR-0028) but may be
// pointed elsewhere with PM_DASH_TANDEM_DIST. The release build sets it to the public tree it is
// about to publish, so the demo board on GitHub Pages documents the exact artefact shipped
// beside it instead of rendering the consumer empty state (ADR-0088). Both env vars default to
// unset, so consumer and kit-dev output is unchanged — the STORY-21.5.01 gate still holds.
function buildTandemPackage() {
  const source = resolveTandemSource();
  if (!source) return null;
  const distRoot = source.root;
  const origin = source.origin;
  // Only the local kit-dev origins are worth naming on the board; every other origin sits outside
  // the repo, where rel() would print a machine path (ADR-0088's blocker, generalised by ADR-0090).
  const isLocalOrigin = (origin === 'kit-repo' || origin === 'dist');
  if (!existsDir(distRoot)) return null;
  let manifest = {};
  const manifestText = readFileSafe(path.join(distRoot, '.claude-plugin', 'plugin.json'));
  if (manifestText) {
    try { manifest = JSON.parse(manifestText); } catch (e) { manifest = { name: '(unparseable)', error: String(e.message) }; }
  }
  // Marketplace id — needed for the install block's `/plugin install <plugin>@<marketplace>`.
  // Not present in plugin.json, so read the sibling manifest; absent/garbled leaves it empty and
  // the renderer omits the install block rather than printing a command that would not work.
  let marketplace = '';
  const mpText = readFileSafe(path.join(distRoot, '.claude-plugin', 'marketplace.json'));
  if (mpText) {
    try { marketplace = String(JSON.parse(mpText).name || ''); } catch { marketplace = ''; }
  }
  const skills = [];
  const skillsRoot = path.join(distRoot, 'skills');
  if (existsDir(skillsRoot)) {
    let entries = [];
    try { entries = fs.readdirSync(skillsRoot, { withFileTypes: true }); } catch { entries = []; }
    for (const e of entries) {
      if (!direntIsDir(skillsRoot, e)) continue;
      const md = path.join(skillsRoot, e.name, 'SKILL.md');
      const content = readFileSafe(md);
      if (!content) continue;
      const parsed = parseFrontmatterAndBody(content);
      const fm = parsed.fm || {};
      // BUG-20260618-03 Cases D/E — same guard + prose-line fallback as the main scan.
      const rawDesc = resolveDescription(fm, parsed.body || '');
      const blurb = rawDesc.split(/<example>|Specifically:/i)[0].trim();
      skills.push({
        name: fm.name || e.name,
        description: truncate(blurb || rawDesc, 220),
        // ORIGIN-RELATIVE, never repo-relative (BUG-20260824-06, ADR-0237 — operator's Option B).
        // `rel()` resolves against REPO_ROOT, so when the Tandem source is the plugin cache under
        // the home directory this field climbed out of the repo and printed the operator's
        // USERNAME — 30 times in a PM_DASH_ROOT render, straight into a shareable board. The
        // sibling `sourceDir` field was guarded against exactly this and this one was not.
        //
        // Relative to `distRoot` instead of REPO_ROOT the path is `skills/<name>/SKILL.md` for
        // EVERY origin — which is the half a reader actually uses (the Tandem tab renders it as
        // the Source line) and carries nothing about the machine. So this needs no
        // `isLocalOrigin` gate: there is no origin for which it leaks, and blanking it would have
        // thrown away information that is useful and safe.
        file: path.relative(distRoot, md).replace(/\\/g, '/'),
      });
    }
    skills.sort((a, b) => a.name.localeCompare(b.name));
  }
  const hooks = [];
  const hooksJson = readFileSafe(path.join(distRoot, 'hooks', 'hooks.json'));
  if (hooksJson) {
    try {
      const h = JSON.parse(hooksJson);
      const groups = h.hooks || h || {};
      for (const event of Object.keys(groups)) {
        const list = Array.isArray(groups[event]) ? groups[event] : [];
        list.forEach((entry, i) => {
          const matcher = entry.matcher || entry.match || '';
          const commands = (entry.hooks || []).map((hh) => hh.command || hh.type || '').filter(Boolean).join(' · ');
          hooks.push({ event, idx: i, matcher, commands });
        });
      }
    } catch (e) {
      hooks.push({ event: '(unparseable)', idx: 0, matcher: '', commands: String(e.message) });
    }
  }
  const docs = [];
  const docsRoot = path.join(distRoot, 'docs');
  if (existsDir(docsRoot)) {
    let entries = [];
    try { entries = fs.readdirSync(docsRoot, { withFileTypes: true }); } catch { entries = []; }
    const dashboardDir = path.join(PM_ROOT, '42-Monitor');
    // In a published build the board IS docs/index.html and the doc pages are its siblings, so a
    // path relative to the dev tree's 42-Monitor/ would 404. PM_DASH_TANDEM_DOCS_BASE rebases the
    // href; the empty string is the meaningful published value ("bare sibling filename"), so test
    // for presence, not truthiness (ADR-0088).
    //
    // For the installed-plugin origins there is nothing local to link: a relative path would point
    // into the plugin cache under the operator's HOME and put that path on the board. Link the
    // PUBLISHED pages instead, at a base derived from the scanned manifest (ADR-0090).
    let hrefBase = process.env.PM_DASH_TANDEM_DOCS_BASE;
    if (origin === 'plugin-root' || origin === 'plugin-cache') {
      hrefBase = pagesBaseFromRepo(manifest.repository || manifest.homepage) || TANDEM_PUBLIC_SITE;
    }
    const rebase = hrefBase !== undefined && hrefBase !== null;
    for (const e of entries) {
      if (!direntIsFile(docsRoot, e)) continue;
      if (e.name.startsWith('.')) continue;         // dotfiles (.nojekyll etc.) — not docs
      if (!/\.html?$/i.test(e.name)) continue;      // only RENDERED pages are linkable docs
      if (e.name.toLowerCase() === 'index.html') continue; // the board itself, not a doc
      const fp = path.join(docsRoot, e.name);
      docs.push({
        name: e.name,
        title: docTitleFromFilename(e.name),
        href: rebase ? (hrefBase + e.name) : path.relative(dashboardDir, fp).replace(/\\/g, '/'),
      });
    }
    docs.sort((a, b) => a.name.localeCompare(b.name));
  }
  return {
    manifest,
    marketplace,
    origin,
    skills,
    hooks,
    docs,
    // "built from <path>" is a KIT-DEV affordance: it tells the maintainer which local tree the
    // board scanned. Every other origin sits outside the repo, so rel() yields a machine path — in
    // a published build that would print e.g. `../../../../../../<user>/AppData/Local/Temp/...` on
    // a public page, and any such path under a home directory whose name is denylisted would fail
    // the release scrub outright. Emit nothing unless the origin is local; the renderer already
    // treats an empty sourceDir as "omit the line".
    sourceDir: isLocalOrigin ? rel(distRoot) : '',
  };
}

/* ============================================================
 * v1.1 — Derived "Now-page" widgets (ADR-0048)
 *
 * Pure functions over the PM corpus. Computed once at build time and
 * baked into the __DATA payload so the browser never recomputes.
 * ============================================================ */

// "Pending action" — open founder-action items: needs_action true, not archived,
// and outside 10-Inbox/archive/ (ADR-0063). Defaults to false when needs_action is
// absent (opt-in for v1.1; STORY-04.6.06 risk). The archive-path guard is belt-and-
// braces — the scan already excludes archive/, but this keeps the query self-evidently
// correct even if the corpus ever carries an archived item.
function computePendingAction(pm) {
  return (pm.inbox || []).filter((it) =>
    (it.needs_action === true || it.needs_action === 'true') &&
    it.action_status !== 'archived' &&
    !/[\\/]archive[\\/]/.test(it.file || ''));
}

// "What's blocking me" — anything with status: blocked. Mixes stories + features
// so the operator sees both. Surface the declared `depends_on:` chain when present.
function computeBlocking(pm) {
  const types = ['story', 'feature', 'epic'];
  const out = [];
  for (const t of types) {
    for (const it of (pm[t] || [])) {
      if (it.status === 'blocked') out.push(Object.assign({}, it, { _type: t }));
    }
  }
  return out;
}

// "What's stale" — not done/archived/wontfix, no movement in N days. Uses
// started_at when present (in-progress), else created_at (waiting in queue).
function computeStale(pm, days) {
  days = days || 14;
  // STALE_TYPES is bounded to *work items* only. ADRs are deliberately excluded:
  // decision records are created already-settled (ADR-on-the-spot rule) and do not
  // "go stale" like queued work — including them swamped the Now-page widget with
  // every recorded decision (STORY-04.6.06 AI-review finding F2). Pinned by TESTPLAN-15.1.01 TC-01.
  const STALE_TYPES = ['story', 'feature', 'epic', 'bug', 'backlog'];
  const SKIP_STATUS = new Set(['done', 'archived', 'wontfix', 'duplicate']);
  const out = [];
  for (const t of STALE_TYPES) {
    for (const it of (pm[t] || [])) {
      if (SKIP_STATUS.has(it.status)) continue;
      const ref = it.started_at || it.created_at;
      const age = ageDays(ref);
      if (age != null && age >= days) {
        out.push(Object.assign({}, it, { _type: t, _ageDays: age }));
      }
    }
  }
  out.sort((a, b) => (b._ageDays || 0) - (a._ageDays || 0));
  return out.slice(0, 40);
}

// "This week" — created/started/completed in the last N days. Returns a flat
// activity stream tagged with which timestamp triggered inclusion.
//
// STORY-25.4.02 — TWO changes, and they are the same change.
//
// The old shape was `Object.assign({}, it, …)`: a FULL copy of the artefact record,
// body and all, per event. That is why the list had to be truncated to 40 — 40 whole
// artefacts is already a large payload and the real week is several hundred events.
// But the widget reads exactly five fields, so the copy was paying for nothing. The
// entry is now projected down to those five, which makes the whole week cheaper to
// carry than the old 40 truncated full copies were.
//
// Which is what lets the cap go. A hard `slice(0, 40)` here meant the widget's badge
// could never be honest: it counted the truncated array, so "40 events" was a ceiling
// masquerading as a total, and the 636 events beyond it were unreachable by ANY
// affordance the widget could offer. AC-4 asks for the badge and what is reachable to
// agree; that is only possible if the payload holds the whole week. Default visible
// rows are a RENDER concern now (ADR-0125), not a data one.
function computeThisWeek(pm, days) {
  days = days || 7;
  const STREAM_TYPES = ['story', 'feature', 'epic', 'bug', 'adr', 'release', 'retro', 'backlog'];
  const out = [];
  for (const t of STREAM_TYPES) {
    for (const it of (pm[t] || [])) {
      const hits = [];
      if (it.created_at   && ageDays(it.created_at)   <= days) hits.push({ when: it.created_at,   why: 'created' });
      if (it.started_at   && ageDays(it.started_at)   <= days) hits.push({ when: it.started_at,   why: 'started' });
      if (it.completed_at && ageDays(it.completed_at) <= days) hits.push({ when: it.completed_at, why: 'completed' });
      for (const h of hits) {
        // The five fields streamHtml() reads. `id` + `_type` are also the drawer key
        // (data-type/data-id), so clicking a row still resolves the FULL record through
        // findArtefact() against D.story/D.bug/etc — same lookup as before.
        out.push({ id: it.id, title: it.title, _type: t, _when: h.when, _why: h.why });
      }
    }
  }
  // CHRONOLOGICAL, NOT LEXICOGRAPHIC. `localeCompare` on ISO strings only agrees with time
  // order while every stamp shares one UTC offset. The corpus this reads is 4065/4065 at
  // `+01:00` today, so the old sort was correct by coincidence - but the wider tree already
  // holds `Z`, `+00:00`, `-04:00` and more, and Europe/London puts `+00:00` and `+01:00` in
  // the SAME seven-day window every October. The widget only ever showed 3 days x 4 rows; the
  // timeline view groups the whole week, and its day headings are correct only if this list
  // is day-monotone - a payload ordered day-A, day-B, day-A renders two headings for the same
  // day (EPIC-30 phase-close review). Ties keep their original order.
  out.sort((a, b) => {
    const ta = Date.parse(String(a._when));
    const tb = Date.parse(String(b._when));
    if (Number.isNaN(ta) || Number.isNaN(tb)) {
      // An unparseable stamp must not reorder the list arbitrarily; fall back to the string
      // comparison rather than to NaN, which would make the sort non-deterministic.
      return String(b._when).localeCompare(String(a._when));
    }
    return tb - ta;
  });
  return out;
}

/* ============================================================
 * STORY-25.4.03 — the in-flight signal (ADR-0126).
 *
 * Replaces the lifetime cumulative done/total bar, which had been reading 99% for
 * months: with 295 of 298 stories done, one more close-out moves it by 0.3 of a
 * percentage point. A number that cannot move is not an indicator.
 *
 * THE DEFINITION (ADR-0126): "in flight" is the count of stories whose status is
 * `in-progress` or `in-review` — the work that is genuinely open right now — shown
 * against the near pipeline (`ready` + in-flight), with a 7-day delta underneath.
 * The primary value is the in-flight count, and it moves by exactly 1 whenever a story
 * enters or leaves those two statuses. That is the property TC-01 asserts, and it is
 * why the count and not a percentage is the headline: a percentage of a 298-story
 * denominator is the same stuck number in a different costume.
 *
 * Pure and corpus-only, so tests/now-signal-row.test.js can drive the SHIPPED function
 * over a fixture PM root via PM_DASH_ROOT and prove the value MOVES, rather than
 * asserting against a re-implementation of it.
 * ============================================================ */
const IN_FLIGHT_STATUSES = ['in-progress', 'in-review'];

function computeSignal(pm, days) {
  days = days || 7;
  const stories = (pm && pm.story) || [];
  const byStatus = (s) => stories.filter((x) => (x.status || 'not-started') === s).length;
  const inFlight = IN_FLIGHT_STATUSES.reduce((n, s) => n + byStatus(s), 0);
  const ready = byStatus('ready');
  const blocked = byStatus('blocked');
  // The near pipeline: what could be worked next, plus what is open. Deliberately NOT
  // the whole corpus — a denominator of 298 is what made the old bar inert.
  const pipeline = ready + inFlight;
  let started = 0; let completed = 0;
  for (const s of stories) {
    if (s.started_at && ageDays(s.started_at) <= days) started += 1;
    if (s.completed_at && ageDays(s.completed_at) <= days) completed += 1;
  }
  return {
    inFlight,
    ready,
    blocked,
    pipeline,
    // A share of the NEAR pipeline, not of all time. Null (never 0) when the pipeline
    // is empty — there is no fraction of nothing, and a fabricated 0% would read as
    // "nothing is moving" when the truth is "there is nothing to move".
    pipelinePct: pipeline > 0 ? Math.round((100 * inFlight) / pipeline) : null,
    windowDays: days,
    startedInWindow: started,
    completedInWindow: completed,
    inFlightStatuses: IN_FLIGHT_STATUSES.slice(),
  };
}

/* ============================================================
 * STORY-21.2.03 — usage rollup (ADR-0079). Rolls up ACTUAL usage
 * (usage-log.jsonl, tolerant of absence) + ESTIMATED usage
 * (usage_estimate frontmatter) per epic/feature for the __DATA
 * payload's `usage` field. CRITICAL HONESTY RULE: an epic/feature
 * entry is created ONLY when a story actually contributes an
 * estimate or an actual — never a fabricated all-null/all-zero row.
 *
 * ------------------------------------------------------------
 * STORY-25.4.01 — chat-kind records, and the ATTRIBUTION RULE.
 *
 * The ledger holds two kinds of record. `kind:"story"` carries a story id and
 * is attributable. `kind:"chat"` carries a chat id ("CHAT-06") captured as one
 * bracket over a whole batch, and is NOT attributable to an epic or a feature:
 *
 *   - a chat id is only unique WITHIN one execution-strategy sidecar, and this
 *     project has 19 of them, so "CHAT-01" names nineteen different brackets;
 *   - the same repeated phase names make sidecar-of-origin unrecoverable from
 *     the ledger record alone (it carries ts + id + tokens, nothing else);
 *   - a chat may legitimately span epics, so even a resolved sidecar would not
 *     yield ONE epic.
 *
 * The rule, therefore (ADR-0124): a chat record is COUNTED and its tokens are
 * TOTALLED, and it is attributed to NOTHING. It never creates or bumps an
 * epic/feature entry. This is the story's "stated-count path", chosen over a
 * guess: inventing an attribution is the converse of the honesty rule the
 * header above states, and would be a worse failure than declining to attribute.
 *
 * The honesty rule is applied to the chat block itself, not just to epics:
 * `totalTokens` is null (never 0) when no chat record contributes any tokens,
 * and the whole `chat` block is null when there are no chat records at all.
 * ============================================================ */

// STORY-29.3.01 / ADR-0188 — THE ROLLUP MOVED; THIS IS THE CALL SITE.
//
// Everything the block comment above describes is now implemented once, in
// `lib/usage-rollup.js`, and `generate-monitor.js` calls the same function. The body that used
// to live here was the fixed half of a pair whose other half (MONITOR's) still asserted "no
// usage actuals recorded yet" over 31 records — BUG-20260805-01. Two implementations cannot be
// kept in agreement by intention; one implementation cannot disagree with itself.
//
// This wrapper survives for exactly two reasons: it supplies THIS surface's ledger path
// (`USAGE_LOG_PATH`, which honours PM_DASH_ROOT, rather than usage-capture's install-pinned
// default), and `tests/usage-rollup.test.js` drives the SHIPPED export through it.
//
// `opts.logPath` overrides the module-level ledger path — the seam that lets the rollup be
// tested against fixtures without touching the real ledger.
function buildUsageRollup(storyRecords, opts) {
  const options = opts || {};
  return usageRollup.buildUsageRollup(storyRecords, {
    logPath: options.logPath || USAGE_LOG_PATH,
    retroLogPath: options.retroLogPath,
    retroRecords: options.retroRecords,
  });
}

/* ============================================================
 * STORY-29.1.04 — the stale-run notice, and the judgement an operator recorded about it
 * (ADR-0180, closing BACKLOG-0147).
 *
 * THE BOARD IS STATIC HTML, SO THE DISMISSAL IS NOT A CLICK. The story's own gotcha puts the
 * choice plainly: a dismissal written at VIEW time needs a client store the next GENERATION
 * reads, or dismissal happens through a command. It is the command —
 * `autopilot-stale-runs.js --dismiss <run_id> --reason "<why>"` — because a click on a
 * generated page can only write somewhere the generator does not read, and a notice that
 * reappears on the next `pm:dash` would be persistence that is fake in exactly the way the
 * story forbids. The board RENDERS the state; it never writes it.
 *
 * DEMO/EXTERNAL RENDERS CANNOT CARRY A HOST DISMISSAL (AC-4, ADR-0106's posture). The reports
 * directory is derived from `PM_ROOT`, which honours `PM_DASH_ROOT` — so a demo build reads the
 * fixture root's store, which does not exist, and gets nothing. That is structural rather than
 * a filter somebody has to remember to apply, and `tests/stale-run-notice.test.js ::
 * demo-clean-three-states` asserts it against a real external-root render.
 *
 * ALWAYS SAFE. A broken checkpoint, a corrupt store, or a missing reports folder yields a
 * notice block that says so — never an exception. `pm:dash` regenerating the whole board must
 * not be takeable down by an orientation widget.
 * ============================================================ */

const staleRunsMod = require('./autopilot-stale-runs.js');

function buildStaleRunNotice(opts) {
  const reportsDir = (opts && opts.reportsDir) || path.join(PM_ROOT, '41-Reports');
  const empty = {
    reportsDir: rel(reportsDir),
    external: EXTERNAL_ROOT,
    active: [],
    dismissed: [],
    consideredCount: 0,
    storeError: null,
    error: null,
  };
  let verdict;
  try {
    verdict = staleRunsMod.staleRuns(reportsDir, (opts && opts.now) ? { now: opts.now } : {});
  } catch (err) {
    return Object.assign({}, empty, {
      error: `stale-run detection failed: ${err && err.message ? err.message : String(err)}`,
    });
  }
  const shape = v => ({
    run_id: v.run_id,
    reason: v.reason,
    stale_for: v.stale_for,
    summary: v.summary,
    why: v.why,
    paused_at: v.paused_at,
    scheduled_at: v.scheduled_at,
    evidence_key: v.evidence_key,
    // `dismissed_by` travels with the reason and the instant. The shape is an allow-list, so a
    // field the store gains is invisible on the board until it is named HERE — which is how the
    // actor reached the render as `(not recorded)` on its first wiring (BUG-20260810-04).
    dismissal: v.dismissal
      ? {
        reason: v.dismissal.reason,
        dismissed_by: v.dismissal.dismissed_by,
        dismissed_at: v.dismissal.dismissed_at,
      }
      : null,
  });
  return Object.assign({}, empty, {
    active: verdict.active.map(shape),
    dismissed: verdict.dismissed.map(shape),
    consideredCount: verdict.considered.length,
    storeError: verdict.dismissalStore ? verdict.dismissalStore.error : null,
  });
}


/* ============================================================
 * v1.1 — Split reports into the 3 typed homes (ADR-0048)
 *
 * Build → Phases    : Execution Strategies (already shaped by buildExecutionStrategy)
 * Cadence → Reviews : AI-CODE-REVIEW-* indexed by linked artefact id
 * Cadence → Audits  : everything else (Phase retros, Remediation, Explorations,
 *                     Boards, plus 20-Requirements/*.html + 42-Monitor/*.html)
 * ============================================================ */

// Parse a linked artefact id out of an AI-CODE-REVIEW filename.
// Examples:
//   AI-CODE-REVIEW-STORY-02.3.01-2026-05-24.html       → STORY-02.3.01
//   AI-CODE-REVIEW-FEAT-09.2-2026-05-27.md             → FEAT-09.2
//   AI-CODE-REVIEW-EPIC-04-2026-05-27.md               → EPIC-04
//   AI-CODE-REVIEW-plugin-2026-05-26.html              → null (free-form target)
//
// STORY-28.3.01 / ADR-0175 — the three families come from lib/artefact-id.js. The private
// copy this replaces spelled the epic and story-epic numbers `\d{2}`, so
// `AI-CODE-REVIEW-EPIC-104-…` did not fail to parse — it parsed to `EPIC-10`, and the review
// would render on the wrong epic's card with nothing anywhere to notice. Two digits is the
// PADDING convention (CLAUDE.md § Numbering rules), never the grammar. The live review corpus
// is entirely two-digit, so the rendered board is unchanged; the test asserts that over the
// real corpus rather than assuming it.
const REVIEW_LINK_RE = new RegExp(
  '^AI-CODE-REVIEW-' + artefactId.alternation(['STORY', 'FEAT', 'EPIC']), 'i');
function parseReviewLink(name) {
  const m = String(name).match(REVIEW_LINK_RE);
  return m ? m[1].toUpperCase() : null;
}

/* ------------------------------------------------------------
 * STORY-25.6.03 — the review verdict. REWRITTEN after CRITICAL-1 of the CHAT-08
 * independent review; the reasoning is ADR-0131.
 *
 * The first version scanned the WHOLE document for the first verdict-shaped word
 * and the first severity-shaped number. Over 105 reviews that put a wrong verdict
 * on 35 cards, and every error softened it — this branch's own review artefact
 * rendered `PASS`, matched inside the subtitle "An independent pass over a
 * freshly regenerated dashboard", while its actual verdict is
 * APPROVE-WITH-CHANGES. Two more rendered PASS / PASSED against sections reading
 * "Ship." The counts had the same disease: `78 warning · 78 nit` lifted out of a
 * contrast table reading `warning=2.78 nit=10.95`.
 *
 * A verdict is now only read from a place where a verdict is DECLARED, and a
 * document that declares none gets `null` rather than a guess. Showing nothing is
 * the AC-4 contract; showing a softened verdict is worse than showing nothing.
 *
 * Anchors, in priority order — the first that yields anything wins:
 *   1. a verdict HEADING          `## Verdict`, `## 5. Verdict`, `## Scope & Verdict`
 *   2. a verdict DECLARATION      `Verdict: X`, `Verdict — X`, `Verdict is X`
 *      (a separator is REQUIRED: it is what rejects "Verdict. 396 const …" inside
 *      a code diff and "…verdict below with its own pass/fail" in prose)
 *   3. a COUNTS BLOCK             three or more severity counts inside 90 chars,
 *      e.g. `0 blocker 0 critical 0 warning 1 nit`. 48 reviews carry this and no
 *      verdict word at all. Three is the threshold because two is what a contrast
 *      table produces.
 * Only the window around the winning anchor is parsed. No anchor -> null.
 * ------------------------------------------------------------ */

const VERDICT_SEVERITIES = ['blocker', 'critical', 'major', 'minor', 'warning', 'nit'];

// Longest-first, so APPROVE-WITH-CHANGES is not shortened to APPROVE. The
// open-ended APPROVE-WITH-<word> arm exists because the closed list missed
// APPROVE-WITH-NITS and silently reported those reviews as a clean APPROVE —
// not one card in the corpus carried a WITH-qualified label before this fix.
const VERDICT_LABELS = /\b(APPROVE-WITH-[A-Z]+|APPROVED|APPROVE|CLEAR TO CLOSE|BLOCKED|REJECTED|REJECT|READY|PASSED|PASS|SHIP(?:\s+IT)?)\b/i;

// The numeric boundary is load-bearing. Without the lookbehind, `2.78 nit` in a
// contrast table matches as "78 nit"; `\d{1,3}` additionally refuses a count no
// review would ever state.
const VERDICT_COUNT_RE = (sev) => new RegExp('(?<![\\w.])(\\d{1,3})\\s*' + sev + 's?\\b', 'i');
const VERDICT_NONE_RE = (sev) => new RegExp('\\bno\\s+' + sev + 's?\\b', 'i');

// Block-aware flattening, so an .html review's headings and paragraphs survive as
// LINES and the heading anchor can still see them.
//
// Two traps here, both of which bit on the first attempt:
//   - stripHtmlTags() collapses \s+ to a single space, so newlines inserted before
//     it are eaten. A \1 sentinel is used instead because it is not whitespace
//     and therefore survives that collapse.
//   - the format must be decided by EXTENSION, not by sniffing for "<". A markdown
//     review that merely mentions <div> in a code sample was being treated as HTML,
//     tag-stripped, and flattened to one line — which is exactly why the two
//     "## 5. Verdict / Ship." reviews the review named still read as no verdict
//     after the anchors were added.
function reviewPlainText(text, name) {
  const s = String(text == null ? '' : text);
  const ext = reportExt(name || '');
  const looksHtml = ext === 'html' || ext === 'htm'
    || (!ext && /<(?:html|body|div|p|h[1-6])\b/i.test(s));
  if (!looksHtml) return s; // markdown already carries its own line structure
  const SENT = '\u0001'; // not whitespace, so the \s+ collapse cannot eat it
  const withBreaks = s
    .replace(/<\/(h[1-6]|p|div|li|tr|section|header|blockquote)>/gi, SENT)
    .replace(/<br\s*\/?>/gi, SENT);
  return stripHtmlTags(withBreaks).split(SENT).map((l) => l.trim()).join('\n');
}

function verdictWindows(plain) {
  const out = [];
  const heading = /^[ \t]{0,3}#{1,6}[ \t]*(?:[\d.]+[ \t]*)?(?:scope[ \t]*&[ \t]*)?verdict\b[^\n]*/im.exec(plain);
  if (heading) out.push(plain.slice(heading.index, heading.index + 320));
  const decl = /\b(?:final\s+)?verdict\b[ \t]*(?::|—|-{1,2}|\bis\b)[ \t]*/i.exec(plain);
  if (decl) out.push(plain.slice(decl.index, decl.index + 320));
  // A counts block: >= 3 distinct severities inside 90 characters.
  const hits = [];
  const scan = /(?<![\w.])(\d{1,3})\s*(blocker|critical|major|minor|warning|nit)s?\b/ig;
  let m;
  while ((m = scan.exec(plain))) hits.push({ at: m.index, sev: m[2].toLowerCase() });
  for (let i = 0; i < hits.length; i += 1) {
    const near = hits.filter((h) => h.at >= hits[i].at && h.at - hits[i].at <= 90);
    if (new Set(near.map((h) => h.sev)).size >= 3) {
      // Reach back for a label stated just before the block ("APPROVE-WITH-CHANGES · 0 blocker /…").
      out.push(plain.slice(Math.max(0, hits[i].at - 140), hits[i].at + 120));
      break;
    }
  }
  return out;
}

function parseReviewVerdict(text, name) {
  if (!text) return null;
  const plain = reviewPlainText(text, name);
  for (const win of verdictWindows(plain)) {
    const counts = {};
    for (const sev of VERDICT_SEVERITIES) {
      const numbered = VERDICT_COUNT_RE(sev).exec(win);
      if (numbered) { counts[sev] = Number(numbered[1]); continue; }
      if (VERDICT_NONE_RE(sev).test(win)) counts[sev] = 0; // "no blockers" is a verdict of zero
    }
    const lab = VERDICT_LABELS.exec(win);
    const label = lab ? lab[1].toUpperCase().replace(/\s+/g, ' ') : null;
    const keys = VERDICT_SEVERITIES.filter((s) => Object.prototype.hasOwnProperty.call(counts, s));
    if (!keys.length && !label) continue; // this anchor said nothing; try the next
    return {
      label,
      counts: keys.map((s) => ({ severity: s, n: counts[s] })),
      // A single readable line for the card, so the renderer does not have to
      // re-decide how a verdict reads.
      text: [label, keys.map((s) => counts[s] + ' ' + s).join(' · ')].filter(Boolean).join(' — '),
    };
  }
  return null; // no anchor declared a verdict — the card shows none
}

function splitReports(reports) {
  const reviews = [], audits = [];
  for (const r of reports) {
    if (r.kind === 'Execution Strategies') continue; // → D.executionStrategy / D.phases
    if (r.kind === 'Code Reviews') {
      reviews.push(Object.assign({}, r, { linked: parseReviewLink(r.name) }));
    } else {
      audits.push(r);
    }
  }
  // Newest first — on the DATE, not on the name. Sorting by name only looked like
  // date order because most filenames start with the same prefix; across prefixes
  // it interleaved badly (the Audits view opened 2026-06-09, 05-27, 05-26, 08-01).
  // STORY-25.5.04 put a visible date on every card, which is what made the wrong
  // order obvious. Undated records sort last, then by name, so the order is total
  // and stable rather than dependent on readdir order.
  const newestFirst = (a, b) => {
    if (a.date && b.date && a.date !== b.date) return b.date.localeCompare(a.date);
    if (a.date && !b.date) return -1;
    if (!a.date && b.date) return 1;
    return b.name.localeCompare(a.name);
  };
  reviews.sort(newestFirst);
  audits.sort(newestFirst);
  return { reviews, audits };
}






/* ============================================================
 * Left ink rail (STORY-23.2.01, ADR-0094) — server-rendered, static
 * markup. Supersedes the client-JS `renderGroupNav()`/`.gtab` two-row
 * tab (ADR-0048); see ADR-0094 for why static Node-side render replaced
 * the DOM-API build. Same key/label/order as the retired browser-side
 * `groups` array — "AI Catalogue" label preserved (TESTPLAN-11.2.03 TC-01
 * intent).
 * ============================================================ */
const RAIL_GROUPS = [
  ["now", "Now", "Flow", '<path d="M3 12h4l3 8 4-16 3 8h4"/>'],
  ["capture", "Capture", "Flow", '<path d="M4 4h16v12h-5l-3 3-3-3H4z"/>'],
  ["plan", "Plan", "Flow", '<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/>'],
  ["build", "Build", "Flow", '<path d="M4 6h16M4 12h16M4 18h10"/>'],
  ["cadence", "Cadence", "Flow", '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'],
  ["decisions", "Decisions", "Flow", '<path d="M6 3h9l3 3v15H6z"/><path d="M9 9h6M9 13h6M9 17h4"/>'],
  // STORY-27.3.01 — Reports is its own group. It was a renderer with no way in:
  // RENDERERS.reports existed, but LEGACY_ROUTES redirected "reports" to
  // cadence:audits and no <section id="sec-reports"> was ever emitted, so the
  // whole corpus browser was unreachable. See ADR-0140 for why it is a top-level
  // group in Reference rather than a sixth Cadence pill.
  ["reports", "Reports", "Reference", '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 16h4"/>'],
  // STORY-31.1.01 / ADR-0218 — the Project Wiki. In Reference, beside Reports, because
  // it is a place you go to READ something the project already produced, not a step in
  // the Flow. Registered here and nowhere else: buildSubTabs() keys the browser routing
  // config off this array, so one row makes the group real for the rail, the router and
  // the --views vocabulary at once (validate-frontmatter.js reads the same export).
  ["wiki", "Project Wiki", "Reference", '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H11v18H5.5A1.5 1.5 0 0 1 4 19.5z"/><path d="M11 3h7.5A1.5 1.5 0 0 1 20 4.5v15a1.5 1.5 0 0 1-1.5 1.5H11"/><path d="M7 7.5h1.5M7 11h1.5M14 7.5h3M14 11h3"/>'],
  ["toolkit", "AI Catalogue", "Reference", '<path d="M14 7l3 3-7 7-3 .5.5-3z"/><path d="M4 20h16"/>'],
  ["tandem", "Tandem", "Reference", '<path d="M7 5l5 14M12 5l5 14M4 19h16M9 5h8"/>'],
  ["about", "About", "Reference", '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'],
];



/* ============================================================
 * Contextual pill sub-nav (STORY-23.2.02, ADR-0094) — server-rendered,
 * static markup: one <nav class="sub-nav" data-group="X"> block per
 * multi-view group.
 *
 * STORY-27.1.03 (BACKLOG-0096, ADR-0094's alternative 2) — this is now the
 * SINGLE source. The browser-side `SUB_TABS` routing config used to be a
 * hand-kept mirror of this object inside BROWSER_JS; it is generated from here
 * by buildSubTabs() and emitted as data ahead of BROWSER_JS. Adding or removing
 * a sub-view is one edit, to the object below.
 * ============================================================ */
const SUB_NAV_GROUPS = {
  capture: [["inbox", "Inbox"], ["backlog", "Backlog"]],
  plan: [["strategy", "Strategy"], ["roadmap", "Roadmap"], ["specs", "Specs"]],
  build: [["phases", "Phases"], ["epic", "Epics"], ["feature", "Features"], ["story", "Stories"], ["testplan", "Testplans"], ["bug", "Bugs"]],
  // STORY-30.5.01 / ADR-0213 — "timeline" is a CADENCE sub-view, not a Now sub-view.
  // Now has no sub-nav at all, and giving it one would make `#group=now` resolve to
  // `now:<first sub>`; ADR-0138's "an unknown hash still lands on Now" contract is
  // asserted against a bare Now, so that reshape would have been a routing change
  // wearing a placement decision's clothes. Cadence already owns the time-ordered
  // surfaces (Monitor, Retros, Releases), which is what an activity timeline is.
  cadence: [["monitor", "Monitor"], ["timeline", "Timeline"], ["retros", "Retros"], ["releases", "Releases"], ["reviews", "Reviews"], ["audits", "Audits"]],
  toolkit: [["skill", "Skills"], ["agent", "Agents"], ["command", "Commands"], ["plugin", "Plugins"], ["templates", "Templates"], ["prompts", "Prompts"], ["scripts", "Scripts"], ["glossary", "Glossary"]],
};

/* ------------------------------------------------------------------
 * CRITICAL-3 (independent review, 2026-08-11) — the matrix and the sub-nav
 * must name the SAME set of Build sub-views, asserted at build time.
 *
 * THE HOLE. `--dropdown-adoption-scan` takes `Object.keys(SLICE_BANDS)` as its
 * own oracle: "every filterable sub-view" means "every key the matrix has".
 * Nothing anywhere asserted that set against `SUB_NAV_GROUPS.build`, the list
 * of sub-views a reader can actually navigate to. A seventh Build sub-view
 * added to SUB_NAV_GROUPS alone was therefore invisible in both directions —
 * measured on this branch, the scan reported "6 filterable sub-view(s) … all 6
 * proved BY BEHAVIOUR" and exited 0, `npm run pm:dash` exited 0, and the whole
 * 85-suite `npm test` passed. A navigable, unfiltered, unprobed view.
 *
 * The `expected.length <= 5` floor inside the probe is not this check: it is a
 * hardcoded number one below today's six, so it catches a REMOVAL today and
 * says nothing whatever about growth.
 *
 * THE EXEMPTION IS A LIST, NOT A SILENCE. A Build sub-view can legitimately be
 * non-filterable — but that has to be a decision someone wrote down, with the
 * reason next to it, so the next reader can tell "deliberately unfiltered" from
 * "nobody noticed". An empty list is the honest state today: all six filter.
 * ------------------------------------------------------------------ */
const NON_FILTERABLE_BUILD_SUBS = {
  // '<sub key>': 'why this sub-view deliberately offers no slicer bands',
};

// The rule itself, as a pure function over the three lists, so
// tests/build-subview-filterability.test.js drives the SHIPPED rule with
// synthetic divergences instead of re-implementing it (the
// phase-band-source.test.js precedent). Returns the problems; the caller
// decides whether to throw.
function buildSubViewFilterabilityProblems(navSubs, matrixSubs, exempt) {
  const staleExemption = exempt.filter((s) => navSubs.indexOf(s) === -1);
  const exemptedAndGranted = exempt.filter((s) => matrixSubs.indexOf(s) !== -1);
  const navNotInMatrix = navSubs.filter((s) => matrixSubs.indexOf(s) === -1 && exempt.indexOf(s) === -1);
  const matrixNotInNav = matrixSubs.filter((s) => navSubs.indexOf(s) === -1);

  const problems = [];
  if (navNotInMatrix.length) {
    problems.push('SUB_NAV_GROUPS.build offers sub-view(s) the band matrix does not grant, and which are not on the '
      + 'named exemption list: ' + navNotInMatrix.join(', ') + '. A reader can navigate there; --dropdown-adoption-scan '
      + 'takes SLICE_BANDS as its denominator, so it would never visit them and would still report "all N proved". '
      + 'Either add the sub-view to SLICE_BANDS, or add it to NON_FILTERABLE_BUILD_SUBS with the reason.');
  }
  if (matrixNotInNav.length) {
    problems.push('SLICE_BANDS grants bands to sub-view(s) SUB_NAV_GROUPS.build does not offer: ' + matrixNotInNav.join(', ')
      + '. The adoption scan would try to click a sub-pill that does not exist and fail for a confusing reason. '
      + 'Remove the matrix row, or add the sub-view to the sub-nav.');
  }
  if (exemptedAndGranted.length) {
    problems.push('NON_FILTERABLE_BUILD_SUBS names sub-view(s) the matrix DOES grant bands to: ' + exemptedAndGranted.join(', ')
      + '. The exemption and the grant contradict each other; drop one.');
  }
  if (staleExemption.length) {
    problems.push('NON_FILTERABLE_BUILD_SUBS names sub-view(s) SUB_NAV_GROUPS.build no longer offers: ' + staleExemption.join(', ')
      + '. A stale exemption silently widens the next real gap; remove it.');
  }
  return problems;
}

// Runs at module load, so `npm run pm:dash` is where the divergence is caught —
// loudly, once — rather than in a browser probe that takes the matrix as its own
// oracle and therefore cannot see it at all.
(function assertEveryBuildSubViewIsFilterableOrExempt() {
  const problems = buildSubViewFilterabilityProblems(
    (SUB_NAV_GROUPS.build || []).map((s) => s[0]),
    Object.keys(SLICE_BANDS),
    Object.keys(NON_FILTERABLE_BUILD_SUBS),
  );
  if (problems.length) {
    throw new Error('Build sub-view filterability disagrees with the band matrix:\n  - ' + problems.join('\n  - '));
  }
})();



/* ============================================================
 * STORY-30.5.03 / BUG-20260805-01 — About, derived at build time.
 *
 * The page this replaces was prose written during EPIC-23's brand pass and never
 * made data-driven, so four epics of change silently invalidated bits of it — the
 * designed-then-drifts pattern. Everything here is resolved from a file at
 * generation time, and the two hand-written paragraphs below are the ONLY literal
 * sentences on the page. That makes the rot class structural rather than editorial:
 * there is no longer a fact on About that a future story could invalidate without
 * changing the file it is read from.
 *
 * The section is SERVER-BAKED into <section id="sec-about"> rather than rendered by
 * a client renderer — the same ADR-0098/0099 move Build › Phases and Toolkit ›
 * Plugins already made — so a static check (and TESTPLAN-30.5.03 TC-02's grep for
 * `data-about-version`) reads real emitted markup instead of a client string-concat.
 * ============================================================ */
const ABOUT_TANDEM_BLURB = 'Tandem is a project-management operating system for one person and an AI pair: '
  + 'a closed status enum, mandatory Story-to-Testplan pairing, Definition-of-Ready and Definition-of-Done gates, '
  + 'a decision record written at the moment of the decision, and a bug raised the moment a test fails. '
  + 'The board you are reading is generated from that corpus, not maintained alongside it.';
const ABOUT_PROJECT_BLURB = 'Everything below is counted from this repository at the moment the board was generated. '
  + 'The markdown under the project-management folder is the source of truth; this page is a view of it, '
  + 'so a number here that looks wrong is a number in the corpus, not a number in the renderer.';

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_e) { return null; }
}

// The plugin version, resolved from a FILE, never typed. The repo's own manifest wins
// where it exists (that is the kit repo, and it is the authoritative copy there); a
// consumer install has no such file and falls through to the manifest of the plugin
// actually scanned on this machine. Neither present yields an empty string, which the
// renderer shows as an honest "not resolved" rather than inventing a number.
function resolveAboutPlugin(tandemPackage) {
  const own = readJsonSafe(path.join(REPO_ROOT, '.claude-plugin', 'plugin.json'));
  if (own && own.version) {
    return { version: String(own.version), source: '.claude-plugin/plugin.json', name: String(own.name || ''), homepage: String(own.homepage || ''), repository: String(own.repository || ''), license: String(own.license || '') };
  }
  const m = (tandemPackage && tandemPackage.manifest) || null;
  if (m && m.version) {
    return { version: String(m.version), source: 'installed plugin manifest', name: String(m.name || ''), homepage: String(m.homepage || ''), repository: String(m.repository || ''), license: String(m.license || '') };
  }
  return { version: '', source: '', name: '', homepage: '', repository: '', license: '' };
}

// The host project's identity, from the config the installer writes.
function resolveAboutProject() {
  const cfgPath = path.join(REPO_ROOT, '.claude-pm-config.json');
  const cfg = readJsonSafe(cfgPath) || {};
  return {
    name: resolveProjectName(),
    kitVersion: cfg.kitVersion ? String(cfg.kitVersion) : '',
    installedAt: cfg.installedAt || cfg.installed_at || '',
    configPresent: !!readJsonSafe(cfgPath),
  };
}

// The spec version, PARSED from the PRD. The old page hard-coded "v1.0" while the PRD
// had moved to 1.1 and the document's own <meta name="generator"> already said 1.1 —
// which is the whole bug in one line. Resolved by NAME at any depth so moving the file
// into a folder cannot silently blank it, and omitted entirely when the document is
// absent (a consumer install has no such PRD) rather than shown as a stale literal.
function resolveAboutSpec() {
  const reqRoot = path.join(PM_ROOT, '20-Requirements');
  const hits = walk(reqRoot, [], (n) => n === 'PRD-PM-Dashboard.md');
  if (!hits.length) return { name: '', version: '' };
  const text = readFileSafe(hits[0]);
  if (!text) return { name: '', version: '' };
  const m = text.match(/^\*\*Version:\*\*\s*([0-9][0-9A-Za-z.\-]*)\s*$/m);
  return { name: path.basename(hits[0]), version: m ? m[1] : '' };
}

function buildAboutFacts(tandemPackage) {
  return {
    plugin: resolveAboutPlugin(tandemPackage),
    project: resolveAboutProject(),
    spec: resolveAboutSpec(),
    // A demo / PM_DASH_ROOT render must not print host-machine facts (ADR-0106). The
    // flag is carried rather than re-derived in the builder so the one place that
    // decides "is this an external render" stays the one place.
    external: EXTERNAL_ROOT,
  };
}




/* ============================================================
 * STORY-31.1.01 — the Project Wiki's markup, SERVER-BAKED.
 *
 * Baked into <section id="sec-wiki"> for the reason ADR-0098/0099 gives and
 * STORY-30.5.03 restated for About: the content is a BUILD-TIME fact (a file's
 * rendered body), the browser cannot read a file, and a probe reading real
 * emitted markup can falsify a claim about it. A client renderer here would have
 * to be handed the same HTML through __DATA anyway — i.e. the payload would carry
 * a second copy of every doc, which is precisely the defect STORY-30.2.03 and
 * STORY-30.4.03 spent two stories removing.
 *
 * THE READING LAYOUT IS FULL-PAGE, NOT THE DRAWER (ADR-0218). Every doc is in the
 * DOM; the index switches which one is shown. A drawer is sized for an artefact
 * card's worth of prose and closes over the page; a 21 KB reference document is
 * a page, and a wiki whose reader has to keep re-opening a drawer is a tile grid
 * with extra steps. "Drawer-grade fidelity" is about the PARSER — mdToHtml, the
 * canonical one — not about the container.
 * ============================================================ */
/* STORY-31.1.02 - one drift flag, rendered.
 *
 * THE EVIDENCE LINE IS THE FLAG. Every flag renders the sentence the checker produced, which
 * names the exact dead anchor and what resolution was tried, or the exact event and the anchor
 * it shares. A pill saying "possibly stale" with the reason a click away is a verdict without
 * its evidence, and the story forbids it in as many words: "the event named, never a bare
 * verdict".
 *
 * A DISMISSED FLAG IS STILL ON THE PAGE. It renders greyed, with who dismissed it and why,
 * because deleting it would make "nobody has looked at this" and "an operator decided it was
 * fine" the same page - and the second is a fact worth six months of someone's time.
 */
function wikiFlagHtml(flag) {
  const dismissed = !!flag.dismissed;
  const label = {
    'dead-anchor': 'Dead anchor',
    staleness: 'Possibly drifted',
    unassessable: 'Unassessable',
    'anchor-schema': 'Anchor schema',
    'anchor-malformed': 'Anchor block',
  }[flag.kind] || flag.kind;
  return '<li class="wiki-flag' + (dismissed ? ' is-dismissed' : '') + '"'
    + ' data-wiki-flag="' + escapeHtml(flag.kind) + '"'
    + ' data-wiki-flag-state="' + (dismissed ? 'dismissed' : 'live') + '">'
    + '<span class="wiki-flag-kind">' + escapeHtml(label) + '</span>'
    + '<span class="wiki-flag-evidence">' + escapeHtml(flag.evidence) + '</span>'
    + (dismissed
      ? '<span class="wiki-flag-dismissal">Dismissed by ' + escapeHtml(flag.dismissedBy)
        + (flag.dismissedAt ? ' on ' + escapeHtml(String(flag.dismissedAt).slice(0, 10)) : '')
        + ' \u2014 \u201c' + escapeHtml(flag.dismissedReason) + '\u201d</span>'
      : '')
    + '</li>';
}

// The per-document drift panel. An unassessable document gets the re-run instruction rather
// than a green tick; a current one says what it was checked against, so "no flags" is
// readable as a result rather than as an absence of checking.
function wikiDriftHtml(doc) {
  const d = doc.drift || { state: 'unassessable', flags: [], anchors: [] };
  const flags = d.flags || [];
  const anchors = d.anchors || [];
  const head = {
    unassessable: 'Unassessable',
    flagged: 'Possible drift',
    current: 'Checked \u2014 no drift found',
  }[d.state] || d.state;
  // AN UNASSESSABLE DOCUMENT HAS NO `produced_by`, because it has no block at all — so the
  // board does not know whether a command writes it. Naming one command as THE fix was the
  // second half of BUG-20260818-09: on a hand-authored page that instruction is simply wrong.
  // Both routes are named, neither is asserted.
  const note = d.state === 'unassessable'
    ? '<p class="wiki-drift-note">This document carries no source-anchor block, so neither drift '
      + 'check can read it. If <code>' + escapeHtml(WIKI_PRODUCER_COMMAND) + '</code> authors this file, re-run it; '
      + 'if it is hand-authored, add the block yourself (the shape is in '
      + '<code>skills/document/SKILL.md</code>). Then run <code>npm run pm:dash</code>.</p>'
    : '<p class="wiki-drift-note">Checked against ' + anchors.length + ' declared source anchor'
      + (anchors.length === 1 ? '' : 's')
      + (d.generatedAt ? ', written ' + escapeHtml(String(d.generatedAt).slice(0, 10)) : '')
      + '.</p>';
  return '<section class="wiki-drift" data-wiki-doc-state="' + escapeHtml(d.state) + '"'
    + ' data-wiki-anchor-count="' + anchors.length + '">'
    + '<h3 class="wiki-drift-head">' + escapeHtml(head) + '</h3>'
    + note
    + (flags.length ? '<ul class="wiki-flags">' + flags.map(wikiFlagHtml).join('') + '</ul>' : '')
    + '</section>';
}

/* THE PROVENANCE FOOTER — per document, from what the document declares (ADR-0220).
 *
 * Three states, because there are three facts and collapsing them was the bug:
 *
 *   produced_by: /tandem:<skill>   a command writes this file. Naming it is a promise the
 *                                  reader can act on: re-run it, the page updates.
 *   produced_by: hand              a person writes this file. A re-run would not touch it, and
 *                                  saying otherwise sends the reader to a command that does
 *                                  nothing while resetting five other pages.
 *   (absent)                       the block records no producer. "Not recorded" is the honest
 *                                  answer; guessing a producer is how the falsehood got here.
 */
function wikiProvenanceHtml(d) {
  const by = String((d.drift && d.drift.producedBy) || '').trim();
  const file = '<code>' + escapeHtml(d.file) + '</code>';
  let inner;
  let state;
  if (by && by.indexOf('/') === 0) {
    state = 'command';
    inner = 'Authored by <code>' + escapeHtml(by) + '</code>. '
      + 'Re-run it and then <code>npm run pm:dash</code> to update this page.';
  } else if (by && by.toLowerCase() === WIKI_HAND_AUTHORED) {
    state = 'hand';
    inner = 'Hand-authored — no command writes this file. Edit ' + file
      + ' directly, then run <code>npm run pm:dash</code> to update this page.';
  } else {
    state = 'not-recorded';
    inner = 'Provenance not recorded — this document’s anchor block does not say what '
      + 'writes it. Edit ' + file + ' directly (or add <code>produced_by:</code> to its anchor '
      + 'block), then run <code>npm run pm:dash</code>.';
  }
  return '<footer class="wiki-doc-foot" data-wiki-produced-by="' + escapeHtml(state) + '">' + inner + '</footer>';
}




/* ============================================================
 * Hash-router v2 known-routes table (STORY-23.2.03, ADR-0095) — parsed from
 * the parity inventory's own `## Routes` section at build time, so the
 * emitted redirect/validation table can never drift from the recorded v1
 * route surface (TESTPLAN-23.2.03 TC-01 re-parses the same file independently
 * to verify against this). Defensive: a missing/malformed inventory yields an
 * empty array rather than crashing the build.
 * ============================================================ */
function buildKnownRoutes() {
  // STORY-27.3.02 — reader site 3 of 6. Was a hardcoded root-level path. The
  // route table is PARSED from this document, and a missing file yields an empty
  // table rather than a throw — so moving the inventory into a folder would have
  // silently emptied the hash router's known-route list, and the board would have
  // kept building. Resolved by NAME at any depth instead.
  const invPath = reportTree.resolveReportDoc(path.join(PM_ROOT, '41-Reports'), 'PARITY-INVENTORY-command-center-v1.md');
  let text;
  try {
    text = fs.readFileSync(invPath, 'utf8');
  } catch (_e) {
    return [];
  }
  const routesSection = (text.split(/^## Routes/m)[1] || '').split(/^## /m)[0];
  // Match only backticked bullet routes ("- `#group=...`") — the prior bare "#..."
  // scan ran over the whole section including prose, and the section's own intro
  // sentence ("current-format `#group=…&sub=…` routes") matched up to the non-ASCII
  // ellipsis, yielding a spurious 29th "group=" entry (AI-CODE-REVIEW-CHAT-03 anno-4).
  // TESTPLAN-23.2.03 TC-01 uses this same regex so the two derivations stay genuinely
  // independent-but-aligned instead of one parsing bug self-confirming the other.
  const matches = Array.from(routesSection.matchAll(/^\s*-\s+`#([a-z0-9=&/-]+)`/gim));
  // KNOWN_ROUTES stores bare "group=...&sub=..." keys (no leading "#").
  return matches.map(function (m) { return m[1]; });
}


/* ============================================================
 * HTML assembly
 * ============================================================ */

// HOST-PATH REDACTION — ONE implementation, shared with the ported Preact lane.
//
// BUG-20260824-09 / ADR-0238. This was an inline copy here until a SECOND build needed
// it: board/build.mjs emits the board STORY-33.9.05 cuts over to the committed name, so a
// redaction living only here would have been silently undone by the port — measured, the
// old board sat at 0 occurrences while DASHBOARD-NEXT.html carried 639. Two copies drift;
// this repo has paid for that once already (ADR-0175).
const { redactHostPaths, hostPathVariants } = require('./lib/host-path-redaction.js');



/* ============================================================
 * Cross-reference resolution — build-time application (STORY-23.3.02)
 * ============================================================ */

// Collections whose tiled artefacts get body-embedded cross-ref linking. Kept
// to the AC's enumerated tiled types (story/bug/testplan/epic/feature/ADR +
// the AI catalogue) rather than every scanned folder, so the payload-growth
// guard (TESTPLAN-23.1.02 TC-03, 20 MB envelope) has headroom — resolving
// against report/backlog/retro prose that rarely carries recognisable
// cross-refs would grow the file for little drawer value.
const XREF_TARGET_COLLECTIONS = ['story', 'bug', 'testplan', 'epic', 'feature', 'adr'];

function applyCrossRefResolution(data) {
  const idIndex = new Map();
  for (const type of XREF_TARGET_COLLECTIONS) {
    for (const item of data[type] || []) {
      if (item && item.id) idIndex.set(String(item.id), type);
    }
  }
  for (const type of XREF_TARGET_COLLECTIONS) {
    for (const item of data[type] || []) {
      if (item && item.bodyHtml) item.bodyHtml = resolveCrossRefs(item.bodyHtml, idIndex, item.id);
    }
  }
  // AI catalogue: skills/agents/commands carry bodyHtml; plugins carry readmeHtml.
  const ai = data.ai || {};
  for (const kind of ['skills', 'agents', 'commands']) {
    for (const item of ai[kind] || []) {
      if (item && item.bodyHtml) item.bodyHtml = resolveCrossRefs(item.bodyHtml, idIndex, item.name);
    }
  }
  for (const item of ai.plugins || []) {
    if (item && item.readmeHtml) item.readmeHtml = resolveCrossRefs(item.readmeHtml, idIndex, item.name);
  }
}

/* ============================================================
 * LIFTED CLIENT CONTRACTS (STORY-33.9.05)
 *
 * Facts the OLD browser bundle used to declare inside its source text, which the
 * ported board and its gates lift from THIS file as their single source. The bundle
 * retired with the renderer; the contracts stay, as real declarations and exports:
 *   PAGE_SIZE     — the CF-11 page contract (board/lib/paging.mjs)
 *   STREAM_DAYS / STREAM_PER_DAY — ADR-0125's published window (board/lib/stream-window.mjs
 *                    lifts these by SOURCE REGEX — keep them as plain `const NAME = <int>;`
 *                    declarations, exactly one each)
 *   NO_SCOPE      — the filter-attribute sentinel (board/lib/slice-matrix.mjs); its
 *                    declaration already lives in the data half above — exported, not
 *                    redeclared
 *   LEGACY_ROUTES — the v1.0 bookmark table (board/lib/legacy-routes.mjs); its sub
 *                    aliases ride SUB_ALIASES, unchanged
 * Every value below was lifted VERBATIM out of the retiring bundle by the cutover pass —
 * nothing re-typed.
 * ============================================================ */
const PAGE_SIZE = 30;
const STREAM_DAYS = 3;
const STREAM_PER_DAY = 4;
const LEGACY_ROUTES = {
  'overview': 'now',
  'impl': 'build:phases',
  'strategy': 'plan:strategy',
  'plan': 'plan:roadmap',
  'work:epic': 'build:epic',
  'work:feature': 'build:feature',
  'work:story': 'build:story',
  'work:testplan': 'build:testplan',
  'work:bug': 'build:bug',
  'decisions:adr': 'decisions',
  'decisions:backlog': 'capture:backlog',
  'decisions:release': 'cadence:releases',
  'decisions:retro': 'cadence:retros',
  'ai:skill': 'toolkit:skill',
  'ai:agent': 'toolkit:agent',
  'ai:command': 'toolkit:command',
  'ai:plugin': 'toolkit:plugin',
  'ai:glossary': 'toolkit:glossary',
  'docs': 'wiki',
  'build:stories': 'build:story',
  'build:testplans': 'build:testplan',
  'build:bugs': 'build:bug',
  'build:epics': 'build:epic',
  'build:features': 'build:feature',
};

/**
 * The payload the board ships — the corpus `data` minus the two server-side-only weights
 * (lifted out of the old renderer by STORY-33.9.05 so the payload has a producer of its
 * own, independent of any document):
 *  - `phases` stays server-side: the client only ever reads D.executionStrategy for its
 *    impl/phase lookups, never D.phases (measured when the old renderer baked its SSR),
 *    so shipping it would put a ~105 KB dead copy of the strategy corpus on the wire.
 *  - wiki doc bodies ride the baked docs, not the wire twice (STORY-31.1.01).
 */
function buildClientData(data) {
  const clientData = Object.assign({}, data);
  delete clientData.phases;
  if (clientData.wiki && Array.isArray(clientData.wiki.docs)) {
    clientData.wiki = Object.assign({}, clientData.wiki, {
      docs: clientData.wiki.docs.map(function (d) {
        const copy = Object.assign({}, d);
        delete copy.bodyHtml;
        return copy;
      }),
    });
  }
  return clientData;
}

/* ============================================================
 * Main
 * ============================================================ */

/**
 * `--payload-out <file>` — the payload's own exit (STORY-33.9.05, sanctioned by ADR-0271's
 * freeze terminus; the shape ADR-0230 alternative 3/4 could not take while the freeze held).
 * The generator is the board's DATA PRODUCER; this flag lets the assembly lanes receive the
 * payload as a file instead of slicing it back out of a rendered document. RAW JSON on
 * purpose: `assemble()` documents its payload input as UNescaped and applies its own
 * `escapeForScript` at embed time — pre-escaping here would double-escape.
 */
function parsePayloadOutFlag() {
  const i = process.argv.indexOf('--payload-out');
  if (i === -1) return null;
  const v = process.argv[i + 1];
  if (!v || v.startsWith('--')) {
    console.error('✗ --payload-out requires a file path (ADR-0135: usage faults are exit 2)');
    process.exit(2);
  }
  return path.resolve(v);
}

function main() {
  const t0 = Date.now();
  // Usage first (review minor): refusing a bare invocation AFTER a 3-second corpus walk
  // was a slow way to say "wrong command".
  const payloadOut = parsePayloadOutFlag();
  if (!payloadOut) {
    console.error('✗ generate-dashboard.js is the board\'s DATA PRODUCER (STORY-33.9.05): '
      + 'it emits the window.__DATA payload and renders no document. Usage: '
      + 'node generate-dashboard.js --payload-out <file>. To (re)build the board itself, '
      + 'run `npm run pm:dash` (build-board.js), which invokes this producer as its child.');
    process.exit(2); // ADR-0135: usage faults are exit 2
  }
  const pm = buildPmCorpus();
  const monitor = parseMonitor();
  const ai = buildAiCatalogue();
  const counts = computeCounts(pm);
  const plan = buildPlanTree(pm);
  const executionStrategy = buildExecutionStrategy();
  const reports = buildReports();
  const docs = buildDocs();
  const wiki = buildWiki();

  // v1.1 — new scan surfaces (ADR-0048).
  const specs     = buildSpecs();
  const templates = buildTemplates();
  const prompts   = buildPrompts();
  const scripts   = buildScripts();

  // v1.1 — derived "Now-page" widgets.
  const pendingAction = computePendingAction(pm);
  const blocking      = computeBlocking(pm);
  const stale         = computeStale(pm, 14);
  const thisWeek      = computeThisWeek(pm, 7);

  // STORY-21.2.03 — usage rollup (estimated + actual tokens, per epic/feature).
  const usage = buildUsageRollup(pm.story);

  // STORY-29.1.04 — the stale-run notice, and whichever of them an operator has judged.
  const staleRunNotice = buildStaleRunNotice();

  // STORY-25.4.03 — the in-flight signal (ADR-0126), left half of the signal row.
  const signal = computeSignal(pm, 7);

  // STORY-30.2.03 / ADR-0200 — report bodies live in ONE map keyed by the record's
  // `id`, never on the records themselves.
  //
  // `reports`, `audits` and `reviews` are three PRESENTATIONS of the same corpus.
  // `audits` shares object references with `reports`, and `reviews` holds shallow
  // COPIES — so a body carried on the record serialises two or three times.
  // STORY-25.2.02 measured exactly this shape at 384 KB for the monitor entries;
  // at 1.3 MB of report markdown the same mistake would be several megabytes on a
  // board that is already 27 MB.
  //
  // Keying by `id` also makes AC-1's parity STRUCTURAL rather than something a test
  // has to keep true: the Reports route and the Cadence · Audits route resolve the
  // same record id into the same map entry, so they cannot show different bodies.
  //
  // This runs BEFORE splitReports() on purpose — reviews are copied there, and a
  // body left on the record until after the split would survive on the copies.
  const reportBodies = {};
  for (const r of reports) {
    if (r.bodyHtml) reportBodies[r.id] = r.bodyHtml;
    delete r.bodyHtml;
  }

  // v1.1 — split reports into typed homes for Build → Phases / Cadence → Reviews|Audits.
  const splitR = splitReports(reports);
  // STORY-23.4.01/02 — `phases` is now one entry PER PHASE (flattened across every
  // epic), not one entry per epic — see flattenPhases(). Both the rail count and the
  // "Phases" sub-nav pill (railCounts/subNavCount, unchanged) key off this same array,
  // so AC-4 (sub-nav count === sidecar phase count) falls out of this reshape for free.
  // STORY-29.2.03 / ADR-0186 — reconcile the two tracks BEFORE flattening, so every phase and
  // chat carries one executed truth and its run-kind. Read-only; no sidecar is rewritten.
  const trackReconciliation = buildTrackReconciliation(executionStrategy, pm.story);
  const phases = flattenPhases(executionStrategy, trackReconciliation);

  // BUG-20260618-01 / STORY-21.5.01 — Tandem tab consumer gate.
  const isKitRepo = detectIsKitRepo();

  // STORY-23.2.03 (ADR-0095) — hash-router v2 known-routes table, generated
  // from the parity inventory (never hand-duplicated).
  const knownRoutes = buildKnownRoutes();

  const data = Object.assign({}, pm, {
    // BUG-20260801-04 — was `new Date().toISOString()`, which normalised to UTC and made every
    // displayed date the WRONG DAY between midnight and the local offset. Offset-preserving now.
    generatedAt: localIso(new Date()),
    project: resolveProjectName(),
    // STORY-25.2.02: the entry list is shipped ONCE, as `monitorEntries`.
    // `monitor` and `monitorEntries` referenced the SAME array and JSON.stringify
    // does not dedupe references, so every entry was serialised twice. Harmless
    // while an entry was two short strings; this story added three pre-rendered
    // HTML fields per entry, and the duplicate cost 384 KB of the 769 KB growth.
    // Every client reader now uses `D.monitorEntries`.
    //
    // STORY-30.4.03 / BACKLOG-0116 — `bodyHtml` is dropped here too, for the same
    // reason one story later. It was the WHOLE of MONITOR.md rendered a second time
    // (792 KB) on top of the per-entry renders, and it has **no reader**: not in the
    // client bundle (`D.monitor` is never dereferenced — the only two `D.monitor*`
    // reads in this file are both `D.monitorEntries`), not in the emitted board (the
    // string `monitor.bodyHtml` appears 0 times in DASHBOARD.html), and not in any
    // smoke probe or test. `found`, `wip`, `lastUpdated` and `file` are kept: they
    // are scalars, and `wip`/`lastUpdated` are what the panel's header is built from
    // server-side.
    //
    // This is the same defect class as the per-entry twins, one level up — a payload
    // carrying a whole second rendering of a document nothing reads. Removing it is
    // what makes the "renders ONCE" claim true of the payload and not just of the
    // entry list.
    monitor: monitor ? Object.assign({}, monitor, { entries: undefined, bodyHtml: undefined }) : monitor,
    counts,
    ai,
    plan,
    executionStrategy,
    reports,
    // STORY-30.2.03 — see the lift above. One entry per report id; the ONLY place a
    // report body exists in the payload.
    reportBodies,
    docs,
    // STORY-31.1.01 - the Project Wiki. The SECTION is baked from this same object
    // (buildWikiSectionHtml reads data.wiki), and the client copy below has every
    // bodyHtml stripped: shipping the rendered docs twice is the exact defect
    // STORY-30.2.03 and STORY-30.4.03 removed one payload at a time. What the browser
    // keeps is the metadata a probe needs as an ORACLE - slug, file, title - which is
    // small and is not a second rendering of anything.
    wiki,
    // v1.1 — new __DATA keys (ADR-0048, TESTPLAN-04.6.06 TC-05).
    specs,
    templates,
    prompts,
    scripts,
    phases,
    // STORY-29.2.04 AC-3 — the SECOND presentation of the same corpus, flat and serialisable.
    autopilotTrack: flattenAutopilotTrack(trackReconciliation),
    reviews: splitR.reviews,
    audits:  splitR.audits,
    monitorEntries: (monitor && monitor.entries) || [],
    pendingAction,
    blocking,
    stale,
    thisWeek,
    usage,
    signal,
    staleRunNotice,
    diagnostics,
    glossary: GLOSSARY,
    sessionFlow: SOP_SESSION_FLOW,
    commandFlow: SOP_COMMAND_PROCESS_FLOW,
    tandemPackage: buildTandemPackage(),
    // STORY-30.5.03 — the build-time facts the About page states. Carried in the
    // payload as well as baked into the section so `--about-probe` can verdict the
    // RENDERED text against the value the generator resolved, rather than against
    // itself. `tandemPackage` is read back off `this` object below rather than
    // re-scanned: two scans could disagree.
    isKitRepo,
    tandemEmptyStateHtml: buildTandemEmptyStateHtml(isKitRepo),
    knownRoutes,
  });

  // STORY-30.5.03 — resolved from the SAME tandemPackage object the Tandem tab renders,
  // so the two surfaces cannot advertise different versions of the same plugin.
  data.about = buildAboutFacts(data.tandemPackage);

  applyCrossRefResolution(data);

  // The payload's ONLY exit (STORY-33.9.05 — the old renderer and its document write are
  // retired; the assembled board is `pm:dash`/build-board.js's job now). Redaction is the
  // LAST thing that happens to the text (BUG-20260824-09 / ADR-0238) — one place to audit,
  // and the corpus-prose half, which has no producer, is covered by the same pass.
  const payloadJson = redactHostPaths(JSON.stringify(buildClientData(data)));
  fs.mkdirSync(path.dirname(payloadOut), { recursive: true });
  fs.writeFileSync(payloadOut, payloadJson);
  console.log('Wrote ' + rel(payloadOut) + ' (' + Math.round(payloadJson.length / 1024)
    + ' KB payload) in ' + (Date.now() - t0) + ' ms.');
  reportDiagnostics();
}

function reportDiagnostics() {
  if (diagnostics.unparseable.length) {
    console.warn('Diagnostics: ' + diagnostics.unparseable.length + ' unparseable file(s).');
    for (const u of diagnostics.unparseable) console.warn('  - ' + u.path + '  (' + u.reason + ')');
  }
  if (diagnostics.warnings.length) {
    for (const w of diagnostics.warnings) console.warn('Warning: ' + w.path + '  (' + w.reason + ')');
  }
}

/* ============================================================
 * Test seam (STORY-09.4.01)
 *
 * Exports `mdToHtml` and `escapeHtml` so test commands can
 * `require()` this module and call those helpers directly without
 * triggering any build side-effect.  The `require.main` guard
 * ensures `main()` — and therefore the DASHBOARD.html write — only
 * runs when the script is invoked directly (e.g. `npm run pm:dash`),
 * never when it is loaded via `require(...)` from a test.
 *
 * Rule: this is the SINGLE module.exports block for this file.
 * Downstream stories that need additional exports extend this object;
 * they MUST NOT add a second `module.exports` statement.
 * ============================================================ */
// STORY-25.3.01 — SLICE_BANDS (with BAND_REQUIRES and BAND_VOCABULARY_CLOSED)
// is exported so smoke-dashboard.js's --band-matrix-walk can compare the
// RENDERED bands against the real config object rather than against a copy
// re-typed in the harness (which would drift) or against `window.__SLICE_BANDS`
// (which the renderer itself reads, making the comparison self-referential).
//
// BAND_ORDER is exported for completeness and injected into the page, but the
// walk does NOT consume it — it reads rendered DOM order and compares against
// the per-sub-view grant. The original comment claimed otherwise; corrected as
// MINOR-2 (independent review). SUB_ALIASES is consumed, by the reached-ness
// checks.
// STORY-25.3.04 additionally exports the Phase-band pipeline —
// buildExecutionStrategy (now dir-parameterised) -> flattenPhases ->
// phaseBandEntries -> buildPhasePillsHtml — plus the shared `diagnostics` sink,
// so tests/phase-band-source.test.js can drive the SHIPPED reader over fixtures
// and read the warnings it emits, rather than asserting against a copy of it.
// STORY-25.4.01 exports buildUsageRollup so tests/usage-rollup.test.js drives the SHIPPED
// rollup over fixture ledgers (via its opts.logPath seam) rather than a re-typed copy.
// STORY-25.4.03 additionally exports computeSignal + buildPmCorpus, so
// tests/now-signal-row.test.js renders the indicator from a FIXTURE PM root (via
// PM_DASH_ROOT, in a child process, because PM_ROOT is resolved at module load) and can
// prove the value MOVES when a story changes status — driving the shipped reader rather
// than asserting against a re-implementation of it (the phase-band-source.test.js
// precedent). computeThisWeek rides along for the same reason.
module.exports = { redactHostPaths, hostPathVariants, buildReports, splitReports, reportTitle, reportDate, reportSummary, REPORT_DOC_EXTS,
  parseReviewVerdict, VERDICT_SEVERITIES,
  extractSection, cardSlotParts, CARD_SLOT_SPEC, SLOT_NOT_RECORDED, paSummariseNode, unquoteScalar, mdToHtml, escapeHtml, tokenCost, buildAiCatalogue, resolveDescription, parseFrontmatterAndBody, buildDeliverableLine, monitorLead, buildMonitorEntries, balanceInlineMarkers, mdInlineHtml, lastIndexOutsideCode, MONITOR_LEAD_CHARS, SLICE_BANDS, BAND_ORDER, BAND_REQUIRES, BAND_VOCABULARY_CLOSED, SUB_ALIASES, SORT_KEYS, SORT_DIRS, buildExecutionStrategy, flattenPhases, phaseBandEntries, diagnostics,
  // STORY-34.2.01 — the rest of the sort matrix, on the export surface for the same
  // reason SORT_KEYS already is: `lib/sort-keys.mjs` lifts it into the board's config
  // and `--sort-walk` reads it as its oracle, so a second declaration on either side
  // would make the walk compare two matrices. SORT_KEY_LABEL joins them now that the
  // freeze has reached its terminus (ADR-0271) — see ADR-0288 for why derivation could
  // not spell "Last moved" or "ID".
  SORT_KEY_LABEL, SORT_VIEWS, SORT_DEFAULTS, STATUS_URGENCY, SEVERITY_URGENCY,
  // STORY-33.9.05 — the lifted client contracts (see their declaration block): real
  // exports now that the old browser bundle, which used to carry them as source text,
  // is retired. paging.mjs, legacy-routes.mjs, slice-matrix.mjs consume these directly;
  // stream-window.mjs still lifts STREAM_DAYS/STREAM_PER_DAY by source regex.
  PAGE_SIZE, STREAM_DAYS, STREAM_PER_DAY, NO_SCOPE, LEGACY_ROUTES,
  // STORY-30.1.04 — canonical phase identity, exported so tests/phase-identity.test.js
  // drives the SHIPPED deriver over the REAL sidecar corpus instead of re-deriving the
  // rule in the test (the phase-band-source.test.js precedent).
  phaseIdentity, phaseLabelOf, PHASE_NAME_RE, buildUsageRollup, buildPmCorpus, computeSignal, computeThisWeek, IN_FLIGHT_STATUSES,
  // STORY-29.2.03/04 — the reconciliation wiring, exported so tests drive the SHIPPED
  // readers over fixtures. (The two-track SSR renderers retired with the old board —
  // STORY-33.9.05; the ported board carries its own rendering in board/src.)
  buildTrackReconciliation, flattenAutopilotTrack, readRunScopes,
  // STORY-30.1.05 — the Autopilot/Batch display grouping, exported so
  // tests/track-reconciliation.test.js can drive the SHIPPED classifier (and prove it consumes
  // the shared `run_kind` field rather than re-deriving one).
  phaseDisplayGroup, PHASE_DISPLAY_GROUPS, PHASE_GROUP_BASIS,
  // STORY-27.1.02 — the badge class injector, exported so tests/badge-markup.test.js
  // drives the SHIPPED transform from fixtures instead of asserting against a copy.
  applyBadgeClass, resolveBadgeMarkup, BUILTIN_BADGE_SVG,
  // STORY-28.3.01 — the id reader and the review-link parser THIS file uses, so the
  // propagation proof and the equivalence freeze can ask the shipped consumer what it
  // makes of a name rather than assert that an import line is still present.
  fileIdFromName, parseReviewLink,
  // STORY-27.1.03 — the sub-nav config, exported as the single source both the ported
  // board's nav and the routing tests read. (The SSR derivation/emission helpers retired
  // with the old board — STORY-33.9.05.)
  SUB_NAV_GROUPS, RAIL_GROUPS,
  // CRITICAL-3 (independent review, 2026-08-11) — the named exemption list for
  // Build sub-views that deliberately offer no slicer bands, exported so
  // tests/build-subview-filterability.test.js drives the SHIPPED rule rather
  // than a re-implementation of it.
  NON_FILTERABLE_BUILD_SUBS, buildSubViewFilterabilityProblems,
  // STORY-30.5.04 — the fit-tier vocabulary and its bucketing, exported so
  // --toolkit-tier-order-probe reads the SHIPPED tier order rather than a list re-typed in
  // the harness (which would keep checking three tiers on the day a fourth shipped), and so
  // tests/toolkit-tier-order.test.js can drive the shipped bucketer over fixtures.
  FIT_TIERS, FIT_TIER_LABELS, fitTierGroups, FIT_UNRANKED_LABEL };
  // (BROWSER_JS retired with the old board — STORY-33.9.05. Its lifted contracts are the
  // PAGE_SIZE / STREAM_* / NO_SCOPE / LEGACY_ROUTES exports above; the runtime the board
  // actually ships is board/src via assets/board-runtime.js.)

if (require.main === module) main();
