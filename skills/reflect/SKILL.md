---
name: reflect
description: End-of-session reflection that proposes updates to CLAUDE.md / SOP.md / PROJECT-CONTEXT.md based on what happened. Use when the user asks to reflect on a session, capture lessons, propose CLAUDE.md updates, or invokes /tandem:reflect. The blog's "stop hooks reflect on what happened and propose CLAUDE.md updates" recommendation, implemented as a manual skill (less noisy than an auto-firing Stop hook that triggers on every trivial session).
---

# Tandem: reflect (self-improvement)

Use at the end of a substantive session (>30 min of real work) to capture lessons that should bleed back into the kit's rules. The blog's "self-improvement loop" pattern.

## Ground the scan in the ledger first

Before scanning from memory, read what the run **recorded at the time**. The retro ledger holds one
line per development boundary — the friction, the kit signals and the estimate-vs-actual calls each
close-out wrote as it happened — and recalling those is stronger evidence than reconstructing them
at the end of a long session:

```bash
node _00-Project-Management/93-Scripts/retro-report.js --month <YYYY-MM>
```

Read the **current month only** — that is the in-flight view this skill needs, and the ledger grows
monotonically, so loading all of it would cost more than it is worth here. This is
`93-Scripts/retro-report.js`, the same aggregator `close-phase` and `monthly-retro` read: `reflect`
does not re-implement the join, so the three surfaces cannot disagree about what happened.

**An empty window changes nothing about this skill.** The output says
`No retro records for this window.`; carry on with the scan below exactly as before. No error, no
banner, and nothing attributed to a ledger that has nothing in it — a reflection with no ledger
line to cite is still a valid reflection, and every session before 2026-08 has none.

## What to scan in this session

1. **Decisions made** — did you create an ADR? Did you make a decision that *should* have become an ADR but didn't? (the rule says "any non-obvious decision" — be honest.)
2. **Friction encountered** — did you have to explain the same convention to Claude twice? That's a `PROJECT-CONTEXT.md` candidate.
3. **Workarounds applied** — did you bypass a rule or use a one-off command? Why? Should the rule change, or should there be a new entry in PROJECT-CONTEXT.md's "Known stack gotchas"?
4. **Skills that didn't fire** — did Claude paste a prompt's content instead of loading a skill? The skill's `description:` may not match the trigger phrase the user actually used.
5. **Tools used that surprised you** — was an agent invoked when a direct Read would have been faster? Was main-thread context bloated by grep results? Subagent policy adjustment needed?
6. **Patterns that recurred** — did you tell Claude to do something three times that could be a hook?

## What to output

A proposal — **not** a commit. The user decides what lands.

```
🪞 Session reflection — <ISO date>

What worked:
  - <specific thing, ≤2 lines>

What hurt:
  - <specific thing, ≤2 lines>

Proposed kit changes (review before applying):
  1. [PROJECT-CONTEXT.md] Add to "Known stack gotchas": <symptom> — <fix>. Reason: <one line>.
  2. [SOP.md §<N>] Tighten rule: <current text> → <proposed text>. Reason: <one line>.
  3. [skills/<name>/SKILL.md] Update description to include trigger phrase: "<phrase user actually used>". Reason: <one line>.
  4. [hooks/hooks.json] New hook candidate: <event> running <command>. Reason: <one line>.

ADR backlog (decisions made this session without an ADR — file these now):
  - <decision> made at <timestamp/commit>. Should be ADR-<NNNN>.

Tech debt observed (file as BACKLOG entries):
  - <observation>

User confirmation needed to apply any of the above.
```

## Output rules

- **Propose, don't commit.** No file edits during reflect. The user reviews and explicitly approves each item before it lands.
- One proposal per finding — not bundled.
- Cite evidence: "I noticed X at <approx point in session>" — concrete, not vague.
- Skip the section entirely if there's no finding for that category. Don't pad.
- ≤ 30 lines total. If the session yielded more than 5 findings, prioritise the top 3 and note the rest as "additional minor findings: <count>".

## Anti-patterns

- Proposing rule changes for one-off situations. The bar is "this would have helped me twice or more in the past month."
- Suggesting new skills when a richer description on an existing skill would solve it.
- Auto-applying proposals without user approval — even small ones. The user owns the kit.

## Non-negotiable rules from CLAUDE.md

- Read-only — reflect proposes; user applies.
- Subagent delegation for multi-file scans of past sessions.
- If a proposal touches `_00-Project-Management/90-Standards/SOP.md`, also bump the file's `version:` field in frontmatter once the user approves.

## End-of-reflect summary

A single line: "X proposals · Y ADRs to backfill · Z tech-debt items. Apply now? (y/n)"
