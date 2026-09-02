'use strict';
/**
 * probe-family-census.js — the ADR-0227 probe-family census, DERIVED from the shipped parser.
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * ADR-0227 censused **81 probe families** and made `smoke-dashboard.js` the port's acceptance
 * harness. `41-Reports/audits/probe-families-to-stories-roster-2026-08-24.md` then rostered those
 * 81 to their owning EPIC-33 stories, and STORY-33.9.03 consumes the roster as its convergence
 * checklist.
 *
 * **The census was wrong in both directions, and BUG-20260826-03 measured both.**
 *
 *   · It counted `--ghost-walk`, whose only occurrence in the harness is a COMMENT — and the
 *     comment's subject is precisely that this token is the historical example of a flag that
 *     walked straight through a hand-kept roster.
 *   · It omitted real probe families the harness accepts and EPIC-33's own artefacts invoke.
 *
 * One root cause for both: **the oracle was text presence, not the parser.** Searching a file's
 * TEXT cannot distinguish a flag from a word about a flag, and it cannot see a flag that exists
 * without being written about.
 *
 * ============================================================================
 * THE RULE, AND WHY IT IS A DERIVATION RATHER THAN A LIST
 * ============================================================================
 * A **probe family** is a flag that OWNS A VERDICT. The harness already declares, structurally,
 * which flags those are — in three places this module reads and never re-types:
 *
 *   (1) `KNOWN_FLAGS`          — every flag the parser accepts, and the only authority on
 *                                whether a flag EXISTS. `--ghost-walk` is not in it.
 *   (2) `--assert-*`           — an assertion. Every one of them states a claim and can fail.
 *   (3) `PROBE_ORDER_TABLE` +  — the dispatch tables: the probes that run together, and the arms
 *       `EXCLUSIVE_RUN_BRANCH_TABLE`  of run()'s ladder that each own the invocation.
 *
 *   families  = KNOWN_FLAGS ∩ ( --assert-*  ∪  the two dispatch tables )
 *   qualifiers = KNOWN_FLAGS \ families
 *
 * Everything the rule leaves out is an **option or qualifier**: it modifies an invocation and
 * never owns a verdict (`--views`, `--widths`, `--hash`, `--within`, `--min-ratio`, …).
 *
 * **There is no hand-kept exemption list here, deliberately.** The two dispatch tables are
 * already gated from two independent derivations by
 * `tests/smoke-arg-parser.test.js --case exclusive-branch-guard`: a walk-shaped flag that reaches
 * the parser without a table row fails there, and so does a table row for a flag the parser does
 * not have. So this module inherits a set that cannot rot silently, instead of introducing a
 * fourth copy of it — which is the mistake ADR-0227's census made and BUG-20260812-01 made before
 * it (*"a third hand-kept copy of the walk roster had already drifted"*).
 *
 * The one judgement call in the rule — that `--stream-probes` is a qualifier and not a family —
 * was MEASURED rather than assumed at authoring: its `run()` block returns early only on a
 * corpus-basis refusal (exit 2 / exit 3) and otherwise falls through to the ordinary run, so it
 * enables assertions rather than owning one. `--stream-probes --back-walk` was executed and exits
 * **2**, loudly, not 0 — it is not a silent-drop escape of the BUG-20260811-09 class.
 *
 * ============================================================================
 * WHAT THIS MODULE DOES NOT CLAIM
 * ============================================================================
 * It says which families EXIST. It does not say a family's stored `Command:` RUNS — that is a
 * different question with a different oracle (`parseArgs` over the stored invocation), it is
 * BACKLOG-0207's subject, and conflating the two is exactly how the roster's *carries-over*
 * column came to promise something it never measured.
 *
 * Node stdlib only. No side effects on require.
 */

const path = require('path');

/** The shipped harness, resolved from this module's own location unless overridden. */
function loadHarness(harnessPath) {
  return require(harnessPath || path.join(__dirname, '..', 'smoke-dashboard.js'));
}

/**
 * The live census, derived from the parser's own declarations.
 *
 * @param {object} [smoke] the harness module (injectable so a test can drive a synthetic one)
 * @returns {{families:string[], qualifiers:string[], known:string[], assertions:string[], tableFlags:string[]}}
 */
function census(smoke) {
  const h = smoke || loadHarness();
  const known = [...h.KNOWN_FLAGS].sort();
  const tableFlags = [...new Set(
    (h.PROBE_ORDER_TABLE || []).concat(h.EXCLUSIVE_RUN_BRANCH_TABLE || []).map((r) => r[0]),
  )].sort();
  const assertions = known.filter((f) => /^--assert-/.test(f));
  const famSet = new Set(assertions.concat(tableFlags));
  // Intersect with KNOWN_FLAGS: a table row naming a flag the parser does not have is a defect,
  // but it is `exclusive-branch-guard`'s defect to report, not a family this census invents.
  const families = known.filter((f) => famSet.has(f));
  const qualifiers = known.filter((f) => !famSet.has(f));
  return { families, qualifiers, known, assertions, tableFlags };
}

/**
 * Does the parser KNOW this flag?
 *
 * Asked through `parseArgs` rather than through `KNOWN_FLAGS.has()`, because the parser is the
 * authority a stored command actually meets. Note the argv shape: `parseArgs` takes the full
 * `process.argv` and slices two entries internally, so a bare argument list silently loses its
 * first two tokens — the miscalibration that made the first edition of
 * `stored-probe-command-parse-preflight-2026-08-25.md` understate its finding by 15 commands.
 *
 * A flag that parses is known. A flag that throws `unknown flag` is not. Anything else it throws
 * (a missing value, a companion rule, an anti-vacuity refusal) means the flag EXISTS and the
 * invocation was incomplete — which is a different question and must not be read as absence.
 */
function parserKnows(smoke, flag) {
  const h = smoke || loadHarness();
  try {
    h.parseArgs(['node', 'smoke-dashboard.js', 'board.html', flag]);
    return true;
  } catch (e) {
    return !/unknown flag/i.test(String((e && e.message) || ''));
  }
}

/**
 * The families a roster document claims, read out of its markdown tables.
 *
 * The roster's row shape is `| \`--flag\` | disposition | basis | also-re-anchors |`. Only the
 * FIRST cell is read, and only when it is a backticked flag token, so prose that mentions a flag
 * is not mistaken for a row — the text-presence oracle this whole module exists to replace.
 */
function rosterFamilies(text) {
  // N2. The disposition cell is KEPT and is asserted by the census gate, so this is not a dead
  // value. It also lets a row that records a REMOVAL be recognised rather than re-read as a live
  // roster row — which is how `--ghost-walk` would return through a different door the day
  // somebody writes a "families removed" table.
  const rows = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^\|\s*`(--[a-z0-9-]+)`\s*\|\s*([^|]*)\|/i);
    if (!m) continue;
    const disposition = m[2].trim();
    if (/\bREMOVED\b|\bwithdrawn\b/i.test(disposition)) continue;
    if (!rows.has(m[1])) rows.set(m[1], disposition);
  }
  return rows;
}

/**
 * The two-way reconciliation. BOTH directions, because the census failed in both.
 *
 * @returns {{families:string[], roster:string[], rosterNotAFlag:string[], familyNoRow:string[]}}
 */
function reconcile(rosterText, smoke) {
  const h = smoke || loadHarness();
  const c = census(h);
  const rows = rosterFamilies(rosterText);
  const roster = [...rows.keys()].sort();
  const famSet = new Set(c.families);
  return {
    families: c.families,
    qualifiers: c.qualifiers,
    roster,
    // Direction 1 — a roster row for something the parser does not have (`--ghost-walk`).
    rosterNotAFlag: roster.filter((f) => !parserKnows(h, f)),
    // Direction 1b — a roster row for a flag that exists but is a qualifier, not a family.
    rosterNotAFamily: roster.filter((f) => parserKnows(h, f) && !famSet.has(f)),
    // Direction 2 — a real probe family with no roster row (the larger of the two errors).
    familyNoRow: c.families.filter((f) => !rows.has(f)),
    // A row with no disposition is a row that records ownership and says nothing about what the
    // owner owes — which is the half of the roster ADR-0173 actually consumes.
    rowsWithoutDisposition: roster.filter((f) => !String(rows.get(f) || '').trim()),
  };
}

module.exports = { census, parserKnows, rosterFamilies, reconcile, loadHarness };
