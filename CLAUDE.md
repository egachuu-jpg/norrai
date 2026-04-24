# Norr AI — Project Context

## What This Is

Norr AI is an AI automation agency targeting local businesses in Faribault and southern Minnesota. Built and operated by Egan. The name has quiet Scandinavian/regional roots — credible locally, scalable nationally.

- **Domain:** norrai.co
- **Primary email:** hello@norrai.co
- **Automation email:** studio@norrai.co (SendGrid verified sender)
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
| SendGrid | Email delivery via studio@norrai.co |
| Postgres | Connective tissue between Tier 1 and Tier 2 |
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
- Email sends from studio@norrai.co via SendGrid native n8n node
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

## Files in This Project

| File | What it is |
|------|-----------|
| `listing_form.html` | Client-facing intake form for the listing description generator. Branded Polar Modern style. Submits JSON to n8n webhook. Swap `WEBHOOK_URL` constant to go live. |
| `event_ops_discovery.html` | Discovery questionnaire for event operations prospects (Prep Network warm lead). 6-section form: team context, event volume, time-sink ratings, current tools, repetitive work, priorities. Submits to n8n webhook. |
| `onboarding_form.html` | Agent onboarding questionnaire — collects writing style, previous listings, follow-up tone, CRM, goals. |
| `brand_concepts.html` | Brand exploration — Polar Modern design system. |
| `norrai_style_guide.html` | Full Polar Modern style guide. Tokens: bone `#FAFAF7`, ink `#0A0F1A`, glacial `#7FA9B8`, graphite `#3A3F48`, blush `#E8D4C4`. Fonts: Inter Tight (display), Inter (body), JetBrains Mono (mono). |
| `norrai_master_context.docx` | Full business context document — source of truth for positioning, verticals, workflows, and open threads. |

> **Session note (2026-04-23):** Added `norr_ai_favicon.svg` to all 12 HTML pages that were missing it (services, how-it-works, real-estate, insurance, dental, contact, pricing, listing_form, event_ops_discovery, norrai_style_guide, brand_concepts, onboarding_form). `index.html` already had it.

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
**Test file:** `tests/listing_form.spec.js` — 41 tests covering `listing_form.html`

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

## Open Tasks

### Immediate
- [x] Connect `listing_form.html` to n8n production webhook URL
- [ ] Upgrade Twilio account, buy local 507 number, replace toll-free 855
- [x] Complete SendGrid domain authentication DNS records for norrai.co
- [ ] Open Relay business bank account once MN LLC approval certificate arrives

### Near Term
- [ ] Write Growth tier Claude prompts: SOI re-engagement (real estate), cross-sell campaign (insurance)
- [ ] Design Postgres schema as connective tissue between Tier 1 and Tier 2
- [ ] Build remaining Starter workflows: appointment reminders, open house follow-up, review request
- [ ] Set up internal monitoring dashboard (red/green per client status) — needed at 10+ clients
- [ ] Deploy HTML tools to tools.norrai.co (Cloudflare Pages)

### First Client Targets
- Insurance broker friend — Salesforce user, discovery call framework ready
- Dental and real estate — easiest to template and repeat

---

## Sales Principles

- Lead with ROI in the client's language, never with technology. Dentists think in appointment values. Realtors think in GCI. Insurance brokers think in retained premium.
- Never lead with n8n, Claude, or "automation."
- Salesforce positioning for insurance: "we complete Salesforce, not compete with it."
- Key insurance qualifying question: "If I told you there were clients about to leave at renewal and you don't know who they are — what would it be worth to find out in advance?"

---

## About the Owner

Egan is a data engineer working primarily with dbt and SQL Server. Comfortable with technical implementation. Norr AI is a side business being built from scratch.
