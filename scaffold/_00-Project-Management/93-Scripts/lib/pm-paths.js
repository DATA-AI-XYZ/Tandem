/**
 * pm-paths.js — the kit's folder-layout map.
 *
 * The PM folder's sub-folders are referred to throughout the kit by LOGICAL names
 * (stories, testplans, bugs, decisions, …). Their PHYSICAL folder names vary per
 * project: the canonical "full" numbering (32-Stories, 33-Testplans, …) or a
 * "flattened" variant (03-Stories, 05-Test, …), or any custom map a project sets.
 *
 * Resolution order (highest wins):
 *   1. `.claude-pm-config.json` → `paths` object (per-key physical overrides)
 *   2. `90-Standards/pm-paths.json` → `paths` object (the declared path-map config)
 *   3. `.claude-pm-config.json` → `layout` ("full" | "flattened") preset
 *   4. `90-Standards/pm-paths.json` → `layout` preset
 *   5. auto-detect: whichever preset's folders actually exist under the PM root
 *   6. default: "full"
 *
 * `.claude-pm-config.json` (repo root, pinned by `pm:install`) is the per-project
 * OVERRIDE; `90-Standards/pm-paths.json` is the DECLARED default config the kit ships
 * and `detect --write` produces. Both are read by `loadPaths`, so the file the skills
 * name and bootstrap writes is genuinely authoritative — `.claude-pm-config.json` only
 * needs to carry the deltas it wants to override (ADR-0052).
 *
 * Every consumer should call `loadPaths(pmRoot)` once and read `.map[<logical>]`.
 * Folders that don't exist for a given layout resolve to a name anyway; scanners
 * must skip non-existent dirs (they already do via `fs.existsSync`).
 *
 * ---------------------------------------------------------------------------
 * Path-map config file shape (`90-Standards/pm-paths.json`)
 * ---------------------------------------------------------------------------
 * The kit ships a declared path-map config so folder locations live in ONE place
 * instead of being hardcoded across the skills. Shape:
 *
 *   {
 *     "layout": "full" | "flattened",   // selects a built-in PRESETS map
 *     "paths": {                         // optional per-role physical overrides
 *       "stories": "32-Stories", "decisions": "40-Decisions", ...
 *     }
 *   }
 *
 * `layout` picks a preset; `paths` (if present) overrides individual roles on top
 * of it. The shipped default config is `layout: "full"` with every logical role
 * mapped to this repo's current numbered folders. Valid logical roles are the
 * LOGICAL_KEYS below.
 *
 * ---------------------------------------------------------------------------
 * CLI (so non-JS callers — skills, bootstrap — can resolve a folder)
 * ---------------------------------------------------------------------------
 *   node pm-paths.js [--config <path>] resolve <role> [role...]
 *       Prints the physical folder for each logical role (space-separated),
 *       exit 0. Unknown role → clear error naming the role + valid roles, exit 1.
 *       Without --config, resolves against the live project via loadPaths — which
 *       reads `90-Standards/pm-paths.json` + `.claude-pm-config.json` TOLERANTLY
 *       (a malformed file is ignored, not fatal). With an explicit --config the read
 *       is STRICT (a missing/malformed config is a hard exit-2) — the asymmetry is
 *       deliberate: a tool/test pointing at a named config wants to know it's broken.
 *
 *   node pm-paths.js detect <dir> [--write <path>]
 *       Infers the layout from the folders that exist under <dir> and prints the
 *       chosen preset (`full` / `flattened`). Precedence: the preset whose marker
 *       folders best match wins; on a tie `full` wins (deterministic). When NEITHER
 *       scheme is found it does NOT guess — it prints an explicit "no layout
 *       detected — defaulting to 'full'" fallback line. With --write, writes the
 *       resolved `{ layout, paths }` config to <path> (used by BOOTSTRAP).
 *
 * Dependency-free — Node stdlib only (fs, path).
 */
'use strict';

const fs = require('fs');
const path = require('path');

// Logical keys the kit understands. Order is stable for reporting.
const LOGICAL_KEYS = [
  'strategy', 'inbox', 'backlog', 'active', 'releases', 'retros', 'requirements',
  'epics', 'features', 'stories', 'testplans', 'bugs', 'decisions', 'reports',
  'monitor', 'standards', 'templates', 'prompts', 'scripts',
];

// Artefact-bearing folders that linters / rollup generators scan (have frontmatter).
const SCAN_KEYS = ['backlog', 'epics', 'features', 'stories', 'testplans', 'bugs', 'decisions'];

const PRESETS = {
  // Canonical PM-kit numbering (what `pm:claude-scaffold` creates by default).
  full: {
    strategy: '00-Strategy', inbox: '10-Inbox', backlog: '11-Backlog',
    active: '12-Active', releases: '13-Releases', retros: '14-Retros',
    requirements: '20-Requirements', epics: '30-Epics', features: '31-Features',
    stories: '32-Stories', testplans: '33-Testplans', bugs: '34-Bugs',
    decisions: '40-Decisions', reports: '41-Reports', monitor: '42-Monitor',
    standards: '90-Standards', templates: '91-Templates', prompts: '92-Prompts',
    scripts: '93-Scripts',
  },
  // Flattened variant (e.g. a flattened-numbering-variant adopter). Folders the
  // variant does not use keep their full-numbering name as a harmless default —
  // scanners skip any folder that doesn't exist on disk.
  flattened: {
    strategy: '00-Strategy', inbox: '10-Inbox', backlog: '00-BackLog-Item',
    active: '00-Monitor', releases: '13-Releases', retros: '14-Retros',
    requirements: '_Requirements', epics: '01-EPIC', features: '02-Features',
    stories: '03-Stories', testplans: '05-Test', bugs: '04-Bug',
    decisions: '06-ADR', reports: '_Reports', monitor: '00-Monitor',
    standards: '_Standards', templates: '91-Templates', prompts: '92-Prompts',
    scripts: '93-Scripts',
  },
};

const CONFIG_NAME = '.claude-pm-config.json';
// Declared path-map config the kit ships + `detect --write` produces. Conventional
// home: the canonical standards folder. (Flattened/custom adopters that relocate it
// still drive resolution via `.claude-pm-config.json`, which always overrides.)
const PM_PATHS_CONFIG_REL = ['90-Standards', 'pm-paths.json'];

// Tolerant JSON-object read: returns {} on missing/malformed rather than throwing — a
// bad config must not crash a read-only path lookup. (The dedicated config writer,
// lib/claude-config.js, is the one that validates strictly; the resolve CLI uses the
// strict readConfigStrict for an explicit --config.)
function readJsonObject(p) {
  try {
    if (!fs.existsSync(p)) return {};
    const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) return {};
    return cfg;
  } catch (_e) {
    return {};
  }
}

// Tolerant read of the host `.claude-pm-config.json` (repo-root per-project override).
function readPmConfig(repoRoot) {
  return readJsonObject(path.join(repoRoot, CONFIG_NAME));
}

// Tolerant read of the declared `90-Standards/pm-paths.json` (shipped default config).
function readPmPathsFile(pmRoot) {
  return readJsonObject(path.join(pmRoot, ...PM_PATHS_CONFIG_REL));
}

// Score each preset by how many of its folders exist under pmRoot; return the best
// match, or null if nothing matches (caller falls back to default).
function detectLayout(pmRoot) {
  let best = null;
  let bestScore = 0;
  for (const [name, map] of Object.entries(PRESETS)) {
    const seen = new Set();
    let score = 0;
    for (const key of LOGICAL_KEYS) {
      const folder = map[key];
      if (seen.has(folder)) continue; // don't double-count aliased folders (active===monitor)
      seen.add(folder);
      if (fs.existsSync(path.join(pmRoot, folder))) score += 1;
    }
    if (score > bestScore) { bestScore = score; best = name; }
  }
  return bestScore > 0 ? best : null;
}

/**
 * Resolve the layout map for a project.
 * @param {string} pmRoot absolute path to the project's _00-Project-Management folder
 * @returns {{ map: Object, layout: string, source: string, repoRoot: string }}
 */
function loadPaths(pmRoot) {
  const repoRoot = path.resolve(pmRoot, '..');
  const userCfg = readPmConfig(repoRoot);     // .claude-pm-config.json — per-project override
  const fileCfg = readPmPathsFile(pmRoot);    // 90-Standards/pm-paths.json — declared default

  // Layout precedence: user.layout > pm-paths.layout > auto-detect > default 'full'.
  let layout;
  let source;
  if (userCfg.layout && PRESETS[userCfg.layout]) {
    layout = userCfg.layout; source = 'config.layout';
  } else if (fileCfg.layout && PRESETS[fileCfg.layout]) {
    layout = fileCfg.layout; source = 'pm-paths.layout';
  } else {
    const detected = detectLayout(pmRoot);
    if (detected) { layout = detected; source = 'auto-detect'; }
    else { layout = 'full'; source = 'default'; }
  }
  const map = { ...PRESETS[layout] };

  // Per-key `paths` overrides layer onto the preset, lowest-to-highest:
  // preset < pm-paths.json paths < .claude-pm-config.json paths.
  for (const [paths, tag] of [[fileCfg.paths, 'pm-paths.paths'], [userCfg.paths, 'config.paths']]) {
    if (paths && typeof paths === 'object' && !Array.isArray(paths)) {
      for (const [k, v] of Object.entries(paths)) {
        if (typeof v === 'string' && v) { map[k] = v; }
      }
      source += '+' + tag;
    }
  }

  return { map, layout, source, repoRoot };
}

// Convenience: physical folder names for the given logical keys (defaults to the
// artefact-bearing scan set), de-duplicated and only those that exist on disk.
function scanDirs(pmRoot, keys = SCAN_KEYS) {
  const { map } = loadPaths(pmRoot);
  const out = [];
  const seen = new Set();
  for (const key of keys) {
    const folder = map[key];
    if (!folder || seen.has(folder)) continue;
    seen.add(folder);
    if (fs.existsSync(path.join(pmRoot, folder))) out.push(folder);
  }
  return out;
}

module.exports = { LOGICAL_KEYS, SCAN_KEYS, PRESETS, CONFIG_NAME, readPmConfig, detectLayout, loadPaths, scanDirs };

// ---------------------------------------------------------------------------
// CLI — lets skills / bootstrap resolve folders without importing the module.
// ---------------------------------------------------------------------------

// PM root inferred from this file's location: 93-Scripts/lib/pm-paths.js → up two.
const DEFAULT_PM_ROOT = path.resolve(__dirname, '..', '..');

// Strict read for an explicitly-provided --config path: fail loudly (exit 2) on a
// missing / unreadable / malformed config rather than silently falling back, so a
// typo'd path or broken JSON is surfaced instead of producing a confident wrong answer.
function readConfigStrict(p) {
  if (!fs.existsSync(p)) { console.error(`pm-paths: config not found: ${p}`); process.exit(2); }
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch (e) {
    console.error(`pm-paths: cannot read config ${p}: ${e.message}`);
    process.exit(2);
  }
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch (e) {
    console.error(`pm-paths: config is not valid JSON (${p}): ${e.message}`);
    process.exit(2);
  }
  if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) {
    console.error(`pm-paths: config must be a JSON object: ${p}`);
    process.exit(2);
  }
  return cfg;
}

// resolve <role...> — print the physical folder per logical role; unknown role is fatal.
function cliResolve(cfg, roles) {
  if (!roles.length) {
    console.error('pm-paths resolve: no role given. Usage: resolve <role> [role...]');
    process.exit(2);
  }
  // A declared-but-unknown layout is a typo, not a silent fall-through to 'full' —
  // surface it (mirrors readConfigStrict's fail-loud contract). Absent layout → 'full'.
  let layout = 'full';
  if (cfg.layout !== undefined && cfg.layout !== null && cfg.layout !== '') {
    if (!PRESETS[cfg.layout]) {
      console.error(`pm-paths: unknown layout '${cfg.layout}'. Known layouts: ${Object.keys(PRESETS).join(', ')}.`);
      process.exit(2);
    }
    layout = cfg.layout;
  }
  const preset = PRESETS[layout] || {};
  const overrides = (cfg.paths && typeof cfg.paths === 'object' && !Array.isArray(cfg.paths)) ? cfg.paths : {};
  const out = [];
  for (const role of roles) {
    if (!LOGICAL_KEYS.includes(role)) {
      console.error(`pm-paths: unknown role '${role}'. Valid roles: ${LOGICAL_KEYS.join(', ')}`);
      process.exit(1);
    }
    const folder = (typeof overrides[role] === 'string' && overrides[role]) ? overrides[role] : preset[role];
    if (!folder) {
      console.error(`pm-paths: role '${role}' is not mapped by the config or the '${layout}' preset.`);
      process.exit(1);
    }
    out.push(folder);
  }
  process.stdout.write(out.join(' ') + '\n');
  process.exit(0);
}

// detect <dir> — infer the layout from existing folders; optionally --write the config.
function cliDetect(dir, writePath) {
  if (!fs.existsSync(dir)) { console.error(`pm-paths: directory not found: ${dir}`); process.exit(2); }
  if (!fs.statSync(dir).isDirectory()) { console.error(`pm-paths: not a directory: ${dir}`); process.exit(2); }
  const detected = detectLayout(dir);
  const layout = detected || 'full';
  if (!detected) {
    // Documented fallback (AC-3): neither scheme found. The human-facing note goes to
    // STDERR (so a machine caller capturing stdout still gets a usable preset rather
    // than a sentence), and the resolved default 'full' goes to STDOUT — never a
    // silent confident guess.
    console.error(`pm-paths: no layout detected under ${dir} — defaulting to '${layout}' (confirm with the operator)`);
  }
  process.stdout.write(layout + '\n');
  if (writePath) {
    const cfg = { layout, paths: { ...PRESETS[layout] } };
    try {
      // BOOTSTRAP often targets a fresh tree where the parent (e.g. 90-Standards/)
      // doesn't exist yet — create it so the primary use case doesn't ENOENT.
      fs.mkdirSync(path.dirname(path.resolve(writePath)), { recursive: true });
      fs.writeFileSync(writePath, JSON.stringify(cfg, null, 2) + '\n');
    } catch (e) {
      console.error(`pm-paths: cannot write config to ${writePath} (check the parent path): ${e.message}`);
      process.exit(2);
    }
  }
  process.exit(0);
}

function cliMain(argv) {
  const args = argv.slice(2);
  let configPath = null;
  let writePath = null;
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config') {
      configPath = args[++i];
      if (configPath === undefined) { console.error('pm-paths: --config requires a path argument.'); process.exit(2); }
    } else if (args[i] === '--write') {
      writePath = args[++i];
      if (writePath === undefined) { console.error('pm-paths: --write requires a path argument.'); process.exit(2); }
    } else { rest.push(args[i]); }
  }
  const cmd = rest.shift();

  // --write is only meaningful for `detect`; flag it elsewhere rather than swallow it silently.
  if (writePath !== null && cmd !== 'detect') {
    console.error("pm-paths: --write is only valid for the 'detect' command.");
    process.exit(2);
  }

  if (cmd === 'resolve') {
    let cfg;
    if (configPath) {
      cfg = readConfigStrict(configPath);
    } else {
      const { map, layout } = loadPaths(DEFAULT_PM_ROOT);
      cfg = { layout, paths: map };
    }
    return cliResolve(cfg, rest);
  }

  if (cmd === 'detect') {
    const dir = rest[0];
    if (!dir) { console.error('pm-paths detect: no directory given. Usage: detect <dir> [--write <path>]'); process.exit(2); }
    return cliDetect(dir, writePath);
  }

  console.error(`pm-paths: unknown command '${cmd || ''}'. Commands: resolve <role> [role...] [--config <path>] | detect <dir> [--write <path>]`);
  process.exit(2);
}

if (require.main === module) { cliMain(process.argv); }
