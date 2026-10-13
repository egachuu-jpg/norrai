# Agent MCP Connector — Setup Guide

Lets a real estate agent (or their assistant) manage to-dos and check hot leads
by talking to Claude, by typing or with voice, in the Claude app. A Cloudflare
Worker is the OAuth + MCP front door; n8n is the engine; Claude is the interface.

## Architecture (live as of 2026-10-12)

```
Claude app (agent's phone / desktop)
  └─ Norr AI connector (OAuth)  →  Cloudflare Worker  agent-mcp.norrai.co
        • /authorize → Cloudflare Access login (email code) → verified email
        • /mcp       → add_task · list_tasks · complete_task · get_hot_leads
                        (only the agent's enabled_tools are exposed)
                          │  POST {action, agent_email, …} + X-Norr-Secret
                          ▼
        n8n "Agent Tools Executor" webhook
          • validate_agent → clients lookup (client_id + enabled_tools)
          • else           → "Real Estate Agent Tools" sub-workflow → Neon
                              (logs agent_tools triggered/completed)
  └─ Google Calendar connector (Claude's built-in one, enabled by the agent)
```

The agent's **verified login email IS the `agent_email`** — nothing hardcoded.
Data is scoped to the `clients` row whose `primary_contact_email` matches, and
that row's `enabled_tools` array controls which tools the agent sees. Worker code
lives in `workers/agent-mcp/`; design spec + plan in `docs/superpowers/`.

## What an MCP server is (30-second version)

A small web service that tells Claude "here are some functions, here's what each
does, here are the inputs." Claude reads the descriptions and decides when to
call them. The tool **description** does the same job as a skill's description, so
write it for Claude: when to use it, what it returns.

## Connect URL

`https://agent-mcp.norrai.co/mcp` — the only thing an agent pastes into Claude.
(The old per-agent n8n MCP Server + secret-URL pilot is retired.)

## Onboard an agent (3 steps, no per-agent build)

1. **`clients` row** — agent's real email as `primary_contact_email`, plus
   `vertical`/`tier`. `enabled_tools` defaults to the core 4; set it per agent to
   grant or restrict tools.
2. **Cloudflare Access policy** — Zero Trust → Access → the `Norr AI Agent MCP —
   Authorize` app (path-scoped to `/authorize`): add the agent's email to the
   Allow policy. This is the allowlist; the email must match the `clients` row.
3. **Agent adds the connector** in their Claude app (Settings → Connectors → add
   custom connector → the URL above) and logs in with the email code, then gets a
   Claude Project (below).

The Worker, executor, and Tools sub-workflow are shared infrastructure — no new
workflow, no redeploy, no hardcoded email per agent.

## Auth model

- **Login:** Cloudflare Access (email one-time code, or Google) gates `/authorize`
  **only**; `/mcp`, `/token`, `/register`, `/.well-known/*` stay public (the OAuth
  token is the credential there). Do not gate the whole host.
- **Identity → data:** the Access-verified email must equal a
  `clients.primary_contact_email` (direct match; unknown → refused). That email is
  injected as `agent_email` on every tool call — never client-supplied, so
  per-client isolation is structural.
- **Worker ↔ n8n:** shared-secret header `X-Norr-Secret` (Worker secret
  `N8N_SHARED_SECRET` = the executor webhook's Header Auth credential). The
  executor webhook is never exposed to the agent.
- **Hardening TODO:** the Worker currently trusts the
  `Cf-Access-Authenticated-User-Email` header; verify the `Cf-Access-Jwt-Assertion`
  signature (aud + key) before a second brokerage.

## Test it yourself (server side, no browser)

```bash
curl https://agent-mcp.norrai.co/.well-known/oauth-authorization-server   # issuer = our domain
curl -i -X POST https://agent-mcp.norrai.co/mcp -d '{}'                    # 401 + WWW-Authenticate
curl -i https://agent-mcp.norrai.co/authorize                             # 302 → …cloudflareaccess.com
```

The full OAuth login + tool calls require a browser (Access email code), i.e. the
Claude app itself. After a tool runs, confirm `workflow_events` has `agent_tools`
rows.

## Give the agent a Claude Project (biases tool routing)

Custom connectors behave best inside a Claude **Project**. Without one, phrases
like *"who should I call today"* get grabbed by Claude's built-in Reminders /
Calendar connectors instead of our tools. A Project whose instructions name the
Norr AI tools fixes the routing. **One Project per agent.**

Setup (in the agent's Claude app or claude.ai — needs Pro/Max/Team):

1. Confirm the agent's custom connector **and** Google Calendar are added and enabled.
2. **Projects → New project** → name it e.g. `Norr AI — <Agent> Assistant`.
3. Paste the instructions below into the project's **instructions** box. They're
   connector-agnostic — nothing to edit.
4. *(Optional, improves answers)* Add **project knowledge**: the agent's
   territory, brokerage name, email signature, preferred call hours.
5. Make sure the connector's tools are enabled for the project, then test:
   *"who should I call today?"* must call `get_hot_leads`, **not** Reminders.

**Project instructions (paste verbatim).** Deliberately principle-based, not a
tool list — new connector tools (listings, research, …) are covered by the
principle and discovered automatically, so this rarely needs re-pasting. Per-tool
routing nudges live in each tool's n8n `description`, which propagates to every
client on its own.

> You are my real-estate assistant; I'm a real estate agent.
>
> Prefer the Norr AI connector for all my real-estate work — leads, clients,
> follow-ups, my pipeline, my to-dos/tasks, and anything else its tools cover
> (e.g. listings or property research as they're added). Use whichever Norr AI
> tool fits. In particular: when I ask who to call or who needs attention, use
> the connector's lead tool, **not** the phone's Reminders or Calendar; manage my
> tasks with the connector's task tools, **not** the Reminders app (to finish
> one, look it up first, then complete it).
>
> Use Google Calendar only for actual calendar events (showings, closings,
> meetings).
>
> Respect each lead's opt-out flags when suggesting how to reach them. Keep
> answers short and skimmable — I'm often on my phone or using voice.

## Voice

The Claude mobile app has a voice mode, so an agent can say *"what's on my plate
today?"* while driving between showings. **Verify the connector works in voice
mode on the agent's phone before leaning on it.** Tool/connector support in voice
has varied by app version and plan. Tool answers are already short, which voice
reads aloud well.

## Tools reference

| Tool | Inputs (from Claude) | Notes |
|---|---|---|
| `add_task` | `title`, `due_at` (YYYY-MM-DD or YYYY-MM-DDTHH:MM, Central), `deal_ref`, `assigned_to`, `lead_id` | Date-only = 5pm Central. A `lead_id` from another client is silently dropped. |
| `list_tasks` | `status` (open/done), `due_within_days` (-1 all, 0 overdue+today, 7 week), `assigned_to` | Max 50; returns ids for `complete_task` |
| `complete_task` | `task_id` | Scoped to the agent's client; double-complete is a no-op with a note |
| `get_hot_leads` | `days` (1–90, default 14), `limit` (1–50, default 15) | Active statuses only; includes opt-out flags and open task count |

## Adding a new tool

The connector spans three places; a new tool touches each. This is a checklist,
not a skill — the shape is stable enough that a runbook suffices.

1. **n8n — teach the Tools sub-workflow the new action** (`Real Estate Agent
   Tools`, id `wh3JN8bmLCTtPeOT`): add the action name to the `ACTIONS` array in
   **Prep Input**, add an output to **Route Action**, and add the node that does
   the work (a Postgres query, or a Call-Workflow to something like the Research
   Agent) returning a single `result` json. Keep the `triggered`/`completed`
   logging nodes. (Validation lives in Prep Input — add any new field checks there.)
2. **Worker — add it to the catalog** (`workers/agent-mcp/src/tools.ts`): one
   `ToolDef` entry — `action` (must equal the n8n action string), a Claude-facing
   `description` (when to use it; add a "prefer this over the phone's X" nudge if
   it competes with a Claude built-in), and an `inputSchema` (zod raw shape).
   That is the only Worker code change — `tools/list`, entitlement filtering, and
   the executor call are generic. `npm test`, then `wrangler deploy`.
3. **Neon — grant it** per client: add the action string to `clients.enabled_tools`
   for whoever should have it (and to the schema default in `db/schema.sql` if
   it's core). It's hidden in `tools/list` and refused on call for anyone without
   it — no redeploy needed for a grant.

Because tools are a per-client allowlist, you can ship a tool to one agent only.

## Next

- OAuth JWT hardening (verify `Cf-Access-Jwt-Assertion`) before a second brokerage.
- More tools (see "Adding a new tool"): `write_listing` → listing workflow,
  `research_property` → Research Agent.
- Skills on top: daily briefing (calendar + `list_tasks` + `get_hot_leads`), PA
  deadline extractor (PDF → calendar events + `add_task`).
