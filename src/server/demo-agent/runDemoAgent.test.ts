import { afterEach, describe, expect, it, vi } from "vitest";
import { seedWorld } from "@/server/testing/worldFixture";
import { worldStore } from "@/server/world/worldStore";
import { buildAgentPathGroups, buildAgentPathInventory, createDemoAgentRunState, resolveDemoAgentModel, runDemoAgentStep } from "./runDemoAgent";

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

    expect(listedPaths.length).toBeLessThanOrEqual(32 * 8);
    expect(listedPaths.every((filePath) => filePaths.includes(filePath))).toBe(true);
    expect(inventory).not.toContain("README.md");
    expect(inventory).not.toContain("sample.test.ts");
    expect(buildAgentPathGroups(filePaths)).toHaveLength(30);
  });

  it("starts in the modules phase with real paths available to the model", () => {
    const run = createDemoAgentRunState("world-1", "owner/repo", 2, ["src/index.ts", "src/services/api.ts"]);
    const systemMessage = run.messages[0] as { content: string };

    expect(run.phase).toBe("modules");
    expect(systemMessage.content).toContain("src/index.ts");
    expect(systemMessage.content).toContain("src/services/api.ts");
    expect(systemMessage.content).toContain('worldId "world-1"');
    expect(systemMessage.content).toContain("exactly one module for each listed directory group");
    expect(run.pathGroups).toHaveLength(2);
  });

  it("pages every module group, submits evidence-backed dependencies, and detects manifest frameworks", async () => {
    const { world, model } = await seedWorld({
      "client/auction/api-auction.js": "export const list = () => fetch('/api/auctions');\n",
      "client/auction/Auction.js": "import React from 'react';\nexport default function Auction() { return null; }\n",
      "client/auth/auth.js": "export const auth = true;\n",
      "client/cart/cart.js": "export const cart = true;\n",
      "server/controllers/controller.js": "export const controller = true;\n",
      "server/models/model.js": "import mongoose from 'mongoose';\nexport default mongoose.model('Item', {});\n",
      "server/routes/route.js": "import express from 'express';\nexport const route = express.Router();\n",
      "server/server.js": "import express from 'express';\nexport default express();\n",
      "package.json": JSON.stringify({ dependencies: { express: "4", mongoose: "5", react: "16" } }),
    }, { owner: "demo-agent-test", repo: "workflow" });
    const previousKey = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = "test-key";
    const groups = buildAgentPathGroups(model.files.map((file) => file.path));
    const toolResponse = (id: string, name: string, args: Record<string, unknown>) => ({
      choices: [{ message: { content: null, tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] } }],
    });
    groqCreate
      .mockRejectedValueOnce(new Error('400 {"type":"invalid_request_error","code":"tool_use_failed","message":"Failed to parse tool call arguments as JSON"}'))
      .mockResolvedValueOnce(toolResponse("modules-1", "submit_modules", {
        worldId: world.id,
        modules: groups.slice(0, 4).map((group) => ({ id: group.path, name: group.path, path: group.path, fileIds: group.fileIds, importance: 0.7 })),
      }))
      .mockResolvedValueOnce(toolResponse("modules-2", "submit_modules", {
        worldId: world.id,
        modules: groups.slice(4, 8).map((group) => ({ id: group.path, name: group.path, path: group.path, fileIds: group.fileIds, importance: 0.7 })),
      }))
      .mockResolvedValueOnce(toolResponse("dependencies-call", "submit_dependencies", {
        worldId: world.id,
        dependencies: [{ fromId: "client/auction", toId: "server/routes", fromKind: "module", toKind: "module", relationship: "http-request", confidence: 0.95 }],
      }))
      .mockResolvedValueOnce(toolResponse("frameworks-call", "submit_frameworks", {
        worldId: world.id,
        frameworks: [
          { name: "React", category: "frontend", evidence: ["client/auction/Auction.js"], confidence: 0.99 },
          { name: "Express", category: "backend", evidence: ["server/server.js"], confidence: 0.99 },
          { name: "Mongoose", category: "database", evidence: ["server/models/model.js"], confidence: 0.99 },
        ],
      }));

    try {
      const state = createDemoAgentRunState(
        world.id,
        world.repositoryId,
        model.files.length,
        model.files.map((file) => file.path),
        "package.json: express, mongoose, react",
        "client/auction/api-auction.js: fetch('/api/auctions')\nserver/routes/route.js: router.route('/api/auctions')"
      );
      const retryStep = await runDemoAgentStep(world.id, state, () => undefined);
      expect(retryStep.run.phase).toBe("modules");
      expect(retryStep.run.attempts).toBe(1);
      expect(retryStep.done).toBe(false);

      const firstModulesStep = await runDemoAgentStep(world.id, retryStep.run, () => undefined);
      expect(firstModulesStep.run.phase).toBe("modules");
      expect(firstModulesStep.run.moduleGroupIndex).toBe(4);

      const lastModulesStep = await runDemoAgentStep(world.id, firstModulesStep.run, () => undefined);
      expect(lastModulesStep.run.phase).toBe("dependencies");
      expect((lastModulesStep.run.messages[0] as { content: string }).content).toContain("fetch('/api/auctions')");

      const dependenciesStep = await runDemoAgentStep(world.id, lastModulesStep.run, () => undefined);
      expect(dependenciesStep.run.phase).toBe("frameworks");

      const frameworksStep = await runDemoAgentStep(world.id, dependenciesStep.run, () => undefined);
      expect(frameworksStep.run.phase).toBe("complete");
      expect(frameworksStep.done).toBe(true);

      const snapshot = await worldStore.getSnapshot(world.id);
      expect(snapshot?.knowledgeModel.modules.map((module) => module.id)).toContain("client/auth");
      expect(snapshot?.knowledgeModel.dependencies).toHaveLength(1);
      expect(snapshot?.knowledgeModel.repository.frameworks.map((framework) => framework.name)).toEqual(expect.arrayContaining(["React", "Express", "Mongoose"]));
      expect(snapshot?.worldModel.paths).toHaveLength(1);
    } finally {
      if (previousKey === undefined) delete process.env.GROQ_API_KEY;
      else process.env.GROQ_API_KEY = previousKey;
    }
  });
});
