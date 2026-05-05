# B&B Lead Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an n8n workflow that runs every Monday at 6am CT, searches Apollo.io for regional OEM manufacturing prospects, scores them with Claude, and emails a drafted outreach message to B&B's inbox for human review.

**Architecture:** Schedule trigger fires Apollo.io search → Google Sheets exclusion dedup → SplitInBatches processes one lead at a time → Claude scores each lead → qualified leads (8+) get a Claude-drafted outreach emailed to B&B's review inbox and logged to Neon.

**Tech Stack:** n8n Cloud, Apollo.io API, Google Sheets, Claude API (claude-sonnet-4-6), SendGrid, Neon Postgres

---

## File Structure

| File | Action | Purpose |
|---|---|---|
| `n8n/workflows/B&B Lead Generator.json` | Create | Complete n8n workflow (12 nodes) |
| `n8n/TESTING_NOTES.md` | Modify | Add lead generator testing section |
| `CLAUDE.md` | Modify | Update session log and task list |

---

### Task 1: Create the workflow JSON

**Files:**
- Create: `n8n/workflows/B&B Lead Generator.json`

Read `n8n/workflows/B&B Manufacturing Estimate.json` first to understand the n8n workflow JSON schema. This workflow uses the same pattern.

**Node map (12 nodes):**

| # | Name | Type | Purpose |
|---|---|---|---|
| 1 | Every Monday 6am CT | scheduleTrigger | Fires weekly at 11am UTC (6am CDT) |
| 2 | Search Apollo | httpRequest | Pulls ~15 contacts from Apollo.io |
| 3 | Read Exclusion Sheet | googleSheets | Gets company/domain exclusion list |
| 4 | Filter and Dedup | code | Removes excluded contacts, outputs one item per lead |
| 5 | Split by Lead | splitInBatches | Processes leads one at a time |
| 6 | Score with Claude | httpRequest | Returns JSON {score, reason} |
| 7 | Parse Score | code | Extracts score/reason, carries lead fields forward |
| 8 | Score 8 or Above? | if | Gates on score >= 8 |
| 9 | Draft Outreach | httpRequest | Writes personalized cold email body |
| 10 | Parse Draft | code | Extracts draft text, carries all fields forward |
| 11 | Send Review Email | sendGrid | Emails B&B with lead info and draft copy |
| 12 | Log Lead to Neon | postgres | Inserts row into leads table |

- [ ] **Step 1: Create the workflow file**

Create `n8n/workflows/B&B Lead Generator.json` with this exact content:

```json
{
  "name": "B&B Lead Generator",
  "nodes": [
    {
      "parameters": {
        "rule": {
          "interval": [
            {
              "field": "weeks",
              "weeksInterval": 1,
              "triggerAtDay": [1],
              "triggerAtHour": 11,
              "triggerAtMinute": 0
            }
          ]
        }
      },
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1.2,
      "position": [240, 300],
      "id": "b3b4c5d6-0001-4000-8000-000000000001",
      "name": "Every Monday 6am CT"
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://api.apollo.io/v1/mixed_people/search",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "Content-Type",
              "value": "application/json"
            }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "{\n  \"person_locations\": [\"Faribault, Minnesota\"],\n  \"person_location_radius_miles\": 250,\n  \"organization_industry_tag_ids\": [\"Machinery Manufacturing\", \"Fabricated Metal Products\", \"Industrial Machinery\"],\n  \"person_titles\": [\"Sourcing Manager\", \"Procurement Manager\", \"Operations Manager\", \"Plant Manager\"],\n  \"contact_email_status\": [\"verified\"],\n  \"per_page\": 15\n}",
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.4,
      "position": [460, 300],
      "id": "b3b4c5d6-0002-4000-8000-000000000002",
      "name": "Search Apollo",
      "continueOnFail": true,
      "credentials": {
        "httpHeaderAuth": {
          "id": "APOLLO_CREDENTIAL_ID",
          "name": "Apollo API Key"
        }
      }
    },
    {
      "parameters": {
        "operation": "readAllRows",
        "documentId": {
          "__rl": true,
          "value": "YOUR_SPREADSHEET_ID",
          "mode": "id"
        },
        "sheetName": {
          "__rl": true,
          "value": "Sheet1",
          "mode": "name"
        }
      },
      "type": "n8n-nodes-base.googleSheets",
      "typeVersion": 4.5,
      "position": [680, 300],
      "id": "b3b4c5d6-0003-4000-8000-000000000003",
      "name": "Read Exclusion Sheet",
      "continueOnFail": true,
      "credentials": {
        "googleSheetsOAuth2Api": {
          "id": "GOOGLE_SHEETS_CREDENTIAL_ID",
          "name": "Google Sheets account"
        }
      }
    },
    {
      "parameters": {
        "jsCode": "// Get Apollo contacts (from Search Apollo, two nodes back)\nconst apolloData = $('Search Apollo').first().json;\nconst contacts = apolloData.people || [];\n\n// Get exclusion rows from Google Sheets (direct input to this node)\nconst exclusionRows = $input.all().map(item => item.json);\n\n// Build exclusion sets (lowercase for case-insensitive matching)\nconst excludedNames = exclusionRows\n  .map(r => (r.company_name || '').toLowerCase().trim())\n  .filter(Boolean);\nconst excludedDomains = exclusionRows\n  .map(r => (r.domain || '').toLowerCase().replace(/^www\\./, '').trim())\n  .filter(Boolean);\n\nfunction isExcluded(contact) {\n  const name = (contact.organization_name || '').toLowerCase();\n  const rawUrl = (contact.organization_website_url || '').toLowerCase();\n  const domain = rawUrl\n    .replace(/^https?:\\/\\//, '')\n    .replace(/^www\\./, '')\n    .split('/')[0];\n  return (\n    excludedNames.some(n => n && name.includes(n)) ||\n    excludedDomains.some(d => d && domain.includes(d))\n  );\n}\n\n// TODO: replace Google Sheet check with JobBOSS API lookup when integration is ready\n\nreturn contacts.filter(c => !isExcluded(c)).map(c => ({\n  json: {\n    first_name: c.first_name || '',\n    last_name: c.last_name || '',\n    full_name: `${c.first_name || ''} ${c.last_name || ''}`.trim(),\n    title: c.title || '',\n    email: c.email || '',\n    company: c.organization_name || '',\n    website: c.organization_website_url || '',\n    city: c.city || '',\n    state: c.state || ''\n  }\n}));"
      },
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [900, 300],
      "id": "b3b4c5d6-0004-4000-8000-000000000004",
      "name": "Filter and Dedup"
    },
    {
      "parameters": {
        "batchSize": 1,
        "options": {}
      },
      "type": "n8n-nodes-base.splitInBatches",
      "typeVersion": 3,
      "position": [1120, 300],
      "id": "b3b4c5d6-0005-4000-8000-000000000005",
      "name": "Split by Lead"
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
            {
              "name": "anthropic-version",
              "value": "2023-06-01"
            },
            {
              "name": "content-type",
              "value": "application/json"
            }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={\n  \"model\": \"claude-sonnet-4-6\",\n  \"max_tokens\": 150,\n  \"messages\": [\n    {\n      \"role\": \"user\",\n      \"content\": {{ JSON.stringify(\"You are a lead qualifier for B&B Manufacturing and Assembly, a custom metal fabrication shop in Faribault, MN. They specialize in laser cutting, CNC machining, MIG/TIG/robotic welding, press brake forming, and powder coating for OEM manufacturers in agriculture, aerospace, food processing, and industrial markets. They hold ISO 9001:2015 certification.\\n\\nScore this lead from 1\\u201310 based on fit:\\n- 8\\u201310: Strong fit \\u2014 OEM manufacturer in a served industry, decision-maker title, regional proximity\\n- 5\\u20137: Possible fit \\u2014 adjacent industry or unclear role\\n- 1\\u20134: Poor fit \\u2014 consumer, retail, or irrelevant industry\\n\\nLead:\\nName: \" + $json.full_name + \"\\nTitle: \" + $json.title + \"\\nCompany: \" + $json.company + \"\\nLocation: \" + $json.city + \", \" + $json.state + \"\\n\\nReturn ONLY valid JSON: {\\\"score\\\": 8, \\\"reason\\\": \\\"one sentence\\\"}\") }}\n    }\n  ]\n}",
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.4,
      "position": [1340, 300],
      "id": "b3b4c5d6-0006-4000-8000-000000000006",
      "name": "Score with Claude",
      "continueOnFail": true,
      "credentials": {
        "anthropicApi": {
          "id": "gXqu8TiqvDY4mUPZ",
          "name": "Anthropic account 2"
        }
      }
    },
    {
      "parameters": {
        "jsCode": "const claudeResponse = $input.first().json;\nconst text = claudeResponse.content[0].text.trim();\nconst { score, reason } = JSON.parse(text);\n\n// Carry lead fields from Split by Lead through the Claude HTTP call\n// .item gives the current batch item (not the first item across all batches)\nconst lead = $('Split by Lead').item.json;\n\nreturn [{\n  json: {\n    first_name: lead.first_name,\n    last_name: lead.last_name,\n    full_name: lead.full_name,\n    title: lead.title,\n    email: lead.email,\n    company: lead.company,\n    website: lead.website,\n    city: lead.city,\n    state: lead.state,\n    score,\n    reason\n  }\n}];"
      },
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1560, 300],
      "id": "b3b4c5d6-0007-4000-8000-000000000007",
      "name": "Parse Score"
    },
    {
      "parameters": {
        "conditions": {
          "options": {
            "caseSensitive": true,
            "leftValue": "",
            "typeValidation": "loose",
            "version": 3
          },
          "conditions": [
            {
              "id": "score-check-001",
              "leftValue": "={{ $json.score }}",
              "rightValue": 8,
              "operator": {
                "type": "number",
                "operation": "gte"
              }
            }
          ],
          "combinator": "and"
        },
        "looseTypeValidation": true,
        "options": {}
      },
      "type": "n8n-nodes-base.if",
      "typeVersion": 2.3,
      "position": [1780, 300],
      "id": "b3b4c5d6-0008-4000-8000-000000000008",
      "name": "Score 8 or Above?"
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
            {
              "name": "anthropic-version",
              "value": "2023-06-01"
            },
            {
              "name": "content-type",
              "value": "application/json"
            }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={\n  \"model\": \"claude-sonnet-4-6\",\n  \"max_tokens\": 300,\n  \"messages\": [\n    {\n      \"role\": \"user\",\n      \"content\": {{ JSON.stringify(\"Write a cold outreach email from B&B Manufacturing and Assembly (Faribault, MN) to \" + $json.first_name + \" \" + $json.last_name + \", \" + $json.title + \" at \" + $json.company + \".\\n\\nB&B is a 55,000 sq ft custom metal fabrication shop: laser cutting, CNC machining, MIG/TIG/robotic welding, press brake forming, powder coating. ISO 9001:2015 certified. Serves OEMs in ag, aerospace, food processing, and industrial markets.\\n\\nRequirements:\\n- Address them by first name\\n- Reference their industry or likely pain (faster turnaround, reliable fabrication partner)\\n- One concrete B&B capability that fits their world\\n- CTA: 15-minute discovery call\\n- Sign off: \\\"B&B Manufacturing and Assembly\\\"\\n- Under 100 words \\u2014 this is cold outreach, not a pitch deck\\n- Warm and direct, not corporate\\n\\nReturn ONLY the email body. No subject line. No formatting markers.\") }}\n    }\n  ]\n}",
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.4,
      "position": [2000, 200],
      "id": "b3b4c5d6-0009-4000-8000-000000000009",
      "name": "Draft Outreach",
      "continueOnFail": true,
      "credentials": {
        "anthropicApi": {
          "id": "gXqu8TiqvDY4mUPZ",
          "name": "Anthropic account 2"
        }
      }
    },
    {
      "parameters": {
        "jsCode": "const claudeResponse = $input.first().json;\nconst draft = claudeResponse.content[0].text.trim();\n\n// Carry all scored lead fields from Parse Score through the Claude draft call\n// .item gives the current batch item's data from that node\nconst lead = $('Parse Score').item.json;\n\nreturn [{\n  json: {\n    first_name: lead.first_name,\n    last_name: lead.last_name,\n    full_name: lead.full_name,\n    title: lead.title,\n    email: lead.email,\n    company: lead.company,\n    city: lead.city,\n    state: lead.state,\n    score: lead.score,\n    reason: lead.reason,\n    draft\n  }\n}];"
      },
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [2220, 200],
      "id": "b3b4c5d6-0010-4000-8000-000000000010",
      "name": "Parse Draft"
    },
    {
      "parameters": {
        "resource": "mail",
        "fromEmail": "hello@norrai.co",
        "fromName": "Norr AI",
        "toEmail": "egachuu@gmail.com",
        "subject": "=Lead Review \u2014 {{ $json.full_name }}, {{ $json.company }} (Score: {{ $json.score }}/10)",
        "contentValue": "=Lead: {{ $json.full_name }} \u2014 {{ $json.title }} at {{ $json.company }}, {{ $json.city }}, {{ $json.state }}\nScore: {{ $json.score }}/10 \u2014 {{ $json.reason }}\nEmail: {{ $json.email }}\n\nDrafted outreach:\n---\n{{ $json.draft }}\n---\n\nTo use: copy the draft above and send from your own email address.",
        "additionalFields": {}
      },
      "type": "n8n-nodes-base.sendGrid",
      "typeVersion": 1,
      "position": [2440, 200],
      "id": "b3b4c5d6-0011-4000-8000-000000000011",
      "name": "Send Review Email",
      "continueOnFail": true,
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
        "query": "INSERT INTO leads (lead_name, email, phone, source, metadata, created_at)\nVALUES (\n  '{{ $json.full_name }}',\n  '{{ $json.email }}',\n  NULL,\n  'bnb_lead_generator',\n  '{\"company\": \"{{ $json.company }}\", \"title\": \"{{ $json.title }}\", \"location\": \"{{ $json.city }}, {{ $json.state }}\", \"apollo_score\": {{ $json.score }}, \"score_reason\": \"{{ $json.reason }}\", \"draft_sent\": true}'::jsonb,\n  NOW()\n)"
      },
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2.5,
      "position": [2660, 200],
      "id": "b3b4c5d6-0012-4000-8000-000000000012",
      "name": "Log Lead to Neon",
      "continueOnFail": true,
      "credentials": {
        "postgres": {
          "id": "NEON_CREDENTIAL_ID",
          "name": "Neon account"
        }
      }
    }
  ],
  "connections": {
    "Every Monday 6am CT": {
      "main": [[{"node": "Search Apollo", "type": "main", "index": 0}]]
    },
    "Search Apollo": {
      "main": [[{"node": "Read Exclusion Sheet", "type": "main", "index": 0}]]
    },
    "Read Exclusion Sheet": {
      "main": [[{"node": "Filter and Dedup", "type": "main", "index": 0}]]
    },
    "Filter and Dedup": {
      "main": [[{"node": "Split by Lead", "type": "main", "index": 0}]]
    },
    "Split by Lead": {
      "main": [[{"node": "Score with Claude", "type": "main", "index": 0}]]
    },
    "Score with Claude": {
      "main": [[{"node": "Parse Score", "type": "main", "index": 0}]]
    },
    "Parse Score": {
      "main": [[{"node": "Score 8 or Above?", "type": "main", "index": 0}]]
    },
    "Score 8 or Above?": {
      "main": [
        [{"node": "Draft Outreach", "type": "main", "index": 0}],
        []
      ]
    },
    "Draft Outreach": {
      "main": [[{"node": "Parse Draft", "type": "main", "index": 0}]]
    },
    "Parse Draft": {
      "main": [[{"node": "Send Review Email", "type": "main", "index": 0}]]
    },
    "Send Review Email": {
      "main": [[{"node": "Log Lead to Neon", "type": "main", "index": 0}]]
    }
  },
  "active": false,
  "settings": {
    "executionOrder": "v1",
    "saveManualExecutions": true
  },
  "versionId": "bnb-lead-gen-v1-001",
  "meta": {
    "templateCredsSetupCompleted": false,
    "instanceId": "0d4efb408d47ca7fe5f9bfa9b6b5b1a6e6f8fcb31cb2584a172b735d47653914"
  },
  "id": "",
  "tags": []
}
```

- [ ] **Step 2: Validate JSON is parseable**

```bash
node -e "JSON.parse(require('fs').readFileSync('n8n/workflows/B\\&B Lead Generator.json', 'utf8')); console.log('Valid JSON');"
```

Expected: `Valid JSON`

- [ ] **Step 3: Commit**

```bash
git add "n8n/workflows/B&B Lead Generator.json"
git commit -m "feat: add B&B lead generator n8n workflow"
```

---

### Task 2: Add testing notes

**Files:**
- Modify: `n8n/TESTING_NOTES.md`

Read `n8n/TESTING_NOTES.md` first, then append the following section at the end of the file.

- [ ] **Step 1: Append the B&B Lead Generator section**

Append to end of `n8n/TESTING_NOTES.md`:

```markdown
---

## B&B Lead Generator

**Workflow file:** `n8n/workflows/B&B Lead Generator.json`
**Trigger:** Schedule — every Monday at 11am UTC (6am CDT / 7am CST in winter)
**Review email recipient:** egachuu@gmail.com (placeholder — replace with B&B inbox before go-live)

### Credentials to configure after import

| Node | Credential type | What to set |
|---|---|---|
| Search Apollo | HTTP Header Auth | `X-Api-Key` = Apollo API key |
| Read Exclusion Sheet | Google Sheets OAuth2 | Link Google account; update spreadsheet ID |
| Score with Claude | Anthropic | `gXqu8TiqvDY4mUPZ` (Anthropic account 2) |
| Draft Outreach | Anthropic | `gXqu8TiqvDY4mUPZ` (Anthropic account 2) |
| Send Review Email | SendGrid | `A5ypmjiRLAUMUm9O` (SendGrid account) |
| Log Lead to Neon | Postgres | Add Neon pooled connection string as Postgres credential |

### Google Sheet setup

Create a Google Sheet with two columns in row 1: `company_name` | `domain`

Pre-populate with any companies already in B&B's customer list. Share the sheet with the Google account linked in n8n.

Replace `YOUR_SPREADSHEET_ID` in the Read Exclusion Sheet node with the actual spreadsheet ID (found in the Google Sheet URL: `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`).

### Apollo.io setup

B&B must create an Apollo.io account and generate an API key (Settings → API → Create Key). In n8n, create an HTTP Header Auth credential with name `Apollo API Key`, header name `X-Api-Key`, and the key as the value. Link it to the Search Apollo node.

**Required dependency:** The workflow cannot run until B&B provisions an Apollo account.

### How to test without waiting until Monday

1. Import workflow into n8n — configure all 6 credentials and update spreadsheet ID
2. Open the workflow in n8n editor
3. Click **Test workflow** to manually trigger a single execution
4. Watch execution steps in n8n Executions view — each lead processes as a separate SplitInBatches iteration
5. Confirm review emails arrive at egachuu@gmail.com with real lead data and Claude-written draft
6. Confirm rows appear in Neon `leads` table: `SELECT * FROM leads WHERE source = 'bnb_lead_generator';`

### Critical data reference to verify first

The Parse Score and Parse Draft Code nodes use `$('Split by Lead').item.json` and `$('Parse Score').item.json` to carry lead fields across node boundaries inside the SplitInBatches loop. **Verify these references resolve correctly on the first test run.** Check the output of Parse Score and Parse Draft in Executions — if `first_name`, `company`, `score`, etc. are blank or undefined, the `.item` reference broke. Fix: add a Set node before each Claude HTTP Request to explicitly copy `$json.*` fields, removing the need for back-references.

### Test checklist

- [ ] Import workflow, configure all 6 credentials
- [ ] Update spreadsheet ID in Read Exclusion Sheet node
- [ ] Add one test company to exclusion sheet (e.g., "B&B Manufacturing" / "bBmfg.com")
- [ ] Manually trigger — confirm Apollo returns contacts in execution output
- [ ] Confirm excluded company is filtered out in Filter and Dedup output
- [ ] Check Parse Score output — confirm score and reason fields are populated with real lead data
- [ ] Confirm leads scoring >= 8 produce a review email with name, company, score, reason, and draft
- [ ] Confirm leads scoring < 8 are silently skipped (no email, no Neon row)
- [ ] Confirm Neon `leads` table has a row for each qualified lead: `SELECT * FROM leads WHERE source = 'bnb_lead_generator';`
- [ ] Replace egachuu@gmail.com with B&B inbox before activating for production
- [ ] Activate workflow — fires automatically Monday 11am UTC

### Known gaps / future work

| Gap | Priority |
|-----|----------|
| Review email recipient is a placeholder (egachuu@gmail.com) | High — replace before go-live |
| Spreadsheet ID is a placeholder (YOUR_SPREADSHEET_ID) | High — replace before go-live |
| Apollo API key not provisioned — B&B must set up account | High — required dependency |
| JobBOSS integration stubbed (comment in Filter and Dedup node) | Low — future |
| No LinkedIn enrichment (Apify integration planned) | Low — future |
| No workflow_events aggregate row in Neon (individual lead rows are logged) | Low — cosmetic |
| Schedule fires at 6am CDT; becomes 7am in winter CST | Low — acceptable |
| SQL in Log Lead to Neon is not parameterized — names with apostrophes will break | Low — fix for production |
```

- [ ] **Step 2: Commit**

```bash
git add n8n/TESTING_NOTES.md
git commit -m "docs: add B&B lead generator testing notes"
```

---

### Task 3: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

Read `CLAUDE.md` first to find the correct insertion points.

- [ ] **Step 1: Mark the lead generator task complete under Open Tasks**

Find this line under Near Term:
```
- [x] Build B&B Manufacturing estimating demo — form + n8n workflow + tests (see 2026-04-29 session log)
```

Add after it:
```markdown
- [x] Build B&B lead generator workflow — n8n schedule + Apollo.io + Claude scoring + SendGrid review email + Neon logging
```

- [ ] **Step 2: Update First Client Targets**

Find:
```
- **B&B Manufacturing** (Faribault, MN) — warm prospect, demo estimating workflow built; pending smoke test and import into n8n
```

Replace with:
```markdown
- **B&B Manufacturing** (Faribault, MN) — warm prospect, demo estimating workflow built; lead generator workflow built; pending smoke tests and n8n import for both; Apollo.io account is a required dependency B&B must provision
```

- [ ] **Step 3: Append to the 2026-04-29 session log**

Find the `### 2026-04-29` section and append to the end of that section's bullet list:
```markdown
- Brainstormed and designed automated lead generator for B&B Manufacturing — Monday 6am schedule, Apollo.io search (250-mile radius, OEM industries, decision-maker titles, verified emails), Google Sheet exclusion list with JobBOSS stub, Claude scoring (1-10, 8+ threshold), SendGrid review email to B&B inbox with drafted outreach copy, Neon logging per qualified lead
- Design spec: `docs/superpowers/specs/2026-04-29-bnb-lead-generator-design.md`
- Implementation plan: `docs/superpowers/plans/2026-04-29-bnb-lead-generator.md`
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with B&B lead generator"
```
