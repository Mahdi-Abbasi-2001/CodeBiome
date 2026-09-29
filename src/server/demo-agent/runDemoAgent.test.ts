import { afterEach, describe, expect, it, vi } from "vitest";
import { seedWorld } from "@/server/testing/worldFixture";
import { worldStore } from "@/server/world/worldStore";
import { buildAgentPathInventory, createDemoAgentRunState, resolveDemoAgentModel, runDemoAgentStep } from "./runDemoAgent";

const groqCreate = vi.hoisted(() => vi.fn());
const originalGroqKey = process.env.GROQ_API_KEY;

vi.mock("groq-sdk", () => ({
  default: class GroqMock {
    chat = { completions: { create: groqCreate } };
  },
}));

afterEach(() => {
  if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = originalGroqKey;
  groqCreate.mockReset();
});

describe("resolveDemoAgentModel", () => {
  it("prefers the explicit configured model first", () => {
    const ordered = resolveDemoAgentModel("custom/model");

    expect(ordered[0]).toBe("custom/model");
    expect(ordered).toContain("openai/gpt-oss-120b");
  });

  it("keeps a stable fallback list when the configured model is unavailable", () => {
    const ordered = resolveDemoAgentModel("missing/model");

    expect(ordered[0]).toBe("missing/model");
    expect(ordered.slice(1)).toEqual([
      "openai/gpt-oss-120b",
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "meta-llama/llama-4-scout-17b-16e-instruct",
    ]);
  });
});

describe("demo-agent repository context", () => {
  it("includes only real, representative source paths in the bounded inventory", () => {
    const filePaths = Array.from({ length: 30 }, (_, group) =>
      Array.from({ length: 5 }, (_, file) => `packages/pkg-${group}/src/file-${file}.ts`)
    ).flat();
    filePaths.push("packages/pkg-0/README.md", "packages/pkg-0/tests/sample.test.ts");

    const inventory = buildAgentPathInventory(filePaths);
    const listedPaths = inventory.match(/^\s+- (packages\/\S+)/gm)?.map((line) => line.trim().slice(2)) ?? [];

    expect(listedPaths.length).toBeLessThanOrEqual(16 * 2);
    expect(listedPaths.every((filePath) => filePaths.includes(filePath))).toBe(true);
    expect(inventory).not.toContain("README.md");
    expect(inventory).not.toContain("sample.test.ts");
  });

  it("starts in the modules phase with real paths available to the model", () => {
    const run = createDemoAgentRunState("world-1", "owner/repo", 2, ["src/index.ts", "src/services/api.ts"]);
    const systemMessage = run.messages[0] as { content: string };

    expect(run.phase).toBe("modules");
    expect(systemMessage.content).toContain("src/index.ts");
    expect(systemMessage.content).toContain("src/services/api.ts");
    expect(systemMessage.content).toContain('worldId "world-1"');
    expect(systemMessage.content).toContain("at most 8 real modules");
    expect(systemMessage.content).toContain("at most 2 fileIds per module");
  });

  it("persists successful module and dependency phases through real MCP submissions", async () => {
    const { world, model } = await seedWorld({
      "src/controllers/controller.ts": "export const controller = true;\n",
      "src/services/service.ts": "export const service = true;\n",
    }, { owner: "demo-agent-test", repo: "workflow" });
    const previousKey = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = "test-key";
    groqCreate
      .mockRejectedValueOnce(new Error('400 {"type":"invalid_request_error","code":"tool_use_failed","message":"Failed to parse tool call arguments as JSON"}'))
      .mockResolvedValueOnce({
        choices: [{ message: { content: null, tool_calls: [{ id: "modules-call", type: "function", function: { name: "submit_modules", arguments: JSON.stringify({
          worldId: world.id,
          modules: [
            { id: "src/controllers", name: "Controllers", path: "src/controllers", fileIds: ["src/controllers/controller.ts"], importance: 0.8 },
            { id: "src/services", name: "Services", path: "src/services", fileIds: ["src/services/service.ts"], importance: 0.7 },
          ],
        }) } }] } }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: null, tool_calls: [{ id: "dependencies-call", type: "function", function: { name: "submit_dependencies", arguments: JSON.stringify({
          worldId: world.id,
          dependencies: [{ fromId: "src/controllers", toId: "src/services", fromKind: "module", toKind: "module", relationship: "calls", confidence: 0.8 }],
        }) } }] } }],
      });

    try {
      const state = createDemoAgentRunState(world.id, world.repositoryId, model.files.length, model.files.map((file) => file.path));
      const retryStep = await runDemoAgentStep(world.id, state, () => undefined);
      expect(retryStep.run.phase).toBe("modules");
      expect(retryStep.run.attempts).toBe(1);
      expect(retryStep.done).toBe(false);

      const modulesStep = await runDemoAgentStep(world.id, retryStep.run, () => undefined);
      expect(modulesStep.run.phase).toBe("dependencies");
      expect(modulesStep.done).toBe(false);

      const dependenciesStep = await runDemoAgentStep(world.id, modulesStep.run, () => undefined);
      expect(dependenciesStep.run.phase).toBe("complete");
      expect(dependenciesStep.done).toBe(true);

      const snapshot = await worldStore.getSnapshot(world.id);
      expect(snapshot?.knowledgeModel.modules.map((module) => module.id)).toContain("src/controllers");
      expect(snapshot?.knowledgeModel.dependencies).toHaveLength(1);
    } finally {
      if (previousKey === undefined) delete process.env.GROQ_API_KEY;
      else process.env.GROQ_API_KEY = previousKey;
    }
  });
});
