'use strict';
/**
 * STORY-30.2.02 — wrap each h2-led section of a rendered drawer body in a
 * disclosure control.
 *
 * ONE DEFINITION, TWO RUNTIMES. The function below is required by Node (so
 * tests/drawer-folds.test.js can drive it directly, including the cases the live
 * corpus cannot supply) and imported by the ported board (board/src/artefact-body.jsx
 * → the shipped runtime bundle; the old BROWSER_JS inlining retired with
 * STORY-33.9.05). A hand-kept client copy is the shape BUG-20260812-01
 * filed against the walk roster: a thing maintained in two places is maintained
 * in one.
 *
 * THE IDIOM IS NATIVE `<details>`, and that choice is load-bearing — see ADR-0202.
 * The short version: sibling isolation, keyboard operation and the expanded/collapsed
 * state are all the browser's job here, not ours. STORY-30.3.01 exists because a
 * hand-rolled disclosure leaked state across siblings; this story is explicitly
 * required not to reproduce that class, and the cheapest way to not reproduce it is
 * to not hand-roll the mechanism.
 *
 * THE h2 SURVIVES INSIDE THE `<summary>`. Replacing it would have destroyed the
 * document outline, and would also have made the paired probe's "one fold per h2"
 * law unverifiable — it counts both.
 */

/**
 * @param {string} html rendered artefact body (mdToHtml output)
 * @returns {string} the same html with each h2-led section wrapped, or the input
 *   unchanged when there is nothing to fold
 */
function foldDrawerSections(html) {
  if (!html || typeof html !== 'string') return html;
  // Split BEFORE each TOP-LEVEL <h2 …>. A section runs from its own h2 up to the
  // next one.
  //
  // "TOP-LEVEL" IS LOAD-BEARING — BUG-20260817-06. The first version of this split
  // was `html.split(/(?=<h2[\s>])/)` and its comment said "mdToHtml emits a flat
  // block sequence". It does not: mdToHtmlAtDepth RECURSES into blockquotes
  // (generate-dashboard.js), so a quoted `> ##` in an artefact yields a real <h2>
  // nested inside a <blockquote>. Splitting there opened `<details>` INSIDE the
  // blockquote and closed it outside it — structurally invalid markup that HTML5
  // error recovery absorbs only while the blockquote happens to be the last thing
  // before the next top-level h2. Four artefacts in the live corpus hit it.
  //
  // The paired browser probe is structurally blind to this: it asserts
  // `folds === h2s`, and in every affected artefact both counts move together.
  // `tests/drawer-folds.test.js :: h2-inside-a-blockquote-is-not-a-section` and the
  // corpus-wide tag-balance sweep in that file are what actually hold this line.
  var parts = splitAtTopLevelH2(html);
  // Nothing to fold: no h2 at all, or a body that opens with one and has no other.
  // A short note must render EXACTLY as before — no empty disclosure chrome
  // (the story's gotcha).
  var headings = 0;
  for (var k = 0; k < parts.length; k++) {
    if (/^<h2[\s>]/.test(parts[k])) headings++;
  }
  if (headings === 0) return html;

  var out = '';
  for (var i = 0; i < parts.length; i++) {
    var seg = parts[i];
    var m = /^<h2([^>]*)>([\s\S]*?)<\/h2>/.exec(seg);
    if (!m) { out += seg; continue; } // the lead-in before the first h2
    var attrs = m[1];
    var headingInner = m[2];
    var rest = seg.slice(m[0].length);
    out += '<details class="drawer-fold" open>'
      + '<summary class="drawer-fold-head"><h2' + attrs + '>' + headingInner + '</h2></summary>'
      + '<div class="drawer-fold-body">' + rest + '</div>'
      + '</details>';
  }
  return out;
}

/**
 * Split `html` before every <h2 …> that is NOT inside a container, returning the
 * segments in document order.
 *
 * Depth is tracked over <blockquote> alone, because that is the ONE element
 * mdToHtmlAtDepth recurses into — every other block it emits (p, ul, ol, table,
 * pre, hr) is terminal and cannot contain a heading. Tracking it explicitly rather
 * than "anything nested" keeps the rule readable and keeps a stray unbalanced tag
 * elsewhere in a body from silently suppressing every fold.
 *
 * @param {string} html
 * @returns {string[]}
 */
function splitAtTopLevelH2(html) {
  var re = /<(\/?)(blockquote|h2)\b[^>]*>/gi;
  var parts = [];
  var depth = 0;
  var last = 0;
  var m;
  while ((m = re.exec(html)) !== null) {
    var closing = m[1] === '/';
    var tag = m[2].toLowerCase();
    if (tag === 'blockquote') {
      if (closing) { if (depth > 0) depth -= 1; } else { depth += 1; }
      continue;
    }
    if (closing) continue;      // </h2> is not a boundary
    if (depth !== 0) continue;  // a quoted heading is CONTENT of its section
    if (m.index === last) continue; // already at a boundary — no empty segment
    parts.push(html.slice(last, m.index));
    last = m.index;
  }
  parts.push(html.slice(last));
  return parts;
}

module.exports = {
  foldDrawerSections,
  splitAtTopLevelH2,
  /** The exact source shipped to the browser. */
  SOURCE: String(splitAtTopLevelH2) + '\n' + String(foldDrawerSections),
};
