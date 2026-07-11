# Workflows Built — Status Log

Reference for workflows that are wired and their current state. Status lines
here go stale — treat this as a snapshot, not a live dashboard. For live health
per client, query `workflow_events` in Neon.

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
- **Stack:** Webhook → Token Check → Prep Input (Code) → Log Triggered (Neon) → Cache Lookup (Neon, 7-day TTL) → Evaluate Cache (Code) → [cache hit] Respond Cached / [cache miss] Census Geocoder → Build Gemini Prompt (Code) → Gemini 2.5 Flash + Google Search grounding (HTTP) → Parse + Compliance Filter (Code) → Claude Haiku Formatter (HTTP) → Build Final Output (Code) → Save to Cache (Neon) → Log Completed (Neon) → Respond to Webhook
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

## Weekly Marketing Drip (Weichert weekly listing email)
- **Status:** Built, validated, pushed to n8n Cloud. Intake + Opt-Out are **active and smoke-tested**; Send is **inactive pending go-live** (see PRD `obsidian/PRDs/2026-05-22-weekly-marketing-drip.md`)
- **Three workflows (n8n IDs):**
  - Weekly Marketing Drip - Intake (`KDWC5WwRJuNldOCY`) — webhook `/webhook/weekly-marketing-drip-intake`, writes form submission to `listing_queue` (status `pending`)
  - Weekly Marketing Drip - Send (`wSXuvtUorzoLmktv`) — Monday 9am CT cron (workflow timezone `America/Chicago`); reads latest pending queue row, best-effort photo scrape, per-lead SendGrid send (100ms Wait between sends), marks queue `sent`
  - Marketing Opt-Out (`oiefZVdPfLPRsTZM`) — webhook `/webhook/marketing-opt-out?lead_id=&token=`, idempotent, flips `leads.communication_opted_out`
- **Form:** `website/clients/weichert_weekly_listings_form.html` (Cloudflare Access — clients)
- **Opt-out token:** HMAC-SHA256(lead_id) hex computed in **Postgres via pgcrypto** (`encode(hmac(id::text, secret, 'sha256'),'hex')`), shared secret = the standard `X-Norr-Token`. Send generates the token in the Get Leads query; Opt-Out re-derives + compares it in a Verify Token query. (n8n Cloud's task runner exposes no `crypto` global and no `require`, and the Crypto node needs a credential — pgcrypto avoids both and guarantees both sides match.)
- **Schema:** `leads.communication_opted_out` column + `listing_queue` table (applied to Neon prod)
- **Send filter:** marketing broadcasts suppress on BOTH `communication_opted_out != true AND email_opt_out != true`; a pre-flight canary to hello@norrai.co gates the whole batch on a real SendGrid round-trip (see `docs/lessons-learned.md`)
- **Listing photos:** the listing-detail page `https://northstar.weichert.com/{listing_id}/` is server-rendered with full OpenGraph `og:image`/`og:title` — a plain HTTP GET + regex gets the photo, no Apify/JS-render needed (see `docs/lessons-learned.md`)
- **Go-live gates:** (1) SendGrid volume — **CLEARED** (Essentials 50K Email API, ~3,900/mo needed); (2) listing photos — resolved via og:image scrape above; (3) activate the Send workflow (Monday 9am CT cron)
