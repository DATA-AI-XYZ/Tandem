#!/usr/bin/env node
/**
 * generate-backlog-board.js
 *
 * Builds a single self-contained interactive HTML backlog-prioritization board
 * at _00-Project-Management/41-Reports/BACKLOG-BOARD.html from the BACKLOG-*.md
 * files in _00-Project-Management/11-Backlog/.
 *
 * The board is a THROWAWAY single-purpose tool (per CLAUDE-CODE-CONFIG §4 and
 * the Anthropic "unreasonable effectiveness of HTML" blog): one card per backlog
 * item, drag-to-reorder, RICE sliders, filter by priority / type-of-work, and an
 * "Export → markdown patch" button that emits a unified diff of the frontmatter
 * (priority + rice_score) so changes can be applied with `git apply` or by hand.
 * Markdown-in-git stays the source of truth; the HTML never persists anything.
 *
 * Design tokens + the export/clipboard pattern mirror DASHBOARD.html,
 * HTML-ARTEFACT.template.html and EXPLORATION.template.html (no CDN, no fonts off
 * the web, light + dark, fully offline / file://).
 *
 * Dependency-free: Node.js stdlib only (fs, path).
 * Idempotent except for the generated-at timestamp.
 *
 * Usage:
 *   node _00-Project-Management/93-Scripts/generate-backlog-board.js
 *   npm run pm:board
 *
 * Exit codes:
 *   0 — board written
 *   2 — script error (couldn't read the backlog folder, etc.)
 */

'use strict';

const fs = require('fs');
const path = require('path');

/* ============================================================
 * Config
 * ============================================================ */

const PM_ROOT = path.resolve(__dirname, '..');
const BACKLOG_DIR = path.join(PM_ROOT, '11-Backlog');
const OUT_FILE = path.join(PM_ROOT, '41-Reports', 'BACKLOG-BOARD.html');

// Priority enum used for the filter pills + colour mapping.
const PRIORITY_ORDER = ['P0', 'P1', 'P2', 'P3'];

/* ============================================================
 * Frontmatter parsing
 * Mirrors validate-frontmatter.js's flat-YAML approach. We keep the
 * raw line text around so the exporter can build a byte-faithful diff.
 * ============================================================ */

function stripQuotes(s) {
  if (typeof s !== 'string') return s;
  if ((s.startsWith("'") && s.endsWith("'")) ||
      (s.startsWith('"') && s.endsWith('"'))) {
    return s.slice(1, -1);
  }
  return s;
}

// Split a file into { fmLines, fmText } where fmLines are the raw lines BETWEEN
// the opening and closing `---` (no delimiters), preserving exact text. Returns
// null if there's no frontmatter block.
function splitFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return null;
  return { fmText: m[1], fmLines: m[1].split(/\r?\n/) };
}

// Parse the flat key:value fields we care about from the raw frontmatter lines.
function parseFields(fmLines) {
  const fm = {};
  for (const line of fmLines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (kv) fm[kv[1]] = stripQuotes(kv[2].trim());
  }
  return fm;
}

// Find the 0-based index of a top-level `key:` line in the frontmatter lines,
// or -1 if absent. Only matches unindented keys (frontmatter here is flat).
function indexOfKey(fmLines, key) {
  for (let i = 0; i < fmLines.length; i++) {
    if (new RegExp('^' + key + '\\s*:').test(fmLines[i])) return i;
  }
  return -1;
}

/* ============================================================
 * RICE
 * rice_score = reach * impact * confidence / effort  (round to int)
 * confidence is a 0..1 fraction; effort never zero. We surface the four
 * components when present, otherwise default to a neutral starting point
 * so the slider has something to move. The score field itself is what the
 * patch writes back.
 * ============================================================ */

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function computeRice(reach, impact, confidence, effort) {
  const e = effort > 0 ? effort : 1;
  return Math.round((reach * impact * confidence) / e);
}

/* ============================================================
 * Collect backlog items
 * ============================================================ */

function collect() {
  if (!fs.existsSync(BACKLOG_DIR)) {
    console.error('✗ backlog folder not found: ' + BACKLOG_DIR);
    process.exit(2);
  }
  const files = fs.readdirSync(BACKLOG_DIR)
    .filter(f => /^BACKLOG-\d+.*\.md$/.test(f))
    .sort();

  const items = [];
  for (const file of files) {
    const abs = path.join(BACKLOG_DIR, file);
    let content;
    try {
      content = fs.readFileSync(abs, 'utf8');
    } catch (e) {
      console.error('  ! skipped unreadable file: ' + file);
      continue;
    }
    const split = splitFrontmatter(content);
    if (!split) {
      // Malformed frontmatter — don't crash, just note and skip (per testplan
      // "generator handles malformed BACKLOG frontmatter without crashing").
      console.error('  ! skipped (no frontmatter): ' + file);
      continue;
    }
    const fm = parseFields(split.fmLines);

    const reach = num(fm.rice_reach, 100);
    const impact = num(fm.rice_impact, 2);
    const confidence = num(fm.rice_confidence, 0.8);
    const effort = num(fm.rice_effort, 3);
    const existingScore = fm.rice_score !== undefined
      ? num(fm.rice_score, 0)
      : 0;

    items.push({
      file,
      id: fm.id || file.replace(/\.md$/, ''),
      title: fm.title || fm.id || file,
      priority: fm.priority || 'P3',
      typeOfWork: fm.type_of_work || 'unknown',
      estimate: fm.estimate || '?',
      status: fm.status || 'not-started',
      riceScore: existingScore,
      reach, impact, confidence, effort,
      hasRiceScore: fm.rice_score !== undefined,
      // Raw line context for byte-faithful patch generation:
      priorityLineIdx: indexOfKey(split.fmLines, 'priority'),
      riceLineIdx: indexOfKey(split.fmLines, 'rice_score'),
      fmLines: split.fmLines,
    });
  }
  return items;
}

/* ============================================================
 * Patch context
 * For each item we precompute the data the in-browser exporter needs to
 * build a unified diff hunk: the original `priority:` line, the original
 * `rice_score:` line (or null if absent), and a stable surrounding context
 * line so `git apply` can anchor the hunk. We hand the browser the raw
 * frontmatter lines + indices and let it splice — keeping the diff math in
 * one place (the script computes nothing about the *new* values; the user's
 * slider/filter edits do).
 * ============================================================ */

function patchContextFor(item) {
  // Offset: frontmatter lines start at file line 2 (line 1 is the opening `---`).
  const FM_LINE_OFFSET = 2;
  return {
    file: '_00-Project-Management/11-Backlog/' + item.file,
    fmLines: item.fmLines,
    fmLineOffset: FM_LINE_OFFSET,
    priorityLineIdx: item.priorityLineIdx,
    riceLineIdx: item.riceLineIdx,
  };
}

/* ============================================================
 * HTML helpers
 * ============================================================ */

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function priorityClass(p) {
  switch (p) {
    case 'P0': return 'danger';
    case 'P1': return 'warn';
    case 'P2': return 'info';
    default:   return 'ok';
  }
}

/* ============================================================
 * Render
 * ============================================================ */

function renderCard(item, index) {
  const pClass = priorityClass(item.priority);
  return `
      <article class="backlog-card" draggable="true"
               data-backlog-id="${esc(item.id)}"
               data-file="${esc(item.file)}"
               data-orig-priority="${esc(item.priority)}"
               data-orig-rice="${esc(item.riceScore)}"
               data-has-rice="${item.hasRiceScore ? '1' : '0'}"
               data-type="${esc(item.typeOfWork)}">
        <div class="card-head">
          <span class="drag-handle" aria-hidden="true" title="Drag to reorder">☰</span>
          <span class="card-pos" data-pos>${index + 1}</span>
          <span class="card-id">${esc(item.id)}</span>
        </div>
        <h3 class="card-title">${esc(item.title)}</h3>
        <div class="card-meta">
          <label class="prio-wrap">
            <span class="pill ${pClass} prio-pill" data-prio-pill>${esc(item.priority)}</span>
            <select class="prio-select" data-prio aria-label="Priority for ${esc(item.id)}">
              ${PRIORITY_ORDER.map(p =>
                `<option value="${p}"${p === item.priority ? ' selected' : ''}>${p}</option>`
              ).join('')}
            </select>
          </label>
          <span class="pill type-pill">${esc(item.typeOfWork)}</span>
          <span class="pill est-pill">est ${esc(item.estimate)}</span>
          <span class="pill status-pill">${esc(item.status)}</span>
        </div>
        <div class="rice-row">
          <span class="rice-label">RICE</span>
          <input type="range" class="rice-slider" data-rice
                 min="0" max="1000" step="5" value="${esc(item.riceScore)}"
                 aria-label="RICE score for ${esc(item.id)}">
          <output class="rice-out" data-rice-out>${esc(item.riceScore)}</output>
        </div>
      </article>`;
}

function buildHtml(items) {
  const now = new Date();
  const genDate = now.toISOString().slice(0, 10);

  // Patch context payload (JSON, embedded). textContent of a <script type=…>
  // tag — never eval'd, parsed with JSON.parse — so no injection surface.
  const patchData = {};
  for (const it of items) patchData[it.id] = patchContextFor(it);
  const patchJson = JSON.stringify(patchData)
    .replace(/</g, '\\u003c')   // safe to inline inside <script>
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');

  const cards = items.map(renderCard).join('\n');

  const typeOptions = Array.from(new Set(items.map(i => i.typeOfWork))).sort();

  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="generator" content="generate-backlog-board.js (STORY-01.1.06 / BACKLOG-0016 Tranche A) — mirrors DASHBOARD.html + EXPLORATION.template.html">
<meta name="robots" content="noindex">
<title>Backlog prioritization board</title>
<style>
/* ============================================================
   BACKLOG-BOARD — generated, throwaway, single-purpose (CCC §4).
   Design tokens copied from HTML-ARTEFACT / EXPLORATION / DASHBOARD.
   Pure HTML/CSS/JS. No CDN, no framework, no web fonts. Offline (file://).
   ============================================================ */
:root {
  --cream:#F5F0E8; --cream-2:#EBE5D8;
  --surface:#FAF8F4; --surface-2:#F1ECE3;
  --ink:#1A1714; --ink-2:#3D3831; --ink-3:#6B6358; --ink-faint:#9E9589;
  --border:#DDD6C8;
  --red:#D63031;     --red-soft:#F8E0E0;
  --yellow:#F0B429;  --yellow-soft:#FAE9C0;
  --blue:#2D6CDF;    --blue-soft:#DCE7F8;
  --teal:#0D9488;    --teal-soft:#CFEAE6;
  --r:12px; --r-sm:10px; --r-lg:16px; --r-pill:100px;
  --shadow-sm:0 1px 2px rgba(26,23,20,0.06);
  --shadow:0 4px 14px rgba(26,23,20,0.08);
  --serif:Georgia, 'Times New Roman', serif;
  --sans:-apple-system, 'Segoe UI', system-ui, sans-serif;
  --mono:Consolas, 'JetBrains Mono', ui-monospace, monospace;
  --ease:cubic-bezier(0.16, 1, 0.3, 1);
  --dur:280ms;
  --focus-ring:rgba(214,48,49,0.45);
}
html[data-theme="dark"] {
  --cream:#15120F; --cream-2:#1C1814;
  --surface:#1A1612; --surface-2:#221D17;
  --ink:#F1ECE3; --ink-2:#D8CFC0; --ink-3:#9E9589; --ink-faint:#6B6358;
  --border:#312A22;
  --red:#E25558;     --red-soft:rgba(226,85,88,0.16);
  --yellow:#F2C24A;  --yellow-soft:rgba(242,194,74,0.16);
  --blue:#5B8DE8;    --blue-soft:rgba(91,141,232,0.18);
  --teal:#2BB3A6;    --teal-soft:rgba(43,179,166,0.18);
  --shadow-sm:0 1px 2px rgba(0,0,0,0.35);
  --shadow:0 6px 18px rgba(0,0,0,0.45);
  --focus-ring:rgba(226,85,88,0.5);
}

* { box-sizing:border-box; margin:0; padding:0; }
html { scroll-behavior:smooth; }
body {
  font-family:var(--sans); color:var(--ink); background:var(--cream);
  line-height:1.55; font-size:15px; -webkit-font-smoothing:antialiased;
  transition:background var(--dur) var(--ease), color var(--dur) var(--ease);
}
:focus-visible { outline:none; box-shadow:0 0 0 3px var(--focus-ring); border-radius:var(--r-sm); }
::selection { background:var(--yellow); color:var(--ink); }
a { color:var(--blue); text-decoration:none; }
a:hover { text-decoration:underline; }
code, kbd, pre { font-family:var(--mono); font-size:0.875em; }

.shell { max-width:1280px; margin:0 auto; padding:1.5rem 1.25rem 3rem; }

/* Header */
.art-header {
  display:flex; align-items:flex-end; justify-content:space-between;
  gap:1rem; flex-wrap:wrap; padding-bottom:1.25rem;
  border-bottom:1px solid var(--border); margin-bottom:1.5rem;
}
.art-title { font-family:var(--serif); font-weight:400; font-size:2rem; line-height:1.15; letter-spacing:-0.01em; }
.art-title em { color:var(--red); font-style:italic; }
.art-sub { color:var(--ink-3); font-size:0.78rem; letter-spacing:0.14em; text-transform:uppercase; margin-top:0.4rem; }
.art-meta { color:var(--ink-3); font-family:var(--mono); font-size:0.78rem; }
.theme-btn {
  background:transparent; border:1px solid var(--border); color:var(--ink-2);
  padding:0.4rem 0.75rem; border-radius:var(--r-pill); cursor:pointer;
  font-family:var(--sans); font-size:0.78rem; transition:all 160ms var(--ease);
}
.theme-btn:hover { background:var(--surface-2); border-color:var(--ink-faint); color:var(--ink); }

.banner {
  background:var(--yellow-soft); border:1px solid var(--yellow);
  border-radius:var(--r-sm); padding:0.75rem 1rem; margin-bottom:1.5rem;
  font-size:0.86rem; color:var(--ink-2);
}
.banner strong { color:var(--ink); }

/* Toolbar: filters + export */
.toolbar {
  display:flex; gap:1rem; flex-wrap:wrap; align-items:flex-end;
  margin-bottom:1.5rem;
}
.filter-group { display:flex; flex-direction:column; gap:0.3rem; }
.filter-group label { font-size:0.72rem; text-transform:uppercase; letter-spacing:0.06em; color:var(--ink-3); }
select.filter, .toolbar select {
  background:var(--surface); color:var(--ink); border:1px solid var(--border);
  border-radius:var(--r-sm); padding:0.45rem 0.7rem; font-family:var(--sans); font-size:0.86rem;
}
.spacer { flex:1 1 auto; }
.btn {
  background:var(--red); color:#fff; border:1px solid var(--red);
  padding:0.55rem 1rem; border-radius:var(--r-pill); cursor:pointer;
  font-family:var(--sans); font-size:0.86rem; font-weight:600; transition:all 160ms var(--ease);
}
.btn:hover { filter:brightness(1.08); }
.btn.secondary { background:transparent; color:var(--ink-2); border-color:var(--border); }
.btn.secondary:hover { background:var(--surface-2); border-color:var(--ink-faint); color:var(--ink); }
.btn:disabled { opacity:0.5; cursor:not-allowed; filter:none; }

/* Card grid */
.board {
  display:grid; grid-template-columns:repeat(auto-fill, minmax(300px, 1fr));
  gap:1rem; margin-bottom:1.5rem;
}
.backlog-card {
  background:var(--surface); border:1px solid var(--border); border-radius:var(--r);
  padding:1rem 1.1rem; box-shadow:var(--shadow-sm);
  display:flex; flex-direction:column; gap:0.6rem; cursor:grab;
  transition:border-color 160ms var(--ease), box-shadow 160ms var(--ease), opacity 160ms var(--ease);
}
.backlog-card:hover { border-color:var(--ink-faint); }
.backlog-card.dragging { opacity:0.45; cursor:grabbing; box-shadow:var(--shadow); }
.backlog-card.drop-target { border-color:var(--red); box-shadow:0 0 0 2px var(--red-soft); }
.backlog-card.dirty { border-left:4px solid var(--yellow); }
.backlog-card[hidden] { display:none; }
.card-head { display:flex; align-items:center; gap:0.5rem; }
.drag-handle { color:var(--ink-faint); cursor:grab; font-size:1rem; }
.card-pos {
  background:var(--surface-2); color:var(--ink-2); font-family:var(--mono);
  font-size:0.72rem; border-radius:var(--r-pill); padding:0.05rem 0.5rem; min-width:1.6rem; text-align:center;
}
.card-id { font-family:var(--mono); font-size:0.72rem; color:var(--ink-faint); letter-spacing:0.04em; }
.card-title { font-size:0.96rem; font-weight:600; color:var(--ink); line-height:1.35; }
.card-meta { display:flex; gap:0.4rem; flex-wrap:wrap; align-items:center; }

.pill { display:inline-flex; align-items:center; gap:0.3rem; padding:0.15rem 0.6rem; border-radius:var(--r-pill); font-size:0.72rem; font-weight:600; }
.pill.ok    { background:var(--teal-soft);   color:var(--teal); }
.pill.warn  { background:var(--yellow-soft); color:var(--yellow); }
.pill.danger{ background:var(--red-soft);    color:var(--red); }
.pill.info  { background:var(--blue-soft);   color:var(--blue); }
.type-pill, .est-pill, .status-pill { background:var(--surface-2); color:var(--ink-2); }

.prio-wrap { position:relative; display:inline-flex; align-items:center; }
.prio-select {
  background:var(--surface); color:var(--ink); border:1px solid var(--border);
  border-radius:var(--r-sm); padding:0.1rem 0.35rem; font-size:0.72rem; font-family:var(--sans);
}
.prio-pill { display:none; } /* the select is the live control; pill kept for static greppability */

.rice-row { display:flex; align-items:center; gap:0.6rem; }
.rice-label { font-size:0.7rem; text-transform:uppercase; letter-spacing:0.06em; color:var(--ink-3); }
.rice-slider { flex:1 1 auto; accent-color:var(--red); cursor:pointer; }
.rice-out { font-family:var(--mono); font-size:0.82rem; color:var(--ink-2); min-width:2.6rem; text-align:right; }

/* Export panel */
.export-card {
  background:var(--surface); border:1px solid var(--border); border-radius:var(--r);
  padding:1.25rem 1.5rem; box-shadow:var(--shadow-sm);
}
.export-card h2 { font-family:var(--serif); font-weight:400; font-size:1.4rem; margin-bottom:0.5rem; }
.export-bar { display:flex; gap:0.75rem; flex-wrap:wrap; align-items:center; margin:0.75rem 0; }
.export-status { font-size:0.82rem; color:var(--ink-3); }
.export-status.ok { color:var(--teal); }
.export-status.err { color:var(--red); }
textarea.export-out {
  width:100%; min-height:260px; background:var(--surface-2); color:var(--ink);
  border:1px solid var(--border); border-radius:var(--r-sm);
  padding:0.85rem 1rem; font-family:var(--mono); font-size:0.82rem; line-height:1.5; resize:vertical;
}

.art-footer {
  margin-top:2rem; padding-top:1rem; border-top:1px solid var(--border);
  color:var(--ink-3); font-size:0.78rem; display:flex; justify-content:space-between; gap:1rem; flex-wrap:wrap;
}

@media (max-width: 640px) {
  .shell { padding:1rem 0.85rem 2rem; }
  .art-title { font-size:1.55rem; }
  .board { grid-template-columns:1fr; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration:0.001ms !important; transition-duration:0.001ms !important; }
}
</style>
</head>
<body>
<main class="shell" id="top">

  <header class="art-header">
    <div>
      <h1 class="art-title">Backlog <em>prioritization</em> board</h1>
      <div class="art-sub">Throwaway tool · STORY-01.1.06 · BACKLOG-0016 Tranche A</div>
    </div>
    <div style="display:flex; align-items:center; gap:0.75rem;">
      <span class="art-meta">Generated · ${genDate} · ${items.length} items</span>
      <button class="theme-btn" type="button" id="theme-toggle" aria-label="Toggle dark mode">Dark mode</button>
    </div>
  </header>

  <div class="banner">
    <strong>Desktop-only, throwaway tool.</strong> Drag-to-reorder uses the HTML5 drag-and-drop API
    (no touch support). This HTML is regenerated by <code>npm run pm:board</code> and is never the
    source of truth — the BACKLOG markdown in git is. Reorder cards, adjust priority + RICE, then
    <strong>Export → markdown patch</strong> and apply with <code>git apply</code>.
  </div>

  <div class="toolbar">
    <div class="filter-group">
      <label for="filter-priority">Filter by priority</label>
      <select class="filter" id="filter-priority">
        <option value="">All priorities</option>
        ${PRIORITY_ORDER.map(p => `<option value="${p}">${p}</option>`).join('')}
      </select>
    </div>
    <div class="filter-group">
      <label for="filter-type">Filter by type-of-work</label>
      <select class="filter" id="filter-type">
        <option value="">All types</option>
        ${typeOptions.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}
      </select>
    </div>
    <span class="spacer"></span>
    <button class="btn" type="button" id="export-btn">Export → markdown patch</button>
    <button class="btn secondary" type="button" id="copy-btn">Copy patch to clipboard</button>
  </div>

  <section class="board" id="board" aria-label="Backlog cards">
${cards}
  </section>

  <section class="export-card">
    <h2>Export → markdown patch</h2>
    <p>Generates a unified diff (one hunk per modified file) of the changed
      <code>priority:</code> and <code>rice_score:</code> frontmatter fields. Save it to a
      <code>.patch</code> file and run <code>git apply &lt;file&gt;.patch</code> (or
      <code>git apply --check</code> first). Only cards you actually changed appear in the diff.</p>
    <div class="export-bar">
      <button class="btn" type="button" id="export-btn-2">Generate patch</button>
      <button class="btn secondary" type="button" id="copy-btn-2">Copy to clipboard</button>
      <span class="export-status" id="export-status" role="status" aria-live="polite"></span>
    </div>
    <textarea class="export-out" id="export-out" readonly
              aria-label="Generated unified diff — select and Ctrl+C if the copy button is blocked"
              placeholder="Reorder / edit cards, then click “Export → markdown patch”…"></textarea>
  </section>

  <footer class="art-footer">
    <span>BACKLOG-BOARD — generated by generate-backlog-board.js. Throwaway, single-purpose (CCC §4).</span>
    <span>SOP §11.1 · STORY-01.1.06 · mirrors DASHBOARD.html</span>
  </footer>

</main>

<script type="application/json" id="patch-data">${patchJson}</script>
<script>
(function () {
  'use strict';

  /* ----- Theme toggle (persists) — from HTML-ARTEFACT ----- */
  var root = document.documentElement;
  var themeBtn = document.getElementById('theme-toggle');
  var TKEY = 'backlog-board-theme';
  function applyTheme(t) {
    root.setAttribute('data-theme', t);
    if (themeBtn) themeBtn.textContent = (t === 'dark') ? 'Light mode' : 'Dark mode';
  }
  try {
    var saved = localStorage.getItem(TKEY);
    if (saved === 'light' || saved === 'dark') applyTheme(saved);
  } catch (e) {}
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var next = (root.getAttribute('data-theme') === 'dark') ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem(TKEY, next); } catch (e) {}
    });
  }

  /* ----- Load patch context (no eval — JSON.parse only) ----- */
  var PATCH = {};
  try {
    PATCH = JSON.parse(document.getElementById('patch-data').textContent || '{}');
  } catch (e) { PATCH = {}; }

  var board = document.getElementById('board');
  var cards = function () {
    return Array.prototype.slice.call(board.querySelectorAll('.backlog-card'));
  };

  /* ----- Position numbers reflect current DOM order ----- */
  function renumber() {
    var pos = 0;
    cards().forEach(function (c) {
      if (c.hasAttribute('hidden')) return;
      pos += 1;
      var el = c.querySelector('[data-pos]');
      if (el) el.textContent = pos;
    });
  }

  /* ----- Drag to reorder (HTML5 DnD) ----- */
  var dragEl = null;
  board.addEventListener('dragstart', function (e) {
    var card = e.target.closest('.backlog-card');
    if (!card) return;
    dragEl = card;
    card.classList.add('dragging');
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', card.getAttribute('data-backlog-id')); } catch (x) {}
  });
  board.addEventListener('dragend', function () {
    if (dragEl) dragEl.classList.remove('dragging');
    cards().forEach(function (c) { c.classList.remove('drop-target'); });
    dragEl = null;
    renumber();
  });
  board.addEventListener('dragover', function (e) {
    e.preventDefault();
    var over = e.target.closest('.backlog-card');
    if (!over || over === dragEl) return;
    cards().forEach(function (c) { if (c !== over) c.classList.remove('drop-target'); });
    over.classList.add('drop-target');
    var rect = over.getBoundingClientRect();
    var after = (e.clientY - rect.top) > rect.height / 2;
    if (after) over.parentNode.insertBefore(dragEl, over.nextSibling);
    else over.parentNode.insertBefore(dragEl, over);
  });
  board.addEventListener('drop', function (e) { e.preventDefault(); });

  /* ----- Per-card live controls: priority select + RICE slider ----- */
  function markDirty(card) {
    var prioChanged = card.querySelector('[data-prio]').value !== card.getAttribute('data-orig-priority');
    var riceChanged = String(card.querySelector('[data-rice]').value) !== String(card.getAttribute('data-orig-rice'));
    if (prioChanged || riceChanged) card.classList.add('dirty');
    else card.classList.remove('dirty');
  }
  board.addEventListener('input', function (e) {
    var card = e.target.closest('.backlog-card');
    if (!card) return;
    if (e.target.matches('[data-rice]')) {
      var out = card.querySelector('[data-rice-out]');
      if (out) out.textContent = e.target.value;
    }
    if (e.target.matches('[data-prio]')) {
      var pill = card.querySelector('[data-prio-pill]');
      if (pill) pill.textContent = e.target.value;
    }
    markDirty(card);
  });
  board.addEventListener('change', function (e) {
    var card = e.target.closest('.backlog-card');
    if (card) markDirty(card);
  });

  /* ----- Filters ----- */
  var fPrio = document.getElementById('filter-priority');
  var fType = document.getElementById('filter-type');
  function applyFilters() {
    var wantP = fPrio.value;
    var wantT = fType.value;
    cards().forEach(function (c) {
      var p = c.querySelector('[data-prio]').value;
      var t = c.getAttribute('data-type');
      var show = (!wantP || p === wantP) && (!wantT || t === wantT);
      if (show) c.removeAttribute('hidden'); else c.setAttribute('hidden', '');
    });
    renumber();
  }
  fPrio.addEventListener('change', applyFilters);
  fType.addEventListener('change', applyFilters);

  /* ============================================================
   * Patch generation — unified diff, one hunk per modified file.
   *
   * For each card whose priority or rice_score changed we splice the new
   * value into a copy of the file's raw frontmatter lines, then emit a
   * minimal hunk with 1 line of leading context so git apply can anchor
   * cleanly. priority is written unquoted (matching the corpus); rice_score
   * is a bare integer. If rice_score is absent it's inserted right after the
   * priority line. We never reformat unrelated lines.
   * ============================================================ */
  function diffFile(card) {
    var id = card.getAttribute('data-backlog-id');
    var ctx = PATCH[id];
    if (!ctx) return null;

    var origPrio = card.getAttribute('data-orig-priority');
    var newPrio = card.querySelector('[data-prio]').value;
    var origRice = card.getAttribute('data-orig-rice');
    var newRice = card.querySelector('[data-rice]').value;
    var hadRice = card.getAttribute('data-has-rice') === '1';

    var prioChanged = newPrio !== origPrio;
    var riceChanged = String(newRice) !== String(origRice);
    if (!prioChanged && !riceChanged) return null;

    // Work on a copy of the raw frontmatter lines (0-based within frontmatter).
    var lines = ctx.fmLines.slice();
    var pIdx = ctx.priorityLineIdx;
    var rIdx = ctx.riceLineIdx;

    // Determine the hunk window: from one line before the earliest touched
    // line through the last touched line. Insert of a new rice_score goes
    // directly after priority.
    var changed = [];   // {idx, oldText, newText, insert?}
    if (prioChanged && pIdx >= 0) {
      changed.push({ idx: pIdx, oldText: lines[pIdx], newText: 'priority: ' + newPrio });
    }
    if (riceChanged) {
      if (hadRice && rIdx >= 0) {
        changed.push({ idx: rIdx, oldText: lines[rIdx], newText: 'rice_score: ' + newRice });
      } else if (pIdx >= 0) {
        // Insert a new rice_score line immediately after priority.
        changed.push({ idx: pIdx, insertAfter: true, newText: 'rice_score: ' + newRice });
      }
    }
    if (!changed.length) return null;

    // Hunk window with 1 context line each side of the touched range.
    var touched = changed.map(function (c) { return c.idx; });
    var first = Math.min.apply(null, touched);
    var last = Math.max.apply(null, touched);
    var winStart = Math.max(0, first - 1);
    var winEnd = Math.min(lines.length - 1, last + 1);

    // File line numbers: frontmatter line i (0-based) is file line i + fmLineOffset.
    var oldStart = winStart + ctx.fmLineOffset;
    var oldCount = (winEnd - winStart + 1);
    var newCount = oldCount + changed.filter(function (c) { return c.insertAfter; }).length;
    var newStart = oldStart;

    var header = '--- a/' + ctx.file + '\\n+++ b/' + ctx.file + '\\n';
    var hunkHead = '@@ -' + oldStart + ',' + oldCount + ' +' + newStart + ',' + newCount + ' @@';

    // Interleave context/removed/added in proper unified order: walk window,
    // emitting context as ' ', and for changed lines emit '-old' then '+new'.
    var body = [];
    for (var j = winStart; j <= winEnd; j++) {
      var rep = changed.filter(function (c) { return c.idx === j && !c.insertAfter; })[0];
      var ins = changed.filter(function (c) { return c.idx === j && c.insertAfter; })[0];
      if (rep) {
        body.push('-' + lines[j]);
        body.push('+' + rep.newText);
      } else {
        body.push(' ' + lines[j]);
      }
      if (ins) body.push('+' + ins.newText);
    }

    return header + hunkHead + '\\n' + body.join('\\n') + '\\n';
  }

  function buildPatch() {
    var parts = [];
    cards().forEach(function (c) {
      var d = diffFile(c);
      if (d) parts.push(d);
    });
    if (!parts.length) {
      return '# No changes to export. Adjust a priority or RICE slider first.\\n' +
             '# (Reordering cards changes display position only — priority is the persisted rank.)\\n';
    }
    return parts.join('');
  }

  var out = document.getElementById('export-out');
  var status = document.getElementById('export-status');
  function setStatus(msg, cls) {
    if (!status) return;
    status.textContent = msg;
    status.className = 'export-status' + (cls ? ' ' + cls : '');
  }
  function doExport() {
    out.value = buildPatch();
    setStatus('Patch generated. Review, then Copy or Ctrl+C, save as .patch, git apply.', 'ok');
  }
  function doCopy() {
    if (!out.value) doExport();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(out.value).then(function () {
        setStatus('Copied to clipboard.', 'ok');
      }).catch(fallbackCopy);
    } else {
      fallbackCopy();
    }
  }
  function fallbackCopy() {
    out.focus(); out.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    setStatus(ok ? 'Copied (fallback).' : 'Clipboard blocked — text selected, press Ctrl+C.', ok ? 'ok' : 'err');
  }

  ['export-btn', 'export-btn-2'].forEach(function (idn) {
    var b = document.getElementById(idn);
    if (b) b.addEventListener('click', doExport);
  });
  ['copy-btn', 'copy-btn-2'].forEach(function (idn) {
    var b = document.getElementById(idn);
    if (b) b.addEventListener('click', doCopy);
  });

  renumber();
})();
</script>
</body>
</html>
`;
}

/* ============================================================
 * Main
 * ============================================================ */

function main() {
  const items = collect();
  const html = buildHtml(items);
  const outDir = path.dirname(OUT_FILE);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(OUT_FILE, html, 'utf8');
  console.log('✓ pm:board — produced ' + items.length + ' card(s) → ' +
    path.relative(path.resolve(PM_ROOT, '..'), OUT_FILE).replace(/\\/g, '/'));
  process.exit(0);
}

main();
