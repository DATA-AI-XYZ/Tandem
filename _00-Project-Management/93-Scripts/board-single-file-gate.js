#!/usr/bin/env node
/**
 * board-single-file-gate.js — the single-file / payload-safety gate for the ported
 * Command Center (STORY-33.1.01 AC-2 · STORY-33.1.02 AC-1/AC-2 · CF-44 · ADR-0231).
 *
 *   node board-single-file-gate.js <board.html> [--expect-records N] [--json]
 *
 *   exit 0 — clean
 *   exit 1 — at least one violation (each is named on stderr)
 *   exit 2 — usage or environment error (no verdict was produced)
 *
 * Node stdlib only, and deliberately OUTSIDE the build workspace: it must be
 * runnable by anyone holding a board and nothing else — no bundler, no
 * `node_modules`, no framework (ADR-0226 §1).
 *
 * ===========================================================================
 * WHY A DEDICATED GATE RATHER THAN A GREP
 * ===========================================================================
 * Two facts about this document make the obvious check wrong.
 *
 * 1. THE PAYLOAD QUOTES THE HAZARD. The board inlines every artefact body, and
 *    those bodies legitimately contain the strings `type="module"`, `import(`,
 *    `<script src=` and `</script` — ADR-0191's own constraint table is IN the
 *    corpus. A whole-document grep for those tokens therefore reports the
 *    REQUIREMENTS as violations. This is the confound the kit already knows as
 *    BUG-20260609-01 and which the CONSUMER-PROOF wrote up as finding F5: the
 *    structure scan must run with the data bytes spliced out. This file does that.
 *
 * 2. THE STRUCTURE SCAN CANNOT SEE THE PAYLOAD HAZARD. A literal `</script` inside
 *    an embedded record body does not violate any structural rule — it ENDS THE
 *    SCRIPT ELEMENT, and everything after it becomes live markup the structure scan
 *    is then reading as ordinary document (CF-44). So the two checks are genuinely
 *    different questions and both are asked here.
 *
 * ===========================================================================
 * HOW THE PAYLOAD CHECK IS MODELLED
 * ===========================================================================
 * Not as a regex over the payload, but as the BROWSER'S OWN RULE: inside a script
 * element, the first `</script` (ASCII-case-insensitive) ends it. So the gate slices
 * the payload exactly where a parser would, then `JSON.parse`s the result. If a
 * terminator was planted in a record body, the slice ends early and the parse
 * throws — which is the same instant the browser would have started reading markup.
 * A gate that models the failure cannot be fooled by a spelling it did not predict.
 */

'use strict';

const fs = require('fs');

const USAGE = 'usage: node board-single-file-gate.js <board.html> [--expect-records <n>] [--json]';
const EXIT_USAGE = 2;

/** The literal the assembler emits, and the only payload marker this gate knows. */
const DATA_OPEN = '<script>window.__DATA = ';

/** Inside a script element the parser ends on this, case-insensitively. */
const SCRIPT_END = /<\/script/i;

function parseArgs(argv) {
  const out = { file: null, expectRecords: null, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') { out.json = true; continue; }
    if (a === '--expect-records') {
      const v = argv[++i];
      const n = Number(v);
      if (v === undefined || !Number.isFinite(n) || n < 0) {
        console.error(USAGE);
        console.error('--expect-records expects a non-negative integer');
        process.exit(EXIT_USAGE);
      }
      out.expectRecords = n;
      continue;
    }
    if (a.indexOf('-') === 0) {
      console.error(USAGE);
      console.error('unknown option "' + a + '"');
      process.exit(EXIT_USAGE);
    }
    if (out.file !== null) {
      console.error(USAGE);
      console.error('unexpected extra positional argument "' + a + '"');
      process.exit(EXIT_USAGE);
    }
    out.file = a;
  }
  if (!out.file) { console.error(USAGE); process.exit(EXIT_USAGE); }
  return out;
}

/**
 * Split the document into inline `<script>` bodies and everything else.
 *
 * Bodies are delimited the way a parser delimits them — first `</script` wins — so
 * this function's view of the document is the browser's view of it, not a
 * best-effort one. Returns the structural remainder plus each body with its offset.
 */
function splitScripts(html) {
  const bodies = [];
  let structure = '';
  let i = 0;
  for (;;) {
    const open = html.indexOf('<script', i);
    if (open === -1) { structure += html.slice(i); break; }
    const tagEnd = html.indexOf('>', open);
    if (tagEnd === -1) { structure += html.slice(i); break; }
    structure += html.slice(i, tagEnd + 1);          // keep the OPEN TAG: it is structure
    const rest = html.slice(tagEnd + 1);
    const m = SCRIPT_END.exec(rest);
    if (!m) { bodies.push({ start: tagEnd + 1, text: rest, unterminated: true }); break; }
    bodies.push({ start: tagEnd + 1, text: rest.slice(0, m.index), unterminated: false });
    i = tagEnd + 1 + m.index;                        // resume AT the closing tag
  }
  return { structure, bodies };
}

/** The record census: every top-level array in the payload. Derived here independently. */
function countRecords(data) {
  let total = 0;
  for (const k of Object.keys(data)) if (Array.isArray(data[k])) total += data[k].length;
  return total;
}

function main(argv) {
  const args = parseArgs(argv);
  let html;
  try { html = fs.readFileSync(args.file, 'utf8'); }
  catch (e) { console.error('[board-gate] cannot read ' + args.file + ': ' + e.message); return EXIT_USAGE; }

  const violations = [];
  const detail = { file: args.file, bytes: Buffer.byteLength(html) };

  const { structure, bodies } = splitScripts(html);
  detail.scriptBlocks = bodies.length;
  detail.structureBytes = Buffer.byteLength(structure);

  // -- 1. PAYLOAD SAFETY (CF-44) -------------------------------------------
  // Slice where a parser would slice, then parse. An early end IS the defect.
  const open = html.indexOf(DATA_OPEN);
  if (open === -1) {
    violations.push('no `window.__DATA` payload block found — this is not an assembled board');
  } else {
    const after = html.slice(open + DATA_OPEN.length);
    const end = SCRIPT_END.exec(after);
    if (!end) {
      violations.push('the `window.__DATA` script element is never closed');
    } else {
      let text = after.slice(0, end.index).trim();
      if (text.endsWith(';')) text = text.slice(0, -1);
      detail.payloadBytes = Buffer.byteLength(text);
      let data = null;
      try { data = JSON.parse(text); }
      catch (e) {
        violations.push(
          'the payload does not parse as JSON where a browser would end the script element — '
          + 'a literal `</script` in a record body has terminated it early and everything after '
          + 'it is live markup (CF-44). Parser said: ' + e.message);
      }
      if (data) {
        detail.records = countRecords(data);
        if (args.expectRecords !== null && detail.records !== args.expectRecords) {
          violations.push('payload record parity FAILED — the built board carries ' + detail.records
            + ' record(s), the source corpus has ' + args.expectRecords
            + '; records were dropped between the corpus and the deliverable');
        }
      }
    }
  }

  // Every inline script body must be free of the terminator by construction. The
  // splitter cannot see one (it ends the body there), so what this actually asserts
  // is that no body was cut short — a body that ends before its `</script>` leaves a
  // structural remainder no rule below would flag.
  for (const b of bodies) {
    if (b.unterminated) violations.push('an inline <script> block is never closed');
  }

  // -- 2. STRUCTURE (ADR-0191 constraint table) ----------------------------
  // Data bytes are OUT of this scan (finding F5). Only tags are judged.
  const STRUCTURE_RULES = [
    ['ESM script', /<script[^>]*\btype\s*=\s*["']?module/i,
      'a `type="module"` script does not execute from file:// (control C1)'],
    ['dynamic import', /\bimport\s*\(/,
      'a dynamic `import()` cannot resolve from file:// (control C3)'],
    ['external script', /<script[^>]*\bsrc\s*=/i,
      'an external `<script src>` makes the deliverable a folder, not a file'],
  ];
  for (const [name, re, why] of STRUCTURE_RULES) {
    if (re.test(structure)) violations.push('single-file violation — ' + name + ': ' + why);
  }

  // The two URL-bearing rules CAPTURE the value and then test it, rather than
  // matching with a negative lookahead. A lookahead placed after an optional quote
  // backtracks past it, so `href="data:…"` satisfies "not followed by data:" with
  // the quote consumed as nothing — the check then passes precisely the input it
  // was written to reject, and fails the input it was written to accept.
  const REFERENCE_RULES = [
    ['external stylesheet', /<link[^>]*\bhref\s*=\s*(['"]?)([^'">\s]*)\1/gi,
      'an external `<link href>` makes the deliverable a folder, not a file'],
    ['remote url()', /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi,
      'a non-data `url()` reaches the network; an offline board must carry its assets'],
  ];
  for (const [name, re, why] of REFERENCE_RULES) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(structure)) !== null) {
      const value = String(m[2] || '').trim();
      if (!value || /^data:/i.test(value) || value.charAt(0) === '#') continue;
      violations.push('single-file violation — ' + name + ' (' + value.slice(0, 60) + '): ' + why);
      break;
    }
  }

  // -- 3. THE DOCUMENT IS ONE DOCUMENT -------------------------------------
  const htmlTags = (structure.match(/<html\b/gi) || []).length;
  if (htmlTags !== 1) violations.push('expected exactly 1 <html> element, found ' + htmlTags);
  if (!/<div\s+id="app"><\/div>/.test(structure)) {
    violations.push('the mount point `<div id="app"></div>` is missing — nothing can render');
  }

  if (args.json) console.log(JSON.stringify(Object.assign({ ok: violations.length === 0 }, detail)));

  if (violations.length) {
    console.error('[board-gate] FAIL — ' + violations.length + ' violation(s) in ' + args.file + ':');
    for (const v of violations) console.error('  - ' + v);
    return 1;
  }
  console.log('board-gate OK: ' + detail.records + ' record(s), ' + detail.scriptBlocks
    + ' inline script block(s), payload parses where a parser would cut it, 0 external references');
  return 0;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = { splitScripts, countRecords, main, DATA_OPEN, SCRIPT_END };
