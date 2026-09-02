---
type: standard
id: USAGE-ESTIMATE-HEURISTIC
title: How a story's usage_estimate is derived
status: active
version: 1.0
---

# How a story's `usage_estimate` is derived

**This is the only place the derivation is written.** `refine-backlog` (at the DoR pass) and
`split-into-stories` (at authoring) both point here; neither restates it, because two copies of a
heuristic is two heuristics the day one of them is edited.

The rule is implemented in `93-Scripts/lib/usage-estimate.js` and invoked as
`93-Scripts/usage-estimate.js`, so a story's number does not depend on a model re-deriving prose
in the moment.

---

## The rule

```
usage_estimate  =  ANCHOR_M  ×  BAND_RATIO[estimate]  ×  TYPE_MULTIPLIER[type_of_work]
```

One positive integer of **total** tokens (input + output + cache-read + cache-creation), per the
R23 shape rule. Rounded to one significant figure. An estimate carried to seven figures is
precision theatre.

### The three factors, and how well founded each is

| Factor | Value | Standing |
|---|---|---|
| `ANCHOR_M` | 9,000,000 tokens | **Measured** from the live usage ledger — see the snapshot below |
| `BAND_RATIO` | XS 0.25 · S 0.5 · M 1 · L 2 | **A stated judgement.** No per-band actuals exist to fit it to |
| `TYPE_MULTIPLIER` | 1.00 for every discipline | **Unmeasured, and therefore neutral.** See below |

**Why every type multiplier is 1.00.** The tempting move is to make `docs` cheap and `backend`
dear. There is no evidence for any spread — there are no story-level actuals at all yet, which is
what STORY-29.3.03 exists to change — and inventing one would be the fabrication this kit files
bugs about. The factor stays in the formula so a future refresh has somewhere to put a measured
value, and the basis line records that no adjustment was made.

**XL has no ratio on purpose.** SOP §6 says an XL story is split before it is promoted. A
heuristic that quietly priced one would be helping a DoR gap through the gate.

---

## Where the anchor comes from, and the trap in it

A `--chat` capture sums the **whole session transcript directory**, so each chat row on the
ledger is a *cumulative re-sum*, not that chat's own spend: the live rows climb 907M → 2.77B
across 39 captures. **Reading a row total as "what a chat cost" overstates a story's expected
cost by two orders of magnitude.** This is the single most important thing on this page.

The incremental figure is the **delta between consecutive rows**, and the anchor is the *median*
of those deltas — median rather than mean because two of the 38 intervals are transcript-directory
rotations (686M and 331M) that no chat spent.

```
ANCHOR_M = median chat-interval delta / mean stories per chat
         = 21,173,428 / 2.6
         = 8,143,626  →  stated as 8,000,000
```

### Snapshot (as of 2026-09-01, 74-row ledger)

| Quantity | Value | Source |
|---|---|---|
| Ledger rows | 74 | `41-Reports/usage/usage-log.jsonl` |
| Intervals measured | 73 | consecutive-row deltas |
| Median chat-interval delta | 21,173,428 tokens | the same ledger |
| Mean stories per chat | 2.6 | 338 stories across 130 chats in the `EXECUTION-STRATEGY-*.json` sidecars |
| **ANCHOR_M** | **8,000,000 tokens** | the division above, rounded |

> **2026-09-01 — the anchor moved DOWN, for the first time.** Phase 2's CHAT-04, CHAT-05 and
> CHAT-06 appended six rows between them (68 → 74, intervals 67 → 73), and those chats were
> shorter per capture than the EPIC-33 port work the previous snapshot was measured over: the
> median interval fell 24,344,688 → 21,173,428 (−13.0%). The divisor is byte-identical at 2.6 —
> no strategy sidecar was emitted in between — so the entire movement is the median. The raw
> division lands at 8,143,626, which one significant figure rounds DOWN to 8,000,000. A falling
> anchor is as real a measurement as a rising one and is recorded rather than smoothed: an M
> story is now expected to cost about a million tokens LESS than it was three days ago. Stories
> written before today keep the basis line they were written with — including the three
> FEAT-34.2 stories closed in the same chat as this refresh, which correctly still read
> `anchor 9,000,000`. See BACKLOG-0214 (why this keeps happening).

> **2026-08-29 — a strategy emission moved the divisor again; the anchor absorbed it.** Landing
> `EXECUTION-STRATEGY-2026-08-29.json` (11 chats / 25 stories) grew the divisor population
> 119/313 → 130/338 in one write — the BUG-20260824-07 shape recurring — and the ledger grew
> 67 → 68 rows (median 22,911,709 → 24,344,688, +6.3%). The raw division lands at 9,363,342,
> which one significant figure keeps at 9,000,000. See BUG-20260829-01 (this occurrence) and
> BACKLOG-0214 (why it keeps happening).

> **2026-08-26, later the same day — the anchor moved AGAIN, and only the median moved.** The
> ledger grew 63 → 67 rows across CHAT-07, the Phase-4/5 closes and CHAT-08's captures. The
> divisor is byte-identical at 2.6303 — no strategy sidecar was emitted in between — so the
> entire movement is in the median chat interval: 20,347,043 → 22,911,709 (+12.6%), which one
> significant figure rounds up to 9,000,000. That is the SECOND consecutive refresh in which the
> anchor itself moves rather than the population around it, and it is worth reading rather than
> skimming: an M story is now expected to cost about two million tokens more than it was on
> 2026-08-24. See BUG-20260826-08 (this occurrence) and BACKLOG-0214 (why it keeps happening).

> **2026-08-26 — the anchor moved, for the first time.** Five earlier refreshes moved only the
> population and one significant figure absorbed the change. That one did not: 7,000,000 →
> 8,000,000. Stories written before this date keep the basis line they were written with — a basis
> line records what was measured when it was written, which is the whole reason it quotes its own
> snapshot. See BUG-20260826-01 (that occurrence) and BACKLOG-0214.

**This table is a snapshot and will go stale as the ledger grows — that is expected, and it is
bounded rather than trusted.** The numbers are held in `lib/usage-estimate.js`'s `ANCHORS` block,
and `tests/estimate-producer.test.js --case anchors-grounded` asserts:

- this table and that block agree **exactly** (neither can be edited alone); and
- `rows`, `intervals` and the **median** are each within a stated tolerance of a **fresh
  measurement of the live ledger** — with `rows` allowed to grow by a few and never to shrink.

Beyond that slack the suite goes red and names the refresh command. (Until the E29-CHAT-05 review
this compared only the document to the module, plus `ANCHOR_M` alone against the ledger — so the
phase's own close-out moved three of these four numbers and nothing noticed.)

**A produced estimate does not depend on this table being current.** The producer re-measures the
ledger at fill time and stamps *that* measurement into the basis line; the snapshot is the
fallback used only when no ledger is readable, and the basis line says which one it used.

### How to refresh it

```bash
node _00-Project-Management/93-Scripts/usage-estimate.js --refresh-anchors
```

It re-measures **both** halves of the anchor — the median interval from the live ledger and the
stories-per-chat divisor from the `EXECUTION-STRATEGY-*.json` sidecars — and prints the recorded
figures beside the measured ones with the drift between them. If the drift has moved materially,
update `ANCHORS` in `lib/usage-estimate.js` (`snapshot_date`, `rows`, `intervals`,
`median_chat_interval_tokens`, `stories_per_chat_mean`, `anchor_m_tokens`) **and the table above**,
in the same commit. Bump `HEURISTIC_VERSION` only when a *factor* changes — a refreshed snapshot is
not a new heuristic.

---

## Applying it: fill-if-missing, never overwrite

```bash
node _00-Project-Management/93-Scripts/usage-estimate.js --story <path>   # writes
node _00-Project-Management/93-Scripts/usage-estimate.js --story <path> --dry-run
```

- An **empty** `usage_estimate:` is filled, and a one-line **basis** is appended to the story's
  `## Technical notes`.
- A **populated** one is preserved **verbatim** and the file is left byte-identical. The producer
  is safe to run twice, and safe to run over a story someone estimated by hand.
- A story whose `estimate:` band is missing or `XL` gets **no number and a stated reason** — that
  is a DoR gap for the human to close, not something to paper over.

The basis line is mandatory because an estimate without one produces variance nobody can
interpret a year later. It names every factor and the snapshot:

> **Usage estimate basis:** 7,000,000 tokens = anchor 7,000,000 (median chat-interval delta
> 18,180,687 / 2.55 stories per chat, ledger snapshot 2026-08-10, n=38) × band M 1 ×
> type_of_work infra 1.00 · heuristic v1, see `90-Standards/USAGE-ESTIMATE-HEURISTIC.md`.

---

## Write-forward only

**Activation date: 2026-08-10.** Stories created on or after it must carry an estimate;
`usage-estimate.js --check` enforces it over the corpus and
`tests/estimate-producer.test.js --case activation-enforcement` runs that check in the suite.

The ~350 stories that predate it are **exempt and must stay exempt**. An estimate written for
work that is already finished is a measurement wearing an estimate's clothes — it would make
every plan-vs-actual comparison look calibrated while measuring nothing. BACKLOG-0157 and
BACKLOG-0146 both say so explicitly; this is that decision, kept.

---

## What this is not

- **Not a promise.** It is a claim with a stated basis, so that variance is interpretable.
- **Not a budget.** The usage governor's caps are a separate mechanism with separate inputs.
- **Not the actual.** The actual side arrives via `usage-capture.js --story` (STORY-29.3.03);
  where both sides exist, `usage-reconcile.js` renders the variance and neither side is
  back-filled from the other.

## Related

- `93-Scripts/lib/usage-estimate.js` — the implementation and the `ANCHORS` block
- ADR-0189 — the decision this page records · ADR-0079 (source/unit/attribution) · ADR-0124
- BACKLOG-0157 (the producer this closes) · BACKLOG-0146 (the actual-side twin)
- STORY-21.2.02 / R23 — the field's shape rule
