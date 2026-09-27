import { describe, it, expect, vi, afterEach } from "vitest";
import { analyzeRepository } from "./analysisTools";
import { InvalidToolArgumentsError } from "./errors";
import { fakeSnapshot } from "@/server/testing/fixtures";
import { worldStore } from "@/server/world/worldStore";

vi.mock("@/server/ingestion/snapshotBuilder", () => ({
  buildRepositorySnapshot: vi.fn(),
}));

/**
 * `analyze_repository` — the agent-first entry point (docs/WORLD_ARCHITECTURE.md).
 * Mocks the tarball-fetching layer (`buildRepositorySnapshot`) so this can
 * run without a real network call, while exercising the REAL
 * `seedKnowledgeModel` + `createWorldFromAnalysis` code the production
 * handler uses.
 */
describe("analyzeRepository", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an empty repositoryUrl", async () => {
    await expect(analyzeRepository({ repositoryUrl: "" })).rejects.toBeInstanceOf(InvalidToolArgumentsError);
    await expect(analyzeRepository({ repositoryUrl: "   " })).rejects.toBeInstanceOf(InvalidToolArgumentsError);
  });

  it("rejects a URL that isn't a parseable GitHub owner/repo", async () => {
    await expect(analyzeRepository({ repositoryUrl: "not a url at all" })).rejects.toBeInstanceOf(InvalidToolArgumentsError);
  });

  it("fetches the repository's real file tree and creates a World, with no architecture analysis performed", async () => {
    const repoId = { owner: "analysis-tool-owner", repo: "app" };
    const snapshot = fakeSnapshot(
      { "src/index.js": `require('./controllers/orderController');\n`, "src/controllers/orderController.js": `app.get('/api/orders', () => {});\n` },
      repoId
    );
    const { buildRepositorySnapshot } = await import("@/server/ingestion/snapshotBuilder");
    vi.mocked(buildRepositorySnapshot).mockResolvedValue({ snapshot, cleanup: async () => {} });

    const result = await analyzeRepository({ repositoryUrl: "https://github.com/analysis-tool-owner/app" });

    expect(result.repository).toBe("analysis-tool-owner/app");
    expect(result.commitSha).toBe(snapshot.commitSha);
    expect(result.fileCount).toBe(2);
    expect(result.topLevelEntries).toEqual(["src"]);
    expect(result.worldUrl).toContain(result.worldId);
    expect(result.message).toContain(result.worldId);

    // The World this call created must be real and independently readable,
    // with a real file tree but NO modules/dependencies yet — those only
    // exist once a connected agent calls submit_modules/submit_dependencies.
    const stored = await worldStore.getSnapshot(result.worldId);
    expect(stored?.knowledgeModel.meta.repositoryId).toBe("analysis-tool-owner/app");
    expect(stored?.knowledgeModel.modules).toEqual([]);
    expect(stored?.knowledgeModel.files.length).toBe(2);
  });

  it("creates a NEW, independent World on a second call for the same repository", async () => {
    const repoId = { owner: "analysis-tool-owner2", repo: "app" };
    const snapshot = fakeSnapshot({ "src/index.js": `console.log(1);\n` }, repoId);
    const { buildRepositorySnapshot } = await import("@/server/ingestion/snapshotBuilder");
    vi.mocked(buildRepositorySnapshot).mockResolvedValue({ snapshot, cleanup: async () => {} });

    const first = await analyzeRepository({ repositoryUrl: "https://github.com/analysis-tool-owner2/app" });
    const second = await analyzeRepository({ repositoryUrl: "https://github.com/analysis-tool-owner2/app" });

    expect(first.worldId).not.toBe(second.worldId);
  });
});
