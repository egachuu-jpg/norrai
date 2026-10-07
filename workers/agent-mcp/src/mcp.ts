import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import { McpServer } from "@modelcontextprotocol/server";
import { env } from "cloudflare:workers";
import type { Env, Props } from "./types";
import { TOOL_CATALOG } from "./tools";
import { filterTools, isEntitled } from "./entitlements";
import { callExecutor } from "./executor";

/**
 * Stateless MCP server (no Durable Object).
 *
 * `createMcpHandler` takes a *factory* that constructs a fresh `McpServer`
 * per request, and runs that factory inside an AsyncLocalStorage scope that
 * carries the OAuth application props. That means `getMcpAuthContext()` is
 * readable both here (at registration time) and inside each tool handler.
 *
 * Because the factory runs per request with the auth context live, we can
 * register ONLY the tools the authenticated agent is entitled to. Un-entitled
 * tools are never registered, so they never appear in `tools/list`.
 */
export const mcpHandler = createMcpHandler(
  () => {
    const server = new McpServer({ name: "norrai-agent-mcp", version: "1.0.0" });

    const props = (getMcpAuthContext()?.props ?? {}) as Props;
    const enabledTools = props.enabledTools ?? [];

    for (const tool of filterTools(TOOL_CATALOG, enabledTools)) {
      server.registerTool(
        tool.action,
        { description: tool.description, inputSchema: tool.inputSchema },
        async (args) => {
          // Re-read the auth context at call time and re-check entitlement
          // server-side before touching n8n. Never trust the registration-time
          // snapshot or any client-supplied identity.
          const callProps = (getMcpAuthContext()?.props ?? {}) as Props;
          if (!isEntitled(callProps.enabledTools ?? [], tool.action)) {
            return {
              content: [{ type: "text" as const, text: "This tool isn't enabled for your account." }],
              isError: true,
            };
          }
          try {
            // agent_email is always the verified prop from the OAuth token.
            const result = await callExecutor(
              env as unknown as Env,
              tool.action,
              callProps.email,
              args as Record<string, unknown>,
            );
            return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
          } catch {
            return {
              content: [{ type: "text" as const, text: "That didn't go through — please try again in a moment." }],
              isError: true,
            };
          }
        },
      );
    }

    return server;
  },
  { route: "/mcp" },
);
