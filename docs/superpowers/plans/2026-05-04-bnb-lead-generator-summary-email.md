# B&B Lead Generator — Summary Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the B&B Lead Generator workflow to accumulate all qualified leads during the loop and send one summary email after the loop completes, replacing the current one-email-per-lead pattern.

**Architecture:** New Code nodes accumulate qualified leads in n8n static data during the SplitInBatches loop. The SplitInBatches "done" output triggers a Build Summary Email node that reads static data, constructs a single HTML email body, and passes it to SendGrid. A Postgres node logs all qualified leads and a `workflow_events` row in one write at the end.

**Tech Stack:** n8n Cloud, n8n static data (`$getWorkflowStaticData`), SendGrid, Neon Postgres

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `n8n/workflows/B&B Lead Generator.json` | Modify | Replace workflow with 16-node version |
| `n8n/TESTING_NOTES.md` | Modify | Update known bugs and test checklist |

---

### Task 1: Write the updated workflow JSON

**Files:**
- Modify: `n8n/workflows/B&B Lead Generator.json`

Read the current file first. Then replace the entire file with the JSON below.

**Node changes from current:**

| Node | Change |
|------|--------|
| Initialize Accumulator | NEW — code node inserted between Schedule and Search Apollo |
| Filter and Dedup | UPDATED — stores apolloReturned/afterDedup in static data |
| Accumulate Lead | NEW — replaces "Restore Lead Fields" Set node; pushes lead to static data; loops back |
| Build Summary Email | NEW — on Split by Lead done output; reads static data, builds subject + body |
| Send Review Email | UPDATED — subject/body now come from `$json.subject` / `$json.body` |
| Build Neon Insert | NEW — code node that constructs multi-row INSERT SQL from static data |
| Log All to Neon | NEW — postgres executeQuery node that runs the SQL |
| Send Review Email (old, in loop) | REMOVED from loop — moved to post-loop |
| Log Lead to Neon (old, in loop) | REMOVED — replaced by post-loop Log All to Neon |

**Key code for each new/updated node:**

**Initialize Accumulator (jsCode):**
```js
const staticData = $getWorkflowStaticData('global');
staticData.qualifiedLeads = [];
staticData.apolloReturned = 0;
staticData.afterDedup = 0;
return $input.all();
```

**Filter and Dedup (jsCode) — add 4 lines before the return:**
```js
// ... existing exclusion logic unchanged above this point ...

const filtered = contacts.filter(c => !isExcluded(c));

// Store run stats for post-loop summary
const staticData = $getWorkflowStaticData('global');
staticData.apolloReturned = contacts.length;
staticData.afterDedup = filtered.length;

return filtered.map(c => ({
  json: {
    first_name: c.first_name || '',
    last_name: c.last_name || '',
    full_name: `${c.first_name || ''} ${c.last_name || ''}`.trim(),
    title: c.title || '',
    email: c.email || '',
    company: c.organization_name || '',
    website: c.organization_website_url || '',
    city: c.city || '',
    state: c.state || ''
  }
}));
```

**Accumulate Lead (jsCode):**
```js
const lead = $input.first().json;

const staticData = $getWorkflowStaticData('global');
if (!Array.isArray(staticData.qualifiedLeads)) {
  staticData.qualifiedLeads = [];
}
staticData.qualifiedLeads.push({
  first_name: lead.first_name,
  last_name: lead.last_name,
  full_name: lead.full_name,
  title: lead.title,
  email: lead.email,
  company: lead.company,
  city: lead.city,
  state: lead.state,
  score: lead.score,
  reason: lead.reason,
  draft: lead.draft
});

return [{ json: lead }];
```

**Build Summary Email (jsCode):**
```js
const staticData = $getWorkflowStaticData('global');
const leads = staticData.qualifiedLeads || [];
const runDate = new Date().toLocaleDateString('en-US', {
  timeZone: 'America/Chicago',
  month: 'long',
  day: 'numeric',
  year: 'numeric'
});

let subject, body;

if (leads.length === 0) {
  subject = `B&B Lead Prospects — Week of ${runDate} (0 qualified)`;
  body = 'The workflow ran but no leads scored 8 or above this week.';
} else {
  subject = `B&B Lead Prospects — Week of ${runDate} (${leads.length} qualified)`;
  const divider = '─────────────────────────────';
  const sections = leads.map((lead, i) =>
    `${divider}\n` +
    `Lead ${i + 1} of ${leads.length}\n` +
    `${lead.full_name} — ${lead.title} at ${lead.company}, ${lead.city}, ${lead.state}\n` +
    `Score: ${lead.score}/10 — ${lead.reason}\n` +
    `Email: ${lead.email}\n\n` +
    `Drafted outreach:\n${lead.draft}\n` +
    divider
  ).join('\n\n');
  body = `${leads.length} lead${leads.length === 1 ? '' : 's'} qualified this week. Review each draft below and send from your own email.\n\n${sections}`;
}

return [{ json: { subject, body } }];
```

**Build Neon Insert (jsCode):**
```js
const staticData = $getWorkflowStaticData('global');
const leads = staticData.qualifiedLeads || [];

const queries = [];

if (leads.length > 0) {
  const values = leads.map(l => {
    const name = (l.full_name || '').replace(/'/g, "''");
    const email = (l.email || '').replace(/'/g, "''");
    const draft = (l.draft || '').replace(/'/g, "''");
    const meta = JSON.stringify({
      company: l.company || '',
      title: l.title || '',
      location: `${l.city || ''}, ${l.state || ''}`,
      apollo_score: l.score,
      score_reason: l.reason || '',
      draft_sent: true
    }).replace(/'/g, "''");
    return `('86a01b94-ddab-4594-8afc-8212fb18fdd0', '${name}', '${email}', NULL, 'bnb_lead_generator', '${draft}', '${meta}'::jsonb, NOW())`;
  });
  queries.push(
    `INSERT INTO leads (client_id, lead_name, email, phone, source, lead_message, metadata, created_at) VALUES ${values.join(', ')}`
  );
}

const eventsMeta = JSON.stringify({
  apollo_returned: staticData.apolloReturned || 0,
  after_dedup: staticData.afterDedup || 0,
  qualified: leads.length,
  run_date: new Date().toISOString().split('T')[0]
}).replace(/'/g, "''");

queries.push(
  `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('86a01b94-ddab-4594-8afc-8212fb18fdd0', 'bnb_lead_generator', 'completed', '${eventsMeta}'::jsonb)`
);

return [{ json: { query: queries.join('; ') } }];
```

- [ ] **Step 1: Write the complete updated workflow JSON**

Replace `n8n/workflows/B&B Lead Generator.json` entirely with:

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
        "jsCode": "const staticData = $getWorkflowStaticData('global');\nstaticData.qualifiedLeads = [];\nstaticData.apolloReturned = 0;\nstaticData.afterDedup = 0;\nreturn $input.all();"
      },
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [380, 300],
      "id": "b3b4c5d6-0013-4000-8000-000000000013",
      "name": "Initialize Accumulator"
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
      "position": [560, 300],
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
      "position": [760, 300],
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
        "jsCode": "const apolloData = $('Search Apollo').first().json;\nconst contacts = apolloData.people || [];\n\nconst exclusionRows = $input.all().map(item => item.json);\n\nconst excludedNames = exclusionRows\n  .map(r => (r.company_name || '').toLowerCase().trim())\n  .filter(Boolean);\nconst excludedDomains = exclusionRows\n  .map(r => (r.domain || '').toLowerCase().replace(/^www\\./, '').trim())\n  .filter(Boolean);\n\nfunction isExcluded(contact) {\n  const name = (contact.organization_name || '').toLowerCase();\n  const rawUrl = (contact.organization_website_url || '').toLowerCase();\n  const domain = rawUrl\n    .replace(/^https?:\\/\\//, '')\n    .replace(/^www\\./, '')\n    .split('/')[0];\n  return (\n    excludedNames.some(n => n && name.includes(n)) ||\n    excludedDomains.some(d => d && domain.includes(d))\n  );\n}\n\n// TODO: replace Google Sheet check with JobBOSS API lookup when integration is ready\n\nconst filtered = contacts.filter(c => !isExcluded(c));\n\nconst staticData = $getWorkflowStaticData('global');\nstaticData.apolloReturned = contacts.length;\nstaticData.afterDedup = filtered.length;\n\nreturn filtered.map(c => ({\n  json: {\n    first_name: c.first_name || '',\n    last_name: c.last_name || '',\n    full_name: `${c.first_name || ''} ${c.last_name || ''}`.trim(),\n    title: c.title || '',\n    email: c.email || '',\n    company: c.organization_name || '',\n    website: c.organization_website_url || '',\n    city: c.city || '',\n    state: c.state || ''\n  }\n}));"
      },
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [960, 300],
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
      "position": [1160, 300],
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
      "position": [1380, 300],
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
        "jsCode": "const claudeResponse = $input.first().json;\nlet score = 0;\nlet reason = 'Claude returned malformed JSON — skipping this lead';\ntry {\n  const text = claudeResponse.content[0].text.trim();\n  const parsed = JSON.parse(text);\n  score = parsed.score;\n  reason = parsed.reason;\n} catch (e) {\n  // score stays 0, IF node routes to false branch and silently drops this lead\n}\n\nconst lead = $('Split by Lead').item.json;\n\nreturn [{\n  json: {\n    first_name: lead.first_name,\n    last_name: lead.last_name,\n    full_name: lead.full_name,\n    title: lead.title,\n    email: lead.email,\n    company: lead.company,\n    website: lead.website,\n    city: lead.city,\n    state: lead.state,\n    score,\n    reason\n  }\n}];"
      },
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1580, 300],
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
        "jsCode": "const claudeResponse = $input.first().json;\nconst draft = claudeResponse.content[0].text.trim();\n\nconst lead = $('Parse Score').item.json;\n\nreturn [{\n  json: {\n    first_name: lead.first_name,\n    last_name: lead.last_name,\n    full_name: lead.full_name,\n    title: lead.title,\n    email: lead.email,\n    company: lead.company,\n    city: lead.city,\n    state: lead.state,\n    score: lead.score,\n    reason: lead.reason,\n    draft\n  }\n}];"
      },
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [2220, 200],
      "id": "b3b4c5d6-0010-4000-8000-000000000010",
      "name": "Parse Draft"
    },
    {
      "parameters": {
        "jsCode": "const lead = $input.first().json;\n\nconst staticData = $getWorkflowStaticData('global');\nif (!Array.isArray(staticData.qualifiedLeads)) {\n  staticData.qualifiedLeads = [];\n}\nstaticData.qualifiedLeads.push({\n  first_name: lead.first_name,\n  last_name: lead.last_name,\n  full_name: lead.full_name,\n  title: lead.title,\n  email: lead.email,\n  company: lead.company,\n  city: lead.city,\n  state: lead.state,\n  score: lead.score,\n  reason: lead.reason,\n  draft: lead.draft\n});\n\nreturn [{ json: lead }];"
      },
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [2440, 200],
      "id": "b3b4c5d6-0014-4000-8000-000000000014",
      "name": "Accumulate Lead"
    },
    {
      "parameters": {
        "jsCode": "const staticData = $getWorkflowStaticData('global');\nconst leads = staticData.qualifiedLeads || [];\nconst runDate = new Date().toLocaleDateString('en-US', {\n  timeZone: 'America/Chicago',\n  month: 'long',\n  day: 'numeric',\n  year: 'numeric'\n});\n\nlet subject, body;\n\nif (leads.length === 0) {\n  subject = `B&B Lead Prospects \\u2014 Week of ${runDate} (0 qualified)`;\n  body = 'The workflow ran but no leads scored 8 or above this week.';\n} else {\n  subject = `B&B Lead Prospects \\u2014 Week of ${runDate} (${leads.length} qualified)`;\n  const divider = '\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500';\n  const sections = leads.map((lead, i) =>\n    `${divider}\\n` +\n    `Lead ${i + 1} of ${leads.length}\\n` +\n    `${lead.full_name} \\u2014 ${lead.title} at ${lead.company}, ${lead.city}, ${lead.state}\\n` +\n    `Score: ${lead.score}/10 \\u2014 ${lead.reason}\\n` +\n    `Email: ${lead.email}\\n\\n` +\n    `Drafted outreach:\\n${lead.draft}\\n` +\n    divider\n  ).join('\\n\\n');\n  body = `${leads.length} lead${leads.length === 1 ? '' : 's'} qualified this week. Review each draft below and send from your own email.\\n\\n${sections}`;\n}\n\nreturn [{ json: { subject, body } }];"
      },
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1380, 500],
      "id": "b3b4c5d6-0015-4000-8000-000000000015",
      "name": "Build Summary Email"
    },
    {
      "parameters": {
        "resource": "mail",
        "fromEmail": "hello@norrai.co",
        "fromName": "Norr AI",
        "toEmail": "egachuu@gmail.com",
        "subject": "={{ $json.subject }}",
        "contentValue": "={{ $json.body }}",
        "additionalFields": {}
      },
      "type": "n8n-nodes-base.sendGrid",
      "typeVersion": 1,
      "position": [1580, 500],
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
        "jsCode": "const staticData = $getWorkflowStaticData('global');\nconst leads = staticData.qualifiedLeads || [];\n\nconst queries = [];\n\nif (leads.length > 0) {\n  const values = leads.map(l => {\n    const name = (l.full_name || '').replace(/'/g, \"''\");\n    const email = (l.email || '').replace(/'/g, \"''\");\n    const draft = (l.draft || '').replace(/'/g, \"''\");\n    const meta = JSON.stringify({\n      company: l.company || '',\n      title: l.title || '',\n      location: `${l.city || ''}, ${l.state || ''}`,\n      apollo_score: l.score,\n      score_reason: l.reason || '',\n      draft_sent: true\n    }).replace(/'/g, \"''\");\n    return `('86a01b94-ddab-4594-8afc-8212fb18fdd0', '${name}', '${email}', NULL, 'bnb_lead_generator', '${draft}', '${meta}'::jsonb, NOW())`;\n  });\n  queries.push(\n    `INSERT INTO leads (client_id, lead_name, email, phone, source, lead_message, metadata, created_at) VALUES ${values.join(', ')}`\n  );\n}\n\nconst eventsMeta = JSON.stringify({\n  apollo_returned: staticData.apolloReturned || 0,\n  after_dedup: staticData.afterDedup || 0,\n  qualified: leads.length,\n  run_date: new Date().toISOString().split('T')[0]\n}).replace(/'/g, \"''\");\n\nqueries.push(\n  `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('86a01b94-ddab-4594-8afc-8212fb18fdd0', 'bnb_lead_generator', 'completed', '${eventsMeta}'::jsonb)`\n);\n\nreturn [{ json: { query: queries.join('; ') } }];"
      },
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1780, 500],
      "id": "b3b4c5d6-0016-4000-8000-000000000016",
      "name": "Build Neon Insert"
    },
    {
      "parameters": {
        "operation": "executeQuery",
        "query": "={{ $json.query }}"
      },
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2.5,
      "position": [1980, 500],
      "id": "b3b4c5d6-0017-4000-8000-000000000017",
      "name": "Log All to Neon",
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
      "main": [[{"node": "Initialize Accumulator", "type": "main", "index": 0}]]
    },
    "Initialize Accumulator": {
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
      "main": [
        [{"node": "Score with Claude", "type": "main", "index": 0}],
        [{"node": "Build Summary Email", "type": "main", "index": 0}]
      ]
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
        [{"node": "Split by Lead", "type": "main", "index": 0}]
      ]
    },
    "Draft Outreach": {
      "main": [[{"node": "Parse Draft", "type": "main", "index": 0}]]
    },
    "Parse Draft": {
      "main": [[{"node": "Accumulate Lead", "type": "main", "index": 0}]]
    },
    "Accumulate Lead": {
      "main": [[{"node": "Split by Lead", "type": "main", "index": 0}]]
    },
    "Build Summary Email": {
      "main": [[{"node": "Send Review Email", "type": "main", "index": 0}]]
    },
    "Send Review Email": {
      "main": [[{"node": "Build Neon Insert", "type": "main", "index": 0}]]
    },
    "Build Neon Insert": {
      "main": [[{"node": "Log All to Neon", "type": "main", "index": 0}]]
    }
  },
  "active": false,
  "settings": {
    "executionOrder": "v1",
    "saveManualExecutions": true
  },
  "versionId": "bnb-lead-gen-v2-001",
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
git commit -m "feat: refactor B&B lead generator to send one summary email per run"
```

---

### Task 2: Update TESTING_NOTES.md

**Files:**
- Modify: `n8n/TESTING_NOTES.md`

Read the file first. Find the `### Test checklist` section under `## B&B Lead Generator` and replace it with the updated version below.

- [ ] **Step 1: Replace the test checklist**

Find:
```markdown
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
```

Replace with:
```markdown
### Credentials to re-link after import

After importing the new JSON, re-link these credentials in n8n (node IDs changed):
- Search Apollo → HTTP Header Auth (Apollo API Key)
- Read Exclusion Sheet → Google Sheets OAuth2
- Score with Claude → Anthropic account 2
- Draft Outreach → Anthropic account 2
- Send Review Email → SendGrid account
- Log All to Neon → Postgres account (Neon)

### Test checklist

- [ ] Import new workflow JSON, re-link all 6 credentials
- [ ] Update spreadsheet ID in Read Exclusion Sheet node
- [ ] Manually trigger — confirm Initialize Accumulator runs first (check execution output)
- [ ] Confirm Filter and Dedup stores apolloReturned/afterDedup (check staticData in execution)
- [ ] Confirm excluded companies are filtered out
- [ ] Confirm Accumulate Lead pushes each qualified lead into staticData.qualifiedLeads
- [ ] Confirm Build Summary Email fires after loop completes (done output)
- [ ] Confirm one email arrives at egachuu@gmail.com with all leads in a single message
- [ ] If 0 leads qualify: confirm "no leads" email arrives with correct subject
- [ ] Confirm Neon `leads` table has one row per qualified lead: `SELECT * FROM leads WHERE source = 'bnb_lead_generator' ORDER BY created_at DESC;`
- [ ] Confirm Neon `workflow_events` has one row per run: `SELECT * FROM workflow_events WHERE workflow_name = 'bnb_lead_generator' ORDER BY created_at DESC;`
- [ ] Replace egachuu@gmail.com with B&B inbox before activating for production
- [ ] Activate workflow — fires automatically Monday 11am UTC
```

- [ ] **Step 2: Update the known bugs section to mark the loop issue resolved**

Find the paragraph starting `**SplitInBatches only processed one lead (2026-05-04):**` and append to the end of that paragraph:

```
 Fixed in v2 JSON.
```

- [ ] **Step 3: Commit**

```bash
git add n8n/TESTING_NOTES.md
git commit -m "docs: update B&B lead generator testing notes for v2 summary email"
```
