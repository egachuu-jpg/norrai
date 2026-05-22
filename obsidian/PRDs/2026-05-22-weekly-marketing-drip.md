# Weekly Marketing Drip — PRD
**Date:** 2026-05-22
**Status:** Backlog
**Client:** Weichert, Realtors® — Heartland (Evan Knutson + Michelle Jasinski)
**Neon story:** Weichert Realty — Weekly Marketing Drip

---

## Overview

Weekly listing update emails sent every Monday at 9am CT to all leads in the Neon leads table for both agents. One agent-facing intake form collects up to 10 listing URLs. Apify scrapes each URL for listing data. SendGrid forks the send: Evan's leads get his contact info and signature, Michelle's get hers. Opt-out link in every email.

---

## Flow

```
Agent fills weichert_weekly_listings_form.html
  → POST /webhook/weekly-marketing-drip-intake
    → INSERT INTO listing_queue (listings, status='pending')

[Monday 9am CT]
  → weekly_marketing_drip scheduled workflow fires
    → SELECT latest pending row from listing_queue
    → Loop: Apify scrape each listing URL
      → extract photo, price, address, link
    → Build HTML email (Code node, Weichert template)
    → Evan send: SELECT leads WHERE client_id=evan AND opted_out!=true
      → SendGrid per-lead with Evan's contact info + tokenized opt-out URL
    → Michelle send: SELECT leads WHERE client_id=michelle AND opted_out!=true
      → SendGrid per-lead with Michelle's contact info + tokenized opt-out URL
    → UPDATE listing_queue SET status='sent'

[Lead clicks opt-out]
  → GET /webhook/marketing-opt-out?lead_id=xxx&token=xxx
    → UPDATE leads SET communication_opted_out=true
```

---

## New Schema

### `communication_opted_out` column on `leads`
```sql
ALTER TABLE leads ADD COLUMN communication_opted_out BOOLEAN NOT NULL DEFAULT FALSE;
```
- `true` = exclude from all marketing broadcast emails
- Does **not** affect transactional messages (reminders, nurture, follow-ups)
- Flipped via the marketing-opt-out webhook

### `listing_queue` table
```sql
CREATE TABLE listing_queue (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  listings     jsonb NOT NULL,
  status       text NOT NULL DEFAULT 'pending',
  sent_at      timestamptz
);
```
`listings` shape: `[{url: string, address: string|null}]` — max 10 entries.

Status values: `pending` → `sent` | `failed`

---

## Intake Form — weichert_weekly_listings_form.html

- Location: `website/clients/weichert_weekly_listings_form.html` (Cloudflare Access — clients group)
- 10 rows × (Listing URL + optional Address)
- At least one URL required to submit
- Payload: `{listings: [{url, address}, ...]}` — empty rows excluded
- Success message: *"Listings queued — the email will send this Monday at 9am CT."*
- Design: Polar Modern (internal Norr AI tool, not Weichert-branded)

---

## Apify Scraping

- Target: individual listing pages on `northstar.weichert.com`
- Extract per listing: main photo URL, address, price, listing URL (for CTA button)
- Called via Apify API from n8n HTTP node (synchronous run)
- Fall back to form-supplied address if Apify returns nothing
- Store API key as n8n credential

---

## Email Template

Responsive HTML, inline CSS (required for email client compatibility).

| Section | Content |
|---|---|
| Header | Weichert logo + "Weichert, Realtors® — Heartland — Faribault" |
| Intro | "Here are this week's featured listings in Faribault." |
| Listing cards (×10 max) | Photo, address, price, "View Listing" button → northstar.weichert.com |
| Agent CTA | "Interested in a showing? Call or text [name] at [phone]." |
| Signature | Name, phone, email |
| Footer | "Opt out of future listing emails" → opt-out webhook |

**Two variants** — identical except sections 4–6:

| | Evan | Michelle |
|---|---|---|
| Name | Evan Knutson | Michelle Jasinski |
| Phone | 507-210-9140 | 507-210-7967 |
| Email | eknutson@teamyellownow.com | mjasinski@teamyellownow.com |

Listing cards built dynamically in n8n via a Code node looping over Apify output.

---

## SendGrid Send Strategy

- **Per-lead sends** (not BCC) — required to personalize the opt-out URL per lead
- Filter: `communication_opted_out != true AND email IS NOT NULL`
- Evan's leads: `client_id = ded234e3-1c78-45c3-8924-6036e1fcaf60`
- Michelle's leads: `client_id = 451306d1-6437-42b8-8ffe-c16f28803490`
- From: `hello@norrai.co`
- Watch SendGrid rate limits for large lists

---

## Opt-Out

- Link in every email footer: `/webhook/marketing-opt-out?lead_id={{id}}&token={{hmac}}`
- Token = HMAC-SHA256 of lead_id (same pattern as nurture de-enroll)
- On click: `UPDATE leads SET communication_opted_out = true`
- Idempotent — clicking again returns "already unsubscribed" page
- CAN-SPAM compliant

---

## Workflow Registry

| Workflow | `workflow_name` |
|---|---|
| Weekly Marketing Drip — Intake | `weekly_marketing_drip_intake` |
| Weekly Marketing Drip — Send | `weekly_marketing_drip` |
| Marketing Opt-Out | `marketing_opt_out` |

---

## Risks & Watch Items

### SendGrid Send Volume
The per-lead send strategy (required for personalized opt-out URLs) means one API call per lead per Monday run. This creates a volume risk at scale.

**Before go-live, run this query after the CSV import:**
```sql
SELECT client_id, COUNT(*) as send_count
FROM leads
WHERE email IS NOT NULL
  AND communication_opted_out != true
GROUP BY client_id;
```

| List size | Recommendation |
|---|---|
| < 500 combined | Transactional sends fine. Add 100ms Wait node between sends in n8n loop. |
| 500–2,000 combined | Check SendGrid plan limit. Consider batching (chunks of 100 with a 1s pause). |
| 2,000+ combined | Switch to SendGrid Marketing Campaigns API (bulk send endpoint). Requires redesigning the send step in the Monday workflow — opt-out tokens would need to be embedded via SendGrid's substitution tags instead of generated per-lead in n8n. |

**Current SendGrid plan:** verify limit in dashboard before task 13 smoke test.

**Fallback option:** If list size warrants it, build the opt-out token into the lead record at import time (a `marketing_token` column on `leads`) so it's always available for bulk substitution — avoids having to HMAC at send time per lead.

---

## Task Sequence

| Seq | Title | Category |
|---|---|---|
| 1 | Add communication_opted_out column to leads table | ops |
| 2 | Add listing_queue table to Neon schema | ops |
| 3 | Import Weichert CRM contacts from BoldTrail CSV | ops |
| 4 | Create Apify account + test scraping a live listing URL | research |
| 5 | Collect Weichert Realty brand assets | ops |
| 6 | Design HTML email template — Weichert branded | dev |
| 7 | Build weichert_weekly_listings_form.html | dev |
| 8 | Build n8n marketing opt-out webhook workflow | dev |
| 9 | Build n8n weekly marketing drip — intake webhook | dev |
| 10 | Build n8n weekly marketing drip — Monday send workflow | dev |
| 11 | Add workflow_events logging + register workflow names | ops |
| 12 | Write Playwright tests for weichert_weekly_listings_form.html | testing |
| 13 | Test end-to-end: submit → scrape → preview → test send | testing |
| 14 | Go live — first weekly send to Weichert CRM list | ops |
