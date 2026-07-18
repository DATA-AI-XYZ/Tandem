#!/usr/bin/env node
/**
 * deliverable-thin-input.test.js — thin-input honesty test for the Plan →
 * Roadmap timeline's "what you'll see" deliverable line (STORY-21.4.01 /
 * BACKLOG-0082 / ADR-0084 / TESTPLAN-21.4.01 TC-03).
 *
 * Two techniques, one per precedent test named in the story:
 *
 *   1. Module export seam (mdtohtml.test.js pattern) — drives
 *      buildDeliverableLine() DIRECTLY via generate-dashboard.js's
 *      module.exports test seam. No child process, no DOM. This is the
 *      canonical thin-input check: buildDeliverableLine() is the single
 *      function that enforces the ADR-0059 thin-input rule (an empty/
 *      absent/whitespace-only outcome renders NOTHING), and it is what the
 *      client-side Roadmap renderer injects verbatim (see ADR-0084).
 *
 *   2. Staged mini-corpus + PM_DASH_ROOT (tandem-tab-gate.test.js pattern) —
 *      runs the REAL generator against two fixture epics (one with an
 *      outcome, one scaffolding-only, no outcome) and asserts the field the
 *      client renderer consumes end-to-end, through window.__DATA.
 *
 * Fixtures:
 *   (a) epic WITH an outcome            → deliverable line renders.
 *   (b) epic WITHOUT an outcome         → NO deliverable line — absent,
 *       (scaffolding-only)                not a fabricated placeholder
 *                                          sentence.
 *
 * Exit 0 = pass, non-zero = fail. Dependency-free (Node stdlib only).
 * Cleans up its temp dirs on both success and failure.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const GENERATOR = path.join(__dirname, '..', 'generate-dashboard.js');
const { buildDeliverableLine } = require(GENERATOR);

let failures = 0;
function check(name, cond) {
  if (cond) { console.log('  ok  - ' + name); }
  else { console.log('  FAIL- ' + name); failures += 1; }
}

/* ============================================================
 * Part 1 · Module export seam — buildDeliverableLine() direct
 * ============================================================ */
function runUnit() {
  // (a) WITH an outcome → renders.
  {
    const html = buildDeliverableLine('You can now do the thing.', 'epic-deliverable');
    check('with outcome: non-empty HTML returned', !!html);
    check('with outcome: wrapped in the requested css class', html.includes('class="epic-deliverable"'));
    check('with outcome: carries the outcome text', html.includes('You can now do the thing.'));
    check('with outcome: carries a "What you\'ll see" label', /What you.ll see/.test(html));
  }

  // (b) WITHOUT an outcome — every thin-input shape (absent, null, empty
  // string, whitespace-only) must produce NO element at all — an empty
  // string, never a fabricated placeholder sentence (ADR-0059 thin-input
  // rule, honoured by ADR-0084's surface choice).
  [undefined, null, '', '   ', '\n\t '].forEach(function (v) {
    const html = buildDeliverableLine(v, 'epic-deliverable');
    check('thin input ' + JSON.stringify(v) + ': returns empty string (no element rendered)', html === '');
  });

  // Outcome text must be HTML-escaped, not passed through raw (defence in
  // depth — outcome is free text authored by a producer skill).
  {
    const html = buildDeliverableLine('<script>alert(1)</script>', 'epic-deliverable');
    check('outcome text is HTML-escaped, not raw', !html.includes('<script>') && html.includes('&lt;script&gt;'));
  }

  // Feature grain uses the same function with a different css class.
  {
    const html = buildDeliverableLine('You can now export a report.', 'feat-deliverable');
    check('feature grain: wrapped in feat-deliverable class', html.includes('class="feat-deliverable"'));
  }
}

/* ============================================================
 * Part 2 · Staged mini-corpus + PM_DASH_ROOT — end-to-end via __DATA
 * ============================================================ */
function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }
function writeFile(p, content) { mkdirp(path.dirname(p)); fs.writeFileSync(p, content); }

function epicMd(id, title, outcome) {
  const lines = [
    '---',
    'type: epic',
    'id: ' + id,
    'title: ' + title,
    'status: not-started',
    "okr: 'OKR-TEST'",
    "created_at: '2026-07-18T09:00:00+01:00'",
    "started_at: ''",
    "completed_at: ''",
  ];
  if (outcome !== undefined) lines.push("outcome: '" + outcome + "'");
  lines.push('---', '', '# ' + id, '', '## Why this exists', 'Fixture epic for TESTPLAN-21.4.01 TC-03.', '');
  return lines.join('\n');
}

// Fixture (a): epic WITH an outcome.
function withOutcomeMd() {
  return epicMd('EPIC-90', 'Has a deliverable', 'You can now see the thing on the dashboard.');
}

// Fixture (b): scaffolding-only epic — no outcome at all (thin-input case).
function scaffoldingOnlyMd() {
  return epicMd('EPIC-91', 'Scaffolding only, no user-visible output yet', undefined);
}

function buildFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deliverable-thin-input-'));
  const pm = path.join(root, '_00-Project-Management');
  writeFile(path.join(pm, '30-Epics', 'EPIC-90-with-outcome.md'), withOutcomeMd());
  writeFile(path.join(pm, '30-Epics', 'EPIC-91-scaffolding-only.md'), scaffoldingOnlyMd());
  return root;
}

function runGenerator(fixtureRoot) {
  const pmRoot = path.join(fixtureRoot, '_00-Project-Management');
  const result = spawnSync(process.execPath, [GENERATOR], {
    env: Object.assign({}, process.env, { PM_DASH_ROOT: pmRoot }),
    encoding: 'utf8',
  });
  const htmlPath = path.join(pmRoot, '42-Monitor', 'DASHBOARD.html');
  const html = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '';
  return { status: result.status, stderr: result.stderr, html };
}

// Pulls the `window.__DATA = {...};` payload out of the generated HTML and
// parses it. Scans for the matching closing brace (respecting string
// literals) rather than a non-greedy regex — see tandem-tab-gate.test.js for
// the same technique and the fragility it avoids.
function extractEmbeddedData(html) {
  const marker = 'window.__DATA = ';
  const start = html.indexOf(marker);
  if (start === -1) throw new Error('window.__DATA marker not found in generated dashboard');
  const jsonStart = start + marker.length;
  let depth = 0;
  let inString = false;
  let escape = false;
  let i = jsonStart;
  for (; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (escape) { escape = false; }
      else if (c === '\\') { escape = true; }
      else if (c === '"') { inString = false; }
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  return JSON.parse(html.slice(jsonStart, i));
}

function runIntegration() {
  const root = buildFixture();
  try {
    const { status, stderr, html } = runGenerator(root);
    check('fixture corpus: generator exits 0 (no crash)', status === 0);
    if (status !== 0) { console.log('  stderr: ' + stderr); return; }

    const data = extractEmbeddedData(html);
    const epics = data.epic || [];
    const withOutcome = epics.filter(function (e) { return e.id === 'EPIC-90'; })[0];
    const scaffoldingOnly = epics.filter(function (e) { return e.id === 'EPIC-91'; })[0];

    check('with-outcome epic is present in __DATA', !!withOutcome);
    check('scaffolding-only epic is present in __DATA', !!scaffoldingOnly);

    if (withOutcome) {
      check('with-outcome epic: outcome carried through __DATA', withOutcome.outcome === 'You can now see the thing on the dashboard.');
      check('with-outcome epic: deliverableHtml renders (non-empty)', !!withOutcome.deliverableHtml);
      check('with-outcome epic: deliverableHtml carries the outcome text', (withOutcome.deliverableHtml || '').includes('You can now see the thing on the dashboard.'));
    }
    if (scaffoldingOnly) {
      check('scaffolding-only epic: outcome is absent/null in __DATA', !scaffoldingOnly.outcome);
      check('scaffolding-only epic: deliverableHtml is empty — no element, no fabricated placeholder', scaffoldingOnly.deliverableHtml === '');
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

runUnit();
runIntegration();

if (failures === 0) {
  console.log('\n✓ deliverable-thin-input — all checks passed.');
  process.exit(0);
}
console.log('\n✗ deliverable-thin-input — ' + failures + ' check(s) failed.');
process.exit(1);
