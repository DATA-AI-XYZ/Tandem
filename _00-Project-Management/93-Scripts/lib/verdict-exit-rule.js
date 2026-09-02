'use strict';
/**
 * verdict-exit-rule.js — STORY-28.1.03, hardened by the E28 Phase-1 review
 * (AI-CODE-REVIEW-E28-CHAT-01-02, BLOCKER-1 / CRITICAL-2 / CRITICAL-3 / MAJOR-4;
 * BUG-20260805-07). One definition of "this check decides pass-or-fail and then exits 0
 * either way".
 *
 * BUG-20260803-02 found TESTPLAN-23.1.01 TC-02 in this shape:
 *
 *     node -e 'const bad = …; console.log(bad.length ? ("VIOLATION:" + list) : "OK");'
 *
 * The process exits 0 whichever branch runs. Everything downstream that gates on the exit
 * code — `run-testplan`, a chat verify line, `npm test` — sees unconditional green. That TC
 * had been inert for four epics.
 *
 * ---------------------------------------------------------------------------
 * WHY THE FIRST VERSION OF THIS RULE CERTIFIED A NO-OP AS FIXED
 *
 * The review proved three separate holes, all of which came from asking the question of the
 * WHOLE FENCED BLOCK instead of the command that actually decides anything:
 *
 *   1. `failPath()` was applied to the whole block, so ONE repaired command immunised every
 *      other command in the same fence. TESTPLAN-24.2.01 TC-02 was classified as an offender
 *      because of a `LINT-FAIL` string in a *different* command on a later line, and then
 *      classified as fixed because `process.exitCode=` appeared *somewhere* in the block.
 *   2. A block's exit status is its LAST command's status. A repaired `node -e` followed by
 *      `… || echo "LINT-FAIL"`, or captured in `$( )` with a trailing `echo`, or followed by
 *      an `if … fi` whose branches all `echo`, cannot report failure however honest the
 *      Node one-liner has become.
 *   3. The repair shim carried a HAND-WRITTEN copy of the failure vocabulary, which had
 *      already drifted from `VERDICT_TOKEN` (it omitted `✗`) and was blind to sentinels the
 *      corpus really prints (`MIRRORS-STALE`, `PHASECOUNT-UNREADABLE`, `<kind>:EMPTY`).
 *      A detector and a repair that keep separate copies of a heuristic disagree silently.
 *
 * ---------------------------------------------------------------------------
 * WHAT COUNTS AS AN OFFENDER NOW
 *
 * A fenced block is JUDGED when it contains a `node -e` / `node --eval` command that either
 * computes a verdict (selects, conditionally, a string carrying a failure token) or carries
 * the repair shim — once a block has been swept it stays under the rule's jurisdiction.
 *
 * A judged block is an OFFENDER when any of these holds:
 *
 *   A. NO FAILING EXIT PATH ON THE COMMAND ITSELF. Evaluated against the individual command,
 *      never the fence: no `process.exit(x)` with anything but a literal 0, no
 *      `process.exitCode =`, no `throw`, no `assert`, no shell-level `exit 1`, and no shell
 *      gate (`| grep -q`, `test …`, `[ … ]`, `|| exit`) on ITS output.
 *   B. THE BLOCK'S LAST COMMAND CANNOT FAIL. `echo`, `printf`, `true`, `:`, `exit 0`, a
 *      `… || echo "…"` tail, and an `if … fi` whose branches all end in one of those, all
 *      exit 0 unconditionally — so nothing the earlier commands discovered reaches the
 *      caller.
 *   C. A SHIM THAT HAS DRIFTED. Any command carrying the shim marker must carry EXACTLY
 *      `shimSource()`, which is generated from `VERDICT_TOKEN`. The vocabulary therefore has
 *      one definition, and a change to it is a corpus-wide diff rather than a silent
 *      divergence.
 *   D. A BLIND VERDICT ARM. In a shimmed command the shim IS the failing exit path, so a
 *      conditional that selects between two sentinel-shaped strings and carries no failure
 *      token in either arm is a verdict the shim cannot see — half-guarded, exactly as inert
 *      as before the sweep. (Checked only for shimmed commands: a command with its own
 *      `process.exit(ok?0:1)` does not depend on what it prints.)
 *
 * Clause A is the one that keeps this from being the 439-false-positive rule the
 * `testplan-command-patterns.json` `$comment` warns about: a command that already CAN fail
 * is not this defect, however it prints.
 *
 * Node stdlib only.
 */

/**
 * The failure vocabulary. ONE definition — the detector reads it and `shimSource()` is
 * generated from it, so the two cannot disagree about what a verdict looks like.
 *
 * Deliberately NOT extended with `LEAK` or `PRESENT`, which the review suggested: the corpus
 * prints `NO-LEAK-OK` and `TILES-PRESENT` as a SUCCESS and a FAILURE respectively, so either
 * word in this set would make a passing command exit 1. Those two sentinels were repaired at
 * the source instead, by suffixing the failure arm (ADR-0172).
 */
const VERDICT_TOKEN = /(FAIL|VIOLATION|MISSING|BROKEN|MISMATCH|ABSENT|NOT-|STALE|UNREADABLE|:EMPTY|✗)/;
const CONDITIONAL = /\?[\s\S]{0,400}:/;

/** The marker that says "this command was repaired by the STORY-28.1.03 sweep". */
const SHIM_MARK = 'const __say=console.log';
const SHIM_TAG = 'STORY-28.1.03: exit on the verdict this command prints';

/**
 * The repair, GENERATED from `VERDICT_TOKEN`. Never hand-copy this into a testplan — the
 * sweep and `verdict-exit.test.js` both take it from here, and `classify()` rejects any
 * command whose shim is not byte-identical to it.
 *
 * It accumulates every line the command prints (not just the last one): a verdict printed
 * before a trailing measurement is still a verdict.
 */
function shimSource() {
  return SHIM_MARK + ';let __v="";'
    + 'console.log=function(){__v+=Array.prototype.join.call(arguments," ")+"\\n";'
    + 'return __say.apply(console,arguments)};'
    + 'process.on("exit",function(){if(' + String(VERDICT_TOKEN) + '.test(__v))process.exitCode=1});'
    + '/* ' + SHIM_TAG + ' */';
}

// Any path by which the command can exit non-zero.
const FAIL_PATHS = [
  { re: /process\.exit\((?!\s*0\s*\))/, why: 'process.exit with a non-zero or computed code' },
  { re: /process\.exitCode\s*=/, why: 'process.exitCode is assigned' },
  { re: /\bthrow\b/, why: 'it throws' },
  { re: /require\(['"]assert|\bassert\./, why: 'it asserts' },
  { re: /\bexit\s+[1-9]/, why: 'a shell-level exit' },
  { re: /\|\s*grep\s+-[a-zA-Z]*q|\bgrep\s+-[a-zA-Z]*q\b/, why: 'its output is gated by grep -q' },
  { re: /&&\s*\[|\btest\s+["'$-]/, why: 'its output is gated by test/[' },
  { re: /\|\|\s*exit/, why: 'an || exit gate' },
];

function isNodeEval(text) { return /\bnode\s+(-e|--eval)\b/.test(text); }
function hasShim(text) { return String(text || '').indexOf(SHIM_MARK) >= 0; }

/** The shim occurrences in a command, as written. */
function shimsIn(text) {
  const out = [];
  const src = String(text || '');
  let i = src.indexOf(SHIM_MARK);
  while (i >= 0) {
    const end = src.indexOf('*/', i);
    out.push(end < 0 ? src.slice(i) : src.slice(i, end + 2));
    i = src.indexOf(SHIM_MARK, i + 1);
  }
  return out;
}

/** The command without its shim(s) — what the author actually wrote. */
function withoutShim(text) {
  let out = String(text || '');
  for (const s of shimsIn(out)) out = out.split(s).join('');
  return out;
}

function computesVerdict(text) {
  const bare = withoutShim(text);
  return VERDICT_TOKEN.test(bare) && CONDITIONAL.test(bare);
}

function failPath(text) {
  const hit = FAIL_PATHS.find((p) => p.re.test(text));
  return hit ? hit.why : null;
}

/* ===========================================================================
 * Shell shape: which command's exit status is the block's exit status
 * ======================================================================== */

/**
 * Split shell text on the given top-level separators. Quoted regions and `( … )` / `$( … )`
 * groups are never split inside.
 */
function splitShell(text, seps) {
  const src = String(text || '');
  const parts = [];
  let cur = '';
  let quote = null;
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) { cur += c; if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; cur += c; continue; }
    if (c === '$' && src[i + 1] === '(') { depth += 1; cur += '$('; i += 1; continue; }
    if (c === '(') { depth += 1; cur += c; continue; }
    if (c === ')') { if (depth > 0) depth -= 1; cur += c; continue; }
    if (depth === 0) {
      if (seps.indexOf('&&') >= 0 && c === '&' && src[i + 1] === '&') { parts.push(cur); cur = ''; i += 1; continue; }
      if (seps.indexOf('||') >= 0 && c === '|' && src[i + 1] === '|') { parts.push(cur); cur = ''; i += 1; continue; }
      if (seps.indexOf('|') >= 0 && c === '|' && src[i + 1] !== '|' && src[i - 1] !== '|') { parts.push(cur); cur = ''; continue; }
      if (seps.indexOf(';') >= 0 && c === ';') { parts.push(cur); cur = ''; continue; }
      if (seps.indexOf('\n') >= 0 && c === '\n') { parts.push(cur); cur = ''; continue; }
    }
    cur += c;
  }
  parts.push(cur);
  return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * The top-level commands of a fenced block, in order. A `node -e '…'` spanning ten lines is
 * ONE command; a `#` comment is none.
 *
 * Whole-line comments are dropped BEFORE the quote-aware split, because a shell stops reading
 * a comment at the newline and never sees the quotes in it — an apostrophe in prose ("the
 * block's exit status") would otherwise open a quote that swallows the next command whole,
 * and the block would silently drop out of the judged set.
 */
function blockCommands(text) {
  const src = String(text || '')
    .replace(/\\\r?\n/g, ' ')
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
  return splitShell(src, ['\n']).filter((s) => !/^#/.test(s));
}

const ALWAYS_ZERO_BASE = /^(echo\b|printf\b|true\b|:\s|:$|exit\s+0\s*$)/;

/** Last command of a `;`-separated body. */
function lastOf(body) {
  const parts = splitShell(body, [';']);
  return parts.length ? parts[parts.length - 1] : String(body || '').trim();
}

/** `if … fi` exits with the last command of whichever branch runs (0 if none does). */
function ifAlwaysZero(t) {
  const toks = String(t).split(/\s*;?\s*\b(if|then|elif|else|fi)\b\s*;?\s*/);
  const bodies = [];
  for (let i = 0; i < toks.length - 1; i++) {
    if (toks[i] === 'then' || toks[i] === 'else') bodies.push(toks[i + 1]);
  }
  if (!bodies.length) return false;
  return bodies.every((b) => alwaysZero(lastOf(b)));
}

/** Can this command ever exit non-zero? */
function alwaysZero(cmd) {
  const t = String(cmd || '').trim();
  if (!t) return true;
  if (/^if\b/.test(t) && /\bfi$/.test(t)) return ifAlwaysZero(t);
  const semi = splitShell(t, [';']);
  if (semi.length > 1) return alwaysZero(semi[semi.length - 1]);
  const or = splitShell(t, ['||']);
  if (or.length > 1) return alwaysZero(or[or.length - 1]);
  const and = splitShell(t, ['&&']);
  if (and.length > 1) return and.every(alwaysZero);
  const pipe = splitShell(t, ['|']);
  if (pipe.length > 1) return alwaysZero(pipe[pipe.length - 1]);
  return ALWAYS_ZERO_BASE.test(t);
}

/* ===========================================================================
 * Blind verdict arms: a conditional the shim cannot read
 * ======================================================================== */

// A sentinel is an upper-case hyphenated word — `TILES-PRESENT`, `WORDING-OK`. A bare
// `PHASECOUNT:` measurement prefix is not one.
const SENTINEL_LITERAL = /[A-Z][A-Z0-9]*(-[A-Z0-9]+)+/;

/** The `?`/`:` arms of every ternary in a JS-ish source string. */
function ternaryArms(source) {
  const src = String(source || '');
  const out = [];
  const depthAt = [];
  let quote = null;
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i += 1; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '(' || c === '[' || c === '{') { depth += 1; continue; }
    if (c === ')' || c === ']' || c === '}') { depth -= 1; continue; }
    if (c !== '?') continue;
    const prev = src[i - 1];
    const next = src[i + 1];
    // regex quantifiers (`*?`, `+?`, `}?`), optional-chaining, `??`, and `(?:` groups
    if (prev === '*' || prev === '+' || prev === '}' || prev === '(' || prev === '?') continue;
    if (next === ':' || next === '.' || next === '?' || next === '=' || next === '!') continue;
    depthAt.push({ i, depth });
  }
  for (const start of depthAt) {
    const arm = readArms(src, start.i, start.depth);
    if (arm) out.push(arm);
  }
  return out;
}

function readArms(src, qi, depth0) {
  let quote = null;
  let depth = depth0;
  let colon = -1;
  for (let i = qi + 1; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i += 1; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '(' || c === '[' || c === '{') { depth += 1; continue; }
    if (c === ')' || c === ']' || c === '}') { depth -= 1; if (depth < depth0) return null; continue; }
    if (c === ':' && depth === depth0) { colon = i; break; }
  }
  if (colon < 0) return null;
  quote = null;
  depth = depth0;
  let end = src.length;
  for (let i = colon + 1; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i += 1; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '(' || c === '[' || c === '{') { depth += 1; continue; }
    if (c === ')' || c === ']' || c === '}') { depth -= 1; if (depth < depth0) { end = i; break; } continue; }
    if (depth === depth0 && (c === ',' || c === ';')) { end = i; break; }
  }
  return { a: src.slice(qi + 1, colon), b: src.slice(colon + 1, end) };
}

function stringLiterals(source) {
  return (String(source || '').match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g) || []);
}

function armIsSentinel(arm) {
  return stringLiterals(arm).some((s) => SENTINEL_LITERAL.test(s));
}

/**
 * The JS the shell hands to `node -e`. Without this step the whole one-liner sits inside a
 * shell-quoted region and every conditional in it is invisible — which is how the first pass
 * of the blind-arm check silently found nothing.
 */
function evalScripts(command) {
  const src = String(command || '');
  const out = [];
  const re = /\bnode\s+(?:-e|--eval)\s+/g;
  let m;
  while ((m = re.exec(src))) {
    const i = m.index + m[0].length;
    const q = src[i];
    if (q !== "'" && q !== '"') continue;
    const end = src.lastIndexOf(q);
    if (end <= i) continue;
    out.push(src.slice(i + 1, end));
  }
  return out;
}

/**
 * Conditionals that select between sentinel strings but carry no failure token in either
 * arm. In a shimmed command that is a verdict nothing can observe.
 */
function blindArms(command) {
  const out = [];
  for (const script of evalScripts(withoutShim(command))) {
    for (const arm of ternaryArms(script)) {
      if (VERDICT_TOKEN.test(arm.a) || VERDICT_TOKEN.test(arm.b)) continue;
      if (!armIsSentinel(arm.a) && !armIsSentinel(arm.b)) continue;
      out.push((arm.a.trim() + ' : ' + arm.b.trim()).replace(/\s+/g, ' ').slice(0, 120));
    }
  }
  return out;
}

/* ===========================================================================
 * Classification
 * ======================================================================== */

/**
 * Classify one fenced command block (or one command — a single-command string is a block of
 * one). Returns { offender, reason } — `reason` explains either why it is one or why it is
 * not, so a caller can print the classification rather than an unexplained count.
 */
function classify(text) {
  const t = String(text || '');
  const commands = blockCommands(t);
  const judged = commands.filter((c) => isNodeEval(c) && (computesVerdict(c) || hasShim(c)));

  if (!judged.length) {
    if (!commands.some(isNodeEval)) return { offender: false, reason: 'not a node -e command' };
    return { offender: false, reason: 'prints no conditional verdict' };
  }

  // A. every judged command must be able to fail IN ITS OWN RIGHT
  for (const c of judged) {
    if (!failPath(c)) {
      return {
        offender: true,
        reason: 'it selects a failure string conditionally and then exits 0 either way — every '
          + 'consumer that gates on the exit code sees unconditional green (BUG-20260803-02)',
      };
    }
  }

  // C. a shim must be the generated one, exactly
  const want = shimSource();
  for (const c of commands) {
    for (const s of shimsIn(c)) {
      if (s !== want) {
        return {
          offender: true,
          reason: 'it carries a hand-edited repair shim whose failure vocabulary has drifted '
            + 'from VERDICT_TOKEN — regenerate it from shimSource() (review CRITICAL-3)',
        };
      }
    }
  }

  // D. a shimmed command must not print a verdict the shim cannot read
  for (const c of judged) {
    if (!hasShim(c)) continue;
    const blind = blindArms(c);
    if (blind.length) {
      return {
        offender: true,
        reason: 'the shim is its only failing exit path, and it selects between sentinels that '
          + 'carry no failure token — the failure arm is invisible to the guard: ' + blind[0],
      };
    }
  }

  // B. the block's exit status is its LAST command's status
  const last = commands[commands.length - 1];
  if (alwaysZero(last)) {
    return {
      offender: true,
      reason: 'the block\'s last command cannot exit non-zero (' + last.slice(0, 80)
        + '), so nothing the repaired command discovers reaches the caller (review BLOCKER-1 / '
        + 'CRITICAL-2)',
    };
  }

  return { offender: false, reason: 'has a failing exit path: ' + failPath(judged[0]) };
}

/** Fenced blocks of a markdown file, with the line the fence opened on. */
function fencedBlocks(markdown) {
  const lines = String(markdown).split(/\r?\n/);
  const out = [];
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) {
      if (open === null) open = { line: i + 1, body: [] };
      else { out.push({ line: open.line, text: open.body.join('\n') }); open = null; }
      continue;
    }
    if (open) open.body.push(lines[i]);
  }
  return out;
}

module.exports = {
  VERDICT_TOKEN, CONDITIONAL, FAIL_PATHS, SHIM_MARK, SHIM_TAG,
  shimSource, shimsIn, withoutShim, hasShim,
  splitShell, blockCommands, alwaysZero, ternaryArms, evalScripts, blindArms,
  classify, fencedBlocks, isNodeEval, computesVerdict, failPath,
};
