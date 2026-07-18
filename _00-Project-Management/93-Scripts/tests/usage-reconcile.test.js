#!/usr/bin/env node
/**
 * usage-reconcile.test.js — behavioural test for usage-reconcile.js (STORY-21.2.02 / TC-02).
 *
 * Stages a self-contained fixture tree in a temp dir — a handful of STORY files (some
 * carrying `usage_estimate:`, some not) under a fake `32-Stories/EPIC-XX/FEAT-XX.Y/`
 * layout, plus a temp `usage-log.jsonl` with matching/mismatched actuals — and drives the
 * helper as a CHILD process (spawnSync — true black-box, not a require() of internals) via
 * its `--usage-log` / `--stories-dir` / `--strategy-dir` test-override flags. Never touches
 * the real corpus or the real usage log.
 *
 * Asserts:
 *   - per-story variance output (estimate, actual, +/- variance) for stories carrying both
 *   - a per-batch rollup line (feature-prefix rollup by default, chat rollup via --chat
 *     against a temp EXECUTION-STRATEGY-*.json sidecar)
 *   - the missing-usage-log case prints the explicit "no actuals recorded yet" message
 *   - the --seed no-history path prints the explicit "no history — no seed" line and never
 *     fabricates a number
 *   - the --seed happy path computes the MEDIAN of matching DONE stories' actuals
 *
 * Exit 0 = pass, non-zero = fail. Dependency-free (Node stdlib only).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPTS_ROOT = path.resolve(__dirname, '..');
const HELPER = path.join(SCRIPTS_ROOT, 'usage-reconcile.js');

let failures = 0;
function check(name, cond) {
  if (cond) { console.log('  ok  - ' + name); }
  else { console.log('  FAIL- ' + name); failures += 1; }
}

function runHelper(args) {
  return spawnSync(process.execPath, [HELPER, ...args], { encoding: 'utf8' });
}

function storyFixture({ id, feature, status, estimate, typeOfWork, usageEstimate }) {
  const lines = [
    '---',
    'type: story',
    `id: ${id}`,
    `epic: ${feature.split('.')[0].replace('FEAT-', 'EPIC-')}`,
    `feature: ${feature}`,
    `title: Fixture story ${id}`,
    `status: ${status}`,
    "created_at: '2026-07-01T00:00:00+01:00'",
    `started_at: ${status === 'not-started' ? "''" : "'2026-07-01T00:00:00+01:00'"}`,
    `completed_at: ${status === 'done' ? "'2026-07-02T00:00:00+01:00'" : "''"}`,
    `estimate: ${estimate}`,
    'priority: P2',
    `type_of_work: ${typeOfWork}`,
    ...(usageEstimate !== undefined ? [`usage_estimate: '${usageEstimate}'`] : []),
    '---',
    '',
    `# ${id} · fixture`,
    '',
  ];
  return lines.join('\n');
}

function usageRecord(id, kind, input, output) {
  return JSON.stringify({
    ts: '2026-07-15T12:00:00.000Z', id, kind, model: ['claude-sonnet-5'],
    tokens: { input, output, cache_read: 0, cache_creation: 0 },
    source: 'fixture',
  });
}

function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-usage-reconcile-test-'));
  try {
    const storiesDir = path.join(tmpDir, '32-Stories');
    const featDir = path.join(storiesDir, 'EPIC-90', 'FEAT-90.1');
    fs.mkdirSync(featDir, { recursive: true });

    // STORY-90.1.01: estimate=1000, actual=1500 (in usage log) — variance +500 (+50%).
    fs.writeFileSync(path.join(featDir, 'STORY-90.1.01-fixture.md'), storyFixture({
      id: 'STORY-90.1.01', feature: 'FEAT-90.1', status: 'done',
      estimate: 'M', typeOfWork: 'data', usageEstimate: 1000,
    }));
    // STORY-90.1.02: estimate=2000, actual=1800 (in usage log) — variance -200 (-10%).
    fs.writeFileSync(path.join(featDir, 'STORY-90.1.02-fixture.md'), storyFixture({
      id: 'STORY-90.1.02', feature: 'FEAT-90.1', status: 'done',
      estimate: 'M', typeOfWork: 'data', usageEstimate: 2000,
    }));
    // STORY-90.1.03: no usage_estimate, no actual — must be excluded from the report entirely.
    fs.writeFileSync(path.join(featDir, 'STORY-90.1.03-fixture.md'), storyFixture({
      id: 'STORY-90.1.03', feature: 'FEAT-90.1', status: 'not-started',
      estimate: 'S', typeOfWork: 'data',
    }));

    const usageLogPath = path.join(tmpDir, 'usage-log.jsonl');
    const logLines = [
      usageRecord('STORY-90.1.01', 'story', 1000, 500), // total 1500
      usageRecord('STORY-90.1.02', 'story', 1200, 600), // total 1800
    ];
    fs.writeFileSync(usageLogPath, logLines.join('\n') + '\n');

    // ---- missing usage-log: clear "no actuals recorded yet" message, exit 0 ----
    const missingLogPath = path.join(tmpDir, 'does-not-exist.jsonl');
    const missingResult = runHelper(['--usage-log', missingLogPath, '--stories-dir', storiesDir]);
    check('missing usage-log: helper exits 0', missingResult.status === 0);
    check('missing usage-log: prints an explicit "no actuals recorded yet" message',
      /no actuals recorded yet/.test(missingResult.stdout || ''));

    // ---- main reconciliation run: per-story variance + feature rollup ----
    const result = runHelper(['--usage-log', usageLogPath, '--stories-dir', storiesDir]);
    check('reconcile run exits 0', result.status === 0);
    const out = result.stdout || '';

    check('per-story line for STORY-90.1.01 shows estimate=1000', /STORY-90\.1\.01\s+estimate=1000/.test(out));
    check('per-story line for STORY-90.1.01 shows actual=1500', /STORY-90\.1\.01.*actual=1500/.test(out));
    check('per-story line for STORY-90.1.01 shows a positive variance (+500)', /STORY-90\.1\.01.*variance=\+500/.test(out));
    check('per-story line for STORY-90.1.02 shows a negative variance (-200)', /STORY-90\.1\.02.*variance=-200/.test(out));
    check('STORY-90.1.03 (no estimate, no actual) is excluded from the report', !/STORY-90\.1\.03/.test(out));

    check('output contains a per-batch (feature) rollup section', /Rollup \(by feature\)/.test(out));
    check('rollup line for FEAT-90.1 sums estimate=3000', /FEAT-90\.1\s+estimate=3000/.test(out));
    check('rollup line for FEAT-90.1 sums actual=3300', /FEAT-90\.1.*actual=3300/.test(out));
    check('rollup line for FEAT-90.1 shows variance=+300', /FEAT-90\.1.*variance=\+300/.test(out));

    // ---- --chat rollup against a temp EXECUTION-STRATEGY-*.json sidecar ----
    const reportsDir = path.join(tmpDir, '41-Reports');
    fs.mkdirSync(reportsDir, { recursive: true });
    const sidecar = {
      epic: 'EPIC-90',
      phases: [{
        name: 'Fixture phase',
        chats: [{
          id: 'CHAT-90',
          stories: [{ id: 'STORY-90.1.01' }, { id: 'STORY-90.1.02' }],
        }],
      }],
    };
    fs.writeFileSync(path.join(reportsDir, 'EXECUTION-STRATEGY-fixture.json'), JSON.stringify(sidecar));

    const chatResult = runHelper([
      '--usage-log', usageLogPath, '--stories-dir', storiesDir,
      '--strategy-dir', reportsDir, '--chat', 'CHAT-90',
    ]);
    check('--chat run exits 0', chatResult.status === 0);
    const chatOut = chatResult.stdout || '';
    check('output contains a per-batch (chat) rollup section', /Rollup \(by chat CHAT-90\)/.test(chatOut));
    check('chat rollup sums both member stories (estimate=3000)', /CHAT-90\s+estimate=3000/.test(chatOut));
    check('chat rollup sums both member stories (actual=3300)', /CHAT-90.*actual=3300/.test(chatOut));

    // ---- unknown chat id: reported explicitly, still exit 0 ----
    const unknownChatResult = runHelper([
      '--usage-log', usageLogPath, '--stories-dir', storiesDir,
      '--strategy-dir', reportsDir, '--chat', 'CHAT-NOPE',
    ]);
    check('unknown --chat id still exits 0', unknownChatResult.status === 0);
    check('unknown --chat id is reported explicitly, not silently dropped',
      /was not found in any EXECUTION-STRATEGY/.test(unknownChatResult.stdout || ''));

    // ---- --seed: no history for a band/type combination that has never run ----
    const noHistoryResult = runHelper([
      '--usage-log', usageLogPath, '--stories-dir', storiesDir,
      '--seed', '--estimate-band', 'L', '--type', 'infra',
    ]);
    check('--seed no-history run exits 0', noHistoryResult.status === 0);
    check('--seed no-history prints the explicit "no history — no seed" line',
      /no history — no seed/.test(noHistoryResult.stdout || ''));
    check('--seed no-history never fabricates a numeric suggestion',
      !/seed suggestion/.test(noHistoryResult.stdout || ''));

    // ---- --seed: happy path — median of matching DONE stories' actuals (1500, 1800) -> 1650 ----
    const seedResult = runHelper([
      '--usage-log', usageLogPath, '--stories-dir', storiesDir,
      '--seed', '--estimate-band', 'M', '--type', 'data',
    ]);
    check('--seed happy-path run exits 0', seedResult.status === 0);
    check('--seed happy-path prints the median (1650) of the two matching actuals',
      /seed suggestion.*1650 tokens/s.test(seedResult.stdout || ''));

    // ---- --seed: missing required args is a usage error ----
    const seedBadArgs = runHelper(['--usage-log', usageLogPath, '--stories-dir', storiesDir, '--seed']);
    check('--seed without --estimate-band/--type exits non-zero (usage error)', seedBadArgs.status !== 0 && seedBadArgs.status === 2);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  if (failures === 0) {
    console.log('\n✓ usage-reconcile — all checks passed.');
    process.exit(0);
  }
  console.log('\n✗ usage-reconcile — ' + failures + ' check(s) failed.');
  process.exit(1);
}

main();
