#!/usr/bin/env node
/**
 * verify-twin-divergence.js — DO THE TWO COPIES OF A CHAT'S VERIFY LINE AGREE? (BUG-20260805-04)
 *
 * ============================================================================
 * THE BUG ASKED FOR A NAMED CHECK AND THERE WAS NONE
 * ============================================================================
 * Every execution-strategy sidecar exists twice: `EXECUTION-STRATEGY-<date>.json`, which an agent
 * reads, and `EXECUTION-STRATEGY-<date>.md`, which a human reads. Each carries the same chat's
 * `verify` line. They drift — `--assert-visible 'main'` survived in BOTH copies until
 * BUG-20260803-01, and BUG-20260805-04 is the mirror image: a step present in one copy and not the
 * other, so a human and an agent run different gates.
 *
 * That bug's own acceptance criterion is *"a named check reports zero verify-text divergences
 * between a sidecar and its twin, OR the divergence is explicitly recorded as historical in the
 * artefacts themselves"* — and nothing under `93-Scripts/` measured it, so neither half could be
 * verified. This is that check.
 *
 * ============================================================================
 * IT DOES NOT ASK FOR ZERO DIVERGENCES. IT ASKS FOR ZERO **UNRECORDED** ONES.
 * ============================================================================
 * ADR-0165: an executed sidecar is a RECORD. Regenerating a `.md` twin from its `.json` to make an
 * assertion green is precisely the failure mode EPIC-28 removed, and it would rewrite archived
 * prose alongside the commands. So a divergence is discharged by being WRITTEN DOWN, in the `.md`,
 * inside the chat's own section, naming `BUG-20260805-04` — a reader who reaches the verify block
 * reaches the note with it.
 *
 * A NEW divergence has nothing written about it and fails. That is the whole point: this check
 * exists to stop the NEXT one, not to relitigate the eleven that are already history.
 *
 * ============================================================================
 * TWO FENCE INDENTATIONS, AND A NAIVE SWEEP UNDERCOUNTS
 * ============================================================================
 * `2026-06-01` writes the verify fence at column 0; `2026-06-03` indents it two spaces under a
 * `- **Verify before closing:**` bullet. A regex anchored on one shape silently reports zero for
 * the other — which is how the original exploratory scan stopped at "at least 6" when the true
 * figure was 11 across 5 sidecars. Both shapes are read here, and the count is reported so a
 * reader can see the sweep is live.
 *
 * A chat whose `.md` twin carries NO verify block at all is reported as UNCOMPARABLE, never as
 * agreement. 53 of the corpus' chats are in that state, and counting them as passes would be the
 * same false reassurance one column over.
 *
 * Usage:
 *   node verify-twin-divergence.js [--dir <execution-strategy dir>] [--json]
 *
 * Exit codes: 0 = no UNRECORDED divergence · 1 = at least one · 2 = usage error or empty corpus
 * (an empty scope is an error, never "0 divergences" — `run-suite.js`'s rule, applied here).
 *
 * Dependency-free — Node stdlib only.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const PM_ROOT = path.resolve(__dirname, '..');
const DEFAULT_DIR = path.join(PM_ROOT, '41-Reports', 'execution-strategy');

/** The token a recorded divergence must carry, in the chat's own section of the `.md`. */
const RECORD_MARKER = 'BUG-20260805-04';

const EXIT_OK = 0;
const EXIT_DIVERGED = 1;
const EXIT_USAGE = 2;

/** One spelling of "the same command", so a line break or a shell continuation is not a change. */
function normaliseCommand(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/\s*\\\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The `.md` twin, split into chat sections. A heading naming a chat opens one; the next chat
 * heading, or any h1/h2 that names no chat, closes it — so the "Recommended sequence" prose at the
 * foot of a sidecar is never attributed to the last chat.
 *
 * @returns {Map<string, {verify: string|null, text: string}>}
 */
function readTwinSections(body) {
  const lines = String(body).replace(/\r\n/g, '\n').split('\n');
  const sections = new Map();
  let current = null;
  const open = (id) => {
    if (!sections.has(id)) sections.set(id, { verify: null, lines: [] });
    current = sections.get(id);
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = /^\s*#{1,6}\s/.test(line);
    if (heading) {
      const named = /\b(CHAT-\d+)\b/.exec(line);
      if (named) { open(named[1]); continue; }
      if (/^\s*#{1,2}\s/.test(line)) current = null;
    }
    if (current === null) continue;
    current.lines.push(line);
    if (!/Verify before closing/i.test(line) || current.verify !== null) continue;
    // The fenced block that follows, at ANY indentation (see the header).
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    if (j >= lines.length || !/^\s*```/.test(lines[j])) continue;
    const block = [];
    j++;
    while (j < lines.length && !/^\s*```\s*$/.test(lines[j])) { block.push(lines[j].trim()); j++; }
    current.verify = normaliseCommand(block.join(' '));
  }
  const out = new Map();
  for (const [id, sec] of sections) out.set(id, { verify: sec.verify, text: sec.lines.join('\n') });
  return out;
}

/** Compare one sidecar pair. Never throws. */
function comparePair(jsonPath, mdPath) {
  const result = {
    sidecar: path.basename(jsonPath).replace(/^EXECUTION-STRATEGY-|\.json$/g, ''),
    compared: 0, agree: 0, recorded: [], unrecorded: [], uncomparable: [], error: null,
  };
  let json;
  try { json = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch (err) {
    result.error = `unreadable JSON sidecar (${err && err.message})`;
    return result;
  }
  let sections;
  try { sections = readTwinSections(fs.readFileSync(mdPath, 'utf8')); } catch (err) {
    result.error = `unreadable md twin (${err && err.message})`;
    return result;
  }
  for (const phase of (json.phases || [])) {
    for (const chat of (phase.chats || [])) {
      const id = typeof chat.id === 'string' ? chat.id.trim() : '';
      const verify = normaliseCommand(chat.verify);
      if (!id || !verify) continue;
      const section = sections.get(id);
      if (!section || section.verify === null) {
        result.uncomparable.push({ chat: id, why: 'the md twin carries no verify block for it' });
        continue;
      }
      result.compared += 1;
      if (section.verify === verify) { result.agree += 1; continue; }
      const entry = {
        chat: id,
        executed: chat.executed === true,
        json: verify,
        md: section.verify,
      };
      if (section.text.indexOf(RECORD_MARKER) !== -1) result.recorded.push(entry);
      else result.unrecorded.push(entry);
    }
  }
  return result;
}

function scan(dir) {
  const target = dir || DEFAULT_DIR;
  let names;
  try { names = fs.readdirSync(target); } catch (err) {
    return { dir: target, error: `cannot read ${target} (${err && err.message})`, pairs: [] };
  }
  const pairs = [];
  for (const name of names.filter(n => /\.json$/.test(n)).sort()) {
    const md = path.join(target, name.replace(/\.json$/, '.md'));
    if (!fs.existsSync(md)) continue;
    pairs.push(comparePair(path.join(target, name), md));
  }
  return { dir: target, error: null, pairs };
}

function summarise(scanned) {
  const add = (k) => scanned.pairs.reduce((a, p) => a + (Array.isArray(p[k]) ? p[k].length : p[k]), 0);
  return {
    sidecars: scanned.pairs.length,
    compared: add('compared'),
    agree: add('agree'),
    recorded: add('recorded'),
    unrecorded: add('unrecorded'),
    uncomparable: add('uncomparable'),
    errors: scanned.pairs.filter(p => p.error).length,
  };
}

function main(argv) {
  const args = argv.slice(2);
  let dir = null;
  let asJson = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') { asJson = true; continue; }
    if (args[i] === '--dir') {
      const v = args[++i];
      if (v === undefined || String(v).indexOf('--') === 0) {
        console.error('--dir requires a directory path');
        return EXIT_USAGE;
      }
      dir = path.resolve(v);
      continue;
    }
    console.error(`unknown argument "${args[i]}"`);
    console.error('usage: node verify-twin-divergence.js [--dir <execution-strategy dir>] [--json]');
    return EXIT_USAGE;
  }

  const scanned = scan(dir);
  if (scanned.error) { console.error(scanned.error); return EXIT_USAGE; }
  const totals = summarise(scanned);
  if (scanned.pairs.length === 0) {
    console.error(`no sidecar pair found under ${scanned.dir} — an empty scope is an error, not `
      + 'a clean result');
    return EXIT_USAGE;
  }
  // NOTHING TO COMPARE **AND** NOTHING TO SKIP means the reader saw no chat at all — a broken
  // locator wearing a clean corpus' clothes. `compared === 0` alone is NOT that: a corpus whose
  // twins all lack a verify block is honestly uncomparable, and 53 of this repository's chats are
  // in exactly that state. Conflating the two would make the reader's own blindness unreportable.
  if (totals.compared === 0 && totals.uncomparable === 0) {
    console.error(`${scanned.pairs.length} sidecar pair(s) found but NOT ONE chat was read — the `
      + 'reader is broken, not the corpus clean');
    return EXIT_USAGE;
  }

  if (asJson) {
    console.log(JSON.stringify({ totals, pairs: scanned.pairs }, null, 2));
  } else {
    console.log(`verify-twin-divergence — ${totals.sidecars} sidecar pair(s) under ${scanned.dir}`);
    for (const p of scanned.pairs) {
      if (p.error) { console.log(`  !  ${p.sidecar}: ${p.error}`); continue; }
      for (const d of p.unrecorded) {
        console.log(`  UNRECORDED  ${p.sidecar} ${d.chat} (executed=${d.executed})`);
        console.log(`      json: ${d.json.slice(0, 150)}`);
        console.log(`      md  : ${d.md.slice(0, 150)}`);
      }
      for (const d of p.recorded) {
        console.log(`  recorded    ${p.sidecar} ${d.chat} — the twin names ${RECORD_MARKER}`);
      }
    }
    console.log(`  compared=${totals.compared} agree=${totals.agree} `
      + `recorded=${totals.recorded} UNRECORDED=${totals.unrecorded} `
      + `uncomparable=${totals.uncomparable} (md twin carries no verify block)`);
  }

  if (totals.unrecorded > 0) {
    console.error(`\n${totals.unrecorded} verify-text divergence(s) are not recorded anywhere. A `
      + 'human reading the .md and an agent reading the .json would run DIFFERENT gates. Either '
      + 'make the two copies agree, or add a one-line note inside that chat\'s section of the .md '
      + `naming ${RECORD_MARKER} and saying which copy is authoritative — the .json is. Do NOT `
      + 'regenerate an executed twin to make this green (ADR-0165).');
    return EXIT_DIVERGED;
  }
  return EXIT_OK;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = {
  RECORD_MARKER, DEFAULT_DIR, EXIT_OK, EXIT_DIVERGED, EXIT_USAGE,
  normaliseCommand, readTwinSections, comparePair, scan, summarise, main,
};
