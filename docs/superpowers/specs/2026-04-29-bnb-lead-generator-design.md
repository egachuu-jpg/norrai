# B&B Manufacturing — Automated Lead Generator Design

**Date:** 2026-04-29
**Client:** B&B Manufacturing and Assembly, Faribault, MN
**NorrAI Tier:** Growth (demo)
**Status:** Design approved, pending implementation

---

## Overview

B&B Manufacturing currently has no systematic outbound prospecting. This workflow runs every Monday at 6am, searches Apollo.io for regional OEM manufacturers matching B&B's served industries and buyer titles, scores each lead with Claude, and sends a review email to B&B with a drafted outreach message for each qualified lead. A human at B&B copies the draft and sends from their own email.

**What this does:**
- Searches Apollo.io for contacts within 250 miles of Faribault, MN in target industries
- Deduplicates against a Google Sheet exclusion list (existing customers, closed/dead leads)
- Scores each lead 1-10 with Claude based on industry fit and title
- Drafts a personalized cold outreach email for each lead scoring 8+
- Sends a review email to B&B (egachuu@gmail.com placeholder) with the draft and lead context
- Logs each qualified lead to Neon for audit and dedup in future runs

**What this does not do:**
- Send outreach directly to prospects (human reviews and sends manually)
- Enrich leads via LinkedIn (stubbed for future Apify integration)
- Replace judgment on edge cases (Claude scores but a human still decides to send)

---

## Architecture & Data Flow

```
Schedule Trigger (Monday 6am)
  → Apollo.io Search [HTTP Request] — ~15 contacts
  → Read Exclusion Sheet [Google Sheets]
  → Filter & Dedup [Code node] — removes excluded contacts, outputs one item per lead
  → SplitInBatches(1)
      → Score with Claude [HTTP Request] — returns {score, reason}
      → IF score >= 8
          → Draft Outreach [HTTP Request → Claude]
          → Send Review Email [SendGrid] — to B&B with draft copy
          → Log to Neon [HTTP Request]
      → IF score < 8 → no-op, batch continues
```

**Stack:** n8n Cloud + Apollo.io API + Google Sheets + Claude API + SendGrid + Neon Postgres

**Stop after 5:** Apollo is set to return ~15 contacts. After dedup and exclusion filtering, approximately 8-10 remain. With a ~40-50% qualification rate at the 8+ threshold, the run produces ~4-6 review emails — naturally close to the 5-lead target without requiring a hard mid-loop stop. If Apollo returns an unusually clean batch and more than 5 qualify, all qualified leads are processed (extra leads are a feature, not a bug).

---

## Apollo.io Integration

**Endpoint:** `POST https://api.apollo.io/v1/mixed_people/search`

**Filters:**
```json
{
  "person_locations": ["Faribault, Minnesota"],
  "person_location_radius_miles": 250,
  "organization_industry_tag_ids": [
    "Machinery Manufacturing",
    "Fabricated Metal Products",
    "Industrial Machinery"
  ],
  "person_titles": [
    "Sourcing Manager",
    "Procurement Manager",
    "Operations Manager",
    "Plant Manager"
  ],
  "contact_email_status": ["verified"],
  "per_page": 15
}
```

**Fields pulled:** `first_name`, `last_name`, `title`, `email`, `organization_name`, `organization_website_url`, `city`, `state`

**Auth:** `X-Api-Key` header — stored in n8n credentials. B&B provisions their own Apollo account and provides the key.

**Required dependency:** B&B must create an Apollo.io account before this workflow can run in production.

---

## Exclusion List (Google Sheet)

**Sheet structure:**

| company_name | domain |
|---|---|
| B&B Manufacturing | bBmfg.com |
| Acme Corp | acmecorp.com |

**Matching logic (Code node):**
- Case-insensitive contains match on `company_name` against Apollo `organization_name`
- Strip `www.` and match `domain` against Apollo `organization_website_url`
- Either match = exclude

**Updates:** B&B adds companies to the sheet manually when a deal closes or a lead goes cold. Exclusion applies on the next Monday run.

**JobBOSS stub:** A comment in the Code node marks where the Google Sheet check should be replaced with a JobBOSS API lookup when integration is available.

---

## Claude Scoring

**One HTTP Request per lead (inside SplitInBatches).**

**Prompt:**
```
You are a lead qualifier for B&B Manufacturing and Assembly, a custom metal fabrication shop
in Faribault, MN. They specialize in laser cutting, CNC machining, MIG/TIG/robotic welding,
press brake forming, and powder coating for OEM manufacturers in agriculture, aerospace, food
processing, and industrial markets. They hold ISO 9001:2015 certification.

Score this lead from 1–10 based on fit:
- 8–10: Strong fit — OEM manufacturer in a served industry, decision-maker title, regional proximity
- 5–7: Possible fit — adjacent industry or unclear role
- 1–4: Poor fit — consumer, retail, or irrelevant industry

Lead:
Name: {{name}}
Title: {{title}}
Company: {{company}}
Location: {{city}}, {{state}}

Return ONLY valid JSON: {"score": 8, "reason": "one sentence"}
```

**Model:** `claude-sonnet-4-6`, max_tokens: 150

The `reason` field is logged to Neon and included in the review email so B&B can see why each lead was selected.

---

## Outreach Draft

**One HTTP Request per qualified lead.**

**Prompt:**
```
Write a cold outreach email from B&B Manufacturing and Assembly (Faribault, MN) to
{{first_name}} {{last_name}}, {{title}} at {{company}}.

B&B is a 55,000 sq ft custom metal fabrication shop: laser cutting, CNC machining,
MIG/TIG/robotic welding, press brake forming, powder coating. ISO 9001:2015 certified.
Serves OEMs in ag, aerospace, food processing, and industrial markets.

Requirements:
- Address them by first name
- Reference their industry or likely pain (faster turnaround, reliable fabrication partner)
- One concrete B&B capability that fits their world
- CTA: 15-minute discovery call
- Sign off: "B&B Manufacturing and Assembly"
- Under 100 words — this is cold outreach, not a pitch deck
- Warm and direct, not corporate

Return ONLY the email body. No subject line. No formatting markers.
```

**Model:** `claude-sonnet-4-6`, max_tokens: 300

---

## Review Email (SendGrid)

One email per qualified lead sent to `egachuu@gmail.com` (placeholder — replace with B&B inbox before go-live).

**From:** studio@norrai.co
**Subject:** `Lead Review — {{first_name}} {{last_name}}, {{company}} (Score: {{score}}/10)`

**Body:**
```
Lead: {{full_name}} — {{title}} at {{company}}, {{city}}, {{state}}
Score: {{score}}/10 — {{reason}}
Email: {{email}}

Drafted outreach:
---
{{draft}}
---

To use: copy the draft above and send from your own email address.
```

**Credential:** SendGrid account `A5ypmjiRLAUMUm9O` (same as other NorrAI workflows)

---

## Neon Logging

**Table: `leads`** — one row per qualified lead (score >= 8):
```json
{
  "client_id": "<B&B client ID>",
  "lead_name": "{{first_name}} {{last_name}}",
  "email": "{{email}}",
  "phone": null,
  "source": "bnb_lead_generator",
  "metadata": {
    "company": "{{company}}",
    "title": "{{title}}",
    "location": "{{city}}, {{state}}",
    "apollo_score": 8,
    "score_reason": "OEM manufacturer in ag sector, procurement title",
    "draft_sent": true,
    "run_date": "2026-05-04"
  }
}
```

**Table: `workflow_events`** — one row per weekly run:
```json
{
  "workflow": "bnb_lead_generator",
  "status": "success",
  "metadata": {
    "apollo_returned": 15,
    "after_dedup": 10,
    "qualified": 5,
    "drafts_sent": 5,
    "run_date": "2026-05-04"
  }
}
```

**Connection:** Neon project `norrai` (`gentle-hill-54285247`), `neondb`, `us-east-1`. Connection string stored in n8n credentials.

---

## Error Handling

- **Continue on Fail** enabled on all nodes — a single bad lead (Apollo data issue, Claude timeout) doesn't kill the run
- Failed leads are logged in n8n execution view; `workflow_events` row still records what succeeded
- If Apollo returns 0 results, the workflow exits gracefully with no emails sent

---

## Production Upgrade Path

| Component | Demo | Production |
|---|---|---|
| Exclusion list | Google Sheet | JobBOSS API lookup |
| Review email recipient | egachuu@gmail.com | B&B sales inbox |
| LinkedIn enrichment | Stubbed (comment only) | Apify actor |
| Sender address | studio@norrai.co | B&B branded address |
| Apollo account | B&B provisions | B&B provisions |

---

## Key Decisions

- **SplitInBatches(1) for per-lead processing:** Natural n8n pattern; each lead is a visible step in the execution view, making it easy to debug which lead caused an issue.
- **Separate Claude calls for scoring and drafting:** Keeps prompts focused and outputs predictable. Batch scoring would be cheaper but harder to debug and parse.
- **Review email rather than direct send:** B&B retains control. Cold outreach sent from a no-reply automation address would hurt deliverability and brand. Human sender = human relationship.
- **Google Sheet exclusion list:** Zero infrastructure for demo. JobBOSS is the production answer but requires API access B&B doesn't have yet.
- **No hard stop at 5:** Apollo volume + dedup + 8+ threshold naturally produces ~5 leads. A hard stop would require state management across SplitInBatches iterations — complexity not worth it at this scale.
