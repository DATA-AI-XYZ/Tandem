'use strict';
/**
 * stored-invocation.js — is a stored `Command:` a valid INVOCATION of the acceptance harness?
 *
 * ============================================================================
 * WHY THIS EXISTS (BACKLOG-0207 Tranche C · BACKLOG-0209)
 * ============================================================================
 * `tests/tc-command-parses.test.js` closed *"is it valid shell?"* (BACKLOG-0196). It cannot close
 * *"is it a valid invocation?"*, and the gap is not theoretical:
 *
 *   · BUG-20260824-03 — STORY-33.1.02 was the FIRST story to re-run a *carries-over* family. Both
 *     of its stored commands were usage errors, then vacuous. Three blocks before either could
 *     verdict anything.
 *   · BUG-20260825-02 — **5 of the 11** probe commands in CHAT-03's own dispatched verify line
 *     exited 2 before a browser opened.
 *   · `41-Reports/audits/stored-probe-command-parse-preflight-2026-08-25.md` — **41 of 77**
 *     stored invocations across the remaining work could not run.
 *
 * The roster's *carries-over* column promises the **probe** needs no re-targeting. It has never
 * promised the stored **command runs**, and for a carries-over family those two things come apart
 * entirely. `parseArgs` is exported precisely so it can be asked; nothing asked it.
 *
 * ============================================================================
 * THE ARGV SHAPE — the miscalibration that cost 15 commands
 * ============================================================================
 * `parseArgs` takes the FULL `process.argv` and slices two entries internally. Handed a bare
 * argument list it silently discards the first two tokens — usually the board path and the first
 * flag — and verdicts a truncated command. The first edition of the pre-flight above did exactly
 * that and published **26** where the truth was **41**.
 *
 * The control that caught it, and the control this module keeps: **the parser's own documented
 * example must be accepted.** `usageError()`'s callers assert that. A tool that rejects the
 * manual's example is broken, not revealing.
 *
 * ============================================================================
 * CONSERVATIVE BY CONSTRUCTION — a false positive here would be worse than no gate
 * ============================================================================
 * A stored command is shell, not argv, and not all shell has a statically-knowable argv. This
 * module **refuses to guess** and reports what it skipped rather than parsing it badly:
 *
 *   · `$VAR` / `${VAR}` / `` `cmd` `` / `$(cmd)` — the argv depends on the environment;
 *   · a `#` comment line;
 *   · an unbalanced quote — that is `tc-command-parses`'s subject, not this one.
 *
 * Splitting on `&&`, `||`, `;` and `|` happens **outside quotes only**. A first cut split on bare
 * `|` and tore three `--not-matching '^(auto|inherit)$'` regexes in half, manufacturing three
 * offenders that did not exist. The skipped count is printed by every caller so the conservatism
 * is visible rather than silently shrinking the denominator.
 *
 * Node stdlib only. No side effects on require.
 */

/** Shell metacharacters whose presence means the argv is not statically knowable. */
const DYNAMIC = /\$\{|\$[A-Za-z_(]|`/;

/**
 * Strip shell REDIRECTIONS before tokenising — outside quotes only.
 *
 * A first cut did not, and `>/dev/null` came back as a positional argument: 19 stored EPIC-30
 * commands were reported unrunnable with `unexpected extra positional argument ">/dev/null"`,
 * every one of them a perfectly good invocation. A gate that manufactures offenders is worse
 * than no gate — it trains its readers to disbelieve it, and the true positives go with them.
 *
 * Handles `>f`, `> f`, `>>f`, `2>f`, `2>&1`, `&>f`, `<f`, with or without a space before the
 * target. A redirection inside quotes is an argument (`--assert-contains ">"`), and is kept.
 */
/**
 * Strip an unquoted `#` comment — bash's rule: a `#` that begins a token starts a comment.
 *
 * W14. Without this, `… --assert-visible x # explain why` tokenises to
 * `["b.html","--assert-visible","x","#","explain","why"]` and the parser refuses it as an extra
 * positional — a manufactured offender, which the header of this file calls worse than no gate.
 * Zero in the corpus today; the trigger is a TC author adding an inline note to a stored command.
 */
function stripComment(s) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i);
  }
  return s;
}

function stripRedirections(s) {
  let out = '';
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { out += c; if (c === q) q = null; continue; }
    if (c === "'" || c === '"') { q = c; out += c; continue; }
    // A redirection operator, optionally prefixed by a file descriptor already emitted.
    // A bare `&` outside quotes is job control, not an argument (W14). `&>` is handled below.
    if (c === '&' && s[i + 1] !== '>' && s[i + 1] !== '&') { out += ' '; continue; }
    if (c === '>' || c === '<' || (c === '&' && s[i + 1] === '>')) {
      // Drop a file-descriptor digit we may have just written (the `2` of `2>`).
      out = out.replace(/(?:^|\s)\d+$/, (m) => (m[0] === ' ' ? ' ' : ''));
      while (i < s.length && (s[i] === '>' || s[i] === '<' || s[i] === '&')) i += 1;
      while (i < s.length && /\s/.test(s[i])) i += 1;
      // Consume the target, honouring quotes so `> "a b"` does not leave `b"` behind.
      let tq = null;
      while (i < s.length) {
        const d = s[i];
        if (tq) { if (d === tq) tq = null; i += 1; continue; }
        if (d === "'" || d === '"') { tq = d; i += 1; continue; }
        if (/\s/.test(d)) break;
        i += 1;
      }
      i -= 1;
      out += ' ';
      continue;
    }
    out += c;
  }
  return out;
}
/**
 * Tokenise ONE simple command into argv, honouring single and double quotes.
 * Returns null when the quoting is unbalanced (not this module's defect to report).
 */
function tokenise(s) {
  const out = [];
  let cur = '';
  let started = false;
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) { q = null; continue; }
      if (q === '"' && c === '\\' && i + 1 < s.length) { cur += s[++i]; started = true; continue; }
      cur += c; started = true; continue;
    }
    if (c === "'" || c === '"') { q = c; started = true; continue; }
    if (c === '\\' && i + 1 < s.length) { cur += s[++i]; started = true; continue; }
    if (/\s/.test(c)) { if (started) out.push(cur); cur = ''; started = false; continue; }
    cur += c; started = true;
  }
  if (q) return null;
  if (started) out.push(cur);
  return out;
}

/** Split a command line on `&&`, `||`, `;`, `|` — OUTSIDE quotes only. */
function splitSimple(s) {
  const parts = [];
  let cur = '';
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === '&' && s[i + 1] === '&') { parts.push(cur); cur = ''; i += 1; continue; }
    if (c === '|' && s[i + 1] === '|') { parts.push(cur); cur = ''; i += 1; continue; }
    if (c === '|' || c === ';') { parts.push(cur); cur = ''; continue; }
    // A NEWLINE is a separator too, and applying it HERE rather than before this function is what
    // stops a multi-line quoted command being torn in half (W4).
    if (c === '\n') { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts;
}

/**
 * Every statically-knowable `smoke-dashboard.js` invocation in a stored command fence.
 *
 * @returns {{invocations: string[][], skipped: {reason:string, text:string}[]}}
 */
/**
 * Is this token the harness, in COMMAND position?
 *
 * W5. `toks.findIndex(t => /smoke-dashboard\.js$/.test(t))` found the path ANYWHERE, so
 * `test -f …/smoke-dashboard.js`, `node --check …/smoke-dashboard.js` and
 * `S=…/smoke-dashboard.js` all yielded `args = []` — which `parseArgs` accepts (it defaults the
 * board) — and three non-invocations were counted as live invocations. The `S=` case is the
 * sharpest: the assignment counted as live while the `$S …` lines that USE it were skipped as
 * shell expansion, so the denominator moved in both wrong directions at once.
 *
 * Command position = index 0 after stripping the prefixes a stored command legitimately carries:
 * `VAR=value` assignments, `env`, `timeout <n>`, and a `node` interpreter with its own flags.
 *
 * @returns {number} index of the first ARGUMENT after the harness, or -1
 */
function harnessArgStart(toks) {
  let i = 0;
  while (i < toks.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[i])) i += 1;   // VAR=value
  if (toks[i] === 'env') { i += 1; while (i < toks.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[i])) i += 1; }
  if (toks[i] === 'timeout') { i += 1; if (i < toks.length && /^[0-9]/.test(toks[i])) i += 1; }
  if (i < toks.length && /(^|[\\/])node(\.exe)?$/i.test(toks[i])) {
    i += 1;
    // A node flag that takes the FOLLOWING PATH AS DATA means the harness is not being run at all:
    //   node --check <file>   syntax-checks it        node -e/-p <code>   never reaches a file
    // W5 caught  being counted as a live invocation with no
    // arguments, which parseArgs accepts (it defaults the board) — a non-invocation inflating the
    // denominator.
    const OPERAND_FLAGS = /^(--check|-c|--eval|-e|--print|-p)$/;
    while (i < toks.length && toks[i].indexOf('-') === 0) {
      if (OPERAND_FLAGS.test(toks[i])) return -1;
      i += 1;
    }
  }
  if (i < toks.length && /smoke-dashboard\.js$/.test(toks[i])) return i + 1;
  return -1;
}

/**
 * Every statically-knowable `smoke-dashboard.js` invocation in a stored command fence.
 *
 * W4. The first cut split the fence on newlines BEFORE the quote-aware splitter ran, so a
 * `node -e '<multi-line JS>' && node …/smoke-dashboard.js …` command was torn in half: the line
 * carrying the closing quote joined to the harness invocation, leaving a dangling opening quote and
 * an "unbalanced quote" skip. **Seven real invocations across the corpus were lost that way, four
 * of them in the EPIC-25 tree the acceptance run reports on** — the same class as the >/dev/null
 * defect, pointing the other way: a shrinking denominator instead of an invented offender.
 *
 * So the newline is just another separator, applied by the same quote-aware splitter as `&&`.
 *
 * @returns {{invocations: string[][], skipped: {reason:string, text:string}[]}}
 */
function harnessInvocations(fence) {
  const invocations = [];
  const skipped = [];
  const flat = String(fence || '').replace(/\\\r?\n/g, ' ');
  for (const rawPart of splitSimple(flat)) {
    const part = stripComment(rawPart).trim();
    if (!part) continue;
    if (!/smoke-dashboard\.js/.test(part)) continue;
    if (DYNAMIC.test(part)) { skipped.push({ reason: 'shell expansion', text: part.slice(0, 120) }); continue; }
    const toks = tokenise(stripRedirections(part));
    if (toks === null) { skipped.push({ reason: 'unbalanced quote', text: part.slice(0, 120) }); continue; }
    const start = harnessArgStart(toks);
    if (start === -1) { skipped.push({ reason: 'harness named but not invoked', text: part.slice(0, 120) }); continue; }
    invocations.push(toks.slice(start));
  }
  return { invocations, skipped };
}
/**
 * Ask the SHIPPED parser. Returns null when the invocation is valid, else its complaint.
 *
 * Note the argv shape — `['node', '<script>'].concat(args)` — which is the whole point (above).
 */
function usageError(smoke, args) {
  try {
    smoke.parseArgs(['node', 'smoke-dashboard.js'].concat(args));
    return null;
  } catch (e) {
    return String((e && e.message) || e).split('\n')[0];
  }
}

/**
 * Is this test case ASSERTING the refusal?
 *
 * `TESTPLAN-28.1.01 TC-03 · Unknown flag exits 2 (regression pin)` stores
 * `--no-such-flag-xyzzy` on purpose and expects `exit=2`. Its invocation is unrunnable BY
 * DESIGN — that is the assertion. Reporting it as a defect would be the same category error as
 * failing a preserved original: punishing the artefact for doing the right thing, and teaching
 * the next author to stop.
 *
 * Read from the `Expected:` line rather than the whole body, so a TC that merely MENTIONS a
 * usage error in prose is not excused. The refusal has to be what the case claims.
 */
/**
 * The test-case blocks of a testplan, split on its `### TC-NN` headings.
 *
 * Per-CASE rather than per-file because the preserved-original rule is a statement about ONE
 * test case: a landed arm in TC-01 does not excuse an unrunnable command in TC-02.
 */
function testCaseBlocks(text) {
  const t = String(text || '').replace(/\r\n/g, '\n');
  return t.split(/\n(?=###\s+TC-)/).slice(1).map((b) => ({
    id: (b.match(/^###\s+(TC-[0-9]+)/) || [, '?'])[1], body: b,
  }));
}

/**
 * Command fences WITH their label. `- **Command:**` is the stored one; `- **Command (arm 2 …):**`
 * is a landed arm. The distinction is what lets a preserved original be recognised instead of
 * being failed.
 */
function commandFences(block) {
  const out = [];
  const re = /-\s*\*\*Command(\s*\([^)]*\))?:\*\*\s*\r?\n\s*```(?:bash|sh)\r?\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(block)) !== null) out.push({ qualified: !!m[1], body: m[2].replace(/\r\n/g, '\n') });
  return out;
}

/**
 * How this corpus records an ADR-0173 re-anchor. A test case carrying one of these has already
 * disclosed that its stored command does not run; the command is kept as evidence, which is the
 * behaviour ADDENDUM 2 §6 requires and no rule here may penalise.
 */
const REANCHOR_DISCLOSURE = /RE-ANCHORED|re-anchored|does not parse|usage error|deferred-arm-guard/;

/**
 * Should this fence be EXCUSED from the "must be a valid invocation" rule?
 *
 * N8. Both callers used to re-type this decision, and they had already drifted: one applied the
 * negative-control rule and the other did not, so a negative control added to EPIC-25/27/30 would
 * have failed one gate and passed the other. That is the shared-rule-re-typed shape this whole
 * story is about, committed inside the story itself.
 */
function isExcusedFence(fence, tcBody, fences) {
  if (expectsRefusal(tcBody)) return true;
  if (fence.qualified) return false;
  return fences.some((f) => f.qualified) || REANCHOR_DISCLOSURE.test(tcBody);
}

function expectsRefusal(tcBody) {
  const m = /^-\s*\*\*Expected:\*\*([\s\S]*?)(?=\n-\s*\*\*|$)/m.exec(
    String(tcBody || '').replace(/\r\n/g, '\n'));
  if (!m) return false;
  const claim = m[1];
  // C1. The first cut fired on ANY mention of a non-zero exit anywhere in the Expected paragraph,
  // which excused 50 test cases when exactly ONE is a negative control. The other 49 were ordinary
  // exit-0 cases whose prose happens to say "exit 1 (no matches)", "refuses the merge", "Exit 2 =
  // BLOCKED is environment, not failure". Any of them acquiring a harness command later would have
  // been silently exempted.
  //
  // A negative control claims the refusal AND NOTHING ELSE. So: an explicit non-zero exit must be
  // present, and any claim of a SUCCESSFUL exit disqualifies it.
  // A SUCCESSFUL exit claimed anywhere disqualifies it — including inside an alternation such as
  // `exit=<0|1|2>`, which is a range test, not a refusal.
  if (/exit[^.\n]{0,12}\b0\b/i.test(claim)) return false;
  return /\bexits?\s*[=:]?\s*[1-9]\b/i.test(claim);
}
module.exports = { harnessInvocations, usageError, tokenise, splitSimple, stripRedirections,
  testCaseBlocks, commandFences, isExcusedFence, REANCHOR_DISCLOSURE,
  expectsRefusal, DYNAMIC };
