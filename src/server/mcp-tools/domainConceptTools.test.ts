import { describe, it, expect } from "vitest";
import { seedWorld } from "@/server/testing/worldFixture";
import { worldStore } from "@/server/world/worldStore";
import { contributeDomainConcept, listDomainConcepts } from "./domainConceptTools";
import { EntityNotFoundError, InvalidToolArgumentsError } from "./errors";

const APP = {
  "src/index.js": `require('./controllers/orderController');\n`,
  "src/controllers/orderController.js": `const orderService = require('../services/orderService');\napp.get('/api/orders', orderService.list);\n`,
  "src/services/orderService.js": `const orderRepository = require('../repositories/orderRepository');\nmodule.exports.list = () => orderRepository.all();\n`,
  "src/repositories/orderRepository.js": `module.exports.all = () => db.query('select * from orders');\n`,
};

async function seed(repoId: { owner: string; repo: string }) {
  const { model, world } = await seedWorld(APP, repoId);
  return { model, worldId: world.id };
}

/** Captures every event published during `fn()`, reading through the same durable worldStore every tool publishes to — see src/server/agent/eventBus.ts. */
async function capture(worldId: string, fn: () => Promise<unknown>) {
  const before = await worldStore.getEventsSince(worldId, 0);
  const result = await fn();
  const after = await worldStore.getEventsSince(worldId, before.latestIndex);
  return { result, events: after.events };
}

describe("domainConceptTools", () => {
  describe("contributeDomainConcept", () => {
    it("stores a concept with correct ai-interpreted provenance and publishes both event kinds", async () => {
      const { model, worldId } = await seed({ owner: "dc1", repo: "r" });
      const controller = model.modules.find((m) => m.path.includes("controllers"))!;

      const { result, events } = await capture(worldId, () =>
        contributeDomainConcept({
          name: "Order Fulfillment",
          description: "Handles receiving and processing customer orders.",
          relatedModuleIds: [controller.id],
          confidence: 0.8,
          agentName: "bob",
          agentVersion: "ibm-bob-2.0",
          owner: "dc1",
          repo: "r",
        })
      );

      const concept = (result as any).concept;
      expect(concept.provenance).toEqual({
        source: "ai-interpreted",
        confidence: 0.8,
        generatedBy: "bob",
        modelVersion: "ibm-bob-2.0",
      });
      expect(concept.relatedModuleIds).toEqual([controller.id]);

      expect(events.some((e: any) => e.kind === "domain-concept" && e.concept.name === "Order Fulfillment")).toBe(true);
      expect(events.some((e: any) => e.kind === "activity" && e.tool === "contribute_domain_concept")).toBe(true);
    });

    it("rejects a concept referencing a module that doesn't exist — never stores or publishes it", async () => {
      const { worldId } = await seed({ owner: "dc2", repo: "r" });
      const { events } = await capture(worldId, async () => {
        await expect(
          contributeDomainConcept({
            name: "Fake Concept",
            description: "References a module that isn't real.",
            relatedModuleIds: ["no-such-module"],
            confidence: 0.5,
            owner: "dc2",
            repo: "r",
          })
        ).rejects.toBeInstanceOf(EntityNotFoundError);
      });
      expect(events).toEqual([]);

      const { concepts } = await listDomainConcepts({ owner: "dc2", repo: "r" });
      expect(concepts).toEqual([]);
    });

    it("rejects a concept referencing a file that doesn't exist", async () => {
      const { model } = await seed({ owner: "dc3", repo: "r" });
      const controller = model.modules.find((m) => m.path.includes("controllers"))!;
      await expect(
        contributeDomainConcept({
          name: "X",
          description: "Y",
          relatedModuleIds: [controller.id],
          relatedFileIds: ["src/does-not-exist.js"],
          confidence: 0.5,
          owner: "dc3",
          repo: "r",
        })
      ).rejects.toBeInstanceOf(EntityNotFoundError);
    });

    it("rejects an empty relatedModuleIds array — a concept must explain something concrete", async () => {
      await seed({ owner: "dc4", repo: "r" });
      await expect(
        contributeDomainConcept({ name: "X", description: "Y", relatedModuleIds: [], confidence: 0.5, owner: "dc4", repo: "r" })
      ).rejects.toBeInstanceOf(InvalidToolArgumentsError);
    });

    it("rejects a confidence outside [0, 1]", async () => {
      const { model } = await seed({ owner: "dc5", repo: "r" });
      const controller = model.modules.find((m) => m.path.includes("controllers"))!;
      await expect(
        contributeDomainConcept({ name: "X", description: "Y", relatedModuleIds: [controller.id], confidence: 1.5, owner: "dc5", repo: "r" })
      ).rejects.toBeInstanceOf(InvalidToolArgumentsError);
    });

    it("rejects an empty name or description", async () => {
      const { model } = await seed({ owner: "dc6", repo: "r" });
      const controller = model.modules.find((m) => m.path.includes("controllers"))!;
      await expect(
        contributeDomainConcept({ name: "  ", description: "Y", relatedModuleIds: [controller.id], confidence: 0.5, owner: "dc6", repo: "r" })
      ).rejects.toBeInstanceOf(InvalidToolArgumentsError);
      await expect(
        contributeDomainConcept({ name: "X", description: "  ", relatedModuleIds: [controller.id], confidence: 0.5, owner: "dc6", repo: "r" })
      ).rejects.toBeInstanceOf(InvalidToolArgumentsError);
    });

    it("resolves modules by name, not just id, same as other tools", async () => {
      const { model, worldId } = await seed({ owner: "dc7", repo: "r" });
      const controller = model.modules.find((m) => m.path.includes("controllers"))!;
      const { result } = await capture(worldId, () =>
        contributeDomainConcept({
          name: "X",
          description: "Y",
          relatedModuleIds: [controller.name.toUpperCase()],
          confidence: 0.5,
          owner: "dc7",
          repo: "r",
        })
      );
      expect((result as any).concept.relatedModuleIds).toEqual([controller.id]);
    });
  });

  describe("listDomainConcepts", () => {
    it("returns every concept contributed so far for that repository, with a disclosure", async () => {
      const { model } = await seed({ owner: "dc8", repo: "r" });
      const controller = model.modules.find((m) => m.path.includes("controllers"))!;
      await contributeDomainConcept({ name: "A", description: "a", relatedModuleIds: [controller.id], confidence: 0.6, owner: "dc8", repo: "r" });
      await contributeDomainConcept({ name: "B", description: "b", relatedModuleIds: [controller.id], confidence: 0.9, owner: "dc8", repo: "r" });

      const { concepts, disclosure } = await listDomainConcepts({ owner: "dc8", repo: "r" });
      expect(concepts.map((c) => c.name)).toEqual(["A", "B"]);
      expect(disclosure).toMatch(/not deterministic facts/i);
    });

    it("returns an empty list for a repository nothing has been contributed to yet", async () => {
      await seed({ owner: "dc9", repo: "r" });
      const { concepts } = await listDomainConcepts({ owner: "dc9", repo: "r" });
      expect(concepts).toEqual([]);
    });
  });
});
