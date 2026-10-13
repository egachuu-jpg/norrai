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

export default new OAuthProvider<Env>({
  apiRoute: "/mcp",
  apiHandler: { fetch: mcpHandler },
  defaultHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  // RFC 9728 Protected Resource Metadata — required by the provider options.
  // The resource identifier is this Worker's public MCP endpoint.
  resourceMetadata: { resource: "https://agent-mcp.norrai.co" },
});
