# Agent MCP Connector — Setup Guide

Lets a real estate agent (or their assistant) manage to-dos and check hot leads
by talking to Claude, by typing or with voice, in the Claude app. n8n is the engine; Claude is the
interface.

```
Claude app (agent's phone / desktop)
  └─ Norr AI connector  →  n8n "Real Estate Agent MCP Server"  (MCP Server Trigger)
                             ├─ add_task       ┐
                             ├─ list_tasks     ├─→ "Real Estate Agent Tools" sub-workflow → Neon
                             ├─ complete_task  │     (logs agent_tools triggered/completed)
                             └─ get_hot_leads  ┘
  └─ Google Calendar connector (Claude's built-in one, enabled by the agent, so we don't build calendar access)
```

## What an MCP server is (30-second version)

A small web service that tells Claude "here are some functions, here's what each
does, here are the inputs." Claude reads the descriptions and decides when to
call them. The tool **description** does the same job as a skill's description, so
write it for Claude: when to use it, what it returns.

## 1. Database

Apply the new table to Neon (one statement per `run_sql` call if using the Neon
MCP; or just re-run the file, since the new block is idempotent):

```bash
psql "$DATABASE_URL" -f db/schema.sql   # agent_tasks uses IF NOT EXISTS / OR REPLACE
```

Re-running the whole file errors on older non-idempotent tables, so for prod it's
cleaner to run just the `AGENT TASKS` block at the bottom of `db/schema.sql`.

## 2. Import the workflows (order matters)

1. Import `n8n/workflows/Real Estate Agent Tools.json`. Confirm:
   - Postgres nodes use the `Postgres account` credential.
   - Settings → Error Workflow = `Norr AI Workflow Error Logger`.
2. Import `n8n/workflows/Real Estate Agent MCP Server.json`, then **per agent**:
   - In each of the 4 tool nodes: re-select **Real Estate Agent Tools** in the
     workflow picker (IDs change on import) and replace `REPLACE_WITH_AGENT_EMAIL`
     with the agent's `clients.primary_contact_email`.
   - MCP Server Trigger: set the path (replace `REPLACE_WITH_SLUG`, e.g. `evan`)
     and choose auth (see §4).
   - Activate. Production URL: `https://norrai.app.n8n.cloud/mcp/<path>`
     (`/mcp-test/` is the test URL; never give that to a client).
3. Open each node after import: these node types (MCP trigger, Call Workflow
   Tool, Switch in expression mode) were hand-written JSON and haven't been
   round-tripped through n8n yet. If any field comes in blank, set it in the UI
   to match the table below.

| Node | Key settings |
|---|---|
| Norr AI MCP Server | Path `norrai-agent-<slug>`, auth per §4 |
| add_task / list_tasks / complete_task / get_hot_leads | Workflow = Real Estate Agent Tools; `action` fixed to the node name; `agent_email` fixed; other inputs use `$fromAI(...)` |
| Route Action (Switch) | Mode: Expression, 4 outputs, output = `{{ $json.action_index }}` (0 add, 1 list, 2 complete, 3 hot leads) |

## 3. Test it yourself first (Claude Code)

```bash
claude mcp add --transport http norrai-evan https://norrai.app.n8n.cloud/mcp/norrai-agent-evan \
  --header "Authorization: Bearer <token>"
```

Then in Claude Code: *"add a task to order the inspection for 412 Elm by Thursday"*,
*"what's on my plate this week?"*, *"mark the inspection done"*, *"who should I call today?"*.
Check `workflow_events` for `agent_tools` rows.

## 4. Auth: pilot vs. real

| | How | Good for |
|---|---|---|
| **Bearer token** (n8n trigger auth = Bearer) | Header on every request | Your own testing in Claude Code / Claude Desktop config |
| **Secret URL** (trigger auth = None, path includes a long random string) | The URL *is* the password | A short pilot in the agent's Claude app, since Claude's custom connector screen takes a URL and handles OAuth but may not accept a pasted static token. Rotate by changing the path. |
| **OAuth** (Cloudflare Worker MCP template in front of n8n) | Agent logs in once; we know who they are without hardcoding `agent_email` | Anything beyond the pilot |

`get_hot_leads` returns lead names, emails and phones, so the secret-URL option is
pilot-only. Move to OAuth before a second brokerage. The Cloudflare Access +
Token Check pattern used for the HTML forms does **not** apply here.

## 5. Connect it in the agent's Claude app

1. Claude settings → Connectors → add a custom connector → paste the MCP URL.
2. Enable Google Calendar in the same screen (Claude's built-in connector).
3. Test by text, then by voice (see below).

## Voice

The Claude mobile app has a voice mode, so an agent can say *"what's on my plate
today?"* while driving between showings. **Verify that our custom connector
works in voice mode on the pilot agent's phone before pitching it.** Tool and
connector support in voice has varied by app version and plan. Keep tool answers short (they already are) since voice reads
them aloud.

## Tools reference

| Tool | Inputs (from Claude) | Notes |
|---|---|---|
| `add_task` | `title`, `due_at` (YYYY-MM-DD or YYYY-MM-DDTHH:MM, Central), `deal_ref`, `assigned_to`, `lead_id` | Date-only = 5pm Central. A `lead_id` from another client is silently dropped. |
| `list_tasks` | `status` (open/done), `due_within_days` (-1 all, 0 overdue+today, 7 week), `assigned_to` | Max 50; returns ids for `complete_task` |
| `complete_task` | `task_id` | Scoped to the agent's client; double-complete is a no-op with a note |
| `get_hot_leads` | `days` (1–90, default 14), `limit` (1–50, default 15) | Active statuses only; includes opt-out flags and open task count |

## Next

- Skills on top: daily briefing (calendar + `list_tasks` + `get_hot_leads`), PA
  deadline extractor (PDF → calendar events + `add_task`), listing writer.
- More tools: `write_listing` → listing workflow, `research_property` → Research Agent.
- OAuth front door (Cloudflare Worker) → drop the per-agent hardcoded email.
