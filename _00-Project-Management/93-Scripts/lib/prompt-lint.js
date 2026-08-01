/**
 * prompt-lint.js
 *
 * Shared scanning module for the warn-tier prompt-language lint (BACKLOG-0091 /
 * STORY-24.1.02 / ADR-0104). Detects model-fragile prompt phrases (the kind that
 * cause over-verification, refusal triggers, or tool-overtriggering on newer Claude
 * models) inside skill and prompt authoring surfaces, so a future edit can't silently
 * reintroduce a pattern the 2026-07 audit already cleaned up.
 *
 * The phrase list itself lives in `prompt-lint-phrases.json` (config/data, not code —
 * AC-2) — this module only implements the matching + file-discovery mechanics.
 *
 * Consumed by validate-frontmatter.js, which wires the corpus scan in as warn-tier
 * rule W4 (non-fatal — ADR-0061) and exposes a `--prompt-lint-target <file>`
 * single-file CLI seam for fixture-driven testing (TESTPLAN-24.1.02 TC-01).
 *
 * Dependency-free — Node.js stdlib only (fs, path).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_PATH = path.join(__dirname, 'prompt-lint-phrases.json');

/**
 * Load + normalise the phrase list from a JSON config file. Each raw entry carries
 * exactly one of `phrase` (literal, case-sensitive substring) or `pattern` (JS RegExp
 * source string, flags as authored in the entry or 'i' by default is NOT assumed —
 * the pattern's own casing controls case sensitivity, matching the seed's
 * `after every \d+ tool calls` which is inherently case-shape-free).
 *
 * Throws on a missing/malformed config or a malformed entry — a broken data file
 * should fail loudly, not silently lint nothing (mirrors readConfigStrict's stance
 * in lib/pm-paths.js).
 */
function loadPhraseConfig(configPath) {
  const resolvedPath = configPath || DEFAULT_CONFIG_PATH;
  let raw;
  try {
    raw = fs.readFileSync(resolvedPath, 'utf8');
  } catch (e) {
    throw new Error(`prompt-lint: cannot read phrase config ${resolvedPath}: ${e.message}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`prompt-lint: phrase config is not valid JSON (${resolvedPath}): ${e.message}`);
  }
  if (!data || !Array.isArray(data.phrases)) {
    throw new Error(`prompt-lint: phrase config missing a \`phrases\` array (${resolvedPath})`);
  }
  return data.phrases.map((entry, i) => {
    const hasPhrase = typeof entry.phrase === 'string' && entry.phrase.length > 0;
    const hasPattern = typeof entry.pattern === 'string' && entry.pattern.length > 0;
    if (hasPhrase === hasPattern) {
      // Neither set, or both set — exactly one is required.
      throw new Error(
        `prompt-lint: phrase config entry #${i} must carry exactly one of \`phrase\`/\`pattern\` ` +
        `(${resolvedPath})`);
    }
    if (!entry.reason) {
      throw new Error(`prompt-lint: phrase config entry #${i} missing \`reason\` (${resolvedPath})`);
    }
    // Optional `flags` (e.g. "i" for case-insensitive) lets a future data-only entry opt into
    // non-default regex behaviour WITHOUT a validator code change (AC-2) — absent means no
    // flags, matching the pattern exactly as authored. `g`/`y` are always stripped: the same
    // RegExp instance is reused across every line of every corpus file via `.test()`
    // (findHitsInLine), and `.test()` on a global/sticky regex is stateful (`lastIndex`
    // persists between calls) — that produces alternating false negatives across lines and
    // even leaks state across files. There is no legitimate use for `g`/`y` in a per-line
    // `.test()` scan, so they are dropped rather than honoured or rejected.
    const regexFlags = (typeof entry.flags === 'string' ? entry.flags : '').replace(/[gy]/g, '');
    let regex = null;
    if (hasPattern) {
      try {
        regex = new RegExp(entry.pattern, regexFlags);
      } catch (e) {
        throw new Error(
          `prompt-lint: phrase config entry #${i} has an invalid pattern/flags: ${e.message} ` +
          `(${resolvedPath})`);
      }
    }
    return {
      label: hasPhrase ? entry.phrase : entry.pattern,
      literal: hasPhrase ? entry.phrase : null,
      regex,
      reason: entry.reason,
      replacement: entry.replacement || '',
    };
  });
}

// Scan a single line for phrase hits. Literal phrases are CASE-SENSITIVE substring
// matches by design (see the config file header + STORY-24.1.02's gotcha: `ALWAYS use`
// must not flag ordinary lowercase prose). Regex phrases match as authored.
function findHitsInLine(line, phrases) {
  const hits = [];
  for (const p of phrases) {
    if (p.literal !== null) {
      if (line.includes(p.literal)) hits.push(p);
    } else if (p.regex.test(line)) {
      hits.push(p);
    }
  }
  return hits;
}

/**
 * Scan raw text content, line by line, against the phrase list.
 * @returns {Array<{line:number, phrase:string, reason:string, replacement:string}>}
 */
function scanContent(content, phrases) {
  const lines = content.split(/\r?\n/);
  const results = [];
  for (let i = 0; i < lines.length; i++) {
    for (const hit of findHitsInLine(lines[i], phrases)) {
      results.push({ line: i + 1, phrase: hit.label, reason: hit.reason, replacement: hit.replacement });
    }
  }
  return results;
}

// Scan a file on disk; returns the same shape as scanContent with a `file` field added.
function scanFile(filepath, phrases) {
  const content = fs.readFileSync(filepath, 'utf8');
  return scanContent(content, phrases).map(r => Object.assign({ file: filepath }, r));
}

function walkFiles(dir, matchFile, list) {
  if (!fs.existsSync(dir)) return list;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, matchFile, list);
    } else if (entry.isFile() && matchFile(entry.name)) {
      list.push(full);
    }
  }
  return list;
}

/**
 * Discover the prompt-lint corpus: every `skills/**\/SKILL.md` and every
 * `<promptsDir>/**\/*.md` (STORY-24.1.02 AC-1). Both directories are passed in
 * absolute (the caller resolves them via lib/pm-paths so a flattened/custom layout's
 * `prompts` folder name is honoured) — this module stays layout-agnostic.
 */
function findCorpusFiles(skillsDir, promptsDir) {
  const files = [];
  walkFiles(skillsDir, name => name === 'SKILL.md', files);
  walkFiles(promptsDir, name => name.endsWith('.md'), files);
  return files;
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  loadPhraseConfig,
  scanContent,
  scanFile,
  findCorpusFiles,
};
