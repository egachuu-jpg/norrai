# 7-Touch Cold Nurture Enhancements — PRD
**Date:** 2026-05-22
**Status:** Backlog
**Client:** Weichert, Realtors® — Heartland (Evan Knutson + Michelle Jasinski)
**Neon story:** Weichert Realty - 7-Touch Cold Nurture Enhancements

---

## Overview

Three workstreams layered onto the existing nurture infrastructure:

1. **Weekly de-enroll digest** — Monday 10am CT email to each agent listing their active nurture leads with a per-lead Remove button
2. **Mid-sequence enrollment check** — 7-Touch workflow verifies lead is still enrolled before every send
3. **Activate Nurture Prompt Scheduler + Confirm** — already imported into n8n, just need to be published

---

## Workstream 1 — Weekly Agent De-Enroll Digest

### Problem
Once a lead is enrolled in the 7-touch sequence, there's no easy off-ramp for the agent. If the lead re-engages or goes cold, nurture keeps firing. The agent has no weekly touchpoint to review and prune their active list.

### Solution
A scheduled workflow fires every Monday at 10:00am CT. It queries all leads with `status = 'nurturing'` grouped by agent and sends each agent a Polar Modern digest email. Each lead row has a **Remove from Nurture** button — a tokenized link that, when clicked, updates `leads.status = 'unenrolled'` and shows the agent a confirmation page.

### New workflows

| Workflow | Type | Trigger |
|---|---|---|
| Nurture De-Enroll Prompt | Scheduled | Monday 10:00am CT (15:00 UTC) |
| Nurture De-Enroll Confirm | Webhook | GET /webhook/nurture-deenroll-confirm |

### De-Enroll Prompt — Neon query
```sql
SELECT
  l.id, l.lead_name, l.email, l.phone, l.source, l.nurture_enrolled_at,
  c.primary_contact_email
FROM leads l
JOIN clients c ON l.client_id = c.id
WHERE l.status = 'nurturing'
  AND c.status = 'active'
ORDER BY c.id, l.nurture_enrolled_at
```
Group by `primary_contact_email`. Skip agents with zero results.

### De-Enroll Confirm — webhook flow
1. Receive `GET /webhook/nurture-deenroll-confirm?lead_id=...&token=...`
2. Validate HMAC-SHA256 token (lead_id + shared secret stored as n8n credential)
3. Neon: `SELECT lead_name, status FROM leads WHERE id = $lead_id`
4. If `status != 'nurturing'` → return "Already removed" page (idempotency)
5. `UPDATE leads SET status = 'unenrolled', updated_at = now() WHERE id = $lead_id`
6. Return Polar Modern success page: *"Done. [lead_name] has been removed from nurture."*

### Lead status values
| Status | Meaning |
|---|---|
| `new` | Default — just entered system |
| `contacted` | First touch sent |
| `qualified` | Agent confirmed as a real prospect |
| `nurturing` | Actively enrolled in 7-touch sequence |
| `converted` | Became a client |
| `unenrolled` | Agent manually removed from nurture |

No CHECK constraint on `leads.status` — no migration needed.

---

## Workstream 2 — Mid-Sequence Enrollment Check

### Problem
The current 7-Touch Cold Nurture workflow has no guard between touches. If a lead is de-enrolled (or converted) after touch 2, touches 3–7 still fire.

### Solution
Add a Neon status lookup + IF node before each of the 7 send nodes:
```sql
SELECT status FROM leads WHERE id = $lead_id
```
`IF status != 'nurturing'` → stop execution. No message sent.

**Note:** Verify how lead_id is currently threaded through the workflow. If it's not in scope, look up by phone or email and add lead_id to the initial Set node for downstream use.

---

## Workstream 3 — Activate Nurture Prompt Scheduler + Confirm

Both workflows are already imported into n8n. They handle lead *enrollment* (not de-enrollment) — the agent receives a daily digest of unenrolled leads and can click to enroll them in the 7-touch sequence.

### Nurture Prompt Scheduler (workflow_name: `nurture_prompt_scheduler`)
- Runs daily at 8:00am CT (13:00 UTC)
- Queries: `nurture_enrolled_at IS NULL`, older than 7 days, status not converted/dead, client active
- Groups by agent, sends Polar Modern digest with "Enroll in Cold Nurture" button per lead
- Button = tokenized URL → /webhook/nurture-prompt-confirm

### Nurture Prompt Confirm (workflow_name: `nurture_prompt_confirm`)
- GET webhook — fires on button click
- Validates token, checks lead not already enrolled
- Fires POST to /webhook/nurture-enroll-slack (hands off to 7-touch sequence)
- Stamps `nurture_enrolled_at = now()` on lead record
- Returns success page: *"Done. [Lead name] has been enrolled."*

### Pre-activation checklist (both workflows)
- [ ] Cron/webhook paths use `/webhook/` not `/webhook-test/`
- [ ] Error Workflow → Norr AI Workflow Error Logger
- [ ] Logging nodes wired (triggered + completed → workflow_events)

---

## Workflow Registry Additions

| Workflow | `workflow_name` |
|---|---|
| Nurture De-Enroll Prompt | `nurture_deenroll_prompt` |
| Nurture De-Enroll Confirm | `nurture_deenroll_confirm` |

Add both to the registry table in `CLAUDE.md`.

---

## Task Sequence (Neon `tasks` table)

| Seq | Title | Category |
|---|---|---|
| 1 | Document unenrolled status in db/schema.sql + db/README.md | ops |
| 2 | Build Nurture De-Enroll Prompt scheduled workflow | dev |
| 3 | Build Nurture De-Enroll Confirm webhook workflow | dev |
| 4 | Add enrollment check to 7-Touch Cold Nurture workflow | dev |
| 5 | Activate Nurture Prompt Scheduler | ops |
| 6 | Activate Nurture Prompt Confirm | ops |
| 7 | Smoke test Nurture Prompt Scheduler | testing |
| 8 | Smoke test Nurture Prompt Confirm | testing |
| 9 | Smoke test Nurture De-Enroll Prompt end to end | testing |
| 10 | Smoke test Nurture De-Enroll Confirm end to end | testing |
| 11 | Update CLAUDE.md workflow registry | ops |
