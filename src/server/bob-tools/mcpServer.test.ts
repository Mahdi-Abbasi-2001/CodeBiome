import { describe, it, expect, beforeAll, vi, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { seedWorld } from "@/server/testing/worldFixture";
import { buildTestKnowledgeModel } from "@/server/testing/knowledgeModelFixture";
import { knowledgeModelStore } from "@/server/knowledge-model/store";
import { registerBobTools } from "./index";

/**
 * End-to-end through the REAL MCP protocol layer (JSON-RPC + zod input
 * validation + tool dispatch), not just the underlying functions — an
 * in-process client/server pair connected by InMemoryTransport, the same
 * mechanism the MCP SDK itself uses for testing. This is the closest thing
 * to "IBM Bob connects and calls a tool" that can run in a unit test
 * without an HTTP server. src/app/api/mcp/route.ts wires the same
 * `registerBobTools` call into the real Streamable HTTP transport.
 */
async function connectedClient(): Promise<Client> {
  const server = new McpServer({ name: "codebiome-test", version: "1.0.0" });
  registerBobTools(server);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

const APP = {
  "src/index.js": `require('./orderController');\n`,
  "src/orderController.js": `const orderService = require('./orderService');\napp.get('/api/orders', orderService.list);\n`,
  "src/orderService.js": `module.exports.list = () => [];\n`,
};

describe("CodeBiome MCP server", () => {
  beforeAll(async () => {
    await seedWorld(APP, { owner: "mcp-test", repo: "app" });
  });

  it("advertises all 24 Bob-facing tools with valid JSON schemas", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "analyze_repository",
        "advance_onboarding_step",
        "contribute_domain_concept",
        "create_onboarding_journey",
        "find_feature",
        "focus_flow_step",
        "get_current_context",
        "get_file",
        "get_flow",
        "get_module",
        "get_module_dependencies",
        "get_repository_overview",
        "list_domain_concepts",
        "list_feature_plans",
        "list_flows",
        "list_onboarding_journeys",
        "open_file",
        "open_module",
        "propose_feature_plan",
        "search_repository",
        "show_dependencies",
        "show_impact",
        "start_flow",
        "trace_dependency_path",
      ].sort()
    );
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("calls a real tool over the protocol and gets real repository data back", async () => {
    const client = await connectedClient();
    const result: any = await client.callTool({ name: "get_repository_overview", arguments: { owner: "mcp-test", repo: "app" } });
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.repositoryId).toBe("mcp-test/app");
    expect(payload.entryPoints.length).toBeGreaterThan(0);
  });

  it("rejects invalid tool arguments at the protocol layer (zod schema), not deep inside application code", async () => {
    const client = await connectedClient();
    const result: any = await client.callTool({ name: "get_module", arguments: { owner: "mcp-test" /* missing required moduleId */ } });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/invalid arguments/i);
  });

  it("surfaces a missing-entity error as isError, not a thrown protocol fault", async () => {
    const client = await connectedClient();
    const result: any = await client.callTool({ name: "get_module", arguments: { moduleId: "no-such-module", owner: "mcp-test", repo: "app" } });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/no module/i);
  });

  it("rejects a call for a repository CodeBiome hasn't analyzed, with an actionable message", async () => {
    const client = await connectedClient();
    const result: any = await client.callTool({ name: "get_repository_overview", arguments: { owner: "never-seen", repo: "nope" } });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/hasn't been analyzed/i);
  });

  describe("the Bob-first workflow (docs/WORLD_ARCHITECTURE.md)", () => {
    const originalFetch = global.fetch;
    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("analyze_repository -> get_repository_overview -> list_flows -> create_onboarding_journey, all against the SAME worldId, with no repository pre-analyzed", async () => {
      const repoId = { owner: "bob-first-owner", repo: "app" };
      const model = await buildTestKnowledgeModel(
        {
          "src/index.js": `require('./controllers/orderController');\n`,
          "src/controllers/orderController.js": `app.get('/api/orders', () => {});\n`,
        },
        repoId
      );
      await knowledgeModelStore.set(model);
      global.fetch = vi.fn(async (url: string) => {
        if (url.includes("/commits/")) return new Response(JSON.stringify({ sha: model.meta.commitSha }), { status: 200 });
        return new Response(JSON.stringify({ default_branch: "main", description: null, full_name: "bob-first-owner/app" }), { status: 200 });
      }) as unknown as typeof fetch;

      const client = await connectedClient();

      // Step 1: no repository pre-analyzed anywhere except the mocked
      // GitHub metadata calls above — this is the whole point of
      // analyze_repository (docs/WORLD_ARCHITECTURE.md §1).
      const analyzeResult: any = await client.callTool({
        name: "analyze_repository",
        arguments: { repositoryUrl: "https://github.com/bob-first-owner/app" },
      });
      expect(analyzeResult.isError).toBeFalsy();
      const analyzePayload = JSON.parse(analyzeResult.content[0].text);
      const worldId = analyzePayload.worldId;
      expect(worldId).toBeTruthy();
      expect(analyzePayload.worldUrl).toContain(worldId);

      // Step 2: every subsequent call threads the SAME worldId through —
      // exactly how Bob would carry it across a conversation.
      const overview: any = await client.callTool({ name: "get_repository_overview", arguments: { worldId } });
      expect(overview.isError).toBeFalsy();
      expect(JSON.parse(overview.content[0].text).repositoryId).toBe("bob-first-owner/app");

      const flows: any = await client.callTool({ name: "list_flows", arguments: { worldId } });
      expect(flows.isError).toBeFalsy();

      const journey: any = await client.callTool({
        name: "create_onboarding_journey",
        arguments: {
          worldId,
          title: "Understanding Orders",
          goal: "See how an order request travels through the app",
          steps: [{ moduleId: model.modules[0].id, reason: "Entry point for order creation" }],
          confidence: 0.8,
        },
      });
      expect(journey.isError).toBeFalsy();

      const list: any = await client.callTool({ name: "list_onboarding_journeys", arguments: { worldId } });
      const journeys = JSON.parse(list.content[0].text).journeys;
      expect(journeys).toHaveLength(1);
      expect(journeys[0].title).toBe("Understanding Orders");
    });
  });
});
