#!/usr/bin/env node
/**
 * generate-dashboard.js
 *
 * Builds a single self-contained interactive HTML dashboard at
 * _00-Project-Management/42-Monitor/DASHBOARD.html.
 *
 * Contract: PRD-PM-Dashboard.md v1.0 (Live).
 *   - Walks 10 SCAN_DIRS under _00-Project-Management/ (strategy, epics,
 *     features, stories, testplans, bugs, ADRs, backlog, releases, retros)
 *   - Scans the AI Catalogue from ~/.claude/ and project .claude/
 *     (skills, sub-agents, slash commands, installed plugins)
 *   - Merges curated overlays from _00-Project-Management/97-AI-Reference/
 *   - Emits a single HTML file: brand tokens inlined, dark mode, drawer,
 *     hash routing, group+sub tabs, diagnostics, motion, SOP session flow,
 *     glossary, three-dot brand mark.
 *
 * Node.js stdlib (fs, path, os); the CSS string lives in a local sibling module
 * ./lib/dashboard-css.js (extracted in STORY-15.3.03 so CSS and the renderer
 * arrays no longer share a source file; see ADR-0071). No third-party packages.
 * Idempotent except for the generated-at timestamp.
 *
 * Usage:
 *   node _00-Project-Management/93-Scripts/generate-dashboard.js
 *   npm run pm:dash
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

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
const OUT_FILE = path.join(PM_ROOT, '42-Monitor', 'DASHBOARD.html');
// When rendering an explicit external PM root (the Tandem demo build), skip the local ~/.claude
// scan / machine-absolute paths — they would leak the builder's username/inventory into a public dashboard.
const EXTERNAL_ROOT = !!process.env.PM_DASH_ROOT;

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

const AI_KINDS = ['skill', 'agent', 'command', 'plugin'];

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
  [/Tandem:|pm-kit|project-management/i, 'PM Kit'],
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
  ['Context-load cost (context tax)', 'An estimate of how many tokens an AI artefact (skill, sub-agent, command or plugin) costs to LOAD into the context window when it is read — the kit context tax. Shown as <code>~N tok</code> on each AI-catalogue card, summed per kind, plus a plugin total. Computed as roughly <code>chars / 4</code>; it is not a per-invocation <strong>completion cost</strong> (the dollar price a model charges to run a request) — it measures context weight, not money. See the <a href="../../documentation/context-economics.html" target="_blank" rel="noopener" title="Forward reference — authored in FEAT-11.4">context-economics doc</a> (FEAT-11.4) for the full definition.'],
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
function existsFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
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
    if (/^\[.*\]$/.test(value)) {
      const inner = value.slice(1, -1).trim();
      fm[key] = inner ? inner.split(',').map(s => unquote(s.trim())) : [];
    } else {
      fm[key] = unquote(value);
    }
  }
  return { fm, body };
}

function unquote(v) {
  if (!v) return v;
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
    return v.slice(1, -1);
  }
  return v;
}

function rel(p) {
  return path.relative(REPO_ROOT, p).replace(/\\/g, '/');
}

function fileIdFromName(filename) {
  const base = path.basename(filename, '.md');
  const m = base.match(/^(EPIC-\d+|FEAT-\d+\.\d+|STORY-\d+\.\d+\.\d+|TESTPLAN-\d+\.\d+\.\d+|BUG-\d{8}-\d+|ADR-\d+|BACKLOG-\d+|RELEASE-v\d+\.\d+(?:\.\d+)?|RETRO-\d{4}-\d{2})/);
  return m ? m[1] : null;
}

function ageDays(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

// STORY-15.2.04 — resolve the display name for this project.
// Precedence: .claude-pm-config.json `projectName` > host package.json `name`
// > repo folder basename (hyphens/underscores → spaces). Never throws.
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
  // (b) host package.json name
  try {
    const pkgPath = path.join(REPO_ROOT, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg && typeof pkg.name === 'string' && pkg.name.trim()) {
        return pkg.name.trim();
      }
    }
  } catch (_e) { /* ignore */ }
  // (c) repo folder basename humanized
  return path.basename(REPO_ROOT).replace(/[-_]+/g, ' ').trim() || 'My Project';
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

// Minimal markdown → HTML. Handles headings, paragraphs, fenced code, inline
// code, lists (ul/ol), blockquotes, tables, links, bold/italic, hr.
function mdToHtml(md) {
  if (!md) return '';
  const lines = md.split(/\r?\n/);
  let out = '';
  let inCode = false;
  let codeBuf = [];
  let codeLang = '';
  let inList = false;
  let listType = null;
  let para = [];
  let table = null;
  let blockquote = [];

  function inline(s) {
    s = escapeHtml(s);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|\s|\()_([^_\n]+)_(?=$|\s|[.,;:!?\)])/g, '$1<em>$2</em>');
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, txt, href) {
      const safeHref = /^(https?:|mailto:|#|\.\.?\/)/.test(href) ? href : '#';
      return '<a href="' + safeHref + '"' + (safeHref.startsWith('http') ? ' target="_blank" rel="noopener"' : '') + '>' + txt + '</a>';
    });
    return s;
  }
  function flushPara() {
    if (para.length) {
      out += '<p>' + inline(para.join(' ')) + '</p>\n';
      para = [];
    }
  }
  function closeList() {
    if (inList) { out += '</' + listType + '>\n'; inList = false; listType = null; }
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
  function flushBlockquote() {
    if (!blockquote.length) return;
    out += '<blockquote>' + inline(blockquote.join(' ')) + '</blockquote>\n';
    blockquote = [];
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
    const ul = line.match(/^[-*]\s+(.+)$/);
    if (ul) {
      flushPara();
      if (!inList || listType !== 'ul') { closeList(); out += '<ul>\n'; inList = true; listType = 'ul'; }
      out += '<li>' + inline(ul[1]) + '</li>\n';
      continue;
    }
    const ol = line.match(/^\d+\.\s+(.+)$/);
    if (ol) {
      flushPara();
      if (!inList || listType !== 'ol') { closeList(); out += '<ol>\n'; inList = true; listType = 'ol'; }
      out += '<li>' + inline(ol[1]) + '</li>\n';
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

/* ============================================================
 * PM Corpus
 * ============================================================ */

const diagnostics = { unparseable: [], warnings: [] };

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
        title: fm.title || '(no title)',
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
      record.cycleDays = (record.started_at && record.completed_at)
        ? Math.max(0, Math.floor((Date.parse(record.completed_at) - Date.parse(record.started_at)) / 86400000))
        : null;
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

function parseMonitor() {
  const p = path.join(PM_ROOT, '42-Monitor', 'MONITOR.md');
  const text = readFileSafe(p);
  if (!text) return { found: false, entries: [], wip: {}, lastUpdated: null };
  const entries = [];
  const re = /^\*\*(\d{4}-\d{2}-\d{2})\s*—\s*([^*]+)\*\*\s*(.*)$/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    entries.push({ date: m[1], title: m[2].trim(), summary: m[3].trim() });
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
  const fullDescription = decodeYamlEscapes((fm && fm.description) || '') || firstLine(body);
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
  const rawDesc = decodeYamlEscapes((fm && fm.description) || '');
  // Card blurb: the prose before the first <example>/Specifically marker.
  const blurb = rawDesc.split(/<example>|Specifically:/i)[0].trim();
  const description = blurb ? truncate(blurb, 220) : firstLine(body);
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
  const description = (fm && fm.description) || firstLine(body) || baseName;
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

function firstLine(s) {
  if (!s) return '';
  const t = String(s).trim().split(/\r?\n/)[0].trim();
  return t.length > 220 ? t.slice(0, 219) + '…' : t;
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
    version: manifest.version || entry.version || '',
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
function loadFitOverlays() {
  const dir = path.join(PM_ROOT, '97-AI-Reference');
  const map = new Map();
  if (!existsDir(dir)) return map; // no-overlay fallback — graceful, empty Map
  for (const f of walk(dir)) {
    const text = readFileSafe(f);
    if (!text) continue;
    const { fm, body } = parseFrontmatterAndBody(text);
    if (!fm) continue;
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
    return { name, kind, rank, rationale, installed };
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
  }
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

function buildPlanTree(pm) {
  // Group features by epic, stories by feature, testplans by story.
  const byEpic = new Map();
  for (const e of pm.epic) byEpic.set(e.id, { epic: e, features: [] });
  const orphanFeats = [];
  for (const f of pm.feature) {
    const ep = byEpic.get(f.epic);
    const node = { feature: f, stories: [] };
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
      fn.stories = (storyByFeat.get(fn.feature.id) || []).slice();
    }
  }
  // Map testplans to stories by id mirror
  const tpByStory = new Map();
  for (const tp of pm.testplan) {
    const sid = tp.id.replace(/^TESTPLAN-/, 'STORY-');
    tpByStory.set(sid, tp);
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

function buildReports() {
  // Paths relative to PM_ROOT that we scan for report artefacts.
  const sources = [
    // 1. All files directly inside 41-Reports/ (including .json, .md, .html)
    { dir: path.join(PM_ROOT, '41-Reports'),       glob: null },
    // 2. *.html only inside 20-Requirements/
    { dir: path.join(PM_ROOT, '20-Requirements'),  glob: '.html' },
    // 3. *.html only inside 42-Monitor/
    { dir: path.join(PM_ROOT, '42-Monitor'),       glob: '.html' },
  ];

  const seen = new Set();
  const reports = [];

  for (const src of sources) {
    if (!existsDir(src.dir)) continue; // degrade gracefully — dir missing → empty, no crash
    let entries;
    try { entries = fs.readdirSync(src.dir, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      // Only regular files (follow symlinks)
      if (!direntIsFile(src.dir, entry)) continue;
      const name = entry.name;
      // Apply extension filter when set
      if (src.glob && !name.endsWith(src.glob)) continue;
      const fullPath = path.join(src.dir, name);
      // De-duplicate (a file could theoretically appear in two scans)
      const relPath = rel(fullPath);
      if (seen.has(relPath)) continue;
      seen.add(relPath);

      const kind = classifyReport(name);
      // Build a sensible relative href from the generated DASHBOARD.html
      // (which lives in 42-Monitor/). STORY-04.6.05 will handle Pages resolution;
      // here we emit a relative path from the 42-Monitor/ output directory.
      const dashboardDir = path.join(PM_ROOT, '42-Monitor');
      const href = path.relative(dashboardDir, fullPath).replace(/\\/g, '/');

      reports.push({
        name,
        kind,
        href,
        file: relPath,
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

function buildExecutionStrategy() {
  const dir = path.join(PM_ROOT, '41-Reports');
  const out = { epics: [] };
  if (!existsDir(dir)) return out;
  let files;
  try { files = fs.readdirSync(dir); } catch { return out; }
  const byEpic = new Map();
  for (const name of files) {
    if (!/^EXECUTION-STRATEGY-.*\.json$/i.test(name)) continue;
    const fp = path.join(dir, name);
    const text = readFileSafe(fp);
    if (text == null) continue;
    let json;
    try { json = JSON.parse(text); }
    catch { diagnostics.warnings.push({ path: rel(fp), reason: 'malformed EXECUTION-STRATEGY JSON' }); continue; }
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
    }))
    .sort((a, b) => String(a.epic).localeCompare(String(b.epic), 'en', { numeric: true }));
  return out;
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

// Scan the Tandem build output (`dist/tt/`) for the published plugin's manifest,
// skill set, hook registry, and bundled docs. Drives the Tandem tab so the
// dashboard reflects what's actually shipped rather than the source tree.
function buildTandemPackage() {
  const distRoot = path.join(REPO_ROOT, 'dist', 'tt');
  if (!existsDir(distRoot)) return null;
  let manifest = {};
  const manifestText = readFileSafe(path.join(distRoot, '.claude-plugin', 'plugin.json'));
  if (manifestText) {
    try { manifest = JSON.parse(manifestText); } catch (e) { manifest = { name: '(unparseable)', error: String(e.message) }; }
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
      const rawDesc = decodeYamlEscapes(fm.description || '') || firstLine(parsed.body || '');
      const blurb = rawDesc.split(/<example>|Specifically:/i)[0].trim();
      skills.push({
        name: fm.name || e.name,
        description: truncate(blurb || rawDesc, 220),
        file: rel(md),
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
    for (const e of entries) {
      if (!direntIsFile(docsRoot, e)) continue;
      if (e.name.startsWith('.')) continue; // skip dotfiles (.nojekyll etc.) — not docs
      const fp = path.join(docsRoot, e.name);
      docs.push({
        name: e.name,
        href: path.relative(dashboardDir, fp).replace(/\\/g, '/'),
      });
    }
    docs.sort((a, b) => a.name.localeCompare(b.name));
  }
  return {
    manifest,
    skills,
    hooks,
    docs,
    sourceDir: rel(distRoot),
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
        out.push(Object.assign({}, it, { _type: t, _when: h.when, _why: h.why }));
      }
    }
  }
  out.sort((a, b) => String(b._when).localeCompare(String(a._when)));
  return out.slice(0, 40);
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
function parseReviewLink(name) {
  const m = name.match(/^AI-CODE-REVIEW-(STORY-\d{2}\.\d+\.\d+|FEAT-\d{2}\.\d+|EPIC-\d{2})/i);
  return m ? m[1].toUpperCase() : null;
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
  // Reviews: sort newest first (filename embeds date YYYY-MM-DD near end).
  reviews.sort((a, b) => b.name.localeCompare(a.name));
  // Audits: same — newest first.
  audits.sort((a, b) => b.name.localeCompare(a.name));
  return { reviews, audits };
}

/* ============================================================
 * CSS — brand tokens, motion, layout, dark mode (PRD §8)
 * ============================================================ */

const CSS = require('./lib/dashboard-css.js');

/* ============================================================
 * Browser JS (no template literals — string concat only, so the
 * Node template literal that wraps this stays clean).
 * ============================================================ */

const BROWSER_JS = [
'(function(){',
'"use strict";',
'var D = window.__DATA;',
'var $ = function(s, root){ return (root||document).querySelector(s); };',
'var $$ = function(s, root){ return Array.prototype.slice.call((root||document).querySelectorAll(s)); };',
'function el(tag, attrs, children){ var n=document.createElement(tag); if(attrs){ Object.keys(attrs).forEach(function(k){ if(k==="class"){ n.className = attrs[k]; } else if(k==="html"){ n.innerHTML = attrs[k]; } else if(k.indexOf("on")===0 && typeof attrs[k]==="function"){ n.addEventListener(k.slice(2), attrs[k]); } else if(k==="dataset"){ Object.keys(attrs[k]).forEach(function(dk){ n.dataset[dk]=attrs[dk][dk] || attrs[k][dk]; }); } else { n.setAttribute(k, attrs[k]); } }); } if(children){ (Array.isArray(children)?children:[children]).forEach(function(c){ if(c==null) return; if(typeof c==="string") n.appendChild(document.createTextNode(c)); else n.appendChild(c); }); } return n; }',
'function escHtml(s){ if(s==null) return ""; return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/\'/g,"&#39;"); }',
// STORY-19.2.02 — name-INDEPENDENT detection of the PM kit\'s own plugin. A plugin is "the kit"
// when its bundled skill set carries the kit\'s signature lifecycle skills (core + execute-story),
// regardless of whether it is installed as "Tandem" or under a dev marketplace name. Never match on
// the plugin NAME: a name regex that widened to the dev name would re-leak it into consumer HTML
// (rejected fix; TESTPLAN-16.4.02 TC-02 / BUG-20260607-01). Reads the data shape built server-side
// at the plugin object\'s `bundles.skills` ({name, description}).
'function isPmKitPlugin(p){',
'  var sk = (p && p.bundles && p.bundles.skills) || [];',
'  var has = function(n){ return sk.some(function(s){ return (s && (s.name || s)) === n; }); };',
'  return has("core") && has("execute-story");',
'}',
'function pill(status){ status = status || "not-started"; return \'<span class="pill" data-status="\' + escHtml(status) + \'">\' + escHtml(status) + \'</span>\'; }',
'function sev(s){ if(!s) return ""; return \'<span class="sev \' + escHtml(s) + \'">\' + escHtml(s) + \'</span>\'; }',
'function statusOrderIdx(s){ var arr=["in-progress","in-review","ready","blocked","active","not-started","done","wontfix","duplicate","archived"]; var i=arr.indexOf(s); return i===-1?999:i; }',

// ------------ Routing & state ------------
'var STATE = { group:"now", sub:null, search:{}, statusFilter:{}, aiCatFilter:{}, aiCostSort:{}, aiCostFilter:{}, implEpic:null, palette:false, cmdFlowView:{ sop:"e2e", tandem:"e2e" } };',

// Command process flow — view filters. e2e shows every command; the other
// three views surface only the commands relevant to that kind of session.
// session-start + core always show (every session starts with them).
'var CMD_FLOW_VIEWS = [',
'  ["e2e",      "End-to-end"],',
'  ["planning", "Planning"],',
'  ["dev",      "Development"],',
'  ["cadence",  "Cadence"],',
'];',
'var CMD_FLOW_VIEW_MEMBERS = {',
'  planning: ["session-start","core","draft-okrs","draft-prd","draft-epic","split-into-features","split-into-stories","critique","fill-claude-md","refine-backlog","execution-strategist","weekly-monitor"],',
'  dev:      ["session-start","core","start-phase","execute-batch","execute-story","run-testplan","peer-review","close-out-story","close-phase"],',
'  cadence:  ["session-start","core","critique","peer-review","fill-claude-md","weekly-monitor","monthly-retro","reflect","document","curate-toolkit"],',
'};',
'function readHash(){ var h=location.hash.replace(/^#/,""); var out={}; h.split("&").forEach(function(p){ if(!p) return; var kv=p.split("="); out[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]||""); }); return out; }',
'function writeHash(){ var parts=[]; if(STATE.group) parts.push("group="+encodeURIComponent(STATE.group)); if(STATE.sub) parts.push("sub="+encodeURIComponent(STATE.sub)); var nh = parts.join("&"); if(("#"+nh) !== location.hash){ history.replaceState(null, "", "#"+nh); } }',

// ------------ Theme ------------
'function getTheme(){ try { var t = localStorage.getItem("dxz-theme"); if(t) return t; } catch(e){} return (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light"; }',
'function applyTheme(t){ document.documentElement.setAttribute("data-theme", t); try { localStorage.setItem("dxz-theme", t); } catch(e){} var btn=$("#theme-toggle"); if(btn){ btn.setAttribute("aria-label", "Switch to " + (t==="dark"?"light":"dark") + " theme"); btn.dataset.theme = t; } }',
'applyTheme(getTheme());',

// ------------ Tabs ------------
// v1.1 — 8-group IA (ADR-0048, TESTPLAN-04.6.06 TC-02).
'var SUB_TABS = {',
'  now: [],',
'  capture: [["inbox","Inbox"],["backlog","Backlog"]],',
'  plan: [["strategy","Strategy"],["roadmap","Roadmap"],["specs","Specs"]],',
'  build: [["phases","Phases"],["epic","Epics"],["feature","Features"],["story","Stories"],["testplan","Testplans"],["bug","Bugs"]],',
'  cadence: [["monitor","Monitor"],["retros","Retros"],["releases","Releases"],["reviews","Reviews"],["audits","Audits"]],',
'  decisions: [],',
'  toolkit: [["skill","Skills"],["agent","Agents"],["command","Commands"],["plugin","Plugins"],["templates","Templates"],["prompts","Prompts"],["scripts","Scripts"],["glossary","Glossary"]],',
'  tandem: [],',
'  about: []',
'};',

// v1.1 — backwards-compat: redirect v1.0 hash routes to their v1.1 home.
// PRD §5.1.2 + TESTPLAN-04.6.06 TC-06. Keys can be "group" or "group:sub".
'var LEGACY_ROUTES = {',
'  "overview": "now",',
'  "impl": "build:phases",',
'  "strategy": "plan:strategy",',
'  "plan": "plan:roadmap",',
'  "work:epic": "build:epic",',
'  "work:feature": "build:feature",',
'  "work:story": "build:story",',
'  "work:testplan": "build:testplan",',
'  "work:bug": "build:bug",',
'  "decisions:adr": "decisions",',
'  "decisions:backlog": "capture:backlog",',
'  "decisions:release": "cadence:releases",',
'  "decisions:retro": "cadence:retros",',
'  "ai:skill": "toolkit:skill",',
'  "ai:agent": "toolkit:agent",',
'  "ai:command": "toolkit:command",',
'  "ai:plugin": "toolkit:plugin",',
'  "ai:glossary": "toolkit:glossary",',
'  "reports": "cadence:audits",',
'  "docs": "toolkit:prompts"',
'};',
'function applyLegacy(group, sub){ var k = sub ? group+":"+sub : group; if(LEGACY_ROUTES[k]){ var v = LEGACY_ROUTES[k].split(":"); return { group:v[0], sub:v[1]||null }; } if(LEGACY_ROUTES[group] && !sub){ var w = LEGACY_ROUTES[group].split(":"); return { group:w[0], sub:w[1]||null }; } return { group:group, sub:sub }; }',

'function renderGroupNav(){',
'  var nav=$("#group-nav"); if(!nav) return;',
'  nav.innerHTML="";',
// v1.1 — 8-group order: now → capture → plan → build → cadence → decisions → toolkit → about
// (TESTPLAN-04.6.06 TC-01).
'  var groups=[["now","Now"],["capture","Capture"],["plan","Plan"],["build","Build"],["cadence","Cadence"],["decisions","Decisions"],["toolkit","AI Catalogue"],["tandem","Tandem"],["about","About"]];',
'  groups.forEach(function(g){',
'    var count="";',
'    if(g[0]==="now") count = ((D.pendingAction||[]).length) + ((D.blocking||[]).length);',
'    else if(g[0]==="capture") count = ((D.inbox||[]).length) + ((D.backlog||[]).length);',
'    else if(g[0]==="plan") count = ((D.counts.epic||{total:0}).total) + ((D.specs||[]).length);',
'    else if(g[0]==="build") count = (D.phases ? D.phases.length : 0) + (D.counts.epic||{total:0}).total + (D.counts.feature||{total:0}).total + (D.counts.story||{total:0}).total + (D.counts.testplan||{total:0}).total + (D.counts.bug||{total:0}).total;',
'    else if(g[0]==="cadence") count = ((D.monitorEntries||[]).length) + ((D.counts.retro||{total:0}).total) + ((D.counts.release||{total:0}).total) + ((D.reviews||[]).length) + ((D.audits||[]).length);',
'    else if(g[0]==="decisions") count = (D.counts.adr||{total:0}).total;',
'    else if(g[0]==="toolkit") count = D.ai.counts.skills + D.ai.counts.agents + D.ai.counts.commands + D.ai.counts.plugins + ((D.templates||[]).length) + ((D.prompts||[]).length) + ((D.scripts||[]).length);',
'    var btn = el("button", { class:"gtab" + (STATE.group===g[0]?" active":""), "data-group":g[0], onclick: function(){ setGroup(g[0]); } });',
'    btn.innerHTML = escHtml(g[1]) + (count!==""? \' <span class="gtab-count">\' + count + \'</span>\' : "");',
'    nav.appendChild(btn);',
'  });',
'}',

'function renderSubNav(){',
'  var nav=$("#sub-nav-inner"); var holder=$("#sub-nav"); if(!nav) return;',
'  nav.innerHTML="";',
'  var subs = SUB_TABS[STATE.group] || [];',
'  if(!subs.length){ holder.classList.add("hidden"); return; } else { holder.classList.remove("hidden"); }',
'  subs.forEach(function(s){',
'    var cnt = "";',
// v1.1 — count logic per group (ADR-0048).
'    var k = s[0]; var g = STATE.group;',
'    if(g==="build"){',
'      if(k==="phases") cnt = (D.phases||[]).length;',
'      else cnt = (D.counts[k]||{total:0}).total;',
'    } else if(g==="capture"){',
'      if(k==="inbox") cnt = (D.inbox||[]).length;',
'      else if(k==="backlog") cnt = (D.counts.backlog||{total:0}).total;',
'    } else if(g==="plan"){',
'      if(k==="strategy") cnt = (D.counts.strategy||{total:0}).total;',
'      else if(k==="roadmap") cnt = (D.counts.epic||{total:0}).total;',
'      else if(k==="specs") cnt = (D.specs||[]).length;',
'    } else if(g==="cadence"){',
'      if(k==="monitor") cnt = (D.monitorEntries||[]).length;',
'      else if(k==="retros") cnt = (D.counts.retro||{total:0}).total;',
'      else if(k==="releases") cnt = (D.counts.release||{total:0}).total;',
'      else if(k==="reviews") cnt = (D.reviews||[]).length;',
'      else if(k==="audits") cnt = (D.audits||[]).length;',
'    } else if(g==="toolkit"){',
'      if(k==="glossary") cnt = D.glossary.length;',
'      else if(k==="templates") cnt = (D.templates||[]).length;',
'      else if(k==="prompts") cnt = (D.prompts||[]).length;',
'      else if(k==="scripts") cnt = (D.scripts||[]).length;',
'      else cnt = (D.ai.counts[k+"s"]||0);',
'    }',
'    var btn = el("button", { class:"stab" + (STATE.sub===s[0]?" active":""), "data-sub":s[0], onclick: function(){ setSub(s[0]); } });',
'    btn.innerHTML = escHtml(s[1]) + (cnt!==""? \' <span class="stab-count">\' + cnt + \'</span>\' : "");',
'    nav.appendChild(btn);',
'  });',
'}',

'function setGroup(g, opts){ opts=opts||{}; STATE.group=g; var subs=SUB_TABS[g]||[]; STATE.sub = subs.length ? (opts.sub && subs.some(function(x){return x[0]===opts.sub;}) ? opts.sub : subs[0][0]) : null; renderGroupNav(); renderSubNav(); renderActive(); writeHash(); window.scrollTo({top:0, behavior:"instant"}); }',
'function setSub(s){ STATE.sub=s; renderSubNav(); renderActive(); writeHash(); }',

// ------------ Render dispatch ------------
'function renderActive(){',
'  $$(".tab-section").forEach(function(s){ s.classList.remove("active"); });',
'  var key = STATE.group + (STATE.sub ? ":" + STATE.sub : "");',
'  var sec = document.getElementById("sec-" + key);',
'  if(!sec){ sec = document.getElementById("sec-" + STATE.group); }',
'  if(!sec) return;',
'  sec.classList.add("active");',
'  var renderer = RENDERERS[key] || RENDERERS[STATE.group];',
'  if(renderer) renderer(sec);',
'  reveal(sec);',
'}',

'function reveal(root){ if(!root) return; $$(".reveal", root).forEach(function(e){ e.classList.add("visible"); }); }',

// ------------ Renderers ------------
// viewIntro: emits the reusable descriptive intro block shown at the top of each primary view.
// title  — plain text label for the view (escaped internally).
// source — pre-escaped HTML string naming the data source (may contain <code> for path citations).
// why    — pre-escaped HTML string explaining why this view matters to the reader.
'// source/why are TRUSTED HTML; escape any dynamic data at the call-site, not here.',
'function viewIntro(title, source, why){',
'  return \'<div class="view-intro"><div class="vi-title">\' + escHtml(title) + \'</div><div class="vi-source">\' + source + \'</div><div class="vi-why">\' + why + \'</div></div>\';',
'}',

'var RENDERERS = {};',

// Overview
'RENDERERS.overview = function(root){',
'  var inProgStories = (D.story||[]).filter(function(s){return s.status==="in-progress";});',
'  var blockedStories = (D.story||[]).filter(function(s){return s.status==="blocked";});',
'  var inProgFeats = (D.feature||[]).filter(function(f){return f.status==="in-progress";});',
'  var blockedFeats = (D.feature||[]).filter(function(f){return f.status==="blocked";});',
'  var storyDone = (D.story||[]).filter(function(s){return s.status==="done";}).length;',
'  var storyTotal = (D.story||[]).length;',
'  var pct = storyTotal? Math.round(100*storyDone/storyTotal) : 0;',
'  var wip = (D.monitor && D.monitor.wip) || {};',
'  function metric(val, lab, sub){ return \'<div class="metric reveal"><div class="metric-val">\'+val+\'</div><div class="metric-lab">\'+escHtml(lab)+\'</div>\'+(sub?\'<div class="metric-sub">\'+sub+\'</div>\':\'\')+\'</div>\'; }',
'  var hero = \'<div class="overview-hero">\'',
'    + metric((D.counts.epic||{total:0}).total, "Epics", inProgFeats.length + " in-progress")',
'    + metric((D.counts.feature||{total:0}).total, "Features", (D.counts.feature&&D.counts.feature.byStatus&&D.counts.feature.byStatus["done"]||0) + " done")',
'    + metric(storyTotal, "Stories", storyDone + " done · " + pct + "%")',
'    + metric((D.counts.bug||{total:0}).total, "Bugs", (D.counts.bug&&D.counts.bug.byStatus&&(D.counts.bug.byStatus["not-started"]||0)+(D.counts.bug.byStatus["in-progress"]||0))||0 + " open")',
'    + metric((D.counts.adr||{total:0}).total, "ADRs")',
'    + metric((D.counts.backlog||{total:0}).total, "Backlog")',
'    + metric((D.counts.release||{total:0}).total, "Releases")',
'  + \'</div>\';',
'  // Progress bar',
'  var progress = \'<div class="panel reveal" style="margin-bottom:1rem;"><h3>Story progress</h3><div class="progress\' + (pct<50?\' danger\':\'\') + \'"><span style="width:\' + pct + \'%"></span></div><div class="metric-sub">\' + storyDone + \' / \' + storyTotal + \' done · \' + pct + \'%</div></div>\';',
'  // WIP line',
'  var wipHtml = \'<div class="panel reveal"><h3>WIP — Work in progress</h3><dl class="kv">\'',
'    + \'<dt>in-progress</dt><dd>\' + ((wip["in-progress"]||{}).current ?? inProgStories.length) + \' / \' + ((wip["in-progress"]||{}).limit ?? 2) + \'</dd>\'',
'    + \'<dt>in-review</dt><dd>\' + ((wip["in-review"]||{}).current ?? ((D.story||[]).filter(function(s){return s.status==="in-review";}).length)) + \' / \' + ((wip["in-review"]||{}).limit ?? 3) + \'</dd>\'',
'    + \'<dt>blocked</dt><dd>\' + ((wip["blocked"]||{}).current ?? blockedStories.length) + \' / \' + ((wip["blocked"]||{}).limit ?? 5) + \'</dd>\'',
'  + \'</dl></div>\';',
'  // In-progress / blocked lists — shared tile model (STORY-09.4.03: rows→tiles migration; STORY-13.1.01: helper renamed off the legacy `rowsHtml` name; ADR-0032)',
'  function tileListHtml(list, emptyMsg){ if(!list.length) return \'<div class="empty">\' + emptyMsg + \'</div>\'; return \'<div class="tile-grid">\' + list.map(function(r){ return \'<div class="tile reveal" data-type="\' + r.type + \'" data-id="\' + escHtml(r.id) + \'"><div class="tile-head"><span class="tile-id">\' + escHtml(r.id) + \'</span><span class="tile-extra">\' + pill(r.status) + \'</span></div><div class="tile-title">\' + escHtml(r.title) + \'</div></div>\'; }).join("") + \'</div>\'; }',
'  var col1 = \'<div class="panel reveal"><h3>In-progress <span class="count-bubble">\' + (inProgStories.length+inProgFeats.length) + \'</span></h3>\' + tileListHtml(inProgStories.concat(inProgFeats), "No stories are in flight right now. Pull a \\\'ready\\\' story with <code>/Tandem:execute-story</code> or open a phase via <code>/start-phase</code> to begin work.") + \'</div>\';',
'  var col2 = \'<div class="panel reveal"><h3>Blocked <span class="count-bubble">\' + (blockedStories.length+blockedFeats.length) + \'</span></h3>\' + tileListHtml(blockedStories.concat(blockedFeats), "No blocked stories — the team isn\\\'t waiting on any external decisions or dependencies right now. Blockers appear here automatically when a story flips to <code>status: blocked</code>.") + \'</div>\';',
'  // Latest monitor entry',
'  var monEntries = (D.monitor && D.monitor.entries) || [];',
'  var latest = monEntries.length ? \'<div class="panel reveal"><h3>Latest from MONITOR</h3><dl class="kv"><dt>\' + escHtml(monEntries[0].date) + \'</dt><dd>\' + escHtml(monEntries[0].title) + \'</dd></dl><p style="margin-top:0.6rem; color:var(--ink-2); font-size:0.86rem; line-height:1.6;">\' + escHtml(monEntries[0].summary) + \'</p></div>\' : \'\';',
'  // Latest ADRs',
'  var adrs = (D.adr||[]).slice().sort(function(a,b){ return String(b.id).localeCompare(String(a.id), "en", { numeric:true }); }).slice(0,3);',
'  var adrHtml = \'<div class="panel reveal"><h3>Recent decisions</h3>\' + (adrs.length ? \'<div class="tile-grid">\' + adrs.map(function(a){ return \'<div class="tile reveal" data-type="adr" data-id="\' + escHtml(a.id) + \'"><div class="tile-head"><span class="tile-id">\' + escHtml(a.id) + \'</span><span class="tile-extra">\' + pill(a.status) + \'</span></div><div class="tile-title">\' + escHtml(a.title) + \'</div></div>\'; }).join("") + \'</div>\' : \'<div class="empty">No ADRs yet.</div>\') + \'</div>\';',
'  var intro = \'<div class="view-intro"><div class="vi-title">Overview</div><div class="vi-source">Reads <code>42-Monitor/MONITOR.md</code> and the latest artefacts from every scan folder.</div><div class="vi-why">Helps you see what is open, what is stale, and what shipped this week without opening individual files.</div></div>\';',
'  root.innerHTML = intro + hero + progress + \'<div class="overview-panels">\' + col1 + col2 + \'</div>\' + (latest ? \'<div style="margin-top:1rem;">\' + latest + \'</div>\' : "") + \'<div style="margin-top:1rem;">\' + adrHtml + \'</div>\';',
'  bindRows(root);',
'};',

// Strategy
'RENDERERS.strategy = function(root){',
'  var list = D.strategy || [];',
'  if(!list.length){ root.innerHTML = \'<div class="panel"><h3>Strategy</h3><div class="empty">No <code>00-Strategy/</code> directory yet. Create it to track OKRs, North Star, customer journey, risk register.</div></div>\'; return; }',
'  var search = (STATE.search.strategy||"").toLowerCase();',
'  var filtered = list.filter(function(s){ return !search || (s.id+s.title+s.status+(s.bodyHtml||"")).toLowerCase().indexOf(search)!==-1; });',
'  var controls = \'<div class="controls reveal"><input class="search" type="search" placeholder="Search strategy…" value="\' + escHtml(STATE.search.strategy||"") + \'" data-scope="strategy"></div>\';',
'  var rows = filtered.length ? \'<div class="tile-grid stagger">\' + filtered.map(function(s){ return \'<div class="tile reveal" data-type="strategy" data-id="\' + escHtml(s.id) + \'"><div class="tile-head"><span class="tile-id">\' + escHtml(s.id) + \'</span><span class="tile-extra">\' + pill(s.status) + \'</span></div><div class="tile-title">\' + escHtml(s.title) + \'</div></div>\'; }).join("") + \'</div>\' : \'<div class="empty">No matches.</div>\';',
'  var intro = \'<div class="view-intro"><div class="vi-title">Strategy</div><div class="vi-source">Reads <code>00-Strategy/</code> files and the strategic-linkage fields on epics.</div><div class="vi-why">Lets you trace any tactical item back to the business outcome it serves — OKRs, North Star and customer journey all live here.</div></div>\';',
'  root.innerHTML = intro + controls + rows;',
'  bindControls(root); bindRows(root);',
'};',

// Implementation Strategy (FEAT-03.3) — render the execution-strategist JSON sidecars
'function implShortId(id){ return String(id).replace(/^STORY-/, ""); }',
'function implLaneStr(lanes){ if(!lanes||!lanes.length) return "—"; return lanes.map(function(l){ var ss=(l.stories||[]).map(implShortId); return (l.type==="serial") ? "serial (" + ss.join(" → ") + ")" : ss.length + " parallel (" + ss.join(", ") + ")"; }).join(" · "); }',
// Execution-strategy JSON sidecars are frozen snapshots — their `executed`
// and `ready` flags lag reality when work ships outside the pasted-trigger
// flow. We reconcile against live D.story status so chats whose stories are
// now `done` count as effectively executed even if nobody clicked the badge.
'function liveStoryStatusMap(){',
'  var m = {};',
'  (D.story||[]).forEach(function(s){ if(s.id) m[s.id] = s.status || ""; });',
'  return m;',
'}',
'function isChatLiveDone(c, statusMap){',
'  var ids = (c.stories||[]).map(function(s){ return s.id; });',
'  if(!ids.length) return false;',
'  return ids.every(function(id){ return statusMap[id] === "done"; });',
'}',
'function chatEffectiveExecuted(c, statusMap){',
'  return !!c.executed || isChatLiveDone(c, statusMap);',
'}',
// Pick the "live" epic for default selection: the first epic (in catalogue
// order) that still has at least one effectively-unexecuted chat. Falls back
// to the last epic when every chat is effectively done.
'function pickActiveImplEpic(es){',
'  var sm = liveStoryStatusMap();',
'  for(var i = 0; i < es.length; i++){',
'    var pending = (es[i].phases||[]).some(function(p){',
'      return (p.chats||[]).some(function(c){ return !chatEffectiveExecuted(c, sm); });',
'    });',
'    if(pending) return es[i].epic;',
'  }',
'  return es[es.length - 1].epic;',
'}',
'RENDERERS.impl = function(root){',
'  var es = (D.executionStrategy && D.executionStrategy.epics) || [];',
'  if(!es.length){ root.innerHTML = \'<div class="panel"><h3>Implementation Strategy</h3><div class="empty">No execution strategy yet. Run <code>/Tandem:execution-strategist EPIC-NN</code> — it writes <code>41-Reports/EXECUTION-STRATEGY-*.json</code>, which this view renders.</div></div>\'; return; }',
'  if(!STATE.implEpic || !es.some(function(e){return e.epic===STATE.implEpic;})) STATE.implEpic = pickActiveImplEpic(es);',
'  var sel = es.filter(function(e){return e.epic===STATE.implEpic;})[0] || es[0];',
'  var statusMap = liveStoryStatusMap();',
'  var selector = es.length>1 ? \'<div class="controls reveal"><span class="filter-label">Epic</span>\' + es.map(function(e){ return \'<span class="pill filterable\' + (e.epic===STATE.implEpic?"":" off") + \'" data-impl-epic="\' + escHtml(e.epic) + \'">\' + escHtml(e.epic) + \'</span>\'; }).join("") + \'</div>\' : "";',
'  var allChats = (sel.phases||[]).reduce(function(n,p){ return n + (p.chats||[]).length; }, 0);',
'  var manualExec  = (sel.phases||[]).reduce(function(n,p){ return n + (p.chats||[]).filter(function(c){return !!c.executed;}).length; }, 0);',
'  var execChats   = (sel.phases||[]).reduce(function(n,p){ return n + (p.chats||[]).filter(function(c){return chatEffectiveExecuted(c, statusMap);}).length; }, 0);',
'  var derivedExec = execChats - manualExec;',
'  var execMeta    = execChats + " executed" + (derivedExec > 0 ? " (" + derivedExec + " via live story status)" : "");',
'  var head = \'<div class="impl-head reveal"><h2 class="impl-epic-title">\' + escHtml(sel.epic) + \' · Implementation Strategy</h2><div class="impl-meta">\' + (sel.phases||[]).length + \' phase(s) · \' + allChats + \' chat(s) · \' + execMeta + \' · generated \' + escHtml(String(sel.generated_at||"").slice(0,10)) + \'</div>\' + (sel.note ? \'<div class="impl-note">\' + escHtml(sel.note) + \'</div>\' : "") + \'</div>\';',
'  var body = (sel.phases||[]).map(function(p, pi){',
'    var cards = (p.chats||[]).map(function(c){',
'      var manualExec = !!c.executed;',
'      var liveDone   = isChatLiveDone(c, statusMap);',
'      var exec       = manualExec || liveDone;',
'      var storiesHtml = (c.stories||[]).map(function(s){',
'        var live = statusMap[s.id];',
'        var done    = (live === "done");',
'        var blocked = (live === "blocked");',
'        var stale   = !done && !blocked && s.ready === false;',
'        var cls   = blocked ? " blocked" : (stale ? " unready" : (done ? " done" : ""));',
'        var glyph = done ? " ✓" : (blocked ? " 🔴" : (stale ? " ⚠" : ""));',
'        var ttl   = escHtml(s.id) + " (live: " + escHtml(live || "unknown") + (s.status && s.status !== live ? "; snapshot: " + escHtml(s.status) : "") + ")";',
'        return \'<span class="impl-story\' + cls + \'" title="\' + ttl + \'">\' + escHtml(implShortId(s.id)) + glyph + \'</span>\';',
'      }).join("");',
'      var subs = (c.sub_agents||[]).map(function(a){ return \'<span class="impl-agent">\' + escHtml(a) + \'</span>\'; }).join("") || "—";',
'      var deps = (c.depends_on||[]).join(", ") || "—";',
'      var unlocks = (c.unlocks||[]).join(", ") || "—";',
'      var badgeText = manualExec ? "✓ AUTO-EXECUTED" : (liveDone ? "✓ STORIES COMPLETE" : "MARK EXECUTED");',
'      var badgeCls  = manualExec ? "exec" : (liveDone ? "exec exec-derived" : "pend");',
'      return \'<div class="tile chat-card \' + (exec?"executed":"pending") + \' reveal" data-type="impl" data-id="\' + escHtml(c.id||"") + \'">\'',
'        + \'<div class="chat-head"><span class="chat-id">\' + escHtml(c.id||"") + \'</span><span class="chat-est">\' + escHtml(c.estimate||"") + \'</span><span class="chat-badge \' + badgeCls + \'">\' + badgeText + \'</span></div>\'',
'        + \'<div class="chat-title">\' + escHtml(c.title||"") + \'</div>\'',
'        + (c.outcome ? \'<div class="chat-outcome"><span class="lab">What you\\\'ll have</span> \' + escHtml(c.outcome) + \'</div>\' : "")',
'        + \'<div class="chat-stories">\' + storiesHtml + \'</div>\'',
'        + \'<div class="chat-line"><span class="lab">Lanes</span> \' + escHtml(implLaneStr(c.lanes)) + \'</div>\'',
'        + \'<div class="chat-line"><span class="lab">Sub-agents</span> \' + subs + \'</div>\'',
'        + (c.trigger ? \'<div class="chat-block"><div class="lab">Paste this trigger</div><pre>\' + escHtml(c.trigger) + \'</pre></div>\' : "")',
'        + (c.verify ? \'<div class="chat-block"><details><summary class="lab">Verify before closing</summary><pre>\' + escHtml(c.verify) + \'</pre></details></div>\' : "")',
'        + \'<div class="chat-edges"><span class="lab">Depends on</span> \' + escHtml(deps) + \' · <span class="lab">Unlocks</span> \' + escHtml(unlocks) + \'</div>\'',
'        + \'</div>\';',
'    }).join("");',
'    return \'<div class="impl-phase reveal"><h3 class="impl-phase-title">Phase \' + (pi+1) + \' · \' + escHtml((p.name||"").replace(/^\\s*Phase\\s*\\d+\\s*·\\s*/i,"")) + \'</h3>\' + (p.outcome ? \'<p class="impl-phase-sub">\' + escHtml(p.outcome) + \'</p>\' : "") + \'<div class="tile-grid impl-tiles">\' + cards + \'</div></div>\';',
'  }).join("");',
'  var intro = \'<div class="view-intro"><div class="vi-title">Implementation</div><div class="vi-source">Reads <code>41-Reports/EXECUTION-STRATEGY-*.json</code> sidecars generated by the execution-strategist skill.</div><div class="vi-why">Use this to pull the next ready chat into a fresh execute-batch session — it shows which chats are done, which are pending, and what each one depends on.</div></div>\';',
'  root.innerHTML = intro + selector + head + body;',
'  $$("[data-impl-epic]", root).forEach(function(p){ p.addEventListener("click", function(){ STATE.implEpic = p.dataset.implEpic; renderActive(); }); });',
'  bindRows(root);',
'};',
// STORY-04.5.04: alias so TC-02 grep anchors on RENDERERS.implementation near tile-grid.
'RENDERERS.implementation = RENDERERS.impl;',

// Plan
'RENDERERS.plan = function(root){',
'  var byEpic = (D.plan && D.plan.byEpic) || [];',
'  if(!byEpic.length){ root.innerHTML = \'<div class="panel"><h3>Plan</h3><div class="empty">No epics planned yet. Run <code>/Tandem:draft-prd</code> then split it into epics under <code>30-Epics/</code> to populate this view.</div></div>\'; return; }',
'  var toolbar = \'<div class="plan-toolbar reveal"><button data-action="expand-all">Expand all</button><button data-action="collapse-all">Collapse all</button></div>\';',
'  var html = byEpic.map(function(ep){',
'    var e = ep.epic;',
'    var feats = ep.features || [];',
'    var totalFeats = feats.length;',
'    var TERM_DONE = ["done","wontfix","duplicate","archived"];',
'    function deriveStatus(ss, fallback){ if(!ss||!ss.length) return fallback; if(ss.every(function(s){ return TERM_DONE.indexOf(s.status)!==-1; })) return "done"; if(ss.some(function(s){ return s.status==="in-progress"||s.status==="in-review"||s.status==="done"; })) return "in-progress"; return "not-started"; }',
'    function featStatus(fn){ return deriveStatus(fn.stories||[], fn.feature.status); }',
'    var epicStories = feats.reduce(function(a,fn){ return a.concat(fn.stories||[]); }, []);',
'    var doneFeats = feats.filter(function(fn){ return featStatus(fn)==="done"; }).length;',
'    var pct = totalFeats ? Math.round(100*doneFeats/totalFeats) : 0;',
'    var badges = \'\';',
'    if(e.okr) badges += \'<span class="tag" title="OKR: \' + escHtml(e.okr) + \'">🎯 \' + escHtml(e.okr) + \'</span>\';',
'    if(e.prd_section) badges += \'<span class="tag" title="PRD: \' + escHtml(e.prd_section) + \'">📋 \' + escHtml(e.prd_section) + \'</span>\';',
'    var featsHtml = feats.map(function(fn){',
'      var f = fn.feature;',
'      var stories = fn.stories || [];',
'      var storiesHtml = stories.length ? \'<div class="tile-grid plan-stories">\' + stories.map(function(s){',
'        var tp = (D.plan && D.plan.tpByStory && D.plan.tpByStory[s.id]) || null;',
'        return \'<div class="tile" data-type="story" data-id="\' + escHtml(s.id) + \'"><div class="tile-head"><span class="tile-id">\' + escHtml(s.id) + \'</span><span class="tile-extra">\' + (tp ? \'<span class="tp-link">\' + escHtml(tp.id) + \'</span>\' : \'\') + pill(s.status) + \'</span></div><div class="tile-title">\' + escHtml(s.title) + \'</div></div>\';',
'      }).join("") + \'</div>\' : \'<div class="empty">No stories yet.</div>\';',
'      return \'<div class="feat-card" data-feat="\' + escHtml(f.id) + \'"><div class="feat-head"><span class="disclose">▸</span><span class="feat-id">\' + escHtml(f.id) + \'</span><span class="feat-title">\' + escHtml(f.title) + \'</span>\' + pill(featStatus(fn)) + \'</div><div class="feat-body">\' + storiesHtml + \'</div></div>\';',
'    }).join("") || \'<div class="empty">No features yet.</div>\';',
'    return \'<div class="epic-card reveal" data-epic="\' + escHtml(e.id) + \'"><div class="epic-head"><span class="disclose">▸</span><span class="epic-id">\' + escHtml(e.id) + \'</span><span class="epic-title">\' + escHtml(e.title) + \'</span><span class="epic-progress"><span class="progress"><span style="width:\' + pct + \'%"></span></span><span class="ratio">\' + doneFeats + \' / \' + totalFeats + \'</span></span><span class="epic-badges">\' + badges + pill(deriveStatus(epicStories, e.status)) + \'</span></div><div class="epic-body">\' + featsHtml + \'</div></div>\';',
'  }).join("");',
'  var intro = \'<div class="view-intro"><div class="vi-title">Plan</div><div class="vi-source">Derived from every story file under <code>32-Stories/</code>, grouped by epic and feature.</div><div class="vi-why">Matters because it is the single board showing what is planned, what is in flight, and what is done at every level of the hierarchy.</div></div>\';',
'  root.innerHTML = intro + toolbar + html;',
'  // Wire toolbar',
'  $$("[data-action=\\"expand-all\\"]", root).forEach(function(b){ b.addEventListener("click", function(){ $$(".epic-card, .feat-card", root).forEach(function(c){ c.classList.add("open"); }); }); });',
'  $$("[data-action=\\"collapse-all\\"]", root).forEach(function(b){ b.addEventListener("click", function(){ $$(".epic-card, .feat-card", root).forEach(function(c){ c.classList.remove("open"); }); }); });',
'  // Wire heads',
'  $$(".epic-card", root).forEach(function(card){',
'    var head = $(".epic-head", card);',
'    head.addEventListener("click", function(e){ if(e.shiftKey || e.detail===2){ openDrawer("epic", card.dataset.epic); } else { card.classList.toggle("open"); } });',
'  });',
'  $$(".feat-card", root).forEach(function(card){',
'    var head = $(".feat-head", card);',
'    head.addEventListener("click", function(e){ if(e.shiftKey){ openDrawer("feature", card.dataset.feat); } else { card.classList.toggle("open"); } });',
'  });',
'  bindRows(root);',
'};',

// Generic Work renderer factory
'function workRenderer(typeKey){',
'  return function(root){',
'    var list = D[typeKey] || [];',
'    var scope = "work:" + typeKey;',
'    var search = (STATE.search[scope]||"").toLowerCase();',
'    var statusOff = STATE.statusFilter[scope] || {};',
'    var statuses = Object.keys(((D.counts[typeKey]||{}).byStatus)||{});',
'    statuses.sort(function(a,b){ return statusOrderIdx(a)-statusOrderIdx(b); });',
'    var pillsHtml = statuses.map(function(s){ var off = statusOff[s]; return \'<span class="pill filterable\' + (off?\' off\':\'\') + \'" data-status="\' + escHtml(s) + \'" data-filter="status" aria-pressed="\' + (off?"false":"true") + \'">\' + escHtml(s) + \'</span>\'; }).join("");',
'    var filtered = list.filter(function(r){',
'      if(statusOff[r.status]) return false;',
'      if(!search) return true;',
'      var blob = (r.id+" "+r.title+" "+r.status+" "+(r.epic||"")+" "+(r.feature||"")+" "+(r.severity||"")+" "+(r.bodyHtml||"")).toLowerCase();',
'      return blob.indexOf(search)!==-1;',
'    });',
'    var controls = \'<div class="controls reveal"><input class="search" type="search" placeholder="Search \' + escHtml(typeKey) + \'…" value="\' + escHtml(STATE.search[scope]||"") + \'" data-scope="\' + scope + \'"><div class="filter-group">\' + (pillsHtml ? \'<span class="filter-label">Status</span>\' + pillsHtml : "") + \'</div></div>\';',
'    function extraFor(r){',
'      var ex = [];',
'      if(typeKey==="bug" && r.severity) ex.push(sev(r.severity));',
'      if(typeKey==="testplan") ex.push(\'<span class="tag">\' + escHtml(r.id.replace(/^TESTPLAN-/, "STORY-")) + \'</span>\');',
'      ex.push(pill(r.status));',
'      return ex.join("");',
'    }',
'    function tileHtml(r){',
'      var metaBits = [];',
'      if(typeKey==="feature" && r.epic) metaBits.push(escHtml(r.epic));',
'      if(typeKey==="story" && r.feature) metaBits.push(escHtml(r.feature));',
'      if(typeKey==="testplan" && r.story) metaBits.push(escHtml(r.story));',
'      var metaStr = metaBits.length ? \'<span class="meta">\' + metaBits.join(" · ") + \'</span>\' : "";',
'      return \'<div class="tile reveal" data-type="\' + typeKey + \'" data-id="\' + escHtml(r.id) + \'"><div class="tile-head"><span class="tile-id">\' + escHtml(r.id) + \'</span><span class="tile-extra">\' + extraFor(r) + \'</span></div><div class="tile-title">\' + escHtml(r.title) + metaStr + \'</div></div>\';',
'    }',
'    // STORY-04.6.01: group the Work view into its natural hierarchy so each item is reachable by drilling',
'    // Epic → Feature → Story → (Testplan/Bug) instead of scanning one flat list. Each group keeps the shared',
'    // tile model (data-type/data-id + .tile binding), so bindRows still opens the drawer for every tile.',
'    // Feature tiles are grouped by their Epic (featuresByEpic); Story tiles by Epic→Feature (storiesByFeature);',
'    // Testplan tiles mirror their Story grouping (testplansByStory); Bug tiles nest under their owning Story',
'    // (bugsByStory) with an "Unassigned" bucket for orphan bugs whose story cannot be resolved.',
'    var UNASSIGNED = "\\u0000unassigned";',
'    function groupWorkByHierarchy(rows){',
'      // Returns an ordered list of { key, crumbs:[{label,kind}], items:[] } groups for the hierarchical',
'      // Work types. crumbs render the Epic→Feature→Story breadcrumb path above each tile-grid.',
'      var order = [];',
'      var byKey = {};',
'      function bucket(key, crumbs){ if(!byKey[key]){ byKey[key] = { key:key, crumbs:crumbs, items:[] }; order.push(byKey[key]); } return byKey[key]; }',
'      rows.forEach(function(r){',
'        var key, crumbs;',
'        if(typeKey==="feature"){',
'          // group feature under epic',
'          var ep = r.epic || UNASSIGNED;',
'          key = ep;',
'          crumbs = ep===UNASSIGNED ? [{label:"Unassigned", kind:"unassigned"}] : [{label:ep, kind:"epic"}];',
'        } else if(typeKey==="story"){',
'          // group story by epic then feature',
'          var sEp = r.epic || UNASSIGNED, sFe = r.feature || UNASSIGNED;',
'          key = sEp + "|" + sFe;',
'          crumbs = [];',
'          crumbs.push(sEp===UNASSIGNED ? {label:"Unassigned", kind:"unassigned"} : {label:sEp, kind:"epic"});',
'          if(sFe!==UNASSIGNED) crumbs.push({label:sFe, kind:"feature"});',
'        } else if(typeKey==="testplan"){',
'          // testplan mirrors its story: group by epic then feature then story',
'          var tEp = r.epic || UNASSIGNED, tFe = r.feature || UNASSIGNED, tSt = r.story || r.id.replace(/^TESTPLAN-/, "STORY-") || UNASSIGNED;',
'          key = tEp + "|" + tFe + "|" + tSt;',
'          crumbs = [];',
'          crumbs.push(tEp===UNASSIGNED ? {label:"Unassigned", kind:"unassigned"} : {label:tEp, kind:"epic"});',
'          if(tFe!==UNASSIGNED) crumbs.push({label:tFe, kind:"feature"});',
'          if(tSt && tSt!==UNASSIGNED) crumbs.push({label:tSt, kind:"story"});',
'        } else {',
'          // typeKey==="bug": nest bug under its owning story (epic→feature→story→bug)',
'          var bSt = r.story && /^STORY-/.test(r.story) ? r.story : null;',
'          if(bSt){',
'            var bEp = r.epic || UNASSIGNED, bFe = r.feature || UNASSIGNED;',
'            key = bEp + "|" + bFe + "|" + bSt;',
'            crumbs = [];',
'            crumbs.push(bEp===UNASSIGNED ? {label:"Unassigned", kind:"unassigned"} : {label:bEp, kind:"epic"});',
'            if(bFe!==UNASSIGNED) crumbs.push({label:bFe, kind:"feature"});',
'            crumbs.push({label:bSt, kind:"story"});',
'          } else {',
'            // orphan bug with no resolvable story still renders, under the Unassigned bucket',
'            key = UNASSIGNED;',
'            crumbs = [{label:"Unassigned", kind:"unassigned"}];',
'          }',
'        }',
'        bucket(key, crumbs).items.push(r);',
'      });',
'      // keep Unassigned bucket last; otherwise preserve first-seen (already status-sorted) order',
'      order.sort(function(a,b){ var au=a.key===UNASSIGNED?1:0, bu=b.key===UNASSIGNED?1:0; return au-bu; });',
'      return order;',
'    }',
'    function crumbsHtml(crumbs){ return crumbs.map(function(c){ return \'<span class="crumb crumb-\' + c.kind + \'">\' + escHtml(c.label) + \'</span>\'; }).join(\'<span class="crumb-sep">\\u203a</span>\'); }',
'    var HIERARCHICAL = (typeKey==="feature"||typeKey==="story"||typeKey==="testplan"||typeKey==="bug");',
'    var rowsHtml;',
'    if(!filtered.length){',
'      rowsHtml = \'<div class="empty">No \' + escHtml(typeKey) + \'s match.</div>\';',
'    } else if(HIERARCHICAL){',
'      rowsHtml = groupWorkByHierarchy(filtered).map(function(grp){',
'        var grid = \'<div class="tile-grid stagger">\' + grp.items.map(tileHtml).join("") + \'</div>\';',
'        return \'<div class="work-group reveal"><div class="group-head"><span class="group-path">\' + crumbsHtml(grp.crumbs) + \'</span><span class="group-count">\' + grp.items.length + \'</span></div>\' + grid + \'</div>\';',
'      }).join("");',
'    } else {',
'      rowsHtml = \'<div class="tile-grid stagger">\' + filtered.map(tileHtml).join("") + \'</div>\';',
'    }',
'    var intro = \'<div class="view-intro"><div class="vi-title">Work</div><div class="vi-source">Searchable index of artefacts under <code>30-Epics/</code>, <code>31-Features/</code>, <code>32-Stories/</code>, <code>33-Testplans/</code> and <code>34-Bugs/</code>.</div><div class="vi-why">Helps you find any single artefact by id, title, status, or freeform text across the full work hierarchy.</div></div>\';',
'    root.innerHTML = intro + controls + rowsHtml;',
'    bindControls(root); bindRows(root);',
'  };',
'}',
'RENDERERS["work:epic"] = workRenderer("epic");',
'RENDERERS["work:feature"] = workRenderer("feature");',
'RENDERERS["work:story"] = workRenderer("story");',
'RENDERERS["work:testplan"] = workRenderer("testplan");',
'RENDERERS["work:bug"] = workRenderer("bug");',

// Decisions sub-view renderers (STORY-04.6.02)
// ADR status order — accepted/superseded buckets first, unknown last.
'var ADR_STATUS_ORDER = ["accepted","active","proposed","draft","in-review","superseded","deprecated","rejected","obsolete"];',
// Backlog priority order — P0 most urgent, unknown pushed last.
'var BACKLOG_PRIORITY_ORDER = ["P0","P1","P2","P3","P4"];',

// groupAdrsBy: groups ADR records by adr_status (falling back to status),
// newest-first within each group. Items missing a sort key (no date, unknown
// status) are pushed to the end with a stable tiebreak on id.
'function groupAdrsBy(list){',
'  var byStatus = {};',
'  var statusSeq = [];',
'  list.forEach(function(r){',
'    var s = (r.adr_status || r.status || "unknown").toLowerCase().trim();',
'    if(!byStatus[s]){ byStatus[s] = []; statusSeq.push(s); }',
'    byStatus[s].push(r);',
'  });',
'  // Sort each bucket newest-first (created_at desc); items without a date',
'  // are pushed to the end, then tiebroken by id (deterministic stable sort).',
'  function dateSortKey(r){ var d = r.created_at||""; return d ? d : ""; }',
'  Object.keys(byStatus).forEach(function(s){',
'    byStatus[s].sort(function(a,b){',
'      var da = dateSortKey(a), db = dateSortKey(b);',
'      if(!da && !db) return String(a.id).localeCompare(String(b.id), "en", {numeric:true});',
'      if(!da) return 1; if(!db) return -1;',
'      if(db > da) return 1; if(da > db) return -1;',
'      return String(a.id).localeCompare(String(b.id), "en", {numeric:true});',
'    });',
'  });',
'  // Sort status buckets by ADR_STATUS_ORDER; unknown statuses go last, alpha.',
'  statusSeq.sort(function(a,b){',
'    var ia = ADR_STATUS_ORDER.indexOf(a), ib = ADR_STATUS_ORDER.indexOf(b);',
'    if(ia===-1 && ib===-1) return a.localeCompare(b);',
'    if(ia===-1) return 1; if(ib===-1) return -1;',
'    return ia - ib;',
'  });',
'  return statusSeq.map(function(s){ return { key:s, items: byStatus[s] }; });',
'}',

// groupBacklogByPriority: groups backlog items by priority.
// Items missing a priority land in an "Unset" bucket at the end,
// tiebroken by id for deterministic ordering.
'function groupBacklogByPriority(list){',
'  var byPri = {};',
'  var priSeq = [];',
'  list.forEach(function(r){',
'    var p = (r.priority || "Unset").toString().trim();',
'    if(!byPri[p]){ byPri[p] = []; priSeq.push(p); }',
'    byPri[p].push(r);',
'  });',
'  // Within each bucket, sort by id (deterministic).',
'  Object.keys(byPri).forEach(function(p){',
'    byPri[p].sort(function(a,b){ return String(a.id).localeCompare(String(b.id), "en", {numeric:true}); });',
'  });',
'  // Sort by BACKLOG_PRIORITY_ORDER; unknown / Unset pushed to end, alpha.',
'  priSeq.sort(function(a,b){',
'    var ia = BACKLOG_PRIORITY_ORDER.indexOf(a), ib = BACKLOG_PRIORITY_ORDER.indexOf(b);',
'    if(ia===-1 && ib===-1) return a.localeCompare(b);',
'    if(ia===-1) return 1; if(ib===-1) return -1;',
'    return ia - ib;',
'  });',
'  return priSeq.map(function(p){ return { key:p, items: byPri[p] }; });',
'}',

// sortByDateDesc: sorts releases/retros reverse-chronologically (newest first).
// Uses version or created_at. Items missing a date are pushed to the end,
// then tiebroken by id for deterministic, crash-free ordering.
'function sortByDateDesc(list){',
'  var reverseChrono = list.slice().sort(function(a,b){',
'    var da = a.created_at||a.version||"", db = b.created_at||b.version||"";',
'    if(!da && !db) return String(a.id).localeCompare(String(b.id), "en", {numeric:true});',
'    if(!da) return 1; if(!db) return -1;',
'    if(db > da) return 1; if(da > db) return -1;',
'    return String(a.id).localeCompare(String(b.id), "en", {numeric:true});',
'  });',
'  return reverseChrono;',
'}',

// decisionsRenderer: wraps workRenderer but applies ADR-0033 grouping on top.
// For ADR: groups by adr_status (groupAdrsBy), newest-first within each status.
// For Backlog: groups by priority (groupBacklogByPriority).
// For Release/Retro: lists reverse-chronologically (sortByDateDesc).
// All other behaviour (search, status filters, tile/drawer model) is unchanged.
'function decisionsRenderer(typeKey){',
'  return function(root){',
'    var list = D[typeKey] || [];',
'    var scope = "decisions:" + typeKey;',
'    var search = (STATE.search[scope]||"").toLowerCase();',
'    var statusOff = STATE.statusFilter[scope] || {};',
'    var statuses = Object.keys(((D.counts[typeKey]||{}).byStatus)||{});',
'    statuses.sort(function(a,b){ return statusOrderIdx(a)-statusOrderIdx(b); });',
'    var pillsHtml = statuses.map(function(s){ var off = statusOff[s]; return \'<span class="pill filterable\' + (off?\' off\':\'\') + \'" data-status="\' + escHtml(s) + \'" data-filter="status" aria-pressed="\' + (off?"false":"true") + \'">\' + escHtml(s) + \'</span>\'; }).join("");',
'    var filtered = list.filter(function(r){',
'      if(statusOff[r.status]) return false;',
'      if(!search) return true;',
'      var blob = (r.id+" "+r.title+" "+r.status+" "+(r.adr_status||"")+" "+(r.priority||"")+" "+(r.version||"")+" "+(r.bodyHtml||"")).toLowerCase();',
'      return blob.indexOf(search)!==-1;',
'    });',
'    var controls = \'<div class="controls reveal"><input class="search" type="search" placeholder="Search \' + escHtml(typeKey) + \'…" value="\' + escHtml(STATE.search[scope]||"") + \'" data-scope="\' + scope + \'"><div class="filter-group">\' + (pillsHtml ? \'<span class="filter-label">Status</span>\' + pillsHtml : "") + \'</div></div>\';',
'    function tileHtml(r){',
'      var extra = [];',
'      if(typeKey==="adr" && r.adr_status) extra.push(\'<span class="tag">\' + escHtml(r.adr_status) + \'</span>\');',
'      if(typeKey==="backlog" && r.priority) extra.push(\'<span class="tag">\' + escHtml(r.priority) + \'</span>\');',
'      extra.push(\'<span class="pill" data-status="\' + escHtml(r.status) + \'">\' + escHtml(r.status) + \'</span>\');',
'      var metaBits = [];',
'      if((typeKey==="release"||typeKey==="retro") && (r.created_at||r.version)) metaBits.push(escHtml((r.created_at||r.version||"").slice(0,10)));',
'      if(typeKey==="adr" && r.created_at) metaBits.push(escHtml(r.created_at.slice(0,10)));',
'      var metaStr = metaBits.length ? \'<span class="meta">\' + metaBits.join(" · ") + \'</span>\' : "";',
'      return \'<div class="tile reveal" data-type="\' + typeKey + \'" data-id="\' + escHtml(r.id) + \'"><div class="tile-head"><span class="tile-id">\' + escHtml(r.id) + \'</span><span class="tile-extra">\' + extra.join("") + \'</span></div><div class="tile-title">\' + escHtml(r.title) + metaStr + \'</div></div>\';',
'    }',
'    var rowsHtml;',
'    if(!filtered.length){',
'      if(typeKey==="retro"){',
'        rowsHtml = \'<div class="empty">No retros yet — run /Tandem:weekly-monitor at end of month to generate one.</div>\';',
'      } else if(typeKey==="release"){',
'        rowsHtml = \'<div class="empty">No releases yet — see CHANGELOG.md or run /Tandem:monthly-retro to create one.</div>\';',
'      } else {',
'        rowsHtml = \'<div class="empty">No \' + escHtml(typeKey) + \'s match.</div>\';',
'      }',
'    } else if(typeKey==="adr"){',
'      // Group ADRs by adr_status, newest-first within each status group.',
'      var adrsByStatus = groupAdrsBy(filtered);',
'      rowsHtml = adrsByStatus.map(function(grp){',
'        return \'<div class="work-group reveal"><div class="group-head"><span class="group-path">\' + escHtml(grp.key) + \'</span><span class="group-count">\' + grp.items.length + \'</span></div><div class="tile-grid stagger">\' + grp.items.map(tileHtml).join("") + \'</div></div>\';',
'      }).join("");',
'    } else if(typeKey==="backlog"){',
'      // Group backlog items by priority (groupBacklogByPriority).',
'      var backlogByPriority = groupBacklogByPriority(filtered);',
'      rowsHtml = backlogByPriority.map(function(grp){',
'        return \'<div class="work-group reveal"><div class="group-head"><span class="group-path">\' + escHtml(grp.key) + \'</span><span class="group-count">\' + grp.items.length + \'</span></div><div class="tile-grid stagger">\' + grp.items.map(tileHtml).join("") + \'</div></div>\';',
'      }).join("");',
'    } else {',
'      // Release and Retro: sortByDateDesc (reverse-chronological, newest first).',
'      var sorted = sortByDateDesc(filtered);',
'      rowsHtml = \'<div class="tile-grid stagger">\' + sorted.map(tileHtml).join("") + \'</div>\';',
'    }',
'    var intro = \'<div class="view-intro"><div class="vi-title">Decisions</div><div class="vi-source">Reads <code>40-Decisions/ADR-*.md</code> and the cadence folders: <code>11-Backlog/</code>, <code>13-Releases/</code> and <code>14-Retros/</code>.</div><div class="vi-why">Matters because it is where the rationale behind a load-bearing choice lives, separate from the code that implements it.</div></div>\';',
'    root.innerHTML = intro + controls + rowsHtml;',
'    bindControls(root); bindRows(root);',
'  };',
'}',
'RENDERERS["decisions:adr"]     = decisionsRenderer("adr");',
'RENDERERS["decisions:backlog"]  = decisionsRenderer("backlog");',
'RENDERERS["decisions:release"]  = decisionsRenderer("release");',
'RENDERERS["decisions:retro"]    = decisionsRenderer("retro");',

// AI Catalogue renderers
'function fitBadgeHtml(rank){',
'  if(!rank) return "";',
'  return \'<span class="fit-badge \' + escHtml(rank) + \'">\' + escHtml(rank) + \'</span>\';',
'}',
'function aiCardHtml(it, kindKey){',
'  var badges = "";',
'  if(it.fitRank) badges += fitBadgeHtml(it.fitRank);',
'  if(it.curated) badges += \'<span class="tag star">★ curated</span>\';',
'  if(it.mustKnow) badges += \'<span class="tag must">must-know</span>\';',
'  if(it.source) badges += \'<span class="tag source">\' + escHtml(it.source) + \'</span>\';',
'  if(it.category) badges += \'<span class="tag">\' + escHtml(it.category) + \'</span>\';',
'  // STORY-11.1.04 / ADR-0046: prefer a curated overlay description, fall back to the item own description (all 4 kinds).',
'  var desc = (it.overlay && it.overlay.description) || it.description || "";',
'  // STORY-11.1.04 / ADR-0047: the successor element renders ONLY for command-kind cards that carry a pointer.',
'  var nextHtml = "";',
"  if(kindKey === 'command' && it.nextCommand){ nextHtml = '<div class=\"ai-next\">Next: <code>' + escHtml(it.nextCommand) + '</code></div>'; }",
'  // STORY-11.3.02 — per-item context-load cost. READS the precomputed it.tokenCost value (set once',
'  // in buildAiCatalogue); it never recomputes the cost at render time. Neutral numeric label here;',
'  // STORY-11.3.03 adds the human "context-load cost / context tax" wording + glossary cross-link.',
'  var cost = (typeof it.tokenCost === "number") ? it.tokenCost : 0;',
'  var costHtml = \'<span class="tag ai-cost" data-cost="\' + cost + \'" title="Context-load token cost (estimate)">~\' + cost + \' tok</span>\';',
'  return \'<div class="ai-card reveal\' + (it.curated?" curated":"") + \'" data-type="ai-\' + kindKey + \'" data-name="\' + escHtml(it.name) + \'" data-cost="\' + cost + \'"><div class="name">\' + escHtml(it.name) + \'</div><div class="desc">\' + escHtml(desc) + \'</div>\' + nextHtml + \'<div class="footer">\' + costHtml + badges + \'</div></div>\';',
'}',
// recommendedVsOther partition (ADR-0033): split filtered items into
// "Recommended for this project" (fitRank HIGH or MED) vs "Other" (LOW or no overlay).
// Items with no overlay always render in Other — never dropped (graceful fallback).
'function recommendedVsOther(filtered){',
'  var recommended = filtered.filter(function(it){ return it.fitRank==="HIGH" || it.fitRank==="MED"; });',
'  var other = filtered.filter(function(it){ return it.fitRank!=="HIGH" && it.fitRank!=="MED"; });',
'  return { recommended: recommended, other: other };',
'}',
'function aiCatRenderer(kindKey, listKey){',
'  return function(root){',
'    var ai = D.ai || {};',
'    var list = (D.ai && D.ai[listKey]) || [];',
'    var scope = "ai:" + kindKey;',
'    var search = (STATE.search[scope]||"").toLowerCase();',
'    var activeCat = STATE.aiCatFilter[scope] || null;',
'    var costSort = STATE.aiCostSort[scope];',
'    var costMin = STATE.aiCostFilter[scope] || 0;',
'    var cats = {};',
'    list.forEach(function(it){ var c = it.category || "Other"; cats[c] = (cats[c]||0)+1; });',
'    var catKeys = Object.keys(cats).sort(function(a,b){ if(a==="Other") return 1; if(b==="Other") return -1; return a.localeCompare(b); });',
'    var pillsHtml = catKeys.map(function(c){ var act = (activeCat===c); return \'<span class="tag cat exclusive\' + (act?\' active\':\'\') + \'" data-cat="\' + escHtml(c) + \'">\' + escHtml(c) + \' <span class="count-bubble" style="opacity:0.7;">\' + cats[c] + \'</span></span>\'; }).join("");',
'    var filtered = list.filter(function(it){',
'      if(activeCat && (it.category||"Other") !== activeCat) return false;',
'      // STORY-11.3.02 — cost filter composes WITH search + category (does not replace them).',
'      if(costMin && (it.tokenCost||0) < costMin) return false;',
'      if(!search) return true;',
'      var blob = (it.name+" "+(it.description||"")+" "+(it.category||"")+" "+(it.body||"")).toLowerCase();',
'      return blob.indexOf(search)!==-1;',
'    });',
'    // STORY-11.3.02 — cost sort (asc/desc), applied after filtering and before the Recommended/Other',
'    // partition so the cost ordering carries through both groups; sorts on the precomputed it.tokenCost.',
'    if(costSort==="asc"){ filtered.sort(function(a,b){ return (a.tokenCost||0)-(b.tokenCost||0); }); }',
'    else if(costSort==="desc"){ filtered.sort(function(a,b){ return (b.tokenCost||0)-(a.tokenCost||0); }); }',
'    var controls = \'<div class="controls reveal"><input class="search" type="search" placeholder="Search \' + escHtml(kindKey) + \'s…" value="\' + escHtml(STATE.search[scope]||"") + \'" data-scope="\' + scope + \'"></div>\';',
'    var catBar = \'<div class="controls reveal" style="background:transparent; border:none; padding:0.25rem 0;"><span class="filter-label">Category (single-select)</span>\' + pillsHtml + \'</div>\';',
'    // STORY-11.3.02 — context-load cost rollup header + cost sort + cost filter controls.',
'    var kindTotal = (ai.costByKind && ai.costByKind[listKey]) || 0;',
'    var pluginTot = (ai.pluginTotal!=null) ? ai.pluginTotal : 0;',
'    var catTotal  = (ai.totalCost!=null) ? ai.totalCost : 0;',
'    var costBar = \'<div class="controls reveal cost-controls" style="background:transparent; border:none; padding:0.25rem 0; gap:0.55rem; flex-wrap:wrap;">\' +',
'      \'<span class="filter-label">Context-load cost <span class="cost-legend" style="font-weight:400; color:var(--ink-2);">(the context tax — how much an item costs to LOAD; it is not a per-invocation completion ($) cost · <a href="../../documentation/context-economics.html" target="_blank" rel="noopener" title="Forward reference — authored in FEAT-11.4">what is this?</a>)</span></span>\' +',
'      \'<span class="cost-rollup">this \' + escHtml(kindKey) + \': <b>~\' + kindTotal + \' tok</b>\' + (listKey==="plugins" ? "" : \' · plugin total <b>~\' + pluginTot + \' tok</b>\') + \' · catalogue <b>~\' + catTotal + \' tok</b></span>\' +',
'      \'<span class="tag cost-sort\' + (costSort==="asc"?" active":"") + \'" data-cost-sort="asc" title="Sort by cost, ascending">cost ↑</span>\' +',
'      \'<span class="tag cost-sort\' + (costSort==="desc"?" active":"") + \'" data-cost-sort="desc" title="Sort by cost, descending">cost ↓</span>\' +',
'      \'<label class="cost-filter-label" style="font-size:0.78rem; color:var(--ink-2);">min cost <input class="cost-filter" type="number" min="0" step="50" value="\' + costMin + \'" style="width:5.5rem;"></label>\' +',
'    \'</div>\';',
// Partition into Recommended vs Other (ADR-0033 render-time grouping over existing fields).
'    var groups = recommendedVsOther(filtered);',
'    function groupSection(label, items){',
'      if(!items.length) return "";',
'      return \'<div class="ai-fit-group">\' +',
'        \'<div class="ai-fit-group-head">\' +',
'          \'<span class="ai-fit-group-label">\' + escHtml(label) + \'</span>\' +',
'          \'<span class="ai-fit-group-count">\' + items.length + \'</span>\' +',
'        \'</div>\' +',
'        \'<div class="card-grid tight stagger">\' + items.map(function(it){ return aiCardHtml(it, kindKey); }).join("") + \'</div>\' +',
'      \'</div>\';',
'    }',
'    var grid;',
'    if(!filtered.length){',
'      grid = \'<div class="empty">No \' + escHtml(kindKey) + \'s match.</div>\';',
'    } else if(groups.recommended.length === 0){',
// No overlays present (the common/demo case) — everything renders in "Other" without badges.
'      grid = groupSection("Other", groups.other);',
'    } else {',
'      grid = groupSection("Recommended for this project", groups.recommended) +',
'             groupSection("Other", groups.other);',
'    }',
// Tandem command process flow — shown above the plugin grid
// when this is the Toolkit → Plugin tab AND the kit is present in the catalogue.
'    var cmdFlowHtml = "";',
'    if(kindKey === "plugin" && (list||[]).some(isPmKitPlugin)){',
'      cmdFlowHtml = renderCommandFlow({ scope:"sop" });',
'    }',
'    var intro = \'<div class="view-intro"><div class="vi-title">AI Catalogue</div><div class="vi-source">Scans <code>~/.claude/</code> and the workspace <code>.claude/</code> folder for skill, sub-agent, slash command and plugin definitions.</div><div class="vi-why">Lets you see what is installed and what each item does without leaving the dashboard.</div></div>\';',
'    root.innerHTML = intro + cmdFlowHtml + controls + catBar + costBar + grid;',
'    bindControls(root);',
'    $$(".tag.cat.exclusive", root).forEach(function(p){',
'      p.addEventListener("click", function(){',
'        var c = p.dataset.cat;',
'        STATE.aiCatFilter[scope] = (STATE.aiCatFilter[scope]===c) ? null : c;',
'        renderActive();',
'      });',
'    });',
'    // STORY-11.3.02 — wire the cost sort pills + the cost filter (compose with category + search).',
'    // No __bound guard here: root.innerHTML is rewritten on every renderActive(), so these elements',
'    // are freshly created each render and must be re-bound each time (unlike bindControls targets).',
'    $$(".cost-sort", root).forEach(function(b){',
'      b.addEventListener("click", function(){',
'        var v = b.dataset.costSort;',
'        STATE.aiCostSort[scope] = (STATE.aiCostSort[scope]===v) ? null : v;',
'        renderActive();',
'      });',
'    });',
'    var cfEl = root.querySelector(".cost-filter");',
'    if(cfEl){ cfEl.addEventListener("change", function(){ STATE.aiCostFilter[scope] = Math.max(0, parseInt(cfEl.value,10)||0); renderActive(); }); }',
'    $$(".ai-card", root).forEach(function(c){ c.addEventListener("click", function(){ openDrawer("ai-" + kindKey, c.dataset.name); }); });',
'    $$(".cmd-pill[data-cmd-skill]", root).forEach(function(b){ b.addEventListener("click", function(ev){ ev.stopPropagation(); openDrawer("ai-skill", b.dataset.cmdSkill); }); });',
'    bindCmdFlowTabs(root);',
'  };',
'}',
'RENDERERS["ai:skill"]   = aiCatRenderer("skill",   "skills");',
'RENDERERS["ai:agent"]   = aiCatRenderer("agent",   "agents");',
'RENDERERS["ai:command"] = aiCatRenderer("command", "commands");',
'RENDERERS["ai:plugin"]  = aiCatRenderer("plugin",  "plugins");',

'RENDERERS["ai:glossary"] = function(root){',
'  var search = (STATE.search["ai:glossary"]||"").toLowerCase();',
'  var entries = D.glossary.filter(function(e){ if(!search) return true; return (e[0]+e[1]).toLowerCase().indexOf(search)!==-1; });',
'  var controls = \'<div class="controls reveal"><input class="search" type="search" placeholder="Search glossary…" value="\' + escHtml(STATE.search["ai:glossary"]||"") + \'" data-scope="ai:glossary"></div>\';',
'  var html = entries.length ? \'<div class="card-grid stagger">\' + entries.map(function(e){ return \'<div class="card reveal"><div class="metric-lab">\' + escHtml(e[0]) + \'</div><div style="margin-top:0.45rem; font-size:0.88rem; color:var(--ink-2); line-height:1.6;">\' + e[1] + \'</div></div>\'; }).join("") + \'</div>\' : \'<div class="empty">No matches.</div>\';',
'  root.innerHTML = controls + html;',
'  bindControls(root);',
'};',

// Reports view (STORY-04.6.04) — sub-grouped by kind; each tile is a new-tab link.
'RENDERERS.reports = function(root){',
'  var list = D.reports || [];',
'  var search = (STATE.search["reports"]||"").toLowerCase();',
'  var filtered = list.filter(function(r){',
'    if(!search) return true;',
'    return (r.name+" "+r.kind+" "+r.file).toLowerCase().indexOf(search)!==-1;',
'  });',
'  var controls = \'<div class="controls reveal"><input class="search" type="search" placeholder="Search reports…" value="\' + escHtml(STATE.search["reports"]||"") + \'" data-scope="reports"></div>\';',
'  if(!filtered.length){',
'    var emptyMsg = list.length===0',
'      ? \'<div class="empty">No report artefacts found. Place files in <code>41-Reports/</code>, <code>20-Requirements/*.html</code>, or <code>42-Monitor/*.html</code>.</div>\'',
'      : \'<div class="empty">No reports match.</div>\';',
'    root.innerHTML = controls + emptyMsg;',
'    bindControls(root);',
'    return;',
'  }',
'  // Group by kind in canonical order',
'  var KIND_ORDER = ["Explorations","Code Reviews","Execution Strategies","Boards","Other"];',
'  var byKind = {};',
'  KIND_ORDER.forEach(function(k){ byKind[k] = []; });',
'  filtered.forEach(function(r){',
'    var k = KIND_ORDER.indexOf(r.kind)!==-1 ? r.kind : "Other";',
'    byKind[k].push(r);',
'  });',
'  var html = "";',
'  KIND_ORDER.forEach(function(k){',
'    var items = byKind[k];',
'    if(!items.length) return;',
'    var tiles = items.map(function(r){',
'      var ext = r.name.indexOf(".")!==-1 ? r.name.slice(r.name.lastIndexOf(".")+1).toUpperCase() : "";',
'      return \'<a class="report-tile reveal" href="\' + escHtml(r.href) + \'" target="_blank" rel="noopener noreferrer">\'',
'        + \'<div class="report-name">\' + escHtml(r.name) + \'</div>\'',
'        + (ext ? \'<div class="report-ext">\' + escHtml(ext) + \'</div>\' : "")',
'        + \'<div class="report-open">Open ↗</div>\'',
'        + \'</a>\';',
'    }).join("");',
'    html += \'<div class="report-kind-group reveal">\'',
'      + \'<div class="report-kind-head"><span class="report-kind-label">\' + escHtml(k) + \'</span><span class="report-kind-count">\' + items.length + \'</span></div>\'',
'      + \'<div class="tile-grid">\' + tiles + \'</div>\'',
'      + \'</div>\';',
'  });',
'  var intro = \'<div class="view-intro"><div class="vi-title">Reports</div><div class="vi-source">Reads generated artefacts under <code>41-Reports/</code>, <code>20-Requirements/*.html</code> and <code>42-Monitor/*.html</code>.</div><div class="vi-why">Helps you find a specific audit, code review or execution strategy without browsing the folder by hand.</div></div>\';',
'  root.innerHTML = intro + controls + html;',
'  bindControls(root);',
'};',

// Docs view (STORY-04.6.05) — FEAT-04.4 documentation/ HTML; each tile is a new-tab link.
'RENDERERS.docs = function(root){',
'  var list = D.docs || [];',
'  var search = (STATE.search["docs"]||"").toLowerCase();',
'  var filtered = list.filter(function(r){',
'    if(!search) return true;',
'    return (r.name+" "+r.file).toLowerCase().indexOf(search)!==-1;',
'  });',
'  var controls = \'<div class="controls reveal"><input class="search" type="search" placeholder="Search docs…" value="\' + escHtml(STATE.search["docs"]||"") + \'" data-scope="docs"></div>\';',
'  if(!filtered.length){',
'    var emptyMsg = list.length===0',
'      ? \'<div class="empty">No documentation found. Generate it with <code>npm run pm:docs</code> — it renders <code>documentation/*.md</code> into <code>documentation/*.html</code>.</div>\'',
'      : \'<div class="empty">No docs match.</div>\';',
'    root.innerHTML = controls + emptyMsg;',
'    bindControls(root);',
'    return;',
'  }',
'  var tiles = filtered.map(function(r){',
'    var ext = r.name.indexOf(".")!==-1 ? r.name.slice(r.name.lastIndexOf(".")+1).toUpperCase() : "";',
'    return \'<a class="report-tile reveal" href="\' + escHtml(r.href) + \'" target="_blank" rel="noopener noreferrer">\'',
'      + \'<div class="report-name">\' + escHtml(r.name) + \'</div>\'',
'      + (ext ? \'<div class="report-ext">\' + escHtml(ext) + \'</div>\' : "")',
'      + \'<div class="report-open">Open ↗</div>\'',
'      + \'</a>\';',
'  }).join("");',
'  var html = \'<div class="report-kind-group reveal">\'',
'    + \'<div class="report-kind-head"><span class="report-kind-label">Documentation</span><span class="report-kind-count">\' + filtered.length + \'</span></div>\'',
'    + \'<div class="tile-grid">\' + tiles + \'</div>\'',
'    + \'</div>\';',
'  var intro = \'<div class="view-intro"><div class="vi-title">Docs</div><div class="vi-source">Reads documentation files from <code>20-Requirements/</code>, <code>90-Standards/</code> and other docs folders the project ships.</div><div class="vi-why">Use this when you need a written contract — the SOP, a DoR/DoD definition, or a PRD — without leaving the board.</div></div>\';',
'  root.innerHTML = intro + controls + html;',
'  bindControls(root);',
'};',

// About
'RENDERERS.about = function(root){',
'  var d = D.generatedAt || "—";',
'  var counts = D.counts || {};',
'  var ai = D.ai || {};',
'  function entry(k, v){ return \'<dt>\' + escHtml(k) + \'</dt><dd>\' + v + \'</dd>\'; }',
'  var pmKv = Object.keys(counts).map(function(k){ return entry(k, counts[k].total); }).join("");',
'  var aiKv = entry("skills", ai.counts.skills) + entry("agents", ai.counts.agents) + entry("commands", ai.counts.commands) + entry("plugins", ai.counts.plugins);',
'  var overlays = ai.overlayCounts ? Object.keys(ai.overlayCounts).map(function(k){ return entry(k, ai.overlayCounts[k]); }).join("") : "";',
'  root.innerHTML = ',
'    \'<div class="about-grid">\' +',
'    \'<div class="panel reveal"><h3>About Tandem Command Center</h3><p>Single self-contained HTML file generated by <code>generate-dashboard.js</code>. The markdown under <code>_00-Project-Management/</code> is the source of truth — edit there. Re-run with <span class="kbd">npm run pm:dash</span>.</p><p>This dashboard is part of a governed project-management operating system that takes work from plan → build → review → ship.</p><dl class="kv" style="margin-top:0.85rem;"><dt>Generated at</dt><dd>\' + escHtml(d) + \'</dd><dt>Spec</dt><dd>PRD-PM-Dashboard.md v1.0</dd></dl></div>\' +',
'    \'<div class="panel reveal"><h3>Scan roots</h3><dl class="kv"><dt>User</dt><dd>\' + escHtml(ai.scanRoots && ai.scanRoots.user || "—") + \'</dd><dt>Project</dt><dd>\' + escHtml(ai.scanRoots && ai.scanRoots.project || "—") + \'</dd></dl></div>\' +',
'    \'<div class="panel reveal"><h3>PM corpus</h3><dl class="kv">\' + pmKv + \'</dl></div>\' +',
'    \'<div class="panel reveal"><h3>AI Catalogue</h3><dl class="kv">\' + aiKv + \'</dl></div>\' +',
'    \'<div class="panel reveal"><h3>Curated overlays applied</h3><dl class="kv">\' + overlays + \'</dl></div>\' +',
'    \'<div class="panel reveal"><h3>Keyboard</h3><dl class="kv"><dt><span class="kbd">/</span></dt><dd>Focus search</dd><dt><span class="kbd">Cmd/Ctrl+K</span></dt><dd>Global search palette</dd><dt><span class="kbd">Esc</span></dt><dd>Close drawer / palette</dd></dl></div>\' +',
'    \'</div>\';',
'};',

// ============================================================
// v1.1 — RENDERERS for the 8-group IA (ADR-0048, STORY-04.6.06)
// Aliases first; then new renderers. The old RENDERERS.{overview, strategy,
// plan, impl, "work:*", "decisions:*", "ai:*", reports, docs} stay defined
// above so any legacy direct call still works; the visible nav routes
// through these new keys.
// ============================================================

// --- Aliases for renamed groups -----------------------------
'RENDERERS["plan:strategy"]   = RENDERERS.strategy;',
'RENDERERS["plan:roadmap"]    = RENDERERS.plan;',
'RENDERERS["build:phases"]    = RENDERERS.impl;',
'RENDERERS["build:epic"]      = RENDERERS["work:epic"];',
'RENDERERS["build:feature"]   = RENDERERS["work:feature"];',
'RENDERERS["build:story"]     = RENDERERS["work:story"];',
'RENDERERS["build:testplan"]  = RENDERERS["work:testplan"];',
'RENDERERS["build:bug"]       = RENDERERS["work:bug"];',
'RENDERERS["capture:backlog"] = RENDERERS["decisions:backlog"];',
'RENDERERS["cadence:retros"]   = RENDERERS["decisions:retro"];',
'RENDERERS["cadence:releases"] = RENDERERS["decisions:release"];',
'RENDERERS.decisions           = RENDERERS["decisions:adr"];',
'RENDERERS["toolkit:skill"]    = RENDERERS["ai:skill"];',
'RENDERERS["toolkit:agent"]    = RENDERERS["ai:agent"];',
'RENDERERS["toolkit:command"]  = RENDERERS["ai:command"];',
'RENDERERS["toolkit:plugin"]   = RENDERERS["ai:plugin"];',
'RENDERERS["toolkit:glossary"] = RENDERERS["ai:glossary"];',

// Tandem plugin tab — scans dist/tt/ at generation time and renders the
// published plugin's manifest, command process flow, full skill grid, hooks
// and bundled docs. Each /tandem:<name> pill or skill card opens the source
// skill's ai-skill drawer (names match by design).
'RENDERERS.tandem = function(root){',
'  var tp = D.tandemPackage;',
'  if(!tp || !tp.manifest || !tp.manifest.name){',
'    root.innerHTML = \'<div class="panel"><h3>Tandem plugin</h3><div class="empty">No Tandem build found at <code>dist/tt/</code>. Run <code>npm run build:tandem</code> to publish the plugin and regenerate this dashboard.</div></div>\';',
'    return;',
'  }',
'  var m = tp.manifest;',
'  var repoLink   = m.repository ? \'<a href="\' + escHtml(m.repository) + \'" target="_blank" rel="noopener">Repository ↗</a>\' : "";',
'  var homeLink   = (m.homepage && m.homepage !== m.repository) ? \'<a href="\' + escHtml(m.homepage) + \'" target="_blank" rel="noopener">Homepage ↗</a>\' : "";',
'  var authorTxt  = m.author ? (typeof m.author === "string" ? m.author : (m.author.name || "")) : "";',
'  var authorHtml = authorTxt ? \'<span class="tandem-author">by \' + escHtml(authorTxt) + \'</span>\' : "";',
'  var licHtml    = m.license ? \'<span class="tandem-license">\' + escHtml(m.license) + \'</span>\' : "";',
'  var header = \'<div class="tandem-header reveal">\' +',
'    \'<div class="tandem-mark"><svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="100" cy="100" r="100" fill="#1C1713"/><polygon points="50.0,142.0 148.0,142.0 128.0,50.0" fill="none" stroke="#2E6CE7" stroke-width="4.5" stroke-linejoin="round"/><polygon points="71.1,131.0 133.8,131.0 121.0,72.1" fill="none" stroke="#F5B726" stroke-width="4.5" stroke-linejoin="round"/><polygon points="91.1,120.5 120.5,120.5 114.5,92.9" fill="none" stroke="#D72D2D" stroke-width="4.5" stroke-linejoin="round"/></svg></div>\' +',
'    \'<div class="tandem-meta">\' +',
'      \'<h2>\' + escHtml(m.name) + \' <span class="tandem-version">v\' + escHtml(m.version||"—") + \'</span></h2>\' +',
'      \'<p class="tandem-desc">\' + escHtml(m.description||"") + \'</p>\' +',
'      \'<div class="tandem-links">\' + repoLink + homeLink + authorHtml + licHtml + \'</div>\' +',
'      (tp.sourceDir ? \'<div class="tandem-source">built from <code>\' + escHtml(tp.sourceDir) + \'</code></div>\' : "") +',
'    \'</div>\' +',
'    \'<div class="tandem-counts">\' +',
'      \'<span><strong>\' + (tp.skills||[]).length + \'</strong>skills</span>\' +',
'      \'<span><strong>\' + (tp.hooks||[]).length + \'</strong>hooks</span>\' +',
'      \'<span><strong>\' + (tp.docs||[]).length + \'</strong>docs</span>\' +',
'    \'</div>\' +',
'  \'</div>\';',
'  var flow = renderCommandFlow({',
'    scope: "tandem",',
'    prefix: "tandem:",',
'    title: m.name + " · command process flow",',
'    sub: "click any /tandem:<command> to open its skill reference"',
'  });',
'  var skillsHtml = (tp.skills||[]).map(function(s){',
'    return \'<div class="tandem-skill reveal" data-tandem-skill="\' + escHtml(s.name) + \'">\' +',
'      \'<div class="tandem-skill-name">/tandem:\' + escHtml(s.name) + \'</div>\' +',
'      \'<div class="tandem-skill-desc">\' + escHtml(s.description||"") + \'</div>\' +',
'    \'</div>\';',
'  }).join("");',
'  var skillsPanel = \'<div class="panel reveal"><h3>All shipped skills <span class="count-bubble">\' + (tp.skills||[]).length + \'</span></h3>\' +',
'    ((tp.skills||[]).length ? \'<div class="tandem-skill-grid">\' + skillsHtml + \'</div>\' : \'<div class="empty">No skills bundled.</div>\') +',
'  \'</div>\';',
'  var hooksPanel = "";',
'  if((tp.hooks||[]).length){',
'    var hooksHtml = tp.hooks.map(function(h){',
'      return \'<div class="tandem-hook">\' +',
'        \'<span class="tandem-hook-event">\' + escHtml(h.event||"") + \'</span>\' +',
'        \'<span class="tandem-hook-matcher">\' + escHtml(h.matcher||"*") + \'</span>\' +',
'        \'<span class="tandem-hook-cmd">\' + escHtml(h.commands||"") + \'</span>\' +',
'      \'</div>\';',
'    }).join("");',
'    hooksPanel = \'<div class="panel reveal"><h3>Hooks <span class="count-bubble">\' + tp.hooks.length + \'</span></h3><div class="tandem-hook-list">\' + hooksHtml + \'</div></div>\';',
'  }',
'  var docsPanel = "";',
'  if((tp.docs||[]).length){',
// d.href is already a complete path relative to the dashboard dir (built via
// path.relative in buildTandemPackage) — do NOT prepend ../../ again (was the
// double-prefix bug that pushed links 4 levels above the repo root).
'    var docsHtml = tp.docs.map(function(d){ return \'<a class="tandem-doc" href="\' + escHtml(d.href) + \'" target="_blank" rel="noopener">\' + escHtml(d.name) + \' ↗</a>\'; }).join("");',
'    docsPanel = \'<div class="panel reveal"><h3>Bundled docs <span class="count-bubble">\' + tp.docs.length + \'</span></h3><div class="tandem-docs">\' + docsHtml + \'</div></div>\';',
'  }',
// Bundled reference — deep-links to the plugin's Templates/Prompts/Scripts/Glossary.
// Canonical home stays AI Catalogue (toolkit) per ADR-0048; these are convenience
// jump-offs from the showcase so the plugin's own assets are reachable from Tandem.
'  var refDefs = [["templates","Templates"],["prompts","Prompts"],["scripts","Scripts"],["glossary","Glossary"]];',
'  var refCounts = { templates:(D.templates||[]).length, prompts:(D.prompts||[]).length, scripts:(D.scripts||[]).length, glossary:(D.glossary||[]).length };',
'  var refTotal = refCounts.templates + refCounts.prompts + refCounts.scripts + refCounts.glossary;',
'  var refsHtml = refDefs.map(function(r){ return \'<button type="button" class="tandem-doc tandem-ref" data-tandem-ref="\' + r[0] + \'" style="cursor:pointer;">\' + escHtml(r[1]) + \' <span class="count-bubble">\' + refCounts[r[0]] + \'</span></button>\'; }).join("");',
'  var refsPanel = \'<div class="panel reveal"><h3>Bundled reference <span class="count-bubble">\' + refTotal + \'</span></h3><p class="tandem-desc" style="margin-bottom:0.85rem;">Plugin templates, prompts, scripts and glossary. Canonical home is <strong>AI Catalogue</strong> (ADR-0048) — click any to open it there.</p><div class="tandem-docs">\' + refsHtml + \'</div></div>\';',
'  root.innerHTML = header + flow + skillsPanel + hooksPanel + docsPanel + refsPanel;',
'  $$(".cmd-pill[data-cmd-skill]", root).forEach(function(b){ b.addEventListener("click", function(ev){ ev.stopPropagation(); openDrawer("ai-skill", b.dataset.cmdSkill); }); });',
'  $$(".tandem-skill[data-tandem-skill]", root).forEach(function(c){ c.addEventListener("click", function(){ openDrawer("ai-skill", c.dataset.tandemSkill); }); });',
'  $$(".tandem-ref[data-tandem-ref]", root).forEach(function(b){ b.addEventListener("click", function(){ setGroup("toolkit", { sub: b.dataset.tandemRef }); }); });',
'  bindCmdFlowTabs(root);',
'};',

// --- Helper: render a generic tile-grid list of items with id+title --
// v1.1.1 (BUG-20260529-01): `typeOrFn` may be a string OR a function(item) → string
// so mixed-type widgets (blocking/stale on Now) can emit per-item data-type that
// matches the D.* key findArtefact reads.
'function tileList(items, typeOrFn, opts){',
'  opts = opts || {};',
'  if(!items.length) return \'<div class="empty">\' + escHtml(opts.emptyMsg||"Nothing here yet.") + \'</div>\';',
'  var resolveType = typeof typeOrFn === "function" ? typeOrFn : function(){ return typeOrFn; };',
'  return \'<div class="tile-grid stagger">\' + items.map(function(it){',
'    var t = resolveType(it);',
'    var extra = "";',
'    if(it.status) extra += pill(it.status);',
'    if(opts.showAge && it._ageDays != null){',
'      var cls = it._ageDays >= 30 ? "danger" : "warn";',
'      extra += \' <span class="age-ribbon \' + cls + \'">\' + it._ageDays + \'d</span>\';',
'    }',
'    if(opts.showExt && it.ext){',
'      extra += \' <span class="ext-badge \' + escHtml(it.ext) + \'">\' + escHtml(it.ext) + \'</span>\';',
'    }',
'    var sub = "";',
'    if(opts.showType && it._type) sub = \'<span class="meta">\' + escHtml(it._type) + \'</span>\';',
'    var idTxt = it.id || it.name || "";',
'    var titleTxt = it.title || it.name || idTxt;',
// v1.1.1 (BUG-20260529-01): for HTML reference artefacts (Specs/Templates with .html), open in new tab
// instead of drawer (drawer would show empty body since we don\'t inline arbitrary HTML).
'    var isHtmlRef = opts.useHrefAnchor && it.href && /\\.html?$/i.test(it.file || it.name || "");',
'    if(isHtmlRef){',
'      return \'<a class="tile reveal" href="\' + escHtml(it.href) + \'" target="_blank" rel="noopener" style="text-decoration:none; color:inherit;"><div class="tile-head"><span class="tile-id">\' + escHtml(idTxt) + \'</span><span class="tile-extra">\' + extra + \'</span></div><div class="tile-title">\' + escHtml(titleTxt) + sub + \'</div></a>\';',
'    }',
'    return \'<div class="tile reveal" data-type="\' + escHtml(t) + \'" data-id="\' + escHtml(idTxt) + \'"><div class="tile-head"><span class="tile-id">\' + escHtml(idTxt) + \'</span><span class="tile-extra">\' + extra + \'</span></div><div class="tile-title">\' + escHtml(titleTxt) + sub + \'</div></div>\';',
'  }).join("") + \'</div>\';',
'}',
// Founder-action tiles (ADR-0063): the open question is the tile title, the recommendation
// a sub-line, the target artefact a badge; clicking opens the inbox drawer (full body).
'function pendingActionList(items){',
'  if(!items.length) return \'<div class="empty">No items awaiting your action.</div>\';',
'  return \'<div class="tile-grid stagger">\' + items.map(function(it){',
'    var idTxt = it.id || it.name || "";',
'    var q = it.question || it.title || "(founder action)";',
'    var rec = it.recommendationText || it.recommendation || "";',
'    var recHtml = rec ? \'<div class="meta" style="margin-top:0.4rem; white-space:normal; display:block;"><strong>Recommendation:</strong> \' + escHtml(rec) + \'</div>\' : "";',
'    var tgt = it.target_artefact ? \'<span class="tile-extra">\' + escHtml(it.target_artefact) + \'</span>\' : "";',
'    return \'<div class="tile reveal" data-type="inbox" data-id="\' + escHtml(idTxt) + \'"><div class="tile-head"><span class="tile-id">⏳ needs answer</span>\' + tgt + \'</div><div class="tile-title">\' + escHtml(q) + \'</div>\' + recHtml + \'</div>\';',
'  }).join("") + \'</div>\';',
'}',

// --- Now-page (replaces Overview) -------------------------------
'RENDERERS.now = function(root){',
'  var pendingAction = D.pendingAction || [];',
'  var blocking = D.blocking || [];',
'  var stale = D.stale || [];',
'  var thisWeek = D.thisWeek || [];',
'  var monEntries = (D.monitor && D.monitor.entries) || [];',
'  var adrs = (D.adr||[]).slice().sort(function(a,b){ return String(b.id).localeCompare(String(a.id), "en", { numeric:true }); }).slice(0,3);',
'  var storyDone = (D.story||[]).filter(function(s){return s.status==="done";}).length;',
'  var storyTotal = (D.story||[]).length;',
'  var pct = storyTotal? Math.round(100*storyDone/storyTotal) : 0;',
'  function metric(val, lab, sub){ return \'<div class="metric reveal"><div class="metric-val">\'+val+\'</div><div class="metric-lab">\'+escHtml(lab)+\'</div>\'+(sub?\'<div class="metric-sub">\'+sub+\'</div>\':\'\')+\'</div>\'; }',
'  var hero = \'<div class="overview-hero">\'',
'    + metric((D.counts.epic||{total:0}).total, "Epics")',
'    + metric((D.counts.feature||{total:0}).total, "Features")',
'    + metric(storyTotal, "Stories", storyDone + " done · " + pct + "%")',
'    + metric((D.counts.bug||{total:0}).total, "Bugs")',
'    + metric((D.counts.adr||{total:0}).total, "ADRs")',
'    + metric((D.counts.backlog||{total:0}).total, "Backlog")',
'  + \'</div>\';',
'  var progress = \'<div class="panel reveal" style="margin-bottom:1rem;"><h3>Story progress</h3><div class="progress\' + (pct<50?\' danger\':\'\') + \'"><span style="width:\' + pct + \'%"></span></div><div class="metric-sub">\' + storyDone + \' / \' + storyTotal + \' done · \' + pct + \'%</div></div>\';',
// Story lifecycle flow (Backlog → Done) — live counts + clickable stages.
'  var storyByStatus = ((D.counts.story||{}).byStatus)||{};',
'  var stages = [',
'    { key:"inbox",       label:"Inbox",       count:(D.inbox||[]).length,                                              group:"capture", sub:"inbox",   status:null },',
'    { key:"backlog",     label:"Backlog",     count:(D.backlog||[]).length + (storyByStatus["not-started"]||0),        group:"capture", sub:"backlog", status:null },',
'    { key:"ready",       label:"Ready",       count:storyByStatus["ready"]||0,                                         group:"build",   sub:"story",   status:"ready" },',
'    { key:"in-progress", label:"In-progress", count:storyByStatus["in-progress"]||0,                                   group:"build",   sub:"story",   status:"in-progress" },',
'    { key:"in-review",   label:"In-review",   count:storyByStatus["in-review"]||0,                                     group:"build",   sub:"story",   status:"in-review" },',
'    { key:"done",        label:"Done",        count:storyByStatus["done"]||0,                                          group:"build",   sub:"story",   status:"done" }',
'  ];',
'  function flowStageHtml(s){',
'    var data = \' data-flow-target="1" data-flow-group="\' + s.group + \'" data-flow-sub="\' + s.sub + \'"\' + (s.status ? \' data-flow-status="\' + s.status + \'"\' : "");',
'    return \'<div class="flow-stage click" data-stage="\' + s.key + \'"\' + data + \'><div class="flow-stage-count">\' + s.count + \'</div><div class="flow-stage-label">\' + escHtml(s.label) + \'</div></div>\';',
'  }',
'  function flowArrowHtml(gate){ if(!gate) return \'<div class="flow-arrow">→</div>\'; return \'<div class="flow-arrow with-gate"><span class="flow-gate-label">\' + gate + \'</span><span>→</span></div>\'; }',
'  var flowParts = [];',
'  stages.forEach(function(s, i){',
'    flowParts.push(flowStageHtml(s));',
'    if(i < stages.length-1){ flowParts.push(flowArrowHtml(i===1 ? "DoR" : (i===4 ? "DoD" : ""))); }',
'  });',
'  var flowPanel = \'<div class="flow-panel reveal"><h3>Story lifecycle — Backlog → Done <span class="flow-variant-tag">click a stage to jump</span></h3>\' +',
'    \'<div class="flow-row">\' + flowParts.join("") + \'</div>\' +',
'    \'<div class="flow-loop"><span class="flow-loop-glyph">↺ bug</span><span>In-review loops back to Ready when QA files a bug (SOP §3).</span></div>\' +',
'  \'</div>\';',
'  function streamHtml(items){',
'    if(!items.length) return \'<div class="empty">Quiet week so far.</div>\';',
'    return items.slice(0, 12).map(function(it){',
'      var idTxt = it.id || "";',
'      var when = (it._when||"").slice(0,10);',
'      return \'<div class="stream-line" data-type="\' + escHtml(it._type||"story") + \'" data-id="\' + escHtml(idTxt) + \'" style="cursor:pointer;"><span class="stream-when">\' + escHtml(when) + \'</span><span class="stream-why">\' + escHtml(it._why||"") + \'</span><span class="stream-id">\' + escHtml(idTxt) + \'</span><span class="stream-title">\' + escHtml(it.title||"") + \'</span></div>\';',
'    }).join("");',
'  }',
'  function widget(label, count, body, isPending){',
'    return \'<div class="now-widget reveal\' + (isPending && count>0 ? " has-pending" : "") + \'"><h3>\' + escHtml(label) + \' <span class="count-bubble">\' + count + \'</span></h3>\' + body + \'</div>\';',
'  }',
'  var pendingPanel = widget("Pending action", pendingAction.length,',
'    pendingActionList(pendingAction),',
'    true);',
'  var blockedEmptyMsg = "No blocked stories — the team isn\\\'t waiting on any external decisions or dependencies right now. Blockers appear here automatically when a story flips to <code>status: blocked</code>.";',
// v1.1.1 (BUG-20260529-01): use per-item _type so clicking a blocked feature/epic finds its drawer.
'  var blockingPanel = widget("What\\\'s blocking me", blocking.length,',
'    blocking.length ? tileList(blocking, function(it){ return it._type; }, { emptyMsg:blockedEmptyMsg }) : \'<div class="empty">\' + blockedEmptyMsg + \'</div>\');',
'  var stalePanel = widget("What\\\'s stale (>14d)", stale.length,',
'    stale.length ? tileList(stale.slice(0, 12), function(it){ return it._type; }, { showAge:true, showType:true }) : \'<div class="empty">Everything fresh.</div>\');',
'  var thisWeekPanel = widget("This week", thisWeek.length, streamHtml(thisWeek));',
'  var nowGrid = \'<div class="now-grid">\' + pendingPanel + blockingPanel + stalePanel + thisWeekPanel + \'</div>\';',
'  var latest = monEntries.length ? \'<div class="panel reveal"><h3>Latest from MONITOR</h3><dl class="kv"><dt>\' + escHtml(monEntries[0].date) + \'</dt><dd>\' + escHtml(monEntries[0].title) + \'</dd></dl><p style="margin-top:0.6rem; color:var(--ink-2); font-size:0.86rem; line-height:1.6;">\' + escHtml(monEntries[0].summary) + \'</p></div>\' : \'\';',
'  var adrHtml = \'<div class="panel reveal"><h3>Recent decisions</h3>\' + (adrs.length ? tileList(adrs, "adr") : \'<div class="empty">No ADRs yet.</div>\') + \'</div>\';',
'  root.innerHTML = hero + flowPanel + progress + nowGrid + (latest ? \'<div style="margin-top:1rem;">\' + latest + \'</div>\' : "") + \'<div style="margin-top:1rem;">\' + adrHtml + \'</div>\';',
'  bindRows(root);',
'  $$("[data-flow-target]", root).forEach(function(el){ el.addEventListener("click", function(){',
'    var g = el.dataset.flowGroup, s = el.dataset.flowSub, st = el.dataset.flowStatus;',
'    if(st){',
'      var key = "work:story";',
'      var known = ["not-started","ready","in-progress","in-review","blocked","done","wontfix","duplicate","archived"];',
'      STATE.statusFilter[key] = {};',
'      known.forEach(function(x){ if(x !== st) STATE.statusFilter[key][x] = true; });',
'    }',
'    setGroup(g, { sub:s });',
'  }); });',
'};',

// --- Capture → Inbox --------------------------------------------
'RENDERERS["capture:inbox"] = function(root){',
'  var inbox = D.inbox || [];',
'  // Sort: needs_action: true first, then by created_at desc.',
'  var sorted = inbox.slice().sort(function(a,b){',
'    var an = a.needs_action===true ? 0 : 1;',
'    var bn = b.needs_action===true ? 0 : 1;',
'    if(an !== bn) return an - bn;',
'    return String(b.created_at||"").localeCompare(String(a.created_at||""));',
'  });',
'  var search = (STATE.search.inbox||"").toLowerCase();',
'  var filtered = sorted.filter(function(s){ return !search || (s.id+s.title+(s.bodyHtml||"")).toLowerCase().indexOf(search)!==-1; });',
'  var controls = \'<div class="controls reveal"><input class="search" type="search" placeholder="Search inbox…" value="\' + escHtml(STATE.search.inbox||"") + \'" data-scope="inbox"></div>\';',
'  root.innerHTML = controls + tileList(filtered, "inbox", { emptyMsg:"Inbox is empty. Drop unrefined items here." });',
'  bindRows(root);',
'  bindSearch(root);',
'};',

// --- Plan → Specs -----------------------------------------------
'RENDERERS["plan:specs"] = function(root){',
'  var specs = D.specs || [];',
'  var search = (STATE.search.specs||"").toLowerCase();',
'  var filtered = specs.filter(function(s){ return !search || (s.id+s.title).toLowerCase().indexOf(search)!==-1; });',
'  var controls = \'<div class="controls reveal"><input class="search" type="search" placeholder="Search PRDs and specs…" value="\' + escHtml(STATE.search.specs||"") + \'" data-scope="specs"></div>\';',
// v1.1.1 (BUG-20260529-01): data-type "specs" matches D.specs key for findArtefact; HTML specs open in new tab.
'  root.innerHTML = controls + tileList(filtered, "specs", { showExt:true, useHrefAnchor:true, emptyMsg:"No PRDs in 20-Requirements/ yet." });',
'  bindRows(root);',
'  bindSearch(root);',
'};',

// --- Cadence → Monitor (full revision history) -----------------
'RENDERERS["cadence:monitor"] = function(root){',
'  var entries = D.monitorEntries || [];',
'  if(!entries.length){ root.innerHTML = \'<div class="panel"><h3>MONITOR</h3><div class="empty">No MONITOR.md found.</div></div>\'; return; }',
'  var html = \'<div class="panel reveal"><h3>Revision history <span class="count-bubble">\' + entries.length + \'</span></h3>\';',
'  html += entries.map(function(e){',
'    return \'<div style="padding:0.65rem 0; border-bottom:1px dashed var(--border);"><div style="display:flex; gap:0.6rem; align-items:baseline;"><span class="stream-when">\' + escHtml(e.date) + \'</span><strong style="color:var(--ink); font-size:0.92rem;">\' + escHtml(e.title) + \'</strong></div><p style="margin-top:0.35rem; color:var(--ink-2); font-size:0.84rem; line-height:1.6;">\' + escHtml(e.summary) + \'</p></div>\';',
'  }).join("");',
'  html += \'</div>\';',
'  root.innerHTML = html;',
'};',

// --- Cadence → Reviews (AI-CODE-REVIEW grouped by linked artefact)
'RENDERERS["cadence:reviews"] = function(root){',
'  var reviews = D.reviews || [];',
'  if(!reviews.length){ root.innerHTML = \'<div class="panel"><h3>Reviews</h3><div class="empty">No AI code reviews in 41-Reports/ yet.</div></div>\'; return; }',
'  // Group by linked artefact id (or "(unlinked)").',
'  var groups = {};',
'  reviews.forEach(function(r){ var k = r.linked || "(unlinked)"; (groups[k] = groups[k] || []).push(r); });',
'  var orderedKeys = Object.keys(groups).sort(function(a,b){ return String(b).localeCompare(String(a), "en", { numeric:true }); });',
'  var html = orderedKeys.map(function(k){',
'    var rows = groups[k].map(function(r){',
'      var extCls = r.name.endsWith(".html") ? "html" : "md";',
'      return \'<div class="review-row"><span class="ext-badge \' + extCls + \'">\' + extCls + \'</span><span class="name">\' + escHtml(r.name) + \'</span><a href="\' + escHtml(r.href) + \'" target="_blank" rel="noopener">open ↗</a></div>\';',
'    }).join("");',
'    return \'<div class="review-group reveal"><div class="review-group-head"><span class="review-group-id">\' + escHtml(k) + \'</span><span class="review-group-count">\' + groups[k].length + \' review\' + (groups[k].length===1?"":"s") + \'</span></div>\' + rows + \'</div>\';',
'  }).join("");',
'  root.innerHTML = html;',
'};',

// --- Cadence → Audits ------------------------------------------
// v1.1.1 (BUG-20260529-01): .html opens in new tab (rendered HTML); .md / .json / others open in drawer.
'RENDERERS["cadence:audits"] = function(root){',
'  var audits = D.audits || [];',
'  if(!audits.length){ root.innerHTML = \'<div class="panel"><h3>Audits</h3><div class="empty">No audits in 41-Reports/ yet.</div></div>\'; return; }',
'  var html = \'<div class="tile-grid stagger">\';',
'  html += audits.map(function(a){',
'    var extMatch = (a.name.match(/\\.[^.]+$/) || [""])[0].slice(1).toLowerCase();',
'    var isHtml = /\\.html?$/i.test(a.name);',
'    if(isHtml){',
'      return \'<a class="tile reveal" href="\' + escHtml(a.href) + \'" target="_blank" rel="noopener" style="text-decoration:none; color:inherit;"><div class="tile-head"><span class="tile-id">\' + escHtml(a.kind) + \'</span><span class="tile-extra"><span class="ext-badge \' + escHtml(extMatch) + \'">\' + escHtml(extMatch) + \'</span></span></div><div class="tile-title">\' + escHtml(a.name) + \'</div></a>\';',
'    }',
'    return \'<div class="tile reveal" data-type="audits" data-id="\' + escHtml(a.name) + \'"><div class="tile-head"><span class="tile-id">\' + escHtml(a.kind) + \'</span><span class="tile-extra"><span class="ext-badge \' + escHtml(extMatch) + \'">\' + escHtml(extMatch) + \'</span></span></div><div class="tile-title">\' + escHtml(a.name) + \'</div></div>\';',
'  }).join("");',
'  html += \'</div>\';',
'  root.innerHTML = html;',
'  bindRows(root);',
'};',

// --- Toolkit → Templates / Prompts / Scripts -------------------
'function refRenderer(key, label){',
'  return function(root){',
'    var items = D[key] || [];',
'    var search = (STATE.search[key]||"").toLowerCase();',
'    var filtered = items.filter(function(s){ return !search || (s.id+s.title+(s.bodyHtml||"")).toLowerCase().indexOf(search)!==-1; });',
'    var controls = \'<div class="controls reveal"><input class="search" type="search" placeholder="Search \' + escHtml(label) + \'…" value="\' + escHtml(STATE.search[key]||"") + \'" data-scope="\' + escHtml(key) + \'"></div>\';',
// v1.1.1 (BUG-20260529-01): pass `key` (plural — matches D.templates/D.prompts/D.scripts) so findArtefact resolves;
// .html items in 91-Templates (EXPLORATION, HTML-ARTEFACT, AI-CODE-REVIEW) open in new tab.
'    root.innerHTML = controls + tileList(filtered, key, { showExt:true, useHrefAnchor:true, emptyMsg:"No " + label + " yet." });',
'    bindRows(root); bindSearch(root);',
'  };',
'}',
'RENDERERS["toolkit:templates"] = refRenderer("templates", "Templates");',
'RENDERERS["toolkit:prompts"]   = refRenderer("prompts",   "Prompts");',
'RENDERERS["toolkit:scripts"]   = refRenderer("scripts",   "Scripts");',

// --- Generic search input binding (used by new renderers) -----
'function bindSearch(root){',
'  $$(".search[data-scope]", root).forEach(function(inp){',
'    inp.addEventListener("input", function(){',
'      var scope = inp.dataset.scope;',
'      STATE.search[scope] = inp.value;',
'      renderActive();',
'      // Re-focus the new input element after re-render.',
'      setTimeout(function(){ var nf = $(\'.search[data-scope="\' + scope + \'"]\', root); if(nf){ nf.focus(); nf.setSelectionRange(inp.value.length, inp.value.length); } }, 0);',
'    });',
'  });',
'}',

// ============================================================
// v1.1 — Cmd-K / `/` global search palette (ADR-0048, TC-07)
// Indexes every artefact type. Toggled by Cmd/Ctrl+K. Enter opens
// the matched drawer. Escape closes.
// ============================================================
'var SEARCH_INDEX = null;',
'function buildSearchIndex(){',
'  if(SEARCH_INDEX) return SEARCH_INDEX;',
'  var idx = [];',
'  function add(items, type, kind){ (items||[]).forEach(function(it){ idx.push({ type:type, kind:kind, id:it.id||it.name||"", title:it.title||it.name||"", status:it.status||"", search:((it.id||it.name||"")+" "+(it.title||it.name||"")+" "+(it.status||"")+" "+(it.bodyHtml||"").replace(/<[^>]+>/g, " ")).toLowerCase() }); }); }',
'  add(D.epic, "epic", "EPIC");',
'  add(D.feature, "feature", "FEAT");',
'  add(D.story, "story", "STORY");',
'  add(D.testplan, "testplan", "TESTPLAN");',
'  add(D.bug, "bug", "BUG");',
'  add(D.adr, "adr", "ADR");',
'  add(D.reviews, "reviews", "REVIEW");',
'  add(D.audits, "audits", "AUDIT");',
'  add(D.backlog, "backlog", "BACKLOG");',
'  add(D.release, "release", "RELEASE");',
'  add(D.retro, "retro", "RETRO");',
'  add(D.strategy, "strategy", "STRATEGY");',
'  add(D.inbox, "inbox", "INBOX");',
'  add(D.specs, "spec", "SPEC");',
'  add(D.templates, "template", "TEMPLATE");',
'  add(D.prompts, "prompt", "PROMPT");',
'  add(D.scripts, "script", "SCRIPT");',
'  SEARCH_INDEX = idx;',
'  return idx;',
'}',
'function searchScore(item, q){',
'  if(!q) return 0;',
'  var s = item.search;',
'  if(s.indexOf(q) === -1) return -1;',
'  // Prefer matches in id/title over body.',
'  var idHit = (item.id||"").toLowerCase().indexOf(q) !== -1 ? 100 : 0;',
'  var titleHit = (item.title||"").toLowerCase().indexOf(q) !== -1 ? 50 : 0;',
'  return idHit + titleHit + 1;',
'}',
'function ensurePalette(){',
'  var bd = $("#cmdk-backdrop");',
'  if(bd) return bd;',
'  bd = el("div", { id:"cmdk-backdrop", class:"cmdk-backdrop" });',
'  bd.innerHTML = \'<div class="cmdk" role="dialog" aria-modal="true" aria-label="Search palette"><input id="cmdk-input" class="cmdk-input" type="search" placeholder="Search every artefact…" autocomplete="off" spellcheck="false"><div id="cmdk-list" class="cmdk-list" role="listbox"></div><div class="cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></div></div>\';',
'  document.body.appendChild(bd);',
'  bd.addEventListener("click", function(e){ if(e.target === bd) closePalette(); });',
'  var inp = $("#cmdk-input", bd);',
'  inp.addEventListener("input", renderPaletteResults);',
'  inp.addEventListener("keydown", paletteKeydown);',
'  return bd;',
'}',
'function openPalette(){',
'  STATE.palette = true;',
'  buildSearchIndex();',
'  var bd = ensurePalette();',
'  bd.classList.add("open");',
'  var inp = $("#cmdk-input", bd);',
'  inp.value = "";',
'  renderPaletteResults();',
'  setTimeout(function(){ inp.focus(); }, 30);',
'}',
'function closePalette(){',
'  STATE.palette = false;',
'  var bd = $("#cmdk-backdrop");',
'  if(bd) bd.classList.remove("open");',
'}',
'function renderPaletteResults(){',
'  var inp = $("#cmdk-input"); if(!inp) return;',
'  var q = (inp.value||"").trim().toLowerCase();',
'  var list = $("#cmdk-list");',
'  if(!q){ list.innerHTML = \'<div class="cmdk-empty">Type to search across every epic, feature, story, ADR, review, audit, bug, backlog, release, retro, strategy, inbox, spec, prompt, template, and script.</div>\'; return; }',
'  var scored = buildSearchIndex().map(function(it){ return { item:it, score: searchScore(it, q) }; }).filter(function(x){ return x.score >= 0; }).sort(function(a,b){ return b.score - a.score; }).slice(0, 12);',
'  if(!scored.length){ list.innerHTML = \'<div class="cmdk-empty">No matches for "\' + escHtml(q) + \'".</div>\'; return; }',
'  list.innerHTML = scored.map(function(x, i){',
'    return \'<div class="cmdk-item\' + (i===0?" focused":"") + \'" data-type="\' + escHtml(x.item.type) + \'" data-id="\' + escHtml(x.item.id) + \'" role="option"><span class="cmdk-kind">\' + escHtml(x.item.kind) + \'</span><span class="cmdk-id">\' + escHtml(x.item.id) + \'</span><span class="cmdk-title">\' + escHtml(x.item.title) + \'</span></div>\';',
'  }).join("");',
'  $$(".cmdk-item", list).forEach(function(node){ node.addEventListener("click", function(){ activatePaletteItem(node); }); });',
'}',
'function activatePaletteItem(node){',
'  var type = node.getAttribute("data-type");',
'  var id = node.getAttribute("data-id");',
'  closePalette();',
'  openDrawer(type, id);',
'}',
'function paletteKeydown(e){',
'  var focused = $("#cmdk-list .cmdk-item.focused");',
'  var all = $$("#cmdk-list .cmdk-item");',
'  if(e.key === "ArrowDown"){ e.preventDefault(); if(!focused && all.length){ all[0].classList.add("focused"); return; } var i = all.indexOf(focused); var n = all[Math.min(i+1, all.length-1)]; if(n && n!==focused){ focused.classList.remove("focused"); n.classList.add("focused"); n.scrollIntoView({ block:"nearest" }); } }',
'  else if(e.key === "ArrowUp"){ e.preventDefault(); if(!focused) return; var j = all.indexOf(focused); var p = all[Math.max(j-1, 0)]; if(p && p!==focused){ focused.classList.remove("focused"); p.classList.add("focused"); p.scrollIntoView({ block:"nearest" }); } }',
'  else if(e.key === "Enter"){ e.preventDefault(); if(focused) activatePaletteItem(focused); }',
'  else if(e.key === "Escape"){ e.preventDefault(); closePalette(); }',
'}',

// ------------ Drawer ------------
'var DRAWER_STACK = [];',
'function findArtefact(type, id){',
'  if(type==="ai-skill")   return (D.ai.skills||[]).find(function(x){ return x.name===id; });',
'  if(type==="ai-agent")   return (D.ai.agents||[]).find(function(x){ return x.name===id; });',
'  if(type==="ai-command") return (D.ai.commands||[]).find(function(x){ return x.name===id; });',
'  if(type==="ai-plugin")  return (D.ai.plugins||[]).find(function(x){ return x.name===id; });',
// Chat IDs (CHAT-01, CHAT-02 …) repeat across epics — they're local to each
// epic, not globally unique. Scope the lookup to STATE.implEpic so clicking
// CHAT-01 on EPIC-03 returns EPIC-03's chat, not the last-seen epic's.
'  if(type==="impl"){',
'    var epics = (D.executionStrategy && D.executionStrategy.epics) || [];',
'    var scoped = STATE.implEpic ? epics.filter(function(e){ return e.epic === STATE.implEpic; }) : epics;',
'    var pool = scoped.length ? scoped : epics;',
'    for(var ei=0; ei<pool.length; ei++){',
'      var ph = pool[ei].phases || [];',
'      for(var pi=0; pi<ph.length; pi++){',
'        var cs = ph[pi].chats || [];',
'        for(var ci=0; ci<cs.length; ci++){ if(cs[ci].id === id) return cs[ci]; }',
'      }',
'    }',
'    return null;',
'  }',
// v1.1.1 (BUG-20260529-01): audits/reviews look up by name (no id field on report artefacts).
'  if(type==="audits") return (D.audits||[]).find(function(x){ return x.name===id; });',
'  if(type==="reviews") return (D.reviews||[]).find(function(x){ return x.name===id; });',
'  var arr = D[type] || [];',
'  return arr.find(function(x){ return x.id===id; });',
'}',

'function showDrawerPanel(){ var d=$("#drawer"), m=$("#mask"); d.classList.add("open"); m.classList.add("open"); document.body.style.overflow="hidden"; $(".drawer-back", d).classList.toggle("show", DRAWER_STACK.length>1); d.scrollTo({top:0, behavior:"instant"}); }',
'function openDrawer(type, id, opts){',
'  opts = opts || {};',
'  var item = findArtefact(type, id);',
'  if(!item){ console.warn("No artefact for", type, id); return; }',
'  if(opts.replaceTop && DRAWER_STACK.length) DRAWER_STACK.pop();',
'  DRAWER_STACK.push({ render: function(){ renderDrawer(item, type); } });',
'  renderDrawer(item, type);',
'  showDrawerPanel();',
'}',

'function closeDrawer(){ var d=$("#drawer"); var m=$("#mask"); d.classList.remove("open"); m.classList.remove("open"); document.body.style.overflow=""; DRAWER_STACK=[]; }',

'function popDrawer(){ if(DRAWER_STACK.length>1){ DRAWER_STACK.pop(); DRAWER_STACK[DRAWER_STACK.length-1].render(); $(".drawer-back").classList.toggle("show", DRAWER_STACK.length>1); $("#drawer").scrollTo({top:0, behavior:"instant"}); } else { closeDrawer(); } }',

'function renderDrawer(item, type){',
'  var d = $("#drawer .drawer-titles");',
'  var idText = item.id || item.name || "";',
'  var titleText = item.title || item.name || "";',
'  d.querySelector(".drawer-id").textContent = idText;',
'  d.querySelector(".drawer-title").textContent = titleText;',
'  var meta = d.querySelector(".drawer-meta"); meta.innerHTML = "";',
'  if(item.status) meta.innerHTML += pill(item.status);',
'  if(item.severity) meta.innerHTML += sev(item.severity);',
'  if(item.source) meta.innerHTML += \'<span class="tag source">\' + escHtml(item.source) + \'</span>\';',
'  if(item.category) meta.innerHTML += \'<span class="tag">\' + escHtml(item.category) + \'</span>\';',
'  if(item.curated) meta.innerHTML += \'<span class="tag star">★ curated</span>\';',
'  if(item.mustKnow) meta.innerHTML += \'<span class="tag must">must-know</span>\';',
'  if(item.version) meta.innerHTML += \'<span class="tag">v\' + escHtml(item.version) + \'</span>\';',
'  var body = $("#drawer .drawer-body");',
'  var sections = "";',
'  if(item.outcome && !/^ai-/.test(type)) sections += \'<p class="drawer-outcome"><span class="lab">Outcome</span> \' + escHtml(item.outcome) + \'</p>\';',
'  // Implementation chat drawer (execution-strategy chats)',
'  if(type==="impl"){',
'    var implSecs = "";',
'    if(item.outcome) implSecs += \'<p class="drawer-outcome"><span class="lab">Outcome</span> \' + escHtml(item.outcome) + \'</p>\';',
'    implSecs += \'<dl class="kv">\';',
'    if(item.estimate) implSecs += \'<dt>Estimate</dt><dd>\' + escHtml(item.estimate) + \'</dd>\';',
'    if(item.executed != null) implSecs += \'<dt>Executed</dt><dd>\' + escHtml(String(item.executed)) + \'</dd>\';',
'    implSecs += \'</dl>\';',
'    if(item.trigger) implSecs += \'<h3>Trigger / prompt</h3><pre class="drawer-pre">\' + escHtml(item.trigger) + \'</pre>\';',
'    if(item.verify)  implSecs += \'<h3>Verify</h3><pre class="drawer-pre">\' + escHtml(item.verify) + \'</pre>\';',
'    if(item.stories && item.stories.length)   implSecs += \'<h3>Stories</h3><p>\' + item.stories.map(function(s){ var sid=(s&&s.id)?s.id:s; return \'<code>\' + escHtml(sid) + \'</code>\'; }).join(" ") + \'</p>\';',
'    if(item.sub_agents && item.sub_agents.length) implSecs += \'<h3>Sub-agents</h3><p>\' + item.sub_agents.map(function(s){ return \'<code>\' + escHtml(s) + \'</code>\'; }).join(" ") + \'</p>\';',
'    if(item.depends_on && item.depends_on.length) implSecs += \'<h3>Depends on</h3><p>\' + item.depends_on.map(function(s){ return \'<code>\' + escHtml(s) + \'</code>\'; }).join(" ") + \'</p>\';',
'    if(item.unlocks && item.unlocks.length)   implSecs += \'<h3>Unlocks</h3><p>\' + item.unlocks.map(function(s){ return \'<code>\' + escHtml(s) + \'</code>\'; }).join(" ") + \'</p>\';',
'    body.innerHTML = implSecs;',
'    wireDrawerLinks(body);',
'    return;',
'  }',
'  // Curated overlay block (AI)',
'  if(item.overlay){',
'    var ov = item.overlay;',
'    sections += \'<div class="drawer-overlay"><div class="label">Curated guidance</div>\';',
'    if(ov.when_to_use)    sections += \'<p><strong>When to use:</strong> \' + escHtml(ov.when_to_use) + \'</p>\';',
'    if(ov.when_not_to_use)sections += \'<p><strong>When NOT to use:</strong> \' + escHtml(ov.when_not_to_use) + \'</p>\';',
'    if(ov.bodyHtml) sections += ov.bodyHtml;',
'    sections += \'</div>\';',
'  }',
'  // SOP session-flow timeline (special-case for the kit\'s own plugin)',
'  if(type==="ai-plugin" && isPmKitPlugin(item)){',
'    sections += renderSessionFlow();',
'  }',
'  var isAi = /^ai-/.test(type);',
'  var aiKind = isAi ? type.slice(3) : "";',
'  // AI: full / upstream description (the frontmatter trigger text)',
'  if(isAi){',
'    var fullD = item.fullDescription || item.description || "";',
'    if(aiKind==="agent"){ fullD = fullD.split("<example>")[0].replace(/Specifically:\\s*$/i, "").trim(); }',
'    if(fullD){',
'      var dLabel = item.curated ? "Upstream description" : "Description";',
'      sections += \'<h3>\' + dLabel + \'</h3><p class="drawer-ai-desc">\' + escHtml(fullD).replace(/\\n+/g, " ").trim() + \'</p>\';',
'    }',
'  }',
'  // Skill sub-commands (reference/*.md) — clickable drill-down',
'  if(aiKind==="skill" && item.subItems && item.subItems.length){',
'    sections += \'<h3>Sub-commands · \' + item.subItems.length + \'</h3>\';',
'    sections += \'<div class="subitems">\' + item.subItems.map(function(s){ return \'<div class="subitem" tabindex="0" role="button" data-sub-skill="\' + escHtml(item.name) + \'" data-sub-slug="\' + escHtml(s.slug) + \'"><div class="subitem-name">\' + escHtml(s.slug) + (s.title && s.title!==s.slug ? \' <span class="subitem-title">\' + escHtml(s.title) + \'</span>\' : "") + \'</div>\' + (s.desc ? \'<div class="subitem-desc">\' + escHtml(s.desc) + \'</div>\' : "") + \'<div class="subitem-cta">Open reference →</div></div>\'; }).join("") + \'</div>\';',
'  }',
'  // Sub-agent: tools + concrete trigger examples',
'  if(aiKind==="agent"){',
'    if(item.tools) sections += \'<h3>Tools</h3><p><code>\' + escHtml(item.tools) + \'</code></p>\';',
'    if(item.examples && item.examples.length){',
'      sections += \'<h3>Trigger examples · \' + item.examples.length + \'</h3>\';',
'      sections += item.examples.map(function(ex){ return \'<div class="drawer-example">\' + (ex.context ? \'<div class="ex-label">Context</div><div class="ex-body">\' + escHtml(ex.context) + \'</div>\' : "") + (ex.user ? \'<div class="ex-label">User says</div><div class="ex-body ex-user">\' + escHtml(ex.user) + \'</div>\' : "") + (ex.commentary ? \'<div class="ex-label">Why it fits</div><div class="ex-body">\' + escHtml(ex.commentary) + \'</div>\' : "") + \'</div>\'; }).join("");',
'    }',
'  }',
'  // Slash command: argument hint + allowed tools',
'  if(aiKind==="command"){',
'    if(item.argumentHint) sections += \'<h3>Arguments</h3><p><code>\' + escHtml(item.argumentHint) + \'</code></p>\';',
'    if(item.allowedTools) sections += \'<h3>Allowed tools</h3><p><code>\' + escHtml(item.allowedTools) + \'</code></p>\';',
'  }',
'  // Plugin: grouped, clickable inventory of what it bundles',
'  if(aiKind==="plugin" && item.bundles){',
'    var b = item.bundles;',
'    if((b.skills&&b.skills.length)||(b.agents&&b.agents.length)||(b.commands&&b.commands.length)||(b.hooks&&b.hooks.length)) sections += \'<h3>What this plugin bundles</h3>\';',
'    var bundleGroup = function(label, arr, kind){ if(!arr||!arr.length) return ""; return \'<div class="bundle-group"><div class="bundle-title">\' + label + \' · \' + arr.length + \'</div><div class="subitems">\' + arr.map(function(s){ return \'<div class="subitem" tabindex="0" role="button" data-bundled-plugin="\' + escHtml(item.name) + \'" data-bundled-kind="\' + kind + \'" data-bundled-name="\' + escHtml(s.name) + \'"><div class="subitem-name">\' + escHtml(s.name) + \'</div>\' + (s.description ? \'<div class="subitem-desc">\' + escHtml(s.description) + \'</div>\' : "") + \'<div class="subitem-cta">Open detail →</div></div>\'; }).join("") + \'</div></div>\'; };',
'    sections += bundleGroup("Skills", b.skills, "skill");',
'    sections += bundleGroup("Subagents", b.agents, "agent");',
'    sections += bundleGroup("Slash commands", b.commands, "command");',
'    if(b.hooks && b.hooks.length) sections += \'<div class="bundle-group"><div class="bundle-title">Hooks · \' + b.hooks.length + \'</div><p>\' + b.hooks.map(function(h){ return \'<code>\' + escHtml(h) + \'</code>\'; }).join(" ") + \'</p></div>\';',
'    var pkv = "";',
'    if(item.author) pkv += \'<dt>Author</dt><dd>\' + escHtml(item.author) + \'</dd>\';',
'    if(item.homepage) pkv += \'<dt>Homepage</dt><dd><a href="\' + escHtml(item.homepage) + \'" target="_blank" rel="noopener">\' + escHtml(item.homepage) + \'</a></dd>\';',
'    if(item.license) pkv += \'<dt>License</dt><dd>\' + escHtml(item.license) + \'</dd>\';',
'    if(item.installPath) pkv += \'<dt>Install path</dt><dd><code style="word-break:break-all;">\' + escHtml(item.installPath) + \'</code></dd>\';',
'    if(pkv) sections += \'<dl class="kv" style="margin-top:1rem;">\' + pkv + \'</dl>\';',
'  }',
'  // Body / reference',
'  if(aiKind==="skill" || aiKind==="agent" || aiKind==="command"){ if(item.bodyHtml && item.bodyHtml.trim()){ sections += \'<h3>Reference body</h3>\' + item.bodyHtml; } }',
'  else if(item.bodyHtml){ sections += item.bodyHtml; }',
'  else if(item.readmeHtml){ sections += item.readmeHtml; }',
'  else if(!isAi){ sections += \'<p style="color:var(--ink-faint);">No body content.</p>\'; }',
'  // Cross-references',
'  var xref = [];',
'  if(item.epic && type!=="epic") xref.push({type:"epic", id:item.epic, label:item.epic});',
'  if(item.feature && type!=="feature") xref.push({type:"feature", id:item.feature, label:item.feature});',
'  if(item.story && type!=="story") xref.push({type:"story", id:item.story, label:item.story});',
'  if(item.testplan && type!=="testplan") xref.push({type:"testplan", id:item.testplan, label:item.testplan});',
'  if(item.decisions && item.decisions.length) item.decisions.forEach(function(a){ if(a) xref.push({type:"adr", id:a, label:a}); });',
'  if(item.context_story) xref.push({type: /^STORY-/.test(item.context_story)?"story":/^BACKLOG-/.test(item.context_story)?"backlog":"feature", id:item.context_story, label:item.context_story});',
'  // For stories, link to paired testplan',
'  if(type==="story"){ var tpId = String(item.id).replace(/^STORY-/, "TESTPLAN-"); if(D.testplan && D.testplan.some(function(t){return t.id===tpId;})) xref.push({type:"testplan", id:tpId, label:tpId}); }',
'  // For testplans, link to paired story',
'  if(type==="testplan"){ var stId = String(item.id).replace(/^TESTPLAN-/, "STORY-"); if(D.story && D.story.some(function(s){return s.id===stId;})) xref.push({type:"story", id:stId, label:stId}); }',
'  var xrefHtml = "";',
'  if(xref.length){',
'    xrefHtml = \'<div class="drawer-section"><h3>Cross-references</h3><div class="xref">\' + xref.map(function(x){ return \'<button type="button" class="xref-pill" data-xref-type="\' + escHtml(x.type) + \'" data-xref-id="\' + escHtml(x.id) + \'">\' + escHtml(x.label) + \'</button>\'; }).join("") + \'</div></div>\';',
'  }',
'  // Source path',
'  var srcHtml = "";',
'  if(item.file){',
'    srcHtml = \'<div class="drawer-section"><h3>Source</h3><code style="font-size:0.78rem; word-break:break-all;">\' + escHtml(item.file) + \'</code></div>\';',
'  }',
'  body.innerHTML = sections + xrefHtml + srcHtml;',
'  wireDrawerLinks(body);',
'}',

// Wire every in-drawer drill-down affordance: cross-reference pills,
// skill sub-commands, and bundled plugin items.
'function wireDrawerLinks(body){',
'  $$(".xref-pill", body).forEach(function(b){ b.addEventListener("click", function(){ openDrawer(b.dataset.xrefType, b.dataset.xrefId); }); });',
'  $$("[data-sub-skill]", body).forEach(function(elm){ var go=function(){ openSkillSubItem(elm.dataset.subSkill, elm.dataset.subSlug); }; elm.addEventListener("click", go); elm.addEventListener("keydown", function(e){ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); go(); } }); });',
'  $$("[data-bundled-plugin]", body).forEach(function(elm){ var go=function(){ openBundledItem(elm.dataset.bundledPlugin, elm.dataset.bundledKind, elm.dataset.bundledName); }; elm.addEventListener("click", go); elm.addEventListener("keydown", function(e){ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); go(); } }); });',
'}',

// Open a skill reference sub-command (e.g. impeccable's "craft") in the drawer.
'function openSkillSubItem(skillName, slug){',
'  var skill = (D.ai.skills||[]).find(function(s){return s.name===skillName;});',
'  if(!skill) return;',
'  var sub = (skill.subItems||[]).find(function(s){return s.slug===slug;});',
'  if(!sub) return;',
'  DRAWER_STACK.push({ render: function(){ renderSubItemDrawer(skill, sub); } });',
'  renderSubItemDrawer(skill, sub);',
'  showDrawerPanel();',
'}',
'function renderSubItemDrawer(skill, sub){',
'  var t = $("#drawer .drawer-titles");',
'  t.querySelector(".drawer-id").textContent = skill.name + " · sub-command";',
'  t.querySelector(".drawer-title").textContent = "/" + skill.name + " " + sub.slug + (sub.title && sub.title!==sub.slug ? " — " + sub.title : "");',
'  t.querySelector(".drawer-meta").innerHTML = \'<span class="tag source">\' + escHtml(skill.source||"") + \'</span><span class="tag">sub-command</span>\';',
'  var sec = "";',
'  if(sub.desc) sec += \'<h3>Summary</h3><p class="drawer-ai-desc">\' + escHtml(sub.desc) + \'</p>\';',
'  if(sub.bodyHtml) sec += \'<h3>Reference</h3>\' + sub.bodyHtml;',
'  if(skill.file) sec += \'<div class="drawer-section"><h3>Source</h3><code style="font-size:0.78rem; word-break:break-all;">\' + escHtml(skill.file + "/reference/" + sub.slug + ".md") + \'</code></div>\';',
'  var bd = $("#drawer .drawer-body"); bd.innerHTML = sec; wireDrawerLinks(bd);',
'}',
// Open a single bundled item from a plugin: prefer the fully-scanned catalogue
// entry (so its own body / sub-commands show); fall back to a name+blurb stub.
'function openBundledItem(pluginName, kind, name){',
'  var listKey = kind + "s";',
'  var list = (D.ai && D.ai[listKey]) || [];',
'  var found = list.filter(function(x){ return x.pluginName===pluginName; }).find(function(x){ return x.name===name || x.name===pluginName+":"+name; });',
'  if(!found) found = list.find(function(x){ return x.name===name; });',
'  if(found){ openDrawer("ai-"+kind, found.name); return; }',
'  var plugin = (D.ai.plugins||[]).find(function(p){return p.name===pluginName;});',
'  var arr = plugin && plugin.bundles ? (plugin.bundles[listKey]||[]) : [];',
'  var stub = arr.find(function(s){return s.name===name;});',
'  if(!stub) return;',
'  DRAWER_STACK.push({ render: function(){ renderBundleStub(pluginName, kind, stub); } });',
'  renderBundleStub(pluginName, kind, stub);',
'  showDrawerPanel();',
'}',
'function renderBundleStub(pluginName, kind, stub){',
'  var t = $("#drawer .drawer-titles");',
'  t.querySelector(".drawer-id").textContent = pluginName + " · bundled " + kind;',
'  t.querySelector(".drawer-title").textContent = stub.name;',
'  t.querySelector(".drawer-meta").innerHTML = \'<span class="tag source">plugin:\' + escHtml(pluginName) + \'</span><span class="tag">\' + escHtml(kind) + \'</span>\';',
'  $("#drawer .drawer-body").innerHTML = stub.description ? \'<p class="drawer-ai-desc">\' + escHtml(stub.description) + \'</p>\' : \'<p style="color:var(--ink-faint);">No description.</p>\';',
'}',

'function renderSessionFlow(){',
'  var sf = D.sessionFlow;',
'  if(!sf) return "";',
'  var rows = sf.spine.map(function(s){ return \'<div class="flow-row \' + escHtml(s.kind) + \'"><span class="flow-label">\' + escHtml(s.label) + \'</span><span class="flow-detail">\' + s.detail + \'</span></div>\'; }).join("");',
'  var aside = sf.aside ? \'<div class="flow-aside"><div class="head">\' + escHtml(sf.aside.label) + \'</div>\' + sf.aside.items.map(function(s){ return \'<div class="flow-row \' + escHtml(s.kind) + \'"><span class="flow-label">\' + escHtml(s.label) + \'</span><span class="flow-detail">\' + s.detail + \'</span></div>\'; }).join("") + \'</div>\' : "";',
'  return \'<h3>Session flow</h3><div class="flow">\' + rows + \'</div>\' + aside;',
'}',

// renderCommandFlow — Toolkit → Plugin panel for the Tandem
// plugin. Renders the kit's slash commands in the order they're invoked through
// a story's lifecycle. Each pill opens the corresponding ai-skill drawer.
// opts: { scope?: "sop"|"tandem", prefix?: string, title?: string, sub?: string }
'function renderCommandFlow(opts){',
'  opts = opts || {};',
'  var scope  = opts.scope  || "sop";',
'  var prefix = opts.prefix || "";',
'  var title  = opts.title  || "Tandem · command process flow";',
'  var sub    = opts.sub    || "click any /command to open its skill reference";',
'  var cf = D.commandFlow;',
'  if(!cf || !cf.phases) return "";',
'  var view = (STATE.cmdFlowView && STATE.cmdFlowView[scope]) || "e2e";',
'  var members = CMD_FLOW_VIEW_MEMBERS[view] || null; // null means show all',
'  function inView(c){ return !members || members.indexOf(c.name) !== -1; }',
'  function pillHtml(c){',
'    var note = c.note ? \'<span class="cmd-pill-note">\' + escHtml(c.note) + \'</span>\' : "";',
'    var when = c.when ? \'<span class="cmd-pill-when">\' + escHtml(c.when) + \'</span>\' : "";',
'    var adv  = c.advisory ? \' data-advisory="1"\' : "";',
'    var amb  = c.ambient  ? \' data-ambient="1"\'  : "";',
'    return \'<button type="button" class="cmd-pill" data-cmd-skill="\' + escHtml(c.name) + \'"\' + adv + amb + \'><span class="cmd-pill-name">/\' + escHtml(prefix) + escHtml(c.name) + \'</span>\' + when + note + \'</button>\';',
'  }',
'  // Per-view command counts for the tab badges.',
'  function countForView(v){',
'    var mem = CMD_FLOW_VIEW_MEMBERS[v];',
'    var n = 0;',
'    (cf.phases||[]).forEach(function(p){ (p.commands||[]).forEach(function(c){ if(!mem || mem.indexOf(c.name)!==-1) n++; }); });',
'    if(cf.cadence) (cf.cadence.commands||[]).forEach(function(c){ if(!mem || mem.indexOf(c.name)!==-1) n++; });',
'    return n;',
'  }',
'  var tabsHtml = \'<div class="cmd-view-tabs" role="tablist">\' + CMD_FLOW_VIEWS.map(function(v){',
'    var active = (view === v[0]);',
'    return \'<button type="button" class="cmd-view-tab\' + (active?" active":"") + \'" role="tab" aria-selected="\' + (active?"true":"false") + \'" data-cmd-view-scope="\' + scope + \'" data-cmd-view-key="\' + v[0] + \'">\' + escHtml(v[1]) + \' Session\' + \'<span class="cmd-view-tab-count">\' + countForView(v[0]) + \'</span></button>\';',
'  }).join("") + \'</div>\';',
'  var phaseHtml = cf.phases.map(function(p){',
'    var visible = (p.commands||[]).filter(inView);',
'    if(!visible.length) return ""; // hide empty phases for the active view',
'    var gate = p.gate ? \'<span class="cmd-phase-gate">\' + escHtml(p.gate) + \' gate</span>\' : "";',
'    var pills = visible.map(pillHtml).join("");',
'    return \'<div class="cmd-phase" data-phase="\' + escHtml(p.key) + \'">\' +',
'      \'<div class="cmd-phase-head">\' +',
'        \'<div class="cmd-phase-top"><span class="cmd-phase-label">\' + escHtml(p.label) + \'</span><span class="cmd-phase-hat">\' + escHtml(p.hat||"") + \'</span>\' + gate + \'</div>\' +',
'        \'<div class="cmd-phase-desc">\' + escHtml(p.desc||"") + \'</div>\' +',
'      \'</div>\' +',
'      \'<div class="cmd-phase-pills">\' + pills + \'</div>\' +',
'    \'</div>\';',
'  }).filter(function(s){ return !!s; });',
'  // Inject arrows between visible phases only.',
'  var phasesWithArrows = phaseHtml.length ? phaseHtml.join(\'<div class="cmd-phase-arrow">→</div>\') : \'<div class="empty">No commands in this view.</div>\';',
'  var rail = "";',
'  if(cf.cadence){',
'    var railVisible = (cf.cadence.commands||[]).filter(inView);',
'    if(railVisible.length){',
'      var railPills = railVisible.map(pillHtml).join("");',
'      rail = \'<div class="cmd-rail">\' +',
'        \'<div class="cmd-rail-head">\' +',
'          \'<span class="cmd-rail-label">↻ \' + escHtml(cf.cadence.label) + \'</span>\' +',
'          \'<span class="cmd-rail-desc">\' + escHtml(cf.cadence.desc||"") + \'</span>\' +',
'        \'</div>\' +',
'        \'<div class="cmd-rail-pills">\' + railPills + \'</div>\' +',
'      \'</div>\';',
'    }',
'  }',
'  return \'<div class="cmd-flow-panel reveal" data-cmd-flow-scope="\' + scope + \'">\' +',
'    \'<div class="cmd-flow-head">\' +',
'      \'<span class="cmd-flow-title">\' + escHtml(title) + \'</span>\' +',
'      \'<span class="cmd-flow-sub">\' + escHtml(sub) + \'</span>\' +',
'    \'</div>\' +',
'    tabsHtml +',
'    \'<div class="cmd-flow-phases">\' + phasesWithArrows + \'</div>\' +',
'    rail +',
'  \'</div>\';',
'}',

// ------------ Event wiring ------------
// v1.1.1 (BUG-20260529-01): include .stream-line so Now's "This week" rows open the drawer.
'function bindRows(root){',
'  $$(".tile, .stream-line", root).forEach(function(r){ if(r.__bound) return; r.__bound=true; r.addEventListener("click", function(){ openDrawer(r.dataset.type, r.dataset.id); }); });',
'}',
'function bindControls(root){',
'  $$(".search", root).forEach(function(inp){ if(inp.__bound) return; inp.__bound=true; inp.addEventListener("input", function(){ var s = inp.dataset.scope; STATE.search[s] = inp.value; renderActive(); inp.focus(); }); });',
'  $$(".pill.filterable", root).forEach(function(p){ if(p.__bound) return; p.__bound=true; p.addEventListener("click", function(){ var s = (STATE.group==="work"?"work:":STATE.group==="decisions"?"decisions:":STATE.group+":") + STATE.sub; STATE.statusFilter[s] = STATE.statusFilter[s] || {}; var st = p.dataset.status; STATE.statusFilter[s][st] = !STATE.statusFilter[s][st]; renderActive(); }); });',
'}',

// Command process flow view-tab clicks (Planning / Development / Learning / E2E).
'function bindCmdFlowTabs(root){',
'  $$(".cmd-view-tab[data-cmd-view-scope]", root).forEach(function(b){',
'    if(b.__bound) return; b.__bound = true;',
'    b.addEventListener("click", function(){',
'      var scope = b.dataset.cmdViewScope;',
'      var key   = b.dataset.cmdViewKey;',
'      STATE.cmdFlowView = STATE.cmdFlowView || {};',
'      STATE.cmdFlowView[scope] = key;',
'      renderActive();',
'    });',
'  });',
'}',

// ------------ Reveal observer ------------
'function setupRevealObserver(){',
'  if(!("IntersectionObserver" in window)) { $$(".reveal").forEach(function(e){ e.classList.add("visible"); }); return; }',
'  var ob = new IntersectionObserver(function(entries){ entries.forEach(function(en){ if(en.isIntersecting){ en.target.classList.add("visible"); ob.unobserve(en.target); } }); }, { rootMargin:"-30px 0px -20px 0px" });',
'  var watcher = new MutationObserver(function(){ $$(".reveal:not(.visible)").forEach(function(e){ ob.observe(e); }); });',
'  watcher.observe(document.body, { childList:true, subtree:true });',
'  $$(".reveal").forEach(function(e){ ob.observe(e); });',
'}',

// ------------ Init ------------
'function init(){',
'  renderGroupNav();',
'  // Hash routing',
'  var h = readHash();',
// v1.1 — apply LEGACY_ROUTES so old hash bookmarks redirect silently.
'  var r = applyLegacy(h.group, h.sub);',
'  if(r.group && SUB_TABS[r.group] != null){ setGroup(r.group, { sub: r.sub }); } else { setGroup("now"); }',
'  // Mask + close',
'  $("#mask").addEventListener("click", closeDrawer);',
'  $(".drawer-close").addEventListener("click", closeDrawer);',
'  $(".drawer-back").addEventListener("click", popDrawer);',
// v1.1 — Cmd-K / Ctrl-K opens the global search palette; `/` keeps focusing the active tab's search.
'  document.addEventListener("keydown", function(e){',
'    if((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")){ e.preventDefault(); openPalette(); return; }',
'    if(e.key === "Escape"){ if(STATE.palette){ closePalette(); return; } if($("#drawer").classList.contains("open")) closeDrawer(); return; }',
'    if(e.key === "/" && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)){ e.preventDefault(); openPalette(); }',
'  });',
'  $("#theme-toggle").addEventListener("click", function(){ applyTheme(document.documentElement.getAttribute("data-theme")==="dark" ? "light" : "dark"); });',
// v1.1 — hashchange also honours LEGACY_ROUTES.
'  window.addEventListener("hashchange", function(){ var h=readHash(); var r=applyLegacy(h.group, h.sub); if(r.group && r.group!==STATE.group){ setGroup(r.group, { sub:r.sub }); } else if(r.sub && r.sub!==STATE.sub){ setSub(r.sub); } });',
'  setupRevealObserver();',
'  // Diagnostics link clicks',
'  $$("#diag a[data-path]").forEach(function(a){ a.addEventListener("click", function(e){ e.preventDefault(); /* read-only — show path */ }); });',
'}',
'if(document.readyState==="loading"){ document.addEventListener("DOMContentLoaded", init); } else { init(); }',
'})();',
].join('\n');

/* ============================================================
 * HTML assembly
 * ============================================================ */

var RE_LS = new RegExp(String.fromCharCode(0x2028), "g");
var RE_PS = new RegExp(String.fromCharCode(0x2029), "g");
function escScript(s) {
  // Make a JSON blob safe to inline inside <script>...</script>.
  // 1. Break any literal "</script" so the parser doesn't end the script tag.
  // 2. Escape U+2028 / U+2029 (JSON allows them raw but they break JS source).
  return String(s)
    .replace(/<\/(script)/gi, '<\\/$1')
    .replace(RE_LS, '\\u2028')
    .replace(RE_PS, '\\u2029');
}

function emitHtml(data) {
  const escapedProjectName = escapeHtml(data.project || resolveProjectName());
  const diagBlock = data.diagnostics.unparseable.length
    ? `<div id="diag" class="diag"><div class="diag-inner" role="alert"><div><strong>${data.diagnostics.unparseable.length} file(s) could not be parsed.</strong><ul>${data.diagnostics.unparseable.map(u => `<li><code data-path="${escapeHtml(u.path)}">${escapeHtml(u.path)}</code> — ${escapeHtml(u.reason)}</li>`).join('')}</ul></div></div></div>`
    : '';

  // v1.1 — 8-group section grid (ADR-0048, PRD §5.1, TESTPLAN-04.6.06 TC-02).
  const sections = `
    <section id="sec-now" class="tab-section"></section>
    <section id="sec-capture:inbox" class="tab-section"></section>
    <section id="sec-capture:backlog" class="tab-section"></section>
    <section id="sec-plan:strategy" class="tab-section"></section>
    <section id="sec-plan:roadmap" class="tab-section"></section>
    <section id="sec-plan:specs" class="tab-section"></section>
    <section id="sec-build:phases" class="tab-section"></section>
    <section id="sec-build:epic" class="tab-section"></section>
    <section id="sec-build:feature" class="tab-section"></section>
    <section id="sec-build:story" class="tab-section"></section>
    <section id="sec-build:testplan" class="tab-section"></section>
    <section id="sec-build:bug" class="tab-section"></section>
    <section id="sec-cadence:monitor" class="tab-section"></section>
    <section id="sec-cadence:retros" class="tab-section"></section>
    <section id="sec-cadence:releases" class="tab-section"></section>
    <section id="sec-cadence:reviews" class="tab-section"></section>
    <section id="sec-cadence:audits" class="tab-section"></section>
    <section id="sec-decisions" class="tab-section"></section>
    <section id="sec-toolkit:skill" class="tab-section"></section>
    <section id="sec-toolkit:agent" class="tab-section"></section>
    <section id="sec-toolkit:command" class="tab-section"></section>
    <section id="sec-toolkit:plugin" class="tab-section"></section>
    <section id="sec-toolkit:templates" class="tab-section"></section>
    <section id="sec-toolkit:prompts" class="tab-section"></section>
    <section id="sec-toolkit:scripts" class="tab-section"></section>
    <section id="sec-toolkit:glossary" class="tab-section"></section>
    <section id="sec-tandem" class="tab-section"></section>
    <section id="sec-about" class="tab-section"></section>
  `;

  const dataJson = escScript(JSON.stringify(data));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="generator" content="generate-dashboard.js (PRD-PM-Dashboard.md v1.1, ADR-0048)">
<meta name="robots" content="noindex">
<title>Tandem Command Center — ${escapedProjectName}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap">
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#main">Skip to main content</a>
<header class="app-header" role="banner">
  <div class="app-header-inner">
    <div class="brand-wrap">
      <span class="brand-mark" aria-hidden="true">
        <svg class="brand-logo" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><circle cx="100" cy="100" r="100" fill="#1C1713"/><polygon points="50.0,142.0 148.0,142.0 128.0,50.0" fill="none" stroke="#2E6CE7" stroke-width="4.5" stroke-linejoin="round"/><polygon points="71.1,131.0 133.8,131.0 121.0,72.1" fill="none" stroke="#F5B726" stroke-width="4.5" stroke-linejoin="round"/><polygon points="91.1,120.5 120.5,120.5 114.5,92.9" fill="none" stroke="#D72D2D" stroke-width="4.5" stroke-linejoin="round"/></svg>
      </span>
      <div>
        <h1 class="app-title">Tandem Command Center<em>.</em></h1>
        <small class="app-sub">${escapedProjectName}</small>
      </div>
    </div>
    <div class="app-tools">
      <span class="app-meta" title="Generated">${escapeHtml(data.generatedAt)}</span>
      <button id="theme-toggle" class="icon-btn" type="button" aria-label="Toggle theme" title="Toggle theme">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"></path></svg>
      </button>
    </div>
  </div>
</header>
${diagBlock}
<nav id="group-nav-wrap" class="group-nav" role="navigation" aria-label="Section groups">
  <div id="group-nav" class="group-inner"></div>
</nav>
<nav id="sub-nav" class="sub-nav" role="navigation" aria-label="Sub-tabs">
  <div id="sub-nav-inner" class="sub-inner"></div>
</nav>
<main id="main" role="main">
${sections}
</main>
<div id="mask" class="mask" aria-hidden="true"></div>
<aside id="drawer" class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
  <div class="drawer-head">
    <button type="button" class="drawer-back" aria-label="Previous drawer" title="Back">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
    </button>
    <div class="drawer-titles titles">
      <div class="drawer-id"></div>
      <div class="drawer-title" id="drawer-title"></div>
      <div class="drawer-meta"></div>
    </div>
    <button type="button" class="drawer-close" aria-label="Close drawer" title="Close">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M18 6L6 18M6 6l12 12"/></svg>
    </button>
  </div>
  <div class="drawer-body"></div>
</aside>
<script>window.__DATA = ${dataJson};</script>
<script>
${BROWSER_JS}
</script>
</body>
</html>`;
}

/* ============================================================
 * Main
 * ============================================================ */

function main() {
  const t0 = Date.now();
  const pm = buildPmCorpus();
  const monitor = parseMonitor();
  const ai = buildAiCatalogue();
  const counts = computeCounts(pm);
  const plan = buildPlanTree(pm);
  const executionStrategy = buildExecutionStrategy();
  const reports = buildReports();
  const docs = buildDocs();

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

  // v1.1 — split reports into typed homes for Build → Phases / Cadence → Reviews|Audits.
  const splitR = splitReports(reports);
  // `phases` is the existing executionStrategy reshaped to a flat card list per epic.
  const phases = (executionStrategy && executionStrategy.epics) || [];

  const data = Object.assign({}, pm, {
    generatedAt: new Date().toISOString(),
    project: resolveProjectName(),
    monitor,
    counts,
    ai,
    plan,
    executionStrategy,
    reports,
    docs,
    // v1.1 — new __DATA keys (ADR-0048, TESTPLAN-04.6.06 TC-05).
    specs,
    templates,
    prompts,
    scripts,
    phases,
    reviews: splitR.reviews,
    audits:  splitR.audits,
    monitorEntries: (monitor && monitor.entries) || [],
    pendingAction,
    blocking,
    stale,
    thisWeek,
    diagnostics,
    glossary: GLOSSARY,
    sessionFlow: SOP_SESSION_FLOW,
    commandFlow: SOP_COMMAND_PROCESS_FLOW,
    tandemPackage: buildTandemPackage(),
  });

  const html = emitHtml(data);
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, html);
  const ms = Date.now() - t0;
  const kb = Math.round(html.length / 1024);
  console.log('Wrote ' + rel(OUT_FILE) + ' (' + kb + ' KB) in ' + ms + ' ms.');
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
module.exports = { mdToHtml, escapeHtml, tokenCost, buildAiCatalogue };

if (require.main === module) main();
