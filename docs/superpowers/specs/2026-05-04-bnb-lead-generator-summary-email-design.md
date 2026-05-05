# B&B Lead Generator — Summary Email Redesign

**Date:** 2026-05-04
**Client:** B&B Manufacturing and Assembly, Faribault, MN
**Workflow:** B&B Lead Generator (`n8n/workflows/B&B Lead Generator.json`)
**Status:** Design approved, pending implementation

---

## Problem

The current workflow sends one review email per qualified lead. At 4–6 qualified leads per run, this produces 4–6 emails every Monday morning — noisy and harder to act on than a single consolidated view.

---

## Goal

Send one summary email per run containing all qualified leads and their drafted outreach. Log all leads to Neon in a single write at the end of the run, including a `workflow_events` row per run.

---

## Architecture

The SplitInBatches loop stays intact for per-lead scoring and drafting. Qualified leads are accumulated in n8n workflow static data during the loop. After the loop finishes, the done output triggers a single summary email and consolidated Neon logging.

### Data flow

```
Schedule Trigger
  → Initialize Accumulator (Code) — clears staticData.qualifiedLeads = []
  → Search Apollo
  → Read Exclusion Sheet
  → Filter and Dedup
  → Split by Lead
      [loop output]
        → Score with Claude
        → Parse Score
        → Score 8 or Above? (IF)
            [true]  → Draft Outreach → Parse Draft → Accumulate Lead (Code) → Split by Lead (loop back)
            [false] → Split by Lead (loop back)
      [done output]
        → Build Summary Email (Code) — reads staticData, builds HTML
        → Send Review Email (SendGrid) — one email
        → Log All to Neon (Postgres) — multi-row INSERT to leads + one row to workflow_events
```

---

## Node Changes

| Action | Node | Detail |
|--------|------|--------|
| Add | **Initialize Accumulator** | Code node after Schedule Trigger. Sets `$getWorkflowStaticData('global').qualifiedLeads = []`. Runs once per execution before the loop. |
| Replace | **Restore Lead Fields** → **Accumulate Lead** | Code node. Restores all lead fields to `$json` (same as current Set node). Also pushes lead object into `staticData.qualifiedLeads`. |
| Remove | **Send Review Email** (inside loop) | Moved to after the loop. |
| Remove | **Log Lead to Neon** (inside loop) | Moved to after the loop. |
| Add | **Build Summary Email** | Code node connected to Split by Lead done output. Reads `staticData.qualifiedLeads`, builds HTML email body. |
| Keep | **Send Review Email** | Moved to after Build Summary Email. One SendGrid call per run. |
| Add | **Log All to Neon** | Postgres node after Send Review Email. Multi-row INSERT to `leads` + one INSERT to `workflow_events`. |

Loop-back connections are unchanged: Accumulate Lead → Split by Lead (true branch), false branch → Split by Lead.

---

## Summary Email

**From:** studio@norrai.co
**To:** egachuu@gmail.com (placeholder — replace with B&B inbox before go-live)
**Subject:** `B&B Lead Prospects — Week of {{date}} ({{n}} qualified)`

**Body (qualified leads exist):**
```
{{n}} leads qualified this week. Review each draft below and send from your own email.

─────────────────────────────
Lead 1 of {{n}}
{{full_name}} — {{title}} at {{company}}, {{city}}, {{state}}
Score: {{score}}/10 — {{reason}}
Email: {{email}}

Drafted outreach:
{{draft}}
─────────────────────────────
Lead 2 of {{n}}
...
```

**Body (zero qualified leads):**
```
The workflow ran but no leads scored 8 or above this week.
```

---

## Neon Logging

### `leads` table — one row per qualified lead

Same schema as current: `client_id`, `lead_name`, `email`, `phone`, `source`, `lead_message` (drafted outreach), `metadata`.

```json
{
  "client_id": "86a01b94-ddab-4594-8afc-8212fb18fdd0",
  "lead_name": "{{full_name}}",
  "email": "{{email}}",
  "phone": null,
  "source": "bnb_lead_generator",
  "lead_message": "{{draft}}",
  "metadata": {
    "company": "{{company}}",
    "title": "{{title}}",
    "location": "{{city}}, {{state}}",
    "apollo_score": 8,
    "score_reason": "...",
    "draft_sent": true
  }
}
```

Built as a multi-row INSERT from `staticData.qualifiedLeads` in a single Postgres node execution.

### `workflow_events` table — one row per run

```json
{
  "workflow": "bnb_lead_generator",
  "status": "success",
  "metadata": {
    "apollo_returned": 15,
    "after_dedup": 10,
    "qualified": 3,
    "run_date": "2026-05-05"
  }
}
```

`apollo_returned` and `after_dedup` counts are captured in the Initialize Accumulator node and stored in static data alongside `qualifiedLeads`.

---

## Static Data Shape

```js
$getWorkflowStaticData('global') = {
  qualifiedLeads: [
    {
      first_name, last_name, full_name, title, email,
      company, city, state, score, reason, draft
    },
    ...
  ],
  apolloReturned: 15,
  afterDedup: 10
}
```

Cleared at the start of every run by Initialize Accumulator.

---

## Error Handling

- `continueOnFail` stays on all external call nodes (Claude, SendGrid, Postgres)
- If Build Summary Email finds `staticData.qualifiedLeads` is empty (all leads failed or scored < 8), it sends the "no leads" email — same as the zero-qualified case
- Failed individual leads (Claude timeout, bad Apollo data) simply don't appear in static data and are silently skipped — visible in n8n execution view

---

## What Does Not Change

- Apollo search parameters
- Exclusion sheet logic (Filter and Dedup node)
- Claude scoring and drafting prompts
- SendGrid credential
- Neon credential and `leads` table schema
- Loop-back wiring for SplitInBatches
