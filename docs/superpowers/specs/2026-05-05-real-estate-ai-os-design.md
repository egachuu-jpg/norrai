# Real Estate AI Operating System — Design Spec

**Date:** 2026-05-05
**Tier:** Pro ($3–6k build fee, $2–2.5k/mo)
**Status:** Approved design, not yet implemented

---

## Overview

An AI-driven operating system for real estate agents who have no CRM and are managing leads in spreadsheets. Primarily invisible — AI runs in the background and surfaces timely, agent-approved outreach. Optional dashboard for agents who want visibility.

The product is the AI intelligence layer. Neon is the data store, n8n is the orchestration engine, Claude generates the action queue. The agent interacts with a morning digest and approves or edits drafts before anything sends.

**Build strategy:** Implement the full architecture (Option A), but start thin (Option C). Launch without Zillow/Facebook/Realtor.com integrations. Use CSV import + existing intake forms. Add integrations when a paying client requires them.

---

## Data Model

Extends the existing `leads` table in Neon with the following new columns:

| Column | Type | Notes |
|--------|------|-------|
| `stage` | text | Real-estate pipeline position: `new`, `nurturing`, `active`, `under_contract`, `closed`, `dead`. Distinct from the existing `status` column, which tracks generic contact workflow state (`new`, `contacted`, `nurturing`, `converted`, `dead`). `stage` is the agent-visible pipeline; `status` is the internal automation state. |
| `last_contacted_at` | timestamptz | Updated by n8n after any outreach |
| `next_action_due` | date | Set by Claude after each run; scheduler queries this |
| `notes` | text | Free text; agent can add context |

`assigned_agent_email` is not needed — leads already carry `client_id`, and the agent's email is `clients.primary_contact_email`. All queries use the join.

**Schema migration also required on `workflow_events`:** add a nullable `lead_id uuid REFERENCES leads(id)` column. This allows interaction history to be queried per lead when building Claude's context. n8n workflows that create `workflow_events` rows for lead-related actions must populate this column going forward.

---

## Lead Ingestion

Three intake paths, all normalizing to the same `leads` table shape.

### CSV Import (onboarding)
- Agent-facing HTML page (Polar Modern, token-protected)
- Agent uploads spreadsheet; n8n Code node parses, maps columns to schema, dedupes on email + phone, inserts into Neon
- One-time for onboarding; re-runnable for updates
- Requires a light column-mapping step at the UI layer (agent identifies which column is name, email, phone, etc.)

### Existing Intake Forms (ongoing)
- `lead_response.html`, `open_house.html`, `nurture_enroll.html` already fire n8n webhooks
- Add a Neon insert node to each existing workflow — minimal change
- New leads auto-land in the database with `source` set appropriately

### Zillow / Facebook / Realtor.com (Phase 2 — stub only)
- `source` field reserves the values; no integration built yet
- When a client requires it: each is a new n8n webhook → normalize → dedupe → insert path
- Do not build until a paying client forces it

**Dedupe logic:** email + phone lookup before insert. Existing lead → update record, stop. New lead → insert with `stage: new`.

---

## AI Action Queue

The core intelligence. Runs nightly via n8n scheduled trigger.

### Who gets surfaced
Query Neon for leads where:
- `next_action_due <= today`
- `stage` NOT IN (`closed`, `dead`)
- `client_id = [agent's client record]`

Max 10 leads per agent per run to keep the digest manageable.

### What Claude receives (per lead)
- Name, stage, source
- Days since last contact (`last_contacted_at`)
- Any agent notes
- Last 2–3 entries from `workflow_events` for this lead

### What Claude outputs (per lead)
- Recommended action: `send_email`, `send_sms`, or `call_suggested`
- Draft message (for email or SMS actions)
- One-line reason ("Sarah went cold after open house follow-up 18 days ago")
- Suggested `next_action_due` date

### After the run
- n8n writes `next_action_due` back to Neon for each lead
- If agent skips an action, a webhook bumps `next_action_due` forward 3 days

---

## Agent Interaction

### Morning Digest Email
Sent via SendGrid after the action queue runs. Contains:
- Brief intro: "Here are your X follow-ups for today"
- One card per lead: name, stage, days since contact, Claude's reason, draft message
- Three buttons per card: **Send**, **Edit**, **Skip**

### Approval Mechanism
Each button is a tokenized URL pointing to an n8n webhook:
- **Send** — fires the draft as-is via Twilio (SMS) or SendGrid (email); updates `last_contacted_at` and `next_action_due` in Neon
- **Skip** — bumps `next_action_due` forward 3 days; no message sent
- **Edit** — opens a Polar Modern HTML page pre-populated with the draft; agent edits and submits; same send + Neon update path

Token scopes the action to a specific lead + draft. No app login required.

### Delivery Preference
Set at onboarding, stored in `clients` table:
- Email digest only
- SMS nudge ("You have 5 follow-ups ready — [link]") + digest accessible via link
- Both

### Dashboard (Phase 1 — read-only stub)
Simple Polar Modern HTML page showing:
- All leads for this agent, sorted by `next_action_due`
- Stage, last contacted date, source
- No actions — visibility only

Phase 2 promotes the dashboard to a full action interface (approve/edit/skip inline, pipeline drag-and-drop, performance metrics).

---

## Phase 2 Path

When the system is live and a client is paying, add in order:

1. **Zillow / Facebook Lead Ads / Realtor.com webhooks** — triggered by client need, not speculation
2. **Dashboard actions** — approve/edit/skip from the dashboard, not just the email
3. **SMS nudge delivery option** — simple Twilio message with tokenized link to digest
4. **AI escalation logic** — if a lead has been skipped 3+ times, Claude flags it differently ("This lead may be worth a call")
5. **Agent-configurable cadence** — let agents adjust how aggressive the AI is per lead stage

---

## Pricing

| Component | Amount |
|-----------|--------|
| Build fee | $3,000–6,000 (depending on Phase 1 scope) |
| Monthly retainer | $2,000–2,500 |

First client may be discounted in exchange for feedback and case study.

---

## What This Is Not

- Not a full CRM with calendar, document storage, transaction management, or MLS integration
- Not full autopilot — the agent approves every message in Phase 1
- Not a competing product to Follow Up Boss or kvCORE — it's an AI layer for agents who haven't committed to a CRM yet
