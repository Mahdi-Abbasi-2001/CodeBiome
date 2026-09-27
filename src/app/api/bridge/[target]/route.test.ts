import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST, DELETE } from "./route";
import { seedWorld } from "@/server/testing/worldFixture";

/**
 * Deployment-sensitive behavior for the `/api/bridge/[target]` route family
 * that backs `/api/mcp`, `/api/analyze`, `/api/session-context`, and
 * `/api/agent-events` via `next.config.mjs` `rewrites()` — see route.ts's doc
 * comment and docs/VERCEL_DEPLOYMENT.md for the real Next.js 14.2.35
 * output-file-tracing defect found during deployment investigation (fixed
 * via `experimental.outputFileTracingExcludes`, not this route's shape),
 * and for why this uses a `[target]` PATH segment rather than a `?target=`
 * query destination (the query form worked on real Vercel but not
 * reliably under `next start`).
 *
 * Requests are built the way they arrive AFTER a rewrite — i.e. against
 * `/api/bridge/<target>` with `params: { target }` supplied directly, since
 * calling the exported route handlers bypasses Next.js's own rewrite
 * resolution (which is what supplies `params` for a real request).
 */

function req(target: string, init: RequestInit & { query?: string } = {}) {
  const { query = "", ...rest } = init;
  return new NextRequest(`http://localhost:3000/api/bridge/${target}${query}`, rest as ConstructorParameters<typeof NextRequest>[1]);
}

function callGet(target: string, query = "") {
  return GET(req(target, { query }), { params: { target } });
}

function callPost(target: string, body?: unknown, rawBody?: string) {
  return POST(
    req(target, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: rawBody ?? JSON.stringify(body ?? {}),
    }),
    { params: { target } }
  );
}

function callDelete(target: string) {
  return DELETE(req(target, { method: "DELETE" }), { params: { target } });
}

function mcpCall(name: string, args: Record<string, unknown> = {}, id = 1) {
  return callPost("mcp", { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
}

const APP = {
  "src/index.js": `require('./controllers/orderController');\n`,
  "src/controllers/orderController.js": `const orderService = require('../services/orderService');\napp.get('/api/orders', orderService.list);\n`,
  "src/services/orderService.js": `module.exports.list = () => [];\n`,
};

async function seed(repoId: { owner: string; repo: string }) {
  const { model, world } = await seedWorld(APP, repoId);
  return { model, worldId: world.id };
}

describe("/api/bridge/[target] (backing /api/mcp, /api/analyze, /api/session-context, /api/agent-events)", () => {
  describe("routing", () => {
    it("dispatches target=mcp to the real MCP transport (tools/list)", async () => {
      const listRes = await callPost("mcp", { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
      expect(listRes.status).toBe(200);
      const body = await listRes.json();
      const names = body.result.tools.map((t: { name: string }) => t.name);
      expect(names).toContain("create_onboarding_journey");
      expect(names).toContain("get_current_context");
      expect(names).toContain("propose_feature_plan");
      expect(names.length).toBe(32);
    });

    it("returns 405 for GET on a POST-only target", async () => {
      const res = await callGet("analyze");
      expect(res.status).toBe(405);
    });

    it("returns 405 for POST on a GET-only target", async () => {
      const res = await callPost("agent-events");
      expect(res.status).toBe(405);
    });

    it("returns 404 for an unknown target", async () => {
      expect((await callGet("nonsense")).status).toBe(404);
    });

    it("DELETE only routes target=mcp (MCP session teardown), 404 elsewhere", async () => {
      const res = await callDelete("analyze");
      expect(res.status).toBe(404);
    });

    it("POST analyze rejects invalid JSON and a missing url without touching the network", async () => {
      const badJson = await callPost("analyze", undefined, "not json");
      expect(badJson.status).toBe(400);

      const missingUrl = await callPost("analyze", {});
      expect(missingUrl.status).toBe(400);
    });

    it("POST session-context rejects a missing worldId", async () => {
      const res = await callPost("session-context", { selectedModuleId: "x" });
      expect(res.status).toBe(400);
    });

    it("GET agent-events requires a worldId query param, forwarded through the rewrite", async () => {
      const res = await callGet("agent-events");
      expect(res.status).toBe(400);
    });
  });

  describe("MCP_AUTH_TOKEN gating (target=mcp only)", () => {
    const originalToken = process.env.MCP_AUTH_TOKEN;
    afterEach(() => {
      if (originalToken === undefined) delete process.env.MCP_AUTH_TOKEN;
      else process.env.MCP_AUTH_TOKEN = originalToken;
    });

    it("stays open with no auth header when MCP_AUTH_TOKEN is unset (local-dev default)", async () => {
      delete process.env.MCP_AUTH_TOKEN;
      const res = await callPost("mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" });
      expect(res.status).toBe(200);
    });

    it("rejects a request with no/wrong Authorization header once MCP_AUTH_TOKEN is set", async () => {
      process.env.MCP_AUTH_TOKEN = "s3cret";
      const noHeader = await callPost("mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" });
      expect(noHeader.status).toBe(401);

      const wrongHeader = await POST(
        req("mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: "Bearer wrong" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        }),
        { params: { target: "mcp" } }
      );
      expect(wrongHeader.status).toBe(401);
    });

    it("allows a request with the correct Bearer token", async () => {
      process.env.MCP_AUTH_TOKEN = "s3cret";
      const res = await POST(
        req("mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: "Bearer s3cret" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        }),
        { params: { target: "mcp" } }
      );
      expect(res.status).toBe(200);
    });
  });

  describe("cross-endpoint state flow (the actual reason this route exists)", () => {
    it("session-context written via target=session-context is read back by get_current_context via target=mcp", async () => {
      const { model, worldId } = await seed({ owner: "disp1", repo: "app" });
      const moduleId = model.modules.find((m) => m.path.includes("controllers"))!.id;

      const ctxRes = await callPost("session-context", {
        worldId,
        selectedModuleId: moduleId,
        selectedModuleName: "orderController",
      });
      expect(ctxRes.status).toBe(200);

      const mcpRes = await mcpCall("get_current_context", { owner: "disp1", repo: "app" });
      const body = await mcpRes.json();
      const parsed = JSON.parse(body.result.content[0].text);
      expect(parsed).toMatchObject({ hasSelection: true, selectedModule: { id: moduleId, name: "orderController" } });
    });

    it("an onboarding journey created via target=mcp is retrievable via list_onboarding_journeys and published to target=agent-events", async () => {
      const { model, worldId } = await seed({ owner: "disp2", repo: "app" });
      const moduleId = model.modules.find((m) => m.path.includes("controllers"))!.id;

      const createRes = await mcpCall("create_onboarding_journey", {
        title: "Understanding Orders",
        goal: "See how an order request travels through the app",
        steps: [{ moduleId, reason: "Entry point for order creation" }],
        confidence: 0.8,
        owner: "disp2",
        repo: "app",
      });
      const createBody = await createRes.json();
      expect(createBody.result.isError).toBeUndefined();

      const listRes = await mcpCall("list_onboarding_journeys", { owner: "disp2", repo: "app" });
      const listBody = await listRes.json();
      const parsedList = JSON.parse(listBody.result.content[0].text);
      expect(parsedList.journeys).toHaveLength(1);
      expect(parsedList.journeys[0].title).toBe("Understanding Orders");

      // The rewrite forwards the original query string through unchanged —
      // confirm worldId survives the same way it would for a real
      // /api/agent-events?worldId=... request. bobEvents.ts polls the durable
      // worldStore rather than pushing instantly (see its own doc comment)
      // — the initial `getEventsSince(worldId, 0)` call already returns
      // everything published so far, so no poll wait is needed here.
      const eventsRes = await callGet("agent-events", `?worldId=${encodeURIComponent(worldId)}`);
      expect(eventsRes.status).toBe(200);
      const reader = eventsRes.body!.getReader();
      const decoder = new TextDecoder();
      let text = "";
      for (let i = 0; i < 10 && !(text.includes('"kind":"onboarding-journey"') && text.includes('"type":"focus_onboarding_step"')); i++) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
      await reader.cancel();
      expect(text).toContain('"kind":"onboarding-journey"');
      expect(text).toContain('"type":"focus_onboarding_step"');
    });

    it("rejects an onboarding journey referencing a fabricated module — nothing stored, nothing published", async () => {
      await seed({ owner: "disp3", repo: "app" });

      const createRes = await mcpCall("create_onboarding_journey", {
        title: "Fake",
        goal: "goal",
        steps: [{ moduleId: "src/totally-fake-module", reason: "made up" }],
        confidence: 0.5,
        owner: "disp3",
        repo: "app",
      });
      const createBody = await createRes.json();
      expect(createBody.result.isError).toBe(true);
      expect(createBody.result.content[0].text).toContain('No module "src/totally-fake-module"');

      const listRes = await mcpCall("list_onboarding_journeys", { owner: "disp3", repo: "app" });
      const listBody = await listRes.json();
      const parsedList = JSON.parse(listBody.result.content[0].text);
      expect(parsedList.journeys).toHaveLength(0);
    });

    it("rejects a tool call for a module that doesn't exist in the analyzed repository", async () => {
      await seed({ owner: "disp4", repo: "app" });
      const res = await mcpCall("get_module", { moduleId: "no-such-module", owner: "disp4", repo: "app" });
      const body = await res.json();
      expect(body.result.isError).toBe(true);
      expect(body.result.content[0].text).toContain('No module "no-such-module"');
    });

    it("rejects invalid MCP tool arguments (missing required field) with an honest tool error, not a crash", async () => {
      const res = await mcpCall("get_module", {}, 9);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.result.isError).toBe(true);
      expect(body.result.content[0].text).toContain("moduleId");
    });

    it("rejects an unknown tool name with an honest tool error, not a crash", async () => {
      const res = await mcpCall("not_a_real_tool", {}, 10);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.result.isError).toBe(true);
      expect(body.result.content[0].text).toContain("not_a_real_tool");
    });
  });
});
