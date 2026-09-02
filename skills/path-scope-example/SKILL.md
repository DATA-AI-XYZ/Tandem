---
name: path-scope-example
description: The kit's reference example of a PATH-SCOPED skill (ADR-0010) — copy its `paths:` frontmatter as the template for your own directory-scoped skills. Its `paths:` block, not this description, is what loads it: inside the decisions folder it auto-loads as a light ADR-authoring reminder (next free ADR-NNNN, the template to start from, the same-response linking rule) and everywhere else it stays silent.
paths:
  - "_00-Project-Management/40-Decisions/**/*"
---

# path-scope-example (reference: directory-scoped skill)

This skill is the kit's **worked example of `paths:` scoping** (ADR-0010, proven by STORY-17.2.01). Unlike every other Tandem skill — which is globally relevant and explicitly slash-invoked — this one is bound by its `paths:` frontmatter to **`_00-Project-Management/40-Decisions/`**, so Claude auto-loads it only while reading/writing files in that directory. Outside the decisions folder it stays silent.

It is intentionally minimal and doubles as a genuine, directory-local helper: a quick ADR-authoring checklist.

## When this activates

Auto-loads when you touch a file under `_00-Project-Management/40-Decisions/` (e.g. creating `ADR-0077-*.md`). It does **not** auto-load when you're working in `32-Stories/`, `skills/`, or anywhere else — that's the whole point of path-scoping.

## ADR-authoring reminder (the local concern)

1. **Number sequentially across the whole project.** Glob `ADR-*.md` in this folder, take the max `NNNN`, add 1. No folder grouping.
2. **Start from the template** — `91-Templates/ADR.template.md`. Don't redraft headings from memory.
3. **Record the decision in the same response** as the work that forced it (ADR-on-the-spot).
4. **Link back** — add the new `ADR-NNNN` to the originating story's `decisions:` frontmatter array.
5. **Commit, don't hedge** — an ADR commits to one option; list the rejected ones under `## Alternatives considered`.

## How to reuse this pattern

To make one of your own skills directory-scoped, copy the `paths:` block above and point it at your directory's glob (repo-relative, `**` recursion, brace expansion — same format as `.claude/rules/` path-specific rules). Remember `paths:` is **additive** with `description:` — it constrains *where* a description-match may fire; it is not a security control. See `90-Standards/CLAUDE-CODE-CONFIG.md` §2.3.1 for when to path-scope vs description-match.

**Portability note:** `paths:` is a Claude Code loader convention, not part of the minimal skill-frontmatter schema (`name` + `description`). Hosts and validators that don't recognise it ignore unknown frontmatter keys, so on such hosts (e.g. Claude Cowork surfaces that only description-match) this skill degrades gracefully to an ordinary description-matched skill — nothing breaks, it just loses the auto-load-on-directory behaviour.
