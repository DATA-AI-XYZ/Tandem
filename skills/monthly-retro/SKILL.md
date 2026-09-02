---
name: monthly-retro
description: Run the monthly retrospective. Use when the user asks for a monthly retro, monthly retrospective, end-of-month review, month-in-review, or invokes /tandem:monthly-retro. Operates as Founder + PM hats jointly. Auto-detects the most recently completed full month, reads MONITOR + closed stories + ADRs + bugs from that window, and produces 14-Retros/RETRO-YYYY-MM.md from the kit's retro template.
---

# Tandem: monthly-retro (Founder + PM hats)

Operate as **Founder + PM hats jointly** for a solo retro. The user is closing out a month and wants the retro filed in one slash command — no paste-prompt copy.

This skill is the slash-command wrapper for the kit's canonical monthly-retro prompt. The prompt is the source of truth; this file is the entry point.

## Source of truth

@_00-Project-Management/92-Prompts/10-monthly-retro.md

Follow that prompt verbatim. The sections below add only the slash-command-specific glue (which month to retro, input resolution, output path, empty-month handling, post-write handoff) — do not re-declare the prompt's content here.

## Which month — the prior-month window rule

**Always retro the MOST RECENTLY COMPLETED FULL month — never the in-progress month.** Auto-detect this month from the system clock unless an argument overrides it.

The rule, stated precisely with its boundary cases:

- Run on **2026-06-01** → retro **2026-05**. June has just begun; May is the most recently completed full month.
- Run on **2026-05-31** → **also retro 2026-05** (NOT June). You retro the month that just finished, not the in-progress one — and on the last day of May you are wrapping up May itself, so May is the target. The point of the boundary is to never retro a month that is still partly ahead of you: a run dated anywhere in late May still targets **2026-05**, and a run on the very first day of June still targets **2026-05**.

  In short: the target is the **last full month whose work is done** — the prior month relative to a fresh-of-the-month run, and the just-closed current month when you run on its final day. Either way you land on the most recently completed full month and you do not retro a month still in progress beyond "today".

- **Argument override:** if the user passes an explicit month (e.g. `2026-03` or "March"), retro that month instead of the auto-detected one. The argument always wins over the clock.

Derive `YYYY-MM` for the target month and use it for both the output filename and the `period_start` / `period_end` frontmatter (`period_end` = last calendar day of the target month).

## Inputs needed

- If the user passed a month argument, use it. Otherwise auto-detect per the prior-month window rule above from the system clock.
- If the user is ambiguous ("do the retro"), state which month you resolved to before drafting, so they can correct you in one line.

## Load into context

The canonical layout is under `_00-Project-Management/`. Use `Read` / `Glob` to detect existence rather than assuming; treat missing files as "not present" rather than throwing. Load the inputs the source prompt lists, scoped to the target month's window:

- **MONITOR** — `_00-Project-Management/42-Monitor/MONITOR.md` (last ~4 weeks of revision history).
- **Previous month's retro** — `_00-Project-Management/14-Retros/RETRO-*.md`, the one immediately before the target month, to check the carry-forward "One change".
- **Current quarter's OKRs** — `_00-Project-Management/00-Strategy/OKR-*.md` (most recent) for the strategic check.
- **Closed stories in-window** — stories under `_00-Project-Management/32-Stories/` whose `completed_at` falls inside the target month.
- **ADRs in-window** — `_00-Project-Management/40-Decisions/ADR-*.md` created in the target month.
- **Bugs in-window** — `_00-Project-Management/34-Bugs/` filed / fixed in the target month.
- **Retro template** — `_00-Project-Management/91-Templates/RETRO.template.md`.
- **SOP** — `_00-Project-Management/90-Standards/SOP.md` for retro rules + frontmatter contract.

For a multi-folder scan of the in-window activity, delegate to an Explore agent (SOP §18) and ingest the summary, not the raw paths.

## Task

Run the source prompt verbatim. The mechanical points that matter for the slash command:

1. Write the retro to **`14-Retros/RETRO-YYYY-MM.md`** (target month's `YYYY-MM`), using **`91-Templates/RETRO.template.md`** verbatim — do not redraft section headings from memory. The template opens `## Summary` → `## Period` → `## What shipped` → `## Metrics` (ADR-0146).
2. Compute the objective metrics (stories shipped, bugs filed/fixed delta, ADRs created, rework rate, first-pass close rate, bugs per shipped story) from the in-window data. Auto-draft the objective sections; leave "What worked / What hurt / Surprises" for the user to edit to their voice.
   **Do NOT compute "average story cycle time" from `completed_at` - `started_at`, and do not report time in `blocked`.** Both were retired 2026-08-01 (ADR-0107): under orchestrated execution both timestamps are stamped minutes apart by the same run, and `status:` keeps no history — so the first measured an agent's execution window rather than lead time, and the second was never measurable at all. Report the difficulty signals above instead.
3. Propose 2-3 candidate "One change" actions — propose only, the user picks one.
4. Run the strategic check: did the month's work ladder into the current OKRs? Flag drift for the next quarterly review.
5. **Show the draft in chat before saving.** Wait for the user's edits.

## `## What shipped` — derived, never written by hand

**Do not compose this section.** Run the derivation and paste what it returns:

```bash
node _00-Project-Management/93-Scripts/retro-shipped.js <YYYY-MM>
```

It prints the `## What shipped` heading, the list grouped by epic, and a trailing HTML comment
carrying the same window's counts. Add `--json` for the structured form when you need the numbers
for `## Metrics` as well.

Three rules ride on this, and all three are enforced by
`93-Scripts/tests/monthly-retro-shipped.test.js`:

- **It is derived on every run, not carried forward.** Never copy the list out of the previous
  month's retro, and never edit last month's list into this month's shape. The script reads
  `32-Stories/` — it does not read `14-Retros/` at all, so a story that exists only in a previous
  retro document cannot appear.
- **It agrees with Metrics by construction.** `storiesShipped` is derived *from* the same list, not
  counted by a second walk. If the number under `## Metrics` and the number of bullets under
  `## What shipped` ever disagree, one of them was hand-edited — fix the edit, do not reconcile the
  two by hand.
- **What counts as shipped:** a story with `status: done` whose `completed_at` falls in the month.
  `wontfix`, `duplicate` and `archived` are terminal but did not ship. An in-window timestamp on a
  story that is still `in-progress` does not ship either.

## `## Recalled from the retro ledger` — what the runs noticed at the time

`## What shipped` above is **derived** from the board: it says what the month produced. The retro
ledger is the other half — what each close-out, chat and phase **observed while it was happening**:
the friction, the kit signals, the estimate-vs-actual calls. Recall it for the same window rather
than reconstructing it from the artefacts a second time:

```bash
node _00-Project-Management/93-Scripts/retro-report.js --month <YYYY-MM>
```

Paste what it returns as its own section. It comes from `93-Scripts/retro-report.js` — the **one**
aggregator this skill, `close-phase` and `reflect` all share, so none of the three re-implements
the join and the three cannot drift apart about what happened.

**This AUGMENTS the derived sections; it replaces none of them.** `## What shipped`, `## Metrics`
and `## Summary` are unchanged and are still derived exactly as described above. The recalled
section sits alongside them under its own heading, so a reader can tell which sentence came from
the board and which came from the run.

**A window with no records is normal.** The output says `No retro records for this window.` — paste
that as returned. Every month before 2026-08 has no ledger lines at all, so this is the ordinary
case for a while: it is a statement of fact, not a warning, and it must not read like one. Do not
leave the section blank, and do not fall back to a month that does have records — the same stance
`## What shipped` takes, for the same reason.

## `## Summary` — auto-drafted, in the objective register

**Auto-draft it; do not prompt the operator for it.** This follows the split this skill already
makes: objective sections are Claude's to write, subjective sections ("What worked / What hurt /
Surprises") are the user's voice. The Summary describes what the period *was*, from the same
in-window data as Metrics, so it belongs on the objective side — the operator edits it afterwards
like any other drafted section.

Contract (ADR-0146): **2–4 sentences, plain past-tense prose, objective register.** The
**first sentence must stand alone as the whole gist** — the Cadence → Retros card renders this
section clamped at ~220 characters, so a summary whose meaning only arrives in sentence three shows
up truncated and useless.

The `write-outcomes` voice **does not apply here**. That skill is capability-framed and
future-facing ("You can now…", under ~20 words) with hard bans on internal IDs and command names; a
retrospective is past-tense and its job is to name the epics, stories and ADRs of a closed period.

**An empty month still gets an honest Summary** — say the month was quiet and, if known, why. Do not
invent narrative to fill the section, and do not carry last month's summary forward.

## Empty month is valid output

A month with **0 closed stories is valid** — still produce the retro file. Populate the metrics with zeros, note explicitly in "What worked / What hurt" that the month was quiet (and why, if known — e.g. holiday, founder offline, single long-running story not yet closed), and still propose a "One change" for the next month. Do NOT skip the file or error out on an empty window; early-kit months legitimately have no closed work.

`## What shipped` on an empty month reads **"Nothing shipped in this period."** — the derivation
emits that sentence itself, so paste it as returned. Leaving the section blank is wrong: a blank
section reads as an omission rather than as a fact, and it is indistinguishable from a run that
failed halfway. Equally, do not fall back to the last month that *did* have something in it.

`## Recalled from the retro ledger` on an empty month reads **"No retro records for this window."**
— the aggregator emits that sentence itself. The two sections are independent: a month can ship
nothing and still carry ledger records, or ship plenty and carry none. Read each one's answer and
paste it; never infer one from the other.

## Output rules

- One retro file per month: `14-Retros/RETRO-YYYY-MM.md`.
- Objective sections (Metrics, Action-from-last-retro carry-forward, Strategic check) are Claude's to write; subjective sections (What worked / What hurt / Surprises) are the user's voice — draft them as a starting point only.
- The "One change" — propose 2-3, the user commits to one.
- Honour the frontmatter contract: quoted ISO 8601 timestamps with offset from the system clock, canonical status enum, template used verbatim. The source prompt sets `status=done` + `completed_at` on save (this is the retro artefact's own lifecycle, not a kit story).

## Non-negotiable rules from CLAUDE.md

- Frontmatter timestamps (quoted ISO 8601 with offset, from the system clock).
- Status enum (closed set of 9).
- Templates rule — use `91-Templates/RETRO.template.md` verbatim; do not redraft section headings from memory.
- Update `42-Monitor/MONITOR.md` with the one-line retro entry per the source prompt's end-of-retro step.

## End-of-session summary (always emit)

- Target month resolved: `YYYY-MM` (and whether from clock or argument).
- File written: `_00-Project-Management/14-Retros/RETRO-YYYY-MM.md`.
- Stories shipped in-window: N (0 is valid — empty month noted in the file).
- Bugs filed / fixed: X / Y. ADRs created: Z.
- "One change" candidates proposed: list (user to pick one).
- Strategic drift: Yes / No.

## Next-step guidance

Review the draft with the **founder hat**; capture any decisions that surface as **ADRs**. The retro often exposes a structural choice ("we keep skipping DoR — should we?") worth recording.

## Next command

`/tandem:weekly-monitor` — the retro's "One change" is tracked from here into next month; the weekly cadence keeps it alive. If the strategic check flagged drift, run `/tandem:draft-okrs` next quarter to re-anchor.
