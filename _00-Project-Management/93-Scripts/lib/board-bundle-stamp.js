'use strict';
/**
 * board-bundle-stamp.js — the staleness gate for the two SHIPPED build artefacts
 * (STORY-33.10.02 · ADR-0268).
 *
 * ===========================================================================
 * THE PROBLEM THIS EXISTS FOR
 * ===========================================================================
 * `assets/board-runtime.js` and `lib/board-assemble.js` are BUILD OUTPUTS that are
 * COMMITTED, because a consumer must receive them without ever running a bundler
 * (ADR-0226 section 2). A committed build output can fall out of step with its source,
 * and a stale bundle ships silently: it installs cleanly, renders something, and is wrong
 * in ways nobody looks for. That is a worse failure than not shipping the bundle at all.
 *
 * `npm test` is deliberately bundler-free (ADR-0233), so the gate CANNOT rebuild and
 * diff. What it can do — with nothing but Node stdlib — is compare two independent
 * recordings:
 *
 *   INPUT SIDE   the sha256 of every source file the lane reads, recomputed now
 *                against the digest the last build recorded.
 *   OUTPUT SIDE  the sha256 of each shipped artefact on disk, recomputed now
 *                against the digest the last build recorded.
 *
 * Both directions fire:
 *   - edit `board/src/app.jsx` and do not rebuild  -> the INPUT digest moves, RED.
 *   - hand-edit `assets/board-runtime.js`          -> the OUTPUT digest moves, RED.
 *   - rebuild                                      -> both are rewritten together, green.
 *
 * ===========================================================================
 * WHAT IT IS NOT, STATED SO NOBODY HAS TO GUESS
 * ===========================================================================
 * It is NOT a check of the bundle against itself, and it is NOT a check against
 * something regenerated in the same breath — those are the two shapes a staleness gate
 * goes vacuous in, and this run has already paid for seven gates that could not fail.
 * The stamp is a COMMITTED record written at build time and read back later; the
 * comparison is between two moments, not between a value and its own restatement.
 *
 * It does NOT detect FORGERY. Edit a source, then hand-edit the stamp to match, and the
 * gate is green over a stale bundle. That is out of reach of any recorded-hash scheme
 * and is named here rather than implied away — the threat model is drift, not an
 * adversary with commit access.
 *
 * It needs NO BUNDLER, so it has NO SKIP PATH. A gate that skips when a tool is absent
 * is BUG-20260825-04, and ADR-0265 settled that a skipped arm is not a passed one. The
 * absence of `board/` (a consumer install) or of the stamp is reported as a PROBLEM,
 * never as "nothing to check".
 *
 * ===========================================================================
 * LINE ENDINGS ARE NORMALISED BEFORE HASHING, AND THAT IS DELIBERATE
 * ===========================================================================
 * Every file here is text under git's eol conversion: CRLF in this Windows working tree,
 * LF in the object store and on a Linux clone. A raw-byte hash would therefore be RED on
 * a fresh clone for a reason that has nothing to do with staleness — the gate would be
 * measuring the checkout, not the build. CRLF to LF before hashing makes the digest a
 * property of the CONTENT. The only change it cannot see is one that alters nothing but
 * line endings, which is precisely the change it is being asked to ignore.
 *
 * Dependency-free — Node stdlib only.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/** The shipped artefacts, relative to the 93-Scripts root. */
const SHIPPED_ARTEFACTS = [
  'assets/board-runtime.js',
  'lib/board-assemble.js',
];

/** Source trees the lane bundles, relative to the repo root. Walked recursively. */
const SOURCE_TREES = ['board/src', 'board/lib'];

/** Single source files the lane depends on, relative to the repo root. */
// `package-lock.json` is here because the BUNDLER'S OWN INPUTS decide what comes out: an
// `npm install` in `board/` that moves preact from 10.x to 11.x changes what
// `board-runtime.js` would be, with every file under `board/src` byte-identical. Without the
// lock the gate would stay green over a bundle that no longer reproduces. Each entry is
// optional-if-absent (see `inputHashes`), so a checkout without one still verifies.
const SOURCE_FILES = ['board/assemble-entry.mjs', 'board/build.mjs', 'board/package.json',
  'board/package-lock.json'];

/** Where the record lives, relative to the 93-Scripts root. */
const STAMP_REL = 'lib/board-bundle-stamp.json';

function sha256(text) { return crypto.createHash('sha256').update(text, 'utf8').digest('hex'); }

/** Content hash of one text file, line endings normalised (see the header). */
function hashFile(abs) {
  return sha256(fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n'));
}

/** Every file under `dir`, as repo-root-relative POSIX paths, appended to `out`. */
function walk(root, dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_e) { return out; }
  const sorted = entries.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of sorted) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) { walk(root, abs, out); continue; }
    if (!e.isFile()) continue;
    out.push(path.relative(root, abs).split(path.sep).join('/'));
  }
  return out;
}

/**
 * The per-file hashes of everything the lane reads, plus one digest over the lot.
 *
 * The digest covers the PATHS as well as the contents, so a deleted or renamed module
 * moves it. A digest over concatenated contents alone would be blind to a file that
 * simply vanished, which is a change to what the bundle contains.
 */
function inputHashes(repoRoot) {
  const rels = [];
  for (const t of SOURCE_TREES) walk(repoRoot, path.join(repoRoot, t), rels);
  for (const f of SOURCE_FILES) {
    if (fs.existsSync(path.join(repoRoot, f))) rels.push(f);
  }
  rels.sort();
  const files = {};
  for (const rel of rels) files[rel] = hashFile(path.join(repoRoot, rel));
  // JSON-encoded PAIRS, not concatenated text. The separator has to be something that can
  // appear in neither a path nor a hex digest, or two different file sets could hash alike.
  // A NUL byte is the usual answer and is the wrong one HERE: this file SHIPS, and
  // `release-tandem.js`'s scrub gate sniffs for a NUL and SKIPS the file it finds one in —
  // so the separator would quietly exempt this module from the leak scan. Measured, not
  // theorised: a throwaway `build:tandem` printed `scrub skip (NUL-byte sniff)` for exactly
  // this file before the separator changed.
  const digest = sha256(rels.map((r) => JSON.stringify([r, files[r]])).join('\n'));
  return { files, digest };
}

/** The per-artefact hashes of what is actually on disk in the shipped tree. */
function outputHashes(scriptsDir) {
  const files = {};
  const missing = [];
  for (const rel of SHIPPED_ARTEFACTS) {
    const abs = path.join(scriptsDir, rel);
    if (!fs.existsSync(abs)) { missing.push(rel); continue; }
    files[rel] = { sha256: hashFile(abs), bytes: fs.statSync(abs).size };
  }
  const present = Object.keys(files).sort();
  // THE ARTEFACT HASH GOES INSIDE THE PAIR, not after it. `JSON.stringify([r, files[r]]).sha256`
  // is `undefined` for every entry, which makes this digest a CONSTANT — and a constant digest
  // always equals the recorded one, so `verify()` would never enter the branch that names a
  // tampered artefact. The gate would have agreed with any bundle at all.
  //
  // That is not hypothetical: it is what the first cut of this line actually said, introduced by
  // a careless string replacement while fixing an unrelated finding (BUG-20260827-04). It is the
  // exact shape this run has caught seven times — a gate that cannot fail — and it was written
  // while fixing a review finding, which is when they get written. `digest-depends-on-content`
  // in tests/board-bundle-staleness.test.js now asserts this directly, so the next slip is
  // caught by a machine rather than by someone re-reading a diff.
  const digest = sha256(present.map((r) => JSON.stringify([r, files[r].sha256])).join('\n'));
  return { files, missing, digest };
}

/** Build the record. Called by `board/build.mjs` immediately after it writes both artefacts. */
function buildStamp(o) {
  const inputs = inputHashes(o.repoRoot);
  const outputs = outputHashes(o.scriptsDir);
  // A stamp that records only the artefacts it happened to find is worse than no stamp: it
  // reads as a complete claim. `verify()` would then compare a one-artefact digest against a
  // one-artefact digest and agree, over a tree missing the other one.
  if (outputs.missing.length) {
    throw new Error('refusing to stamp an incomplete artefact set — ' + outputs.missing.join(', ')
      + ' missing from ' + o.scriptsDir + '. The runtime bundle, the assembly bundle and this '
      + 'stamp are one set; a stamp over part of it vouches for a tree with a hole in it.');
  }
  return {
    $comment: 'Generated by `npm run board:build` (ADR-0268). NEVER hand-edit: this file is the '
      + 'only record that the two committed build artefacts are in step with board/src + '
      + 'board/lib, and tests/board-bundle-staleness.test.js reads it back. Editing it to make '
      + 'the gate green ships a stale bundle with the gate agreeing.',
    kitVersion: o.kitVersion || '',
    builtAt: o.builtAt || '',
    artefacts: SHIPPED_ARTEFACTS.slice(),
    inputDigest: inputs.digest,
    inputCount: Object.keys(inputs.files).length,
    inputs: inputs.files,
    outputDigest: outputs.digest,
    outputs: outputs.files,
  };
}

/** Read the record, or null when it is absent or unreadable. */
function readStamp(scriptsDir) {
  try { return JSON.parse(fs.readFileSync(path.join(scriptsDir, STAMP_REL), 'utf8')); }
  catch (_e) { return null; }
}

/**
 * Verify the shipped artefacts are in step with their sources.
 *
 * @param {object} o
 * @param {string} o.repoRoot    tree containing `board/`
 * @param {string} o.scriptsDir  the 93-Scripts root holding the artefacts + the stamp
 * @returns {{ok: boolean, problems: string[], inputDigest: string, outputDigest: string}}
 *
 * Every failure is a PROBLEM, including "there is nothing to check". An absent source
 * tree, an absent artefact and an absent stamp are all states in which the claim
 * "the shipped bundle is current" is UNVERIFIED, and unverified is not verified.
 */
function verify(o) {
  const problems = [];
  const repoRoot = o.repoRoot;
  const scriptsDir = o.scriptsDir;

  for (const t of SOURCE_TREES) {
    if (!fs.existsSync(path.join(repoRoot, t))) {
      problems.push('source tree ' + t + ' is absent under ' + repoRoot + ' — the shipped bundle '
        + 'cannot be checked against a source that is not here');
    }
  }

  const stamp = readStamp(scriptsDir);
  if (!stamp) {
    problems.push('no ' + STAMP_REL + ' — the shipped build artefacts carry no record of what '
      + 'they were built from, so their currency is unknown. Run `npm run board:build`.');
    return { ok: false, problems, inputDigest: '', outputDigest: '' };
  }

  const inputs = inputHashes(repoRoot);
  const outputs = outputHashes(scriptsDir);

  for (const rel of outputs.missing) {
    problems.push('shipped artefact ' + rel + ' is missing from ' + scriptsDir
      + ' — the stamp records it, the tree does not have it');
  }

  if (stamp.outputDigest !== outputs.digest) {
    let named = 0;
    for (const rel of SHIPPED_ARTEFACTS) {
      const was = stamp.outputs && stamp.outputs[rel];
      const now = outputs.files[rel];
      if (!was || !now) continue;
      if (was.sha256 !== now.sha256) {
        named += 1;
        problems.push('shipped artefact ' + rel + ' does not match the stamp (recorded '
          + String(was.sha256).slice(0, 12) + ' / ' + was.bytes + ' B, on disk '
          + now.sha256.slice(0, 12) + ' / ' + now.bytes + ' B) — it has been edited or replaced '
          + 'since the build');
      }
    }
    if (named === 0 && outputs.missing.length === 0) {
      problems.push('the shipped artefact set does not match the stamp (recorded digest '
        + String(stamp.outputDigest).slice(0, 12) + ', computed ' + outputs.digest.slice(0, 12)
        + ') — the recorded artefact list and the tree disagree');
    }
  }

  if (stamp.inputDigest !== inputs.digest) {
    const was = stamp.inputs || {};
    const now = inputs.files;
    const changed = [];
    for (const rel of Object.keys(now)) {
      if (!(rel in was)) changed.push('added ' + rel);
      else if (was[rel] !== now[rel]) changed.push('changed ' + rel);
    }
    for (const rel of Object.keys(was)) if (!(rel in now)) changed.push('removed ' + rel);
    problems.push(changed.length
      ? 'the shipped build artefacts are STALE — ' + changed.length + ' source file(s) differ from '
        + 'the build that produced them: ' + changed.slice(0, 8).join(', ')
        + (changed.length > 8 ? ', and more' : '') + '. Run `npm run board:build` and commit both '
        + 'artefacts with the stamp.'
      : 'the recorded input digest does not match the computed one, yet no individual file '
        + 'differs — the digest DEFINITION moved (this module changed), not the sources. Re-run '
        + '`npm run board:build` so the stamp is rewritten by the current definition.');
  }

  return {
    ok: problems.length === 0,
    problems,
    inputDigest: inputs.digest,
    outputDigest: outputs.digest,
  };
}

module.exports = {
  SHIPPED_ARTEFACTS, SOURCE_TREES, SOURCE_FILES, STAMP_REL,
  sha256, hashFile, inputHashes, outputHashes, buildStamp, readStamp, verify,
};
