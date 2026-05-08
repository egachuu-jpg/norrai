# Norr AI — Project Context

## What This Is

Norr AI is an AI automation agency targeting local businesses in Faribault and southern Minnesota. Built and operated by Egan. The name has quiet Scandinavian/regional roots — credible locally, scalable nationally.

- **Domain:** norrai.co
- **Primary email:** hello@norrai.co
- **Automation email:** hello@norrai.co (SendGrid verified sender)
- **LLC:** Filed with Minnesota SOS — pending approval
- **EIN:** Obtained
- **Banking:** Relay — pending approval
- **Google Workspace:** Active

---

## Service Tiers

| Tier | Price | What it is |
|------|-------|-----------|
| Starter | $500–600/mo + $500–600 setup | n8n + Claude API automations. Template-based, no custom dev. |
| Growth | $1,000–1,200/mo + $1,000–1,200 setup | Advanced sequences, AI-written outreach, monthly reporting. |
| Pro | $2,000–2,500/mo + $3,000–6,000 build fee | Custom Claude Code pipelines, dashboards, white-labeled portals. |

---

## Core Tech Stack

| Tool | Role |
|------|------|
| n8n Cloud | Workflow automation — Starter and Growth delivery |
| Claude API | Intelligence layer across all tiers |
| Twilio | SMS delivery — one subaccount per client |
| SendGrid | Email delivery via hello@norrai.co |
| Neon (Postgres) | Connective tissue between Tier 1 and Tier 2 — project: `norrai`, hosted on Neon (`gentle-hill-54285247`) |
| Claude Code | Custom Tier 3 builds |
| Hoppscotch | Webhook testing (dev only) |

---

## Target Verticals

Norr AI serves any local or regional business with repetitive client communications, scheduling, or data workflows. The full target market includes:

🏡 Real estate agents · 🦷 Dental offices · 👁️ Eye clinics · ✂️ Hair salons & barbershops · ⛳ Golf courses · 🌿 Greenhouses & nurseries · 🔧 Plumbers & electricians · 🏗️ Construction companies · 🛡️ Insurance brokers · 💆 Spas & wellness studios · 🐾 Veterinary clinics · 🚗 Auto repair shops · 🏋️ Gyms & fitness studios · 🌄 Landscaping companies

### Verticals with Detailed Playbooks Built Out

**Dental** — Starter pitch: no-show math. Workflows: appointment reminders, missed appointment follow-up, review requests, missed call → SMS, new patient intake. Growth anchor: dormant patient reactivation. Pro: Dentrix/Eaglesoft pipeline → production dashboard.

**Real Estate** — Starter pitch: speed-to-lead. Workflows: instant lead response (Claude personalizes by listing), 7-touch cold nurture, missed call → SMS, listing description generator, open house follow-up. Growth anchor: sphere of influence re-engagement. Pro: MLS feed, deal velocity dashboard, lead scoring.

**Insurance** — Starter pitch: renewal math. Workflows: renewal reminders (90/60/30/7 days), post-renewal thank you + review request, lapsed win-back, quote request response, missed call → SMS. Growth anchor: cross-sell campaign. Pro: book-of-business pipeline, retention risk scoring.

---

## Architecture Decisions

- Own the infrastructure from day one: Twilio numbers, Postgres, n8n instance. Client pays for the service — Norr AI owns the stack.
- All Tier 1 n8n workflows write events to Postgres so Tier 2 inherits clean history.
- Transition framing when upgrading a client: "we expanded the system" not "we rebuilt everything."
- Run Tier 1 and Tier 2 in parallel for 2–4 weeks during upgrade — zero downtime.

**Lead Cleansing Architecture:** A staging layer sits between all intake sources and downstream nurture workflows. Every intake source normalizes to a single payload shape before hitting the cleansing workflow.

Normalized payload shape:
```json
{
  "lead_name": "Sarah Johnson",
  "email": "sarah@gmail.com",
  "phone": "5075551234",
  "source": "zillow",
  "property_address": "123 Maple St",
  "price_range": "$250k-$320k",
  "beds": 3,
  "lead_message": "..."
}
```

Dedupe check: CRM lookup by email + phone before firing any sequence. Existing lead → update record, stop. New lead → fire downstream.

---

## n8n Operational Notes

- Always use `/webhook/` production path, NOT `/webhook-test/`, for live clients.
- Timezone: n8n Cloud runs UTC. Use `America/Chicago` with `hour12: false` for Central time.
- Business hours IF node: use two separate conditions (`>= 8` AND `< 17`), not a single JS expression.
- SendGrid click tracking: disable for transactional emails to avoid Promotions tab.
- Twilio subaccounts: one master account, one subaccount per client.
- Expression path: raw JSON from webhooks comes through as `$json.fieldname` (no `.body.` wrapper).
- Multiline Claude prompts: build in Set node first, pass as single `$json.prompt` variable to HTTP Request.

Timezone expression used in Missed Call workflow:
```js
parseInt(new Date().toLocaleString('en-US', {timeZone: 'America/Chicago', hour12: false}).split(', ')[1].split(':')[0])
```

---

## Workflows Built

### Missed Call → Auto SMS
- **Status:** Working end to end
- **Stack:** Twilio webhook → n8n IF node (business hours check) → Twilio SMS (two branches: in-hours / after-hours message)
- **Pending:** Upgrade Twilio account from trial, buy local 507 area code number to replace toll-free 855 number

### Listing Description Generator
- **Status:** Working end to end
- **Stack:** Webhook → Set node (build prompt) → HTTP Request (Claude API) → Code node (parse response) → SendGrid
- Claude returns plain text with `HEADLINE:` / `MLS_DESCRIPTION:` / `SOCIAL_MEDIA_POST:` labels — Code node splits on these
- Email sends from hello@norrai.co via SendGrid native n8n node
- Agent voice personalization: few-shot prompting with 3–5 of agent's previous listings pasted into prompt
- **Webhook URL:** `https://norrai.app.n8n.cloud/webhook/listing-description`

### Event Ops Discovery Form
- **Status:** Working end to end
- **Stack:** `event_ops_discovery.html` → n8n webhook → (review + routing)
- 6-section discovery questionnaire: About You, Event Volume & Types, Where Your Time Goes (1–5 rating scales), Current Tools & Stack, Repetitive Work, Priorities & Goals
- Collects: team size, capacity gap, events/year, attendee volume, event types, time-sink ratings across 7 categories, current registration/comms/data tools, manual step walkthrough, recurring email and report types, biggest pain, success criteria, openness to new tools
- Payload fields include multi-select pill groups serialized as comma-separated strings, rating scale values as integers, and free-text fields
- **Webhook URL placeholder:** `https://YOUR-N8N-INSTANCE.app.n8n.cloud/webhook/event-ops-discovery`
- **Origin:** Built for a warm lead — senior event ops manager at Prep Network who lost two employees; her director is also running an internal AI automation analysis this quarter

---

## Project Structure

```
norrai/
├── website/                  # All HTML — deployed to Cloudflare Pages (build output dir: website)
│   ├── index.html
│   ├── services.html
│   ├── how-it-works.html
│   ├── pricing.html
│   ├── contact.html
│   ├── dental.html
│   ├── real-estate.html
│   ├── insurance.html
│   ├── privacy.html            # Public legal page
│   ├── terms.html              # Public legal page
│   ├── open_house.html         # Open house sign-in — public, QR code, reads URL params (address, agent, notes)
│   ├── discovery_form.html     # General prospect discovery form — public
│   ├── event_ops_discovery.html
│   ├── onboarding_form.html
│   ├── clients/                # Cloudflare Access: clients group (7-day session)
│   │   ├── listing_form.html       # Listing description generator
│   │   ├── lead_response.html      # Instant lead response
│   │   ├── open_house_setup.html   # Open house QR code generator
│   │   ├── nurture_enroll.html     # Cold nurture enrollment
│   │   ├── review_request.html     # Review request
│   │   ├── lead_action_edit.html   # Edit SMS/email drafts before sending to leads
│   │   └── bnb_estimate_form.html  # B&B Manufacturing estimate form (B&B employees)
│   ├── internal/               # Cloudflare Access: internal group (1-day session)
│   │   ├── brand_concepts.html
│   │   └── norrai_style_guide.html
│   ├── norr_ai_favicon.svg
│   ├── norr_ai_emblem.svg
│   └── css/
│       └── norrai.css        # Shared Polar Modern styles for main site pages
├── db/
│   ├── schema.sql            # Canonical schema — apply with: psql <connection-string> -f db/schema.sql
│   └── README.md             # Table overview, n8n connection instructions, smoke test queries
├── n8n/
│   ├── TESTING_NOTES.md      # Gotchas, known gaps, production promotion checklist
│   ├── TESTING_GUIDE.md      # Step-by-step testing instructions per workflow
│   └── workflows/            # n8n workflow JSON exports — import directly into n8n
├── tests/
│   └── listing_form.spec.js  # Playwright tests for listing_form.html
├── norrai_master_context.docx
├── playwright.config.js
├── package.json
└── CLAUDE.md
```

---

## Brand — Polar Modern

All HTML files should use this design system:

```css
--bone:      #FAFAF7;   /* background */
--ink:       #0A0F1A;   /* primary text, header bg */
--glacial:   #7FA9B8;   /* accent, focus states */
--graphite:  #3A3F48;   /* button hover */
--blush:     #E8D4C4;   /* warm accent */
--surface:   #FFFFFF;
--border:    #E5E4DE;
--muted:     #9EA3AA;
--secondary: #6A6F78;

font-display: 'Inter Tight'
font-body:    'Inter'
font-mono:    'JetBrains Mono'
```

---

## Testing

**Test stack:** Playwright (`npm test`)
**248 tests across 10 spec files — all must pass before pushing.**

| Spec file | Page covered |
|---|---|
| `tests/listing_form.spec.js` | `clients/listing_form.html` |
| `tests/lead_response.spec.js` | `clients/lead_response.html` |
| `tests/open_house_setup.spec.js` | `clients/open_house_setup.html` |
| `tests/nurture_enroll.spec.js` | `clients/nurture_enroll.html` |
| `tests/review_request.spec.js` | `clients/review_request.html` |
| `tests/bnb_estimate_form.spec.js` | `clients/bnb_estimate_form.html` |
| `tests/open_house.spec.js` | `open_house.html` |
| `tests/discovery_form.spec.js` | `discovery_form.html` |
| `tests/event_ops_discovery.spec.js` | `event_ops_discovery.html` |
| `tests/onboarding_form.spec.js` | `onboarding_form.html` |

### Rules
- **Run `npm test` before pushing any code changes.** All tests must pass.
- **When adding new functionality to a tested file, add tests for it first (or alongside).** Do not ship new form fields, JS behavior, or payload changes without corresponding test coverage.
- **When editing a file that has no test file, create one.** Scope the tests to the risk level of the file (see below).
- New test coverage should follow the existing patterns in `tests/listing_form.spec.js`: use `fillRequired()` + `mockWebhook()` helpers, `Promise.all` for request interception, and wait for UI state (success banner, etc.) before asserting async side effects like localStorage.

### Risk-based test coverage

| Risk | File type | Minimum coverage |
|------|-----------|-----------------|
| **High** | Forms that submit to a webhook (listing_form, event_ops_discovery) | Full: required fields, type enforcement, payload shape, localStorage, UI states, security header |
| **Medium** | Marketing/vertical pages with interactive elements or JS | Key interactions, navigation links resolve, no JS errors on load |
| **Low** | Static display pages with no JS (brand_concepts, style_guide) | Smoke test only: page loads, title correct, no console errors |

Forms that touch the n8n → Claude → SendGrid pipeline are **high risk** — bad data produces silent failures with real cost (API calls, emails sent). Test them thoroughly.

---

## Ideas / Parking Lot

### Real Estate — Slack-mediated SMS send (agent-in-the-loop)
Instead of the workflow sending the automated text directly to the lead, route it through Slack first. The agent receives the pre-drafted SMS in Slack, formatted exactly as it would be sent. Tapping the message opens it in iMessage (or the native Android Messages app) with the lead's number and message body pre-filled — agent just hits send. Technical mechanism: generate an `sms:` deep link (`sms:+15075551234?body=Hey%20Sarah...`) and post it to Slack as a button or linked message. This works on mobile — iOS and Android both honor the `sms:` URI scheme. Benefit: agent stays in the loop for the actual send (trust, compliance, personal touch) without having to draft anything. Tradeoff: adds one manual step vs. full automation. Could be an opt-in mode per agent — "auto-send" vs. "review in Slack first." Applies to: instant lead response, open house follow-up, any outbound SMS in the nurture sequence.

---

## Open Tasks

### Immediate
- [x] Connect `listing_form.html` to n8n production webhook URL
- [ ] Upgrade Twilio account, buy local 507 number, replace toll-free 855
- [x] Complete SendGrid domain authentication DNS records for norrai.co
- [ ] Open Relay business bank account once MN LLC approval certificate arrives

### Security (Pre-First Client)
- [ ] Fix `innerHTML` → `textContent` in `open_house_setup.html` line 307 — XSS code smell, one-line fix
- [ ] Add token check to `event_ops_discovery.html` n8n workflow — only form without webhook auth
- [x] Set up Cloudflare Access (Zero Trust) on all agent-facing forms — restructured website/ into clients/ and internal/ subfolders; two Access Groups (clients, internal) + two Applications protect /clients/* and /internal/* with email OTP (7-day and 1-day sessions)
- [ ] Add rate limiting to n8n webhook endpoints — prevent abuse before first live client
- [ ] Add server-side input validation in n8n workflows — currently all validation is client-side only and can be bypassed via curl
- [ ] Enforce exact match (not `startsWith`) on token check IF nodes across all workflows
- [ ] Encrypt PII columns in Neon DB (phone, email, name) using pgcrypto — currently plaintext
- [ ] Add explicit input escaping for user-supplied fields in n8n Claude prompt templates (lead_name, lead_message) — prompt injection hardening

### Research / Product Decisions
- [ ] **Real estate email inbox lead ingestion — design and build email-to-lead pipeline:** Many agents receive leads via email from lead companies (Zillow, Realtor.com, Homes.com, BoomTown, Opcity, etc.). Build a pipeline that monitors an agent's inbox, detects emails from known lead providers, parses the lead data out of the email body, normalizes it to the standard payload shape, runs it through the existing lead cleansing/dedupe layer, and auto-enrolls in the instant lead response + cold nurture workflows. Key design decisions: (a) **Email access method** — Gmail API via n8n Gmail Trigger node (cleanest, OAuth, real-time push) vs. IMAP polling (works for any inbox, slightly more setup); Gmail Trigger is the right default for agents on Google Workspace. (b) **Parsing approach** — each lead company sends a different email format; options are n8n Code node with per-provider regex/string extraction, a managed email parsing service (Mailparser.io, Parseur) that normalizes to JSON before hitting n8n, or Claude itself to extract structured lead data from raw email HTML (most flexible, handles format drift). Claude extraction is the strongest long-term choice — pass raw email body, get back normalized JSON. (c) **Provider detection** — use sender domain (`@zillow.com`, `@realtor.com`, etc.) or subject line patterns to identify lead emails and ignore everything else. (d) **Normalization** — all parsed leads must conform to the existing normalized payload shape before hitting the cleansing workflow (`lead_name`, `email`, `phone`, `source`, `property_address`, `price_range`, `beds`, `lead_message`). Dedupe check against Neon `leads` table by email + phone before firing any sequence. This is an intake source addition, not a new workflow — it plugs into the existing architecture upstream of everything that already works.
- [ ] **Real estate lead reply handling — decide on conversation architecture:** When a lead replies to an AI-sent SMS or email, should the workflow (a) let the AI continue the conversation autonomously (bidirectional AI ↔ lead loop), or (b) capture the reply, stop automation, and route it directly to the agent to pick up manually? Key tradeoffs: option (a) is faster and scales infinitely but risks the AI going off-script or losing trust on a high-value transaction; option (b) is safer and keeps the agent in control but adds latency and defeats part of the value prop. Consider a hybrid: AI handles first 1–2 reply turns (answers basic questions, re-qualifies interest), then hands off to agent with full context. Research how other real estate AI tools (Follow Up Boss, Sierra, Ylopo) handle this boundary. Applies to: instant lead response, 7-touch cold nurture, open house follow-up.

### Near Term
- [ ] Write Growth tier Claude prompts: SOI re-engagement (real estate), cross-sell campaign (insurance)
- [x] Design Postgres schema as connective tissue between Tier 1 and Tier 2
- [x] Build real estate Starter workflows: instant lead response, open house setup + follow-up, 7-touch cold nurture
- [x] Build real estate Starter: review request — form + workflow + tests complete (2026-04-30)
- [x] Test and promote real estate workflows to production — open house setup + follow-up confirmed working
- [ ] Re-import Real Estate Open House Follow-Up workflow in n8n (prompt updated to use property highlights, fix hallucination)
- [ ] Fix nurture_enroll.html: make email required (known gap — T1/T3/T5 are email-only, no guard)
- [x] Set up Cloudflare Access (Zero Trust) on agent-facing forms before handing URL to first client
- [ ] Set up internal monitoring dashboard (red/green per client status) — needed at 10+ clients
- [x] Deploy HTML tools to tools.norrai.co (Cloudflare Pages)
- [x] Build B&B Manufacturing estimating demo — form + n8n workflow + tests (see 2026-04-29 session log)
- [x] Build B&B lead generator workflow — n8n schedule + Apollo.io + Claude scoring + SendGrid review email + Neon logging
- [ ] Smoke test B&B workflow: import JSON into n8n, fire test payload, verify estimate email
- [ ] Swap placeholder rates with real B&B rates once obtained
- [ ] Add Neon logging nodes to B&B workflow when B&B is onboarded as a client
- [ ] Move B&B rate card to Google Sheets for production (so B&B staff can update rates without touching n8n)
- [ ] **Real estate chief of staff — add AI voice bot interface:** The chief of staff currently lives in Slack (text). Extend it so an agent can *call in* on their phone and have a spoken conversation to kick off tasks (e.g., "Enroll Sarah Johnson in the cold nurture sequence" or "Generate a listing description for 412 Oak Street"). Stack options to evaluate: (a) Twilio Voice + Twilio Media Streams → real-time audio → Whisper/Deepgram for STT → Claude for intent + task execution → TTS response back through Twilio; (b) Vapi.ai or Bland.ai as a managed voice agent layer that handles the telephony plumbing and exposes a webhook for Claude. Vapi/Bland are faster to ship; Twilio is more controllable and already in the stack. Voice sessions should map to the same task-dispatch layer as Slack commands — same Claude prompt, same n8n webhook triggers, just a different input surface. Design the voice interface as a thin adapter over the existing chief of staff logic, not a separate system.

### First Client Targets
- Insurance broker friend — Salesforce user, discovery call framework ready
- Dental and real estate — easiest to template and repeat
- **B&B Manufacturing** (Faribault, MN) — warm prospect, demo estimating workflow built; lead generator workflow built; pending smoke tests and n8n import for both; Apollo.io account is a required dependency B&B must provision

---

## Sales Principles

- Lead with ROI in the client's language, never with technology. Dentists think in appointment values. Realtors think in GCI. Insurance brokers think in retained premium.
- Never lead with n8n, Claude, or "automation."
- Salesforce positioning for insurance: "we complete Salesforce, not compete with it."
- Key insurance qualifying question: "If I told you there were clients about to leave at renewal and you don't know who they are — what would it be worth to find out in advance?"

---

## Database

**Platform:** Neon — project `norrai` (ID: `gentle-hill-54285247`), Postgres 17, `us-east-1`
**Database:** `neondb` | **Branch:** `main`
**Connection string:** stored in `.env` as `DATABASE_URL` (pooled)

| Table | Purpose |
|-------|---------|
| `clients` | NorrAI client businesses — tier, vertical, status, contact info |
| `service_contracts` | Billing history per client |
| `twilio_subaccounts` | One Twilio subaccount + phone number per client |
| `norrai_meetings` | NorrAI's own discovery/onboarding/check-in calls |
| `leads` | End-customer leads across all verticals; vertical-specific fields in `metadata` jsonb |
| `appointments` | End-customer appointments; tracks reminder/follow-up/review-request timestamps |
| `workflow_events` | Audit log of every n8n workflow trigger/completion/failure |

**Vertical-specific lead fields** go in `leads.metadata` jsonb:
```json
// Real estate
{ "property_address": "123 Maple St", "price_range": "$250k-$320k", "beds": 3 }
// Insurance
{ "policy_type": "auto", "renewal_date": "2026-09-01", "current_carrier": "State Farm" }
// Dental
{ "procedure_type": "cleaning", "insurance": "Delta Dental", "last_visit": "2024-11-01" }
```

---

## Session Log

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

### 2026-04-30
- Fixed Open House Setup workflow: HTML email was arriving as a file attachment in Gmail due to unescaped `&` in QR/signin URLs inside HTML attributes
- Moved email HTML construction into the "Build QR URL" Code node with `&amp;`-escaped URLs
- Replaced SendGrid node with HTTP Request node calling SendGrid v3 API directly (`text/html` content type, `JSON.stringify` for body value)
- Requires "Header Auth" credential in n8n: Authorization: Bearer SG.xxx
- Open House Setup + Open House Follow-Up both tested and confirmed working end to end
- Built `website/review_request.html` + `n8n/workflows/Real Estate Review Request.json` — agent form triggers Claude-personalized SMS + email to closed client after 1/3/7-day delay; localStorage agent profile (name, Google URL, Zillow URL); 20 Playwright tests passing

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

### 2026-05-06
- Audited all HTML pages in website/ — found pages missing from CLAUDE.md: `discovery_form.html`, `lead_action_edit.html`, `privacy.html`, `terms.html`
- Brainstormed and implemented Cloudflare Zero Trust Access for all non-public pages
- Restructured `website/` folder: 7 client-facing pages moved to `website/clients/`, 2 internal pages to `website/internal/`; public pages stay at root
- Cloudflare Access Groups: `clients` (all client/prospect tool users + Egan, 7-day session), `internal` (Egan only, 1-day session)
- Cloudflare Access Applications: one for `/clients/*`, one for `/internal/*` — email OTP, free tier, up to 50 users
- Updated 6 Playwright test files to reference new `/clients/` paths; 248 tests passing
- To add a new client: Zero Trust → Access Groups → `clients` → add their email — automatically grants access to all `/clients/*` pages
- n8n workflows unchanged — only workflow referencing a page URL points to `open_house.html` which stays public at root

### 2026-04-28
- Built `website/open_house_setup.html` + `n8n/workflows/Real Estate Open House Setup.json` — agent enters name/email/phone/address/MLS description; Claude extracts 3–5 property highlights; QR code generated via qrserver.com and emailed to agent; highlights encoded as `notes` param in the sign-in URL
- Updated `website/open_house.html` to read `notes` URL param and pass it as `property_notes` in the form payload
- Updated `Real Estate Open House Follow-Up.json`: threaded `property_notes` through all nodes; updated Build Prompt to include a PROPERTY HIGHLIGHTS section — fixes hallucinated property features
- **Webhook URL (setup):** `https://norrai.app.n8n.cloud/webhook/open-house-setup`
- **Re-import required:** Real Estate Open House Follow-Up workflow must be re-imported in n8n to pick up prompt changes

---

## About the Owner

Egan is a data engineer working primarily with dbt and SQL Server. Comfortable with technical implementation. Norr AI is a side business being built from scratch.
