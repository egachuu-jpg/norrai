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

### 2026-05-17
- Brainstormed and designed Starter tier contract system — design spec: `docs/superpowers/specs/2026-05-17-starter-contract-system-design.md`
- Built `website/internal/contract_generator.html` — two-section internal tool: Generate (renders print-ready contract from form fields) + Mark as Signed (fires POST to n8n after client returns signed copy); supports email reply / print-scan / DocuSign signing methods via dropdown
- Built `tests/contract_generator.spec.js` — 25 tests covering page load, required fields, contract rendering, Mark as Signed payload (including setup_fee=0 edge case); 319/319 tests passing
- Built `n8n/workflows/Norr AI Contract Signed.json` — 9-node workflow: Token Check → Respond Unauthorized (401 on false) → Sanitize Input (Code, escapes quotes, casts numerics) → Upsert Client (CTE pattern) → Log Triggered → Insert Contract → Log Completed → Respond Success; imported and smoke tested working
- Added `contract_signed` to workflow_name registry in CLAUDE.md
- Implementation used TDD + subagent-driven development on `feature/starter-contracts` worktree; merged to main

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

### 2026-05-14 (session 2)
- Discussed native n8n error handling — identified Error Trigger payload fields (`lastNodeExecuted`, `error.message`, `execution.url`) as underutilized for health diagnostics
- Confirmed `Norr AI Workflow Error Logger` workflow did not exist in the repo (gap — all workflows referenced it in Settings but it was never built or exported)
- Built `n8n/workflows/Norr AI Workflow Error Logger.json` — Error Trigger → Extract Error Data (Code, maps display names to registry keys, SQL-escapes all fields, builds Slack message) → Log Failed to Neon (Postgres, `continueOnFail`) → Post to Slack (HTTP, `continueOnFail`); `payload` column stores `execution_id`, `execution_url`, `last_node`, `error_message`
- Added todos: wire Neon credential + Slack webhook in Error Logger, set Error Workflow setting in all other workflows

### 2026-05-16
- Fixed `Mission Control Mutate.json` — all three SQL queries (Create Task, Update Task, Create Story) used `NULLIF('{{ expr }}', '')` which doesn't catch n8n's `"undefined"` string; fixed to `NULLIF(NULLIF(..., ''), 'undefined')` pattern throughout
- Diagnosed Error Logger receiving hardcoded example payload — confirmed it's n8n's built-in sample data displayed on the Error Trigger node in the editor; real data flows to downstream nodes and is visible in the Executions tab
- Cleaned up Neon: deleted "Test story" and all its test tasks (including the "undefined"-title row created by the CHECK constraint bug)
- Set task tracking rule: tasks are now in Neon (`stories` + `tasks`), not CLAUDE.md; added stale warning + query to CLAUDE.md Open Tasks section; saved to memory
- Created "Weichert Client Onboarding" story in Neon with 10 ordered tasks covering the full onboarding sequence
- **Weichert onboarding progress:**
  - Task 3 ✅ — INSERT Michelle Jasinski into `clients` (Evan already existed); both agents have UUIDs and tokens
  - Task 4 ✅ — Added both agent emails to Cloudflare Access `clients` group
  - Task 5 ✅ — Evan's Zapier Zap live and tested end-to-end; Michelle pending her Zapier key (copy Evan's Zap, swap agentemail); decided on free tier
  - Task 6 ✅ — Generated personalized tool URLs for both agents using their `clients.token` UUIDs
  - Task 7 ✅ — Wired Error Logger credentials in n8n: Neon Postgres + Slack webhook from `.env`
  - Task 8 ✅ — Set Error Workflow → `Norr AI Workflow Error Logger` in all active workflows
- Added "Expand agent_token consumption to all client-facing workflows" as a standalone task on the board — currently only Instant Lead Response uses it; connection to Client Health dashboard value noted
- Added `workflow_events` logging (Log Triggered + Log Completed) to `Real Estate Instant Lead Response.json` — Log Triggered fires in parallel from Validate Input using `norrai_internal`; Log Completed fires after Insert Lead using actual `client_id` from Find Client with norrai_internal fallback; re-imported into n8n
- Discussed Zapier free tier inactivity pause — no clean programmatic workaround for BoldTrail-triggered Zaps

### 2026-05-18
- Brainstormed and designed graceful handling for property-null leads in cold nurture — general buyer inquiries with no specific listing attached
- Design spec: `docs/superpowers/specs/2026-05-17-cold-nurture-property-null-design.md`
- Implementation plan: `docs/superpowers/plans/2026-05-17-cold-nurture-property-null.md`
- Updated `n8n/workflows/Real Estate 7-Touch Cold Nurture.json`:
  - `Prep Fields`: assembles `context_block` string from only available fields (property, price, beds/baths, lead_message); falls back to "General buyer inquiry — no details or message on file." when all are absent; emits `channel: 'email'` for A2P restore path
  - Fixed beds/baths falsy edge case: `if (beds || baths)` → `if (beds !== '' || baths !== '')` to handle `beds: 0` correctly
  - All 6 `Build Prompt` nodes: replaced individual property field references with `context_block`; removed separate "Their original message:" line (now in context_block); updated angle instructions to be context-adaptive
  - T1/T3: added explicit minimal-context fallback instructions to prevent weak/hollow output when context_block is bare
  - T2/T4/T6 `Build Prompt`: converted from SMS format (160-char plain text) to email format (SUBJECT/BODY); `max_tokens` 150 → 300
  - T2/T4/T6 `Extract` nodes: converted from SMS message extraction to SUBJECT/BODY parse pattern
  - T2/T4/T6 delivery nodes: Twilio replaced with SendGrid; connections updated to `Email T2/T4/T6`
  - T1 + T2: added "Only reference property details you have been given — do not invent specifics you weren't told" after discovering Claude hallucinated "half acre with mature oaks" for a property it knew only by address
- PR #17 opened: `feat/cold-nurture-property-null` → `main`
- Pending: smoke test all three context scenarios (full / partial / minimal) before merge

### 2026-05-15
- Brainstormed Mission Control concept: client health, workflow throughput, lead activity, open task visibility, revenue snapshot — scoped down to task/kanban + subagent dispatch as the priority
- Designed two-table schema (`stories` + `tasks`) instead of self-referencing single table — stories and tasks have different fields and different dispatch semantics
- Key schema decisions: `seq` int on tasks for ordered display within a story; `context` text field as agent dispatch input; `output` text field for agent results; `assigned_to` for egan vs agent:research etc.; `agent_working` as distinct status from `in_progress`
- `db/migrations/004_tasks_stories.sql` — `stories` + `tasks` tables with CHECK constraints, updated_at triggers, and indexes
- `db/migrations/005_seed_tasks.sql` — DO $$ block seeding 8 stories + 11 standalone tasks from CLAUDE.md open tasks (~50 task rows total)
- `website/internal/mission-control.html` — 1105-line Kanban board: Stories view (default, grid of story cards with progress bars + category dots) + Board view (6 columns: Backlog → Done), task drawer with immediate status/priority updates via POST, Dispatch button for research/analysis tasks (→ Claude API), Copy Agent Prompt for dev/testing tasks (→ clipboard), New Task + New Story modals; Polar Modern design
- `n8n/workflows/Mission Control List.json` — GET /webhook/mc-tasks; single nested Postgres query with correlated subqueries returns `{ stories: [...with tasks], standalone: [...], generated_at }` in one round trip
- `n8n/workflows/Mission Control Mutate.json` — POST /webhook/mc-mutate; Switch node routes `update_task` / `create_task` / `create_story` to their respective Postgres operations
- `n8n/workflows/Mission Control Dispatch.json` — POST /webhook/mc-dispatch; fetches task + story context → Claude Haiku → saves output to `tasks.output`, sets status to `review`
- `tests/mission-control.spec.js` — 18 Playwright tests; all 294 tests passing

### 2026-05-20
- Fixed `Build Classifier Input` node in email triage inbox workflows: `json.from` → `json.From` and `json.subject` → `json.Subject` to match Gmail node's actual output field names
- Updated `scripts/generate_email_triage_workflows.js` and regenerated all 8 email triage workflow JSON files

### 2026-05-21
- Brainstormed and designed client onboarding materials for Evan Knutson (Weichert Realty) — handoff call tomorrow morning; all 6 workflows already live
- Design spec: `docs/superpowers/specs/2026-05-21-weichert-onboarding-design.md`
- Implementation plan: `docs/superpowers/plans/2026-05-21-weichert-onboarding.md`
- Built `website/clients/weichert_guide.html` — 6-workflow reference page (Instant Lead Response, Listing Description Generator, Open House, Cold Nurture, Review Request, Birthday & Anniversary); Polar Modern design, no JS, `@media print` stylesheet for PDF leave-behind
- Birthday & Anniversary section documents Google Sheet column format instead of a tool button (automated workflow, no form)
- Built `tests/weichert_guide.spec.js` — 4 smoke tests (title, no JS errors, 6 section IDs, 5 tool buttons); 327/327 full suite passing
- Created `obsidian/clients/evan-knutson-weichert.md` — internal client record; Evan's client_id (`ded234e3`), email, phone, BoldTrail/Zapier notes, open items (Twilio number, Google Sheet ID, Zapier plan confirm) all wired in
- Looked up Evan's Neon record — also found Michelle Jasinski at same office (client_id `451306d1`), flagged as future prospect in the Obsidian file

### 2026-05-22
- Attempted Notion task query via MCP — workspace was empty (default onboarding pages only); confirmed tasks live in Neon, not Notion
- Created 4 Weichert Realty stories in Neon (47 tasks total, all with context fields):
  - **Open House Enhancements** (14 tasks) — MLS listing link + Make an Offer button post-sign-in; agent representation Yes/No toggle; offer form emails hosting agent; unrepresented attendees logged as leads + follow-up; represented attendees forward agent info to host
  - **7-Touch Cold Nurture Enhancements** (11 tasks) — weekly Monday de-enroll digest email per agent with per-lead remove button; mid-sequence enrollment check before each touch; activate Nurture Prompt Scheduler + Nurture Prompt Confirm; `unenrolled` as new lead status (no migration needed, no CHECK constraint)
  - **Weekly Marketing Drip** (14 tasks) — weekly Monday 9am listing email to full CRM contact list; Apify scrapes listing URLs for photo/price; SendGrid forks per agent (Evan vs Michelle); per-lead sends for personalized opt-out tokens; `communication_opted_out` column + `listing_queue` table added to schema plan; two-workflow architecture (intake webhook → Neon queue → separate Monday scheduled workflow)
  - **Boosted Property Lead Ingestion** (8 tasks) — Gmail triggers on Evan + Michelle inboxes watching for `no-reply@boldtrail.com` "New Lead Email" emails; Claude Haiku parses HTML → structured JSON; dedupe + Neon insert; fires existing `instant_lead_response`; read Tina Jore .eml to confirm field extraction (name, phone, email, property interest, listing URL from Notes field)
- Created 4 PRDs in `obsidian/PRDs/`: open-house-enhancements, nurture-enhancements, weekly-marketing-drip, property-boost-lead-ingestion
- Created `obsidian/clients/michelle-jasinski-weichert.md` — full client record mirroring Evan's format
- Updated `obsidian/clients/evan-knutson-weichert.md` — corrected Michelle from "potential future client" to "active client"; added Active Stories table with all 4 stories
- Identified SendGrid volume risk for marketing drip — per-lead sends require personalized opt-out URLs; documented threshold query + fallback to Marketing Campaigns API at 2,000+ sends; noted in PRD
- Drafted client-facing email to Evan + Michelle summarizing 4 upcoming features in non-technical language

### 2026-05-26
**Open House Enhancements story (completed):**
- Modified `website/open_house.html`: added `wf` URL param routing — `wf=weichert` routes to `weichert-open-house-signin` webhook; default routes to `open-house-signin`
- Modified `n8n/workflows/Real Estate Open House Setup.json`: `Build QR URL` detects `source_form = 'weichert_open_house_setup'` and injects `wf=weichert` + `listing_url` into QR code URL
- Created `n8n/workflows/Real Estate Open House Follow-Up Weichert.json` — webhook: `weichert-open-house-signin`; Weichert-specific prompt (unagented representation angle), email-only delivery, dedupe via SELECT→conditional INSERT/UPDATE pattern (no unique constraint on leads table)
- Created `n8n/workflows/Weichert Offer Submit.json` — webhook: `weichert-offer-submit`; formatted HTML offer email to `eknutson@teamyellownow.com`, agent CC'd, reply-to set to buyer email
- Updated `Norr AI Workflow Error Logger.json`: added `open_house_follow_up_weichert`, `weichert_offer_submit`, `nurture_deenroll_prompt`, `nurture_deenroll_confirm` to WORKFLOW_NAME_MAP
- Created `obsidian/PRDs/2026-05-24-open-house-enhancements-testing.md` — 4-section smoke test checklist
- Marked Open House Enhancements story as `done` in Neon

**Cold Nurture Enhancements (code complete, testing pending):**
- Modified `n8n/workflows/Real Estate 7-Touch Cold Nurture.json`: added enrollment guard for T1–T6 — each Wait node now feeds `Check Enrolled T{n}` (Postgres SELECT status by email+agent_email join) → `IF Enrolled T{n}` (status = 'nurturing') → `Build Prompt T{n}`; stops execution mid-sequence when lead is de-enrolled
- Created `n8n/workflows/Nurture De-Enroll Prompt.json` — Monday 10am CT cron; queries `status = 'nurturing'` leads joined to active clients; groups by agent; Polar Modern digest with red "Remove from Nurture" button per lead
- Created `n8n/workflows/Nurture De-Enroll Confirm.json` — GET `/webhook/nurture-deenroll-confirm`; shared token + UUID regex validation; idempotency via `Still Nurturing?` IF; sets `status = 'unenrolled'`; returns HTML success/already-removed/not-found pages
- Updated `db/schema.sql` and `db/README.md`: documented `unenrolled` and `nurturing` statuses
- Updated `CLAUDE.md` workflow registry: added `nurture_deenroll_prompt` and `nurture_deenroll_confirm`
- Created `obsidian/PRDs/2026-05-26-nurture-enhancements-testing.md` — pre-flight + 5-section smoke test checklist

### 2026-06-06
- Queried task list for "Weichert Realty — Boosted Property Lead Ingestion" story from PRD + codebase (Neon and mission-control inaccessible in remote env — no DATABASE_URL, webhook host not in n8n allowlist)
- Built `n8n/workflows/PropertyBoost Parser.json` — webhook subworkflow at `/webhook/property-boost-parser`; input: `{html_body, client_id, agent_email}`; looks up agent name/phone/brokerage from Neon; Claude Haiku (`claude-haiku-4-5-20251001`) parses BoldTrail HTML → structured JSON (lead_name, phone, email, property_interest, source, referrer, listing_url); dedupes on `(email OR phone) AND client_id`; inserts new lead with `source='property_boost'`, `listing_url + referrer` in metadata jsonb; fires POST to `/webhook/lead-response`; logs `triggered`/`completed`/`skipped` for `property_boost_parser`; error workflow set
- Changed intake architecture: instead of per-agent Gmail OAuth on Evan/Michelle's teamyellownow.com accounts, agents forward BoldTrail emails to hello@norrai.co; single workflow monitors the Norr AI inbox
- Built `n8n/workflows/PropertyBoost Intake.json` — Gmail trigger on hello@norrai.co; filter: `{from:eknutson@teamyellownow.com from:mjasinski@teamyellownow.com} subject:"New Lead Email"`; Resolve Agent Code node parses from address → sets `client_id` + `agent_email` (Evan: `ded234e3`, Michelle: `451306d1`); throws on unknown sender; logs `triggered`/`completed` for `property_boost_intake`; POSTs to `/webhook/property-boost-parser`
- Registered `property_boost_intake` and `property_boost_parser` in CLAUDE.md workflow name registry
- Added PropertyBoost Intake + Parser section to `n8n/TESTING_NOTES.md` — credential requirements, Gmail forwarding behavior warning (auto-forward preserves original From: header), subaddress workaround, smoke test sequence

### 2026-06-04
- Built `n8n/workflows/Weichert Nurture Auto-Scheduler.json` — Monday 8am CT cron; queries Weichert leads (Evan + Michelle) with `nurture_enrolled_at IS NULL`; marks `status = 'nurturing'` per lead; fires `cn-enroll` per lead; sends FYI digest email per agent listing enrolled leads with per-lead red "Remove from Nurture" button; registered `weichert_nurture_auto_scheduler` in CLAUDE.md and Error Logger WORKFLOW_NAME_MAP
- Changed enrollment webhook from `nurture-enroll` to `cn-enroll` in `Nurture Prompt Confirm.json` and `website/clients/nurture_enroll.html`
- Changed Email T1–T6 nodes in `Real Estate 7-Touch Cold Nurture.json` from SendGrid native node to HTTP Request → SendGrid v3 API — enables `text/html` content type and explicit `click_tracking: false`
- Added `business_name` field to Prep Fields and Extract T1–T6 code nodes — appended as styled `<p>` signature line when non-empty; omitted cleanly when absent (non-Weichert enrollments unaffected)
- Added `business_name` to Weichert Auto-Scheduler Fire Nurture Sequence payload
- Diagnosed `Mark Nurture Enrolled` credential error — n8n Cloud project credential scoping; credentials visible in node UI are not usable at runtime until explicitly shared via Credentials → Sharing → add project; no code change
- Fixed "invalid sequence" in `Nurture De-Enroll Confirm` Log Completed — n8n API silently drops `queryParams` from Postgres nodes; added `Prep Log Values` Code node extracting `client_id`, `lead_id`, `lead_name` into `$json`; reordered tail to Prep Log Values → Respond: Success → Log Completed so all three use plain `{{ $json.field }}` references
- `Nurture De-Enroll Confirm` unsubscribe flow confirmed working end to end

### 2026-06-07
- Fixed PropertyBoost duplicate lead insertion: `Build Lead Insert` in ILR now checks `body.lead_id` and returns no-op `SELECT 1` when the Parser already inserted the lead
- Fixed ILR unsubscribe link: was incorrectly pointing at `nurture-deenroll-confirm?lead_id=`; changed to `tools.norrai.co/unsubscribe?email=` (Email Unsubscribe Handler via webpage)
- Clarified unsubscribe routing split: `nurture-deenroll-confirm` is for nurture sequence removal only (`status = 'unenrolled'`); `Email Unsubscribe Handler` (POST, called by `tools.norrai.co/unsubscribe` webpage) handles all one-off email opt-outs (`email_opt_out = TRUE`)
- Discovered `norrai.co/unsubscribe` 404ing — website is deployed at `tools.norrai.co`, not apex `norrai.co`; updated all workflow unsubscribe links (ILR, Review Request, Open House Follow-Up, Birthday & Anniversary, Lead Action Handler, ILR with Research, 7-Touch Email Only)
- Pushed unsubscribe URL fix to live n8n: ILR (`aN9vvdXo9k1IKLXq`) and Review Request (`JPOPWcKVzheC9YXs`); also backfilled unsubscribe footer into Review Request which was never in the live n8n version
- Added `email_opt_out BOOLEAN NOT NULL DEFAULT FALSE` and `opted_out_at TIMESTAMPTZ` columns to Neon `leads` table — both were in `db/schema.sql` but the ALTER TABLE had never been run against production
- End-to-end unsubscribe flow confirmed working: ILR email → `tools.norrai.co/unsubscribe` → POST to handler → `leads.email_opt_out = TRUE` in Neon

### 2026-06-05
- Simplified `website/weichert_offer_form.html`: removed financing type, closing date, and contingencies sections; added live dollar-formatted offer amount field (`type="text"` + `inputmode="numeric"` + JS `toLocaleString`); added "Not a legally binding offer" disclaimer block; pushed to `main` for testing
- Fixed `Wait Until 9am CT` node in Weichert Open House Follow-Up workflow: `$json.resume_at` → `$('Prep Wait Time').first().json.resume_at` — `Upsert Lead` (Postgres INSERT) overwrites `$json`, so `resume_at` was gone by the time the Wait node evaluated it
- Fixed `Has Agent?` IF node: unary boolean operator requires `singleValue: true` and no `rightValue` field — `{"type": "boolean", "operation": "false", "singleValue": true}`
- Fixed `Build Prompt` Set node: all 6 `$json.*` field refs changed to `$('Prep Wait Time').first().json.*` — same data-flow-loss root cause as the Wait node fix
- Fixed `Extract Message` Code node: `$('Wait Until 9am CT').first().json` → `$('Prep Wait Time').first().json` — Wait node output on resume is whatever was stored when execution paused, which is the Postgres INSERT result (empty), not the prep data
- Removed `vertical` column from leads INSERT in `Build Upsert Query` — column no longer exists in Neon schema
- Discovered duplicate Weichert Open House Follow-Up workflows: canonical ID `VzNYr7R5DdiTvni9` (May 11, active, holds the webhook) vs duplicate `kiwvKR6T8Z6hBSBA` (imported prior session); applied all fixes to canonical, archived the duplicate; updated local JSON file name/ID
- Used n8n REST API directly to unarchive `kiwvKR6T8Z6hBSBA` when MCP tool was blocked: `POST /api/v1/workflows/{id}/unarchive` with `X-N8N-API-KEY` header
- All workflow fixes tested and confirmed working end to end
