import { describe, it, expect } from "vitest";
import { seedWorld } from "@/server/testing/worldFixture";
import { worldStore } from "@/server/world/worldStore";
import { listFlows } from "./flowTools";
import { openModule, startFlow, focusFlowStep, openFile, showDependencies, showImpact } from "./worldActionTools";
import { EntityNotFoundError, InvalidToolArgumentsError } from "./errors";

// One directory per layer — see flowTools.test.ts for why (structure-analyzer
// groups modules by directory, so a flat "src" would collapse into one).
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

/** Captures every event published during `fn()`, reading through the same durable worldStore every tool publishes to — see src/server/bob/eventBus.ts. */
async function capture(worldId: string, fn: () => Promise<unknown>) {
  const before = await worldStore.getEventsSince(worldId, 0);
  const result = await fn();
  const after = await worldStore.getEventsSince(worldId, before.latestIndex);
  return { result, events: after.events };
}

describe("worldActionTools", () => {
  it("open_module validates the module exists and publishes a real world-action event", async () => {
    const { model, worldId } = await seed({ owner: "act1", repo: "r" });
    const moduleId = model.modules[0].id;
    const { result, events } = await capture(worldId, () => openModule({ moduleId, owner: "act1", repo: "r" }));
    expect(result).toMatchObject({ ok: true, moduleId });
    expect(events).toContainEqual(
      expect.objectContaining({ kind: "world-action", worldId, action: expect.objectContaining({ type: "open_module", moduleId }) })
    );
  });

  it("open_module rejects a nonexistent module without publishing anything — never navigates to a fabricated entity", async () => {
    const { worldId } = await seed({ owner: "act2", repo: "r" });
    const { events } = await capture(worldId, async () => {
      await expect(openModule({ moduleId: "no-such-module", owner: "act2", repo: "r" })).rejects.toBeInstanceOf(EntityNotFoundError);
    });
    expect(events).toEqual([]);
  });

  it("start_flow accepts a real flow id or name and publishes start_flow", async () => {
    const { worldId } = await seed({ owner: "act3", repo: "r" });
    const { flows } = await listFlows({ owner: "act3", repo: "r" });
    const { result, events } = await capture(worldId, () => startFlow({ flowId: flows[0].name, owner: "act3", repo: "r" }));
    expect(result).toMatchObject({ ok: true, flowId: flows[0].id });
    expect(events.some((e: any) => e.kind === "world-action" && e.action.type === "start_flow")).toBe(true);
  });

  it("focus_flow_step rejects an out-of-range stepIndex with a clear message, not a crash", async () => {
    await seed({ owner: "act4", repo: "r" });
    const { flows } = await listFlows({ owner: "act4", repo: "r" });
    await expect(focusFlowStep({ flowId: flows[0].id, stepIndex: 999, owner: "act4", repo: "r" })).rejects.toBeInstanceOf(
      InvalidToolArgumentsError
    );
  });

  it("focus_flow_step on a valid index publishes the real step label", async () => {
    const { worldId } = await seed({ owner: "act5", repo: "r" });
    const { flows } = await listFlows({ owner: "act5", repo: "r" });
    const flow = flows[0];
    const { result } = await capture(worldId, () => focusFlowStep({ flowId: flow.id, stepIndex: 0, owner: "act5", repo: "r" }));
    expect(result).toMatchObject({ ok: true, stepIndex: 0 });
  });

  it("open_file resolves the owning module and rejects a path that isn't in the repository", async () => {
    const { worldId } = await seed({ owner: "act6", repo: "r" });
    const { result } = await capture(worldId, () => openFile({ path: "src/index.js", owner: "act6", repo: "r" }));
    expect(result).toMatchObject({ ok: true, path: "src/index.js" });

    await expect(openFile({ path: "src/nope.js", owner: "act6", repo: "r" })).rejects.toBeInstanceOf(EntityNotFoundError);
  });

  it("show_dependencies publishes with the real dependency count", async () => {
    const { model, worldId } = await seed({ owner: "act7", repo: "r" });
    const controller = model.modules.find((m) => m.path.includes("controllers"))!;
    const { result } = await capture(worldId, () => showDependencies({ moduleId: controller.id, owner: "act7", repo: "r" }));
    expect(result).toMatchObject({ ok: true, moduleId: controller.id });
  });

  it("show_impact computes real transitive dependents and publishes them", async () => {
    const { model, worldId } = await seed({ owner: "act8", repo: "r" });
    const repository = model.modules.find((m) => m.path.includes("repositories"))!;
    const { result, events } = await capture(worldId, () => showImpact({ moduleId: repository.id, owner: "act8", repo: "r" }));
    expect((result as any).affectedModules.length).toBeGreaterThan(0);
    const action = events.find((e: any) => e.kind === "world-action") as any;
    expect(action.action.type).toBe("show_impact");
    expect(action.action.affectedModuleIds).toEqual((result as any).affectedModules.map((m: any) => m.id));
  });
});
