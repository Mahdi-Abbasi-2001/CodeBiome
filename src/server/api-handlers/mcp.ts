import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { registerMcpTools } from "@/server/mcp-tools";

/**
 * CodeBiome's MCP server. Any spec-compliant MCP client that supports
 * Streamable HTTP can connect here — Claude Desktop/Code, Cursor, Cline,
 * Windsurf, IBM Bob, or a generic client — see docs/MCP_CLIENTS.md for
 * per-client config. A developer adds this endpoint's URL to their own
 * client's MCP config and asks it questions; the agent decides which tools
 * below to call.
 *
 * Streamable HTTP (not legacy SSE) — the modern MCP transport. Stateless
 * mode (`sessionIdGenerator: undefined`): a fresh McpServer + transport per
 * HTTP request — the recommended shape for a server that may run on
 * serverless (Vercel), since there is no long-lived connection to keep alive
 * between calls, only the shared in-memory stores (`activityEventBus`,
 * `sessionContextStore`, etc.) that every request handled by THIS SAME
 * function reads and writes — see src/app/api/bridge/[target]/route.ts for
 * why this, `/api/analyze`, `/api/session-context`, and `/api/agent-events`
 * are deliberately one Vercel Function rather than four.
 *
 * `defaultWorldId` is derived from THIS request's own `?worldId=` query
 * param — never from shared/global state — so it scopes only to whatever
 * URL a specific developer's client config points at (docs/
 * WORLD_ARCHITECTURE.md §4). Two different agents/developers hitting this
 * same deployed instance without an explicit `worldId` in their own config
 * resolve independently instead of colliding on each other's World.
 */
function buildServer(defaultWorldId?: string): McpServer {
  const server = new McpServer({ name: "codebiome", version: "1.0.0" });
  registerMcpTools(server, { defaultWorldId });
  return server;
}

export async function handleMcp(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const defaultWorldId = url.searchParams.get("worldId") ?? undefined;

  const server = buildServer(defaultWorldId);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}
