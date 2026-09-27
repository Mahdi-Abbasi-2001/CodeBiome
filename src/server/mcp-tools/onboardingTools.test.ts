import { describe, it, expect } from "vitest";
import { seedWorld } from "@/server/testing/worldFixture";
import { worldStore } from "@/server/world/worldStore";
import { createOnboardingJourney, listOnboardingJourneys, advanceOnboardingStep } from "./onboardingTools";
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

describe("onboardingTools", () => {
  describe("createOnboardingJourney", () => {
    it("accepts real module references, stores the journey, and focuses step 0 in the world", async () => {
      const { model, worldId } = await seed({ owner: "onb1", repo: "r" });
      const controller = model.modules.find((m) => m.path.includes("controllers"))!;
      const service = model.modules.find((m) => m.path.includes("services"))!;

      const { result, events } = await capture(worldId, () =>
        createOnboardingJourney({
          title: "Understanding Order Creation",
          goal: "Understand how an order request travels through the application",
          steps: [
            { moduleId: controller.id, reason: "HTTP entry point for order creation" },
            { moduleId: service.id, reason: "Business logic for order creation" },
          ],
          confidence: 0.9,
          agentName: "bob",
          owner: "onb1",
          repo: "r",
        })
      );

      expect(result).toMatchObject({
        ok: true,
        journey: {
          title: "Understanding Order Creation",
          steps: [
            { order: 0, moduleId: controller.id, reason: "HTTP entry point for order creation" },
            { order: 1, moduleId: service.id, reason: "Business logic for order creation" },
          ],
          provenance: { source: "ai-interpreted", confidence: 0.9, generatedBy: "bob" },
        },
      });

      expect(events).toContainEqual(expect.objectContaining({ kind: "onboarding-journey" }));
      expect(events).toContainEqual(
        expect.objectContaining({
          kind: "world-action",
          action: expect.objectContaining({ type: "focus_onboarding_step", stepIndex: 0, moduleId: controller.id }),
        })
      );
    });

    it("rejects a journey referencing a nonexistent module and stores/publishes nothing", async () => {
      const { worldId } = await seed({ owner: "onb2", repo: "r" });
      const { events } = await capture(worldId, async () => {
        await expect(
          createOnboardingJourney({
            title: "Fake Journey",
            goal: "Goal",
            steps: [{ moduleId: "src/totally-fake-module", reason: "made up" }],
            confidence: 0.5,
            owner: "onb2",
            repo: "r",
          })
        ).rejects.toBeInstanceOf(EntityNotFoundError);
      });
      expect(events).toEqual([]);
      const { journeys } = await listOnboardingJourneys({ owner: "onb2", repo: "r" });
      expect(journeys).toHaveLength(0);
    });

    it("rejects an empty title, empty goal, empty step reason, or out-of-range confidence", async () => {
      const { model } = await seed({ owner: "onb3", repo: "r" });
      const moduleId = model.modules[0].id;

      await expect(
        createOnboardingJourney({ title: "  ", goal: "g", steps: [{ moduleId, reason: "r" }], confidence: 0.5, owner: "onb3", repo: "r" })
      ).rejects.toBeInstanceOf(InvalidToolArgumentsError);

      await expect(
        createOnboardingJourney({ title: "t", goal: " ", steps: [{ moduleId, reason: "r" }], confidence: 0.5, owner: "onb3", repo: "r" })
      ).rejects.toBeInstanceOf(InvalidToolArgumentsError);

      await expect(
        createOnboardingJourney({ title: "t", goal: "g", steps: [{ moduleId, reason: "  " }], confidence: 0.5, owner: "onb3", repo: "r" })
      ).rejects.toBeInstanceOf(InvalidToolArgumentsError);

      await expect(
        createOnboardingJourney({ title: "t", goal: "g", steps: [{ moduleId, reason: "r" }], confidence: 1.5, owner: "onb3", repo: "r" })
      ).rejects.toBeInstanceOf(InvalidToolArgumentsError);
    });

    it("rejects an empty steps array — a journey must point somewhere concrete", async () => {
      await seed({ owner: "onb4", repo: "r" });
      await expect(
        createOnboardingJourney({ title: "t", goal: "g", steps: [], confidence: 0.5, owner: "onb4", repo: "r" })
      ).rejects.toBeInstanceOf(InvalidToolArgumentsError);
    });
  });

  describe("listOnboardingJourneys", () => {
    it("lists previously created journeys with a disclosure", async () => {
      const { model } = await seed({ owner: "onb5", repo: "r" });
      await createOnboardingJourney({
        title: "Journey A",
        goal: "goal",
        steps: [{ moduleId: model.modules[0].id, reason: "reason" }],
        confidence: 0.8,
        owner: "onb5",
        repo: "r",
      });
      const { journeys, disclosure } = await listOnboardingJourneys({ owner: "onb5", repo: "r" });
      expect(journeys).toHaveLength(1);
      expect(journeys[0].title).toBe("Journey A");
      expect(disclosure).toContain("interpretation");
    });
  });

  describe("advanceOnboardingStep", () => {
    it("focuses a valid step and publishes the real module", async () => {
      const { model, worldId } = await seed({ owner: "onb6", repo: "r" });
      const controller = model.modules.find((m) => m.path.includes("controllers"))!;
      const service = model.modules.find((m) => m.path.includes("services"))!;
      const { result: created } = await capture(worldId, () =>
        createOnboardingJourney({
          title: "Journey B",
          goal: "goal",
          steps: [
            { moduleId: controller.id, reason: "first" },
            { moduleId: service.id, reason: "second" },
          ],
          confidence: 0.7,
          owner: "onb6",
          repo: "r",
        })
      );
      const journeyId = (created as any).journey.id;

      const { result, events } = await capture(worldId, () => advanceOnboardingStep({ journeyId, stepIndex: 1, owner: "onb6", repo: "r" }));
      expect(result).toMatchObject({ ok: true, journeyId, stepIndex: 1 });
      expect(events).toContainEqual(
        expect.objectContaining({ kind: "world-action", action: expect.objectContaining({ type: "focus_onboarding_step", stepIndex: 1, moduleId: service.id }) })
      );
    });

    it("rejects an unknown journey id", async () => {
      await seed({ owner: "onb7", repo: "r" });
      await expect(advanceOnboardingStep({ journeyId: "no-such-journey", stepIndex: 0, owner: "onb7", repo: "r" })).rejects.toBeInstanceOf(
        EntityNotFoundError
      );
    });

    it("rejects an out-of-range step index", async () => {
      const { model, worldId } = await seed({ owner: "onb8", repo: "r" });
      const { result: created } = await capture(worldId, () =>
        createOnboardingJourney({
          title: "Journey C",
          goal: "goal",
          steps: [{ moduleId: model.modules[0].id, reason: "only step" }],
          confidence: 0.6,
          owner: "onb8",
          repo: "r",
        })
      );
      const journeyId = (created as any).journey.id;
      await expect(advanceOnboardingStep({ journeyId, stepIndex: 5, owner: "onb8", repo: "r" })).rejects.toBeInstanceOf(
        InvalidToolArgumentsError
      );
    });
  });
});
