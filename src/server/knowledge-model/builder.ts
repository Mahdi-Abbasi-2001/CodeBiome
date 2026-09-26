import type { RepositorySnapshot } from "../ingestion/types";
import type { AnalyzerRunSummary } from "../analyzers/runner";
import type { StructureAnalyzerOutput } from "../analyzers/structure-analyzer";
import type { AnalyzerResult } from "../analyzers/types";
import type { DependencyEdgeDraft } from "../analyzers/dependency-analyzer";
import type { SecurityAnalyzerOutput } from "../analyzers/security-analyzer";
import type { EntryPointAnalyzerOutput } from "../analyzers/entry-point-analyzer";
import {
  RepositoryKnowledgeModelSchema,
  type RepositoryKnowledgeModel,
  type FileFact,
  type ModuleFact,
  type DependencyEdge,
} from "@/types/knowledge-model";

/**
 * Aggregates analyzer outputs into the full Repository Knowledge Model.
 * Sections with no v1 analyzer (git, codeHealth beyond large-files, tests
 * beyond detection, documentation beyond README, dataFlows, domainConcepts)
 * are populated with valid empty/default values — the schema is never
 * trimmed, only progressively filled in as analyzers are added. See
 * docs/ARCHITECTURE_DECISIONS.md.
 */
// Every per-language dependency analyzer produces the same
// `{ edges: DependencyEdgeDraft[] }` shape and prefixes its own edge ids
// ("dep-", "pydep-", "rsdep-", "godep-", "javadep-", "cdep-", "csdep-",
// "rbdep-", "phpdep-"), so merging all of them is a plain concatenation with
// no collision risk. Adding a new language analyzer means implementing it
// (see ANALYZER_ARCHITECTURE.md's extension contract) and adding its id
// here — nothing else in this function changes.
const DEPENDENCY_ANALYZER_IDS = [
  "dependency-analyzer",
  "python-dependency-analyzer",
  "rust-dependency-analyzer",
  "go-dependency-analyzer",
  "java-dependency-analyzer",
  "c-family-dependency-analyzer",
  "csharp-dependency-analyzer",
  "ruby-dependency-analyzer",
  "php-dependency-analyzer",
];

function collectDependencyEdges(run: AnalyzerRunSummary): DependencyEdgeDraft[] {
  const edges: DependencyEdgeDraft[] = [];
  for (const analyzerId of DEPENDENCY_ANALYZER_IDS) {
    const result = run.results.get(analyzerId) as AnalyzerResult<{ edges: DependencyEdgeDraft[] }> | undefined;
    if (result) edges.push(...result.data.edges);
  }
  return edges;
}

export function buildKnowledgeModel(snapshot: RepositorySnapshot, run: AnalyzerRunSummary): RepositoryKnowledgeModel {
  const structure = run.results.get("structure-analyzer")?.data as StructureAnalyzerOutput | undefined;

  if (!structure) {
    throw new Error("structure-analyzer did not produce a result; cannot build knowledge model");
  }

  const fileModuleId = new Map<string, string>();
  for (const mod of structure.modules) {
    for (const fileId of mod.fileIds) fileModuleId.set(fileId, mod.id);
  }

  const edges = collectDependencyEdges(run);

  const moduleOutDegree = new Map<string, Set<string>>();
  const moduleInDegree = new Map<string, Set<string>>();
  for (const edge of edges) {
    const fromModule = fileModuleId.get(edge.fromId);
    const toModule = edge.toKind === "file" ? fileModuleId.get(edge.toId) : undefined;
    if (!fromModule || !toModule || fromModule === toModule) continue;
    if (!moduleOutDegree.has(fromModule)) moduleOutDegree.set(fromModule, new Set());
    moduleOutDegree.get(fromModule)!.add(toModule);
    if (!moduleInDegree.has(toModule)) moduleInDegree.set(toModule, new Set());
    moduleInDegree.get(toModule)!.add(fromModule);
  }

  const maxDegree = Math.max(
    1,
    ...structure.modules.map((m) => (moduleOutDegree.get(m.id)?.size ?? 0) + (moduleInDegree.get(m.id)?.size ?? 0))
  );

  const fileById = new Map(structure.files.map((f) => [f.id, f]));

  const entryPointResult = run.results.get("entry-point-analyzer")?.data as EntryPointAnalyzerOutput | undefined;
  const security = run.results.get("security-analyzer")?.data as SecurityAnalyzerOutput | undefined;
  const securityFindingsByFile = new Map<string, NonNullable<typeof security>["patternMatches"]>();
  for (const finding of security?.patternMatches ?? []) {
    if (!securityFindingsByFile.has(finding.fileId)) securityFindingsByFile.set(finding.fileId, []);
    securityFindingsByFile.get(finding.fileId)!.push(finding);
  }

  const files: FileFact[] = structure.files.map((f) => {
    const riskIndicators: FileFact["riskIndicators"] = [];
    if (f.sizeBytes > 100_000) {
      riskIndicators.push({
        kind: "large-file",
        severity: "medium",
        detail: "File exceeds 100KB",
        evidence: `${f.sizeBytes} bytes`,
      });
    }
    for (const finding of securityFindingsByFile.get(f.id) ?? []) {
      riskIndicators.push({
        kind: "hardcoded-secret-pattern",
        severity: finding.severity === "critical" || finding.severity === "high" ? "high" : "medium",
        detail: `Matched rule "${finding.rule}"`,
        evidence: `line ${finding.line}`,
      });
    }

    return {
      id: f.id,
      path: f.path,
      type: f.type,
      language: f.language,
      sizeBytes: f.sizeBytes,
      linesOfCode: f.linesOfCode,
      importance: 0, // v1: importance is only computed at module granularity
      complexity: null,
      testStatus: { isTestFile: f.isTestFile, coveredByTests: false, testFileIds: [] },
      documentationStatus: { hasFileLevelDoc: false, docCommentCoverage: 0 },
      riskIndicators,
    };
  });

  const fileFactById = new Map(files.map((f) => [f.id, f]));

  const modules: ModuleFact[] = structure.modules.map((m) => {
    const degree = (moduleOutDegree.get(m.id)?.size ?? 0) + (moduleInDegree.get(m.id)?.size ?? 0);
    const centrality = degree / maxDegree;
    const sizeScore = Math.min(1, m.fileIds.length / 20);
    const importance = Math.min(1, 0.5 * centrality + 0.5 * sizeScore);
    const totalLoc = m.fileIds.reduce((sum, id) => sum + (fileById.get(id)?.linesOfCode ?? 0), 0);

    // Roll up real file-level risk indicators onto the module — not a new
    // signal, just aggregation of facts already computed per file.
    const risk = m.fileIds.flatMap((fileId) => fileFactById.get(fileId)?.riskIndicators ?? []);

    return {
      id: m.id,
      name: m.name,
      path: m.path,
      description: null,
      fileIds: m.fileIds,
      importance,
      centrality,
      complexity: { cyclomaticComplexity: 0, linesOfCode: totalLoc, maintainabilityIndex: null },
      risk,
      dependencyIds: [...(moduleOutDegree.get(m.id) ?? [])],
      dependentIds: [...(moduleInDegree.get(m.id) ?? [])],
    };
  });

  const dependencies: DependencyEdge[] = edges.map((e) => ({ ...e }));

  const totalLinesOfCode = files.reduce((sum, f) => sum + f.linesOfCode, 0);

  const model: RepositoryKnowledgeModel = {
    meta: {
      schemaVersion: "0.1.0",
      repositoryId: snapshot.repositoryId,
      commitSha: snapshot.commitSha,
      generatedAt: new Date().toISOString(),
      analyzerVersions: Object.fromEntries([...run.results.values()].map((r) => [r.analyzerId, r.version])),
    },
    repository: {
      id: snapshot.repositoryId,
      owner: snapshot.owner,
      name: snapshot.repo,
      url: `https://github.com/${snapshot.owner}/${snapshot.repo}`,
      defaultBranch: snapshot.defaultBranch,
      description: snapshot.description,
      languages: structure.languageStats,
      frameworks: [],
      statistics: {
        fileCount: files.length,
        totalLinesOfCode,
        moduleCount: modules.length,
        contributorCount: 0,
        firstCommitAt: null,
        lastCommitAt: null,
      },
    },
    files,
    modules,
    dependencies,
    entryPoints: entryPointResult?.entryPoints ?? [],
    dataFlows: [], // reserved — see docs/REPOSITORY_KNOWLEDGE_MODEL.md; Flow (src/types/flow.ts) is the richer, separate artifact built on top of entryPoints instead
    git: {
      commitFrequency: { period: "week", series: [] },
      recentChanges: [],
      hotspots: [],
      contributors: [],
    },
    codeHealth: {
      largeFiles: files.filter((f) => f.linesOfCode > 500).map((f) => ({ fileId: f.id, linesOfCode: f.linesOfCode })),
      todoFixme: [],
      deadCodeCandidates: [],
      duplicatedCodeCandidates: [],
      missingTests: [],
      deprecatedPatterns: [],
    },
    security: {
      vulnerableDependencies: [],
      patternMatches: (security?.patternMatches ?? []).map((f) => ({
        fileId: f.fileId,
        line: f.line,
        rule: f.rule,
        severity: f.severity,
      })),
    },
    tests: {
      testFiles: files.filter((f) => f.testStatus.isTestFile).map((f) => ({ fileId: f.id, framework: null, testedModuleIds: [] })),
      coverage: { available: false, overallPercentage: null, byModule: [] },
      missingTestCandidates: [],
    },
    documentation: {
      readme: { exists: structure.readme.exists, fileId: structure.readme.fileId, sections: [] },
      docsDirectory: { exists: modules.some((m) => m.name.toLowerCase() === "docs"), fileIds: [] },
      apiDocumentation: { exists: false, toolDetected: null, fileIds: [] },
      undocumentedImportantModules: modules
        .filter((m) => m.importance > 0.5)
        .map((m) => ({ moduleId: m.id, importance: m.importance })),
    },
    domainConcepts: [],
  };

  return RepositoryKnowledgeModelSchema.parse(model);
}
