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

### Workflow Logging Standard

Every n8n workflow must log `triggered`, `completed`, and `failed` events to `workflow_events` in Neon. This powers the monitoring dashboard health logic (red/yellow/green per client).

**Node pattern (add to every workflow):**

1. **Lookup Client** (Postgres, `continueOnFail: true`) — resolves `client_id` based on workflow group:
   - Real estate webhooks: `SELECT id FROM clients WHERE primary_contact_email = '{{ $json.body.agent_email }}'`
   - B&B workflows: hardcode `86a01b94-ddab-4594-8afc-8212fb18fdd0`
   - Internal/system workflows: hardcode `e2f9934c-4d28-4bb4-ac90-4284c1123517` (norrai_internal)
   - Lead Cleanser pipeline + misc: use norrai_internal until per-client routing is built

2. **Log Triggered** (Postgres, `continueOnFail: true`) — fires right after Token Check:
   ```sql
   INSERT INTO workflow_events (client_id, workflow_name, event_type, payload)
   VALUES ($client_id, '$workflow_name', 'triggered',
     '{"execution_id": "{{ $execution.id }}", "agent_email": "{{ $json.body.agent_email }}"}'::jsonb)
   ```

3. **Log Completed** (Postgres, `continueOnFail: true`) — fires at the successful end of the workflow:
   ```sql
   INSERT INTO workflow_events (client_id, workflow_name, event_type, payload)
   VALUES ($client_id, '$workflow_name', 'completed',
     '{"execution_id": "{{ $execution.id }}"}'::jsonb)
   ```

4. **Error Workflow setting** — every workflow's Settings → Error Workflow must point to `Norr AI Workflow Error Logger`. This handles `failed` event logging automatically.

**`workflow_name` registry (snake_case values stored in Neon):**

| Workflow | `workflow_name` |
|---|---|
| Real Estate Instant Lead Response | `instant_lead_response` |
| Real Estate Open House Follow-Up | `open_house_follow_up` |
| Real Estate Open House Setup | `open_house_setup` |
| Real Estate Listing Description Generator | `listing_description` |
| Real Estate Review Request | `review_request` |
| Real Estate 7-Touch Cold Nurture | `cold_nurture` |
| B&B Lead Generator | `bnb_lead_generator` |
| B&B Manufacturing Estimate | `bnb_estimate` |
| Norr AI Chief of Staff | `norrai_chief_of_staff` |
| Norr AI Client Health Query | `client_health_query` |
| Norr AI Red Alert Scheduler | `red_alert_scheduler` |
| Real Estate Lead Cleanser | `lead_cleanser` |
| Real Estate Zillow Intake | `zillow_intake` |
| Real Estate Realtor Intake | `realtor_intake` |
| Real Estate Facebook Intake | `facebook_intake` |
| Real Estate Custom Form Intake | `custom_form_intake` |
| Real Estate Lead Response Auto | `lead_response_auto` |
| Real Estate Lead Action Handler | `lead_action_handler` |
| Real Estate Lead Cleanser | `lead_cleanser` |
| Real Estate Zillow Intake | `zillow_intake` |
| Real Estate Realtor Intake | `realtor_intake` |
| Real Estate Facebook Intake | `facebook_intake` |
| Real Estate Custom Form Intake | `custom_form_intake` |
| Client Discovery → Claude Analysis | `client_discovery` |
| Client Onboarding → Claude Analysis | `client_onboarding` |
| Event Ops Discovery | `event_ops_discovery` |
| Real Estate Research Agent | `research_agent` |
| Buyer Briefing Generator | `buyer_briefing` |
| Price Sanity Checker | `price_sanity_checker` |
| Lead Scoring at Intake | `lead_scoring` |
| Nurture Prompt Scheduler | `nurture_prompt_scheduler` |
| Nurture Prompt Confirm | `nurture_prompt_confirm` |

**All logging nodes use `continueOnFail: true` — logging failures never break the main workflow.**

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

### Research Agent (Subworkflow)
- **Status:** Live in production — smoke tested 2026-05-10
- **Stack:** Webhook → Token Check → Prep Input (Code) → Log Triggered (Neon) → Cache Lookup (Neon, 7-day TTL) → Evaluate Cache (Code) → [cache hit] Respond Cached / [cache miss] Census Geocoder → Build Gemini Prompt (Code) → Gemini 2.0 Flash + Google Search Grounding (HTTP) → Parse + Compliance Filter (Code) → Claude Haiku Formatter (HTTP) → Build Final Output (Code) → Save to Cache (Neon) → Log Completed (Neon) → Respond to Webhook
- **Webhook URL:** `https://norrai.app.n8n.cloud/webhook/research-agent`
- **Input:** `address`, `city`, `state`, `zip`, `price_range`, `beds`, `baths` (+ optional `sqft`, `year_built`, `caller`, `client_id`)
- **Output:** `status`, `address_verified`, `walkability`, `schools`, `market`, `recent_comps`, `data_confidence`, `insight_block`, `comps_disclaimer`
- **Credentials needed in n8n:** "Gemini API Key" (Query Auth credential — name: `key`, value: your Gemini API key) — created and wired
- **Prerequisites:** `research_cache` table in Neon (added to `db/schema.sql` — apply to production)
- See `PRD/research-agent.md` for full spec

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
│   │   ├── norrai_style_guide.html
│   │   └── dashboard.html
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
**276 tests across 11 spec files — all must pass before pushing.**

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
| `tests/dashboard.spec.js` | `internal/dashboard.html` |

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
Instead of the workflow sending the automated text directly to the lead, route it through Slack first. The agent receives the pre-drafted SMS in Slack, formatted exactly as it would be sent. Tapping the message opens it in iMessage (or the native Android Messages app) with the lead's number and message body pre-filled — agent just hits send. Technical mechanism: generate an `sms:` deep link (`sms:+15075551234?body=Hey%20Sarah...`) and post it to Slack as a button or linked message. This works on mobile — iOS and Android both honor the `sms:` URI scheme natively with no app install required; tapping the link opens the default messaging app with the number and body pre-filled. The main implementation detail in n8n is URL-encoding the message body correctly before constructing the link — use a Code node to run `encodeURIComponent(message)` on the Claude-generated SMS draft before building the `sms:` URL. Benefit: agent stays in the loop for the actual send (trust, compliance, personal touch) without having to draft anything. Tradeoff: adds one manual step vs. full automation. Could be an opt-in mode per agent — "auto-send" vs. "review in Slack first." Applies to: instant lead response, open house follow-up, any outbound SMS in the nurture sequence.

---

## Open Tasks

### Meta
- [ ] Audit and reorganize Open Tasks — reduce essay-length bullets to one-liners, move detailed specs to PRDs, remove stale items, tighten section structure

### Immediate
- [x] Connect `listing_form.html` to n8n production webhook URL
- [ ] Upgrade Twilio account, buy local 507 number, replace toll-free 855
- [x] Complete SendGrid domain authentication DNS records for norrai.co
- [ ] Open Relay business bank account once MN LLC approval certificate arrives

### Security (Pre-First Client)
- [x] Fix `innerHTML` → `textContent` in `open_house_setup.html` line 307 — XSS code smell, one-line fix
- [x] Set up Cloudflare Access (Zero Trust) on all agent-facing forms — restructured website/ into clients/ and internal/ subfolders; two Access Groups (clients, internal) + two Applications protect /clients/* and /internal/* with email OTP (7-day and 1-day sessions)
- [ ] Add rate limiting to n8n webhook endpoints — prevent abuse before first live client
- [x] Add server-side input validation in n8n workflows — added to Instant Lead Response (Validate Input node) and Open House Follow-Up (Prep Wait Time node)
- [ ] Encrypt PII columns in Neon DB (phone, email, name) using pgcrypto — currently plaintext
- [x] Add explicit input escaping for user-supplied fields in n8n Claude prompt templates (lead_name, lead_message) — [DATA][/DATA] delimiter wrapping added to Instant Lead Response and Open House Follow-Up prompts

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
- [ ] Add optional property details field to nurture_enroll.html — agent pastes MLS description, highlights, or notes; field passed as `property_notes` in payload; inject into T1–T6 prompts so Claude can reference specific property features throughout the sequence rather than working from address/price/beds alone
- [x] Set up Cloudflare Access (Zero Trust) on agent-facing forms before handing URL to first client
- [x] Set up internal monitoring dashboard (red/green per client status) — built 2026-05-08: dashboard.html + Health Query webhook + Red Alert Scheduler (6am/6pm CT Slack)
- [x] Deploy HTML tools to tools.norrai.co (Cloudflare Pages)
- [x] Build B&B Manufacturing estimating demo — form + n8n workflow + tests (see 2026-04-29 session log)
- [x] Build B&B lead generator workflow — n8n schedule + Apollo.io + Claude scoring + SendGrid review email + Neon logging
- [ ] Smoke test B&B workflow: import JSON into n8n, fire test payload, verify estimate email
- [ ] Swap placeholder rates with real B&B rates once obtained
- [ ] Add Neon logging nodes to B&B workflow when B&B is onboarded as a client
- [ ] Audit workflow_events logging coverage — only B&B Lead Generator currently logs to Neon; all real estate workflows (Instant Lead Response, Open House Follow-Up, Open House Setup, Listing Description, 7-Touch Nurture, Review Request, Lead Cleanser pipeline) need `workflow_events` INSERT nodes added before the monitoring dashboard can work
- [x] **Wire research agent into 7-Touch Cold Nurture** — `Real Estate 7-Touch Cold Nurture with Research.json`; research called once at enrollment; insight_block injected into T1/T2/T3 prompts
- [x] **Wire research agent into Instant Lead Response** — `Real Estate Instant Lead Response with Research.json`; research called after Validate Input; MARKET CONTEXT block added to Build Prompt
- [x] **Wire research agent into Open House Follow-Up** — `Real Estate Open House Follow-Up with Research.json`; research called after overnight wait node; MARKET CONTEXT block added to Build Prompt
- [x] Research Agent integration audit complete — see `PRD/buyer-briefing.md`, `PRD/price-sanity-checker.md`, `PRD/lead-scoring-at-intake.md` for new workflow PRDs
- [ ] **Build Buyer Briefing Generator** — `clients/buyer_briefing.html` form + n8n workflow; pre-showing briefing emailed to buyer automatically; see `PRD/buyer-briefing.md`
- [ ] **Build Price Sanity Checker** — `clients/price_check.html` form + n8n workflow; inline comp verdict in 60 seconds; see `PRD/price-sanity-checker.md`
- [ ] **Build Lead Scoring at Intake** — parallel scoring branch in Lead Cleanser pipeline + dashboard hot-lead indicator; see `PRD/lead-scoring-at-intake.md`
- [x] Apply `research_cache` table to Neon production — applied 2026-05-10
- [ ] **Evaluate Token Check nodes across all workflows** — every workflow has a Token Check IF node that checks `x-norr-token: 8F68D963-7060-4033-BD04-7593E4B203CB` against the incoming header. This token is hardcoded in every client-facing HTML form and baked into the n8n IF condition — it's the same shared secret everywhere. The honest security value is low: anyone who views page source can see the token, and it's the same across all workflows. The real protection for agent-facing forms is Cloudflare Access (email OTP on `/clients/*`). Evaluate whether to: (a) **remove Token Check entirely** from all workflows and rely on Cloudflare Access as the auth layer; (b) **keep it but per-client** — rotate to a per-client token stored in Neon, looked up dynamically, so one leaked token doesn't open all workflows; or (c) **keep as-is** and accept it as a basic CSRF/accident guard rather than real security. Option (a) is likely the right call for workflows only triggered by Cloudflare-protected forms. Workflows that accept external webhooks (intake sources, chief of staff) are a separate question — those may need the check or a signed secret.
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

## Lessons Learned

### n8n — Expressions & Nodes
- Token Check rightValue must be a plain string — any `=` prefix causes n8n to evaluate it as an expression and the check always fails
- Never use `$json.caller` (or similar dynamic fields) in SQL nodes — n8n blocks certain variable references in database queries for security; use hardcoded strings or safe payload fields
- Cache Lookup (Postgres) node: enable "Always Output Data" or the node stops execution on 0 rows instead of passing through
- Multiline Claude prompts: build in a Set node first, pass as `$json.prompt` to the HTTP Request — avoids bad control character errors from inline expressions
- Watch for field name mismatches between HTML form payload keys and n8n node references — silent failures with no error output
- Double `$$` on price fields in n8n expressions is a known gotcha — check expressions on any currency field
- When `continueOnFail: true` is set on an HTTP Request node, `$input.first().json` in the downstream Code node is the n8n error object on failure — always use `$('NodeName').first().json` for a stable upstream named ref to preserve payload data regardless of HTTP result
- `respondToWebhook` node with empty `options: {}` returns `{"success": true}` — always set `respondWith: "firstIncomingItem"` (for passthrough) or `"json"` with an explicit `responseBody` expression
- After removing a node from a workflow JSON array, check the previous node for a trailing comma — JSON is invalid with it and n8n will refuse to import
- For confirm/accept workflows triggered by link clicks (GET requests), read the token from `$json.query.token` (query param), not from a request header
- Validate UUIDs with regex before using them in SQL — untrusted URL params may be malformed or injection attempts; use `SELECT null::uuid WHERE false` as a safe no-op fallback
- Idempotency in confirm workflows: check `IS NULL` on the timestamp column before updating to prevent double-enrollment on repeated link clicks
- Parallel fire-and-forget in n8n: multiple downstream nodes can fan out from the same output — add them both to the same `connections["Source Node"]["main"][0]` array in the JSON

### n8n — Workflow Management
- After editing a workflow JSON file locally, re-import is required in n8n — it does not auto-sync from the file
- When restructuring HTML file paths (e.g., into subfolders), n8n workflow webhook URLs are unaffected — only Playwright test file paths need updating
- "With Research" workflow variants use distinct webhook paths (e.g., `lead-response-research`) so originals and new variants coexist in n8n during smoke testing — swap to original paths when promoting to production
- Email-only demo variants are a useful pattern when Twilio is not provisioned — swap SMS nodes for SendGrid, update prompts to SUBJECT/BODY format, use a distinct webhook path

### SendGrid
- HTML email arriving as a Gmail attachment = unescaped `&` in HTML attribute values inside the email body; fix with `&amp;`
- Use HTTP Request node calling SendGrid v3 API directly for HTML emails — the native n8n SendGrid node doesn't set content-type correctly for HTML
- SendGrid v3 HTTP Request requires a "Header Auth" credential: `Authorization: Bearer SG.xxx`; JSON.stringify the body value
- Disable click tracking on transactional emails — enabled by default, causes Gmail to route to Promotions tab

### Gemini
- `gemini-2.0-flash` is no longer available to new API users — use `gemini-2.5-flash`
- Gemini 2.5 tool name: `google_search` (not `google_search_retrieval` — that was 2.0 only)
- REST generation config key is `generation_config` (snake_case), not `generationConfig` (JS SDK style)
- `response_mime_type: application/json` is incompatible with tool use — remove it from `generation_config` when using `google_search`
- n8n credential for Gemini: Query Auth type, field name `key`, display name "Gemini API Key"
- Gemini (and Claude) may return markdown-fenced JSON (triple-backtick json blocks) even when instructed not to — always strip fences before JSON.parse()
- Never commit `.env` — `DATABASE_URL` (pooled connection string) lives there only
- `appointments` table: schema is correct, but don't build calendar scraping/normalization until a real client requires it

### Prompt Engineering
- Wrap all user-supplied fields in Claude prompts with `[DATA][/DATA]` delimiters to prevent prompt injection (lead_name, lead_message, agent_notes, etc.)
- Cold nurture and lead response prompts must explicitly say "do not invent school names, market statistics, or sold prices" until the research agent is wired in — Claude will hallucinate these without the instruction
- Property highlights must be extracted during Open House Setup (when the MLS description is available) and passed as a URL param — the Follow-Up workflow fires the next morning with no access to the original listing copy
- Pass structured research data as a formatted text block (`research_detail`) not just the `insight_block` summary — Claude needs school names/ratings/distances and market numbers to answer specific lead questions; the 2–3 sentence summary is too thin
- When splitting a combined address string is required, 4 separate form fields is more reliable than parsing — comma placement is not enforced by users

### Cloudflare Access
- To add a new client: Zero Trust → Access Groups → `clients` → add email — grants access to all `/clients/*` pages automatically
- `open_house.html` stays at root (public, QR code on door) — Cloudflare Access only covers `/clients/*` and `/internal/*`
- Session durations: clients group = 7 days, internal group = 1 day

### Playwright / Testing
- `npx serve` strips `.html` extension AND drops query params in clean-URL redirects — always navigate to the clean path (no `.html`) in Playwright tests when query params are needed

### Architecture Decisions
- Own the infrastructure stack (Twilio numbers, Neon, n8n) — client pays for service, Norr AI owns the stack
- Cloudflare Access is the real auth layer for agent-facing forms; Token Check is a secondary CSRF guard, not real security
- Research Agent caches by address with 7-day TTL — call once per workflow run, not per touch; the cache covers the full cold nurture run
- Dashboard health logic: red = any failures in last 7 days, yellow = no events in 7 days (silence), green = healthy
- Per-client personalized URLs use `clients.token` (uuid) — no separate `agents` table needed at solo-agent-per-client scale

## About the Owner

Egan is a data engineer working primarily with dbt and SQL Server. Comfortable with technical implementation. Norr AI is a side business being built from scratch.

---

## Session Wrap-Up

When the user says **"donezo"** or **"wrap up"**, run the `/session-end` skill — update `SESSION_LOG.md` with what was done this session, extract any new lessons to `## Lessons Learned` above, and commit both files.

Full instructions live in `.claude/commands/session-end.md`.
