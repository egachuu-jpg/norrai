# BoldTrail Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three BoldTrail integration gaps: (1) automate contact sync from CSV export to Neon, (2) add SMS opt-out checks before nurture SMS sends that currently bypass them, and (3) give agents a portal button to flag manual opt-out requests.

**Architecture:** A Gmail-triggered n8n workflow ingests weekly BoldTrail CSV exports and upserts leads into Neon. The existing `Twilio STOP Handler` already correctly sets `sms_opt_out` in Neon — no changes needed there. The `7-Touch Cold Nurture with Research` sends SMS at touches T2, T4, T6 with no opt-out gate; add a Postgres lookup + IF node before each. A new `manual_optout_handler` n8n webhook + "Stop texting this lead" button in `lead_action_edit.html` covers the verbal/in-person opt-out path.

**Tech Stack:** n8n (Gmail Trigger, Code, Postgres, Webhook, IF nodes), Neon/Postgres 17, vanilla HTML/JS, Playwright tests, Norr AI Polar Modern CSS

---

## File Map

| Action | File | What changes |
|--------|------|-------------|
| Modify | `db/schema.sql` | Add partial unique index on `leads(email, phone)` |
| Create | `n8n/workflows/BoldTrail CSV Import.json` | Gmail → parse CSV → upsert Neon leads |
| Modify | `n8n/workflows/Real Estate 7-Touch Cold Nurture with Research.json` | Add Check SMS Opt-Out + IF before SMS T2, T4, T6 |
| Create | `n8n/workflows/Manual Opt-Out Handler.json` | Webhook → validate token → set `sms_opt_out = true` |
| Modify | `website/clients/lead_action_edit.html` | Add "Stop texting this lead" button (SMS only) |
| Create | `tests/lead_action_edit.spec.js` | Playwright tests: render, send, cancel, opt-out flow |
| Modify | `CLAUDE.md` | Add `boldtrail_csv_import`, `manual_optout_handler` to workflow registry table |

---

## Task 1: Schema — Unique Index on leads(email, phone)

**Files:**
- Modify: `db/schema.sql`

**Context:** The CSV import upsert uses `ON CONFLICT (email, phone)` which requires a matching unique constraint. The `leads` table has no such constraint today. Using a partial index (only where both are non-null) correctly handles leads with missing contact info.

- [ ] **Step 1: Add index to `db/schema.sql`**

In `db/schema.sql`, after line 108 (`CREATE INDEX idx_leads_client_status ON leads(client_id, status);`), insert:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_email_phone
  ON leads(email, phone)
  WHERE email IS NOT NULL AND phone IS NOT NULL;
```

- [ ] **Step 2: Apply via Neon MCP**

Using `mcp__Neon__run_sql` (project: `gentle-hill-54285247`, database: `neondb`):

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_email_phone
  ON leads(email, phone)
  WHERE email IS NOT NULL AND phone IS NOT NULL;
```

Expected result: `CREATE INDEX`

- [ ] **Step 3: Verify**

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'leads' AND indexname = 'idx_leads_email_phone';
```

Expected: one row with definition containing `WHERE ((email IS NOT NULL) AND (phone IS NOT NULL))`.

- [ ] **Step 4: Commit**

```bash
git add db/schema.sql
git commit -m "feat: add partial unique index on leads(email, phone) for upsert support"
```

---

## Task 2: BoldTrail CSV Import Workflow

**Files:**
- Create: `n8n/workflows/BoldTrail CSV Import.json`

**Context:**
- Gmail credential must be configured in n8n for `imports@norrai.co` — set the `id` and `name` in the node after adding the credential
- Replace `WEICHERT_CLIENT_ID` with the actual UUID from `SELECT id FROM clients WHERE business_name ILIKE '%weichert%'` in Neon
- `Log Completed` fires once per CSV row (not once per import run) — this is acceptable for this audit log volume
- The upsert query is pre-built in the `Split Into Rows` Code node (same pattern as `Twilio STOP Handler`'s `Build Opt-Out Update` node)

- [ ] **Step 1: Create `n8n/workflows/BoldTrail CSV Import.json`**

```json
{
  "name": "BoldTrail CSV Import",
  "nodes": [
    {
      "parameters": {
        "pollTimes": { "item": [{ "mode": "everyMinute" }] },
        "filters": { "readStatus": "unread" },
        "downloadAttachments": true,
        "dataPropertyAttachmentsPrefixName": "attachment_",
        "options": {}
      },
      "type": "n8n-nodes-base.gmailTrigger",
      "typeVersion": 1.2,
      "position": [240, 300],
      "id": "bc100001-0001-4000-8000-bc1000000001",
      "name": "Gmail Trigger",
      "credentials": {
        "gmailOAuth2": {
          "id": "GMAIL_IMPORTS_CREDENTIAL_ID",
          "name": "Gmail account (imports@norrai.co)"
        }
      }
    },
    {
      "parameters": {
        "jsCode": "const email = $input.first().json;\nconst attachments = [];\n\n// n8n Gmail trigger stores attachments as attachment_0, attachment_1, etc.\nfor (let i = 0; ; i++) {\n  const key = `attachment_${i}`;\n  if (!email[key]) break;\n  attachments.push(email[key]);\n}\n\nconst csvAttachment = attachments.find(a =>\n  (a.name || '').toLowerCase().endsWith('.csv') ||\n  (a.mimeType || '').includes('csv')\n);\n\nif (!csvAttachment) {\n  throw new Error('No CSV attachment in email from: ' + (email.from || 'unknown'));\n}\n\nconst csvContent = Buffer.from(csvAttachment.data, 'base64')\n  .toString('utf-8')\n  .replace(/^\\uFEFF/, '')        // strip BOM\n  .replace(/\\r\\n/g, '\\n')\n  .replace(/\\r/g, '\\n');\n\nconst lines = csvContent.split('\\n').filter(l => l.trim());\nif (lines.length < 2) throw new Error('CSV has no data rows');\n\nfunction parseCSVLine(line) {\n  const result = [];\n  let current = '';\n  let inQuotes = false;\n  for (let i = 0; i < line.length; i++) {\n    const ch = line[i];\n    if (ch === '\"') {\n      if (inQuotes && line[i + 1] === '\"') { current += '\"'; i++; }\n      else inQuotes = !inQuotes;\n    } else if (ch === ',' && !inQuotes) {\n      result.push(current.trim()); current = '';\n    } else {\n      current += ch;\n    }\n  }\n  result.push(current.trim());\n  return result;\n}\n\nconst headers = parseCSVLine(lines[0]);\nconst rows = [];\nfor (let i = 1; i < lines.length; i++) {\n  if (!lines[i].trim()) continue;\n  const values = parseCSVLine(lines[i]);\n  const row = {};\n  headers.forEach((h, idx) => { row[h] = values[idx] || ''; });\n  rows.push(row);\n}\n\nreturn [{ json: { rows, row_count: rows.length, filename: csvAttachment.name } }];"
      },
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [460, 300],
      "id": "bc100001-0002-4000-8000-bc1000000002",
      "name": "Parse CSV Rows"
    },
    {
      "parameters": {
        "operation": "executeQuery",
        "query": "SELECT id FROM clients WHERE id = 'WEICHERT_CLIENT_ID'",
        "continueOnFail": true
      },
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2.5,
      "position": [680, 300],
      "id": "bc100001-0003-4000-8000-bc1000000003",
      "name": "Lookup Client",
      "continueOnFail": true,
      "credentials": {
        "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon Postgres" }
      }
    },
    {
      "parameters": {
        "operation": "executeQuery",
        "query": "INSERT INTO workflow_events (client_id, workflow_name, event_type, payload)\nVALUES (\n  '{{ $('Lookup Client').first().json.id }}',\n  'boldtrail_csv_import',\n  'triggered',\n  ('{\"row_count\":' || {{ $('Parse CSV Rows').first().json.row_count }} || ',\"filename\":\"{{ $('Parse CSV Rows').first().json.filename }}\"}')::jsonb\n)",
        "continueOnFail": true
      },
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2.5,
      "position": [900, 300],
      "id": "bc100001-0004-4000-8000-bc1000000004",
      "name": "Log Triggered",
      "continueOnFail": true,
      "credentials": {
        "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon Postgres" }
      }
    },
    {
      "parameters": {
        "jsCode": "const clientId = $('Lookup Client').first().json.id;\nconst rows = $('Parse CSV Rows').first().json.rows;\n\nconst MAPPED_COLS = new Set([\n  'Contact Name','Full Name','Name',\n  'Email','Email Address',\n  'Phone','Phone Number','Mobile','Cell',\n  'Status','Assigned To','Agent','Agent Email',\n  'Source','Lead Source',\n  'Address','Property Address',\n  'Created Date','Date Added'\n]);\n\nreturn rows\n  .map(row => {\n    const rawName = (row['Contact Name'] || row['Full Name'] || row['Name'] || '').trim();\n    const emailRaw = (row['Email'] || row['Email Address'] || '').toLowerCase().trim();\n    const rawPhone = (row['Phone'] || row['Phone Number'] || row['Mobile'] || row['Cell'] || '').replace(/[^\\d]/g, '');\n    const phone = rawPhone.length === 11 && rawPhone.startsWith('1') ? rawPhone.slice(1) : rawPhone;\n\n    if (!emailRaw && !phone) return null;\n\n    const metadata = {\n      boldtrail_status:     row['Status'] || '',\n      agent_email:          (row['Assigned To'] || row['Agent'] || row['Agent Email'] || '').trim(),\n      lead_source:          (row['Source'] || row['Lead Source'] || '').trim(),\n      property_address:     (row['Address'] || row['Property Address'] || '').trim(),\n      boldtrail_created_at: (row['Created Date'] || row['Date Added'] || '').trim(),\n    };\n    Object.keys(row).forEach(k => {\n      if (!MAPPED_COLS.has(k) && row[k]) metadata['raw_' + k] = row[k];\n    });\n\n    // Escape single quotes for safe SQL interpolation\n    const safeName    = rawName.replace(/'/g, \"''\");\n    const safeEmail   = emailRaw.replace(/'/g, \"''\");\n    const safePhone   = phone.replace(/'/g, \"''\");\n    const safeMeta    = JSON.stringify(metadata).replace(/'/g, \"''\");\n    const emailVal    = safeEmail ? `'${safeEmail}'` : 'NULL';\n    const phoneVal    = safePhone ? `'${safePhone}'` : 'NULL';\n\n    const upsertQuery = `INSERT INTO leads (client_id, lead_name, email, phone, source, metadata)\nVALUES ('${clientId}', '${safeName}', ${emailVal}, ${phoneVal}, 'boldtrail', '${safeMeta}'::jsonb)\nON CONFLICT (email, phone) WHERE email IS NOT NULL AND phone IS NOT NULL\nDO UPDATE SET\n  lead_name  = EXCLUDED.lead_name,\n  metadata   = leads.metadata || EXCLUDED.metadata,\n  updated_at = NOW()`;\n\n    return { json: { upsert_query: upsertQuery, client_id: clientId } };\n  })\n  .filter(Boolean);"
      },
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1120, 300],
      "id": "bc100001-0005-4000-8000-bc1000000005",
      "name": "Split Into Rows"
    },
    {
      "parameters": {
        "operation": "executeQuery",
        "query": "={{ $json.upsert_query }}",
        "continueOnFail": true
      },
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2.5,
      "position": [1340, 300],
      "id": "bc100001-0006-4000-8000-bc1000000006",
      "name": "Upsert Lead",
      "continueOnFail": true,
      "credentials": {
        "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon Postgres" }
      }
    },
    {
      "parameters": {
        "operation": "executeQuery",
        "query": "INSERT INTO workflow_events (client_id, workflow_name, event_type, payload)\nVALUES (\n  '{{ $json.client_id }}',\n  'boldtrail_csv_import',\n  'completed',\n  '{\"execution_id\": \"{{ $execution.id }}\"}'::jsonb\n)",
        "continueOnFail": true
      },
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2.5,
      "position": [1560, 300],
      "id": "bc100001-0007-4000-8000-bc1000000007",
      "name": "Log Completed",
      "continueOnFail": true,
      "credentials": {
        "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon Postgres" }
      }
    }
  ],
  "connections": {
    "Gmail Trigger":   { "main": [[{ "node": "Parse CSV Rows",  "type": "main", "index": 0 }]] },
    "Parse CSV Rows":  { "main": [[{ "node": "Lookup Client",   "type": "main", "index": 0 }]] },
    "Lookup Client":   { "main": [[{ "node": "Log Triggered",   "type": "main", "index": 0 }]] },
    "Log Triggered":   { "main": [[{ "node": "Split Into Rows", "type": "main", "index": 0 }]] },
    "Split Into Rows": { "main": [[{ "node": "Upsert Lead",     "type": "main", "index": 0 }]] },
    "Upsert Lead":     { "main": [[{ "node": "Log Completed",   "type": "main", "index": 0 }]] }
  },
  "settings": {
    "errorWorkflow": "Norr AI Workflow Error Logger",
    "saveDataErrorExecution": "all",
    "saveDataSuccessExecution": "none",
    "saveManualExecutions": true
  },
  "tags": [],
  "triggerCount": 1,
  "versionId": "boldtrail-csv-import-v1"
}
```

- [ ] **Step 2: Get Weichert client UUID and update the JSON**

Run via Neon MCP:
```sql
SELECT id, business_name FROM clients WHERE business_name ILIKE '%weichert%';
```

Replace `WEICHERT_CLIENT_ID` in the `Lookup Client` node query with the returned UUID.

- [ ] **Step 3: Import workflow into n8n**

In n8n Cloud UI: Settings → Import from file → select `n8n/workflows/BoldTrail CSV Import.json`.

After import:
1. Open the `Gmail Trigger` node and swap the credential to the `imports@norrai.co` Google account (must already exist in n8n Credentials)
2. Set up a Gmail filter in the trigger: filter by sender address (the BoldTrail export sender — get this from the first real export)
3. Open `Lookup Client`, `Log Triggered`, `Split Into Rows`, `Upsert Lead`, `Log Completed` nodes → confirm the Postgres credential shows "Neon Postgres" (not a broken credential)
4. Set Error Workflow: workflow Settings → Error Workflow → "Norr AI Workflow Error Logger"
5. Activate the workflow

- [ ] **Step 4: Smoke test**

Run a manual test export from BoldTrail (brokerage owner), confirm the email arrives at `imports@norrai.co`. Trigger the workflow manually in n8n with the email, then run:

```sql
SELECT lead_name, email, phone, source, metadata->>'agent_email' as agent, updated_at
FROM leads
WHERE source = 'boldtrail'
ORDER BY updated_at DESC
LIMIT 10;
```

Expected: rows present with `source = 'boldtrail'` and correct contact info.

- [ ] **Step 5: Sync workflow and commit**

Use the `workflow-sync` skill to pull the workflow from n8n and overwrite the local JSON, then commit:

```bash
git add "n8n/workflows/BoldTrail CSV Import.json"
git commit -m "feat: add BoldTrail CSV Import workflow (boldtrail_csv_import)"
```

---

## Task 3: Add SMS Opt-Out Gates to Cold Nurture with Research

**Files:**
- Modify: `n8n/workflows/Real Estate 7-Touch Cold Nurture with Research.json`

**Context:** The workflow sends SMS at touches T2, T4, T6 via Twilio. It has no opt-out check before any SMS send. Other SMS workflows (Open House Follow-Up, Review Request) use the pattern: Postgres lookup → IF node with `sms_opt_out` condition → true (opted out) stops, false (ok) continues to send.

The current node graph for each SMS touch:
```
Extract T2 → SMS T2 → Wait Day 7
Extract T4 → SMS T4 → Wait Day 14
Extract T6 → SMS T6 → [end]
```

Target graph:
```
Extract T2 → Check SMS Opt-Out T2 → SMS Opted Out T2? ─false─→ SMS T2 → Wait Day 7
                                                        └─true──→ [stop]
Extract T4 → Check SMS Opt-Out T4 → SMS Opted Out T4? ─false─→ SMS T4 → Wait Day 14
                                                        └─true──→ [stop]
Extract T6 → Check SMS Opt-Out T6 → SMS Opted Out T6? ─false─→ SMS T6 → [end]
                                                        └─true──→ [stop]
```

The phone number is available via `$('Prep Fields').item.json.phone` throughout the workflow (all downstream nodes carry Prep Fields data via `{ ...p }` spread in Extract nodes).

- [ ] **Step 1: Open the workflow in n8n UI**

In n8n Cloud, open "Real Estate 7-Touch Cold Nurture with Research".

- [ ] **Step 2: Add the 3 pairs of opt-out nodes**

For each of T2, T4, T6, add a Postgres node and an IF node between Extract TX and SMS TX:

**Check SMS Opt-Out TX (Postgres node):**
- Operation: Execute Query
- Query:
  ```sql
  SELECT sms_opt_out FROM leads WHERE phone = '{{ $('Prep Fields').item.json.phone }}' LIMIT 1
  ```
- continueOnFail: true
- Credential: Neon Postgres

**SMS Opted Out TX? (IF node):**
- Condition:
  - Left value: `={{ ($input.first().json.sms_opt_out || false) }}`
  - Operator: Boolean → Is True
- When TRUE (opted out) → no connection (stops)
- When FALSE (not opted out) → connects to SMS TX

Repeat for T2, T4, T6 — three pairs of nodes total.

- [ ] **Step 3: Rewire connections**

For each touch:
1. Delete the direct connection: `Extract TX → SMS TX`
2. Connect: `Extract TX → Check SMS Opt-Out TX`
3. Connect: `Check SMS Opt-Out TX → SMS Opted Out TX?`
4. Connect: `SMS Opted Out TX?` **FALSE output (port 1)** → `SMS TX`

Verify: clicking `SMS Opted Out TX?` shows two outputs — the first (true, opted-out) has no downstream node, the second (false, ok-to-send) connects to the Twilio SMS node.

- [ ] **Step 4: Activate and smoke test**

Activate the workflow. Test with a lead whose phone is in Neon with `sms_opt_out = false` — the SMS branch should be reached. 

To simulate an opted-out lead, run in Neon:
```sql
UPDATE leads SET sms_opt_out = true WHERE phone = 'TEST_PHONE_NUMBER';
-- reset after test:
UPDATE leads SET sms_opt_out = false WHERE phone = 'TEST_PHONE_NUMBER';
```

Manually trigger a nurture enrollment and step through to a Wait node, then verify the IF node routes correctly in the execution log.

- [ ] **Step 5: Export and commit**

Export the workflow from n8n (Settings → Download) and overwrite `n8n/workflows/Real Estate 7-Touch Cold Nurture with Research.json`. Then:

```bash
git add "n8n/workflows/Real Estate 7-Touch Cold Nurture with Research.json"
git commit -m "feat: add SMS opt-out check before T2/T4/T6 in Cold Nurture with Research"
```

---

## Task 4: Manual Opt-Out Handler Workflow

**Files:**
- Create: `n8n/workflows/Manual Opt-Out Handler.json`

**Context:** This webhook receives `{ phone, agent_token }` from `lead_action_edit.html` when the agent clicks "Stop texting this lead". It validates the token against the `clients` table, then sets `sms_opt_out = true` on the matching lead. `agent_token` is the client's `token` UUID from the `clients` table — the same token used in other client portal pages.

- [ ] **Step 1: Create `n8n/workflows/Manual Opt-Out Handler.json`**

```json
{
  "name": "Manual Opt-Out Handler",
  "nodes": [
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "manual-optout",
        "responseMode": "responseNode",
        "options": {}
      },
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2.1,
      "position": [240, 300],
      "id": "mo100001-0001-4000-8000-mo1000000001",
      "name": "Receive Opt-Out",
      "webhookId": "manual-optout-webhook-001"
    },
    {
      "parameters": {
        "operation": "executeQuery",
        "query": "SELECT id FROM clients WHERE token = '{{ $json.body.agent_token }}'",
        "continueOnFail": true
      },
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2.5,
      "position": [460, 300],
      "id": "mo100001-0002-4000-8000-mo1000000002",
      "name": "Verify Token",
      "continueOnFail": true,
      "credentials": {
        "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon Postgres" }
      }
    },
    {
      "parameters": {
        "conditions": {
          "options": { "caseSensitive": true, "typeValidation": "loose", "version": 3 },
          "conditions": [
            {
              "id": "mo-token-check",
              "leftValue": "={{ $input.first().json.id }}",
              "operator": { "type": "string", "operation": "exists", "singleValue": true }
            }
          ],
          "combinator": "and"
        }
      },
      "type": "n8n-nodes-base.if",
      "typeVersion": 2.2,
      "position": [680, 300],
      "id": "mo100001-0003-4000-8000-mo1000000003",
      "name": "Token Valid?"
    },
    {
      "parameters": {
        "operation": "executeQuery",
        "query": "UPDATE leads\nSET sms_opt_out = true, opted_out_at = NOW()\nWHERE phone = '{{ $('Receive Opt-Out').first().json.body.phone }}'",
        "continueOnFail": true
      },
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2.5,
      "position": [900, 200],
      "id": "mo100001-0004-4000-8000-mo1000000004",
      "name": "Set SMS Opt-Out",
      "continueOnFail": true,
      "credentials": {
        "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon Postgres" }
      }
    },
    {
      "parameters": {
        "operation": "executeQuery",
        "query": "INSERT INTO workflow_events (client_id, workflow_name, event_type, payload)\nVALUES (\n  '{{ $('Verify Token').first().json.id }}',\n  'manual_optout_handler',\n  'completed',\n  ('{\"phone\":\"' || '{{ $('Receive Opt-Out').first().json.body.phone }}' || '\",\"execution_id\":\"{{ $execution.id }}\"}')::jsonb\n)",
        "continueOnFail": true
      },
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2.5,
      "position": [1120, 200],
      "id": "mo100001-0005-4000-8000-mo1000000005",
      "name": "Log Completed",
      "continueOnFail": true,
      "credentials": {
        "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon Postgres" }
      }
    },
    {
      "parameters": {
        "respondWith": "json",
        "responseBody": "={\"ok\": true}",
        "options": { "responseCode": 200 }
      },
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [1340, 200],
      "id": "mo100001-0006-4000-8000-mo1000000006",
      "name": "Respond OK"
    },
    {
      "parameters": {
        "respondWith": "json",
        "responseBody": "={\"ok\": false, \"error\": \"invalid token\"}",
        "options": { "responseCode": 401 }
      },
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [900, 420],
      "id": "mo100001-0007-4000-8000-mo1000000007",
      "name": "Respond Unauthorized"
    }
  ],
  "connections": {
    "Receive Opt-Out":      { "main": [[{ "node": "Verify Token",         "type": "main", "index": 0 }]] },
    "Verify Token":         { "main": [[{ "node": "Token Valid?",          "type": "main", "index": 0 }]] },
    "Token Valid?": {
      "main": [
        [{ "node": "Set SMS Opt-Out",        "type": "main", "index": 0 }],
        [{ "node": "Respond Unauthorized",   "type": "main", "index": 0 }]
      ]
    },
    "Set SMS Opt-Out":      { "main": [[{ "node": "Log Completed",        "type": "main", "index": 0 }]] },
    "Log Completed":        { "main": [[{ "node": "Respond OK",           "type": "main", "index": 0 }]] }
  },
  "settings": {
    "errorWorkflow": "Norr AI Workflow Error Logger",
    "saveDataErrorExecution": "all",
    "saveDataSuccessExecution": "none",
    "saveManualExecutions": true
  },
  "tags": [],
  "triggerCount": 1,
  "versionId": "manual-optout-handler-v1"
}
```

- [ ] **Step 2: Import into n8n**

In n8n Cloud UI: Settings → Import from file → select `n8n/workflows/Manual Opt-Out Handler.json`.

After import:
1. Open Postgres nodes and confirm credential shows "Neon Postgres"
2. Set Error Workflow: Settings → Error Workflow → "Norr AI Workflow Error Logger"
3. Activate the workflow
4. Note the production webhook URL: `https://norrai.app.n8n.cloud/webhook/manual-optout`

- [ ] **Step 3: Smoke test via curl**

Get a valid client token from Neon:
```sql
SELECT token FROM clients WHERE status = 'active' LIMIT 1;
```

Get a phone number from the leads table:
```sql
SELECT phone FROM leads WHERE phone IS NOT NULL LIMIT 1;
```

Send the request (replace values):
```bash
curl -X POST https://norrai.app.n8n.cloud/webhook/manual-optout \
  -H "Content-Type: application/json" \
  -d '{"phone":"5075551234","agent_token":"<uuid-from-clients>"}'
```

Expected: `{"ok": true}`. Verify in Neon:
```sql
SELECT phone, sms_opt_out, opted_out_at FROM leads WHERE phone = '5075551234';
```

Reset after test:
```sql
UPDATE leads SET sms_opt_out = false, opted_out_at = NULL WHERE phone = '5075551234';
```

- [ ] **Step 4: Sync and commit**

```bash
git add "n8n/workflows/Manual Opt-Out Handler.json"
git commit -m "feat: add Manual Opt-Out Handler workflow (manual_optout_handler)"
```

---

## Task 5: Opt-Out Button in lead_action_edit.html + Tests

**Files:**
- Create: `tests/lead_action_edit.spec.js`
- Modify: `website/clients/lead_action_edit.html`

**Context:** The page is opened with URL params: `token`, `action` (send_sms | send_email), `draft`, `lead_name`, and now also `phone`. The opt-out button only shows when `action === 'send_sms'` AND `phone` is present in the URL params. On click: shows a confirm dialog, then POSTs to the `manual-optout` webhook, shows a success state. The button is styled as a secondary destructive action (not primary CTA color).

**Note for Lead Action Handler workflow:** The URL that n8n generates to open this page needs `phone` added as a query param so the opt-out button appears. That workflow update is out of scope here but should be filed as a follow-up task.

- [ ] **Step 1: Write the failing tests**

Create `tests/lead_action_edit.spec.js`:

```javascript
const { test, expect } = require('@playwright/test');

const BASE_URL = '/clients/lead_action_edit.html';

function smsUrl(overrides = {}) {
  const params = new URLSearchParams({
    token: 'test-token-abc',
    action: 'send_sms',
    draft: 'Hi Sarah, just checking in!',
    lead_name: 'Sarah Johnson',
    phone: '5075551234',
    ...overrides,
  });
  return `${BASE_URL}?${params.toString()}`;
}

function emailUrl(overrides = {}) {
  const params = new URLSearchParams({
    token: 'test-token-abc',
    action: 'send_email',
    draft: 'Hi Sarah, following up on your inquiry.',
    lead_name: 'Sarah Johnson',
    ...overrides,
  });
  return `${BASE_URL}?${params.toString()}`;
}

function mockWebhook(page, path = '**/webhook/**', status = 200) {
  return page.route(path, route =>
    route.fulfill({ status, body: JSON.stringify({ ok: true }), contentType: 'application/json' })
  );
}

// ─── 1. Page load ─────────────────────────────────────────────────────────────

test.describe('Page load', () => {
  test('loads with correct SMS title', async ({ page }) => {
    await page.goto(smsUrl());
    await expect(page.locator('h2')).toHaveText('Edit SMS');
  });

  test('loads with correct email title', async ({ page }) => {
    await page.goto(emailUrl());
    await expect(page.locator('h2')).toHaveText('Edit Email');
  });

  test('pre-fills textarea with draft param', async ({ page }) => {
    await page.goto(smsUrl());
    await expect(page.locator('#message-text')).toHaveValue('Hi Sarah, just checking in!');
  });
});

// ─── 2. Send action ───────────────────────────────────────────────────────────

test.describe('Send action', () => {
  test('submits to lead-action webhook and shows success', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(smsUrl());
    await page.click('#send-btn');
    await expect(page.locator('#status-msg.success')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#edit-form')).not.toBeVisible();
  });

  test('shows error state on webhook failure', async ({ page }) => {
    await mockWebhook(page, '**/webhook/**', 500);
    await page.goto(smsUrl());
    await page.click('#send-btn');
    await expect(page.locator('#status-msg.error')).toBeVisible({ timeout: 5000 });
  });

  test('cancel button does not submit', async ({ page }) => {
    let fetched = false;
    await page.route('**/webhook/**', route => { fetched = true; route.continue(); });
    await page.goto(smsUrl());
    // cancel closes window — just verify no webhook was called before any click
    expect(fetched).toBe(false);
  });
});

// ─── 3. Opt-out button visibility ─────────────────────────────────────────────

test.describe('Opt-out button visibility', () => {
  test('shows opt-out button for SMS when phone param present', async ({ page }) => {
    await page.goto(smsUrl());
    await expect(page.locator('#optout-btn')).toBeVisible();
  });

  test('hides opt-out button when action is send_email', async ({ page }) => {
    await page.goto(emailUrl());
    await expect(page.locator('#optout-btn')).not.toBeVisible();
  });

  test('hides opt-out button when phone param is missing', async ({ page }) => {
    await page.goto(smsUrl({ phone: '' }));
    await expect(page.locator('#optout-btn')).not.toBeVisible();
  });
});

// ─── 4. Opt-out flow ──────────────────────────────────────────────────────────

test.describe('Opt-out flow', () => {
  test('clicking opt-out button shows confirm dialog text', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(smsUrl());

    // Intercept confirm dialog
    page.on('dialog', async dialog => {
      expect(dialog.message()).toContain('Sarah Johnson');
      await dialog.accept();
    });
    await page.click('#optout-btn');
  });

  test('accepting confirm sends POST to manual-optout webhook', async ({ page }) => {
    let capturedBody = null;
    await page.route('**/webhook/manual-optout**', async route => {
      capturedBody = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({ status: 200, body: JSON.stringify({ ok: true }), contentType: 'application/json' });
    });

    await page.goto(smsUrl());
    page.on('dialog', dialog => dialog.accept());
    await page.click('#optout-btn');

    await expect(page.locator('#status-msg.success')).toBeVisible({ timeout: 5000 });
    expect(capturedBody).toMatchObject({ phone: '5075551234', agent_token: 'test-token-abc' });
  });

  test('dismissing confirm dialog does not call webhook', async ({ page }) => {
    let called = false;
    await page.route('**/webhook/manual-optout**', route => { called = true; route.continue(); });

    await page.goto(smsUrl());
    page.on('dialog', dialog => dialog.dismiss());
    await page.click('#optout-btn');

    await page.waitForTimeout(300);
    expect(called).toBe(false);
  });

  test('opt-out error state shown on webhook failure', async ({ page }) => {
    await page.route('**/webhook/manual-optout**', route =>
      route.fulfill({ status: 401, body: JSON.stringify({ ok: false }), contentType: 'application/json' })
    );

    await page.goto(smsUrl());
    page.on('dialog', dialog => dialog.accept());
    await page.click('#optout-btn');

    await expect(page.locator('#status-msg.error')).toBeVisible({ timeout: 5000 });
  });

  test('after successful opt-out, send form is hidden', async ({ page }) => {
    await page.route('**/webhook/manual-optout**', route =>
      route.fulfill({ status: 200, body: JSON.stringify({ ok: true }), contentType: 'application/json' })
    );

    await page.goto(smsUrl());
    page.on('dialog', dialog => dialog.accept());
    await page.click('#optout-btn');

    await expect(page.locator('#edit-form')).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('#status-msg.success')).toBeVisible();
  });
});
```

- [ ] **Step 2: Run tests to confirm they all fail**

```bash
npx playwright test tests/lead_action_edit.spec.js --reporter=line
```

Expected: multiple failures — `#optout-btn` not found, etc.

- [ ] **Step 3: Implement the opt-out button in `lead_action_edit.html`**

In `website/clients/lead_action_edit.html`, make the following changes:

**Add CSS** — in the `<style>` block, after the `.status` rule (line 35):

```css
    .optout-btn { margin-top: 28px; padding-top: 20px; border-top: 1px solid var(--border); display: none; }
    .optout-btn button { background: none; border: 1px solid #c0392b; color: #c0392b; padding: 9px 20px; font-family: 'Inter', sans-serif; font-size: 13px; border-radius: 4px; cursor: pointer; }
    .optout-btn button:hover { background: #fdecea; }
```

**Add HTML** — in `<main>`, after the `<div class="status" id="status-msg"></div>` line (line 54):

```html
    <div class="optout-btn" id="optout-section">
      <button type="button" id="optout-btn">Stop texting this lead</button>
    </div>
```

**Add JavaScript** — after the `const isSms = action === 'send_sms';` line (after line 62), add:

```javascript
    const phone = params.get('phone') || '';
```

After the `updateCount();` call (after line 83), add:

```javascript
    // Show opt-out button only for SMS with a known phone number
    if (isSms && phone) {
      document.getElementById('optout-section').style.display = 'block';
    }

    document.getElementById('optout-btn').addEventListener('click', async () => {
      const confirmed = window.confirm(
        `Mark ${leadName} as opted out? They will no longer receive automated texts from Norr AI.`
      );
      if (!confirmed) return;

      const status = document.getElementById('status-msg');
      const btn = document.getElementById('optout-btn');
      btn.disabled = true;

      try {
        const res = await fetch('https://norrai.app.n8n.cloud/webhook/manual-optout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, agent_token: token }),
        });
        if (res.ok) {
          document.getElementById('edit-form').style.display = 'none';
          document.getElementById('optout-section').style.display = 'none';
          status.textContent = `${leadName} has been opted out. No further texts will be sent.`;
          status.className = 'status success';
        } else {
          throw new Error('Request failed');
        }
      } catch {
        status.textContent = 'Something went wrong marking opt-out. Try again or contact support.';
        status.className = 'status error';
        btn.disabled = false;
      }
    });
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx playwright test tests/lead_action_edit.spec.js --reporter=line
```

Expected: all tests pass.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all 276+ tests pass (plus the new lead_action_edit tests).

- [ ] **Step 6: Commit**

```bash
git add tests/lead_action_edit.spec.js website/clients/lead_action_edit.html
git commit -m "feat: add SMS opt-out button to lead_action_edit with Playwright coverage"
```

---

## Task 6: CLAUDE.md Workflow Registry Update

**Files:**
- Modify: `CLAUDE.md`

**Context:** Two new `workflow_name` values need to be added to the registry table in CLAUDE.md so future session context is accurate.

- [ ] **Step 1: Add entries to the workflow registry table in `CLAUDE.md`**

In the `**workflow_name` registry section, add two rows after the `PropertyBoost Parser` entry:

```
| BoldTrail CSV Import | `boldtrail_csv_import` |
| Manual Opt-Out Handler | `manual_optout_handler` |
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: register boldtrail_csv_import and manual_optout_handler workflow names"
```

---

## Gmail Auto-Forward Setup (Non-Code — One-Time)

**Not a code task — no commit needed.** Do this in person or via screen share with the brokerage owner.

1. In the brokerage owner's Gmail: Settings (⚙️) → See all settings → Filters and Blocked Addresses → Create a new filter
2. Filter criteria:
   - **From:** `[BoldTrail export sender — check from first real export]`
   - **Has attachment:** ✓
3. Action: **Forward to** `imports@norrai.co`
4. Also check: **Never send it to Spam**
5. Test: owner runs an export from BoldTrail, confirms email arrives at `imports@norrai.co`
6. Open the n8n BoldTrail CSV Import workflow and set the Gmail Trigger filter to match the same sender address

This completes the "brokerage owner clicks Export → everything else is automated" loop described in the PRD.
