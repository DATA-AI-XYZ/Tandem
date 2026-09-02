#!/usr/bin/env node
/**
 * board-data-binding-gate.js — the DATA-REACHES-DOM arm of the port's acceptance
 * gate (STORY-33.9.01 · CF-43 · ADR-0227 §additive · ADR-0235).
 *
 *   node board-data-binding-gate.js <board.html> [--smoke <path>] [--json]
 *
 *   exit 0 — the payload demonstrably reaches the screen
 *   exit 1 — it does not; every failing arm is named on stderr
 *   exit 2 — no verdict was produced (usage, unreadable board, or a board this
 *            gate cannot honestly interrogate)
 *
 * Node stdlib only. Two of its three arms are stored compositions of probe families
 * `smoke-dashboard.js` already ships; the parity arm is driven by ONE additive family
 * (`--summary-parity`) that STORY-34.4.03 landed at the harness's registration seam,
 * because the surface parity used to read no longer exists. ADR-0227 permits additive
 * arms and forbids replacing the harness; this is the former. ADR-0296 records why the
 * arm could not stay a stored composition.
 *
 * ===========================================================================
 * THE LYING GREEN THIS EXISTS TO REFUSE (CF-43)
 * ===========================================================================
 * The E32 CHAT-02 independent review falsified the deliverable verdict: a board
 * whose ENTIRE 25 MB payload is disconnected — `window.__DATA` renamed, so the app
 * reads `undefined` and renders an empty shell — still exits 0 on a plain
 * `smoke-dashboard.js` run, reporting "10 nav tabs". It passes because the rail is
 * built from `window.__BOARD_CONFIG`, not from the data, and because
 * `--assert-visible <token>` asserts the NAV ITEM, not any content. Every arm the
 * suite had was answering a question the disconnected board could still answer.
 *
 * ===========================================================================
 * WHY THIS GATE DOES NOT READ THE PAYLOAD THE WAY THE APP DOES
 * ===========================================================================
 * This is the whole design, and the story's own gotcha names it: "the arm must not
 * itself read the payload variable the way the app does (or a rename breaks both
 * identically and parity lies)".
 *
 * An in-page probe can only reach the payload through `window.__DATA`. Rename it
 * and the probe sees `undefined` at exactly the moment the app does, so
 * "rendered === payload" becomes "0 === 0" and the gate certifies the dead board.
 *
 * So the EXPECTED side of every assertion here is derived from the DOCUMENT BYTES,
 * by SHAPE rather than by name: the gate walks the inline `<script>` bodies and
 * takes the payload to be the `window.<anything> = <json>` assignment whose value
 * is an object carrying arrays of records, and the config to be the one carrying a
 * `rail`. Rename `window.__DATA` to anything at all and this gate still finds 3,012
 * records in the file — while the board renders none. That asymmetry IS the gate.
 *
 * ===========================================================================
 * THE THREE ARMS (re-taught by STORY-34.4.03 · R11 · ADR-0296)
 * ===========================================================================
 * 0. THE RAIL IS NUMBERLESS. `.nav-item .cnt` — the surface arm 1 used to read — is
 *    retired, because a nav badge must mean "this needs you" and never "this many
 *    exist". Its ABSENCE is asserted rather than assumed, with `--assert-visible` as
 *    the positive control so that "no counts in the rail" cannot be satisfied by a
 *    board with no rail. This is also the arm the counted-rail mutant turns red.
 *
 * 1. PARITY, over the whole payload, in ONE browser launch — now read from each
 *    ADDRESSABLE VIEW'S OWN SUMMARY LINE (`.view-count-n`) instead of from the rail.
 *    The walk visits every declared view, which is what the retired arm got for free
 *    from a rail that rendered all the numbers at once.
 *
 *    THE EXPECTED SIDE DID NOT MOVE, and that is the point: it is still derived from
 *    the DOCUMENT BYTES by shape, and it is handed to the harness as a FILE so the
 *    in-page probe CANNOT compute it. A probe that read `window.__DATA` would go blind
 *    at exactly the moment the app does, parity would become 0 === 0, and the gate
 *    would certify the dead board. The asymmetry survives the re-teach untouched, and
 *    `tests/data-reaches-dom.test.js` proves it against BOTH mutants — the
 *    counted-rail one AND the disconnected-payload one the arm has always existed for.
 *
 *    The rail's own `keys:` declaration IS the declared exclusion list the testplan
 *    demanded, now read per addressable view: a view declaring `[]` (a panel-owned
 *    surface with no top-level array) is excluded on both sides and PRINTED, so the
 *    exclusion is visible rather than absorbed.
 *
 * 2. AN ANCHORED RECORD CARD. One real record, chosen deterministically from the
 *    file's own payload for the DEFAULT view, must appear on screen with its id on
 *    the card and its title as the card's text. Parity is a statement about
 *    numbers; this is a statement about a datum. A board could in principle fake
 *    the first with a hardcoded number; it cannot fake the second without holding
 *    the record.
 *
 * ANTI-VACUITY (EPIC-28 discipline). The gate REFUSES rather than passes when it
 * cannot discriminate: no payload found, no rail, no declared view, every declared
 * view empty (parity over zeros is 0===0), a declared view with NO summary line at all
 * (a skipped gate still exits 0 — BUG-20260825-04), or no anchorable record. Those are
 * exit 2 — "no verdict" — never exit 0.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const USAGE = 'usage: node board-data-binding-gate.js <board.html> [--smoke <path>] [--json]';
const EXIT_USAGE = 2;

/** Inside a script element the parser ends on this, case-insensitively. */
const SCRIPT_END = /<\/script/i;

/** A `window.<ident> = ` assignment at the head of an inline script body. */
const ASSIGN = /^\s*window\.([A-Za-z_$][\w$]*)\s*=\s*/;

/** The characters an anchor needle may contain — CLI-safe and CSS-safe. */
const SAFE_RUN = /[A-Za-z0-9 ,.\-()]{12,}/;

/** An id we are willing to put inside a CSS attribute selector unescaped. */
const SAFE_ID = /^[A-Za-z0-9._-]+$/;

/** How far into the default view's record list the anchor may be drawn from. */
const ANCHOR_SEARCH_DEPTH = 25;

function parseArgs(argv) {
  const out = { file: null, smoke: path.join(__dirname, 'smoke-dashboard.js'), json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') { out.json = true; continue; }
    if (a === '--smoke') {
      const v = argv[++i];
      if (v === undefined || v === '') { console.error(USAGE); console.error('--smoke requires a path'); process.exit(EXIT_USAGE); }
      out.smoke = path.resolve(v);
      continue;
    }
    if (a.indexOf('-') === 0) { console.error(USAGE); console.error('unknown option "' + a + '"'); process.exit(EXIT_USAGE); }
    if (out.file !== null) { console.error(USAGE); console.error('unexpected extra argument "' + a + '"'); process.exit(EXIT_USAGE); }
    out.file = a;
  }
  if (!out.file) { console.error(USAGE); process.exit(EXIT_USAGE); }
  return out;
}

/**
 * Every inline `<script>` body, delimited the way a parser delimits them (first
 * `</script` wins) so this function's view of the document is the browser's.
 */
function scriptBodies(html) {
  const bodies = [];
  let i = 0;
  for (;;) {
    const open = html.indexOf('<script', i);
    if (open === -1) break;
    const tagEnd = html.indexOf('>', open);
    if (tagEnd === -1) break;
    const rest = html.slice(tagEnd + 1);
    const m = SCRIPT_END.exec(rest);
    if (!m) { bodies.push(rest); break; }
    bodies.push(rest.slice(0, m.index));
    i = tagEnd + 1 + m.index;
  }
  return bodies;
}

/**
 * Find the payload and the config **by shape, never by name**.
 *
 * This is the property the whole gate rests on: the expected side must survive the
 * exact mutation that kills the rendered side. Returns `{ payload, config,
 * payloadVar, configVar }`; either may be null.
 */
function extractByShape(html) {
  let payload = null;
  let payloadVar = null;
  let payloadSize = -1;
  let config = null;
  let configVar = null;

  for (const body of scriptBodies(html)) {
    const m = ASSIGN.exec(body);
    if (!m) continue;
    let text = body.slice(m[0].length).trim();
    if (text.charAt(text.length - 1) === ';') text = text.slice(0, -1);
    if (text.charAt(0) !== '{') continue;
    let value;
    try { value = JSON.parse(text); } catch (_e) { continue; }
    if (!value || typeof value !== 'object') continue;

    if (Array.isArray(value.rail) && config === null) { config = value; configVar = m[1]; }

    let records = 0;
    let arrays = 0;
    for (const k of Object.keys(value)) {
      if (Array.isArray(value[k])) { arrays += 1; records += value[k].length; }
    }
    // The payload is the record-bearing object. `rail` alone is one array, so the
    // >= 2 floor keeps a config from being mistaken for a payload on a thin board.
    if (arrays >= 2 && records > payloadSize) { payload = value; payloadVar = m[1]; payloadSize = records; }
  }
  return { payload, config, payloadVar, configVar };
}

/** Per-view census, from the file's own bytes. */
function census(payload, config) {
  const views = [];
  let claimed = 0;
  for (const r of config.rail) {
    let n = 0;
    for (const k of (r.keys || [])) if (Array.isArray(payload[k])) n += payload[k].length;
    claimed += n;
    views.push({ id: r.id, label: String(r.label == null ? '' : r.label), keys: r.keys || [], count: n });
  }
  let total = 0;
  for (const k of Object.keys(payload)) if (Array.isArray(payload[k])) total += payload[k].length;

  /* BUG-20260825-03 — `unclaimed` used to be `total - claimed`, and `claimed` is a sum over
   * VIEWS. Two rail views may legitimately name the same payload array (measured on this board:
   * they do), so the subtraction double-counts and the figure goes NEGATIVE — at which point the
   * sentence "N record(s) are claimed by no view" silently stops meaning what it says. The gate's
   * VERDICT was never affected; the sentence a reader takes away from a green run was.
   *
   * Both quantities are now counted over KEYS, which is the thing views actually claim:
   *   unclaimed   — records in arrays no view names. Cannot be negative by construction.
   *   multiClaimed — records in arrays more than one view names. This is the overlap that used
   *                  to be silently folded into the first number with the wrong sign. */
  const claimCount = new Map();
  for (const r of config.rail) {
    for (const k of new Set(r.keys || [])) {
      if (Array.isArray(payload[k])) claimCount.set(k, (claimCount.get(k) || 0) + 1);
    }
  }
  let unclaimed = 0;
  let multiClaimed = 0;
  for (const k of Object.keys(payload)) {
    if (!Array.isArray(payload[k])) continue;
    const n = claimCount.get(k) || 0;
    if (n === 0) unclaimed += payload[k].length;
    else if (n > 1) multiClaimed += payload[k].length;
  }
  /* STORY-34.4.03 — THE PER-ADDRESSABLE-VIEW CENSUS.
   *
   * The rail carried a count per GROUP, so a group-level census was the right shape for
   * the arm that read it. The numberless rail retires that surface and parity moves to
   * each view's OWN summary line — and a summary line is per ADDRESSABLE view
   * (`group` or `group:sub`), not per group. `plan`'s group-level union is
   * strategy+epic+feature+specs; `plan:strategy`'s summary shows `strategy` alone, and
   * comparing one against the other would fail a board that is binding perfectly.
   *
   * Derived from the SAME `config.rail` bytes, by the same method. A group with
   * sub-views is addressable only through them (the rail's own rule), so its own key is
   * not a view.
   *
   * A VIEW DECLARING NO KEYS IS A DECLARED EXCLUSION, not a gap: `build:phases`, the
   * four `toolkit` catalogue sub-views, `tandem` and `about` state `[]` on purpose —
   * their content is a nested tree or a nested bag, neither of which is a top-level
   * array this gate can census from the bytes. They are printed rather than dropped, so
   * the exclusion is visible instead of absorbed. */
  const addressable = [];
  for (const r of config.rail) {
    const subs = Array.isArray(r.subs) ? r.subs : [];
    const label = String(r.label == null ? '' : r.label);
    if (subs.length) {
      for (const s of subs) {
        const keys = s.keys || [];
        let n = 0;
        for (const k of keys) if (Array.isArray(payload[k])) n += payload[k].length;
        addressable.push({ key: r.id + ':' + s.key, label: label + ' · ' + s.label, keys, count: n });
      }
    } else {
      const keys = r.keys || [];
      let n = 0;
      for (const k of keys) if (Array.isArray(payload[k])) n += payload[k].length;
      addressable.push({ key: r.id, label, keys, count: n });
    }
  }
  return { views, claimed, total, unclaimed, multiClaimed, addressable };
}

/**
 * Choose the record the anchored arm will look for.
 *
 * Deterministic (first eligible, in payload order) and drawn from the HEAD of the
 * default view's list, so the gate does not pin the shell's render cap — a record
 * in the first few positions is rendered under any cap the shell could plausibly
 * carry.
 */
function chooseAnchor(payload, view) {
  // THE ANCHOR MUST BE UNIQUE, NOT MERELY WELL-FORMED (BUG-20260827-04).
  // The arm asserts on `.card[data-id="<id>"]`, which is an all-matches selector. Bug ids
  // are folder-scoped by design (ADR-0168), so the corpus legitimately carries the same id
  // more than once — 24 of 216 distinct bug ids at the time of writing, one of them five
  // times. Anchoring on such an id matches several cards with different titles and fails a
  // board that is binding data perfectly. SAFE_ID constrains the id's characters, not its
  // cardinality; this counts the cardinality across the WHOLE payload, because the cards
  // sharing that id may be rendered by a different view than the one being anchored in.
  // Count DISTINCT TITLES per id, not occurrences. The payload repeats the same record
  // across view arrays, so counting occurrences marks every record a duplicate and the
  // chooser finds nothing anchorable at all — which is a false RED of its own, just a
  // quieter one. What actually breaks the assertion is two records sharing an id while
  // carrying DIFFERENT titles: the all-matches selector then spans both and no single
  // needle is in all of them. Same id + same title is the same artefact rendered twice
  // and the assertion passes over it unharmed.
  const titlesById = new Map();
  for (const k of Object.keys(payload || {})) {
    if (!Array.isArray(payload[k])) continue;
    for (const r of payload[k]) {
      if (!r || typeof r !== 'object' || r.id == null) continue;
      const key = String(r.id);
      const t = String(r.title == null ? (r.label == null ? '' : r.label) : r.title);
      if (!titlesById.has(key)) titlesById.set(key, new Set());
      titlesById.get(key).add(t);
    }
  }

  const recs = [];
  for (const k of (view.keys || [])) if (Array.isArray(payload[k])) for (const r of payload[k]) recs.push(r);
  const depth = Math.min(recs.length, ANCHOR_SEARCH_DEPTH);
  for (let i = 0; i < depth; i++) {
    const r = recs[i];
    if (!r || typeof r !== 'object') continue;
    const id = String(r.id == null ? '' : r.id);
    if (!SAFE_ID.test(id)) continue;
    // An ambiguous selector cannot prove binding, so refusing to anchor on one is the
    // arm's meaning being kept, not dodged.
    if ((titlesById.get(id) || new Set()).size > 1) continue;
    const title = String(r.title == null ? (r.label == null ? '' : r.label) : r.title);
    const run = SAFE_RUN.exec(title);
    if (!run) continue;
    return { id, title, needle: run[0].trim(), index: i };
  }
  return null;
}

function runSmoke(smoke, file, args) {
  const r = spawnSync(process.execPath, [smoke, file].concat(args), { encoding: 'utf8' });
  return {
    status: r.status,
    out: String(r.stdout || '').trim(),
    err: String(r.stderr || '').trim(),
    spawnError: r.error ? r.error.message : null,
  };
}

function main(argv) {
  const args = parseArgs(argv);

  let html;
  try { html = fs.readFileSync(args.file, 'utf8'); }
  catch (e) { console.error('[data-binding] no verdict — cannot read ' + args.file + ': ' + e.message); return EXIT_USAGE; }
  if (!fs.existsSync(args.smoke)) {
    console.error('[data-binding] no verdict — harness not found at ' + args.smoke);
    return EXIT_USAGE;
  }

  const found = extractByShape(html);
  if (!found.payload) {
    console.error('[data-binding] no verdict — no record-bearing payload assignment found in the '
      + 'document bytes. This gate reads the payload by SHAPE, so this is not a renamed variable; '
      + 'it is a board with no data in it.');
    return EXIT_USAGE;
  }
  if (!found.config || !Array.isArray(found.config.rail) || !found.config.rail.length) {
    console.error('[data-binding] no verdict — no `rail` declaration found, so there is nothing to '
      + 'compute a per-view census against.');
    return EXIT_USAGE;
  }

  const c = census(found.payload, found.config);
  const nonEmpty = c.views.filter((v) => v.count > 0);
  if (!nonEmpty.length) {
    console.error('[data-binding] no verdict — every rail view censuses to 0 records, so parity '
      + 'would be 0 === 0 and would pass against a board with no data bound at all.');
    return EXIT_USAGE;
  }

  const defaultView = c.views[0];
  // The positive control for the numberless arm below — the view the rail lands on,
  // taken from the config's own first entry rather than spelled.
  const defaultViewId = String(defaultView.id);
  const anchor = chooseAnchor(found.payload, defaultView);
  if (!anchor) {
    console.error('[data-binding] no verdict — no anchorable record in the first '
      + ANCHOR_SEARCH_DEPTH + ' record(s) of the default view "' + defaultView.id + '" (needs a '
      + 'selector-safe id and a >= 12-character plain-text run in its title).');
    return EXIT_USAGE;
  }

  const violations = [];
  const detail = {
    file: args.file,
    payloadVar: found.payloadVar,
    configVar: found.configVar,
    recordsInFile: c.total,
    // `claimed` is a sum over VIEWS, so an array two views both name is counted twice. That is the
    // right number for "did the rail render each view's count" and the WRONG number for "how many
    // records reach the DOM" — reporting it as the latter is the other half of BUG-20260825-03,
    // and it is why `recordsInFile` and this figure could not be reconciled by a reader.
    railViewRecordSlots: c.claimed,
    recordsReachingDom: c.total - c.unclaimed,
    recordsNoViewClaims: c.unclaimed,
    recordsClaimedByMoreThanOneView: c.multiClaimed,
    views: c.views.length,
    nonEmptyViews: nonEmpty.length,
    anchor: { id: anchor.id, index: anchor.index, needle: anchor.needle },
  };

  // -- ARM 0 · THE RAIL IS NUMBERLESS (STORY-34.4.03 · R11) -----------------
  // The counted rail is the surface ARM 1 used to read. It is retired, and a board that
  // grew it back would put ARM 1's old question back on a nav badge — so its absence is
  // asserted rather than assumed. `--assert-visible` is the positive control: without
  // it, "no `.cnt` inside `.rail .nav-item`" would also be true of a board with no rail.
  const numberless = runSmoke(args.smoke, args.file,
    ['--assert-absent', '.rail .nav-item .cnt', '--assert-visible', defaultViewId]);
  detail.numberlessExit = numberless.status;
  if (numberless.spawnError) {
    console.error('[data-binding] no verdict — could not launch the harness: ' + numberless.spawnError);
    return EXIT_USAGE;
  }
  if (numberless.status === 2) {
    console.error('[data-binding] no verdict — the harness could not evaluate the numberless-rail arm '
      + '(exit 2):\n' + (numberless.err || numberless.out));
    return EXIT_USAGE;
  }
  if (numberless.status !== 0) {
    violations.push('NUMBERLESS RAIL — the rail renders inventory count badges (`.nav-item .cnt`). '
      + 'A nav badge must mean "this needs you", never "this many exist" (R11), and a counted rail '
      + 'puts the shelf totals back on the one surface every view shares. Harness said:\n'
      + '    ' + (numberless.err || numberless.out).split('\n').slice(0, 6).join('\n    '));
  }

  // -- ARM 1 · PARITY, from each view's OWN summary line, one launch ---------
  // Re-derived (STORY-34.4.03 AC-3). The EXPECTED side is unchanged in kind: it still
  // comes from the DOCUMENT BYTES by shape, and it is handed to the harness as a FILE
  // precisely so the probe cannot compute it in-page — an in-page read of the payload
  // would go blind at exactly the moment the app does and parity would become 0 === 0.
  // Only the RENDERED side moved, from the rail badge to the surface R11 sends shelf
  // totals to.
  const declared = c.addressable.filter((a) => a.keys.length > 0);
  const excluded = c.addressable.filter((a) => a.keys.length === 0);
  detail.addressableViews = c.addressable.length;
  detail.declaredViews = declared.length;
  detail.declaredExclusions = excluded.map((a) => a.key);
  if (!declared.length) {
    console.error('[data-binding] no verdict — no addressable view declares a payload array, so summary '
      + 'parity would be asserted over nothing.');
    return EXIT_USAGE;
  }
  if (!declared.some((a) => a.count > 0)) {
    console.error('[data-binding] no verdict — every view that declares a payload array censuses to 0 '
      + 'records, so parity would be 0 === 0 and would pass against a board with no data bound at all.');
    return EXIT_USAGE;
  }
  const expectations = {};
  for (const a of declared) expectations[a.key] = a.count;
  let expectPath;
  try {
    expectPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'summary-parity-')), 'expectations.json');
    fs.writeFileSync(expectPath, JSON.stringify(expectations));
  } catch (e) {
    console.error('[data-binding] no verdict — could not write the expectation file: ' + e.message);
    return EXIT_USAGE;
  }
  const parity = runSmoke(args.smoke, args.file, ['--summary-parity', expectPath]);
  detail.parityExit = parity.status;
  if (parity.spawnError) {
    console.error('[data-binding] no verdict — could not launch the harness: ' + parity.spawnError);
    return EXIT_USAGE;
  }
  if (parity.status === 2) {
    // A view with no summary surface is a REFUSAL, never a silent skip
    // (BUG-20260825-04's lesson, carried across the re-teach).
    console.error('[data-binding] no verdict — the harness could not evaluate the summary-parity arm '
      + '(exit 2):\n' + (parity.err || parity.out));
    return EXIT_USAGE;
  }
  if (parity.status !== 0) {
    violations.push('PARITY — the views do not render the counts this document carries. The file '
      + 'holds ' + (c.total - c.unclaimed) + ' record(s) claimed across ' + declared.length
      + ' declared view(s) (read by shape, from `window.' + found.payloadVar + '`), and the board did '
      + 'not display them in the views\' own summary lines. Harness said:\n'
      + '    ' + (parity.err || parity.out).split('\n').slice(0, 8).join('\n    '));
  }
  try { fs.rmSync(path.dirname(expectPath), { recursive: true, force: true }); } catch (_e) { /* ignore */ }

  // -- ARM 2 · one real record, on screen -----------------------------------
  const anchorArgs = [
    '--assert-element-text', '.card[data-id="' + anchor.id + '"] .card-title',
    '--assert-contains', anchor.needle,
  ];
  const anchored = runSmoke(args.smoke, args.file, anchorArgs);
  detail.anchorExit = anchored.status;
  if (anchored.status === 2) {
    console.error('[data-binding] no verdict — the harness could not evaluate the anchored-record '
      + 'arm (exit 2):\n' + (anchored.err || anchored.out));
    return EXIT_USAGE;
  }
  if (anchored.status !== 0) {
    violations.push('ANCHORED RECORD — the document carries record "' + anchor.id + '" titled "'
      + anchor.title.slice(0, 60) + '" at position ' + anchor.index + ' of the default view, and the '
      + 'board does not put it on screen. Harness said:\n'
      + '    ' + (anchored.err || anchored.out).split('\n').slice(0, 6).join('\n    '));
  }

  if (args.json) console.log(JSON.stringify(Object.assign({ ok: violations.length === 0 }, detail)));

  if (violations.length) {
    console.error('[data-binding] FAIL — ' + violations.length + ' arm(s) refused ' + args.file + ':');
    for (const v of violations) console.error('  - ' + v);
    console.error('  This is CF-43: a board can render, report its nav tabs and exit 0 on the plain '
      + 'smoke verdict while showing none of its data. That is what these arms refuse.');
    return 1;
  }
  // Declared exclusions PRINT on green runs. A view whose keys are `[]` is not counted
  // on either side, and a reader has to keep seeing which ones those are — an exclusion
  // that goes quiet is an exclusion nobody re-examines.
  for (const k of detail.declaredExclusions) {
    console.log('[data-binding] declared exclusion (declares no top-level payload array): ' + k);
  }
  console.log('data-binding OK: ' + (c.total - c.unclaimed) + ' record(s) reach the DOM through '
    + detail.declaredViews + ' declared view(s)\' OWN summary lines (' + nonEmptyViews(nonEmpty)
    + ' by rail group), the rail renders no inventory count, and record "' + anchor.id
    + '" renders its title on screen. Payload read by shape from `window.' + found.payloadVar
    + '`; ' + c.unclaimed + ' record(s) in the file are claimed by no view and are excluded from '
    + 'both sides; ' + detail.declaredExclusions.length + ' addressable view(s) declare no array '
    + 'and are excluded by declaration'
    + (c.multiClaimed ? ', and ' + c.multiClaimed + ' record(s) are claimed by more than one view'
      : '') + '.');
  return 0;
}

function nonEmptyViews(list) {
  return list.map((v) => v.label + '=' + v.count).join(', ');
}

if (require.main === module) process.exit(main(process.argv));

module.exports = { scriptBodies, extractByShape, census, chooseAnchor, main, SAFE_ID, SAFE_RUN };
