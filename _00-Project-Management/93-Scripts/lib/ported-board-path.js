'use strict';
/**
 * ported-board-path.js — where the EPIC-33 ported board is built, spelled ONCE.
 *
 * ===========================================================================
 * WHY THIS MODULE EXISTS
 *
 * `DASHBOARD-NEXT.html` used to be written into `_00-Project-Management/42-Monitor/`,
 * beside the real `DASHBOARD.html` that `pm:dash` produces and that the release renders
 * its demo from. (That board was git-tracked when this note was written; ADR-0276 /
 * STORY-35.3.04 untracked it — it is now regenerable output on both sides of the kit,
 * which changes nothing about why the STAGING artefact had to move out of that folder.)
 * Two dashboards in the folder an operator opens, one of them
 * a staging artefact, is a standing invitation to read the wrong one — and it did
 * exactly that: the acceptance suite picks the newest of the two by mtime, so a plain
 * `npm run pm:dash` silently re-pointed a gate at the OLD board and reported the port's
 * acceptance against a document the port had not produced.
 *
 * The staging artefact now lives with the build that makes it, under `board/dist/`,
 * which `.gitignore`'s `dist/` rule already covers. `42-Monitor/` holds exactly one
 * dashboard again: the real one.
 *
 * ===========================================================================
 * AND IT IS ONE DEFINITION, NOT NINE
 *
 * The path was hardcoded as `path.join(PM, '42-Monitor', 'DASHBOARD-NEXT.html')` in
 * eight test files and once more in `board/build.mjs`. Nine copies of one fact is nine
 * chances for a move to half-land, and a half-landed move is the worst outcome here:
 * a gate left pointing at the old location does not fail, it SKIPS, and a skipped
 * board-dependent gate still exits 0 (BUG-20260825-04). Measured at the time of the
 * move: with the board absent, `css-token-gate` skipped 4 checks, `markdown-single-
 * pipeline` 5, and `mermaid-corpus` 2 — all reporting success.
 *
 * So the location is a function, every consumer calls it, and moving the board again
 * is a one-line change rather than a nine-file sweep.
 *
 * Node stdlib only. CommonJS so the test lane can `require()` it; `board/build.mjs`
 * reaches it through `createRequire`.
 */

const path = require('path');
const fs = require('fs');

/** The repo root, derived from this file's own location (93-Scripts/lib -> repo). */
function repoRoot() {
  return path.join(__dirname, '..', '..', '..');
}

/**
 * Where the ported board lives — the CANONICAL name, since the STORY-33.9.05 cutover.
 *
 * The staging era is over: `pm:dash` (build-board.js) and `board:build` both produce the
 * ported board AT `42-Monitor/DASHBOARD.html`, `42-Monitor/` holds exactly one dashboard,
 * and it IS the ported one. The eight board-dependent suites follow this function, which
 * is the whole point of it being a function — the cutover was this one line.
 *
 * @param {string} [root] repo root; defaults to this file's own repo.
 * @returns {string} absolute path to _00-Project-Management/42-Monitor/DASHBOARD.html
 */
function portedBoardPath(root) {
  return path.join(root || repoRoot(), '_00-Project-Management', '42-Monitor', 'DASHBOARD.html');
}

/**
 * The two RETIRED staging locations, kept ONLY so a consumer can say "you have a stale
 * artefact here" rather than silently ignoring it:
 *   - `42-Monitor/DASHBOARD-NEXT.html` (the pre-move era), and
 *   - `board/dist/DASHBOARD-NEXT.html` (the staging era STORY-33.9.05 ended).
 *
 * A leftover staging copy is not harmless: it is a second dashboard looking current,
 * which is the exact confusion the staging name's retirement removes.
 */
function legacyPortedBoardPath(root) {
  return path.join(root || repoRoot(), '_00-Project-Management', '42-Monitor', 'DASHBOARD-NEXT.html');
}

function retiredStagingBoardPath(root) {
  return path.join(root || repoRoot(), 'board', 'dist', 'DASHBOARD-NEXT.html');
}

/**
 * Is a stale staging-era artefact still lying around? Consumers surface this rather than
 * deleting it — removing a file a person may be mid-way through reading is not this
 * module's call to make.
 */
function staleLegacyBoard(root) {
  for (const p of [legacyPortedBoardPath(root), retiredStagingBoardPath(root)]) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

module.exports = { portedBoardPath, legacyPortedBoardPath, retiredStagingBoardPath, staleLegacyBoard, repoRoot };
