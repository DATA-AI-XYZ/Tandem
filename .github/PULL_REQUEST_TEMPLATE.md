## Summary

<1–3 bullet points — what changed and why.>

## Linked artefacts

- Closes: <issue # / BACKLOG-NNNN path / "n/a">
- Related: <PR # / ADR / story path>

## Type of change

- [ ] Bug fix
- [ ] New feature (skill, hook, rule, template)
- [ ] Breaking change (requires major version bump)
- [ ] Documentation
- [ ] Internal / refactor (no user-visible change)

## AI authorship disclosure

Per SOP §7 DoD, disclose AI involvement:

- [ ] Human-authored throughout (no AI).
- [ ] AI-assisted (Claude / other) for <50 net lines OR <2 files — review skipped as trivial.
  - **Rationale (required if checked):** <one line>
- [ ] AI-authored substantially — **AI-code review pass complete**: <date + reviewing agent / session>.

## Test plan

How did you verify this works?

- [ ] `npm run pm:lint` — exits 0
- [ ] `npm run pm:dash` — generates dashboard cleanly
- [ ] Tested locally with `claude --plugin-dir .` against a throwaway project
- [ ] Manual reproduction of the issue this fixes (paste before/after)
- [ ] <other check>

## CHANGELOG entry

I've added an entry under `## [Unreleased]` in `CHANGELOG.md`:
- [ ] Yes
- [ ] No (explain why):

## Boundary check

- [ ] Stays within solo / small-team scope (no multi-user-assignment, no real-time collab features)
- [ ] Stack-agnostic (works across all 8 project types — see PROJECT-CONTEXT.md)
- [ ] No new dependencies (scripts must stay stdlib-only)
- [ ] Hooks (if any) stay scoped to `_00-Project-Management/`

## Screenshots / output

<If UI-relevant or if it produces dashboard / validator output, paste relevant snippets.>
