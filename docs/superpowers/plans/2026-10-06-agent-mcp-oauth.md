# Agent MCP OAuth Front Door — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an agent connect the Norr AI MCP connector in the Claude app by logging in (Cloudflare Access), with data scoped to their client and tools granted per agent.

**Architecture:** A Cloudflare Worker at `agent-mcp.norrai.co` is both the OAuth authorization server (`@cloudflare/workers-oauth-provider`) and the MCP server (`createMcpHandler` from `agents/mcp/server` — stateless, no Durable Object). Cloudflare Access gates the `/authorize` login; the verified email is injected as `agent_email` and scoped against `clients`. A single n8n "Agent Tools Executor" webhook runs the existing Tools sub-workflow, preserving `workflow_events` logging.

**Tech Stack:** Cloudflare Workers, `@cloudflare/workers-oauth-provider`, `agents` (`createMcpHandler`), `@modelcontextprotocol/sdk`, Workers KV, TypeScript, Vitest + `@cloudflare/vitest-pool-workers`, n8n, Neon Postgres.

---

## File structure

```
workers/agent-mcp/
  wrangler.jsonc          # Worker config: routes, KV, DO, vars
  package.json            # deps + scripts
  tsconfig.json
  vitest.config.ts
  .dev.vars.example       # local secrets template (never commit real .dev.vars)
  src/
    index.ts              # OAuthProvider wiring (apiHandler = mcpHandler)
    access.ts             # /authorize handler: read Access email, validate, complete grant
    mcp.ts                # mcpHandler (createMcpHandler): tools/list + tools/call
    tools.ts              # tool catalog (schemas + descriptions), pure data
    executor.ts           # callExecutor(): POST to n8n webhook with shared secret
    entitlements.ts       # filterTools(catalog, enabledTools)
    types.ts              # Env, Props, ExecutorResult types
  test/
    tools.test.ts
    executor.test.ts
    entitlements.test.ts
    access.test.ts
```

n8n: one new workflow **"Agent Tools Executor"** (built via n8n MCP tools).
Neon: `clients.enabled_tools` column added to `db/schema.sql`.

---

### Task 1: Verify current Cloudflare library APIs

No code yet — the `workers-oauth-provider` and `agents`/`McpAgent` surfaces move between versions. Confirm signatures before coding so later tasks match reality.

- [ ] **Step 1: Read the current remote-MCP-with-OAuth guide**

Fetch and read: `https://developers.cloudflare.com/agents/guides/remote-mcp-server/` and the `@cloudflare/workers-oauth-provider` README on npm.

Confirm and note in a scratch comment at the top of `workers/agent-mcp/README.md`:
- `OAuthProvider` constructor option names (`apiRoute`/`apiHandler`/`defaultHandler`/`authorizeEndpoint`/`tokenEndpoint`/`clientRegistrationEndpoint`).
- The `env.OAUTH_PROVIDER` helper methods: `parseAuthRequest(request)` and `completeAuthorization({ request, userId, scope, metadata, props })` (exact names/shape).
- `McpAgent` import path (`agents/mcp`) and how `props` are accessed inside the agent (`this.props`).
- How the agent is mounted (`AgentMCP.mount("/mcp")` vs `.serve`).

- [ ] **Step 2: Commit the note**

```bash
mkdir -p workers/agent-mcp
# write workers/agent-mcp/README.md with the confirmed API notes
git add workers/agent-mcp/README.md
git commit -m "docs(agent-mcp): confirmed Cloudflare OAuth/McpAgent API surface"
```

If any API differs from what later tasks assume, adjust those tasks' code to the confirmed signatures as you go.

---

### Task 2: Neon — `clients.enabled_tools`

**Files:**
- Modify: `db/schema.sql` (clients table block)

- [ ] **Step 1: Add the column + backfill in Neon**

Run via the Neon MCP `run_sql` (one statement per call):

```sql
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS enabled_tools text[] NOT NULL
  DEFAULT ARRAY['get_hot_leads','list_tasks','add_task','complete_task'];
```

- [ ] **Step 2: Verify the test client has the default**

```sql
SELECT primary_contact_email, enabled_tools
FROM clients WHERE primary_contact_email = 'egachuu@gmail.com';
```

Expected: `enabled_tools = {get_hot_leads,list_tasks,add_task,complete_task}`.

- [ ] **Step 3: Mirror into `db/schema.sql`**

In the `clients` CREATE TABLE block in `db/schema.sql`, add the column so the canonical schema matches:

```sql
  enabled_tools text[] NOT NULL
    DEFAULT ARRAY['get_hot_leads','list_tasks','add_task','complete_task'],
```

- [ ] **Step 4: Commit**

```bash
git add db/schema.sql
git commit -m "feat(db): add clients.enabled_tools for per-agent MCP tool entitlements"
```

---

### Task 3: n8n — Agent Tools Executor workflow

Build via the n8n MCP tools (`n8n_create_workflow`), project `dHMe2aoOwTztDaWE`. The Webhook branches on `action`: `validate_agent` does its own client lookup (returns `client_id` + `enabled_tools`); every other action runs the existing Tools sub-workflow (`wh3JN8bmLCTtPeOT`) unchanged.

**Nodes:** Webhook (POST, path `agent-tools-exec`) → Verify Secret (IF: `{{$json.headers['x-norr-secret']}}` equals `$env` secret; false → Respond 401) → Switch (`validate_agent` vs other) → [validate_agent] Postgres `SELECT id AS client_id, enabled_tools FROM clients WHERE primary_contact_email = $1` → Respond; [other] Execute Workflow (Tools sub-workflow, pass body through) → Respond to Webhook.

- [ ] **Step 1: Create the workflow**

Use `n8n_create_workflow` with the nodes above. Postgres nodes use credential `Postgres account` (`2DDeKGMIP9Ijbd9R`). Settings → Error Workflow = `Al6gagYmiq1feOWq`. Store the shared secret as an n8n env/credential, compared in the Verify Secret IF node. Use parameterized Postgres (query params), not string interpolation, for the email.

- [ ] **Step 2: Activate and capture the production URL**

Activate; record `https://norrai.app.n8n.cloud/webhook/agent-tools-exec` for the Worker's `N8N_EXECUTOR_URL`.

- [ ] **Step 3: Smoke-test each path with curl**

```bash
SECRET="<shared secret>"
URL="https://norrai.app.n8n.cloud/webhook/agent-tools-exec"
# validate_agent
curl -sS -X POST "$URL" -H "Content-Type: application/json" -H "X-Norr-Secret: $SECRET" \
  -d '{"action":"validate_agent","agent_email":"egachuu@gmail.com"}'
# get_hot_leads
curl -sS -X POST "$URL" -H "Content-Type: application/json" -H "X-Norr-Secret: $SECRET" \
  -d '{"action":"get_hot_leads","agent_email":"egachuu@gmail.com","days":14,"limit":15}'
# bad secret -> 401
curl -sS -o /dev/null -w "%{http_code}\n" -X POST "$URL" -H "X-Norr-Secret: wrong" -d '{"action":"validate_agent","agent_email":"x"}'
```

Expected: `validate_agent` returns `{client_id, enabled_tools}`; `get_hot_leads` returns the 5 test leads; bad secret returns `401`.

- [ ] **Step 4: Export + commit the workflow JSON**

Save to `n8n/workflows/Agent Tools Executor.json`; add its `workflow_name` to `n8n/README.md`.

```bash
git add "n8n/workflows/Agent Tools Executor.json" n8n/README.md
git commit -m "feat(n8n): Agent Tools Executor webhook (validate_agent + tool proxy)"
```

---

### Task 4: Worker scaffold

**Files:**
- Create: `workers/agent-mcp/package.json`, `tsconfig.json`, `vitest.config.ts`, `.dev.vars.example`, `src/types.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "agent-mcp",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@cloudflare/workers-oauth-provider": "^1.2.2",
    "@modelcontextprotocol/sdk": "^1.32.1",
    "agents": "^0.26.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250101.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0",
    "wrangler": "^3.80.0"
  }
}
```

Pin to the versions confirmed in Task 1 if they differ.

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "es2022",
    "moduleResolution": "bundler",
    "lib": ["es2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node" },
});
```

(Unit tests in Tasks 5–8 are pure logic — plain vitest, no Workers runtime needed. The Worker itself is verified end-to-end via curl in Task 11.)

- [ ] **Step 4: Create `.dev.vars.example`**

```
N8N_EXECUTOR_URL=https://norrai.app.n8n.cloud/webhook/agent-tools-exec
N8N_SHARED_SECRET=replace-me
```

- [ ] **Step 5: Create `src/types.ts`**

```ts
export interface Env {
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: any; // helper binding injected by workers-oauth-provider
  N8N_EXECUTOR_URL: string;
  N8N_SHARED_SECRET: string;
}

// Bound to the issued token; set in the /authorize handler.
export interface Props {
  email: string;
  clientId: string;
  enabledTools: string[];
  [key: string]: unknown;
}

export interface ExecutorResult {
  // tool actions return the Format Result JSON; validate_agent returns the row
  [key: string]: unknown;
}
```

- [ ] **Step 6: Install + typecheck + commit**

```bash
cd workers/agent-mcp && npm install && npm run typecheck
git add workers/agent-mcp/package.json workers/agent-mcp/tsconfig.json workers/agent-mcp/vitest.config.ts workers/agent-mcp/.dev.vars.example workers/agent-mcp/src/types.ts workers/agent-mcp/package-lock.json
git commit -m "chore(agent-mcp): worker scaffold (config, types, test harness)"
```

---

### Task 5: Tool catalog (`src/tools.ts`)

**Files:**
- Create: `workers/agent-mcp/src/tools.ts`, `workers/agent-mcp/test/tools.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/tools.test.ts
import { describe, it, expect } from "vitest";
import { TOOL_CATALOG, CORE_TOOLS } from "../src/tools";

describe("tool catalog", () => {
  it("defines the four core tools with names, descriptions, and zod input schemas", () => {
    for (const name of CORE_TOOLS) {
      const tool = TOOL_CATALOG[name];
      expect(tool, `missing ${name}`).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema).toBeTruthy();
    }
  });
  it("maps every tool to an executor action equal to its name", () => {
    for (const [name, tool] of Object.entries(TOOL_CATALOG)) {
      expect(tool.action).toBe(name);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tools` — Expected: FAIL (cannot find `../src/tools`).

- [ ] **Step 3: Implement `src/tools.ts`**

```ts
import { z } from "zod";

export interface ToolDef {
  action: string;
  description: string;
  inputSchema: z.ZodRawShape;
}

export const TOOL_CATALOG: Record<string, ToolDef> = {
  get_hot_leads: {
    action: "get_hot_leads",
    description:
      "The agent's real-estate lead pipeline from their CRM: active leads with recent activity, most promising first. Use for 'who should I call today', follow-ups, or which clients need attention. Prefer this over the phone's Reminders or Calendar for lead questions.",
    inputSchema: {
      days: z.number().int().min(1).max(90).default(14),
      limit: z.number().int().min(1).max(50).default(15),
    },
  },
  list_tasks: {
    action: "list_tasks",
    description:
      "The agent's real-estate to-do list in Norr AI. Use for what's on my plate, what's overdue, what's due this week, or what my assistant is working on. Prefer this over the phone's Reminders app. Returns task ids needed by complete_task.",
    inputSchema: {
      status: z.enum(["open", "done"]).default("open"),
      due_within_days: z.number().int().min(-1).max(365).default(-1),
      assigned_to: z.string().default(""),
    },
  },
  add_task: {
    action: "add_task",
    description:
      "Add a to-do to the agent's task list, including deadlines pulled from a purchase agreement. Link to a deal (property address) or lead when relevant. Times are Central.",
    inputSchema: {
      title: z.string().min(1).max(300),
      due_at: z.string().default(""),
      deal_ref: z.string().default(""),
      assigned_to: z.string().default(""),
      lead_id: z.string().default(""),
    },
  },
  complete_task: {
    action: "complete_task",
    description:
      "Mark one of the agent's to-dos as done. Call list_tasks first to get the task id; if several match, ask which one.",
    inputSchema: { task_id: z.string().min(1) },
  },
};

export const CORE_TOOLS = ["get_hot_leads", "list_tasks", "add_task", "complete_task"] as const;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tools` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add workers/agent-mcp/src/tools.ts workers/agent-mcp/test/tools.test.ts
git commit -m "feat(agent-mcp): tool catalog with schemas and descriptions"
```

---

### Task 6: Entitlements (`src/entitlements.ts`)

**Files:**
- Create: `workers/agent-mcp/src/entitlements.ts`, `workers/agent-mcp/test/entitlements.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/entitlements.test.ts
import { describe, it, expect } from "vitest";
import { filterTools } from "../src/entitlements";
import { TOOL_CATALOG } from "../src/tools";

describe("filterTools", () => {
  it("returns only tools present in enabledTools", () => {
    const names = filterTools(TOOL_CATALOG, ["get_hot_leads", "list_tasks"]).map((t) => t.action);
    expect(names.sort()).toEqual(["get_hot_leads", "list_tasks"]);
  });
  it("ignores unknown tool names in enabledTools", () => {
    const names = filterTools(TOOL_CATALOG, ["get_hot_leads", "write_listing"]).map((t) => t.action);
    expect(names).toEqual(["get_hot_leads"]);
  });
  it("returns empty when nothing enabled", () => {
    expect(filterTools(TOOL_CATALOG, [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- entitlements` — Expected: FAIL (cannot find module).

- [ ] **Step 3: Implement `src/entitlements.ts`**

```ts
import type { ToolDef } from "./tools";

export function filterTools(
  catalog: Record<string, ToolDef>,
  enabledTools: string[],
): ToolDef[] {
  const enabled = new Set(enabledTools);
  return Object.values(catalog).filter((t) => enabled.has(t.action));
}

export function isEntitled(enabledTools: string[], action: string): boolean {
  return enabledTools.includes(action);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- entitlements` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add workers/agent-mcp/src/entitlements.ts workers/agent-mcp/test/entitlements.test.ts
git commit -m "feat(agent-mcp): per-agent tool entitlement filtering"
```

---

### Task 7: n8n executor client (`src/executor.ts`)

**Files:**
- Create: `workers/agent-mcp/src/executor.ts`, `workers/agent-mcp/test/executor.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/executor.test.ts
import { describe, it, expect, vi } from "vitest";
import { callExecutor } from "../src/executor";

const env = { N8N_EXECUTOR_URL: "https://n8n.test/webhook/agent-tools-exec", N8N_SHARED_SECRET: "s3cr3t" } as any;

describe("callExecutor", () => {
  it("POSTs action + agent_email + args with the shared secret header", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await callExecutor(env, "get_hot_leads", "a@b.com", { days: 14 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(env.N8N_EXECUTOR_URL);
    expect(init.headers["X-Norr-Secret"]).toBe("s3cr3t");
    expect(JSON.parse(init.body)).toEqual({ action: "get_hot_leads", agent_email: "a@b.com", days: 14 });
  });
  it("throws on non-200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    await expect(callExecutor(env, "get_hot_leads", "a@b.com", {})).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- executor` — Expected: FAIL (cannot find module).

- [ ] **Step 3: Implement `src/executor.ts`**

```ts
import type { Env, ExecutorResult } from "./types";

export async function callExecutor(
  env: Env,
  action: string,
  agentEmail: string,
  args: Record<string, unknown>,
): Promise<ExecutorResult> {
  const res = await fetch(env.N8N_EXECUTOR_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Norr-Secret": env.N8N_SHARED_SECRET },
    body: JSON.stringify({ action, agent_email: agentEmail, ...args }),
  });
  if (!res.ok) throw new Error(`executor ${action} failed: ${res.status}`);
  return (await res.json()) as ExecutorResult;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- executor` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add workers/agent-mcp/src/executor.ts workers/agent-mcp/test/executor.test.ts
git commit -m "feat(agent-mcp): n8n executor client"
```

---

### Task 8: Access login handler (`src/access.ts`)

Serves `/authorize` behind Cloudflare Access. Reads the verified email, calls the executor's `validate_agent`, and completes the OAuth grant binding `{email, clientId, enabledTools}`.

**Files:**
- Create: `workers/agent-mcp/src/access.ts`, `workers/agent-mcp/test/access.test.ts`

- [ ] **Step 1: Write the failing test** (pure helper, no network)

```ts
// test/access.test.ts
import { describe, it, expect } from "vitest";
import { resolveAgent } from "../src/access";

describe("resolveAgent", () => {
  it("returns props when validate_agent finds a client", async () => {
    const call = async () => ({ client_id: "c1", enabled_tools: ["get_hot_leads"] });
    const props = await resolveAgent(call as any, {} as any, "a@b.com");
    expect(props).toEqual({ email: "a@b.com", clientId: "c1", enabledTools: ["get_hot_leads"] });
  });
  it("returns null when no client matches", async () => {
    const call = async () => ({ client_id: null });
    const props = await resolveAgent(call as any, {} as any, "nobody@x.com");
    expect(props).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- access` — Expected: FAIL (cannot find module).

- [ ] **Step 3: Implement `src/access.ts`**

```ts
import type { Env, Props } from "./types";
import { callExecutor } from "./executor";

const ACCESS_EMAIL_HEADER = "cf-access-authenticated-user-email";

export function verifiedEmail(request: Request): string | null {
  return request.headers.get(ACCESS_EMAIL_HEADER);
}

// Isolated for unit testing: given an executor caller, resolve props or null.
export async function resolveAgent(
  call: typeof callExecutor,
  env: Env,
  email: string,
): Promise<Props | null> {
  const row = (await call(env, "validate_agent", email, {})) as {
    client_id?: string | null;
    enabled_tools?: string[];
  };
  if (!row?.client_id) return null;
  return { email, clientId: row.client_id, enabledTools: row.enabled_tools ?? [] };
}

// Request handler mounted at /authorize (behind Cloudflare Access).
export async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  const email = verifiedEmail(request);
  if (!email) return new Response("Access authentication required", { status: 401 });

  const props = await resolveAgent(callExecutor, env, email);
  if (!props) {
    return new Response(
      "This email isn't linked to a Norr AI account. Contact hello@norrai.co.",
      { status: 403 },
    );
  }

  const oauthReq = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReq,
    userId: email,
    scope: oauthReq.scope,
    metadata: { email },
    props,
  });
  return Response.redirect(redirectTo, 302);
}
```

Adjust `parseAuthRequest`/`completeAuthorization` names/shape to the Task 1 confirmation if they differ.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- access` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add workers/agent-mcp/src/access.ts workers/agent-mcp/test/access.test.ts
git commit -m "feat(agent-mcp): Access login handler + agent resolution"
```

---

### Task 9: MCP server (`src/mcp.ts`)

**Files:**
- Create: `workers/agent-mcp/src/mcp.ts`

- [ ] **Step 1: Implement `src/mcp.ts` with `createMcpHandler`**

Uses Cloudflare's current `createMcpHandler` (import from `agents/mcp/server`) — stateless, no Durable Object (`McpAgent` is deprecated per Task 1). Hard requirements:
- **Only entitled tools may appear in `tools/list`** — register tools per request from the authenticated agent's `enabledTools` (read via `getMcpAuthContext()`). **Verify against the installed `agents@0.26.0` types that the auth context is readable inside the factory callback; if it is NOT, stop and report BLOCKED — do not fall back to registering all tools (that would leak tool names in `tools/list`).**
- **`tools/call` re-checks entitlement** server-side before calling n8n.
- `agent_email` sent to n8n is always the verified `props.email`, never client input.
- Obtain `env` inside the tool handler (e.g. `context.env`) for `callExecutor`; confirm the exact accessor against the installed types.

```ts
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import type { Env, Props } from "./types";
import { TOOL_CATALOG } from "./tools";
import { filterTools, isEntitled } from "./entitlements";
import { callExecutor } from "./executor";

export const mcpHandler = createMcpHandler(
  (server) => {
    const { props } = getMcpAuthContext() as { props: Props };
    for (const tool of filterTools(TOOL_CATALOG, props?.enabledTools ?? [])) {
      server.registerTool(
        tool.action,
        { description: tool.description, inputSchema: tool.inputSchema },
        async (args: Record<string, unknown>, context: any) => {
          const auth = getMcpAuthContext() as { props: Props };
          if (!isEntitled(auth.props.enabledTools ?? [], tool.action)) {
            return { content: [{ type: "text", text: "This tool isn't enabled for your account." }], isError: true };
          }
          try {
            const result = await callExecutor(context.env as Env, tool.action, auth.props.email, args);
            return { content: [{ type: "text", text: JSON.stringify(result) }] };
          } catch {
            return { content: [{ type: "text", text: "That didn't go through — please try again in a moment." }], isError: true };
          }
        },
      );
    }
  },
  { route: "/mcp" },
);
```

Adjust `getMcpAuthContext`, the `context.env` accessor, and `registerTool`'s signature to the installed `agents@0.26.0` / `@modelcontextprotocol/sdk@1.32.1` types. If the auth context is not available inside the factory callback (so per-agent `tools/list` filtering is impossible), stop and report BLOCKED with what the types allow.

- [ ] **Step 2: Typecheck + commit**

```bash
cd workers/agent-mcp && npm run typecheck
git add workers/agent-mcp/src/mcp.ts
git commit -m "feat(agent-mcp): MCP server (createMcpHandler) with entitlement-gated tools"
```

---

### Task 10: OAuth provider wiring + wrangler config

**Files:**
- Create: `workers/agent-mcp/src/index.ts`, `workers/agent-mcp/wrangler.jsonc`

- [ ] **Step 1: Implement `src/index.ts`**

```ts
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { mcpHandler } from "./mcp";
import { handleAuthorize } from "./access";
import type { Env } from "./types";

const defaultHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/authorize") return handleAuthorize(request, env);
    return new Response("Not found", { status: 404 });
  },
};

export default new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: mcpHandler,
  defaultHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
```

Confirm `apiHandler` accepts the `createMcpHandler` return value directly (per Task 1 it expects an `ExportedHandler`/fetch handler); wrap it if the installed types require it.

- [ ] **Step 2: Create `wrangler.jsonc`**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "agent-mcp",
  "main": "src/index.ts",
  "compatibility_date": "2026-10-01",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true },
  "routes": [{ "pattern": "agent-mcp.norrai.co", "custom_domain": true }],
  "kv_namespaces": [{ "binding": "OAUTH_KV", "id": "<created in step 3>" }],
  "vars": { "N8N_EXECUTOR_URL": "https://norrai.app.n8n.cloud/webhook/agent-tools-exec" }
}
```

- [ ] **Step 3: Create the KV namespace and paste the id**

Run: `cd workers/agent-mcp && npx wrangler kv namespace create OAUTH_KV`
Paste the returned id into `wrangler.jsonc`.

- [ ] **Step 4: Typecheck + commit**

```bash
cd workers/agent-mcp && npm run typecheck
git add workers/agent-mcp/src/index.ts workers/agent-mcp/wrangler.jsonc
git commit -m "feat(agent-mcp): OAuth provider wiring + wrangler config"
```

---

### Task 11: Deploy + Cloudflare Access + end-to-end

These are console/CLI steps (the user runs interactive bits with `! <cmd>`); verify after each.

- [ ] **Step 1: Set the shared secret**

Run: `cd workers/agent-mcp && npx wrangler secret put N8N_SHARED_SECRET` (enter the same secret the n8n Verify Secret node checks).

- [ ] **Step 2: Deploy + DNS**

Run: `npx wrangler deploy`. Confirm `agent-mcp.norrai.co` resolves (the `custom_domain` route provisions it; add the DNS record in the Cloudflare dashboard if prompted).

- [ ] **Step 3: Configure Cloudflare Access**

In Cloudflare Zero Trust → Access → Applications: create a **self-hosted** app for `agent-mcp.norrai.co/authorize` (path-scoped). Policy: allow emails `egachuu@gmail.com` (add Weichert agent emails later), identity method email-OTP (and/or Google). Leave all other paths unprotected.

- [ ] **Step 4: Verify discovery + no-auth boundary**

```bash
curl -sS https://agent-mcp.norrai.co/.well-known/oauth-authorization-server | head -5
curl -sS -o /dev/null -w "authorize HTTP %{http_code}\n" https://agent-mcp.norrai.co/authorize
```

Expected: AS metadata with `issuer: https://agent-mcp.norrai.co`; `/authorize` redirects to the Access login (302/login page), not our handler directly.

- [ ] **Step 5: End-to-end from the Claude app (acceptance)**

Add `https://agent-mcp.norrai.co/mcp` as a custom connector. Log in via Access as `egachuu@gmail.com`. Confirm: connection succeeds (no `invalid_target`); `tools/list` shows exactly the test client's `enabled_tools`; run all four tools against the test client; `workflow_events` shows `agent_tools` rows. Then test voice.

- [ ] **Step 6: Entitlement check**

```sql
UPDATE clients SET enabled_tools = ARRAY['get_hot_leads']
WHERE primary_contact_email = 'egachuu@gmail.com';
```
Reconnect in the Claude app; confirm only `get_hot_leads` appears. Restore the full array afterward.

---

### Task 12: Cutover + docs

- [ ] **Step 1: Retire the pilot**

After the OAuth path is green, deactivate + delete the per-agent MCP Server workflow (`qmQNADSrumrjsfgP`) and delete its secret path. Keep the Tools sub-workflow (`wh3JN8bmLCTtPeOT`) and the new Executor.

- [ ] **Step 2: Update `docs/agent-mcp-server.md`**

Replace §4/§5 connector instructions with the OAuth URL (`https://agent-mcp.norrai.co/mcp`) and the "log in via Access" flow; note onboarding = add email to Access policy + `clients` row + `enabled_tools`. Keep §6 (Claude Project).

- [ ] **Step 3: Update memory + close the Neon task**

Update memory `agent_mcp_connector_live` (new URL, OAuth model, per-agent entitlements). Mark Neon task `274ffb5b` completed.

- [ ] **Step 4: Commit**

```bash
git add docs/agent-mcp-server.md
git commit -m "docs(agent-mcp): cut connector over to OAuth front door"
```

---

## Self-review

**Spec coverage:** OAuth AS on our domain (Tasks 10–11), Cloudflare Access login (Tasks 8, 11), direct email→client match (Tasks 3, 8), MCP server + tool catalog (Tasks 5, 9), per-agent entitlements incl. `tools/list` hide + `tools/call` enforce + freshness-on-reconnect (Tasks 2, 6, 9, 11 step 6), n8n executor preserving logging (Task 3), error handling (Tasks 7–9 error branches, Task 3 401), security/shared-secret (Tasks 3, 7, 11 step 1), testing (Tasks 5–8 unit + 11 e2e), parallel-run rollout + cutover (Tasks 11–12). All spec sections map to tasks.

**Placeholder scan:** No TBD/TODO. The only "adjust to confirmed API" notes (Tasks 8–9) are deliberate, tied to the Task 1 verification of version-sensitive external libraries — concrete code is provided to adjust from, not omitted.

**Type consistency:** `Props {email, clientId, enabledTools}` is produced in `resolveAgent` (Task 8) and consumed in the MCP tool handlers (Task 9). `callExecutor(env, action, agentEmail, args)` signature matches across Tasks 7, 8, 9. `ToolDef {action, description, inputSchema}` defined in Task 5, used in Tasks 6, 9. `filterTools`/`isEntitled` names consistent (Tasks 6, 9). `X-Norr-Secret` header consistent (Tasks 3, 7).
