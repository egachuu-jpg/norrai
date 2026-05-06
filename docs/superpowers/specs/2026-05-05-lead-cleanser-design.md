# Lead Cleanser + Lead Response — Design Spec

**Date:** 2026-05-05
**Tier:** Starter / Growth (included in real estate package)
**Status:** Approved design, not yet implemented

---

## Overview

A generic, multi-source lead intake pipeline for real estate agents. Inbound leads from any source (Zillow, Realtor.com, Facebook Ads, agent custom forms) are normalized to a standard shape, deduped, inserted into Neon, and routed to an AI-drafted approval flow. The agent receives an email with Claude-written SMS and email drafts and approves before anything sends.

Scales to any number of clients with 6 fixed n8n workflows — no new workflows per client.

---

## Architecture

```
/webhook/intake/zillow?token=CLIENT_TOKEN   ─┐
/webhook/intake/realtor?token=CLIENT_TOKEN  ─┤
/webhook/intake/facebook?token=CLIENT_TOKEN ─┼──► Lead Cleanser ──► Lead Response ──► Agent Approval
/webhook/intake/custom?token=CLIENT_TOKEN   ─┘
```

**Intake workflows (4):** One per source. Receive native payload, normalize to standard shape, POST to Lead Cleanser. Each client gets their own token — same 4 workflows serve all clients.

**Lead Cleanser (1):** Resolve token → dedupe → Neon insert → hand off to Lead Response.

**Lead Response (1):** Claude drafts SMS + email → approval email to agent → tokenized action buttons.

**Action Handler (1):** Handles Send / Edit / Skip button clicks. (Could be bundled into Lead Response as a second webhook path, or kept separate.)

Total: **6 workflows**, regardless of client count.

---

## Normalized Payload Shape

All intake workflows produce this shape before POSTing to the cleanser:

```json
{
  "client_token": "abc123",
  "lead_name": "Sarah Johnson",
  "email": "sarah@gmail.com",
  "phone": "5075551234",
  "source": "zillow",
  "property_address": "123 Maple St",
  "price_range": "$250k-$320k",
  "beds": 3,
  "lead_message": "I'm interested in this property..."
}
```

`property_address`, `price_range`, and `beds` are optional — present when the source provides them, null otherwise.

---

## Source Intake Workflows

### Authentication
Every intake URL includes `?token=CLIENT_TOKEN`. The workflow validates against `clients.token` in Neon. Invalid or missing token → stop, log to `workflow_events`.

### Zillow
- Native fields: `firstName`, `lastName`, `email`, `phone`, `propertyAddress`, `message`
- Normalization: concatenate name, map fields directly
- Setup: agent configures webhook URL in Zillow Premier Agent portal

### Realtor.com
- Similar field structure to Zillow, slightly different names
- Normalization: same mapping pattern
- Setup: agent configures webhook URL in Realtor.com portal

### Facebook Lead Ads
- Two-step: Facebook sends a notification ping to the webhook; n8n calls `GET /leadgen/{lead_id}` via Graph API to fetch actual lead data
- Requires a Facebook App with webhook verification: Facebook sends a `hub.challenge` GET request on setup — n8n must echo it back
- Normalization: map Graph API response fields to standard shape
- Setup: Facebook App + Page subscription per agent

### Custom Forms
- Existing agent-facing forms (`lead_response.html`, `open_house.html`, `nurture_enroll.html`) already POST to n8n
- Add `?token=CLIENT_TOKEN` to their webhook URLs
- Reroute through Lead Cleanser instead of current direct workflows
- Normalization: already close to standard shape — minimal mapping

---

## Lead Cleanser Workflow

### Step 1 — Resolve token to client
```sql
SELECT id, primary_contact_email FROM clients WHERE token = $1
```
No match → stop, log failure to `workflow_events`.

### Step 2 — Dedupe
```sql
SELECT id FROM leads
WHERE client_id = $1 AND (email = $2 OR phone = $3)
LIMIT 1
```
- Match → update `lead_message` and `updated_at`, stop. No downstream trigger.
- No match → continue.

### Step 3 — Insert to Neon
```sql
INSERT INTO leads (client_id, lead_name, email, phone, source, lead_message,
                   status, stage, last_contacted_at, next_action_due, metadata)
VALUES (...)
```
- `status: new`, `stage: new`
- `last_contacted_at: null`
- `next_action_due: today` (AI OS picks it up in its nightly run)
- `metadata`: `{ "property_address": "...", "price_range": "...", "beds": 3 }`

### Step 4 — Hand off
POST normalized payload + `lead_id` to Lead Response webhook.

---

## Lead Response Workflow

### Step 1 — Build Claude prompt
Claude receives: lead name, source, property address, price range, beds, lead message, agent name.

Outputs two drafts:
- **SMS** — under 160 chars, conversational, acknowledges the specific property
- **Email** — warmer, slightly longer, same personalization

### Step 2 — Generate approval tokens
n8n Code node generates UUIDs for each action (`send_sms`, `send_email`, `skip`, `edit_sms`, `edit_email`). Written to `approval_tokens` table with expiry (24 hours), `lead_id`, `client_id`, and draft content.

### Step 3 — Send approval email to agent
SendGrid to `clients.primary_contact_email`. Contains:
- "New lead from [source]: [lead name]"
- Lead's message (quoted)
- SMS draft + **Send SMS** · **Edit** buttons
- Email draft + **Send Email** · **Edit** buttons
- **Skip** button
- All buttons are tokenized URLs to the Action Handler webhook

### Step 4 — Action Handler (separate webhook)
| Action | Behavior |
|--------|----------|
| `send_sms` | Twilio SMS to lead; update `last_contacted_at`, `status: contacted` in Neon; expire token |
| `send_email` | SendGrid to lead; same Neon update; expire token |
| `skip` | Set `next_action_due = today + 3`; expire token |
| `edit_sms` / `edit_email` | Open pre-populated Polar Modern HTML edit page; agent submits → same send path |

Expired or already-used tokens → return a friendly "This action has already been taken" page.

---

## Schema Changes Required

### `clients` table
Add column:
```sql
ALTER TABLE clients ADD COLUMN token text UNIQUE;
```
One token per client, generated at onboarding, stored securely.

### `approval_tokens` table (new)
```sql
CREATE TABLE approval_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       uuid NOT NULL REFERENCES leads(id),
  client_id     uuid NOT NULL REFERENCES clients(id),
  action        text NOT NULL,   -- send_sms | send_email | skip | edit_sms | edit_email
  draft_content text,
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
```

### `leads` table
Add columns (also required by AI OS spec):
```sql
ALTER TABLE leads ADD COLUMN stage text;
ALTER TABLE leads ADD COLUMN last_contacted_at timestamptz;
ALTER TABLE leads ADD COLUMN next_action_due date;
ALTER TABLE leads ADD COLUMN notes text;
```

### `workflow_events` table
Add column (also required by AI OS spec):
```sql
ALTER TABLE workflow_events ADD COLUMN lead_id uuid REFERENCES leads(id);
```

---

## What This Is Not

- Not a CRM — no pipeline UI, no contact management, no calendar
- Not full autopilot — agent approves every outgoing message
- Not source-specific logic — once normalized, all leads are treated identically downstream
- Not built yet for SMS intake (only webhook-based sources)

---

## Phase 2 Path

1. **Auto-enroll into nurture** — after agent sends initial response, auto-enroll lead in 7-touch cold nurture sequence
2. **Source-specific prompt templates** — Claude already receives `source` in Phase 1; Phase 2 uses it to select a different prompt template per source (open house tone vs. cold Zillow inquiry tone)
3. **SMS intake** — lead texts an agent's Twilio number, intake fires the same pipeline
4. **Duplicate notification** — when a dedupe match is found, notify agent ("This lead already exists — last contacted X days ago")
