'use strict';
/**
 * wiki-drift.js — source anchors, and the two honest drift checks that read them
 * (STORY-31.1.02, closing BACKLOG-0156 Tranche B; schema and stance in ADR-0219).
 *
 * ============================================================================
 * WHY A DOC NEEDS ANCHORS AT ALL
 * ============================================================================
 * BACKLOG-0106 proved that shipped docs rot silently: `CONTRIBUTING.md` advertised a CI gate
 * this project has never had, `README.md` stated a version three releases behind, and
 * `CODEBASE-MAP.md` described a folder layout that had moved. Every one of those is a claim
 * ABOUT SOMETHING IN THE REPO — a workflow file, a manifest, a directory — and every one of
 * them could have been checked the moment it stopped being true.
 *
 * What made them uncheckable is that the claims are prose. "CI runs pm:lint on every push" is
 * a sentence; there is nothing in it a program can resolve. So `/tandem:document` now records,
 * per document, the ANCHORS its claims rest on: the files, scripts, board views, commands and
 * ADRs it is describing. Those are resolvable, and a resolution that fails is a fact rather
 * than an opinion.
 *
 * ============================================================================
 * PRECISION FIRST, AND WHY THE TWO CHECKS ARE NOT EQUALS
 * ============================================================================
 * BACKLOG-0156's own framing is that over-flagging is the design's central tension: a signal
 * the operator learns to ignore is worse than no signal. So the two checks are deliberately
 * unequal in the confidence they claim.
 *
 *   DEAD ANCHOR is near-zero-false-positive. A declared anchor either resolves against the
 *   live repo or it does not. The flag names the EXACT anchor string and what was tried.
 *
 *   STALENESS is a heuristic and says so in its own words — "possibly drifted since <event>".
 *   It never says a doc is wrong; it says a recorded event touched something the doc declares
 *   it is describing, after the doc was written. The event is NAMED, always. A bare verdict
 *   ("this doc may be stale") is exactly the noise that trains an operator to dismiss.
 *
 * ============================================================================
 * THE THIRD STATE (ADR-0134's stance)
 * ============================================================================
 * A doc with NO anchor block is not green. It is UNASSESSABLE, and it says so, with the
 * command that fixes it. Rendering "no flags" over a document nothing has checked is the
 * silent-green failure this whole epic is a response to.
 *
 * ============================================================================
 * WHERE THE "DECLARED AREA" COMES FROM — AND WHERE IT DOES NOT
 * ============================================================================
 * From the anchor block. Only. The staleness arm matches an event to a document by looking for
 * the document's OWN DECLARED ANCHOR STRINGS in the event's text. There is no topic inference,
 * no keyword overlap, no similarity score: a reviewer who finds inference beyond the anchors
 * has found a defect, and the story says so.
 *
 * Node stdlib only.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createDismissalStore, actorOf, ACTOR_NOT_RECORDED } = require('./dismissal-store.js');

/* ============================================================
 * The anchor block
 * ============================================================ */

/**
 * The block is an HTML COMMENT, and that is a decision rather than a formatting whim.
 *
 *   - It is invisible in every renderer the kit has. `mdToHtml` strips HTML comments
 *     (STORY-21.5.02), so the board and `pm:docs` — which share that parser since ADR-0205 —
 *     both drop it. A reader never sees machinery.
 *   - It is not frontmatter. Frontmatter on a documentation file would change what
 *     `generate-docs.js` renders and what every other reader of these files expects.
 *   - It is line-oriented and flat, so parsing it needs no YAML and a malformed line is
 *     REPORTED rather than thrown on.
 *
 * Shape:
 *
 *     <!-- tandem:anchors v1
 *     generated_at: 2026-08-18T20:00:00+01:00
 *     file: _00-Project-Management/93-Scripts/generate-dashboard.js
 *     script: pm:dash
 *     view: wiki
 *     command: /tandem:document
 *     adr: ADR-0218
 *     -->
 */
const ANCHOR_OPEN_RE = /^<!--\s*tandem:anchors\s+v(\d+)\s*$/;
const ANCHOR_CLOSE_RE = /^-->\s*$/;
const ANCHOR_LINE_RE = /^([a-z_]+):\s*(.*)$/;

/** The schema version this reader understands. */
const ANCHOR_SCHEMA_VERSION = 1;

/**
 * The anchor kinds, each with how it resolves. THE LIST IS THE SCHEMA — a kind not named here
 * is a malformed line, reported, never silently ignored (an ignored kind is an anchor that
 * looks declared and is checked by nothing).
 */
const ANCHOR_KINDS = Object.freeze(['file', 'script', 'view', 'command', 'adr']);

/**
 * Keys that carry metadata rather than an anchor.
 *
 * `produced_by` (ADR-0220) — WHO writes this document. A board that prints one producer over
 * every article states a falsehood on every article the producer does not write, and offers a
 * remediation that will not touch them. The claim is therefore made BY THE DOCUMENT or not at
 * all: `/tandem:document` for a document that skill authors, `hand` for one a person maintains.
 * A document that records neither gets neither claim — "not recorded" is the honest third answer.
 *
 * `body_sha` (ADR-0220) — the hash of the BODY at the moment `generated_at` was written. It is
 * what makes "the body did not change" a fact rather than a guess, and it is the whole of the
 * defence against a re-stamp silently muting every staleness flag in the project.
 */
const ANCHOR_META_KEYS = Object.freeze(['generated_at', 'produced_by', 'body_sha']);

/** The value `produced_by` takes for a document no command in the kit writes. */
const PRODUCED_BY_HAND = 'hand';

/**
 * Parse one document's anchor block. NEVER THROWS.
 *
 * @returns {{present, version, generatedAt, anchors: {kind,value,line}[], malformed: {line,text,why}[]}}
 */
function parseAnchorBlock(text) {
  const out = {
    present: false, version: 0, generatedAt: '', producedBy: '', bodySha: '',
    anchors: [], malformed: [],
  };
  const lines = String(text || '').split(/\r?\n/);
  let open = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!open) {
      const m = ANCHOR_OPEN_RE.exec(raw);
      if (!m) continue;
      open = true;
      out.present = true;
      out.version = Number(m[1]);
      continue;
    }
    if (ANCHOR_CLOSE_RE.test(raw)) { open = false; break; }
    if (raw === '') continue;
    const kv = ANCHOR_LINE_RE.exec(raw);
    if (!kv) {
      out.malformed.push({ line: i + 1, text: raw, why: 'not a `<kind>: <value>` line' });
      continue;
    }
    const kind = kv[1];
    const value = kv[2].trim();
    if (ANCHOR_META_KEYS.indexOf(kind) !== -1) {
      if (kind === 'generated_at') out.generatedAt = value;
      else if (kind === 'produced_by') out.producedBy = value;
      else if (kind === 'body_sha') out.bodySha = value;
      continue;
    }
    if (ANCHOR_KINDS.indexOf(kind) === -1) {
      out.malformed.push({ line: i + 1, text: raw, why: `"${kind}" is not one of ${ANCHOR_KINDS.join(', ')}` });
      continue;
    }
    if (value === '') {
      out.malformed.push({ line: i + 1, text: raw, why: `"${kind}" has no value` });
      continue;
    }
    out.anchors.push({ kind, value, line: i + 1 });
  }
  // An unterminated block is malformed, not absent — the difference matters, because absent
  // means "the skill has not run here" and unterminated means "it ran and something ate the
  // close", which are different things to tell an operator.
  if (open) out.malformed.push({ line: lines.length, text: '', why: 'the anchor block is never closed with -->' });
  return out;
}

/* ============================================================
 * The body, its hash, and the staleness clock (ADR-0220)
 * ============================================================ */

/**
 * The document as a READER sees it: every HTML comment removed, line endings normalised,
 * trailing whitespace dropped. The anchor block is an HTML comment, so this strips it too —
 * which is the point. Re-stamping the block must not look like editing the document.
 *
 * `mdToHtml` strips HTML comments as well (STORY-21.5.02), so this is the same text the board
 * renders, not a second notion of "the body" that agrees today.
 */
function strippedBody(text) {
  const NL = String.fromCharCode(10);
  return String(text || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join(NL)
    .replace(/\n{3,}/g, NL + NL)
    .trim();
}

/** The hash recorded beside `generated_at`. Short enough to read in a diff, long enough to trust. */
function bodyHash(text) {
  return crypto.createHash('sha256').update(strippedBody(text), 'utf8').digest('hex').slice(0, 16);
}

/**
 * THE CLOCK RULE — the half of ADR-0220 that stops a re-run from muting the project.
 *
 * `generated_at` is the day the document's BODY was last authored. It is NOT the day the
 * anchor block was last written, and the difference is not pedantry: STORY-31.1.03 stamped
 * eleven documents with the moment of the stamp, and because staleness fires only on events
 * DATED AFTER that moment, the whole arm went structurally inert — `{flagged:0}` over a corpus
 * whose bodies were between two and ten weeks old. Worse, the same move is available on every
 * future run: re-stamp, and every staleness flag in the project disappears with no reason, no
 * actor and no record. That is a blanket mute, and a blanket mute is the exact thing
 * BACKLOG-0147 Tranche B forbids in the dismissal store — reached here through the product's
 * own advertised remediation.
 *
 * So the clock only moves when the body moves, and `body_sha` is what makes "the body did not
 * move" a fact. A first stamp has no previous hash to compare against, so the caller must
 * supply when the body was actually last authored (the stamper reads it from git); inventing
 * `now` there is the same defect on day one.
 *
 * @returns {{generatedAt, bodySha, moved, why}}
 */
function nextClock(prev, body, authoredAt) {
  const p = prev || {};
  const sha = bodyHash(body);
  if (p.generatedAt && p.bodySha && p.bodySha === sha) {
    return {
      generatedAt: p.generatedAt, bodySha: sha, moved: false,
      why: 'the body is byte-identical to the one this block was written against, so the '
        + 'staleness clock does not move',
    };
  }
  const when = String(authoredAt || '').trim();
  if (!when) {
    return {
      generatedAt: p.generatedAt || '', bodySha: sha, moved: false,
      why: 'the body changed (or was never hashed) but no authored date was supplied, so the '
        + 'clock cannot be set honestly — refusing to invent one',
    };
  }
  return {
    generatedAt: when, bodySha: sha, moved: true,
    why: p.bodySha ? 'the body changed since this block was written' : 'first stamp',
  };
}

/**
 * THE GATE. A re-run may not advance the clock without a body change — which is the same thing
 * as saying it may not lower the live-flag count without one, because the only flag a clock
 * advance can clear is a staleness flag.
 *
 * Called by the stamper before it writes, and driven directly by the test, so the invariant is
 * checked at the seam that would violate it rather than asserted about it.
 */
function clockGate(before, after) {
  const b = before || {}; const a = after || {};
  if (!b.generatedAt || !a.generatedAt) return { ok: true, why: 'nothing to compare' };
  if (String(a.generatedAt) <= String(b.generatedAt)) return { ok: true, why: 'the clock did not advance' };
  if (b.bodySha && a.bodySha && b.bodySha !== a.bodySha) {
    return { ok: true, why: 'the clock advanced and the body hash changed with it' };
  }
  if (!b.bodySha) {
    // THE MIGRATION WINDOW, named rather than hidden. A block written before `body_sha` existed
    // carries no hash, so this function can neither prove nor disprove a body change and must
    // not pretend to. It is the CALLER's job to source the new date from the history rather
    // than from the clock — which is what wiki-anchor-stamp.js does, and is the whole reason
    // the first stamp is a script with git behind it instead of a producer writing `now`.
    // Every stamp writes a hash, so this window closes permanently after one pass.
    return {
      ok: true,
      unverifiable: true,
      why: `the previous block recorded no body_sha, so a body change cannot be proved here — `
        + `the new date (${a.generatedAt}) must come from the file's history, not from now`,
    };
  }
  return {
    ok: false,
    why: `the staleness clock advanced from ${b.generatedAt} to ${a.generatedAt} with no body `
      + `change (body_sha ${b.bodySha || '(none)'} -> ${a.bodySha || '(none)'}). That silences `
      + 'every staleness flag on this document with no reason, no actor and no record.',
  };
}

/* ============================================================
 * Resolution — what makes an anchor live or dead
 * ============================================================ */

function existsPath(p) {
  try { fs.statSync(p); return true; } catch { return false; }
}

/**
 * Build the resolution context ONCE per board build. Reading package.json and the rail
 * vocabulary per anchor would re-read the same two files a few hundred times.
 *
 * `views` is passed IN rather than required here, because the rail lives in
 * generate-dashboard.js and requiring that module from a lib it imports would be a cycle.
 */
function buildResolveContext(repoRoot, opts) {
  const o = opts || {};
  let scripts = [];
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    scripts = Object.keys((pkg && pkg.scripts) || {});
  } catch { scripts = []; }
  return {
    repoRoot,
    scripts,
    views: Array.isArray(o.views) ? o.views : [],
    skillsDir: o.skillsDir || path.join(repoRoot, 'skills'),
    adrDir: o.adrDir || path.join(repoRoot, '_00-Project-Management', '40-Decisions'),
  };
}

/**
 * Does one anchor resolve? Returns `{ ok, tried }` — `tried` is what a reader needs in order
 * to fix it, and is the half a bare "does not resolve" leaves out.
 *
 * NEVER THROWS.
 */
function resolveAnchor(anchor, ctx) {
  const value = String((anchor && anchor.value) || '');
  try {
    switch (anchor.kind) {
      case 'file': {
        const abs = path.resolve(ctx.repoRoot, value);
        return { ok: existsPath(abs), tried: path.relative(ctx.repoRoot, abs).replace(/\\/g, '/') };
      }
      case 'script': {
        // An npm script name (`pm:dash`), written with or without the `npm run` prefix.
        const name = value.replace(/^npm\s+run\s+/, '').trim();
        return { ok: ctx.scripts.indexOf(name) !== -1, tried: `package.json scripts["${name}"]` };
      }
      case 'view': {
        // A rail group key, or `group:sub`. The vocabulary is the board's own RAIL_GROUPS /
        // SUB_NAV_GROUPS, handed in — never a list retyped here.
        return { ok: ctx.views.indexOf(value) !== -1, tried: `the board's view vocabulary (${ctx.views.length} keys)` };
      }
      case 'command': {
        // `/tandem:document` or `document` — the skill folder is the resolution.
        const name = value.replace(/^\//, '').replace(/^[a-z0-9-]+:/i, '').trim();
        const abs = path.join(ctx.skillsDir, name, 'SKILL.md');
        return { ok: existsPath(abs), tried: path.relative(ctx.repoRoot, abs).replace(/\\/g, '/') };
      }
      case 'adr': {
        const id = value.trim();
        if (!/^ADR-\d{4}$/.test(id)) return { ok: false, tried: `an ADR id of the form ADR-NNNN (got "${id}")` };
        let hit = false;
        try {
          hit = fs.readdirSync(ctx.adrDir).some((n) => n.indexOf(id + '-') === 0 || n === id + '.md');
        } catch { hit = false; }
        return { ok: hit, tried: `40-Decisions/${id}-*.md` };
      }
      default:
        return { ok: false, tried: `unknown anchor kind "${anchor.kind}"` };
    }
  } catch (_e) {
    return { ok: false, tried: 'resolution threw' };
  }
}

/* ============================================================
 * Events — what staleness is measured against
 * ============================================================ */

/** ISO-ish date out of frontmatter, or out of a trailing `-YYYY-MM-DD` in a filename. */
function eventDate(text, fileName) {
  const fm = /^(?:completed_at|created_at):\s*'?([0-9]{4}-[0-9]{2}-[0-9]{2}[^'\s]*)'?\s*$/m;
  const lines = String(text || '').split(/\r?\n/).slice(0, 40).join('\n');
  const m = fm.exec(lines);
  if (m) return m[1];
  const fn = /(\d{4}-\d{2}-\d{2})(?:\.[a-z]+)?$/.exec(String(fileName || '').replace(/\.md$/i, ''));
  return fn ? fn[1] : '';
}

/**
 * The recorded events a doc can have drifted since: ADRs, releases and phase closes — the
 * three the story names, and no others. Each carries its id, its date and its TEXT, because
 * matching is on the doc's declared anchor strings appearing in that text.
 *
 * NEVER THROWS; an unreadable folder contributes nothing.
 */
function collectEvents(pmRoot) {
  const events = [];
  const add = (kind, dir, idOf) => {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const n of names) {
      if (!/\.md$/i.test(n)) continue;
      let text = '';
      try { text = fs.readFileSync(path.join(dir, n), 'utf8'); } catch { continue; }
      const when = eventDate(text, n);
      if (!when) continue;
      events.push({ kind, id: idOf(n), when, text, file: n });
    }
  };
  add('adr', path.join(pmRoot, '40-Decisions'), (n) => (/^(ADR-\d{4})/.exec(n) || [, n])[1]);
  add('release', path.join(pmRoot, '13-Releases'), (n) => n.replace(/\.md$/i, ''));
  add('phase-close', path.join(pmRoot, '41-Reports', 'phases'), (n) => n.replace(/\.md$/i, ''));
  return events;
}

/* ============================================================
 * The two checks
 * ============================================================ */

/** A day-comparable key. Both sides are ISO-8601, so a lexical compare on the date is correct. */
function dayOf(iso) {
  return String(iso || '').slice(0, 10);
}

/**
 * The strings the staleness arm looks for in an event's text, per anchor kind — and the
 * BOUNDARY each is required to sit inside.
 *
 * ADR-0219 asserted that four of the five kinds were "already distinctive" because they carry
 * a separator. MEASURED against the live 275-event corpus, that was wrong for two of them:
 *
 *     script: pm:lint   matched  93/275  (34%)
 *     file:   skills    matched  80/275  (29%)
 *
 * `pm:lint` is named in prose by a third of every ADR, release note and phase report in the
 * tree, because "run pm:lint before you push" is a sentence this project writes constantly. It
 * is a WORD here, not an address. And `skills` has no separator at all — it is an ordinary
 * English noun this repo uses on nearly every page. Either one would flag several documents
 * that never changed the moment the next ADR lands, blowing ADR-0219's own ">a third of raised
 * flags dismissed" review trigger on day one. See ADR-0221.
 *
 * So each kind now matches on the form in which it is ADDRESSED rather than mentioned:
 *
 *   view     `group=<key>`                     (ADR-0219's original narrowing, unchanged)
 *   script   `npm run <name>` or the name quoted/backticked — i.e. someone writing the script
 *            as a thing you invoke, not as a topic they mention in passing
 *   file     the path, with a word boundary on each side, so a short anchor cannot match
 *            inside a longer identifier. A trailing `/` still matches: a change to
 *            `40-Decisions/ADR-0219-x.md` IS a change inside `40-Decisions`.
 *   command  the slash command with a right boundary, so `/tandem:document` does not match
 *            `/tandem:document-html`
 *   adr      the id with a boundary on each side, EXCLUDING the markdown-link citation form
 *            `[ADR-XXXX](…)`. An id used as link TEXT is this repo's cross-reference — a reader
 *            aid, not the event addressing the decision. Measured (BUG-20260902-01): the
 *            2026-08-19 ADR sweep stamped the same "…under the install contract of
 *            [ADR-0226](…)" sentence across 27 historical board ADRs, pushing `adr: ADR-0226`
 *            to 47/376 (13%); excluding the link-text form cuts it to 18/376 (5%) while keeping
 *            every addressing event — `supersedes:` frontmatter, `ADR-0226 §N` re-derivations
 *            and related-ADR lists all name the id in plain text.
 *
 * A bare-word `file:` anchor (no `/`, no `.`) is additionally reported as IMPRECISE — see
 * assessDoc — because no boundary rule can rescue an anchor whose value is an English word.
 * The fix for those is to anchor the specific path the document actually asserts.
 */
const WORDISH = /[A-Za-z0-9_-]/;

/** Does `needle` occur in `hay` with a word boundary on each requested side? */
function boundedIndexOf(hay, needle, opts) {
  const o = opts || {};
  if (!needle) return -1;
  let from = 0;
  for (;;) {
    const i = hay.indexOf(needle, from);
    if (i === -1) return -1;
    const before = i > 0 ? hay.charAt(i - 1) : '';
    const after = hay.charAt(i + needle.length);
    const leftOk = !o.left || before === '' || !WORDISH.test(before);
    const rightOk = !o.right || after === '' || !WORDISH.test(after);
    // `notLinkText`: an occurrence that IS the text of a markdown link — `[needle](…` — is a
    // hyperlinked citation, not an address, and does not count (BUG-20260902-01). Only the
    // exact `[needle](` shape is excluded; a bracketed mention with no target still matches.
    const isLinkText = !!o.notLinkText && before === '['
      && hay.slice(i + needle.length, i + needle.length + 2) === '](';
    if (leftOk && rightOk && !isLinkText) return i;
    from = i + 1;
  }
}

/**
 * The needle FORMS for an anchor — the alternatives any one of which counts as a match. The
 * first is the canonical one, used when the evidence line has to name what was looked for.
 */
function stalenessNeedles(anchor) {
  const v = String((anchor && anchor.value) || '');
  switch (anchor && anchor.kind) {
    case 'view': return ['group=' + v];
    case 'script': {
      // `npm run <name>` (an invocation) or `"<name>"` (the package.json form). NOT the
      // backticked form: measured on the live corpus, allowing `` `pm:lint` `` keeps the hit
      // rate at 75/275 (27%) because this repo writes "run `pm:lint` before you push" on
      // nearly every page — that is the script MENTIONED, not the script CHANGED. The two
      // forms below cut it to 20/275 (7%).
      const name = v.replace(/^npm\s+run\s+/, '').trim();
      return ['npm run ' + name, '"' + name + '"'];
    }
    default: return [v];
  }
}

/** Back-compat: the canonical needle, for messages. Matching goes through anchorMatchesEvent. */
function stalenessNeedle(anchor) {
  return stalenessNeedles(anchor)[0];
}

/** Does this event's text NAME this anchor, in the addressed form its kind requires? */
function anchorMatchesEvent(anchor, eventText) {
  const hay = String(eventText || '');
  const kind = anchor && anchor.kind;
  // `script` alternatives already carry their own delimiters; a boundary on top would reject
  // `npm run pm:lint` followed by a backtick. `view` carries `group=`, likewise delimited.
  // `adr` additionally refuses the markdown-link citation form (see the kinds table above).
  const bounds = (kind === 'script' || kind === 'view')
    ? { left: false, right: false }
    : { left: true, right: true, notLinkText: kind === 'adr' };
  for (const n of stalenessNeedles(anchor)) {
    if (boundedIndexOf(hay, n, bounds) !== -1) return true;
  }
  return false;
}

/** A `file:` anchor that is an ordinary word rather than a path — no `/` and no `.` in it. */
function isBareWordFileAnchor(anchor) {
  return !!anchor && anchor.kind === 'file'
    && String(anchor.value).indexOf('/') === -1
    && String(anchor.value).indexOf('.') === -1;
}

/**
 * Assess ONE document.
 *
 * @param {{name, file, text}} doc   the document's name, repo-relative path, and raw markdown
 * @param {object} ctx               from buildResolveContext()
 * @param {object[]} events          from collectEvents()
 * @returns {{state, anchors, flags, malformed}}
 *          state is 'unassessable' | 'flagged' | 'current' — never a silent green.
 */
function assessDoc(doc, ctx, events) {
  const parsed = parseAnchorBlock(doc.text);
  const flags = [];

  if (!parsed.present) {
    return {
      state: 'unassessable',
      anchors: [],
      malformed: parsed.malformed,
      generatedAt: '',
      flags: [{
        kind: 'unassessable',
        evidence: 'this document carries no source-anchor block, so neither drift check can '
          + 'read it — it is not being checked, which is a different thing from being current',
      }],
      producedBy: '',
      bodySha: '',
    };
  }

  if (parsed.version !== ANCHOR_SCHEMA_VERSION) {
    flags.push({
      kind: 'anchor-schema',
      evidence: `the anchor block declares schema v${parsed.version}; this build reads `
        + `v${ANCHOR_SCHEMA_VERSION}`,
    });
  }
  for (const bad of parsed.malformed) {
    flags.push({
      kind: 'anchor-malformed',
      evidence: `anchor block line ${bad.line}: ${bad.why}`
        + (bad.text ? ` — "${bad.text}"` : ''),
    });
  }

  // ---- dead anchors ---------------------------------------------------------
  for (const a of parsed.anchors) {
    const r = resolveAnchor(a, ctx);
    if (r.ok) continue;
    flags.push({
      kind: 'dead-anchor',
      anchor: a.value,
      anchorKind: a.kind,
      // The EXACT anchor string and what resolution was attempted. A flag that says only
      // "an anchor is dead" makes the reader do the search the checker already did.
      evidence: `the ${a.kind} anchor \`${a.value}\` no longer resolves (tried ${r.tried})`,
    });
  }

  // ---- imprecise anchors (ADR-0221) -----------------------------------------
  // A `file:` anchor with no separator in it is an English word, and the staleness arm will
  // match it against every event that happens to use that word. `file: skills` measured
  // 80/275 events on the live corpus. No boundary rule rescues that; the anchor has to name
  // the path the document actually asserts.
  for (const a of parsed.anchors) {
    if (!isBareWordFileAnchor(a)) continue;
    flags.push({
      kind: 'anchor-imprecise',
      anchor: a.value,
      anchorKind: a.kind,
      evidence: `the file anchor \`${a.value}\` is a bare word rather than a path, so the `
        + 'staleness arm will match it against every event that merely uses that word — anchor '
        + 'the specific file or directory path this document asserts instead',
    });
  }

  // ---- the staleness clock's own integrity (ADR-0220) -----------------------
  // `generated_at` claims to be the day this document's BODY was authored, and `body_sha` is
  // what makes that claim checkable. A body that no longer hashes to the recorded value means
  // the text was edited without re-deriving the clock, so every staleness verdict below is
  // being measured against the wrong day.
  if (parsed.bodySha) {
    const actual = bodyHash(doc.text);
    if (actual !== parsed.bodySha) {
      flags.push({
        kind: 'anchor-clock',
        evidence: `the anchor block records \`body_sha: ${parsed.bodySha}\` but this document's `
          + `body hashes to \`${actual}\` — the text changed without \`generated_at\` being `
          + 're-derived, so staleness is being measured against the wrong day',
      });
    }
  }

  // ---- staleness vs events --------------------------------------------------
  // Matching is on the doc's OWN declared anchor strings appearing in the event's text. No
  // topic inference. An event with no anchor in common is not this doc's event.
  const generatedAt = parsed.generatedAt;
  if (!generatedAt) {
    flags.push({
      kind: 'anchor-malformed',
      evidence: 'the anchor block records no `generated_at:`, so staleness cannot be measured '
        + 'against anything — the dead-anchor check still applies',
    });
  } else {
    const docDay = dayOf(generatedAt);
    let newest = null;
    for (const ev of events) {
      if (dayOf(ev.when) <= docDay) continue;
      const hit = parsed.anchors.find((a) => anchorMatchesEvent(a, ev.text));
      if (!hit) continue;
      if (!newest || dayOf(ev.when) > dayOf(newest.when)) newest = { ev, anchor: hit };
    }
    if (newest) {
      flags.push({
        kind: 'staleness',
        event: newest.ev.id,
        anchor: newest.anchor.value,
        // "possibly", and the event NAMED. The check does not know the doc is wrong; it knows
        // something the doc declares it describes was touched after the doc was written.
        evidence: `possibly drifted since ${newest.ev.id} (${newest.ev.kind}, ${dayOf(newest.ev.when)}) `
          + `— it names this document's \`${newest.anchor.kind}\` anchor \`${newest.anchor.value}\`, `
          + `and this document was written ${docDay}`,
      });
    }
  }

  return {
    state: flags.length ? 'flagged' : 'current',
    anchors: parsed.anchors,
    malformed: parsed.malformed,
    generatedAt,
    // WHO writes this document, as the document itself records it — never a guess, and never a
    // project-wide default. An empty string means the block records nothing, which the board
    // renders as "provenance not recorded" rather than inventing a producer (ADR-0220).
    producedBy: parsed.producedBy,
    bodySha: parsed.bodySha,
    flags,
  };
}

/**
 * The evidence a dismissal is keyed to. A flag whose evidence changes — a different dead
 * anchor, a newer event — is NEW evidence and fires again, which is the whole of the
 * dismiss-with-reason contract's expiry rule (STORY-29.1.04 Tranche B).
 */
function flagVerdict(docSlug, flag) {
  return {
    doc: docSlug,
    flag_kind: flag.kind,
    anchor: flag.anchor || '',
    event: flag.event || '',
  };
}

/* ============================================================
 * The dismissal store — ONE contract, a second subject
 *
 * Not a second implementation. lib/dismissal-store.js holds the five decisions
 * STORY-29.1.04 got right (evidence-keyed, reason required, actor required, append-only,
 * never-throws-on-read); this is a configuration of it, exactly as the stale-run store now
 * is. AC-4 asks for one dismiss-with-reason contract and this is what makes that structural
 * rather than a claim two files happen to satisfy today. See ADR-0219.
 *
 * WHAT THE EVIDENCE IS. The document, the KIND of flag, and the specific thing that fired
 * it — the dead anchor string, or the event id. So dismissing "possibly drifted since
 * ADR-0140" does NOT silence "possibly drifted since ADR-0218" on the same document, and
 * dismissing one dead anchor does not silence the next one. That is the blanket-mute failure
 * BACKLOG-0147 Tranche B names, in this surface.
 * ============================================================ */

const DISMISSAL_FILE = 'WIKI-DRIFT-DISMISSALS.json';

const dismissals = createDismissalStore({
  fileName: DISMISSAL_FILE,
  storeVersion: 1,
  evidenceFields: ['doc', 'flag_kind', 'anchor', 'event'],
  subjectField: 'doc',
  subjectLabel: 'a document slug',
});
module.exports = {
  ANCHOR_SCHEMA_VERSION, ANCHOR_KINDS, ANCHOR_META_KEYS, PRODUCED_BY_HAND,
  parseAnchorBlock, buildResolveContext, resolveAnchor,
  collectEvents, eventDate, assessDoc, flagVerdict,
  stalenessNeedle, stalenessNeedles, anchorMatchesEvent, boundedIndexOf, isBareWordFileAnchor,
  strippedBody, bodyHash, nextClock, clockGate,
  DISMISSAL_FILE, dismissals, actorOf, ACTOR_NOT_RECORDED,
};
