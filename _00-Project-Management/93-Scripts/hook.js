#!/usr/bin/env node
/**
 * hook.js — canonical, dependency-free Claude Code hook entrypoint for the PM kit.
 *
 * Single source of truth for hook behaviour (STORY-12.3.01 / ADR-0053). The kit's
 * hook definitions (hooks/hooks.json and the scaffolded .claude/settings.json) call
 * `node 93-Scripts/hook.js <event>` so the hooks behave identically on Windows,
 * macOS, and Linux — no `jq`/`bash`/`case`/`git -C`/`grep` shell-out, no PATH
 * dependency on `node`/`npm`/`jq`.
 *
 * It reads the hook payload as JSON on stdin and dispatches on argv[2]:
 *   post-tool-use  → if the edited file is under _00-Project-Management/, run the
 *                    project's validate-frontmatter.js (frontmatter lint).
 *   stop           → if the working tree has changes under _00-Project-Management/,
 *                    regenerate the dashboard; if `.claude-pm-config.json` has
 *                    "claude_md_nudge": true, ALSO emit a one-line warn-only nudge
 *                    when any CLAUDE.md is incomplete (never blocks). A short-lived
 *                    once-guard (OS-temp sentinel, ~10s TTL) collapses a plugin+scaffold
 *                    double-registration into a single net regeneration (STORY-16.3.03).
 *   user-prompt-submit → if the session has joined the conversation mode (its id is in
 *                    .tandem-mode.json "joined"), print the mode banner to stdout for
 *                    Claude Code to inject into context. Fail-open: prints nothing on
 *                    any error. Never blocks the prompt.
 *
 * Child Node scripts are spawned with the SAME node binary (process.execPath) — the
 * one documented exception to "pure Node" is this child_process call to a kit pm:*
 * script (it never shells out to a POSIX shell). Git is invoked (when present) with
 * the `cwd` option rather than the `git -C` flag; any failure is swallowed so a hook
 * never blocks the session.
 *
 * A missing or non-JSON payload is handled gracefully (treated as {}), so a hook
 * never hard-fails the session on a malformed stdin.
 *
 * Exit codes: post-tool-use forwards the linter's code (non-zero surfaces
 * violations to the model); stop always exits 0 (advisory only).
 * Dependency-free — Node stdlib only.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const os = require('os');
const crypto = require('crypto');

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch (_e) { return ''; }
}
function parseInput() {
  const raw = readStdin();
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (_e) { return {}; }
}

// Resolve the project's 93-Scripts folder. Folder is stable (_00-Project-Management),
// scripts subfolder defaults to 93-Scripts but honours a `paths.scripts` override.
function scriptsDir(cwd) {
  let sub = '93-Scripts';
  try {
    const cfgPath = path.join(cwd, '.claude-pm-config.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (cfg && cfg.paths && typeof cfg.paths.scripts === 'string' && cfg.paths.scripts) sub = cfg.paths.scripts;
    }
  } catch (_e) { /* ignore — fall back to default */ }
  return path.join(cwd, '_00-Project-Management', sub);
}

function runNode(scriptFile, cwd) {
  const full = path.join(scriptsDir(cwd), scriptFile);
  if (!fs.existsSync(full)) return 0; // kit scripts not installed here — nothing to do
  const r = cp.spawnSync(process.execPath, [full], { cwd, encoding: 'utf8' });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  return typeof r.status === 'number' ? r.status : 0;
}

function gitChangedPM(cwd) {
  const variants = [
    ['diff', '--name-only', 'HEAD', '--', '_00-Project-Management/'],
    ['diff', '--cached', '--name-only', '--', '_00-Project-Management/'],
  ];
  for (const args of variants) {
    try {
      const r = cp.spawnSync('git', args, { cwd, encoding: 'utf8' });
      if (r.status === 0 && r.stdout && r.stdout.trim()) return true;
    } catch (_e) { /* git absent — skip */ }
  }
  return false;
}

function loadCfg(cwd) {
  try {
    const p = path.join(cwd, '.claude-pm-config.json');
    return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, 'utf8')) || {}) : {};
  } catch (_e) { return {}; }
}

// Stop-hook double-fire once-guard (STORY-16.3.03). A host can register the Stop hook via
// BOTH the plugin (hooks/hooks.json) AND the scaffolded .claude/settings.json — then one
// Stop event runs `hook.js stop` twice (the ADR-0053 trade-off). This collapses the pair to
// a SINGLE net dashboard regeneration: the first run detects no fresh sentinel and proceeds;
// it stamps the sentinel AFTER a successful regen so a sibling run within STOP_GUARD_TTL_MS
// sees the fresh stamp and skips. Stamping AFTER regen means a failed regen never stamps,
// so the retry within the TTL is always permitted (BACKLOG-0067). The guard is TTL-based so
// a stale sentinel can NEVER permanently block a later legitimate regen, and
// single-registration is unaffected (by the next Stop event the TTL has long elapsed).
// Fail-OPEN: any error in isDoubleFirePending returns false (regen proceeds) — the guard
// must never suppress a real regeneration.
const STOP_GUARD_TTL_MS = 10000;

// Returns the sentinel path for the given cwd (shared between check and stamp).
function _sentinelPath(cwd) {
  const key = crypto.createHash('md5').update(path.resolve(cwd)).digest('hex').slice(0, 16);
  return path.join(os.tmpdir(), `tandem-stop-hook-${key}.lock`);
}

// Returns true when a sibling stop-hook already ran within the TTL (skip this run).
function stopDoubleFire(cwd) {
  try {
    const sentinel = _sentinelPath(cwd);
    const now = Date.now();
    if (fs.existsSync(sentinel)) {
      const age = now - fs.statSync(sentinel).mtimeMs;
      if (age >= 0 && age < STOP_GUARD_TTL_MS) return true; // sibling just ran — skip
    }
    return false;
  } catch (_e) {
    return false; // fail-open — never suppress a legitimate regeneration
  }
}

// Stamps the sentinel AFTER a successful regen so a sibling within the TTL will skip.
// Must be called after runNode('generate-dashboard.js') succeeds.
function stampStopSentinel(cwd) {
  try {
    fs.writeFileSync(_sentinelPath(cwd), String(Date.now()));
  } catch (_e) { /* fail-open — a stamp failure is non-fatal */ }
}

function main() {
  const event = process.argv[2];
  const input = parseInput();
  const cwd = input.cwd || process.cwd();

  if (event === 'post-tool-use') {
    const fp = (input.tool_input && input.tool_input.file_path) || '';
    if (fp.replace(/\\/g, '/').includes('_00-Project-Management/')) {
      process.exit(runNode('validate-frontmatter.js', cwd));
    }
    process.exit(0);
  }

  if (event === 'stop') {
    if (gitChangedPM(cwd)) {
      // Collapse a plugin+scaffold double-registration into one net regen (STORY-16.3.03).
      if (stopDoubleFire(cwd)) process.exit(0);
      const regenStatus = runNode('generate-dashboard.js', cwd);
      // Stamp sentinel ONLY after a successful regen (exit 0) — runNode returns the child's
      // exit status (spawnSync does not throw on a non-zero exit), so a failed regen leaves
      // no stamp and the retry within the 10s TTL is always allowed (BACKLOG-0067). A
      // not-installed no-op returns 0, which correctly stamps (nothing failed).
      if (regenStatus === 0) stampStopSentinel(cwd);
      // Phase-4 nudge — opt-in, warn-only, never blocks.
      const cfg = loadCfg(cwd);
      if (cfg.claude_md_nudge === true) {
        const auditPath = path.join(scriptsDir(cwd), 'claude-audit.js');
        if (fs.existsSync(auditPath)) {
          try {
            const r = cp.spawnSync(process.execPath, [auditPath, '--json'], { cwd, encoding: 'utf8' });
            const arr = JSON.parse(r.stdout || '[]');
            const n = (Array.isArray(arr) ? arr : []).filter(x => x && x.state === 'incomplete').length;
            if (n > 0) console.error(`⚠ ${n} CLAUDE.md file(s) look incomplete — run /fill-claude-md (or: npm run pm:claude-audit).`);
          } catch (_e) { /* advisory only — swallow */ }
        }
      }
    }
    process.exit(0);
  }

  if (event === 'user-prompt-submit') {
    // Inject the conversation-mode banner for joined sessions only. Fail-open: any
    // problem (missing mode.js, missing/locked state file) prints nothing, exit 0 —
    // a hook must never block input.
    try {
      const sessionId = input.session_id || '';
      // mode.js is always co-located with hook.js (__dirname); cwd is the repo root
      // (where .tandem-mode.json lives).
      const modePath = path.join(__dirname, 'mode.js');
      if (sessionId && fs.existsSync(modePath)) {
        const mode = require(modePath);
        const line = mode.bannerFor(mode.readState(cwd), sessionId);
        if (line) process.stdout.write(line + '\n');
      }
    } catch (_e) { /* advisory only — never block the prompt */ }
    process.exit(0);
  }

  // Unknown event — no-op.
  process.exit(0);
}

main();
