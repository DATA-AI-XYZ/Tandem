---
type: release
id: RELEASE-vX.Y
title: <release codename or theme>
status: not-started
created_at: ''
started_at: ''
completed_at: ''
version: vX.Y.Z
target_date: <YYYY-MM-DD>
release_type: major | minor | patch | hotfix
---

# RELEASE-vX.Y · <title>

## Summary
<one paragraph. What ships, who it's for, what it unlocks.>

## Stories included

| Story | Title | Status |
|---|---|---|
| STORY-NN.M.PP | <title> | done |
| STORY-NN.M.PP | <title> | done |

## Bugs fixed

| Bug | Summary |
|---|---|
| BUG-YYYYMMDD-NN | <…> |

## Decisions ratified
- ADR-NNNN — <title>

## Migration / breaking changes
<does anything need to be migrated? Schema changes? Env var renames? Config?>

- <bullet — or "none">

## Smoke-test checklist
Run these after deploy to confirm the release works in production.

- [ ] <user-facing path / smoke test>
- [ ] <admin path / smoke test>
- [ ] <integration / webhook smoke test>
- [ ] Error tracker shows no new errors after 15 minutes
- [ ] Performance metrics within budget

## Rollback plan
<how to revert if smoke fails. Be specific about commands and conditions.>

1. <command>
2. <command>

**Time budget for rollback:** <e.g. "must be able to revert within 10 minutes">

## Communication
- [ ] Internal notes posted (where: <…>)
- [ ] External release notes drafted (if customer-facing)
- [ ] Stakeholders notified

## Metrics to watch (post-deploy)
- <metric and target>
- <metric and target>

## Retro hook
This release will be discussed in `RETRO-YYYY-MM.md`. Items to surface there:
- <what went well>
- <what hurt>
