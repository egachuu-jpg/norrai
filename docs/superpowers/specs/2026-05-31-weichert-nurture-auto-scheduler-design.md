# Weichert Nurture Auto-Scheduler — Design Spec

**Date:** 2026-05-31
**Status:** Approved

---

## Overview

A Monday morning workflow scoped to Weichert agents (Evan Knutson, Michelle Jasinski) that automatically enrolls eligible leads into the 7-Touch Cold Nurture sequence — no agent approval step required. A FYI digest email is sent to each agent listing enrolled leads with a "Remove from Nurture" option in case they're already working a lead.

Differs from the standard Nurture Prompt Scheduler in two ways: it auto-fires the nurture sequence instead of prompting for confirmation, and the digest email is informational rather than action-required.

---

## Node Flow

| # | Node | Type | Notes |
|---|------|------|-------|
| 1 | Schedule Trigger | Schedule | `0 13 * * *` — Monday 8am CT |
| 2 | Log Triggered | Postgres | `norrai_internal`, `continueOnFail: true` |
| 3 | Query Eligible Leads | Postgres | See query below, `continueOnFail: true` |
| 4 | Has Eligible Leads? | IF | `$json.id` not empty — false branch exits silently |
| 5 | Set Status Nurturing | Postgres | UPDATE per lead, `continueOnFail: true` |
| 6 | Fire Nurture Sequence | HTTP Request | POST to `/webhook/nurture-enroll` per lead, `continueOnFail: true` |
| 7 | Group by Agent | Code | Collects all leads, groups by agent_email, builds FYI HTML digest |
| 8 | Send FYI Email | HTTP Request | POST to SendGrid per agent |
| 9 | Log Completed | Postgres | Per agent, captures `lead_count` + `agent_email`, `continueOnFail: true` |

---

## Query — Eligible Leads

```sql
SELECT
  l.id,
  l.lead_name,
  l.email,
  l.phone,
  l.source,
  l.metadata,
  l.lead_message,
  l.nurture_enrolled_at,
  c.id AS client_id,
  c.primary_contact_email AS agent_email,
  c.primary_contact_name AS agent_name,
  c.primary_contact_phone AS agent_phone,
  c.business_name
FROM leads l
JOIN clients c ON l.client_id = c.id
WHERE l.nurture_enrolled_at IS NULL
  AND l.status NOT IN ('converted', 'unenrolled', 'dead')
  AND c.status = 'active'
  AND l.created_at <= now() - INTERVAL '7 days'
  AND c.id IN (
    'ded234e3-...',  -- Evan Knutson
    '451306d1-...'   -- Michelle Jasinski
  )
ORDER BY c.id, l.created_at
```

---

## Set Status Nurturing

```sql
UPDATE leads
SET status = 'nurturing', nurture_enrolled_at = now(), updated_at = now()
WHERE id = '{{ $json.id }}'
```

Runs per lead via item linking. `continueOnFail: true` — a failed UPDATE does not block the nurture fire.

---

## Fire Nurture Sequence

HTTP POST to `https://norrai.app.n8n.cloud/webhook/nurture-enroll`.

Header: `x-norr-token: 8F68D963-7060-4033-BD04-7593E4B203CB`

Payload built from `$('Query Eligible Leads').item.json`:

```json
{
  "lead_name": "...",
  "email": "...",
  "phone": "...",
  "source": "...",
  "lead_message": "...",
  "property_address": "...",
  "price_range": "...",
  "beds": "...",
  "baths": "...",
  "agent_name": "...",
  "agent_email": "...",
  "agent_phone": "..."
}
```

`continueOnFail: true` — a failed fire is not fatal. Lead status is already set to `nurturing`; de-enroll prompt will surface it next Monday.

---

## Group by Agent (Code Node)

Uses `$('Query Eligible Leads').all()` to access all leads regardless of downstream node output. Groups by `agent_email`. For each agent, produces one item:

```js
{
  has_leads: true,
  to_email: agent_email,
  subject: `Nurture auto-started — ${n} lead${n > 1 ? 's' : ''} enrolled — ${today}`,
  html_body: '...',
  lead_count: n,
  agent_name
}
```

Metadata parsing uses the same `JSON.parse` pattern with string/object check.

---

## FYI Email

**Subject:** `Nurture auto-started — X lead[s] enrolled — [date]`

**Body:**
> Hi [first name],
>
> We automatically added these leads to your cold nurture sequence this morning. Their first email goes out tomorrow — if you're already working with one of them, click Remove before it sends.

Each lead row: name · source · enrolled date · property info (if any in metadata) · red **Remove from Nurture** button.

Remove button URL: `https://norrai.app.n8n.cloud/webhook/nurture-deenroll-confirm?lead_id={{lead.id}}&token=8F68D963-7060-4033-BD04-7593E4B203CB`

**Footer:** *"Removed leads won't receive any further follow-ups. Leads you don't remove will receive touches over the next 21 days."*

Click tracking: disabled.

---

## Logging

- `workflow_name`: `weichert_nurture_auto_scheduler`
- Log Triggered: once per execution, `norrai_internal` client_id
- Log Completed: once per agent email sent, payload includes `lead_count` and `agent_email`
- Error Workflow: `Norr AI Workflow Error Logger` — add `weichert_nurture_auto_scheduler` to `WORKFLOW_NAME_MAP`

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| No eligible leads | Has Eligible Leads? exits false branch — no email, no Log Completed |
| Nurture fire fails for a lead | `continueOnFail: true` — status already set to `nurturing`, de-enroll prompt surfaces it next Monday |
| Lead already in nurture | `nurture_enrolled_at IS NULL` in query — already-enrolled leads never appear |
| Malformed metadata string | Group by Agent checks `typeof metadata === 'string'` before parsing |

---

## Registry Updates Required

- Add `weichert_nurture_auto_scheduler` to CLAUDE.md workflow_name registry
- Add to `Norr AI Workflow Error Logger` WORKFLOW_NAME_MAP
