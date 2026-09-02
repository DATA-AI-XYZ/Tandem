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

// STORY-30.4.01 / BACKLOG-0114 — THE canonical markdown parser, imported, not
// re-implemented. This file used to carry its own `function mdToHtml(md)`, a
// fork of the board's parser taken before either had grown up. Every renderer
// fix since the split — HTML-comment stripping (STORY-21.5.02), the image rule
// and its dangling-bang fix (BUG-20260618-02), the raw-block allow-list and its
// attribute filter (BUG-20260731-03), structure-aware blockquotes and nested /
// task lists (STORY-25.2.01) — landed on the board's copy and never reached the
// docs. Deleted under ADR-0139's annotate-then-delete rule; see ADR-0205 for
// what the convergence changed and why heading anchors stayed behind here.
const { mdToHtml } = require('./generate-dashboard.js');

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
 * Markdown → HTML  ·  the DOCS ENTRY POINT
 *
 * There is no parser here. `mdToHtml` is imported from
 * generate-dashboard.js at the top of this file (STORY-30.4.01) — this
 * section is the thin docs-specific wrapper around it.
 *
 * The only thing the docs need that the board must NOT have is heading
 * anchors, so that is the whole of the wrapper.
 * ============================================================ */

// Reverse of the parser's escapeHtml, for slug computation only — never for
// output. The old docs-local parser slugged the RAW markdown heading text; the
// canonical parser hands us the RENDERED inner HTML, so the text has to be put
// back the way the slugger used to see it (tags dropped, entities decoded) or a
// heading like `## The \`pm:*\` scripts` would slug to `the-code-pm-code-scripts`
// and every in-page link to it would 404 in place.
function headingSlugText(innerHtml) {
  return String(innerHtml)
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function headingSlug(innerHtml) {
  return headingSlugText(innerHtml)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// STORY-30.4.01 / ADR-0205 — heading anchors are a DOCS decoration, applied
// after parsing, deliberately not pushed into the shared parser.
//
// documentation/*.md contains in-page links (`[Standards](#standards)`), which
// need `<h2 id="standards">`. The board must not emit those ids: DASHBOARD.html
// renders ~1,500 artefact bodies into ONE document, and near-every artefact has
// a `## Summary`, so per-heading ids there would be mass duplicate-id collisions
// on a single page. Keeping the anchors out here is what lets both surfaces
// share one parser instead of forking it again over a one-surface need.
//
// Operates on emitted HTML rather than on markdown, safely: a literal `<h2>`
// written inside a fenced code block reaches the output as `&lt;h2&gt;`, so the
// tag pattern below can only ever match a heading the parser itself emitted.
// A heading whose text slugs to nothing (e.g. `## ***`) is left without an id
// rather than given `id=""`.
function addHeadingIds(html) {
  if (!html) return '';
  return html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, function (whole, level, inner) {
    const slug = headingSlug(inner);
    if (!slug) return whole;
    return '<h' + level + ' id="' + slug + '">' + inner + '</h' + level + '>';
  });
}

// THE DOCS ENTRY POINT. Everything that renders a documentation page body goes
// through here, and tests/mdtohtml.test.js --case docs-entry-parity drives THIS
// function (not the imported parser directly) so the pair cannot silently
// re-diverge: if anyone re-adds a local parser or a body-mutating pass, the
// parity assertion against the board's parser fails.
function renderDocBody(md) {
  return addHeadingIds(mdToHtml(md));
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
    const bodyHtml = renderDocBody(body);
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

// STORY-30.4.01 — test seam, matching the one at the bottom of
// generate-dashboard.js. `main()` used to run unconditionally on load, which is
// precisely why nothing could reach the docs renderer from a test: any
// `require()` of this file rendered the whole documentation folder as a side
// effect. Guarded, so tests/mdtohtml.test.js --case docs-entry-parity can drive
// the SHIPPED docs entry point rather than a re-typed copy of it — the same
// reason phase-band-source.test.js drives the shipped reader.
if (require.main === module) main();

module.exports = { renderDocBody, addHeadingIds, headingSlug, parseMd };
