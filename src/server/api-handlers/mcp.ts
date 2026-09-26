import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { registerBobTools } from "@/server/bob-tools";

/**
 * CodeBiome's MCP server, per docs/BOB_INTEGRATION.md. IBM Bob is an MCP
 * CLIENT (its own IDE/CLI process) that connects OUT to servers like this
 * one — nothing calls IN to Bob, and CodeBiome never talks to an "IBM Bob
 * API" because no such thing exists for embedding Bob's reasoning into
 * another app. A developer adds this endpoint to their own Bob config
 * (`.bob/mcp.json`, `type: "streamable-http"`) and asks Bob questions in
 * their IDE; Bob decides which tools below to call.
 *
 * Streamable HTTP (not legacy SSE) — the modern MCP transport, and the one
 * IBM Bob's own docs describe for remote servers. Stateless mode
 * (`sessionIdGenerator: undefined`): a fresh McpServer + transport per HTTP
 * request. This matches how the RKM cache already works (in-memory,
 * per-process — see knowledge-model/store.ts) and is the recommended shape
 * for a server that may run on serverless (Vercel): there is no long-lived
 * connection to keep alive between calls, only the shared in-memory stores
 * (`knowledgeModelStore`, `bobEventBus`, `sessionContextStore`, etc.) that
 * every request handled by THIS SAME function reads and writes — see
 * src/app/api/[...codebiome]/route.ts for why this, `/api/analyze`,
 * `/api/session-context`, and `/api/bob-events` are deliberately one
 * Vercel Function rather than four.
 */
function buildServer(): McpServer {
  const server = new McpServer({ name: "codebiome", version: "1.0.0" });
  registerBobTools(server);
  return server;
}

export async function handleMcp(req: Request): Promise<Response> {
  const server = buildServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}
