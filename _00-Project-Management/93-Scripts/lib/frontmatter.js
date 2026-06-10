/**
 * frontmatter.js
 *
 * Shared YAML frontmatter parser used by both validate-frontmatter.js and
 * generate-monitor.js. Implements hardened parsing rules per ADR-0041 (R20):
 * - Detects and flags nested keys (not supported in kit's flat YAML)
 * - Detects and flags duplicate top-level keys
 * - Handles scalar coercion, quote stripping, inline arrays, and multi-line lists
 *
 * Exported function: parseFrontmatter(content)
 *   Returns: null (no frontmatter) or an object with:
 *     - All parsed key-value pairs (scalar, array, etc.)
 *     - _diagnostics: array of {type, key, [line]} for nested/duplicate detection
 *       (value semantics: last-write-wins, so on clean corpus counts are unchanged)
 *
 * Both calling scripts use the diagnostics field:
 *   - validate-frontmatter.js: fatal violations (R20)
 *   - generate-monitor.js: advisory only (doesn't affect rollups on clean corpus)
 *
 * KNOWN LIMITATION — inline-array split is NOT quote-aware (BACKLOG-0064 / AC-4):
 * The inline `[a, b, c]` parser splits on every bare comma, so a value containing a
 * quoted string with an embedded comma (e.g. `['hello, world', 'foo']`) will be split
 * incorrectly at the comma inside the quote. The kit's current artefact corpus never
 * uses quoted-comma values in inline arrays, so this is safe in practice. A
 * quote-aware tokeniser (state-machine CSV-style) should replace the bare split when
 * this file is next substantially touched.
 */

'use strict';

function stripQuotes(s) {
  if (typeof s !== 'string') return s;
  if ((s.startsWith("'") && s.endsWith("'")) ||
      (s.startsWith('"') && s.endsWith('"'))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseFrontmatter(content) {
  // Match a YAML block delimited by --- on first and second occurrences at line start.
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return null;
  const block = m[1];
  const fm = {};
  // Track diagnostics (duplicate keys, nested keys) to be surfaced as violations.
  // These are retained in _diagnostics but do not alter the parsed values (last-write-wins).
  fm._diagnostics = [];

  // Small flat-YAML parser: key: value, with optional quoting and inline arrays.
  // Also supports multi-line list form (`key:` followed by `  - item` lines).
  // Frontmatter in this kit deliberately stays flat; nested mappings are not parsed.
  const lines = block.split(/\r?\n/);
  // `listKey` is the key currently allowed to accept multi-line `- item` rows.
  // ONLY a bare key (one whose inline value is the empty string) becomes a list
  // parent; any inline-valued key (scalar or inline `[...]` array) clears it. This
  // prevents (a) a stray `- ` line attaching to an unrelated earlier key, and
  // (b) merging an inline array with subsequent block items.
  let listKey = null;
  const seenKeys = new Set(); // track keys to detect duplicates

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;

    // Multi-line list item: leading whitespace + `- value`, only under a bare key.
    const listItem = line.match(/^\s+-\s+(.*)$/);
    if (listItem && listKey) {
      const item = stripQuotes(listItem[1].trim());
      if (!Array.isArray(fm[listKey])) fm[listKey] = [];
      fm[listKey].push(item);
      continue;
    }

    // Detect nested mapping (indented key without `- item`).
    // A line starting with 2+ spaces + a key pattern (not a list item) indicates a nested mapping.
    const nestedMapping = line.match(/^\s{2,}([A-Za-z_][\w-]*)\s*:\s/);
    if (nestedMapping && !line.match(/^\s+-/)) {
      // This is a nested key under some parent; flag it.
      const nestedKey = nestedMapping[1];
      fm._diagnostics.push({ type: 'nested-key', key: nestedKey, line });
      // Do not parse it into fm; just skip.
      listKey = null;
      continue;
    }

    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (kv) {
      const key = kv[1];
      // Detect duplicate top-level key.
      if (seenKeys.has(key)) {
        fm._diagnostics.push({ type: 'duplicate-key', key });
      }
      seenKeys.add(key);

      let value = stripQuotes(kv[2].trim());
      // Inline arrays: [a, b, c] — strip per-item quotes.
      if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
        const inner = value.slice(1, -1).trim();
        value = inner ? inner.split(',').map(s => stripQuotes(s.trim())) : [];
      }
      fm[key] = value;
      // Contract: a bare key (empty inline value) MAY own following `- item` rows
      // and will parse to an array; an inline-valued key never does. NOTE: this means
      // `files_touched:` / `depends_on:` written in multi-line form parse to arrays,
      // not the empty string they yielded before R15 (intended — any future rule
      // reading them, e.g. EPIC-02 R17/R18, should expect an array).
      listKey = (value === '') ? key : null;
    }
  }
  return fm;
}

module.exports = { parseFrontmatter, stripQuotes };
