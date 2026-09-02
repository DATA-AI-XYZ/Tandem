---
type: bug
id: BUG-YYYYMMDD-NN
title: ''                    # REQUIRED. The symptom, same text as the H1 below. No apostrophes.
                             # generate-dashboard.js renders `fm.title || '(no title)'` — it does
                             # NOT fall back to the H1, so omitting this shows "(no title)" on the
                             # board and in search.
epic: EPIC-NN
feature: FEAT-NN.M
story: STORY-NN.M.PP        # the story whose testplan exposed it (or "exploratory")
testplan: TESTPLAN-NN.M.PP  # the testplan run (or "exploratory")
failing_test: TC-NN          # the failing test case, or "exploratory"
severity: critical | high | medium | low
status: not-started          # not-started | in-progress | done | wontfix | duplicate
created_at: ''
started_at: ''
completed_at: ''
---

# BUG-YYYYMMDD-NN · <symptom>

## Summary
<one sentence, plain English, from the user's perspective. What's broken.>

## Impact
<one or two sentences: WHAT this actually affects — which surface, which reader, which workflow,
and whether there is a workaround. Distinct from Summary (what is broken) and from `severity:`
(how bad). Surfaced on the expanded bug card alongside both. ADR-0129.

WRITE-FORWARD: added 2026-08-03 and NOT backfilled onto the 88 bugs that predate it. `pm:lint` does
not require it — a rule that fired on all 88 is the mistake EPIC-26's R25 avoids. A bug without this
section renders "Not recorded in the artefact." on its card, which is honest and is accepted by
TESTPLAN-25.5.03 TC-04.>

## Source
- **Failing testplan:** `<path to TESTPLAN-*.md>`
- **Failing test case:** TC-NN
- **Originating story:** `<path to STORY-*.md>`

## Environment
- **Branch:** <git branch>
- **Commit SHA:** <full sha>
- **Runtime:** <node / python / etc. + version>
- **Browser / project:** <e.g. chromium headless, or "n/a">
- **OS:** <e.g. Windows 11>
- **URL hit:** <or "n/a">
- **Auth state:** <e.g. admin user, anonymous, n/a>

## Steps to reproduce
1. <numbered, copy-pasteable>
2. <…>
3. Observe: <what happens>

A junior dev should be able to follow these and reproduce in under 5 minutes.

## Expected behaviour
> <quote the relevant AC verbatim from the source story>

## Actual behaviour
<what happened instead. Include exact error message, HTTP status, stack trace, console error, screenshot path if applicable.>

## Evidence
```
<pasted log output, trimmed to ≤30 lines, key frames preserved>
```

- **Error tracker URL:** <e.g. Sentry event, or "—">
- **Screenshot / video path:** <or "—">
- **Network HAR:** <or "—">

## First analysis
**Hypothesis — not yet verified end-to-end:**

<your best initial guess at root cause. Which file/function is suspect, why (line refs welcome). Mark uncertainty clearly.>

Supporting evidence:
- <bullet>
- <bullet>

## Suggested fix direction
<one or two concrete options the junior could pursue, plus risks/trade-offs. Not a full solution — a starting line.>

**Option A:** <approach> — risk: <one line>
**Option B:** <approach> — risk: <one line>

## Acceptance criteria for the fix
- [ ] TC-NN passes
- [ ] No regression in <other TCs to spot-check>
- [ ] No new errors in <error tracker> for <component>
- [ ] <project-specific gate per `PROJECT-CONTEXT.md`>

## Related
- <duplicate or sibling BUG-* files>
- <related stories>
- <related PRs>
