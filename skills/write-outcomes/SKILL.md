---
name: write-outcomes
description: Dispatched by producer skills via a sub-agent to turn an artefact's technical content into one plain-English founder-outcome line; it is not a manually-invoked lifecycle command.
---

# Tandem: write-outcomes (dispatch-only)

This skill is **dispatch-only**. Producer skills (via FEAT-14.3 wirings) spawn a sub-agent, hand it an artefact's technical scope, and this skill transforms it into a single plain-English outcome line for founder-facing communication. A human never invokes this directly; it is not part of the lifecycle command chain.

An "outcome line" is the what-you-can-now-do summary: what a founder will *have* or *be able to do* after this artefact ships. It strips internals and surfaces value.

## Voice

The outcome voice is one sentence, plain English, second-person or capability-framed. Hard bans (literal): **no internal IDs**, **no command names**, **no shell**, no jargon. Apply these strict rules:

- **DO:** Write what the founder will have or be able to do (`You can now…`, `You have…`, or `Teams can…`).
- **DON'T:** Use internal IDs (e.g., STORY-14.1.01, EPIC-14, BACKLOG-0009).
- **DON'T:** Name commands or implementation (e.g., /execute-batch, npm run build:tandem, CLI flags).
- **DON'T:** Include shell syntax, jargon, or tool names (e.g., "webhook payload," "API v3.2").
- **DO:** Keep it under ~20 words — one line, scannable.

## Template

```
You can now <capability> — <the value it unlocks>.
```

Or: `You have <artifact> enabling <outcome>.` Adapt as needed; keep it a single line.

## Examples

**Good:** You can now auto-generate dashboards from PRDs — ship faster without manual widget wiring.

**Bad:** EPIC-03 implements dashboard-generator workflow via pm:dash (see ADR-0028, BACKLOG-0009).
*Why bad:* Internal IDs (EPIC-03, ADR-0028, BACKLOG-0009), jargon (pm:dash, ADR), no founder value.

---

**Good:** Your team can spin up a release pipeline that scrubs gated content before publishing.

**Bad:** Run `npm run build:tandem` with branch tandem-public-release, then execute the scrub-gated workflow per FEAT-14.3 wiring.
*Why bad:* Command names (npm run, branch ref, execute), internal feature ID (FEAT-14.3), assumes technical knowledge.

---

**Good:** You can bulk-run a folder of work items in dependency order and track the full cycle to completion.

**Bad:** Batch-execute a stories folder sequentially via the folder pointer + execute prompt using sub-agents in dep order (BACKLOG-0013).
*Why bad:* Jargon (batch-execute, stories folder, sub-agents), internal ID (BACKLOG-0013), mechanism leaks.

---

**Good:** Documentation now stays accurate by testing that every example still works.

**Bad:** CLAUDE.md automation feature bundles BACKLOG-0009/0013/0018/0008 hybrid scripts+skill design for auto-managing the layer.
*Why bad:* Internal jargon (CLAUDE.md automation feature, hybrid scripts+skill, auto-managing), IDs, no outcome for founder.

---

**Good:** Your monitoring app now updates its alert rules without rebuilding the entire codebase.

**Bad:** Refactored the alert-rules module to hot-reload config per EPIC-04 v1.1 polish, see ADR-0044.
*Why bad:* Mechanism leak (refactored, hot-reload config), internal IDs (EPIC-04, ADR-0044), assumes background knowledge.

---

**Good:** You can deploy changes across all your sites without manual syncing of dashboard scaffolds.

**Bad:** Dashboard generator dev/sync rules via symlink + scaffold-leak gotchas per the reference fork integration.
*Why bad:* Mechanism details (symlink, scaffold-leak gotchas, dev/sync rules), tooling jargon, no founder value statement.

## Input / Output Contract

**INPUT:** The artefact's technical content — title, acceptance criteria, scope, technical notes — passed by the producer skill.

**OUTPUT:** Exactly one single line of plain text, no markdown formatting, no leading label (no "Outcome:" prefix), no surrounding quotes. Length-bounded to ~20 words. The producer persists this verbatim to the artefact's outcome field.

## How Producers Dispatch This

A producer skill (e.g., the FEAT-14.3 wirings for dashboard-generator or CLAUDE.md automation) spawns a sub-agent, hands it the artefact's technical body + this skill file, and receives the one-line outcome back to store. The sub-agent runs this skill in isolation, not as part of the lifecycle chain. The outcome line is persisted by the caller, not by this skill.

This skill is dispatch-only and does not execute in the main lifecycle.
