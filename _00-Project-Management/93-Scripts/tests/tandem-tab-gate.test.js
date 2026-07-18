#!/usr/bin/env node
/**
 * tandem-tab-gate.test.js — behavioural test for the Tandem tab's isKitRepo gate
 * (STORY-21.5.01 / BUG-20260618-01 / TESTPLAN-21.5.01).
 *
 * Drives the REAL generate-dashboard.js against staged fixture repos via the
 * PM_DASH_ROOT test seam (same seam install.js/update.js already use to render a
 * dashboard for a target project — see generate-dashboard.js's PM_ROOT/EXTERNAL_ROOT
 * config). Each fixture is a throwaway temp dir shaped like either a consumer install
 * (no .claude-plugin/, no dist/tt/, no build:tandem script) or the kit's own dev repo
 * (kit markers present). The generator runs in a CHILD `node` process — PM_ROOT/
 * REPO_ROOT are resolved once at module load from process.env, so each fixture needs
 * its own process to get its own resolution.
 *
 * Every SCAN_DIRS subfolder under _00-Project-Management/ is optional (the generator
 * degrades to an empty list — see buildPmCorpus/buildReports/buildReferenceFolder
 * etc.), so a bare `_00-Project-Management/` directory is sufficient PM_ROOT shape;
 * no other kit template files are needed to exercise the Tandem-tab gate.
 *
 * Modes:
 *   node tandem-tab-gate.test.js --consumer   — TESTPLAN-21.5.01 TC-02
 *   node tandem-tab-gate.test.js --kit        — TESTPLAN-21.5.01 TC-03
 *
 * Exit 0 = pass, non-zero = fail. Dependency-free (Node stdlib only). Cleans up its
 * temp dirs on both success and failure.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const GENERATOR = path.join(__dirname, '..', 'generate-dashboard.js');

// The bare kit-only build command — used for the targeted field-level checks below
// (D.tandemEmptyStateHtml must never carry it in a consumer build).
const KIT_BUILD_SCRIPT = ['npm', 'run', 'build:tandem'].join(' ');

// The full un-followable sentence BUG-20260618-01 is about (the Tandem tab's empty-
// state copy) — distinct from the unrelated, always-present glossary entry that also
// mentions the bare build command as general reference documentation ("Triggered by
// <code>npm run build:tandem</code> with a scrub gate."), which is out of this story's
// scope (files touched: buildTandemPackage()/RENDERERS.tandem only). Matching the full
// instructional sentence rather than the bare command keeps the whole-output check
// (below) anchored to the actual reported defect instead of the grep-confound the
// story's Risks section warns about.
const KIT_DEV_TAB_INSTRUCTION = 'Run <code>' + KIT_BUILD_SCRIPT + '</code> to publish the plugin and regenerate this dashboard';

let failures = 0;
function check(name, cond) {
  if (cond) { console.log('  ok  - ' + name); }
  else { console.log('  FAIL- ' + name); failures += 1; }
}

function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }

function writeJson(filePath, obj) {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2));
}

// Consumer-shaped fixture (BUG-20260618-01 repro shape): a plain vendored install —
// pm:* scripts only, no build:tandem, no .claude-plugin/, no dist/tt/.
function buildConsumerFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-gate-consumer-'));
  mkdirp(path.join(root, '_00-Project-Management'));
  writeJson(path.join(root, 'package.json'), {
    name: 'consumer-fixture',
    version: '0.1.0',
    scripts: {
      'pm:dash': 'node _00-Project-Management/93-Scripts/generate-dashboard.js',
      'pm:lint': 'node _00-Project-Management/93-Scripts/validate-frontmatter.js',
    },
  });
  return root;
}

// Kit-shaped fixture: the kit's own .claude-plugin markers + a build:tandem script.
// withDist controls whether dist/tt/ (build output) is also staged — the pre-build
// variant (withDist:false) exercises the Risks/unknowns note: markers alone must
// still classify as kit even before the first build:tandem run.
function buildKitFixture(withDist) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-gate-kit-'));
  mkdirp(path.join(root, '_00-Project-Management'));
  writeJson(path.join(root, '.claude-plugin', 'plugin.json'), {
    name: 'kit-fixture-plugin',
    version: '9.9.9',
  });
  writeJson(path.join(root, 'package.json'), {
    name: 'kit-fixture',
    version: '9.9.9',
    scripts: { 'build:tandem': 'node scripts/release-tandem.js' },
  });
  if (withDist) {
    writeJson(path.join(root, 'dist', 'tt', '.claude-plugin', 'plugin.json'), {
      name: 'kit-fixture-plugin',
      version: '9.9.9',
      description: 'Fixture manifest for TESTPLAN-21.5.01 TC-03.',
      repository: 'https://example.invalid/kit-fixture',
      license: 'MIT',
      author: 'Fixture Author',
    });
  }
  return root;
}

// Widened-marker fixture: build:tandem script alone, no .claude-plugin/, no dist/tt/.
function buildScriptOnlyFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-gate-kit-scriptonly-'));
  mkdirp(path.join(root, '_00-Project-Management'));
  writeJson(path.join(root, 'package.json'), {
    name: 'kit-fixture-script-only',
    version: '1.0.0',
    scripts: { 'build:tandem': 'node scripts/release-tandem.js' },
  });
  return root;
}

// Runs the real generator in a child process against fixtureRoot via PM_DASH_ROOT,
// then reads back the DASHBOARD.html it wrote.
function runGenerator(fixtureRoot) {
  const pmRoot = path.join(fixtureRoot, '_00-Project-Management');
  const result = spawnSync(process.execPath, [GENERATOR], {
    env: Object.assign({}, process.env, { PM_DASH_ROOT: pmRoot }),
    encoding: 'utf8',
  });
  const htmlPath = path.join(pmRoot, '42-Monitor', 'DASHBOARD.html');
  const html = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '';
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, html };
}

// Pulls the `window.__DATA = {...};` payload out of the generated HTML and parses it.
// Scans for the matching closing brace (respecting string literals) rather than a
// regex, since the JSON blob is large and may itself contain "};" sequences inside
// string values.
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

function runConsumerMode() {
  const root = buildConsumerFixture();
  try {
    const { status, stderr, html } = runGenerator(root);
    check('consumer fixture: generator exits 0 (no crash)', status === 0);
    if (status !== 0) { console.log('  stderr: ' + stderr); return; }

    const data = extractEmbeddedData(html);
    check('consumer fixture: isKitRepo signal is false', data.isKitRepo === false);
    check('consumer fixture: tandemPackage stays null (no dist/tt/)', data.tandemPackage === null);
    check(
      'consumer fixture: empty-state copy carries a consumer-appropriate N/A note',
      /not applicable/i.test(data.tandemEmptyStateHtml || '')
    );
    check(
      'consumer fixture: empty-state copy does not reference the kit-only build script',
      !(data.tandemEmptyStateHtml || '').includes(KIT_BUILD_SCRIPT)
    );
    // Whole-output negative assertion (TESTPLAN-21.5.01 TC-02 / risk note): safe here
    // specifically because (a) the fixture corpus is fully controlled and free of the
    // phrase, (b) the fix removes it from the static client bundle entirely, and
    // (c) we match the full instructional sentence rather than the bare build command
    // — so it can't be confounded by the unrelated glossary entry that also mentions
    // the bare command as general reference documentation.
    check(
      'consumer fixture: generated dashboard contains no un-followable build:tandem instruction anywhere',
      !html.includes(KIT_DEV_TAB_INSTRUCTION)
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runKitMode() {
  // Sub-case 1: full kit fixture (markers + populated dist/tt/) — AC-2/TC-03: the tab
  // wires up the package data exactly as pre-fix.
  const builtRoot = buildKitFixture(true);
  try {
    const { status, stderr, html } = runGenerator(builtRoot);
    check('kit fixture (built): generator exits 0', status === 0);
    if (status !== 0) { console.log('  stderr: ' + stderr); }
    else {
      const data = extractEmbeddedData(html);
      check('kit fixture (built): isKitRepo signal is true', data.isKitRepo === true);
      check(
        'kit fixture (built): tandemPackage wires up the manifest',
        !!(data.tandemPackage && data.tandemPackage.manifest && data.tandemPackage.manifest.name === 'kit-fixture-plugin')
      );
      check(
        'kit fixture (built): tandemPackage manifest version carried through unchanged',
        !!(data.tandemPackage && data.tandemPackage.manifest && data.tandemPackage.manifest.version === '9.9.9')
      );
    }
  } finally {
    fs.rmSync(builtRoot, { recursive: true, force: true });
  }

  // Sub-case 2: kit repo pre-build (markers present, no dist/tt/ yet). Must still
  // classify as kit and keep the pre-fix kit-dev empty-state (no regression).
  const preBuildRoot = buildKitFixture(false);
  try {
    const { status, stderr, html } = runGenerator(preBuildRoot);
    check('kit fixture (pre-build): generator exits 0', status === 0);
    if (status !== 0) { console.log('  stderr: ' + stderr); }
    else {
      const data = extractEmbeddedData(html);
      check('kit fixture (pre-build): isKitRepo signal is true (markers alone are enough)', data.isKitRepo === true);
      check('kit fixture (pre-build): tandemPackage stays null (no dist/tt/ yet)', data.tandemPackage === null);
      check(
        'kit fixture (pre-build): empty-state keeps the pre-fix build-script instruction unchanged',
        (data.tandemEmptyStateHtml || '').includes(KIT_BUILD_SCRIPT)
      );
    }
  } finally {
    fs.rmSync(preBuildRoot, { recursive: true, force: true });
  }

  // Sub-case 3: widened marker — a defined build:tandem script alone (no
  // .claude-plugin/, no dist/tt/) is sufficient kit-repo evidence per this story's AC.
  const scriptOnlyRoot = buildScriptOnlyFixture();
  try {
    const { status, stderr, html } = runGenerator(scriptOnlyRoot);
    check('kit fixture (build:tandem script only): generator exits 0', status === 0);
    if (status !== 0) { console.log('  stderr: ' + stderr); }
    else {
      const data = extractEmbeddedData(html);
      check('kit fixture (build:tandem script only): isKitRepo signal is true', data.isKitRepo === true);
    }
  } finally {
    fs.rmSync(scriptOnlyRoot, { recursive: true, force: true });
  }
}

const isKit = process.argv.includes('--kit');
const isConsumer = process.argv.includes('--consumer');
if (!isKit && !isConsumer) {
  console.error('Usage: node tandem-tab-gate.test.js --consumer | --kit');
  process.exit(1);
}

if (isConsumer) runConsumerMode(); else runKitMode();

const mode = isConsumer ? 'consumer' : 'kit';
if (failures === 0) {
  console.log('\n✓ tandem-tab-gate — all checks passed (' + mode + ' mode).');
  process.exit(0);
}
console.log('\n✗ tandem-tab-gate — ' + failures + ' check(s) failed (' + mode + ' mode).');
process.exit(1);
