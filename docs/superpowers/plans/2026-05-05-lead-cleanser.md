# Lead Cleanser + Lead Response Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a multi-source real estate lead intake pipeline that normalizes leads from Zillow, Realtor.com, Facebook Ads, and custom forms into a single shape, deduplicates against Neon, and routes to an AI-drafted agent approval flow.

**Architecture:** Four thin intake workflows (one per source) normalize payloads and POST to a shared Lead Cleanser. The cleanser resolves the client token, dedupes, and inserts into Neon before handing off to Lead Response. Lead Response calls Claude for SMS and email drafts, stores an approval token, and emails the agent a single-click approval UI. An Action Handler workflow processes Send/Skip/Edit clicks.

**Tech Stack:** n8n Cloud, Neon Postgres (postgres node v2.5), Claude API (HTTP Request to Anthropic), Twilio (native node), SendGrid (native node), Cloudflare Pages (HTML edit page)

---

## Files

| Action | Path | Purpose |
|--------|------|---------|
| Create | `db/migrations/001_lead_cleanser.sql` | All schema changes |
| Create | `n8n/workflows/Real Estate Zillow Intake.json` | Zillow normalization |
| Create | `n8n/workflows/Real Estate Realtor Intake.json` | Realtor.com normalization |
| Create | `n8n/workflows/Real Estate Facebook Intake.json` | Facebook Lead Ads + verification |
| Create | `n8n/workflows/Real Estate Custom Form Intake.json` | Existing agent forms |
| Create | `n8n/workflows/Real Estate Lead Cleanser.json` | Dedupe + Neon insert + handoff |
| Create | `n8n/workflows/Real Estate Lead Response Auto.json` | Claude drafts + approval email |
| Create | `n8n/workflows/Real Estate Lead Action Handler.json` | Send/Skip/Edit click handler |
| Create | `website/lead_action_edit.html` | Pre-populated draft editor for Edit flow |
| Modify | `n8n/TESTING_NOTES.md` | Add section for all new workflows |

---

## Task 1: Schema Migration

**Files:**
- Create: `db/migrations/001_lead_cleanser.sql`

- [ ] **Step 1: Write migration file**

```sql
-- db/migrations/001_lead_cleanser.sql
-- Lead Cleanser + Lead Response schema additions
-- Apply with: psql <neon-connection-string> -f db/migrations/001_lead_cleanser.sql

-- clients: add token for per-client webhook auth
ALTER TABLE clients ADD COLUMN IF NOT EXISTS token text UNIQUE;

-- leads: add pipeline stage + AI OS scheduler fields
ALTER TABLE leads ADD COLUMN IF NOT EXISTS stage text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_contacted_at timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_action_due date;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS notes text;

-- workflow_events: add lead_id for per-lead history queries
ALTER TABLE workflow_events ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES leads(id);

-- approval_tokens: one row per lead response event, holds both drafts + session token
CREATE TABLE IF NOT EXISTS approval_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token        text UNIQUE NOT NULL,
  lead_id      uuid NOT NULL REFERENCES leads(id),
  client_id    uuid NOT NULL REFERENCES clients(id),
  sms_draft    text,
  email_draft  text,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approval_tokens_token ON approval_tokens(token);
CREATE INDEX IF NOT EXISTS idx_approval_tokens_lead ON approval_tokens(lead_id);
```

- [ ] **Step 2: Apply migration via Neon MCP**

Run: `mcp__Neon__run_sql` on project `gentle-hill-54285247`, database `neondb`, with the full SQL above.

Expected: No errors. Each statement runs clean (IF NOT EXISTS guards make it idempotent).

- [ ] **Step 3: Verify schema**

Run: `SELECT column_name FROM information_schema.columns WHERE table_name = 'leads' AND column_name IN ('stage','last_contacted_at','next_action_due','notes');`

Expected: 4 rows returned.

Run: `SELECT column_name FROM information_schema.columns WHERE table_name = 'clients' AND column_name = 'token';`

Expected: 1 row.

Run: `SELECT table_name FROM information_schema.tables WHERE table_name = 'approval_tokens';`

Expected: 1 row.

- [ ] **Step 4: Seed a test client token**

```sql
UPDATE clients
SET token = 'test-token-realestate-001'
WHERE vertical = 'real_estate'
LIMIT 1;
```

Note the `id` and `primary_contact_email` of that client — you'll need them in later tests.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/001_lead_cleanser.sql
git commit -m "feat: add lead cleanser schema migrations"
```

---

## Task 2: Lead Cleanser Workflow

**Files:**
- Create: `n8n/workflows/Real Estate Lead Cleanser.json`

The cleanser receives the normalized payload, resolves the client token, deduplicates, inserts the lead, and POSTs to Lead Response.

- [ ] **Step 1: Write workflow JSON**

```json
{
  "name": "Real Estate Lead Cleanser",
  "nodes": [
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "lead-cleanser",
        "responseMode": "onReceived",
        "options": {}
      },
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2.1,
      "position": [240, 300],
      "id": "lc000001-0001-4000-8000-000000000001",
      "name": "Receive Lead",
      "webhookId": "lead-cleanser-webhook-001"
    },
    {
      "parameters": {
        "jsCode": "const b = $input.first().json.body;\nconst token = b.client_token || '';\nreturn [{\n  json: {\n    query: `SELECT id, primary_contact_email, primary_contact_name FROM clients WHERE token = '${token.replace(/'/g, \"''\")}'`,\n    payload: b\n  }\n}];"
      },
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [440, 300],
      "id": "lc000001-0002-4000-8000-000000000002",
      "name": "Build Token Query"
    },
    {
      "parameters": {
        "operation": "executeQuery",
        "query": "={{ $json.query }}"
      },
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2.5,
      "position": [640, 300],
      "id": "lc000001-0003-4000-8000-000000000003",
      "name": "Resolve Token",
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
        "conditions": {
          "options": {"caseSensitive": true, "leftValue": "", "typeValidation": "loose", "version": 3},
          "conditions": [
            {
              "id": "token-found-001",
              "leftValue": "={{ $json.id }}",
              "rightValue": "",
              "operator": {"type": "string", "operation": "notEmpty"}
            }
          ],
          "combinator": "and"
        },
        "looseTypeValidation": true,
        "options": {}
      },
      "type": "n8n-nodes-base.if",
      "typeVersion": 2.3,
      "position": [840, 300],
      "id": "lc000001-0004-4000-8000-000000000004",
      "name": "Token Found?"
    },
    {
      "parameters": {
        "jsCode": "const row = $input.first().json;\nconst prev = $('Build Token Query').first().json.payload;\nconst email = (prev.email || '').replace(/'/g, \"''\");\nconst phone = (prev.phone || '').replace(/'/g, \"''\");\nreturn [{\n  json: {\n    query: `SELECT id FROM leads WHERE client_id = '${row.id}' AND (email = '${email}' OR phone = '${phone}') LIMIT 1`,\n    client_id: row.id,\n    agent_email: row.primary_contact_email,\n    agent_name: row.primary_contact_name,\n    payload: prev\n  }\n}];"
      },
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1040, 220],
      "id": "lc000001-0005-4000-8000-000000000005",
      "name": "Build Dedupe Query"
    },
    {
      "parameters": {
        "operation": "executeQuery",
        "query": "={{ $json.query }}"
      },
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2.5,
      "position": [1240, 220],
      "id": "lc000001-0006-4000-8000-000000000006",
      "name": "Dedupe Check",
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
        "conditions": {
          "options": {"caseSensitive": true, "leftValue": "", "typeValidation": "loose", "version": 3},
          "conditions": [
            {
              "id": "lead-exists-001",
              "leftValue": "={{ $json.id }}",
              "rightValue": "",
              "operator": {"type": "string", "operation": "notEmpty"}
            }
          ],
          "combinator": "and"
        },
        "looseTypeValidation": true,
        "options": {}
      },
      "type": "n8n-nodes-base.if",
      "typeVersion": 2.3,
      "position": [1440, 220],
      "id": "lc000001-0007-4000-8000-000000000007",
      "name": "Lead Exists?"
    },
    {
      "parameters": {
        "jsCode": "// Lead already exists — update lead_message and stop\nconst existing_id = $input.first().json.id;\nconst ctx = $('Build Dedupe Query').first().json;\nconst p = ctx.payload;\nconst msg = (p.lead_message || '').replace(/'/g, \"''\");\nreturn [{\n  json: {\n    query: `UPDATE leads SET lead_message = '${msg}', updated_at = now() WHERE id = '${existing_id}'`\n  }\n}];"
      },
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1640, 140],
      "id": "lc000001-0008-4000-8000-000000000008",
      "name": "Build Update Query"
    },
    {
      "parameters": {
        "operation": "executeQuery",
        "query": "={{ $json.query }}"
      },
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2.5,
      "position": [1840, 140],
      "id": "lc000001-0009-4000-8000-000000000009",
      "name": "Update Existing Lead",
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
        "jsCode": "const ctx = $('Build Dedupe Query').first().json;\nconst p = ctx.payload;\n\nconst esc = v => (v || '').toString().replace(/'/g, \"''\");\n\nconst metadata = JSON.stringify({\n  property_address: p.property_address || null,\n  price_range: p.price_range || null,\n  beds: p.beds || null\n}).replace(/'/g, \"''\");\n\nconst today = new Date().toISOString().split('T')[0];\n\nreturn [{\n  json: {\n    query: `INSERT INTO leads (client_id, lead_name, email, phone, source, lead_message, status, stage, next_action_due, metadata) VALUES ('${ctx.client_id}', '${esc(p.lead_name)}', '${esc(p.email)}', '${esc(p.phone)}', '${esc(p.source)}', '${esc(p.lead_message)}', 'new', 'new', '${today}', '${metadata}') RETURNING id`,\n    client_id: ctx.client_id,\n    agent_email: ctx.agent_email,\n    agent_name: ctx.agent_name,\n    payload: p\n  }\n}];"
      },
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1640, 300],
      "id": "lc000001-0010-4000-8000-000000000010",
      "name": "Build Insert Query"
    },
    {
      "parameters": {
        "operation": "executeQuery",
        "query": "={{ $json.query }}"
      },
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2.5,
      "position": [1840, 300],
      "id": "lc000001-0011-4000-8000-000000000011",
      "name": "Insert New Lead",
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
        "jsCode": "// Combine lead_id from INSERT RETURNING with context fields\nconst insertResult = $input.first().json;\nconst ctx = $('Build Insert Query').first().json;\nreturn [{\n  json: {\n    lead_id: insertResult.id,\n    client_id: ctx.client_id,\n    agent_email: ctx.agent_email,\n    agent_name: ctx.agent_name,\n    payload: ctx.payload\n  }\n}];"
      },
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [2040, 300],
      "id": "lc000001-0012-4000-8000-000000000012",
      "name": "Prepare Handoff"
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://norrai.app.n8n.cloud/webhook/lead-response-auto",
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify($json) }}",
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.4,
      "position": [2240, 300],
      "id": "lc000001-0013-4000-8000-000000000013",
      "name": "Trigger Lead Response"
    }
  ],
  "pinData": {},
  "connections": {
    "Receive Lead": {"main": [[{"node": "Build Token Query", "type": "main", "index": 0}]]},
    "Build Token Query": {"main": [[{"node": "Resolve Token", "type": "main", "index": 0}]]},
    "Resolve Token": {"main": [[{"node": "Token Found?", "type": "main", "index": 0}]]},
    "Token Found?": {
      "main": [
        [{"node": "Build Dedupe Query", "type": "main", "index": 0}],
        []
      ]
    },
    "Build Dedupe Query": {"main": [[{"node": "Dedupe Check", "type": "main", "index": 0}]]},
    "Dedupe Check": {"main": [[{"node": "Lead Exists?", "type": "main", "index": 0}]]},
    "Lead Exists?": {
      "main": [
        [{"node": "Build Update Query", "type": "main", "index": 0}],
        [{"node": "Build Insert Query", "type": "main", "index": 0}]
      ]
    },
    "Build Update Query": {"main": [[{"node": "Update Existing Lead", "type": "main", "index": 0}]]},
    "Build Insert Query": {"main": [[{"node": "Insert New Lead", "type": "main", "index": 0}]]},
    "Insert New Lead": {"main": [[{"node": "Prepare Handoff", "type": "main", "index": 0}]]},
    "Prepare Handoff": {"main": [[{"node": "Trigger Lead Response", "type": "main", "index": 0}]]}
  },
  "active": false,
  "settings": {"executionOrder": "v1"},
  "versionId": "lead-cleanser-v1-001",
  "meta": {
    "templateCredsSetupCompleted": false,
    "instanceId": "0d4efb408d47ca7fe5f9bfa9b6b5b1a6e6f8fcb31cb2584a172b735d47653914"
  },
  "id": "",
  "tags": []
}
```

- [ ] **Step 2: Save to disk**

Write the JSON above to `n8n/workflows/Real Estate Lead Cleanser.json`.

- [ ] **Step 3: Commit**

```bash
git add n8n/workflows/Real\ Estate\ Lead\ Cleanser.json
git commit -m "feat: add Real Estate Lead Cleanser n8n workflow"
```

---

## Task 3: Zillow Intake Workflow

**Files:**
- Create: `n8n/workflows/Real Estate Zillow Intake.json`

Zillow sends: `firstName`, `lastName`, `email`, `phone`, `propertyAddress`, `message` (field names vary by integration — treat as the typical Zillow Premier Agent webhook shape).

- [ ] **Step 1: Write workflow JSON**

```json
{
  "name": "Real Estate Zillow Intake",
  "nodes": [
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "intake-zillow",
        "responseMode": "onReceived",
        "options": {}
      },
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2.1,
      "position": [240, 300],
      "id": "zi000001-0001-4000-8000-000000000001",
      "name": "Receive Zillow Lead",
      "webhookId": "zillow-intake-webhook-001"
    },
    {
      "parameters": {
        "jsCode": "const b = $input.first().json.body || $input.first().json;\nconst q = $input.first().json.query || {};\n\nconst firstName = b.firstName || b.first_name || '';\nconst lastName = b.lastName || b.last_name || '';\n\nreturn [{\n  json: {\n    client_token: q.token || '',\n    lead_name: `${firstName} ${lastName}`.trim() || b.name || b.lead_name || '',\n    email: b.email || '',\n    phone: b.phone || b.phoneNumber || '',\n    source: 'zillow',\n    property_address: b.propertyAddress || b.property_address || '',\n    price_range: b.priceRange || b.price_range || '',\n    beds: b.beds || b.bedrooms || null,\n    lead_message: b.message || b.lead_message || b.comments || ''\n  }\n}];"
      },
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [440, 300],
      "id": "zi000001-0002-4000-8000-000000000002",
      "name": "Normalize Zillow Payload"
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
      "position": [640, 300],
      "id": "zi000001-0003-4000-8000-000000000003",
      "name": "Send to Lead Cleanser"
    }
  ],
  "pinData": {},
  "connections": {
    "Receive Zillow Lead": {"main": [[{"node": "Normalize Zillow Payload", "type": "main", "index": 0}]]},
    "Normalize Zillow Payload": {"main": [[{"node": "Send to Lead Cleanser", "type": "main", "index": 0}]]}
  },
  "active": false,
  "settings": {"executionOrder": "v1"},
  "versionId": "zillow-intake-v1-001",
  "meta": {
    "templateCredsSetupCompleted": false,
    "instanceId": "0d4efb408d47ca7fe5f9bfa9b6b5b1a6e6f8fcb31cb2584a172b735d47653914"
  },
  "id": "",
  "tags": []
}
```

- [ ] **Step 2: Save to disk and commit**

```bash
git add n8n/workflows/Real\ Estate\ Zillow\ Intake.json
git commit -m "feat: add Real Estate Zillow Intake n8n workflow"
```

---

## Task 4: Realtor.com Intake Workflow

**Files:**
- Create: `n8n/workflows/Real Estate Realtor Intake.json`

Realtor.com sends a similar shape to Zillow with slightly different field names.

- [ ] **Step 1: Write workflow JSON**

```json
{
  "name": "Real Estate Realtor Intake",
  "nodes": [
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "intake-realtor",
        "responseMode": "onReceived",
        "options": {}
      },
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2.1,
      "position": [240, 300],
      "id": "ri000001-0001-4000-8000-000000000001",
      "name": "Receive Realtor Lead",
      "webhookId": "realtor-intake-webhook-001"
    },
    {
      "parameters": {
        "jsCode": "const b = $input.first().json.body || $input.first().json;\nconst q = $input.first().json.query || {};\n\n// Realtor.com field names differ slightly from Zillow\nconst firstName = b.buyer_first_name || b.firstName || b.first_name || '';\nconst lastName = b.buyer_last_name || b.lastName || b.last_name || '';\n\nreturn [{\n  json: {\n    client_token: q.token || '',\n    lead_name: `${firstName} ${lastName}`.trim() || b.name || b.contact_name || '',\n    email: b.buyer_email || b.email || '',\n    phone: b.buyer_phone || b.phone || '',\n    source: 'realtor_com',\n    property_address: b.listing_address || b.propertyAddress || b.property_address || '',\n    price_range: b.listing_price ? `$${b.listing_price}` : b.price_range || '',\n    beds: b.listing_beds || b.beds || null,\n    lead_message: b.buyer_message || b.message || b.lead_message || ''\n  }\n}];"
      },
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [440, 300],
      "id": "ri000001-0002-4000-8000-000000000002",
      "name": "Normalize Realtor Payload"
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
      "position": [640, 300],
      "id": "ri000001-0003-4000-8000-000000000003",
      "name": "Send to Lead Cleanser"
    }
  ],
  "pinData": {},
  "connections": {
    "Receive Realtor Lead": {"main": [[{"node": "Normalize Realtor Payload", "type": "main", "index": 0}]]},
    "Normalize Realtor Payload": {"main": [[{"node": "Send to Lead Cleanser", "type": "main", "index": 0}]]}
  },
  "active": false,
  "settings": {"executionOrder": "v1"},
  "versionId": "realtor-intake-v1-001",
  "meta": {
    "templateCredsSetupCompleted": false,
    "instanceId": "0d4efb408d47ca7fe5f9bfa9b6b5b1a6e6f8fcb31cb2584a172b735d47653914"
  },
  "id": "",
  "tags": []
}
```

- [ ] **Step 2: Save to disk and commit**

```bash
git add n8n/workflows/Real\ Estate\ Realtor\ Intake.json
git commit -m "feat: add Real Estate Realtor.com Intake n8n workflow"
```

---

## Task 5: Facebook Ads Intake Workflow

**Files:**
- Create: `n8n/workflows/Real Estate Facebook Intake.json`

Facebook Lead Ads requires two things: (1) a GET endpoint that echoes back `hub.challenge` during app setup, and (2) a POST handler that receives a notification ping, then calls the Graph API to fetch the actual lead data.

- [ ] **Step 1: Write workflow JSON**

```json
{
  "name": "Real Estate Facebook Intake",
  "nodes": [
    {
      "parameters": {
        "httpMethod": "ALL",
        "path": "intake-facebook",
        "responseMode": "responseNode",
        "options": {}
      },
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2.1,
      "position": [240, 300],
      "id": "fi000001-0001-4000-8000-000000000001",
      "name": "Receive Facebook Event",
      "webhookId": "facebook-intake-webhook-001"
    },
    {
      "parameters": {
        "conditions": {
          "options": {"caseSensitive": true, "leftValue": "", "typeValidation": "loose", "version": 3},
          "conditions": [
            {
              "id": "hub-mode-001",
              "leftValue": "={{ $json.query['hub.mode'] }}",
              "rightValue": "subscribe",
              "operator": {"type": "string", "operation": "equals"}
            }
          ],
          "combinator": "and"
        },
        "looseTypeValidation": true,
        "options": {}
      },
      "type": "n8n-nodes-base.if",
      "typeVersion": 2.3,
      "position": [440, 300],
      "id": "fi000001-0002-4000-8000-000000000002",
      "name": "Is Verification Request?"
    },
    {
      "parameters": {
        "respondWith": "text",
        "responseBody": "={{ $('Receive Facebook Event').first().json.query['hub.challenge'] }}",
        "options": {"responseCode": 200}
      },
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [640, 220],
      "id": "fi000001-0003-4000-8000-000000000003",
      "name": "Echo Hub Challenge"
    },
    {
      "parameters": {
        "jsCode": "// Facebook sends a notification — extract leadgen_id and token from URL\nconst body = $input.first().json.body || {};\nconst q = $input.first().json.query || {};\n\nlet leadgenId = null;\ntry {\n  leadgenId = body.entry[0].changes[0].value.leadgen_id;\n} catch(e) {}\n\nreturn [{\n  json: {\n    leadgen_id: leadgenId,\n    client_token: q.token || '',\n    page_access_token: 'FACEBOOK_PAGE_ACCESS_TOKEN'\n  }\n}];"
      },
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [640, 380],
      "id": "fi000001-0004-4000-8000-000000000004",
      "name": "Extract Leadgen ID"
    },
    {
      "parameters": {
        "method": "GET",
        "url": "=https://graph.facebook.com/v19.0/{{ $json.leadgen_id }}?access_token={{ $json.page_access_token }}&fields=field_data,created_time",
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.4,
      "position": [840, 380],
      "id": "fi000001-0005-4000-8000-000000000005",
      "name": "Fetch Lead from Graph API"
    },
    {
      "parameters": {
        "jsCode": "const lead = $input.first().json;\nconst ctx = $('Extract Leadgen ID').first().json;\n\n// Facebook field_data is an array: [{name: 'full_name', values: ['Sarah Johnson']}, ...]\nconst fields = {};\n(lead.field_data || []).forEach(f => {\n  fields[f.name] = f.values[0] || '';\n});\n\nreturn [{\n  json: {\n    client_token: ctx.client_token,\n    lead_name: fields.full_name || `${fields.first_name || ''} ${fields.last_name || ''}`.trim(),\n    email: fields.email || '',\n    phone: fields.phone_number || fields.phone || '',\n    source: 'facebook_ads',\n    property_address: fields.street_address || fields.property_address || '',\n    price_range: fields.price_range || '',\n    beds: fields.bedrooms || null,\n    lead_message: fields.message || fields.comments || 'Facebook Lead Ad inquiry'\n  }\n}];"
      },
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1040, 380],
      "id": "fi000001-0006-4000-8000-000000000006",
      "name": "Normalize Facebook Payload"
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
      "position": [1240, 380],
      "id": "fi000001-0007-4000-8000-000000000007",
      "name": "Send to Lead Cleanser"
    }
  ],
  "pinData": {},
  "connections": {
    "Receive Facebook Event": {"main": [[{"node": "Is Verification Request?", "type": "main", "index": 0}]]},
    "Is Verification Request?": {
      "main": [
        [{"node": "Echo Hub Challenge", "type": "main", "index": 0}],
        [{"node": "Extract Leadgen ID", "type": "main", "index": 0}]
      ]
    },
    "Extract Leadgen ID": {"main": [[{"node": "Fetch Lead from Graph API", "type": "main", "index": 0}]]},
    "Fetch Lead from Graph API": {"main": [[{"node": "Normalize Facebook Payload", "type": "main", "index": 0}]]},
    "Normalize Facebook Payload": {"main": [[{"node": "Send to Lead Cleanser", "type": "main", "index": 0}]]}
  },
  "active": false,
  "settings": {"executionOrder": "v1"},
  "versionId": "facebook-intake-v1-001",
  "meta": {
    "templateCredsSetupCompleted": false,
    "instanceId": "0d4efb408d47ca7fe5f9bfa9b6b5b1a6e6f8fcb31cb2584a172b735d47653914"
  },
  "id": "",
  "tags": []
}
```

**Note after import:** Replace `FACEBOOK_PAGE_ACCESS_TOKEN` in the "Extract Leadgen ID" node with the actual Page Access Token from Facebook's Graph API Explorer. This token is per-agent and does not expire if it's a Page token (unlike User tokens).

- [ ] **Step 2: Save to disk and commit**

```bash
git add n8n/workflows/Real\ Estate\ Facebook\ Intake.json
git commit -m "feat: add Real Estate Facebook Ads Intake n8n workflow"
```

---

## Task 6: Custom Form Intake Workflow

**Files:**
- Create: `n8n/workflows/Real Estate Custom Form Intake.json`

This handles POSTs from existing agent-facing forms (`lead_response.html`, `open_house.html`, `nurture_enroll.html`) and any custom forms built for a specific client. These already produce a near-standard payload — normalization is minimal.

- [ ] **Step 1: Write workflow JSON**

```json
{
  "name": "Real Estate Custom Form Intake",
  "nodes": [
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "intake-custom",
        "responseMode": "onReceived",
        "options": {}
      },
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2.1,
      "position": [240, 300],
      "id": "cf000001-0001-4000-8000-000000000001",
      "name": "Receive Custom Form Lead",
      "webhookId": "custom-intake-webhook-001"
    },
    {
      "parameters": {
        "jsCode": "const b = $input.first().json.body || $input.first().json;\nconst q = $input.first().json.query || {};\n\n// Custom forms already use the standard shape — just normalize variations\nconst property = [\n  b.property_address,\n  b.street_address ? `${b.street_address}, ${b.city || ''}, ${b.state || 'MN'} ${b.zip || ''}`.trim() : null\n].find(Boolean) || '';\n\nreturn [{\n  json: {\n    client_token: q.token || b.client_token || '',\n    lead_name: b.lead_name || b.name || b.contact_name || '',\n    email: b.email || b.lead_email || '',\n    phone: b.phone || b.lead_phone || '',\n    source: b.source || 'custom_form',\n    property_address: property,\n    price_range: b.price_range || '',\n    beds: b.beds || null,\n    lead_message: b.lead_message || b.message || b.notes || ''\n  }\n}];"
      },
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [440, 300],
      "id": "cf000001-0002-4000-8000-000000000002",
      "name": "Normalize Custom Payload"
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
      "position": [640, 300],
      "id": "cf000001-0003-4000-8000-000000000003",
      "name": "Send to Lead Cleanser"
    }
  ],
  "pinData": {},
  "connections": {
    "Receive Custom Form Lead": {"main": [[{"node": "Normalize Custom Payload", "type": "main", "index": 0}]]},
    "Normalize Custom Payload": {"main": [[{"node": "Send to Lead Cleanser", "type": "main", "index": 0}]]}
  },
  "active": false,
  "settings": {"executionOrder": "v1"},
  "versionId": "custom-intake-v1-001",
  "meta": {
    "templateCredsSetupCompleted": false,
    "instanceId": "0d4efb408d47ca7fe5f9bfa9b6b5b1a6e6f8fcb31cb2584a172b735d47653914"
  },
  "id": "",
  "tags": []
}
```

- [ ] **Step 2: Save to disk and commit**

```bash
git add n8n/workflows/Real\ Estate\ Custom\ Form\ Intake.json
git commit -m "feat: add Real Estate Custom Form Intake n8n workflow"
```

---

## Task 7: Lead Response Auto Workflow

**Files:**
- Create: `n8n/workflows/Real Estate Lead Response Auto.json`

Receives the handoff from Lead Cleanser, calls Claude for SMS + email drafts, stores an approval token in Neon, and sends the agent an approval email.

- [ ] **Step 1: Write workflow JSON**

```json
{
  "name": "Real Estate Lead Response Auto",
  "nodes": [
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "lead-response-auto",
        "responseMode": "onReceived",
        "options": {}
      },
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2.1,
      "position": [240, 300],
      "id": "lr000001-0001-4000-8000-000000000001",
      "name": "Receive Handoff",
      "webhookId": "lead-response-auto-webhook-001"
    },
    {
      "parameters": {
        "assignments": {
          "assignments": [
            {
              "id": "prompt-001",
              "name": "prompt",
              "value": "=A new real estate lead just came in. Draft two short personalized responses for the agent to send.\n\nAGENT: {{ $json.agent_name }}\nLEAD NAME: {{ $json.payload.lead_name }}\nLEAD SOURCE: {{ $json.payload.source }}\nPROPERTY: {{ $json.payload.property_address || 'not specified' }}\nPRICE RANGE: {{ $json.payload.price_range || 'not specified' }}\nBEDS: {{ $json.payload.beds || 'not specified' }}\nLEAD MESSAGE: {{ $json.payload.lead_message || 'No message provided' }}\n\nWrite two responses — a SHORT SMS (under 155 characters, conversational) and an EMAIL (2–3 sentences, warm). Both should:\n- Address the lead by first name\n- Acknowledge the specific property or inquiry\n- Invite them to connect\n- Sign off with the agent name\n\nFormat your response EXACTLY like this:\nSMS: [your sms text here]\nEMAIL: [your email text here]",
              "type": "string"
            },
            {
              "id": "passthrough-001",
              "name": "lead_id",
              "value": "={{ $json.lead_id }}",
              "type": "string"
            },
            {
              "id": "passthrough-002",
              "name": "client_id",
              "value": "={{ $json.client_id }}",
              "type": "string"
            },
            {
              "id": "passthrough-003",
              "name": "agent_email",
              "value": "={{ $json.agent_email }}",
              "type": "string"
            },
            {
              "id": "passthrough-004",
              "name": "agent_name",
              "value": "={{ $json.agent_name }}",
              "type": "string"
            },
            {
              "id": "passthrough-005",
              "name": "lead_name",
              "value": "={{ $json.payload.lead_name }}",
              "type": "string"
            },
            {
              "id": "passthrough-006",
              "name": "lead_phone",
              "value": "={{ $json.payload.phone }}",
              "type": "string"
            },
            {
              "id": "passthrough-007",
              "name": "lead_email",
              "value": "={{ $json.payload.email }}",
              "type": "string"
            },
            {
              "id": "passthrough-008",
              "name": "source",
              "value": "={{ $json.payload.source }}",
              "type": "string"
            },
            {
              "id": "passthrough-009",
              "name": "lead_message",
              "value": "={{ $json.payload.lead_message }}",
              "type": "string"
            }
          ]
        },
        "options": {}
      },
      "type": "n8n-nodes-base.set",
      "typeVersion": 3.4,
      "position": [440, 300],
      "id": "lr000001-0002-4000-8000-000000000002",
      "name": "Build Prompt"
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://api.anthropic.com/v1/messages",
        "authentication": "predefinedCredentialType",
        "nodeCredentialType": "anthropicApi",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {"name": "anthropic-version", "value": "2023-06-01"},
            {"name": "content-type", "value": "application/json"}
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={\n  \"model\": \"claude-sonnet-4-20250514\",\n  \"max_tokens\": 400,\n  \"messages\": [{\"role\": \"user\", \"content\": {{ JSON.stringify($json.prompt) }}}]\n}",
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.4,
      "position": [640, 300],
      "id": "lr000001-0003-4000-8000-000000000003",
      "name": "Draft Responses (Claude)",
      "credentials": {
        "anthropicApi": {
          "id": "gXqu8TiqvDY4mUPZ",
          "name": "Anthropic account 2"
        }
      }
    },
    {
      "parameters": {
        "jsCode": "const response = $input.first().json;\nconst text = response.content[0].text.trim();\nconst prev = $('Build Prompt').first().json;\n\n// Parse SMS: and EMAIL: labels\nconst smsMatch = text.match(/^SMS:\\s*(.+?)(?=\\nEMAIL:|$)/ms);\nconst emailMatch = text.match(/EMAIL:\\s*(.+)$/ms);\n\nconst sms_draft = smsMatch ? smsMatch[1].trim() : text.split('\\n')[0];\nconst email_draft = emailMatch ? emailMatch[1].trim() : text;\n\n// Generate session token\nconst token = crypto.randomUUID();\n\n// Token expires in 24 hours\nconst expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();\n\nconst esc = v => (v || '').replace(/'/g, \"''\");\n\nreturn [{\n  json: {\n    sms_draft,\n    email_draft,\n    token,\n    expires,\n    insert_query: `INSERT INTO approval_tokens (token, lead_id, client_id, sms_draft, email_draft, expires_at) VALUES ('${token}', '${prev.lead_id}', '${prev.client_id}', '${esc(sms_draft)}', '${esc(email_draft)}', '${expires}')`,\n    lead_id: prev.lead_id,\n    client_id: prev.client_id,\n    agent_email: prev.agent_email,\n    agent_name: prev.agent_name,\n    lead_name: prev.lead_name,\n    lead_phone: prev.lead_phone,\n    lead_email: prev.lead_email,\n    source: prev.source,\n    lead_message: prev.lead_message\n  }\n}];"
      },
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [840, 300],
      "id": "lr000001-0004-4000-8000-000000000004",
      "name": "Parse Drafts + Generate Token"
    },
    {
      "parameters": {
        "operation": "executeQuery",
        "query": "={{ $json.insert_query }}"
      },
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2.5,
      "position": [1040, 300],
      "id": "lr000001-0005-4000-8000-000000000005",
      "name": "Store Approval Token",
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
        "jsCode": "const ctx = $('Parse Drafts + Generate Token').first().json;\nconst base = 'https://norrai.app.n8n.cloud/webhook/lead-action';\nconst editBase = 'https://tools.norrai.co/lead_action_edit.html';\nconst t = encodeURIComponent(ctx.token);\nconst smsDraft = encodeURIComponent(ctx.sms_draft);\nconst emailDraft = encodeURIComponent(ctx.email_draft);\nconst leadName = encodeURIComponent(ctx.lead_name);\n\nconst sendSmsUrl = `${base}?token=${t}&action=send_sms`;\nconst sendEmailUrl = `${base}?token=${t}&action=send_email`;\nconst skipUrl = `${base}?token=${t}&action=skip`;\nconst editSmsUrl = `${editBase}?token=${t}&action=send_sms&draft=${smsDraft}&lead_name=${leadName}`;\nconst editEmailUrl = `${editBase}?token=${t}&action=send_email&draft=${emailDraft}&lead_name=${leadName}`;\n\nconst sourceLabel = (ctx.source || 'unknown').replace(/_/g, ' ').replace(/\\b\\w/g, c => c.toUpperCase());\n\nconst html = `<!DOCTYPE html><html><body style=\"font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#FAFAF7\">\n<h2 style=\"color:#0A0F1A\">New lead from ${sourceLabel}</h2>\n<p style=\"color:#3A3F48\"><strong>${ctx.lead_name}</strong> reached out${ctx.lead_message ? ':' : '.'}</p>\n${ctx.lead_message ? `<blockquote style=\"border-left:3px solid #7FA9B8;padding:8px 16px;color:#6A6F78;margin:16px 0\">${ctx.lead_message}</blockquote>` : ''}\n<hr style=\"border:1px solid #E5E4DE;margin:24px 0\">\n<h3 style=\"color:#0A0F1A\">SMS Draft <span style=\"font-size:12px;color:#9EA3AA\">(${ctx.sms_draft.length} chars)</span></h3>\n<div style=\"background:#fff;border:1px solid #E5E4DE;border-radius:6px;padding:16px;margin-bottom:12px\">\n<p style=\"color:#0A0F1A;margin:0\">${ctx.sms_draft}</p>\n</div>\n<table><tr>\n<td><a href=\"${sendSmsUrl}\" style=\"background:#0A0F1A;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;display:inline-block\">Send SMS</a></td>\n<td style=\"padding-left:8px\"><a href=\"${editSmsUrl}\" style=\"background:#fff;color:#0A0F1A;padding:10px 20px;text-decoration:none;border-radius:4px;border:1px solid #E5E4DE;display:inline-block\">Edit</a></td>\n</tr></table>\n<br>\n<h3 style=\"color:#0A0F1A\">Email Draft</h3>\n<div style=\"background:#fff;border:1px solid #E5E4DE;border-radius:6px;padding:16px;margin-bottom:12px\">\n<p style=\"color:#0A0F1A;margin:0\">${ctx.email_draft}</p>\n</div>\n<table><tr>\n<td><a href=\"${sendEmailUrl}\" style=\"background:#0A0F1A;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;display:inline-block\">Send Email</a></td>\n<td style=\"padding-left:8px\"><a href=\"${editEmailUrl}\" style=\"background:#fff;color:#0A0F1A;padding:10px 20px;text-decoration:none;border-radius:4px;border:1px solid #E5E4DE;display:inline-block\">Edit</a></td>\n</tr></table>\n<br>\n<a href=\"${skipUrl}\" style=\"color:#9EA3AA;font-size:13px\">Skip this lead for now</a>\n<hr style=\"border:1px solid #E5E4DE;margin:24px 0\">\n<p style=\"font-size:11px;color:#9EA3AA\">These links expire in 24 hours. Norr AI</p>\n</body></html>`;\n\nreturn [{ json: { html, agent_email: ctx.agent_email, agent_name: ctx.agent_name, lead_name: ctx.lead_name, source_label: sourceLabel } }];"
      },
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1240, 300],
      "id": "lr000001-0006-4000-8000-000000000006",
      "name": "Build Approval Email"
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://api.sendgrid.com/v3/mail/send",
        "authentication": "predefinedCredentialType",
        "nodeCredentialType": "sendGridApi",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [{"name": "Content-Type", "value": "application/json"}]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={\n  \"personalizations\": [{\"to\": [{\"email\": {{ JSON.stringify($json.agent_email) }}}]}],\n  \"from\": {\"email\": \"hello@norrai.co\", \"name\": \"Norr AI\"},\n  \"subject\": {{ JSON.stringify(`New lead from ${$json.source_label}: ${$json.lead_name}`) }},\n  \"content\": [{\"type\": \"text/html\", \"value\": {{ JSON.stringify($json.html) }}}],\n  \"tracking_settings\": {\"click_tracking\": {\"enable\": false}}\n}",
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.4,
      "position": [1440, 300],
      "id": "lr000001-0007-4000-8000-000000000007",
      "name": "Send Approval Email",
      "credentials": {
        "sendGridApi": {
          "id": "A5ypmjiRLAUMUm9O",
          "name": "SendGrid account"
        }
      }
    }
  ],
  "pinData": {},
  "connections": {
    "Receive Handoff": {"main": [[{"node": "Build Prompt", "type": "main", "index": 0}]]},
    "Build Prompt": {"main": [[{"node": "Draft Responses (Claude)", "type": "main", "index": 0}]]},
    "Draft Responses (Claude)": {"main": [[{"node": "Parse Drafts + Generate Token", "type": "main", "index": 0}]]},
    "Parse Drafts + Generate Token": {"main": [[{"node": "Store Approval Token", "type": "main", "index": 0}]]},
    "Store Approval Token": {"main": [[{"node": "Build Approval Email", "type": "main", "index": 0}]]},
    "Build Approval Email": {"main": [[{"node": "Send Approval Email", "type": "main", "index": 0}]]}
  },
  "active": false,
  "settings": {"executionOrder": "v1"},
  "versionId": "lead-response-auto-v1-001",
  "meta": {
    "templateCredsSetupCompleted": false,
    "instanceId": "0d4efb408d47ca7fe5f9bfa9b6b5b1a6e6f8fcb31cb2584a172b735d47653914"
  },
  "id": "",
  "tags": []
}
```

- [ ] **Step 2: Save to disk and commit**

```bash
git add n8n/workflows/Real\ Estate\ Lead\ Response\ Auto.json
git commit -m "feat: add Real Estate Lead Response Auto n8n workflow"
```

---

## Task 8: Lead Action Handler Workflow

**Files:**
- Create: `n8n/workflows/Real Estate Lead Action Handler.json`

Handles agent clicks on Send SMS / Send Email / Skip / Edit buttons in the approval email. All actions are GET requests (links in email). The workflow responds with an HTML confirmation page.

- [ ] **Step 1: Write workflow JSON**

```json
{
  "name": "Real Estate Lead Action Handler",
  "nodes": [
    {
      "parameters": {
        "httpMethod": "GET",
        "path": "lead-action",
        "responseMode": "responseNode",
        "options": {}
      },
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2.1,
      "position": [240, 300],
      "id": "ah000001-0001-4000-8000-000000000001",
      "name": "Receive Action Click",
      "webhookId": "lead-action-webhook-001"
    },
    {
      "parameters": {
        "jsCode": "const q = $input.first().json.query || {};\nconst token = (q.token || '').replace(/'/g, \"''\");\nreturn [{\n  json: {\n    query: `SELECT at.id, at.token, at.lead_id, at.client_id, at.sms_draft, at.email_draft, at.expires_at, at.used_at, l.phone, l.email, l.lead_name FROM approval_tokens at JOIN leads l ON l.id = at.lead_id WHERE at.token = '${token}' LIMIT 1`,\n    action: q.action || '',\n    custom_content: q.content || '',\n    token: q.token || ''\n  }\n}];"
      },
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [440, 300],
      "id": "ah000001-0002-4000-8000-000000000002",
      "name": "Build Token Lookup"
    },
    {
      "parameters": {
        "operation": "executeQuery",
        "query": "={{ $json.query }}"
      },
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2.5,
      "position": [640, 300],
      "id": "ah000001-0003-4000-8000-000000000003",
      "name": "Lookup Token",
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
        "conditions": {
          "options": {"caseSensitive": true, "leftValue": "", "typeValidation": "loose", "version": 3},
          "conditions": [
            {
              "id": "valid-001",
              "leftValue": "={{ $json.id && !$json.used_at && new Date($json.expires_at) > new Date() ? 'valid' : '' }}",
              "rightValue": "valid",
              "operator": {"type": "string", "operation": "equals"}
            }
          ],
          "combinator": "and"
        },
        "looseTypeValidation": true,
        "options": {}
      },
      "type": "n8n-nodes-base.if",
      "typeVersion": 2.3,
      "position": [840, 300],
      "id": "ah000001-0004-4000-8000-000000000004",
      "name": "Token Valid?"
    },
    {
      "parameters": {
        "respondWith": "html",
        "responseBody": "<!DOCTYPE html><html><body style=\"font-family:Arial,sans-serif;max-width:500px;margin:80px auto;text-align:center;background:#FAFAF7\"><h2 style=\"color:#0A0F1A\">Link expired</h2><p style=\"color:#6A6F78\">This action link has already been used or has expired. Check your email for a fresh set of options.</p></body></html>",
        "options": {"responseCode": 200}
      },
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [1040, 420],
      "id": "ah000001-0005-4000-8000-000000000005",
      "name": "Respond Expired"
    },
    {
      "parameters": {
        "jsCode": "const row = $input.first().json;\nconst ctx = $('Build Token Lookup').first().json;\nconst action = ctx.action;\n\n// Use custom content if provided (from edit form), else original draft\nconst smsContent = ctx.custom_content || row.sms_draft;\nconst emailContent = ctx.custom_content || row.email_draft;\n\n// Mark token used\nconst markUsed = `UPDATE approval_tokens SET used_at = now() WHERE id = '${row.id}'`;\n\n// Update lead last_contacted_at\nconst markContacted = `UPDATE leads SET last_contacted_at = now(), status = 'contacted', stage = 'nurturing' WHERE id = '${row.lead_id}'`;\n\n// Bump next_action_due for skip\nconst bumpDue = `UPDATE leads SET next_action_due = CURRENT_DATE + INTERVAL '3 days' WHERE id = '${row.lead_id}'`;\n\nreturn [{\n  json: {\n    action,\n    lead_id: row.lead_id,\n    lead_phone: row.phone,\n    lead_email: row.email,\n    lead_name: row.lead_name,\n    sms_content: smsContent,\n    email_content: emailContent,\n    mark_used_query: markUsed,\n    mark_contacted_query: markContacted,\n    bump_due_query: bumpDue\n  }\n}];"
      },
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1040, 220],
      "id": "ah000001-0006-4000-8000-000000000006",
      "name": "Route Action"
    },
    {
      "parameters": {
        "conditions": {
          "options": {"caseSensitive": true, "leftValue": "", "typeValidation": "loose", "version": 3},
          "conditions": [
            {
              "id": "is-sms-001",
              "leftValue": "={{ $json.action }}",
              "rightValue": "send_sms",
              "operator": {"type": "string", "operation": "equals"}
            }
          ],
          "combinator": "and"
        },
        "looseTypeValidation": true,
        "options": {}
      },
      "type": "n8n-nodes-base.if",
      "typeVersion": 2.3,
      "position": [1240, 220],
      "id": "ah000001-0007-4000-8000-000000000007",
      "name": "Send SMS?"
    },
    {
      "parameters": {
        "from": "+18XXXXXXXXXX",
        "to": "=+1{{ $json.lead_phone.replace(/\\D/g, '') }}",
        "message": "={{ $json.sms_content }}"
      },
      "type": "n8n-nodes-base.twilio",
      "typeVersion": 1,
      "position": [1440, 140],
      "id": "ah000001-0008-4000-8000-000000000008",
      "name": "Send SMS",
      "credentials": {
        "twilioApi": {
          "id": "TWILIO_CREDENTIAL_ID",
          "name": "Twilio account"
        }
      }
    },
    {
      "parameters": {
        "operation": "executeQuery",
        "query": "={{ $('Route Action').first().json.mark_used_query + '; ' + $('Route Action').first().json.mark_contacted_query }}"
      },
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2.5,
      "position": [1640, 140],
      "id": "ah000001-0009-4000-8000-000000000009",
      "name": "Mark Sent + Update Lead",
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
        "respondWith": "html",
        "responseBody": "<!DOCTYPE html><html><body style=\"font-family:Arial,sans-serif;max-width:500px;margin:80px auto;text-align:center;background:#FAFAF7\"><h2 style=\"color:#0A0F1A\">Sent!</h2><p style=\"color:#6A6F78\">Your message to <strong>{{ $('Route Action').first().json.lead_name }}</strong> has been sent. You're done here.</p></body></html>",
        "options": {"responseCode": 200}
      },
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [1840, 140],
      "id": "ah000001-0010-4000-8000-000000000010",
      "name": "Respond SMS Sent"
    },
    {
      "parameters": {
        "conditions": {
          "options": {"caseSensitive": true, "leftValue": "", "typeValidation": "loose", "version": 3},
          "conditions": [
            {
              "id": "is-email-001",
              "leftValue": "={{ $json.action }}",
              "rightValue": "send_email",
              "operator": {"type": "string", "operation": "equals"}
            }
          ],
          "combinator": "and"
        },
        "looseTypeValidation": true,
        "options": {}
      },
      "type": "n8n-nodes-base.if",
      "typeVersion": 2.3,
      "position": [1440, 300],
      "id": "ah000001-0011-4000-8000-000000000011",
      "name": "Send Email?"
    },
    {
      "parameters": {
        "resource": "mail",
        "fromEmail": "hello@norrai.co",
        "fromName": "Norr AI",
        "toEmail": "={{ $json.lead_email }}",
        "subject": "=Re: Your inquiry",
        "contentValue": "={{ $json.email_content }}",
        "additionalFields": {}
      },
      "type": "n8n-nodes-base.sendGrid",
      "typeVersion": 1,
      "position": [1640, 300],
      "id": "ah000001-0012-4000-8000-000000000012",
      "name": "Send Email to Lead",
      "credentials": {
        "sendGridApi": {
          "id": "A5ypmjiRLAUMUm9O",
          "name": "SendGrid account"
        }
      }
    },
    {
      "parameters": {
        "operation": "executeQuery",
        "query": "={{ $('Route Action').first().json.mark_used_query + '; ' + $('Route Action').first().json.mark_contacted_query }}"
      },
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2.5,
      "position": [1840, 300],
      "id": "ah000001-0013-4000-8000-000000000013",
      "name": "Mark Email Sent",
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
        "respondWith": "html",
        "responseBody": "<!DOCTYPE html><html><body style=\"font-family:Arial,sans-serif;max-width:500px;margin:80px auto;text-align:center;background:#FAFAF7\"><h2 style=\"color:#0A0F1A\">Email Sent!</h2><p style=\"color:#6A6F78\">Your email to <strong>{{ $('Route Action').first().json.lead_name }}</strong> has been sent.</p></body></html>",
        "options": {"responseCode": 200}
      },
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [2040, 300],
      "id": "ah000001-0014-4000-8000-000000000014",
      "name": "Respond Email Sent"
    },
    {
      "parameters": {
        "operation": "executeQuery",
        "query": "={{ $json.bump_due_query + '; ' + $json.mark_used_query }}"
      },
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2.5,
      "position": [1640, 460],
      "id": "ah000001-0015-4000-8000-000000000015",
      "name": "Bump Next Action Due",
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
        "respondWith": "html",
        "responseBody": "<!DOCTYPE html><html><body style=\"font-family:Arial,sans-serif;max-width:500px;margin:80px auto;text-align:center;background:#FAFAF7\"><h2 style=\"color:#0A0F1A\">Skipped</h2><p style=\"color:#6A6F78\">Got it. <strong>{{ $('Route Action').first().json.lead_name }}</strong> will reappear in your queue in 3 days.</p></body></html>",
        "options": {"responseCode": 200}
      },
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [1840, 460],
      "id": "ah000001-0016-4000-8000-000000000016",
      "name": "Respond Skipped"
    }
  ],
  "pinData": {},
  "connections": {
    "Receive Action Click": {"main": [[{"node": "Build Token Lookup", "type": "main", "index": 0}]]},
    "Build Token Lookup": {"main": [[{"node": "Lookup Token", "type": "main", "index": 0}]]},
    "Lookup Token": {"main": [[{"node": "Token Valid?", "type": "main", "index": 0}]]},
    "Token Valid?": {
      "main": [
        [{"node": "Route Action", "type": "main", "index": 0}],
        [{"node": "Respond Expired", "type": "main", "index": 0}]
      ]
    },
    "Route Action": {"main": [[{"node": "Send SMS?", "type": "main", "index": 0}]]},
    "Send SMS?": {
      "main": [
        [{"node": "Send SMS", "type": "main", "index": 0}],
        [{"node": "Send Email?", "type": "main", "index": 0}]
      ]
    },
    "Send SMS": {"main": [[{"node": "Mark Sent + Update Lead", "type": "main", "index": 0}]]},
    "Mark Sent + Update Lead": {"main": [[{"node": "Respond SMS Sent", "type": "main", "index": 0}]]},
    "Send Email?": {
      "main": [
        [{"node": "Send Email to Lead", "type": "main", "index": 0}],
        [{"node": "Bump Next Action Due", "type": "main", "index": 0}]
      ]
    },
    "Send Email to Lead": {"main": [[{"node": "Mark Email Sent", "type": "main", "index": 0}]]},
    "Mark Email Sent": {"main": [[{"node": "Respond Email Sent", "type": "main", "index": 0}]]},
    "Bump Next Action Due": {"main": [[{"node": "Respond Skipped", "type": "main", "index": 0}]]}
  },
  "active": false,
  "settings": {"executionOrder": "v1"},
  "versionId": "lead-action-handler-v1-001",
  "meta": {
    "templateCredsSetupCompleted": false,
    "instanceId": "0d4efb408d47ca7fe5f9bfa9b6b5b1a6e6f8fcb31cb2584a172b735d47653914"
  },
  "id": "",
  "tags": []
}
```

**Note:** The `Send Email?` false branch routes to `Bump Next Action Due` which handles the `skip` action. If `action` is `send_email` → false also catches `skip` and `edit_*`. The `edit_*` actions don't hit this workflow directly — they link to `lead_action_edit.html` instead. The edit page submits with `action=send_sms` or `action=send_email` and a `content` param, which this workflow handles in "Route Action" via `ctx.custom_content`.

- [ ] **Step 2: Save to disk and commit**

```bash
git add n8n/workflows/Real\ Estate\ Lead\ Action\ Handler.json
git commit -m "feat: add Real Estate Lead Action Handler n8n workflow"
```

---

## Task 9: Edit Page HTML

**Files:**
- Create: `website/lead_action_edit.html`

Agent lands here after clicking "Edit" in the approval email. Reads token, action, draft, and lead_name from URL params. Agent edits the textarea and submits. POSTs to the action handler with the edited content.

- [ ] **Step 1: Write HTML**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Edit Message — Norr AI</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600&family=Inter:wght@400;500&display=swap" rel="stylesheet">
  <link rel="icon" type="image/svg+xml" href="/norr_ai_favicon.svg">
  <style>
    :root {
      --bone: #FAFAF7; --ink: #0A0F1A; --glacial: #7FA9B8;
      --graphite: #3A3F48; --surface: #FFFFFF; --border: #E5E4DE;
      --muted: #9EA3AA; --secondary: #6A6F78;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--bone); color: var(--ink); font-family: 'Inter', sans-serif; min-height: 100vh; display: flex; flex-direction: column; }
    header { background: var(--ink); padding: 16px 24px; }
    header h1 { color: white; font-family: 'Inter Tight', sans-serif; font-size: 18px; font-weight: 600; }
    main { flex: 1; max-width: 600px; margin: 48px auto; padding: 0 24px; width: 100%; }
    h2 { font-family: 'Inter Tight', sans-serif; font-size: 22px; font-weight: 600; margin-bottom: 8px; }
    .lead-name { color: var(--secondary); font-size: 14px; margin-bottom: 32px; }
    label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 8px; color: var(--graphite); }
    textarea { width: 100%; border: 1px solid var(--border); border-radius: 6px; padding: 14px; font-family: 'Inter', sans-serif; font-size: 15px; line-height: 1.6; background: var(--surface); color: var(--ink); resize: vertical; min-height: 140px; outline: none; }
    textarea:focus { border-color: var(--glacial); }
    .char-count { font-size: 12px; color: var(--muted); text-align: right; margin-top: 6px; }
    .char-count.over { color: #c0392b; }
    .actions { display: flex; gap: 12px; margin-top: 24px; }
    button[type="submit"] { background: var(--ink); color: white; border: none; padding: 12px 28px; font-family: 'Inter Tight', sans-serif; font-size: 15px; font-weight: 500; border-radius: 4px; cursor: pointer; flex: 1; }
    button[type="submit"]:hover { background: var(--graphite); }
    button[type="submit"]:disabled { opacity: 0.5; cursor: not-allowed; }
    .cancel { color: var(--muted); font-size: 14px; padding: 12px 0; cursor: pointer; background: none; border: none; }
    .status { margin-top: 16px; padding: 12px 16px; border-radius: 4px; font-size: 14px; display: none; }
    .status.success { background: #e8f5e9; color: #2e7d32; display: block; }
    .status.error { background: #fdecea; color: #c62828; display: block; }
  </style>
</head>
<body>
  <header>
    <h1>Norr AI</h1>
  </header>
  <main>
    <h2 id="page-title">Edit Message</h2>
    <p class="lead-name" id="lead-label"></p>
    <form id="edit-form">
      <label for="message-text" id="message-label">Your message</label>
      <textarea id="message-text" name="content" required></textarea>
      <p class="char-count" id="char-count"></p>
      <div class="actions">
        <button type="submit" id="send-btn">Send</button>
        <button type="button" class="cancel" onclick="window.close()">Cancel</button>
      </div>
    </form>
    <div class="status" id="status-msg"></div>
  </main>
  <script>
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token') || '';
    const action = params.get('action') || 'send_sms';
    const draft = params.get('draft') || '';
    const leadName = params.get('lead_name') || 'this lead';
    const isSms = action === 'send_sms';
    const SMS_LIMIT = 155;

    document.getElementById('page-title').textContent = isSms ? 'Edit SMS' : 'Edit Email';
    document.getElementById('message-label').textContent = isSms ? `SMS to ${leadName}` : `Email to ${leadName}`;
    document.getElementById('lead-label').textContent = isSms
      ? 'Keep it under 155 characters for a single SMS segment.'
      : '';
    document.getElementById('send-btn').textContent = isSms ? 'Send SMS' : 'Send Email';

    const textarea = document.getElementById('message-text');
    const charCount = document.getElementById('char-count');
    textarea.value = draft;

    function updateCount() {
      if (!isSms) { charCount.textContent = ''; return; }
      const len = textarea.value.length;
      charCount.textContent = `${len} / ${SMS_LIMIT} characters`;
      charCount.className = 'char-count' + (len > SMS_LIMIT ? ' over' : '');
    }
    textarea.addEventListener('input', updateCount);
    updateCount();

    document.getElementById('edit-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('send-btn');
      const status = document.getElementById('status-msg');
      btn.disabled = true;
      btn.textContent = 'Sending…';
      status.className = 'status';

      try {
        const res = await fetch(
          `https://norrai.app.n8n.cloud/webhook/lead-action?token=${encodeURIComponent(token)}&action=${action}&content=${encodeURIComponent(textarea.value.trim())}`,
          { method: 'GET' }
        );
        const text = await res.text();
        if (res.ok) {
          document.getElementById('edit-form').style.display = 'none';
          status.textContent = isSms ? 'SMS sent successfully.' : 'Email sent successfully.';
          status.className = 'status success';
        } else {
          throw new Error('Request failed');
        }
      } catch (err) {
        status.textContent = 'Something went wrong. Please try again or contact support.';
        status.className = 'status error';
        btn.disabled = false;
        btn.textContent = isSms ? 'Send SMS' : 'Send Email';
      }
    });
  </script>
</body>
</html>
```

- [ ] **Step 2: Save to disk and commit**

```bash
git add website/lead_action_edit.html
git commit -m "feat: add lead action edit page for SMS/email editing"
```

---

## Task 10: Update TESTING_NOTES.md

**Files:**
- Modify: `n8n/TESTING_NOTES.md`

- [ ] **Step 1: Append testing section**

Add the following to the end of `n8n/TESTING_NOTES.md`:

```markdown
---

## Lead Cleanser Pipeline (Zillow / Realtor / Facebook / Custom Form)

**Workflows:**
- `n8n/workflows/Real Estate Zillow Intake.json` → `/webhook/intake-zillow`
- `n8n/workflows/Real Estate Realtor Intake.json` → `/webhook/intake-realtor`
- `n8n/workflows/Real Estate Facebook Intake.json` → `/webhook/intake-facebook`
- `n8n/workflows/Real Estate Custom Form Intake.json` → `/webhook/intake-custom`
- `n8n/workflows/Real Estate Lead Cleanser.json` → `/webhook/lead-cleanser`
- `n8n/workflows/Real Estate Lead Response Auto.json` → `/webhook/lead-response-auto`
- `n8n/workflows/Real Estate Lead Action Handler.json` → `/webhook/lead-action` (GET)

**Edit page:** `website/lead_action_edit.html` (deployed to tools.norrai.co)

### Credentials to configure after import

| Node | Credential type | What to set |
|------|----------------|-------------|
| All Postgres nodes | Postgres | Neon pooled connection string (`DATABASE_URL` from `.env`) |
| Lead Response Auto → Draft Responses | Anthropic | `gXqu8TiqvDY4mUPZ` (Anthropic account 2) |
| Action Handler → Send SMS | Twilio | Your Twilio credential; replace `+18XXXXXXXXXX` |
| Action Handler → Send Email + Lead Response | SendGrid | `A5ypmjiRLAUMUm9O` (SendGrid account) |
| Facebook Intake → Extract Leadgen ID | (none — edit Code node) | Replace `FACEBOOK_PAGE_ACCESS_TOKEN` with actual Page Access Token |

### Seed a client token before testing

```sql
UPDATE clients SET token = 'test-token-realestate-001' WHERE vertical = 'real_estate' LIMIT 1;
```

Confirm: `SELECT id, primary_contact_email, token FROM clients WHERE token = 'test-token-realestate-001';`

### Test the full pipeline end-to-end (Hoppscotch)

**POST** `https://norrai.app.n8n.cloud/webhook-test/intake-zillow?token=test-token-realestate-001`

```json
{
  "firstName": "Sarah",
  "lastName": "Johnson",
  "email": "sarah@example.com",
  "phone": "5075551234",
  "propertyAddress": "123 Maple St, Faribault MN 55021",
  "priceRange": "$250k-$320k",
  "beds": 3,
  "message": "I am very interested in this property. Can we schedule a showing this weekend?"
}
```

Expected sequence:
1. Zillow Intake normalizes → POSTs to Lead Cleanser
2. Lead Cleanser resolves token → no dedupe match → inserts lead → POSTs to Lead Response Auto
3. Lead Response Auto calls Claude → stores approval token → sends approval email to agent
4. Check agent email: approval email arrives with SMS + Email drafts and action buttons
5. Check Neon: `SELECT * FROM leads WHERE email = 'sarah@example.com';` — one row
6. Check Neon: `SELECT * FROM approval_tokens ORDER BY created_at DESC LIMIT 1;` — one row, `used_at` is null

### Test dedupe

Re-submit the same payload. Expected: Lead Cleanser finds existing email match → updates `lead_message` → stops. No second approval email. Confirm: `SELECT COUNT(*) FROM leads WHERE email = 'sarah@example.com';` returns 1.

### Test action handler

Copy the `token` UUID from `approval_tokens`. Open in browser:

`https://norrai.app.n8n.cloud/webhook-test/lead-action?token=TOKEN_HERE&action=send_sms`

Expected: browser shows "Sent!" page. SMS arrives on lead phone. Neon: `approval_tokens.used_at` is now set, `leads.last_contacted_at` is set, `leads.status = 'contacted'`.

Repeat with `action=skip` (different token): browser shows "Skipped". Neon: `leads.next_action_due` = today + 3 days.

Test expired link: manually update `approval_tokens SET expires_at = now() - interval '1 day'`, then click link → browser shows "Link expired".

### Test Facebook verification

**GET** `https://norrai.app.n8n.cloud/webhook-test/intake-facebook?hub.mode=subscribe&hub.challenge=TESTCHALLENGE123&hub.verify_token=any`

Expected: response body is `TESTCHALLENGE123` (plain text, 200).

### Known gaps / post-deploy

| Gap | Priority |
|-----|----------|
| Facebook Page Access Token is hardcoded in Code node — must be replaced per agent | High |
| String escaping in Postgres queries (single-quote doubling) is adequate for demo; use parameterized queries for production | Medium |
| Edit page submits via GET (appends content to URL) — fine for SMS; long emails may hit URL length limits in some browsers | Low |
| No workflow_events logging in new workflows yet — add Postgres insert nodes when needed for audit trail | Low |
| Token in Zillow/Realtor/Facebook URLs is not validated at intake — invalid tokens fail silently in cleanser | Low |
```

- [ ] **Step 2: Commit**

```bash
git add n8n/TESTING_NOTES.md
git commit -m "docs: add lead cleanser pipeline testing notes"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|-----------------|------------|
| Per-source intake workflows (4) | Tasks 3–6 |
| Token-parameterized URLs | Tasks 3–6 (query.token) |
| Lead Cleanser: token resolve | Task 2 (Resolve Token + Build Token Query) |
| Lead Cleanser: dedupe email+phone | Task 2 (Dedupe Check) |
| Lead Cleanser: Neon insert with stage/status/next_action_due | Task 2 (Build Insert Query) |
| Lead Cleanser: handoff to Lead Response | Task 2 (Trigger Lead Response) |
| Claude SMS + email drafts | Task 7 (Draft Responses + Parse Drafts) |
| Approval token stored in Neon | Task 7 (Store Approval Token) |
| Approval email with action buttons | Task 7 (Build Approval Email + Send) |
| Send SMS action | Task 8 (Send SMS node) |
| Send Email action | Task 8 (Send Email to Lead node) |
| Skip action (bump next_action_due) | Task 8 (Bump Next Action Due node) |
| Edit flow | Task 8 (edit URLs → Task 9 HTML) |
| Token expiry + used_at check | Task 8 (Token Valid? node) |
| Schema migrations | Task 1 |
| clients.token column | Task 1 |
| approval_tokens table | Task 1 |
| leads new columns | Task 1 |
| Facebook hub.challenge verification | Task 5 |
| Testing notes | Task 10 |
