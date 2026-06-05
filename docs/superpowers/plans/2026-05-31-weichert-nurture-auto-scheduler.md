# Weichert Nurture Auto-Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Monday morning workflow that auto-enrolls eligible Weichert leads into the 7-Touch Cold Nurture sequence and sends agents an FYI digest with a Remove option.

**Architecture:** Single n8n cron workflow scoped to Weichert client IDs. Queries eligible leads (same criteria as Nurture Prompt Scheduler), flattens metadata in a Code node, runs a Postgres UPDATE + HTTP POST per lead to enroll, then groups by agent and sends one FYI email per agent with Remove from Nurture buttons pointing at the existing de-enroll confirm webhook.

**Tech Stack:** n8n Cloud, Neon Postgres, SendGrid (HTTP via header auth), existing `/webhook/nurture-enroll` and `/webhook/nurture-deenroll-confirm` endpoints.

---

## Reference

**Weichert client UUIDs (from Neon):**
- Evan Knutson: `ded234e3-1c78-45c3-8924-6036e1fcaf60`
- Michelle Jasinski: `451306d1-6437-42b8-8ffe-c16f28803490`

**Credential IDs (n8n):**
- Neon Postgres: `id: "2DDeKGMIP9Ijbd9R"`, name: `"Postgres account"`
- SendGrid header auth: `id: "d2B1Q0ceGNVDwjqs"`, name: `"Header Auth account"`
- n8n project: `dHMe2aoOwTztDaWE`
- Error Logger workflow ID: `Al6gagYmiq1feOWq`
- norrai_internal client_id: `e2f9934c-4d28-4bb4-ac90-4284c1123517`

**Files:**
- Create: `n8n/workflows/Weichert Nurture Auto-Scheduler.json`
- Modify: `n8n/workflows/Norr AI Workflow Error Logger.json` (WORKFLOW_NAME_MAP)
- Modify: `CLAUDE.md` (workflow registry table)

---

## Task 1: Write workflow JSON

- [ ] **Create `n8n/workflows/Weichert Nurture Auto-Scheduler.json` with the following content:**

```json
{
  "name": "Weichert Nurture Auto-Scheduler",
  "nodes": [
    {
      "parameters": {
        "rule": {
          "interval": [{ "field": "cronExpression", "expression": "0 13 * * 1" }]
        }
      },
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1.2,
      "position": [-1040, 96],
      "id": "wnas-001-schedule",
      "name": "Schedule Monday 8am CT"
    },
    {
      "parameters": {
        "operation": "executeQuery",
        "query": "INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('e2f9934c-4d28-4bb4-ac90-4284c1123517'::uuid, 'weichert_nurture_auto_scheduler', 'triggered', json_build_object('execution_id', '{{ $execution.id }}')::jsonb)",
        "options": {}
      },
      "onError": "continueRegularOutput",
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2.5,
      "position": [-832, 96],
      "id": "wnas-002-log-triggered",
      "name": "Log Triggered",
      "continueOnFail": true,
      "credentials": { "postgres": { "id": "2DDeKGMIP9Ijbd9R", "name": "Postgres account" } }
    },
    {
      "parameters": {
        "operation": "executeQuery",
        "query": "SELECT l.id, l.lead_name, l.email, l.phone, l.source, l.metadata, l.lead_message, l.nurture_enrolled_at, c.id AS client_id, c.primary_contact_email AS agent_email, c.primary_contact_name AS agent_name, c.primary_contact_phone AS agent_phone, c.business_name FROM leads l JOIN clients c ON l.client_id = c.id WHERE l.nurture_enrolled_at IS NULL AND l.status NOT IN ('converted', 'unenrolled', 'dead') AND c.status = 'active' AND l.created_at <= now() - INTERVAL '7 days' AND c.id IN ('ded234e3-1c78-45c3-8924-6036e1fcaf60'::uuid, '451306d1-6437-42b8-8ffe-c16f28803490'::uuid) ORDER BY c.id, l.created_at",
        "options": {}
      },
      "onError": "continueRegularOutput",
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2.5,
      "position": [-624, 96],
      "id": "wnas-003-query-leads",
      "name": "Query Eligible Leads",
      "continueOnFail": true,
      "credentials": { "postgres": { "id": "2DDeKGMIP9Ijbd9R", "name": "Postgres account" } }
    },
    {
      "parameters": {
        "conditions": {
          "options": { "caseSensitive": true, "leftValue": "", "typeValidation": "loose", "version": 3 },
          "conditions": [{
            "id": "wnas-has-leads-001",
            "leftValue": "={{ $json.id }}",
            "operator": { "type": "string", "operation": "notEmpty", "singleValue": true }
          }],
          "combinator": "and"
        },
        "looseTypeValidation": true,
        "options": {}
      },
      "type": "n8n-nodes-base.if",
      "typeVersion": 2.3,
      "position": [-416, 96],
      "id": "wnas-004-has-leads",
      "name": "Has Eligible Leads?"
    },
    {
      "parameters": {
        "jsCode": "return $input.all().map(item => {\n  const body = item.json;\n  const meta = (typeof body.metadata === 'string' ? JSON.parse(body.metadata || '{}') : body.metadata) || {};\n  return {\n    json: {\n      id: body.id,\n      client_id: body.client_id,\n      lead_name: body.lead_name || '',\n      email: body.email || '',\n      phone: body.phone || '',\n      source: body.source || '',\n      lead_message: body.lead_message || '',\n      property_address: meta.property_address || '',\n      price_range: meta.price_range || '',\n      beds: meta.beds !== null && meta.beds !== undefined ? String(meta.beds) : '',\n      baths: meta.baths !== null && meta.baths !== undefined ? String(meta.baths) : '',\n      agent_name: body.agent_name || '',\n      agent_email: body.agent_email || '',\n      agent_phone: body.agent_phone || '',\n      business_name: body.business_name || ''\n    }\n  };\n});"
      },
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [-208, 96],
      "id": "wnas-005-prep-fields",
      "name": "Prep Fields"
    },
    {
      "parameters": {
        "operation": "executeQuery",
        "query": "UPDATE leads SET status = 'nurturing', nurture_enrolled_at = now(), updated_at = now() WHERE id = '{{ $json.id }}' RETURNING id",
        "options": {}
      },
      "onError": "continueRegularOutput",
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2.5,
      "position": [0, 96],
      "id": "wnas-006-set-nurturing",
      "name": "Set Status Nurturing",
      "continueOnFail": true,
      "credentials": { "postgres": { "id": "2DDeKGMIP9Ijbd9R", "name": "Postgres account" } }
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://norrai.app.n8n.cloud/webhook/nurture-enroll",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "x-norr-token", "value": "8F68D963-7060-4033-BD04-7593E4B203CB" },
            { "name": "content-type", "value": "application/json" }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={{ { lead_name: $('Prep Fields').item.json.lead_name, email: $('Prep Fields').item.json.email, phone: $('Prep Fields').item.json.phone, source: $('Prep Fields').item.json.source, lead_message: $('Prep Fields').item.json.lead_message, property_address: $('Prep Fields').item.json.property_address, price_range: $('Prep Fields').item.json.price_range, beds: $('Prep Fields').item.json.beds, baths: $('Prep Fields').item.json.baths, agent_name: $('Prep Fields').item.json.agent_name, agent_email: $('Prep Fields').item.json.agent_email, agent_phone: $('Prep Fields').item.json.agent_phone } }}",
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.4,
      "position": [208, 96],
      "id": "wnas-007-fire-nurture",
      "name": "Fire Nurture Sequence",
      "continueOnFail": true
    },
    {
      "parameters": {
        "jsCode": "const leads = $('Prep Fields').all().map(i => i.json);\n\nif (!leads.length) return [{ json: { has_leads: false } }];\n\nconst DEENROLL_BASE = 'https://norrai.app.n8n.cloud/webhook/nurture-deenroll-confirm';\nconst TOKEN = '8F68D963-7060-4033-BD04-7593E4B203CB';\n\nconst agents = {};\nfor (const lead of leads) {\n  const key = lead.agent_email;\n  if (!agents[key]) {\n    agents[key] = { agent_email: lead.agent_email, agent_name: lead.agent_name || '', leads: [] };\n  }\n  agents[key].leads.push(lead);\n}\n\nconst results = [];\nfor (const data of Object.values(agents)) {\n  const { agent_email, agent_name, leads: agentLeads } = data;\n  const first_name = agent_name.split(' ')[0] || 'there';\n  const n = agentLeads.length;\n  const today = new Date().toLocaleDateString('en-US', {\n    timeZone: 'America/Chicago', month: 'long', day: 'numeric', year: 'numeric'\n  });\n\n  const lead_blocks = agentLeads.map(lead => {\n    const parts = [`Source: ${lead.source || 'unknown'}`];\n    if (lead.property_address) parts.push(lead.property_address);\n    if (lead.price_range) parts.push(lead.price_range);\n    if (lead.beds) parts.push(`${lead.beds}bd`);\n    const details = parts.join(' &middot; ');\n    const remove_url = `${DEENROLL_BASE}?lead_id=${lead.id}&token=${TOKEN}`;\n    const name_escaped = (lead.lead_name || 'Unknown Lead').replace(/[<>&\"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','\"':'&quot;'}[c]));\n    return `<tr><td style=\"padding:20px 0;border-top:1px solid #E5E4DE;\"><p style=\"margin:0 0 4px;font-size:16px;font-weight:600;color:#0A0F1A;font-family:'Inter',sans-serif;\">${name_escaped}</p><p style=\"margin:0 0 14px;font-size:13px;color:#9EA3AA;font-family:'Inter',sans-serif;\">${details}</p><a href=\"${remove_url}\" style=\"display:inline-block;background:#B91C1C;color:#FFFFFF;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:600;font-family:'Inter',sans-serif;\">Remove from Nurture</a></td></tr>`;\n  }).join('');\n\n  const html_body = `<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"></head><body style=\"font-family:'Inter',sans-serif;background:#FAFAF7;margin:0;padding:0;\"><div style=\"max-width:540px;margin:0 auto;padding:40px 24px;\"><p style=\"font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#9EA3AA;margin:0 0 24px;\">Norr AI</p><h2 style=\"font-size:22px;font-weight:700;color:#0A0F1A;margin:0 0 8px;letter-spacing:-0.02em;\">Hi ${first_name},</h2><p style=\"font-size:15px;color:#3A3F48;margin:0 0 28px;line-height:1.6;\">We automatically added these leads to your cold nurture sequence this morning. Their first email goes out tomorrow \\u2014 if you're already working with one of them, click Remove before it sends.</p><table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"border-collapse:collapse;\">${lead_blocks}</table><p style=\"font-size:13px;color:#9EA3AA;margin:32px 0 0;line-height:1.6;\">Removed leads won't receive any further follow-ups. Leads you don't remove will receive touches over the next 21 days.</p><p style=\"font-size:13px;color:#9EA3AA;margin:16px 0 0;\">\\u2014 Norr AI</p></div></body></html>`;\n\n  results.push({ json: {\n    has_leads: true,\n    to_email: agent_email,\n    subject: `Nurture auto-started \\u2014 ${n} lead${n > 1 ? 's' : ''} enrolled \\u2014 ${today}`,\n    html_body,\n    lead_count: n,\n    agent_name\n  }});\n}\n\nreturn results;"
      },
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [416, 96],
      "id": "wnas-008-group-by-agent",
      "name": "Group by Agent"
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://api.sendgrid.com/v3/mail/send",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [{ "name": "Content-Type", "value": "application/json" }]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={{ { personalizations: [{ to: [{ email: $json.to_email }], subject: $json.subject }], from: { email: 'hello@norrai.co', name: 'Norr AI' }, content: [{ type: 'text/html', value: $json.html_body }], tracking_settings: { click_tracking: { enable: false } } } }}",
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.4,
      "position": [624, 96],
      "id": "wnas-009-send-email",
      "name": "Send FYI Email",
      "credentials": { "httpHeaderAuth": { "id": "d2B1Q0ceGNVDwjqs", "name": "Header Auth account" } }
    },
    {
      "parameters": {
        "operation": "executeQuery",
        "query": "INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('e2f9934c-4d28-4bb4-ac90-4284c1123517'::uuid, 'weichert_nurture_auto_scheduler', 'completed', json_build_object('lead_count', {{ $json.lead_count }}, 'agent_email', '{{ $json.to_email }}')::jsonb)",
        "options": {}
      },
      "onError": "continueRegularOutput",
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2.5,
      "position": [832, 96],
      "id": "wnas-010-log-completed",
      "name": "Log Completed",
      "continueOnFail": true,
      "credentials": { "postgres": { "id": "2DDeKGMIP9Ijbd9R", "name": "Postgres account" } }
    }
  ],
  "pinData": {},
  "connections": {
    "Schedule Monday 8am CT": { "main": [[{ "node": "Log Triggered", "type": "main", "index": 0 }]] },
    "Log Triggered": { "main": [[{ "node": "Query Eligible Leads", "type": "main", "index": 0 }]] },
    "Query Eligible Leads": { "main": [[{ "node": "Has Eligible Leads?", "type": "main", "index": 0 }]] },
    "Has Eligible Leads?": {
      "main": [
        [{ "node": "Prep Fields", "type": "main", "index": 0 }],
        []
      ]
    },
    "Prep Fields": { "main": [[{ "node": "Set Status Nurturing", "type": "main", "index": 0 }]] },
    "Set Status Nurturing": { "main": [[{ "node": "Fire Nurture Sequence", "type": "main", "index": 0 }]] },
    "Fire Nurture Sequence": { "main": [[{ "node": "Group by Agent", "type": "main", "index": 0 }]] },
    "Group by Agent": { "main": [[{ "node": "Send FYI Email", "type": "main", "index": 0 }]] },
    "Send FYI Email": { "main": [[{ "node": "Log Completed", "type": "main", "index": 0 }]] }
  },
  "active": false,
  "settings": {
    "executionOrder": "v1",
    "errorWorkflow": "Al6gagYmiq1feOWq"
  },
  "versionId": "weichert-nurture-auto-scheduler-v1-001",
  "meta": {
    "instanceId": "0d4efb408d47ca7fe5f9bfa9b6b5b1a6e6f8fcb31cb2584a172b735d47653914"
  },
  "id": "",
  "tags": [{ "updatedAt": "2026-05-01T01:39:33.838Z", "createdAt": "2026-05-01T01:39:33.838Z", "id": "hF4YeAdcnZuVMhqJ", "name": "real estate" }]
}
```

- [ ] **Verify file saved:** `ls n8n/workflows/ | grep Weichert`
  Expected: `Weichert Nurture Auto-Scheduler.json`

---

## Task 2: Update Error Logger WORKFLOW_NAME_MAP

- [ ] **In `n8n/workflows/Norr AI Workflow Error Logger.json`, find the line:**
  ```
  'Nurture De-Enroll Confirm': 'nurture_deenroll_confirm'
  ```
  Add after it:
  ```
  'Weichert Nurture Auto-Scheduler': 'weichert_nurture_auto_scheduler',
  ```

- [ ] **Verify the map entry is present:**
  ```bash
  grep "weichert_nurture_auto_scheduler" "n8n/workflows/Norr AI Workflow Error Logger.json"
  ```
  Expected: one matching line.

---

## Task 3: Update CLAUDE.md workflow registry

- [ ] **In `CLAUDE.md`, find the workflow registry table. Add this row after the `Nurture De-Enroll Confirm` entry:**

  ```
  | Weichert Nurture Auto-Scheduler | `weichert_nurture_auto_scheduler` |
  ```

- [ ] **Verify:**
  ```bash
  grep "weichert_nurture_auto_scheduler" CLAUDE.md
  ```
  Expected: one matching line.

---

## Task 4: Commit local changes

- [ ] **Stage and commit:**
  ```bash
  git add "n8n/workflows/Weichert Nurture Auto-Scheduler.json" \
          "n8n/workflows/Norr AI Workflow Error Logger.json" \
          CLAUDE.md
  git commit -m "feat: Weichert nurture auto-scheduler workflow + registry updates"
  ```

---

## Task 5: Import workflow to n8n

- [ ] **Create the workflow via MCP** (use `mcp__n8n-mcp__n8n_create_workflow`):
  - Copy nodes, connections, and settings from the JSON written in Task 1
  - Include `projectId: "dHMe2aoOwTztDaWE"`
  - Include `settings.errorWorkflow: "Al6gagYmiq1feOWq"`

- [ ] **Note the workflow ID** returned in the response — you'll need it to activate.

- [ ] **Update Error Logger in n8n** to add the new WORKFLOW_NAME_MAP entry. Use `mcp__n8n-mcp__n8n_update_partial_workflow` on the Error Logger workflow (ID: `Al6gagYmiq1feOWq`):
  - `patchNodeField` on node `"Extract Error Data"`, fieldPath `"parameters.jsCode"`
  - Find: `'Nurture De-Enroll Confirm': 'nurture_deenroll_confirm'`
  - Replace: `'Nurture De-Enroll Confirm': 'nurture_deenroll_confirm',\n  'Weichert Nurture Auto-Scheduler': 'weichert_nurture_auto_scheduler'`

---

## Task 6: Smoke test

- [ ] **Set up a test lead in Neon.** Insert a lead belonging to Evan's client that is eligible (no `nurture_enrolled_at`, old enough, status not excluded):

  ```sql
  INSERT INTO leads (client_id, lead_name, email, phone, source, status, created_at, updated_at)
  VALUES (
    'ded234e3-1c78-45c3-8924-6036e1fcaf60',
    'Smoke Test Lead',
    'egachuu+smoketest@gmail.com',
    '5075550000',
    'test',
    'new',
    now() - INTERVAL '8 days',
    now()
  )
  RETURNING id;
  ```

  Save the returned UUID — you'll need it for cleanup.

- [ ] **Manually trigger the workflow** in n8n (open it → Test → Execute workflow).

- [ ] **Verify — FYI email arrives** at `eknutson@teamyellownow.com` with:
  - Subject contains "Nurture auto-started"
  - Smoke Test Lead row visible
  - Red "Remove from Nurture" button present

- [ ] **Verify — Neon lead updated:**
  ```sql
  SELECT id, status, nurture_enrolled_at
  FROM leads
  WHERE email = 'egachuu+smoketest@gmail.com';
  ```
  Expected: `status = 'nurturing'`, `nurture_enrolled_at` is set.

- [ ] **Verify — 7-Touch workflow fired:** Check n8n executions — `Real Estate 7-Touch Cold Nurture` should show a new execution for the test lead.

- [ ] **Verify — workflow_events logged:**
  ```sql
  SELECT event_type, payload FROM workflow_events
  WHERE workflow_name = 'weichert_nurture_auto_scheduler'
  ORDER BY fired_at DESC LIMIT 5;
  ```
  Expected: `triggered` and `completed` rows.

- [ ] **Verify — no eligible leads path:** Reset another test, check that if no leads exist the false branch exits cleanly (no email, no error).

- [ ] **Test idempotency:** Re-trigger the workflow — the smoke test lead now has `nurture_enrolled_at` set, so it should NOT appear again.

- [ ] **Clean up test lead:**
  ```sql
  DELETE FROM leads WHERE email = 'egachuu+smoketest@gmail.com';
  ```

- [ ] **Activate the workflow** in n8n.

- [ ] **Commit any adjustments made during smoke testing.**
