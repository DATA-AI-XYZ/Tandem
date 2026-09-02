---
name: execution-strategist
description: Plan how to execute a whole epic — group its stories into "chats" that are genuinely good to run together, the way a lead plans a sprint. Use when the user asks to plan execution, strategise an epic, group stories to run together, decide what to batch, or invokes /tandem:execution-strategist (typically with an EPIC-NN). Operates as PM hat. DRY-RUN: never modifies story status. Output schema (two paired report formats + the autopilot track): see the body.
---

# Tandem: execution-strategist (PM hat)

Operate as **PM hat**. After an epic has been planned, the user runs this skill to get the best
way to clear that epic's stories in a small number of batched "chats" — reasoning about which
stories are genuinely **good to do together** (a long view, like planning a sprint), not just
mechanical matching. The output (an **Implementation Strategy**) is the input to
`execute-batch` / `execute-story` and is rendered by the dashboard's Implementation Strategy view.

**What it emits (schema summary — moved here from the description under PRD R7):** takes an
epic, reads all its not-done stories + paired testplans, and writes an Implementation Strategy —
phases → chats, each with execution lanes (serial/parallel), sub-agents, a paste-ready trigger,
a verify-before-closing command, and depends/unlocks edges — as a markdown report PLUS a
structured JSON sidecar. It ALWAYS also emits an AUTOPILOT TRACK (`autopilot_runs[]`) beside the
chat track — the same stories regrouped into unattended runs of at most ten chats, each carrying
a paste-ready prompt, risk ordering and a stop condition.

This file IS the source of truth for the behaviour. Grouping is **judgment-led** (see ADR-0025):
two runs may differ, and that is acceptable — the plan is a dry-run proposal you review before
acting. Verification is therefore **structural** (does each chat carry lanes, sub-agents, a
trigger, a verify line, valid phases?), not exact-output matching.

## Dry-run contract (read-only — MANDATORY)

- It **reads** story + testplan frontmatter/content and **writes exactly two artefacts**: the
  Implementation Strategy report (`.md`) and its paired structured sidecar (`.json`), both under
  `41-Reports/`.
- It does **NOT modify story status**, does **NOT** flip anything to `in-progress`, does **NOT**
  edit any story, testplan, MONITOR, or dashboard. Acting on the plan happens later via
  `/tandem:execute-batch`. If asked to "start"/"pull" a chat, stop and clarify —
  that is `execute-batch`.

## Inputs needed

- **An epic identifier** — `EPIC-NN` (or a path under `32-Stories/EPIC-NN/`). If the user didn't
  supply one, ask: "Which epic? e.g. `EPIC-100`." Optionally a target date for the filename
  (default: today, system clock).

## Load into context

Use `Read` / `Glob` to detect existence; treat missing files as "not present", never throw.

- **Epic-scoped stories** — glob `_00-Project-Management/32-Stories/EPIC-NN/FEAT-*/STORY-*.md` for
  the named epic only. Keep every story that is **not-done** (exclude `done` / `wontfix` /
  `duplicate` / `archived`). This is the corpus — the whole epic, not just `ready` ones.
- **DoR flag** — a story whose `status` is not `ready` (e.g. `not-started`) is still **included**
  but **flagged** with a visible DoR-gap marker, so the user knows that chat needs
  `/tandem:refine-backlog` before it can actually run. Never silently drop it.
- **Paired testplans** — for each story, read `_00-Project-Management/33-Testplans/EPIC-NN/FEAT-*/TESTPLAN-NN.M.PP-*.md`
  (used to compose the verify line — see step 6).
- **Story frontmatter fields consumed:** `id`, `feature`, `estimate`, `priority`, `status`,
  `type_of_work`, `suggested_agents` (FEAT-03.1), `depends_on`, `files_touched` (ADR-0020).
- **PROJECT-CONTEXT.md** — `_00-Project-Management/90-Standards/PROJECT-CONTEXT.md` "Sub-agent
  mapping" (the `type_of_work → sub-agent` default map) + "Quality commands" (the DoD fallback
  for verify lines).
- **SOP** — `90-Standards/SOP.md` (status/estimate enums, §11.3 sub-agent resolution).
- **ADRs** — ADR-0020 (depends_on/files_touched), ADR-0023 (sub-agent metadata), ADR-0025
  (judgment-led determinism stance), ADR-0026 (soft batch-size bounds).

## Step 1 — Scope the epic

Collect the epic's not-done stories (above). For each, note id, title, feature, status, estimate,
priority, `suggested_agents`, `depends_on`, `files_touched`, and a `ready` boolean
(`status == ready`). Flag any not-`ready` story for the DoR-gap marker.

## Step 2 — Group into chats (JUDGMENT-LED)

**Reason** about which stories are genuinely good to execute together in one fresh chat — shared
domain, a dependency you'd want warm, the same files, a coherent slice of the epic. Think like a
lead planning a sprint, not a mechanical matcher. The old affinity signals (same FEAT,
`depends_on` chain, `files_touched` overlap) are **inputs to your judgment**, not the whole story.
Each chat gets a **one-line rationale** explaining *why these belong together*.

**Soft bounds (ADR-0026, amends ADR-0021):** aim for **2–5 stories** per chat. These are
**guidance, not hard caps** — you MAY deviate (a justified single-story chat, or a cohesive
6-story phase) when the reasoning warrants it, but you MUST record the deviation in that chat's
rationale. A story with no good companion is its own chat (note "runs solo — no good co-batch").

## Step 3 — Derive lanes (serial vs parallel)

Within each chat, mark how its stories sequence:

- **Serial** — stories linked by `depends_on` form an ordered chain (e.g. "serial (A → B)").
- **Parallel** — two stories are parallel-**safe** ONLY when their `files_touched` lists are
  provably **disjoint** (no shared path). Label e.g. "3 parallel (separate files)".
- **Default to serial** when `files_touched` is missing or overlap is uncertain — be
  **conservative**; never assert parallel you can't prove disjoint.

This skill only **plans** lanes. Actually running stories concurrently (fan-out) is **BACKLOG-0020**,
out of scope here.

## Step 4 — Assign sub-agents (per chat)

Resolve each story's sub-agent via the FEAT-03.1 order: the story's **`suggested_agents`** if set
→ else the **PROJECT-CONTEXT** `type_of_work → sub-agent` **map** → else discipline-only /
**`general-purpose`** **fallback**. An unknown/uninstalled agent never hard-fails — degrade to the
next step. Aggregate the distinct resolved agents per chat **with counts** (e.g.
`react-expert ×2, javascript-pro`) into the chat's `sub_agents`.

## Step 5 — Compose the paste-trigger (per chat)

A ready-to-paste prompt the user drops into a fresh chat. Template:

> Execute STORY-A, STORY-B together. [lanes: serial chain A → B / N parallel, file-isolated].
> Follow CLAUDE.md gates: paired testplan per story, auto-file BUG-* on any TC failure, atomic
> status → done. Sub-agents: [resolved list].

The trigger drives the existing `execute-batch` / `execute-story` flow — it does **not** invent a
new runtime.

## Step 6 — Compose the verify-before-closing line (per chat)

From each constituent story's **paired testplan**, collect the **P0 + integration** TC `Command`s
and join them with `&&` into one verify line (de-duplicate identical commands across the chat;
skip `manual-review-by-claude` TCs — they have no runnable command). **Fallback:** when a story
has no P0/integration TC, use the project **DoD quality gates** (lint / typecheck / test / build
from PROJECT-CONTEXT) plus `npm run pm:lint`.

**Exit-code gates only (MANDATORY — BUG-20260608-01).** Every gate in the verify line must rely on
the command's **exit code**, never on a substring of its output. Emit `npm run pm:lint >/dev/null
&& echo OK` (the script exits non-zero on any violation — let that gate). **Never** emit the
`npm run pm:lint 2>&1 | grep -E "violations" | tail -1` shape: the summary reads `N violation(s)`
(no bare `violations` substring) and a trailing `| tail` always exits 0, so that pipeline can never
fail and would green-light a dirty corpus. The same rule applies to any `grep … | tail`/`| head`
"gate" — a pipe into `tail`/`head` masks the real exit status.

**Discard stdout, NEVER stderr (BUG-20260824-04).** `>/dev/null` and `>/dev/null 2>&1` are not
interchangeable here, and this instruction used to say the latter — which the kit's own
`93-Scripts/tests/stderr-kept.test.js` rejects on every gated verify segment. A strategist that
followed this file to the letter therefore emitted a sidecar that turned the suite red before a
single story ran; measured 2026-08-24 on `EXECUTION-STRATEGY-2026-08-24.json`, ten segments across
five chats. **The exit code still gates and stdout is still noise — but a failing gate must be able
to say WHY**, and `2>&1` sends the reason to the same `/dev/null` as the noise, leaving an operator
with an exit code and a silent terminal at 2am. Emit `<cmd> >/dev/null && echo OK`; never append
`2>&1` to a gated step.

**Never re-emit `npm run pm:mirror`.** The scaffold-parity mirror gate was retired in ADR-0074 (the
script no longer exists in `package.json`), so a verify line that calls it would now hard-fail on a
missing script. Do not append `&& npm run pm:mirror` (or `npm run pm:mirror &&`) to any emitted
`verify` block. Historical sidecars that still carry it are a one-time cleanup, not a live gate.

## Step 6b — Generate chat and phase outcomes (`write-outcomes` rules, inline-first)

For each **chat** and for each **phase**, apply the `write-outcomes` rules inline to
synthesize a **fresh, founder-facing outcome line** — a single plain-text sentence describing *what
the founder will have* once that chat/phase lands (the new capability, not the implementation).
Dispatch a sub-agent only under ADR-0105 — write-outcomes runs inline first, rather than dispatching a sub-agent per artefact's
named conditions (this producer's own context is near its limit, or an isolation-worthy batch run).
**Critical nuance:** The outcome is a **fresh synthesis** of the grouped stories' collective value,
**NOT** a concatenation or list of individual story outcomes. Read the grouped stories' technical
scope and write one clean line. The line is verbatim (no
markdown, no "Outcome:" label, no quotes) written into the JSON sidecar's `chats[].outcome`
and `phases[].outcome` fields, and rendered in the markdown report.

**Ordering note (chats vs phases):** chats already exist by Step 2, so chat outcomes can be
synthesized here. **Phase outcomes are synthesized once Step 7 has grouped chats into phases** — the
phase set does not exist yet at this step, so run the phase-outcome dispatch after Step 7 (or treat
this step's phase pass as deferred until the phases are known). Either way a phase outcome is a
fresh synthesis of its constituent chats' collective value, not a concatenation of their lines.

## Step 7 — Order into phases + edges

Group chats into **ordered phases**, **foundation-first** (chats with no cross-chat dependency
come first; then themed phases). Compute chat-level **`depends_on` / `unlocks`** edges from the
cross-chat `depends_on` relationships between the constituent stories.

### Step 7b — Name every phase (the NAMING CONTRACT — MANDATORY)

Every phase carries **three fields**, and a phase missing any of them is **not emitted**
(ADR-0196 — canonical phase identity is a resolved record, and the Phases view slices by Phase N alone):

| field | what it carries |
|---|---|
| `number` | 1-based position **within this sidecar**, sequential, no gaps — `1`, `2`, `3` … |
| `title` | the phase's theme, WITHOUT the `Phase N` prefix — `Foundations`, `The views pass` |
| `description` | one sentence saying what this phase covers and why its chats belong to it |

Keep `name` as well and spell it `Phase <number> · <title>` so a human reading the raw JSON sees
the same identity the board renders. **The board's phase label is always `Phase N — <title>`** —
that is the vocabulary an operator filters by, and the Phases view slices by it and nothing else.

**Refuse to emit an unnamed phase.** "Untitled", `""`, a title that merely repeats `Phase 3`, or a
phase with no `number` are all the same defect: the reader gets a filter value they cannot read.
If you cannot say what a phase is about, the grouping is not finished — go back to Step 7.

Legacy sidecars written before this contract are read by DERIVATION (the board parses `Phase N ·
Title` out of `name`, and falls back to the phase's position plus its raw name). That is a
READER's tolerance for history, not a licence to keep emitting it: derivation cannot invent a
description, and a phase whose number is only its position was never actually named.

**RUN THE NAMING GATE ON THE SIDECAR YOU JUST WROTE:**

```bash
node _00-Project-Management/93-Scripts/tests/autopilot-track-shape.test.js \
  --case phase-naming --sidecar <the .json this session wrote>
```

Exit **0** or the emission is not finished. A non-zero exit names the phase and the field
(`phases[2] (Phase 3): \`description\` must say what this phase covers`); fix the sidecar and
re-run.

> **The gate is FORWARD-ONLY, and it has never yet run green on a live sidecar. That is by
> design — do not read the line above as already satisfied.** Every sidecar in this repo predates
> the contract, so pointing the gate at one of them exits **1**, naming every phase in it. Measured
> 2026-08-12 against the most recent live sidecar,
> `41-Reports/EXECUTION-STRATEGY-2026-08-01-03.json`: exit 1, all four phases
> missing `number` / `title` / `description`. ADR-0196 §2 records why the rule is not folded into
> `validateSidecar()`'s sweep across `41-Reports/` — 24 sidecars would fail on the day it landed,
> and "a gate that is red for reasons the current session cannot fix is a gate that gets `|| true`'d".
> So: **run it on the sidecar THIS session just wrote, and only that one.** A red from an older
> sidecar is history, not your emission; a red from yours is your emission, and it is the only one
> this step is about. (Recorded on the independent review of the EPIC-30 Phase 1 close, MINOR-9 —
> the instruction read as a routine re-run of something already known to pass.)

## Step 8 — Regroup into the AUTOPILOT TRACK (ALWAYS — never skipped, never a flag)

Phases and chats now exist. Regroup **the same not-done stories** a second time, for an
**unattended** run rather than a human session. This step is not optional and has no opt-in flag
(ADR-0184 — the autopilot track is always emitted into the same sidecar, its run shape is fixed at ten fields, and ties break in a written order,
operator-ratified 2026-08-05): an unused track costs a section, an absent one costs a 2am
improvisation.

**The two tracks are independent regroupings, not one grouping viewed twice**
(ADR-0182 — one story corpus, two groupings — and ADR-0026's bounds are human-session-only).
A chat groups stories so one person keeps context; an autopilot **run** groups **chats** so that a
halt costs the least already-verified work. They may disagree about what belongs together, and the
autopilot track may order chats differently from the phase order — say so in the run's rationale
when it does. **ADR-0026's 2–5 soft bounds do not apply here at all** — they govern a chat.

**Group for this objective, in strict priority order**
(ADR-0183 — the autopilot objective is safety-first, the cap is ten chats per run, and every run carries a paste-ready prompt):
**safety → result quality → speed**. Lexicographic, never weighted: a speed gain never buys a
safety loss. **Run count is an output, never a target** — do not aim for "2–3 runs".

**THE CAP IS HARD: no run contains more than 10 chats.** An eleventh chat splits the plan into
another run; there is no rationale that makes an over-cap run acceptable, and the shape test fails
one. The cap counts **chats**, not stories, because a chat is what autopilot dispatches,
checkpoints and resumes at.

**Tie-breaks, applied in order** (stop at the first that decides): 1. foundation-first across runs
· 2. fewer cross-run dependency edges · 3. run boundaries at phase closes · 4. risk-first inside a
run · 5. lower chat id first.

Emit each run with **all ten fields** — a run missing any one of them is invalid, not degraded:

| field | what it carries |
|---|---|
| `id` | `RUN-01`, `RUN-02`, … within this strategy |
| `title` | short name for the run |
| `chats` | ordered chat ids from **this sidecar's own chat track**, ≤10, no chat in two runs |
| `stories` | ordered **risk-first**: `{id, chat, risk_rank, risk_basis, tier, tier_reason}`, `risk_rank` non-increasing |
| `checkpoints` | `{after, review, tier}` — where the review passes land (`[]` if none inside the run) |
| `projected_usage` | `{tokens, counted, missing_estimates, basis}` — see the null rule below |
| `stop_condition` | autopilot's grammar only: `max-phases: N` / `max-duration: …` / `stop-at-end-of-EPIC-NN` |
| `halt_blast_radius` | at each boundary, what is already merged vs what unwinds |
| `parallel_lanes` | the ADR-0081 prediction: `{chat, provably_parallel, orchestrator_runs_it, basis}` (`[]` if none) |
| `prompt` | paste-ready and **self-contained** — see below |

- **Risk ordering.** `risk_rank` is an integer, higher = more likely to halt, and the sequence is
  **non-increasing** across the run. Every story states its `risk_basis`; a rank with no basis is a
  number, not a judgment. When a `depends_on` edge forbids risk-first order — the prerequisite is
  the *safer* story — declare the two ranks **equal** and say so in the basis
  (ADR-0185 — a dependency that forbids risk-first order is declared as equal rank and stated in the basis, never smoothed by demoting the dependant).
  Never demote the dependant to fake a descent.
- **Tiering.** `low` or `high` plus a one-line reason, resolved by autopilot's own
  **escalate-on-doubt** rule: schema, parser, concurrency, security or ambiguity → `high`
  regardless of estimated size. Doubt always resolves upward.
- **The null rule (do not fabricate a number).** `tokens` is the sum of the member stories'
  `usage_estimate` values and is **explicit `null` when nothing could be counted** — **never `0`**.
  `counted` + `missing_estimates` must equal the run's story count. Most of this corpus carries no
  estimate yet, so `null` with a missing count is the normal, correct answer.
- **Self-contained prompt.** It must name its own **run id**, the **sidecar file** it came from,
  **every chat** and **every story** in scope, its **stop condition verbatim**, the **entry gate**
  (autopilot never self-starts without operator authorisation) and a **verify** reference. A prompt
  that points at the sidecar instead of naming its scope is not paste-ready.

Verification is **structural** and lives in
`_00-Project-Management/93-Scripts/tests/autopilot-track-shape.test.js` — it checks the cap, the
ten fields, the monotone ordering, the null-honesty and the prompt, and it deliberately asserts
**no particular grouping** (ADR-0025).

**RUN IT ON THE SIDECAR YOU JUST WROTE, BEFORE THE SESSION CLOSES. This step is part of the
emission, not a later chore:**

```bash
node _00-Project-Management/93-Scripts/tests/autopilot-track-shape.test.js \
  --case real-emission --sidecar <the .json this session wrote>
```

Exit **0** or the emission is not finished. A non-zero exit names the run and the field
(`run[0] (RUN-01): missing required field \`halt_blast_radius\``); fix the sidecar and re-run —
do **not** report the track as emitted with the failure outstanding. The cap is hard and the ten
fields are required, but a rule enforced only by the next full-suite run is a rule a 2am session
ships past: the strategist writes prose-authored JSON, and this is the only thing between a
malformed track and the board rendering it.

**Empty epic:** emit `"autopilot_runs": []` — always present, never absent. An absent key and an
empty track are different facts.

## Output — Implementation Strategy (markdown report + JSON sidecar)

Write **two** artefacts (today's date; on same-day re-run append `-02`, `-03`, … — never clobber):

1. `_00-Project-Management/41-Reports/execution-strategy/EXECUTION-STRATEGY-YYYY-MM-DD.md` —
   human-readable.
2. `_00-Project-Management/41-Reports/execution-strategy/EXECUTION-STRATEGY-YYYY-MM-DD.json` —
   structured; the dashboard's Implementation Strategy view (FEAT-03.3) reads this. The per-chat
   `executed` flag lives here (default `false`; later flipped by `execute-batch` / by hand, then
   `pm:dash`).

Both go in the `execution-strategy/` **topic folder** (STORY-27.3.03 / ADR-0143 moved the reports
corpus into topic folders; readers walk the tree, so either location resolves, and the topic
folder is where every sidecar since 2026-08-05 lives).

### JSON sidecar schema

```json
{
  "epic": "EPIC-NN",
  "generated_at": "<ISO 8601>",
  "phases": [
    {
      "number": 1,
      "title": "Foundations",
      "description": "<one sentence: what this phase covers and why these chats belong to it>",
      "name": "Phase 1 · Foundations",
      "outcome": "<optional: founder-facing 'what you'll have' once this phase lands>",
      "chats": [
        {
          "id": "CHAT-01",
          "title": "<short title>",
          "outcome": "<optional: founder-facing 'what you'll have' once this chat lands>",
          "stories": [{ "id": "STORY-NN.M.PP", "status": "ready", "ready": true }],
          "lanes": [{ "type": "serial", "stories": ["STORY-...", "STORY-..."] }],
          "sub_agents": ["react-expert ×2", "javascript-pro"],
          "trigger": "<paste-ready prompt>",
          "verify": "<&&-joined command>",
          "depends_on": ["CHAT-..."],
          "unlocks": ["CHAT-..."],
          "estimate": "<rolled-up>",
          "executed": false
        }
      ]
    }
  ]
}
```

…and, **always**, the autopilot track as a top-level sibling of `phases[]` (Step 8, ADR-0184):

```json
{
  "autopilot_runs": [
    {
      "id": "RUN-01",
      "title": "<short name for the run>",
      "rationale": "<optional: why these chats are one run, and any disagreement with the phase order>",
      "chats": ["CHAT-01", "CHAT-02"],
      "stories": [
        { "id": "STORY-NN.M.PP", "chat": "CHAT-01", "risk_rank": 5,
          "risk_basis": "<the halt-probability claim>",
          "tier": "high", "tier_reason": "<one line>" }
      ],
      "checkpoints": [{ "after": "CHAT-02", "review": "<what is reviewed>", "tier": "high" }],
      "projected_usage": { "tokens": null, "counted": 0, "missing_estimates": 4,
                           "basis": "<what was summed>" },
      "stop_condition": "stop-at-end-of-EPIC-NN",
      "halt_blast_radius": "<what is already merged vs what unwinds, per boundary>",
      "parallel_lanes": [{ "chat": "CHAT-02", "provably_parallel": true,
                           "orchestrator_runs_it": true, "basis": "<disjoint-files evidence>" }],
      "prompt": "<paste-ready, self-contained>"
    }
  ]
}
```

**`outcome` (optional, per `phase` and per `chat`)** — a single founder-facing sentence describing *what you'll have* once that phase/chat lands (the capability, not the implementation). Omit it (or use `""`) when there's nothing founder-facing to say; it never affects grouping or the dry-run contract. When present, the dashboard's Implementation Strategy view surfaces it on phase headers and chat cards (FEAT-14.2). This mirrors the optional `outcome:` field on Story/Feature frontmatter (SOP §11; nudged by the non-fatal W1 `pm:lint` warning, ADR-0061).

### Markdown report

Renders the same data human-readably: a `## Phase N · <title>` heading per phase (the SAME number
and title the sidecar carries — Step 7b), its `description` line, then one block
per chat carrying its id, rolled-up estimate, title, **Stories** (DoR-gap flagged where
not-`ready`), **Lanes**, **Sub-agents**, a fenced **paste-trigger**, a fenced
**verify-before-closing** command, **Depends on / Unlocks**, and the phase/chat **outcome** line
(if present, rendered after the phase heading and after the chat title respectively). End with the next-command stub
`/tandem:execute-batch <chat-id>`.

### Markdown report — the autopilot track section

The track gets **its own section**, after the phases, never interleaved with them (ADR-0184 §1 —
two groupings rendered together read as drift). Head it `## Autopilot track` with the run count and
the cap, then one block per run: `### RUN-NN · <title>` followed by its chats in order, the
risk-ordered stories (rank · basis · tier · reason), checkpoints, projected usage (say **null** in
words when it is null, with the missing count), stop condition, halt blast radius, the ADR-0081
parallel-lane prediction, and a fenced **paste-ready prompt**.

### Empty case (handle gracefully — do NOT error)

If the epic has **0** not-done stories, write a valid empty strategy (0 phases / 0 chats / an empty
`autopilot_runs: []`) stating there is nothing to execute — and, if the only stories are `done`,
say the epic is complete.

## End-of-session summary (always emit)

- Artefacts written: `EXECUTION-STRATEGY-YYYY-MM-DD.md` + `.json`
- Epic: EPIC-NN — stories scanned: N (R ready, U un-ready flagged)
- Phases: P · Chats: C
- Autopilot track: R run(s), largest run C chats (cap 10) · projected usage per run (or **null**
  with its missing-estimate count)
- **Shape validation: `autopilot-track-shape.test.js --case real-emission --sidecar <the file
  written>` — exit code, quoted.** Not "the track is valid": the command and what it returned.
  A session that cannot show a 0 has not finished emitting.
- **Phase naming: `autopilot-track-shape.test.js --case phase-naming --sidecar <the file
  written>` — exit code, quoted** (Step 7b, ADR-0196). Same rule: the command and what it
  returned, not a claim that the phases are named.
- Confirm: no story status was modified (dry-run).

## Non-negotiable rules from CLAUDE.md

- **Dry-run / read-only** — never changes a `status:` field; writes only the two report artefacts.
- Grouping is **judgment-led** (ADR-0025) — reason, don't mechanically match; record a rationale.
- Batch-size bounds are **soft guidance** (ADR-0026) — deviate only with a written rationale.
  They govern a **chat**. They do **not** bound an autopilot run (ADR-0182).
- The **autopilot track is always emitted** (ADR-0184) and **no run exceeds 10 chats** (ADR-0183)
  — the cap is hard, and an eleventh chat splits the plan into another run.
- **Every phase is named** — `number` + `title` + `description`, and an unnamed phase is refused,
  never emitted (ADR-0196, Step 7b).
- A projection with nothing to sum is **explicit `null`**, never `0` (ADR-0184).
- Parallel lanes require **provably-disjoint** `files_touched`; default serial.
- Reports live in `41-Reports/`, in their topic folder.

## Next command

Next: `/tandem:start-phase`

`/tandem:start-phase` opens the phase (branch cut + entry gates), then
`/tandem:execute-batch <chat-id>` pulls one proposed chat into a fresh working
chat — never run a batch without the phase branch cut first. Those commands own the status
changes; this one does not. For a single story outside a batch, the fork's alternative is
`/tandem:execute-story` (see the chain record in `core`).
