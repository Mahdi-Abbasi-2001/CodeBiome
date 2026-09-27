import { describe, it, expect } from "vitest";
import { seedWorld } from "@/server/testing/worldFixture";
import { worldStore } from "@/server/world/worldStore";
import { proposeFeaturePlan, listFeaturePlans } from "./planTools";
import { InvalidToolArgumentsError } from "./errors";

const APP = {
  "api/src/routes/orders.route.js": `import express from 'express';\nimport { OrdersController } from '../controllers/orders.controller.js';\nconst app = express();\napp.get('/api/orders', OrdersController.list);\n`,
  "api/src/controllers/orders.controller.js": `export class OrdersController {\n  static list() { return []; }\n}\n`,
  "api/src/db.js": `import mysql2 from 'mysql2';\nexport const pool = mysql2.createPool({});\n`,
};

async function seed(repoId: { owner: string; repo: string }) {
  const { world } = await seedWorld(APP, repoId);
  return world.id;
}

async function capture(worldId: string, fn: () => Promise<unknown>) {
  const before = await worldStore.getEventsSince(worldId, 0);
  const result = await fn();
  const after = await worldStore.getEventsSince(worldId, before.latestIndex);
  return { result, events: after.events };
}

describe("planTools", () => {
  describe("proposeFeaturePlan", () => {
    it("stores a valid plan, publishes an activity event, and returns a direct Plan-tab url", async () => {
      const worldId = await seed({ owner: "plan1", repo: "r" });

      const { result, events } = await capture(worldId, () =>
        proposeFeaturePlan({
          description: "add order notes",
          name: "Order notes",
          summary: "Adds a notes field to orders.",
          confidence: "high",
          steps: [{ kind: "controller", label: "Orders Controller", status: "existing", filePath: "api/src/controllers/orders.controller.js", explanation: "reused" }],
          worldId,
        })
      );

      expect(result).toMatchObject({ ok: true, plan: { name: "Order notes", confidence: "high" } });
      const r = result as Awaited<ReturnType<typeof proposeFeaturePlan>>;
      expect(r.url).toContain(worldId);
      expect(r.url).toContain("lens=plan");
      expect(events).toContainEqual(expect.objectContaining({ kind: "activity", tool: "propose_feature_plan" }));

      const stored = await listFeaturePlans({ worldId });
      expect(stored.plans).toHaveLength(1);
      expect(stored.plans[0].name).toBe("Order notes");
    });

    it("downgrades rather than rejects when a step references a file that doesn't exist", async () => {
      const worldId = await seed({ owner: "plan2", repo: "r" });

      const { result } = await capture(worldId, () =>
        proposeFeaturePlan({
          description: "add a wishlist",
          name: "Wishlist",
          summary: "Adds a wishlist.",
          confidence: "high",
          steps: [{ kind: "service", label: "Wishlist Service", status: "existing", filePath: "api/src/services/wishlist.service.js", explanation: "made up" }],
          worldId,
        })
      );

      const r = result as Awaited<ReturnType<typeof proposeFeaturePlan>>;
      expect(r.plan.steps[0].status).toBe("new");
      expect(r.plan.confidence).toBe("medium");
      expect(r.plan.evidence.length).toBeGreaterThan(0);
    });

    it("rejects a call with no steps at all", async () => {
      const worldId = await seed({ owner: "plan3", repo: "r" });
      await expect(
        proposeFeaturePlan({
          description: "add a wishlist",
          name: "Wishlist",
          summary: "Adds a wishlist.",
          confidence: "medium",
          steps: [],
          worldId,
        })
      ).rejects.toThrow(InvalidToolArgumentsError);
    });

    it("rejects an empty description", async () => {
      const worldId = await seed({ owner: "plan4", repo: "r" });
      await expect(
        proposeFeaturePlan({
          description: "  ",
          name: "Wishlist",
          summary: "Adds a wishlist.",
          confidence: "medium",
          steps: [{ kind: "unknown", label: "X", status: "new", filePath: "x.js", explanation: "?" }],
          worldId,
        })
      ).rejects.toThrow(InvalidToolArgumentsError);
    });
  });

  describe("listFeaturePlans", () => {
    it("returns an empty list and a disclosure when nothing has been proposed yet", async () => {
      const worldId = await seed({ owner: "plan5", repo: "r" });
      const result = await listFeaturePlans({ worldId });
      expect(result.plans).toEqual([]);
      expect(result.disclosure).toMatch(/ai-interpreted/i);
    });
  });
});
