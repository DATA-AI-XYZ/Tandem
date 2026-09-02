'use strict';
/**
 * verify-stderr-rule.js — STORY-28.1.02. One definition of "this gated step throws away
 * the evidence of its own failure".
 *
 * Lives in `lib/` rather than inside the test because two things read it: the durable
 * guard (`tests/stderr-kept.test.js`) and the sweep that repaired the corpus. A guard and
 * a fixer that each carry their own copy of a heuristic drift apart, and the drift is
 * invisible — the fixer reports "clean" in terms nobody else is using.
 *
 * WHY NOT JUST BAN `2>&1`. Three shapes look alike and only the first is a defect:
 *
 *   npm test >/dev/null 2>&1 && node probe.js
 *       `npm test`'s exit code gates the rest of the line, and its failure text is the
 *       thing a red run needs. OFFENDER (BACKLOG-0137's recorded incident, exactly).
 *
 *   f=$(ls ADR-*x* 2>/dev/null | head -1) && test -f "$f"
 *       Inside a command substitution, on a discovery step. NOT an offender.
 *
 *   node scaffold.js --target "$S" >/dev/null 2>&1; test -f "$S/CLAUDE.md"
 *       On a set-up command; the segment's exit code is `test`'s. NOT an offender.
 *
 * So the question asked of each `&&`-separated segment is: does the command whose exit
 * status IS this segment's exit status send stderr to /dev/null? Quoted regions, `$( … )`
 * and `( … )` groups are masked before asking, so a redirect belonging to an inner script
 * is never mistaken for the segment's own.
 *
 * The final segment of a chain gates nothing. A discard there is permitted when it is
 * ANNOTATED — an unexplained suppression cannot be told from an accidental one, and the
 * annotation is what makes the intent reviewable. It never excuses a gated segment.
 *
 * Node stdlib only; no dependencies in either direction.
 */

// stderr going to the bit bucket, in the spellings this corpus uses (POSIX and Windows),
// plus the append (`2>>`) and close (`2>&-`) forms the review found missing (MINOR-9).
const DISCARDS_STDERR = /2>>?\s*(\/dev\/null|NUL)\b|>\s*(\/dev\/null|NUL)\s+2>&1|2>&1\s*>\s*(\/dev\/null|NUL)|2>&-/;

/**
 * Split shell text on the given top-level separators. Quoted regions, `$( … )` and `( … )`
 * groups are never split inside, so a `&&` in a `bash -c '…'` argument does not inflate
 * the segment count.
 */
function splitTopLevel(text, seps) {
  const parts = [];
  let cur = '';
  let quote = null;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { cur += c; if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; cur += c; continue; }
    if (c === '$' && text[i + 1] === '(') { depth += 1; cur += '$('; i += 1; continue; }
    if (c === '(') { depth += 1; cur += c; continue; }
    if (c === ')') { if (depth > 0) depth -= 1; cur += c; continue; }
    if (depth === 0) {
      if (seps.indexOf('&&') >= 0 && c === '&' && text[i + 1] === '&') { parts.push(cur); cur = ''; i += 1; continue; }
      if (seps.indexOf('||') >= 0 && c === '|' && text[i + 1] === '|') { parts.push(cur); cur = ''; i += 1; continue; }
      if (seps.indexOf('|') >= 0 && c === '|' && text[i + 1] !== '|' && text[i - 1] !== '|') { parts.push(cur); cur = ''; continue; }
      if (seps.indexOf(';') >= 0 && c === ';') { parts.push(cur); cur = ''; continue; }
    }
    cur += c;
  }
  parts.push(cur);
  return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Blank out quoted text and bracketed groups: what is left is this command's own words. */
function ownWords(text) {
  let out = '';
  let quote = null;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { out += ' '; if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; out += ' '; continue; }
    if (c === '$' && text[i + 1] === '(') { depth += 1; out += '  '; i += 1; continue; }
    if (c === '(') { depth += 1; out += ' '; continue; }
    if (c === ')') { if (depth > 0) depth -= 1; out += ' '; continue; }
    out += depth > 0 ? ' ' : c;
  }
  return out;
}

/** The command whose exit status IS this segment's exit status. */
function decisiveCommand(segment) {
  const subs = splitTopLevel(segment, [';', '||']);
  const last = subs.length ? subs[subs.length - 1] : segment;
  const stages = splitTopLevel(last, ['|']);
  return stages.length ? stages[stages.length - 1] : last;
}

/** Does this exact command send its stderr to /dev/null, in its own right? */
function discardsStderr(command) {
  return DISCARDS_STDERR.test(ownWords(String(command || '')));
}

/**
 * Offenders in one verify chain.
 * `annotated` permits a discard on the FINAL (non-gating) segment only.
 */
function scanVerify(verify, annotated) {
  const segments = splitTopLevel(String(verify || ''), ['&&']);
  const offenders = [];
  segments.forEach((segment, idx) => {
    const gated = idx < segments.length - 1;
    const decisive = decisiveCommand(segment);
    if (!discardsStderr(decisive)) return;
    if (!gated && annotated) return;
    offenders.push({
      index: idx,
      gated,
      command: decisive.trim(),
      why: gated
        ? 'this step gates the rest of the line, so its failure text is exactly what a red run '
          + 'needs and exactly what is being thrown away — drop the `2>&1` and keep `>/dev/null`'
        : 'the final step suppresses stderr with no annotation saying why; an unexplained '
          + 'suppression cannot be told from an accidental one',
    });
  });
  return { segments: segments.length, offenders };
}

/**
 * The repair, for the three shapes this corpus uses. Returns the command unchanged when it
 * does not know one, so a caller can refuse rather than guess.
 */
function repairCommand(command) {
  return String(command)
    .replace(/(>\s*(?:\/dev\/null|NUL))\s+2>&1/g, '$1')
    .replace(/\s*2>\s*(?:\/dev\/null|NUL)\b/g, '');
}

/** A chat's annotation, if it carries one. One non-empty sentence, and it is greppable. */
function annotationOf(chat) {
  const note = chat && chat.verify_stderr_suppression_note;
  return typeof note === 'string' && note.trim().length > 0;
}

/* ===========================================================================
 * Liveness is a property of a CHAT, not of a file (ADR-0165, review MAJOR-5)
 * ======================================================================== */

/**
 * Three states, not two. A chat is:
 *
 *   'live'      `executed === false` — it has not run yet, its verify line is an INSTRUCTION,
 *               so it is swept and enforced.
 *   'executed'  `executed === true` — a RECORD of a command that was already run. Rewriting it
 *               would falsify the record, so it is reported as history and left alone.
 *   'unknown'   the flag is missing or is not a boolean. NOT a third kind of record: it is a
 *               malformed one, and it must be LOUD.
 *
 * The first version of this rule asked the question of the whole SIDECAR
 * (`chats.some((c) => c.executed === false)`), and a file that is live overall contains
 * executed chats. The 2026-08-05 sweep rewrote two of them
 * (EXECUTION-STRATEGY-2026-06-01-02 CHAT-04 and CHAT-06) for exactly that reason.
 *
 * The second version collapsed 'unknown' into "not live", which is fail-closed for RECORD
 * PRESERVATION and fail-OPEN for ENFORCEMENT: a chat whose `executed` key was simply absent
 * left the scan set entirely, and the only trace was a line count one lower than before
 * (review NEW-1 — the planted BACKLOG-0137 offender went from exit 1 to exit 0 by deleting a
 * key). An undeclared record is not an exemption. `chatMustBeEnforced()` therefore covers
 * 'live' AND 'unknown', and callers are expected to report 'unknown' as a failure in its own
 * right — that combination is fail-closed in BOTH directions.
 */
function chatExecutionState(chat) {
  if (!chat || typeof chat !== 'object') return 'unknown';
  if (typeof chat.executed !== 'boolean') return 'unknown';
  return chat.executed ? 'executed' : 'live';
}

/** Has this chat definitely not run yet? */
function chatIsLive(chat) {
  return chatExecutionState(chat) === 'live';
}

/** Is this chat definitely a record of something already run? Only these are exempt. */
function chatIsRecord(chat) {
  return chatExecutionState(chat) === 'executed';
}

/**
 * Whose verify line the scan must read. Everything except a declared record — so an absent or
 * non-boolean `executed` is scanned, never skipped.
 */
function chatMustBeEnforced(chat) {
  return !chatIsRecord(chat);
}

/**
 * The chat a `.md` twin heading names, e.g. `### CHAT-04 · Tiered CLAUDE.md scaffolder …`.
 * Returns null for any other line.
 */
function chatIdOfHeading(line) {
  const m = /^#{1,6}\s.*?\b(CHAT-\d+)\b/.exec(String(line || ''));
  return m ? m[1] : null;
}

/**
 * Which chat owns each line of a `.md` twin — the nearest `CHAT-NN` heading above it.
 * Lines before the first chat heading belong to no chat and are returned as null, which
 * callers must treat as LIVE: exempting text that is not accounted for is how a record and
 * an instruction stop being distinguishable.
 */
function chatOwnerByLine(mdText) {
  const lines = String(mdText || '').split(/\r?\n/);
  const owners = new Array(lines.length).fill(null);
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const id = chatIdOfHeading(lines[i]);
    if (id) current = id;
    owners[i] = current;
  }
  return owners;
}

module.exports = {
  DISCARDS_STDERR, splitTopLevel, ownWords, decisiveCommand, discardsStderr,
  scanVerify, repairCommand, annotationOf,
  chatExecutionState, chatIsLive, chatIsRecord, chatMustBeEnforced,
  chatIdOfHeading, chatOwnerByLine,
};
