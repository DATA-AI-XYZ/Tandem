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
 *                    when any CLAUDE.md is incomplete (never blocks).
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
      runNode('generate-dashboard.js', cwd);
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

  // Unknown event — no-op.
  process.exit(0);
}

main();
