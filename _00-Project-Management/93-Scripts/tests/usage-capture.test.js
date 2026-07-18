#!/usr/bin/env node
/**
 * usage-capture.test.js — behavioural test for usage-capture.js (STORY-21.2.01 / TC-02).
 *
 * Stages a fixture session-transcript JSONL (a few `assistant` messages carrying `usage`
 * fields + a model id, one `isSidechain: true` sub-agent turn, plus malformed/irrelevant
 * lines interspersed), runs the helper as a CHILD process (spawnSync — true black-box, not
 * a require() of internals) with `--story STORY-00.0.00 --source <fixture>` and a temp
 * `--out` log path so it never writes the real `41-Reports/usage/usage-log.jsonl`. Asserts
 * the appended record carries the story id, the four token fields summed correctly
 * (INCLUDING the sidechain/sub-agent record per ADR-0079's fan-out attribution), and a
 * model id — and that malformed lines were skipped rather than crashing the run.
 *
 * Exit 0 = pass, non-zero = fail. Dependency-free (Node stdlib only).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPTS_ROOT = path.resolve(__dirname, '..');
const HELPER = path.join(SCRIPTS_ROOT, 'usage-capture.js');

let failures = 0;
function check(name, cond) {
  if (cond) { console.log('  ok  - ' + name); }
  else { console.log('  FAIL- ' + name); failures += 1; }
}

// ---------- fixture ----------

// Two real assistant usage records (one main-thread, one isSidechain sub-agent fan-out —
// ADR-0079 says fan-out counts toward the dispatching bracket), a non-assistant record
// (no usage — must be ignored), and two malformed lines (must be skipped, not thrown).
const FIXTURE_LINES = [
  JSON.stringify({
    type: 'assistant', isSidechain: false, sessionId: 'fixture-session',
    timestamp: '2026-07-18T09:00:00.000Z',
    message: { model: 'claude-sonnet-5', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 } },
  }),
  JSON.stringify({
    type: 'assistant', isSidechain: true, sessionId: 'fixture-session',
    timestamp: '2026-07-18T09:01:00.000Z',
    message: { model: 'claude-haiku-5', usage: { input_tokens: 20, output_tokens: 8, cache_read_input_tokens: 2, cache_creation_input_tokens: 0 } },
  }),
  JSON.stringify({ type: 'user', isSidechain: false, sessionId: 'fixture-session', timestamp: '2026-07-18T09:02:00.000Z', message: { role: 'user', content: 'no usage here' } }),
  '{ this is not valid json at all',
  '   ',
  JSON.stringify({ type: 'attachment', sessionId: 'fixture-session' }), // no message/usage — ignored, not malformed
];

const EXPECTED = {
  input: 100 + 20,
  output: 50 + 8,
  cache_read: 10 + 2,
  cache_creation: 5 + 0,
};
const EXPECTED_MODELS = ['claude-haiku-5', 'claude-sonnet-5'];

function runHelper(args, extraEnv) {
  return spawnSync(process.execPath, [HELPER, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...(extraEnv || {}) },
  });
}

function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-usage-capture-test-'));
  const fixturePath = path.join(tmpDir, 'fixture-session.jsonl');
  const logPath = path.join(tmpDir, 'usage-log.jsonl');

  // Snapshot the REAL log's state before running anything, so we can prove this test never
  // touched it (every invocation below passes --out to a temp path instead).
  const realLogPath = path.join(SCRIPTS_ROOT, '..', '41-Reports', 'usage', 'usage-log.jsonl');
  const realLogBefore = fs.existsSync(realLogPath) ? fs.readFileSync(realLogPath, 'utf8') : null;

  try {
    fs.writeFileSync(fixturePath, FIXTURE_LINES.join('\n') + '\n');

    // ---- main behavioural run: --story + --source fixture + --out temp log ----
    const result = runHelper(['--story', 'STORY-00.0.00', '--source', fixturePath, '--out', logPath]);
    check('helper exits 0 on a valid fixture run', result.status === 0);
    check('helper prints a one-line human summary containing the story id', /STORY-00\.0\.00/.test(result.stdout || ''));

    check('temp log file was created', fs.existsSync(logPath));
    const lines = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean) : [];
    check('exactly one record appended to the temp log', lines.length === 1);

    let record = null;
    try { record = JSON.parse(lines[0] || '{}'); } catch { /* leave null */ }
    check('emitted record parses as JSON', record !== null);

    if (record) {
      check('record.id carries the story id', record.id === 'STORY-00.0.00');
      check('record.kind is "story"', record.kind === 'story');
      check('record.tokens.input summed correctly (incl. sub-agent/sidechain)', record.tokens && record.tokens.input === EXPECTED.input);
      check('record.tokens.output summed correctly (incl. sub-agent/sidechain)', record.tokens && record.tokens.output === EXPECTED.output);
      check('record.tokens.cache_read summed correctly (incl. sub-agent/sidechain)', record.tokens && record.tokens.cache_read === EXPECTED.cache_read);
      check('record.tokens.cache_creation summed correctly (incl. sub-agent/sidechain)', record.tokens && record.tokens.cache_creation === EXPECTED.cache_creation);
      check('record carries a model id', Array.isArray(record.model) && record.model.length > 0);
      check('record.model includes both models seen (main + sidechain fan-out)',
        Array.isArray(record.model) && EXPECTED_MODELS.every(m => record.model.includes(m)));
      check('record carries a ts (ISO timestamp)', typeof record.ts === 'string' && !Number.isNaN(Date.parse(record.ts)));
      check('record carries the source path', record.source === fixturePath);
    }

    // ---- malformed-lines-skipped, not crashed: re-run with ONLY malformed content ----
    const malformedOnlyPath = path.join(tmpDir, 'malformed-only.jsonl');
    fs.writeFileSync(malformedOnlyPath, '{not json\n{"also": "not", "valid"\n\n');
    const malformedLog = path.join(tmpDir, 'malformed-usage-log.jsonl');
    const malformedResult = runHelper(['--chat', 'CHAT-00', '--source', malformedOnlyPath, '--out', malformedLog]);
    check('helper exits 0 when source has ONLY malformed lines (no crash)', malformedResult.status === 0);
    check('helper no-ops (prints the unavailable note) when nothing usable is found', /usage source unavailable — skipped \(no-op\)/.test(malformedResult.stdout || ''));
    check('no log record written for a source with no usable usage records', !fs.existsSync(malformedLog));

    // ---- --story and --chat both given: usage error ----
    const bothResult = runHelper(['--story', 'STORY-00.0.00', '--chat', 'CHAT-00', '--source', fixturePath, '--out', logPath]);
    check('helper rejects --story AND --chat together with a non-zero exit', bothResult.status !== 0);

    // ---- neither --story nor --chat given: usage error ----
    const neitherResult = runHelper(['--source', fixturePath, '--out', logPath]);
    check('helper rejects neither --story nor --chat with a non-zero exit', neitherResult.status !== 0);

    // ---- the real 41-Reports/usage/usage-log.jsonl was never touched by this test ----
    const realLogAfter = fs.existsSync(realLogPath) ? fs.readFileSync(realLogPath, 'utf8') : null;
    check('the real 41-Reports/usage/usage-log.jsonl is unchanged (every run above used --out)', realLogAfter === realLogBefore);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  if (failures === 0) {
    console.log('\n✓ usage-capture — all checks passed.');
    process.exit(0);
  }
  console.log('\n✗ usage-capture — ' + failures + ' check(s) failed.');
  process.exit(1);
}

main();
