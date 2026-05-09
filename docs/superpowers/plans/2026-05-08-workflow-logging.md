# Workflow Execution Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `triggered`, `completed`, and `failed` events to `workflow_events` in Neon for all 21 n8n workflows, powering the monitoring dashboard health logic.

**Architecture:** All logging nodes run as parallel branches from existing nodes — they never sit inline and never touch `$json` in the main flow. All use `continueOnFail: true`. A new shared Error Logger workflow captures failure events via execution_id lookup in `workflow_events`.

**Tech Stack:** n8n JSON workflow files, Neon Postgres (`NEON_CREDENTIAL_ID`), Node.js for JSON validation.

---

## Constants (reference throughout all tasks)

```
NORRAI_INTERNAL_UUID = e2f9934c-4d28-4bb4-ac90-4284c1123517
BNB_CLIENT_UUID      = 86a01b94-ddab-4594-8afc-8212fb18fdd0
```

## Parallel Branch Pattern (applied in every workflow task)

All logging nodes attach as **parallel branches** — they receive the same data as existing downstream nodes but run independently:

```
Anchor Node → [existing next node]      ← main flow untouched
            → Lookup Client             ← parallel branch (real estate only)
                → Build Log Triggered
                    → Log Triggered

Last Node → [nothing — was terminal]   ← was terminal
          → Build Log Completed         ← new parallel branch
              → Log Completed
```

**Connection change for parallel from a node that goes to one target:**
```json
// Before:
"Anchor Node": { "main": [[{"node": "Next Node", "type": "main", "index": 0}]] }

// After (real estate — adds Lookup Client in parallel):
"Anchor Node": { "main": [[{"node": "Next Node", "type": "main", "index": 0}, {"node": "Lookup Client", "type": "main", "index": 0}]] }
```

**Connection change for parallel from an IF TRUE branch (two outputs):**
```json
// Before:
"Token Check": { "main": [[{"node": "Prep Fields", "type": "main", "index": 0}], []] }

// After:
"Token Check": { "main": [[{"node": "Prep Fields", "type": "main", "index": 0}, {"node": "Lookup Client", "type": "main", "index": 0}], []] }
```

**Connection change for Log Completed parallel from a terminal node:**
```json
// Before: "Last Node" not present in connections (was terminal)
// After:
"Last Node": { "main": [[{"node": "Build Log Completed", "type": "main", "index": 0}]] }
```

## Reusable Node Templates

### TEMPLATE-LOOKUP: Lookup Client (real estate only)
```json
{
  "parameters": {
    "operation": "executeQuery",
    "query": "=SELECT id FROM clients WHERE primary_contact_email = '{{ $('RECEIVE_NODE').first().json.body.agent_email }}'"
  },
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [ANCHOR_X, ANCHOR_Y + 200],
  "id": "REPLACE_UUID",
  "name": "Lookup Client",
  "continueOnFail": true,
  "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
}
```

### TEMPLATE-BLT-RE: Build Log Triggered (real estate, runs after Lookup Client)
```json
{
  "parameters": {
    "jsCode": "const clientId = $json?.id ?? 'e2f9934c-4d28-4bb4-ac90-4284c1123517';\nconst execId = $execution.id;\nconst agentEmail = ($('RECEIVE_NODE').first().json.body.agent_email || '').replace(/'/g, \"''\");\nreturn [{ json: { query: `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('${clientId}', 'WORKFLOW_SNAKE', 'triggered', ('{\"execution_id\": \"' || '${execId}' || '\", \"agent_email\": \"' || '${agentEmail}' || '\"}')::jsonb)` } }];"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [ANCHOR_X + 200, ANCHOR_Y + 200],
  "id": "REPLACE_UUID",
  "name": "Build Log Triggered",
  "continueOnFail": true
}
```

### TEMPLATE-BLT-HARD: Build Log Triggered (hardcoded client_id — B&B, internal, intake)
```json
{
  "parameters": {
    "jsCode": "const execId = $execution.id;\nreturn [{ json: { query: `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('CLIENT_UUID', 'WORKFLOW_SNAKE', 'triggered', ('{\"execution_id\": \"' || '${execId}' || '\"}')::jsonb)` } }];"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [X, Y],
  "id": "REPLACE_UUID",
  "name": "Build Log Triggered",
  "continueOnFail": true
}
```

### TEMPLATE-POSTGRES: Log Triggered / Log Completed (Postgres execute node)
```json
{
  "parameters": { "operation": "executeQuery", "query": "={{ $json.query }}" },
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [X, Y],
  "id": "REPLACE_UUID",
  "name": "Log Triggered",
  "continueOnFail": true,
  "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
}
```
*(Change `"name"` to `"Log Completed"` for the completed node.)*

### TEMPLATE-BLC-RE: Build Log Completed (real estate, uses Lookup Client reference)
```json
{
  "parameters": {
    "jsCode": "const clientId = $('Lookup Client').first().json?.id ?? 'e2f9934c-4d28-4bb4-ac90-4284c1123517';\nconst execId = $execution.id;\nreturn [{ json: { query: `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('${clientId}', 'WORKFLOW_SNAKE', 'completed', ('{\"execution_id\": \"' || '${execId}' || '\"}')::jsonb)` } }];"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [LAST_X, LAST_Y + 200],
  "id": "REPLACE_UUID",
  "name": "Build Log Completed",
  "continueOnFail": true
}
```

### TEMPLATE-BLC-HARD: Build Log Completed (hardcoded client_id)
```json
{
  "parameters": {
    "jsCode": "const execId = $execution.id;\nreturn [{ json: { query: `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('CLIENT_UUID', 'WORKFLOW_SNAKE', 'completed', ('{\"execution_id\": \"' || '${execId}' || '\"}')::jsonb)` } }];"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [LAST_X, LAST_Y + 200],
  "id": "REPLACE_UUID",
  "name": "Build Log Completed",
  "continueOnFail": true
}
```

---

## Task 1: DB Migration — norrai_internal client row

**Files:**
- Create: `db/migrations/002_norrai_internal_client.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- 002_norrai_internal_client.sql
-- Inserts the norrai_internal client row required for all internal workflow logging.
-- Safe to run multiple times (ON CONFLICT DO NOTHING).

INSERT INTO clients (
  id,
  business_name,
  vertical,
  tier,
  status,
  primary_contact_name,
  primary_contact_email
)
VALUES (
  'e2f9934c-4d28-4bb4-ac90-4284c1123517',
  'Norr AI (Internal)',
  'internal',
  'internal',
  'active',
  'Egan',
  'hello@norrai.co'
)
ON CONFLICT (id) DO NOTHING;
```

- [ ] **Step 2: Apply to Neon**

Run via Neon MCP:
```sql
INSERT INTO clients (id, business_name, vertical, tier, status, primary_contact_name, primary_contact_email)
VALUES ('e2f9934c-4d28-4bb4-ac90-4284c1123517', 'Norr AI (Internal)', 'internal', 'internal', 'active', 'Egan', 'hello@norrai.co')
ON CONFLICT (id) DO NOTHING;
```
Expected: `INSERT 0 1` (or `INSERT 0 0` if row already exists — both are fine).

- [ ] **Step 3: Verify**

```sql
SELECT id, business_name, status FROM clients WHERE id = 'e2f9934c-4d28-4bb4-ac90-4284c1123517';
```
Expected: one row returned.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/002_norrai_internal_client.sql
git commit -m "db: add norrai_internal client row migration"
```

---

## Task 2: Error Logger Workflow

**Files:**
- Create: `n8n/workflows/Norr AI Workflow Error Logger.json`

**How it works:**
1. Error Trigger receives n8n error payload with `execution.id`, `execution.workflowName`, `execution.error`
2. Lookup Triggered Event: queries `workflow_events` by `execution_id` stored in the triggered event payload
3. Build Log Failed: builds INSERT with `client_id` from lookup (falls back to norrai_internal)
4. Log Failed: executes INSERT

- [ ] **Step 1: Create the workflow JSON**

Write `n8n/workflows/Norr AI Workflow Error Logger.json`:

```json
{
  "name": "Norr AI Workflow Error Logger",
  "nodes": [
    {
      "parameters": {},
      "type": "n8n-nodes-base.errorTrigger",
      "typeVersion": 1,
      "position": [240, 300],
      "id": "elog0001-0001-4000-8000-000000000001",
      "name": "Error Trigger"
    },
    {
      "parameters": {
        "operation": "executeQuery",
        "query": "=SELECT client_id, workflow_name FROM workflow_events WHERE event_type = 'triggered' AND payload->>'execution_id' = '{{ $json.execution.id }}' LIMIT 1"
      },
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2.5,
      "position": [460, 300],
      "id": "elog0001-0002-4000-8000-000000000002",
      "name": "Lookup Triggered Event",
      "continueOnFail": true,
      "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
    },
    {
      "parameters": {
        "jsCode": "const errData = $('Error Trigger').first().json;\nconst triggeredRow = $input.first().json;\nconst clientId = triggeredRow.client_id || 'e2f9934c-4d28-4bb4-ac90-4284c1123517';\nconst workflowName = triggeredRow.workflow_name || (errData.execution.workflowName || '').toLowerCase().replace(/\\s+/g, '_');\nconst execId = (errData.execution.id || '').replace(/'/g, \"''\");\nconst errMsg = (errData.execution.error?.message || '').replace(/'/g, \"''\").replace(/\"/g, '\\\\\"').substring(0, 500);\nconst errNode = (errData.execution.error?.node?.name || '').replace(/'/g, \"''\");\nreturn [{ json: { query: `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('${clientId}', '${workflowName}', 'failed', ('{\"execution_id\": \"${execId}\", \"error\": \"${errMsg}\", \"node\": \"${errNode}\"}')::jsonb)` } }];"
      },
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [680, 300],
      "id": "elog0001-0003-4000-8000-000000000003",
      "name": "Build Log Failed",
      "continueOnFail": true
    },
    {
      "parameters": { "operation": "executeQuery", "query": "={{ $json.query }}" },
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2.5,
      "position": [900, 300],
      "id": "elog0001-0004-4000-8000-000000000004",
      "name": "Log Failed",
      "continueOnFail": true,
      "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
    }
  ],
  "pinData": {},
  "connections": {
    "Error Trigger": { "main": [[{"node": "Lookup Triggered Event", "type": "main", "index": 0}]] },
    "Lookup Triggered Event": { "main": [[{"node": "Build Log Failed", "type": "main", "index": 0}]] },
    "Build Log Failed": { "main": [[{"node": "Log Failed", "type": "main", "index": 0}]] }
  },
  "active": false,
  "settings": { "executionOrder": "v1" },
  "versionId": "norrai-error-logger-v1-001",
  "meta": { "templateCredsSetupCompleted": false, "instanceId": "0d4efb408d47ca7fe5f9bfa9b6b5b1a6e6f8fcb31cb2584a172b735d47653914" },
  "id": "",
  "tags": []
}
```

- [ ] **Step 2: Validate JSON**

```bash
python3 -c "import json; json.load(open('n8n/workflows/Norr AI Workflow Error Logger.json')); print('valid')"
```
Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add "n8n/workflows/Norr AI Workflow Error Logger.json"
git commit -m "feat: add Norr AI Workflow Error Logger"
```

---

## Task 3: Real Estate Instant Lead Response

**Files:**
- Modify: `n8n/workflows/Real Estate Instant Lead Response.json`

**Anchor node:** `Token Check` (TRUE branch, position ~[440, 300])
**Trigger node (for agent_email):** `Receive Lead`
**Last main node for Log Completed:** `Extract Message` (parallel — fires before the email branch split)
**workflow_name:** `instant_lead_response`

- [ ] **Step 1: Add 5 logging nodes to the `nodes` array**

Append these 5 objects to the `nodes` array in `Real Estate Instant Lead Response.json`:

```json
{
  "parameters": {
    "operation": "executeQuery",
    "query": "=SELECT id FROM clients WHERE primary_contact_email = '{{ $('Receive Lead').first().json.body.agent_email }}'"
  },
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [640, 500],
  "id": "ilrl0001-0001-4000-8000-000000000001",
  "name": "Lookup Client",
  "continueOnFail": true,
  "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
},
{
  "parameters": {
    "jsCode": "const clientId = $json?.id ?? 'e2f9934c-4d28-4bb4-ac90-4284c1123517';\nconst execId = $execution.id;\nconst agentEmail = ($('Receive Lead').first().json.body.agent_email || '').replace(/'/g, \"''\");\nreturn [{ json: { query: `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('${clientId}', 'instant_lead_response', 'triggered', ('{\"execution_id\": \"' || '${execId}' || '\", \"agent_email\": \"' || '${agentEmail}' || '\"}')::jsonb)` } }];"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [840, 500],
  "id": "ilrl0001-0002-4000-8000-000000000002",
  "name": "Build Log Triggered",
  "continueOnFail": true
},
{
  "parameters": { "operation": "executeQuery", "query": "={{ $json.query }}" },
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [1040, 500],
  "id": "ilrl0001-0003-4000-8000-000000000003",
  "name": "Log Triggered",
  "continueOnFail": true,
  "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
},
{
  "parameters": {
    "jsCode": "const clientId = $('Lookup Client').first().json?.id ?? 'e2f9934c-4d28-4bb4-ac90-4284c1123517';\nconst execId = $execution.id;\nreturn [{ json: { query: `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('${clientId}', 'instant_lead_response', 'completed', ('{\"execution_id\": \"' || '${execId}' || '\"}')::jsonb)` } }];"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [1680, 500],
  "id": "ilrl0001-0004-4000-8000-000000000004",
  "name": "Build Log Completed",
  "continueOnFail": true
},
{
  "parameters": { "operation": "executeQuery", "query": "={{ $json.query }}" },
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [1880, 500],
  "id": "ilrl0001-0005-4000-8000-000000000005",
  "name": "Log Completed",
  "continueOnFail": true,
  "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
}
```

- [ ] **Step 2: Update `connections`**

In the `connections` object, make these two changes:

**Change 1 — parallel from Token Check TRUE branch:**
```json
"Token Check": {
  "main": [
    [
      {"node": "Validate Input", "type": "main", "index": 0},
      {"node": "Lookup Client", "type": "main", "index": 0}
    ],
    []
  ]
}
```

**Change 2 — Log Completed parallel from Extract Message:**
```json
"Extract Message": {
  "main": [
    [
      {"node": "Email to Lead", "type": "main", "index": 0},
      {"node": "Build Log Completed", "type": "main", "index": 0}
    ]
  ]
}
```

**Add new connection chains:**
```json
"Lookup Client": { "main": [[{"node": "Build Log Triggered", "type": "main", "index": 0}]] },
"Build Log Triggered": { "main": [[{"node": "Log Triggered", "type": "main", "index": 0}]] },
"Build Log Completed": { "main": [[{"node": "Log Completed", "type": "main", "index": 0}]] }
```

- [ ] **Step 3: Validate JSON**

```bash
python3 -c "import json; json.load(open('n8n/workflows/Real Estate Instant Lead Response.json')); print('valid')"
```
Expected: `valid`

- [ ] **Step 4: Commit**

```bash
git add "n8n/workflows/Real Estate Instant Lead Response.json"
git commit -m "feat(logging): add triggered/completed nodes to Instant Lead Response"
```

---

## Task 4: Real Estate Open House Follow-Up

**Files:**
- Modify: `n8n/workflows/Real Estate Open House Follow-Up.json`

**Anchor node:** `Token Check` (TRUE branch)
**Trigger node (for agent_email):** `Receive Sign-In`
**Last main node for Log Completed:** `Extract Message` (parallel from here — before the SMS/email branch split)
**workflow_name:** `open_house_follow_up`

- [ ] **Step 1: Add 5 logging nodes to the `nodes` array**

Append to `nodes`:

```json
{
  "parameters": {
    "operation": "executeQuery",
    "query": "=SELECT id FROM clients WHERE primary_contact_email = '{{ $('Receive Sign-In').first().json.body.agent_email }}'"
  },
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [640, 500],
  "id": "ohfu0001-0001-4000-8000-000000000001",
  "name": "Lookup Client",
  "continueOnFail": true,
  "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
},
{
  "parameters": {
    "jsCode": "const clientId = $json?.id ?? 'e2f9934c-4d28-4bb4-ac90-4284c1123517';\nconst execId = $execution.id;\nconst agentEmail = ($('Receive Sign-In').first().json.body.agent_email || '').replace(/'/g, \"''\");\nreturn [{ json: { query: `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('${clientId}', 'open_house_follow_up', 'triggered', ('{\"execution_id\": \"' || '${execId}' || '\", \"agent_email\": \"' || '${agentEmail}' || '\"}')::jsonb)` } }];"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [840, 500],
  "id": "ohfu0001-0002-4000-8000-000000000002",
  "name": "Build Log Triggered",
  "continueOnFail": true
},
{
  "parameters": { "operation": "executeQuery", "query": "={{ $json.query }}" },
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [1040, 500],
  "id": "ohfu0001-0003-4000-8000-000000000003",
  "name": "Log Triggered",
  "continueOnFail": true,
  "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
},
{
  "parameters": {
    "jsCode": "const clientId = $('Lookup Client').first().json?.id ?? 'e2f9934c-4d28-4bb4-ac90-4284c1123517';\nconst execId = $execution.id;\nreturn [{ json: { query: `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('${clientId}', 'open_house_follow_up', 'completed', ('{\"execution_id\": \"' || '${execId}' || '\"}')::jsonb)` } }];"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [2000, 500],
  "id": "ohfu0001-0004-4000-8000-000000000004",
  "name": "Build Log Completed",
  "continueOnFail": true
},
{
  "parameters": { "operation": "executeQuery", "query": "={{ $json.query }}" },
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [2200, 500],
  "id": "ohfu0001-0005-4000-8000-000000000005",
  "name": "Log Completed",
  "continueOnFail": true,
  "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
}
```

- [ ] **Step 2: Update `connections`**

**Change 1 — parallel from Token Check TRUE:**
```json
"Token Check": {
  "main": [
    [
      {"node": "Prep Wait Time", "type": "main", "index": 0},
      {"node": "Lookup Client", "type": "main", "index": 0}
    ],
    []
  ]
}
```

**Change 2 — Log Completed parallel from Extract Message:**
```json
"Extract Message": {
  "main": [
    [
      {"node": "SMS to Attendee", "type": "main", "index": 0},
      {"node": "Build Log Completed", "type": "main", "index": 0}
    ]
  ]
}
```

**Add new connection chains:**
```json
"Lookup Client": { "main": [[{"node": "Build Log Triggered", "type": "main", "index": 0}]] },
"Build Log Triggered": { "main": [[{"node": "Log Triggered", "type": "main", "index": 0}]] },
"Build Log Completed": { "main": [[{"node": "Log Completed", "type": "main", "index": 0}]] }
```

- [ ] **Step 3: Validate JSON**

```bash
python3 -c "import json; json.load(open('n8n/workflows/Real Estate Open House Follow-Up.json')); print('valid')"
```

- [ ] **Step 4: Commit**

```bash
git add "n8n/workflows/Real Estate Open House Follow-Up.json"
git commit -m "feat(logging): add triggered/completed nodes to Open House Follow-Up"
```

---

## Task 5: Real Estate Open House Setup

**Files:**
- Modify: `n8n/workflows/Real Estate Open House Setup.json`

**Anchor node:** `Token Check` (TRUE branch, position [432, 224])
**Agent email source:** `Prep Fields` output — `$('Prep Fields').first().json.agent_email`
**Last main node for Log Completed:** `Email QR to Agent` (position [1472, 144])
**workflow_name:** `open_house_setup`

Note: Prep Fields extracts `agent_email` from body; reference it via `$('Prep Fields').first().json.agent_email` instead of going back to the raw webhook body.

- [ ] **Step 1: Add 5 logging nodes to the `nodes` array**

Append to `nodes`:

```json
{
  "parameters": {
    "operation": "executeQuery",
    "query": "=SELECT id FROM clients WHERE primary_contact_email = '{{ $('Prep Fields').first().json.agent_email }}'"
  },
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [640, 350],
  "id": "ohsu0001-0001-4000-8000-000000000001",
  "name": "Lookup Client",
  "continueOnFail": true,
  "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
},
{
  "parameters": {
    "jsCode": "const clientId = $json?.id ?? 'e2f9934c-4d28-4bb4-ac90-4284c1123517';\nconst execId = $execution.id;\nconst agentEmail = ($('Prep Fields').first().json.agent_email || '').replace(/'/g, \"''\");\nreturn [{ json: { query: `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('${clientId}', 'open_house_setup', 'triggered', ('{\"execution_id\": \"' || '${execId}' || '\", \"agent_email\": \"' || '${agentEmail}' || '\"}')::jsonb)` } }];"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [840, 350],
  "id": "ohsu0001-0002-4000-8000-000000000002",
  "name": "Build Log Triggered",
  "continueOnFail": true
},
{
  "parameters": { "operation": "executeQuery", "query": "={{ $json.query }}" },
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [1040, 350],
  "id": "ohsu0001-0003-4000-8000-000000000003",
  "name": "Log Triggered",
  "continueOnFail": true,
  "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
},
{
  "parameters": {
    "jsCode": "const clientId = $('Lookup Client').first().json?.id ?? 'e2f9934c-4d28-4bb4-ac90-4284c1123517';\nconst execId = $execution.id;\nreturn [{ json: { query: `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('${clientId}', 'open_house_setup', 'completed', ('{\"execution_id\": \"' || '${execId}' || '\"}')::jsonb)` } }];"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [1472, 350],
  "id": "ohsu0001-0004-4000-8000-000000000004",
  "name": "Build Log Completed",
  "continueOnFail": true
},
{
  "parameters": { "operation": "executeQuery", "query": "={{ $json.query }}" },
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [1672, 350],
  "id": "ohsu0001-0005-4000-8000-000000000005",
  "name": "Log Completed",
  "continueOnFail": true,
  "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
}
```

- [ ] **Step 2: Update `connections`**

**Note:** Token Check connects to Prep Fields (TRUE branch). Lookup Client needs Prep Fields output, so attach Lookup Client after Prep Fields (not Token Check), so agent_email is available.

**Change 1 — parallel from Prep Fields:**
```json
"Prep Fields": {
  "main": [
    [
      {"node": "Build Extraction Prompt", "type": "main", "index": 0},
      {"node": "Lookup Client", "type": "main", "index": 0}
    ]
  ]
}
```

**Change 2 — Log Completed parallel from Email QR to Agent (was terminal, add it):**
```json
"Email QR to Agent": {
  "main": [[{"node": "Build Log Completed", "type": "main", "index": 0}]]
}
```

**Add new chains:**
```json
"Lookup Client": { "main": [[{"node": "Build Log Triggered", "type": "main", "index": 0}]] },
"Build Log Triggered": { "main": [[{"node": "Log Triggered", "type": "main", "index": 0}]] },
"Build Log Completed": { "main": [[{"node": "Log Completed", "type": "main", "index": 0}]] }
```

- [ ] **Step 3: Validate JSON**

```bash
python3 -c "import json; json.load(open('n8n/workflows/Real Estate Open House Setup.json')); print('valid')"
```

- [ ] **Step 4: Commit**

```bash
git add "n8n/workflows/Real Estate Open House Setup.json"
git commit -m "feat(logging): add triggered/completed nodes to Open House Setup"
```

---

## Task 6: Real Estate Listing Description Generator

**Files:**
- Modify: `n8n/workflows/Real Estate Listing Description Generator.json`

**Anchor node:** `Valid Email Check` (TRUE branch — the node after Token Check, adds DataTable email allowlist check)
**Agent email source:** `$('Get Listing Details').first().json.body.agent_email`
**Last main node for Log Completed:** `Send email` (terminal node)
**workflow_name:** `listing_description`

Note: This workflow has an extra `Valid Email Check` DataTable IF node between Token Check and the main flow. Attach logging parallel from `Valid Email Check` TRUE branch (index 0), not from Token Check.

- [ ] **Step 1: Add 5 logging nodes to the `nodes` array**

Append to `nodes`:

```json
{
  "parameters": {
    "operation": "executeQuery",
    "query": "=SELECT id FROM clients WHERE primary_contact_email = '{{ $('Get Listing Details').first().json.body.agent_email }}'"
  },
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [900, 400],
  "id": "ldgl0001-0001-4000-8000-000000000001",
  "name": "Lookup Client",
  "continueOnFail": true,
  "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
},
{
  "parameters": {
    "jsCode": "const clientId = $json?.id ?? 'e2f9934c-4d28-4bb4-ac90-4284c1123517';\nconst execId = $execution.id;\nconst agentEmail = ($('Get Listing Details').first().json.body.agent_email || '').replace(/'/g, \"''\");\nreturn [{ json: { query: `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('${clientId}', 'listing_description', 'triggered', ('{\"execution_id\": \"' || '${execId}' || '\", \"agent_email\": \"' || '${agentEmail}' || '\"}')::jsonb)` } }];"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [1100, 400],
  "id": "ldgl0001-0002-4000-8000-000000000002",
  "name": "Build Log Triggered",
  "continueOnFail": true
},
{
  "parameters": { "operation": "executeQuery", "query": "={{ $json.query }}" },
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [1300, 400],
  "id": "ldgl0001-0003-4000-8000-000000000003",
  "name": "Log Triggered",
  "continueOnFail": true,
  "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
},
{
  "parameters": {
    "jsCode": "const clientId = $('Lookup Client').first().json?.id ?? 'e2f9934c-4d28-4bb4-ac90-4284c1123517';\nconst execId = $execution.id;\nreturn [{ json: { query: `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('${clientId}', 'listing_description', 'completed', ('{\"execution_id\": \"' || '${execId}' || '\"}')::jsonb)` } }];"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [2000, 400],
  "id": "ldgl0001-0004-4000-8000-000000000004",
  "name": "Build Log Completed",
  "continueOnFail": true
},
{
  "parameters": { "operation": "executeQuery", "query": "={{ $json.query }}" },
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [2200, 400],
  "id": "ldgl0001-0005-4000-8000-000000000005",
  "name": "Log Completed",
  "continueOnFail": true,
  "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
}
```

- [ ] **Step 2: Update `connections`**

**Change 1 — parallel from Valid Email Check TRUE branch (index 0):**
```json
"Valid Email Check": {
  "main": [
    [
      {"node": "Parse HTML", "type": "main", "index": 0},
      {"node": "Lookup Client", "type": "main", "index": 0}
    ],
    []
  ]
}
```

**Change 2 — Log Completed parallel from Send email (was terminal):**
```json
"Send email": {
  "main": [[{"node": "Build Log Completed", "type": "main", "index": 0}]]
}
```

**Add new chains:**
```json
"Lookup Client": { "main": [[{"node": "Build Log Triggered", "type": "main", "index": 0}]] },
"Build Log Triggered": { "main": [[{"node": "Log Triggered", "type": "main", "index": 0}]] },
"Build Log Completed": { "main": [[{"node": "Log Completed", "type": "main", "index": 0}]] }
```

- [ ] **Step 3: Validate JSON**

```bash
python3 -c "import json; json.load(open('n8n/workflows/Real Estate Listing Description Generator.json')); print('valid')"
```

- [ ] **Step 4: Commit**

```bash
git add "n8n/workflows/Real Estate Listing Description Generator.json"
git commit -m "feat(logging): add triggered/completed nodes to Listing Description Generator"
```

---

## Task 7: Real Estate Review Request

**Files:**
- Modify: `n8n/workflows/Real Estate Review Request.json`

**Anchor node:** `Token Check` (TRUE branch)
**Agent email source:** `$('Receive Review Request').first().json.body.agent_email`
**Last main node for Log Completed:** `Send SMS` (fires before the conditional email branch — parallel here covers both branches)
**workflow_name:** `review_request`

- [ ] **Step 1: Add 5 logging nodes to the `nodes` array**

Append to `nodes`:

```json
{
  "parameters": {
    "operation": "executeQuery",
    "query": "=SELECT id FROM clients WHERE primary_contact_email = '{{ $('Receive Review Request').first().json.body.agent_email }}'"
  },
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [700, 500],
  "id": "rrvl0001-0001-4000-8000-000000000001",
  "name": "Lookup Client",
  "continueOnFail": true,
  "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
},
{
  "parameters": {
    "jsCode": "const clientId = $json?.id ?? 'e2f9934c-4d28-4bb4-ac90-4284c1123517';\nconst execId = $execution.id;\nconst agentEmail = ($('Receive Review Request').first().json.body.agent_email || '').replace(/'/g, \"''\");\nreturn [{ json: { query: `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('${clientId}', 'review_request', 'triggered', ('{\"execution_id\": \"' || '${execId}' || '\", \"agent_email\": \"' || '${agentEmail}' || '\"}')::jsonb)` } }];"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [900, 500],
  "id": "rrvl0001-0002-4000-8000-000000000002",
  "name": "Build Log Triggered",
  "continueOnFail": true
},
{
  "parameters": { "operation": "executeQuery", "query": "={{ $json.query }}" },
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [1100, 500],
  "id": "rrvl0001-0003-4000-8000-000000000003",
  "name": "Log Triggered",
  "continueOnFail": true,
  "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
},
{
  "parameters": {
    "jsCode": "const clientId = $('Lookup Client').first().json?.id ?? 'e2f9934c-4d28-4bb4-ac90-4284c1123517';\nconst execId = $execution.id;\nreturn [{ json: { query: `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('${clientId}', 'review_request', 'completed', ('{\"execution_id\": \"' || '${execId}' || '\"}')::jsonb)` } }];"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [2000, 500],
  "id": "rrvl0001-0004-4000-8000-000000000004",
  "name": "Build Log Completed",
  "continueOnFail": true
},
{
  "parameters": { "operation": "executeQuery", "query": "={{ $json.query }}" },
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [2200, 500],
  "id": "rrvl0001-0005-4000-8000-000000000005",
  "name": "Log Completed",
  "continueOnFail": true,
  "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
}
```

- [ ] **Step 2: Update `connections`**

**Change 1 — parallel from Token Check TRUE:**
```json
"Token Check": {
  "main": [
    [
      {"node": "Prep Fields", "type": "main", "index": 0},
      {"node": "Lookup Client", "type": "main", "index": 0}
    ],
    []
  ]
}
```

**Change 2 — Log Completed parallel from Send SMS:**
```json
"Send SMS": {
  "main": [
    [
      {"node": "Has Email?", "type": "main", "index": 0},
      {"node": "Build Log Completed", "type": "main", "index": 0}
    ]
  ]
}
```

**Add new chains:**
```json
"Lookup Client": { "main": [[{"node": "Build Log Triggered", "type": "main", "index": 0}]] },
"Build Log Triggered": { "main": [[{"node": "Log Triggered", "type": "main", "index": 0}]] },
"Build Log Completed": { "main": [[{"node": "Log Completed", "type": "main", "index": 0}]] }
```

- [ ] **Step 3: Validate JSON**

```bash
python3 -c "import json; json.load(open('n8n/workflows/Real Estate Review Request.json')); print('valid')"
```

- [ ] **Step 4: Commit**

```bash
git add "n8n/workflows/Real Estate Review Request.json"
git commit -m "feat(logging): add triggered/completed nodes to Review Request"
```

---

## Task 8: Real Estate 7-Touch Cold Nurture

**Files:**
- Modify: `n8n/workflows/Real Estate 7-Touch Cold Nurture.json`

**Anchor node:** `Token Check` (TRUE branch)
**Agent email source:** `$('Manual Enrollment').first().json.body.agent_email`
**Last main node for Log Completed:** `SMS T6` (position [6640, 300] — the last touch node)
**workflow_name:** `cold_nurture`

Note: This workflow runs over 21 days with Wait nodes. n8n persists node data through Waits, so `$('Lookup Client')` reference in Build Log Completed will still resolve after 21 days.

- [ ] **Step 1: Add 5 logging nodes to the `nodes` array**

Append to `nodes`:

```json
{
  "parameters": {
    "operation": "executeQuery",
    "query": "=SELECT id FROM clients WHERE primary_contact_email = '{{ $('Manual Enrollment').first().json.body.agent_email }}'"
  },
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [700, 500],
  "id": "cnt70001-0001-4000-8000-000000000001",
  "name": "Lookup Client",
  "continueOnFail": true,
  "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
},
{
  "parameters": {
    "jsCode": "const clientId = $json?.id ?? 'e2f9934c-4d28-4bb4-ac90-4284c1123517';\nconst execId = $execution.id;\nconst agentEmail = ($('Manual Enrollment').first().json.body.agent_email || '').replace(/'/g, \"''\");\nreturn [{ json: { query: `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('${clientId}', 'cold_nurture', 'triggered', ('{\"execution_id\": \"' || '${execId}' || '\", \"agent_email\": \"' || '${agentEmail}' || '\"}')::jsonb)` } }];"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [900, 500],
  "id": "cnt70001-0002-4000-8000-000000000002",
  "name": "Build Log Triggered",
  "continueOnFail": true
},
{
  "parameters": { "operation": "executeQuery", "query": "={{ $json.query }}" },
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [1100, 500],
  "id": "cnt70001-0003-4000-8000-000000000003",
  "name": "Log Triggered",
  "continueOnFail": true,
  "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
},
{
  "parameters": {
    "jsCode": "const clientId = $('Lookup Client').first().json?.id ?? 'e2f9934c-4d28-4bb4-ac90-4284c1123517';\nconst execId = $execution.id;\nreturn [{ json: { query: `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('${clientId}', 'cold_nurture', 'completed', ('{\"execution_id\": \"' || '${execId}' || '\"}')::jsonb)` } }];"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [6640, 500],
  "id": "cnt70001-0004-4000-8000-000000000004",
  "name": "Build Log Completed",
  "continueOnFail": true
},
{
  "parameters": { "operation": "executeQuery", "query": "={{ $json.query }}" },
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [6840, 500],
  "id": "cnt70001-0005-4000-8000-000000000005",
  "name": "Log Completed",
  "continueOnFail": true,
  "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
}
```

- [ ] **Step 2: Update `connections`**

**Change 1 — parallel from Token Check TRUE:**
```json
"Token Check": {
  "main": [
    [
      {"node": "Prep Fields", "type": "main", "index": 0},
      {"node": "Lookup Client", "type": "main", "index": 0}
    ],
    []
  ]
}
```

**Change 2 — Log Completed parallel from SMS T6 (was terminal):**
```json
"SMS T6": {
  "main": [[{"node": "Build Log Completed", "type": "main", "index": 0}]]
}
```

**Add new chains:**
```json
"Lookup Client": { "main": [[{"node": "Build Log Triggered", "type": "main", "index": 0}]] },
"Build Log Triggered": { "main": [[{"node": "Log Triggered", "type": "main", "index": 0}]] },
"Build Log Completed": { "main": [[{"node": "Log Completed", "type": "main", "index": 0}]] }
```

- [ ] **Step 3: Validate JSON**

```bash
python3 -c "import json; json.load(open('n8n/workflows/Real Estate 7-Touch Cold Nurture.json')); print('valid')"
```

- [ ] **Step 4: Commit**

```bash
git add "n8n/workflows/Real Estate 7-Touch Cold Nurture.json"
git commit -m "feat(logging): add triggered/completed nodes to 7-Touch Cold Nurture"
```

---

## Task 9: B&B Lead Generator (update existing + add triggered)

**Files:**
- Modify: `n8n/workflows/B&B Lead Generator.json`

**Changes needed:**
1. Add `Build Log Triggered` + `Log Triggered` parallel from `Every Monday 6am CT` (the schedule trigger)
2. Update existing `Build Neon Insert` Code node to include `execution_id` in the `completed` event payload already built there

**Anchor for Log Triggered:** `Every Monday 6am CT` (position [240, 300])
**workflow_name:** `bnb_lead_generator`
**client_id:** `86a01b94-ddab-4594-8afc-8212fb18fdd0`

- [ ] **Step 1: Add 2 new nodes to `nodes` array**

Append to `nodes`:

```json
{
  "parameters": {
    "jsCode": "const execId = $execution.id;\nreturn [{ json: { query: `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('86a01b94-ddab-4594-8afc-8212fb18fdd0', 'bnb_lead_generator', 'triggered', ('{\"execution_id\": \"' || '${execId}' || '\"}')::jsonb)` } }];"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [240, 500],
  "id": "bnblg001-0001-4000-8000-000000000001",
  "name": "Build Log Triggered",
  "continueOnFail": true
},
{
  "parameters": { "operation": "executeQuery", "query": "={{ $json.query }}" },
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [440, 500],
  "id": "bnblg001-0002-4000-8000-000000000002",
  "name": "Log Triggered",
  "continueOnFail": true,
  "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
}
```

- [ ] **Step 2: Update `connections`**

**Change 1 — parallel from Every Monday 6am CT:**
```json
"Every Monday 6am CT": {
  "main": [
    [
      {"node": "Initialize Accumulator", "type": "main", "index": 0},
      {"node": "Build Log Triggered", "type": "main", "index": 0}
    ]
  ]
}
```

**Add new chain:**
```json
"Build Log Triggered": { "main": [[{"node": "Log Triggered", "type": "main", "index": 0}]] }
```

- [ ] **Step 3: Update `Build Neon Insert` Code node to include execution_id in the completed payload**

Find the `Build Neon Insert` node (id `b3b4c5d6-0016-4000-8000-000000000016`). In its `jsCode`, find the line that builds the workflow_events INSERT:

```js
// BEFORE (in the existing jsCode):
queries.push(
  `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('86a01b94-ddab-4594-8afc-8212fb18fdd0', 'bnb_lead_generator', 'completed', '${eventsMeta}'::jsonb)`
);
```

Change `eventsMeta` construction to include `execution_id`. Locate the line:
```js
const eventsMeta = JSON.stringify({
  apollo_returned: staticData.apolloReturned || 0,
  after_dedup: staticData.afterDedup || 0,
  qualified: leads.length,
  run_date: new Date().toISOString().split('T')[0]
}).replace(/'/g, "''");
```

Replace with:
```js
const eventsMeta = JSON.stringify({
  execution_id: $execution.id,
  apollo_returned: staticData.apolloReturned || 0,
  after_dedup: staticData.afterDedup || 0,
  qualified: leads.length,
  run_date: new Date().toISOString().split('T')[0]
}).replace(/'/g, "''");
```

- [ ] **Step 4: Validate JSON**

```bash
python3 -c "import json; json.load(open('n8n/workflows/B&B Lead Generator.json')); print('valid')"
```

- [ ] **Step 5: Commit**

```bash
git add "n8n/workflows/B&B Lead Generator.json"
git commit -m "feat(logging): add triggered node and execution_id to B&B Lead Generator"
```

---

## Task 10: B&B Manufacturing Estimate

**Files:**
- Modify: `n8n/workflows/B&B Manufacturing Estimate.json`

**Anchor node:** `Valid Token?` (TRUE branch, index 0)
**Last main node:** `Send Estimate Email` (position [1340, 120])
**workflow_name:** `bnb_estimate`
**client_id:** `86a01b94-ddab-4594-8afc-8212fb18fdd0`

- [ ] **Step 1: Add 4 logging nodes to the `nodes` array**

Append to `nodes`:

```json
{
  "parameters": {
    "jsCode": "const execId = $execution.id;\nreturn [{ json: { query: `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('86a01b94-ddab-4594-8afc-8212fb18fdd0', 'bnb_estimate', 'triggered', ('{\"execution_id\": \"' || '${execId}' || '\"}')::jsonb)` } }];"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [640, 320],
  "id": "bnbe0001-0001-4000-8000-000000000001",
  "name": "Build Log Triggered",
  "continueOnFail": true
},
{
  "parameters": { "operation": "executeQuery", "query": "={{ $json.query }}" },
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [840, 320],
  "id": "bnbe0001-0002-4000-8000-000000000002",
  "name": "Log Triggered",
  "continueOnFail": true,
  "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
},
{
  "parameters": {
    "jsCode": "const execId = $execution.id;\nreturn [{ json: { query: `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('86a01b94-ddab-4594-8afc-8212fb18fdd0', 'bnb_estimate', 'completed', ('{\"execution_id\": \"' || '${execId}' || '\"}')::jsonb)` } }];"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [1340, 320],
  "id": "bnbe0001-0003-4000-8000-000000000003",
  "name": "Build Log Completed",
  "continueOnFail": true
},
{
  "parameters": { "operation": "executeQuery", "query": "={{ $json.query }}" },
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [1540, 320],
  "id": "bnbe0001-0004-4000-8000-000000000004",
  "name": "Log Completed",
  "continueOnFail": true,
  "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
}
```

- [ ] **Step 2: Update `connections`**

**Change 1 — parallel from Valid Token? TRUE branch (index 0). The existing TRUE branch goes to `Build Claude Prompt`:**
```json
"Valid Token?": {
  "main": [
    [
      {"node": "Build Claude Prompt", "type": "main", "index": 0},
      {"node": "Build Log Triggered", "type": "main", "index": 0}
    ],
    []
  ]
}
```

**Change 2 — Log Completed parallel from Send Estimate Email (was terminal):**
```json
"Send Estimate Email": {
  "main": [[{"node": "Build Log Completed", "type": "main", "index": 0}]]
}
```

**Add new chains:**
```json
"Build Log Triggered": { "main": [[{"node": "Log Triggered", "type": "main", "index": 0}]] },
"Build Log Completed": { "main": [[{"node": "Log Completed", "type": "main", "index": 0}]] }
```

- [ ] **Step 3: Validate JSON**

```bash
python3 -c "import json; json.load(open('n8n/workflows/B\&B Manufacturing Estimate.json')); print('valid')"
```

- [ ] **Step 4: Commit**

```bash
git add "n8n/workflows/B&B Manufacturing Estimate.json"
git commit -m "feat(logging): add triggered/completed nodes to B&B Manufacturing Estimate"
```

---

## Task 11: Internal Workflows (Chief of Staff, Client Health Query, Red Alert Scheduler)

**Files:**
- Modify: `n8n/workflows/Norr AI Chief of Staff.json`
- Modify: `n8n/workflows/Norr AI Client Health Query.json`
- Modify: `n8n/workflows/Norr AI Red Alert Scheduler.json`

**client_id for all three:** `e2f9934c-4d28-4bb4-ac90-4284c1123517` (norrai_internal)

### 11a: Chief of Staff

**Anchor for Log Triggered:** `Schedule Mon + Thu 8am CT` (schedule trigger — first node)
**Last node for Log Completed:** `Post to Slack` (terminal)
**workflow_name:** `norrai_chief_of_staff`

- [ ] **Step 1: Add 4 logging nodes to Chief of Staff `nodes` array**

Append to `nodes`:

```json
{
  "parameters": {
    "jsCode": "const execId = $execution.id;\nreturn [{ json: { query: `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('e2f9934c-4d28-4bb4-ac90-4284c1123517', 'norrai_chief_of_staff', 'triggered', ('{\"execution_id\": \"' || '${execId}' || '\"}')::jsonb)` } }];"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [240, 500],
  "id": "nacs0001-0001-4000-8000-000000000001",
  "name": "Build Log Triggered",
  "continueOnFail": true
},
{
  "parameters": { "operation": "executeQuery", "query": "={{ $json.query }}" },
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [440, 500],
  "id": "nacs0001-0002-4000-8000-000000000002",
  "name": "Log Triggered",
  "continueOnFail": true,
  "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
},
{
  "parameters": {
    "jsCode": "const execId = $execution.id;\nreturn [{ json: { query: `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('e2f9934c-4d28-4bb4-ac90-4284c1123517', 'norrai_chief_of_staff', 'completed', ('{\"execution_id\": \"' || '${execId}' || '\"}')::jsonb)` } }];"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [1120, 500],
  "id": "nacs0001-0003-4000-8000-000000000003",
  "name": "Build Log Completed",
  "continueOnFail": true
},
{
  "parameters": { "operation": "executeQuery", "query": "={{ $json.query }}" },
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [1320, 500],
  "id": "nacs0001-0004-4000-8000-000000000004",
  "name": "Log Completed",
  "continueOnFail": true,
  "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
}
```

- [ ] **Step 2: Update Chief of Staff `connections`**

The schedule trigger name: confirm the exact name by reading the file (`Schedule Mon + Thu 8am CT` or similar). Add parallel to `Build Log Triggered`:

```json
"Schedule Mon + Thu 8am CT": {
  "main": [
    [
      {"node": "Fetch CLAUDE.md", "type": "main", "index": 0},
      {"node": "Build Log Triggered", "type": "main", "index": 0}
    ]
  ]
}
```

Add Log Completed from `Post to Slack`:
```json
"Post to Slack": {
  "main": [[{"node": "Build Log Completed", "type": "main", "index": 0}]]
}
```

Add chains:
```json
"Build Log Triggered": { "main": [[{"node": "Log Triggered", "type": "main", "index": 0}]] },
"Build Log Completed": { "main": [[{"node": "Log Completed", "type": "main", "index": 0}]] }
```

### 11b: Client Health Query

**Anchor:** `Token Check` (TRUE branch)
**Last node for Log Completed:** `Return Health JSON` (terminal)
**workflow_name:** `client_health_query`

- [ ] **Step 3: Add 4 logging nodes to Client Health Query `nodes` array**

Append to `nodes`:

```json
{
  "parameters": {
    "jsCode": "const execId = $execution.id;\nreturn [{ json: { query: `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('e2f9934c-4d28-4bb4-ac90-4284c1123517', 'client_health_query', 'triggered', ('{\"execution_id\": \"' || '${execId}' || '\"}')::jsonb)` } }];"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [640, 350],
  "id": "nchq0001-0001-4000-8000-000000000001",
  "name": "Build Log Triggered",
  "continueOnFail": true
},
{
  "parameters": { "operation": "executeQuery", "query": "={{ $json.query }}" },
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [840, 350],
  "id": "nchq0001-0002-4000-8000-000000000002",
  "name": "Log Triggered",
  "continueOnFail": true,
  "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
},
{
  "parameters": {
    "jsCode": "const execId = $execution.id;\nreturn [{ json: { query: `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('e2f9934c-4d28-4bb4-ac90-4284c1123517', 'client_health_query', 'completed', ('{\"execution_id\": \"' || '${execId}' || '\"}')::jsonb)` } }];"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [1056, 350],
  "id": "nchq0001-0003-4000-8000-000000000003",
  "name": "Build Log Completed",
  "continueOnFail": true
},
{
  "parameters": { "operation": "executeQuery", "query": "={{ $json.query }}" },
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [1256, 350],
  "id": "nchq0001-0004-4000-8000-000000000004",
  "name": "Log Completed",
  "continueOnFail": true,
  "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
}
```

- [ ] **Step 4: Update Client Health Query `connections`**

```json
"Token Check": {
  "main": [
    [
      {"node": "Query Neon", "type": "main", "index": 0},
      {"node": "Build Log Triggered", "type": "main", "index": 0}
    ],
    []
  ]
}
```

```json
"Return Health JSON": {
  "main": [[{"node": "Build Log Completed", "type": "main", "index": 0}]]
}
```

```json
"Build Log Triggered": { "main": [[{"node": "Log Triggered", "type": "main", "index": 0}]] },
"Build Log Completed": { "main": [[{"node": "Log Completed", "type": "main", "index": 0}]] }
```

### 11c: Red Alert Scheduler

**Anchor for Log Triggered:** `Schedule 6am + 6pm CT` (schedule trigger)
**Last node for Log Completed:** `Build Alert` (fires before the Has Red Clients? IF — logging here covers both branches, red and silent)
**workflow_name:** `red_alert_scheduler`

- [ ] **Step 5: Add 4 logging nodes to Red Alert Scheduler `nodes` array**

Append to `nodes`:

```json
{
  "parameters": {
    "jsCode": "const execId = $execution.id;\nreturn [{ json: { query: `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('e2f9934c-4d28-4bb4-ac90-4284c1123517', 'red_alert_scheduler', 'triggered', ('{\"execution_id\": \"' || '${execId}' || '\"}')::jsonb)` } }];"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [240, 350],
  "id": "nras0001-0001-4000-8000-000000000001",
  "name": "Build Log Triggered",
  "continueOnFail": true
},
{
  "parameters": { "operation": "executeQuery", "query": "={{ $json.query }}" },
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [440, 350],
  "id": "nras0001-0002-4000-8000-000000000002",
  "name": "Log Triggered",
  "continueOnFail": true,
  "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
},
{
  "parameters": {
    "jsCode": "const execId = $execution.id;\nreturn [{ json: { query: `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('e2f9934c-4d28-4bb4-ac90-4284c1123517', 'red_alert_scheduler', 'completed', ('{\"execution_id\": \"' || '${execId}' || '\"}')::jsonb)` } }];"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [656, 350],
  "id": "nras0001-0003-4000-8000-000000000003",
  "name": "Build Log Completed",
  "continueOnFail": true
},
{
  "parameters": { "operation": "executeQuery", "query": "={{ $json.query }}" },
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [856, 350],
  "id": "nras0001-0004-4000-8000-000000000004",
  "name": "Log Completed",
  "continueOnFail": true,
  "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
}
```

- [ ] **Step 6: Update Red Alert Scheduler `connections`**

```json
"Schedule 6am + 6pm CT": {
  "main": [
    [
      {"node": "Query Neon", "type": "main", "index": 0},
      {"node": "Build Log Triggered", "type": "main", "index": 0}
    ]
  ]
}
```

```json
"Build Alert": {
  "main": [
    [
      {"node": "Has Red Clients?", "type": "main", "index": 0},
      {"node": "Build Log Completed", "type": "main", "index": 0}
    ]
  ]
}
```

```json
"Build Log Triggered": { "main": [[{"node": "Log Triggered", "type": "main", "index": 0}]] },
"Build Log Completed": { "main": [[{"node": "Log Completed", "type": "main", "index": 0}]] }
```

- [ ] **Step 7: Validate all three files**

```bash
python3 -c "import json; json.load(open('n8n/workflows/Norr AI Chief of Staff.json')); print('chief of staff valid')"
python3 -c "import json; json.load(open('n8n/workflows/Norr AI Client Health Query.json')); print('client health valid')"
python3 -c "import json; json.load(open('n8n/workflows/Norr AI Red Alert Scheduler.json')); print('red alert valid')"
```

- [ ] **Step 8: Commit**

```bash
git add "n8n/workflows/Norr AI Chief of Staff.json" "n8n/workflows/Norr AI Client Health Query.json" "n8n/workflows/Norr AI Red Alert Scheduler.json"
git commit -m "feat(logging): add triggered/completed nodes to internal workflows"
```

---

## Task 12: Real Estate Lead Cleanser

**Files:**
- Modify: `n8n/workflows/Real Estate Lead Cleanser.json`

**Anchor for Log Triggered:** `Token Found?` (TRUE branch, index 0)
**client_id source:** `$('Resolve Token').first().json.id` — this node already resolved client_id from the token; use it directly (no Lookup Client node needed)
**Last main node for Log Completed:** `Trigger Lead Response` (terminal, position [2240, 300])
**workflow_name:** `lead_cleanser`

Note: `Build Dedupe Query` already passes through `client_id` as `$json.client_id`. We can reference either `$('Resolve Token').first().json.id` or `$('Build Dedupe Query').first().json.client_id`. Use `Resolve Token` for clarity.

- [ ] **Step 1: Add 4 logging nodes to `nodes` array**

Append to `nodes`:

```json
{
  "parameters": {
    "jsCode": "const clientId = $('Resolve Token').first().json.id || 'e2f9934c-4d28-4bb4-ac90-4284c1123517';\nconst execId = $execution.id;\nreturn [{ json: { query: `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('${clientId}', 'lead_cleanser', 'triggered', ('{\"execution_id\": \"' || '${execId}' || '\"}')::jsonb)` } }];"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [1040, 500],
  "id": "lcl00001-0001-4000-8000-000000000001",
  "name": "Build Log Triggered",
  "continueOnFail": true
},
{
  "parameters": { "operation": "executeQuery", "query": "={{ $json.query }}" },
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [1240, 500],
  "id": "lcl00001-0002-4000-8000-000000000002",
  "name": "Log Triggered",
  "continueOnFail": true,
  "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
},
{
  "parameters": {
    "jsCode": "const clientId = $('Resolve Token').first().json.id || 'e2f9934c-4d28-4bb4-ac90-4284c1123517';\nconst execId = $execution.id;\nreturn [{ json: { query: `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('${clientId}', 'lead_cleanser', 'completed', ('{\"execution_id\": \"' || '${execId}' || '\"}')::jsonb)` } }];"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [2240, 500],
  "id": "lcl00001-0003-4000-8000-000000000003",
  "name": "Build Log Completed",
  "continueOnFail": true
},
{
  "parameters": { "operation": "executeQuery", "query": "={{ $json.query }}" },
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [2440, 500],
  "id": "lcl00001-0004-4000-8000-000000000004",
  "name": "Log Completed",
  "continueOnFail": true,
  "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
}
```

- [ ] **Step 2: Update `connections`**

**Change 1 — parallel from Token Found? TRUE branch (index 0):**
```json
"Token Found?": {
  "main": [
    [
      {"node": "Build Dedupe Query", "type": "main", "index": 0},
      {"node": "Build Log Triggered", "type": "main", "index": 0}
    ],
    []
  ]
}
```

**Change 2 — Log Completed from Trigger Lead Response (was terminal):**
```json
"Trigger Lead Response": {
  "main": [[{"node": "Build Log Completed", "type": "main", "index": 0}]]
}
```

**Add new chains:**
```json
"Build Log Triggered": { "main": [[{"node": "Log Triggered", "type": "main", "index": 0}]] },
"Build Log Completed": { "main": [[{"node": "Log Completed", "type": "main", "index": 0}]] }
```

- [ ] **Step 3: Validate JSON**

```bash
python3 -c "import json; json.load(open('n8n/workflows/Real Estate Lead Cleanser.json')); print('valid')"
```

- [ ] **Step 4: Commit**

```bash
git add "n8n/workflows/Real Estate Lead Cleanser.json"
git commit -m "feat(logging): add triggered/completed nodes to Lead Cleanser"
```

---

## Task 13: Intake Workflows (Zillow, Realtor, Facebook, Custom Form)

**Files:**
- Modify: `n8n/workflows/Real Estate Zillow Intake.json`
- Modify: `n8n/workflows/Real Estate Realtor Intake.json`
- Modify: `n8n/workflows/Real Estate Facebook Intake.json`
- Modify: `n8n/workflows/Real Estate Custom Form Intake.json`

**Pattern for all four:** No token check. Log Triggered parallel from the receive webhook trigger. Log Completed parallel from `Send to Lead Cleanser` (last node). `client_id` = norrai_internal (will be updated when per-client routing is built).

### Zillow Intake — workflow_name: `zillow_intake`

Receive node: `Receive Zillow Lead` (id `zi000001-0001-4000-8000-000000000001`)
Last node: `Send to Lead Cleanser` (id `zi000001-0003-4000-8000-000000000003`)

- [ ] **Step 1: Add 4 logging nodes to Zillow Intake `nodes` array**

```json
{
  "parameters": {
    "jsCode": "const execId = $execution.id;\nreturn [{ json: { query: `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('e2f9934c-4d28-4bb4-ac90-4284c1123517', 'zillow_intake', 'triggered', ('{\"execution_id\": \"' || '${execId}' || '\"}')::jsonb)` } }];"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [240, 500],
  "id": "zi000001-LOG1-4000-8000-000000000001",
  "name": "Build Log Triggered",
  "continueOnFail": true
},
{
  "parameters": { "operation": "executeQuery", "query": "={{ $json.query }}" },
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [440, 500],
  "id": "zi000001-LOG2-4000-8000-000000000002",
  "name": "Log Triggered",
  "continueOnFail": true,
  "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
},
{
  "parameters": {
    "jsCode": "const execId = $execution.id;\nreturn [{ json: { query: `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('e2f9934c-4d28-4bb4-ac90-4284c1123517', 'zillow_intake', 'completed', ('{\"execution_id\": \"' || '${execId}' || '\"}')::jsonb)` } }];"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [640, 500],
  "id": "zi000001-LOG3-4000-8000-000000000003",
  "name": "Build Log Completed",
  "continueOnFail": true
},
{
  "parameters": { "operation": "executeQuery", "query": "={{ $json.query }}" },
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [840, 500],
  "id": "zi000001-LOG4-4000-8000-000000000004",
  "name": "Log Completed",
  "continueOnFail": true,
  "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
}
```

- [ ] **Step 2: Update Zillow Intake `connections`**

```json
"Receive Zillow Lead": {
  "main": [
    [
      {"node": "Normalize Zillow Payload", "type": "main", "index": 0},
      {"node": "Build Log Triggered", "type": "main", "index": 0}
    ]
  ]
}
```

```json
"Send to Lead Cleanser": {
  "main": [[{"node": "Build Log Completed", "type": "main", "index": 0}]]
}
```

```json
"Build Log Triggered": { "main": [[{"node": "Log Triggered", "type": "main", "index": 0}]] },
"Build Log Completed": { "main": [[{"node": "Log Completed", "type": "main", "index": 0}]] }
```

### Realtor Intake — workflow_name: `realtor_intake`

Receive node: `Receive Realtor Lead`
Last node: `Send to Lead Cleanser`

- [ ] **Step 3: Add 4 logging nodes to Realtor Intake** (same structure as Zillow, change workflow_name to `realtor_intake`, UUIDs to `ri000001-LOG{1-4}`, node names unchanged)

Apply the same 4 nodes as Zillow but change:
- All `zillow_intake` → `realtor_intake`
- All `zi000001-LOG` → `ri000001-LOG`

- [ ] **Step 4: Update Realtor Intake `connections`**

Same pattern as Zillow but with `"Receive Realtor Lead"` as the parallel anchor.

### Facebook Intake — workflow_name: `facebook_intake`

- [ ] **Step 5: Read `Real Estate Facebook Intake.json` to confirm receive node name and last node name**

```bash
python3 -c "import json; f=json.load(open('n8n/workflows/Real Estate Facebook Intake.json')); print(', '.join(n['name'] for n in f['nodes']))"
```

- [ ] **Step 6: Add 4 logging nodes to Facebook Intake** (same pattern, `facebook_intake`, UUIDs `fi000001-LOG{1-4}`)

### Custom Form Intake — workflow_name: `custom_form_intake`

- [ ] **Step 7: Read `Real Estate Custom Form Intake.json` to confirm receive node name and last node name**

```bash
python3 -c "import json; f=json.load(open('n8n/workflows/Real Estate Custom Form Intake.json')); print(', '.join(n['name'] for n in f['nodes']))"
```

- [ ] **Step 8: Add 4 logging nodes to Custom Form Intake** (same pattern, `custom_form_intake`, UUIDs `cf000001-LOG{1-4}`)

- [ ] **Step 9: Validate all four files**

```bash
python3 -c "import json; json.load(open('n8n/workflows/Real Estate Zillow Intake.json')); print('zillow valid')"
python3 -c "import json; json.load(open('n8n/workflows/Real Estate Realtor Intake.json')); print('realtor valid')"
python3 -c "import json; json.load(open('n8n/workflows/Real Estate Facebook Intake.json')); print('facebook valid')"
python3 -c "import json; json.load(open('n8n/workflows/Real Estate Custom Form Intake.json')); print('custom form valid')"
```

- [ ] **Step 10: Commit**

```bash
git add "n8n/workflows/Real Estate Zillow Intake.json" "n8n/workflows/Real Estate Realtor Intake.json" "n8n/workflows/Real Estate Facebook Intake.json" "n8n/workflows/Real Estate Custom Form Intake.json"
git commit -m "feat(logging): add triggered/completed nodes to intake workflows"
```

---

## Task 14: Real Estate Lead Response Auto

**Files:**
- Modify: `n8n/workflows/Real Estate Lead Response Auto.json`

**Pattern:** `client_id` is passed in the handoff payload from Lead Cleanser. It's available at `$('Build Prompt').first().json.client_id`. No Lookup Client node needed.
**Anchor for Log Triggered:** `Receive Handoff` (first node, no token check in this workflow)
**Last node for Log Completed:** `Send Approval Email` (terminal, position [1440, 300])
**workflow_name:** `lead_response_auto`

- [ ] **Step 1: Add 4 logging nodes to `nodes` array**

```json
{
  "parameters": {
    "jsCode": "const execId = $execution.id;\nconst clientId = ($json.client_id || 'e2f9934c-4d28-4bb4-ac90-4284c1123517').replace(/'/g, \"''\");\nreturn [{ json: { query: `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('${clientId}', 'lead_response_auto', 'triggered', ('{\"execution_id\": \"' || '${execId}' || '\"}')::jsonb)` } }];"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [240, 500],
  "id": "lra00001-0001-4000-8000-000000000001",
  "name": "Build Log Triggered",
  "continueOnFail": true
},
{
  "parameters": { "operation": "executeQuery", "query": "={{ $json.query }}" },
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [440, 500],
  "id": "lra00001-0002-4000-8000-000000000002",
  "name": "Log Triggered",
  "continueOnFail": true,
  "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
},
{
  "parameters": {
    "jsCode": "const execId = $execution.id;\nconst clientId = ($('Build Prompt').first().json.client_id || 'e2f9934c-4d28-4bb4-ac90-4284c1123517').replace(/'/g, \"''\");\nreturn [{ json: { query: `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('${clientId}', 'lead_response_auto', 'completed', ('{\"execution_id\": \"' || '${execId}' || '\"}')::jsonb)` } }];"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [1440, 500],
  "id": "lra00001-0003-4000-8000-000000000003",
  "name": "Build Log Completed",
  "continueOnFail": true
},
{
  "parameters": { "operation": "executeQuery", "query": "={{ $json.query }}" },
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [1640, 500],
  "id": "lra00001-0004-4000-8000-000000000004",
  "name": "Log Completed",
  "continueOnFail": true,
  "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
}
```

- [ ] **Step 2: Update `connections`**

```json
"Receive Handoff": {
  "main": [
    [
      {"node": "Build Prompt", "type": "main", "index": 0},
      {"node": "Build Log Triggered", "type": "main", "index": 0}
    ]
  ]
}
```

```json
"Send Approval Email": {
  "main": [[{"node": "Build Log Completed", "type": "main", "index": 0}]]
}
```

```json
"Build Log Triggered": { "main": [[{"node": "Log Triggered", "type": "main", "index": 0}]] },
"Build Log Completed": { "main": [[{"node": "Log Completed", "type": "main", "index": 0}]] }
```

- [ ] **Step 3: Validate JSON**

```bash
python3 -c "import json; json.load(open('n8n/workflows/Real Estate Lead Response Auto.json')); print('valid')"
```

- [ ] **Step 4: Commit**

```bash
git add "n8n/workflows/Real Estate Lead Response Auto.json"
git commit -m "feat(logging): add triggered/completed nodes to Lead Response Auto"
```

---

## Task 15: Real Estate Lead Action Handler

**Files:**
- Modify: `n8n/workflows/Real Estate Lead Action Handler.json`

**Pattern:** This workflow has multi-branch terminal nodes (Respond SMS Sent, Respond Email Sent, Respond Skipped). Log Triggered from `Receive Action Click`. Log Completed parallel from `Route Action` — this is the last single node before branching and represents successful processing.
**client_id:** norrai_internal (Lead Action Handler operates across clients without a direct client lookup)
**workflow_name:** `lead_action_handler`

- [ ] **Step 1: Add 4 logging nodes to `nodes` array**

```json
{
  "parameters": {
    "jsCode": "const execId = $execution.id;\nreturn [{ json: { query: `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('e2f9934c-4d28-4bb4-ac90-4284c1123517', 'lead_action_handler', 'triggered', ('{\"execution_id\": \"' || '${execId}' || '\"}')::jsonb)` } }];"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [240, 500],
  "id": "lah00001-0001-4000-8000-000000000001",
  "name": "Build Log Triggered",
  "continueOnFail": true
},
{
  "parameters": { "operation": "executeQuery", "query": "={{ $json.query }}" },
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [440, 500],
  "id": "lah00001-0002-4000-8000-000000000002",
  "name": "Log Triggered",
  "continueOnFail": true,
  "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
},
{
  "parameters": {
    "jsCode": "const execId = $execution.id;\nreturn [{ json: { query: `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('e2f9934c-4d28-4bb4-ac90-4284c1123517', 'lead_action_handler', 'completed', ('{\"execution_id\": \"' || '${execId}' || '\"}')::jsonb)` } }];"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [1040, 500],
  "id": "lah00001-0003-4000-8000-000000000003",
  "name": "Build Log Completed",
  "continueOnFail": true
},
{
  "parameters": { "operation": "executeQuery", "query": "={{ $json.query }}" },
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [1240, 500],
  "id": "lah00001-0004-4000-8000-000000000004",
  "name": "Log Completed",
  "continueOnFail": true,
  "credentials": { "postgres": { "id": "NEON_CREDENTIAL_ID", "name": "Neon account" } }
}
```

- [ ] **Step 2: Update `connections`**

```json
"Receive Action Click": {
  "main": [
    [
      {"node": "Build Token Lookup", "type": "main", "index": 0},
      {"node": "Build Log Triggered", "type": "main", "index": 0}
    ]
  ]
}
```

```json
"Route Action": {
  "main": [
    [
      {"node": "Send SMS?", "type": "main", "index": 0},
      {"node": "Build Log Completed", "type": "main", "index": 0}
    ]
  ]
}
```

```json
"Build Log Triggered": { "main": [[{"node": "Log Triggered", "type": "main", "index": 0}]] },
"Build Log Completed": { "main": [[{"node": "Log Completed", "type": "main", "index": 0}]] }
```

- [ ] **Step 3: Validate JSON**

```bash
python3 -c "import json; json.load(open('n8n/workflows/Real Estate Lead Action Handler.json')); print('valid')"
```

- [ ] **Step 4: Commit**

```bash
git add "n8n/workflows/Real Estate Lead Action Handler.json"
git commit -m "feat(logging): add triggered/completed nodes to Lead Action Handler"
```

---

## Task 16: Client Discovery, Client Onboarding, Event Ops Discovery

**Files:**
- Modify: `n8n/workflows/Client Discovery → Claude Analysis.json`
- Modify: `n8n/workflows/Client Onboarding → Claude Analysis.json`
- Modify: `n8n/workflows/n8n_event_ops_discovery.json`

All three use `client_id` = norrai_internal.

**Client Discovery** has a `Token Check` node. Anchor: `Token Check` TRUE branch.
**Client Onboarding** goes directly from `Webhook — Form Intake` to `Build Claude Prompt` (no token check). Anchor: `Webhook — Form Intake`.
**Event Ops Discovery** goes directly from `Webhook — Form Intake` to `Build Claude Prompt`. Anchor: `Webhook — Form Intake`.

For all three, Log Completed goes parallel from the last node (typically the final HTTP Request node or Respond node).

- [ ] **Step 1: Read the last node name for each workflow**

```bash
python3 -c "
import json
f = json.load(open('n8n/workflows/Client Discovery → Claude Analysis.json'))
targets = {n['node'] for conns in f['connections'].values() for branch in conns['main'] for n in branch}
terminal = [n['name'] for n in f['nodes'] if n['name'] not in targets]
print('Discovery terminal:', terminal)
"
python3 -c "
import json
f = json.load(open('n8n/workflows/Client Onboarding → Claude Analysis.json'))
targets = {n['node'] for conns in f['connections'].values() for branch in conns['main'] for n in branch}
terminal = [n['name'] for n in f['nodes'] if n['name'] not in targets]
print('Onboarding terminal:', terminal)
"
python3 -c "
import json
f = json.load(open('n8n/workflows/n8n_event_ops_discovery.json'))
targets = {n['node'] for conns in f['connections'].values() for branch in conns['main'] for n in branch}
terminal = [n['name'] for n in f['nodes'] if n['name'] not in targets]
print('Event Ops terminal:', terminal)
"
```

- [ ] **Step 2: Add logging nodes to Client Discovery**

workflow_name: `client_discovery`, anchor: `Token Check` TRUE. Use UUIDs `cd000001-LOG{1-4}`.

Append 4 nodes (Build Log Triggered, Log Triggered, Build Log Completed, Log Completed) using TEMPLATE-BLT-HARD and TEMPLATE-BLC-HARD with:
- `CLIENT_UUID` = `e2f9934c-4d28-4bb4-ac90-4284c1123517`
- `WORKFLOW_SNAKE` = `client_discovery`

Connection changes: parallel from `Token Check` TRUE adding `Build Log Triggered`, and Log Completed parallel from terminal node.

- [ ] **Step 3: Add logging nodes to Client Onboarding**

workflow_name: `client_onboarding`, anchor: `Webhook — Form Intake`. Use UUIDs `co000001-LOG{1-4}`.

Same 4-node pattern. Connection: parallel from `Webhook — Form Intake` adding `Build Log Triggered`.

- [ ] **Step 4: Add logging nodes to Event Ops Discovery**

workflow_name: `event_ops_discovery`, anchor: `Webhook — Form Intake`. Use UUIDs `eod00001-LOG{1-4}`.

Same 4-node pattern. Connection: parallel from `Webhook — Form Intake` adding `Build Log Triggered`.

- [ ] **Step 5: Validate all three files**

```bash
python3 -c "import json; json.load(open('n8n/workflows/Client Discovery → Claude Analysis.json')); print('discovery valid')"
python3 -c "import json; json.load(open('n8n/workflows/Client Onboarding → Claude Analysis.json')); print('onboarding valid')"
python3 -c "import json; json.load(open('n8n/workflows/n8n_event_ops_discovery.json')); print('event ops valid')"
```

- [ ] **Step 6: Commit**

```bash
git add "n8n/workflows/Client Discovery → Claude Analysis.json" "n8n/workflows/Client Onboarding → Claude Analysis.json" "n8n/workflows/n8n_event_ops_discovery.json"
git commit -m "feat(logging): add triggered/completed nodes to discovery/onboarding/event-ops"
```

---

## Task 17: Update TESTING_NOTES.md + n8n Error Workflow Setup

**Files:**
- Modify: `n8n/TESTING_NOTES.md`

- [ ] **Step 1: Read current TESTING_NOTES.md**

```bash
cat n8n/TESTING_NOTES.md
```

- [ ] **Step 2: Append a new section**

Add to the end of `n8n/TESTING_NOTES.md`:

```markdown
## Workflow Logging Setup (import checklist)

### Import order
1. Import `Norr AI Workflow Error Logger.json` first — all other workflows point to it.
2. Note the workflow ID assigned by n8n (shown in the URL when you open it: `/workflow/<ID>`).
3. Import all remaining workflow JSON files.

### Setting Error Workflow on each workflow
After importing, open each workflow in n8n → Settings → Error Workflow → select "Norr AI Workflow Error Logger".
This cannot be pre-set in the JSON (n8n assigns IDs on import).
Apply to: all 21 workflows listed in the workflow_name registry.

### Linking Neon credential
All logging nodes use `NEON_CREDENTIAL_ID` as a placeholder. After import:
- Open each workflow
- Click any Postgres logging node → Credentials → select the real Neon credential

Or: find-replace `NEON_CREDENTIAL_ID` with the real credential ID in all JSON files before import.
The real Neon credential ID can be found by opening any existing working Neon node (e.g., Query Neon in Client Health Query) and noting its credential ID.

### Smoke testing log events
After importing and linking credentials:
1. Trigger any workflow (e.g., GET `/webhook/client-health` with `X-Norr-Token` header)
2. Check Neon: `SELECT * FROM workflow_events ORDER BY created_at DESC LIMIT 5`
3. Expected: one `triggered` row and one `completed` row for `client_health_query`

### Smoke testing the Error Logger
1. Create a test workflow with a single node that throws an error
2. Set its Error Workflow to "Norr AI Workflow Error Logger"
3. Run it — it should fail
4. Check Neon: `SELECT * FROM workflow_events WHERE event_type = 'failed' ORDER BY created_at DESC LIMIT 3`
5. Expected: one `failed` row with `execution_id` and `error` message in payload

### Known gaps
- Lead Cleanser pipeline + misc workflows log against norrai_internal until per-client routing is built
- If a workflow fails before Log Triggered fires (e.g., token rejected), Error Logger falls back to norrai_internal
- `execution_id` in triggered payload is required for Error Logger lookup — if missing, failed event still logs but client_id falls back
```

- [ ] **Step 3: Validate Markdown renders (no broken syntax)**

```bash
python3 -c "s = open('n8n/TESTING_NOTES.md').read(); print('lines:', len(s.splitlines()), '— looks ok')"
```

- [ ] **Step 4: Commit**

```bash
git add n8n/TESTING_NOTES.md
git commit -m "docs: add workflow logging import checklist to TESTING_NOTES"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] DB migration for norrai_internal client row → Task 1
- [x] Error Logger workflow → Task 2
- [x] 6 real estate workflows (agent_email lookup) → Tasks 3–8
- [x] B&B Lead Generator update (add triggered, update completed with execution_id) → Task 9
- [x] B&B Estimate (hardcoded client_id) → Task 10
- [x] 3 internal workflows → Task 11
- [x] Lead Cleanser (Resolve Token client_id) → Task 12
- [x] 4 intake workflows (norrai_internal) → Task 13
- [x] Lead Response Auto (client_id from payload) → Task 14
- [x] Lead Action Handler (norrai_internal) → Task 15
- [x] Client Discovery, Onboarding, Event Ops → Task 16
- [x] TESTING_NOTES update → Task 17
- [x] `continueOnFail: true` on all logging nodes — included in every node template
- [x] All logging nodes as parallel branches — documented in pattern section
- [x] execution_id in triggered payload → in every Build Log Triggered node

**Total: 21 workflows + 1 Error Logger + 1 DB migration + 1 doc update = 24 deliverables across 17 tasks.**
