# Real Estate Review Request Workflow — Design Spec
**Date:** 2026-04-30
**Status:** Approved

---

## Overview

An agent-facing web form that triggers a delayed, Claude-personalized review request to a recently closed buyer or seller client. Sends both SMS (Twilio) and email (SendGrid) after a configurable delay of 1, 3, or 7 days. Single message — no follow-up sequence.

---

## Files

| File | Purpose |
|------|---------|
| `website/review_request.html` | Agent-facing form, token protected |
| `n8n/workflows/Real Estate Review Request.json` | 8-node n8n workflow |
| `tests/review_request.spec.js` | Playwright tests |

---

## Form — `review_request.html`

### Agent Profile (localStorage, saved once)
- Agent name
- Google review URL
- Zillow review URL (optional)
- "· saved / clear" badge — same pattern as `listing_form.html`

### Per-Submission Fields
| Field | Type | Notes |
|-------|------|-------|
| Client first name | text, required | Used in Claude prompt and message personalization |
| Client phone | text, required | 10-digit, stripped/prefixed by Code node |
| Client email | email, optional | If blank, SendGrid step is skipped |
| Transaction type | radio: Buyer / Seller | Shapes Claude's congratulations framing |
| Property address | text, required | Included in message for personalization |
| Send delay | dropdown: 1 day / 3 days (default) / 7 days | Controls Wait node duration |

---

## Workflow — 10 Nodes

```
Webhook (responseMode: onReceived)
  → Token Check (IF node, X-Norr-Token header)
  → Prep Fields (Code node)
  → Wait (1 / 3 / 7 days based on delay field)
  → Build Claude Prompt (Set node)
  → Claude API (HTTP Request → Anthropic)
  → Parse SMS (Code node)
  → Send SMS (Twilio)
  → Has Email? (IF node)
  → Send Email (HTTP Request → SendGrid v3)
```

### Node details

**Webhook** — path: `/webhook/review-request`, responds immediately so agent sees confirmation without waiting for Claude.

**Token Check** — same `X-Norr-Token` as all other workflows. Invalid token drops silently.

**Prep Fields (Code node)** — normalizes payload:
- Strips non-digits from phone, prepends `+1`
- Passes through: `client_name`, `client_phone`, `client_email`, `transaction_type`, `property_address`, `delay_days`, `agent_name`, `google_url`, `zillow_url`

**Wait** — duration set from `delay_days` field (1, 3, or 7). Pauses execution; resumed automatically by n8n scheduler.

**Build Claude Prompt (Set node)** — builds prompt string, passed to Claude as `$json.prompt`.

**Claude API (HTTP Request)** — model: `claude-sonnet-4-20250514`, max_tokens: 400. Returns labeled blocks.

**Parse + Send SMS (Code node + Twilio)** — parses `SMS:` block, appends review links on new lines, sends via Twilio.

**Has Email? (IF node)** — checks `client_email` is non-empty. True branch continues to SendGrid; false branch ends execution.

**Send Email (HTTP Request → SendGrid v3)** — parses `EMAIL_SUBJECT:` and `EMAIL_BODY:` blocks, builds HTML email, posts to `api.sendgrid.com/v3/mail/send`. Uses Header Auth credential (`Authorization: Bearer SG.xxx`) — same pattern as Open House Setup.

---

## Claude Prompt Design

Claude receives: client name, transaction type, property address, agent name.

**Output format (labeled blocks, parsed by Code node):**
```
SMS:
<≤160 chars, warm + ask, no links — links appended by Code node>

EMAIL_SUBJECT:
<subject line>

EMAIL_BODY:
<2–3 short paragraphs, plain conversational tone>
```

**Framing by transaction type:**
- Buyer → "Congrats on your new home at [address]"
- Seller → "Congrats on a successful sale at [address]"

Both ask for an honest review and note it only takes a minute. Claude does not include URLs — the Code node appends them to ensure they are never mangled.

---

## Link Handling

Links are assembled by the Code node after parsing Claude's output:

**SMS** — appended as plain text on new lines after Claude's message:
```
⭐ Google: <google_url>
⭐ Zillow: <zillow_url>   ← omitted if zillow_url is blank
```

**Email** — appended as plain `<a href>` links in the email HTML. No button styling — keeps the email out of Promotions tab. URLs are `&amp;`-escaped in HTML attributes.

---

## Error Handling & Edge Cases

| Case | Behavior |
|------|---------|
| No Zillow URL | Code node checks; only Google link included |
| No client email | IF node before SendGrid skips email step; SMS still fires |
| Phone with country code prefix | Code node strips non-digits and prepends `+1` — same caveat as Lead Response (double-prefix if `1XXXXXXXXXX` is entered; document in TESTING_NOTES) |
| Invalid token | Token Check IF drops to false branch; no action |

---

## Testing

**Wait node testing:** manually resume the paused execution in n8n Executions panel — same approach as Open House Follow-Up.

**Test checklist (to be added to `n8n/TESTING_NOTES.md`):**
- Submit as Buyer — verify Claude framing ("new home")
- Submit as Seller — verify Claude framing ("successful sale")
- Submit with no Zillow URL — verify only Google link appears in SMS and email
- Submit with no client email — verify SMS fires, no SendGrid error
- Submit with 1-day, 3-day, and 7-day delay — verify Wait node picks up correct duration
- Manually resume — confirm SMS and email both arrive with correct content
- Submit with invalid token — confirm no message sent

---

## What This Is Not

- No follow-up sequence — single message only
- No CRM or Google Sheets trigger — manual agent form for now; automation deferred
- No unsubscribe handling — Twilio opt-outs handled at carrier level; n8n logs errors for opted-out numbers (same as Cold Nurture)
