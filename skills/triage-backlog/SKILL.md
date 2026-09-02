---
name: triage-backlog
description: Triage BACKLOG items for continued validity — verify each item's claim against the current tree and rule it keep / already-delivered / partially-delivered / duplicate / retire, with evidence per verdict. Use when the user asks to triage the backlog, check whether an item is still valid or still required, find stale / redundant / already-done backlog items, verify the backlog against HEAD, or invokes /tandem:triage-backlog. Operates as PM hat. Upstream of refine-backlog — judges whether an item deserves refinement at all; never runs DoR, never promotes to ready.
---

# Tandem: triage-backlog (PM hat)

Operate as **PM hat**. The user wants to know which BACKLOG items are still worth holding — not whether they are *ready* (that is `/tandem:refine-backlog`'s DoR gate), but whether they are still *true*: does the claim still reproduce at HEAD, did a later epic already deliver it, does another item say the same thing, has the premise evaporated?

Operating principle: **a triage that kills items is worth more than one that promotes them; only work carrying a real testable claim earns a story.** Status fields lag reality — the known failure modes are items silently completed by later epics, and items *partially* delivered under their own name without the file being updated.

## triage-backlog vs refine-backlog (do not blur)

| | `triage-backlog` (this skill) | `refine-backlog` |
|---|---|---|
| Question | Is this item still valid / required? | Is this item ready to work? |
| Checks against | The current tree, git history, ADRs, sibling items | The SOP §6 DoR checklist |
| Can flip status to | `done` / `duplicate` / `wontfix` / `archived` (terminal, evidence-gated) | `ready` |
| Never does | Runs DoR, promotes, writes stories | Digs git history / probes for delivery evidence (its Premise check resolves frontmatter only) |

Triage runs **first**. Its survivors are refine-backlog's input.

## Inputs needed

- Either:
  - One or more BACKLOG paths (`_00-Project-Management/11-Backlog/BACKLOG-NNNN-<slug>.md`).
  - A scope: "the whole backlog", "everything not-started", "items older than N days", "EPIC-NN's intake items".
- If the user supplied nothing, default to **every `not-started` BACKLOG item** — a full-corpus triage is the normal cadence, not the exception.

## Load into context

Use `Read` / `Glob` to detect existence. Treat missing files as "not present" rather than throwing.

- **Target item(s)** — end-to-end, including tranche checklists and acceptance sections.
- **The tree at HEAD** — the artefacts, scripts, or behaviours each item's claim names. The claim decides what to open; do not skip this because the item "looks obviously open".
- **Git history** — `git log --oneline -- <named-paths>` for evidence that work shipped after the item was captured.
- **ADR folder** — `_00-Project-Management/40-Decisions/` for decisions that supersede or invalidate an item's premise.
- **Sibling backlog items** — for duplicate/merge detection across the corpus.
- **SOP** — `_00-Project-Management/90-Standards/SOP.md` §15 (sunset rule).
- **Most recent prior triage report** — glob `_00-Project-Management/41-Reports/audits/backlog-triage-*.md`; re-verify, never inherit, its verdicts.
- **Project root `CLAUDE.md`** — for project-specific overrides.

## Verdict set (closed — one per item)

- **STILL-VALID** — the claim reproduces at HEAD. Status unchanged.
- **ALREADY-DELIVERED** — the work shipped. Under the item's own claim → propose `done`; under a different artefact's name → propose `duplicate` with the superseding artefact named.
- **PARTIAL** — a named tranche shipped, remainder stands. Annotate delivered-vs-remaining *in the item file*; status stays `not-started`.
- **DUPLICATE / MERGE-CANDIDATE** — another open item carries the same claim. Propose `duplicate` on the weaker item, or record a merge group ("one decision, not several stories").
- **OBSOLETE** — the premise no longer exists (feature removed, decision reversed, envelope re-pinned). Propose `wontfix` or `archived` per SOP §15.
- **DECISION-ONLY** — needs an operator ruling, not code. Surface the decision; take no action silently.
- **TRIGGER-GATED** — the item's own text defers it behind a named trigger. Verify the trigger has not fired; leave.
- **PRODUCT-BET** — PRD-level scope, not story-level. Route toward `/tandem:draft-prd` or an epic split; do not story-ify.

## Task

1. Resolve the target set. Read each item end-to-end.
2. Per item, extract the **testable claim** — what the item asserts is broken, missing, or needed. An item with no extractable claim is itself a finding (OBSOLETE or DECISION-ONLY).
3. **Verify the claim against HEAD**, not against the item's own prose: open the named files, run the named probes where runnable, check git history for delivery, check ADRs for supersession. Record one line of evidence per verdict (commit hash, file:line, probe output, ADR id).
4. Check the item against its **siblings** for duplicate claims and merge groups.
5. Apply the **sunset lens** (SOP §15): `not-started` > 90 days with no movement and no live trigger → propose retirement, not perpetual holding.
6. Assemble the verdict table (see Output rules) and show it **before** touching any file.
7. Apply changes per the status-flip rules below.
8. Write the triage report to `_00-Project-Management/41-Reports/audits/backlog-triage-<YYYY-MM-DD>.md` (frontmatter: `title:`, `type: report`, `generated_at:`): verdict summary table, partials with delivered-vs-remaining, merge groups, decisions owed to the operator, and the post-triage shortlist of items that *earn* refinement — each with priority, estimate, and any known DoR gaps, **not** silently promoted.
9. Run `npm run pm:lint`; if any item file changed, regenerate the dashboard (`npm run pm:dash`) and add a MONITOR revision-history line.

## Status-flip rules (evidence-gated, never silent)

- **Annotations are free**: PARTIAL delivered-vs-remaining notes, stale-title corrections, and trigger records may be written directly into item files during the pass.
- **Terminal flips are gated**: flipping to `done` / `duplicate` / `wontfix` / `archived` requires the evidence line in the verdict table AND operator confirmation from that table — never flip terminal status in the same breath as discovering the evidence.
- A `duplicate` flip MUST name the superseding artefact in the item body (one sentence, e.g. "Superseded by STORY-NN.M.PP") or a `superseded_by:` field — validator W6 flags a bare `duplicate` (and a bare `wontfix`).
- Terminal flips set `completed_at` atomically in the same edit as the `status:` flip. Never touch `started_at`.
- Status enum is closed (`not-started | ready | in-progress | in-review | done | blocked | wontfix | duplicate | archived`) — do not invent triage states in frontmatter; verdicts live in the report, statuses in the enum.

## Output rules

- Verdict table first, files second. Columns: Item · Verdict · Evidence · Proposed action.
- **Never promote.** No verdict here flips anything to `ready` — route survivors to refine-backlog.
- **Never re-file killed claims.** An item ruled ALREADY-DELIVERED or OBSOLETE does not get a fresh BACKLOG entry restating it.
- Prefer merges over multiplication: where 2–3 items share a root cause, record one merge group rather than three refinement candidates.
- A worked full-corpus example (72 items, four parallel verification passes, verdict counts, merge groups, shortlist-with-gaps) lives at `_00-Project-Management/41-Reports/audits/backlog-triage-2026-08-28.md` — match its report shape when in doubt.

## Non-negotiable rules from CLAUDE.md

- Frontmatter timestamps — terminal flips set `completed_at` in the same edit; nothing else changes timestamps.
- Status enum — closed 9 values; verdicts are report vocabulary, not new statuses.
- Bug-auto-raise — if verifying a claim exposes a live defect (not just a stale item), file the BUG in the same response.
- Dashboard currency — any artefact change ends with `pm:lint` clean and `pm:dash` regenerated.

## End-of-session summary (always emit)

- Items triaged: N (of M in scope)
- Verdicts: STILL-VALID x · ALREADY-DELIVERED x · PARTIAL x · DUPLICATE x · OBSOLETE x · DECISION-ONLY x · TRIGGER-GATED x · PRODUCT-BET x
- Terminal flips applied (with evidence): list, or "none — awaiting operator confirmation"
- Merge groups recorded: list
- Decisions owed to the operator: list
- Report written: `41-Reports/audits/backlog-triage-<date>.md`
- Refinement shortlist (with DoR gaps): top 3–5 items

## Next command

Next: `/tandem:refine-backlog` — run the DoR gate over the shortlist survivors.

Or, if the triage surfaced PRD-level scope: `/tandem:draft-prd`.
