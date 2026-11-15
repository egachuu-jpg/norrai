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
- **Status:** Live on n8n Cloud since 2026-09-01. **Since 2026-11 the scrape is blocked** (Cloudflare challenge beats the Apify residential proxy; failed Nov 2 + Nov 9), so listings are queued by hand each week via the Drip Listings bookmarklet (below) until the site vendor adds a Cloudflare skip rule or an MLS/IDX feed is set up. Originally fully automated — see design spec `docs/superpowers/specs/2026-08-18-weichert-weekly-drip-automation-design.md` and plan `docs/superpowers/plans/2026-08-18-weichert-weekly-drip-automation.md` for full detail on the automation build.
- **Two live workflows (n8n IDs):**
  - Weekly Marketing Drip - Send (`wSXuvtUorzoLmktv`) — Monday 9am CT cron (workflow timezone `America/Chicago`). First checks `listing_queue` for a pending batch from the last 7 days (items with `mls_id`); if found it skips the scrape, uses the batch, and marks it `sent` at the end (`from_queue` in the `completed` payload). Otherwise scrapes Weichert Heartland's own listing feed via Apify (see below), dedupes against `weichert_sent_listings`, selects up to 10 newest listings (falls back to the 10 most recent overall on a zero-new week), builds the email, per-lead SendGrid send (100ms Wait between sends), upserts the sent listings into the dedupe table.
  - Marketing Opt-Out (`oiefZVdPfLPRsTZM`) — webhook `/webhook/marketing-opt-out?lead_id=&token=`, idempotent, flips `leads.communication_opted_out`. Unchanged by the automation work.
  - **Weekly Marketing Drip - Intake** (`KDWC5WwRJuNldOCY`) — retired 2026-09-01, **reactivated 2026-11-15** for the manual fallback. `POST /webhook/weekly-marketing-drip-intake` (`X-Norr-Token`) with `{listings:[{mls_id, address, price, beds, baths, sqft, url, photo_thumb_url}]}`; validates (MLS id + https url, max 20), cancels any older pending batch, inserts a new `pending` one.
  - **Drip Listings page** (`website/internal/drip_listings.html`, test `tests/drip_listings.spec.js`) — hosts the *Send to Norr AI* bookmarklet. Run it on `https://northstar.weichert.com/MN/Rice/Faribault/` (Weichert's city search, all brokerages): it keeps only cards whose `.card-text-misc` says Heartland, opens this page with the listings in the URL hash, preview → Queue posts to Intake. Paste box fallback if the popup is blocked.
  - `ZZ TEST - Weekly Drip Send (single recipient)` (`M1oFzCHX73d9w0MR`, inactive) — read-only copy of the queue → cards → email path, hardcoded to one test inbox, no DB writes. Activate, POST `/webhook/zz-test-drip-send-20261115`, deactivate.
- **Listing source:** `https://www.teamyellownow.com/index.php?showagency=1` — the Weichert Heartland office's own IDX listing feed (Weichert-branded listings only, not the broader regional MLS search). This site sits behind a Cloudflare interactive challenge, so it's scraped via an Apify Puppeteer actor with a US-pinned residential proxy (a plain HTTP GET gets a `403`) rather than the simple fetch used elsewhere. Listing photos resolve from plain, unprotected CloudFront URLs embedded in the scrape results, so no second protected fetch per listing is needed.
- **Dedupe:** `weichert_sent_listings` table (`mls_id` PRIMARY KEY, upserted via `ON CONFLICT`) tracks every MLS ID ever featured, so the same property isn't re-blasted week over week.
- **Opt-out token:** HMAC-SHA256(lead_id) hex computed in **Postgres via pgcrypto** (`encode(hmac(id::text, secret, 'sha256'),'hex')`), shared secret = the standard `X-Norr-Token`. Send generates the token in the Get Leads query; Opt-Out re-derives + compares it in a Verify Token query. (n8n Cloud's task runner exposes no `crypto` global and no `require`, and the Crypto node needs a credential — pgcrypto avoids both and guarantees both sides match.)
- **Schema:** `leads.communication_opted_out` column + `weichert_sent_listings` table (both applied to Neon prod). `listing_queue` (`pending｜sent｜cancelled`) holds manual batches — written by Intake, consumed by Send.
- **Send filter:** marketing broadcasts suppress on BOTH `communication_opted_out != true AND email_opt_out != true`; a pre-flight canary to hello@norrai.co gates the whole batch on a real SendGrid round-trip (see `docs/lessons-learned.md`)
- **From address:** sends from `hello@norrai.co` (the only SendGrid-verified sender) with the agent's name as display name and their real address as Reply-To. Switching the visible From to `eknutson@`/`mjasinski@teamyellownow.com` directly is a parking-lot item — it requires verifying those addresses as senders in SendGrid first (Single Sender Verification or full domain auth), not yet done.
- **Go-live gates:** all cleared. SendGrid volume cleared earlier (Essentials 50K Email API); a manual dry-run test execution (2026-09-01, redirected to a test inbox) confirmed the full scrape → dedupe → build → send pipeline works end-to-end before the Send workflow was activated for real.

## Agent MCP Connector (to-dos + hot leads in the Claude app)
- **Status:** Built and SQL-tested locally (2026-10-03), **not yet imported or deployed**. `agent_tasks` table not yet applied to Neon prod.
- **Two workflows:**
  - Real Estate Agent MCP Server — `MCP Server Trigger` exposing 4 tools (`add_task`, `list_tasks`, `complete_task`, `get_hot_leads`). One copy per agent; each tool hardcodes that agent's `agent_email`.
  - Real Estate Agent Tools (`agent_tools`) — sub-workflow every tool calls: Lookup Client → Log Triggered → Prep Input (validate + SQL-escape) → Route Action → one Postgres query per action → Log Completed → Format Result.
- **Every query returns exactly one row** (`json_build_object(...) AS result`), so a "nothing found" answer still reaches Claude instead of an empty run.
- **Times:** stored as timestamptz, read and written in `America/Chicago`. A date-only due date means 5pm Central.
- **Setup + auth notes:** `docs/agent-mcp-server.md`
