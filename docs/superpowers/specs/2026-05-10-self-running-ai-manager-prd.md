# PRD: Norr AI Self-Running Manager System

**Date:** 2026-05-10
**Author:** Egan
**Status:** Draft
**Target:** Internal — Norr AI operations

---

## 1. Overview

Norr AI needs to run itself. As the client base grows, the operational work — monitoring client health, finding new leads, writing outreach, catching inbound inquiries, tracking revenue — cannot stay manual. The goal is a system where an orchestrating AI manager runs Norr AI's operations continuously in the background, surfaces decisions to Egan when human judgment is required, and improves its own performance over time by learning from outcomes.

This is not a chatbot and not another n8n workflow. It is an autonomous agent system with persistent memory, a sub-agent fleet, a human approval layer, and a minimal visual dashboard.

The closest analogy: a chief of staff who works 24/7, never drops a ball, asks smart questions when blocked, and gets measurably better every week.

---

## 2. Problem Statement

### What breaks as Norr AI scales without this

| Problem | Impact |
|---------|--------|
| Client health monitoring is manual and reactive | Issues are caught late — after client frustration, not before |
| Lead generation (B&B workflow) is per-client, not generalized | Can't prospect for Norr AI itself or new verticals |
| Inbound emails require Egan to triage | Delays on hot leads; things fall through the cracks |
| No learning loop | The same outreach patterns repeat regardless of what worked |
| Egan is the bottleneck for every decision | Doesn't scale past 5–6 active clients |

### What this system solves

A manager agent that never sleeps evaluates the full state of Norr AI every 15 minutes, advances what it can autonomously, and routes exactly the right decisions to Egan at the right moment — not a flood of notifications, but a curated queue of things that genuinely need a human.

---

## 3. Goals

### Primary Goals
- **Zero dropped balls.** Every inbound lead, client flag, and renewal signal gets caught and acted on.
- **Egan spends < 30 min/day on Norr AI ops** once the system is at steady state.
- **Self-improvement.** The system tracks outcomes and feeds them back into its own behavior. Outreach that converts more gets used more. Approaches that don't get pruned.

### Non-Goals
- This is not a product sold to clients (yet). It runs Norr AI's internal operations only.
- It does not replace human relationship management. All high-stakes client communication goes through an approval queue.
- It is not a general-purpose AI assistant. It knows Norr AI's business deeply and nothing else.

---

## 4. User Stories

**As Egan:**
- I want to wake up and see one Slack message summarizing what happened overnight and what needs my attention today — not ten separate pings.
- I want to approve or reject AI-drafted outreach emails with one tap in Slack, not by opening a dashboard.
- I want the system to tell me when a client is going quiet before they churn, not after.
- I want new qualified leads in my pipeline without me initiating searches.
- I want a dashboard I can glance at for 30 seconds and know the full state of the business.

**As the Manager Agent:**
- I need to know the current state of all clients, prospects, and tasks at all times.
- I need to take action on anything I'm confident about without bothering Egan.
- I need to escalate clearly when I'm uncertain, blocked by missing data, or the stakes are too high to act alone.
- I need to remember what I've tried, what worked, and apply that learning forward.

---

## 5. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  EGAN                                                           │
│  Slack (approval queue, briefings, decision requests)           │
│  Dashboard (pipeline, fleet status, client health, queue)       │
└─────────────────┬───────────────────────────────────────────────┘
                  │ approvals / replies
┌─────────────────▼───────────────────────────────────────────────┐
│  MANAGER AGENT                                                  │
│  Wakes every 15 min. Reads full state from Neon.                │
│  Evaluates: what can I advance? what needs Egan?                │
│  Writes decisions to agent_decisions. Spawns sub-agents.        │
│  Posts structured Slack messages. Logs everything.              │
└──────┬──────────┬──────────┬──────────┬──────────┬─────────────┘
       │          │          │          │          │
  ┌────▼──┐  ┌───▼───┐  ┌───▼──┐  ┌───▼──┐  ┌───▼────┐
  │ Scout │  │ Clerk │  │Watch │  │Draft │  │Archive │
  │       │  │       │  │ dog  │  │      │  │        │
  └───────┘  └───────┘  └──────┘  └──────┘  └────────┘
       │          │          │          │          │
┌──────▼──────────▼──────────▼──────────▼──────────▼─────────────┐
│  NEON (Postgres)                                                │
│  clients · leads · workflow_events · agent_tasks                │
│  agent_memory · agent_decisions · agent_outcomes · approvals    │
└─────────────────────────────────────────────────────────────────┘
       │          │          │
  ┌────▼──┐  ┌───▼──┐  ┌───▼──┐
  │ Gmail │  │Slack │  │Apollo│
  │  API  │  │  API │  │  API │
  └───────┘  └──────┘  └──────┘
```

---

## 6. Components

### 6.1 Manager Agent

The orchestrating brain. Runs as a Python process on a 15-minute cron (n8n triggers an HTTP call to a hosted endpoint on Fly.io or Railway).

**Each cycle:**
1. Pull current state: `clients`, `leads`, `workflow_events`, `agent_tasks`, `approvals`
2. Evaluate health: any red clients? any overdue tasks? any pending approvals expiring?
3. Check inbound queue: new items from Clerk (emails), Scout (leads), Watchdog (alerts)
4. Decide: for each item, does it require Egan? Can I act alone?
5. Spawn sub-agents for any work being delegated
6. Write decisions to `agent_decisions`
7. Post to Slack (if anything requires Egan or it's a scheduled briefing)
8. Update `agent_tasks` status

**Model:** `claude-opus-4-7` — this is the reasoning layer, not the workhorse. Haiku handles classification inside sub-agents.

**System prompt includes:**
- Full Norr AI context (CLAUDE.md condensed)
- Current clients and their health
- Active task queue
- Recent outcome stats (what's been working)
- Escalation thresholds (when to ask vs. act)

**Escalation thresholds (acts alone below, escalates above):**
- Sending a notification to an existing client → escalate
- Drafting outreach to a new prospect → escalate
- Logging an event or updating a record → act alone
- Querying an API for data → act alone
- Any irreversible action touching a real person → escalate

### 6.2 Sub-Agents

#### Scout
**Purpose:** Find and score new prospects for Norr AI itself and for client verticals.
**Trigger:** Manager assigns on Monday mornings + any time pipeline drops below threshold.
**Inputs:** Target vertical, geography, title filters → Apollo.io search.
**Process:** Fetch results → Claude scores each lead 1–10 against Norr AI ICP → anything 8+ goes to `agent_tasks` as a "draft outreach" item → notifies manager.
**Outputs:** Qualified leads in `leads` table, tasks in `agent_tasks`.
**Learns from:** `agent_outcomes` — which lead profiles convert to discovery calls.

#### Clerk
**Purpose:** Monitor the `hello@norrai.co` Gmail inbox, classify every email, route it.
**Trigger:** Gmail push notification (Gmail API watch) → webhook → Clerk fires.
**Classifications:**
- `lead_inquiry` → creates lead record + draft response → approval queue
- `client_message` → flags to manager, links to client record
- `vendor_spam` → archives, no action
- `internal` → logs, may summarize if action required
**Process:** Claude Haiku classifies. Claude Sonnet drafts responses for lead_inquiry and client_message types.
**Outputs:** New `leads` rows, `approvals` rows for drafts, `agent_memory` entries.

#### Watchdog
**Purpose:** Monitor client health, detect problems early.
**Trigger:** Manager on every cycle. Also subscribes to `workflow_events` INSERT events.
**Logic:**
- Red: any `failed` events in past 7 days → draft check-in email to Egan (not client)
- Yellow: no events in past 72 hours for an active client → flag to manager
- Silence threshold: per-client, learned from their typical cadence (stored in `agent_memory`)
**Outputs:** `agent_tasks` rows, Slack alerts, health fields updated in `clients`.

#### Drafter
**Purpose:** Write high-quality outbound communications — emails, SMS drafts, proposals, follow-ups.
**Trigger:** Manager assigns a draft task with context: recipient, purpose, tone, relevant history.
**Process:** Pulls client/lead history from Neon + `agent_memory` → Claude Sonnet writes draft → draft goes to `approvals` table → Slack message to Egan with preview and one-tap approve/edit/reject.
**Learns from:** Open rates, reply rates, conversion outcomes stored in `agent_outcomes`.
**Never sends autonomously.** Every Drafter output goes through approval.

#### Archivist
**Purpose:** Write structured memory entries after every significant event.
**Trigger:** After any completed agent action (email sent, call logged, lead converted).
**Process:** Reads the event + context → Claude writes a concise structured summary → inserts into `agent_memory`.
**Example memory entry:**
```json
{
  "entity_type": "lead",
  "entity_id": "uuid",
  "fact": "Sarah replied positively to ROI-first framing. Opened email 3x. Best time window: Tuesday 9-11am CT.",
  "confidence": 0.8,
  "source": "clerk_classification + outcome_tracking",
  "created_at": "2026-05-10T14:23:00Z"
}
```

#### Reporter
**Purpose:** Weekly business briefing — what happened, what worked, what didn't, what's coming.
**Trigger:** Sunday 8pm CT cron.
**Contents:**
- MRR (current + change)
- Clients: health summary, any at-risk
- Pipeline: new leads, discovery calls, proposals out
- Agent performance: tasks completed, approval rate, outcome stats
- Recommended focus for the coming week (3 bullets)
**Output:** Rich Slack message + optional email to `hello@norrai.co`.

---

## 7. Data Model

### New Tables (extend existing Neon schema)

```sql
-- Work queue for all agent tasks
CREATE TABLE agent_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type TEXT NOT NULL,          -- 'draft_outreach', 'research_lead', 'monitor_client', etc.
  assigned_to TEXT NOT NULL,        -- 'scout', 'clerk', 'drafter', 'watchdog', 'archivist'
  priority INTEGER DEFAULT 5,       -- 1 (urgent) to 10 (low)
  status TEXT DEFAULT 'pending',    -- pending | running | blocked | done | cancelled
  context JSONB,                    -- task-specific data (lead_id, client_id, instructions, etc.)
  result JSONB,                     -- what the sub-agent produced
  blocked_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Persistent memory layer — facts the system has learned
CREATE TABLE agent_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,        -- 'client', 'lead', 'vertical', 'global'
  entity_id UUID,                   -- references clients.id or leads.id (nullable for global)
  fact TEXT NOT NULL,               -- human-readable learned fact
  confidence NUMERIC(3,2),          -- 0.0 to 1.0
  source TEXT,                      -- which agent or event created this
  superseded_by UUID REFERENCES agent_memory(id),  -- for updating facts
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Audit log of every manager decision
CREATE TABLE agent_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id UUID NOT NULL,           -- groups all decisions in one manager cycle
  decision_type TEXT NOT NULL,      -- 'act_alone', 'escalate', 'defer', 'spawn_agent'
  reasoning TEXT,                   -- Claude's brief explanation
  action_taken TEXT,
  task_id UUID REFERENCES agent_tasks(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Outcome tracking — closes the learning loop
CREATE TABLE agent_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES agent_tasks(id),
  outcome_type TEXT NOT NULL,       -- 'email_opened', 'replied', 'converted', 'no_response', 'bounced'
  outcome_value NUMERIC,            -- e.g. 1.0 for converted, 0.0 for no_response
  measured_at TIMESTAMPTZ DEFAULT now(),
  notes TEXT
);

-- Human approval queue
CREATE TABLE approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES agent_tasks(id),
  approval_type TEXT NOT NULL,      -- 'send_email', 'send_sms', 'create_lead', 'update_client'
  draft_content JSONB NOT NULL,     -- full draft (subject, body, recipient, etc.)
  status TEXT DEFAULT 'pending',    -- pending | approved | rejected | edited | expired
  egan_notes TEXT,                  -- Egan's feedback if edited/rejected
  slack_message_ts TEXT,            -- Slack message timestamp for updating in-place
  expires_at TIMESTAMPTZ,           -- auto-expire after 48h if no response
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
```

### Indexes
```sql
CREATE INDEX ON agent_tasks(status, priority);
CREATE INDEX ON agent_tasks(assigned_to, status);
CREATE INDEX ON agent_memory(entity_type, entity_id);
CREATE INDEX ON approvals(status, expires_at);
CREATE INDEX ON agent_outcomes(task_id);
```

---

## 8. Integrations

| Integration | Purpose | Method | Auth |
|-------------|---------|--------|------|
| Gmail API | Clerk reads/watches inbox | OAuth 2.0, push notifications | Service account or Egan's Google account |
| Slack API | All human-facing output + approval taps | Bot token, slash commands | Slack app in Norr AI workspace |
| Apollo.io API | Scout searches for leads | REST API | API key in env |
| Neon (Postgres) | All persistent state | psycopg2 / asyncpg | DATABASE_URL in env |
| Anthropic API | All intelligence | Python SDK | ANTHROPIC_API_KEY in env |
| SendGrid API | Drafter sends approved emails | REST API | Already in use |
| Twilio API | Drafter sends approved SMS | REST API | Already in use |
| n8n webhooks | Manager can trigger existing n8n workflows | HTTP POST | X-Norr-Token header |

---

## 9. Human Interface

### 9.1 Slack — the primary control surface

**Approval message format:**
```
📝 Draft ready for approval
To: Sarah Johnson <sarah@gmail.com>
Re: Following up on your Zillow inquiry

---
Hi Sarah — saw you were looking at 412 Oak Street...
[full preview truncated at 3 lines]

[✅ Approve & Send] [✏️ Edit] [❌ Reject]
Expires in 48h · Task #a3f2
```

**Daily briefing format (7am CT):**
```
☀️ Norr AI — Sunday May 10

MRR: $2,400 (↑ $600 this month)

CLIENTS
• Lakeland Dental — 🟢 healthy, last event 4h ago
• B&B Manufacturing — 🟡 no events in 3 days — check in?

PIPELINE
• 3 new leads from Scout this week (2 in approval queue)
• Discovery call with Trnka Wood Products — Tuesday 2pm

NEEDS YOUR ATTENTION
1. 2 outreach drafts awaiting approval [Review]
2. B&B workflow silence — draft check-in? [Yes] [No]
```

**Decision request format (when manager is blocked):**
```
❓ Need your call on this

Prep Network lead (Katie, Sr. Event Ops Mgr) has gone quiet after 
2 follow-ups. It's been 14 days.

Options:
A. Send one final breakup email (I've drafted it)
B. Archive and revisit in Q3
C. Try a different channel (LinkedIn)

[A — Send Draft] [B — Archive] [C — LinkedIn]
```

### 9.2 Dashboard — `/internal/dashboard.html` extended

Extend the existing dashboard with four panels:

**Panel 1: Agent Fleet**
- Card per sub-agent: name, status (idle/running/error), last run timestamp, tasks completed today

**Panel 2: Approval Queue**
- List of pending approvals, sorted by expiry
- Preview of draft content
- Approve/Reject buttons (posts to a webhook → updates `approvals` table → agent acts)
- Expired approvals shown as faded/cancelled

**Panel 3: Pipeline**
- MRR counter at top (large, prominent)
- Kanban-lite: Prospect → Discovery → Proposal → Onboarded
- Each card: name, vertical, last agent action, days in stage

**Panel 4: Client Health**
- Existing red/green cards retained
- Add: last agent action per client, next scheduled check-in

---

## 10. Phases

### Phase 1: Foundation (Weeks 1–2)
**Goal:** Manager agent is running, reading state, posting one useful Slack briefing per cycle.

- [ ] Create new Neon tables: `agent_tasks`, `agent_memory`, `agent_decisions`, `agent_outcomes`, `approvals`
- [ ] Build manager agent Python script — reads Neon, evaluates state, writes decisions, posts Slack
- [ ] n8n cron → HTTP trigger → manager endpoint (hosted on Fly.io or Railway)
- [ ] Watchdog logic inline in manager (no separate sub-agent yet) — red/yellow client detection
- [ ] Daily 7am Slack briefing working end-to-end
- [ ] All decisions logged to `agent_decisions`

**Success:** Manager wakes up, reads Neon, posts a coherent Slack briefing. No dropped errors. Zero false positives in first week.

### Phase 2: Clerk + Approval Queue (Weeks 3–4)
**Goal:** Inbound emails are caught, classified, and routed. Approval queue is live.

- [ ] Gmail API OAuth setup + push notification watch on `hello@norrai.co`
- [ ] Clerk sub-agent: classify → draft → insert into `approvals`
- [ ] Slack approval messages with interactive buttons (Slack Block Kit)
- [ ] Approval webhook → updates `approvals.status` → Drafter sends if approved
- [ ] Dashboard: Approval Queue panel live
- [ ] `agent_memory` populated by Archivist after each completed email

**Success:** A cold inbound email to `hello@norrai.co` triggers a Slack approval within 5 minutes. Egan taps Approve. Email sends. All logged.

### Phase 3: Scout + Learning Loop (Weeks 5–7)
**Goal:** Autonomous lead generation. Outcome tracking starts feeding back in.

- [ ] Scout sub-agent: Apollo.io search → Claude scoring → `leads` insert → `agent_tasks` for Drafter
- [ ] Scout runs Monday 6am CT (n8n cron → manager → Scout)
- [ ] `agent_outcomes` populated from: Gmail open tracking (SendGrid events), reply detection (Clerk classifies replies)
- [ ] Manager system prompt includes outcome stats summary (recalculated weekly by Reporter)
- [ ] Reporter sub-agent: Sunday 8pm briefing with outcome stats

**Success:** Egan gets a Monday morning Slack message with 5 pre-scored, pre-drafted outreach emails ready to approve. At least one converts to a discovery call within 30 days.

### Phase 4: Dashboard + Scheduler (Weeks 8–10)
**Goal:** Full visual interface. Scheduling capability.

- [ ] Dashboard: all 4 panels live (`/internal/dashboard.html` extended)
- [ ] Approval queue interactive in dashboard (not just Slack)
- [ ] Scheduler sub-agent: detects "let's connect" signals, proposes calendar options via Slack
- [ ] Pipeline view populated from `leads` + `clients` state
- [ ] MRR calculated from `service_contracts` and displayed on dashboard

**Success:** 30-second dashboard glance gives full business state. Pipeline view matches reality.

---

## 11. Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| Manager cycle time | < 60 seconds end-to-end per cycle |
| Uptime | 99%+ — hosted process with auto-restart (Fly.io health checks) |
| Approval expiry | 48 hours — expired approvals are cancelled, manager is notified |
| Escalation latency | Manager flags to Slack within 1 cycle (< 15 min) of detecting an issue |
| Data privacy | No PII in `agent_decisions` or `agent_memory` plaintext — reference by ID only |
| Cost | Anthropic API cost target: < $50/month at steady state (Haiku for classification, Sonnet for drafting, Opus for manager cycles) |
| Irreversibility guard | Any action that sends communication to a person outside Norr AI requires an `approvals` record with status `approved` before execution |

---

## 12. Risks and Open Questions

### Risks

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| Manager acts on stale data and makes a bad call | Medium | Every decision logged with reasoning; Egan can audit and veto; escalation thresholds set conservatively at start |
| Gmail API OAuth expires or gets revoked | Low | Alert on auth failure; fallback to manual polling via IMAP |
| Approval queue becomes overwhelming (too many escalations) | Medium | Tune escalation thresholds week-by-week; start conservative, loosen as trust builds |
| Anthropic API rate limits on high-volume cycles | Low | Haiku for most classification; rate limit backoff built into sub-agent calls |
| Fly.io process crashes silently | Low | Health check endpoint + n8n monitors it; Slack alert on missed cycles |

### Open Questions

1. **Approval UX:** Should approvals live primarily in Slack (faster, mobile-friendly) or in the dashboard (more context, editable)? Initial answer: Slack for approve/reject, dashboard for editing. Revisit after Phase 2.

2. **Gmail access scope:** Full inbox access vs. a dedicated `norrai-ops@norrai.co` alias the manager monitors. Dedicated alias is safer (lower blast radius) but means manually forwarding relevant emails during setup. Decision needed before Phase 2 starts.

3. **Outbound sending identity:** Does the manager send as `hello@norrai.co` or a dedicated `ops@norrai.co`? Recommendation: `hello@norrai.co` for client-facing, `ops@norrai.co` for internal/prospect outreach.

4. **Scheduler integration:** Phase 4 includes meeting scheduling suggestions. Calendly API vs. building a simple availability check against Google Calendar. Calendly is faster. Google Calendar is already in the stack via Google Workspace.

5. **Voice interface (parking lot):** The chief-of-staff voice bot idea (Twilio + Whisper + Claude) is architecturally compatible with this system — the voice interface becomes another input surface to the manager's task queue. Not in scope for this PRD but should be designed as an adapter, not a separate system.

---

## 13. Success Metrics

| Metric | 30-day target | 90-day target |
|--------|--------------|--------------|
| Egan's daily ops time | < 45 min | < 20 min |
| Inbound leads caught automatically | 90% | 99% |
| Client health alerts — caught before client flags issue | 50% | 85% |
| Outreach approval-to-send rate | — | > 70% (low reject rate signals quality) |
| Scout leads → discovery calls | — | 1+ per month |
| System uptime | 95% | 99% |
| Egan's reported confidence in business state | Qualitative check | "I know what's happening at all times" |

---

## 14. Out of Scope (v1)

- Multi-tenant: this system runs Norr AI's ops, not client ops. Client AI features stay in n8n.
- Mobile app: Slack is the mobile surface. No native app.
- Voice interface: architecturally planned for, not built in v1.
- Fine-tuning or custom model training: prompt engineering + RAG only.
- Selling this system as a product: internal only until it's proven.
