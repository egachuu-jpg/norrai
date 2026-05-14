# Design: Birthday & Anniversary Outreach Workflow

**Status:** Approved
**Date:** 2026-05-13
**Tier:** Growth
**Vertical:** Real estate (first), built generically for extension

---

## Problem

Real estate agents lose top-of-mind presence with past clients between transactions. Birthdays and home purchase anniversaries are natural touchpoints — but agents never remember to send anything. Manual effort means it doesn't happen.

---

## Goal

Automatically send a warm, personalized message to past clients on their birthday and home purchase anniversary. Zero agent effort after initial setup. No calls to action — pure relationship maintenance.

---

## Non-Goals

- Agent review before send (fully automated)
- Multi-vertical support at launch (real estate only, but pattern is generic)
- Syncing sheet data to Neon (deferred — query Sheets directly for now)
- SMS at launch (node built but disabled until Twilio registration complete)

---

## Data Source

Google Sheet per agent. The Sheet ID is hardcoded in the workflow at client onboarding.

### Sheet Columns

| Column | Format | Notes |
|--------|--------|-------|
| `lead_name` | Text | Full name |
| `email` | Text | |
| `phone` | Text | E.164 or plain 10-digit |
| `birthday` | MM-DD | Year excluded — typical for contacts |
| `transaction_anniversary` | YYYY-MM-DD | Full date — needed to calculate years elapsed |
| `property_address` | Text | Used in anniversary message |
| `birthday_sent_year` | YYYY | Written back after send — prevents duplicate sends |
| `anniversary_sent_year` | YYYY | Written back after send — prevents duplicate sends |

The `_sent_year` columns are the dedup guard. Before sending, the workflow checks whether `birthday_sent_year` or `anniversary_sent_year` equals the current year. If yes, skip. After sending, write the current year back to that column.

---

## Architecture

Single workflow. One n8n workflow instance per agent client.

```
Cron Trigger (9am CT daily)
        │
        ▼
Get Today (Code node)
  — today_mmdd = "MM-DD"
  — today_yyyy = "YYYY"
        │
        ▼
Google Sheets: Read All Rows
        │
        ▼
Filter Matches (Code node)
  — birthday == today_mmdd AND birthday_sent_year != today_yyyy
  — OR transaction_anniversary[5..9] == today_mmdd AND anniversary_sent_year != today_yyyy
        │
   No matches → stop
   Matches → loop (SplitInBatches, batch size 1)
        │
        ▼
For each match:
  Determine event type (birthday | anniversary | both)
  Calculate years elapsed for anniversary
        │
        ▼
  Build Claude Prompt (Code node)
        │
        ▼
  Claude Haiku (HTTP Request)
  → returns EMAIL_SUBJECT / EMAIL_BODY / SMS_TEXT
        │
        ▼
  Parse Response (Code node)
        │
        ├──▶ SendGrid: send email
        │
        └──▶ [DISABLED] Twilio SMS
        │
        ▼
  Google Sheets: Update Row
  — write today_yyyy to birthday_sent_year or anniversary_sent_year
        │
        ▼
Log triggered + completed → workflow_events (Neon)
```

**Workflow name:** `bday_anniversary_outreach`
**Client ID:** hardcoded per workflow instance (same pattern as B&B and Red Alert Scheduler)

---

## Claude Prompt

Model: Claude Haiku (cost-effective, simple drafting task)

```
You are drafting a brief, warm personal message from a real estate agent to a past client.

Event: [BIRTHDAY | TRANSACTION ANNIVERSARY | BIRTHDAY AND ANNIVERSARY]
Client name: [DATA]{lead_name}[/DATA]
Property address: [DATA]{property_address}[/DATA]  ← anniversary only
Years since transaction: {years}                    ← anniversary only
Agent name: [DATA]{agent_name}[/DATA]

Guidelines:
- Warm and personal, NOT salesy. No calls to action, no "let me know if you're thinking of buying/selling."
- 2-3 sentences max.
- Birthday: simple well-wish, light warmth.
- Anniversary: acknowledge the milestone, reference the property, wish them well.
- Sign off with the agent's first name only.

Return exactly:
EMAIL_SUBJECT: ...
EMAIL_BODY: ...
SMS_TEXT: ... (under 160 characters)
```

`[DATA][/DATA]` delimiters follow the prompt injection guard pattern used across all workflows.

### Example outputs

**Birthday:**
> EMAIL_SUBJECT: Happy Birthday, Sarah!
> EMAIL_BODY: Hi Sarah, just wanted to take a moment to wish you a wonderful birthday. Hope you have a great day! — Mike
> SMS_TEXT: Happy birthday, Sarah! Hope your day is a great one. — Mike

**Anniversary:**
> EMAIL_SUBJECT: 3 years in your home!
> EMAIL_BODY: Hi Sarah, can you believe it's been 3 years since you moved into 412 Oak St? Wishing you many more happy years there. — Mike
> SMS_TEXT: 3 years at 412 Oak St — hope it's been every bit as great as you hoped! — Mike

---

## Delivery

**Email:** SendGrid via HTTP Request node (same pattern as all other HTML emails). From `hello@norrai.co`. Click tracking disabled.

**SMS:** Twilio node built but disabled. Enable when Twilio registration is complete. Message body = `SMS_TEXT` from Claude response.

---

## Deduplication

Before sending, check `birthday_sent_year` / `anniversary_sent_year` against current year. If match, skip that row entirely. After send, write current year back via Google Sheets Update Row node. Handles the case where n8n fires the cron twice in one day.

---

## Workflow Events Logging

Standard pattern:
- Log `triggered` at workflow start (after cron fires, before Sheet read)
- Log `completed` after all rows are processed
- Error Workflow setting points to `Norr AI Workflow Error Logger`
- `client_id` hardcoded per workflow instance

---

## Edge Cases

| Case | Handling |
|------|----------|
| No matches today | Filter returns empty array → workflow stops, no email sent |
| Birthday and anniversary fall on same day | Event type = "both" — Claude drafts one message acknowledging both |
| Lead has no email | Skip SendGrid node (IF check on email field) |
| Lead has no phone | SMS node already disabled; when enabled, add IF check |
| `transaction_anniversary` cell is empty | Filter excludes rows with blank anniversary field |
| `birthday` cell is empty | Filter excludes rows with blank birthday field |
| Agent sheet not accessible | Google Sheets node fails → error workflow logs `failed` event |

---

## Schema Changes

None. Data lives in Google Sheet. No Neon changes required.

`workflow_events` logging uses existing table — no new columns needed.

---

## Workflow Name Registry

Add to CLAUDE.md:

| Workflow | `workflow_name` |
|---|---|
| Birthday & Anniversary Outreach | `bday_anniversary_outreach` |

---

## Future Extensions

- Add `agent_name` column to sheet (or pull from `clients` table via client_id lookup)
- Sync sheet → Neon nightly; drop Sheets dependency once a client-facing form is built
- Enable SMS node once Twilio registration complete
- Extend to dental (patient birthday) and insurance (policy anniversary) verticals by changing event type labels and prompt copy
- Per-client configurable send time (currently hardcoded 9am CT)
