import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerMcpTools } from "../src/server/mcp-tools";

/**
 * A local, stdio-transport entry point to the SAME tool set `/api/mcp`
 * serves over HTTP (see src/server/api-handlers/mcp.ts) — for clients that
 * prefer to spawn a local process rather than connect to a remote URL
 * (docs/MCP_CLIENTS.md). Reuses `registerMcpTools` directly, so there is no
 * second implementation of any tool to keep in sync.
 *
 * No `defaultWorldId` here — a stdio session is inherently single-developer/
 * single-process already, so every call should just pass an explicit
 * worldId (from analyze_repository's result) or owner/repo.
 *
 * Storage: whichever WorldStore `src/server/world/worldStore.ts` selects
 * from this process's own environment — `FileWorldStore` (the OS temp dir)
 * if no Blob credentials are set, matching a `next dev` instance running on
 * the same machine, so a World created here is immediately visible at
 * http://localhost:3000/world/<id>; or `BlobWorldStore` if you export the
 * same `BLOB_READ_WRITE_TOKEN`/`BLOB_STORE_ID` a deployed instance uses.
 *
 * Uses relative imports (not the `@/*` alias) deliberately, so this file
 * doesn't depend on `tsx` resolving tsconfig path aliases.
 */
async function main() {
  const server = new McpServer({ name: "codebiome", version: "1.0.0" });
  registerMcpTools(server);
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
