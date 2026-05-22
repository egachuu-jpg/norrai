# Email Triage Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a daily email triage assistant that runs at 8 PM CST across three Gmail inboxes, auto-actions newsletters/notifications/cold outreach, and routes uncertain emails to a Telegram bot for numbered-reply approval.

**Architecture:** A Schedule Trigger workflow fires at 02:00 UTC and calls a reusable sub-workflow once per inbox. Each sub-workflow fetches unread emails, runs them through Claude Haiku for classification, executes Gmail actions, and logs uncertain emails to Neon. After all three inboxes are processed, the Sweep workflow sends a Telegram digest of pending items. A second Telegram webhook workflow listens for your numbered reply and executes approved actions.

**Tech Stack:** n8n Cloud, Claude API (Haiku for classification), Gmail OAuth2 (×3), Telegram Bot API, Neon (Postgres 17)

---

## File Structure

| File | Purpose |
|---|---|
| `db/schema.sql` | Add `email_triage_queue` and `email_triage_runs` tables |
| `n8n/workflows/email_triage_sweep.json` | Exported Sweep workflow |
| `n8n/workflows/email_triage_process_inbox.json` | Exported per-inbox sub-workflow |
| `n8n/workflows/email_triage_reply.json` | Exported Telegram Reply Handler workflow |

---

## Task 1: Apply Neon Schema

**Files:**
- Modify: `db/schema.sql`

- [ ] **Step 1: Append tables to `db/schema.sql`**

```sql
-- Stores all processed emails (dedup + audit log). status = auto_actioned for acted items, pending for Telegram queue.
CREATE TABLE IF NOT EXISTS email_triage_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      TEXT NOT NULL,
  inbox           TEXT NOT NULL,
  sender          TEXT,
  subject         TEXT,
  snippet         TEXT,
  category        TEXT,
  proposed_action TEXT,
  status          TEXT DEFAULT 'auto_actioned', -- auto_actioned | pending | approved | skipped
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ,
  UNIQUE(message_id, inbox)
);

-- One row per inbox per sweep run for health monitoring.
CREATE TABLE IF NOT EXISTS email_triage_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID NOT NULL,
  inbox             TEXT NOT NULL,
  emails_processed  INT DEFAULT 0,
  auto_actioned     INT DEFAULT 0,
  queued_for_review INT DEFAULT 0,
  started_at        TIMESTAMPTZ DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_triage_queue_pending
  ON email_triage_queue(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_triage_queue_dedup
  ON email_triage_queue(message_id, inbox);
```

- [ ] **Step 2: Apply to Neon**

```bash
psql $DATABASE_URL -f db/schema.sql
```

Expected output: `CREATE TABLE`, `CREATE TABLE`, `CREATE INDEX`, `CREATE INDEX` — no errors.

- [ ] **Step 3: Smoke test**

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name LIKE 'email_triage%';
```

Expected: two rows — `email_triage_queue`, `email_triage_runs`.

- [ ] **Step 4: Commit**

```bash
git add db/schema.sql
git commit -m "feat: add email_triage_queue and email_triage_runs tables"
```

---

## Task 2: Create Telegram Bot

- [ ] **Step 1: Create bot via BotFather**

1. Open Telegram → search `@BotFather` → send `/newbot`
2. Name: `Norr AI Email Assistant`
3. Username: anything ending in `_bot` (e.g., `norrai_email_bot`)
4. Copy the **HTTP API token** — format: `7123456789:ABCdef...`

- [ ] **Step 2: Get your Telegram chat ID**

1. Send any message to the new bot.
2. Open in browser: `https://api.telegram.org/bot<TOKEN>/getUpdates`
3. Find `"chat":{"id":XXXXXXXXX}` — copy that number.

- [ ] **Step 3: Add credentials to n8n**

n8n → Settings → Credentials → New → **Telegram API**
- Name: `Telegram — Norr AI Email Bot`
- Access Token: paste the BotFather token
- Save

- [ ] **Step 4: Note values for workflow setup**

You will need these in later tasks:
- `TELEGRAM_CHAT_ID` = the number from Step 2
- `TELEGRAM_BOT_TOKEN` = the BotFather token from Step 1

---

## Task 3: Set Up Gmail OAuth Credentials in n8n

Repeat for each inbox. n8n does not support dynamic credential selection, so each inbox requires its own named credential.

- [ ] **Step 1: Create credential for `egachuu@gmail.com`**

n8n → Settings → Credentials → New → **Gmail OAuth2 API**
- Name: `Gmail — egachuu`
- Follow OAuth flow → sign in as `egachuu@gmail.com` → grant access → Save

- [ ] **Step 2: Create credential for `eganbonde@gmail.com`**

Same steps. Name: `Gmail — eganbonde`

- [ ] **Step 3: Create credential for `hello@norrai.co`**

Same steps. Name: `Gmail — hello@norrai.co`

> If `hello@norrai.co` is blocked at the OAuth consent screen (Workspace restriction), go to Google Cloud Console → APIs & Services → OAuth consent screen → add `egachuu@gmail.com` as a test user.

---

## Task 4: Build Sub-Workflow — Email Triage Process Inbox

This workflow is called once per inbox by the Sweep. It fetches unread messages, classifies each with Claude, acts on them, and logs everything to Neon.

> **n8n limitation:** Gmail credentials cannot be selected dynamically via expression. The workaround is a Switch node at the top that routes to three separate hardcoded Gmail nodes (one per credential), then merges the results.

- [ ] **Step 1: Create new workflow**

n8n → New Workflow → Name: `Email Triage — Process Inbox`

- [ ] **Step 2: Add "When Called by Another Workflow" trigger**

- Node: **Execute Workflow Trigger**
- This workflow receives two fields from the caller: `inbox` (string) and `label` (string)

- [ ] **Step 2b: Add "Log Run Start" Postgres node**

- Node: **Postgres** (`continueOnFail: true`)
- Name: `Log Run Start`
- Query:
```sql
INSERT INTO email_triage_runs (run_id, inbox, started_at)
VALUES ('{{ $execution.id }}', '{{ $json.inbox }}', NOW())
```

- [ ] **Step 3: Add "Which Inbox?" Switch node**

- Node: **Switch**
- Name: `Which Inbox?`
- Routing field: `{{ $json.inbox }}`
- Output 1: equals `egachuu@gmail.com`
- Output 2: equals `eganbonde@gmail.com`
- Output 3: equals `hello@norrai.co`

- [ ] **Step 4: Add three Gmail "Get Messages" nodes (one per output)**

For each output, add a **Gmail** node:
- Operation: **Get Many**
- Filter: Label = `UNREAD`
- Max Results: `50`
- Additional Fields → Received After: `{{ DateTime.now().minus({hours: 24}).toISO() }}`

Node names and credentials:
- Output 1 → Node: `Get Messages — egachuu` / Credential: `Gmail — egachuu`
- Output 2 → Node: `Get Messages — eganbonde` / Credential: `Gmail — eganbonde`
- Output 3 → Node: `Get Messages — hello` / Credential: `Gmail — hello@norrai.co`

- [ ] **Step 5: Merge outputs into one stream**

- Node: **Merge**
- Name: `Merge Inboxes`
- Mode: **Append**
- Connect all three Gmail nodes as inputs

- [ ] **Step 6: Add "Loop Over Emails" node**

- Node: **Split In Batches**
- Name: `Loop Over Emails`
- Batch Size: `1`

- [ ] **Step 7: Add "Dedup Check" Postgres node**

- Node: **Postgres** (`continueOnFail: true`)
- Name: `Dedup Check`
- Query:
```sql
SELECT id FROM email_triage_queue
WHERE message_id = '{{ $json.id }}'
  AND inbox = '{{ $('Execute Workflow Trigger').item.json.inbox }}'
LIMIT 1
```

- [ ] **Step 8: Add "Already Processed?" IF node**

- Node: **IF**
- Name: `Already Processed?`
- Condition: `{{ $json.id }}` is not empty
- True branch → loop back to `Loop Over Emails` (skip)
- False branch → continue to classification

- [ ] **Step 9: Add "Build Classifier Input" Set node**

- Node: **Set**
- Name: `Build Classifier Input`
- Fields to set:
  - `inbox` → `{{ $('Execute Workflow Trigger').item.json.inbox }}`
  - `message_id` → `{{ $('Loop Over Emails').item.json.id }}`
  - `sender` → `{{ $('Loop Over Emails').item.json.from }}`
  - `subject` → `{{ $('Loop Over Emails').item.json.subject }}`
  - `snippet` → `{{ $('Loop Over Emails').item.json.snippet?.slice(0, 200) ?? '' }}`

- [ ] **Step 10: Add "Build Prompt" Set node**

- Node: **Set**
- Name: `Build Prompt`
- Field `prompt` (expression, multiline):

```
You are an email triage classifier. Classify the email below into exactly one category.

INBOX: {{ $json.inbox }}
FROM: {{ $json.sender }}
SUBJECT: {{ $json.subject }}
SNIPPET: {{ $json.snippet }}

CATEGORIES:
- newsletter: Marketing emails, digests, Substack, promotional content, sale announcements
- automated_notification: System-generated alerts (GitHub, Notion, Slack, receipts, shipping confirmations, bank alerts, app notifications)
- cold_outreach: Unsolicited sales or partnership emails from people you do not know
- norrai_business: Client inquiries, leads, vendor emails, or business proposals for Norr AI — use this for any email to hello@norrai.co that could be from a real person with business intent
- personal: Emails from real people you know (friends, family, colleagues) or that need a personal reply
- uncertain: Does not clearly fit any category above

RULES:
- If inbox is hello@norrai.co and the email could be a lead or client, classify as norrai_business (not newsletter or cold_outreach)
- Prefer uncertain over a wrong confident guess
- Return ONLY valid JSON with no extra text

{"category":"<category>","confidence":<0.0-1.0>,"proposed_action":"<mark_read_archive|mark_read|trash|mark_important|queue_for_review>","reason":"<one sentence>"}
```

- [ ] **Step 11: Add "Claude Classify" HTTP Request node**

- Node: **HTTP Request**
- Name: `Claude Classify`
- Method: `POST`
- URL: `https://api.anthropic.com/v1/messages`
- Authentication: **Header Auth** credential named `Claude API Key`
  - Header Name: `x-api-key`
  - Header Value: your Anthropic API key
- Additional headers (set via "Headers" section):
  - `anthropic-version`: `2023-06-01`
  - `content-type`: `application/json`
- Body (JSON / Raw):
```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 256,
  "messages": [{ "role": "user", "content": "{{ $json.prompt }}" }]
}
```

- [ ] **Step 12: Add "Parse + Gate" Code node**

- Node: **Code**
- Name: `Parse + Gate`
- JavaScript:
```javascript
const raw = $input.first().json.content[0].text.trim();
let c;
try {
  c = JSON.parse(raw);
} catch (e) {
  c = { category: 'uncertain', confidence: 0, proposed_action: 'queue_for_review', reason: 'parse error' };
}
// Confidence gate: below 0.80 → uncertain regardless of category
if ((c.confidence ?? 0) < 0.80) {
  c.category = 'uncertain';
  c.proposed_action = 'queue_for_review';
}
const input = $('Build Classifier Input').item.json;
return [{ json: { ...input, ...c } }];
```

- [ ] **Step 13: Add "Route by Category" Switch node**

- Node: **Switch**
- Name: `Route by Category`
- Routing field: `{{ $json.category }}`
- Output 1: `newsletter`
- Output 2: `automated_notification`
- Output 3: `cold_outreach`
- Output 4: `norrai_business`
- Output 5: `personal`
- Fallback (default): uncertain → Output 6

- [ ] **Step 14: Add Gmail action nodes per output**

> For each action, use the same "Which Inbox?" Switch → 3 Gmail credential nodes pattern from Steps 3–4. Each action branch needs its own credential router.

**Output 1 — newsletter:**
1. Switch → 3 Gmail "Mark as Read" nodes (one per credential), merge outputs
2. Switch → 3 Gmail "Remove Label" nodes with label `INBOX` (archives message), merge outputs

**Output 2 — automated_notification:**
1. Switch → 3 Gmail "Mark as Read" nodes, merge outputs

**Output 3 — cold_outreach:**
1. Switch → 3 Gmail "Delete Message" nodes (moves to Trash), merge outputs

**Output 4 — norrai_business:**
1. Switch → 3 Gmail "Add Label" nodes with label `IMPORTANT`, merge outputs

**Output 5 — personal:**
1. Switch → 3 Gmail "Add Label" nodes with label `IMPORTANT`, merge outputs

**Output 6 — uncertain:** No Gmail action. Pass directly to Log to Queue.

- [ ] **Step 15: Add "Log to Queue" Postgres node**

Merge all 6 outputs (after their Gmail actions) into one **Merge (Append)** node, then:

- Node: **Postgres** (`continueOnFail: true`)
- Name: `Log to Queue`
- Query:
```sql
INSERT INTO email_triage_queue
  (message_id, inbox, sender, subject, snippet, category, proposed_action, status)
VALUES (
  '{{ $json.message_id }}',
  '{{ $json.inbox }}',
  '{{ $json.sender }}',
  '{{ $json.subject }}',
  '{{ $json.snippet }}',
  '{{ $json.category }}',
  '{{ $json.proposed_action }}',
  '{{ $json.category === "uncertain" ? "pending" : "auto_actioned" }}'
)
ON CONFLICT (message_id, inbox) DO NOTHING
```

- [ ] **Step 16: Loop back**

Connect `Log to Queue` output → `Loop Over Emails` input (this continues the batch loop).

- [ ] **Step 16b: Add "Log Run Complete" Postgres node (done branch)**

Connect the **done** output of `Loop Over Emails` (fires after all emails are processed) to:

- Node: **Postgres** (`continueOnFail: true`)
- Name: `Log Run Complete`
- Query:
```sql
UPDATE email_triage_runs
SET
  completed_at      = NOW(),
  emails_processed  = (SELECT count(*) FROM email_triage_queue WHERE inbox = '{{ $('Execute Workflow Trigger').item.json.inbox }}' AND created_at > NOW() - INTERVAL '2 hours'),
  auto_actioned     = (SELECT count(*) FROM email_triage_queue WHERE inbox = '{{ $('Execute Workflow Trigger').item.json.inbox }}' AND status = 'auto_actioned' AND created_at > NOW() - INTERVAL '2 hours'),
  queued_for_review = (SELECT count(*) FROM email_triage_queue WHERE inbox = '{{ $('Execute Workflow Trigger').item.json.inbox }}' AND status = 'pending'       AND created_at > NOW() - INTERVAL '2 hours')
WHERE run_id = '{{ $execution.id }}' AND inbox = '{{ $('Execute Workflow Trigger').item.json.inbox }}'
```

- [ ] **Step 17: Activate**

Toggle workflow to Active. (It runs only when called — the Schedule Trigger in the Sweep workflow invokes it.)

---

## Task 5: Build Workflow A — Email Triage Sweep

The master workflow. Fires daily at 02:00 UTC, calls the Process Inbox sub-workflow three times, then sends the Telegram digest if there are pending items.

- [ ] **Step 1: Create new workflow**

n8n → New Workflow → Name: `Email Triage Sweep`

- [ ] **Step 2: Add Schedule Trigger**

- Node: **Schedule Trigger**
- Trigger: `Cron`
- Expression: `0 2 * * *`  ← 02:00 UTC = 8:00 PM CST

- [ ] **Step 3: Add "Lookup Client" Postgres node**

- Node: **Postgres** (`continueOnFail: true`)
- Name: `Lookup Client`
- Query: `SELECT id FROM clients WHERE id = 'e2f9934c-4d28-4bb4-ac90-4284c1123517'`

- [ ] **Step 4: Add "Log Triggered" Postgres node**

- Node: **Postgres** (`continueOnFail: true`)
- Name: `Log Triggered`
- Query:
```sql
INSERT INTO workflow_events (client_id, workflow_name, event_type, payload)
VALUES (
  'e2f9934c-4d28-4bb4-ac90-4284c1123517',
  'email_triage_sweep',
  'triggered',
  '{"execution_id": "{{ $execution.id }}"}'::jsonb
)
```

- [ ] **Step 5: Add three "Execute Workflow" nodes (one per inbox)**

Each node calls `Email Triage — Process Inbox`. Connect them sequentially (egachuu → eganbonde → hello@norrai.co).

**Node 1:**
- Name: `Process egachuu@gmail.com`
- Workflow: `Email Triage — Process Inbox`
- Input: `{ "inbox": "egachuu@gmail.com", "label": "personal" }`

**Node 2:**
- Name: `Process eganbonde@gmail.com`
- Workflow: `Email Triage — Process Inbox`
- Input: `{ "inbox": "eganbonde@gmail.com", "label": "persona" }`

**Node 3:**
- Name: `Process hello@norrai.co`
- Workflow: `Email Triage — Process Inbox`
- Input: `{ "inbox": "hello@norrai.co", "label": "business" }`

- [ ] **Step 6: Add "Fetch Pending Queue" Postgres node**

After the last Execute Workflow node:
- Node: **Postgres**
- Name: `Fetch Pending Queue`
- Query:
```sql
SELECT id, inbox, sender, subject, snippet, proposed_action
FROM email_triage_queue
WHERE status = 'pending'
ORDER BY created_at ASC
```

- [ ] **Step 7: Add "Any Pending?" IF node**

- Node: **IF**
- Name: `Any Pending?`
- Condition: `{{ $json.id }}` is not empty (true = has pending items)

- [ ] **Step 8: Add "Build Telegram Digest" Code node (true branch)**

- Node: **Code**
- Name: `Build Telegram Digest`
- JavaScript:
```javascript
const items = $input.all();
let msg = `📬 ${items.length} email${items.length > 1 ? 's' : ''} need your review:\n\n`;
const verb = { mark_read_archive: 'archive', mark_read: 'mark read', trash: 'trash', queue_for_review: 'review' };
items.forEach((item, i) => {
  const a = verb[item.json.proposed_action] ?? 'review';
  msg += `${i + 1}. ${item.json.sender} — "${item.json.subject}" → ${a}?\n`;
});
msg += `\nReply with numbers to approve (e.g. "1 3") or "all"\nSkip any by not including its number.`;
return [{ json: { message: msg } }];
```

- [ ] **Step 9: Add "Send Telegram Digest" Telegram node (true branch)**

- Node: **Telegram**
- Credential: `Telegram — Norr AI Email Bot`
- Operation: **Send Message**
- Chat ID: `<TELEGRAM_CHAT_ID from Task 2>`
- Text: `{{ $json.message }}`

- [ ] **Step 10: Add "Log Completed" Postgres node**

Connect after both true and false branches of `Any Pending?`:
- Node: **Postgres** (`continueOnFail: true`)
- Name: `Log Completed`
- Query:
```sql
INSERT INTO workflow_events (client_id, workflow_name, event_type, payload)
VALUES (
  'e2f9934c-4d28-4bb4-ac90-4284c1123517',
  'email_triage_sweep',
  'completed',
  '{"execution_id": "{{ $execution.id }}"}'::jsonb
)
```

- [ ] **Step 11: Set Error Workflow**

Workflow Settings → Error Workflow → `Norr AI Workflow Error Logger`

- [ ] **Step 12: Activate workflow**

Toggle to Active.

---

## Task 6: Build Workflow B — Telegram Reply Handler

Listens for your numbered Telegram reply, looks up pending emails, executes approved Gmail actions, and confirms.

- [ ] **Step 1: Create new workflow**

n8n → New Workflow → Name: `Email Triage Reply Handler`

- [ ] **Step 2: Add Telegram Trigger node**

- Node: **Telegram Trigger**
- Name: `Telegram Webhook`
- Credential: `Telegram — Norr AI Email Bot`
- Updates to listen for: `message`

- [ ] **Step 3: Add "Is My Chat?" IF node**

Filter out any messages not from your Telegram account:
- Node: **IF**
- Name: `Is My Chat?`
- Condition: `{{ $json.message.chat.id }}` equals `<TELEGRAM_CHAT_ID>`
- False branch → **No Operation** (stop)

- [ ] **Step 4: Add "Parse Reply" Code node**

- Node: **Code**
- Name: `Parse Reply`
- JavaScript:
```javascript
const text = $input.first().json.message.text?.trim().toLowerCase() ?? '';
const approvedNumbers = text === 'all' ? 'all' : text.split(/\s+/).map(Number).filter(n => !isNaN(n) && n > 0);
return [{ json: { approvedNumbers, rawText: text } }];
```

- [ ] **Step 5: Add "Fetch Pending Queue" Postgres node**

- Node: **Postgres**
- Name: `Fetch Pending Queue`
- Query:
```sql
SELECT id, message_id, inbox, sender, subject, proposed_action
FROM email_triage_queue
WHERE status = 'pending'
ORDER BY created_at ASC
```

- [ ] **Step 6: Add "Build Action Plan" Code node**

This pre-computes which items to act on and builds the confirmation message now (before the loop), since the loop will overwrite execution context.

- Node: **Code**
- Name: `Build Action Plan`
- JavaScript:
```javascript
const pending = $input.all().map((item, i) => ({ ...item.json, position: i + 1 }));
const approved = $('Parse Reply').first().json.approvedNumbers;
const toAct  = approved === 'all' ? pending : pending.filter(p => approved.includes(p.position));
const toSkip = pending.filter(p => !toAct.find(a => a.id === p.id));

const verb = { mark_read_archive: 'archived', mark_read: 'marked read', trash: 'trashed', mark_important: 'marked important', queue_for_review: 'reviewed' };
let parts = [];
if (toAct.length)  parts.push(`✓ Done — ${toAct.map(i => `${verb[i.proposed_action] ?? 'actioned'} ${i.position}`).join(', ')}.`);
if (toSkip.length) parts.push(`Skipped ${toSkip.map(i => i.position).join(', ')}.`);
const confirmMsg = parts.join(' ') || '✓ No actions taken.';

// Emit one item per email to process, tagged with act/skip
return [
  ...toAct.map(i  => ({ json: { ...i, skip: false } })),
  ...toSkip.map(i => ({ json: { ...i, skip: true  } })),
  { json: { __confirm_msg: confirmMsg, __is_summary: true } }  // sentinel for confirmation
];
```

- [ ] **Step 7: Add "Loop Over Actions" Split In Batches node**

- Node: **Split In Batches**
- Name: `Loop Over Actions`
- Batch Size: `1`

- [ ] **Step 8: Add "Is Summary?" IF node**

- Node: **IF**
- Name: `Is Summary?`
- Condition: `{{ $json.__is_summary }}` is true
- True branch → Send Confirmation (Step 14)
- False branch → continue to act/skip routing

- [ ] **Step 9: Add "Skip or Act?" IF node (false branch)**

- Node: **IF**
- Name: `Skip or Act?`
- Condition: `{{ $json.skip }}` is false
- True branch → execute action
- False branch → update status to skipped

- [ ] **Step 10: Add "Route by Action" Switch node (true branch)**

- Node: **Switch**
- Name: `Route by Action`
- Routing field: `{{ $json.proposed_action }}`
- Output 1: `mark_read_archive`
- Output 2: `mark_read`
- Output 3: `trash`
- Fallback: mark_important / queue_for_review → Output 4

- [ ] **Step 11: Add Gmail action nodes (same inbox-routing pattern as Task 4 Step 14)**

For each output, route via inbox-aware Switch → 3 Gmail credential nodes → merge:

- Output 1 (mark_read_archive): Mark as Read, then Remove Label `INBOX`
- Output 2 (mark_read): Mark as Read
- Output 3 (trash): Delete Message
- Output 4 (mark_important): Add Label `IMPORTANT`

- [ ] **Step 12: Add "Update Queue — Approved" Postgres node (after action nodes)**

Merge all action output nodes, then:
- Node: **Postgres** (`continueOnFail: true`)
- Query:
```sql
UPDATE email_triage_queue
SET status = 'approved', resolved_at = NOW()
WHERE id = '{{ $json.id }}'
```

- [ ] **Step 13: Add "Update Queue — Skipped" Postgres node (false branch from Skip or Act?)**

- Node: **Postgres** (`continueOnFail: true`)
- Query:
```sql
UPDATE email_triage_queue
SET status = 'skipped', resolved_at = NOW()
WHERE id = '{{ $json.id }}'
```

- [ ] **Step 14: Connect back to loop**

Connect both "Update Queue" nodes → back to `Loop Over Actions` (continue loop).

- [ ] **Step 15: Add "Send Confirmation" Telegram node (Is Summary? true branch)**

- Node: **Telegram**
- Credential: `Telegram — Norr AI Email Bot`
- Operation: **Send Message**
- Chat ID: `<TELEGRAM_CHAT_ID>`
- Text: `{{ $json.__confirm_msg }}`

- [ ] **Step 16: Set Error Workflow**

Workflow Settings → Error Workflow → `Norr AI Workflow Error Logger`

- [ ] **Step 17: Activate workflow**

Toggle to Active.

---

## Task 7: End-to-End Test

- [ ] **Step 1: Seed test emails**

Send the following to each inbox before running the sweep. Use a secondary email address to send them:

| Inbox | Type | Subject |
|---|---|---|
| `egachuu@gmail.com` | newsletter | Forward a Substack email to yourself |
| `egachuu@gmail.com` | automated_notification | Forward a GitHub notification |
| `eganbonde@gmail.com` | cold_outreach | "Quick question about a partnership" (send from a throwaway address) |
| `hello@norrai.co` | norrai_business | "Hi, interested in your automation services" |
| Any inbox | uncertain | "Re: follow up" with a vague body (should score below 0.80) |

- [ ] **Step 2: Run sweep manually**

n8n → `Email Triage Sweep` → Execute Workflow (manual trigger button)

Watch all nodes for green checkmarks. Click through each node to verify output.

- [ ] **Step 3: Verify Gmail actions**

Check each inbox:
- `egachuu`: Substack email → archived + marked read. GitHub notification → marked read only (still in inbox).
- `eganbonde`: Cold outreach → in Trash.
- `hello@norrai.co`: "Interested in services" → marked Important, still in inbox, not archived.

- [ ] **Step 4: Verify Telegram digest arrives**

Check Telegram. The bot should send a numbered list containing the uncertain email(s). Format should match:
```
📬 1 email needs your review:

1. sender@example.com — "Re: follow up" → review?

Reply with numbers to approve (e.g. "1 3") or "all"
Skip any by not including its number.
```

- [ ] **Step 5: Reply and verify action + confirmation**

Reply `1` to the bot. Within seconds you should receive:
```
✓ Done — reviewed 1.
```

Check Gmail: the email should have the action applied. Check Neon:
```sql
SELECT message_id, category, status, resolved_at
FROM email_triage_queue
WHERE status IN ('approved', 'skipped')
ORDER BY resolved_at DESC LIMIT 5;
```

Expected: row with `status = 'approved'` and a `resolved_at` timestamp.

- [ ] **Step 6: Verify dedup on second run**

Run the sweep manually a second time. Verify:
- No Telegram message sent (no new pending items)
- Claude API is not called for already-processed message IDs

Check:
```sql
SELECT count(*) FROM email_triage_queue
WHERE message_id = '<id of a message from run 1>';
```

Expected: `1` (not 2).

- [ ] **Step 7: Export workflows and commit**

n8n → each workflow → ⋮ → Download → save to:
- `n8n/workflows/email_triage_sweep.json`
- `n8n/workflows/email_triage_process_inbox.json`
- `n8n/workflows/email_triage_reply.json`

```bash
git add n8n/workflows/email_triage_sweep.json \
        n8n/workflows/email_triage_process_inbox.json \
        n8n/workflows/email_triage_reply.json \
        db/schema.sql
git commit -m "feat: email triage assistant — sweep, process inbox, and reply handler workflows"
```

---

## Task 8: Update CLAUDE.md Workflow Registry

- [ ] **Step 1: Add entries to the workflow_name registry table in `CLAUDE.md`**

Add these two rows to the registry table:

| Workflow | `workflow_name` |
|---|---|
| Email Triage Sweep | `email_triage_sweep` |
| Email Triage Reply Handler | `email_triage_reply` |

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: register email triage workflows in workflow_name registry"
```
