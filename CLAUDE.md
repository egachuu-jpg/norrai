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
| Client Discovery → Claude Analysis | `client_discovery` |
| Client Onboarding → Claude Analysis | `client_onboarding` |
| Event Ops Discovery | `event_ops_discovery` |
| Real Estate Research Agent | `research_agent` |
| Buyer Briefing Generator | `buyer_briefing` |
| Price Sanity Checker | `price_sanity_checker` |
| Lead Scoring at Intake | `lead_scoring` |
| Nurture Prompt Scheduler | `nurture_prompt_scheduler` |
| Nurture Prompt Confirm | `nurture_prompt_confirm` |
| Nurture De-Enroll Prompt | `nurture_deenroll_prompt` |
| Nurture De-Enroll Confirm | `nurture_deenroll_confirm` |
| Birthday & Anniversary Outreach | `bday_anniversary_outreach` |
| Real Estate BoldTrail Intake | `boldtrail_intake` |
| Norr AI Contract Signed | `contract_signed` |
| Email Triage Sweep | `email_triage_sweep` |
| Email Triage Reply Handler | `email_triage_reply` |

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

> **Tasks are tracked in Neon (`stories` + `tasks` tables), not here.** Query Neon for current state:
>
> ```sql
> SELECT t.title, t.status, t.priority, s.title as story FROM tasks t LEFT JOIN stories s ON t.story_id = s.id ORDER BY t.priority, t.seq;
> ```

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

See `docs/lessons-learned.md` for the full reference — n8n expressions, workflow management, SendGrid, Gemini, prompt engineering, Cloudflare Access, HTML/JS, Playwright, BoldTrail, Zapier, and architecture decisions.

## About the Owner

Egan is a data engineer working primarily with dbt and SQL Server. Comfortable with technical implementation. Norr AI is a side business being built from scratch.

---

## Session Wrap-Up

When the user says **"donezo"** or **"wrap up"**, run the `/session-end` skill and also do the following **before committing**:

**Additional step — update Neon tasks:**
- Review what was completed this session
- Run `UPDATE tasks SET status = 'completed', updated_at = NOW() WHERE title = '...'` for each task finished
- If a story's tasks are all done, update the story status too: `UPDATE stories SET status = 'completed' WHERE id = '...'`
- Use the Neon MCP tool to execute these directly

Then commit `SESSION_LOG.md` and `docs/lessons-learned.md` as usual.
