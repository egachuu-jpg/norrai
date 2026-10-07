# agent-mcp Worker

Cloudflare Worker that acts as both an OAuth 2.1 Authorization Server (via
`@cloudflare/workers-oauth-provider`) and an MCP server (via the Cloudflare
Agents SDK), fronting an n8n webhook for NorrAI client tooling.

---

## API notes (verified 2026-10-06)

### `OAuthProvider` constructor options

Source: `OAuthProviderOptions<Env>` in `@cloudflare/workers-oauth-provider`.

```ts
import OAuthProvider from "@cloudflare/workers-oauth-provider";

export default new OAuthProvider({
  apiRoute: "/mcp",                        // string | string[]
  apiHandler: MyMCP.serve("/mcp"),         // ExportedHandlerWithFetch | WorkerEntrypointClass
  // apiHandlers: { ... }                  // alternative: map of path → handler
  defaultHandler: GitHubHandler,           // handles /authorize UI, etc.
  authorizeEndpoint: "/authorize",         // required
  tokenEndpoint: "/token",                 // required
  clientRegistrationEndpoint: "/register", // optional
  scopesSupported: ["read", "write"],      // optional
  resourceMetadata: {                      // optional (OAuthProtectedResourceMetadata)
    resource: "https://...",
    authorization_servers: ["https://..."],
  },
  requiredScopes: ["read"],               // optional
  accessTokenTTL: 3600,                   // optional, seconds
  // ... additional optional fields below
});
```

All options confirmed against `src/oauth-provider.ts` in the repo.
`apiRoute`/`apiHandler`/`defaultHandler`/`authorizeEndpoint`/`tokenEndpoint`/`clientRegistrationEndpoint`
match the names the plan assumed. `apiHandlers` (plural) is an additional
multi-route variant not mentioned in the plan.

---

### `env.OAUTH_PROVIDER` helper methods

These are injected onto `env` by the `OAuthProvider` wrapper when your
`defaultHandler` (the authorize-endpoint handler) runs.

#### `parseAuthRequest(request)`

```ts
const oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
// Returns: AuthRequest
// Throws on missing/unsupported response_type or unregistered client.
```

`AuthRequest` fields include `responseType`, `clientId`, `redirectUri`,
`scope`, `state`, and PKCE fields.

#### `completeAuthorization(options)`

```ts
const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
  request: oauthReqInfo,   // AuthRequest from parseAuthRequest()
  userId: "user-123",      // string — non-empty, must not contain ':'
  metadata: { ... },       // any — stored with the grant
  scope: ["read"],         // string[] — granted scopes
  props: { ... },          // any — forwarded to the MCP handler as auth props
  revokeExistingGrants: true, // optional, defaults to true
});
// Returns: { redirectTo: string }
```

Both method names (`parseAuthRequest`, `completeAuthorization`) and the
`completeAuthorization` option shape (`request`, `userId`, `scope`,
`metadata`, `props`) match exactly what the plan assumed.

---

### `McpAgent` — DEPRECATED (feature-frozen)

**This is the most important divergence from the plan.**

`McpAgent` is still available but is officially deprecated and feature-frozen.
Cloudflare recommends migrating to `createMcpHandler` for all new servers.

```ts
// Legacy path — do NOT use for new builds
import { McpAgent } from "agents/mcp";

export class MyMCP extends McpAgent<Env, State, Props> {
  async init() { /* register tools on this.server */ }
}

// Mount (deprecated pattern):
export default MyMCP.serve("/mcp");
// or with options:
export default MyMCP.serve("/mcp", { jurisdiction: "eu" });
```

- Import path: `"agents/mcp"` — confirmed (matches plan's assumption).
- Props access inside agent: `this.props` (third generic `Props` type
  parameter; described in docs as "user identity and tokens from OAuth").
- Mount method: `MyMCP.serve("/mcp")` — NOT `.mount()`. The plan named it
  `AgentMCP.mount("/mcp")` — **the real method is `.serve()`**.

---

### `createMcpHandler` — current recommended API

```ts
import { createMcpHandler } from "agents/mcp/server";
// Note: import is from "agents/mcp/server", not "agents/mcp"

const handler = createMcpHandler(
  (server) => {
    // server is a fresh McpServer instance per request
    server.registerTool("my-tool", { description: "...", inputSchema: { ... } },
      async (args, context) => {
        // OAuth-provided identity available at:
        const clientId = context.http?.authInfo?.clientId;
        const scopes   = context.http?.authInfo?.scopes;
        // Application props (from completeAuthorization's props field):
        const auth = getMcpAuthContext();  // returns { props: Record<string,unknown> }
        return { content: [{ type: "text", text: "..." }] };
      }
    );
  },
  {
    route: "/mcp",               // default "/mcp"
    authContext: McpAuthContext, // application props from getMcpAuthContext()
    corsOptions: { ... },        // optional
    responseMode: "auto",        // "auto" | "json" | "sse"
    legacy: "stateless",         // "stateless" | "reject"
  }
);
```

- Import path: `"agents/mcp/server"` (different from deprecated `"agents/mcp"`).
- Stateless per-request — no Durable Object required.
- OAuth props flow: `completeAuthorization({ props: {...} })` → stored by
  `OAuthProvider` → surfaced at `context.http.authInfo` in tool handlers;
  application-level props via `getMcpAuthContext()`.

**For integration with `OAuthProvider`, pass `createMcpHandler(...)` (or
`MyMCP.serve(...)` if staying legacy) as the `apiHandler` option.**

---

## Divergences from the plan's assumptions

| Plan assumed | Reality |
|---|---|
| `McpAgent` is the current API | `McpAgent` is **deprecated + feature-frozen**; use `createMcpHandler` for new builds |
| Mount: `AgentMCP.mount("/mcp")` | Correct class method is `.serve("/mcp")`, not `.mount()` |
| `McpAgent` import: `"agents/mcp"` | Confirmed correct for legacy path; new handler imports from `"agents/mcp/server"` |
| `this.props` inside agent | Confirmed for `McpAgent`; in `createMcpHandler` context, use `context.http.authInfo` + `getMcpAuthContext()` |

---

## Recommended versions

| Package | Current version |
|---|---|
| `@cloudflare/workers-oauth-provider` | `1.2.2` |
| `agents` | `0.26.0` |
| `@modelcontextprotocol/sdk` | `1.32.1` |

Versions sourced from npm registry 2026-10-06.
