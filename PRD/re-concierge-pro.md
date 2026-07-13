# Real Estate Concierge — Pro-Tier Engagement (Design Doc)

**Date:** 2026-07-12
**Status:** Approved design — **build starts only when a real estate client signs a Pro contract** (reaffirms the 2026-05-07 decision: no speculative build)
**Supersedes:** `PRD/real estate chief of staff prd.docx` (v0.1 draft, May 2026)
**Depends on:** `PRD/cos-v2-internal.md` shipped through step 3 (the pending-action layer and identity threading are prerequisites)

---

## 1. Context & Decision

The May 2026 Real Estate Chief of Staff PRD described a venture-scale SaaS
product: 6 specialist agents, Follow Up Boss/HubSpot/kvCORE integrations,
DocuSign, Buffer/Later, MLS feeds, per-seat pricing, and a multi-agent beta.
Evaluated 2026-07-12 and rejected in that form:

- It re-litigates the 2026-05-07 decision ("implement when a real estate
  agent client commits — not speculatively") without new evidence.
- It requires Slack adoption from realtors who demonstrably live in SMS —
  Norr AI's actual real estate users (Weichert agents) interact via HTML
  forms, email, and SMS today.
- The substance of its Lead/Marketing/Content agents is **already running in
  production** as n8n workflows (instant lead response, 7-touch nurture,
  research agent, weekly drip, review requests). What's missing is only the
  conversational front-end.

**The decision:** reframe it as a **Pro-tier service deliverable**, built
per-client on existing rails. One agent (the same `cos/` service, made
multi-tenant), SMS-first, scoped to that client's data, fronting the
workflows Norr AI has already built. The paying client's contract funds the
build; their stack answers the CRM question (BoldTrail, per existing intake
work). Sales framing per CLAUDE.md: *"we expanded the system,"* not a new
product.

### What this is

A dedicated phone number (and optionally Slack) the agent texts like a human
assistant:

> **Agent:** what came in overnight?
> **Bot:** 3 new leads. Hottest: Sarah Johnson (Zillow, $250–320k, 3bd,
> pre-approved — score 9). Want a draft reply?
> **Agent:** yes
> **Bot:** *[draft SMS]* — reply "send it" to text her from your number, or "cancel".
> **Agent:** send it
> **Bot:** Sent. Logged to her record. She's not in nurture — enroll her?

### What this is not

- Not a multi-agent platform. Not a CRM replacement. Not self-serve SaaS.
- No DocuSign, no social scheduling, no MLS feed, no mobile app (v1 out-of-scope list from the old PRD stands, plus its CRM/contract/marketing integrations).

---

## 2. Packaging & Prerequisites

### 2.1 Commercial shape

| Item | Value |
|---|---|
| Tier | Pro — $2,000–2,500/mo + $3,000–6,000 build fee (existing rate card) |
| Included | Concierge number + bot, all underlying Tier-1/2 workflows for that client, monthly usage report |
| Positioning | "Your AI assistant on a phone number" — never "multi-agent Slack bot" (Sales Principles: lead with ROI, GCI language) |
| Upgrade path | Existing Growth client → "we expanded the system"; run old + new in parallel 2–4 weeks (CLAUDE.md architecture rule) |

### 2.2 Hard prerequisites before writing any code for a client

1. Signed Pro contract → row in `service_contracts`.
2. `clients` row active, `primary_contact_email` set — **this exact email is
   the identity key for nurture enrollment** (SESSION_LOG 2026-06-22: the
   Cold Nurture enrollment re-check silently skips when `agent_email` ≠
   `clients.primary_contact_email`).
3. Twilio subaccount + local number provisioned → `twilio_subaccounts` row
   (one subaccount per client — CLAUDE.md standard).
4. `cos-v2-internal.md` steps 1–3 deployed (allowlist, identity threading,
   pending-action layer).
5. Inventory of which n8n workflows are live for this client (webhooks the
   concierge may call, from the `n8n/README.md` registry).

---

## 3. Architecture

**One service, two roles.** The Railway `cos/` service gains a tenant layer.
No second deployment, no n8n orchestrator, no sub-agents.

```
Inbound (Slack DM | SMS to concierge number)
  → main.py: resolve identity → {role, client_id, display_name, agent_email}
      role = internal  → Egan's toolset (cos-v2-internal.md), unscoped
      role = client    → concierge toolset, every query bound to client_id
      unknown          → silently ignored (fail closed)
  → pending-action gate (same keyword machine as internal)
  → agent.run_turn(history, text, identity) → Claude + role-filtered tools → Neon / n8n webhooks
```

### 3.1 Identity resolution — migration `007_concierge_users.sql`

```sql
-- Who may talk to the COS service, and as whom.
-- Replaces the env-var allowlist as the single source of identity
-- (migrate Egan's Slack ID / phone into rows with role='internal').

CREATE TABLE concierge_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid REFERENCES clients(id),   -- NULL for role='internal'
  role          text NOT NULL CHECK (role IN ('internal', 'client')),
  channel       text NOT NULL CHECK (channel IN ('slack', 'sms')),
  identity      text NOT NULL,                 -- Slack user ID or E.164 phone
  display_name  text,
  agent_email   text,                          -- must equal clients.primary_contact_email for nurture ops
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, identity)
);

CREATE INDEX idx_concierge_identity ON concierge_users(channel, identity) WHERE active;

ALTER TABLE cos_pending_actions
  DROP CONSTRAINT cos_pending_actions_action_type_check,
  ADD CONSTRAINT cos_pending_actions_action_type_check
    CHECK (action_type IN ('send_email', 'send_lead_sms', 'send_lead_email'));
```

Lookup in `main.py` (replaces the env allowlist check):

```sql
SELECT cu.role, cu.client_id, cu.display_name, cu.agent_email,
       c.business_name, ts.phone_number AS concierge_number,
       ts.subaccount_sid
FROM concierge_users cu
LEFT JOIN clients c ON c.id = cu.client_id
LEFT JOIN twilio_subaccounts ts ON ts.client_id = cu.client_id
WHERE cu.channel = %s AND cu.identity = %s AND cu.active
```

No row → drop the message (empty TwiML / bare 200). The resolved dict IS the
`identity` object threaded through `run_turn` → `_execute_tool`; **`client_id`
is never a model-visible or model-suppliable parameter.**

### 3.2 Inbound SMS routing

Each client's concierge number is on their Twilio subaccount, webhooked to the
same `/sms/inbound` endpoint. Two required changes to `main.py`:

1. **Signature validation per subaccount**: `RequestValidator` must use the
   **subaccount's** auth token, not the master token. Resolve the recipient
   number (`To` field) → `twilio_subaccounts` → fetch that subaccount's auth
   token. Store per-subaccount tokens in a new column
   `twilio_subaccounts.auth_token_encrypted` following the existing PII
   encryption pattern (`db/migrations/002_pii_encryption.sql`), or validate
   with the master token if the number is webhook-configured at the master
   level — **implementer must check which account owns the webhook config and
   validate with that account's token; test with a real inbound before
   go-live.**
2. Session key: already `(user_id=From, channel='sms')` — unchanged and
   naturally tenant-separate.

### 3.3 Role-filtered tools

In `agent.py`, tag each tool with roles and filter at call time:

```python
TOOLS = [
  {"spec": {...}, "roles": {"internal"}, "fn": ...},          # existing internal tools
  {"spec": {...}, "roles": {"client"}, "fn": ...},            # concierge tools below
  {"spec": {...}, "roles": {"internal", "client"}, "fn": ...} # shared (none in v1)
]
def tools_for(role): ...
```

`run_turn` selects the system prompt and tool list by `identity["role"]`.

---

## 4. Concierge Toolset (role = client)

Every SQL below binds `client_id` from the identity object — first parameter,
always. Tools live in a new `cos/concierge_tools.py`.

### 4.1 `my_leads` (auto-execute)

"What came in overnight / this week? Who are my hottest leads?"

```json
{
  "name": "my_leads",
  "description": "List this agent's leads. Filter by recency and/or status. Returns name, source, status, score (if scored), property interests, and last activity. Newest first.",
  "input_schema": {
    "type": "object",
    "properties": {
      "hours": {"type": "integer", "description": "Lookback in hours; omit for all open leads"},
      "status": {"type": "string", "enum": ["new", "contacted", "qualified", "nurturing", "converted", "unenrolled", "dead"]},
      "min_score": {"type": "integer", "description": "Only leads scored at or above this (1-10)"},
      "limit": {"type": "integer", "description": "Default 10 (SMS-friendly)"}
    },
    "required": []
  }
}
```

```sql
SELECT l.id, l.lead_name, l.email, l.phone, l.source, l.status,
       l.lead_message, l.metadata, l.nurture_enrolled_at,
       l.sms_opt_out, l.email_opt_out, l.created_at
FROM leads l
WHERE l.client_id = %(client_id)s
  AND (%(hours)s IS NULL OR l.created_at > now() - interval '1 hour' * %(hours)s)
  AND (%(status)s IS NULL OR l.status = %(status)s)
  AND (%(min_score)s IS NULL OR (l.metadata->>'score')::int >= %(min_score)s)
ORDER BY (l.metadata->>'score')::int DESC NULLS LAST, l.created_at DESC
LIMIT %(limit)s
```

Return per-lead: full uuid `id` (needed by every action tool), plus the
real-estate metadata keys (`property_address`, `price_range`, `beds`, `score`,
`score_reason`) when present. Include `sms_opt_out`/`email_opt_out` so the
model knows a channel is closed **before** drafting into it.

### 4.2 `lead_detail` (auto-execute)

Single lead by id or name search (scoped): the `my_leads` SQL with
`AND (l.id = %(lead_id)s OR l.lead_name ILIKE '%%' || %(name)s || '%%')`,
plus that lead's recent `workflow_events` (nurture touches, responses) if the
payload carries the lead's email — best-effort, return empty history rather
than erroring.

### 4.3 `run_research` (auto-execute — internal cost, no client-facing output until agent forwards it)

Fronts the live Research Agent (`docs/workflows-built.md`):
`POST https://norrai.app.n8n.cloud/webhook/research-agent` with header
`X-Norr-Token: $NORR_TOKEN`, body
`{address, city, state, zip, price_range, beds, baths, caller: "cos_concierge", client_id}`
(`client_id` injected from identity, not model input). 7-day cache is server-side.
Return the response's `insight_block`, `walkability`, `schools`, `market`,
`data_confidence` — the model summarizes for SMS. Timeout 90s; on timeout
reply that research is still running and will need to be re-asked (v1: no
async callback).

### 4.4 `enroll_nurture` (draft + approve — it triggers 7 outbound touches)

Fronts Cold Nurture enrollment: `POST .../webhook/cn-enroll`, header
`X-Norr-Token`, body must include `agent_email` = identity's `agent_email` and
`agent_token` = `clients.token` (fetch server-side by `client_id`; **never**
in the model context). Per SESSION_LOG 2026-06-22/24: enrollment silently
skips if `agent_email` mismatches, so validate `agent_email ==
clients.primary_contact_email` at tool-execution time and return a hard error
if not.

Staged like email: tool `stage_nurture_enrollment(lead_id)` → pending action →
"send it" fires the webhook. Refuse to stage if the lead has
`communication_opted_out`, `sms_opt_out` AND `email_opt_out`, or
`nurture_enrolled_at` already set (return the reason; the model relays it).

### 4.5 `stage_lead_sms` / `stage_lead_email` (draft + approve)

The core loop: draft a reply to a lead, agent approves, message goes out
**from the client's own number/identity**.

```json
{
  "name": "stage_lead_sms",
  "description": "Stage an SMS to one of this agent's leads, sent from the agent's business number. Compose the message yourself (under 320 chars, warm, no AI-speak, sign with the agent's first name). NOT sent until the agent replies 'send it'. Refuse leads who opted out of SMS.",
  "input_schema": {
    "type": "object",
    "properties": {
      "lead_id": {"type": "string", "description": "Lead uuid from a prior my_leads/lead_detail call"},
      "body": {"type": "string"}
    },
    "required": ["lead_id", "body"]
  }
}
```

Staging validation (server-side, in the tool function — not trusted to the model):
- lead exists AND `lead.client_id == identity.client_id` (404 otherwise — this
  is the tenant boundary; a lead_id from another client must be
  indistinguishable from a nonexistent one)
- `sms_opt_out = false` (or `email_opt_out` for the email variant) — hard refuse
- payload stored: `{lead_id, to_phone, body, from_number: concierge/agent number}`

Execution on "send it":
- SMS: Twilio API **via the client's subaccount SID** (`twilio_subaccounts`),
  `From` = the client's number. Non-2xx ⇒ `failed`, surfaced — never swallowed.
- Email: SendGrid, `From` = hello@norrai.co with reply-to = agent's email
  (v1; per-client verified senders are a later upgrade).
- On success: `UPDATE leads SET status = CASE WHEN status='new' THEN 'contacted' ELSE status END, updated_at=now()`
  and INSERT a `workflow_events` row (`workflow_name='cos_concierge'`,
  `event_type='completed'`, payload `{action:'lead_sms', lead_id}`) so
  concierge activity shows in the client-health dashboard like every other
  workflow. Register `cos_concierge` in `n8n/README.md`.

### 4.6 Deferred hooks (phase 2+, when those workflows ship)

The CMA (`cma-tool.md` § Chief of Staff Integration), Buyer Briefing
(`buyer-briefing.md`), and lead-scoring query hooks
(`lead-scoring-at-intake.md` § Chief of Staff Integration) were all written
anticipating this front-end. Each becomes one more webhook-fronting tool in
`concierge_tools.py` following the `run_research` pattern. Do not build them
until the underlying workflow is live.

---

## 5. Concierge System Prompt

Separate prompt template in `agent.py`, formatted per-turn with identity:

```
You are {display_name}'s assistant at {business_name}, provided by Norr AI.
You help with leads, follow-ups, and property research over text message.

Rules:
- Plain text only, short — this is usually SMS. Lists of 3-5 max.
- You only see {business_name}'s data. If asked about anything else, say you
  don't have access.
- Drafted messages to leads are ALWAYS staged for approval — after staging,
  show the full draft and say: reply "send it" or "cancel".
- Never draft to a lead who has opted out of that channel — say so instead.
- Property/neighborhood content: facts only — no commentary on the people,
  demographics, safety, or "kind of neighborhood" (fair housing). The
  research tool's output is pre-filtered; do not add your own color.
- You are an assistant, not the agent. Never negotiate price, give legal
  advice, or make commitments on {display_name}'s behalf.
```

Approval tiers (same machine as internal):

| Tier | Concierge actions |
|---|---|
| Auto-execute | `my_leads`, `lead_detail`, `run_research` |
| Draft + approve | `stage_lead_sms`, `stage_lead_email`, `stage_nurture_enrollment` |
| Always human (no tool exists) | Offers, contracts, pricing advice, anything to a non-lead third party |

---

## 6. Safety & Compliance Checklist

These are acceptance criteria, not suggestions:

1. **Tenant isolation:** every `concierge_tools.py` query takes `client_id`
   as its first bound parameter sourced from the identity object. A test must
   prove a client-role session cannot retrieve another client's lead by uuid.
2. **Opt-out enforcement at execution time** (not just staging — re-check
   inside `execute_pending` in case the flag flipped between stage and approve).
3. **No silent send failures:** Twilio/SendGrid non-2xx ⇒ `status='failed'`
   + error in the reply (the `continueOnFail` lesson, enforced in code).
4. **Secrets out of model context:** `clients.token`, subaccount SIDs/tokens,
   and `NORR_TOKEN` are fetched inside tool functions; they never appear in
   tool results, prompts, or conversation history.
5. **Fair-housing guard:** research output passes through the existing
   compliance filter server-side (Research Agent already does this); the
   system prompt forbids the model adding neighborhood commentary.
6. **A2P 10DLC:** the client's subaccount campaign registration must cover
   conversational agent-to-lead traffic before go-live (registration was
   already required for the tier-1 workflows; verify it, don't assume).

---

## 7. Client Onboarding Runbook (repeat per Pro client)

1. `clients` row active; verify `primary_contact_email` + `token`.
2. Provision/verify Twilio subaccount + local number → `twilio_subaccounts`;
   point the number's inbound-SMS webhook at `https://<railway-url>/sms/inbound`.
3. INSERT `concierge_users` rows: one per channel the client will use
   (`role='client'`, their cell phone as `identity` for SMS; Slack ID if they
   opt into Slack). Set `agent_email` = `clients.primary_contact_email`.
4. Confirm which webhook-fronting tools are enabled (which workflows are live
   for this client) — v1: a `COS_CLIENT_FEATURES` check is **not** built;
   all client tools ship enabled, and `run_research`/`enroll_nurture` fail
   gracefully if the backing workflow rejects the client token.
5. Smoke: text "what are my leads?" from the client's phone → correct,
   tenant-scoped answer; stage+cancel one SMS; stage+send one SMS to a Norr
   AI test lead (`norrai_internal` client has reversible test leads — see
   SESSION_LOG 2026-07-11 pattern).
6. Walk the client through: send it / cancel keywords, 60-minute draft expiry,
   "the bot never texts your leads without your ok."

---

## 8. Build Plan

Total: ~2–3 weeks of side-project time, started only post-signature. Build
fee covers it at the existing rate card.

| Step | Scope | Done when |
|---|---|---|
| 1 | Migration 007; identity resolution replaces env allowlist; Egan migrated to `role='internal'` rows | Internal bot works exactly as before; unknown senders dropped |
| 2 | Role-filtered TOOLS + concierge system prompt + `my_leads`/`lead_detail` | Test `concierge_users` row (Egan's phone, pointed at `norrai_internal` client) gets scoped answers; cross-tenant uuid probe returns not-found |
| 3 | `stage_lead_sms`/`stage_lead_email` + subaccount send + opt-out enforcement + `workflow_events` logging | Full loop against a test lead: draft → send it → SMS received from client number → lead status flipped → event logged |
| 4 | `run_research` + `stage_nurture_enrollment` webhook fronts | Research answers in-thread; enrollment fires `/webhook/cn-enroll` and the lead parks in Wait Day 1 |
| 5 | Compliance test suite (§6 items as pytest cases) + onboarding runbook executed for the real client | All §6 criteria pass; client texting the bot in production |

## 9. Out of Scope (v1) — unchanged from the old PRD, plus

CRM two-way sync (BoldTrail stays CSV-import one-way) · DocuSign/contracts ·
social scheduling · MLS/RETS feeds · AVM · multi-language · voice · mobile app ·
per-client SendGrid verified senders · async research callbacks · Slack Block
Kit buttons · multi-seat teams (one `concierge_users` row per person is
technically possible but unsupported/untested in v1).

## 10. Open Questions (to resolve with the first signed client)

1. Master vs subaccount webhook token for Twilio signature validation (§3.2) — determined by where the number's webhook is configured; resolve during onboarding step 2.
2. Does the client want Slack at all, or SMS-only? (Default assumption: SMS-only.)
3. Monthly usage report format — start as a manual query, productize later.
