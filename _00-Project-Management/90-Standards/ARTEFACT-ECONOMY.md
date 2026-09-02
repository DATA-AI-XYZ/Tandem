---
type: standard
id: ARTEFACT-ECONOMY
title: Artefact economy — quality over count
status: active
version: 1.0
---

# Artefact economy — quality over count

The kit prefers **few, true artefacts over many thin ones**. Every artefact costs context, triage
time, and board noise for its whole life; an artefact that carries no falsifiable claim is debt the
moment it is created. This standard governs *whether* and *at what level* work becomes an artefact.
The lifecycle skills (`split-into-features`, `split-into-stories`, `refine-backlog`,
`triage-backlog`) enforce it at their gates; `core` binds it for ad-hoc creation.

## The granularity ladder — choose the SMALLEST level that carries the claim

| Level | Earned only when | If not earned |
|---|---|---|
| **EPIC** | A programme with strategic linkage (`okr:` / `prd_section:`) that genuinely needs ≥2 features | It's a Feature |
| **FEATURE** | A shippable slice with its own acceptance criteria that genuinely needs ≥2 stories | It's a Story |
| **STORY** | A single falsifiable claim, XS–L, with a paired Testplan writable *now* | It's a backlog tranche or a ride-along |
| **TESTPLAN** | Never standalone — exists only as a Story's 1:1 pair | — |
| **BUG** | An *observed* defect with reproduction steps | Improvement ideas are backlog, not bugs |
| **BACKLOG item** | A new initiative or root cause **not already covered** by an open item | It's a tranche inside the existing item |
| **Ride-along** | — (the floor) | Small debt (≲30 min, same files) rides the next story touching those files, recorded in that story's notes |

**When unsure between two levels, pick the smaller.** Splitting is always available later;
un-splitting means triage, merges, and history rewriting.

## Governing rules

1. **Fewest artefacts that carry the claims.** A split's success measure is coverage per artefact,
   not artefact count. An AC without a falsifiable claim of its own folds into a sibling — it never
   becomes a thin story.
2. **One intake item per initiative.** Findings, review results, and follow-ups become *tranches*
   inside one BACKLOG item (or requirements inside one PRD), not sibling items. Sibling items that
   share a root cause are a recorded **merge group**, and the merge happens before any promotion.
3. **The testable-claim bar.** No artefact without a claim someone could falsify at HEAD. "Improve
   X", "consider Y", "revisit Z" are not claims — they are DECISION-ONLY notes for the operator.
4. **Kill before promote.** Triage (`triage-backlog` — validity against HEAD) runs before
   refinement (`refine-backlog` — DoR). A triage that kills items is worth more than one that
   promotes them. Never re-file a killed claim.
5. **Ride-alongs absorb small debt.** Promotion to a standalone artefact requires the work to be
   too large, too risky, or too separate to ride — "it would be tidy as its own story" does not
   qualify.
6. **Retroactive records are allowed, minimal, and closed immediately.** Work shipped on direct
   operator request without an intake artefact gets ONE small item recording it (evidence +
   completed_at), flipped terminal in the same response — never a reconstructed story/testplan pair.

## The health signal

Net intake (items raised minus items closed/killed) per weekly-monitor window is the economy's
health metric. A persistently positive gap means artefacts are being minted faster than truth is
being established — run a full-corpus triage before the next split.
