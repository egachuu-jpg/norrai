# Workflows Built — Status Log

Reference for workflows that are wired and their current state. Status lines
here go stale — treat this as a snapshot, not a live dashboard. For live health
per client, query `workflow_events` in Neon.

> **Note (flagged in 2026-07 audit):** the Research Agent stack below and
> `PRD/research-agent.md` both say "Gemini 2.0 Flash", but
> `docs/lessons-learned.md` records that `gemini-2.0-flash` is unavailable to
> new API users (use `gemini-2.5-flash`). Confirm which model the live workflow
> actually calls and reconcile all three docs.

## Missed Call → Auto SMS
- **Status:** Working end to end
- **Stack:** Twilio webhook → n8n IF node (business hours check) → Twilio SMS (two branches: in-hours / after-hours message)
- **Pending:** Upgrade Twilio account from trial, buy local 507 area code number to replace toll-free 855 number

## Listing Description Generator
- **Status:** Working end to end
- **Stack:** Webhook → Set node (build prompt) → HTTP Request (Claude API) → Code node (parse response) → SendGrid
- Claude returns plain text with `HEADLINE:` / `MLS_DESCRIPTION:` / `SOCIAL_MEDIA_POST:` labels — Code node splits on these
- Email sends from hello@norrai.co via SendGrid native n8n node
- Agent voice personalization: few-shot prompting with 3–5 of agent's previous listings pasted into prompt
- **Webhook URL:** `https://norrai.app.n8n.cloud/webhook/listing-description`

## Research Agent (Subworkflow)
- **Status:** Live in production — smoke tested 2026-05-10
- **Stack:** Webhook → Token Check → Prep Input (Code) → Log Triggered (Neon) → Cache Lookup (Neon, 7-day TTL) → Evaluate Cache (Code) → [cache hit] Respond Cached / [cache miss] Census Geocoder → Build Gemini Prompt (Code) → Gemini 2.0 Flash + Google Search Grounding (HTTP) → Parse + Compliance Filter (Code) → Claude Haiku Formatter (HTTP) → Build Final Output (Code) → Save to Cache (Neon) → Log Completed (Neon) → Respond to Webhook
- **Webhook URL:** `https://norrai.app.n8n.cloud/webhook/research-agent`
- **Input:** `address`, `city`, `state`, `zip`, `price_range`, `beds`, `baths` (+ optional `sqft`, `year_built`, `caller`, `client_id`)
- **Output:** `status`, `address_verified`, `walkability`, `schools`, `market`, `recent_comps`, `data_confidence`, `insight_block`, `comps_disclaimer`
- **Credentials needed in n8n:** "Gemini API Key" (Query Auth credential — name: `key`, value: your Gemini API key) — created and wired
- **Prerequisites:** `research_cache` table in Neon (added to `db/schema.sql` — apply to production)
- See `PRD/research-agent.md` for full spec

## Event Ops Discovery Form
- **Status:** Working end to end
- **Stack:** `event_ops_discovery.html` → n8n webhook → (review + routing)
- 6-section discovery questionnaire: About You, Event Volume & Types, Where Your Time Goes (1–5 rating scales), Current Tools & Stack, Repetitive Work, Priorities & Goals
- Collects: team size, capacity gap, events/year, attendee volume, event types, time-sink ratings across 7 categories, current registration/comms/data tools, manual step walkthrough, recurring email and report types, biggest pain, success criteria, openness to new tools
- Payload fields include multi-select pill groups serialized as comma-separated strings, rating scale values as integers, and free-text fields
- **Webhook URL placeholder:** `https://YOUR-N8N-INSTANCE.app.n8n.cloud/webhook/event-ops-discovery`
- **Origin:** Built for a warm lead — senior event ops manager at Prep Network who lost two employees; her director is also running an internal AI automation analysis this quarter
