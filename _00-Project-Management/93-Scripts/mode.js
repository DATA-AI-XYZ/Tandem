#!/usr/bin/env node
/**
 * mode.js — single source of truth for the Tandem conversation-mode state file.
 *
 * State lives at the REPO ROOT in `.tandem-mode.json` (next to .claude-pm-config.json,
 * which lib/pm-paths.js reads from repoRoot). The file is git-ignored: the `joined`
 * list is machine/session-local. Tolerant reads — a missing/malformed file yields the
 * neutral default, never throws. Dependency-free (Node stdlib only).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const STATE_FILE = '.tandem-mode.json';
const VALID_MODES = ['plan', 'dev', 'dual', 'neutral'];
const DEFAULT_STATE = { mode: 'neutral', set_by: null, set_at: null, context: '' };

function statePath(repoRoot) { return path.join(repoRoot, STATE_FILE); }

function readState(repoRoot) {
  try {
    const p = statePath(repoRoot);
    if (!fs.existsSync(p)) return { ...DEFAULT_STATE, joined: [] };
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_STATE, joined: [] };
    return {
      mode: VALID_MODES.includes(raw.mode) ? raw.mode : 'neutral',
      set_by: typeof raw.set_by === 'string' ? raw.set_by : null,
      set_at: typeof raw.set_at === 'string' ? raw.set_at : null,
      context: typeof raw.context === 'string' ? raw.context : '',
      joined: Array.isArray(raw.joined) ? raw.joined.filter(x => typeof x === 'string' && x) : [],
    };
  } catch (_e) {
    return { ...DEFAULT_STATE, joined: [] };
  }
}

/**
 * Persist `state` to the mode file at `repoRoot`.
 * @param {string} repoRoot - Absolute path to the repository root.
 * @param {object} state - State object (mode, set_by, set_at, context, joined).
 * @returns {object} The normalised state that was written.
 * @throws {Error} on filesystem write failure (unlike readState, writeState is NOT tolerant — a failed write must surface, not silently lose state).
 */
function writeState(repoRoot, state) {
  const out = {
    mode: VALID_MODES.includes(state.mode) ? state.mode : 'neutral',
    set_by: state.set_by || null,
    set_at: state.set_at || null,
    context: state.context || '',
    joined: Array.isArray(state.joined) ? state.joined.filter(x => typeof x === 'string' && x) : [],
  };
  fs.writeFileSync(statePath(repoRoot), JSON.stringify(out, null, 2) + '\n');
  return out;
}

/**
 * Set the global mode (full reset of the frame). Throws on an invalid mode.
 * @param {string} repoRoot  repo root holding .tandem-mode.json
 * @param {string} mode      one of VALID_MODES
 * @param {{by?:string, context?:string, sessionId?:string}} [opts]
 *        by: attribution ('user'|'auto-neutral', default 'user'); context: one-line label;
 *        sessionId: if given, also joins that session.
 * @returns {object} the written state
 */
function setMode(repoRoot, mode, opts = {}) {
  if (!VALID_MODES.includes(mode)) {
    throw new Error(`mode.js: invalid mode '${mode}'. Valid: ${VALID_MODES.join(', ')}`);
  }
  const s = readState(repoRoot);
  s.mode = mode;
  s.set_by = opts.by || 'user';
  s.set_at = new Date().toISOString(); // machine state — ISO 8601 UTC is fine
  // setMode is a full reset: an omitted context clears any prior context (a new mode
  // starts a fresh frame). set_by falls back to 'user'; context falls back to empty.
  s.context = typeof opts.context === 'string' ? opts.context : '';
  if (opts.sessionId && !s.joined.includes(opts.sessionId)) s.joined.push(opts.sessionId);
  return writeState(repoRoot, s);
}

/**
 * Add `sessionId` to the joined list (idempotent).
 * @param {string} repoRoot  @param {string} sessionId  @returns {object} written state
 */
function join(repoRoot, sessionId) {
  const s = readState(repoRoot);
  if (sessionId && !s.joined.includes(sessionId)) s.joined.push(sessionId);
  return writeState(repoRoot, s);
}

/**
 * Remove `sessionId` from the joined list.
 * @param {string} repoRoot  @param {string} sessionId  @returns {object} written state
 */
function leave(repoRoot, sessionId) {
  const s = readState(repoRoot);
  s.joined = s.joined.filter(id => id !== sessionId);
  return writeState(repoRoot, s);
}

/**
 * Return true if `sessionId` is in the joined list.
 * @param {string} repoRoot  @param {string} sessionId  @returns {boolean}
 */
function isJoined(repoRoot, sessionId) {
  return readState(repoRoot).joined.includes(sessionId);
}

/**
 * Return the mode banner string for a session, or '' if the session is not joined.
 * @param {object} state  state object (as returned by readState/writeState)
 * @param {string} sessionId
 * @returns {string}
 */
function bannerFor(state, sessionId) {
  const joined = Array.isArray(state.joined) ? state.joined : [];
  if (!sessionId || !joined.includes(sessionId)) return '';
  const meta = [];
  if (state.set_by) meta.push(`set by ${state.set_by}`);
  if (state.set_at) meta.push(String(state.set_at).slice(0, 10));
  if (state.context) meta.push(`"${state.context}"`);
  const ctx = meta.length ? ` (${meta.join(', ')})` : '';
  switch (state.mode) {
    case 'plan':
      return `Tandem mode: PLAN${ctx}. This chat is in PLAN. Dev-type requests (write code, run/execute a testplan, close a story) are out-of-mode — nudge before proceeding per the mode skill.`;
    case 'dev':
      return `Tandem mode: DEV${ctx}. This chat is in DEV. Plan-type requests (draft PRD/epic, split into features/stories, refine backlog) are out-of-mode — nudge before proceeding per the mode skill.`;
    case 'dual':
      return `Tandem mode: DUAL${ctx}. Both Plan and Dev work are allowed — no nudge.`;
    case 'neutral':
      return `Tandem mode: NEUTRAL. No active frame; proceed. You may offer once to set a mode if sustained single-phase work begins.`;
    default:
      // Defensive: writeState normalises unknown modes to 'neutral' before they reach
      // disk, so an unhandled mode here means a caller passed a raw state object. Fail
      // safe to the NEUTRAL banner rather than throwing in the prompt-injection path.
      return `Tandem mode: NEUTRAL. No active frame; proceed. You may offer once to set a mode if sustained single-phase work begins.`;
  }
}

module.exports = { STATE_FILE, VALID_MODES, statePath, readState, writeState, setMode, join, leave, isJoined, bannerFor };

// ---------------------------------------------------------------------------
// CLI — lets skills resolve / set mode without importing the module.
//   node mode.js get [--session <id>] [--json]
//   node mode.js set <plan|dev|dual|neutral> [--context "..."] [--by user|auto-neutral] [--session <id>]
//   node mode.js join --session <id>
//   node mode.js leave --session <id>      (alias: isolate)
//   node mode.js banner --session <id>     (prints the hook banner, or nothing)
// Repo root is inferred from this file: 93-Scripts/mode.js → up two.
// ---------------------------------------------------------------------------
function cliMain(argv) {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const args = argv.slice(2);
  const cmd = args.shift();
  const opts = { session: null, context: '', by: 'user', json: false };
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--session') {
      opts.session = args[++i];
      if (opts.session === undefined) { console.error('mode.js: --session requires an id argument.'); process.exit(2); }
    } else if (args[i] === '--context') {
      opts.context = args[++i];
      if (opts.context === undefined) { console.error('mode.js: --context requires a value.'); process.exit(2); }
    } else if (args[i] === '--by') {
      opts.by = args[++i];
      if (opts.by === undefined) { console.error('mode.js: --by requires a value.'); process.exit(2); }
    } else if (args[i] === '--json') {
      opts.json = true;
    } else {
      rest.push(args[i]);
    }
  }

  if (cmd === 'get') {
    const s = readState(repoRoot);
    if (opts.json) process.stdout.write(JSON.stringify(s, null, 2) + '\n');
    else process.stdout.write(`mode=${s.mode} joined=${s.joined.length}${opts.session ? ' joined_here=' + isJoined(repoRoot, opts.session) : ''}\n`);
    process.exit(0);
  }
  if (cmd === 'set') {
    const mode = rest[0];
    if (!mode) { console.error('mode.js: set requires a mode argument. Valid: ' + VALID_MODES.join(', ')); process.exit(1); }
    try { setMode(repoRoot, mode, { by: opts.by, context: opts.context, sessionId: opts.session }); }
    catch (e) { console.error(e.message); process.exit(1); }
    process.stdout.write(`mode set to ${mode}\n`);
    process.exit(0);
  }
  if (cmd === 'join') { join(repoRoot, opts.session); process.stdout.write('joined\n'); process.exit(0); }
  if (cmd === 'leave' || cmd === 'isolate') { leave(repoRoot, opts.session); process.stdout.write('isolated\n'); process.exit(0); }
  if (cmd === 'banner') {
    const line = bannerFor(readState(repoRoot), opts.session);
    if (line) process.stdout.write(line + '\n');
    process.exit(0);
  }
  console.error("mode.js: unknown command. Use get | set <mode> | join | leave (alias isolate) | banner (all but get/set need --session).");
  process.exit(2);
}

if (require.main === module) { cliMain(process.argv); }
