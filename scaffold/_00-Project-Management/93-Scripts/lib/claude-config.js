/**
 * claude-config.js
 *
 * Read/write the host repo's .claude-pm-config.json, which persists the
 * include/exclude boundary decisions for the CLAUDE.md-layer automation.
 *
 *   { "claude_md": { "include": ["/", "/apps/web"], "exclude": ["/infra"] },
 *     "last_audit": "2026-05-23T10:00:00+01:00" }
 *
 * Dependency-free — Node stdlib only.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_NAME = '.claude-pm-config.json';

function configPath(root) {
  return path.join(root, CONFIG_NAME);
}

function readConfig(root) {
  const p = configPath(root);
  if (!fs.existsSync(p)) {
    return { claude_md: { include: [], exclude: [] } };
  }
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    throw new Error(`Malformed ${CONFIG_NAME}: ${e.message}`);
  }
  // Valid JSON that isn't an object (null, array, string, number) must also fail
  // with a clear Malformed error rather than crashing on property access below.
  if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) {
    throw new Error(`Malformed ${CONFIG_NAME}: expected a JSON object`);
  }
  cfg.claude_md = cfg.claude_md || {};
  cfg.claude_md.include = cfg.claude_md.include || [];
  cfg.claude_md.exclude = cfg.claude_md.exclude || [];
  return cfg;
}

function writeConfig(root, cfg) {
  fs.writeFileSync(configPath(root), JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

// 'included' | 'excluded' | 'undecided' for a candidate path.
function decideStatus(cfg, candidatePath) {
  const inc = (cfg.claude_md && cfg.claude_md.include) || [];
  const exc = (cfg.claude_md && cfg.claude_md.exclude) || [];
  // Exclude takes priority: a path in both lists resolves to 'excluded'.
  if (exc.includes(candidatePath)) return 'excluded';
  if (inc.includes(candidatePath)) return 'included';
  return 'undecided';
}

module.exports = { CONFIG_NAME, configPath, readConfig, writeConfig, decideStatus };
