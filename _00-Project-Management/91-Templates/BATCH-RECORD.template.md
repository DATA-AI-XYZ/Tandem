# Delivery batch <B-id> · <batch title>

> **The batch record lives in this report** (ADR-0305). The board's evidence reader reads the
> ```` ```json batch-record ```` block below and git; validator R34 checks its shape. Keep one
> block per report and one report per batch, under `41-Reports/phases/`.
>
> **What is recorded, and when.** Each field records an event with a reference, never a
> status; story status stays the only status.
> - **At entry** (the owner's entry authorisation): `execution`, `entry`,
>   `entry_gates_confirmed`, `holds` as stated then, `branches`, `product_repo_env` (the NAME
>   of a `*_REPO` environment variable holding the product repository's path; the reader
>   reads no other name and never writes the value onto the board).
> - **At each hold release:** append a `holds` event (`open` or `closed`, `at`, `ref`).
> - **Before submitting for acceptance:** the landing manifest's pre-landing facts in
>   `manifest` (each `main` before landing, or `"unborn"`). This is part of the reviewed
>   commit S.
> - **When the reviewer approves** (a slice, or the batch): append an `approvals` entry in a
>   record commit R that follows the reviewed commit S. The entry names S and P (the
>   reviewed planning and product commits) and never its own commit. The administrative
>   close-out between S and R may change only the fields ADR-0305 §4 permits; anything else
>   invalidates the approval.
> - **After a records-only commit following R:** append a `rebind` entry (no review needed).
> - **After a re-review (§2.3 stale approvals):** append a `renewal` entry naming the new S
>   and P, and record the ledger in `rereview`.
>
> **Execution mode.** `human-gated` needs the complete `entry` authorisation. `autopilot`
> also needs `run_plan`, the path of the written `AUTOPILOT-PLAN-*.md` that names the run;
> without it R34 refuses the record. A run the strategist proposed is never an
> authorisation.

## Outcome

<the batch's outcome, from the approved strategy>

## Batch record

```json batch-record
{
  "batch": "<B-id>",
  "strategy": "<EXECUTION-STRATEGY-YYYY-MM-DD.json>",
  "execution": "human-gated",
  "run_plan": "",
  "entry": { "by": "<owner>", "at": "<YYYY-MM-DDTHH:MM:SS+HH:MM>", "ref": "<the entry authorisation>" },
  "entry_gates_confirmed": [],
  "holds": [],
  "branches": { "planning": "<planning branch>", "product": "<product branch>" },
  "product_repo_env": "<PRODUCT_REPO>",
  "manifest": {},
  "approvals": [],
  "rereview": []
}
```

<!--
An approvals entry, for reference (append; never edit an earlier entry):

  { "kind": "slice+acceptance", "slice": "<B-id>.1", "scope": ["STORY-NN.M.PP"],
    "by": "<reviewer>", "at": "<ISO-8601>", "ref": "<review record>",
    "evidence": { "path": "<evidence file>", "sha256": "<64 hex>" },
    "planning_reviewed": "<S, 40 hex>", "product_reviewed": "<P, 40 hex>" }

kind: slice | slice+acceptance (a one-slice batch) | acceptance | renewal (with "of") | rebind (with "of")
-->

## Results

<the cases run, with PASS / HELD / FAIL; a held case is never a pass>

## Landing manifest

<each main before landing, the reviewed heads, the reviewer's approval reference>
