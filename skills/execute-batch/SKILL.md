---
name: execute-batch
description: Execute one "chat" from an Implementation Strategy in this fresh session — run its stories sequentially (execute-story → run-testplan → close-out-story) with atomic per-story finalisation, a context-budget guard, and clean failure recovery; then flip the chat's executed flag so the dashboard shows it done. Use when the user invokes /tandem:execute-batch with a chat id (e.g. CHAT-01), or asks to run/execute a batch or chat from the execution-strategist's plan. Operates as Dev/QA hat. This command DOES change story status (unlike execution-strategist, which is dry-run).
---

# Tandem: execute-batch (Dev/QA hat)

Operate as **Dev/QA hat** in a **fresh chat**. The user has an Implementation Strategy (from
`/tandem:execution-strategist`) and wants to clear one of its **chats** — a small
set of stories grouped to run together — end to end, without re-warming context per story.

A "chat" is the execution-strategist's batch unit (`CHAT-01`, `CHAT-02`, …). This skill runs the
chat's stories **sequentially**, finalising each atomically before the next. It composes the three
existing per-story skills; it does **not** re-implement their logic.

## Inputs needed

- **A chat id** — e.g. `CHAT-01`. If the user didn't supply one, ask, or list the chats in the
  latest strategy.
- **The strategy** — default to the latest `_00-Project-Management/41-Reports/EXECUTION-STRATEGY-*.json`
  (the structured sidecar `execution-strategist` writes). Fall back to the paired `.md` report if the
  JSON is absent. The user may name a specific strategy file.

## Load into context

Use `Read` / `Glob`; treat missing files as "not present", never throw.

- **The named chat** from the latest `EXECUTION-STRATEGY-*.json`: its `stories` (with `ready`
  flags), `lanes` (serial/parallel), `verify` command, `sub_agents`, and `executed` flag.
- **Each story + its paired testplan** under `32-Stories/` + `33-Testplans/`.
- **SOP** — `90-Standards/SOP.md` (DoR/DoD, status enum, WIP limits §5).
- **The three sub-skills** this one delegates to: `execute-story`, `run-testplan`, `close-out-story`.

## DoR precheck (MANDATORY — before running anything)

A chat may include stories the strategy **flagged un-ready** (`ready: false`). **Do not execute an
un-ready story.** If any story in the chat is not `ready`, STOP and report which — the user runs
`/tandem:refine-backlog` on those first. Only proceed when every story in the chat
is `ready` (or the user explicitly drops the un-ready ones from this run).

## Algorithm — sequential loop with atomic finalisation

Order the chat's stories by its **lanes**: a `serial` lane runs in its listed order; `parallel`
lanes are also run **sequentially here** (one at a time) — concurrent fan-out is **BACKLOG-0020**,
out of scope. Then, **for each story in order**:

1. **execute-story** — verify DoR, flip `ready` → `in-progress` (atomic + `started_at`), implement
   the ACs one at a time, file ADRs/BUGs as they arise. Use the chat's resolved **sub-agent** for
   this story's discipline where appropriate.
2. **run-testplan** — execute every TC's `Command`, mark PASS/FAIL, auto-file `BUG-YYYYMMDD-NN` for
   any failure.
3. **close-out-story** — run the DoD gate; flip to `done` (atomic + `completed_at`); update
   `MONITOR.md`; regenerate the dashboard (`npm run pm:dash`).
4. **Finalise atomically before the next story.** Do not advance until the current story has flipped
   to `done` AND MONITOR is updated (status flip + `completed_at` + revision-history line) AND a
   per-story **commit** has landed. The commit is the load-bearing recovery checkpoint — it is what
   makes mid-batch failure recoverable (a crashed batch leaves every completed story committed and
   `done`). The **dashboard regen (`npm run pm:dash`) may be batched to once at batch end** rather
   than run per story: it is a generated read-view (the Stop hook regenerates it anyway), and on a
   large board a 9 MB `pm:dash` per story is wasteful churn. Refresh MONITOR's generated count blocks
   cheaply per story with `npm run pm:monitor`; reserve the heavy `pm:dash` for the end.

### Context-budget guard

**Before each story**, estimate the remaining context. If running the next story would push
context **utilisation above ~80%**, **abort cleanly** (do not start it). A conservative threshold is
deliberate: if unsure, abort. Completed stories are already `done` and safe; the batch can be
resumed in a new chat.

### Failure-recovery contract

On any abort (context overflow, a story's DoD failing, a hard error):

- **Completed stories stay `done`** (they finalised atomically).
- **The current story** (the one mid-flight) goes to **`blocked`** with a one-line note in its body
  explaining why; do not leave it half-flipped.
- **Remaining stories stay `ready`** — untouched.
- Report: N done, 1 blocked (which), M remaining `ready`, and the chat id to resume.

## On success — mark the chat executed

When **all** the chat's stories reach `done`, set the chat's **`executed: true`** in the
`EXECUTION-STRATEGY-*.json` sidecar (so the dashboard's Implementation Strategy view renders it as
`AUTO-EXECUTED`), then regenerate the dashboard. Finally, run the chat's **verify-before-closing**
command and report its result.

### The flag is ONE track's forward write, not the board's truth (ADR-0186)

Since ADR-0182 the sidecar carries the same stories twice: `phases[].chats[]` (the chat track,
which this skill executes) and `autopilot_runs[]` (the autopilot track). **This flag belongs to the
chat track only.**

- **Never write an executed marker into `autopilot_runs[]`.** ADR-0184 fixes a run at ten fields
  and none of them is an executed flag. Two flags over one corpus is a double count, and it stays
  plausible: the same story would be counted once under its chat and again under its run.
- **Never flip a flag for work this invocation did not do.** If the chat's stories are already
  `done` because the other track ran them, leave the flag alone and say so in the summary. The
  board reconciles that case itself: a chat whose stories are all `done` with no flag renders
  **`covered-by-reference`**, naming the run that covered it — never `not-executed`
  (`93-Scripts/lib/track-reconcile.js`, ADR-0186).
- **The story's `status:` is the one truth.** The flag records *who ran the chat*; `status: done`
  records *that the work landed*. When they disagree, the board wins.

## Usage capture

**Bracket the story where a story boundary is observable; state the remainder where it is not**
(STORY-29.3.03 / ADR-0190). A usage-source-unavailable no-op is fine at every step below — the
helper always exits 0 and never blocks the chat.

**1 — Serial lanes: one bracket per story.** A serial lane means one story is worked at a time,
so its boundary is real and observable. Immediately after each story's `close-out-story`, run:

```bash
node _00-Project-Management/93-Scripts/usage-capture.js --story <STORY-NN.M.PP> --since <ISO of the previous boundary>
```

`--since` is what makes it a bracket rather than a running total: pass the chat's start time for
the first story, and the timestamp of the previous story's capture for each one after it. Without
it, every story records the whole session and the numbers are cumulative rather than per-story.

**2 — Parallel or mixed lanes: no story brackets at all.** When stories run concurrently (or work
interleaves), no boundary is observable in the transcript and any per-story figure would be a
guess. Do not write story records. Write the chat record with its constituents named:

```bash
node _00-Project-Management/93-Scripts/usage-capture.js --chat <CHAT-NN> --stories <STORY-A,STORY-B,…>
```

That stamps the record `attribution: "unattributable-to-story"` and lists them, so the rollup
reports "N tokens across [stories], **not split**". **Never divide the tokens by the story
count.** A prorated figure looks measured, is not, and flows into variance figures where nobody
can tell it from a real one.

**3 — The chat bracket is always written**, serial or not (ADR-0079), and on a serial lane it
still names its constituents with `--stories`. Note that a chat capture re-sums the whole session
and therefore OVERLAPS the story brackets inside it; `usage-reconcile.js --attribution` states
that overlap rather than pretending the totals are disjoint.

**Check it:** `node _00-Project-Management/93-Scripts/usage-reconcile.js --attribution` prints
what attached to a story, what could not, and whether the two together account for the ledger.

## Retro capture

Alongside the usage-capture call above, append the chat-level retro ledger line at chat end
(SOP §14.1). The two ledgers join on the `id` **field**, so pass the same `CHAT-NN` to both.
Same contract as usage capture: always exits 0, never blocks the chat. Skip silently if the
script is absent.

```bash
node _00-Project-Management/93-Scripts/retro-capture.js --level chat --id <CHAT-NN> --phase <EPIC-NN> [--stories <n>] [--halts <n>] [--lanes serial] [--wall-clock-s <n>] [--dispatch-overhead-s <n>] [--fallback-fired|--no-fallback-fired] [--friction "…"] [--artefact-gap <ID>] [--kit-signal "…"]
```

- `--lanes serial` — this command runs its loop sequentially. The parallel sibling writes
  `--lanes parallel`. That single field is what lets the rollup compare the two strategies.
- `--stories` — items this chat closed to `done`.
- `--halts` — times the chat **stopped and handed back to the operator** rather than continuing:
  a failed TC with a raised BUG, a false story premise, a DoR/branch gate refusal. A story that
  merely needed a second pass is `--rework` at item level, not a halt here.
- `--wall-clock-s` — elapsed seconds from chat dispatch to the `executed` flag being set.
- `--dispatch-overhead-s` — of that total, the seconds spent on dispatch, context loading and
  board reconciliation rather than execution. A fresh-context sub-agent per chat is not free;
  this is the only field that measures what it costs.
- **Omit any flag you cannot measure.** Absent records "not recorded"; a guess is
  indistinguishable from a measurement, and a value the schema rejects refuses the whole line.
- Per-item capture is **not** this command's job — the loop's `close-out-story` already wrote
  one line per item it closed.

## Output rules

- Commit messages per story: `STORY-NN.M.PP — <imperative>` (close-out-story owns these).
- Status changes are THIS command's job (it is **not** dry-run — that's `execution-strategist`).
- Respect SOP §5 WIP: only one story is `in-progress` at a time (sequential loop), so the in-progress
  limit is never exceeded by this skill.

## End-of-session summary (always emit)

- Chat: CHAT-NN (from EXECUTION-STRATEGY-YYYY-MM-DD)
- Stories done: X / Y · blocked: <id or none> · remaining `ready`: <list or none>
- Chat `executed` flag set: yes/no · dashboard regenerated: yes/no
- Verify-before-closing: <command> → <result>

## Non-negotiable rules from CLAUDE.md

- **Scope discipline** — deliver each story at the scope its ACs define. Don't add refactors, cleanup, or adjacent actions the ACs don't imply — route out-of-scope discoveries to a BACKLOG or BUG item instead of doing them. If an AC seems wrong, say so in one line and continue as written.
- **Atomic finalisation** per story (status flip + `completed_at` + MONITOR + dashboard) before the
  next — the recovery contract depends on it.
- Status enum is the closed set of nine; DoR gate before `in-progress`, DoD gate before `done`.
- ADR-on-the-spot for non-obvious decisions; BUG auto-raise on any defect / TC failure.
- Never execute an un-ready story (DoR precheck above).

## Fresh session vs autonomous subagent-per-chat dispatch

This skill doesn't care how its fresh session was opened. An operator may open it by hand, or a
PM-hat orchestrator may dispatch this chat as an autonomous **subagent-per-batch** run instead.
**Equivalence:** the dispatched subagent's fresh context == a manually-opened fresh session, so
this skill's contract (sequential loop, atomic finalisation, context-budget guard) holds either
way. See SOP §18 ("Subagent-per-batch — autonomous phase runs") for the orchestrator's contract.

**When running as a dispatched batch subagent:** report the success triple — all stories `done`,
all TCs passing, this chat's `executed` flag set — in the end-of-session summary above; never
switch branches (commit on the phase branch only, no worktree); and if the triple can't be met,
stop and report rather than continue, so the orchestrator's halt-and-report behaviour gets an
honest signal.

## Next command

Next: `/tandem:close-phase`

When every chat in the phase is executed, close the phase (retrospective + gated merge). Until
then, re-run `/tandem:execute-batch <next-chat-id>` for the next chat in the
strategy (mind the chat's `depends_on` edges — run unlocked chats first).
`/tandem:weekly-monitor` — after a chat closes, fold the delta into the Friday
cadence. Do **not** hand a finished chat to `run-testplan` — this command already ran every
story's testplan inside its loop; re-running them after the batch does each step twice.
