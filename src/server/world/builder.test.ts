import { describe, it, expect } from "vitest";
import { buildWorldModel } from "./builder";
import { RepositoryKnowledgeModelSchema, type RepositoryKnowledgeModel, type ModuleFact } from "@/types/knowledge-model";

function fakeModule(overrides: Partial<ModuleFact> & { id: string; name: string; path: string }): ModuleFact {
  return {
    description: null,
    fileIds: [`${overrides.path || overrides.id}/index.ts`],
    importance: 0.3,
    centrality: 0,
    complexity: { cyclomaticComplexity: 0, linesOfCode: 10, maintainabilityIndex: null },
    risk: [],
    dependencyIds: [],
    dependentIds: [],
    ...overrides,
  };
}

function fakeModel(modules: ModuleFact[], dependencies: RepositoryKnowledgeModel["dependencies"] = []): RepositoryKnowledgeModel {
  const files = modules.flatMap((m) =>
    m.fileIds.map((id) => ({
      id,
      path: id,
      type: "source" as const,
      language: "TypeScript",
      sizeBytes: 100,
      linesOfCode: 10,
      importance: 0,
      complexity: null,
      testStatus: { isTestFile: false, coveredByTests: false, testFileIds: [] },
      documentationStatus: { hasFileLevelDoc: false, docCommentCoverage: 0 },
      riskIndicators: [],
    }))
  );

  const model: RepositoryKnowledgeModel = {
    meta: {
      schemaVersion: "0.1.0",
      repositoryId: "test/repo",
      commitSha: "0".repeat(40),
      generatedAt: new Date().toISOString(),
      analyzerVersions: {},
    },
    repository: {
      id: "test/repo",
      owner: "test",
      name: "repo",
      url: "https://github.com/test/repo",
      defaultBranch: "main",
      description: null,
      languages: [],
      frameworks: [],
      statistics: {
        fileCount: files.length,
        totalLinesOfCode: 0,
        moduleCount: modules.length,
        contributorCount: 0,
        firstCommitAt: null,
        lastCommitAt: null,
      },
    },
    files,
    modules,
    dependencies,
    entryPoints: [],
    dataFlows: [],
    git: { commitFrequency: { period: "week", series: [] }, recentChanges: [], hotspots: [], contributors: [] },
    codeHealth: {
      largeFiles: [],
      todoFixme: [],
      deadCodeCandidates: [],
      duplicatedCodeCandidates: [],
      missingTests: [],
      deprecatedPatterns: [],
    },
    security: { vulnerableDependencies: [], patternMatches: [] },
    tests: { testFiles: [], coverage: { available: false, overallPercentage: null, byModule: [] }, missingTestCandidates: [] },
    documentation: {
      readme: { exists: false, fileId: null, sections: [] },
      docsDirectory: { exists: false, fileIds: [] },
      apiDocumentation: { exists: false, toolDetected: null, fileIds: [] },
      undocumentedImportantModules: [],
    },
    domainConcepts: [],
  };

  return RepositoryKnowledgeModelSchema.parse(model);
}

describe("world/builder label disambiguation", () => {
  it("disambiguates duplicate module names with their parent segment", () => {
    const model = fakeModel([
      fakeModule({ id: "lib/arguments", name: "arguments", path: "lib/arguments" }),
      fakeModule({ id: "types/arguments", name: "arguments", path: "types/arguments" }),
      fakeModule({ id: "lib/utils", name: "utils", path: "lib/utils" }),
    ]);

    const world = buildWorldModel(model);
    const names = world.regions.map((r) => r.name);

    expect(names).toContain("lib · arguments");
    expect(names).toContain("types · arguments");
    expect(names).toContain("utils"); // unique name left untouched
  });

  it("leaves unique names untouched", () => {
    const model = fakeModel([
      fakeModule({ id: "core", name: "core", path: "core" }),
      fakeModule({ id: "sdk", name: "sdk", path: "sdk" }),
    ]);
    const world = buildWorldModel(model);
    expect(world.regions.map((r) => r.name).sort()).toEqual(["core", "sdk"]);
  });
});

describe("world/builder ruins classification", () => {
  it("classifies a module flagged dead-code/deprecated as ruins, not a plain landmark", () => {
    const model = fakeModel([
      fakeModule({
        id: "legacy",
        name: "legacy",
        path: "legacy",
        importance: 0.9,
        risk: [{ kind: "deprecated-pattern", severity: "medium", detail: "old API", evidence: "legacy/index.ts" }],
      }),
      fakeModule({ id: "core", name: "core", path: "core", importance: 0.9 }),
    ]);
    const world = buildWorldModel(model);
    const legacyLandmark = world.landmarks.find((l) => l.sourceEntityId === "legacy");
    const coreLandmark = world.landmarks.find((l) => l.sourceEntityId === "core");
    expect(legacyLandmark?.type).toBe("ruins");
    expect(coreLandmark?.type).toBe("landmark");
  });
});

describe("world/builder path confidence", () => {
  it("averages confidence across file-level edges collapsed into one module path", () => {
    const a = fakeModule({ id: "a", name: "a", path: "a", fileIds: ["a/x.ts", "a/y.ts"] });
    const b = fakeModule({ id: "b", name: "b", path: "b", fileIds: ["b/z.ts"] });
    const model = fakeModel([a, b], [
      {
        id: "e1",
        fromId: "a/x.ts",
        toId: "b/z.ts",
        fromKind: "file",
        toKind: "file",
        relationship: "imports",
        direction: "uses",
        confidence: 1,
      },
      {
        id: "e2",
        fromId: "a/y.ts",
        toId: "b/z.ts",
        fromKind: "file",
        toKind: "file",
        relationship: "imports",
        direction: "uses",
        confidence: 0.5,
      },
    ]);

    const world = buildWorldModel(model);
    expect(world.paths).toHaveLength(1);
    expect(world.paths[0].confidence).toBeCloseTo(0.75, 5);
  });

  it("marks a bidirectional module dependency as cyclic", () => {
    const a = fakeModule({ id: "a", name: "a", path: "a", fileIds: ["a/x.ts"] });
    const b = fakeModule({ id: "b", name: "b", path: "b", fileIds: ["b/y.ts"] });
    const model = fakeModel([a, b], [
      {
        id: "e1",
        fromId: "a/x.ts",
        toId: "b/y.ts",
        fromKind: "file",
        toKind: "file",
        relationship: "imports",
        direction: "uses",
        confidence: 1,
      },
      {
        id: "e2",
        fromId: "b/y.ts",
        toId: "a/x.ts",
        fromKind: "file",
        toKind: "file",
        relationship: "imports",
        direction: "uses",
        confidence: 1,
      },
    ]);

    const world = buildWorldModel(model);
    expect(world.paths.every((p) => p.cyclic)).toBe(true);
    expect(world.paths).toHaveLength(2);
  });
});
