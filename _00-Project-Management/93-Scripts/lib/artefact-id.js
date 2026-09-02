'use strict';
/**
 * artefact-id.js — STORY-28.3.01 / BACKLOG-0134. ONE definition of what an
 * artefact id looks like, for every script that has to recognise one.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists
 *
 * The id grammar was written out by hand in six places. Two of them (the
 * `fileIdFromName` in `validate-frontmatter.js` and the one in
 * `generate-dashboard.js`) had already drifted once and cost a live incident:
 * the linter's RELEASE arm was `RELEASE-v\d+\.\d+` — two segments — while the
 * dashboard's had always been `RELEASE-v\d+\.\d+(?:\.\d+)?`, so `RELEASE-v2.7.1.md`
 * was read as the id `RELEASE-v2.7` by one reader and `RELEASE-v2.7.1` by the
 * other. R10 then reported 15 correct release records as mismatching their own
 * filenames (BUG-20260803-01). The fix reconciled that PAIR by hand and left a
 * comment asking the next author to keep them byte-identical — which is a
 * request, not a mechanism. This module is the mechanism.
 *
 * The other four copies were never reconciled at all, and the freeze measured
 * before consolidation (see `tests/fixtures/artefact-id-baseline.json`) showed
 * three of them answering differently from the pair:
 *
 *   - W6's prose scanner carried SIX families and no TESTPLAN / RELEASE / RETRO,
 *     so "Superseded by TESTPLAN-01.2.03" or "…by RELEASE-v2.7.1" did not count
 *     as naming where the work went.
 *   - `parseReviewLink` in the dashboard carried `\d{2}` for the epic/story
 *     number, so `AI-CODE-REVIEW-EPIC-104-…` parsed to the id `EPIC-10` — a
 *     review silently filed against the wrong epic. Two digits is the padding
 *     convention, not the grammar.
 *   - R28's folder-scope test was a bare `BUG_SCOPED_ID_RE = /^BUG-/`, so ANY id
 *     beginning `BUG-` grouped per folder. `isFolderScoped()` below asks the BUG
 *     family's own pattern, which means a MALFORMED bug id (`BUG-xyz`,
 *     `BUG-2026-08-05-01`) is now project-global and two of them in different
 *     feature folders are a FATAL collision that was not one before. The two
 *     predicates agree on every well-formed id.
 *
 * All three were resolved TOWARD the canonical grammar (the widest family set,
 * no fixed-width digits, the family's own pattern rather than its bare prefix)
 * with the decision recorded in ADR-0175, not toward whichever copy this module
 * happened to be typed from.
 *
 * COUNT CORRECTION (2026-08-05, E28-P2 review remediation): this header, ADR-0175
 * and the freeze fixture all said SIX copies. There were SEVEN — R28's was
 * retired with the rest and frozen with none of them, which is why its changed
 * answer went unrecorded for a day. The fixture now holds seven patterns over 53
 * probes and three resolved divergences. A freeze that omits one retired copy
 * cannot notice that copy drifting, which is the entire job of a freeze.
 *
 * ---------------------------------------------------------------------------
 * The grammar, and where it comes from
 *
 * `_00-Project-Management/CLAUDE.md` § Numbering rules is the source of truth for
 * both the SHAPE of each id and its uniqueness SCOPE. The scope belongs here with
 * the shape because R28 (two artefacts, one id) has to know that a BUG number
 * restarts per feature folder while every other family is project-global — and a
 * second hand-written copy of THAT is the same defect one level up.
 *
 * ORDER IS PART OF THE CONTRACT. The alternation is tried left to right and the
 * families are listed in the order the two `fileIdFromName` copies listed them, so
 * the generated source is byte-identical to what those call sites carried. No two
 * families share a prefix today; if one ever does, the longer must come first.
 *
 * Node stdlib only. No filesystem access — every function here is pure, which is
 * what lets the equivalence freeze be a data file rather than a corpus run.
 */

/**
 * @typedef {Object} Family
 * @property {string} name     the id prefix (also the family name)
 * @property {string} pattern  the regex SOURCE for one id of this family
 * @property {'project'|'folder'} scope uniqueness scope per CLAUDE.md § Numbering rules
 * @property {string} example  a real id of this family
 */

/** @type {Family[]} */
const FAMILIES = [
  { name: 'EPIC', pattern: 'EPIC-\\d+', scope: 'project', example: 'EPIC-28' },
  { name: 'FEAT', pattern: 'FEAT-\\d+\\.\\d+', scope: 'project', example: 'FEAT-28.3' },
  { name: 'STORY', pattern: 'STORY-\\d+\\.\\d+\\.\\d+', scope: 'project', example: 'STORY-28.3.01' },
  { name: 'TESTPLAN', pattern: 'TESTPLAN-\\d+\\.\\d+\\.\\d+', scope: 'project', example: 'TESTPLAN-28.3.01' },
  // FOLDER-scoped: "BUG-YYYYMMDD-NN where NN is the sequential bug filed that day
  // WITHIN THAT FEATURE FOLDER" — the counter restarts per folder by design.
  { name: 'BUG', pattern: 'BUG-\\d{8}-\\d+', scope: 'folder', example: 'BUG-20260805-01' },
  { name: 'ADR', pattern: 'ADR-\\d+', scope: 'project', example: 'ADR-0175' },
  { name: 'BACKLOG', pattern: 'BACKLOG-\\d+', scope: 'project', example: 'BACKLOG-0134' },
  // The third segment is optional: `RELEASE-v2.7` and `RELEASE-v2.7.1` are both ids.
  { name: 'RELEASE', pattern: 'RELEASE-v\\d+\\.\\d+(?:\\.\\d+)?', scope: 'project', example: 'RELEASE-v2.7.1' },
  { name: 'RETRO', pattern: 'RETRO-\\d{4}-\\d{2}', scope: 'project', example: 'RETRO-2026-07' },
];

const FAMILY_NAMES = FAMILIES.map((f) => f.name);
const BY_NAME = new Map(FAMILIES.map((f) => [f.name, f]));

/**
 * The alternation source for a family subset, in declaration order.
 * @param {string[]} [names] defaults to every family
 * @returns {string} e.g. `(EPIC-\d+|FEAT-\d+\.\d+|…)`
 */
function alternation(names) {
  const wanted = names ? names.slice() : FAMILY_NAMES;
  for (const n of wanted) {
    if (!BY_NAME.has(n)) throw new Error('unknown artefact family: ' + n);
  }
  // Declaration order, not caller order: the alternation's precedence is part of
  // the contract and must not depend on how a caller happened to list the names.
  const parts = FAMILIES.filter((f) => wanted.indexOf(f.name) >= 0).map((f) => f.pattern);
  return '(' + parts.join('|') + ')';
}

/**
 * Build a matcher over the id grammar.
 *
 * @param {Object} [opts]
 * @param {'start'|'exact'|'word'|'none'} [opts.anchor='start']
 *        start — the id must begin the subject (what a filename reader wants)
 *        exact — the subject is exactly one id (what a `depends_on:` value must be)
 *        word  — an id anywhere, on word boundaries (what a prose scanner wants)
 *        none  — no anchoring; the caller is composing a larger pattern
 * @param {string[]} [opts.families] family subset, defaults to all
 * @param {string} [opts.flags] regex flags
 * @returns {RegExp}
 */
function idRegex(opts) {
  const o = opts || {};
  const core = alternation(o.families);
  const anchor = o.anchor === undefined ? 'start' : o.anchor;
  let source;
  if (anchor === 'start') source = '^' + core;
  else if (anchor === 'exact') source = '^' + core + '$';
  else if (anchor === 'word') source = '\\b' + core + '\\b';
  else if (anchor === 'none') source = core;
  else throw new Error('unknown anchor: ' + anchor);
  return new RegExp(source, o.flags || '');
}

/**
 * The id an artefact FILENAME declares, or null.
 *
 *   "STORY-01.2.07-foo-bar.md"   -> "STORY-01.2.07"
 *   "BUG-20260520-03-symptom.md" -> "BUG-20260520-03"
 *   "ADR-0007-postgres-jsonb.md" -> "ADR-0007"
 *   "RELEASE-v2.7.1.md"          -> "RELEASE-v2.7.1"
 *
 * Prefix semantics, deliberately: everything after the id is a slug, and a slug
 * that itself looks numeric (`STORY-28.3.01.02.md`) still yields the id its
 * leading segment declares. Both `fileIdFromName` copies behaved this way and the
 * frozen baseline pins it.
 *
 * @param {string} filename absolute path, relative path or bare name
 * @returns {string|null}
 */
function fileIdFromName(filename) {
  const name = String(filename === undefined || filename === null ? '' : filename);
  // Basename without a trailing `.md`. Done here rather than via `path.basename`
  // so the module stays dependency-free and answers the same for a bare name, a
  // POSIX path and a Windows path.
  const base = name.split(/[\\/]/).pop().replace(/\.md$/, '');
  const m = ID_START_RE.exec(base);
  return m ? m[1] : null;
}

/** The family a WHOLE id belongs to, or null if the string is not exactly an id. */
function familyOf(id) {
  const s = String(id === undefined || id === null ? '' : id);
  for (const f of FAMILIES) {
    if (new RegExp('^' + f.pattern + '$').test(s)) return f.name;
  }
  return null;
}

/** Is `value` exactly one id of `family`? (`depends_on:` entries, `story:` fields.) */
function isExactId(value, family) {
  return familyOf(value) === family;
}

/** The first id mentioned in a block of prose, or null. Word-anchored. */
function firstIdIn(text) {
  const m = ID_WORD_RE.exec(String(text === undefined || text === null ? '' : text));
  return m ? m[1] : null;
}

/** Does this prose mention any artefact id at all? */
function mentionsId(text) {
  return firstIdIn(text) !== null;
}

/**
 * Is this id's uniqueness scope the containing FOLDER rather than the project?
 * True for BUG ids only (CLAUDE.md § Numbering rules); R28 keys its collision
 * groups on the answer. Prefix-based on purpose: a bug file whose `type:` is
 * wrong is still a bug by its id and its folder.
 *
 * The prefix tested is the BUG family's own `BUG-\d{8}-\d+`, NOT the bare `BUG-`
 * that R28 carried before consolidation. The carve-out exists because the BUG
 * counter restarts per feature folder; a string with no counter has no counter to
 * restart and therefore no claim on it. Divergence D3 in
 * `tests/fixtures/artefact-id-baseline.json` records the change and its four
 * probes; R28 is FATAL, so this is not a silent one.
 */
function isFolderScoped(id) {
  const s = String(id === undefined || id === null ? '' : id);
  for (const f of FAMILIES) {
    if (f.scope !== 'folder') continue;
    if (new RegExp('^' + f.pattern).test(s)) return true;
  }
  return false;
}

/**
 * Is `filename` an artefact file of `family` — i.e. does its name lead with an id
 * of that family? (`generate-backlog-board.js` selecting `BACKLOG-*.md`.)
 */
function isArtefactFileOf(filename, family) {
  const id = fileIdFromName(filename);
  return id !== null && familyOf(id) === family;
}

// Compiled once. `idRegex()` stays available for callers composing something
// larger; these two are the shapes every consumer needs.
const ID_START_RE = idRegex({ anchor: 'start' });
const ID_WORD_RE = idRegex({ anchor: 'word' });

/**
 * THE NO-SECOND-COPY DETECTOR.
 *
 * Finds source lines that encode an artefact-id SHAPE themselves rather than
 * asking this module. The discriminator is a family prefix followed immediately
 * by a digit-class token — `\d`, `\\d` (the escaped form inside a string that
 * will be handed to `new RegExp`) or a literal `[0-9]`. That is deliberately
 * narrower than "mentions an id": these files are full of real ids in prose and
 * in violation messages (`Superseded by STORY-12.3.04`), and a detector that
 * flagged those would be turned off within a week.
 *
 * It reads STRING LITERALS as well as regex literals because a pattern assembled
 * from strings is still a second copy — the risk TESTPLAN-28.3.01 names — and it
 * JOINS string concatenations first, so `'^BACKLOG-' + '\\d+'` is seen as the one
 * pattern it is rather than as two innocent halves. That join is done twice: once
 * per line (exact line numbers) and once over the whole comment-stripped file
 * (catches a concatenation split across lines, at the cost of an approximate line
 * number — flagged as `approximate` on the finding).
 *
 * Comment lines are skipped: this file's own history, and the consumers', is
 * written in comments quoting the patterns that used to live there, and that
 * prose is the record of why the module exists.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT CANNOT SEE — stated plainly, because a detector whose boundary is
 * implicit gets read as one with no boundary (E28-P2 review, MINOR-2)
 *
 *   1. A family prefix this module does not declare. `/^SPIKE-\d+/` in a
 *      consumer is invisible here, by construction: the alternation is built
 *      from `FAMILY_NAMES`. A family added to one consumer and not to the module
 *      is therefore NOT caught by this detector. It is caught by the thing that
 *      actually enforces single-source — the shared function identity assertion
 *      (`artefact-id.test.js`: `vf.fileIdFromName === dash.fileIdFromName ===
 *      A.fileIdFromName`) — because a consumer that answers from its own table
 *      is no longer answering from this one.
 *   2. A pattern assembled by an array join: `['^EPIC', '-', '\\d+'].join('')`.
 *      `joinStringConcats` understands `+` between two same-quoted literals
 *      (including backticks since the E28-P2 review), not arbitrary expressions.
 *   3. A prefix-only copy with no digit-class token — the boundary ADR-0175
 *      states deliberately, so real ids in prose and in violation messages do
 *      not redden the corpus.
 *
 * The case-insensitive flag WAS added, so `/^epic-\d+/i` is caught.
 *
 * @param {string} source file contents
 * @returns {{line: number, text: string, approximate?: boolean}[]}
 */
function residualIdPatterns(source) {
  const out = [];
  const lines = String(source || '').split(/\r?\n/);
  const code = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (t.indexOf('//') === 0 || t.indexOf('*') === 0 || t.indexOf('/*') === 0) { code.push(''); continue; }
    code.push(line);
    if (RESIDUAL_SHAPE_RE.test(line) || RESIDUAL_SHAPE_RE.test(joinStringConcats(line))) {
      out.push({ line: i + 1, text: t });
    }
  }
  const whole = joinStringConcats(code.join('\n'));
  const re = new RegExp(RESIDUAL_SHAPE_RE.source, 'g');
  let m;
  while ((m = re.exec(whole)) !== null) {
    const near = whole.slice(0, m.index).split('\n').length;
    // Within two lines of something already reported is the same finding seen twice —
    // the per-line pass and this one overlap by design on single-line sites.
    if (out.some((o) => Math.abs(o.line - near) <= 2)) continue;
    out.push({
      line: near,
      text: whole.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\n/g, ' | '),
      approximate: true,
    });
  }
  out.sort((a, b) => a.line - b.line);
  return out;
}

/**
 * `'abc' + 'def'` → `'abcdef'`. Adjacent string literals joined into the one they
 * build. Backticks included since the E28-P2 review: `` `^EPIC-` + `\d+` `` is the
 * same evasion as the single-quoted form one keystroke away, and the test's comment
 * called the string-concat case "the evasion TESTPLAN-28.3.01's risks section names"
 * while covering only two of its three spellings.
 */
function joinStringConcats(text) {
  return String(text).replace(/(['"`])\s*\+\s*\1/g, '');
}

// `i`: `/^epic-\d+/i` is a second copy of the grammar however it is cased, and the
// families are upper-case only, so the flag cannot widen this onto anything but a
// family prefix spelled in another case (E28-P2 review, MINOR-2).
const RESIDUAL_SHAPE_RE = new RegExp(
  '(?:' + FAMILY_NAMES.join('|') + ')-(?:v)?(?:\\\\{1,2}d|\\[0-9\\])', 'i');

module.exports = {
  FAMILIES,
  FAMILY_NAMES,
  alternation,
  idRegex,
  fileIdFromName,
  familyOf,
  isExactId,
  firstIdIn,
  mentionsId,
  isFolderScoped,
  isArtefactFileOf,
  residualIdPatterns,
  joinStringConcats,
  RESIDUAL_SHAPE_RE,
};
