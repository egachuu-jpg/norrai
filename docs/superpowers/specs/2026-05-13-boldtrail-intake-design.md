# BoldTrail Intake Workflow — Design Spec

**Date:** 2026-05-13
**Client:** Weichert agent (solo, Weichert-managed BoldTrail instance)
**Status:** Approved for implementation

---

## Context

This client uses BoldTrail (kvCORE) as their CRM. Leads arrive in BoldTrail from various sources (website, Zillow import, etc.). The agent currently has zero visibility into new leads — they unsubscribed from BoldTrail notification emails due to noise, and BoldTrail's built-in email drip is sending listing alerts to leads without the agent's awareness.

Norr AI's value-add:
- Instant personal response the moment a lead hits BoldTrail (agent has no current response)
- SMS outreach (BoldTrail does not text leads)
- Conversational nurture differentiated from BoldTrail's passive listing email drip
- Slack notification to agent when a new lead arrives

---

## Architecture

```
BoldTrail new lead event
  → Zapier trigger (New Lead)
  → Zapier action: POST to n8n webhook
  → n8n: Normalize Payload (Code node)
  → n8n: Send to Lead Cleanser
  → (existing) Instant Lead Response + Cold Nurture
```

---

## Zapier Setup (one-time, manual)

- **Trigger:** BoldTrail — New Lead
  - Authenticates using the Zapier API key found under BoldTrail Settings → Lead Dropbox
- **Action:** Webhooks by Zapier — POST
  - URL: `https://norrai.app.n8n.cloud/webhook/intake-boldtrail`
  - Payload: all available BoldTrail lead fields mapped to the normalized shape below, plus hardcoded `client_token` for this agent
- **Security:** n8n webhook URL acts as the shared secret. No additional token check needed on the n8n side — obscurity of the URL plus Zapier's BoldTrail authentication is sufficient.

### Zapier field mapping

BoldTrail's exact Zapier field names must be confirmed when setting up the Zap. Expected mappings:

| Norr AI field | BoldTrail Zapier field (verify on setup) |
|---|---|
| `lead_name` | `first_name` + `last_name` (or `full_name`) |
| `email` | `email` |
| `phone` | `phone` |
| `source` | hardcode `'boldtrail'` |
| `property_address` | `address` or property interest field |
| `price_range` | `min_price`–`max_price` or `price_range` |
| `beds` | `min_beds` or `bedrooms` |
| `lead_message` | `notes` or `message` |
| `client_token` | hardcoded (this agent's token from `clients` table) |

---

## n8n Workflow: Real Estate BoldTrail Intake

**Webhook path:** `intake-boldtrail`
**Workflow name (registry):** `boldtrail_intake`
**Method:** POST only

### Nodes

1. **Receive BoldTrail Lead** — Webhook, POST, path `intake-boldtrail`, responseMode `onReceived`

2. **Lookup Client** — Postgres, `continueOnFail: true`
   ```sql
   SELECT id FROM clients WHERE token = '<hardcoded-agent-token>'
   ```
   Hardcode the client UUID directly — no dynamic token resolution needed since this workflow is dedicated to one agent.

3. **Log Triggered** — Postgres, `continueOnFail: true`
   ```sql
   INSERT INTO workflow_events (client_id, workflow_name, event_type, payload)
   VALUES ('<client_id>', 'boldtrail_intake', 'triggered',
     '{"execution_id": "{{ $execution.id }}"}'::jsonb)
   ```

4. **Normalize Payload** — Code node
   Maps incoming Zapier POST body to standard shape:
   ```js
   const b = $input.first().json.body;
   return [{
     json: {
       client_token: '<hardcoded-agent-token>',
       lead_name: `${b.first_name || ''} ${b.last_name || ''}`.trim() || b.full_name || '',
       email: b.email || '',
       phone: b.phone || '',
       source: 'boldtrail',
       property_address: b.address || b.property_address || '',
       price_range: b.price_range || (b.min_price ? `$${b.min_price}–$${b.max_price}` : ''),
       beds: b.min_beds || b.bedrooms || null,
       lead_message: b.notes || b.message || 'BoldTrail lead'
     }
   }];
   ```
   Field names are placeholders — confirm against actual Zapier trigger output before finalizing.

5. **Send to Lead Cleanser** — HTTP Request, POST
   - URL: `https://norrai.app.n8n.cloud/webhook/lead-cleanser`
   - Body: `JSON.stringify($json)`

6. **Log Completed** — Postgres, `continueOnFail: true`
   ```sql
   INSERT INTO workflow_events (client_id, workflow_name, event_type, payload)
   VALUES ('<client_id>', 'boldtrail_intake', 'completed',
     '{"execution_id": "{{ $execution.id }}"}'::jsonb)
   ```

7. **Error Workflow setting** — point to `Norr AI Workflow Error Logger`

---

## Downstream Behavior

Identical to all other intake sources:

```
Lead Cleanser
  → dedupe check (email + phone)
  → new lead: INSERT to Neon leads table
  → Trigger Lead Response Auto
      → Instant Lead Response (SMS via Twilio — see prerequisite below)
      → Cold Nurture enrollment (7-touch, SMS-dominant)
          → if no reply after 7 days: enroll in cold nurture sequence
```

---

## Channel Strategy

BoldTrail is already sending listing alert emails to leads. To avoid doubling up:

- **Instant lead response:** SMS primary (personal, differentiated from listing alerts)
- **Cold nurture:** SMS-dominant across all 7 touches
- **Email nurture touches:** conversational/personal only — no listing content

---

## Prerequisites Before Go-Live

1. **Twilio subaccount provisioned** for this agent — one subaccount, one local number (507 area code preferred)
2. **Client record created** in Neon `clients` table — token UUID needed for Zapier payload and hardcoded node values
3. **Zapier account** — agent or Norr AI account; free tier may be sufficient depending on lead volume
4. **Zapier Zap configured** — BoldTrail trigger + Webhook POST action, field mapping confirmed against live Zapier trigger output
5. **Agent re-subscribed** (or notified via Slack) — agent should get Slack notifications for new leads so they have visibility without BoldTrail email noise

---

## Out of Scope

- **Reply handling / nurture de-enrollment** — when a lead replies to an AI-sent SMS, nurture should pause and the agent should be notified. This is a separate spec covering all lead sources, not just BoldTrail.
- **BoldTrail admin webhook** — Weichert controls the BoldTrail instance; outbound webhook config is not available at the agent level. Zapier is the supported integration path.

---

## Workflow Name Registry Entry

| Workflow | `workflow_name` |
|---|---|
| Real Estate BoldTrail Intake | `boldtrail_intake` |
