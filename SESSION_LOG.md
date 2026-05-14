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
- Brainstormed and scoped research agent integration into 3 existing workflows (Instant Lead Response, 7-Touch Cold Nurture, Open House Follow-Up); dropped Listing Description Generator as not worth complexity
- Created design spec: `docs/superpowers/specs/2026-05-11-research-agent-workflow-integration-design.md`
- Created implementation plan: `docs/superpowers/plans/2026-05-11-research-agent-workflow-integration.md`
- Created `n8n/workflows/Real Estate Instant Lead Response with Research.json` — Call Research Agent + Enrich with Research nodes inserted after Validate Input; MARKET CONTEXT block added to Build Prompt
- Created `n8n/workflows/Real Estate 7-Touch Cold Nurture with Research.json` — research called once at enrollment (Prep Fields → research → Enrich → Wait Day 1); insight_block injected into T1/T2/T3 prompts; T4/T5/T6 unchanged
- Created `n8n/workflows/Real Estate Open House Follow-Up with Research.json` — research called after overnight wait (post-Prep Wait Time); no price_range/beds/baths (not on sign-in form)
- Fixed critical bug in Enrich node: initial version used `$input.first().json` as spread source — when upstream HTTP Request fails with `continueOnFail: true`, n8n passes an error object as the item, which would wipe all lead data; fixed to use stable named upstream node ref (`$('Validate Input').first().json`, etc.)
- Replaced Node.js inline JSON validation in plan steps with `jq empty` — the former triggered Vercel hook validation errors in the superpowers plugin environment

### 2026-05-11 (continued)
- Fixed "Missing required field: city" error in Research Agent — Prep Input node updated to parse comma-separated combined address strings into separate address/city/state/zip fields
- Fixed Research Agent returning `{"success": true}` instead of actual data — both `respondToWebhook` nodes had empty `options: {}`; fixed `Respond Cached` to `respondWith: "firstIncomingItem"` and `Respond to Webhook` to `respondWith: "json"` referencing Build Final Output
- Fixed malformed `insight_block` — Gemini and Claude Haiku both returned markdown-fenced JSON (` ```json{...}``` `); added fence-stripping in Parse + Compliance Filter and Build Final Output before `JSON.parse()`
- Removed stray "Gemini Research1" duplicate node from Research Agent workflow; fixed trailing comma left after removal
- Fixed empty `insight_block` in Instant Lead Response — root cause was structured school/walkability/market data never reaching the prompt; added `research_detail` extraction in Enrich with Research (formatted text block) and updated Build Prompt to use it
- Split `property_address` single field into 4 separate fields (`property_street`, `property_city`, `property_state`, `property_zip`) in `lead_response.html` and `nurture_enroll.html` — eliminates address parsing ambiguity entirely
- Updated all 3 "with Research" workflows (Instant Lead Response, 7-Touch Cold Nurture, Open House Follow-Up) to pass separate address fields to Research Agent and extract `research_detail`
- Updated T1/T2/T3 prompts in all 3 workflows: `MARKET CONTEXT` → `RESEARCH DATA` using structured `research_detail`; updated "don't invent" instruction to "use research data for schools/walkability/market; defer only for property-specific unknowns"
- Updated Playwright tests: `lead_response.spec.js` and `nurture_enroll.spec.js` updated for 4-field address split; all 260 tests passing
- Created `n8n/workflows/Real Estate 7-Touch Cold Nurture Email Only.json` — demo variant, all 6 touches via SendGrid; T2/T4/T6 prompts updated to SUBJECT/BODY email format; no Twilio nodes; webhook: `nurture-enroll-email-only`
- Added todo: optional property details field in `nurture_enroll.html` (agent pastes MLS description/notes → `property_notes` → injected into T1–T6 prompts)

### 2026-05-13
- Brainstormed BoldTrail (kvCORE) lead intake integration for a Weichert agent
- Investigated BoldTrail account: Weichert-managed brokerage instance, agent-level access only — no outbound webhook available at agent tier
- Confirmed Lead Dropbox API key is inbound-only — `GET /contacts` with key returns 401; cannot be used for polling leads out
- Decided on Zapier Starter ($20/mo) as integration method — free tier pauses Zaps after 2 weeks of inactivity, too risky for a live client
- Built `n8n/workflows/Real Estate BoldTrail Intake.json` — 6 nodes: Webhook → Lookup Client → Log Triggered → Normalize Payload (Code) → Send to Lead Cleanser → Log Completed
- Used Zapier Copilot prompt to get confirmed BoldTrail field names from live payload inspection; updated Normalize Payload with actuals (`firstname`, `lastname`, `origin`, `is_seller`, buyer/seller address split, `email_status`, `on_drip`, `starrating`, `leadid`); no price_range or beds in BoldTrail Zapier trigger
- Registered `boldtrail_intake` in CLAUDE.md workflow name registry
- Key discovery during session: agent had unsubscribed from all BoldTrail email notifications — completely blind to new leads; strong sales angle
- Key discovery: BoldTrail already sends listing alert emails to leads — decided Norr AI nurture for this client should be SMS-dominant to avoid channel overlap
- Design spec: `docs/superpowers/specs/2026-05-13-boldtrail-intake-design.md`; Implementation plan: `docs/superpowers/plans/2026-05-13-boldtrail-intake.md`
- PR #12 opened: `worktree-boldtrail-integration-weichert` → `main`
- Pending (blocks on client onboarding): fill in CLIENT_TOKEN_PLACEHOLDER / CLIENT_ID_PLACEHOLDER, import into n8n, set up Zapier Zap, smoke test

### 2026-05-12
- Brainstormed and designed nurture prompt feature — daily scheduler emails agent a digest of enrolled-but-unresponded leads; one-click confirm URL marks lead as enrolled + fires nurture sequence
- Built `n8n/workflows/Nurture Prompt Confirm.json` — GET webhook at `/webhook/nurture-prompt-confirm`; token read from `$json.query.token` (query param, not header — it's a link click); UUID regex validation before any DB query; idempotency check (`nurture_enrolled_at IS NULL`); fires `nurture-enroll-slack` webhook; updates `leads.nurture_enrolled_at`; returns HTML success/already-enrolled/error page
- Built `n8n/workflows/Nurture Prompt Scheduler.json` — cron at 13:00 UTC (8am CDT); queries leads without `nurture_enrolled_at`; groups by agent; sends daily digest email via SendGrid with one-click enroll buttons; logs to `workflow_events` (norrai_internal)
- Added `nurture_enrolled_at timestamptz` to `leads` table in `db/schema.sql`; added `token uuid NOT NULL DEFAULT gen_random_uuid()` to `clients` table
- Production migrations: `ALTER TABLE leads ADD COLUMN nurture_enrolled_at timestamptz;` and `ALTER TABLE clients ADD COLUMN token uuid NOT NULL DEFAULT gen_random_uuid();`
- Designed per-client personalized URL token system — decided against a separate `agents` table; `clients.token` (uuid) is sufficient for solo-agent-per-client model
- Updated 5 agent-facing forms to read `?agent_token=` from URL → localStorage `norrai_agent_token` → payload body field: `listing_form.html`, `lead_response.html`, `open_house_setup.html`, `nurture_enroll.html`, `review_request.html`
- Added `Agent token` Playwright test blocks (2 tests each) to 5 spec files — discovered `npx serve` strips `.html` and drops query params in clean-URL redirects; fixed by navigating to clean paths (no `.html` extension) — 276 tests passing
- Added parallel fire-and-forget leads table INSERT to both `Real Estate Instant Lead Response.json` and `Real Estate Instant Lead Response with Research.json` — gated on `agent_token` → `clients.token` lookup; silently skips if no valid token; all 4 new nodes use `continueOnFail: true`
- Deferred n8n Token Check node updates to per-client DB lookup — Token Check still uses hardcoded shared secret for now

### 2026-05-12 (session 2)
- Identified 6 remaining tasks to get nurture prompt scheduler live; 5 were ops/config (schema already applied, credentials wired, confirm webhook URL corrected, SendGrid var confirmed, workflows imported + activated)
- Fixed `nurture_enroll.html` webhook URL: `nurture-enroll-slack` → `nurture-enroll`
- Added `Mark Nurture Enrolled` Postgres UPDATE node to `Real Estate 7-Touch Cold Nurture.json` — inserted between `Prep Fields` and `Wait Day 1`; updates `nurture_enrolled_at` by email match since `lead_id` is not in the manual enrollment payload
- Added same node to `Real Estate 7-Touch Cold Nurture Email Only.json` — inserted between `Prep Fields` and `Call Research Agent` (email-only variant has research built in; standard does not)
- Confirmed scheduler multi-client behavior: one digest email per agent per day, grouped by `clients.primary_contact_email`, each agent sees only their own leads

### 2026-05-12 (bday-anniversary-message worktree)
- Brainstormed and designed client birthday & anniversary outreach workflow (Growth tier)
- Design decisions: Google Sheets as agent-owned data source, auto-send (no approval step), email primary / SMS fallback / skip-and-log if neither present, minimal personalization (name + occasion + address only, no research agent)
- Architecture: single daily cron (7am CT), one Claude Haiku call per match, SendGrid for email (click tracking off), Twilio for SMS fallback (160-char truncated), Neon `workflow_events` logging
- Sheet columns finalized: `name`, `email`, `phone`, `birthday` (MM-DD), `closing_date` (YYYY-MM-DD), `sell_date` (YYYY-MM-DD), `property_address`, `agent_name`, `agent_email`
- Fixed two bugs in spec during self-review: `toLocaleDateString` with month/day options includes year — replaced with `toLocaleString` + split pattern; `.replace('-', '-')` no-op on closing_date removed
- Wrote design spec: `docs/superpowers/specs/2026-05-12-bday-anniversary-outreach-design.md`
- Added `bday_anniversary_outreach` to workflow name registry (pending CLAUDE.md update)

### 2026-05-14
- Removed approval step from `Real Estate Lead Response Auto.json` — now sends directly to lead via SendGrid (SMS pending A2P registration)
- Added `Update Lead Record` Postgres node — sets `status = 'contacted'`, logs `last_outreach_at` / `last_outreach_type` in `metadata` jsonb after send
- Added `Send Agent Copy` node — sends agent a copy of the email with lead details; CC hello@norrai.co
- Fixed `Update Lead Record` UUID undefined error — `$json.lead_id` was the SendGrid 202 response; fixed to `$('Parse Response').first().json.lead_id`
- Fixed `Send Agent Copy` all-undefined fields — same root cause; changed all `$json.*` refs to `$('Parse Response').first().json.*`
- Fixed `{{ JSON.stringify($json.agent_email) }}}` triple-brace parse error in Send Agent Copy — replaced with `"{{ $('Parse Response').first().json.agent_email }}"` (quoted expression)
- Updated `Real Estate Lead Cleanser.json`: SELECT now fetches `primary_contact_phone`, `business_name`; agent_phone + brokerage threaded through Build Dedupe Query, Build Insert Query, and Prepare Handoff
- Added `Email OK?` IF node to Lead Cleanser between Prepare Handoff and Trigger Lead Response — blocks leads with `email_status = 'Unsubscribed'` (case-insensitive)
- Added `alwaysOutputData: true` to Dedupe Check node in Lead Cleanser — prevents execution stop on 0-row result
- Updated `Real Estate BoldTrail Intake.json`: replaced hardcoded `CLIENT_TOKEN_PLACEHOLDER` with dynamic Neon lookup by `agentemail`; added `Build Lookup Query` (Code, sanitizes email), `Agent Found?` (IF), `Log Unknown Agent` (Postgres, norrai_internal fallback)
- Fixed BoldTrail Intake `Log Triggered` UUID quoting error — wrapped `{{$json.id}}` in single quotes → `'{{$json.id}}'`
- Fixed BoldTrail Intake `Normalize Payload` — was reading `$input` (Log Triggered result); fixed to `$('Receive BoldTrail Lead').first().json.body`
- Fixed BoldTrail Intake `Log Completed` — still had `CLIENT_TOKEN_PLACEHOLDER`; fixed to `$('Lookup Client').first().json.id`
- Added `retryOnFail: true, maxTries: 3, waitBetweenTries: 5000` to all 19 Claude HTTP Request nodes across all workflows
- Updated Lead Response Auto prompt: agent signature block with name/brokerage/phone/email; "omit blank lines" instruction prevents Claude from inventing phone numbers
- Stripped research agent nodes (`Call Research Agent`, `Enrich with Research`) from `Real Estate Instant Lead Response with Research.json` — research overhead not worth it for this workflow; Validate Input now fans directly to Build Prompt + Build Client Query
- Removed RESEARCH DATA block from Build Prompt in that workflow; restored "do NOT guess — acknowledge and say you'll follow up" instruction
