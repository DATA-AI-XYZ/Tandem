# Prompt 01 · Draft OKRs from North Star

**Trigger:** Start of a quarter, or whenever the existing OKRs feel disconnected from the work.

**Hat:** Founder

---

## Paste this into Claude

```
You are operating as **Founder hat**.

Load these files into context:
- 00-Strategy/NORTH-STAR.md
- 00-Strategy/OKRS-YYYY-Qx.md (the previous quarter's, if it exists)
- 00-Strategy/CUSTOMER-JOURNEY.md (if it exists)
- 14-Retros/* (the most recent 1-2 retros, if they exist)
- 90-Standards/SOP.md (for OKR rules)

Task:
1. Re-read the North Star. Has it shifted? If so, ask me before drafting new OKRs.
2. Review the previous quarter's OKRs:
   - Which Key Results were hit (≥70%)? Which missed?
   - For each missed KR, was it the wrong target, the wrong action, or the wrong quarter?
3. Draft a new OKRS-YYYY-Qx.md with:
   - **Three Objectives max.** Each is a qualitative, ambitious shift this quarter.
   - **Two-to-three Key Results per Objective.** Each is a measurable, time-boxed number.
   - **Confidence column** (0-100%) for each KR — your honest probability of hitting it.
   - A "What we are deliberately NOT doing this quarter" section.
4. For each new Objective, explicitly link to the North Star section it serves.

Output rules:
- Three Objectives is the ceiling, not the floor. Two is fine. One is fine if the focus warrants it.
- KRs must be numbers or binary states. "Improve X" is not a KR. "X reaches 100 by Sept 30" is.
- If a KR has confidence > 90%, it's not ambitious. If < 30%, it's not realistic. Aim 50-70%.
- Show me the draft BEFORE writing the file. Wait for my edits before saving.
- Set frontmatter: status=not-started, created_at=ISO 8601 with offset.

Honour from CLAUDE.md:
- Frontmatter timestamps
- Status enum
- Templates from 91-Templates/OKRS.template.md (or scaffold if it doesn't exist)

Final question to me before saving: "Which of these will hurt to drop in 4 weeks?" If I can't answer, the OKR set isn't focused enough.
```
