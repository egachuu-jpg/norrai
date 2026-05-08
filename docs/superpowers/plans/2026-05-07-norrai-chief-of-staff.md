# Norr AI Chief of Staff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an n8n workflow that reads open tasks from CLAUDE.md via the GitHub API and posts a formatted Slack message every Monday and Thursday at 8am CT.

**Architecture:** One n8n workflow with 5 nodes — Schedule Trigger → GitHub API fetch → Code node (parse) → Code node (build Block Kit) → Slack Incoming Webhook post. CLAUDE.md is the source of truth; no new infrastructure required.

**Tech Stack:** n8n Cloud, GitHub Contents API, Slack Incoming Webhooks, Slack Block Kit

---

## File Map

| Action | File |
|---|---|
| Create | `n8n/workflows/Norr AI Chief of Staff.json` |
| Modify | `n8n/TESTING_NOTES.md` |

---

## Task 1: Create Slack Incoming Webhook

**Files:** None (manual setup in Slack)

This creates the delivery endpoint. The webhook URL is a secret — treat it like a password.

- [ ] **Step 1: Open Slack App Directory**

  Go to your Slack workspace → **Apps** → search for **Incoming WebHooks** → click **Add to Slack**.

- [ ] **Step 2: Choose a channel**

  Pick or create a channel (e.g., `#norrai-internal`). Click **Add Incoming WebHooks Integration**.

- [ ] **Step 3: Copy the webhook URL**

  The URL looks like: `https://hooks.slack.com/services/T.../B.../...`

  Copy it — you'll paste it into the n8n workflow in Task 5.

---

## Task 2: Create GitHub Personal Access Token

**Files:** None (manual setup on GitHub)

The workflow needs read access to the private repo to fetch CLAUDE.md.

- [ ] **Step 1: Open GitHub token settings**

  GitHub → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.

- [ ] **Step 2: Configure the token**

  | Field | Value |
  |---|---|
  | Token name | `norrai-n8n-read` |
  | Expiration | 1 year |
  | Repository access | Only selected repositories → `egachuu-jpg/norrai` |
  | Repository permissions | **Contents: Read-only** |

  All other permissions: No access.

- [ ] **Step 3: Copy the token**

  The token starts with `github_pat_`. Copy it immediately — GitHub will not show it again.

---

## Task 3: Add GitHub PAT Credential to n8n

**Files:** None (manual setup in n8n Cloud)

- [ ] **Step 1: Open n8n credentials**

  In n8n Cloud → **Credentials** → **Add credential** → search for **Header Auth**.

- [ ] **Step 2: Fill in the credential**

  | Field | Value |
  |---|---|
  | Credential name | `GitHub PAT` |
  | Name | `Authorization` |
  | Value | `token github_pat_YOUR_TOKEN_HERE` |

  Note the format: the word `token` followed by a space, then the PAT. Click **Save**.

- [ ] **Step 3: Note the credential ID**

  After saving, open the credential again. The ID is in the URL: `https://app.n8n.cloud/.../credentials/THE_ID_IS_HERE/edit`.

  Copy this ID — you'll need it when importing the workflow JSON in Task 5.

---

## Task 4: Write Workflow JSON and Commit

**Files:**
- Create: `n8n/workflows/Norr AI Chief of Staff.json`

The complete workflow JSON. The two Code node `jsCode` fields contain the parser and message builder logic — do not simplify or compress them.

- [ ] **Step 1: Create the workflow JSON file**

  Create `n8n/workflows/Norr AI Chief of Staff.json` with this exact content:

  ```json
  {
    "name": "Norr AI Chief of Staff",
    "nodes": [
      {
        "parameters": {
          "rule": {
            "interval": [
              {
                "field": "cronExpression",
                "expression": "0 13 * * 1,4"
              }
            ]
          }
        },
        "id": "node-schedule-001",
        "name": "Schedule",
        "type": "n8n-nodes-base.scheduleTrigger",
        "typeVersion": 1.2,
        "position": [240, 300]
      },
      {
        "parameters": {
          "url": "https://api.github.com/repos/egachuu-jpg/norrai/contents/CLAUDE.md",
          "authentication": "predefinedCredentialType",
          "nodeCredentialType": "httpHeaderAuth",
          "sendHeaders": true,
          "headerParameters": {
            "parameters": [
              {
                "name": "Accept",
                "value": "application/vnd.github.v3+json"
              }
            ]
          },
          "options": {}
        },
        "id": "node-github-001",
        "name": "Fetch CLAUDE.md",
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.2,
        "position": [460, 300],
        "credentials": {
          "httpHeaderAuth": {
            "id": "GITHUB_CREDENTIAL_ID",
            "name": "GitHub PAT"
          }
        }
      },
      {
        "parameters": {
          "jsCode": "const rawContent = Buffer.from($json.content, 'base64').toString('utf-8');\n\nconst openTasksMatch = rawContent.match(/## Open Tasks([\\s\\S]*?)(?=\\n## |\\n---\\n|\\n# |$)/);\nif (!openTasksMatch) {\n  return [{ json: { sections: {} } }];\n}\n\nconst openTasksContent = openTasksMatch[1];\nconst sections = {};\nlet currentSection = 'General';\n\nfor (const line of openTasksContent.split('\\n')) {\n  const trimmed = line.trim();\n  if (trimmed.startsWith('### ')) {\n    currentSection = trimmed.replace('### ', '');\n  } else if (trimmed.startsWith('- [ ]')) {\n    const task = trimmed.replace(/^- \\[ \\] /, '');\n    if (!sections[currentSection]) sections[currentSection] = [];\n    sections[currentSection].push(task);\n  }\n}\n\nreturn [{ json: { sections } }];"
        },
        "id": "node-parse-001",
        "name": "Parse Tasks",
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [680, 300]
      },
      {
        "parameters": {
          "jsCode": "const sections = $json.sections;\nconst today = new Date().toLocaleDateString('en-US', {\n  weekday: 'short',\n  year: 'numeric',\n  month: 'short',\n  day: 'numeric',\n  timeZone: 'America/Chicago'\n});\n\nconst MAX_ITEMS = 5;\n\nconst blocks = [\n  {\n    type: 'header',\n    text: { type: 'plain_text', text: `Norr AI — Open Tasks  |  ${today}`, emoji: false }\n  },\n  { type: 'divider' }\n];\n\nfor (const [sectionName, tasks] of Object.entries(sections)) {\n  if (!tasks || tasks.length === 0) continue;\n  const displayed = tasks.slice(0, MAX_ITEMS);\n  const remaining = tasks.length - MAX_ITEMS;\n  let text = `*${sectionName}*\\n`;\n  text += displayed.map(t => `• ${t}`).join('\\n');\n  if (remaining > 0) text += `\\n_+ ${remaining} more_`;\n  blocks.push({\n    type: 'section',\n    text: { type: 'mrkdwn', text }\n  });\n}\n\nreturn [{ json: { blocks } }];"
        },
        "id": "node-slack-build-001",
        "name": "Build Slack Message",
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [900, 300]
      },
      {
        "parameters": {
          "url": "SLACK_WEBHOOK_URL",
          "method": "POST",
          "sendBody": true,
          "contentType": "raw",
          "rawContentType": "application/json",
          "body": "={{ JSON.stringify({ blocks: $json.blocks }) }}",
          "options": {}
        },
        "id": "node-slack-post-001",
        "name": "Post to Slack",
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.2,
        "position": [1120, 300]
      }
    ],
    "connections": {
      "Schedule": {
        "main": [[{"node": "Fetch CLAUDE.md", "type": "main", "index": 0}]]
      },
      "Fetch CLAUDE.md": {
        "main": [[{"node": "Parse Tasks", "type": "main", "index": 0}]]
      },
      "Parse Tasks": {
        "main": [[{"node": "Build Slack Message", "type": "main", "index": 0}]]
      },
      "Build Slack Message": {
        "main": [[{"node": "Post to Slack", "type": "main", "index": 0}]]
      }
    },
    "active": false,
    "settings": {
      "executionOrder": "v1"
    },
    "meta": {
      "templateCredsSetupCompleted": true
    },
    "pinData": {}
  }
  ```

- [ ] **Step 2: Commit the file**

  ```bash
  git add "n8n/workflows/Norr AI Chief of Staff.json"
  git commit -m "feat: add Norr AI Chief of Staff n8n workflow"
  ```

---

## Task 5: Add Smoke Test Instructions to TESTING_NOTES.md

**Files:**
- Modify: `n8n/TESTING_NOTES.md`

- [ ] **Step 1: Add Chief of Staff section to TESTING_NOTES.md**

  Append the following section to `n8n/TESTING_NOTES.md`:

  ```markdown
  ---

  ## Norr AI Chief of Staff

  **Workflow:** `Norr AI Chief of Staff.json`
  **Trigger:** Schedule — Mon + Thu 8am CT (`0 13 * * 1,4` UTC)

  ### Import Checklist
  - [ ] Import `n8n/workflows/Norr AI Chief of Staff.json`
  - [ ] Open **Fetch CLAUDE.md** node → Credential → select "GitHub PAT" (created in setup)
  - [ ] Open **Post to Slack** node → URL field → replace `SLACK_WEBHOOK_URL` with the actual Slack Incoming Webhook URL
  - [ ] Save the workflow

  ### Smoke Test
  1. In n8n, open the workflow and click **Test workflow** (manual trigger)
  2. Watch execution flow through all 5 nodes — all should show green
  3. Open the Slack channel — message should arrive within a few seconds
  4. Verify message structure:
     - Header shows "Norr AI — Open Tasks | [today's date]"
     - Each subsection (Immediate, Security, Near Term, etc.) appears as a bold label
     - Tasks listed as bullet points
     - Sections with >5 items show "+ N more"
     - No `- [x]` completed items appear

  ### Activate for Production
  - [ ] Toggle workflow to **Active** — n8n will fire on the cron schedule going forward
  - [ ] Confirm first scheduled run arrives the next Mon or Thu at 8am CT

  ### Known Gaps
  - Cron `0 13 * * 1,4` fires at 8am CST (winter) / 7am CDT (summer) — one hour drift in summer due to DST. Acceptable for internal reminders.
  - No retry logic if GitHub API or Slack is temporarily unavailable.
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add n8n/TESTING_NOTES.md
  git commit -m "docs: add Chief of Staff smoke test instructions to TESTING_NOTES"
  ```

---

## Task 6: Import Into n8n, Configure, and Smoke Test

**Files:** None (manual steps in n8n Cloud)

- [ ] **Step 1: Import the workflow**

  n8n Cloud → **Workflows** → **Add workflow** → **Import from file** → select `n8n/workflows/Norr AI Chief of Staff.json`.

- [ ] **Step 2: Fix the GitHub credential**

  Open the **Fetch CLAUDE.md** node. Under **Credential for Header Auth**, the dropdown will show an error (credential ID mismatch from import). Select **GitHub PAT** from the dropdown. Save.

- [ ] **Step 3: Set the Slack webhook URL**

  Open the **Post to Slack** node. In the **URL** field, replace `SLACK_WEBHOOK_URL` with your actual Slack Incoming Webhook URL. Save.

- [ ] **Step 4: Run the manual test**

  Click **Test workflow**. Watch each node execute. All 5 nodes should turn green.

  If the **Fetch CLAUDE.md** node fails with 401: the GitHub PAT credential is misconfigured — check that the Authorization value is `token github_pat_...` (not `Bearer ...`).

  If the **Post to Slack** node fails with 403 or 404: the webhook URL is wrong or the Slack app was removed — regenerate the webhook URL in Slack.

- [ ] **Step 5: Verify the Slack message**

  Open the Slack channel. Confirm:
  - Header with today's date
  - At least one task section visible
  - No completed (`[x]`) tasks appear

- [ ] **Step 6: Activate the workflow**

  Toggle the workflow to **Active**. It will now fire automatically every Monday and Thursday at 8am CT.

---

## Self-Review

**Spec coverage:**
- Schedule trigger Mon + Thu 8am CT: Task 4 (cron `0 13 * * 1,4`)
- GitHub API fetch CLAUDE.md: Task 4 (Fetch CLAUDE.md node)
- Parse `- [ ]` items by subsection: Task 4 (Parse Tasks jsCode)
- Block Kit message with 5-item truncation: Task 4 (Build Slack Message jsCode)
- Slack Incoming Webhook delivery: Task 4 (Post to Slack node)
- Credentials stored separately, not in JSON: Task 3 (GitHub PAT), Task 6 Step 3 (Slack URL)

**All spec requirements covered. No gaps.**
