#!/usr/bin/env node
/**
 * usage-estimate.js — the `usage_estimate:` producer, as a command. STORY-29.3.02 / BACKLOG-0157.
 *
 * The DERIVATION lives in `lib/usage-estimate.js`; the METHODOLOGY is written once in
 * `90-Standards/USAGE-ESTIMATE-HEURISTIC.md`. This file is the seam the two PM skills
 * (`refine-backlog` at the DoR pass, `split-into-stories` at authoring) invoke, so the number a
 * story ends up carrying does not depend on a model re-deriving prose in the moment.
 *
 * Usage:
 *   node usage-estimate.js --story <path>            fill-if-missing + write the basis line
 *   node usage-estimate.js --story <path> --dry-run  print what it WOULD write, touch nothing
 *   node usage-estimate.js --band M --type infra     print the figure and its basis
 *   node usage-estimate.js --anchors                 print the recorded snapshot
 *   node usage-estimate.js --refresh-anchors         re-measure from the live ledger, print the drift
 *   node usage-estimate.js --check [--stories-dir p] activation-date enforcement over a corpus
 *
 * Exit codes:
 *   0 — done (including "already populated — preserved", which is a success, not a failure)
 *   1 — `--check` found post-activation stories with no estimate (the only failing verdict)
 *   2 — usage error: no mode, conflicting modes, unreadable target
 *
 * Dependency-free — Node stdlib only.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const est = require('./lib/usage-estimate.js');
const { readUsageLog } = require('./lib/usage-rollup.js');
const { DEFAULT_LOG_PATH } = require('./usage-capture.js');

const PM_ROOT = path.resolve(__dirname, '..');
const { loadPaths } = require('./lib/pm-paths');
const DEFAULT_STORIES_DIR = path.join(PM_ROOT, loadPaths(PM_ROOT).map.stories);
// MINOR-5 — where the divisor is measured from. The canonical sidecar home since STORY-27.3.02's
// migration; the three pre-migration copies at `41-Reports/` root would double-count.
const DEFAULT_SIDECAR_DIR = path.join(PM_ROOT, '41-Reports', 'execution-strategy');

/** A fresh measurement of both halves of the anchor, or null when no ledger is readable.
 *  MAJOR-1: taken at the moment an estimate is written, so the basis line records the data as it
 *  was then rather than restating a snapshot that may already have moved. */
function measureNow(usageLogPath, sidecarDir) {
  const logPath = usageLogPath || process.env.PM_USAGE_LOG || DEFAULT_LOG_PATH;
  const { found, records } = readUsageLog(logPath);
  if (!found) return null;
  const fresh = est.recomputeAnchors(records, { sidecarDir: sidecarDir || DEFAULT_SIDECAR_DIR });
  return fresh.ok ? fresh : null;
}

function parseArgs(argv) {
  const args = {
    story: null, band: null, type: null, storiesDir: null, usageLog: null,
    anchors: false, refresh: false, check: false, dryRun: false, help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--story' && argv[i + 1]) args.story = argv[++i];
    else if (a === '--band' && argv[i + 1]) args.band = argv[++i];
    else if (a === '--type' && argv[i + 1]) args.type = argv[++i];
    else if (a === '--stories-dir' && argv[i + 1]) args.storiesDir = argv[++i];
    else if (a === '--usage-log' && argv[i + 1]) args.usageLog = argv[++i];
    else if (a === '--anchors') args.anchors = true;
    else if (a === '--refresh-anchors') args.refresh = true;
    else if (a === '--check') args.check = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else return { error: `unknown argument '${a}'` };
  }
  return args;
}

function usage() {
  console.log('Usage: node usage-estimate.js --story <path> [--dry-run]');
  console.log('       node usage-estimate.js --band <XS|S|M|L> --type <type_of_work>');
  console.log('       node usage-estimate.js --anchors | --refresh-anchors [--usage-log <path>]');
  console.log('       node usage-estimate.js --check [--stories-dir <path>]');
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.error) { console.error(`✗ usage-estimate: ${args.error}`); usage(); return 2; }
  if (args.help) { usage(); return 0; }

  const modes = [args.story ? 'story' : null, (args.band || args.type) ? 'band' : null,
    args.anchors ? 'anchors' : null, args.refresh ? 'refresh' : null, args.check ? 'check' : null]
    .filter(Boolean);
  if (modes.length === 0) { console.error('✗ usage-estimate: give one mode'); usage(); return 2; }
  if (modes.length > 1) {
    console.error(`✗ usage-estimate: give exactly ONE mode (got ${modes.join(', ')})`);
    return 2;
  }

  if (args.anchors) {
    console.log(JSON.stringify(est.ANCHORS, null, 2));
    console.log(`heuristic v${est.HEURISTIC_VERSION} · bands ${JSON.stringify(est.BAND_RATIO)} `
      + `· type multipliers ${JSON.stringify(est.TYPE_MULTIPLIER)} (all 1.00 until per-type actuals exist)`);
    console.log(`activation date ${est.ACTIVATION_DATE} — stories created before it are exempt`);
    return 0;
  }

  if (args.refresh) {
    const logPath = args.usageLog || process.env.PM_USAGE_LOG || DEFAULT_LOG_PATH;
    const { found, records } = readUsageLog(logPath);
    if (!found) { console.log(`no ledger at ${logPath} — nothing to measure, anchors unchanged`); return 0; }
    const fresh = est.recomputeAnchors(records, { sidecarDir: DEFAULT_SIDECAR_DIR });
    if (!fresh.ok) { console.log(`cannot re-measure: ${fresh.why} — anchors unchanged`); return 0; }
    const drift = est.anchorDrift(fresh);
    console.log(`recorded : anchor_m=${est.fmt(est.ANCHORS.anchor_m_tokens)} `
      + `(snapshot ${est.ANCHORS.snapshot_date}, ${est.ANCHORS.intervals} intervals)`);
    console.log(`measured : anchor_m=${est.fmt(fresh.anchor_m_tokens)} `
      + `(raw ${Math.round(fresh.anchor_m_raw)}, ${fresh.intervals} intervals over ${fresh.rows} chat rows, `
      + `median interval ${est.fmt(fresh.median_chat_interval_tokens)} / ${fresh.stories_per_chat_mean} stories per chat)`);
    console.log(`divisor  : ${fresh.stories_per_chat_mean} stories per chat `
      + `(${fresh.stories_per_chat_measured ? 'MEASURED now from ' + fresh.stories_per_chat_source
        : 'carried from the recorded snapshot — no sidecars found'}), recorded `
      + `${est.ANCHORS.stories_per_chat_mean}`);
    console.log(`drift    : ${(drift * 100).toFixed(1)}% — update ANCHORS in lib/usage-estimate.js `
      + `(snapshot_date, rows, intervals, median_chat_interval_tokens, stories_per_chat_mean, `
      + `anchor_m_tokens) AND the table in 90-Standards/USAGE-ESTIMATE-HEURISTIC.md if this has moved materially`);
    return 0;
  }

  if (args.check) {
    const dir = args.storiesDir || DEFAULT_STORIES_DIR;
    const res = est.checkCorpus(dir);
    console.log(`usage-estimate --check: ${res.checked} stor(y/ies) created on or after `
      + `${res.activation} (${res.exempt} exempt as historic corpus)`);
    if (res.offenders.length === 0) { console.log('✓ every post-activation story carries a usage_estimate'); return 0; }
    console.error(`✗ ${res.offenders.length} post-activation stor(y/ies) fail the estimate contract:`);
    for (const o of res.offenders) {
      console.error(`    ${o.id || '(no id)'} — ${path.relative(process.cwd(), o.file)}`);
      console.error(`      ${o.reason} (usage_estimate '${o.value === null ? '(absent)' : o.value}', created ${o.created_at})`);
      // MINOR-2 — the fix is NAMED, because "offender" plus a producer that declines to act on
      // it left the operator with no stated way out.
      console.error(`      fix: ${o.fix}`);
    }
    return 1;
  }

  if (args.band || args.type) {
    const d = est.derive({ estimate: args.band, type_of_work: args.type },
      { measured: measureNow(args.usageLog) });
    if (d.value === null) { console.log(`no estimate: ${d.why}`); return 0; }
    console.log(String(d.value));
    console.log(d.basis);
    return 0;
  }

  // --story
  let text;
  try { text = fs.readFileSync(args.story, 'utf8'); } catch (err) {
    console.error(`✗ usage-estimate: cannot read ${args.story} (${err.code || err.message})`);
    return 2;
  }
  const res = est.fillIfMissing(text, { measured: measureNow(args.usageLog) });
  if (!res.changed) { console.log(`unchanged: ${res.why}`); return 0; }
  if (args.dryRun) {
    console.log(`would write usage_estimate: ${res.value}`);
    console.log(res.basis);
    return 0;
  }
  fs.writeFileSync(args.story, res.text);
  console.log(`usage_estimate: ${res.value} -> ${args.story}`);
  console.log(res.basis);
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { main, parseArgs };
