/**
 * pm-materialize.js — shared materialization helpers for install.js and update.js.
 *
 * Extracted from the inline duplicates that existed in both scripts (BACKLOG-0073 /
 * STORY-19.3.03). Both install.js and update.js require this module so the two callers
 * can never drift apart.
 *
 * Exported symbols:
 *   ROLE_BY_FULL_FOLDER  — reverse of PRESETS.full: physical folder name → logical role
 *   remapPmSubPath       — remap a PM-sub-folder path through a layoutMap
 *   remapPmRepoPath      — remap a repo-root-relative PM path through a layoutMap
 *   walkFiles            — recursively list files under a directory (absolute paths)
 *   readJson             — tolerant JSON file reader (returns null on error)
 *
 * Dependency-free — Node stdlib only.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { PRESETS } = require('./pm-paths');

// Reverse of the canonical 'full' preset: physical folder name → logical role. Lets
// install.js / update.js remap a manifest path (authored in 'full' numbering) onto a
// flattened/custom layout — e.g. '30-Epics' → role 'epics' → the target layout's
// physical folder for 'epics'.
const ROLE_BY_FULL_FOLDER = Object.fromEntries(
  Object.entries(PRESETS.full).map(([role, folder]) => [folder, role])
);

/**
 * Remap the first PM-sub-folder segment of a 'full'-layout path through `layoutMap`.
 * `subPath` is PM-root-relative (e.g. '91-Templates/STORY.template.md'); a segment
 * with no known role passes through unchanged. On the 'full' layout this is the identity.
 * @param {string} subPath
 * @param {Object} layoutMap role → physical folder name
 * @returns {string}
 */
function remapPmSubPath(subPath, layoutMap) {
  const parts = String(subPath).split('/');
  const role = ROLE_BY_FULL_FOLDER[parts[0]];
  if (role && layoutMap[role]) parts[0] = layoutMap[role];
  return parts.join('/');
}

/**
 * Remap a repo-root-relative manifest folder path
 * ('_00-Project-Management/30-Epics') — strip the PM-root prefix, remap the
 * sub-folder through the layout map, re-join. Non-PM paths pass through unchanged.
 * @param {string} repoRel
 * @param {Object} layoutMap role → physical folder name
 * @returns {string}
 */
function remapPmRepoPath(repoRel, layoutMap) {
  const parts = String(repoRel).split('/');
  if (parts[0] !== '_00-Project-Management' || parts.length < 2) return repoRel;
  return '_00-Project-Management/' + remapPmSubPath(parts.slice(1).join('/'), layoutMap);
}

/**
 * Recursively list files under `dir` (absolute paths); returns [] if absent.
 * @param {string} dir
 * @returns {string[]}
 */
function walkFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

/**
 * Tolerant JSON file reader — returns null on missing file or parse error.
 * @param {string} p absolute file path
 * @returns {any}
 */
function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_e) { return null; }
}

module.exports = { ROLE_BY_FULL_FOLDER, remapPmSubPath, remapPmRepoPath, walkFiles, readJson };
