# Norr AI — Session Log

Historical record of work done per session. Not loaded into Claude's context by default — reference manually if needed. Active lessons extracted from here live in `CLAUDE.md ## Lessons Learned`.

---

### 2026-04-23
- Added `norr_ai_favicon.svg` to all 12 HTML pages
- Connected `listing_form.html` to production webhook (`https://norrai.app.n8n.cloud/webhook/listing-description`)
- Added localStorage agent profile persistence — saves `agent_name`, `agent_email`, `previous_listings` across sessions; "· saved / clear" badge in Your Voice section
- Split single address field into `street_address`, `city`, `state` (default MN), `zip`, `county`; constructs `property_address` for workflow
- Added price currency pattern validation + blur auto-format; changed `lot_size` to `type="number"` with decimal enforcement
- Added `X-Norr-Token` shared secret header to form fetch + n8n IF node for basic auth
- Fixed n8n workflow: removed hardcoded example listings, wired `previous_listings` from payload, fixed field name mismatches, added all new fields to Claude prompt, fixed `JSON.stringify` on prompt to prevent bad control character error, fixed double `$$` on price
- n8n workflow now includes Token Check IF node + Valid Email Check against DataTable allowlist
- Set up Playwright test suite — 41 tests, all passing (`npm test`)
- Initialized git repo, pushed to `github.com/egachuu-jpg/norrai`
- Deployed to Cloudflare Pages, custom domain `tools.norrai.co` live

### 2026-04-24
- Set up Neon Postgres — project `norrai` (`gentle-hill-54285247`), Postgres 17, `us-east-1`
- Applied `db/schema.sql` to production database: 7 tables (`clients`, `service_contracts`, `twilio_subaccounts`, `norrai_meetings`, `leads`, `appointments`, `workflow_events`), `set_updated_at()` trigger, indexes
- Added `DATABASE_URL` to `.env`, added `.env` to `.gitignore`
- Loaded test data across all 7 tables — 5 clients (dental, real estate, insurance, auto, wellness), realistic leads with vertical metadata, appointments, workflow events

### 2026-04-26
- Built `website/lead_response.html` + `n8n/workflows/Real Estate Instant Lead Response.json` — agent pastes a new lead, Claude drafts personalized SMS + email reply within 60 seconds; agent gets a copy preview
- Built `website/open_house.html` + `n8n/workflows/Real Estate Open House Follow-Up.json` — QR code on door, attendees sign in on their phone, Claude writes personalized follow-up sent at 9am CT next morning via SMS + email (if provided)
- Built `website/nurture_enroll.html` + `n8n/workflows/Real Estate 7-Touch Cold Nurture.json` — agent enrolls a cold lead, 6 Claude-written touches over 21 days (Day 1 email, Day 3 SMS, Day 7 email, Day 10 SMS, Day 14 email, Day 21 SMS); includes disconnected Auto-Trigger webhook node for future automation
- All 3 workflows use token check (`X-Norr-Token`), same Anthropic + SendGrid credentials as listing description workflow
- Created `n8n/TESTING_NOTES.md` — known gotchas, gaps, and production promotion checklist
- Created `n8n/TESTING_GUIDE.md` — step-by-step testing instructions per workflow
- Discussed DB architecture: `appointments` table schema is fine to keep, but don't build calendar scraping/normalization layer until a real client forces it
- Discussed agent-facing form auth: Cloudflare Access (Zero Trust) is the right answer — free up to 50 users, email OTP, protects specific paths; defer until first real agent client

### 2026-04-28
- Built `website/open_house_setup.html` + `n8n/workflows/Real Estate Open House Setup.json` — agent enters name/email/phone/address/MLS description; Claude extracts 3–5 property highlights; QR code generated via qrserver.com and emailed to agent; highlights encoded as `notes` param in the sign-in URL
- Updated `website/open_house.html` to read `notes` URL param and pass it as `property_notes` in the form payload
- Updated `Real Estate Open House Follow-Up.json`: threaded `property_notes` through all nodes; updated Build Prompt to include a PROPERTY HIGHLIGHTS section — fixes hallucinated property features
- **Webhook URL (setup):** `https://norrai.app.n8n.cloud/webhook/open-house-setup`
- **Re-import required:** Real Estate Open House Follow-Up workflow must be re-imported in n8n to pick up prompt changes

### 2026-04-29
- Brainstormed and designed automated estimating workflow for **B&B Manufacturing and Assembly** (Faribault, MN) — 55,000 sq ft metal fab shop, 50+ employees, custom fabrication for OEMs across ag, aerospace, food processing, industrial markets
- Design: web form → n8n → Claude API (line-item estimate with rate card) → SendGrid email to submitter within ~60 seconds; no human in the loop for demo
- Built `website/bnb_estimate_form.html` — all 10 services (laser cutting, waterjet, CNC, press brake, welding, sandblasting, powder coating, plating, deburring, assembly), conditional detail fields per service, Polar Modern design
- Built `n8n/workflows/B&B Manufacturing Estimate.json` — 6 nodes: Webhook (responds immediately) → Token Check → Build Claude Prompt (Code) → Claude API → Parse + Build Email (Code) → SendGrid
- Rate card baked into Claude prompt as placeholder rates; designed for easy swap to Google Sheets in production
- Claude outputs structured JSON; Code node builds full HTML email with line-item table, totals, lead time, disclaimer
- Added 24 Playwright tests (`tests/bnb_estimate_form.spec.js`) — all passing; full suite 132/132
- Added B&B testing section to `n8n/TESTING_NOTES.md` — import checklist, test payload, known gaps
- Design spec: `docs/superpowers/specs/2026-04-28-bnb-estimating-design.md`
- Implementation plan: `docs/superpowers/plans/2026-04-28-bnb-estimating.md`
- **Pending:** smoke test (import workflow into n8n, fire test payload, verify email) — deferred to after work
- Brainstormed and designed automated lead generator for B&B Manufacturing — Monday 6am schedule, Apollo.io search (250-mile radius, OEM industries, decision-maker titles, verified emails), Google Sheet exclusion list with JobBOSS stub, Claude scoring (1-10, 8+ threshold), SendGrid review email to B&B inbox with drafted outreach copy, Neon logging per qualified lead
- Design spec: `docs/superpowers/specs/2026-04-29-bnb-lead-generator-design.md`; Implementation plan: `docs/superpowers/plans/2026-04-29-bnb-lead-generator.md`

### 2026-04-30
- Fixed Open House Setup workflow: HTML email was arriving as a file attachment in Gmail due to unescaped `&` in QR/signin URLs inside HTML attributes
- Moved email HTML construction into the "Build QR URL" Code node with `&amp;`-escaped URLs
- Replaced SendGrid node with HTTP Request node calling SendGrid v3 API directly (`text/html` content type, `JSON.stringify` for body value)
- Requires "Header Auth" credential in n8n: Authorization: Bearer SG.xxx
- Open House Setup + Open House Follow-Up both tested and confirmed working end to end
- Built `website/review_request.html` + `n8n/workflows/Real Estate Review Request.json` — agent form triggers Claude-personalized SMS + email to closed client after 1/3/7-day delay; localStorage agent profile (name, Google URL, Zillow URL); 20 Playwright tests passing

### 2026-05-06
- Audited all HTML pages in website/ — found pages missing from CLAUDE.md: `discovery_form.html`, `lead_action_edit.html`, `privacy.html`, `terms.html`
- Brainstormed and implemented Cloudflare Zero Trust Access for all non-public pages
- Restructured `website/` folder: 7 client-facing pages moved to `website/clients/`, 2 internal pages to `website/internal/`; public pages stay at root
- Cloudflare Access Groups: `clients` (all client/prospect tool users + Egan, 7-day session), `internal` (Egan only, 1-day session)
- Cloudflare Access Applications: one for `/clients/*`, one for `/internal/*` — email OTP, free tier, up to 50 users
- Updated 6 Playwright test files to reference new `/clients/` paths; 248 tests passing
- To add a new client: Zero Trust → Access Groups → `clients` → add their email — automatically grants access to all `/clients/*` pages
- n8n workflows unchanged — only workflow referencing a page URL points to `open_house.html` which stays public at root

### 2026-05-08
- Built internal client health monitoring dashboard (`website/internal/dashboard.html`) — Polar Modern card grid, red/yellow/green status per client, manual refresh, loading/error/empty states; 10 Playwright tests
- Built `n8n/workflows/Norr AI Client Health Query.json` — GET webhook at `/webhook/client-health` queries Neon, applies health logic (red=failures in 7d, yellow=silence, green=healthy), returns JSON; **smoke tested and confirmed working**
- Built `n8n/workflows/Norr AI Red Alert Scheduler.json` — Cron at 6am + 6pm CT, queries Neon, posts Slack alert when any client is red; **smoke tested and confirmed working**
- Re-imported Real Estate Instant Lead Response + Open House Follow-Up workflows in n8n with security enhancements (Validate Input node, [DATA] prompt injection delimiters)

### 2026-05-10
- Imported Real Estate Research Agent workflow into n8n and smoke tested end to end — confirmed working
- Created "Gemini API Key" Query Auth credential in n8n (field: `key`)
- Applied `research_cache` table to Neon production
- Fixed workflow bugs discovered during smoke test:
  - Token Check rightValue had `=` prefix causing expression eval failure — fixed to plain string
  - Log Triggered SQL used `$json.caller` which n8n blocks for security — removed caller from payload
  - Cache Lookup stops on 0 rows — enabled "Always Output Data" in node settings
  - Gemini model `gemini-2.0-flash` no longer available to new users — updated to `gemini-2.5-flash`
  - Gemini tool `google_search_retrieval` not supported in 2.5 — changed to `google_search`
  - `generationConfig` REST key must be `generation_config` — fixed in Build Gemini Prompt node
  - `response_mime_type: application/json` incompatible with tool use — removed from generation_config
- Workflow is published and live at `POST /webhook/research-agent`

### 2026-05-11
- Analyzed research agent integration opportunities across all real estate workflows
- Replaced broad "Research Agent integration audit" task with 3 specific todos (Cold Nurture, Instant Lead Response, Open House Follow-Up)
- Created PRDs: `PRD/buyer-briefing.md`, `PRD/price-sanity-checker.md`, `PRD/lead-scoring-at-intake.md`
- Added `buyer_briefing`, `price_sanity_checker`, `lead_scoring` to workflow_name registry in CLAUDE.md
- Restructured CLAUDE.md: replaced Session Log with Lessons Learned section (domain-organized gotchas); moved session history to `SESSION_LOG.md`
- Created `/session-end` skill at `.claude/commands/session-end.md`
- Added "donezo" and "wrap up" trigger phrases for session wrap-up
