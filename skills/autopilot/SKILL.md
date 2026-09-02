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

### Authorisation NAMES A PLANNED RUN when the target has a track (ADR-0187)

**Before accepting any scope, read the target epic's strategy sidecar
(`41-Reports/execution-strategy/EXECUTION-STRATEGY-*.json`) and look for `autopilot_runs[]`.**

- **If the sidecar carries a non-empty track: authorisation MUST name one of its runs by id**
  (`RUN-01`, `RUN-02`, …). A chat-described scope is **REFUSED** — not because prose is
  imprecise, but because a scope invented in the authorising chat has no written projection
  behind it, so nothing afterwards can falsify it. "Do EPIC-31" is not an authorisation when
  `RUN-01` and `RUN-02` exist and disagree about what belongs together.

- **The refusal NAMES THE AVAILABLE RUNS.** A refusal an operator cannot act on is a wall. Say,
  verbatim shape:

  > Refusing to start: `EXECUTION-STRATEGY-2026-08-10.json` carries an autopilot track for
  > EPIC-31, so authorisation must name a run from it. Available: **RUN-01** (CHAT-02, CHAT-01 ·
  > 5 stories · `max-phases: 2`), **RUN-02** (CHAT-03 · 2 stories ·
  > `stop-at-end-of-EPIC-31`). Re-authorise naming one, or say explicitly that you are
  > overriding the track and why.

  **Every field in that menu is READ FROM THE RUN, never remembered.** The stop condition
  especially: it is the one the operator is authorising, and the two runs above genuinely differ
  (`max-phases: 2` stops after two phases whatever is left of the epic). Quoting the wrong one
  buys an authorisation for a run the operator did not agree to. `plan-vs-actual.test.js ::
  authorisation-seam` asserts the FACT — every run id this menu quotes carries the stop condition
  the sidecar declares — so the example above cannot drift from the emission it cites.

- **The named run's scope IS the run plan's scope.** Pass the reference straight through to
  `autopilot-plan.js` and **transcribe** the run — do not re-derive its tiering or its ordering:

  ```bash
  node _00-Project-Management/93-Scripts/autopilot-plan.js \
    --slug <scope-slug> --date <YYYY-MM-DD> \
    --track 41-Reports/execution-strategy/EXECUTION-STRATEGY-<date>.json --track-run RUN-01 \
    --stop-condition "<verbatim from the run>" --authorised-by "<operator, and how>" \
    --chat <each chat of the run, in the run's order> \
    --story <each story, in the run's risk-first order> \
    --tier <STORY-ID>=<the run's tier for it>
  ```

  `verifyTrackReference()` fails a plan whose scope, order, tiers or stop condition **disagree**
  with the run it names — and, since the phase-2 review, a plan that **omits** a tier the run
  declared (`tier-dropped`, naming the story). One `--tier` per story of the run, every time:
  a story the plan does not tier runs at the plan body's prose **Default tier**, which is a
  silent downgrade nothing in the plan records. Both flags or neither: half a citation cannot be
  followed.

- **AN EMPTY TRACK (`autopilot_runs: []`) IS A THIRD STATE, AND IT IS AN ANSWER.** ADR-0184 §1
  mandates it for an epic with nothing to run, and insists it is a *different fact* from an
  absent key. The refusal above does not fire — it is worded "non-empty" — but do not treat `[]`
  as the pre-track case either. **Say which one you met:** *"EPIC-NN's sidecar carries an empty
  autopilot track, so the strategist saw nothing to run unattended here — authorising by chat
  scope."* An operator who is not told cannot tell "the strategist looked and found nothing" from
  "nobody ever grouped this epic", and those call for different next moves.

- **PRE-TRACK FALLBACK — explicit, never silent.** An epic planned before ADR-0184 has **no
  `autopilot_runs` key**, and an absent key is not an empty track. For those, authorisation falls
  back to the current chat-scope path, and the run plan is written **without** `--track` /
  `--track-run`. **Say so out loud** in the authorisation exchange and in the run log — e.g.
  *"EPIC-29's sidecar predates the autopilot track, so this run is authorised by chat scope; the
  plan will carry no track reference and plan-vs-actual will report it pre-seam"* — because a
  reader who is not told will read the missing reference as a step that was skipped. Every plan
  already on disk in this repository, including this run's own, is in exactly that state.

## Run plan — written BEFORE the first dispatch, and failing to write it BLOCKS (ADR-0151)

Authorisation is a document, not a chat message. Before the first story is dispatched — not during,
not after — autopilot writes a reviewable run plan:

```bash
node _00-Project-Management/93-Scripts/autopilot-plan.js \
  --slug <scope-slug> --date <YYYY-MM-DD> \
  --stop-condition "<max-phases: N | max-duration: … | stop-at-end-of-EPIC-NN>" \
  --authorised-by "<operator, and how the authorisation was given>" \
  --usage-budget "<the run's budget and its units>" \
  --chat <CHAT-ID> … --story <STORY-ID> … --tier <STORY-ID>=<low|high> …
```

It renders `_00-Project-Management/41-Reports/AUTOPILOT-PLAN-<run_id>.md` from
`91-Templates/AUTOPILOT-PLAN.template.md`, and appends the APPROVALS.md entry **referencing that
plan by its repo-relative path** — so the sign-off points at a document a reader can open.

**This is the one place in the kit where failing to write is blocking, and the asymmetry is
deliberate.** Everywhere else — every reflection, every retro line — capture must never block work,
because a record that could not be written must not strand a story. Authorisation is the opposite:
an unattended run that dispatched without a written, reviewable scope is exactly the risk this skill
exists to bound. So if the plan cannot be written, `autopilot-plan.js` **exits 3, names the path it
could not write, and no story is dispatched**. Diagnosed at 2am, `could not write <path>: ENOTDIR` is
a fix; a hang is not.

`run_id` originates here and is `autopilot-<YYYY-MM-DD>-<slug>`. **The same string** goes into the
checkpoint's `run_id` and the ledger's `run`-level record id, so plan, checkpoint and ledger join
without a lookup table. Never mint a second id downstream.

Scope in the plan is **structured, not prose**: `scope_stories`, `scope_chats` and `tier_plan` are
flat YAML lists in its frontmatter, because `93-Scripts/plan-vs-actual.js` subtracts the executed set
from them after the run. Prose in the body is commentary on those lists, never a substitute for them.

## Entry probe — does this install have a usage signal at all? (STORY-26.5.01, ADR-0154)

After the run plan is written and **before the first dispatch**, probe for a live usage signal:

```bash
node _00-Project-Management/93-Scripts/autopilot-entry-probe.js \
  --run-id <run_id> --phase <EPIC-NN> \
  [--acknowledge-signalless "<what the operator is accepting, in words>"]
```

> **THIS HARNESS EXPOSES NO USAGE SURFACE.** There is nothing here to read a percentage from, so
> the probe will refuse (exit 3) and **`--acknowledge-signalless "<text>"` is the only sanctioned
> way past that refusal in this install**. Hitting exit 3 means a human has to say, in words, that
> they accept running without usage protection — it does not mean "supply the numbers yourself".

`--percent-used <n> --reset-at <iso>` exist for **an install that genuinely has a usage surface a
caller can read**. Typing them here does not create one: the probe records
`signal_source: cli-flags` on the ledger for anything supplied that way, so a caller-typed value
can never again be mistaken for a live read (ADR-0156). Values are validated as well as recorded —
`--percent-used` must be a number in 0..100 and `--reset-at` must be an ISO-8601 instant with a
zone designator, so `--reset-at 0` is refused rather than parsed into the year 2000.

A run that has no way to measure its own spend must find that out **at entry, not at 2am**. The
probe checks the SHAPE of whatever it acquired, then hands it to `usage-governor.js` —
`pause-and-ask` *is* the governor's verdict of "that is not a usable signal", so the usability
rules live in one place — and takes one of three designed paths:

| probe outcome | decision | dispatch | exit |
|---|---|---|---|
| a usable signal was acquired | `proceed` | yes | 0 |
| **no usable signal, no acknowledgement** | **`refuse`** | **no** | **3** |
| no usable signal + `--acknowledge-signalless "<text>"` | `proceed-degraded-acknowledged` | yes | 0 |

**Exit 3 means do not dispatch.** Refuse is the default and the acknowledgement is the only way
past it — a string a human wrote, not a boolean, recorded on the ledger at `run` level along with
the probe outcome **and its `signal_source`**, so a later reviewer can see what the run knew about
its own instrumentation *and where it thought it knew it from*. A probe that *itself* throws is
treated as "no signal", never as a crash.

**ADR-0091 — governor degraded mode — entry authorisation answers the pause-and-ask for the authorised scope
is superseded by ADR-0154 — the entry probe refuses a signal-less run unless the signal-less state is acknowledged by name
and its carve-out is withdrawn.** A generic entry authorisation is **not** an answer to the
governor's `pause-and-ask`: consent to run without usage protection must be given in words at
entry, not inferred from a "go". Do not cite ADR-0091 as live guidance.

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

### Executed truth across the two tracks (ADR-0186)

Autopilot drives the **chat track**: `execute-batch` sets each chat's `executed` flag, exactly as
it does for a human session. **Autopilot writes nothing into `autopilot_runs[]`** — a run has ten
fields (ADR-0184) and none of them is an executed flag, and a second flag over the same corpus is a
double count that stays plausible.

"Once every chat reports `executed`" therefore means **the reconciled state**, not the raw flag: a
chat whose stories are all `done` counts as covered even when nothing flipped its flag
(`93-Scripts/lib/track-reconcile.js` renders that as `covered-by-reference`, naming the covering
run). The board wins, as it already does at resume.

**Pass `--run <run_id>` to every `retro-capture.js` invocation this run makes.** Without it the
writer stamps the honest `run_id: "unattributed-run"` marker, and the board can then only classify
that chat's executed run-kind as `unattributed` — it will NOT guess `batch`, and it will not guess
`autopilot` either. Measured on 2026-08-10 over 124 records, seven carry that marker and **two** of
them are chat-level (`E29-CHAT-02`, `E29-CHAT-03`) — both dispatched by
`autopilot-2026-08-05-epic28-29-32a`, which is the point: the marker is on real autopilot chats.
One flag on one command is the difference between a recorded fact and a permanent blank.

Repeat for the next phase in scope until the stop condition fires or the plan is exhausted.

## Branch assertion — before EVERY chat dispatch (STORY-26.5.03)

Dispatched subagents share one working tree. Before each chat is dispatched — not once per run,
and never a cached verdict — assert that the tree is still on the phase branch recorded for the
run:

```bash
node _00-Project-Management/93-Scripts/autopilot-branch-assert.js \
  --run-id <run_id> --phase <EPIC-NN> --chat <CHAT-NN>
```

**Do not hand it `--expected` from `git rev-parse`.** With no flag the expectation is read from
the run's checkpoint `branch` field, recorded by `start-phase` when it cut the branch (ADR-0157).
That is the point: `found` already comes from git, and an `expected` derived from the *same* call
makes a check that can only ever pass. A run whose checkpoint records no branch HALTS (exit 4)
rather than passing — pass `--expected phase/<phase-id>` explicitly only when you are asserting
against something the checkpoint does not know. Every verdict and ledger line carries
`expected_source` (`flag` / `checkpoint` / `none`) so the origin is auditable afterwards.

**Exit 4 means HALT: do not dispatch.** Three conditions all halt — a different branch, a
**detached HEAD**, and a git state that cannot be read at all. The last is deliberate: *"we could
not tell"* is not *"it was fine"*, and a half-locked repository is exactly where drift hides.

**A mismatch is never auto-corrected.** Autopilot does **not** check out the expected branch:
uncommitted work may be sitting in the drifted tree and a checkout can destroy the evidence a
human needs. It halts, prints a message naming **which branch was expected and which was found**,
and records both at the `run` level of the ledger. Then a person looks.

The check adds **no interactive prompt** — an unattended run completes it alone. Halting and
reporting is not the same as asking.

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
  "paused": { "at": "<ISO 8601>", "reason": "usage threshold", "resume_at": "<ISO 8601>" },
  "state": "running",
  "terminal": null
}
```

`state` is one of `running` / `paused` / `completed` / `halted` (ADR-0152). **Do not hand-write a
terminal one.** While the run is in flight, leaving `state` absent is correct — the reader derives
`running` or `paused` and reports `state_source: derived`, so an inference never masquerades as a
record. An ENDING is written at a run boundary, by the script, and only there (see below).

`branch` is **written when the phase is opened**, by the thing that cut the branch, and it is the
authoritative source for `autopilot-branch-assert.js --expected` (ADR-0157). It is carried by
`autopilot-checkpoint.js` — always present, `null` when not recorded — and a `null` there makes the
branch assertion HALT rather than pass. It documented a field nothing implemented until ADR-0157;
if you are reading a checkpoint written before that, expect `null`.

`paused` is `null` while running. On **resume** — crash, manual pause, or a fresh session picking
the run back up — autopilot does **not** trust the checkpoint blindly: it **re-reads every
story's `status:` and every chat's `executed` flag** and reconciles against those, because **the
board wins**: story status and chat `executed` flags are **ground truth**; the checkpoint is a
**hint** that narrows where to look, never the source of truth. Resume must **skip already-done
stories and already-executed chats**, picking up from the first not-done story in the first
not-executed chat — never redoing completed work. If the checkpoint and the board ever disagree
(checkpoint says a story is mid-flight but the board already shows it `done`, or the reverse), the
board's recorded status wins and the checkpoint is corrected to match it, not the other way round.

## Every run ends at a named boundary, and the boundary writes it (STORY-29.1.02)

A run that reached its stop condition and a run whose harness died at 3am used to produce
**byte-comparable checkpoints**, which is why ADR-0152 enumerated the terminal states. Nothing
wrote them, so `completed` was unreachable and the distinction stayed theoretical. It is now the
last step of each ending:

```bash
node _00-Project-Management/93-Scripts/autopilot-checkpoint.js \
  --finish <run_id> --boundary <boundary-id> --reason "<what ended it, in words>"
```

| boundary | records | when |
|---|---|---|
| `stop-condition-reached` | `completed` | the authorised stop condition fired |
| `plan-exhausted` | `completed` | every phase in scope closed; nothing left to dispatch |
| `fail-stops-the-chain` | `halted` (`gate-failure`) | a failed TC, a raised BUG, or a batch without the full success triple |
| `operator-stop` | `halted` (`operator-stop`) | a human stopped the run deliberately |
| `governor-degraded` | `halted` (`governor-degraded`) | the run stopped rather than guess at a missing usage signal |
| `abandonment-detected` | `halted` (`unknown`) | an operator confirms a stale run is over |

`node …/autopilot-checkpoint.js --boundaries` prints this table from the code, so it cannot drift
from what the script accepts.

**Never fake an ending.** There is no exit hook and nothing promotes a stale run to `halted` on a
timer: a run that died leaves a **stale non-terminal state**, and that absence *is* the died
signal — `--unfinished` reports it as *"IN FLIGHT OR DIED — no ending was recorded at any run
boundary"*. Tidying a crash into a terminal state would destroy the one distinction this design
exists to make. `abandonment-detected` is a boundary a **human types** after reading a stale-run
notice; the detector never writes it.

**A terminal state is never rewritten.** Recording the same ending twice is a no-op (a retried
close-out must not be what stops a run saying it finished); recording a *different* one is refused
— "it completed, no, it halted" is something a person should look at.

## Resume after a HALT — an acknowledgement gate (STORY-26.5.04, ADR-0160)

Resuming a `paused` run is routine. Resuming a **`halted`** one is not: `halted` means the run
stopped **without reaching its stop condition** (ADR-0152), so something unresolved sits in
front of it. Before any unit is dispatched on a halted run:

```bash
node _00-Project-Management/93-Scripts/autopilot-halt-ack.js \
  --run-id <run_id> [--phase <EPIC-NN>] [--chat <CHAT-NN>]… \
  [--acknowledge "<what you are accepting, in words>"] [--record]
```

**Exit 6 means REFUSED: do not resume.** A code of its own — 3 is the entry probe's refusal, 4
the branch assertion's halt, 5 the divergence flag — so an unattended caller can tell them
apart. The gate is scoped to halts: a `paused`, `running` or `completed` checkpoint returns
`not-required` and exit 0, deliberately, because a gate that fired on every resume would be
turned off.

**The reason is presented before the acknowledgement is asked for**, so the answer is informed
rather than reflexive. It is read from **both** spellings this repository uses — the `terminal`
block's `halt_reason`, and the hand-written top-level `halt` block — and the verdict names which
one answered (`reason_source`). A halt whose reason was never recorded takes the documented
**acknowledge-blind** path: the absence is presented as the thing being acknowledged, the record
carries a null reason, and the run is not left permanently unresumable.

**The acknowledgement is a string a human wrote, not a flag.** `--acknowledge` with no text is
not an acknowledgement. It is recorded at the `run` level of the ledger under
`resume_authorisation` (`acknowledged-halt` / `halt-unacknowledged` / `not-required`) alongside
`acknowledged_halt_reason`, so an acknowledged resume and one that simply proceeded are
different lines rather than the same line with different prose — **and refusals are recorded
too**, or "how often did this stop somebody?" would be unanswerable. `--record` additionally
writes it onto the checkpoint, which makes it durable: a later resume reads it back and does not
ask again.

**An acknowledgement is not a licence to start over.** The resume dispatches only the units the
checkpoint's `completed.chats` does not already list, and acknowledging leaves the terminal
state exactly as it was — clearing it would destroy the evidence a later reader needs.

## Divergence check — code landed, the board never noticed (STORY-26.5.05, ADR-0155)

At the end of each chat, and again after any halt, ask whether a commit on the phase branch names
a story the board has not closed:

```bash
node _00-Project-Management/93-Scripts/commit-status-divergence.js \
  --run-id <run_id> --phase <EPIC-NN> --chat <CHAT-NN>
```

**Exit 5 means one or more were found — a flag for triage, not a halt.** The distinguishing rule,
which is the check's own and is derived from the kit's status enum rather than paraphrased here:

- `done` / `wontfix` / `duplicate` / `archived` — **closed**. The commit is the work landing, or a
  closure being recorded. Never reported.
- **`in-progress` / `in-review` — work in flight.** A checkpoint commit from a live session: the
  board has not caught up **yet**, which is a different thing from never catching up. Reported in
  its own list, never as a divergence.
- `not-started` / `ready` / `blocked` — **reported**. Code landed for work the board says nobody
  has picked up, or that is stopped.

**Nothing is corrected.** Autopilot leaves the story's frontmatter exactly as it found it and
never repeats work that already landed — doing the work twice is the worst outcome available
here, which is the whole reason this check reports and then stops. A person triages it.

Each detection carries the story, the commit, the observed status, and whether the commit went
near the story's own artefact file. Detections are recorded at the `run` level of the ledger so
they survive the session.

## Fail-stops-the-chain

A failed TC, a raised BUG, or a batch subagent that does not report the full success triple (all
stories `done`, all TCs passing, the chat's `executed` flag set) **halts** the run immediately —
autopilot never continues to the next chat or phase over a partial batch. On halt: write the
checkpoint (so the run is resumable), **record the ending at its boundary** —

```bash
node _00-Project-Management/93-Scripts/autopilot-checkpoint.js \
  --finish <run_id> --boundary fail-stops-the-chain --reason "<the TC / BUG / missing triple>"
```

— append the halt to the run log, and report — phase / chat / story, what's `done`, what's
blocked, what's still `ready` — rather than retrying silently or skipping ahead. This is the same halt-and-report contract SOP §18 defines for the orchestrator;
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
node _00-Project-Management/93-Scripts/usage-capture.js --chat <CHAT-NN> --phase <EPIC-NN> --run <run_id> --stories <the chat's story ids>
```

exactly as `execute-batch` already does at chat end, so the run's actual token spend is
attributed per-chat regardless of whether a human or autopilot drove the chat. Pass `--run` so
the record carries the run beside its join key (ADR-0179) instead of the unattributed marker. A
usage-source-unavailable no-op is fine — it exits 0 and never blocks the chain.

### Story brackets: only where a boundary is observable (STORY-29.3.03 / ADR-0190)

The rule autopilot inherits from `execute-batch`, applied per chat according to that chat's lanes:

- **Serial lanes** — a story boundary is observable, so bracket each story as it closes:
  `usage-capture.js --story <id> --since <the previous boundary>`. The chat record is still
  written afterwards.
- **Parallel lanes, or the ADR-0081 fallback** — no boundary is observable, so write **no** story
  records. The chat record's `--stories` names the constituents and the rollup reports them as
  "N tokens across [stories], not split".

**Never prorate.** An unattended run producing per-story figures by division would manufacture the
exact calibration data the next run plans against — a fabricated number is worse here than a
missing one, because nobody is watching when it is written.

## Capturing the decisions the run makes (STORY-26.4.03, ADR-0153)

Which tier a unit went to, what it was estimated to cost, and every governor decision — these are
judgement calls made at 2am and today they are acted on and thrown away. Capture them **as they
occur**, through the single writer:

```bash
# at dispatch — the tier, WHY, and the estimate (explicit null when the story carries none)
node _00-Project-Management/93-Scripts/autopilot-decision-capture.js tier \
  --run-id <run_id> --id <STORY-ID> --phase <EPIC-NN> --chat <CHAT-NN> \
  --tier <low|high> --reason <plan-declared|default-tier|complexity-escalation|risk-escalation|operator-override|fallback> \
  [--note "<free text, beside the enum not instead of it>"] [--usage-estimate <int>]

# every governor decision — routed to `pause` when it caused one, `run` when it did not
node _00-Project-Management/93-Scripts/autopilot-decision-capture.js governor \
  --run-id <run_id> --action <continue|pause-before-next|pause-now|pause-and-ask> \
  --percent-used <n> --threshold <n> [--reset-at <iso>] \
  [--resumed-at <iso>] [--resume-mechanism <text>]
```

**Every write goes through `retro-capture.js`** — the wrapper spawns it rather than writing anything
itself, so the never-blocking contract is inherited with the process rather than re-promised. **No
capture in this skill can fail a dispatch.**

**`--run-id <run_id>` is what makes the write a production write.** Every gate tool and every
capture in this skill resolves its ledger destination through one shared rule
(`93-Scripts/lib/ledger-target.js`, STORY-29.1.01): `--out <path>` wins; otherwise the production
`41-Reports/retro/retro-log.jsonl` is written **only** for a run this repository has a record of —
its `AUTOPILOT-PLAN-<run_id>.md` or its checkpoint. A run id nothing on disk knows records
**nothing at all**, and the tool prints the path it declined to write. That is why the tier capture
above carries `--run-id` alongside `--id`: the story id says which unit was dispatched, the run id
says which authorised run dispatched it.

**Exercising a gate ad-hoc — to see whether it still refuses — pass `--out <scratch path>`.**
Every tool in the family prints `--out` in its usage string and says what it is for. Before
STORY-29.1.01 the natural verification invocation (run it, read the exit code, pass no `--out`)
appended a fabricated `run` record to the calibration ledger three components read as fact; one
such line, `"id":"verify-junk"`, is still on it (BUG-20260804-37 / BUG-20260804-39). The verdicts
and exit codes are unchanged — only the destination is.

**READ ITS STDOUT, NEVER ITS EXIT CODE.** The writer exits 0 *including when it refuses a record*,
which is correct — refusing and crashing are different things — but it means an exit code cannot tell
"written" from "refused". This run has already lost a phase record that way. The wrapper reports
`NOT CAPTURED (refused): …` on stderr and dispatches anyway; that line is a defect to fix, not noise.

A story leaves **two** records sharing its `id`: `stage: "dispatch"` (tier, reason, estimate) and
`stage: "close"` (outcome). The ledger is append-only, so this is two records and never one amended
one, and `stage` is what lets a reader label them — `ts` only orders them. A story with no
`usage_estimate` records it as **explicit null, never 0**: an absent estimate is information, and a
fabricated zero would be averaged into estimate accuracy as though somebody had measured it.

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
the operator directly, rather than assuming a percentage or continuing blind. In an install with
**no** signal surface this answer would arrive at every boundary, so it is settled once at entry
instead — see the entry probe above (ADR-0154): the run either refuses to dispatch or carries a
recorded acknowledgement, and either way it never guesses a percentage.

**Manual pause and manual resume are always available to the operator**, independent of the
governor's own decisions — an operator can pause a run at any time, and can manually resume a
governor-paused or manually-paused run without waiting for the scheduled wake, the same way any
other checkpointed pause is resumed (board-wins reconciliation, ADR-0083).

## Operator guidance — what to expect, and what to do when it stops (FEAT-26.5)

Five behaviours can interrupt or annotate an unattended run. Each says here what you will see
and what action, if any, is expected of you. Operating instructions only — the reasoning is in
the ADRs named, and the specification is in PRD-Autonomous-Execution.

### The usage-signal probe, before the first dispatch

**What you will see.** `autopilot-entry-probe.js` runs before anything is dispatched. In this
install there is no usage surface to read, so it refuses with **exit 3** and prints
`entry-probe: no-signal -> refuse`, naming the field that failed when a value was offered.

**What to do.** Re-invoke with `--acknowledge-signalless "<what you are accepting>"` — a
sentence you write, not a bare switch — and the run proceeds and records your words. That is the
only sanctioned way past a refusal here. Do **not** type `--percent-used` / `--reset-at` to make
the refusal go away: those are for an install with a real surface, and anything supplied that
way is stamped `signal_source: cli-flags` on the ledger forever
(ADR-0154 — the entry probe refuses a signal-less run unless the signal-less state is acknowledged by name,
ADR-0156 — a usage signal is recorded with its provenance, and its shape is checked before the governor is asked).

### The branch assertion, before every chat dispatch

**What you will see.** `autopilot-branch-assert.js` runs before each dispatch. On a mismatch, a
detached HEAD, or a git state it cannot read, it **halts with exit 4** and prints which branch
was expected and which was found. Expected comes from the run checkpoint, not from git; a run
whose checkpoint records no branch halts rather than passing.

**What to do.** Look before you touch anything. It deliberately does **not** check out the
expected branch, because uncommitted work may be sitting in the drifted tree and a checkout can
destroy the evidence you need. Resolve the tree yourself, then re-run the assertion
(ADR-0157 — the expected branch is read from the run checkpoint, never re-derived from git).

### The commit-without-status-flip flag, at the end of each chat

**What you will see.** `commit-status-divergence.js` reports commits naming a story the board has
not closed, and exits 5 when it finds any. `in-progress` and `in-review` stories are listed
separately and are not divergences — the board has not caught up *yet*.

**What to do.** Triage, do not re-run the work. Exit 5 is a flag, not a halt: nothing is
corrected automatically, precisely because doing landed work twice is the worst outcome
available here. Decide whether the story should be closed or the commit reverted
(ADR-0155 — divergence is classified by the board's own status vocabulary, and path-scoping is rejected).

### A stale paused run, when you next open the project

**What you will see.** `autopilot-stale-runs.js` reports a paused run that is overdue, naming the
`run_id`, the reason and how long it has been stale. Two reasons exist: a `resume_scheduled` that
has passed, and a pause older than 24 hours that was never given a resume time at all. It always
exits 0 — read its output, never its exit code.

**What to do.** Usually nothing: it is a notice, and session-start reports it without touching
the checkpoint. If the pause was deliberate, say so once and the notice goes quiet until the
facts change: `autopilot-stale-runs.js --dismiss <run_id> --reason "<why>" [--by "<who>"]`. A
dismissal records WHO judged it (defaulting to `git config user.name`) as well as why, is keyed
to the EVIDENCE it was shown — so a run that resumes and pauses again, or trips the other
staleness arm, surfaces again by itself — and never touches the run's own checkpoint
(ADR-0180 — a stale-run dismissal is keyed to the evidence, requires a reason, and lives beside the checkpoint rather than on it).
`--include-dismissed` shows the judged set with its reasons at any time. If the run is genuinely
over, say so once and it stops being stale:
`autopilot-checkpoint.js --finish <run_id> --boundary abandonment-detected --reason "…"`. The
detector will never write that for you: it can see that nobody came back, not why, and `unknown`
is the honest cause. Finishing an **old** run writes that run's own record and prints
`live pointer LEFT ALONE` — `AUTOPILOT-CHECKPOINT.json` still belongs to the run you are in, and
is left byte-for-byte untouched
(ADR-0181 — a checkpoint write declares whether it is taking the live pointer, and the safe direction is the default). A run that already **recorded** an ending is reported as ended — with its
boundary and instant — and is never aged. Raise the threshold for one call with
`--max-paused-age-hours <n>`
(ADR-0159 — staleness has two arms, because a genuinely stale run may never have had a schedule to miss).

### The halt acknowledgement, before resuming a halted run

**What you will see.** `autopilot-halt-ack.js` refuses with **exit 6** and prints the recorded
halt reason first, so the decision is informed. If the halt carries no reason, it says so plainly
and asks you to acknowledge that absence rather than refusing outright.

**What to do.** Read the reason, then re-invoke with `--acknowledge "<what you are accepting>"`,
adding `--record` to store it on the checkpoint so a later resume does not ask again. Both the
refusal and the acknowledgement are recorded at `run` level under `resume_authorisation`.
Resuming runs only the chats the checkpoint has not completed; acknowledging never starts the
phase over, and never clears the halted state
(ADR-0160 — an acknowledged resume is a different ledger line, and a halt with no recorded reason is acknowledged blind rather than refused,
ADR-0152 — checkpoint terminal states are enumerated, and old-shape files are derived on read).

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

## End-of-turn completion check

Before ending a turn, check your last paragraph: if it is a plan, a question, or a promise of work not yet done, do that work now. End only when the batch is complete or blocked on operator input.

## End-of-session summary (always emit, on halt, pause, or stop-condition exit)

- Run id, scope (phases in target), stop condition.
- Phases closed / chats executed / stories done — vs what remains.
- Halt or pause reason (if any) and the checkpoint path to resume from.
- Run log: `41-Reports/AUTOPILOT-RUN-<date>.md` — written / appended: yes/no.
- **The ending, recorded**: on a stop-condition exit run
  `autopilot-checkpoint.js --finish <run_id> --boundary stop-condition-reached --reason "…"`, and
  `--boundary plan-exhausted` when the plan ran out instead. A pause is **not** an ending and
  records nothing here — it is resumable, and `paused` is not a terminal state.
