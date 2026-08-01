#!/usr/bin/env node
'use strict';

/*
 * smoke-demo-build.js
 *
 * m2 fix (CHAT-09 review anno-4 / BUG-20260801-03 batch): TESTPLAN-23.7.03's TC-02/TC-03 only ever
 * asserted the BUILT release's static shape (SHELL-OK/PKG-OK/NO-LEAK-OK grep checks) and ran
 * pm:smoke against the DEV board (`_00-Project-Management/42-Monitor/DASHBOARD.html`). Nothing in
 * the release gate exercised the BUILT demo board's actual client-runtime behaviour — a
 * demo-only runtime fault (e.g. an error on an EXTERNAL_ROOT-empty data path) could ship
 * undetected. This closes that gap by re-pointing the existing smoke-dashboard.js probe suite
 * (unmodified — same probes the dev board already runs) at a BUILT release's
 * `<out>/docs/index.html`.
 *
 * Fail-closed: missing build output, a non-zero smoke-dashboard.js exit, or a spawn failure all
 * propagate as a non-zero exit here.
 *
 * Usage:
 *   node _00-Project-Management/93-Scripts/smoke-demo-build.js <built-release-out-dir>
 *   node _00-Project-Management/93-Scripts/smoke-demo-build.js --out <built-release-out-dir>
 *
 * Typical pairing (see TESTPLAN-23.7.03 TC-04):
 *   node scripts/release-tandem.js --out <scratch-dir>
 *   node _00-Project-Management/93-Scripts/smoke-demo-build.js <scratch-dir>
 *
 * Exit codes mirror smoke-dashboard.js: 0 clean, 1 render/behaviour failure, 2 environment-blocked
 * (also used here when the built demo board is missing, e.g. the release build didn't run first).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PM_ROOT = path.resolve(__dirname, '..'); // _00-Project-Management
const REPO_ROOT = path.resolve(PM_ROOT, '..');

function parseArgs(argv) {
  let out = null;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') { out = argv[++i]; }
    else if (!out && a.indexOf('--') !== 0) { out = a; }
  }
  return out;
}

function main() {
  const outArg = parseArgs(process.argv);
  if (!outArg) {
    console.error('[smoke-demo-build] usage: node smoke-demo-build.js <built-release-out-dir>');
    console.error('[smoke-demo-build]   (build one first: node scripts/release-tandem.js --out <dir>)');
    return 2;
  }
  const outDir = path.isAbsolute(outArg) ? outArg : path.resolve(process.cwd(), outArg);
  const demoPath = path.join(outDir, 'docs', 'index.html');

  if (!fs.existsSync(demoPath)) {
    console.error(`[smoke-demo-build] built demo board not found: ${demoPath}`);
    console.error('[smoke-demo-build] run `node scripts/release-tandem.js --out <dir>` first (no --skip-demo).');
    return 2;
  }

  const smokeScript = path.join(PM_ROOT, '93-Scripts', 'smoke-dashboard.js');
  if (!fs.existsSync(smokeScript)) {
    console.error(`[smoke-demo-build] smoke-dashboard.js not found at ${smokeScript}`);
    return 2;
  }

  // smoke-dashboard.js's behavioural probe flags are mutually exclusive -- ONE flag per invocation
  // (see its own comment at the probeFlag selection: "each is mutually exclusive with the others").
  // Passing all three flags in a single call would silently run only the first-priority one and
  // skip the rest -- so this runs each probe as its own separate smoke-dashboard.js invocation
  // against the same built board, and fails closed on the first red probe.
  const WALKS = ['--pagination-walk', '--slicer-walk', '--phases-drawer-walk'];

  console.log(`[smoke-demo-build] probing built demo board: ${demoPath}`);
  for (const walkFlag of WALKS) {
    const result = spawnSync(
      process.execPath,
      [smokeScript, demoPath, walkFlag],
      { stdio: 'inherit', cwd: REPO_ROOT }
    );
    if (result.error) {
      console.error(`[smoke-demo-build] failed to spawn smoke-dashboard.js (${walkFlag}): ${result.error.message}`);
      return 2;
    }
    const code = result.status == null ? 2 : result.status;
    if (code !== 0) {
      console.error(`[smoke-demo-build] DEMO-SMOKE-FAIL (${walkFlag}, exit ${code}): ${demoPath}`);
      return code;
    }
  }

  console.log(`[smoke-demo-build] DEMO-SMOKE-OK: ${demoPath}`);
  return 0;
}

process.exit(main());
