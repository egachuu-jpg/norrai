# BoldTrail Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an n8n intake workflow that receives new BoldTrail leads via Zapier and routes them through the existing Lead Cleanser pipeline (Instant Lead Response + Cold Nurture).

**Architecture:** Zapier polls BoldTrail for new leads using the agent's Zapier API key, then POSTs to an n8n webhook. n8n normalizes the payload to the standard shape and forwards to the Lead Cleanser, which handles deduplication, Neon insertion, and downstream workflow triggers.

**Tech Stack:** n8n (webhook + Code node + HTTP Request + Postgres), Zapier (BoldTrail trigger + Webhooks action), Neon (workflow_events logging)

---

### Task 1: Create BoldTrail Intake workflow JSON

**Files:**
- Create: `n8n/workflows/Real Estate BoldTrail Intake.json`

This workflow has no automated tests — n8n workflow JSONs are validated by import and manual smoke test. The "test" is Task 3.

- [ ] **Step 1: Create the workflow JSON**

Create `n8n/workflows/Real Estate BoldTrail Intake.json` with the following content:

```json
{
  "name": "Real Estate BoldTrail Intake",
  "nodes": [
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "intake-boldtrail",
        "responseMode": "onReceived",
        "options": {}
      },
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2.1,
      "position": [240, 300],
      "id": "bt000001-0001-4000-8000-000000000001",
      "name": "Receive BoldTrail Lead",
      "webhookId": "boldtrail-intake-webhook-001"
    },
    {
      "parameters": {
        "operation": "executeQuery",
        "query": "SELECT id FROM clients WHERE token = 'CLIENT_TOKEN_PLACEHOLDER'",
        "continueOnFail": true
      },
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2.5,
      "position": [440, 300],
      "id": "bt000001-0002-4000-8000-000000000002",
      "name": "Lookup Client",
      "continueOnFail": true,
      "credentials": {
        "postgres": {
          "id": "NEON_CREDENTIAL_ID",
          "name": "Neon account"
        }
      }
    },
    {
      "parameters": {
        "operation": "executeQuery",
        "query": "INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('CLIENT_ID_PLACEHOLDER', 'boldtrail_intake', 'triggered', '{\"execution_id\": \"{{ $execution.id }}\"}'::jsonb)",
        "continueOnFail": true
      },
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2.5,
      "position": [640, 300],
      "id": "bt000001-0003-4000-8000-000000000003",
      "name": "Log Triggered",
      "continueOnFail": true,
      "credentials": {
        "postgres": {
          "id": "NEON_CREDENTIAL_ID",
          "name": "Neon account"
        }
      }
    },
    {
      "parameters": {
        "jsCode": "// Map BoldTrail Zapier fields to Norr AI standard payload shape.\n// IMPORTANT: Verify field names against actual Zapier trigger output before going live.\n// Open the Zap, run a test, and inspect the 'Available fields' panel to confirm.\nconst b = $input.first().json.body || $input.first().json;\n\nconst firstName = b.first_name || b.contact_first_name || '';\nconst lastName = b.last_name || b.contact_last_name || '';\nconst fullName = b.full_name || b.contact_name || `${firstName} ${lastName}`.trim();\n\nconst minPrice = b.min_price || b.price_min || '';\nconst maxPrice = b.max_price || b.price_max || '';\nconst priceRange = b.price_range || (minPrice ? `$${minPrice}–$${maxPrice}` : '');\n\nreturn [{\n  json: {\n    client_token: 'CLIENT_TOKEN_PLACEHOLDER',\n    lead_name: fullName,\n    email: b.email || b.contact_email || '',\n    phone: b.phone || b.contact_phone || b.phone_number || '',\n    source: 'boldtrail',\n    property_address: b.address || b.property_address || b.street_address || '',\n    price_range: priceRange,\n    beds: b.min_beds || b.bedrooms || b.beds || null,\n    lead_message: b.notes || b.message || b.lead_notes || 'BoldTrail lead'\n  }\n}];"
      },
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [840, 300],
      "id": "bt000001-0004-4000-8000-000000000004",
      "name": "Normalize Payload"
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://norrai.app.n8n.cloud/webhook/lead-cleanser",
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify($json) }}",
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.4,
      "position": [1040, 300],
      "id": "bt000001-0005-4000-8000-000000000005",
      "name": "Send to Lead Cleanser"
    },
    {
      "parameters": {
        "operation": "executeQuery",
        "query": "INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('CLIENT_ID_PLACEHOLDER', 'boldtrail_intake', 'completed', '{\"execution_id\": \"{{ $execution.id }}\"}'::jsonb)",
        "continueOnFail": true
      },
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2.5,
      "position": [1240, 300],
      "id": "bt000001-0006-4000-8000-000000000006",
      "name": "Log Completed",
      "continueOnFail": true,
      "credentials": {
        "postgres": {
          "id": "NEON_CREDENTIAL_ID",
          "name": "Neon account"
        }
      }
    }
  ],
  "pinData": {},
  "connections": {
    "Receive BoldTrail Lead": {"main": [[{"node": "Lookup Client", "type": "main", "index": 0}]]},
    "Lookup Client": {"main": [[{"node": "Log Triggered", "type": "main", "index": 0}]]},
    "Log Triggered": {"main": [[{"node": "Normalize Payload", "type": "main", "index": 0}]]},
    "Normalize Payload": {"main": [[{"node": "Send to Lead Cleanser", "type": "main", "index": 0}]]},
    "Send to Lead Cleanser": {"main": [[{"node": "Log Completed", "type": "main", "index": 0}]]}
  },
  "active": false,
  "settings": {
    "executionOrder": "v1",
    "errorWorkflow": "Norr AI Workflow Error Logger"
  },
  "versionId": "boldtrail-intake-v1-001",
  "meta": {
    "templateCredsSetupCompleted": false,
    "instanceId": "0d4efb408d47ca7fe5f9bfa9b6b5b1a6e6f8fcb31cb2584a172b735d47653914"
  },
  "id": "",
  "tags": []
}
```

- [ ] **Step 2: Commit**

```bash
git add n8n/workflows/Real\ Estate\ BoldTrail\ Intake.json
git commit -m "feat: add BoldTrail intake workflow JSON"
```

---

### Task 2: Update CLAUDE.md workflow name registry

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add `boldtrail_intake` to the workflow name registry table**

In `CLAUDE.md`, find the `workflow_name` registry table under `### Workflow Logging Standard`. Add this row at the end of the table:

```markdown
| Real Estate BoldTrail Intake | `boldtrail_intake` |
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: register boldtrail_intake workflow name in registry"
```

---

### Task 3: Client onboarding — populate placeholders

Before the workflow can go live, two values need to be filled in. This task is done once the client record exists in Neon.

**Files:**
- Modify: `n8n/workflows/Real Estate BoldTrail Intake.json`

- [ ] **Step 1: Get the client's token and ID from Neon**

Run this query against the Neon `neondb` database (use the connection string from `.env`):

```sql
SELECT id, token FROM clients WHERE primary_contact_email = '<agent-email>';
```

Note the `id` (UUID) and `token` (UUID) values.

- [ ] **Step 2: Replace placeholders in the workflow JSON**

In `n8n/workflows/Real Estate BoldTrail Intake.json`, replace all occurrences of:
- `CLIENT_TOKEN_PLACEHOLDER` → the `token` value from the query above
- `CLIENT_ID_PLACEHOLDER` → the `id` value from the query above

There are 4 occurrences total:
- `Lookup Client` node query (1× token)
- `Log Triggered` node query (1× id)
- `Normalize Payload` node code (1× token)
- `Log Completed` node query (1× id)

- [ ] **Step 3: Commit**

```bash
git add n8n/workflows/Real\ Estate\ BoldTrail\ Intake.json
git commit -m "feat: wire client token and ID into BoldTrail intake workflow"
```

---

### Task 4: Import workflow into n8n

**This is a manual step in the n8n UI.**

- [ ] **Step 1: Import the workflow**

1. Open n8n Cloud → `https://norrai.app.n8n.cloud`
2. Click **New Workflow** → **Import from file**
3. Select `n8n/workflows/Real Estate BoldTrail Intake.json`
4. Open the imported workflow

- [ ] **Step 2: Wire credentials**

In n8n, open each Postgres node and confirm the `Neon account` credential is selected. The JSON has `"id": "NEON_CREDENTIAL_ID"` as a placeholder — n8n will prompt you to select the real credential on import.

- [ ] **Step 3: Set Error Workflow**

In workflow **Settings** → **Error Workflow**, select `Norr AI Workflow Error Logger`.

- [ ] **Step 4: Activate the workflow**

Toggle the workflow to **Active**. The webhook is now live at:
```
https://norrai.app.n8n.cloud/webhook/intake-boldtrail
```

---

### Task 5: Set up Zapier

**This is a manual step in Zapier.**

Prerequisites: Zapier account (free tier is fine for low lead volume — 100 tasks/mo).

- [ ] **Step 1: Create a new Zap**

Go to zapier.com → **Create Zap**

- [ ] **Step 2: Configure the trigger**

- App: **BoldTrail** (search "BoldTrail" or "kvCORE")
- Trigger event: **New Lead**
- Account: connect using the Zapier API key from BoldTrail Settings → Lead Dropbox

- [ ] **Step 3: Test the trigger**

Run the trigger test. Inspect the **Available fields** panel carefully — note the exact field names BoldTrail exposes (e.g. is it `first_name` or `contact_first_name`? `phone` or `contact_phone`?).

Compare against the field name fallback chain in the Normalize Payload node:
```
lead_name:  b.full_name || b.contact_name || first_name + last_name
email:      b.email || b.contact_email
phone:      b.phone || b.contact_phone || b.phone_number
address:    b.address || b.property_address || b.street_address
price:      b.price_range || b.min_price + b.max_price
beds:       b.min_beds || b.bedrooms || b.beds
message:    b.notes || b.message || b.lead_notes
```

If any real field names are missing from the fallback chain, update the Normalize Payload node code in n8n (edit inline, save) and update the JSON file to match.

- [ ] **Step 4: Configure the action**

- App: **Webhooks by Zapier**
- Action event: **POST**
- URL: `https://norrai.app.n8n.cloud/webhook/intake-boldtrail`
- Payload type: **JSON**
- Data: map **all** available BoldTrail fields (let Zapier pass the full object — the Normalize Payload node picks what it needs)

- [ ] **Step 5: Test the action**

Run the Zap test. Check n8n executions — confirm the BoldTrail Intake workflow triggered.

- [ ] **Step 6: Turn the Zap on**

---

### Task 6: Smoke test end-to-end

- [ ] **Step 1: Trigger a test lead in BoldTrail**

In BoldTrail, manually create a test lead (use a fake name, real-looking email/phone). Wait for Zapier to detect it (up to 15 minutes on free tier; instant if you trigger manually via Zapier's "Run Zap" button).

- [ ] **Step 2: Verify n8n execution**

In n8n → Executions for `Real Estate BoldTrail Intake`:
- Execution should show **Success**
- Open execution → inspect **Normalize Payload** output → confirm all fields populated correctly
- Inspect **Send to Lead Cleanser** output → confirm 200 response

- [ ] **Step 3: Verify Lead Cleanser**

In n8n → Executions for `Real Estate Lead Cleanser`:
- Should have triggered from the BoldTrail intake
- Lead Exists? → should route to **Insert New Lead** (first run)
- Confirm **Trigger Lead Response** fired

- [ ] **Step 4: Verify Neon**

Run against Neon:
```sql
SELECT * FROM leads
WHERE source = 'boldtrail'
ORDER BY created_at DESC
LIMIT 1;
```
Expected: a row with the test lead's name, email, phone, source = 'boldtrail'.

```sql
SELECT * FROM workflow_events
WHERE workflow_name = 'boldtrail_intake'
ORDER BY created_at DESC
LIMIT 2;
```
Expected: two rows — one `triggered`, one `completed`.

- [ ] **Step 5: Verify Instant Lead Response**

Confirm the test lead's phone received an SMS within 2 minutes of the Zapier trigger firing.

- [ ] **Step 6: Clean up test lead**

Delete the test lead from Neon so it doesn't pollute the nurture sequence:
```sql
DELETE FROM leads WHERE source = 'boldtrail' AND email = '<test-email>';
```

---

## Prerequisites Checklist

Before starting Task 3 (client onboarding):

- [ ] Twilio subaccount provisioned for this agent (one subaccount, one local 507 number)
- [ ] Client record created in Neon `clients` table with `token` UUID set
- [ ] Zapier account available (agent's or Norr AI's)
- [ ] Agent confirmed they want SMS as primary channel (Twilio must be provisioned first)
