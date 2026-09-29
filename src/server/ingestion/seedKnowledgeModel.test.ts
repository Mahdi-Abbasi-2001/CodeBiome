import { describe, expect, it } from "vitest";
import { seedKnowledgeModel } from "./seedKnowledgeModel";
import type { RepositorySnapshot } from "./types";

describe("seedKnowledgeModel", () => {
  it("limits concurrent file reads to avoid exhausting file descriptors on large repositories", async () => {
    let active = 0;
    let maxActive = 0;

    const files = Array.from({ length: 80 }, (_, index) => ({
      path: `src/file-${index}.ts`,
      absolutePath: `/tmp/file-${index}.ts`,
      sizeBytes: 128,
      isBinary: false,
      readContent: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return "const value = 1;\n";
      },
    }));

    const snapshot: RepositorySnapshot = {
      repositoryId: "owner/repo",
      owner: "owner",
      repo: "repo",
      defaultBranch: "main",
      commitSha: "abc123",
      fetchedAt: new Date().toISOString(),
      description: null,
      files,
    };

    const model = await seedKnowledgeModel(snapshot);

    expect(model.files).toHaveLength(80);
    expect(maxActive).toBeLessThanOrEqual(16);
  });
});
