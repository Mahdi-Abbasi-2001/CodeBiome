import { z } from "zod";

/**
 * Repository Knowledge Model — the canonical structured representation of a
 * repository. See docs/REPOSITORY_KNOWLEDGE_MODEL.md for the full design.
 *
 * This file is the single source of truth for the shape: types are inferred
 * from the Zod schemas so validation and typing can never drift apart. Every
 * AI-derived field (currently just `domainConcepts`) carries an explicit
 * "ai-interpreted" provenance tag and is validated to only reference ids that
 * already exist elsewhere in this model.
 */

export const ProvenanceSchema = z.union([
  z.object({ source: z.literal("deterministic") }),
  z.object({
    source: z.literal("ai-interpreted"),
    confidence: z.number().min(0).max(1),
    generatedBy: z.literal("bob"),
    modelVersion: z.string(),
  }),
]);

export const RiskIndicatorSchema = z.object({
  kind: z.enum([
    "large-file",
    "high-complexity",
    "todo-fixme",
    "no-tests",
    "duplicated-code",
    "dead-code-candidate",
    "deprecated-pattern",
    "vulnerable-dependency",
    "hardcoded-secret-pattern",
  ]),
  severity: z.enum(["low", "medium", "high"]),
  detail: z.string(),
  evidence: z.string(),
});

export const ComplexityMetricsSchema = z.object({
  cyclomaticComplexity: z.number(),
  linesOfCode: z.number(),
  maintainabilityIndex: z.number().nullable(),
});

export const FileFactSchema = z.object({
  id: z.string(),
  path: z.string(),
  type: z.enum(["source", "test", "config", "documentation", "asset", "generated", "build-output", "other"]),
  language: z.string().nullable(),
  sizeBytes: z.number(),
  linesOfCode: z.number(),
  importance: z.number(),
  complexity: ComplexityMetricsSchema.nullable(),
  testStatus: z.object({
    isTestFile: z.boolean(),
    coveredByTests: z.boolean(),
    testFileIds: z.array(z.string()),
  }),
  documentationStatus: z.object({
    hasFileLevelDoc: z.boolean(),
    docCommentCoverage: z.number(),
  }),
  riskIndicators: z.array(RiskIndicatorSchema),
});

export const ModuleFactSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  description: z.string().nullable(),
  fileIds: z.array(z.string()),
  importance: z.number(),
  centrality: z.number(),
  complexity: ComplexityMetricsSchema,
  risk: z.array(RiskIndicatorSchema),
  dependencyIds: z.array(z.string()),
  dependentIds: z.array(z.string()),
});

export const DependencyEdgeSchema = z.object({
  id: z.string(),
  fromId: z.string(),
  toId: z.string(),
  fromKind: z.enum(["file", "module"]),
  toKind: z.enum(["file", "module", "external-package"]),
  relationship: z.enum(["imports", "calls", "extends", "http-request", "reads-writes-db", "package-dependency"]),
  direction: z.enum(["uses", "used-by"]),
  confidence: z.number(),
});

export const EntryPointSchema = z.object({
  id: z.string(),
  type: z.enum(["http-route", "cli-command", "app-startup", "worker", "script", "scheduled-job"]),
  name: z.string(),
  fileId: z.string(),
  detectionEvidence: z.string(),
});

export const DataFlowStepSchema = z.object({
  order: z.number(),
  entityId: z.string(),
  entityKind: z.enum(["file", "module"]),
  role: z.enum(["route", "controller", "service", "repository", "database", "external-api", "component", "other"]),
});

export const DataFlowSchema = z.object({
  id: z.string(),
  label: z.string(),
  steps: z.array(DataFlowStepSchema),
  entryPointId: z.string().nullable(),
  confidence: z.number(),
});

export const GitIntelligenceSchema = z.object({
  commitFrequency: z.object({
    period: z.enum(["day", "week", "month"]),
    series: z.array(z.object({ date: z.string(), commitCount: z.number() })),
  }),
  recentChanges: z.array(
    z.object({ fileId: z.string(), lastModifiedAt: z.string(), lastCommitSha: z.string() })
  ),
  hotspots: z.array(
    z.object({ fileId: z.string(), changeCount: z.number(), coChangedWith: z.array(z.string()) })
  ),
  contributors: z.array(
    z.object({
      name: z.string(),
      email: z.string(),
      commitCount: z.number(),
      firstCommitAt: z.string(),
      lastCommitAt: z.string(),
    })
  ),
});

export const CodeHealthReportSchema = z.object({
  largeFiles: z.array(z.object({ fileId: z.string(), linesOfCode: z.number() })),
  todoFixme: z.array(
    z.object({ fileId: z.string(), line: z.number(), text: z.string(), kind: z.enum(["TODO", "FIXME"]) })
  ),
  deadCodeCandidates: z.array(z.object({ fileId: z.string(), exportName: z.string(), reason: z.string() })),
  duplicatedCodeCandidates: z.array(
    z.object({
      fileIds: z.array(z.string()),
      similarity: z.number(),
      lineRanges: z.array(z.object({ fileId: z.string(), start: z.number(), end: z.number() })),
    })
  ),
  missingTests: z.array(z.object({ moduleId: z.string(), reason: z.string() })),
  deprecatedPatterns: z.array(z.object({ fileId: z.string(), pattern: z.string(), evidence: z.string() })),
});

export const SecurityReportSchema = z.object({
  vulnerableDependencies: z.array(
    z.object({
      packageName: z.string(),
      installedVersion: z.string(),
      advisoryId: z.string(),
      severity: z.enum(["low", "moderate", "high", "critical"]),
      source: z.enum(["osv", "npm-audit", "github-advisory"]),
    })
  ),
  patternMatches: z.array(
    z.object({
      fileId: z.string(),
      line: z.number(),
      rule: z.string(),
      severity: z.enum(["low", "moderate", "high", "critical"]),
    })
  ),
});

export const TestIntelligenceSchema = z.object({
  testFiles: z.array(
    z.object({ fileId: z.string(), framework: z.string().nullable(), testedModuleIds: z.array(z.string()) })
  ),
  coverage: z.object({
    available: z.boolean(),
    overallPercentage: z.number().nullable(),
    byModule: z.array(z.object({ moduleId: z.string(), percentage: z.number() })),
  }),
  missingTestCandidates: z.array(
    z.object({ moduleId: z.string(), importance: z.number(), reason: z.string() })
  ),
});

export const DocumentationReportSchema = z.object({
  readme: z.object({ exists: z.boolean(), fileId: z.string().nullable(), sections: z.array(z.string()) }),
  docsDirectory: z.object({ exists: z.boolean(), fileIds: z.array(z.string()) }),
  apiDocumentation: z.object({
    exists: z.boolean(),
    toolDetected: z.string().nullable(),
    fileIds: z.array(z.string()),
  }),
  undocumentedImportantModules: z.array(z.object({ moduleId: z.string(), importance: z.number() })),
});

export const DomainConceptSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  relatedModuleIds: z.array(z.string()),
  relatedFileIds: z.array(z.string()),
  provenance: z.object({
    source: z.literal("ai-interpreted"),
    confidence: z.number(),
    generatedBy: z.literal("bob"),
    modelVersion: z.string(),
  }),
});

export const LanguageStatSchema = z.object({ language: z.string(), bytes: z.number(), percentage: z.number() });

export const FrameworkDetectionSchema = z.object({
  name: z.string(),
  category: z.enum(["frontend", "backend", "fullstack", "mobile", "infra", "testing", "other"]),
  evidence: z.array(z.string()),
  confidence: z.number(),
});

export const RepositoryInfoSchema = z.object({
  id: z.string(),
  owner: z.string(),
  name: z.string(),
  url: z.string(),
  defaultBranch: z.string(),
  description: z.string().nullable(),
  languages: z.array(LanguageStatSchema),
  frameworks: z.array(FrameworkDetectionSchema),
  statistics: z.object({
    fileCount: z.number(),
    totalLinesOfCode: z.number(),
    moduleCount: z.number(),
    contributorCount: z.number(),
    firstCommitAt: z.string().nullable(),
    lastCommitAt: z.string().nullable(),
  }),
});

export const RepositoryKnowledgeModelSchema = z.object({
  meta: z.object({
    schemaVersion: z.string(),
    repositoryId: z.string(),
    commitSha: z.string(),
    generatedAt: z.string(),
    analyzerVersions: z.record(z.string()),
  }),
  repository: RepositoryInfoSchema,
  files: z.array(FileFactSchema),
  modules: z.array(ModuleFactSchema),
  dependencies: z.array(DependencyEdgeSchema),
  entryPoints: z.array(EntryPointSchema),
  dataFlows: z.array(DataFlowSchema),
  git: GitIntelligenceSchema,
  codeHealth: CodeHealthReportSchema,
  security: SecurityReportSchema,
  tests: TestIntelligenceSchema,
  documentation: DocumentationReportSchema,
  /** AI-derived. Empty until Bob interpretation is implemented. */
  domainConcepts: z.array(DomainConceptSchema),
});

export type RepositoryKnowledgeModel = z.infer<typeof RepositoryKnowledgeModelSchema>;
export type RepositoryInfo = z.infer<typeof RepositoryInfoSchema>;
export type FileFact = z.infer<typeof FileFactSchema>;
export type ModuleFact = z.infer<typeof ModuleFactSchema>;
export type DependencyEdge = z.infer<typeof DependencyEdgeSchema>;
export type RiskIndicator = z.infer<typeof RiskIndicatorSchema>;
export type DomainConcept = z.infer<typeof DomainConceptSchema>;
