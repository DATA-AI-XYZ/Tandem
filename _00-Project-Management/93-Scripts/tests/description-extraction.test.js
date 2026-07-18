#!/usr/bin/env node
/**
 * description-extraction.test.js — unit test for generate-dashboard.js's description
 * resolution path (STORY-21.5.03 Cases D+E / TESTPLAN-21.5.03 TC-04, TC-05).
 *
 * BUG-20260618-03:
 *   Case D — a YAML block-scalar `description: |` frontmatter value rendered as the
 *   literal `|` in item drawers, because the kit's lightweight frontmatter parser
 *   (`parseFrontmatterAndBody`, local to generate-dashboard.js) left the bare block-
 *   scalar indicator as the value instead of consuming the indented body that follows
 *   it. Fixed at the root: the parser now supports `|` (literal) and `>` (folded)
 *   block scalars. `resolveDescription(fm, body)` additionally guards a bare '|'/'>'
 *   indicator that might still reach it from some other caller (belt-and-suspenders).
 *
 *   Case E — with no `description:` frontmatter at all, the old fallback
 *   (`firstLine(body)`) returned the body's first line verbatim, including a raw
 *   markdown heading (`# File Analysis Tool`). `resolveDescription` now falls back to
 *   `firstProseLine(body)`, which skips blank/heading/blockquote/list-marker/rule
 *   lines to the first genuine prose line (stripping leading markdown tokens), and
 *   finally to a neutral placeholder when no prose line exists at all.
 *
 * Modes (mirrors the two TESTPLAN-21.5.03 test cases so both can be run standalone):
 *   --case block-scalar     TC-04 — a `description: |` fixture resolves to the block
 *                            body text; a bare '|' result is asserted impossible.
 *   --case heading-fallback TC-05 — a no-description fixture whose body opens with an
 *                            H1 heading resolves to the first prose line (or the
 *                            neutral placeholder), never a string starting with '#'.
 *   (no --case / --case all) runs both, plus a few supporting checks.
 *
 * Exit 0 = pass, non-zero = fail. Dependency-free (Node stdlib only).
 */

'use strict';

const path = require('path');

const SCRIPTS_ROOT = path.resolve(__dirname, '..');
const DASHBOARD = path.join(SCRIPTS_ROOT, 'generate-dashboard.js');
const { parseFrontmatterAndBody, resolveDescription } = require(DASHBOARD);

let failures = 0;
function check(name, cond) {
  if (cond) { console.log('  ok  - ' + name); }
  else { console.log('  FAIL- ' + name); failures += 1; }
}

function fixture(lines) {
  return lines.join('\n');
}

// ---------------------------------------------------------------------
// TC-04 — block-scalar description renders (Case D).
// ---------------------------------------------------------------------
function runBlockScalarCase() {
  console.log('--- case: block-scalar (TC-04) ---');

  const content = fixture([
    '---',
    'name: agent-creator',
    'description: |',
    '  Use this agent when the user asks to "create an agent", "generate an agent",',
    '  or describes agent functionality they need.',
    '---',
    '# agent-creator',
    '',
    'Reference body text — unaffected by the description bug (already rendered fully).',
  ]);

  const { fm, body } = parseFrontmatterAndBody(content);
  check('parseFrontmatterAndBody returns a frontmatter object', !!fm);
  check("fm.description is NOT the bare block-scalar indicator '|'", fm.description !== '|');
  check(
    'fm.description contains the block body text',
    typeof fm.description === 'string' && fm.description.indexOf('Use this agent when the user asks to "create an agent"') === 0
  );
  check(
    'fm.description carries both block-scalar lines (literal style joins with a newline)',
    fm.description.split('\n').length === 2
  );

  const resolved = resolveDescription(fm, body);
  check("resolveDescription never returns the bare '|'", resolved !== '|');
  check("resolveDescription result === '|' is impossible", !(resolved.trim() === '|'));
  check(
    'resolveDescription returns the real description prose',
    resolved.indexOf('Use this agent when the user asks to "create an agent"') === 0
  );

  // Folded style (`>`) — same guarantee, different join rule (spaces, not newlines).
  const foldedContent = fixture([
    '---',
    'name: some-skill',
    'description: >',
    '  Folded description',
    '  spanning two source lines.',
    '---',
    'body',
  ]);
  const folded = parseFrontmatterAndBody(foldedContent);
  check("folded '>' block scalar is NOT the bare indicator", folded.fm.description !== '>');
  check(
    'folded description joins its lines with spaces, not newlines',
    folded.fm.description === 'Folded description spanning two source lines.'
  );

  // Defense-in-depth: resolveDescription still recovers even if handed a raw '|'
  // (e.g. an fm object built by some other, unpatched caller).
  const guarded = resolveDescription({ description: '|' }, '# Heading\n\nActual prose line here.');
  check("resolveDescription guards a literal '|' fm.description and falls back to prose", guarded === 'Actual prose line here.');
}

// ---------------------------------------------------------------------
// TC-05 — heading-fallback yields prose or placeholder (Case E).
// ---------------------------------------------------------------------
function runHeadingFallbackCase() {
  console.log('--- case: heading-fallback (TC-05) ---');

  // No `description:` at all; body opens with the exact heading from the bug report.
  const content = fixture([
    '---',
    'name: check-file',
    '---',
    '# File Analysis Tool',
    '',
    'Analyzes files for common issues and reports actionable findings.',
  ]);
  const { fm, body } = parseFrontmatterAndBody(content);
  check('fixture has no description frontmatter', !fm.description);

  const resolved = resolveDescription(fm, body);
  check('resolved description is not empty', !!resolved);
  check("resolved description never starts with '#'", resolved.charAt(0) !== '#');
  check(
    'resolved description is the first prose line, markdown-clean',
    resolved === 'Analyzes files for common issues and reports actionable findings.'
  );

  // No prose anywhere in the body — only a heading. Must fall back to the neutral
  // placeholder, never a raw heading and never an empty string.
  const headingOnly = fixture(['---', 'name: x', '---', '# Just A Heading', '']);
  const p2 = parseFrontmatterAndBody(headingOnly);
  const resolved2 = resolveDescription(p2.fm, p2.body);
  check("heading-only body never yields a string starting with '#'", resolved2.charAt(0) !== '#');
  check('heading-only body falls back to the neutral placeholder', resolved2 === 'No description provided.');

  // Blockquote and list-marker lines are also skipped en route to real prose.
  const skipLines = fixture([
    '---', 'name: y', '---',
    '# Heading',
    '',
    '> a blockquote line',
    '- a list item',
    '1. a numbered item',
    '',
    'Finally, the real prose line.',
  ]);
  const p3 = parseFrontmatterAndBody(skipLines);
  const resolved3 = resolveDescription(p3.fm, p3.body);
  check(
    'blockquote/list-marker lines are skipped en route to the first prose line',
    resolved3 === 'Finally, the real prose line.'
  );
}

function main() {
  const args = process.argv.slice(2);
  const caseIdx = args.indexOf('--case');
  const which = caseIdx >= 0 ? args[caseIdx + 1] : 'all';

  check('parseFrontmatterAndBody is exported as a function', typeof parseFrontmatterAndBody === 'function');
  check('resolveDescription is exported as a function', typeof resolveDescription === 'function');

  if (which === 'block-scalar') {
    runBlockScalarCase();
  } else if (which === 'heading-fallback') {
    runHeadingFallbackCase();
  } else {
    runBlockScalarCase();
    runHeadingFallbackCase();
  }

  if (failures === 0) {
    console.log('\n✓ description-extraction (' + which + ') — all checks passed.');
    process.exit(0);
  }
  console.log('\n✗ description-extraction (' + which + ') — ' + failures + ' check(s) failed.');
  process.exit(1);
}

main();
