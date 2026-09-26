import { describe, it, expect } from "vitest";
import { seedWorld } from "@/server/testing/worldFixture";
import { listFlows, getFlow, traceDependencyPath, getModuleDependencies, findFeature } from "./flowTools";
import { EntityNotFoundError } from "./errors";

// One directory per layer so structure-analyzer's directory-based module
// grouping produces separate modules (controller/service/repository/
// payment) instead of collapsing everything under a flat "src" into one.
const LAYERED_APP = {
  "src/index.js": `require('./controllers/orderController');\n`,
  "src/controllers/orderController.js": `const orderService = require('../services/orderService');\napp.get('/api/orders', orderService.list);\n`,
  "src/services/orderService.js": `const orderRepository = require('../repositories/orderRepository');\nmodule.exports.list = () => orderRepository.all();\n`,
  "src/repositories/orderRepository.js": `module.exports.all = () => db.query('select * from orders');\n`,
  "src/payment/paymentService.js": `module.exports.charge = () => fetch('https://stripe.com');\n`,
};

async function seed(repoId: { owner: string; repo: string }) {
  const { model } = await seedWorld(LAYERED_APP, repoId);
  return model;
}

describe("flowTools", () => {
  describe("listFlows / getFlow", () => {
    it("lists real, statically reconstructed flows with a layer chain", async () => {
      await seed({ owner: "flow1", repo: "r" });
      const { flows } = await listFlows({ owner: "flow1", repo: "r" });
      expect(flows.length).toBeGreaterThan(0);
      expect(flows[0].layerChain.length).toBeGreaterThan(0);
    });

    it("get_flow returns the full step evidence and an explicit static-reconstruction disclosure", async () => {
      await seed({ owner: "flow2", repo: "r" });
      const { flows } = await listFlows({ owner: "flow2", repo: "r" });
      const flow = await getFlow({ flowId: flows[0].id, owner: "flow2", repo: "r" });
      expect(flow.disclosure).toMatch(/not a runtime trace/i);
      expect(flow.steps.every((s) => s.evidence.length > 0 || s.confidence === "low")).toBe(true);
    });

    it("throws EntityNotFoundError for a flow id that doesn't exist", async () => {
      await seed({ owner: "flow3", repo: "r" });
      await expect(getFlow({ flowId: "no-such-flow", owner: "flow3", repo: "r" })).rejects.toBeInstanceOf(EntityNotFoundError);
    });
  });

  describe("traceDependencyPath", () => {
    it("finds a real chain of dependency edges between two connected modules", async () => {
      const model = await seed({ owner: "flow4", repo: "r" });
      const controller = model.modules.find((m) => m.path.includes("controllers"))!;
      const repository = model.modules.find((m) => m.path.includes("repositories"))!;
      const result = await traceDependencyPath({ from: controller.id, to: repository.id, owner: "flow4", repo: "r" });
      expect(result.found).toBe(true);
      expect(result.path[0].id).toBe(controller.id);
      expect(result.path.at(-1)!.id).toBe(repository.id);
    });

    it("honestly reports no path found for two unconnected modules, instead of guessing", async () => {
      const model = await seed({ owner: "flow5", repo: "r" });
      const controller = model.modules.find((m) => m.path.includes("controllers"))!;
      const payment = model.modules.find((m) => m.path.includes("payment"))!;
      const result = await traceDependencyPath({ from: controller.id, to: payment.id, owner: "flow5", repo: "r" });
      expect(result.found).toBe(false);
      expect(result.path).toEqual([]);
      expect(result.disclosure).toMatch(/does not prove no relationship/i);
    });
  });

  describe("getModuleDependencies", () => {
    it("reports direct dependencies/dependents and dependency depth from real edges", async () => {
      const model = await seed({ owner: "flow6", repo: "r" });
      const controller = model.modules.find((m) => m.path.includes("controllers"))!;
      const result = await getModuleDependencies({ moduleId: controller.id, owner: "flow6", repo: "r" });
      expect(result.dependencies.length).toBeGreaterThan(0);
      expect(result.dependencyDepth).toBeGreaterThan(0);
    });
  });

  describe("findFeature", () => {
    it("ranks candidates by keyword overlap and discloses the heuristic explicitly", async () => {
      await seed({ owner: "flow7", repo: "r" });
      const result = await findFeature({ query: "controllers", owner: "flow7", repo: "r" });
      expect(result.method).toBe("keyword-heuristic");
      expect(result.disclosure).toMatch(/not by semantic understanding/i);
      expect(result.candidateModules.length).toBeGreaterThan(0);
    });

    it("returns empty candidate lists (not fabricated ones) for a query matching nothing", async () => {
      await seed({ owner: "flow8", repo: "r" });
      const result = await findFeature({ query: "zzz-totally-unrelated-token", owner: "flow8", repo: "r" });
      expect(result.candidateFlows).toEqual([]);
      expect(result.candidateModules).toEqual([]);
      expect(result.candidateEntryPoints).toEqual([]);
    });
  });
});
