# Email Triage Assistant — Design Spec
**Date:** 2026-05-19
**Status:** Approved

---

## Overview

A personal email triage assistant that runs on a schedule, classifies incoming emails using Claude, auto-actions obvious noise, and routes uncertain emails to Telegram for lightweight human review. Built on the existing Norr AI n8n + Claude API + Neon stack.

**Goal:** Noise reduction — auto-archive/mark-read/trash junk so only signal remains across three inboxes.

---

## Accounts In Scope

| Inbox | Purpose |
|---|---|
| `egachuu@gmail.com` | Personal primary |
| `eganbonde@gmail.com` | Personal persona |
| `hello@norrai.co` | NorrAI business (Google Workspace) |

---

## Architecture

### Workflow A — Email Triage Sweep

Three parallel Gmail triggers (one per inbox) run once daily at 8:00 PM CST (02:00 UTC). Each new email flows through:

1. **Dedup check** — Neon lookup by Gmail `message_id`. Already-processed emails are skipped without calling Claude.
2. **Claude classifier** — HTTP Request to Claude API. Input: sender, subject, body snippet (~200 chars), inbox source. Output: structured JSON with category, confidence, proposed action, and reason.
3. **Confidence gate** — If `confidence < 0.80`, category is overridden to `uncertain` regardless of Claude's classification.
4. **Action router** — Switch node branches on final category (see table below).
5. **Gmail action nodes** — Execute the appropriate Gmail API action.
6. **Uncertain queue** — Uncertain emails are written to `email_triage_queue` in Neon.
7. **Telegram digest** — After sweep completes, batches all queued uncertain emails and sends a numbered review list via Telegram.
8. **Neon logger** — Records `triggered`/`completed`/`failed` events to `workflow_events`.

### Workflow B — Telegram Reply Handler

A Telegram webhook workflow that:
1. Listens for a reply message in the Telegram bot chat.
2. Parses the reply (numbers like `"1 3"` or `"all"`).
3. Looks up all rows in `email_triage_queue` where `status = 'pending'`, ordered by `created_at`. The numbered list in the digest corresponds to this ordered set.
4. Executes the approved Gmail actions.
5. Updates row `status` to `approved` or `skipped`, sets `resolved_at`.
6. Sends a confirmation message back to Telegram.

---

## Classification Logic

### Claude Classifier Input
```
Inbox: hello@norrai.co
From: newsletters@substack.com
Subject: Your Weekly Creator Digest
Snippet: Here's what's trending this week among the creators you follow...
```

### Claude Classifier Output
```json
{
  "category": "newsletter",
  "confidence": 0.97,
  "proposed_action": "mark_read_archive",
  "reason": "Promotional digest email from Substack"
}
```

### Category → Action Map

| Category | Action | Notes |
|---|---|---|
| `newsletter` | Mark read + archive | Substack, marketing, promotional |
| `automated_notification` | Mark read | GitHub, Notion, receipts, shipping |
| `cold_outreach` | Move to trash | Unsolicited sales emails that slip through |
| `norrai_business` | Mark important | Client inquiries, leads, vendor emails — no auto-action |
| `personal` | Mark important | Emails from real people needing replies — no auto-action |
| `uncertain` | Queue for Telegram | Confidence < 0.80 or ambiguous |

### Per-Inbox Bias

- `hello@norrai.co` emails have a higher caution threshold — anything that could be a real lead or client defaults to `norrai_business` or `uncertain` rather than being auto-actioned.
- `egachuu@gmail.com` and `eganbonde@gmail.com` follow standard thresholds.

---

## Telegram Interaction

### Digest Message Format
```
📬 3 emails need your review:

1. john@coldoutreach.io — "Quick question about your business" → trash?
2. noreply@slack.com — "You have unread messages" → mark read?
3. unknown@domain.com — "Re: your inquiry" → archive?

Reply with numbers to approve (e.g. "1 3") or "all"
Skip any by not including its number.
```

### Confirmation Message Format
```
✓ Done — trashed 1, marked read 2. Skipped 3.
```

---

## Data Model

### `email_triage_queue`
Stores uncertain emails awaiting Telegram review.

```sql
CREATE TABLE email_triage_queue (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      UUID NOT NULL,
  message_id  TEXT NOT NULL,
  inbox       TEXT NOT NULL,
  sender      TEXT,
  subject     TEXT,
  snippet     TEXT,
  proposed_action TEXT,
  status      TEXT DEFAULT 'pending', -- pending | approved | skipped
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
```

### `email_triage_runs`
One record per sweep execution for health monitoring.

```sql
CREATE TABLE email_triage_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID NOT NULL,
  inbox             TEXT NOT NULL,
  emails_processed  INT DEFAULT 0,
  auto_actioned     INT DEFAULT 0,
  queued_for_review INT DEFAULT 0,
  started_at        TIMESTAMPTZ DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);
```

---

## Workflow Registry

| Workflow | `workflow_name` |
|---|---|
| Email Triage Sweep | `email_triage_sweep` |
| Email Triage Reply Handler | `email_triage_reply` |

Both workflows follow the standard Norr AI logging pattern: Lookup Client → Log Triggered → [main logic] → Log Completed → Error Workflow set to `Norr AI Workflow Error Logger`.

Client ID for both: `e2f9934c-4d28-4bb4-ac90-4284c1123517` (norrai_internal).

---

## Out of Scope

- Drafting replies to emails
- Calendar integration
- Attachment handling
- Multi-user / client-facing version
- Mobile push notifications (Telegram covers this)

---

## Success Criteria

- Inbox noise (newsletters, notifications, cold outreach) is cleared automatically by 8:00 PM CST each day
- Zero false positives on `norrai_business` and `personal` categories — those emails are never auto-actioned
- Uncertain email Telegram digest is actionable in under 60 seconds
- No duplicate processing of the same message ID across sweep runs
