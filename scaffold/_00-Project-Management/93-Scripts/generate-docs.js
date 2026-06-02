#!/usr/bin/env node
/**
 * generate-docs.js
 *
 * Renders each documentation/*.md to a sibling documentation/*.html.
 *
 * Contract:
 *   - Reads every *.md from the documentation/ folder at project root.
 *   - Writes a self-contained *.html (same basename) beside each *.md.
 *   - HTML inlines the kit's brand tokens / design system (no external CSS).
 *   - Dependency-free: Node.js stdlib only (fs, path).
 *   - Idempotent: same input → same HTML (generated-at appears only in an
 *     HTML comment, not in the styled body, so the body is always stable).
 *   - Degrades gracefully if documentation/ is missing or empty.
 *
 * Usage:
 *   node _00-Project-Management/93-Scripts/generate-docs.js
 *   npm run pm:docs
 *
 * Override the documentation folder via DOC_ROOT env var (useful for testing):
 *   DOC_ROOT=/tmp/my-docs node _00-Project-Management/93-Scripts/generate-docs.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

/* ============================================================
 * Paths
 * ============================================================ */

// Script lives at _00-Project-Management/93-Scripts/generate-docs.js.
// Project root is two levels up.
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Allow override via env for test isolation — default to documentation/ at project root.
const DOC_ROOT = process.env.DOC_ROOT
  ? path.resolve(process.env.DOC_ROOT)
  : path.join(REPO_ROOT, 'documentation');

/* ============================================================
 * Helpers
 * ============================================================ */

function existsDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function readFileSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
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

/* ============================================================
 * Markdown → HTML  (minimal, stdlib-only)
 * Handles: headings, paragraphs, fenced code, inline code,
 *          ul/ol lists, blockquotes, tables, links, bold/italic, hr.
 * ============================================================ */

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
    // Inline code (must come first, before bold/italic so backtick content is left alone)
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Bold
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic (underscore form, word-boundary aware)
    s = s.replace(/(^|\s|\()_([^_\n]+)_(?=$|\s|[.,;:!?\)])/g, '$1<em>$2</em>');
    // Links
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, txt, href) {
      const safe = /^(https?:|mailto:|#|\.\.?\/)/.test(href) ? href : '#';
      const ext = safe.startsWith('http') ? ' target="_blank" rel="noopener"' : '';
      return '<a href="' + safe + '"' + ext + '>' + txt + '</a>';
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

    // Fenced code block continuation
    if (inCode) {
      if (line.trim().startsWith('```')) {
        out += '<pre><code' + (codeLang ? ' class="lang-' + escapeHtml(codeLang) + '"' : '') + '>'
             + escapeHtml(codeBuf.join('\n')) + '</code></pre>\n';
        inCode = false; codeBuf = []; codeLang = '';
      } else {
        codeBuf.push(line);
      }
      continue;
    }

    // Fenced code block open
    const codeStart = line.match(/^```(\w*)\s*$/);
    if (codeStart) {
      flushPara(); closeList(); flushTable(); flushBlockquote();
      inCode = true; codeLang = codeStart[1];
      continue;
    }

    // Table: current line has | and next line is a separator
    if (
      line.indexOf('|') !== -1 &&
      i + 1 < lines.length &&
      /^\s*\|?\s*:?-+:?(\s*\|\s*:?-+:?)+\s*\|?\s*$/.test(lines[i + 1])
    ) {
      flushPara(); closeList(); flushBlockquote();
      const headers = line
        .split('|')
        .map(s => s.trim())
        .filter((_, idx, a) => !(idx === 0 && a[0] === '') && !(idx === a.length - 1 && a[a.length - 1] === ''));
      table = { headers, rows: [] };
      i++; // skip separator line
      while (i + 1 < lines.length && lines[i + 1].indexOf('|') !== -1 && lines[i + 1].trim() !== '') {
        i++;
        const cells = lines[i]
          .split('|')
          .map(s => s.trim())
          .filter((_, idx, a) => !(idx === 0 && a[0] === '') && !(idx === a.length - 1 && a[a.length - 1] === ''));
        table.rows.push(cells);
      }
      flushTable();
      continue;
    }

    // Horizontal rule
    if (/^---+\s*$/.test(line)) {
      flushPara(); closeList(); flushBlockquote();
      out += '<hr>\n';
      continue;
    }

    // Headings
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushPara(); closeList(); flushBlockquote();
      const level = heading[1].length;
      // Build an id slug for anchor linking
      const headingId = String(heading[2]).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      out += '<h' + level + ' id="' + headingId + '">' + inline(heading[2]) + '</h' + level + '>\n';
      continue;
    }

    // Blockquote
    const bq = line.match(/^>\s?(.*)$/);
    if (bq) {
      flushPara(); closeList();
      blockquote.push(bq[1]);
      continue;
    }
    if (blockquote.length) flushBlockquote();

    // Unordered list
    const ul = line.match(/^[-*]\s+(.+)$/);
    if (ul) {
      flushPara();
      if (!inList || listType !== 'ul') { closeList(); out += '<ul>\n'; inList = true; listType = 'ul'; }
      out += '<li>' + inline(ul[1]) + '</li>\n';
      continue;
    }

    // Ordered list
    const ol = line.match(/^\d+\.\s+(.+)$/);
    if (ol) {
      flushPara();
      if (!inList || listType !== 'ol') { closeList(); out += '<ol>\n'; inList = true; listType = 'ol'; }
      out += '<li>' + inline(ol[1]) + '</li>\n';
      continue;
    }

    // Blank line → flush para / close list
    if (line.trim() === '') {
      flushPara(); closeList();
      continue;
    }

    // Paragraph accumulation
    para.push(line);
  }

  // Flush any trailing state
  flushPara(); closeList(); flushBlockquote(); flushTable();
  if (inCode) {
    out += '<pre><code>' + escapeHtml(codeBuf.join('\n')) + '</code></pre>\n';
  }
  return out;
}

/* ============================================================
 * Strip YAML frontmatter and return { title, body }
 * ============================================================ */

function parseMd(content) {
  if (!content) return { title: '', body: '' };
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  let body = fmMatch ? (fmMatch[2] || '').trim() : content.trim();
  let title = '';
  // Extract title from first h1 in body, or derive from first line
  const h1 = body.match(/^#\s+(.+)$/m);
  if (h1) {
    title = h1[1].trim();
  }
  return { title, body };
}

/* ============================================================
 * Brand CSS — inlined design tokens matching the kit visual identity
 * Mirrors the :root block in generate-dashboard.js
 * ============================================================ */

const BRAND_CSS = `
:root {
  /* Foundation */
  --cream: #F5F0E8;
  --cream-2: #EBE5D8;
  --surface: #FAF8F4;
  --surface-2: #F1ECE3;
  --ink: #1A1714;
  --ink-2: #3D3831;
  --ink-3: #6B6358;
  --ink-faint: #9E9589;
  --border: #DDD6C8;
  --line: #DDD6C8;

  /* Brand accents */
  --red: #D63031;
  --red-soft: #F8E0E0;
  --yellow: #F0B429;
  --yellow-soft: #FAE9C0;
  --blue: #2D6CDF;
  --blue-soft: #DCE7F8;
  --teal: #0D9488;
  --teal-soft: #CFEAE6;

  /* Semantic */
  --success: var(--teal);
  --success-soft: var(--teal-soft);
  --warn: var(--yellow);
  --warn-soft: var(--yellow-soft);
  --danger: var(--red);
  --danger-soft: var(--red-soft);

  /* Shape */
  --r: 12px;
  --r-sm: 10px;
  --r-lg: 16px;
  --r-pill: 100px;

  /* Shadow */
  --shadow-sm: 0 1px 2px rgba(26,23,20,0.06);
  --shadow: 0 4px 14px rgba(26,23,20,0.08);
  --shadow-lg: 0 18px 40px rgba(26,23,20,0.16);

  /* Type */
  --serif: 'Instrument Serif', Georgia, 'Times New Roman', serif;
  --sans: 'Manrope', -apple-system, 'Segoe UI', system-ui, sans-serif;
  --mono: 'JetBrains Mono', Consolas, ui-monospace, monospace;

  /* Motion */
  --ease: cubic-bezier(0.16, 1, 0.3, 1);
  --dur-fast: 160ms;
  --dur: 320ms;

  /* Focus */
  --focus-ring: rgba(214,48,49,0.45);

  /* Scrollbar */
  --sb-thumb: #CFC6B7;
}

@media (prefers-color-scheme: dark) {
  :root {
    --cream: #15120F;
    --cream-2: #1C1814;
    --surface: #1A1612;
    --surface-2: #221D17;
    --ink: #F1ECE3;
    --ink-2: #D8CFC0;
    --ink-3: #9E9589;
    --ink-faint: #6B6358;
    --border: #312A22;
    --line: #312A22;
    --red: #E25558;
    --red-soft: rgba(226,85,88,0.16);
    --yellow: #F2C24A;
    --yellow-soft: rgba(242,194,74,0.16);
    --blue: #5B8DE8;
    --blue-soft: rgba(91,141,232,0.18);
    --teal: #2BB3A6;
    --teal-soft: rgba(43,179,166,0.18);
    --shadow-sm: 0 1px 2px rgba(0,0,0,0.35);
    --shadow: 0 6px 18px rgba(0,0,0,0.45);
    --shadow-lg: 0 26px 50px rgba(0,0,0,0.55);
    --focus-ring: rgba(226,85,88,0.5);
    --sb-thumb: #2E2820;
  }
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }
body {
  font-family: var(--sans);
  color: var(--ink);
  background: var(--cream);
  line-height: 1.65;
  font-size: 15px;
  -webkit-font-smoothing: antialiased;
  padding: 0 1rem 4rem;
}
::selection { background: var(--yellow); color: var(--ink); }
:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--focus-ring); border-radius: var(--r-sm); }

/* Scrollbar */
* { scrollbar-width: thin; scrollbar-color: var(--sb-thumb) transparent; }
*::-webkit-scrollbar { width: 8px; height: 8px; }
*::-webkit-scrollbar-thumb { background: var(--sb-thumb); border-radius: var(--r-pill); }

/* Layout */
.doc-wrap {
  max-width: 760px;
  margin: 0 auto;
  padding: 3rem 0 2rem;
}

/* Header */
.doc-header {
  border-bottom: 1px solid var(--border);
  padding-bottom: 1.75rem;
  margin-bottom: 2.5rem;
}
.brand-mark {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 1.5rem;
}
.brand-dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
}
.brand-dot.r { background: var(--red); }
.brand-dot.y { background: var(--yellow); }
.brand-dot.b { background: var(--blue); }
.doc-title {
  font-family: var(--serif);
  font-size: 2.4rem;
  font-weight: 400;
  line-height: 1.15;
  letter-spacing: -0.015em;
  color: var(--ink);
  margin-bottom: 0.5rem;
}
.doc-subtitle {
  font-family: var(--sans);
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-3);
}

/* Body content */
.doc-body { }

.doc-body h1 {
  font-family: var(--serif);
  font-size: 2rem;
  font-weight: 400;
  letter-spacing: -0.015em;
  line-height: 1.2;
  margin: 2.5rem 0 0.75rem;
  color: var(--ink);
}
.doc-body h2 {
  font-family: var(--serif);
  font-size: 1.45rem;
  font-weight: 400;
  letter-spacing: -0.01em;
  line-height: 1.25;
  margin: 2rem 0 0.6rem;
  color: var(--ink);
}
.doc-body h3 {
  font-family: var(--sans);
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  margin: 1.75rem 0 0.5rem;
  color: var(--ink-faint);
}
.doc-body h4, .doc-body h5, .doc-body h6 {
  font-family: var(--sans);
  font-size: 0.95rem;
  font-weight: 600;
  margin: 1.5rem 0 0.4rem;
  color: var(--ink-2);
}
.doc-body p {
  margin: 0 0 1rem;
  color: var(--ink);
}
.doc-body ul, .doc-body ol {
  margin: 0.5rem 0 1rem 1.5rem;
  color: var(--ink);
}
.doc-body li {
  margin-bottom: 0.3rem;
}
.doc-body a {
  color: var(--blue);
  text-decoration: underline;
  text-decoration-color: rgba(45,108,223,0.35);
  text-underline-offset: 2px;
}
.doc-body a:hover {
  text-decoration-color: var(--blue);
}
.doc-body code {
  font-family: var(--mono);
  font-size: 0.85em;
  background: var(--surface-2);
  border: 1px solid var(--border);
  padding: 0.1rem 0.4rem;
  border-radius: 5px;
  color: var(--ink);
}
.doc-body pre {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 1rem 1.1rem;
  overflow-x: auto;
  margin: 0.75rem 0 1.25rem;
  font-family: var(--mono);
  font-size: 0.83rem;
  line-height: 1.55;
}
.doc-body pre code {
  background: none;
  border: none;
  padding: 0;
  font-size: inherit;
}
.doc-body blockquote {
  border-left: 3px solid var(--border);
  margin: 1rem 0;
  padding: 0.4rem 0 0.4rem 1.1rem;
  color: var(--ink-3);
  font-style: italic;
}
.doc-body hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 2rem 0;
}

/* Tables */
.md-table-wrap {
  overflow-x: auto;
  margin: 0.75rem 0 1.25rem;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
}
.md-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}
.md-table th {
  background: var(--surface-2);
  font-family: var(--sans);
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ink-3);
  padding: 0.6rem 0.9rem;
  text-align: left;
  border-bottom: 1px solid var(--border);
}
.md-table td {
  padding: 0.6rem 0.9rem;
  border-bottom: 1px solid var(--border);
  color: var(--ink);
  vertical-align: top;
}
.md-table tbody tr:last-child td {
  border-bottom: none;
}
.md-table tbody tr:hover td {
  background: var(--surface);
}

/* Footer */
.doc-footer {
  margin-top: 3.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--border);
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--ink-faint);
}
`;

/* ============================================================
 * HTML page template
 * ============================================================ */

function renderPage(title, bodyHtml, docFilename) {
  const pageTitle = escapeHtml(title || docFilename || 'Documentation');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;700&family=Manrope:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <style>${BRAND_CSS}
  </style>
</head>
<body>
  <div class="doc-wrap">
    <header class="doc-header">
      <div class="brand-mark">
        <div class="brand-dot r"></div>
        <div class="brand-dot y"></div>
        <div class="brand-dot b"></div>
      </div>
      <h1 class="doc-title">${pageTitle}</h1>
      <span class="doc-subtitle">Tandem · PM Operating Kit</span>
    </header>
    <main class="doc-body">
${bodyHtml}    </main>
    <footer class="doc-footer">
      Source: ${escapeHtml(docFilename)}
    </footer>
  </div>
</body>
</html>
`;
}

/* ============================================================
 * Main
 * ============================================================ */

function main() {
  // Graceful degradation: missing or non-directory documentation/ folder.
  if (!existsDir(DOC_ROOT)) {
    console.log('[generate-docs] documentation/ folder not found — nothing to render (' + DOC_ROOT + ')');
    return;
  }

  let entries;
  try {
    entries = fs.readdirSync(DOC_ROOT, { withFileTypes: true });
  } catch (err) {
    console.error('[generate-docs] Cannot read documentation/ folder:', err.message);
    return;
  }

  const mdFiles = entries
    .filter(e => e.isFile() && e.name.endsWith('.md'))
    .map(e => e.name)
    .sort();

  if (mdFiles.length === 0) {
    console.log('[generate-docs] No *.md files found in documentation/ — nothing to render.');
    return;
  }

  let written = 0;
  let skipped = 0;

  for (const mdName of mdFiles) {
    const mdPath  = path.join(DOC_ROOT, mdName);
    const base    = path.basename(mdName, '.md');
    const htmlName = base + '.html';
    const htmlPath = path.join(DOC_ROOT, htmlName);

    const content = readFileSafe(mdPath);
    if (content === null) {
      console.warn('[generate-docs] Could not read ' + mdName + ' — skipping.');
      skipped++;
      continue;
    }

    const { title, body } = parseMd(content);
    const bodyHtml = mdToHtml(body);
    const html = renderPage(title || base, bodyHtml, mdName);

    try {
      fs.writeFileSync(htmlPath, html, 'utf8');
      console.log('[generate-docs] Wrote ' + htmlName);
      written++;
    } catch (err) {
      console.error('[generate-docs] Failed to write ' + htmlName + ':', err.message);
      skipped++;
    }
  }

  console.log('[generate-docs] Done — ' + written + ' file(s) written' + (skipped ? ', ' + skipped + ' skipped.' : '.'));
}

main();
