#!/usr/bin/env node
/**
 * usage-projection.test.js — behavioural test for usage-reconcile.js's `--project` mode
 * (STORY-21.2.03 AC-3 / TC-03, BACKLOG-0086 Tranche D).
 *
 * Stages a self-contained fixture tree in a temp dir — a handful of STORY files (mixed
 * status, some carrying `usage_estimate:`, one not) under a fake `32-Stories/EPIC-XX/FEAT-XX.Y/`
 * layout, plus a temp `41-Reports/EXECUTION-STRATEGY-*.json` sidecar naming a CHAT's member
 * story ids — and drives the helper as a CHILD process (spawnSync — true black-box, not a
 * require() of internals) via its `--usage-log` / `--stories-dir` / `--strategy-dir` test-
 * override flags. Never touches the real corpus or the real usage log.
 *
 * Asserts:
 *   - `--project --chat <id>` sums `usage_estimate` over ONLY the chat's READY member stories
 *     (a DONE member with an estimate must NOT be counted) and reports the correct
 *     lacking-estimate count for a ready story missing `usage_estimate`
 *   - `--project --stories <id,id,...>` (the direct-list fallback) sums over exactly the
 *     named ids, status notwithstanding, and reports lacking correctly (including an
 *     unknown/non-existent story id counted as lacking)
 *   - an unknown chat id is reported explicitly, not silently dropped, and still exits 0
 *   - a chat with zero READY member stories is reported explicitly ("nothing to project")
 *     and still exits 0
 *   - `--project` with neither/both of `--chat` / `--stories` is a usage error (exit 2)
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

function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-usage-projection-test-'));
  try {
    const storiesDir = path.join(tmpDir, '32-Stories');
    const featDir = path.join(storiesDir, 'EPIC-91', 'FEAT-91.1');
    fs.mkdirSync(featDir, { recursive: true });

    // Chat CHAT-91 members: two READY stories carrying usage_estimate (2000 + 3000 = 5000),
    // one READY story with NO usage_estimate (lacking), and one DONE story that carries an
    // estimate but must be EXCLUDED because it is not READY.
    fs.writeFileSync(path.join(featDir, 'STORY-91.1.01-fixture.md'), storyFixture({
      id: 'STORY-91.1.01', feature: 'FEAT-91.1', status: 'ready',
      estimate: 'M', typeOfWork: 'data', usageEstimate: 2000,
    }));
    fs.writeFileSync(path.join(featDir, 'STORY-91.1.02-fixture.md'), storyFixture({
      id: 'STORY-91.1.02', feature: 'FEAT-91.1', status: 'ready',
      estimate: 'M', typeOfWork: 'data', usageEstimate: 3000,
    }));
    fs.writeFileSync(path.join(featDir, 'STORY-91.1.03-fixture.md'), storyFixture({
      id: 'STORY-91.1.03', feature: 'FEAT-91.1', status: 'ready',
      estimate: 'S', typeOfWork: 'data', // no usage_estimate — lacking
    }));
    fs.writeFileSync(path.join(featDir, 'STORY-91.1.04-fixture.md'), storyFixture({
      id: 'STORY-91.1.04', feature: 'FEAT-91.1', status: 'done',
      estimate: 'M', typeOfWork: 'data', usageEstimate: 1000, // must be excluded — not ready
    }));

    // Chat CHAT-92: a single DONE member — zero READY stories to project.
    fs.writeFileSync(path.join(featDir, 'STORY-91.1.05-fixture.md'), storyFixture({
      id: 'STORY-91.1.05', feature: 'FEAT-91.1', status: 'done',
      estimate: 'S', typeOfWork: 'data', usageEstimate: 500,
    }));

    const reportsDir = path.join(tmpDir, '41-Reports');
    fs.mkdirSync(reportsDir, { recursive: true });
    const sidecar = {
      epic: 'EPIC-91',
      phases: [{
        name: 'Fixture phase',
        chats: [
          {
            id: 'CHAT-91',
            stories: [
              { id: 'STORY-91.1.01' }, { id: 'STORY-91.1.02' },
              { id: 'STORY-91.1.03' }, { id: 'STORY-91.1.04' },
            ],
          },
          { id: 'CHAT-92', stories: [{ id: 'STORY-91.1.05' }] },
        ],
      }],
    };
    fs.writeFileSync(path.join(reportsDir, 'EXECUTION-STRATEGY-fixture.json'), JSON.stringify(sidecar));

    const missingLogPath = path.join(tmpDir, 'does-not-exist.jsonl');

    // ---- --project --chat CHAT-91: sums only the READY members ----
    const chatResult = runHelper([
      '--project', '--chat', 'CHAT-91',
      '--usage-log', missingLogPath, '--stories-dir', storiesDir, '--strategy-dir', reportsDir,
    ]);
    check('--project --chat exits 0', chatResult.status === 0);
    const chatOut = chatResult.stdout || '';
    check('--project --chat reports 3 READY stories considered', /3 stor(y|ies)/.test(chatOut));
    check('--project --chat reports 2 with usage_estimate', /2 with usage_estimate/.test(chatOut));
    check('--project --chat reports 1 lacking', /1 lacking/.test(chatOut));
    check('--project --chat sums the two READY estimates as projected spend (5000 tokens)',
      /projected spend: 5000 tokens/.test(chatOut));
    check('--project --chat EXCLUDES the DONE member (STORY-91.1.04) from the per-row listing',
      !/STORY-91\.1\.04/.test(chatOut));
    check('--project --chat lists the lacking READY story explicitly (STORY-91.1.03)',
      /STORY-91\.1\.03\s+\(no usage_estimate/.test(chatOut));

    // ---- --project --stories: direct list, used as-given (status not filtered) ----
    // Includes the DONE story (STORY-91.1.04, estimate=1000) which --chat mode excluded, plus
    // an unknown id (never on disk) which must count as lacking without crashing.
    const storiesResult = runHelper([
      '--project', '--stories', 'STORY-91.1.01,STORY-91.1.04,STORY-91.1.99-unknown',
      '--usage-log', missingLogPath, '--stories-dir', storiesDir, '--strategy-dir', reportsDir,
    ]);
    check('--project --stories exits 0', storiesResult.status === 0);
    const storiesOut = storiesResult.stdout || '';
    check('--project --stories reports 3 named stories considered', /3 stor(y|ies)/.test(storiesOut));
    check('--project --stories reports 2 with usage_estimate', /2 with usage_estimate/.test(storiesOut));
    check('--project --stories reports 1 lacking (the unknown id)', /1 lacking/.test(storiesOut));
    check('--project --stories sums 2000 (STORY-91.1.01) + 1000 (STORY-91.1.04, DONE but named directly) = 3000',
      /projected spend: 3000 tokens/.test(storiesOut));
    check('--project --stories marks the unknown id as an unknown story id, not a silent zero',
      /STORY-91\.1\.99-unknown\s+\(unknown story id/.test(storiesOut));

    // ---- unknown chat id: reported explicitly, still exit 0 ----
    const unknownChatResult = runHelper([
      '--project', '--chat', 'CHAT-NOPE',
      '--usage-log', missingLogPath, '--stories-dir', storiesDir, '--strategy-dir', reportsDir,
    ]);
    check('--project unknown --chat id still exits 0', unknownChatResult.status === 0);
    check('--project unknown --chat id is reported explicitly, not silently dropped',
      /was not found in any EXECUTION-STRATEGY/.test(unknownChatResult.stdout || ''));

    // ---- chat with zero READY member stories: reported explicitly, still exit 0 ----
    const noReadyResult = runHelper([
      '--project', '--chat', 'CHAT-92',
      '--usage-log', missingLogPath, '--stories-dir', storiesDir, '--strategy-dir', reportsDir,
    ]);
    check('--project chat-with-no-ready-members still exits 0', noReadyResult.status === 0);
    check('--project chat-with-no-ready-members prints an explicit "nothing to project" message',
      /0 READY member stor.*nothing to project/.test(noReadyResult.stdout || ''));

    // ---- usage errors: neither / both of --chat and --stories ----
    const neitherResult = runHelper(['--project', '--usage-log', missingLogPath, '--stories-dir', storiesDir]);
    check('--project with neither --chat nor --stories is a usage error (exit 2)', neitherResult.status === 2);

    const bothResult = runHelper([
      '--project', '--chat', 'CHAT-91', '--stories', 'STORY-91.1.01',
      '--usage-log', missingLogPath, '--stories-dir', storiesDir, '--strategy-dir', reportsDir,
    ]);
    check('--project with BOTH --chat and --stories is a usage error (exit 2)', bothResult.status === 2);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  if (failures === 0) {
    console.log('\n✓ usage-projection — all checks passed.');
    process.exit(0);
  }
  console.log('\n✗ usage-projection — ' + failures + ' check(s) failed.');
  process.exit(1);
}

main();
