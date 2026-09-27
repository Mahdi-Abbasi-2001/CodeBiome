import { describe, it, expect } from "vitest";
import { buildTestKnowledgeModel } from "@/server/testing/knowledgeModelFixture";
import { buildWorldModel } from "@/server/world/builder";
import { validateFeaturePlan, type DraftPlan } from "./validateFeaturePlan";

async function fixture() {
  const model = await buildTestKnowledgeModel({
    "api/src/routes/orders.route.js": `import express from 'express';\nimport { OrdersController } from '../controllers/orders.controller.js';\nconst app = express();\napp.get('/api/orders', OrdersController.list);\n`,
    "api/src/controllers/orders.controller.js": `export class OrdersController {\n  static list() { return []; }\n}\n`,
    "api/src/db.js": `import mysql2 from 'mysql2';\nexport const pool = mysql2.createPool({});\n`,
  });
  const worldModel = buildWorldModel(model);
  return { model, worldModel };
}

describe("validateFeaturePlan", () => {
  it("keeps a draft whose references are all real, unchanged", async () => {
    const { model, worldModel } = await fixture();
    const draft: DraftPlan = {
      name: "Order notes",
      summary: "Adds a notes field to orders.",
      confidence: "high",
      steps: [
        { kind: "controller", label: "Orders Controller", status: "existing", filePath: "api/src/controllers/orders.controller.js", explanation: "reused" },
        { kind: "database", label: "Db", status: "existing", filePath: "api/src/db.js", explanation: "reused" },
      ],
      impactedEntities: [{ kind: "domain", name: "api", reason: "adds a field to the orders table" }],
      newFiles: [{ suggestedPath: "api/src/migrations/add_notes.js", purpose: "schema migration" }],
      modifiedFiles: [{ filePath: "api/src/db.js", reason: "register the migration" }],
    };

    const plan = validateFeaturePlan(draft, "add notes to orders", "plan-1", model, worldModel);

    expect(plan.id).toBe("plan-1");
    expect(plan.confidence).toBe("high");
    expect(plan.evidence).toEqual([]);
    expect(plan.steps.map((s) => s.status)).toEqual(["existing", "existing"]);
    expect(plan.impactedEntities).toHaveLength(1);
    expect(plan.modifiedFiles).toHaveLength(1);
  });

  it("downgrades a hallucinated 'existing' step to 'new' instead of trusting it, and discloses it", async () => {
    const { model, worldModel } = await fixture();
    const draft: DraftPlan = {
      name: "Wishlist",
      summary: "Adds a wishlist.",
      confidence: "high",
      steps: [{ kind: "service", label: "Wishlist Service", status: "existing", filePath: "api/src/services/wishlist.service.js", explanation: "made up" }],
      impactedEntities: [],
      newFiles: [],
      modifiedFiles: [],
    };

    const plan = validateFeaturePlan(draft, "add a wishlist", "plan-2", model, worldModel);

    expect(plan.steps[0].status).toBe("new");
    expect(plan.confidence).toBe("medium");
    expect(plan.evidence.some((e) => e.includes("wishlist.service.js"))).toBe(true);
  });

  it("drops a hallucinated modifiedFiles entry rather than passing it through", async () => {
    const { model, worldModel } = await fixture();
    const draft: DraftPlan = {
      name: "Wishlist",
      summary: "Adds a wishlist.",
      confidence: "high",
      steps: [],
      impactedEntities: [],
      newFiles: [],
      modifiedFiles: [{ filePath: "api/src/services/wishlist.service.js", reason: "made up" }],
    };

    const plan = validateFeaturePlan(draft, "add a wishlist", "plan-3", model, worldModel);

    expect(plan.modifiedFiles).toEqual([]);
    expect(plan.confidence).toBe("medium");
    expect(plan.evidence.length).toBe(1);
  });

  it("drops a hallucinated impactedEntities reference to a domain/technology that doesn't exist", async () => {
    const { model, worldModel } = await fixture();
    const draft: DraftPlan = {
      name: "Wishlist",
      summary: "Adds a wishlist.",
      confidence: "high",
      steps: [],
      impactedEntities: [{ kind: "infra", name: "Redis", reason: "made up — this repo has no Redis" }],
      newFiles: [],
      modifiedFiles: [],
    };

    const plan = validateFeaturePlan(draft, "add a wishlist", "plan-4", model, worldModel);

    expect(plan.impactedEntities).toEqual([]);
    expect(plan.evidence.some((e) => e.includes("Redis"))).toBe(true);
  });

  it("resolves a real impactedEntities reference to the actual domain id, not the display name", async () => {
    const { model, worldModel } = await fixture();
    const draft: DraftPlan = {
      name: "Wishlist",
      summary: "Adds a wishlist.",
      confidence: "medium",
      steps: [],
      impactedEntities: [{ kind: "domain", name: "api", reason: "new route added here" }],
      newFiles: [],
      modifiedFiles: [],
    };

    const plan = validateFeaturePlan(draft, "add a wishlist", "plan-5", model, worldModel);

    expect(plan.impactedEntities).toHaveLength(1);
    expect(plan.impactedEntities[0].id).toBe("domain-api");
  });

  it("coerces an unrecognized step kind to 'unknown' rather than producing invalid output", async () => {
    const { model, worldModel } = await fixture();
    const draft = {
      name: "Wishlist",
      summary: "Adds a wishlist.",
      confidence: "medium",
      steps: [{ kind: "totally-made-up-kind", label: "???", status: "new", filePath: "x.js", explanation: "?" }],
      impactedEntities: [],
      newFiles: [],
      modifiedFiles: [],
    } as unknown as DraftPlan;

    const plan = validateFeaturePlan(draft, "add a wishlist", "plan-6", model, worldModel);

    expect(plan.steps[0].kind).toBe("unknown");
  });
});
