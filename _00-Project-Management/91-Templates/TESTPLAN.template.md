---
type: testplan
id: TESTPLAN-NN.M.PP
story: STORY-NN.M.PP
feature: FEAT-NN.M
epic: EPIC-NN
title: Test Plan — <story title>
status: not-started
created_at: ''
started_at: ''
completed_at: ''
html_context: []                 # optional: repo-relative paths to PRIOR sibling HTML artefacts
                                 # the run-testplan agent must read before executing TCs (mirrors
                                 # the story's html_context:). Validator R16 enforces each entry is
                                 # a repo-relative path (no '..', no absolute) to an existing file.
                                 # See SOP §11.
---

# TESTPLAN-NN.M.PP · <title>

## Source story
`_00-Project-Management/32-Stories/EPIC-NN/FEAT-NN.M/STORY-NN.M.PP-<slug>.md`

## Scope
<one paragraph — what this plan verifies and what it deliberately doesn't>

## Preconditions
- Repo at <path>, branch <branch>
- Runtime: <node / python / etc. + version>
- Dev URL / port: see `PROJECT-CONTEXT.md`
- Required services running: <list>
- Required env vars: <list>
- Test data / fixtures: <or "none">

## Acceptance criteria → Test case map

| # | Acceptance criterion (verbatim from story) | Test case |
|---|--------------------------------------------|-----------|
| AC-1 | <…> | TC-01 |
| AC-2 | <…> | TC-02 |
| AC-3 | <…> | TC-03 |

## Test cases

<!-- Dashboard-TC guidance: never assert by grepping the whole DASHBOARD.html for a substring that
     could appear in indexed artefact prose — the generator embeds every artefact body into the
     window.__DATA payload, so a bare `grep <substring> DASHBOARD.html` is confounded (precedents:
     BUG-20260606-02, TESTPLAN-15.2.02, TESTPLAN-15.2.04). Instead: (a) parse window.__DATA and assert
     the relevant field, (b) assert a specific rendered element (e.g. grep '<h1 class="app-title">'),
     or (c) use a sentinel that cannot appear in any artefact body. -->

<!-- Lint/verify-TC guidance: a TC (or a chat verify line) that checks a quality gate must use an
     EXIT-CODE gate, not a substring-of-output gate. Write `npm run pm:lint >/dev/null 2>&1 && echo OK`
     and assert the exit code / the `OK` sentinel. NEVER gate on `npm run pm:lint 2>&1 | grep -E
     "violations" | tail -1` — the summary reads `N violation(s)` (no bare `violations` substring) and
     a trailing `| tail` always exits 0, so that pipeline can never fail and silently green-lights a
     dirty corpus (precedent: BUG-20260608-01). validate-frontmatter.js already exits non-zero on any
     violation, so the exit code is the load-bearing signal — let it gate. -->


### TC-01 · <name>
- **Type:** unit | integration | e2e | static-analysis | manual-review-by-claude
- **Priority:** P0 | P1 | P2
- **Maps to:** AC-1
- **Command:**
  ```bash
  # exact command Claude can run unattended
  ```
- **Expected:** <pass condition — exit code, stdout substring, file presence, snapshot match, etc.>
- **Result:** _pending_

### TC-02 · <name>
- **Type:** <…>
- **Priority:** <…>
- **Maps to:** AC-2
- **Command:**
  ```bash
  ```
- **Expected:** <…>
- **Result:** _pending_

### TC-03 · <name>
- **Type:** <…>
- **Priority:** <…>
- **Maps to:** AC-3
- **Command:**
  ```bash
  ```
- **Expected:** <…>
- **Result:** _pending_

## Code review checklist
- [ ] Every story AC implemented
- [ ] No security regressions (auth / input validation / injection / authz)
- [ ] No performance regressions (bundle size, query count, render perf)
- [ ] Lint clean (see `PROJECT-CONTEXT.md` for command)
- [ ] Build clean
- [ ] Tests green
- [ ] No suppressed lint rules without justification
- [ ] Error paths covered (not just happy path)
- [ ] Logging / observability hooks added where exceptions can fire
- [ ] Documentation updated if behaviour contract changed

## Risks / edge cases
- <edge case the TCs may not fully cover>
- <known flakiness or environment sensitivity>

## Sign-off
- Code review: _pending_
- All tests passed: _pending_
- Date completed: ''
