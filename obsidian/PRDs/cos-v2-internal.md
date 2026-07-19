# COS v2 — Internal Chief of Staff (Design Doc)

**Date:** 2026-07-12
**Status:** Approved design, ready to implement
**Supersedes:** `obsidian/PRDs/norr ai chief of staff prd.docx` (v0.1 draft, May 2026)
**Builds on:** the deployed `cos/` FastAPI service (Railway) — this is an extension, not a rewrite

---

## 1. Context & Decision

The May 2026 internal Chief of Staff PRD specified a 6-agent n8n orchestration
(Client / Outreach / Proposal / Finance / Content / Knowledge agents) with a
4-week build and a new parallel data model. That design was evaluated and
rejected on 2026-07-12:

- The multi-agent-in-n8n architecture multiplies n8n's known failure surfaces
  (see `docs/lessons-learned.md`) for zero capability gain at this scale.
- Its data model (`projects`, `invoices`, `knowledge_base`, `outreach_log`)
  duplicates existing tables (`stories`/`tasks`, `service_contracts`,
  `clients`, `workflow_events`).
- Drafting/knowledge work (proposals, LinkedIn posts, pricing questions) is
  already better served by Claude Code sessions with full repo + Neon context.

**The decision:** grow the already-deployed single-agent service in `cos/`
(one Claude call, a tool loop, ~400 lines of Python) one tool at a time. The
Slack/SMS bot owns what Claude Code can't do: reach Egan away from his desk
with monitoring, pipeline answers, quick approvals, and a weekly digest.

### What exists today (do not rebuild)

| Piece | Location | State |
|---|---|---|
| FastAPI app: Slack Events + Twilio SMS webhooks, signature verification, async Slack handling | `cos/main.py` | Deployed on Railway |
| Agent loop: Claude `claude-sonnet-4-6`, `TOOLS` list, `_execute_tool` dispatch, 20-message history cap | `cos/agent.py` | Deployed |
| Tools: `check_client_health`, `get_workflow_errors` (Neon queries) | `cos/tools.py` | Deployed |
| Session persistence keyed `(user_id, channel)` | `cos/db.py`, `cos_sessions` table (`db/migrations/003_cos_sessions.sql`) | Deployed |
| Env: `ANTHROPIC_API_KEY`, `DATABASE_URL`, `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Railway variables | Set |

---

## 2. Goals & Non-Goals

### Goals
1. Answer "what's on my plate?" from a phone — Mission Control (`stories`/`tasks`) readable and updatable by chat.
2. Answer "how's the business?" — pipeline summary across clients, contracts, leads, and workflow activity.
3. Draft-and-approve outbound email from chat — a follow-up drafted in Slack/SMS, approved with one reply, sent via SendGrid from hello@norrai.co.
4. Monday weekly digest pushed to Slack without being asked.
5. Lock the service down to Egan only (currently it answers any Slack DM user and any SMS sender).
6. Stay demo-ready: every feature here is shown live in sales calls as proof of the concierge pattern (see `obsidian/PRDs/re-concierge-pro.md`).

### Non-Goals
- No specialist sub-agents, no intent router. One agent, more tools.
- No new knowledge base table. Business facts live in the system prompt (small, curated) and Neon (queried).
- No invoice/finance tooling until there is invoice volume (`service_contracts` covers billing state for now).
- No LinkedIn/content generation in the bot — that stays in Claude Code.
- No Block Kit interactive buttons in v2. Conversational approval ("send it") works identically on SMS and Slack; buttons are a later polish item.

### Success criteria
- Task query, task update, pipeline summary, and draft→approve→send each work end-to-end from both Slack DM and SMS.
- Weekly digest arrives Mondays 8:00 AM Central.
- A non-allowlisted Slack user or phone number gets no agent response.

---

## 3. Architecture

Unchanged: `Slack DM / SMS → FastAPI (Railway) → run_turn() → Claude + tool loop → Neon`.

Three additions:

1. **Allowlist gate** in `main.py` before any agent call.
2. **Pending-action layer** for the draft+approve flow — deterministic keyword
   handling in `main.py` (NOT model-mediated), backed by a `cos_pending_actions`
   table.
3. **Cron endpoint** `/cron/weekly-summary`, fired by an n8n Schedule Trigger,
   composes the digest and posts it to Egan's Slack DM.

### 3.1 Approval model (carried over from the May PRD — the part worth keeping)

| Tier | Actions | Behavior |
|---|---|---|
| Auto-execute | Neon reads (health, errors, tasks, pipeline, leads); task status updates | Tool runs immediately |
| Draft + approve | Outbound email (SendGrid) | Tool **stages** the action; nothing sends until Egan replies with an approval keyword |
| Always human | Anything financial/contractual | Not implemented as tools at all |

### 3.2 Why approval is keyword-driven, not model-driven

If "execute the pending send" were a model tool, a misread turn could fire it.
Instead `main.py` intercepts the message **before** the agent when a pending
action exists:

```
inbound message
  → allowlist check
  → if pending action exists for (user_id, channel):
      message in APPROVE_WORDS → execute action, mark approved, reply with result
      message in CANCEL_WORDS  → mark cancelled, reply "Cancelled."
      anything else            → mark cancelled ("superseded"), fall through to agent
  → else: fall through to agent (run_turn)
```

- `APPROVE_WORDS = {"send", "send it", "yes", "approve", "ship it"}` (case-insensitive, stripped)
- `CANCEL_WORDS = {"cancel", "no", "don't send", "stop"}`
- Exactly **one** pending action per `(user_id, channel)` — staging a new one
  cancels the old one. This keeps "send it" unambiguous on SMS where there are
  no buttons.
- Pending actions expire after **60 minutes** (checked at read time; an expired
  action is treated as absent and marked `expired`).

---

## 4. Database Migration

`db/migrations/006_cos_pending_actions.sql` (also append to `db/schema.sql` —
schema.sql is canonical per `db/README.md`):

```sql
-- COS staged actions awaiting conversational approval
-- One live pending action per (user_id, channel); superseded rows keep history

CREATE TABLE cos_pending_actions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      text NOT NULL,               -- Slack user ID or E.164 phone
  channel      text NOT NULL CHECK (channel IN ('slack', 'sms')),
  action_type  text NOT NULL CHECK (action_type IN ('send_email')),
  payload      jsonb NOT NULL,              -- {"to": ..., "subject": ..., "body": ..., "context": ...}
  status       text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'cancelled', 'expired', 'failed')),
  result       jsonb,                       -- execution result or error detail
  created_at   timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz
);

CREATE INDEX idx_cos_pending_lookup
  ON cos_pending_actions(user_id, channel)
  WHERE status = 'pending';
```

`action_type` is a CHECK'd enum of one today; the RE concierge doc adds
`send_sms` later by widening the constraint.

---

## 5. New Tools

All tools live in `cos/tools.py` (queries) or `cos/actions.py` (new file —
staging + execution). Register each in `agent.py`'s `TOOLS` list and
`_execute_tool` dispatch, following the existing pattern exactly. All SQL uses
psycopg2 bound parameters — never string interpolation.

### 5.1 `query_tasks` (auto-execute)

Read Mission Control. Schema reference: `db/migrations/004_tasks_stories.sql`.

```json
{
  "name": "query_tasks",
  "description": "Query Norr AI Mission Control tasks in Neon. Returns open tasks grouped by story, ordered by priority then seq. Use when Egan asks what's on his plate, what's next, or about a specific task/story.",
  "input_schema": {
    "type": "object",
    "properties": {
      "status": {"type": "string", "enum": ["backlog", "ready", "in_progress", "agent_working", "review", "done"], "description": "Filter to one status. Omit for all non-done tasks."},
      "priority": {"type": "string", "enum": ["low", "medium", "high", "urgent"]},
      "search": {"type": "string", "description": "Partial match against task title"},
      "limit": {"type": "integer", "description": "Max rows, default 25"}
    },
    "required": []
  }
}
```

SQL core (compose WHERE clauses only for provided filters):

```sql
SELECT t.id, t.title, t.status, t.priority, t.category, t.seq,
       s.title AS story, c.business_name AS client
FROM tasks t
LEFT JOIN stories s ON s.id = t.story_id
LEFT JOIN clients c ON c.id = t.client_id
WHERE (%(status)s IS NOT NULL AND t.status = %(status)s
       OR %(status)s IS NULL AND t.status != 'done')
  AND (%(priority)s IS NULL OR t.priority = %(priority)s)
  AND (%(search)s IS NULL OR t.title ILIKE '%%' || %(search)s || '%%')
ORDER BY array_position(ARRAY['urgent','high','medium','low'], t.priority), t.seq NULLS LAST
LIMIT %(limit)s
```

Return `{"tasks": [...], "count": n}`. Include the task `id` (full uuid) in
each row — `update_task_status` needs it and the model must echo it back.

### 5.2 `update_task_status` (auto-execute — internal write, reversible)

```json
{
  "name": "update_task_status",
  "description": "Update one Mission Control task's status. Use only after query_tasks has surfaced the task id in this conversation. Valid statuses: backlog, ready, in_progress, agent_working, review, done.",
  "input_schema": {
    "type": "object",
    "properties": {
      "task_id": {"type": "string", "description": "Task uuid from a prior query_tasks result"},
      "status": {"type": "string", "enum": ["backlog", "ready", "in_progress", "agent_working", "review", "done"]}
    },
    "required": ["task_id", "status"]
  }
}
```

```sql
UPDATE tasks SET status = %s, updated_at = now()
WHERE id = %s
RETURNING id, title, status
```

Return the RETURNING row, or `{"error": "task not found"}` on zero rows.
Note for implementation: the `stories` CHECK constraint uses `done`, not
`completed` (see CLAUDE.md § Session Wrap-Up) — do NOT add a story-update tool
that guesses status values; story closure stays a Claude Code / session-end
concern.

### 5.3 `pipeline_summary` (auto-execute)

One tool, three queries, merged into a single dict. Use when Egan asks "how's
the business / pipeline / what's going on this week".

Query A — clients + active contracts (MRR):

```sql
SELECT c.business_name, c.vertical, c.tier, c.status,
       sc.monthly_price, sc.start_date
FROM clients c
LEFT JOIN service_contracts sc
  ON sc.client_id = c.id AND sc.status = 'active' AND sc.end_date IS NULL
WHERE c.status IN ('prospect', 'active')
ORDER BY c.status, c.business_name
```

Query B — lead flow last 7 days per client:

```sql
SELECT c.business_name, COUNT(*) AS new_leads,
       COUNT(*) FILTER (WHERE l.status = 'converted') AS converted
FROM leads l JOIN clients c ON c.id = l.client_id
WHERE l.created_at > now() - interval '7 days'
GROUP BY c.business_name ORDER BY new_leads DESC
```

Query C — workflow activity last 7 days:

```sql
SELECT c.business_name, we.event_type, COUNT(*) AS n
FROM workflow_events we JOIN clients c ON c.id = we.client_id
WHERE we.created_at > now() - interval '7 days'
GROUP BY c.business_name, we.event_type
```

Return shape:

```json
{
  "mrr": {"active_monthly_total": 0, "clients": [...]},
  "leads_7d": [...],
  "workflow_activity_7d": [...]
}
```

Compute `active_monthly_total` in Python as the sum of non-null
`monthly_price` over active clients.

### 5.4 `recent_leads` (auto-execute)

```json
{
  "name": "recent_leads",
  "description": "List recent leads across clients. Use when Egan asks about new leads, overnight leads, or a specific client's leads.",
  "input_schema": {
    "type": "object",
    "properties": {
      "client_name": {"type": "string", "description": "Partial client business name"},
      "hours": {"type": "integer", "description": "Lookback window in hours, default 48"},
      "limit": {"type": "integer", "description": "Default 15"}
    },
    "required": []
  }
}
```

```sql
SELECT l.lead_name, l.email, l.phone, l.source, l.status, l.created_at,
       l.metadata, c.business_name
FROM leads l JOIN clients c ON c.id = l.client_id
WHERE l.created_at > now() - interval '1 hour' * %(hours)s
  AND (%(client_name)s IS NULL OR c.business_name ILIKE '%%' || %(client_name)s || '%%')
ORDER BY l.created_at DESC LIMIT %(limit)s
```

Surface `metadata->>'score'` if present (populated once the `lead_scoring`
workflow ships) but do not depend on it existing.

### 5.5 `stage_email` (draft + approve)

Lives in `cos/actions.py`. This tool **stages**; it never sends.

```json
{
  "name": "stage_email",
  "description": "Stage an outbound email for Egan's approval. Compose the full email yourself (subject + body, plain text, signed 'Egan — Norr AI'), then call this tool. The email is NOT sent — Egan must reply 'send it' to fire it, or 'cancel' to discard. After calling, show Egan the full draft and tell him to reply 'send it' or 'cancel'.",
  "input_schema": {
    "type": "object",
    "properties": {
      "to": {"type": "string", "description": "Recipient email address"},
      "subject": {"type": "string"},
      "body": {"type": "string", "description": "Plain-text email body"},
      "context": {"type": "string", "description": "One line on why this email is being sent (for the audit trail)"}
    },
    "required": ["to", "subject", "body"]
  }
}
```

Implementation:

```python
def stage_email(user_id, channel, to, subject, body, context=None):
    # supersede any existing pending action for this user/channel
    UPDATE cos_pending_actions SET status='cancelled', decided_at=now()
      WHERE user_id=%s AND channel=%s AND status='pending';
    INSERT INTO cos_pending_actions (user_id, channel, action_type, payload)
      VALUES (%s, %s, 'send_email',
              jsonb {to, subject, body, context})
    RETURNING id;
    return {"staged": True, "action_id": ..., "to": to, "subject": subject}
```

`user_id`/`channel` are **not** model inputs — `_execute_tool` must be extended
to accept the session identity from `main.py` and inject them (change
`run_turn(history, user_message)` → `run_turn(history, user_message, identity)`
where `identity = {"user_id": ..., "channel": ...}`; thread it through to
`_execute_tool`). The model can never stage an action for someone else's
session.

### 5.6 Execution: `execute_pending_action` (code path, NOT a model tool)

In `cos/actions.py`:

```python
def get_pending(user_id, channel) -> dict | None:
    # SELECT the pending row; if created_at < now() - interval '60 minutes',
    # UPDATE status='expired' and return None
def execute_pending(action_row) -> dict:
    # dispatch on action_type; today only send_email
def cancel_pending(user_id, channel, reason='cancelled') -> None
```

`send_email` execution uses the SendGrid v3 API directly (`requests.post` to
`https://api.sendgrid.com/v3/mail/send`, `Authorization: Bearer $SENDGRID_API_KEY`),
from `hello@norrai.co` (the verified sender — CLAUDE.md). **Treat any non-2xx
as failure** and set `status='failed'` with the response body in `result` —
this codebase has been burned twice by swallowed send failures
(`docs/lessons-learned.md`, SESSION_LOG 2026-06-24). On success set
`status='approved'`, `result={"sendgrid_status": 202}`.

Reply text after execution: `"Sent to {to} — subject: {subject}"` or
`"Send FAILED ({status}): {detail}. Draft preserved — say 'retry' is not supported; re-stage it."`

### 5.7 `main.py` wiring

Insert the pending-action gate in both `_handle_slack_dm` and `sms_inbound`,
after allowlist, before `run_turn`. Factor the shared logic into one function:

```python
def handle_inbound(user_id: str, channel: str, text: str) -> str:
    pending = actions.get_pending(user_id, channel)
    if pending:
        norm = text.strip().lower().rstrip(".!")
        if norm in APPROVE_WORDS:
            return actions.execute_pending(pending)  # returns reply string
        if norm in CANCEL_WORDS:
            actions.cancel_pending(user_id, channel)
            return "Cancelled — draft discarded."
        actions.cancel_pending(user_id, channel, reason="superseded")
        # fall through, but tell the agent what happened:
        text = f"[note: a staged draft was auto-discarded because Egan replied with something else] {text}"
    history = db.load_session(user_id, channel)
    reply, updated = agent.run_turn(history, text, {"user_id": user_id, "channel": channel})
    db.save_session(user_id, channel, updated)
    return reply
```

Slack path posts the return value via `chat_postMessage`; SMS path returns it
as TwiML (existing 1600-char truncation stays).

---

## 6. Access Control (P0 — ship before the send capability)

Today the service answers **any** Slack DM and **any** SMS sender whose
request passes signature verification. That was tolerable for read-only
health checks; it is not tolerable once the bot can send email as Norr AI.

- New env vars: `COS_ALLOWED_SLACK_USERS` and `COS_ALLOWED_PHONES` —
  comma-separated lists (Slack user IDs; E.164 phone numbers).
- In `slack_events`: if `event["user"]` not in the allowlist, return 200 and
  do nothing (no reply — don't advertise the bot's existence).
- In `sms_inbound`: if `From` not in the allowlist, return empty `<Response/>`.
- Parse the lists once at startup; empty/unset allowlist ⇒ **deny all** and
  log a startup warning (fail closed, not open).

Add both variables to `cos/.env.example` and the README's Railway table.

---

## 7. Weekly Digest

### 7.1 Endpoint

`POST /cron/weekly-summary` on the FastAPI app.

- Auth: header `X-Norr-Token` must equal env `NORR_TOKEN` (the project's
  standard shared-secret header) — 403 otherwise.
- Composes the digest (below), posts it to Egan's Slack DM
  (`chat_postMessage(channel=EGAN_SLACK_USER_ID, ...)` — Slack opens the DM
  automatically when posting to a user ID), returns `{"ok": true}`.
- New env vars: `NORR_TOKEN`, `EGAN_SLACK_USER_ID`.

### 7.2 Digest content

Assembled from existing tool functions (call them directly in Python — no
Claude round-trip needed for the data; use ONE Claude call at the end to
compress it into a readable message, `max_tokens=600`, plain text):

1. Client health rollup — `check_client_health()`, one line per non-green client.
2. Workflow failures last 7 days — `get_workflow_errors(days=7)`, count + top offenders.
3. Lead flow last 7 days — from `pipeline_summary` query B.
4. Open urgent/high tasks — `query_tasks(priority='urgent')` + `high`, first 5.
5. Active MRR total — from `pipeline_summary` query A.

### 7.3 Trigger

One new n8n workflow, **Norr AI COS Weekly Digest** (`cos_weekly_digest` in
the `n8n/README.md` registry):

```
Schedule Trigger (Mondays 8:00 AM, workflow timezone America/Chicago)
  → HTTP Request: POST https://<railway-url>/cron/weekly-summary
    (header X-Norr-Token from n8n credential)
```

Follow the workflow logging standard (CLAUDE.md): Log Triggered / Log
Completed to `workflow_events` with the `norrai_internal` client_id
(`e2f9934c-4d28-4bb4-ac90-4284c1123517`), and set the Error Workflow to
`Norr AI Workflow Error Logger`. Export the JSON to `n8n/workflows/`.

(Why n8n and not Railway cron: the schedule lives where every other Norr AI
schedule lives, inherits the logging standard, and shows up in client-health
yellow detection via the `SCHEDULED_WORKFLOWS` list in `cos/tools.py` — add
`"cos_weekly_digest"` to that list.)

---

## 8. System Prompt Update

Extend `SYSTEM_PROMPT` in `agent.py` (keep it under ~40 lines — it rides on
every turn over SMS too):

- Add the business facts the old PRD wanted a Knowledge Agent for: the three
  tiers with prices, the verticals served, "lead with ROI, never technology"
  (from CLAUDE.md § Sales Principles). This handles "what do we charge for
  Growth?" with zero tools.
- Describe the new tools and the approval flow: *"stage_email never sends;
  after staging, show the full draft and tell Egan to reply 'send it' or
  'cancel'."*
- Keep the existing constraints: concise, plain text, works on SMS.

---

## 9. Testing

New: `cos/tests/` with pytest (add `pytest` to a `cos/requirements-dev.txt`;
do NOT add it to `requirements.txt` — Railway installs that).

Required tests (mock psycopg2 with a fake cursor, or use `pytest-postgresql`
if simple; mock `anthropic` and SendGrid with stub objects — no live calls):

1. **Approval state machine** — the highest-value tests:
   - pending + "send it" → execute called once, status `approved`
   - pending + "SEND IT." (case/punctuation) → approved
   - pending + "cancel" → cancelled, no execute
   - pending + unrelated text → superseded, agent invoked with the note prefix
   - pending older than 60 min → treated as absent, marked `expired`
   - staging twice → first row cancelled, one pending remains
2. **Allowlist** — unknown Slack user / phone gets no agent invocation;
   empty allowlist denies all.
3. **SendGrid failure path** — non-2xx → status `failed`, error surfaced in
   reply text (never a silent success).
4. **Tool SQL smoke** — each new tool function runs against a test schema
   loaded from `db/schema.sql` + migrations (skip if no test DB available;
   mark with `pytest.mark.db`).

Manual smoke checklist (append to `cos/README.md`): one Slack round-trip and
one SMS round-trip per tool; one full stage→approve→received-email loop to
egachuu@gmail.com; one `/cron/weekly-summary` curl with and without the token.

The repo's Playwright suite (`npm test`) is unaffected — still must pass
before pushing since the push includes registry/docs edits.

---

## 10. Build Order & Acceptance

Each step is independently shippable; deploy after each.

| Step | Scope | Done when |
|---|---|---|
| 1 | Allowlist (§6) + env plumbing | Unknown sender ignored; Egan still works |
| 2 | `query_tasks`, `update_task_status`, `pipeline_summary`, `recent_leads` | "what's on my plate" and "how's the pipeline" answer correctly from phone |
| 3 | Migration 006 + `stage_email` + keyword gate + SendGrid execute | Full draft→"send it"→email-received loop verified to egachuu@gmail.com; "cancel" and expiry verified |
| 4 | `/cron/weekly-summary` + n8n digest workflow + registry row | Digest lands in Slack Monday 8am CT; workflow logs triggered/completed |
| 5 | System prompt update + pytest suite green | Pricing question answered without tools; `pytest cos/tests` passes |

Estimated effort: each step is an evening; the whole thing is roughly one
week of side-project time — versus the 4-week plan in the superseded PRD.

## 11. Explicitly Deferred

- Block Kit approval buttons (conversational approval is channel-uniform; add buttons only if misfires actually happen)
- Invoice tracking (revisit at ~5 active contracts)
- Proposal generation (Claude Code does this better today)
- Second user access — solved properly by the multi-tenant identity layer in `obsidian/PRDs/re-concierge-pro.md`, not by widening the allowlist
