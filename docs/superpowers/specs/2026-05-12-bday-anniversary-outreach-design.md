# Birthday & Anniversary Outreach Workflow — Design Spec

**Date:** 2026-05-12
**Tier:** Growth
**Workflow name:** `bday_anniversary_outreach`

---

## Overview

A daily n8n workflow that reads a real estate agent's client list from Google Sheets, identifies clients whose birthday, home-buying anniversary, or home-selling anniversary falls today, drafts a personalized email via Claude Haiku, and sends it via SendGrid (or falls back to Twilio SMS if no email is on file).

---

## Google Sheet Structure

One sheet per agent (or shared across agents with an `agent_name` column). Required columns:

| Column | Format | Notes |
|---|---|---|
| `name` | Text | Full client name |
| `email` | Text | Primary delivery channel — optional |
| `phone` | Text | E.164 or 10-digit — SMS fallback if no email |
| `birthday` | `MM-DD` | Year not needed — fires every year |
| `closing_date` | `YYYY-MM-DD` | Buyer anniversary — `MM-DD` matched yearly |
| `sell_date` | `YYYY-MM-DD` | Seller anniversary — `MM-DD` matched yearly |
| `property_address` | Text | Used in anniversary message context |
| `agent_name` | Text | Signs the message |
| `agent_email` | Text | Reply-to on outbound email |

Rows with no birthday AND no closing/sell date are skipped. Multiple occasions on the same day each send a separate message.

---

## Workflow Architecture

**Trigger:** Cron — daily at 7:00 AM CT (`America/Chicago`)

```
Cron (7am CT)
  → Google Sheets: Read all rows
  → Code: Filter rows where today matches birthday, closing_date, or sell_date
  → Split in Batches (one item per match)
      → Set: Build occasion context (occasion_type, client_name, property_address, agent_name, agent_email)
      → HTTP Request: Claude Haiku — draft SUBJECT + BODY
      → Code: Parse SUBJECT / BODY, convert \n to <br> for HTML, strip for SMS
      → IF: email present?
          YES → SendGrid (HTML email, click tracking off, reply-to = agent_email)
          NO  → IF: phone present?
              YES → Twilio SMS (BODY only, newlines stripped, truncated to 160 chars)
              NO  → Postgres INSERT: log skip to workflow_events
  → Postgres INSERT: log completed to workflow_events
```

**Error workflow:** Points to `Norr AI Workflow Error Logger` (logs `failed` to `workflow_events`).

---

## Date Matching Logic

Runs inside the Code filter node. All date comparisons use `America/Chicago` timezone.

```js
// Parse month and day in CT — matches the pattern used across other Norr AI workflows
const chiStr = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', hour12: false });
// chiStr → "5/12/2026, 07:00:00"
const [datePart] = chiStr.split(', ');
const [m, d] = datePart.split('/');
const todayMMDD = `${m.padStart(2, '0')}-${d.padStart(2, '0')}`; // → "MM-DD"

// Birthday match (stored as MM-DD)
if (row.birthday === todayMMDD) matches.push({ ...row, occasion_type: 'birthday' });

// Closing anniversary match — YYYY-MM-DD → slice(5) → MM-DD
if (row.closing_date && row.closing_date.slice(5) === todayMMDD)
  matches.push({ ...row, occasion_type: 'closing_anniversary' });

// Sell anniversary match
if (row.sell_date && row.sell_date.slice(5) === todayMMDD)
  matches.push({ ...row, occasion_type: 'sell_anniversary' });
```

---

## Claude Haiku Prompt

Model: `claude-haiku-4-5-20251001`

```
You are writing a short, warm personal email from a real estate agent to a past client.

Occasion: [DATA]{{ $json.occasion_type }}[/DATA]
Client name: [DATA]{{ $json.client_name }}[/DATA]
Property address: [DATA]{{ $json.property_address }}[/DATA]
Agent name: [DATA]{{ $json.agent_name }}[/DATA]

Guidelines:
- 3–4 sentences max, split into 2–3 short paragraphs
- Use blank lines between paragraphs (separate with \n\n)
- Warm and genuine, not salesy
- Do not mention real estate services or ask for referrals
- For birthday: wish them a happy birthday, no mention of property
- For closing_anniversary: acknowledge the milestone, reference the address warmly
- For sell_anniversary: acknowledge selling, wish them well in their next chapter
- Sign off with the agent's first name only

Return exactly two lines:
SUBJECT: <subject line>
BODY: <email body with \n\n between paragraphs>
```

---

## Output Parsing (Code Node)

```js
const raw = $('Claude Draft').first().json.content[0].text;
const subjectMatch = raw.match(/^SUBJECT:\s*(.+)/m);
const bodyMatch = raw.match(/^BODY:\s*([\s\S]+)/m);

const subject = subjectMatch ? subjectMatch[1].trim() : 'Thinking of you';
const bodyRaw = bodyMatch ? bodyMatch[1].trim() : raw;

// For email
const htmlBody = bodyRaw.replace(/\n/g, '<br>');

// For SMS
const smsBody = bodyRaw.replace(/\n+/g, ' ').substring(0, 160);

return [{ json: { subject, htmlBody, smsBody, ...item } }];
```

---

## Delivery

**Email (SendGrid):**
- HTTP Request node → SendGrid v3 API
- `from`: `hello@norrai.co`
- `reply_to`: `agent_email` from sheet
- `to`: client email
- `subject`: parsed SUBJECT
- `html`: parsed htmlBody
- Click tracking: disabled (`tracking_settings.click_tracking.enable: false`)

**SMS (Twilio fallback):**
- Twilio node (agent's subaccount)
- `to`: client phone (normalized to E.164)
- `body`: smsBody (160-char truncated)

---

## Neon Logging

**Skip log** (no email AND no phone):
```sql
INSERT INTO workflow_events (client_id, workflow_name, event_type, payload)
VALUES ($client_id, 'bday_anniversary_outreach', 'completed',
  '{"skipped": true, "reason": "no_contact", "client_name": "{{ $json.name }}"}'::jsonb)
```

**Completed log** (end of workflow):
```sql
INSERT INTO workflow_events (client_id, workflow_name, event_type, payload)
VALUES ($client_id, 'bday_anniversary_outreach', 'completed',
  '{"matches_found": {{ $json.matchCount }}, "execution_id": "{{ $execution.id }}"}'::jsonb)
```

`client_id` resolved by looking up the agent's email against `clients.primary_contact_email`.

---

## Workflow Registry Entry

Add to CLAUDE.md workflow name registry:

| Workflow | `workflow_name` |
|---|---|
| Birthday & Anniversary Outreach | `bday_anniversary_outreach` |

---

## Out of Scope

- Agent approval/preview step (auto-send only)
- Market insight personalization (minimal tone only)
- SMS-to-email fallback (email is primary; SMS is fallback only)
- Deduplication across multiple runs on the same day (cron runs once daily — not a risk)
