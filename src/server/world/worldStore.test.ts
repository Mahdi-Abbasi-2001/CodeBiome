import { describe, it, expect } from "vitest";
import { worldStore } from "./worldStore";
import { buildTestKnowledgeModel } from "@/server/testing/knowledgeModelFixture";
import { buildWorldModel } from "@/server/world/builder";

/**
 * Direct coverage of the World persistence layer itself
 * (docs/WORLD_ARCHITECTURE.md) — the tests in src/server/testing/
 * worldFixture.ts and the various bob-tools tests exercise this
 * indirectly through real tool calls; these tests exercise `worldStore`'s
 * own contract directly: creation, retrieval by id/owner-repo/most-recent,
 * mutable-state read-modify-write, and the durable event log
 * `getEventsSince` reads through for cross-instance SSE catch-up
 * (src/server/api-handlers/bobEvents.ts).
 *
 * Runs against whichever implementation `worldStore` resolves to in this
 * environment — `InMemoryWorldStore` here (no `BLOB_READ_WRITE_TOKEN` in
 * CI/test), `BlobWorldStore` in production — both implement the exact same
 * interface, so this is real coverage of the contract either way.
 */
async function buildSnapshotFor(repoId: { owner: string; repo: string }) {
  const knowledgeModel = await buildTestKnowledgeModel(
    { "src/index.js": `console.log('hi');\n` },
    repoId
  );
  return {
    knowledgeModel,
    flowModel: { meta: { repositoryKnowledgeModelId: knowledgeModel.meta.repositoryId, generatedAt: knowledgeModel.meta.generatedAt }, flows: [] },
    journeyModel: { meta: { repositoryKnowledgeModelId: knowledgeModel.meta.repositoryId, generatedAt: knowledgeModel.meta.generatedAt }, journeys: [] },
    worldModel: buildWorldModel(knowledgeModel),
  };
}

describe("worldStore", () => {
  it("creates a World with an opaque id, and retrieves the same record and snapshot back by that id", async () => {
    const snapshot = await buildSnapshotFor({ owner: "ws-owner1", repo: "app" });
    const world = await worldStore.createWorld({
      repositoryUrl: "https://github.com/ws-owner1/app",
      repositoryId: "ws-owner1/app",
      commitSha: snapshot.knowledgeModel.meta.commitSha,
      snapshot,
    });

    expect(world.id).toBeTruthy();
    expect(world.repositoryId).toBe("ws-owner1/app");

    const fetchedWorld = await worldStore.getWorld(world.id);
    expect(fetchedWorld).toEqual(world);

    const fetchedSnapshot = await worldStore.getSnapshot(world.id);
    expect(fetchedSnapshot?.knowledgeModel.meta.repositoryId).toBe("ws-owner1/app");
    expect(fetchedSnapshot?.flowModel).toBeDefined();
    expect(fetchedSnapshot?.worldModel).toBeDefined();
  });

  it("returns null for a World id that was never created", async () => {
    expect(await worldStore.getWorld("this-id-does-not-exist")).toBeNull();
    expect(await worldStore.getSnapshot("this-id-does-not-exist")).toBeNull();
    expect(await worldStore.getDemoAgentRun("this-id-does-not-exist")).toBeNull();
  });

  it("persists private demo-agent continuation state per World", async () => {
    const snapshot = await buildSnapshotFor({ owner: "ws-agent", repo: "app" });
    const world = await worldStore.createWorld({
      repositoryUrl: "https://github.com/ws-agent/app",
      repositoryId: "ws-agent/app",
      commitSha: snapshot.knowledgeModel.meta.commitSha,
      snapshot,
    });
    const run = { phase: "dependencies" as const, attempts: 0, moduleGroupIndex: 0, pathGroups: [], manifestEvidence: "", relationshipEvidence: "", dependencyHints: [], messages: [{ role: "user", content: "continue" }] };

    await worldStore.setDemoAgentRun(world.id, run);

    expect(await worldStore.getDemoAgentRun(world.id)).toEqual(run);
    expect(await worldStore.getMutableState(world.id)).not.toHaveProperty("demoAgentRun");
  });

  it("resolves the most recently created World for a repository via getLatestWorldIdForRepository", async () => {
    const repoId = { owner: "ws-owner2", repo: "app" };
    const snapshot1 = await buildSnapshotFor(repoId);
    await worldStore.createWorld({
      repositoryUrl: "https://github.com/ws-owner2/app",
      repositoryId: "ws-owner2/app",
      commitSha: snapshot1.knowledgeModel.meta.commitSha,
      snapshot: snapshot1,
    });

    const snapshot2 = await buildSnapshotFor(repoId);
    const world2 = await worldStore.createWorld({
      repositoryUrl: "https://github.com/ws-owner2/app",
      repositoryId: "ws-owner2/app",
      commitSha: snapshot2.knowledgeModel.meta.commitSha,
      snapshot: snapshot2,
    });

    // The SAME repository analyzed twice produces two independent Worlds —
    // the latest lookup must resolve to the second one, not the first.
    expect(await worldStore.getLatestWorldIdForRepository("ws-owner2/app")).toBe(world2.id);
  });

  it("getMostRecentWorldId resolves to whichever World was created last, across all repositories", async () => {
    const snapshotA = await buildSnapshotFor({ owner: "ws-owner3", repo: "a" });
    await worldStore.createWorld({
      repositoryUrl: "https://github.com/ws-owner3/a",
      repositoryId: "ws-owner3/a",
      commitSha: snapshotA.knowledgeModel.meta.commitSha,
      snapshot: snapshotA,
    });

    const snapshotB = await buildSnapshotFor({ owner: "ws-owner3", repo: "b" });
    const worldB = await worldStore.createWorld({
      repositoryUrl: "https://github.com/ws-owner3/b",
      repositoryId: "ws-owner3/b",
      commitSha: snapshotB.knowledgeModel.meta.commitSha,
      snapshot: snapshotB,
    });

    expect(await worldStore.getMostRecentWorldId()).toBe(worldB.id);
  });

  it("isolates mutable state between two Worlds created from the same repository", async () => {
    const repoId = { owner: "ws-owner4", repo: "app" };
    const snapshot1 = await buildSnapshotFor(repoId);
    const worldA = await worldStore.createWorld({
      repositoryUrl: "https://github.com/ws-owner4/app",
      repositoryId: "ws-owner4/app",
      commitSha: `${snapshot1.knowledgeModel.meta.commitSha}-a`,
      snapshot: snapshot1,
    });
    const snapshot2 = await buildSnapshotFor(repoId);
    const worldB = await worldStore.createWorld({
      repositoryUrl: "https://github.com/ws-owner4/app",
      repositoryId: "ws-owner4/app",
      commitSha: `${snapshot2.knowledgeModel.meta.commitSha}-b`,
      snapshot: snapshot2,
    });

    await worldStore.updateMutableState(worldA.id, (state) => ({
      ...state,
      sessionContext: {
        selectedModuleId: "root",
        selectedModuleName: "root",
        activeFlowId: null,
        activeFlowName: null,
        currentStepId: null,
        currentStepLabel: null,
        activeOnboardingJourneyId: null,
        activeOnboardingJourneyTitle: null,
        currentOnboardingStepIndex: null,
        currentOnboardingStepReason: null,
        updatedAt: new Date().toISOString(),
      },
    }));

    const stateA = await worldStore.getMutableState(worldA.id);
    const stateB = await worldStore.getMutableState(worldB.id);
    expect(stateA.sessionContext?.selectedModuleId).toBe("root");
    expect(stateB.sessionContext).toBeNull();
  });

  it("appendEvent/getEventsSince supports incremental cross-request catch-up (what the SSE poll relies on)", async () => {
    const snapshot = await buildSnapshotFor({ owner: "ws-owner5", repo: "app" });
    const world = await worldStore.createWorld({
      repositoryUrl: "https://github.com/ws-owner5/app",
      repositoryId: "ws-owner5/app",
      commitSha: snapshot.knowledgeModel.meta.commitSha,
      snapshot,
    });

    await worldStore.appendEvent(world.id, {
      kind: "activity",
      worldId: world.id,
      repositoryId: world.repositoryId,
      tool: "get_module",
      args: {},
      summary: "Inspected module \"root\"",
      at: new Date().toISOString(),
    });

    const first = await worldStore.getEventsSince(world.id, 0);
    expect(first.events).toHaveLength(1);
    expect(first.latestIndex).toBe(1);

    // Simulates "Request B" (a different SSE poll / instance) picking up
    // ONLY what's new since its last known cursor — the core mechanism
    // src/server/api-handlers/bobEvents.ts relies on for cross-instance
    // delivery (docs/WORLD_ARCHITECTURE.md §7).
    const caughtUp = await worldStore.getEventsSince(world.id, first.latestIndex);
    expect(caughtUp.events).toHaveLength(0);

    await worldStore.appendEvent(world.id, {
      kind: "activity",
      worldId: world.id,
      repositoryId: world.repositoryId,
      tool: "list_flows",
      args: {},
      summary: "1 flow(s)",
      at: new Date().toISOString(),
    });

    const second = await worldStore.getEventsSince(world.id, first.latestIndex);
    expect(second.events).toHaveLength(1);
    expect((second.events[0] as { tool: string }).tool).toBe("list_flows");
  });
});
