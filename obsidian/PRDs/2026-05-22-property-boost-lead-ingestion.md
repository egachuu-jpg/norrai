# Boosted Property Lead Ingestion — PRD
**Date:** 2026-05-22
**Status:** Backlog
**Client:** Weichert, Realtors® — Heartland (Evan Knutson + Michelle Jasinski)
**Neon story:** Weichert Realty — Boosted Property Lead Ingestion

---

## Overview

BoldTrail's PropertyBoost feature runs Facebook Lead Ads for listings. When someone fills out the ad form, BoldTrail sends a "New Lead Notification" HTML email from `no-reply@boldtrail.com` directly to the listing agent. This pipeline monitors both agents' Gmail inboxes for these emails, parses the HTML with Claude Haiku, inserts the lead into Neon, and fires the existing `instant_lead_response` workflow — all within seconds of the email arriving.

---

## Email Format (BoldTrail PropertyBoost)

**Sender:** `no-reply@boldtrail.com`
**Subject:** `New Lead Email - [Lead Name]`

Fields extracted from the HTML body:

| Field | Example |
|---|---|
| Lead name | Tina Jore |
| Phone | (507) 456-8642 |
| Email | ddsberndt@hotmail.com |
| Property interest | Owatonna, 310k, 4 beds, 2 baths |
| Source | PropertyBoost |
| Referrer | Facebook: LeadAd |
| Listing URL (from Notes) | https://jake-piller.teamyellownow.com/details/?mls=133&mlsid=6801630&... |

Example email on file: `docs/New Lead Email - Tina Jore.eml`

---

## Architecture

```
Gmail inbox (Evan or Michelle)
  ← BoldTrail sends "New Lead Email" from no-reply@boldtrail.com

n8n Gmail Trigger (filter: from:no-reply@boldtrail.com subject:"New Lead Email")
  → extract HTML body
  → call PropertyBoost Parser subworkflow
      → Claude Haiku: parse HTML → structured JSON
      → Dedupe: SELECT FROM leads WHERE (email OR phone) AND client_id
          → if duplicate: stop
          → if new: INSERT INTO leads
                      source = 'property_boost'
                      status = 'new'
                      listing_url → metadata jsonb
      → POST /webhook/instant-lead-response
  → log to workflow_events
```

Two separate Gmail trigger workflows — one per agent — feeding into one shared parser subworkflow.

---

## Workflows

| Workflow | Type | Trigger | workflow_name |
|---|---|---|---|
| PropertyBoost Intake — Evan | Gmail Trigger | new email from BoldTrail | `property_boost_intake` |
| PropertyBoost Intake — Michelle | Gmail Trigger | new email from BoldTrail | `property_boost_intake` |
| PropertyBoost Parser | Subworkflow | called by intake workflows | `property_boost_parser` |

Both intake workflows log under the same `workflow_name` — `client_id` in the payload differentiates Evan vs Michelle in `workflow_events`.

---

## Gmail Credential Setup

Both agents use Google Workspace (`@teamyellownow.com`). In n8n:
- Credentials → New → Gmail OAuth2
- Each agent completes their own OAuth flow
- Scopes: `gmail.readonly`, `gmail.labels`
- Named: `"Gmail - Evan Knutson"` and `"Gmail - Michelle Jasinski"`

Gmail trigger filter query: `from:no-reply@boldtrail.com subject:"New Lead Email"`

---

## Claude Haiku Parsing Prompt

```
Extract the following fields from this BoldTrail New Lead Notification HTML email.
Return valid JSON only. No explanation.

Fields:
- lead_name (string)
- phone (string, digits only, no formatting)
- email (string)
- property_interest (string — city, price, beds, baths as-is)
- source (string)
- referrer (string)
- listing_url (string — the URL from the Notes field, or null if absent)

HTML:
{{html_body}}
```

Validated against Tina Jore example before going live.

---

## Neon Lead Insert

```sql
INSERT INTO leads (
  client_id, lead_name, email, phone,
  source, lead_message, status, metadata
) VALUES (
  $client_id,
  $lead_name,
  $email,
  $phone,
  'property_boost',
  $property_interest,
  'new',
  '{"listing_url": "...", "referrer": "Facebook: LeadAd"}'::jsonb
)
```

Dedupes on `(email OR phone) AND client_id` before insert.

---

## Instant Lead Response

After insert, fire POST to `/webhook/instant-lead-response` with the normalized lead payload. Reuses the existing `instant_lead_response` workflow — no changes needed. Agent email is passed as `agent_email` in the payload so the response comes from the correct agent.

---

## Task Sequence

| Seq | Title | Category |
|---|---|---|
| 1 | Set up Gmail OAuth credentials in n8n for Evan and Michelle | ops |
| 2 | Build n8n PropertyBoost parser subworkflow | dev |
| 3 | Build n8n PropertyBoost intake workflow — Evan | dev |
| 4 | Build n8n PropertyBoost intake workflow — Michelle | dev |
| 5 | Validate Claude Haiku parsing against Tina Jore email | testing |
| 6 | Add workflow_events logging + register workflow names in CLAUDE.md | ops |
| 7 | Smoke test end-to-end: email → parse → Neon insert → instant response | testing |
| 8 | Go live — activate both Gmail triggers | ops |
