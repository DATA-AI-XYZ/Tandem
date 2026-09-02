#!/usr/bin/env node
'use strict';
/**
 * wiki-anchor-stamp.js — re-derive a document's staleness clock, and REFUSE to mute it.
 * (Review remediation for STORY-31.1.03; rule and rationale in ADR-0220.)
 *
 * ============================================================================
 * WHAT WENT WRONG, AND WHY THIS IS A SCRIPT RATHER THAN AN INSTRUCTION
 * ============================================================================
 * STORY-31.1.03 anchored eleven documents and stamped every one of them with
 * `generated_at: <the moment of the stamp>`. Staleness fires only on an event dated AFTER that
 * moment, so the arm went structurally inert: `{current:11, flagged:0}` over a corpus whose
 * bodies were between two and ten weeks old. Re-run with the real body dates and the same
 * shipped `assessDoc()` returns `{current:1, flagged:10}`.
 *
 * The structural half is worse than the wrong census. Because the producer wrote `now` on every
 * run, ONE RE-RUN SILENCED EVERY STALENESS FLAG IN THE PROJECT — no reason, no actor, no record.
 * That is a blanket mute, strictly worse than the one BACKLOG-0147 Tranche B forbids in the
 * dismissal store, and it was reachable through the product's own advertised remediation.
 *
 * An instruction ("remember not to advance the clock") is not a fix for that; the instruction
 * was already there in spirit and the run did it anyway. So the rule lives in code, at the seam
 * that would violate it:
 *
 *   1. `generated_at` is the day the BODY was last authored — not the day the block was written.
 *   2. `body_sha` records what the body hashed to at that moment, so "the body did not change"
 *      is a fact this tool checks rather than a claim it makes.
 *   3. A first stamp has no previous hash, so the date comes from GIT — the newest commit whose
 *      body hash differs from its parent's. Inventing `now` there is the same defect on day one.
 *   4. Before writing, `wd.clockGate()` is applied. A clock that would advance without a body
 *      change ABORTS the run. A re-run therefore cannot lower the live-flag count.
 *
 * Usage:
 *   node wiki-anchor-stamp.js                          stamp every documentation/*.md
 *   node wiki-anchor-stamp.js <file> [<file> ...]      stamp only these
 *   node wiki-anchor-stamp.js --produced-by <value> <file> ...
 *                                                      also record who writes those files
 *                                                      (`/tandem:<skill>` or `hand`)
 *   --check      report what would change and exit 1 if anything would; write nothing
 *
 * Exit 0 = done (or nothing to do), 1 = the gate refused / --check found work, 2 = usage.
 *
 * Node stdlib only.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const wd = require('./lib/wiki-drift.js');

// WIKI_STAMP_ROOT drives this script over a DIFFERENT repository — the same idiom
// generate-dashboard.js exposes as PM_DASH_ROOT, and for the same reason. The clock gate is
// the whole point of this file, so it has to be provable by RUNNING it against a corpus a test
// controls; a gate asserted only by reading the source is the shape MAJOR-1 was filed for.
const REPO_ROOT = path.resolve(process.env.WIKI_STAMP_ROOT || path.resolve(__dirname, '..', '..'));
const DOC_DIR = path.join(REPO_ROOT, 'documentation');

/**
 * The opener, with the SAME leading-whitespace tolerance the parser has
 * (BUG-20260826-12).
 *
 * `lib/wiki-drift.js`'s `parseAnchorBlock()` tests its patterns against
 * `lines[i].trim()`, so an INDENTED `<!-- tandem:anchors v1` opens a block for the
 * reader, the board and every drift verdict. This pattern was line-anchored with
 * no such tolerance, so the same document took the "no block here" branch below
 * and got a SECOND anchor block appended to it. Two parsers, two answers, one
 * file — the shape this whole script exists to prevent one level up.
 */
const OPEN_RE = /^[ \t]*<!--\s*tandem:anchors\s+v(\d+)[ \t]*\r?$/m;

/** The closer, likewise. `parseAnchorBlock` accepts `  -->  `; so must the splice. */
const CLOSE_RE = /\r?\n[ \t]*-->[ \t]*(?=\r?\n|$)/;

function rel(p) {
  return path.relative(REPO_ROOT, p).replace(/\\/g, '/');
}

function git(args) {
  const r = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: String(r.stdout || ''), err: String(r.stderr || '') };
}

/**
 * When this file's BODY last changed, as an ISO date with offset.
 *
 * Walks the file's history newest-first and stops at the first commit whose body hash differs
 * from its parent's. `git log -1` alone would be wrong here in exactly the way that caused the
 * defect: the newest commit touching these files is the one that ADDED THE ANCHOR BLOCK, which
 * is not a body change at all — `bodyHash()` strips HTML comments, so the two hash the same.
 */
function lastBodyChange(fileRel, worktreeBody) {
  const log = git(['log', '--format=%cI', '--', fileRel]);
  if (!log.ok) return { when: '', why: 'git log failed: ' + log.err.trim() };
  const revs = git(['log', '--format=%H', '--', fileRel]).out.split('\n').map((x) => x.trim()).filter(Boolean);
  const dates = log.out.split('\n').map((x) => x.trim()).filter(Boolean);
  if (!revs.length) return { when: '', why: 'the file has no git history' };

  const shaAt = (rev) => {
    const show = git(['show', rev + ':' + fileRel]);
    return show.ok ? wd.bodyHash(show.out) : null;
  };

  // The working tree first: if it already differs from HEAD, the body changed in this session.
  const headSha = shaAt(revs[0]);
  if (headSha !== null && wd.bodyHash(worktreeBody) !== headSha) {
    return { when: new Date().toISOString(), why: 'the working tree body differs from HEAD' };
  }

  let cur = headSha;
  for (let i = 0; i < revs.length; i++) {
    const prev = i + 1 < revs.length ? shaAt(revs[i + 1]) : null;
    if (cur !== prev) return { when: dates[i], why: 'body changed in ' + revs[i].slice(0, 8) };
    cur = prev;
  }
  return { when: dates[dates.length - 1], why: 'body unchanged since the file was added' };
}

/**
 * The separator a document already uses (BUG-20260826-10).
 *
 * `main()` decides whether anything changed with a whole-file identity test
 * (`out === src`), so a block rendered with a separator the file does not use can
 * never be identical to the block already in it — even when every value inside is
 * the same. On a CRLF checkout that made `--check` report all eleven documents as
 * needing a re-stamp, forever, while every one of them reported its date as
 * UNCHANGED; and it made a real run rewrite the whole corpus to convert line
 * endings, which is a diff that changes no meaning and that a reviewer has to read
 * anyway.
 *
 * Dominant rather than first-seen: a file with one stray `\r\n` in it should not
 * have every other line rewritten to match the stray. A TIE goes to LF — stated
 * here rather than left to be inferred from `>`, because on a genuinely half-and-half
 * file the choice is arbitrary and a reader should not have to derive it. It
 * converges: choosing LF can only lower the CRLF count, never raise it, so a
 * re-run never oscillates.
 */
function eolOf(text) {
  const src = String(text);
  const crlf = (src.match(/\r\n/g) || []).length;
  const lf = (src.match(/\n/g) || []).length - crlf;
  return crlf > lf ? '\r\n' : '\n';
}

/**
 * Render the anchor block for a document, meta keys first, anchors in declared
 * order, separated the way the document already separates its lines.
 */
function renderBlock(meta, anchors, eol) {
  const nl = eol || '\n';
  const lines = ['<!-- tandem:anchors v' + wd.ANCHOR_SCHEMA_VERSION];
  if (meta.generatedAt) lines.push('generated_at: ' + meta.generatedAt);
  if (meta.producedBy) lines.push('produced_by: ' + meta.producedBy);
  if (meta.bodySha) lines.push('body_sha: ' + meta.bodySha);
  for (const a of anchors) lines.push(a.kind + ': ' + a.value);
  lines.push('-->');
  return lines.join(nl) + nl;
}

/**
 * Replace the existing block (or append one) — everything outside it is untouched.
 *
 * Returns `null` when the block cannot be spliced safely. `null` means REFUSE, and
 * the caller must treat it that way; there is deliberately no "best effort" return.
 *
 * "UNTOUCHED" IS NOW TRUE, AND IT WAS NOT. THREE ways the old splice edited text
 * outside the block, two of them silent data loss:
 *
 *   1. (BUG-20260826-10) It stripped EVERY newline following the block, while
 *      `renderBlock()` supplies exactly one of its own. A document whose block is
 *      followed by a blank line lost that line on every run — 10 of this repo's 11
 *      documents, on LF and CRLF alike, and why `--check` could never answer
 *      "nothing would change".
 *   2. (BUG-20260826-10) The terminator search was `indexOf('\n-->')` and the strip
 *      was `/^\n+/`. `indexOf` found the LF exactly; what leaked is that the slice
 *      then STARTED with the `\r`, which `/^\n+/` will not strip — so a CRLF file
 *      came back as `-->\n` followed by an orphaned `\r`. (An earlier note here said
 *      "the search landed one byte late". That is not what happened, and the wrong
 *      mechanism is what a future reader would reason from.)
 *   3. (BUG-20260826-12, the independent review's blocker) `parseAnchorBlock()`
 *      matches its patterns against a TRIMMED line, so `  -->` closes a block for
 *      every reader of the corpus. This search did not, so on such a file the
 *      closer was not found and the old code returned `src.slice(0, start) + block`
 *      — DELETING THE ENTIRE REST OF THE FILE, in place, from a command an operator
 *      is told to run. The mirror case (an indented OPENER) appended a second anchor
 *      block to a file that already had one.
 *
 * So: both patterns now carry the parser's tolerance, exactly ONE newline is
 * consumed (the one the block's own trailing newline replaces), and an
 * unterminated block REFUSES instead of truncating.
 */
function withBlock(text, meta, anchors) {
  const src = String(text);
  // ONE derivation of the separator, here, where the splice happens — rather than
  // one here and one at the call site, which is two spellings of one fact and a
  // way for a caller to render a block with an ending the splice did not expect.
  const nl = eolOf(src);
  const block = renderBlock(meta, anchors, nl);
  const m = OPEN_RE.exec(src);
  if (!m) return src.replace(/\s*$/, '') + nl + nl + block;
  const start = m.index;
  // Searched from the OPENER, never from byte 0.
  const closer = CLOSE_RE.exec(src.slice(start));
  if (!closer) return null;
  const after = start + closer.index + closer[0].length;
  return src.slice(0, start) + block + src.slice(after).replace(/^\r?\n/, '');
}

function usage(msg) {
  console.error('usage: node wiki-anchor-stamp.js [--check] [--produced-by <value>] [<file> ...]');
  if (msg) console.error(msg);
  return 2;
}

function main(argv) {
  let check = false;
  let producedBy = '';
  const files = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') { check = true; continue; }
    if (a === '--produced-by') {
      const v = argv[++i];
      if (v === undefined || String(v).indexOf('--') === 0) return usage('--produced-by requires a value');
      producedBy = String(v).trim();
      continue;
    }
    // BACKLOG-0136: an argument this script does not understand is exit 2, never ignored.
    if (a.indexOf('-') === 0) return usage('unknown option: ' + a);
    files.push(a);
  }
  if (producedBy && producedBy.indexOf('/') !== 0 && producedBy !== wd.PRODUCED_BY_HAND) {
    return usage(`--produced-by must be a slash command (e.g. /tandem:document) or "${wd.PRODUCED_BY_HAND}"`);
  }

  let targets;
  if (files.length) {
    targets = files.map((f) => path.resolve(REPO_ROOT, f));
  } else {
    if (producedBy) return usage('--produced-by needs the files it applies to; refusing to stamp the whole corpus with one producer');
    let names = [];
    try { names = fs.readdirSync(DOC_DIR).filter((n) => /\.md$/i.test(n)).sort(); }
    catch (e) { console.error('no documentation/ folder at ' + rel(DOC_DIR)); return 2; }
    targets = names.map((n) => path.join(DOC_DIR, n));
  }
  if (!targets.length) { console.log('wiki-anchor-stamp: no documents to stamp.'); return 0; }

  let changed = 0;
  let refused = 0;

  for (const abs of targets) {
    let src;
    try { src = fs.readFileSync(abs, 'utf8'); } catch (e) {
      console.error(`  REFUSED  ${rel(abs)} — unreadable: ${e.message}`);
      refused++;
      continue;
    }
    const parsed = wd.parseAnchorBlock(src);
    if (!parsed.present) {
      console.error(`  REFUSED  ${rel(abs)} — no anchor block. This tool re-derives a clock; it `
        + 'does not invent anchors. Author the block first (skills/document/SKILL.md).');
      refused++;
      continue;
    }
    // ---- NOTHING IS REWRITTEN OVER A BLOCK THE PARSER COULD NOT READ IN FULL ----
    // `renderBlock()` writes `parsed.anchors` and nothing else, so a line the parser
    // could not classify — a typo'd kind, an empty value, an unterminated block —
    // would be DELETED by a re-stamp, silently, with the run reporting `stamped`.
    // That is the same class of loss as the truncating splice above, one field down.
    // The malformed lines are named, because "something is wrong in this file" is not
    // an actionable sentence (BUG-20260826-12).
    if (parsed.malformed.length) {
      console.error(`  REFUSED  ${rel(abs)} — ${parsed.malformed.length} line(s) in the anchor `
        + 'block cannot be read, and re-stamping writes only the lines that CAN be read, so those '
        + 'would be deleted: '
        + parsed.malformed.map(x => `line ${x.line}: ${x.why}`).join('; ')
        + '. Fix the block by hand first.');
      refused++;
      continue;
    }

    const before = { generatedAt: parsed.generatedAt, bodySha: parsed.bodySha };
    const authored = lastBodyChange(rel(abs), src);
    const next = wd.nextClock(before, src, authored.when);

    const gate = wd.clockGate(before, next);
    if (!gate.ok) {
      // THE GATE. Not a warning — the run stops, because the whole point is that this move must
      // not be reachable by re-running a command.
      console.error(`  REFUSED  ${rel(abs)} — ${gate.why}`);
      refused++;
      continue;
    }
    // ---- THE CLOCK MAY NOT SIT AHEAD OF THE BODY ---------------------------
    // clockGate() only sees an advance happening NOW. A clock already forged forward — by hand,
    // or by a producer that wrote `now` before this rule existed — is invisible to it: the body
    // hash still matches, so nextClock carries the forged date straight through and the tool
    // ratifies the mute it exists to prevent.
    //
    // Git is the second opinion, and it is the one the board cannot have (a board build must
    // not shell out). If the recorded clock is LATER than the day the body last changed, the
    // document is claiming to have been written after it was written. Refuse.
    if (next.generatedAt && authored.when
      && next.generatedAt.slice(0, 10) > authored.when.slice(0, 10)) {
      console.error(`  REFUSED  ${rel(abs)} — the anchor block claims generated_at `
        + `${next.generatedAt.slice(0, 10)} but this file's body last changed `
        + `${authored.when.slice(0, 10)} (${authored.why}). A clock ahead of its body silences `
        + 'every staleness flag on this document with no reason, no actor and no record. Fix the '
        + 'date, or change the body.');
      refused++;
      continue;
    }

    if (gate.unverifiable) {
      // The migration window. The gate cannot check this one, so the check that DOES apply is
      // stated out loud: the date came from the history, and here is the commit it came from.
      if (!authored.when) {
        console.error(`  REFUSED  ${rel(abs)} — no previous body_sha and no usable git history, `
          + 'so there is no honest date to write. Refusing to invent one.');
        refused++;
        continue;
      }
      console.log(`  note     ${rel(abs)} — first stamp; clock taken from history (${authored.why}), not from now`);
    }

    const meta = {
      generatedAt: next.generatedAt,
      producedBy: producedBy || parsed.producedBy,
      bodySha: next.bodySha,
    };
    // The block is separated the way THIS document separates its lines, so an
    // unchanged document is byte-identical and the `out === src` test below stays a
    // question about the CLOCK rather than about the platform (BUG-20260826-10).
    // `withBlock` returns null rather than truncating a file it cannot splice; a
    // null here is a REFUSAL, never a fall-through (BUG-20260826-12).
    const out = withBlock(src, meta, parsed.anchors);
    if (out === null) {
      console.error(`  REFUSED  ${rel(abs)} — the anchor block opens but its closing --> could not `
        + 'be located, so a splice would delete everything after the opener. Nothing was written.');
      refused++;
      continue;
    }
    if (out === src) {
      console.log(`  ok       ${rel(abs)} — clock ${meta.generatedAt.slice(0, 10)} (${next.why})`);
      continue;
    }
    changed++;
    const note = `${before.generatedAt.slice(0, 10) || '(none)'} -> ${meta.generatedAt.slice(0, 10)}`;
    console.log(`  ${check ? 'WOULD   ' : 'stamped '} ${rel(abs)} — ${note} · ${authored.why}`
      + (meta.producedBy ? ` · produced_by ${meta.producedBy}` : ''));
    if (!check) fs.writeFileSync(abs, out, 'utf8');
  }

  if (refused) {
    console.error(`\nwiki-anchor-stamp: ${refused} document(s) refused. Nothing about them was written.`);
    return 1;
  }
  if (check && changed) {
    console.error(`\nwiki-anchor-stamp --check: ${changed} document(s) would change.`);
    return 1;
  }
  console.log(`\nwiki-anchor-stamp: ${changed} document(s) ${check ? 'would be ' : ''}re-stamped, `
    + `${targets.length - changed} already honest.`);
  return 0;
}

if (require.main === module) process.exit(main(process.argv));
module.exports = { lastBodyChange, renderBlock, withBlock, eolOf, main };
