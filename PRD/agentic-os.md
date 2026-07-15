# Agentic OS — Norr AI Internal Operating System (Design Doc)

**Date:** 2026-07-15
**Status:** Draft for review
**Builds on:** `PRD/cos-v2-internal.md` (approved 2026-07-12 — ship COS v2 first; this doc extends it, changes nothing in it)
**Related:** `PRD/re-concierge-pro.md` (client-facing concierge pattern), `docs/Norr AI — 6 Month Roadmap.md` (Month 4–6: "delivery doesn't require Egan for every build")

---

## 1. What this is

The May 2026 multi-agent PRD failed because it added agents before adding
shared substrate — six agents, parallel data models, no common gate. The
agentic OS inverts that: **one shared state (Neon), one work queue
(`tasks`), one approval gate (`cos_pending_actions`), and a small number of
processes that all speak to the same substrate.**

The processes, in OS terms:

| OS concept | Norr AI implementation | State |
|---|---|---|
| Shared state | Neon (`clients`, `leads`, `workflow_events`, `stories`/`tasks`) + repo | Exists |
| Daemons | n8n workflows (reminders, drips, intake, cleansing) | Exists |
| Interactive shell | COS bot (Slack/SMS → FastAPI → Claude tool loop) | Deployed; v2 spec approved |
| Scheduler | n8n crons + Claude Code Routines | Exists |
| Work queue | `tasks` table (Mission Control) | Exists — this doc defines the agent contract |
| Workers | Headless Claude Code sessions | **New — this doc** |
| Sensors | Health checks that file tasks instead of just logging | **New — this doc** |
| Permission layer | `cos_pending_actions` (COS v2 §3.1), widened OS-wide | **Extended — this doc** |
| Audit log | `workflow_events` + logging standard | Exists |

The loop that makes it an OS:

```
sense (workflows + health checks write events, file tasks; ideas
       captured from anywhere land in the inbox)
  → decide (Egan or COS triages the queue from a phone)
  → act (workers claim tasks; daemons run sequences)
  → gate (all outbound waits for keyword approval)
  → observe (weekly digest = `top`; task queue = `ps`)
```

### Design invariants (carry from COS v2 — do not relax)

1. **One substrate.** No new parallel data models. New capability = new
   columns/tools on existing tables, not new agents with private memory.
2. **Approval is keyword-driven, never model-mediated** (COS v2 §3.2).
3. **Workers never touch clients directly.** Every worker deliverable is a
   PR, a staged action, or text written back to the task — a human or the
   gate stands between agent output and the outside world.
4. **Everything logs.** Worker runs log to `workflow_events` like any n8n
   workflow (`norrai_internal` client_id until per-client routing exists).

---

## 2. Goals & Non-Goals

### Goals
1. Any process (n8n workflow, COS bot, cron, Egan on a phone) can **file a
   task**; eligible tasks are **claimed and executed by a headless Claude
   Code worker**; output lands as a PR or staged action for Egan's review.
2. Client-health reds **file tasks automatically** instead of waiting for
   the Monday digest.
3. The COS approval gate becomes the **single outbound gate** for every
   agent in the system, not just the COS bot.
4. Egan's role shifts from *doing* builds to *reviewing* builds — the
   roadmap's Month 4–6 leverage milestone, without the contractor hire.

### Non-Goals
- No specialist sub-agents, no intent router, no orchestration framework
  (LangGraph, CrewAI, etc.). The queue **is** the orchestrator.
- No agent autonomy over outbound email/SMS — the gate stays.
- No client-facing behavior change. This is internal machinery.
- No rewrite of COS v2 — its five build steps ship first, unchanged.
- No `stories` automation. Story closure stays a human/session-end concern
  (the CHECK constraint is `done`, not `completed` — see CLAUDE.md).

---

## 3. The task-queue contract

This is the one genuinely new design surface. Everything below is pinned so
that a worker session with zero conversational context can operate purely
from the row.

### 3.1 What makes a task agent-runnable

A task is eligible for a worker when **all** of:

| Field | Requirement |
|---|---|
| `assigned_to` | `= 'agent'` (the eligibility switch — reuses the existing column) |
| `status` | `= 'ready'` (`backlog` is never claimed — promotion to `ready` is a human/COS decision) |
| `category` | In the **agent category allowlist**, initially `('research', 'analysis', 'dev')`. `ops` and `testing` stay human until the loop has earned trust. |
| `description` | Non-empty — **what** to do, written to be executable without conversation context |
| `output` | Non-empty — **acceptance criteria**: what artifact, where, what "done" looks like |

`context` is optional but strongly encouraged: repo paths, PRD references,
client_id, prior-attempt feedback. The worker reads `description` +
`context` + `output` and nothing else — if a task can't be specified in
those three fields, it isn't agent-runnable yet.

**Deliverable types** — every agent task's `output` must resolve to exactly
one of:

| Type | Example | Lands as |
|---|---|---|
| `pr` | "Draft the dental appointment-reminder workflow JSON per the dental playbook" | Branch + PR, task → `review` |
| `staged_action` | "Draft the B&B monthly check-in email" | Row in `cos_pending_actions`, task → `review` |
| `text` | "Research Dentrix API export options; summarize integration paths" | Written to `tasks.output` (appended below the acceptance criteria), task → `review` |

Never: direct sends, direct writes to client-facing tables (`leads`,
`appointments`), n8n deploys, or DNS/Cloudflare changes.

### 3.2 Schema migration

`db/migrations/007_agent_queue.sql` (006 is reserved by COS v2 for
`cos_pending_actions`; also append to `db/schema.sql` — canonical per
`db/README.md`):

```sql
-- Agent work-queue claim semantics on Mission Control tasks

ALTER TABLE tasks
  ADD COLUMN agent_claim_id   uuid,
  ADD COLUMN agent_claimed_at timestamptz,
  ADD COLUMN agent_attempts   int NOT NULL DEFAULT 0,
  ADD COLUMN agent_result     jsonb;

-- Fast eligibility scan for workers
CREATE INDEX idx_tasks_agent_ready
  ON tasks(priority, seq)
  WHERE status = 'ready' AND assigned_to = 'agent';
```

- `agent_claim_id` — uuid minted by the worker session at claim time;
  every subsequent write by that worker includes
  `AND agent_claim_id = %(claim)s` so a janitor-reset task can't be
  clobbered by a zombie session.
- `agent_result` — `{"deliverable": "pr|staged_action|text", "branch": ...,
  "pr_url": ..., "action_id": ..., "summary": ..., "tests": "pass|fail|n/a"}`.
- No status-enum change needed: the agent lifecycle uses the existing
  `ready → agent_working → review → done` path.

### 3.3 Claim semantics

Claiming is **one atomic statement** (works within Neon MCP's
one-statement-per-call constraint; `SKIP LOCKED` makes concurrent workers
safe even though v1 runs only one):

```sql
UPDATE tasks
SET status = 'agent_working',
    agent_claim_id = %(claim)s,
    agent_claimed_at = now(),
    agent_attempts = agent_attempts + 1
WHERE id = (
  SELECT id FROM tasks
  WHERE status = 'ready'
    AND assigned_to = 'agent'
    AND category IN ('research', 'analysis', 'dev')
  ORDER BY array_position(ARRAY['urgent','high','medium','low'], priority),
           seq NULLS LAST, created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING id, title, description, context, output, category, client_id, story_id;
```

Zero rows returned ⇒ queue empty ⇒ worker ends its session immediately
(cheap no-op wake).

**One task per worker session.** A session claims one task, finishes it,
and exits. No batching — keeps blast radius, context, and review units
small.

### 3.4 Completion

On success, one guarded write:

```sql
UPDATE tasks
SET status = 'review',
    agent_result = %(result)s::jsonb
WHERE id = %(task_id)s AND agent_claim_id = %(claim)s;
```

On failure the worker does the same write with `status = 'ready'`,
`agent_result = {"error": ..., "summary": "what was tried"}` appended, and
**prepends a dated failure note to `context`** so the next attempt (agent
or human) starts smarter.

### 3.5 Lease expiry & the janitor

Worker sessions die silently (container reclaimed, crash, context blowout).
The daily sensor routine (§5) doubles as janitor:

- `agent_working` with `agent_claimed_at < now() - interval '4 hours'` ⇒
  reset to `ready`, note appended to `context`.
- `agent_attempts >= 3` ⇒ set `status = 'backlog'`, append tag
  `agent-blocked`, surface in the digest and the daily sensor summary.
  A human re-promotes it (usually after improving the spec) or takes it over
  by clearing `assigned_to`.

### 3.6 Review flow

`review` is Egan's inbox. From Claude Code, or from a phone via COS
(`query_tasks status=review` already surfaces these in v2):

- **Accept:** merge the PR / approve the staged action ("send it" — the
  existing gate), then task → `done`.
- **Redo:** append feedback to `context`, set `status = 'ready'` — the next
  worker wake picks it up with the feedback in front of it.
- **Take over:** clear `assigned_to`, set `status = 'in_progress'` — it's a
  human task again.

---

## 4. The worker

### 4.1 Mechanism

A **Claude Code Routine** (remote environment scheduled trigger,
`create_new_session_on_fire = true`) fires a fresh session on a schedule —
start with **once daily, 6:00 AM Central** — plus on-demand via
`fire_trigger` when Egan says "kick the worker" (a COS tool in Phase 3).

Each firing runs the same standalone prompt (sketch — final text lives with
the Routine):

> You are the Norr AI queue worker. Claim one task using the claim
> statement in `PRD/agentic-os.md` §3.3 (mint a fresh uuid as your
> claim_id). If no task: log a `completed` event with
> `{"queue": "empty"}` and stop. Otherwise: do the work per the task's
> description/context/output. Deliverable rules: `dev` ⇒ branch
> `agent/task-<first-8-of-id>`, run `npm test` and the n8n-audit skill if
> workflow JSON was touched, push, open a PR, never merge. `research` /
> `analysis` ⇒ write findings into the task's `output`. Outbound drafts ⇒
> stage via `cos_pending_actions`, never send. Finish with the completion
> write in §3.4 and log `triggered`/`completed` to `workflow_events` as
> `agent_worker` under the `norrai_internal` client_id.

### 4.2 Guardrails

- **Branch namespace:** all worker branches are `agent/task-<id8>`. Workers
  never push to `main`, never merge, never force-push.
- **Repo verification is mandatory for `dev` tasks:** `npm test` green +
  n8n-audit clean (when applicable) before the PR opens; test results go in
  `agent_result.tests`.
- **No secrets handling:** workers use the credentials already in the
  environment; a task whose spec requires a new credential fails fast with
  a note rather than improvising.
- **Registry discipline:** any new n8n workflow JSON in a PR must include
  the `n8n/README.md` registry row and the standard logging nodes — the
  n8n-audit skill enforces this and the `n8n-workflow-reviewer` agent is
  available for a second pass.
- **Worker runs are themselves observable:** `agent_worker` joins
  `SCHEDULED_WORKFLOWS` in `cos/tools.py`, so a worker that stops waking
  shows up yellow in client health like any other scheduled job.

---

## 5. Sensors — closing sense → decide

One new n8n workflow, **Norr AI Daily Sensor** (`daily_sensor` in the
registry), Schedule Trigger daily 5:30 AM Central (before the worker wake):

1. Run the client-health logic (same query as `check_client_health`).
2. For each **red** client/workflow pair: file a task —
   `category = 'analysis'`, `assigned_to = 'agent'`, `status = 'ready'`,
   `priority = 'high'`, tag `sensor:health`, `description` naming the
   client + workflow + failure count, `context` embedding the recent
   `workflow_events.payload` rows, `output` = "diagnosis + recommended fix
   as text; do not touch production."
3. **Dedupe:** skip if an open (non-`done`) task with tag `sensor:health`
   already exists for the same client + workflow — one
   SELECT-then-conditional-INSERT, per the CLAUDE.md dedupe rule (no
   `ON CONFLICT`).
4. Janitor pass (§3.5): stale-claim resets, attempt-cap demotions.
5. Standard logging nodes; Error Workflow set; export JSON to
   `n8n/workflows/`.

Yellows stay digest-only — filing tasks for silence would flood the queue.
The Monday digest (COS v2 §7) gains one section: queue state — tasks in
`review` awaiting Egan, `agent-blocked` count, worker completions last 7
days.

---

## 6. Idea capture — Telegram inbox

The OS needs a zero-friction way to get a thought out of Egan's head and
into the substrate from anywhere. Today that path is "remember it until the
next Claude Code session edits `docs/ideas.md`" — which is where ideas die.

**Design: capture-only Telegram bot, built entirely in n8n.** No change to
the COS FastAPI service. Telegram over SMS-to-COS because it's free, has no
1600-char limit, handles multi-message brain dumps naturally, and n8n Cloud
has a native Telegram Trigger node — this is one workflow, not a new
service.

### 6.1 Storage — `ideas` inbox table

`docs/ideas.md` stays the **curated** parking lot (per CLAUDE.md). The
table is the **raw inbox** that feeds it — a capture buffer, not a parallel
data model; rows exit by promotion or discard.

`db/migrations/008_ideas.sql` (append to `db/schema.sql`):

```sql
-- Raw idea inbox — captured from anywhere, triaged into docs/ideas.md
-- or promoted to a task. Not a knowledge base; rows are transient.

CREATE TABLE ideas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source           text NOT NULL DEFAULT 'telegram'
    CHECK (source IN ('telegram', 'slack', 'sms', 'session')),
  raw_text         text NOT NULL,           -- verbatim, never rewritten
  title            text,                    -- Claude-generated one-liner
  suggested_tags   text[] NOT NULL DEFAULT '{}',
  status           text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'triaged', 'promoted', 'discarded')),
  promoted_task_id uuid REFERENCES tasks(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ideas_new ON ideas(created_at) WHERE status = 'new';
```

### 6.2 Workflow — **Norr AI Idea Capture** (`idea_capture` in the registry)

```
Telegram Trigger (BotFather bot, token as n8n credential)
  → Allowlist IF: message.from.id equals Egan's numeric Telegram user ID
      (no match → stop; no reply — don't advertise the bot)
  → Log Triggered (norrai_internal client_id, standard pattern)
  → Claude Haiku (HTTP): from raw_text produce {"title": ..., "tags": [...]}
      — title/tag ONLY; raw_text is stored verbatim, never rewritten
  → Insert into ideas (Postgres)
  → Log Completed
  → Telegram reply: "Logged ✓ — {title}"
```

Rules, per the operational standards:

- Claude node prompt built in a Set node first (CLAUDE.md multiline rule).
- The Claude enrichment node gets `onError: continueRegularOutput` — a
  failed title generation must NOT lose the idea; insert with `title NULL`.
  The **Insert** node does not get it (a lost insert is the one real
  failure), and the Telegram reply only fires after a successful insert.
- Error Workflow → `Norr AI Workflow Error Logger`; export JSON to
  `n8n/workflows/`; registry row in `n8n/README.md`.
- Every plain text message = one idea. No commands, no parsing, no menus —
  friction kills capture.

### 6.3 Triage loop

- **Digest:** the Monday digest's queue section (§5) adds one line — count
  of `new` ideas + the three newest titles.
- **Promotion is human, execution is agent:** in any Claude Code session
  (or via a COS `list_ideas` tool later), Egan reviews the inbox; each idea
  becomes `promoted` (a real task is filed, `promoted_task_id` set),
  `triaged` (written into `docs/ideas.md` by the session, kept as
  reference), or `discarded`.
- **The session-end skill picks up the sweep:** add "check `ideas` for
  `new` rows and triage them with Egan" to the wrap-up checklist, so the
  inbox drains at least once per working session.

### 6.4 Deferred for this channel

- Voice-note capture (Telegram voice → transcription → same insert)
- Two-way Telegram (querying COS, approvals) — that makes Telegram a third
  COS channel: `main.py` webhook + allowlist + widening the
  `cos_pending_actions` channel CHECK. Do it only if Telegram displaces
  SMS as the on-the-go channel in practice.
- Auto-promotion by the worker (an agent deciding what's worth doing is
  exactly the judgment call that stays human)

---

## 7. Widening the gate

`cos_pending_actions` becomes the OS-wide outbound gate. Two changes, both
anticipated by COS v2:

1. **Widen the CHECK:** `action_type IN ('send_email', 'send_sms')`
   (the `send_sms` executor lands with `PRD/re-concierge-pro.md`; the
   constraint change can ship earlier).
2. **Non-conversational staging:** workers insert pending rows with
   `user_id = EGAN_SLACK_USER_ID, channel = 'slack'`, and the worker (or the
   sensor that notices a fresh stage) posts a Slack DM: *"Queue worker
   staged an email to X re: Y — reply 'send it' or 'cancel'."* Approval
   then flows through the **exact same keyword gate** COS v2 ships —
   zero new approval code, one pending action per (user, channel)
   semantics unchanged.

Financial/contractual actions remain outside the tool surface entirely
(COS v2 tier 3), for workers as much as for the bot.

---

## 8. Build order & acceptance

Prerequisite: **COS v2 steps 1–3 shipped** (allowlist, read tools, gate).
The digest (v2 step 4) can land in parallel with Phase 1.

| Phase | Scope | Done when |
|---|---|---|
| 1 | Migration 007 + queue contract docs; hand-file 2–3 real agent tasks | Claim statement returns the right task in priority order; guarded completion write works; zero-row claim behaves |
| 2 | Worker Routine (daily + on-demand), `research`/`analysis` categories only | A hand-filed research task goes `ready → agent_working → review` unattended; findings land in `output`; run logged to `workflow_events` |
| 3 | `dev` category + PR flow; COS tools `file_task` and `kick_worker` | A workflow-JSON task produces a green-tested, audit-clean PR; Egan files a task and kicks the worker from SMS |
| 4 | Daily Sensor workflow + janitor + digest queue section | A synthetic `failed` event produces exactly one deduped task by 5:30 AM and a diagnosis in `review` by 7:00 AM |
| 5 | Gate widening + worker staging + Slack nudge | Worker-staged email approved with "send it" end-to-end; `send_sms` constraint in place (executor deferred to re-concierge) |
| T | **Parallel track, no dependencies:** migration 008 + Idea Capture workflow (§6) | Telegram message from Egan's account lands as an `ideas` row with a Claude title and gets a "Logged ✓" reply; non-allowlisted sender gets silence; killed-Claude-node path still inserts |

Each phase is independently shippable and useful on its own. Rough effort:
Phases 1–2 ≈ two evenings; 3–5 ≈ an evening each once COS v2 exists;
track T is one evening and can ship first — it needs nothing but n8n and
migration 008.

### Kill criteria (evaluate after 4 weeks of Phase 3)

- If >half of agent task attempts end `agent-blocked` or redone, the specs
  are too thin for headless work — pause worker expansion, keep the queue
  as a human tool, revisit at higher task-spec maturity.
- If review load exceeds the time the builds used to take, the loop has
  negative leverage — narrow the category allowlist rather than push
  through.

## 9. Explicitly deferred

- Multiple concurrent workers (claim SQL already safe via `SKIP LOCKED`;
  turn on by adding Routine firings when queue depth justifies it)
- Worker access to `ops`/`testing` categories
- Client-scoped workers (per-client task routing — after per-client
  `workflow_events` routing exists)
- Auto-approve for any outbound action type — earned, not assumed; revisit
  only per-action-type with a written trust case
- Story-level planning by agents (task decomposition stays human)
