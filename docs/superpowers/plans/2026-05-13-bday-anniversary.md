# Birthday & Anniversary Outreach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an n8n workflow that queries a Google Sheet daily, identifies contacts with a birthday or home purchase anniversary today, and sends Claude-drafted personalized messages via email (and eventually SMS).

**Architecture:** Single n8n workflow per agent client. Daily cron at 9am CT reads a Google Sheet, filters rows where `birthday` (MM-DD) or `transaction_anniversary` (YYYY-MM-DD) matches today, loops over matches, calls Claude Haiku to draft a warm message, sends via SendGrid, and writes the current year back to a dedup column in the sheet. SMS node is built but disabled until Twilio registration is complete.

**Tech Stack:** n8n Cloud, Google Sheets API (n8n native node), Claude Haiku API (HTTP Request), SendGrid v3 API (HTTP Request), Twilio (HTTP Request, disabled), Neon Postgres (workflow_events logging)

---

## File Map

| File | Action | What it does |
|------|--------|-------------|
| `CLAUDE.md` | Modify | Add `bday_anniversary_outreach` to workflow_name registry |
| `n8n/workflows/Birthday & Anniversary Outreach.json` | Create | Complete importable n8n workflow JSON |

No schema changes — data lives in Google Sheet, `workflow_events` table already exists.

---

## Task 1: Update CLAUDE.md Workflow Registry

**Files:**
- Modify: `CLAUDE.md` (workflow_name registry table)

- [ ] **Step 1: Add workflow name to registry**

In `CLAUDE.md`, find the `workflow_name` registry table under `### Workflow Logging Standard` and add this row:

```
| Birthday & Anniversary Outreach | `bday_anniversary_outreach` |
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: register bday_anniversary_outreach workflow name"
```

---

## Task 2: Set Up the Google Sheet

**This is a manual step performed outside n8n/code.**

- [ ] **Step 1: Create the sheet**

Create a new Google Sheet titled `Norr AI — Birthday & Anniversary — [Agent Name]`.

Add these exact column headers in row 1 (order matters — the n8n node will reference by name):

```
lead_name | email | phone | birthday | transaction_anniversary | property_address | birthday_sent_year | anniversary_sent_year
```

- [ ] **Step 2: Set column formats**

Set the `birthday` column to Plain Text (not Date) — values must be stored as `MM-DD` strings (e.g. `03-15`).

Set the `transaction_anniversary` column to Plain Text — values stored as `YYYY-MM-DD` (e.g. `2021-07-22`).

Set `birthday_sent_year` and `anniversary_sent_year` to Plain Text — values stored as 4-digit year string (e.g. `2026`).

- [ ] **Step 3: Share with n8n service account**

In n8n → Credentials → Google Sheets OAuth2 (or Service Account) — find the service account email (e.g. `n8n-service@project.iam.gserviceaccount.com`).

In Google Sheets → Share → add that email with Editor access.

Copy the Sheet ID from the URL: `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID_HERE/edit`

- [ ] **Step 4: Add one test row**

Add a row with a `birthday` value matching today's MM-DD (e.g. if today is May 13, enter `05-13`). Fill in a real email address (yours) to receive the test message. Leave `birthday_sent_year` blank.

Example test row:
```
Sarah Johnson | your@email.com | 5075551234 | 05-13 | 2021-05-13 | 412 Oak St, Faribault MN | |
```

---

## Task 3: Write the Workflow JSON

**Files:**
- Create: `n8n/workflows/Birthday & Anniversary Outreach.json`

- [ ] **Step 1: Write the complete workflow JSON**

Create `n8n/workflows/Birthday & Anniversary Outreach.json` with the following content. Replace the four placeholder values before importing:
- `SPREADSHEET_ID_HERE` (two occurrences — Read Sheet and Update Sent Year nodes)
- `AGENT_FIRST_NAME` (e.g. `Mike`)
- `AGENT_EMAIL_HERE` (e.g. `mike@realty.com` — used as reply-to)
- `CLIENT_UUID_HERE` (two occurrences — Log Triggered and Log Completed SQL — look up from Neon `clients` table)

```json
{
  "name": "Birthday & Anniversary Outreach",
  "nodes": [
    {
      "id": "bday-0001-0001-0001-000000000001",
      "name": "Schedule Trigger",
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1.2,
      "position": [0, 240],
      "parameters": {
        "rule": {
          "interval": [
            {
              "field": "cronExpression",
              "expression": "0 14 * * *"
            }
          ]
        }
      }
    },
    {
      "id": "bday-0002-0002-0002-000000000002",
      "name": "Set Agent Config",
      "type": "n8n-nodes-base.set",
      "typeVersion": 3.4,
      "position": [220, 240],
      "parameters": {
        "mode": "manual",
        "assignments": {
          "assignments": [
            {
              "id": "bday-assign-001",
              "name": "agent_name",
              "value": "AGENT_FIRST_NAME",
              "type": "string"
            },
            {
              "id": "bday-assign-002",
              "name": "agent_email",
              "value": "AGENT_EMAIL_HERE",
              "type": "string"
            },
            {
              "id": "bday-assign-003",
              "name": "client_id",
              "value": "CLIENT_UUID_HERE",
              "type": "string"
            }
          ]
        }
      }
    },
    {
      "id": "bday-0003-0003-0003-000000000003",
      "name": "Log Triggered",
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2.5,
      "position": [440, 240],
      "continueOnFail": true,
      "parameters": {
        "operation": "executeQuery",
        "query": "INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('CLIENT_UUID_HERE', 'bday_anniversary_outreach', 'triggered', '{\"execution_id\": \"{{ $execution.id }}\"}'::jsonb)"
      },
      "credentials": {
        "postgres": {
          "id": "POSTGRES_CREDENTIAL_ID",
          "name": "Neon"
        }
      }
    },
    {
      "id": "bday-0004-0004-0004-000000000004",
      "name": "Get Today",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [660, 240],
      "parameters": {
        "jsCode": "const now = new Date();\nconst parts = now.toLocaleString('en-US', {\n  timeZone: 'America/Chicago',\n  hour12: false\n}).split(', ');\nconst dateParts = parts[0].split('/');\nconst month = dateParts[0].padStart(2, '0');\nconst day = dateParts[1].padStart(2, '0');\nconst year = dateParts[2];\nreturn [{\n  json: {\n    today_mmdd: `${month}-${day}`,\n    today_yyyy: year\n  }\n}];"
      }
    },
    {
      "id": "bday-0005-0005-0005-000000000005",
      "name": "Read Sheet",
      "type": "n8n-nodes-base.googleSheets",
      "typeVersion": 4.5,
      "position": [880, 240],
      "parameters": {
        "operation": "read",
        "documentId": {
          "__rl": true,
          "value": "SPREADSHEET_ID_HERE",
          "mode": "id"
        },
        "sheetName": {
          "__rl": true,
          "value": "Sheet1",
          "mode": "name"
        },
        "filtersUI": {},
        "options": {}
      },
      "credentials": {
        "googleSheetsOAuth2Api": {
          "id": "GOOGLE_SHEETS_CREDENTIAL_ID",
          "name": "Google Sheets"
        }
      }
    },
    {
      "id": "bday-0006-0006-0006-000000000006",
      "name": "Filter Matches",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1100, 240],
      "parameters": {
        "mode": "runOnceForAllItems",
        "jsCode": "const todayMmdd = $('Get Today').first().json.today_mmdd;\nconst todayYyyy = $('Get Today').first().json.today_yyyy;\nconst rows = $input.all();\n\nconst matches = rows.filter(row => {\n  const bday = String(row.json.birthday || '').trim();\n  const anniv = String(row.json.transaction_anniversary || '').trim();\n  const bdaySentYear = String(row.json.birthday_sent_year || '').trim();\n  const annexSentYear = String(row.json.anniversary_sent_year || '').trim();\n\n  const bdayMatch = bday !== '' && bday === todayMmdd && bdaySentYear !== todayYyyy;\n  const annexMatch = anniv !== '' && anniv.slice(5, 10) === todayMmdd && annexSentYear !== todayYyyy;\n\n  return bdayMatch || annexMatch;\n});\n\nreturn matches;"
      }
    },
    {
      "id": "bday-0007-0007-0007-000000000007",
      "name": "Split In Batches",
      "type": "n8n-nodes-base.splitInBatches",
      "typeVersion": 3,
      "position": [1320, 240],
      "parameters": {
        "batchSize": 1,
        "options": {}
      }
    },
    {
      "id": "bday-0008-0008-0008-000000000008",
      "name": "Build Prompt",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1540, 120],
      "parameters": {
        "jsCode": "const row = $input.first().json;\nconst agentName = $('Set Agent Config').first().json.agent_name;\nconst todayMmdd = $('Get Today').first().json.today_mmdd;\nconst todayYyyy = $('Get Today').first().json.today_yyyy;\n\nconst bday = String(row.birthday || '').trim();\nconst anniv = String(row.transaction_anniversary || '').trim();\nconst bdaySentYear = String(row.birthday_sent_year || '').trim();\nconst annexSentYear = String(row.anniversary_sent_year || '').trim();\n\nconst isBday = bday !== '' && bday === todayMmdd && bdaySentYear !== todayYyyy;\nconst isAnniv = anniv !== '' && anniv.slice(5, 10) === todayMmdd && annexSentYear !== todayYyyy;\n\nlet eventType;\nif (isBday && isAnniv) eventType = 'BIRTHDAY AND ANNIVERSARY';\nelse if (isBday) eventType = 'BIRTHDAY';\nelse eventType = 'TRANSACTION ANNIVERSARY';\n\nlet yearsElapsed = '';\nif (isAnniv) {\n  const txYear = parseInt(anniv.slice(0, 4), 10);\n  yearsElapsed = parseInt(todayYyyy, 10) - txYear;\n}\n\nconst prompt = `You are drafting a brief, warm personal message from a real estate agent to a past client.\\n\\nEvent: ${eventType}\\nClient name: [DATA]${row.lead_name}[/DATA]\\n${isAnniv ? `Property address: [DATA]${row.property_address || ''}[/DATA]\\nYears since transaction: ${yearsElapsed}` : ''}\\nAgent name: [DATA]${agentName}[/DATA]\\n\\nGuidelines:\\n- Warm and personal, NOT salesy. No calls to action, no \\\"let me know if you're thinking of buying/selling.\\\"\\n- 2-3 sentences max.\\n- Birthday: simple well-wish, light warmth.\\n- Anniversary: acknowledge the milestone, reference the property, wish them well.\\n- Sign off with the agent's first name only.\\n\\nReturn exactly:\\nEMAIL_SUBJECT: ...\\nEMAIL_BODY: ...\\nSMS_TEXT: ... (under 160 characters)`;\n\nreturn [{\n  json: {\n    lead_name: row.lead_name,\n    email: row.email,\n    phone: row.phone,\n    property_address: row.property_address || '',\n    birthday_sent_year: bdaySentYear,\n    anniversary_sent_year: annexSentYear,\n    is_bday: isBday,\n    is_anniv: isAnniv,\n    event_type: eventType,\n    years_elapsed: yearsElapsed,\n    today_yyyy: todayYyyy,\n    prompt\n  }\n}];"
      }
    },
    {
      "id": "bday-0009-0009-0009-000000000009",
      "name": "Claude Haiku",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [1760, 120],
      "parameters": {
        "method": "POST",
        "url": "https://api.anthropic.com/v1/messages",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {"name": "anthropic-version", "value": "2023-06-01"},
            {"name": "content-type", "value": "application/json"}
          ]
        },
        "sendBody": true,
        "contentType": "raw",
        "body": "={{ JSON.stringify({model: 'claude-haiku-4-5-20251001', max_tokens: 400, messages: [{role: 'user', content: $json.prompt}]}) }}"
      },
      "credentials": {
        "httpHeaderAuth": {
          "id": "ANTHROPIC_CREDENTIAL_ID",
          "name": "Anthropic API Key"
        }
      }
    },
    {
      "id": "bday-0010-0010-0010-000000000010",
      "name": "Parse Response",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1980, 120],
      "parameters": {
        "jsCode": "const upstream = $('Build Prompt').first().json;\nconst raw = $input.first().json.content[0].text;\nconst cleaned = raw.replace(/```[\\w]*\\n?/g, '').trim();\n\nconst subjectMatch = cleaned.match(/EMAIL_SUBJECT:\\s*(.+)/);\nconst bodyMatch = cleaned.match(/EMAIL_BODY:\\s*([\\s\\S]+?)(?=SMS_TEXT:|$)/);\nconst smsMatch = cleaned.match(/SMS_TEXT:\\s*(.+)/);\n\nreturn [{\n  json: {\n    ...upstream,\n    email_subject: subjectMatch ? subjectMatch[1].trim() : 'Thinking of you',\n    email_body: bodyMatch ? bodyMatch[1].trim() : '',\n    sms_text: smsMatch ? smsMatch[1].trim() : ''\n  }\n}];"
      }
    },
    {
      "id": "bday-0011-0011-0011-000000000011",
      "name": "IF Has Email",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2,
      "position": [2200, 120],
      "parameters": {
        "conditions": {
          "options": {
            "caseSensitive": true,
            "leftValue": "",
            "typeValidation": "strict"
          },
          "conditions": [
            {
              "id": "bday-cond-001",
              "leftValue": "={{ $json.email }}",
              "rightValue": "",
              "operator": {
                "type": "string",
                "operation": "notEmpty"
              }
            }
          ],
          "combinator": "and"
        }
      }
    },
    {
      "id": "bday-0012-0012-0012-000000000012",
      "name": "SendGrid Email",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [2420, 0],
      "parameters": {
        "method": "POST",
        "url": "https://api.sendgrid.com/v3/mail/send",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendBody": true,
        "contentType": "raw",
        "body": "={{ JSON.stringify({personalizations: [{to: [{email: $json.email, name: $json.lead_name}]}], from: {email: 'hello@norrai.co', name: $('Set Agent Config').first().json.agent_name}, reply_to: {email: $('Set Agent Config').first().json.agent_email}, subject: $json.email_subject, content: [{type: 'text/plain', value: $json.email_body}], tracking_settings: {click_tracking: {enable: false}, open_tracking: {enable: false}}}) }}"
      },
      "credentials": {
        "httpHeaderAuth": {
          "id": "SENDGRID_CREDENTIAL_ID",
          "name": "SendGrid"
        }
      }
    },
    {
      "id": "bday-0013-0013-0013-000000000013",
      "name": "Twilio SMS",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [2640, 0],
      "disabled": true,
      "parameters": {
        "method": "POST",
        "url": "=https://api.twilio.com/2010-04-01/Accounts/TWILIO_ACCOUNT_SID/Messages.json",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpBasicAuth",
        "sendBody": true,
        "contentType": "form-urlencoded",
        "bodyParameters": {
          "parameters": [
            {"name": "From", "value": "TWILIO_FROM_NUMBER"},
            {"name": "To", "value": "={{ $('Parse Response').first().json.phone }}"},
            {"name": "Body", "value": "={{ $('Parse Response').first().json.sms_text }}"}
          ]
        }
      },
      "credentials": {
        "httpBasicAuth": {
          "id": "TWILIO_CREDENTIAL_ID",
          "name": "Twilio"
        }
      }
    },
    {
      "id": "bday-0014-0014-0014-000000000014",
      "name": "Prep Update",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [2860, 120],
      "parameters": {
        "jsCode": "const data = $('Parse Response').first().json;\nreturn [{\n  json: {\n    email: data.email,\n    birthday_sent_year: data.is_bday ? data.today_yyyy : (data.birthday_sent_year || ''),\n    anniversary_sent_year: data.is_anniv ? data.today_yyyy : (data.anniversary_sent_year || '')\n  }\n}];"
      }
    },
    {
      "id": "bday-0015-0015-0015-000000000015",
      "name": "Update Sent Year",
      "type": "n8n-nodes-base.googleSheets",
      "typeVersion": 4.5,
      "position": [3080, 120],
      "parameters": {
        "operation": "update",
        "documentId": {
          "__rl": true,
          "value": "SPREADSHEET_ID_HERE",
          "mode": "id"
        },
        "sheetName": {
          "__rl": true,
          "value": "Sheet1",
          "mode": "name"
        },
        "columns": {
          "mappingMode": "defineBelow",
          "value": {
            "email": "={{ $json.email }}",
            "birthday_sent_year": "={{ $json.birthday_sent_year }}",
            "anniversary_sent_year": "={{ $json.anniversary_sent_year }}"
          },
          "matchingColumns": ["email"],
          "schema": [
            {
              "id": "email",
              "displayName": "email",
              "required": false,
              "defaultMatch": true,
              "canBeUsedToMatch": true
            },
            {
              "id": "birthday_sent_year",
              "displayName": "birthday_sent_year",
              "required": false,
              "defaultMatch": false,
              "canBeUsedToMatch": false
            },
            {
              "id": "anniversary_sent_year",
              "displayName": "anniversary_sent_year",
              "required": false,
              "defaultMatch": false,
              "canBeUsedToMatch": false
            }
          ]
        },
        "options": {}
      },
      "credentials": {
        "googleSheetsOAuth2Api": {
          "id": "GOOGLE_SHEETS_CREDENTIAL_ID",
          "name": "Google Sheets"
        }
      }
    },
    {
      "id": "bday-0016-0016-0016-000000000016",
      "name": "Log Completed",
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2.5,
      "position": [1540, 400],
      "continueOnFail": true,
      "parameters": {
        "operation": "executeQuery",
        "query": "INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('CLIENT_UUID_HERE', 'bday_anniversary_outreach', 'completed', '{\"execution_id\": \"{{ $execution.id }}\"}'::jsonb)"
      },
      "credentials": {
        "postgres": {
          "id": "POSTGRES_CREDENTIAL_ID",
          "name": "Neon"
        }
      }
    }
  ],
  "connections": {
    "Schedule Trigger": {
      "main": [[{"node": "Set Agent Config", "type": "main", "index": 0}]]
    },
    "Set Agent Config": {
      "main": [[{"node": "Log Triggered", "type": "main", "index": 0}]]
    },
    "Log Triggered": {
      "main": [[{"node": "Get Today", "type": "main", "index": 0}]]
    },
    "Get Today": {
      "main": [[{"node": "Read Sheet", "type": "main", "index": 0}]]
    },
    "Read Sheet": {
      "main": [[{"node": "Filter Matches", "type": "main", "index": 0}]]
    },
    "Filter Matches": {
      "main": [[{"node": "Split In Batches", "type": "main", "index": 0}]]
    },
    "Split In Batches": {
      "main": [
        [{"node": "Build Prompt", "type": "main", "index": 0}],
        [{"node": "Log Completed", "type": "main", "index": 0}]
      ]
    },
    "Build Prompt": {
      "main": [[{"node": "Claude Haiku", "type": "main", "index": 0}]]
    },
    "Claude Haiku": {
      "main": [[{"node": "Parse Response", "type": "main", "index": 0}]]
    },
    "Parse Response": {
      "main": [[{"node": "IF Has Email", "type": "main", "index": 0}]]
    },
    "IF Has Email": {
      "main": [
        [{"node": "SendGrid Email", "type": "main", "index": 0}],
        [{"node": "Prep Update", "type": "main", "index": 0}]
      ]
    },
    "SendGrid Email": {
      "main": [[{"node": "Twilio SMS", "type": "main", "index": 0}]]
    },
    "Twilio SMS": {
      "main": [[{"node": "Prep Update", "type": "main", "index": 0}]]
    },
    "Prep Update": {
      "main": [[{"node": "Update Sent Year", "type": "main", "index": 0}]]
    },
    "Update Sent Year": {
      "main": [[{"node": "Split In Batches", "type": "main", "index": 0}]]
    }
  },
  "active": false,
  "settings": {
    "executionOrder": "v1"
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add "n8n/workflows/Birthday & Anniversary Outreach.json"
git commit -m "feat: add Birthday & Anniversary Outreach workflow JSON"
```

---

## Task 4: Import and Configure in n8n

**This is a manual step performed in the n8n UI.**

- [ ] **Step 1: Import the workflow**

In n8n → Workflows → Import from File → select `n8n/workflows/Birthday & Anniversary Outreach.json`.

- [ ] **Step 2: Map credentials**

After import, n8n will show credential mapping prompts. Map:
- **"Neon"** (Postgres nodes) → your existing Neon Postgres credential
- **"Google Sheets"** → your existing Google Sheets OAuth2 credential
- **"Anthropic API Key"** (Claude Haiku node) → your existing HTTP Header Auth credential with `x-api-key: sk-ant-...`
- **"SendGrid"** (SendGrid Email node) → your existing HTTP Header Auth credential with `Authorization: Bearer SG...`
- **"Twilio"** (Twilio SMS node, disabled) → create or skip for now (node is disabled)

- [ ] **Step 3: Set agent config values**

Open the **Set Agent Config** node and replace:
- `AGENT_FIRST_NAME` → agent's first name (e.g. `Mike`)
- `AGENT_EMAIL_HERE` → agent's email for reply-to (e.g. `mike@realty.com`)
- `CLIENT_UUID_HERE` → UUID from `SELECT id FROM clients WHERE business_name = 'Agent Business'`

- [ ] **Step 4: Set Sheet IDs**

Open the **Read Sheet** node → set the Spreadsheet ID to the Sheet ID copied in Task 2 Step 3.

Open the **Update Sent Year** node → set the same Spreadsheet ID.

- [ ] **Step 5: Set Postgres client_id in SQL**

Open the **Log Triggered** node → replace `CLIENT_UUID_HERE` in the SQL with the same UUID from Step 3.

Open the **Log Completed** node → replace `CLIENT_UUID_HERE` in the SQL with the same UUID.

- [ ] **Step 6: Set Error Workflow**

In workflow Settings → Error Workflow → select `Norr AI Workflow Error Logger`.

- [ ] **Step 7: Verify Twilio SMS node is disabled**

Open the **Twilio SMS** node → confirm the toggle shows "Disabled". Do not enable until Twilio number is provisioned.

---

## Task 5: Smoke Test

- [ ] **Step 1: Confirm test row is in the sheet**

The test row from Task 2 Step 4 should have today's MM-DD in the `birthday` column and `birthday_sent_year` blank.

- [ ] **Step 2: Run workflow manually**

In n8n, open the workflow → click "Test workflow" (or "Execute Workflow"). The workflow runs immediately without waiting for the 9am cron.

- [ ] **Step 3: Verify Filter Matches output**

In the execution view, click the **Filter Matches** node → confirm it shows 1 output item for the test row.

- [ ] **Step 4: Verify Build Prompt output**

Click **Build Prompt** → confirm `event_type` is `BIRTHDAY`, `is_bday` is `true`, and the `prompt` field contains a well-formed message request with the lead's name and agent name.

- [ ] **Step 5: Verify Claude Haiku output**

Click **Claude Haiku** → confirm `content[0].text` contains the three labeled fields: `EMAIL_SUBJECT:`, `EMAIL_BODY:`, `SMS_TEXT:`.

- [ ] **Step 6: Verify Parse Response output**

Click **Parse Response** → confirm `email_subject`, `email_body`, and `sms_text` are populated and look like natural messages (not salesy, 2–3 sentences max, signed with agent first name).

- [ ] **Step 7: Verify email received**

Check the inbox for the email address in the test row. Confirm you received the birthday email with the correct subject and body.

- [ ] **Step 8: Verify sheet dedup column updated**

In the Google Sheet, confirm the test row's `birthday_sent_year` column now contains `2026` (current year).

- [ ] **Step 9: Re-run and confirm dedup works**

Run the workflow manually a second time. In the **Filter Matches** node output, confirm 0 items are returned (the test row is now filtered out because `birthday_sent_year == today_yyyy`).

- [ ] **Step 10: Check workflow_events log**

Run this query against Neon to confirm both events were logged:

```sql
SELECT workflow_name, event_type, created_at
FROM workflow_events
WHERE workflow_name = 'bday_anniversary_outreach'
ORDER BY created_at DESC
LIMIT 5;
```

Expected output: rows with `triggered` and `completed` event types.

- [ ] **Step 11: Activate workflow**

In n8n, toggle the workflow to **Active**. It will now run daily at 14:00 UTC (9am CDT / 8am CST).

- [ ] **Step 12: Final commit**

```bash
git add "n8n/workflows/Birthday & Anniversary Outreach.json"
git commit -m "feat: birthday & anniversary outreach workflow — smoke tested and live"
```

---

## Notes for Future Sessions

- **Enable SMS:** Open Twilio SMS node → toggle to enabled → fill in `TWILIO_ACCOUNT_SID` and `TWILIO_FROM_NUMBER` → map Twilio credential
- **Duplicate emails in sheet:** Update Sent Year uses `email` as matching column — if two rows have the same email, both will be updated. Add a unique `contact_id` column to the sheet if this becomes an issue.
- **Multi-client:** Clone this workflow in n8n for each new real estate agent client, update Set Agent Config and Sheet ID.
