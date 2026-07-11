# Norr AI — Project Context

## What This Is

Norr AI is an AI automation agency targeting local businesses in Faribault and southern Minnesota. Built and operated by Egan. The name has quiet Scandinavian/regional roots — credible locally, scalable nationally.

- **Domain:** norrai.co · **Site is live at `tools.norrai.co`** (Cloudflare Pages custom domain), not the apex — all external links in workflows/emails must use `tools.norrai.co`
- **Primary + automation email:** hello@norrai.co (SendGrid verified sender)
- **Business setup (as of 2026-07):** LLC filed with MN SOS (pending), EIN obtained, Relay banking (pending), Google Workspace active

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
| Neon (Postgres) | Connective tissue between Tier 1 and Tier 2 — project `norrai` (ID `gentle-hill-54285247`), Postgres 17, `us-east-1`, db `neondb`, branch `main`; pooled `DATABASE_URL` in `.env` |
| Claude Code | Custom Tier 3 builds |
| Cloudflare Pages | Main site hosting for `tools.norrai.co` (build output dir: `website`) |
| Cloudflare Workers | Per-client static sites — one Worker per client under `client-sites/<slug>/`, deployed with `npx wrangler deploy` (config in that dir's `wrangler.jsonc`) |
| Cloudflare Access | Auth for agent-facing forms (`clients` group 7-day session, `internal` group 1-day) |

---

## Target Verticals

Norr AI serves any local or regional business with repetitive client communications, scheduling, or data workflows: 🏡 Real estate · 🦷 Dental · 👁️ Eye clinics · ✂️ Salons/barbershops · ⛳ Golf courses · 🌿 Greenhouses/nurseries · 🔧 Plumbers/electricians · 🏗️ Construction · 🛡️ Insurance · 💆 Spas/wellness · 🐾 Veterinary · 🚗 Auto repair · 🏋️ Gyms · 🌄 Landscaping.

### Verticals with detailed playbooks

**Dental** — Starter pitch: no-show math. Workflows: appointment reminders, missed appointment follow-up, review requests, missed call → SMS, new patient intake. Growth anchor: dormant patient reactivation. Pro: Dentrix/Eaglesoft pipeline → production dashboard.

**Real Estate** — Starter pitch: speed-to-lead. Workflows: instant lead response (Claude personalizes by listing), 7-touch cold nurture, missed call → SMS, listing description generator, open house follow-up. Growth anchor: sphere of influence re-engagement. Pro: MLS feed, deal velocity dashboard, lead scoring.

**Insurance** — Starter pitch: renewal math. Workflows: renewal reminders (90/60/30/7 days), post-renewal thank you + review request, lapsed win-back, quote request response, missed call → SMS. Growth anchor: cross-sell campaign. Pro: book-of-business pipeline, retention risk scoring.

---

## Architecture Decisions

- Own the infrastructure from day one: Twilio numbers, Postgres, n8n instance. Client pays for the service — Norr AI owns the stack.
- All Tier 1 n8n workflows write events to Postgres so Tier 2 inherits clean history.
- Transition framing when upgrading a client: "we expanded the system" not "we rebuilt everything." Run Tier 1 and Tier 2 in parallel for 2–4 weeks during upgrade — zero downtime.
- Cloudflare Access is the real auth layer for agent-facing forms; the workflow Token Check is a secondary CSRF guard, **not** real security.

**Lead Cleansing Architecture:** A staging layer sits between all intake sources and downstream nurture workflows. Every intake source normalizes to a single payload shape before hitting the cleansing workflow:

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

Hard-won gotchas (expression quirks, node behavior, deploy pitfalls) live in `docs/lessons-learned.md`. The durable operating rules:

- Always use `/webhook/` production path, NOT `/webhook-test/`, for live clients.
- Timezone: n8n Cloud runs UTC. Use `America/Chicago` with `hour12: false` for Central time.
- Business hours IF node: two separate conditions (`>= 8` AND `< 17`), not a single JS expression.
- Twilio: one master account, one subaccount per client.
- Multiline Claude prompts: build in a Set node first, pass as a single `$json.prompt` variable to the HTTP Request.
- `continueOnFail` / `onError: continueRegularOutput` belongs on **logging/lookup nodes only** — never on a send/action node (SendGrid, Twilio), where it turns a hard failure into a silent no-op.

### Workflow Logging Standard

Every workflow logs `triggered`, `completed`, and `failed` to `workflow_events` in Neon (powers the dashboard red/yellow/green health logic per client). The `workflow_name` registry lives in **`n8n/README.md`**.

**Node pattern (add to every workflow):**

1. **Lookup Client** (Postgres, `continueOnFail: true`) — resolves `client_id` by workflow group:
   - Real estate webhooks: `SELECT id FROM clients WHERE primary_contact_email = '{{ $json.body.agent_email }}'`
   - B&B workflows: hardcode `86a01b94-ddab-4594-8afc-8212fb18fdd0`
   - Internal/system + Lead Cleanser + misc: hardcode `e2f9934c-4d28-4bb4-ac90-4284c1123517` (norrai_internal) until per-client routing exists

2. **Log Triggered** (Postgres, `continueOnFail: true`) — fires right after Token Check:
   ```sql
   INSERT INTO workflow_events (client_id, workflow_name, event_type, payload)
   VALUES ($client_id, '$workflow_name', 'triggered',
     '{"execution_id": "{{ $execution.id }}", "agent_email": "{{ $json.body.agent_email }}"}'::jsonb)
   ```

3. **Log Completed** (Postgres, `continueOnFail: true`) — fires at the successful end:
   ```sql
   INSERT INTO workflow_events (client_id, workflow_name, event_type, payload)
   VALUES ($client_id, '$workflow_name', 'completed',
     '{"execution_id": "{{ $execution.id }}"}'::jsonb)
   ```

4. **Error Workflow setting** — every workflow's Settings → Error Workflow must point to `Norr AI Workflow Error Logger`, which logs the `failed` event automatically.

All logging nodes use `continueOnFail: true` — logging failures never break the main workflow.

---

## Project Structure

```
website/       # Main tools.norrai.co site → Cloudflare Pages. Public pages at root;
               # clients/ and internal/ gated by Cloudflare Access. Styles in css/norrai.css.
client-sites/  # Per-client static sites, one dir per client (e.g. 507-air/), each
               # deployed as its own Cloudflare Worker via `npx wrangler deploy`.
db/            # schema.sql (canonical — apply with psql -f) + README.md
n8n/           # workflow JSON exports + README (workflow_name registry) + testing docs
tests/         # Playwright specs (one per tested HTML page)
PRD/           # product specs (e.g. research-agent.md)
docs/          # lessons-learned, workflows-built, ideas, roadmap, client notes
```

Full page inventory and Cloudflare Access grouping: see the `website/` directory and `docs/lessons-learned.md § Cloudflare Access`.

---

## Brand — Polar Modern

All HTML uses this design system:

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

When creating a new Polar Modern page, copy the full `:root` block from an existing page in the same directory — partial copies silently omit canonical tokens.

---

## Testing

**Stack:** Playwright (`npm test`). One spec file per tested HTML page in `tests/`. **All tests must pass before pushing.**

### Rules
- Run `npm test` before pushing any code change.
- When adding functionality to a tested file, add tests for it first (or alongside). Don't ship new form fields, JS behavior, or payload changes without coverage.
- When editing a file with no test file, create one, scoped to its risk level (below).
- Follow the patterns in `tests/listing_form.spec.js`: `fillRequired()` + `mockWebhook()` helpers, `Promise.all` for request interception, wait for UI state before asserting async side effects like localStorage.

### Risk-based coverage

| Risk | File type | Minimum coverage |
|------|-----------|-----------------|
| **High** | Forms that submit to a webhook (listing_form, event_ops_discovery) | Full: required fields, type enforcement, payload shape, localStorage, UI states, security header |
| **Medium** | Marketing/vertical pages with interactive JS | Key interactions, nav links resolve, no JS errors on load |
| **Low** | Static display pages, no JS (brand_concepts, style_guide) | Smoke test: loads, title correct, no console errors |

Forms that touch the n8n → Claude → SendGrid pipeline are **high risk** — bad data produces silent failures with real cost (API calls, emails sent). Test them thoroughly.

---

## Sales Principles

- Lead with ROI in the client's language, never with technology. Dentists think in appointment values. Realtors think in GCI. Insurance brokers think in retained premium.
- Never lead with n8n, Claude, or "automation."
- Salesforce positioning for insurance: "we complete Salesforce, not compete with it."
- Key insurance qualifying question: "If I told you there were clients about to leave at renewal and you don't know who they are — what would it be worth to find out in advance?"

---

## Database

**Neon** — project `norrai` (`gentle-hill-54285247`), Postgres 17. Canonical schema in `db/schema.sql` (apply with `psql <conn> -f db/schema.sql`); table overview + smoke queries in `db/README.md`.

| Table | Purpose |
|-------|---------|
| `clients` | NorrAI client businesses — tier, vertical, status, contact info |
| `service_contracts` | Billing history per client |
| `twilio_subaccounts` | One Twilio subaccount + phone number per client |
| `norrai_meetings` | NorrAI's own discovery/onboarding/check-in calls |
| `leads` | End-customer leads across all verticals; vertical-specific fields in `metadata` jsonb |
| `appointments` | End-customer appointments; reminder/follow-up/review-request timestamps |
| `workflow_events` | Audit log of every n8n workflow trigger/completion/failure |
| `stories` / `tasks` | Mission Control — project tasks (status CHECK on stories: `active｜paused｜done｜cancelled`) |
| `research_cache` | Research Agent cache, 7-day TTL by address |

**Vertical-specific lead fields** go in `leads.metadata` jsonb — e.g. real estate `{property_address, price_range, beds}`, insurance `{policy_type, renewal_date, current_carrier}`, dental `{procedure_type, insurance, last_visit}`.

Notes: `run_sql` (Neon MCP) is one statement per call. `leads` has no UNIQUE on `(client_id, email)` — dedupe with SELECT-then-conditional-INSERT/UPDATE, not `ON CONFLICT`.

---

## Pointers

- **Tasks / status:** tracked in Neon (`stories` + `tasks`), not here — `SELECT t.title, t.status, t.priority, s.title AS story FROM tasks t LEFT JOIN stories s ON t.story_id = s.id ORDER BY t.priority, t.seq;`
- **Lessons learned:** `docs/lessons-learned.md` (n8n, SendGrid, Gemini, prompt engineering, Cloudflare Access, HTML/JS, Playwright, BoldTrail, Zapier, architecture)
- **Workflows built + status:** `docs/workflows-built.md`
- **Workflow name registry:** `n8n/README.md`
- **Ideas / parking lot:** `docs/ideas.md`
- **Roadmap:** `docs/Norr AI — 6 Month Roadmap.md`
- **Session history:** `SESSION_LOG.md`

---

## About the Owner

Egan is a data engineer working primarily with dbt and SQL Server. Comfortable with technical implementation. Norr AI is a side business being built from scratch.

---

## Session Wrap-Up

When the user says **"donezo"** or **"wrap up"**, run the `/session-end` skill. It appends a dated entry to `SESSION_LOG.md`, extracts new lessons to `docs/lessons-learned.md`, and commits both.

**Additional step — update Neon tasks (before committing):**
- Review what was completed this session.
- `UPDATE tasks SET status = 'completed', updated_at = NOW() WHERE title = '...'` for each finished task.
- If a story's tasks are all done: `UPDATE stories SET status = 'done' WHERE id = '...'` — the `stories` CHECK constraint is `active｜paused｜done｜cancelled`; it rejects `completed`.
- Use the Neon MCP tool to execute these directly.
