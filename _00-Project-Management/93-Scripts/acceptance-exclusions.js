#!/usr/bin/env node
/**
 * acceptance-exclusions.js — the loud known-red exclusion mechanism for the port's
 * acceptance tally (STORY-33.9.02 AC-3 · EPIC-33 §"The three known-red FEAT-25.5
 * gates" · ADR-0222 · ADR-0173 · ADR-0234).
 *
 *   node acceptance-exclusions.js            print the disposition block
 *   node acceptance-exclusions.js --json     the same thing, machine-readable
 *
 *   exit 0 — a disposition was produced (this is a REPORTER, not a gate)
 *   exit 2 — a registry entry could not be resolved, so no disposition exists
 *
 * Node stdlib only, and it reads the board rather than restating it.
 *
 * ===========================================================================
 * WHAT THIS IS FOR
 * ===========================================================================
 * EPIC-33 forbids the port's acceptance suite from counting the FEAT-25.5 gates
 * that are known not to be gate-capable: "a suite total that silently includes
 * known-reds would be the exact lying-green EPIC-28 exists to prevent". The
 * symmetric error is just as bad — silently DROPPING a red from the denominator
 * flatters the total in the other direction. So the rule is: every known-red gate
 * is named on every run, on whichever side of the line it currently sits, with the
 * BUG and the ADR clause that put it there.
 *
 * ===========================================================================
 * THE THREE THINGS THIS FILE REFUSES TO DO
 * ===========================================================================
 * 1. IT DOES NOT ASSERT A DISPOSITION. The registry below records WHICH gate is
 *    governed by WHICH bug; whether that gate can engage today is read from the
 *    governing BUG file's live `status:` at call time. A registry that carried its
 *    own copy of "this one is fixed now" would go stale the first time a bug
 *    re-opened, and it would go stale silently.
 *
 * 2. IT DOES NOT LET A STATUS FLIP MANUFACTURE A GREEN. One entry —
 *    TESTPLAN-25.5.01 TC-05 — is marked `permanent: true`. Its red is a PERMANENT
 *    RECORDED EXCEPTION under ADR-0222 clause 3 (operator ruling, 2026-08-24,
 *    `10-Inbox/APPROVALS.md`): the `02b103f` grid baseline holds a non-renewable
 *    historical fact, so re-capturing it would compare the build to itself and go
 *    green by forgetting. That gate is excluded REGARDLESS of any status anywhere,
 *    and no edit to a frontmatter line can move it. BACKLOG-0197 is the named
 *    successor; when it ships a size-invariant assertion, that new gate joins the
 *    tally on its own merits and this entry is retired by an ADR, not by a flip.
 *
 * 3. IT DOES NOT GO QUIET WHEN THERE IS NOTHING TO EXCLUDE. An empty exclusion
 *    list still prints a line saying so, with both denominators. A census that
 *    cannot say what it left out is this tree's recurring defect
 *    (`tests/census-basis.test.js` :: adoption-exemptions); an exclusion block that
 *    disappears when it is empty is the same defect with better manners.
 *
 * ===========================================================================
 * THE UNIT IS THE GATE, NOT THE BUG (ADR-0234)
 * ===========================================================================
 * BUG-20260819-03 governs TWO gates whose dispositions are OPPOSITE: TC-02 of
 * TESTPLAN-25.5.04 was repaired under ADR-0222 clause 2 and re-runs green, while
 * TC-05 of TESTPLAN-25.5.01 stays red forever under clause 3. Keying the registry
 * on the bug would force one answer onto both and one of the two would be a lie.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { TERMINAL_STATUSES } = require('./validate-frontmatter.js');

const USAGE = 'usage: node acceptance-exclusions.js [--json]';
const EXIT_USAGE = 2;

const PM = path.resolve(__dirname, '..');
const BUGS = path.join(PM, '34-Bugs', 'EPIC-25', 'FEAT-25.5');
const PLANS = path.join(PM, '33-Testplans', 'EPIC-25', 'FEAT-25.5');

/**
 * THE REGISTRY. Four gates, three bugs. Each row records only facts that do not
 * expire: which gate, which bug governs it, which ADR clause decided it, and why.
 * Nothing here says whether the gate passes today — that is read from disk.
 */
const KNOWN_RED_GATES = Object.freeze([
  Object.freeze({
    gate: 'TESTPLAN-25.5.03 TC-01',
    testplan: 'TESTPLAN-25.5.03-bug-severity-and-impact.md',
    bug: 'BUG-20260819-01',
    adr: 'ADR-0222 clause 1',
    permanent: false,
    successor: null,
    ruling: null,
    basis: 'element mode never paged the bug list in, so the probe refused instead of '
      + 'verdicting — a gate that CANNOT ENGAGE, repairable under clause 1',
  }),
  Object.freeze({
    gate: 'TESTPLAN-25.5.04 TC-03',
    testplan: 'TESTPLAN-25.5.04-audit-cards-title-date-summary.md',
    bug: 'BUG-20260819-02',
    adr: 'ADR-0222 clause 1',
    permanent: false,
    successor: null,
    ruling: null,
    basis: 'the stored command was truncated mid-string by a review commit and has not '
      + 'parsed since — bash refused it before the probe launched',
  }),
  Object.freeze({
    gate: 'TESTPLAN-25.5.04 TC-02',
    testplan: 'TESTPLAN-25.5.04-audit-cards-title-date-summary.md',
    bug: 'BUG-20260819-03',
    adr: 'ADR-0222 clause 2',
    permanent: false,
    successor: null,
    ruling: null,
    basis: 'anchored on a 1500-byte proximity window in a file that grew — re-anchored '
      + 'STRUCTURALLY (the JSDoc block on buildReports()) rather than widened',
  }),
  Object.freeze({
    gate: 'TESTPLAN-25.5.01 TC-05',
    testplan: 'TESTPLAN-25.5.01-card-disclosure-control.md',
    bug: 'BUG-20260819-03',
    adr: 'ADR-0222 clause 3',
    permanent: true,
    successor: 'BACKLOG-0197',
    ruling: 'operator, 2026-08-24T09:47:36+01:00, 10-Inbox/APPROVALS.md',
    basis: 'the grid-height baseline was captured at 02b103f, BEFORE the change it '
      + 'measures; that "before" is not renewable, so the anchor cannot be repaired and '
      + 'the gate stays RED by ruling. Re-capturing it is forbidden',
  }),
]);

/** Read a frontmatter `status:` without a YAML parser (the tree's house style). */
function readStatus(file) {
  const text = fs.readFileSync(file, 'utf8');
  const m = /^status:\s*['"]?([a-z-]+)['"]?\s*$/m.exec(text);
  return m ? m[1] : null;
}

/** Resolve the one file in `dir` whose name starts with `id`. */
function resolveById(dir, id) {
  let names;
  try { names = fs.readdirSync(dir); }
  catch (e) { return { error: 'cannot read ' + dir + ': ' + e.message }; }
  const hits = names.filter((n) => n.indexOf(id) === 0 && n.slice(-3) === '.md');
  if (hits.length !== 1) {
    return { error: 'expected exactly 1 file for ' + id + ' in ' + dir + ', found ' + hits.length };
  }
  return { file: path.join(dir, hits[0]) };
}

/**
 * The disposition of every registry row, derived live.
 *
 * A gate is INCLUDED in the tally only when its governing bug has actually been
 * RESOLVED — the linter's own terminal set, imported rather than re-typed, because
 * a second hand-written copy of a status vocabulary is how two tools come to
 * disagree about what `wontfix` means. `blocked` is a legitimate terminal state for
 * the STORY (the human owner has not answered yet) and is deliberately NOT
 * engageability: a gate whose bug is blocked still cannot verdict, so it stays
 * excluded and says which owner it waits on. Anything else — open, in-progress,
 * in-review — is excluded with its status named.
 *
 * @param {object} [opts]
 * @param {string} [opts.bugsDir]   override for the tests
 * @param {object} [opts.statuses]  inject `{ 'BUG-…': 'open' }` to drive a control
 *                                  arm without planting a status in the real tree
 */
function disposition(opts) {
  const o = opts || {};
  const bugsDir = o.bugsDir || BUGS;
  const plansDir = o.plansDir || PLANS;
  const injected = o.statuses || null;
  const rows = [];
  const errors = [];

  for (const g of KNOWN_RED_GATES) {
    // A registry row names a real gate in a real testplan. If the plan file moves or
    // is renamed, the row still LOOKS fine — it would keep printing its line while
    // pointing at nothing, and a stale exclusion is as dishonest as a missing one.
    // So the path is resolved, not trusted. (Review finding, 2026-08-24: this is
    // also what makes PLANS_DIR load-bearing rather than a decorative export.)
    if (!fs.existsSync(path.join(plansDir, g.testplan))) {
      errors.push('registry row "' + g.gate + '" names a testplan that does not exist: '
        + g.testplan);
    }

    let status = null;
    let bugFile = null;
    if (injected && Object.prototype.hasOwnProperty.call(injected, g.bug)) {
      status = injected[g.bug];
    } else {
      const r = resolveById(bugsDir, g.bug);
      if (r.error) {
        errors.push(r.error);
        rows.push(Object.assign({}, g, {
          status: null, bugFile: null, excluded: true, reason: 'status-unreadable',
        }));
        continue;
      }
      bugFile = r.file;
      try { status = readStatus(bugFile); }
      catch (e) { errors.push('cannot read ' + bugFile + ': ' + e.message); }
    }

    const resolved = status !== null && TERMINAL_STATUSES.has(status);
    let excluded;
    let reason;
    if (g.permanent) {
      excluded = true;
      reason = 'permanent-exception';
    } else if (status === null) {
      excluded = true;
      reason = 'status-unreadable';
    } else if (!resolved) {
      excluded = true;
      reason = status === 'blocked' ? 'blocked-on-owner' : 'not-terminal';
    } else {
      excluded = false;
      reason = 'resolved';
    }
    rows.push(Object.assign({}, g, { status, bugFile, excluded, reason }));
  }

  return {
    rows,
    errors,
    total: rows.length,
    excluded: rows.filter((r) => r.excluded).length,
    included: rows.filter((r) => !r.excluded).length,
  };
}

/** One line per gate, always citing the BUG and the ADR clause that put it there. */
function gateLine(r) {
  const cite = r.bug + ' · ' + r.adr;
  if (!r.excluded) {
    return 'INCLUDED  ' + r.gate + ' — ' + cite + ' is ' + r.status
      + '; the gate was re-anchored and recorded (ADR-0173), so it counts in the tally';
  }
  if (r.reason === 'permanent-exception') {
    return 'EXCLUDED  ' + r.gate + ' — ' + cite + ' · PERMANENT RECORDED EXCEPTION ('
      + r.ruling + '). ' + r.basis + '. Successor: ' + r.successor
      + '. This exclusion never disappears and no status flip can remove it';
  }
  if (r.reason === 'blocked-on-owner') {
    return 'EXCLUDED  ' + r.gate + ' — ' + cite + ' is blocked on its named human owner; '
      + 'the gate still cannot verdict, so it is not counted either way';
  }
  if (r.reason === 'status-unreadable') {
    return 'EXCLUDED  ' + r.gate + ' — ' + cite + ' could not be read; a gate whose governing '
      + 'bug cannot be resolved is never counted as a pass';
  }
  return 'EXCLUDED  ' + r.gate + ' — ' + cite + ' is ' + r.status
    + ' (not terminal); until it resolves, the gate cannot engage: ' + r.basis;
}

/**
 * The loud block. Printed on EVERY acceptance run, green or red — including the run
 * where there is nothing left to exclude, which still says so with both
 * denominators rather than falling silent.
 */
function exclusionBlock(d) {
  const lines = [];
  lines.push('known-red exclusions (EPIC-33 · ADR-0222 · ADR-0234): '
    + d.excluded + ' excluded / ' + d.included + ' included, of ' + d.total
    + ' registered gate(s)');
  for (const r of d.rows) lines.push('  ' + gateLine(r));
  if (d.excluded === 0) {
    lines.push('  none excluded — every registered known-red gate now engages and is counted');
  }
  return lines.join('\n');
}

/**
 * Fold a runner's per-gate results into an honest tally.
 *
 * `results` is `{ '<gate>': 'pass' | 'fail' }`. Excluded gates are removed from
 * BOTH the numerator and the denominator and named in `excludedGates`, so the
 * printed total is a claim about the gates that were actually asked.
 */
function applyExclusions(results, d) {
  const disp = d || disposition();
  const byGate = new Map(disp.rows.map((r) => [r.gate, r]));
  const out = { passed: 0, failed: 0, counted: 0, excludedGates: [], unregistered: 0 };
  for (const gate of Object.keys(results || {})) {
    const row = byGate.get(gate);
    if (row && row.excluded) { out.excludedGates.push(gate); continue; }
    if (!row) out.unregistered += 1;
    out.counted += 1;
    if (results[gate] === 'pass') out.passed += 1; else out.failed += 1;
  }
  return out;
}

function main(argv) {
  let json = false;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--json') { json = true; continue; }
    console.error(USAGE);
    console.error('unknown option "' + argv[i] + '"');
    return EXIT_USAGE;
  }
  const d = disposition();
  if (d.errors.length) {
    console.error('[acceptance-exclusions] no disposition — ' + d.errors.length
      + ' registry row(s) unresolved:');
    for (const e of d.errors) console.error('  - ' + e);
    return EXIT_USAGE;
  }
  if (json) console.log(JSON.stringify(d, null, 2));
  else console.log(exclusionBlock(d));
  return 0;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = {
  KNOWN_RED_GATES, disposition, exclusionBlock, gateLine, applyExclusions, main,
  BUGS_DIR: BUGS, PLANS_DIR: PLANS,
};
