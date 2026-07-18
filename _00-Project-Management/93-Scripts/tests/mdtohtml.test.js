#!/usr/bin/env node
/**
 * mdtohtml.test.js — renderer fixture test for mdToHtml() (STORY-21.5.02 /
 * BUG-20260618-02 / TESTPLAN-21.5.02).
 *
 * Drives mdToHtml() DIRECTLY via the module's require() test seam (see the
 * "Test seam (STORY-09.4.01)" module.exports block at the bottom of
 * generate-dashboard.js) — no child process, no full-dashboard generation.
 *
 * Modes (TESTPLAN-21.5.02 TC-01..04):
 *   node mdtohtml.test.js --case comments    — TC-01: comment stripping
 *   node mdtohtml.test.js --case images      — TC-02: image rule / no dangling bang
 *   node mdtohtml.test.js --case rawhtml     — TC-03: raw block tag passthrough
 *   node mdtohtml.test.js --case regression  — TC-04: existing subset unregressed
 *
 * Exit 0 = pass, non-zero = fail. Dependency-free (Node stdlib only).
 */
'use strict';

const path = require('path');
const { mdToHtml } = require(path.join(__dirname, '..', 'generate-dashboard.js'));

let failures = 0;
function check(name, cond) {
  if (cond) { console.log('  ok  - ' + name); }
  else { console.log('  FAIL- ' + name); failures += 1; }
}

/* ============================================================
 * TC-01 · Comments stripped
 * ============================================================ */
function runComments() {
  // Single-line comment.
  {
    const html = mdToHtml('Before.\n\n<!-- a single line comment -->\n\nAfter.');
    check('single-line comment: no comment text in output', !html.includes('a single line comment'));
    check('single-line comment: not escaped-visible either', !html.includes('&lt;!--'));
    check('single-line comment: surrounding text still renders', html.includes('Before.') && html.includes('After.'));
  }

  // Multi-line comment (BUG-20260618-02's actual repro shape).
  {
    const md = [
      '<!-- Screenshots live under docs/ once generated:',
      '![Tandem Command Center — light](docs/light.png)',
      '![Tandem Command Center — dark](docs/dark.png) -->',
      '',
      'Real content after.',
    ].join('\n');
    const html = mdToHtml(md);
    check('multi-line comment: no comment text in output', !html.includes('Screenshots live under docs'));
    check('multi-line comment: embedded image markdown inside the comment is gone too', !html.includes('docs/light.png') && !html.includes('docs/dark.png'));
    check('multi-line comment: no escaped literal either', !html.includes('&lt;!--'));
    check('multi-line comment: real content after it still renders', html.includes('Real content after.'));
  }

  // Unterminated comment must not swallow the rest of the document.
  {
    const md = [
      'Line one.',
      '<!-- this comment never closes',
      'Line two must still appear.',
      'Line three must still appear.',
    ].join('\n');
    const html = mdToHtml(md);
    check('unterminated comment: does not swallow the rest of the document', html.includes('Line two must still appear.') && html.includes('Line three must still appear.'));
    check('unterminated comment: opener text itself is gone', !html.includes('this comment never closes'));
    check('unterminated comment: leading content survives', html.includes('Line one.'));
  }

  // Comment INSIDE a fenced code block must survive untouched.
  {
    const md = [
      '```html',
      '<!-- this comment lives inside a fence and must survive -->',
      '```',
    ].join('\n');
    const html = mdToHtml(md);
    check('comment inside code fence: survives (escaped, but present)', html.includes('this comment lives inside a fence and must survive'));
    check('comment inside code fence: rendered as escaped code text', html.includes('&lt;!--') && html.includes('--&gt;'));
  }
}

/* ============================================================
 * TC-02 · Images render, no dangling bang
 * ============================================================ */
function runImages() {
  // Badge-style URL renders as an <img>.
  {
    const html = mdToHtml('![version](https://img.shields.io/npm/v/tandem)');
    check('badge image: renders an <img> tag', /<img[^>]*>/.test(html));
    check('badge image: alt text carried through', html.includes('alt="version"'));
    check('badge image: src carried through', html.includes('src="https://img.shields.io/npm/v/tandem"'));
    check('badge image: no dangling bang + link half-match', !html.includes('!<a ') && !/>\s*!\s*</.test(html));
  }

  // javascript: URI must be rejected — falls back to alt text, not an <img>.
  {
    const html = mdToHtml('![evil](javascript:alert(1))');
    check('javascript: URI image: rejected, no <img> emitted', !html.includes('<img'));
    check('javascript: URI image: falls back to alt text', html.includes('evil'));
    check('javascript: URI image: the raw scheme never reaches output', !html.includes('javascript:alert'));
  }

  // Multiple badges on one line (Tandem README shape) — none half-linkified.
  // (Uses allow-listed src schemes throughout; a bare relative filename like
  // the README's own `LICENSE` — no scheme, no leading ./ — is intentionally
  // outside the safeHref allow-list and covered separately below.)
  {
    const html = mdToHtml('![version](https://img.shields.io/badge/v-1.1.0-blue)  ![license](./LICENSE)  ![Claude Code plugin](https://img.shields.io/badge/plugin-blue)');
    const imgCount = (html.match(/<img[^>]*>/g) || []).length;
    check('multiple badges: three <img> tags emitted', imgCount === 3);
    check('multiple badges: no dangling-bang marker ">!<"', !html.includes('>!<'));
    check('multiple badges: no dangling ! before a link "!<a "', !html.includes('!<a '));
  }

  // Bare relative path (no scheme, no leading ./) — outside the safeHref
  // allow-list (same list the link rule has always used) — falls back to
  // alt text cleanly rather than emitting a broken <img src="LICENSE">.
  {
    const html = mdToHtml('![license](LICENSE)');
    check('bare relative path image: rejected, no <img> emitted', !html.includes('<img'));
    check('bare relative path image: falls back to alt text', html.includes('license'));
    check('bare relative path image: no dangling-bang marker ">!<"', !html.includes('>!<'));
  }

  // Relative-path image (allow-listed scheme) still renders.
  {
    const html = mdToHtml('![logo](./assets/logo.png)');
    check('relative-path image: renders as <img>', html.includes('<img alt="logo" src="./assets/logo.png">'));
  }
}

/* ============================================================
 * TC-03 · Raw block tags handled
 * ============================================================ */
function runRawHtml() {
  // <div align="center"> / </div> — Tandem's own README shape.
  {
    const md = [
      '<div align="center">',
      '',
      '# Tandem',
      '',
      '</div>',
    ].join('\n');
    const html = mdToHtml(md);
    check('div align=center: no escaped &lt;div literal in output', !html.includes('&lt;div'));
    check('div align=center: passed through verbatim', html.includes('<div align="center">'));
    check('closing </div>: no escaped &lt;/div literal in output', !html.includes('&lt;/div'));
    check('closing </div>: passed through verbatim', html.includes('</div>'));
    check('heading between the tags still renders', html.includes('<h1>Tandem</h1>'));
  }

  // <p align="center"> family.
  {
    const html = mdToHtml('<p align="center">\n\ncentered text\n\n</p>');
    check('p align=center: passed through verbatim, not escaped', html.includes('<p align="center">') && !html.includes('&lt;p'));
    check('closing </p>: passed through verbatim', html.includes('</p>'));
  }

  // Non-allow-listed tag (e.g. <script>) must stay escaped, never raw.
  {
    const html = mdToHtml('<script>alert(1)</script>');
    check('non-allow-listed <script>: stays escaped (no raw <script> tag emitted)', !html.includes('<script>'));
    check('non-allow-listed <script>: escaped form is present', html.includes('&lt;script&gt;'));
  }
}

/* ============================================================
 * TC-04 · Existing subset unregressed (incl. fenced-code counter-case)
 * ============================================================ */
function runRegression() {
  // Inline code / bold / em / links.
  {
    const html = mdToHtml('Some `code`, **bold**, _em_, and a [link](https://example.com/page).');
    check('inline code renders', html.includes('<code>code</code>'));
    check('bold renders', html.includes('<strong>bold</strong>'));
    check('em renders', html.includes('<em>em</em>'));
    check('link renders with target/rel', html.includes('<a href="https://example.com/page" target="_blank" rel="noopener">link</a>'));
  }

  // Table.
  {
    const md = [
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
    ].join('\n');
    const html = mdToHtml(md);
    check('table renders as a real table', html.includes('<table') && html.includes('<th>A</th>') && html.includes('<td>1</td>'));
  }

  // List.
  {
    const html = mdToHtml('- one\n- two\n- three');
    check('unordered list renders as <ul><li>', html.includes('<ul>') && (html.match(/<li>/g) || []).length === 3);
  }

  // Blockquote.
  {
    const html = mdToHtml('> a quoted line');
    check('blockquote renders', html.includes('<blockquote>') && html.includes('a quoted line'));
  }

  // Fenced block containing literal <!-- and <div> must render exactly as
  // before this change — fence contents are escaped code text, untouched by
  // either the comment pre-pass or the raw-HTML passthrough.
  {
    const md = [
      '```html',
      '<!-- a literal comment -->',
      '<div align="center">literal div</div>',
      '```',
    ].join('\n');
    const html = mdToHtml(md);
    check('fenced counter-case: <pre><code> wrapper present', html.includes('<pre><code'));
    check('fenced counter-case: comment text preserved (escaped) inside the fence', html.includes('a literal comment'));
    check('fenced counter-case: div text preserved (escaped) inside the fence', html.includes('literal div'));
    check('fenced counter-case: tags escaped, not raw, inside the fence', html.includes('&lt;div align=&quot;center&quot;&gt;') && !html.includes('<div align="center">literal div</div>'));
  }

  // Heading + hr still work (sanity: pre-pass didn't disturb line structure).
  {
    const html = mdToHtml('# Title\n\n---\n\nBody text.');
    check('heading renders', html.includes('<h1>Title</h1>'));
    check('hr renders', html.includes('<hr>'));
    check('body paragraph renders', html.includes('<p>Body text.</p>'));
  }
}

const CASES = {
  comments: runComments,
  images: runImages,
  rawhtml: runRawHtml,
  regression: runRegression,
};

const caseFlagIdx = process.argv.indexOf('--case');
const caseName = caseFlagIdx !== -1 ? process.argv[caseFlagIdx + 1] : null;

if (!caseName || !CASES[caseName]) {
  console.error('Usage: node mdtohtml.test.js --case comments | images | rawhtml | regression');
  process.exit(1);
}

CASES[caseName]();

if (failures === 0) {
  console.log('\n✓ mdtohtml — all checks passed (' + caseName + ').');
  process.exit(0);
}
console.log('\n✗ mdtohtml — ' + failures + ' check(s) failed (' + caseName + ').');
process.exit(1);
