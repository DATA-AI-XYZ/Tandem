# Prompt 02 · Draft Epic from OKR or PRD

**Trigger:** A new strategic bet is approved and needs to enter the work graph.

**Hat:** PM

---

## Paste this into Claude

```
You are operating as **PM hat**.

Load these files into context:
- 00-Strategy/OKRS-YYYY-Qx.md (or the PRD at 20-Requirements/PRD-*.md)
- 90-Standards/SOP.md (DoR, estimation, status enum)
- 90-Standards/PROJECT-CONTEXT.md
- 91-Templates/EPIC.template.md
- Project root CLAUDE.md

The source I'm drafting from:
<PASTE: OKR key result OR PRD section OR strategic bet description>

Task:
1. Find the next free EPIC-NN by globbing 30-Epics/.
2. Draft the Epic file at 30-Epics/EPIC-NN-<slug>.md using EPIC.template.md verbatim.
3. Fill in every section, especially:
   - **Strategic linkage** — must link to the OKR or PRD section above.
   - **In scope / Out of scope** — be explicit. Out-of-scope items are how we resist mid-epic creep.
   - **Success criteria** — measurable, not vibes.
   - **Dependencies** — other epics, infra, third parties.
   - **Risks** — top 3 max, with one-line mitigations.
4. Outline 3-7 Features at a high level (titles + one-line goal each), but DO NOT create
   the FEAT files yet — that's prompt 03.
5. **If ≥3 viable approaches exist for a high-stakes architectural choice in this Epic**
   (e.g. storage model, framework, integration pattern), DO NOT narrow to one in this pass.
   First render an exploration artefact: copy 91-Templates/EXPLORATION.template.html to
   41-Reports/EXPLORATION-YYYY-MM-DD-<slug>.html, fill the option slots (6 provided), and
   link it from the Epic body and the Epic's `html_artefacts:` frontmatter array. Defer the
   decision to an ADR (radio-select + "Export → ADR" in the artefact) rather than committing
   to one approach in the same pass that you draft the Epic.
6. Set frontmatter: status=not-started, created_at=now (ISO 8601 with offset).

Output rules:
- Show me the file tree of what you'll create BEFORE writing.
- If the strategic linkage feels weak — if you can't write the Business Outcome line —
  STOP and ask: "What business outcome does this move?" Don't proceed without a clear answer.
- If the Epic feels > 4 weeks of solo work, propose splitting into two Epics.

Honour from CLAUDE.md:
- Frontmatter timestamps
- Status enum
- Strategy linkage rule (okr or prd_section is MANDATORY)
- Templates rule (use EPIC.template.md verbatim)

After saving, propose: "Run prompt 03 (split-epic-into-features) next?"
```
