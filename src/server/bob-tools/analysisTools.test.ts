import { describe, it, expect, vi, afterEach } from "vitest";
import { analyzeRepository } from "./analysisTools";
import { InvalidToolArgumentsError } from "./errors";
import { buildTestKnowledgeModel } from "@/server/testing/knowledgeModelFixture";
import { knowledgeModelStore } from "@/server/knowledge-model/store";
import { worldStore } from "@/server/world/worldStore";

/**
 * `analyze_repository` — the Bob-first entry point (docs/WORLD_ARCHITECTURE.md).
 * The happy-path test mocks `fetchRepoMeta`'s two GitHub calls and pre-seeds
 * `knowledgeModelStore` by commit SHA so `runAnalysisPipeline` takes its
 * existing cache-hit path (same technique as
 * src/server/api-handlers/analyze.test.ts) — this proves `analyzeRepository`
 * genuinely calls the real, shared pipeline and creates a real World from
 * its result, without needing a real tarball download in a unit test.
 */
describe("analyzeRepository", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("rejects an empty repositoryUrl", async () => {
    await expect(analyzeRepository({ repositoryUrl: "" })).rejects.toBeInstanceOf(InvalidToolArgumentsError);
    await expect(analyzeRepository({ repositoryUrl: "   " })).rejects.toBeInstanceOf(InvalidToolArgumentsError);
  });

  it("rejects a URL that isn't a parseable GitHub owner/repo", async () => {
    await expect(analyzeRepository({ repositoryUrl: "not a url at all" })).rejects.toBeInstanceOf(InvalidToolArgumentsError);
  });

  it("analyzes a repository via the real shared pipeline and creates a real World with an honest summary", async () => {
    const repoId = { owner: "analysis-tool-owner", repo: "app" };
    const model = await buildTestKnowledgeModel(
      {
        "src/index.js": `require('./controllers/orderController');\n`,
        "src/controllers/orderController.js": `app.get('/api/orders', () => {});\n`,
      },
      repoId
    );
    await knowledgeModelStore.set(model);

    global.fetch = vi.fn(async (url: string) => {
      if (url.includes("/commits/")) {
        return new Response(JSON.stringify({ sha: model.meta.commitSha }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ default_branch: "main", description: null, full_name: "analysis-tool-owner/app" }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const result = await analyzeRepository({ repositoryUrl: "https://github.com/analysis-tool-owner/app" });

    expect(result.repository).toBe("analysis-tool-owner/app");
    expect(result.commitSha).toBe(model.meta.commitSha);
    expect(result.summary).toEqual({
      modules: model.modules.length,
      files: model.files.length,
      flows: expect.any(Number),
      entryPoints: model.entryPoints.length,
    });
    expect(result.worldUrl).toContain(result.worldId);
    expect(result.message).toContain(result.worldUrl);

    // The World this call created must be real and independently readable —
    // not just a shape returned to the caller.
    const snapshot = await worldStore.getSnapshot(result.worldId);
    expect(snapshot?.knowledgeModel.meta.repositoryId).toBe("analysis-tool-owner/app");
  });

  it("creates a NEW, independent World on a second call for the same repository", async () => {
    const repoId = { owner: "analysis-tool-owner2", repo: "app" };
    const model = await buildTestKnowledgeModel({ "src/index.js": `console.log(1);\n` }, repoId);
    await knowledgeModelStore.set(model);

    global.fetch = vi.fn(async (url: string) => {
      if (url.includes("/commits/")) return new Response(JSON.stringify({ sha: model.meta.commitSha }), { status: 200 });
      return new Response(JSON.stringify({ default_branch: "main", description: null, full_name: "x/x" }), { status: 200 });
    }) as unknown as typeof fetch;

    const first = await analyzeRepository({ repositoryUrl: "https://github.com/analysis-tool-owner2/app" });
    const second = await analyzeRepository({ repositoryUrl: "https://github.com/analysis-tool-owner2/app" });

    expect(first.worldId).not.toBe(second.worldId);
  });
});
