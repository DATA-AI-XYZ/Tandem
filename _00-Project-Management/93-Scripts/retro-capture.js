#!/usr/bin/env node
/**
 * retro-capture.js — the development retro ledger's writer (STORY-26.1.02, PRD §A.4).
 *
 * Appends exactly one JSON line to `41-Reports/retro/retro-log.jsonl`, validated against
 * `lib/retro-schema.js` before writing.
 *
 * THE DEFINING PROPERTY IS THAT RECORDING HOW WORK WENT MUST NEVER BREAK THE WORK ITSELF.
 * This script is wired into four development boundaries (STORY-26.1.03); a close-out that
 * could fail because a retro line could not be written would strand a story between
 * `in-progress` and `done`. So:
 *
 *   - IT ALWAYS EXITS 0. Unwritable ledger, missing directory, full disk, malformed payload,
 *     hostile argv, or a MISSING/BROKEN SCHEMA MODULE — every failure becomes a warning on
 *     stderr and a successful exit. There is exactly one `process.exit` in this file and its
 *     argument is the literal 0. Note the schema `require` is guarded: an unguarded top-level
 *     require exits 1 on a partial install, which is a live failure mode for a kit shipped as
 *     a plugin, and it fires before any try/catch in main() exists.
 *   - AN INVALID RECORD IS REFUSED, NOT WRITTEN. Refusing and crashing are different things;
 *     both halves of the contract hold at once. The ledger therefore never contains a line
 *     `retro-schema.js` would reject, which is what lets the aggregator and R25 parse it
 *     without defensive per-field checks. With no schema loaded the writer refuses everything
 *     rather than appending unvalidated lines.
 *
 * APPEND ATOMICITY (AC-4) — see ADR-0110. The line is serialised in full, with its trailing
 * newline, into a single Buffer and written with ONE `writeSync` to a descriptor opened `'a'`
 * (O_APPEND). O_APPEND fuses the seek-to-end and the write into one operation, so concurrent
 * writers cannot interleave. This is deliberately NOT read-modify-write: reading the file,
 * adding a line and writing it back loses records under concurrency while passing a
 * single-threaded test — measured at 96 of 100 records lost under the suite's barrier test.
 *
 * PRECONDITION: a LOCAL filesystem. O_APPEND atomicity holds on ext4/APFS/NTFS but is NOT
 * guaranteed over NFS or SMB. `PM_RETRO_LOG` can point anywhere; a ledger on a network share
 * voids AC-4.
 *
 * Usage:
 *   node _00-Project-Management/93-Scripts/retro-capture.js \
 *     --level story --id STORY-21.3.03 --phase EPIC-21 --chat CHAT-03 \
 *     --tier high --estimate-vs-actual over --rework --bugs 1 --adrs 1 \
 *     [--friction "..."] [--artefact-gap TESTPLAN-21.3.03] [--kit-signal "..."]
 *
 *   --run <run_id>          the RUN this capture belongs to. Recorded beside the join key
 *                           (STORY-29.1.03); absent is the literal `unattributed-run`.
 *   --flag=value            supported, and the only way to pass a value starting with `--`
 *   --no-rework             explicit false; a bare `--rework` is true; absent is null
 *   --                      end of options
 *   --out <path>            the ledger path. Since STORY-29.1.01 every gate-tool capture passes
 *                           it EXPLICITLY — including for a production write — because
 *                           `lib/ledger-target.js` resolves the destination up front and a
 *                           default two files away is what let a verification invocation
 *                           pollute the calibration ledger (BUG-20260804-37 / -39).
 *   PM_RETRO_LOG=<path>     same, via environment
 *   PM_RETRO_QUIET=1        suppress the stdout success line
 *
 * Exit code: 0. Always. See above.
 *
 * Dependency-free — Node stdlib only, consistent with every other `93-Scripts/` tool.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// GUARDED. A bare top-level require here is the one construct that can exit non-zero before
// any handler exists — verified: a missing or syntactically broken retro-schema.js produced
// `exit 1` plus a Node stack trace, at every close-out. Failure is deferred into main(), which
// warns and refuses to write.
let schema = null;
let schemaLoadError = null;
try {
  schema = require(path.join(__dirname, 'lib', 'retro-schema.js'));
} catch (err) {
  schemaLoadError = err;
}

const PM_ROOT = path.resolve(__dirname, '..');
const DEFAULT_LOG_PATH = path.join(PM_ROOT, '41-Reports', 'retro', 'retro-log.jsonl');

// A single append is atomic in practice well beyond this, but free-text fields come from
// callers and an unbounded line is the one way a torn write becomes reachable.
const MAX_LINE_BYTES = 16384;
const MAX_TEXT_CHARS = 2000;

// Fields whose values are free text from a caller and may therefore be shortened to fit.
// Free text only. `governor_action` is deliberately absent: it is an ENUM, and a truncated
// enum value is not a shorter enum value — it is an invalid record, so shortening it could
// only ever turn a writable record into a refused one.
const TRUNCATABLE = ['friction', 'artefact_gap', 'kit_signal', 'stop_reason', 'action', 'plan',
  'tier_note', 'acknowledged_halt_reason'];

// Never let a diagnostic write take the process down (EPIPE on a closed pipe, etc.).
function warn(msg) {
  // Loud on stderr by design. A writer that swallows every error can hide a ledger that has
  // silently stopped working; R25 (STORY-26.3.01) catches the resulting gaps at the phase
  // merge. The two are designed as a pair.
  try { process.stderr.write('⚠ retro-capture: ' + msg + '\n'); } catch { /* ignore */ }
}
function say(msg) {
  if (process.env.PM_RETRO_QUIET) return;
  try { process.stdout.write(msg + '\n'); } catch { /* ignore */ }
}

// Never trust a thrown value's own stringification.
function safeMessage(err) {
  try {
    if (err && typeof err.message === 'string') return err.message;
    return String(err);
  } catch {
    return '(unprintable error)';
  }
}

// ---------- CLI ----------

// NULL-PROTOTYPE, for the same reason retro-schema.js is: a plain object literal makes
// `TABLE['constructor']` return a truthy inherited function, so a bare argv token like
// `constructor` or `__proto__` injected a garbage key into the ledger. Verified before the fix.
const VALUE_FLAGS = Object.assign(Object.create(null), {
  '--level': 'level',
  '--id': 'id',
  '--phase': 'phase',
  '--chat': 'chat',
  '--friction': 'friction',
  '--artefact-gap': 'artefact_gap',
  '--kit-signal': 'kit_signal',
  '--stage': 'stage',
  // STORY-29.1.03 — the run this capture belongs to. NOT the record's `--id`: a story-level
  // record belongs to a run too. Absent is recorded as the `unattributed-run` marker, never a
  // fabricated id, because a run id only exists once ADR-0151's plan has minted one.
  '--run': 'run_id',
  // story
  '--tier': 'tier',
  '--tier-reason': 'tier_reason',
  '--tier-note': 'tier_note',
  '--usage-estimate': 'usage_estimate',
  '--estimate-vs-actual': 'estimate_vs_actual',
  '--bugs': 'bugs',
  '--adrs': 'adrs',
  '--wall-clock-s': 'wall_clock_s',
  // chat
  '--stories': 'stories',
  '--halts': 'halts',
  '--lanes': 'lanes',
  '--dispatch-overhead-s': 'dispatch_overhead_s',
  // phase
  '--chats': 'chats',
  '--merge': 'merge',
  // run
  '--phases': 'phases',
  '--pauses': 'pauses',
  '--stop-reason': 'stop_reason',
  '--plan': 'plan',
  '--predicted': 'predicted',
  // Where the entry probe's signal came from (ADR-0156). Enumerated in retro-schema.js;
  // an unknown value is rejected by validate() like any other enum violation.
  '--signal-source': 'signal_source',
  '--resume-authorisation': 'resume_authorisation',
  '--acknowledged-halt-reason': 'acknowledged_halt_reason',
  // pause
  '--percent-used': 'percent_used',
  '--threshold': 'threshold',
  '--reset-at': 'reset_at',
  '--action': 'action',
  '--governor-action': 'governor_action',
  '--resumed-at': 'resumed_at',
  '--resume-mechanism': 'resume_mechanism',
});

// Tri-state. A bare `--rework` is true and `--no-rework` is false; ABSENT IS NULL, never
// false. Defaulting to false would assert a fact the caller never supplied — during the
// staged wiring of STORY-26.1.03 that produces a ledger where every record says "no rework"
// and the aggregator reports a 0% rework rate that looks like a measurement instead of an
// absence. That is the worst kind of calibration bug because it is invisible.
const BOOLEAN_FLAGS = Object.assign(Object.create(null), {
  '--rework': ['rework', true],
  '--no-rework': ['rework', false],
  '--fallback-fired': ['fallback_fired', true],
  '--no-fallback-fired': ['fallback_fired', false],
});

// Strict coercion. `Number()` is too permissive to be a pre-arbiter: it silently accepted
// `0x10` as 16, `1e3` as 1000, `" 5 "` as 5, and `1e21` as an "integer" count. Anything not
// matching these patterns is passed through RAW so that `retro-schema.validate()` is the
// single arbiter of what is acceptable.
const INTEGER_FIELDS = new Set([
  'bugs', 'adrs', 'wall_clock_s', 'stories', 'halts', 'dispatch_overhead_s',
  'chats', 'phases', 'pauses', 'usage_estimate',
]);
const DECIMAL_FIELDS = new Set(['percent_used', 'threshold']);

function coerce(field, raw) {
  if (INTEGER_FIELDS.has(field)) {
    return /^\d{1,15}$/.test(raw) ? Number(raw) : raw;
  }
  if (DECIMAL_FIELDS.has(field)) {
    return /^-?\d{1,15}(\.\d+)?$/.test(raw) ? Number(raw) : raw;
  }
  if (field === 'predicted') {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return raw;
}

function parseArgs(argv) {
  const fields = Object.create(null);
  const flagsSeen = Object.create(null);
  const problems = [];
  let out = null;
  let outSeen = false;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (typeof token !== 'string') continue;

    if (token === '--') {
      const rest = argv.length - i - 1;
      if (rest > 0) problems.push(`ignoring ${rest} argument(s) after the \`--\` end-of-options marker`);
      break;
    }
    if (token === '--help' || token === '-h') { help = true; continue; }

    // `--flag=value` — the only way to pass a value that itself starts with `--`.
    let name = token;
    let inlineValue = null;
    const eq = token.indexOf('=');
    if (token.startsWith('--') && eq > 2) {
      name = token.slice(0, eq);
      inlineValue = token.slice(eq + 1);
    }

    if (BOOLEAN_FLAGS[name]) {
      const [field, value] = BOOLEAN_FLAGS[name];
      if (flagsSeen[field]) problems.push(`\`${name}\` overrides an earlier value for ${field}`);
      fields[field] = value;
      flagsSeen[field] = true;
      continue;
    }

    if (name === '--out') {
      const raw = inlineValue !== null ? inlineValue : argv[i + 1];
      // Guarded like every other value flag. Unguarded, `--out` as the final token left `out`
      // undefined and the writer silently retargeted the PRODUCTION ledger.
      if (raw === undefined || (inlineValue === null && raw.startsWith('--'))) {
        problems.push('`--out` was given without a value — refusing rather than falling back ' +
                      'to the production ledger');
        return { fields, flagsSeen, out: null, outMissing: true, problems, help };
      }
      if (inlineValue === null) i++;
      out = raw;
      outSeen = true;
      continue;
    }

    const field = VALUE_FLAGS[name];
    if (field) {
      const raw = inlineValue !== null ? inlineValue : argv[i + 1];
      if (raw === undefined || (inlineValue === null && raw.startsWith('--'))) {
        // Recorded as NULL, not '': an empty string passes validation for every free-text
        // field, so the operator error would vanish silently.
        problems.push(`\`${name}\` was given without a value — ${field} recorded as null`);
        fields[field] = null;
        flagsSeen[field] = true;
        continue;
      }
      if (inlineValue === null) i++;
      if (flagsSeen[field]) problems.push(`\`${name}\` overrides an earlier value for ${field}`);
      fields[field] = coerce(field, raw);
      flagsSeen[field] = true;
      continue;
    }

    problems.push(`ignoring unrecognised argument \`${token}\``);
  }

  return { fields, flagsSeen, out, outSeen, outMissing: false, problems, help };
}

// ---------- record assembly ----------

// Build the record with EVERY key its level defines present, so downstream readers need no
// key-presence checks (PRD §A.4: "written as explicit null, never omitted keys"). The key
// lists are DERIVED FROM THE SCHEMA, never restated here — a hard-coded copy had already
// drifted (it omitted `schema_version`), which is exactly the three-way drift ADR-0109 exists
// to prevent.
function buildRecord(parsed, nowIso) {
  const { fields, flagsSeen } = parsed;
  const record = Object.create(null);

  record.level = fields.level;
  record.id = fields.id;
  record.ts = nowIso; // §A.4: from the system clock inside the script, never caller-supplied.

  for (const key of schema.COMMON_OPTIONAL) {
    if (key === 'level' || key === 'id' || key === 'ts') continue;
    if (key === 'schema_version') { record[key] = schema.SCHEMA_VERSION; continue; }
    // THE JOIN KEY IS COMPUTED, NOT PROMPTED (STORY-29.1.03, ADR-0179). There is deliberately
    // no `--join-key` flag: a key a caller can type is a key a caller can mistype, and the two
    // writers agreeing depends on neither of them being asked. It is composed from what this
    // invocation already said — the id, qualified by the phase when the id is the bare
    // `CHAT-NN` form — and is explicit NULL when that is not enough to name the unit. Null is
    // the honest answer; `CHAT-01` would be a key naming five chats, which is the defect.
    if (key === schema.joinKeyField) {
      record[key] = schema.composeJoinKey({ id: fields.id, phase: fields.phase });
      continue;
    }
    // The run, BESIDE the key. An explicit marker rather than an absent field, so "captured
    // outside a run" and "written before this field existed" stay different facts.
    if (key === schema.runField) {
      record[key] = flagsSeen[key] ? fields[key] : schema.UNATTRIBUTED_RUN;
      continue;
    }
    record[key] = flagsSeen[key] ? fields[key] : null;
  }

  const levelFields = schema.LEVELS.includes(fields.level)
    ? schema.LEVEL_OPTIONAL[fields.level]
    : [];
  for (const key of levelFields) {
    record[key] = flagsSeen[key] ? fields[key] : null;
  }

  // A caller may pass a level-specific flag that does not belong to the level it named (e.g.
  // `--tier` on a phase record). Carry it rather than dropping it: dropping data silently is
  // worse than an out-of-place field, and the schema is deliberately not level-scoped
  // (ADR-0109). It stays visible for the aggregator to notice.
  for (const key of Object.keys(fields)) {
    if (!(key in record)) record[key] = fields[key];
  }

  return record;
}

function serialise(record) {
  // JSON.stringify handles a null-prototype object natively. Do NOT round-trip through
  // Object.assign({}, record) first — that uses [[Set]] and would trip a literal `__proto__`
  // own key, which is the one construct this file must not reintroduce.
  return JSON.stringify(record) + '\n';
}

// Shrink free text until the line fits the byte cap, code-point safe.
//
// Budgeting in CHARACTERS while capping in BYTES did not actually guarantee a fit: six fields
// at 2000 chars of 4-byte UTF-8 is ~48 KB against a 16 KB cap, so the mechanism that exists to
// stop free text costing you the record cost you the record — after announcing it had saved
// it. Mechanical fields (tier, bugs, wall_clock_s) are the calibration data that matters, so
// free text is sacrificed first and refusal is the last resort.
function fitToBudget(record) {
  const truncated = [];
  const mark = key => { if (!truncated.includes(key)) truncated.push(key); };

  for (const key of TRUNCATABLE) {
    const v = record[key];
    if (typeof v !== 'string') continue;
    const cps = Array.from(v); // code points — slicing raw UTF-16 splits surrogate pairs
    if (cps.length > MAX_TEXT_CHARS) {
      record[key] = cps.slice(0, MAX_TEXT_CHARS).join('');
      mark(key);
    }
  }

  let guard = 0;
  while (Buffer.byteLength(serialise(record), 'utf8') > MAX_LINE_BYTES && guard++ < 128) {
    let victim = null;
    let longest = 0;
    for (const key of TRUNCATABLE) {
      const v = record[key];
      if (typeof v === 'string' && v.length > longest) { victim = key; longest = v.length; }
    }
    if (!victim) break; // nothing left to give — caller refuses
    const cps = Array.from(record[victim]);
    const next = Math.floor(cps.length / 2);
    record[victim] = next > 0 ? cps.slice(0, next).join('') : null;
    mark(victim);
  }

  return truncated;
}

// ---------- the append ----------

// One buffer, one writeSync, one O_APPEND descriptor. See the header note on atomicity.
function appendLine(logPath, line) {
  const buf = Buffer.from(line, 'utf8');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  let fd;
  try {
    fd = fs.openSync(logPath, 'a');
    const written = fs.writeSync(fd, buf, 0, buf.length);
    if (written !== buf.length) {
      // Not retried on purpose: a second write after a torn append would duplicate bytes and
      // corrupt the line rather than repair it. But a torn line with no trailing newline would
      // also swallow the NEXT record by gluing it on, losing two instead of one — so terminate
      // the damaged line best-effort, then surface the failure.
      try { fs.writeSync(fd, Buffer.from('\n', 'utf8')); } catch { /* best effort */ }
      throw new Error(`short write (${written}/${buf.length} bytes) — ledger line truncated`);
    }
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* closing is best-effort */ }
    }
  }
}

// ---------- main ----------

function runCapture(argv) {
  const parsed = parseArgs(argv);
  for (const p of parsed.problems) warn(p);

  if (parsed.help) {
    say('Usage: node retro-capture.js --level <' + (schema ? schema.LEVELS.join('|') : 'level') +
      '> --id <id> [--phase <id>] [--chat <id>] [level fields] [--friction "..."] ' +
      '[--artefact-gap <id>] [--kit-signal "..."] [--out <path>]');
    say('Always exits 0 — capturing a retro must never block a close-out.');
    return;
  }

  if (!schema) {
    warn('schema module lib/retro-schema.js could not be loaded (' +
         safeMessage(schemaLoadError) + ') — refusing to write an unvalidated record');
    return;
  }

  // A `--out` given without a value must NOT silently fall back to the production ledger.
  if (parsed.outMissing) return;

  const logPath = parsed.out || process.env.PM_RETRO_LOG || DEFAULT_LOG_PATH;

  const record = buildRecord(parsed, new Date().toISOString());

  // A FORGOTTEN `--run` IS NOW AUDIBLE (BUG-20260811-02). The marker itself is unchanged and
  // correct; what was wrong is that falling back to it looked exactly like success. See
  // `lib/run-attribution.js` for why this asks whether a run is IN FLIGHT rather than warning on
  // every unattributed capture — a warning that fires on the correct case is one nobody acts on.
  if (schema && record[schema.runField] === schema.UNATTRIBUTED_RUN) {
    try {
      const msg = require(path.join(__dirname, 'lib', 'run-attribution.js'))
        .missingRunWarning({ unit: `${record.level} ${record.id}`, marker: schema.UNATTRIBUTED_RUN });
      if (msg) warn(msg);
    } catch { /* additive: a warning must never cost the capture (ADR-0110) */ }
  }

  const truncated = fitToBudget(record);
  if (truncated.length) {
    warn(`free text shortened to fit the ${MAX_LINE_BYTES}-byte line cap: ${truncated.join(', ')}`);
    // Out-of-band, so an aggregator can tell a shortened value from text a human typed.
    record.truncated = truncated;
  }

  // Validate BEFORE writing. The ledger must never contain a line the schema would reject.
  let verdict;
  try {
    verdict = schema.validate(record);
  } catch (err) {
    // retro-schema.validate() is contracted never to throw; belt-and-braces so a future
    // regression there cannot take the close-out down with it.
    warn('validation itself failed (' + safeMessage(err) + ') — refusing to write');
    return;
  }

  if (!verdict.ok) {
    warn('refusing to write an invalid record — ' + verdict.errors.join('; '));
    return;
  }

  let line;
  try {
    line = serialise(record);
  } catch (err) {
    warn('record could not be serialised (' + safeMessage(err) + ') — nothing captured');
    return;
  }

  const bytes = Buffer.byteLength(line, 'utf8');
  if (bytes > MAX_LINE_BYTES) {
    warn(`record is ${bytes} bytes, over the ${MAX_LINE_BYTES}-byte cap that keeps an append ` +
         'atomic, and could not be shortened further — refusing rather than risking a torn line');
    return;
  }

  try {
    appendLine(logPath, line);
  } catch (err) {
    warn(`could not write the ledger at ${logPath} (${safeMessage(err)}) — retro not captured, ` +
         'continuing anyway');
    return;
  }

  say(`retro: ${record.level} ${record.id} -> ${logPath}`);
}

// The exit-0 net lives HERE, not only around the CLI entry point — `main` is exported and
// require()-mode callers have no process boundary to absorb a throw.
function main(argv) {
  try {
    runCapture(argv);
  } catch (err) {
    warn('unexpected failure (' + safeMessage(err) + ') — retro not captured');
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
  // The ONLY process.exit in this file, and its argument is a literal.
  process.exit(0);
}

module.exports = {
  main, parseArgs, buildRecord, fitToBudget, serialise, appendLine,
  DEFAULT_LOG_PATH, MAX_LINE_BYTES, MAX_TEXT_CHARS,
};
