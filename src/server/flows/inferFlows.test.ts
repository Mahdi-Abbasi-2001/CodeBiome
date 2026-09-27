import { describe, it, expect } from "vitest";
import { inferFlows, classifyLayer } from "./inferFlows";
import { RepositoryKnowledgeModelSchema, type RepositoryKnowledgeModel, type ModuleFact, type FileFact } from "@/types/knowledge-model";

function fakeFile(id: string, overrides: Partial<FileFact> = {}): FileFact {
  return {
    id,
    path: id,
    type: "source",
    language: "TypeScript",
    sizeBytes: 100,
    linesOfCode: 20,
    importance: 0,
    complexity: null,
    testStatus: { isTestFile: false, coveredByTests: false, testFileIds: [] },
    documentationStatus: { hasFileLevelDoc: false, docCommentCoverage: 0 },
    riskIndicators: [],
    ...overrides,
  };
}

function fakeModule(id: string, fileIds: string[], importance = 0.3): ModuleFact {
  return {
    id,
    name: id,
    path: id,
    description: null,
    fileIds,
    importance,
    centrality: 0,
    complexity: { cyclomaticComplexity: 0, linesOfCode: 10, maintainabilityIndex: null },
    risk: [],
    dependencyIds: [],
    dependentIds: [],
  };
}

function fakeModel(files: FileFact[], modules: ModuleFact[], dependencies: RepositoryKnowledgeModel["dependencies"], entryPoints: RepositoryKnowledgeModel["entryPoints"]): RepositoryKnowledgeModel {
  const model: RepositoryKnowledgeModel = {
    meta: { schemaVersion: "0.1.0", repositoryId: "test/repo", commitSha: "0".repeat(40), generatedAt: new Date().toISOString(), analyzerVersions: {} },
    repository: {
      id: "test/repo",
      owner: "test",
      name: "repo",
      url: "https://github.com/test/repo",
      defaultBranch: "main",
      description: null,
      languages: [],
      frameworks: [],
      statistics: { fileCount: files.length, totalLinesOfCode: 0, moduleCount: modules.length, contributorCount: 0, firstCommitAt: null, lastCommitAt: null },
    },
    files,
    modules,
    dependencies,
    entryPoints,
    dataFlows: [],
    git: { commitFrequency: { period: "week", series: [] }, recentChanges: [], hotspots: [], contributors: [] },
    codeHealth: { largeFiles: [], todoFixme: [], deadCodeCandidates: [], duplicatedCodeCandidates: [], missingTests: [], deprecatedPatterns: [] },
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

function edge(id: string, fromId: string, toId: string, confidence = 1): RepositoryKnowledgeModel["dependencies"][number] {
  return { id, fromId, toId, fromKind: "file", toKind: "file", relationship: "imports", direction: "uses", confidence };
}

describe("classifyLayer", () => {
  it("never mistakes a repo's frontend client/ directory for an API-client wrapper", () => {
    expect(classifyLayer("client/App.js")).toBe("function");
    expect(classifyLayer("client/auth/Signin.js")).toBe("function");
  });

  it("still recognizes a genuine API-client wrapper file or directory", () => {
    expect(classifyLayer("src/api-client.ts")).toBe("external-api");
    expect(classifyLayer("src/clients/stripeClient.ts")).toBe("external-api");
    expect(classifyLayer("src/sdk/github.ts")).toBe("external-api");
  });
});

describe("inferFlows", () => {
  it("builds a controller -> service -> repository -> database chain from real edges", () => {
    const files = [
      fakeFile("src/controllers/OrderController.ts"),
      fakeFile("src/services/OrderService.ts"),
      fakeFile("src/repositories/OrderRepository.ts"),
      fakeFile("src/db/database.ts"),
    ];
    const modules = [fakeModule("src", files.map((f) => f.id))];
    const dependencies = [
      edge("e1", "src/controllers/OrderController.ts", "src/services/OrderService.ts"),
      edge("e2", "src/services/OrderService.ts", "src/repositories/OrderRepository.ts"),
      edge("e3", "src/repositories/OrderRepository.ts", "src/db/database.ts"),
    ];
    const entryPoints = [
      { id: "entry-0", type: "http-route" as const, name: "/api/orders", fileId: "src/controllers/OrderController.ts", detectionEvidence: "Matched a NestJS route pattern" },
    ];

    const model = fakeModel(files, modules, dependencies, entryPoints);
    const flowModel = inferFlows(model);

    expect(flowModel.flows).toHaveLength(1);
    const flow = flowModel.flows[0];
    expect(flow.name.toLowerCase()).toContain("order");
    expect(flow.steps.map((s) => s.entityId)).toEqual([
      "src/controllers/OrderController.ts",
      "src/services/OrderService.ts",
      "src/repositories/OrderRepository.ts",
      "src/db/database.ts",
    ]);
    expect(flow.steps.map((s) => s.kind)).toEqual(["controller", "service", "repository", "database"]);
    expect(flow.steps[3].kind).toBe("database"); // stops at the terminal layer
    expect(flow.confidence).toBe("high");
  });

  it("names a flow after the resource, not a trailing connector word like 'by'", () => {
    const files = [fakeFile("src/routes/product.routes.js"), fakeFile("src/controllers/product.controller.js")];
    const modules = [fakeModule("src", files.map((f) => f.id))];
    const dependencies = [edge("e1", "src/routes/product.routes.js", "src/controllers/product.controller.js")];
    const entryPoints = [
      { id: "entry-0", type: "http-route" as const, name: "/api/products/by/:shopId", fileId: "src/routes/product.routes.js", detectionEvidence: "Matched an Express Router (chained) route pattern" },
    ];

    const model = fakeModel(files, modules, dependencies, entryPoints);
    const flowModel = inferFlows(model);

    expect(flowModel.flows).toHaveLength(1);
    expect(flowModel.flows[0].name).toBe("Products");
  });

  it("collapses distinctly-named routes into one flow when they resolve to the identical file-level chain", () => {
    const files = [
      fakeFile("src/routes/order.routes.js"),
      fakeFile("src/controllers/order.controller.js"),
      fakeFile("src/models/order.model.js"),
    ];
    const modules = [fakeModule("src", files.map((f) => f.id))];
    const dependencies = [
      edge("e1", "src/routes/order.routes.js", "src/controllers/order.controller.js"),
      edge("e2", "src/controllers/order.controller.js", "src/models/order.model.js"),
    ];
    // Six different registered routes, all in the same route file — same
    // shape as a real Express `router.route(path).get(...)` file exporting
    // several endpoints that all happen to import the same controller.
    const entryPoints = ["/api/orders/:userId", "/api/order/status_values", "/api/order/:orderId/charge/:userId/:shopId", "/api/order/:shopId/cancel/:productId", "/api/orders/shop/:shopId", "/api/orders/user/:userId"].map(
      (name, i) => ({ id: `entry-${i}`, type: "http-route" as const, name, fileId: "src/routes/order.routes.js", detectionEvidence: "Matched an Express Router (chained) route pattern" })
    );

    const model = fakeModel(files, modules, dependencies, entryPoints);
    const flowModel = inferFlows(model);

    expect(flowModel.flows).toHaveLength(1);
  });

  it("never references a file that doesn't exist in the model", () => {
    const files = [fakeFile("a.ts"), fakeFile("b.ts")];
    const modules = [fakeModule("root", files.map((f) => f.id))];
    const dependencies = [edge("e1", "a.ts", "b.ts")];
    const entryPoints = [{ id: "entry-0", type: "app-startup" as const, name: "a.ts", fileId: "a.ts", detectionEvidence: "Conventional entry-point filename" }];

    const model = fakeModel(files, modules, dependencies, entryPoints);
    const flowModel = inferFlows(model);

    const realIds = new Set(files.map((f) => f.id));
    for (const flow of flowModel.flows) {
      for (const step of flow.steps) {
        expect(realIds.has(step.entityId)).toBe(true);
      }
    }
  });

  it("produces no flow for an entry point with no outgoing edges", () => {
    const files = [fakeFile("lonely.ts")];
    const modules = [fakeModule("root", files.map((f) => f.id))];
    const entryPoints = [{ id: "entry-0", type: "app-startup" as const, name: "lonely.ts", fileId: "lonely.ts", detectionEvidence: "Conventional entry-point filename" }];

    const model = fakeModel(files, modules, [], entryPoints);
    const flowModel = inferFlows(model);

    expect(flowModel.flows).toHaveLength(0);
  });

  it("marks a step reached via a low-confidence edge as low confidence, and the whole flow as its weakest step", () => {
    const files = [fakeFile("src/controllers/SearchController.ts"), fakeFile("src/lib/es_client.ts")];
    const modules = [fakeModule("src", files.map((f) => f.id))];
    const dependencies = [edge("e1", "src/controllers/SearchController.ts", "src/lib/es_client.ts", 0.5)];
    const entryPoints = [
      { id: "entry-0", type: "http-route" as const, name: "/api/search", fileId: "src/controllers/SearchController.ts", detectionEvidence: "Matched a Flask/FastAPI route pattern" },
    ];

    const model = fakeModel(files, modules, dependencies, entryPoints);
    const flowModel = inferFlows(model);

    expect(flowModel.flows).toHaveLength(1);
    expect(flowModel.flows[0].steps[1].confidence).toBe("low");
    expect(flowModel.flows[0].confidence).toBe("low");
  });
});
