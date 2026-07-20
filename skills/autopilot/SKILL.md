---
name: autopilot
description: Drive the whole plan end-to-end unattended by chaining start-phase, each chat's execute-batch (subagent-per-batch), and close-phase across one or more phases — with checkpoint/resume, fail-halt guardrails, model tiering, and a usage-governor seam; use when the operator invokes /tandem:autopilot or asks to run the plan autonomously, hands-free, or unattended.
---

# Tandem: autopilot (PM-hat orchestrator)

Operate as the **PM-hat orchestrator** described in SOP §18 ("Subagent-per-batch — autonomous
phase runs"). `autopilot` is the kit's first-party **unattended-execution command**: given a plan
that already exists (epics, features, stories with paired testplans, an Implementation Strategy),
it drives the whole thing to done without an operator opening a session per chat — resumable,
fail-halting, bounded, and logged. It is a **utility, not a chain member** (ADR-0047) — it
composes `start-phase`, `execute-batch` / `execute-batch-parallel`, and `close-phase`; it does not
reimplement any of their contracts, and it carries no `Next:` pointer of its own.

## Entry gate — explicit operator authorisation (MANDATORY, before anything runs)

Autopilot **never self-starts**. Before dispatching a single subagent, it requires an explicit,
in-chat operator **authorisation** naming the scope (which phase(s) / epic) and the **stop
condition** (below). Once authorised, **log the authorisation** the same way `close-phase` logs a
merge approval — a one-line append to `10-Inbox/APPROVALS.md` (ISO-8601 timestamp, what was
authorised, `by: operator`, `gated: autopilot entry`), per the kit's approval-logging convention,
so the sign-off survives beyond the chat transcript. Unattended writes to the board and phase
branches are exactly the risk this gate exists to bound; skipping it is not a shortcut — it is the
one thing this skill refuses to do without a human's word.

## Scope + stop condition (resolve before dispatch)

Take an **explicit** target from the operator — one or more phases, an `EPIC-NN`, or "until the
Implementation Strategy is exhausted" — never infer scope from ambient state (mirrors
`start-phase` Step 1). Authorisation must also name a **stop condition**; accepted forms:

- `max-phases: N` — stop after N phases close, however many chats that takes.
- `max-duration: <duration>` — stop once elapsed wall-clock time exceeds the bound.
- `stop-at-end-of-EPIC-NN` — run until the named epic's last phase closes, then stop.

No stop condition, no run — this bounds autonomy so a mis-scoped invocation cannot silently
consume the whole board.

## The chain it drives

For each phase in scope, in order:

1. **`start-phase`** — resolve the phase's stories, gate entry (clean tree, on `main`, every
   story DoR-ready), cut `phase/<phase-id>` off `main`, record the open on the board.
2. **Each chat's `execute-batch`, dispatched per the subagent-per-batch contract** (SOP §18,
   hardened by STORY-21.3.02) — the orchestrator dispatches every chat as its own **fresh-context
   subagent** (Dev/QA hat), one chat at a time, sequentially; the orchestrator stays PM hat
   throughout, reconciling the board between chats. A chat whose lanes are provably parallel
   (ADR-0075) but whose dispatched batch subagent cannot itself fan out (the nesting wall) falls
   back to the **ADR-0081 parallel-lane rule**: the orchestrator runs that one chat itself, in the
   main thread, by invoking `execute-batch-parallel` directly, then resumes PM-hat dispatch for
   the next chat.
3. **`close-phase`** — once every chat in the phase reports `executed`, run the phase's
   Definition-of-Done gate, compile the retrospective, and perform the gated merge to `main`.

Repeat for the next phase in scope until the stop condition fires or the plan is exhausted.

## Checkpoint + resume — the board is ground truth

Autopilot writes a durable checkpoint to
`_00-Project-Management/41-Reports/AUTOPILOT-CHECKPOINT.json` after every atomic boundary (chat
dispatch, chat completion, phase open/close, pause). Fields:

```json
{
  "run_id": "<uuid-or-timestamp>",
  "started_at": "<ISO 8601>",
  "authorised_by": "operator",
  "stop_condition": "max-phases: 2",
  "current": { "phase": "EPIC-21", "chat": "CHAT-03", "story": "STORY-21.3.05" },
  "completed": { "chats": ["CHAT-01", "CHAT-02"], "stories": ["STORY-21.3.01", "STORY-21.3.02"] },
  "branch": "phase/epic-21",
  "paused": { "at": "<ISO 8601>", "reason": "usage threshold", "resume_at": "<ISO 8601>" }
}
```

`paused` is `null` while running. On **resume** — crash, manual pause, or a fresh session picking
the run back up — autopilot does **not** trust the checkpoint blindly: it **re-reads every
story's `status:` and every chat's `executed` flag** and reconciles against those, because **the
board wins**: story status and chat `executed` flags are **ground truth**; the checkpoint is a
**hint** that narrows where to look, never the source of truth. Resume must **skip already-done
stories and already-executed chats**, picking up from the first not-done story in the first
not-executed chat — never redoing completed work. If the checkpoint and the board ever disagree
(checkpoint says a story is mid-flight but the board already shows it `done`, or the reverse), the
board's recorded status wins and the checkpoint is corrected to match it, not the other way round.

## Fail-stops-the-chain

A failed TC, a raised BUG, or a batch subagent that does not report the full success triple (all
stories `done`, all TCs passing, the chat's `executed` flag set) **halts** the run immediately —
autopilot never continues to the next chat or phase over a partial batch. On halt: write the
checkpoint (so the run is resumable), append the halt to the run log, and report — phase / chat /
story, what's `done`, what's blocked, what's still `ready` — rather than retrying silently or
skipping ahead. This is the same halt-and-report contract SOP §18 defines for the orchestrator;
autopilot is that orchestrator, running across phases instead of one chat at a time.

## Guardrails — bounded, logged, authorised

- **Stop condition** (above) is mandatory at entry — `max-phases`, `max-duration`, or
  `stop-at-end-of-EPIC-NN`; a run without one never starts.
- **Run log** — every run writes `_00-Project-Management/41-Reports/AUTOPILOT-RUN-<date>.md`:
  what ran (phases / chats / stories), what paused it (if anything) and when, when it resumed, and
  the final stop reason. Append to the same day's file across a same-day pause/resume; start a new
  dated file for a run spanning into a new day.
- **Operator authorisation** (above) gates entry — nothing runs unattended without it.

## Model tiering — quality-first dispatch (operator requirement 2026-07-17)

Autopilot's dispatch contract is explicit **model tiering**, not one model for everything:

- **The highest-capability model available orchestrates the whole run and performs every
  review/verification pass.** The orchestrator's own reasoning (scope resolution, board
  reconciliation, halt decisions) and every AI-code-review / DoD-verification pass always use the
  strongest model on offer — review by the higher model is **never skipped**, regardless of which
  model implemented the story.
- **Cheaper, smaller-tier models may implement individual stories**, assigned by
  complexity/risk: docs and small, well-scoped fixes route to a cheaper tier; anything touching
  schema, parsers, concurrency, or security routes to the high tier regardless of estimated size.
- **Quality first — when in doubt, escalate.** Assignment is quality-first: an **ambiguous** or
  **high-risk** story always **escalates** to the higher model rather than risking a cheap-tier
  miss — the rule resolves every tiering call upward on doubt, never down.

## Parallel-lane rule (ADR-0081)

When a chat's lanes are marked parallel and the dispatched batch subagent hits the nesting wall,
**the orchestrator runs that chat itself** — invoking `execute-batch-parallel` directly in the
main thread — rather than letting the subagent silently serialise it. See ADR-0081 for the full
rationale; autopilot inherits this rule unchanged from the subagent-per-batch contract it drives.

## Usage-capture integration

After each chat's `execute-batch` (or the orchestrator's own `execute-batch-parallel` run under
the ADR-0081 fallback) finishes, run:

```bash
node _00-Project-Management/93-Scripts/usage-capture.js --chat <CHAT-NN>
```

exactly as `execute-batch` already does at chat end, so the run's actual token spend is
attributed per-chat regardless of whether a human or autopilot drove the chat. A
usage-source-unavailable no-op is fine — it exits 0 and never blocks the chain.

## Usage governor

Autopilot watches live usage so an unattended run never tears down mid-story at the account's
usage limit. STORY-21.3.04 / ADR-0085 splits this into two halves: **signal acquisition**
(environment-dependent — whatever live usage/limit surface the harness exposes to the
operator/orchestrator at runtime, read as a percent-of-window-consumed + reset-time pair) and
**decision logic** (`_00-Project-Management/93-Scripts/usage-governor.js`, a pure, fixture-tested
Node helper that takes that signal and returns one decision). Autopilot is the caller that
obtains the signal by whatever means the install actually offers and hands it to the helper —
the helper never reaches out to a live system itself.

This is a **different granularity** from ADR-0079's per-story usage capture, and neither
substitutes for the other: ADR-0079 measures actual tokens a specific story/chat consumed, after
the fact, for budgeting and estimate-seeding; the governor's signal measures how much of the
live rolling usage window is consumed **right now**, and when it resets — a runtime enforcement
signal, not a spend ledger. A story can look normal on ADR-0079's per-story count while the
account is nonetheless near its window limit from usage elsewhere in the same window.

**When to consult it:**
- **Before dispatching each chat** — an affordability pre-flight. If a chat's projected usage
  (from STORY-21.2.02 estimates) won't fit the remaining window budget, the governor returns
  `pause-before-next` and autopilot pauses **before** starting that chat rather than mid-way
  through it.
- **At every atomic boundary** (chat start, chat end, phase open, phase close) — a threshold
  check against the configured pause threshold (default **92** percent, override with
  `--threshold`; never hardcode-only).

```bash
node _00-Project-Management/93-Scripts/usage-governor.js \
  --percent-used <n> --reset-at <iso> [--threshold <n, default 92>] \
  [--projected-next <tokens>] [--window-budget <tokens>]
```

The helper prints one line of JSON:
`{ "action": "continue" | "pause-before-next" | "pause-now" | "pause-and-ask", "reason": "...", "resume_at": "<iso>|null" }`.

**On `pause-now`** (percent-used has reached the threshold): the **DRIVER owns atomicity**
(ADR-0083) — autopilot finishes (or cleanly rolls back) the **current atomic unit** first; the
governor only decides WHEN to pause, never HOW to unwind in-flight work. Once the unit is
finished, autopilot writes the checkpoint's `paused` block (`at`, `reason`, `resume_at` — ADR-
0083), where `resume_at` is the governor's `reset_at`, passed straight through. Autopilot then
**schedules resume at that reset time** via the harness's wake/scheduling mechanism (the generic
"wait for reset, then continue from the checkpoint" primitive named in BACKLOG-0087 — e.g. a
cron-style scheduled wake) and continues from the checkpoint once it fires.

**On `pause-before-next`** (the affordability pre-flight fails): autopilot pauses before starting
the chat, writes the same `paused` checkpoint block, and schedules resume the same way.

**On `pause-and-ask`** (the live signal is missing or invalid — the mandated degraded mode):
autopilot **never guesses and never barrels on**. It pauses at the next atomic boundary and asks
the operator directly, rather than assuming a percentage or continuing blind.

**Manual pause and manual resume are always available to the operator**, independent of the
governor's own decisions — an operator can pause a run at any time, and can manually resume a
governor-paused or manually-paused run without waiting for the scheduled wake, the same way any
other checkpointed pause is resumed (board-wins reconciliation, ADR-0083).

## Non-negotiable rules (from CLAUDE.md / SOP §18)

- Operates as **PM-hat orchestrator**; each dispatched chat subagent is **Dev/QA hat** —
  one-hat-per-session is preserved by the fresh-context isolation itself, not violated by it.
- **Never switch branches** — all dispatched subagents share the working tree and the phase
  branch; commit on the phase branch only (SOP §18's branch/worktree-sharing rule).
- Status flips, DoR/DoD gates, MONITOR/ACTIVE updates, and per-story commits still happen exactly
  as `execute-batch` / `close-phase` define them — autopilot changes *who* opens each session, not
  what each session may do.
- ADR-on-the-spot for any non-obvious decision made while driving the run; BUG auto-raise on any
  TC failure or defect, filed before the halt is reported.

## End-of-session summary (always emit, on halt, pause, or stop-condition exit)

- Run id, scope (phases in target), stop condition.
- Phases closed / chats executed / stories done — vs what remains.
- Halt or pause reason (if any) and the checkpoint path to resume from.
- Run log: `41-Reports/AUTOPILOT-RUN-<date>.md` — written / appended: yes/no.
