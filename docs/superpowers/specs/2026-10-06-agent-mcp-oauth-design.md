# Agent MCP Connector — OAuth Front Door

**Date:** 2026-10-06
**Status:** Design approved; ready for implementation planning
**Related:** `docs/agent-mcp-server.md`, Neon task `274ffb5b` (OAuth front door), memory `agent_mcp_connector_live`

## Goal

Let a real-estate agent connect the Norr AI MCP connector in the Claude app by
**logging in** (not pasting a secret URL), so that:

- Agent identity comes from a verified login, not a hardcoded `agent_email`.
- Data is scoped to the agent's own client automatically.
- Each agent sees only the tools we've granted them.
- We stop minting one n8n workflow per agent and retire the fragile n8n
  MCP-trigger node.

This closes the security task before onboarding a second brokerage and replaces
the current secret-URL pilot.

## Problem / why the pilot is blocked

The Claude app's custom-connector flow performs OAuth discovery. The n8n Cloud
domain serves its own instance-level OAuth metadata at
`/.well-known/oauth-authorization-server` (200), so Claude tries to authorize our
per-workflow webhook against n8n's OAuth server, which doesn't govern that
resource → `invalid_target` / "Resource is not available for authorization." A
no-auth secret URL can't dodge this, because Claude bails at OAuth discovery on
the shared n8n domain before it ever reaches our auth setting. The fix is to
serve the connector from our own domain with a real OAuth authorization server.

## Non-goals

- No change to the Tools sub-workflow's SQL or the `workflow_events` logging
  standard — it is reused as-is.
- No new end-customer-facing UI.
- Not building a general multi-tenant auth platform — just this connector.
- Google-direct / managed-auth (Stytch/WorkOS) were considered and rejected in
  favor of Cloudflare Access (already in the stack).

## Architecture (approach A)

A Cloudflare Worker is **both** the OAuth authorization server **and** the MCP
server. n8n remains the tool executor. Cloudflare Access is the upstream login.

```
Claude app (MCP client)
  │  OAuth 2.0 (DCR + PKCE) + MCP Streamable HTTP
  ▼
agent-mcp.norrai.co  — Cloudflare Worker  (workers/agent-mcp/)
  ├─ OAuth provider (@cloudflare/workers-oauth-provider)
  │   ├─ /.well-known/oauth-authorization-server + oauth-protected-resource  (OUR domain)
  │   ├─ /authorize   ← gated by Cloudflare Access app (path-scoped to /authorize)
  │   ├─ /token, /register
  │   └─ tokens/grants in KV
  ├─ Login handler (/authorize): reads Access-verified email → validates against
  │   clients.primary_contact_email → binds {email, client_id} to the token
  └─ MCP server (createMcpHandler — stateless, no Durable Object)
        ├─ tools/list  → only this client's enabled_tools
        └─ tools/call  → re-check entitlement, then POST to n8n executor
                          with agent_email = verified email + shared secret
                          │
                          ▼
            n8n "Agent Tools Executor" (Webhook → verify secret →
            Execute Workflow "Real Estate Agent Tools" → Respond)
                          │
                          ▼
                   Neon (Lookup Client, SQL, workflow_events log)
```

### Components (each independently understandable/testable)

1. **OAuth provider** — Cloudflare's `@cloudflare/workers-oauth-provider` wraps
   the Worker. Serves discovery docs on our domain, `/authorize`, `/token`,
   `/register` (dynamic client registration + PKCE). Persists grants/tokens in a
   **KV** namespace. Depends on: KV binding.
2. **Login handler** (`/authorize`) — the provider's default handler, gated by a
   **Cloudflare Access application scoped to `agent-mcp.norrai.co/authorize`
   only** (all other routes public so Claude can call them with a token). Reads
   the Access-verified email (`Cf-Access-Authenticated-User-Email` /
   `Cf-Access-Jwt-Assertion`), validates it against `clients`, and on match
   completes the grant binding `{email, client_id}`. Depends on: Access config,
   client lookup (via the n8n executor or a small read).
3. **MCP server** — Cloudflare's `createMcpHandler` (`agents/mcp/server`),
   stateless per request (no Durable Object; `McpAgent` is deprecated per Task 1).
   Holds the full tool catalog (schemas + descriptions, versioned in repo).
   `tools/list` returns only the client's entitled tools (registered per request
   from the auth context); `tools/call` re-checks entitlement then calls the n8n
   executor with the verified `agent_email`. Depends on: executor URL + shared
   secret; OAuth props via `getMcpAuthContext()`.
4. **n8n Agent Tools Executor** — one webhook workflow wrapping the existing
   Tools sub-workflow. Depends on: shared secret, `wh3JN8bmLCTtPeOT`.

## Auth & data flow (happy path)

1. Agent adds `https://agent-mcp.norrai.co/mcp` in the Claude app.
2. Claude discovers **our** AS metadata, does dynamic client registration, starts
   auth-code + PKCE, opens `/authorize` in a browser.
3. Cloudflare Access intercepts `/authorize`; agent logs in (email OTP or Google
   Workspace). Verified email reaches the Worker.
4. Worker confirms `email ∈ clients.primary_contact_email`, completes the grant,
   redirects back; Claude exchanges the code at `/token` for an access token
   bound to `{email, client_id}`.
5. Claude calls `/mcp` with the token; the provider validates it and hands
   `{email, client_id}` to the McpAgent.
6. `tools/call` → Worker POSTs `{action, agent_email: <verified email>, …args}`
   + `X-Norr-Secret` to the executor webhook → n8n Lookup Client + SQL +
   `workflow_events` log → Worker relays the result to Claude.

**Invariant:** `agent_email` is always the Access-verified identity, never
client-supplied. Per-client isolation is structural.

## Per-agent tool entitlements

- **Source of truth:** a new `clients.enabled_tools text[]` column, default the
  core 4 (`get_hot_leads, list_tasks, add_task, complete_task`). May be seeded
  from `clients.tier` and overridden per client. (Promote to an
  `agent_tool_access` table only if per-tool config is later needed — YAGNI.)
- **`tools/list`:** returns only the client's `enabled_tools`; unentitled tools
  never appear in the agent's Claude.
- **`tools/call`:** re-checks entitlement server-side and rejects unentitled
  calls before touching n8n. The Worker is the single enforcement boundary;
  n8n trusts the Worker (shared secret).
- **Freshness:** entitlements are read at session start (`tools/list`) and used
  for that session; a Neon change takes effect on the agent's next reconnect
  (no stale-forever tokens).

## Data model changes (Neon)

- `ALTER TABLE clients ADD COLUMN enabled_tools text[] NOT NULL DEFAULT
  ARRAY['get_hot_leads','list_tasks','add_task','complete_task'];`
- Backfill existing real-estate clients with the default; adjust per agent as
  needed. Add to `db/schema.sql`.

## Error handling

- Email not in `clients` → deny at `/authorize`, no token:
  "This email isn't linked to a Norr AI account — contact hello@norrai.co."
- Unentitled tool call → MCP tool error; never reaches n8n.
- n8n executor error/timeout → short friendly tool error, no internals leaked;
  n8n logging nodes keep `continueOnFail`.
- Bad/expired token → 401; Claude re-runs the auth flow.
- Shared-secret mismatch on the executor webhook → n8n responds 401.
- Access misconfig / missing verified email → fail closed (deny), never issue a
  token.

## Security

- Cloudflare Access gates the human login (Access policy = allowlist layer 1;
  `clients` match = layer 2).
- The executor webhook is only called server-side by the Worker, protected by a
  shared-secret header; never exposed to Claude or the agent.
- Tokens scoped to one `{email, client_id}` with TTL in KV; refresh supported by
  the provider. A leaked token is confined to one client.
- `agent_email` is never client-supplied → no cross-client access path.

## Testing

- **Worker unit (vitest + Miniflare):** email→client validation (match/no-match),
  `enabled_tools` filtering in `tools/list`, `tools/call` entitlement rejection,
  n8n payload shape.
- **Executor webhook integration:** curl each action with the shared secret;
  assert the 4 actions succeed and a bad secret returns 401.
- **OAuth metadata:** curl `/.well-known/*`, `/register`, `/token` shape checks.
- **Manual end-to-end (acceptance):** connect from the Claude app as
  `egachuu@gmail.com` via Access → `tools/list` shows only that client's
  entitled tools → run all four tools against the test client → confirm
  `workflow_events` rows. Voice check last.

## Rollout (parallel run, per CLAUDE.md)

1. Add `enabled_tools`; build the Executor workflow; build + deploy the Worker to
   `agent-mcp.norrai.co`; configure the Access app on `/authorize` and allow
   `egachuu@gmail.com` (+ later the Weichert agent emails).
2. Keep the secret-URL connector live in parallel — zero downtime.
3. Validate the full OAuth flow end-to-end on your account against the test
   client.
4. Once green, retire the per-agent MCP Server workflow (`qmQNADSrumrjsfgP`) +
   secret path; re-point `docs/agent-mcp-server.md` to the OAuth URL.
5. Onboarding a real agent = add their email to the Access policy + ensure a
   `clients` row with that email and the right `enabled_tools`. No new workflow,
   no redeploy.

## Open decisions (defaults chosen; confirm at planning)

- **Repo location:** `workers/agent-mcp/` (new top-level `workers/` dir).
- **Hostname:** `agent-mcp.norrai.co`.
- **Client lookup during `/authorize`:** reuse the n8n executor with a dedicated
  `validate_agent` action vs. a direct Neon read from the Worker. Lean: a small
  read action through the same executor to keep DB access in one place.
- **Token/grant store:** Workers KV (provider default).
- **MCP server impl:** Cloudflare `createMcpHandler` (`agents/mcp/server`, stateless) + `workers-oauth-provider`. `McpAgent` was the original assumption but is deprecated/feature-frozen (Task 1).

## References

- Cloudflare "Build a remote MCP server" (OAuthProvider + McpAgent).
- `@cloudflare/workers-oauth-provider`.
- MCP authorization spec (OAuth 2.0, DCR, PKCE, protected-resource metadata).
- `docs/agent-mcp-server.md` §4 (auth options), §6 (Claude Project).
