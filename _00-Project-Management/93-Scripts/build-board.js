#!/usr/bin/env node
/**
 * build-board.js — the CONSUMER's board lane (`pm:dash`), with no build step.
 * STORY-33.10.02 · ADR-0226 section 2 · ADR-0268.
 *
 * ===========================================================================
 * WHAT THIS IS, AND WHY IT IS NOT A "BUILD"
 * ===========================================================================
 * The word "build" in this filename means ASSEMBLY, not compilation. Nothing here runs
 * a bundler, installs a package, or needs `node_modules` — the two artefacts that DID
 * require a bundler were produced once in the kit repo (`npm run board:build`) and ship
 * as ordinary files:
 *
 *   assets/board-runtime.js    the classic-script IIFE the document executes
 *   lib/board-assemble.js      the node-side assembly modules this file calls
 *
 * What happens here is the arm-2 shape the zero-install consumer proof measured at 25 MB
 * live-corpus scale: run the SHIPPED, dependency-free generator for its `window.__DATA`,
 * then inline that payload into the prebuilt runtime with string concatenation. Node
 * stdlib, start to finish.
 *
 * ===========================================================================
 * THE GENERATOR IS A CHILD PROCESS AND IS NOT TOUCHED
 * ===========================================================================
 * `generate-dashboard.js` is frozen for the port (ADR-0230, exceptions enumerated in
 * ADR-0267). It is this lane's DATA PRODUCER and nothing else: spawned as a child so
 * `PM_DASH_ROOT` can move its module-load-time root, read for its payload, never
 * modified and never imported for its rendering. That is exactly what `board/build.mjs`
 * does in the kit repo — the same relationship, on the consumer's side of the boundary.
 *
 * ===========================================================================
 * WHY IT ASSEMBLES TO A TEMPORARY FILE AND RENAMES
 * ===========================================================================
 * The generator writes the board; this file then replaces it. If the assembly or the
 * single-file gate fails after that write, an in-place assembly would leave the consumer
 * with a half-written document where a working board used to be. Assembling beside it and
 * renaming only after the gate passes means a failed run leaves the GENERATOR'S board in
 * place — older in style, complete in content — and says so.
 *
 * Usage: node _00-Project-Management/93-Scripts/build-board.js   (npm run pm:dash)
 *        --data <html>       assemble from an existing generator document instead of
 *                            running the generator (the delivery arm; the document must
 *                            sit in a PM tree of its own)
 *        --out <html>        write the assembled board here instead of the resolved role
 *        --pm-root <dir>     the PM tree to build for (default: $PM_DASH_ROOT, else the
 *                            tree this script lives in)
 *        --quiet             print the contract line and nothing else
 * Exit codes: 0 = board written · 1 = the lane refused to leave an artefact · 2 = bad args.
 * Dependency-free — Node stdlib plus the two kit-shipped artefacts above.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadPaths, dashboardOutPath } = require('./lib/pm-paths');
const { redactHostPaths } = require('./lib/host-path-redaction');

const SCRIPTS = __dirname;
const RUNTIME_BUNDLE = path.join(SCRIPTS, 'assets', 'board-runtime.js');
const ASSEMBLE_BUNDLE = path.join(SCRIPTS, 'lib', 'board-assemble.js');

// The regeneration contract, stated in every transcript (ADR-0226 section 2). `install.js`
// and `update.js` print their own restatements of it; this one is the regenerate path's,
// and it names the two prebuilt artefacts by their shipped paths so a transcript reader can
// check that the run used them rather than take the sentence on trust.
const REGEN_CONTRACT_LINE =
  '  · install contract (ADR-0226): board builds run in the Tandem kit repo only — this ' +
  'regeneration inlines locally-produced data into the kit-shipped prebuilt runtime ' +
  '(assets/board-runtime.js + lib/board-assemble.js) with zero build steps: no bundler, no ' +
  'npm, no node_modules';

function parseArgs() {
  const argv = process.argv.slice(2);
  const out = { data: null, outFile: null, pmRoot: null, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const need = () => {
      const v = argv[++i];
      if (!v || v.startsWith('--')) { console.error(`✗ ${a} requires a path`); process.exit(2); }
      return path.resolve(v);
    };
    if (a === '--data') out.data = need();
    else if (a === '--out') out.outFile = need();
    else if (a === '--pm-root' || a === '--root' || a === '--target') out.pmRoot = need();
    else if (a === '--quiet') out.quiet = true;
    else { console.error(`✗ unknown arg: ${a}`); process.exit(2); }
  }
  return out;
}

/** Refuse loudly rather than half-write. */
function die(message) {
  console.error('✗ pm:dash (build-board): ' + message);
  process.exit(1);
}

/**
 * The PM root a generator document belongs to, derived and then CHECKED.
 *
 * `<pmRoot>/<monitor role>/<file>.html` is the shape every generator output has, so the
 * root is two levels up — but a document copied anywhere else would still assemble, and
 * the phase classification reads THAT project's retro ledger and run scopes. A wrong
 * guess would classify every phase against the wrong project and still report success,
 * so the candidate has to prove it is a PM tree: its own declared roles must resolve to
 * folders that exist. The check is role-based rather than folder-name-based on purpose —
 * a flattened or custom consumer names those folders differently, and a literal here
 * would refuse exactly the layouts this lane was written to serve (BUG-20260819-01).
 */
function pmRootOfDocument(docPath) {
  const candidate = path.dirname(path.dirname(docPath));
  const map = loadPaths(candidate).map;
  const reports = map.reports && path.join(candidate, map.reports);
  const holder = path.basename(path.dirname(docPath));
  if (!reports || !fs.existsSync(reports) || holder !== (map.monitor || '')) {
    die('--data must name a generator board inside a PM tree (<pmRoot>/<monitor role>/'
      + '<file>.html); got ' + docPath + ', which resolves a PM root of ' + candidate
      + ' whose declared monitor role is "' + (map.monitor || '(unset)') + '" and whose reports '
      + 'folder ' + (reports || '(unset)') + ' does not exist. The phase classification reads '
      + 'that project\'s ledgers, so assembling from a board outside its own tree would '
      + 'classify every phase against the wrong project and still report success.');
  }
  return candidate;
}

/**
 * How the document names the board it was built from.
 *
 * Repo-relative when the data sits inside the tree being built for — which is every ordinary
 * run. When it does NOT (`--data` naming another project's board), `path.relative` returns a
 * `../../..` chain whose segments are the names of directories ABOVE the repo, and that chain
 * is inlined into `window.__BOARD_CONFIG`. `redactHostPaths()` removes the home directory,
 * the username and the configured tokens; it has no reason to touch a relative path, so those
 * segments would ship. The basename says the same useful thing and carries nothing else.
 */
function dataSourceLabel(repoRoot, dataPath) {
  const rel = path.relative(repoRoot, dataPath).split(path.sep).join('/');
  return rel && !rel.startsWith('../') && !path.isAbsolute(rel) ? rel : path.basename(dataPath);
}

/**
 * Run the shipped generator for its payload. Child process, never imported.
 *
 * STORY-33.9.05: the generator is payload-only now — `--payload-out` writes the raw
 * `window.__DATA` JSON to a file, and no document is rendered or sliced. The payload
 * file is read, then removed; it is an interchange artefact, not a deliverable.
 */
function runGenerator(pmRoot, payloadFile) {
  const r = spawnSync(process.execPath, [
    path.join(SCRIPTS, 'generate-dashboard.js'), '--payload-out', payloadFile,
  ], {
    cwd: path.dirname(pmRoot),
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, PM_DASH_ROOT: pmRoot },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) die('the generator could not start (' + r.error.message + ')');
  if (r.status !== 0) {
    process.stderr.write(String(r.stderr || '').split('\n').slice(-8).join('\n') + '\n');
    die('the generator refused to produce a payload (exit ' + r.status + ') — cause above');
  }
  if (!fs.existsSync(payloadFile)) {
    die('the generator exited 0 but wrote no payload at ' + payloadFile
      + ' — "exit 0" is a claim about a process, not about an artefact');
  }
}

function main() {
  const args = parseArgs();
  const t0 = Date.now();

  const PM_ROOT = args.pmRoot || (process.env.PM_DASH_ROOT
    ? path.resolve(process.env.PM_DASH_ROOT)
    : path.resolve(SCRIPTS, '..'));
  const REPO_ROOT = path.dirname(PM_ROOT);
  const layoutMap = loadPaths(PM_ROOT).map;

  for (const [label, p] of [['runtime bundle', RUNTIME_BUNDLE], ['assembly bundle', ASSEMBLE_BUNDLE]]) {
    if (!fs.existsSync(p)) {
      die('the kit-shipped ' + label + ' is missing at ' + p + '. It is delivered by pm:install '
        + 'and refreshed by pm:update; a consumer never builds it. Re-run `npm run pm:install`.');
    }
  }
  // Required, not optional: `require` here rather than at module load so the two guards
  // above produce the actionable message instead of a MODULE_NOT_FOUND stack. The try/catch
  // is the other half of that: a PRESENT-but-truncated bundle — the shape an interrupted
  // `pm:update` copy leaves, because the refresh writes with a plain non-atomic
  // `writeFileSync` — otherwise reached the operator as a raw SyntaxError stack with no
  // remedy attached. Same fault, same instruction.
  let board;
  try { board = require(ASSEMBLE_BUNDLE); }
  catch (e) {
    die('the kit-shipped assembly bundle at ' + ASSEMBLE_BUNDLE + ' could not be loaded ('
      + (e && e.message ? String(e.message).split('\n')[0] : String(e)) + '). It is delivered by '
      + 'pm:install and refreshed by pm:update; a consumer never builds it. Re-run '
      + '`npm run pm:install`.');
  }

  const outFile = args.outFile || dashboardOutPath(PM_ROOT, layoutMap);

  // 1. DATA — the shipped generator's payload. Ordinary runs receive it as a FILE from
  //    `--payload-out` (STORY-33.9.05 — no document render, nothing sliced); the `--data`
  //    arm still extracts from an existing board document (the assembled board embeds the
  //    same `window.__DATA` literals, so old and new documents both serve).
  let payloadJson;
  let dataPmRoot;
  let dataLabel;
  if (args.data) {
    const dataPath = args.data;
    if (!fs.existsSync(dataPath)) die('no board document at ' + dataPath);
    dataPmRoot = pmRootOfDocument(dataPath);
    payloadJson = board.extractPayloadJson(dataPath);
    dataLabel = dataSourceLabel(REPO_ROOT, dataPath);
  } else {
    // Per-process temp dir (review M3): a fixed sibling path let a hook-triggered regen
    // and a manual pm:dash race on one 30 MB interchange file — and parked untracked
    // multi-MB files inside the git-tracked monitor folder (review M2).
    const payloadFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pm-dash-')), 'payload.json');
    runGenerator(PM_ROOT, payloadFile);
    dataPmRoot = PM_ROOT;
    payloadJson = fs.readFileSync(payloadFile, 'utf8');
    try { fs.rmSync(path.dirname(payloadFile), { recursive: true, force: true }); } catch (_e) { /* best effort */ }
    dataLabel = 'generate-dashboard.js --payload-out';
  }
  const payload = JSON.parse(payloadJson);
  const records = board.countRecords(payload).total;

  // 2. ASSEMBLE — the same modules the kit-side lane uses, emitted once and shipped.
  //    The stylesheet is built BEFORE the config, because the config's diagram palette is
  //    derived from it (CF-36) — one source for the colours, and the two cannot disagree.
  const css = board.buildCss();
  const config = board.buildBoardConfig({
    payload,
    scriptsDir: SCRIPTS,
    pmRoot: dataPmRoot,
    dataSource: dataLabel,
    css,
  });
  const mermaid = board.mermaidBundle(SCRIPTS);
  const html = redactHostPaths(
    board.assemble({ payloadJson, config, css, runtimeJs: fs.readFileSync(RUNTIME_BUNDLE, 'utf8'), mermaidJs: mermaid.js }),
    undefined, undefined, REPO_ROOT);

  // 3. GATE, then RENAME. See the header for why the order is this way round.
  // Unique per-process suffix (review M3) so two concurrent assemblies never half-write
  // each other's staging file; stale leftovers from interrupted runs are swept below and
  // gitignored (*.assembling*).
  const staging = outFile + '.' + process.pid + '.assembling';
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  // Sweep interrupted-run leftovers beside the board (review M2): announced, never silent —
  // an untracked 38 MB `.assembling` file in the monitor folder is exactly the second-
  // dashboard confusion the staging name's retirement removed.
  try {
    for (const f of fs.readdirSync(path.dirname(outFile))) {
      if ((f.endsWith('.assembling') || f.endsWith('.payload.json')) && f !== path.basename(staging)) {
        const stale = path.join(path.dirname(outFile), f);
        console.warn('  · sweeping stale interchange leftover: ' + stale);
        try { fs.rmSync(stale, { force: true }); } catch (_e) { /* best effort */ }
      }
    }
  } catch (_e) { /* sweep is best-effort */ }
  fs.writeFileSync(staging, html, 'utf8');
  const gate = spawnSync(process.execPath, [
    path.join(SCRIPTS, 'board-single-file-gate.js'), staging, '--expect-records', String(records),
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (gate.error || gate.status !== 0) {
    process.stdout.write(String(gate.stdout || ''));
    process.stderr.write(String(gate.stderr || ''));
    try { fs.rmSync(staging, { force: true }); } catch (_e) { /* best effort */ }
    // The gate's exit 2 means "no verdict was produced" — a usage or environment fault, not a
    // judgement about the board (ADR-0134). Collapsing it into "the board failed" would report
    // a verdict nothing reached, which is the same mistake in miniature that the gate's own
    // exit-code contract exists to prevent. A spawn error (status null) is the same class.
    const couldNotRun = !!gate.error || gate.status === 2;
    // And say truthfully what is left in place: the generator's document only when this run
    // is the one that produced it. Under `--data X --out Y`, Y may never have existed.
    const survives = args.outFile
      ? outFile + ' is unchanged (it may not exist).'
      : outFile + ' still holds the generator\'s own document.';
    die((couldNotRun
      ? 'the single-file gate could not run (' + (gate.error ? gate.error.message : 'exit 2 — '
        + 'usage or environment, no verdict produced') + ')'
      : 'the assembled board failed the single-file gate')
      + ' — refusing to replace the board that is there. ' + survives);
  }
  // renameSync REPLACES an existing destination (libuv uses MoveFileEx with REPLACE_EXISTING on
  // Windows), so no `rm` first. An `rm`-then-`rename` pair opens a window in which the consumer
  // has NEITHER board — precisely the outcome this file's header promises cannot happen — and
  // any failure of the rename (a lock, EPERM) leaves them in it.
  fs.renameSync(staging, outFile);

  // WARNINGS ARE NOT QUIET. `--quiet` exists so install/update transcripts stay readable, and
  // both of those callers also route stdout to /dev/null — so folding the warnings into the
  // quiet branch meant a missing or `</script`-poisoned `assets/mermaid.min.js` degraded every
  // install to a diagram-less board with nothing said anywhere. They go to stderr, always.
  if (mermaid.reason) console.warn('  warning: mermaid — ' + mermaid.reason);
  for (const w of (config.brandWarnings || [])) console.warn('  warning: ' + w.path + ' — ' + w.reason);
  if (!args.quiet) {
    console.log('pm:dash ' + JSON.stringify({
      board: path.relative(REPO_ROOT, outFile).split(path.sep).join('/'),
      boardBytes: Buffer.byteLength(html),
      records,
      buildSteps: 0,
      assembledMs: Date.now() - t0,
    }));
  }
  console.log(REGEN_CONTRACT_LINE);
  process.exit(0);
}

main();
