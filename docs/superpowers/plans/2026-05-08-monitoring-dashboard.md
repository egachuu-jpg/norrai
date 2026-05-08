# NorrAI Client Health Monitoring Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an internal ops dashboard at `/internal/dashboard.html` showing red/yellow/green health per active client, powered by n8n querying Neon, with Slack alerts at 6am and 6pm CT for red clients.

**Architecture:** Two n8n workflows (a GET webhook that queries Neon and returns health JSON; a scheduled job at 6am/6pm CT that runs the same query and posts to Slack if any client is red). A static HTML page fetches from the webhook on load and on Refresh click, rendering a Polar Modern client card grid.

**Tech Stack:** n8n Cloud, Neon Postgres, Slack Incoming Webhook, Playwright (tests), HTML/CSS/JS (Polar Modern design system)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `n8n/workflows/Norr AI Client Health Query.json` | Create | GET webhook → Token Check → Postgres query → Health logic Code → Respond to Webhook |
| `n8n/workflows/Norr AI Red Alert Scheduler.json` | Create | Cron (6am + 6pm CT) → Postgres query → Health + filter Code → IF has red → Post to Slack |
| `website/internal/dashboard.html` | Create | Fetches health webhook on load, renders client card grid, handles loading/error/refresh |
| `tests/dashboard.spec.js` | Create | Playwright tests: page load, card rendering, status order, error state, refresh behavior, token header |

---

### Task 1: Health Query n8n Workflow

**Files:**
- Create: `n8n/workflows/Norr AI Client Health Query.json`

**Background:** GET webhook at `/webhook/client-health`. Checks `X-Norr-Token` header, queries Neon with an aggregation query, applies health logic in a Code node, returns the result JSON via a Respond to Webhook node.

The Postgres node returns one row per (client, workflow_name) pair. The Code node groups these into:
```json
{ "generated_at": "...", "clients": [ { "id": "...", "business_name": "...", "vertical": "...", "tier": "...", "status": "red", "workflows": [...] } ] }
```

Health rules (applied per workflow):
- **Red:** `failures_7d > 0`
- **Yellow:** no `last_triggered_at`, or `last_triggered_at` older than 7 days (event-driven) / 2 days (scheduled)
- **Green:** triggered recently and zero failures
- Scheduled = any `workflow_name` containing `chief_of_staff`
- Client-level status = worst across its workflows
- Clients sorted red → yellow → green, then alphabetically within each group

- [ ] **Step 1: Create the workflow JSON**

Create `n8n/workflows/Norr AI Client Health Query.json`:

```json
{
  "name": "Norr AI Client Health Query",
  "nodes": [
    {
      "parameters": {
        "httpMethod": "GET",
        "path": "client-health",
        "responseMode": "responseNode",
        "options": {}
      },
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2.1,
      "position": [240, 144],
      "id": "d1e2f3a4-0001-4000-8000-000000000001",
      "name": "Receive Request",
      "webhookId": "client-health-webhook-001"
    },
    {
      "parameters": {
        "conditions": {
          "options": { "caseSensitive": true, "leftValue": "", "typeValidation": "loose", "version": 3 },
          "conditions": [
            {
              "id": "token-check-health-001",
              "leftValue": "={{ $json.headers[\"x-norr-token\"] }}",
              "rightValue": "=8F68D963-7060-4033-BD04-7593E4B203CB",
              "operator": { "type": "string", "operation": "startsWith" }
            }
          ],
          "combinator": "or"
        },
        "looseTypeValidation": true,
        "options": {}
      },
      "type": "n8n-nodes-base.if",
      "typeVersion": 2.3,
      "position": [432, 144],
      "id": "d1e2f3a4-0002-4000-8000-000000000002",
      "name": "Token Check"
    },
    {
      "parameters": {
        "operation": "executeQuery",
        "query": "SELECT c.id, c.business_name, c.vertical, c.tier, we.workflow_name, MAX(CASE WHEN we.event_type = 'triggered' THEN we.created_at END) AS last_triggered_at, MAX(CASE WHEN we.event_type = 'failed' THEN we.created_at END) AS last_failed_at, COUNT(CASE WHEN we.event_type = 'failed' AND we.created_at > now() - interval '7 days' THEN 1 END) AS failures_7d FROM clients c LEFT JOIN workflow_events we ON we.client_id = c.id WHERE c.status = 'active' GROUP BY c.id, c.business_name, c.vertical, c.tier, we.workflow_name ORDER BY c.business_name, we.workflow_name",
        "options": {}
      },
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2.5,
      "position": [640, 144],
      "id": "d1e2f3a4-0003-4000-8000-000000000003",
      "name": "Query Neon",
      "credentials": {
        "postgres": {
          "id": "NEON_CREDENTIAL_ID",
          "name": "Neon Postgres"
        }
      }
    },
    {
      "parameters": {
        "jsCode": "const rows = $input.all().map(r => r.json);\nconst SCHEDULED = ['chief_of_staff'];\nconst RANK = { red: 2, yellow: 1, green: 0 };\nconst now = new Date();\n\nconst map = {};\nfor (const row of rows) {\n  const key = row.id;\n  if (!map[key]) {\n    map[key] = { id: row.id, business_name: row.business_name, vertical: row.vertical, tier: row.tier, workflows: [] };\n  }\n  if (!row.workflow_name) continue;\n  const isScheduled = SCHEDULED.some(n => row.workflow_name.toLowerCase().includes(n));\n  const days = isScheduled ? 2 : 7;\n  const threshold = new Date(now - days * 86400000);\n  const lastTriggered = row.last_triggered_at ? new Date(row.last_triggered_at) : null;\n  const failures = parseInt(row.failures_7d) || 0;\n  let status = 'green';\n  if (failures > 0) status = 'red';\n  else if (!lastTriggered || lastTriggered < threshold) status = 'yellow';\n  map[key].workflows.push({\n    workflow_name: row.workflow_name,\n    status,\n    last_triggered_at: row.last_triggered_at || null,\n    last_failed_at: row.last_failed_at || null,\n    failures_7d: failures\n  });\n}\n\nconst clients = Object.values(map).map(c => {\n  const worst = c.workflows.reduce((w, wf) => RANK[wf.status] > RANK[w] ? wf.status : w, 'green');\n  return { ...c, status: worst };\n});\n\nclients.sort((a, b) => {\n  const d = RANK[b.status] - RANK[a.status];\n  return d !== 0 ? d : a.business_name.localeCompare(b.business_name);\n});\n\nreturn [{ json: { generated_at: now.toISOString(), clients } }];"
      },
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [848, 144],
      "id": "d1e2f3a4-0004-4000-8000-000000000004",
      "name": "Apply Health Logic"
    },
    {
      "parameters": {
        "respondWith": "firstIncomingItem",
        "options": {}
      },
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [1056, 144],
      "id": "d1e2f3a4-0005-4000-8000-000000000005",
      "name": "Return Health JSON"
    }
  ],
  "pinData": {},
  "connections": {
    "Receive Request": { "main": [[{ "node": "Token Check", "type": "main", "index": 0 }]] },
    "Token Check": { "main": [[{ "node": "Query Neon", "type": "main", "index": 0 }]] },
    "Query Neon": { "main": [[{ "node": "Apply Health Logic", "type": "main", "index": 0 }]] },
    "Apply Health Logic": { "main": [[{ "node": "Return Health JSON", "type": "main", "index": 0 }]] }
  },
  "active": false,
  "settings": { "executionOrder": "v1", "binaryMode": "separate" },
  "versionId": "client-health-query-v1-001",
  "meta": { "templateCredsSetupCompleted": false, "instanceId": "0d4efb408d47ca7fe5f9bfa9b6b5b1a6e6f8fcb31cb2584a172b735d47653914" },
  "id": "",
  "tags": []
}
```

- [ ] **Step 2: Smoke test in n8n**

1. Import `n8n/workflows/Norr AI Client Health Query.json` into n8n Cloud
2. Link the Neon Postgres credential to the `Query Neon` node (replace `NEON_CREDENTIAL_ID` with the real credential)
3. Activate the workflow
4. Fire a test request from Hoppscotch:
   - Method: `GET`
   - URL: `https://norrai.app.n8n.cloud/webhook/client-health`
   - Header: `X-Norr-Token: 8F68D963-7060-4033-BD04-7593E4B203CB`
5. Expected response body: `{ "generated_at": "...", "clients": [...] }` — if no active clients exist, `clients` will be `[]`
6. Verify token check: send without the header → workflow should stop at Token Check with no meaningful response

- [ ] **Step 3: Commit**

```bash
git add "n8n/workflows/Norr AI Client Health Query.json"
git commit -m "feat: add Client Health Query n8n webhook workflow"
```

---

### Task 2: Red Alert Scheduler n8n Workflow

**Files:**
- Create: `n8n/workflows/Norr AI Red Alert Scheduler.json`

**Background:** Cron trigger at 6am and 6pm CT (CDT offset: 11:00 UTC and 23:00 UTC). Runs the same SQL query as Task 1 and applies the same health logic. A Code node also filters to red clients and builds a Slack message. An IF node checks `red_count > 0` — if true, posts to Slack via HTTP Request using a Slack Incoming Webhook URL. Silent if no red clients.

The `SLACK_WEBHOOK_URL` placeholder follows the same pattern as the Chief of Staff workflow — replace with the actual Slack Incoming Webhook URL in n8n after import.

Note: cron times are UTC offsets for CDT (UTC-5). They shift by 1 hour in CST (November–March) — acceptable for an internal ops tool.

- [ ] **Step 1: Create the workflow JSON**

Create `n8n/workflows/Norr AI Red Alert Scheduler.json`:

```json
{
  "name": "Norr AI Red Alert Scheduler",
  "nodes": [
    {
      "parameters": {
        "rule": {
          "interval": [
            { "field": "cronExpression", "expression": "0 11 * * *" },
            { "field": "cronExpression", "expression": "0 23 * * *" }
          ]
        }
      },
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1.2,
      "position": [240, 144],
      "id": "e2f3a4b5-0001-4000-8000-000000000001",
      "name": "Schedule 6am + 6pm CT"
    },
    {
      "parameters": {
        "operation": "executeQuery",
        "query": "SELECT c.id, c.business_name, c.vertical, c.tier, we.workflow_name, MAX(CASE WHEN we.event_type = 'triggered' THEN we.created_at END) AS last_triggered_at, MAX(CASE WHEN we.event_type = 'failed' THEN we.created_at END) AS last_failed_at, COUNT(CASE WHEN we.event_type = 'failed' AND we.created_at > now() - interval '7 days' THEN 1 END) AS failures_7d FROM clients c LEFT JOIN workflow_events we ON we.client_id = c.id WHERE c.status = 'active' GROUP BY c.id, c.business_name, c.vertical, c.tier, we.workflow_name ORDER BY c.business_name, we.workflow_name",
        "options": {}
      },
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2.5,
      "position": [448, 144],
      "id": "e2f3a4b5-0002-4000-8000-000000000002",
      "name": "Query Neon",
      "credentials": {
        "postgres": {
          "id": "NEON_CREDENTIAL_ID",
          "name": "Neon Postgres"
        }
      }
    },
    {
      "parameters": {
        "jsCode": "const rows = $input.all().map(r => r.json);\nconst SCHEDULED = ['chief_of_staff'];\nconst RANK = { red: 2, yellow: 1, green: 0 };\nconst now = new Date();\n\nconst map = {};\nfor (const row of rows) {\n  const key = row.id;\n  if (!map[key]) {\n    map[key] = { id: row.id, business_name: row.business_name, vertical: row.vertical, tier: row.tier, workflows: [] };\n  }\n  if (!row.workflow_name) continue;\n  const isScheduled = SCHEDULED.some(n => row.workflow_name.toLowerCase().includes(n));\n  const days = isScheduled ? 2 : 7;\n  const threshold = new Date(now - days * 86400000);\n  const lastTriggered = row.last_triggered_at ? new Date(row.last_triggered_at) : null;\n  const failures = parseInt(row.failures_7d) || 0;\n  let wfStatus = 'green';\n  if (failures > 0) wfStatus = 'red';\n  else if (!lastTriggered || lastTriggered < threshold) wfStatus = 'yellow';\n  map[key].workflows.push({ workflow_name: row.workflow_name, status: wfStatus, last_failed_at: row.last_failed_at || null, failures_7d: failures, silence_days: days });\n}\n\nconst clients = Object.values(map).map(c => {\n  const worst = c.workflows.reduce((w, wf) => RANK[wf.status] > RANK[w] ? wf.status : w, 'green');\n  return { ...c, status: worst };\n});\n\nconst redClients = clients.filter(c => c.status === 'red');\n\nif (redClients.length === 0) {\n  return [{ json: { red_count: 0, slack_message: '' } }];\n}\n\nfunction fmt(iso) {\n  return new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });\n}\n\nconst lines = [];\nfor (const c of redClients) {\n  lines.push(':red_circle: *' + c.business_name + '*');\n  for (const wf of c.workflows.filter(w => w.status === 'red')) {\n    if (wf.failures_7d > 0) {\n      const when = wf.last_failed_at ? fmt(wf.last_failed_at) : 'unknown time';\n      lines.push('  \\u2022 ' + wf.workflow_name + ' \\u2014 ' + wf.failures_7d + ' failure' + (wf.failures_7d > 1 ? 's' : '') + ' in last 7 days (last: ' + when + ')');\n    } else {\n      lines.push('  \\u2022 ' + wf.workflow_name + ' \\u2014 no activity in ' + wf.silence_days + ' days');\n    }\n  }\n}\n\nconst n = redClients.length;\nconst slack_message = '*Client Health Alert \\u2014 ' + n + ' client' + (n > 1 ? 's' : '') + ' need' + (n === 1 ? 's' : '') + ' attention*\\n\\n' + lines.join('\\n');\n\nreturn [{ json: { red_count: n, slack_message } }];"
      },
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [656, 144],
      "id": "e2f3a4b5-0003-4000-8000-000000000003",
      "name": "Build Alert"
    },
    {
      "parameters": {
        "conditions": {
          "options": { "caseSensitive": true, "leftValue": "", "typeValidation": "loose", "version": 3 },
          "conditions": [
            {
              "id": "has-red-001",
              "leftValue": "={{ $json.red_count }}",
              "rightValue": 0,
              "operator": { "type": "number", "operation": "gt" }
            }
          ],
          "combinator": "and"
        },
        "looseTypeValidation": true,
        "options": {}
      },
      "type": "n8n-nodes-base.if",
      "typeVersion": 2.3,
      "position": [864, 144],
      "id": "e2f3a4b5-0004-4000-8000-000000000004",
      "name": "Has Red Clients?"
    },
    {
      "parameters": {
        "url": "SLACK_WEBHOOK_URL",
        "method": "POST",
        "sendBody": true,
        "contentType": "raw",
        "rawContentType": "application/json",
        "body": "={{ JSON.stringify({ text: $json.slack_message }) }}",
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [1072, 60],
      "id": "e2f3a4b5-0005-4000-8000-000000000005",
      "name": "Post to Slack"
    }
  ],
  "pinData": {},
  "connections": {
    "Schedule 6am + 6pm CT": { "main": [[{ "node": "Query Neon", "type": "main", "index": 0 }]] },
    "Query Neon": { "main": [[{ "node": "Build Alert", "type": "main", "index": 0 }]] },
    "Build Alert": { "main": [[{ "node": "Has Red Clients?", "type": "main", "index": 0 }]] },
    "Has Red Clients?": { "main": [[{ "node": "Post to Slack", "type": "main", "index": 0 }]] }
  },
  "active": false,
  "settings": { "executionOrder": "v1", "binaryMode": "separate" },
  "versionId": "red-alert-scheduler-v1-001",
  "meta": { "templateCredsSetupCompleted": false, "instanceId": "0d4efb408d47ca7fe5f9bfa9b6b5b1a6e6f8fcb31cb2584a172b735d47653914" },
  "id": "",
  "tags": []
}
```

- [ ] **Step 2: Smoke test in n8n**

1. Import `n8n/workflows/Norr AI Red Alert Scheduler.json` into n8n Cloud
2. Link the Neon Postgres credential to the `Query Neon` node
3. Replace `SLACK_WEBHOOK_URL` with the actual Slack Incoming Webhook URL
4. Manually execute the workflow from the n8n editor (don't wait for the cron)
5. If no active clients are red: confirm the workflow stops at `Has Red Clients?` false branch — no Slack message
6. To test Slack posting: insert a test failure row, manually execute, confirm Slack message, then clean up:

```sql
-- Insert test failure (run against Neon)
INSERT INTO workflow_events (client_id, workflow_name, event_type)
SELECT id, 'test_workflow', 'failed'
FROM clients WHERE status = 'active' LIMIT 1;

-- After confirming Slack message:
DELETE FROM workflow_events WHERE workflow_name = 'test_workflow';
```

- [ ] **Step 3: Commit**

```bash
git add "n8n/workflows/Norr AI Red Alert Scheduler.json"
git commit -m "feat: add Red Alert Scheduler n8n workflow"
```

---

### Task 3: Dashboard HTML + Playwright Tests

**Files:**
- Create: `tests/dashboard.spec.js`
- Create: `website/internal/dashboard.html`

**Background:** Static HTML page at `website/internal/dashboard.html`, served at `http://localhost:3000/internal/dashboard.html` in tests (Playwright config serves `website/` on port 3000). The page fetches from `https://norrai.app.n8n.cloud/webhook/client-health` — tests intercept this with `page.route()` to return mock data.

- [ ] **Step 1: Write the failing tests**

Create `tests/dashboard.spec.js`:

```javascript
const { test, expect } = require('@playwright/test');

const MOCK_HEALTH = {
  generated_at: '2026-05-08T12:00:00.000Z',
  clients: [
    {
      id: 'uuid-1',
      business_name: 'Johnson Realty',
      vertical: 'real_estate',
      tier: 'starter',
      status: 'red',
      workflows: [
        { workflow_name: 'instant_lead_response', status: 'red', last_triggered_at: '2026-05-01T09:00:00Z', last_failed_at: '2026-05-07T14:23:00Z', failures_7d: 2 }
      ]
    },
    {
      id: 'uuid-2',
      business_name: 'Sunrise Dental',
      vertical: 'dental',
      tier: 'growth',
      status: 'yellow',
      workflows: [
        { workflow_name: 'appointment_reminder', status: 'yellow', last_triggered_at: null, last_failed_at: null, failures_7d: 0 }
      ]
    },
    {
      id: 'uuid-3',
      business_name: 'Apex Insurance',
      vertical: 'insurance',
      tier: 'starter',
      status: 'green',
      workflows: [
        { workflow_name: 'renewal_reminder', status: 'green', last_triggered_at: '2026-05-07T10:00:00Z', last_failed_at: null, failures_7d: 0 }
      ]
    }
  ]
};

function mockHealth(page, response = MOCK_HEALTH, status = 200) {
  return page.route('**/webhook/client-health', route =>
    route.fulfill({ status, body: JSON.stringify(response), contentType: 'application/json' })
  );
}

test('page loads with correct title', async ({ page }) => {
  await mockHealth(page);
  await page.goto('/internal/dashboard.html');
  await expect(page).toHaveTitle('Client Health — Norr AI');
});

test('renders three client cards', async ({ page }) => {
  await mockHealth(page);
  await page.goto('/internal/dashboard.html');
  await expect(page.locator('.client-card')).toHaveCount(3);
});

test('red client card appears first', async ({ page }) => {
  await mockHealth(page);
  await page.goto('/internal/dashboard.html');
  const firstCard = page.locator('.client-card').first();
  await expect(firstCard).toContainText('Johnson Realty');
  await expect(firstCard.locator('.status-dot')).toHaveAttribute('data-status', 'red');
});

test('green client card appears last', async ({ page }) => {
  await mockHealth(page);
  await page.goto('/internal/dashboard.html');
  const lastCard = page.locator('.client-card').last();
  await expect(lastCard).toContainText('Apex Insurance');
  await expect(lastCard.locator('.status-dot')).toHaveAttribute('data-status', 'green');
});

test('each card shows workflow list', async ({ page }) => {
  await mockHealth(page);
  await page.goto('/internal/dashboard.html');
  const firstCard = page.locator('.client-card').first();
  await expect(firstCard).toContainText('instant_lead_response');
});

test('each card shows vertical and tier', async ({ page }) => {
  await mockHealth(page);
  await page.goto('/internal/dashboard.html');
  const firstCard = page.locator('.client-card').first();
  await expect(firstCard).toContainText('real estate');
  await expect(firstCard).toContainText('Starter');
});

test('shows error state when fetch fails', async ({ page }) => {
  await page.route('**/webhook/client-health', route => route.fulfill({ status: 500, body: '' }));
  await page.goto('/internal/dashboard.html');
  await expect(page.locator('#error')).toBeVisible();
  await expect(page.locator('.client-grid')).not.toBeVisible();
});

test('refresh button triggers a second fetch', async ({ page }) => {
  let fetchCount = 0;
  await page.route('**/webhook/client-health', route => {
    fetchCount++;
    return route.fulfill({ status: 200, body: JSON.stringify(MOCK_HEALTH), contentType: 'application/json' });
  });
  await page.goto('/internal/dashboard.html');
  await page.locator('.client-card').first().waitFor();
  await page.locator('#refresh-btn').click();
  await page.locator('.client-card').first().waitFor();
  expect(fetchCount).toBe(2);
});

test('sends X-Norr-Token header', async ({ page }) => {
  let tokenSent;
  await page.route('**/webhook/client-health', route => {
    tokenSent = route.request().headers()['x-norr-token'];
    return route.fulfill({ status: 200, body: JSON.stringify(MOCK_HEALTH), contentType: 'application/json' });
  });
  await page.goto('/internal/dashboard.html');
  await page.locator('.client-card').first().waitFor();
  expect(tokenSent).toBeTruthy();
});

test('shows empty state when no active clients', async ({ page }) => {
  await mockHealth(page, { generated_at: '2026-05-08T12:00:00Z', clients: [] });
  await page.goto('/internal/dashboard.html');
  await expect(page.locator('.client-grid')).toContainText('No active clients');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/dashboard.spec.js
```

Expected: all 10 tests fail (page does not exist yet)

- [ ] **Step 3: Create the dashboard HTML**

Create `website/internal/dashboard.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Client Health — Norr AI</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Inter+Tight:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="icon" type="image/svg+xml" href="/norr_ai_favicon.svg">
<style>
  :root {
    --bone: #FAFAF7; --ink: #0A0F1A; --glacial: #7FA9B8; --graphite: #3A3F48;
    --surface: #FFFFFF; --border: #E5E4DE; --muted: #9EA3AA; --secondary: #6A6F78;
    --font-display: 'Inter Tight', sans-serif;
    --font-body: 'Inter', sans-serif;
    --font-mono: 'JetBrains Mono', monospace;
    --radius-sm: 4px; --radius-md: 8px; --radius-lg: 12px;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html { font-size: 16px; -webkit-font-smoothing: antialiased; }
  body { font-family: var(--font-body); background: var(--bone); color: var(--ink); line-height: 1.5; min-height: 100dvh; }

  .site-header { background: var(--ink); padding: 40px 24px 36px; border-bottom: 1px solid #1e2535; }
  .site-header-inner { max-width: 960px; margin: 0 auto; display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
  .eyebrow { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--glacial); margin-bottom: 12px; }
  .site-header h1 { font-family: var(--font-display); font-weight: 700; font-size: 28px; letter-spacing: -0.03em; line-height: 1.1; color: var(--bone); }
  .site-header h1 .accent { color: var(--glacial); }
  .header-actions { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
  #last-updated { font-family: var(--font-mono); font-size: 10px; color: var(--muted); letter-spacing: 0.05em; }
  #refresh-btn { background: transparent; border: 1px solid #3a4555; color: var(--muted); font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.05em; padding: 6px 14px; border-radius: var(--radius-sm); cursor: pointer; transition: border-color 0.15s, color 0.15s; }
  #refresh-btn:hover { border-color: var(--glacial); color: var(--glacial); }

  .wrap { max-width: 960px; margin: 0 auto; padding: 36px 24px 72px; }

  #loading { text-align: center; padding: 80px 0; color: var(--muted); font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.1em; }
  .spinner { display: inline-block; width: 20px; height: 20px; border: 2px solid var(--border); border-top-color: var(--glacial); border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 12px; }
  @keyframes spin { to { transform: rotate(360deg); } }

  #error { display: none; background: #FEF2F2; border: 1px solid #FECACA; border-radius: var(--radius-md); padding: 20px 24px; color: #B91C1C; font-size: 14px; }
  #error button { background: none; border: 1px solid currentColor; color: inherit; font-size: 13px; padding: 6px 14px; border-radius: var(--radius-sm); cursor: pointer; margin-top: 12px; display: block; }

  .client-grid { display: none; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
  .client-grid.visible { display: grid; }

  .client-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 20px; }
  .client-card.status-red    { border-left: 3px solid #B91C1C; }
  .client-card.status-yellow { border-left: 3px solid #F59E0B; }
  .client-card.status-green  { border-left: 3px solid #22C55E; }

  .card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
  .card-name { font-family: var(--font-display); font-weight: 600; font-size: 16px; letter-spacing: -0.01em; line-height: 1.2; }
  .status-dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; margin-top: 3px; }
  .status-dot[data-status="red"]    { background: #B91C1C; }
  .status-dot[data-status="yellow"] { background: #F59E0B; }
  .status-dot[data-status="green"]  { background: #22C55E; }

  .card-meta { font-size: 11px; color: var(--muted); text-transform: capitalize; margin-bottom: 14px; }

  .workflow-list { list-style: none; }
  .workflow-item { display: flex; align-items: center; gap: 8px; padding: 5px 0; border-top: 1px solid var(--border); }
  .workflow-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .workflow-dot[data-status="red"]    { background: #B91C1C; }
  .workflow-dot[data-status="yellow"] { background: #F59E0B; }
  .workflow-dot[data-status="green"]  { background: #22C55E; }
  .workflow-name { font-family: var(--font-mono); font-size: 11px; color: var(--secondary); }

  .empty-state { color: var(--muted); font-size: 14px; }

  @media (max-width: 540px) {
    .site-header { padding: 32px 18px 28px; }
    .wrap { padding: 28px 18px 60px; }
    .client-grid { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>

<header class="site-header">
  <div class="site-header-inner">
    <div>
      <div class="eyebrow">Internal</div>
      <h1>Client <span class="accent">Health</span></h1>
    </div>
    <div class="header-actions">
      <span id="last-updated"></span>
      <button id="refresh-btn">Refresh</button>
    </div>
  </div>
</header>

<div class="wrap">
  <div id="loading"><div class="spinner"></div><div>Loading health data&hellip;</div></div>
  <div id="error"></div>
  <div id="grid" class="client-grid"></div>
</div>

<script>
  const WEBHOOK_URL = 'https://norrai.app.n8n.cloud/webhook/client-health';
  const TOKEN = '8F68D963-7060-4033-BD04-7593E4B203CB';

  const loadingEl     = document.getElementById('loading');
  const errorEl       = document.getElementById('error');
  const gridEl        = document.getElementById('grid');
  const lastUpdatedEl = document.getElementById('last-updated');

  function formatTime(iso) {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: 'America/Chicago', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit'
    });
  }

  function renderClients(data) {
    gridEl.innerHTML = '';

    if (!data.clients || data.clients.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'No active clients.';
      gridEl.appendChild(empty);
    } else {
      for (const client of data.clients) {
        const card = document.createElement('div');
        card.className = 'client-card status-' + client.status;

        const nameEl = document.createElement('div');
        nameEl.className = 'card-name';
        nameEl.textContent = client.business_name;

        const dot = document.createElement('div');
        dot.className = 'status-dot';
        dot.setAttribute('data-status', client.status);

        const cardHeader = document.createElement('div');
        cardHeader.className = 'card-header';
        cardHeader.append(nameEl, dot);

        const tier = client.tier.charAt(0).toUpperCase() + client.tier.slice(1);
        const vertical = client.vertical.replace(/_/g, ' ');
        const meta = document.createElement('div');
        meta.className = 'card-meta';
        meta.textContent = vertical + ' \u00b7 ' + tier;

        const wfList = document.createElement('ul');
        wfList.className = 'workflow-list';
        for (const wf of client.workflows) {
          const li = document.createElement('li');
          li.className = 'workflow-item';
          const wfDot = document.createElement('div');
          wfDot.className = 'workflow-dot';
          wfDot.setAttribute('data-status', wf.status);
          const wfName = document.createElement('span');
          wfName.className = 'workflow-name';
          wfName.textContent = wf.workflow_name;
          li.append(wfDot, wfName);
          wfList.appendChild(li);
        }

        card.append(cardHeader, meta, wfList);
        gridEl.appendChild(card);
      }
    }

    if (data.generated_at) {
      lastUpdatedEl.textContent = 'Last updated ' + formatTime(data.generated_at);
    }

    loadingEl.style.display = 'none';
    errorEl.style.display = 'none';
    gridEl.classList.add('visible');
  }

  async function loadHealth() {
    loadingEl.style.display = 'block';
    errorEl.style.display = 'none';
    gridEl.classList.remove('visible');

    try {
      const res = await fetch(WEBHOOK_URL, { headers: { 'X-Norr-Token': TOKEN } });
      if (!res.ok) throw new Error('Server returned ' + res.status);
      const data = await res.json();
      renderClients(data);
    } catch (err) {
      loadingEl.style.display = 'none';
      errorEl.style.display = 'block';
      errorEl.innerHTML = '';
      const msg = document.createElement('div');
      msg.textContent = 'Failed to load health data: ' + err.message;
      const retryBtn = document.createElement('button');
      retryBtn.textContent = 'Retry';
      retryBtn.addEventListener('click', loadHealth);
      errorEl.append(msg, retryBtn);
    }
  }

  document.getElementById('refresh-btn').addEventListener('click', loadHealth);
  loadHealth();
</script>
</body>
</html>
```

- [ ] **Step 4: Run dashboard tests — all should pass**

```bash
npm test -- tests/dashboard.spec.js
```

Expected: 10/10 passing

- [ ] **Step 5: Run full suite — no regressions**

```bash
npm test
```

Expected: all tests pass (248 existing + 10 new = 258 total)

- [ ] **Step 6: Commit**

```bash
git add website/internal/dashboard.html tests/dashboard.spec.js
git commit -m "feat: add client health monitoring dashboard"
```
