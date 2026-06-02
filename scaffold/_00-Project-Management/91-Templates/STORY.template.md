---
type: story
id: STORY-NN.M.PP
epic: EPIC-NN
feature: FEAT-NN.M
title: <human-readable story title>
status: not-started
created_at: ''
started_at: ''
completed_at: ''
estimate: XS | S | M | L         # XL means "split it"
priority: P0 | P1 | P2 | P3
type_of_work: frontend | backend | infra | data | docs
outcome: ''                      # optional: founder-facing "what you'll have" once this
                                 # story is done — one plain sentence about the capability,
                                 # not the implementation. Never required; a missing outcome
                                 # is nudged by a non-fatal pm:lint warning (W1), see ADR-0061.
ai_review: pending               # pending | completed-YYYY-MM-DD | skipped-trivial | n-a
ai_review_skip_reason: ''        # required only when ai_review = skipped-trivial
ai_review_artefact: ''           # repo-relative path to the AI-CODE-REVIEW HTML artefact;
                                 # typically 41-Reports/AI-CODE-REVIEW-<story-id>-<YYYY-MM-DD>.html.
                                 # Required when ai_review=completed-* (validator R15b); exempt for
                                 # skipped-trivial / n-a. Must point at an existing file if set.
decisions: []
depends_on: []                   # optional: STORY ids this story depends on (e.g.
                                 # [STORY-02.1.01]). Validator R17 enforces each entry is a
                                 # well-formed STORY id (STORY-NN.M.PP) that points at an
                                 # EXISTING story under 32-Stories/ — forward references to
                                 # not-yet-created stories are rejected (see ADR-0020).
                                 # Consumed by execution-strategist to group ready stories by
                                 # dependency chain.
files_touched: []                # optional: repo-relative paths this story expects to modify
                                 # (e.g. ['_00-Project-Management/93-Scripts/foo.js']).
                                 # Validator R18 enforces each entry is a repo-relative path
                                 # (no absolute paths, no leading '/', no '..' traversal).
                                 # FORMAT-only — files need not exist yet (the story may
                                 # create them). Consumed by execution-strategist to group stories by
                                 # shared-files affinity. See SOP §11.
suggested_agents: []             # optional: sub-agent name(s) best suited to implement this story
                                 # (e.g. [react-expert, security-engineer]). Overrides the
                                 # PROJECT-CONTEXT type_of_work→agent map for execution-strategist /
                                 # execute-story. Validator R19 enforces SHAPE only — a list of
                                 # non-empty strings; agent existence is NOT checked (the installed
                                 # roster is project-specific). See SOP §11.
html_context: []                 # optional: repo-relative paths to PRIOR sibling HTML artefacts
                                 # (explorations, annotated diffs, options-comparisons) that the
                                 # verification agents (close-out-story, run-testplan) must read
                                 # before reviewing/testing this story. Validator R16 enforces each
                                 # entry is a repo-relative path (no '..', no absolute) to an
                                 # existing file. List only PRIOR artefacts — never one this story
                                 # produces (self-reference loop). See SOP §11.
---

# STORY-NN.M.PP · <title>

## As
<the role / persona — e.g. "the operator", "the customer", "the engineering team">

## I want
<the capability — what the user can do>

## So that
<the value — why this matters>

## Acceptance criteria
- [ ] <testable AC — a machine can verify this>
- [ ] <testable AC>
- [ ] <testable AC>

## Technical notes
- **Files touched:** <paths>
- **Libraries:** <new deps, or "none">
- **Pattern:** <reuse from / new pattern>
- **Gotchas:** <or "none">

## Dependencies
- <other stories / infra / decisions — or "none">

## References
- **Feature:** FEAT-NN.M
- **PRD:** <section or "—">
- **Mockup:** <path or Figma URL or "—">
- **Related ADRs:** <or "—">

## DoR checklist
- [ ] Paired TESTPLAN exists with every AC mapped to a TC
- [ ] Every TC has a runnable `Command:` Claude can execute unattended
- [ ] Dependencies done or scheduled
- [ ] Estimate set
- [ ] Risks section populated below

## Risks / unknowns
- <bullet — or "none; reviewed YYYY-MM-DD">

## DoD checklist
- [ ] All AC ticked above
- [ ] Paired TESTPLAN run; all TCs PASS (or FAIL linked to BUG)
- [ ] Project quality gates pass (lint / typecheck / tests / build — see `PROJECT-CONTEXT.md`)
- [ ] No new runtime errors on smoke
- [ ] If UI: visual contract tests green
- [ ] **AI-code review** complete: `ai_review` frontmatter flipped to `completed-YYYY-MM-DD`, `skipped-trivial` (with `ai_review_skip_reason`), or `n-a` (no AI authorship). See SOP §7 for the >50-lines / >2-files trigger.
- [ ] Frontmatter updated: `status: done`, `completed_at: <ISO 8601 now>`
- [ ] `42-Monitor/MONITOR.md` updated (bar + count + revision history line)
- [ ] ADRs created for any non-obvious decisions
- [ ] BACKLOG entry created for any new tech debt
