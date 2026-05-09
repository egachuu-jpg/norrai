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

### Real Estate — Agent chief of staff (conversational Slack assistant)
A Slack-based conversational assistant for real estate agents — handles task dispatch, answers questions about their pipeline, and maintains conversation state across turns. The core product insight: state is what makes it feel like an assistant rather than a command line. An agent should be able to say "generate a listing description for 123 Maple" and have the assistant ask for missing details, remember mid-conversation corrections ("actually make that Friday at 3pm"), and confirm before firing irreversible actions — all without the agent repeating themselves.

**Orchestration: LangGraph (not n8n).** Conversational state management is a core product requirement, not a nice-to-have. n8n handles one-shot webhook workflows well but multi-turn conversation state is awkward — each Slack message is a separate trigger and correlating replies to open conversations requires duct-taped state management in Neon. LangGraph handles this natively: each conversation is a stateful graph that accumulates context across turns, pauses for missing information, and resumes when the agent responds. n8n stays as the execution layer — when LangGraph decides to act, it fires an n8n webhook. LangGraph is the brain, n8n is the hands.

**Handling underspecified commands:**
When an agent types something like "generate a listing description for 123 Maple" without providing beds, baths, sq ft, or features, LangGraph handles the follow-up conversation naturally — Claude asks for what's missing, the agent replies in-thread, LangGraph accumulates the answers into state, then fires the listing description webhook once it has everything. No duct-taped reply correlation needed.

**Stack:** FastAPI + Slack Bolt for Python + LangGraph + Anthropic SDK + asyncpg. Hosted on Railway (~$5–10/mo). LangGraph checkpoints conversation state to Neon via `PostgresSaver` — same `DATABASE_URL`, no new infrastructure. Voice interface (Twilio or Vapi) is a thin adapter over the same task-dispatch layer.

**Task set (v1):**
- Enroll a lead in a nurture sequence
- Generate a listing description
- Add a calendar event or reminder
- Check today's schedule and open tasks
- Mark a transaction checklist item complete
- Send a review request

**n8n relationship:** All client-facing workflows (SMS, email, Google Calendar writes, nurture sequences) still run in n8n. LangGraph only replaces the Slack conversation layer — intent parsing, state management, confirmation flows. Task execution fires n8n webhooks exactly as before.

**What LangGraph does vs. what n8n does:**

LangGraph handles reasoning, conversation, and decisions. n8n handles execution. Neither crosses into the other's lane.

| LangGraph | n8n |
|-----------|-----|
| Receives Slack message | Sends SMS via Twilio |
| Maintains conversation state across turns | Sends email via SendGrid |
| Parses intent — what is the agent asking for? | Writes to / reads from Neon |
| Detects missing info, asks follow-up questions | Creates Google Calendar events |
| Decides which tool to call and with what params | Manages nurture sequence timing and delays |
| Handles confirmation before irreversible actions | Generates listing descriptions via Claude API |
| Narrates tool results back to the agent | Personalizes SMS drafts, scores leads, parses emails |
| Posts response to Slack | Handles open house, review request, lead cleansing workflows |

Both layers use Claude, but for different things:

| Layer | Uses Claude for |
|-------|----------------|
| LangGraph | Conversation — intent parsing, follow-up questions, tool routing, result narration. Short prompts, fast, cheap. |
| n8n | Content generation — listing descriptions, personalized SMS copy, lead scoring, email body parsing. Heavier prompts, longer outputs. |

**Worked example — "generate listing description for 123 Maple":**
```
Agent: "generate a listing description for my new listing at 123 Maple"

LangGraph → Claude parses intent: listing description
           → missing: beds, baths, sqft, features
           → posts to Slack: "I need a few details — beds, baths,
             sqft, and any features to highlight?"

Agent: "3 bed 2 bath 1400 sqft, updated kitchen, attached garage"

LangGraph → accumulates details into conversation state
           → calls tool: generate_listing_description({
               address: "123 Maple", beds: 3, baths: 2,
               sqft: 1400, features: "updated kitchen, attached garage",
               agent_id: "agent_001"
             })
           → fires n8n webhook

n8n        → builds prompt with details + agent's previous listings
           → calls Claude API → headline, MLS description, social post
           → sends email to agent via SendGrid
           → returns {"status": "sent"}

LangGraph → posts to Slack: "Done — description sent to your email."
```
LangGraph touched Claude once (short conversation turn). n8n touched Claude once (heavy content generation). Neither knew about the other's call.

**Multi-tenancy — one service, N agents:**
Five agents is not five deployments. The LangGraph service is multi-tenant by design. Each conversation is keyed by agent ID — when a Slack message arrives, the service identifies the agent from the workspace, loads their config, retrieves their isolated conversation state from Neon, runs the graph with their context, and posts back. Agent A's state never touches Agent B's.

What's shared: one Railway service, one FastAPI app, one Neon database, one LangGraph graph definition. What's per-agent in Neon: their Slack workspace bot token, Google Calendar OAuth credential, Twilio subaccount reference (already in `twilio_subaccounts`), agent profile (name, voice preferences), n8n webhook URLs.

Slack multi-workspace: each agent installs the Slack bot into their own workspace via a standard OAuth flow. Each installation generates a bot token stored per-agent in Neon. Incoming messages are identified by workspace ID and routed to the right agent config.

Cost scales only on Claude API token usage (cents per day per agent at normal conversation volume) — Railway and Neon costs stay flat. This is the business model working as intended: infrastructure built once, marginal cost of adding a new agent is a config row in Neon and a Slack app installation.

**Schema drift — keeping LangGraph tool definitions in sync with n8n webhooks:**
As the workflow library grows, the schemas that LangGraph tools send to n8n webhooks can silently fall out of sync when either side is updated. The danger isn't crashes — it's silent misbehavior (missing fields produce blank outputs, personalization breaks, wrong leads enrolled). Three-layer defense:

1. **Validation in n8n (do this now)** — add a Code node at the top of every webhook workflow that checks for required fields and throws a descriptive error if any are missing. Makes drift failures loud and immediate instead of silent:
```js
const required = ['lead_name', 'email', 'phone', 'agent_id'];
const missing = required.filter(f => !$json[f]);
if (missing.length) throw new Error(`Missing required fields: ${missing.join(', ')}`);
```

2. **FastAPI wrapper layer (emerges naturally when building the Python service)** — instead of LangGraph tools calling n8n webhooks directly, they call FastAPI endpoints in the same Python service. Each endpoint owns the Pydantic schema, validates the payload, then forwards to n8n. Schema drift between tool definition and validation layer becomes impossible — they're the same Pydantic model. The only seam is FastAPI → n8n, not N tools → N webhooks:
```
LangGraph tool → FastAPI endpoint (Pydantic) → n8n webhook
```

3. **Contract tests (once workflow library grows)** — one integration test per workflow that sends the exact payload a LangGraph tool would send to the actual n8n webhook and asserts the response is correct. Runs in CI before deploying the Python service. Catches n8n changes that weren't reflected in the tool schema before they hit production.

Start with option 1 on every n8n webhook being built now. Option 2 emerges naturally when building the Python service — route through FastAPI instead of calling n8n directly. Option 3 when the workflow count makes confident refactoring hard.

### Real Estate — Daily and weekly agent briefing
Send each agent a personalized morning summary of what's on their plate for the day (and a weekly preview on Monday morning). Primary data source is Google Calendar via the n8n Google Calendar node (OAuth, real-time). Agents on Google Workspace are the obvious first target; Outlook/Microsoft Calendar is a secondary option if an agent isn't on Google. Claude synthesizes the raw calendar data into a briefing — not just a list of events, but prioritized and framed as "here's your day" with anything time-sensitive called out. Delivery: SMS at 7am CT daily and/or email — agent's choice at onboarding. Weekly preview fires Sunday evening or Monday morning.

Beyond calendar events, the briefing should eventually pull from: leads currently in active nurture sequences, pending tasks logged via the reminder system (see below), and any open house or review request workflows that are mid-flight.

**Future enhancement — agent reminder log and calendar write-back:** For agents who don't keep their calendar current, add a way to log reminders in natural language — "inspection at 412 Oak St on Friday," "need to schedule closing for the Johnson deal," "follow up with Sarah after she tours Thursday." Two input paths to consider: (a) a simple form (same pattern as the other client-facing tools) where the agent logs a reminder with a due date and notes; (b) a more natural interface where the agent texts or Slacks the reminder to the chief of staff in plain language and Claude parses and stores it — due date, property or deal reference, action required. Reminders get logged to a `reminders` table in Neon (or appended to the `leads` metadata if tied to a specific lead). The daily briefing then pulls from both calendar AND the reminder log and synthesizes them together. This is the right fallback for agents who live outside their calendar — the system still knows what they're tracking because they told it.

**Calendar write-back:** The same Google Calendar OAuth credential used to read events for the briefing also supports creating events — n8n's Google Calendar node handles both directions. When an agent tells the chief of staff "add the Johnson closing to my calendar for Thursday at 10am" or "remind me about the inspection Friday at 2pm at 412 Oak St," Claude parses the natural language into a structured event (title, date/time, location, description) and n8n creates it directly in their Google Calendar. Confirmation sent back to the agent via SMS or Slack. This makes the reminder log and calendar fully bidirectional — agent can read their schedule through the briefing and write to it through the chief of staff, all without opening a calendar app. Applies to: appointments, inspections, closings, open houses, follow-up calls, any time-bound task.

### Norr AI — Owner chief of staff (conversational business assistant)
A Slack-based conversational assistant for Egan — knowledgeable about the full Norr AI business, able to answer questions about the roadmap, client pipeline, and open tasks, and able to execute workflows by dispatching to n8n sub-agents. Distinct from the real estate agent chief of staff (narrow domain, specific tasks) — this one covers the whole business and acts as a thinking partner, not just a task dispatcher.

**Architecture — three layers:**

**Layer 1 — Static context (system prompt + prompt caching)**
CLAUDE.md, the 6-month roadmap, and client docs all fit in a single Claude context window today. Inject them as the system prompt on every call. Use Anthropic prompt caching — the business context tokens are cached between calls, so only the user's message and Claude's response cost full price. Fast, cheap, no new infrastructure. As the knowledge base grows, this layer gets refreshed on a schedule (daily re-read of source docs).

**Layer 2 — Live data (Claude tool use → Neon)**
For live operational questions ("how many active clients?", "what fired last in the B&B workflow?"), Claude calls tools that query Neon directly — `clients`, `workflow_events`, `leads` tables. Claude receives structured data back and narrates it. Keeps the live picture accurate without baking volatile data into the static prompt.

**Layer 3 — Task execution (Claude tool use → n8n webhooks)**
Claude classifies each message as "answer a question" or "do something." When it's the latter, it calls a named tool that fires an n8n webhook. Define a small set of actions upfront:
- `add_todo` — writes a new task to CLAUDE.md or Neon
- `trigger_workflow` — fires a named n8n workflow (lead enrollment, listing description, etc.)
- `create_calendar_event` — writes to Google Calendar via the existing OAuth credential
- `get_client_status` — queries Neon for a named client's workflow activity
- `log_meeting_note` — appends to the session log in CLAUDE.md or a dedicated notes doc

**Design goal — full queryability:**
Everything about the Norr AI business should be answerable through this assistant. That means the data layer needs to cover all sources:
- **CLAUDE.md + roadmap + client docs** — static context, injected via system prompt (Layer 1)
- **Neon tables** — live operational data: `clients`, `leads`, `workflow_events`, `appointments`, `service_contracts` — queried via tool use (Layer 2)
- **n8n workflow state** — what ran, when, what failed — via `workflow_events` log in Neon
- **GitHub** — open issues, recent commits, branch status — queryable via GitHub API tool
- **Google Calendar** — what's scheduled — via Google Calendar OAuth credential
- **Session logs** — the CLAUDE.md session log is the memory of what was built and when

The abstraction to build toward: every data source has a corresponding tool Claude can call. The assistant doesn't need to know upfront which source has the answer — it calls the right tool based on the question, same way a person would open the right doc.

**Slack integration:**
n8n Slack Trigger node listens for DMs or `@mentions`. Message passes to Claude with full context (Layer 1 system prompt). Claude responds and optionally calls tools (Layers 2–3). n8n posts response back in-thread. 4–5 nodes total. Requires a Slack app with bot permissions + Events API pointed at the n8n webhook URL.

**What it can answer on day one:**
- "What should I focus on this week?" → synthesizes open tasks + roadmap milestone
- "Where are we with B&B?" → reads client doc + `workflow_events` table
- "What's left before I can onboard a first client?" → reads open tasks, flags blockers

**What task execution looks like:**
- "Add a to-do to fix the Twilio number" → `add_todo` tool → written to CLAUDE.md or Neon
- "Enroll the Trnka lead in the nurture sequence" → `trigger_workflow` → n8n fires the sequence
- "Remind me to follow up with the insurance broker Monday" → `create_calendar_event` → Google Calendar

**Future — RAG layer:**
Once the knowledge base outgrows a single context window (client histories, meeting notes, workflow logs), add a pgvector retrieval layer. Neon already supports pgvector — no new infrastructure. At query time, embed the user's message, retrieve the most relevant chunks, inject into the prompt. This scales the assistant without changing the Slack or n8n layer at all.

**Build notes — hosting as a Python service:**
LangGraph requires a hosted Python service (not just n8n nodes). The service receives Slack webhook events, runs the LangGraph agent, and posts the response back. Roughly 200–300 lines of real code.

Stack:
- **FastAPI** — lightweight Python web framework
- **Slack Bolt for Python** — Slack's official SDK; handles OAuth, event routing, and the 3-second timeout problem (Slack requires a 200 ACK within 3 seconds — Bolt acknowledges immediately and processes async)
- **LangGraph** — agent orchestration (state, tool routing, parallel fan-out, human-in-the-loop interrupts)
- **Anthropic SDK** — Claude API calls
- **asyncpg** — Postgres connection to Neon for checkpointing and tool queries

Hosting: **Railway** is the right call — connect GitHub repo, set env vars (`ANTHROPIC_API_KEY`, `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `DATABASE_URL`), auto-deploys on push. ~$5–10/mo, always-on, no server management.

LangGraph checkpoint storage: `PostgresSaver` points at the existing Neon `DATABASE_URL` and stores conversation state between Slack messages automatically — no new tables to design.

n8n relationship: LangGraph replaces only the thin "receive Slack message → call Claude → post response" portion of the chief of staff. All client-facing workflows (nurture sequences, SMS, SendGrid, Google Calendar writes) still run in n8n. When the agent decides to execute a task, it fires an n8n webhook — n8n takes it from there. LangGraph is the brain, n8n is the hands.

Could live as an `/agent` subdirectory in the existing norrai repo.

### Real Estate — Transaction coordination checklist (per-client deal pipeline)
When a lead converts to a client, agents work through a standard checklist of tasks that varies by deal type — seller listing vs. buyer representation. Example seller sequence: schedule inspection → notify homeowner of inspection date → remind agent day-of → schedule closing → notify all parties → etc. This is a well-known real estate problem (whole SaaS products exist around it: Dotloop, SkySlope, Paperless Pipeline). Norr AI's angle is to make the checklist drive automation rather than just track status.

**Recommended architecture:**

- **Checklist templates in Neon** — one template per deal type (`seller_listing`, `buyer_rep`), each with an ordered list of task definitions: task name, description, who's responsible, and due-date logic (absolute like "closing date" or relative like "3 days before inspection date"). These are global templates the agent customizes once.
- **Per-client transaction record** — when a lead converts, create a `client_transactions` row linked to the `leads` record. Spawn a set of `transaction_tasks` rows from the relevant template, each with its own status (`pending`, `in_progress`, `done`) and calculated due date once key milestone dates are known (inspection date, closing date).
- **Daily briefing integration** — the morning briefing queries open and overdue `transaction_tasks` for the agent and surfaces them alongside calendar events. Agent sees everything in one place: calendar appointments + active deal tasks + overdue items.
- **Auto-triggered reminders** — high-value tasks don't wait for the agent to act. When "notify homeowner of inspection" becomes due, n8n fires the existing SMS/email workflow automatically. When "day-of inspection reminder" hits, the agent gets an SMS. The checklist due date is the trigger — same machinery as the existing workflows, just checklist-driven instead of form-submitted.
- **Task completion** — agent marks tasks done via a simple form, or by texting/Slacking the chief of staff ("mark inspection scheduled for the Johnson file"). Chief of staff updates the `transaction_tasks` record and confirms.

**Tier placement:** Simplified version (checklist + daily briefing integration, no auto-triggers) is Growth tier. Full version with auto-triggered reminders and calendar write-back is Pro tier. A polished per-client checklist UI could be part of a white-labeled portal.

**Integration flexibility — design principle:** The task data layer must be abstracted so that Neon is not the only possible source. For agents with no existing system (spreadsheet or nothing), Neon owns the task data. For agents already on Dotloop, SkySlope, or similar, the Pro tier version reads task status from their existing platform via API rather than duplicating the data — Neon is not involved, and the daily briefing just pulls from whichever source is authoritative for that agent. The abstraction to build toward: a `task_source` config per agent (`neon`, `dotloop`, `skyslope`) that the briefing workflow uses to route its query. That way onboarding a new client on any platform is a config change, not a rebuild. Known integration targets: Dotloop (REST API, widely used), SkySlope (REST API), Brokermint, Paperless Pipeline. Most have publicly documented APIs and support OAuth or API key auth — all reachable from n8n via HTTP Request nodes.

### Real Estate — Slack-mediated SMS send (agent-in-the-loop)
Instead of the workflow sending the automated text directly to the lead, route it through Slack first. The agent receives the pre-drafted SMS in Slack, formatted exactly as it would be sent. Tapping the message opens it in iMessage (or the native Android Messages app) with the lead's number and message body pre-filled — agent just hits send. Technical mechanism: generate an `sms:` deep link (`sms:+15075551234?body=Hey%20Sarah...`) and post it to Slack as a button or linked message. This works on mobile — iOS and Android both honor the `sms:` URI scheme natively with no app install required; tapping the link opens the default messaging app with the number and body pre-filled. The main implementation detail in n8n is URL-encoding the message body correctly before constructing the link — use a Code node to run `encodeURIComponent(message)` on the Claude-generated SMS draft before building the `sms:` URL. Benefit: agent stays in the loop for the actual send (trust, compliance, personal touch) without having to draft anything. Tradeoff: adds one manual step vs. full automation. Could be an opt-in mode per agent — "auto-send" vs. "review in Slack first." Applies to: instant lead response, open house follow-up, any outbound SMS in the nurture sequence.

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
- [ ] **End-to-end workflow tests — research and build:** Playwright tests cover the HTML forms in isolation but not the full pipeline. Need e2e tests that verify the complete path: webhook → n8n → Claude → SendGrid → email received and accurate. Phase 1 (now): send a POST request to each n8n webhook with a known test payload and assert that the correct email was sent and the content is accurate (right recipient, expected fields present, no hallucinated data). Phase 2 (when COS is built): send a message to the chief of staff and assert the downstream email was triggered correctly — tests the full path from agent intent through LangGraph → n8n → SendGrid. Start with the listing description workflow as the pilot (highest complexity, most fields to verify).
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
