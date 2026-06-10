/**
 * claude-md-writer.js
 *
 * File-mutation safety for the CLAUDE.md-layer automation:
 *  - upsertManagedBlock: replace the inner content of a PM-KIT managed block,
 *    preserving the begin/end marker lines and ALL content outside the block.
 *    If the block is absent, append a fresh one. Idempotent.
 *  - mergeSettingsDeny: union a deny list into a settings.json object, leaving
 *    every other key untouched.
 *  - buildCommandsBlock: render detected scripts as `[auto — verify]` lines.
 *
 * Dependency-free — Node stdlib only.
 */
'use strict';

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replace the inner content between PM-KIT:BEGIN <marker> and PM-KIT:END
 * <marker>. Marker lines may carry trailing descriptive text before `-->`.
 * @param {string} content  current file content
 * @param {string} marker   e.g. "managed:commands" or "managed"
 * @param {string[]} innerLines  lines to place between the markers
 * @returns {string} new content
 */
function upsertManagedBlock(content, marker, innerLines) {
  const m = escapeRe(marker);
  // The `(?=[ \t]|--)` lookahead anchors the marker name so the bare `managed`
  // marker does NOT also match `managed:commands` (a substring-collision landmine).
  const beginRe = new RegExp(`[ \\t]*<!--\\s*PM-KIT:BEGIN ${m}(?=[ \\t]|--)[^\\n]*-->`);
  const endRe = new RegExp(`[ \\t]*<!--\\s*PM-KIT:END ${m}(?=[ \\t]|--)[^\\n]*-->`);
  const inner = innerLines.join('\n');
  const begin = content.match(beginRe);
  const end = content.match(endRe);
  if (begin && end && end.index > begin.index) {
    const afterBegin = begin.index + begin[0].length;
    return content.slice(0, afterBegin) + '\n' + inner + '\n' + content.slice(end.index);
  }
  // Absent or malformed — append a fresh, well-formed block.
  const block =
    `\n<!-- PM-KIT:BEGIN ${marker} -->\n${inner}\n<!-- PM-KIT:END ${marker} -->\n`;
  return content.replace(/\s*$/, '\n') + block;
}

/**
 * Union `denyArray` into settings.permissions.deny, preserving other keys.
 * @param {object|null} existing  parsed settings.json (or null/empty)
 * @param {string[]} denyArray
 * @returns {object} merged settings object
 */
function mergeSettingsDeny(existing, denyArray) {
  const obj = existing && typeof existing === 'object' ? existing : {};
  obj.permissions = obj.permissions && typeof obj.permissions === 'object' ? obj.permissions : {};
  const cur = Array.isArray(obj.permissions.deny) ? obj.permissions.deny : [];
  obj.permissions.deny = Array.from(new Set([...cur, ...denyArray]));
  return obj;
}

/**
 * Render detected npm scripts as `[auto — verify]` markdown list lines.
 * @param {object} scripts  { test, build, dev, lint, start } -> command
 * @returns {string[]}
 */
function buildCommandsBlock(scripts) {
  const labels = { test: 'Tests', build: 'Build', dev: 'Dev', lint: 'Lint', start: 'Start' };
  const keys = Object.keys(labels).filter((k) => scripts && scripts[k]);
  if (keys.length === 0) {
    return ['<!-- no package scripts detected — add commands manually -->'];
  }
  return keys.map((k) => `- ${labels[k]}: \`${scripts[k]}\`   [auto — verify]`);
}

module.exports = { upsertManagedBlock, mergeSettingsDeny, buildCommandsBlock };
