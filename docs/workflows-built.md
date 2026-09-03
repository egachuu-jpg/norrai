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
- **Status:** Fully automated, live on n8n Cloud as of 2026-09-01. No manual/human step remains — see design spec `docs/superpowers/specs/2026-08-18-weichert-weekly-drip-automation-design.md` and plan `docs/superpowers/plans/2026-08-18-weichert-weekly-drip-automation.md` for full detail on the automation build.
- **Two live workflows (n8n IDs):**
  - Weekly Marketing Drip - Send (`wSXuvtUorzoLmktv`) — Monday 9am CT cron (workflow timezone `America/Chicago`). Scrapes Weichert Heartland's own listing feed via Apify (see below), dedupes against `weichert_sent_listings`, selects up to 10 newest listings (falls back to the 10 most recent overall on a zero-new week), builds the email, per-lead SendGrid send (100ms Wait between sends), upserts the sent listings into the dedupe table.
  - Marketing Opt-Out (`oiefZVdPfLPRsTZM`) — webhook `/webhook/marketing-opt-out?lead_id=&token=`, idempotent, flips `leads.communication_opted_out`. Unchanged by the automation work.
  - The former **Weekly Marketing Drip - Intake** workflow (`KDWC5WwRJuNldOCY`) is **deactivated** (retired 2026-09-01) — it used to receive submissions from a manual agent-facing form. That form (`website/clients/weichert_weekly_listings_form.html`) has been deleted, along with its Playwright test.
- **Listing source:** `https://www.teamyellownow.com/index.php?showagency=1` — the Weichert Heartland office's own IDX listing feed (Weichert-branded listings only, not the broader regional MLS search). This site sits behind a Cloudflare interactive challenge, so it's scraped via an Apify Puppeteer actor with a US-pinned residential proxy (a plain HTTP GET gets a `403`) rather than the simple fetch used elsewhere. Listing photos resolve from plain, unprotected CloudFront URLs embedded in the scrape results, so no second protected fetch per listing is needed.
- **Dedupe:** `weichert_sent_listings` table (`mls_id` PRIMARY KEY, upserted via `ON CONFLICT`) tracks every MLS ID ever featured, so the same property isn't re-blasted week over week.
- **Opt-out token:** HMAC-SHA256(lead_id) hex computed in **Postgres via pgcrypto** (`encode(hmac(id::text, secret, 'sha256'),'hex')`), shared secret = the standard `X-Norr-Token`. Send generates the token in the Get Leads query; Opt-Out re-derives + compares it in a Verify Token query. (n8n Cloud's task runner exposes no `crypto` global and no `require`, and the Crypto node needs a credential — pgcrypto avoids both and guarantees both sides match.)
- **Schema:** `leads.communication_opted_out` column + `weichert_sent_listings` table (both applied to Neon prod). The old `listing_queue` table is retained as historical record of the manual era but no longer receives writes.
- **Send filter:** marketing broadcasts suppress on BOTH `communication_opted_out != true AND email_opt_out != true`; a pre-flight canary to hello@norrai.co gates the whole batch on a real SendGrid round-trip (see `docs/lessons-learned.md`)
- **From address:** sends from `hello@norrai.co` (the only SendGrid-verified sender) with the agent's name as display name and their real address as Reply-To. Switching the visible From to `eknutson@`/`mjasinski@teamyellownow.com` directly is a parking-lot item — it requires verifying those addresses as senders in SendGrid first (Single Sender Verification or full domain auth), not yet done.
- **Go-live gates:** all cleared. SendGrid volume cleared earlier (Essentials 50K Email API); a manual dry-run test execution (2026-09-01, redirected to a test inbox) confirmed the full scrape → dedupe → build → send pipeline works end-to-end before the Send workflow was activated for real.
