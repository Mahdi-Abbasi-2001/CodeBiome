import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { seedWorld } from "@/server/testing/worldFixture";
import { getRepositoryOverview, searchRepository, getFile, getModule, getCurrentContext } from "./repositoryTools";
import { EntityNotFoundError } from "./errors";
import { RepositoryNotAnalyzedError } from "./resolveRepository";
import { sessionContextStore } from "@/server/bob/sessionContext";

const EXPRESS_APP = {
  "package.json": `{"name":"orders-app"}`,
  "src/index.js": `const app = require('express')();\napp.listen(3000);\n`,
  "src/orderController.js": `const orderService = require('./orderService');\napp.get('/api/orders', orderService.list);\n`,
  "src/orderService.js": `const orderRepository = require('./orderRepository');\nmodule.exports.list = () => orderRepository.all();\n`,
  "src/orderRepository.js": `module.exports.all = () => db.query('select * from orders');\n`,
};

async function seed(repoId = { owner: "acme", repo: "orders" }) {
  const { model } = await seedWorld(EXPRESS_APP, repoId);
  return model;
}

describe("repositoryTools", () => {
  describe("getRepositoryOverview", () => {
    it("returns real repository facts, resolvable by owner/repo", async () => {
      const model = await seed({ owner: "acme1", repo: "orders" });
      const overview = await getRepositoryOverview({ owner: "acme1", repo: "orders" });
      expect(overview.repositoryId).toBe(model.meta.repositoryId);
      expect(overview.statistics.moduleCount).toBe(model.modules.length);
      expect(overview.entryPoints.length).toBeGreaterThan(0);
    });

    it("falls back to the most recently analyzed repository when owner/repo are omitted", async () => {
      const model = await seed({ owner: "acme2", repo: "orders" });
      const overview = await getRepositoryOverview({});
      expect(overview.repositoryId).toBe(model.meta.repositoryId);
    });

    it("throws a clear, typed error when no repository has been analyzed", async () => {
      await expect(getRepositoryOverview({ owner: "never-analyzed", repo: "x" })).rejects.toBeInstanceOf(RepositoryNotAnalyzedError);
    });
  });

  describe("searchRepository", () => {
    it("finds real modules/files by keyword and discloses it is not semantic search", async () => {
      await seed({ owner: "acme3", repo: "orders" });
      const result = await searchRepository({ query: "order", owner: "acme3", repo: "orders" });
      expect(result.method).toBe("keyword-match");
      expect(result.matches.length).toBeGreaterThan(0);
      expect(result.matches.every((m) => m.matchedOn)).toBe(true);
    });

    it("returns no matches for a query with no keyword overlap, rather than guessing", async () => {
      await seed({ owner: "acme4", repo: "orders" });
      const result = await searchRepository({ query: "zzz-nonexistent-token", owner: "acme4", repo: "orders" });
      expect(result.matches).toEqual([]);
    });
  });

  describe("getModule", () => {
    it("resolves by exact id and by case-insensitive name", async () => {
      const model = await seed({ owner: "acme5", repo: "orders" });
      const anyModuleId = model.modules[0].id;
      const byId = await getModule({ moduleId: anyModuleId, owner: "acme5", repo: "orders" });
      const byName = await getModule({ moduleId: byId.name.toUpperCase(), owner: "acme5", repo: "orders" });
      expect(byName.id).toBe(byId.id);
    });

    it("throws EntityNotFoundError for a module that doesn't exist — never fabricates one", async () => {
      await seed({ owner: "acme6", repo: "orders" });
      await expect(getModule({ moduleId: "does-not-exist", owner: "acme6", repo: "orders" })).rejects.toBeInstanceOf(EntityNotFoundError);
    });

    it("includes real dependency/dependent names, not just ids", async () => {
      const model = await seed({ owner: "acme7", repo: "orders" });
      const controller = model.modules.find((m) => m.name.toLowerCase().includes("ordercontroller") || m.path.includes("orderController"));
      if (controller && controller.dependencyIds.length > 0) {
        const result = await getModule({ moduleId: controller.id, owner: "acme7", repo: "orders" });
        expect(result.dependencies.every((d) => typeof d.name === "string" && d.name.length > 0)).toBe(true);
      }
    });
  });

  describe("getFile", () => {
    const originalFetch = global.fetch;
    beforeEach(() => {
      global.fetch = vi.fn(async () => new Response("const x = 1;\n", { status: 200 })) as unknown as typeof fetch;
    });
    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("fetches real content for a file that exists in the analyzed repository", async () => {
      await seed({ owner: "acme8", repo: "orders" });
      const result = await getFile({ path: "src/index.js", owner: "acme8", repo: "orders" });
      expect(result.content).toContain("const x = 1;");
      expect(result.path).toBe("src/index.js");
    });

    it("throws EntityNotFoundError for a path that isn't in the repository — never invents source", async () => {
      await seed({ owner: "acme9", repo: "orders" });
      await expect(getFile({ path: "src/does-not-exist.js", owner: "acme9", repo: "orders" })).rejects.toBeInstanceOf(EntityNotFoundError);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe("getCurrentContext", () => {
    it("honestly reports no selection when the browser hasn't reported one", async () => {
      await seed({ owner: "acme10", repo: "orders" });
      const result = await getCurrentContext({ owner: "acme10", repo: "orders" });
      expect(result.hasSelection).toBe(false);
      expect(result.selectedModule).toBeNull();
    });

    it("reflects what the browser last reported via the session-context store", async () => {
      const { model, world } = await seedWorld(EXPRESS_APP, { owner: "acme11", repo: "orders" });
      await sessionContextStore.set(world.id, {
        selectedModuleId: model.modules[0].id,
        selectedModuleName: model.modules[0].name,
        activeFlowId: null,
        activeFlowName: null,
        currentStepId: null,
        currentStepLabel: null,
        activeOnboardingJourneyId: null,
        activeOnboardingJourneyTitle: null,
        currentOnboardingStepIndex: null,
        currentOnboardingStepReason: null,
        updatedAt: new Date().toISOString(),
      });
      const result = await getCurrentContext({ owner: "acme11", repo: "orders" });
      expect(result.hasSelection).toBe(true);
      expect(result.selectedModule?.id).toBe(model.modules[0].id);
    });

    it("reflects an active onboarding journey step reported by the browser", async () => {
      const { model, world } = await seedWorld(EXPRESS_APP, { owner: "acme12", repo: "orders" });
      await sessionContextStore.set(world.id, {
        selectedModuleId: model.modules[0].id,
        selectedModuleName: model.modules[0].name,
        activeFlowId: null,
        activeFlowName: null,
        currentStepId: null,
        currentStepLabel: null,
        activeOnboardingJourneyId: "journey-abc123",
        activeOnboardingJourneyTitle: "Understanding Order Creation",
        currentOnboardingStepIndex: 1,
        currentOnboardingStepReason: "This is the business logic layer for order creation.",
        updatedAt: new Date().toISOString(),
      });
      const result = await getCurrentContext({ owner: "acme12", repo: "orders" });
      expect(result.activeOnboardingJourney).toMatchObject({
        id: "journey-abc123",
        title: "Understanding Order Creation",
        stepIndex: 1,
        reason: "This is the business logic layer for order creation.",
      });
    });
  });
});
