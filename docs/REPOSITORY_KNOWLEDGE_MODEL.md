# Repository Knowledge Model (RKM)

The RKM is the single canonical, structured representation of a repository
that every downstream consumer (World Generator, Guided Journey, Missions,
Bob chat, investigation panels) reads from. It is **layer 3** of the
architecture described in [`ARCHITECTURE.md`](./ARCHITECTURE.md).

Two hard rules shape this schema:

1. **Provenance is explicit.** Every fact that isn't 100% deterministic
   carries a `source` and, where relevant, a `confidence`. Nothing pretends
   to be a fact when it's actually an interpretation.
2. **AI never fabricates entities.** Bob's output (the `InterpretedLayer`) can
   only *annotate* or *reference* IDs that already exist in the deterministic
   part of the model. It cannot introduce a file, module, or dependency edge
   that the analyzers didn't find. This is enforced by Zod validation at
   write time, not just convention.

## 1. Top-level shape

```typescript
interface RepositoryKnowledgeModel {
  meta: ModelMeta;
  repository: RepositoryInfo;
  files: FileFact[];
  modules: ModuleFact[];
  dependencies: DependencyEdge[];
  entryPoints: EntryPoint[];
  dataFlows: DataFlow[];
  git: GitIntelligence;
  codeHealth: CodeHealthReport;
  security: SecurityReport;
  tests: TestIntelligence;
  documentation: DocumentationReport;

  /** AI-derived. Absent until Bob has run. Never merged into the fields above. */
  domainConcepts: DomainConcept[];
}

interface ModelMeta {
  schemaVersion: string;           // semver of this schema
  repositoryId: string;
  commitSha: string;
  generatedAt: string;             // ISO timestamp
  analyzerVersions: Record<string, string>; // analyzerId -> version, for cache invalidation/debugging
}

/** Attached to any fact that isn't purely deterministic. */
type Provenance =
  | { source: "deterministic" }
  | { source: "ai-interpreted"; confidence: number; generatedBy: "bob"; modelVersion: string };
```

The `InterpretedLayer` (Bob's narrative output: explanations, journey,
missions) is modeled as a **separate top-level artifact**, not a field mixed
into `RepositoryKnowledgeModel` — see §9. This keeps "facts" and
"interpretation" physically separate, not just tagged.

## 2. Repository

```typescript
interface RepositoryInfo {
  id: string;
  owner: string;
  name: string;
  url: string;
  defaultBranch: string;
  description: string | null;
  languages: LanguageStat[];       // from linguist-style byte-count analysis
  frameworks: FrameworkDetection[]; // e.g. Next.js, Express, Django — evidence-based
  statistics: RepositoryStatistics;
}

interface LanguageStat {
  language: string;
  bytes: number;
  percentage: number;
}

interface FrameworkDetection {
  name: string;
  category: "frontend" | "backend" | "fullstack" | "mobile" | "infra" | "testing" | "other";
  evidence: string[];              // e.g. ["package.json:dependencies.next", "next.config.js present"]
  confidence: number;               // 0..1, deterministic scoring (not AI)
}

interface RepositoryStatistics {
  fileCount: number;
  totalLinesOfCode: number;
  moduleCount: number;
  contributorCount: number;
  firstCommitAt: string | null;
  lastCommitAt: string | null;
}
```

## 3. Files

```typescript
type FileType =
  | "source" | "test" | "config" | "documentation"
  | "asset" | "generated" | "build-output" | "other";

interface FileFact {
  id: string;                      // stable id, e.g. hash of path
  path: string;                    // repo-relative
  type: FileType;
  language: string | null;
  sizeBytes: number;
  linesOfCode: number;

  /** 0..1, deterministic score from centrality + change frequency + fan-in. */
  importance: number;

  complexity: ComplexityMetrics | null; // null when not applicable (e.g. assets)

  testStatus: {
    isTestFile: boolean;
    coveredByTests: boolean;        // referenced by at least one test file
    testFileIds: string[];
  };

  documentationStatus: {
    hasFileLevelDoc: boolean;       // header comment/docstring present
    docCommentCoverage: number;     // 0..1, exported symbols with doc comments
  };

  riskIndicators: RiskIndicator[];
}

interface ComplexityMetrics {
  cyclomaticComplexity: number;
  linesOfCode: number;
  maintainabilityIndex: number | null;
}

interface RiskIndicator {
  kind:
    | "large-file" | "high-complexity" | "todo-fixme" | "no-tests"
    | "duplicated-code" | "dead-code-candidate" | "deprecated-pattern"
    | "vulnerable-dependency" | "hardcoded-secret-pattern";
  severity: "low" | "medium" | "high";
  detail: string;
  evidence: string;                // e.g. matched line, rule id, advisory id
}
```

## 4. Modules

A "module" is a directory or logical grouping (deterministically derived from
directory structure + import clustering — not an AI guess about "domains";
see §11 for the AI-named version).

```typescript
interface ModuleFact {
  id: string;
  name: string;                    // derived from path, e.g. "src/server/auth"
  path: string;
  description: string | null;      // deterministic only: e.g. pulled from an existing README/index doc comment, never AI-authored here
  fileIds: string[];

  importance: number;              // 0..1
  centrality: number;              // graph centrality within the dependency graph
  complexity: ComplexityMetrics;   // aggregated from member files
  risk: RiskIndicator[];

  dependencyIds: string[];          // DependencyEdge ids where this module is source
  dependentIds: string[];           // DependencyEdge ids where this module is target
}
```

## 5. Dependencies

```typescript
type DependencyRelationshipType =
  | "imports"            // static import/require
  | "calls"              // function/API call detected via static analysis
  | "extends"            // inheritance
  | "http-request"       // detected fetch/axios/http call to another module's route
  | "reads-writes-db"    // detected ORM/query usage
  | "package-dependency"; // external package manifest dependency

interface DependencyEdge {
  id: string;
  fromId: string;                   // FileFact.id or ModuleFact.id
  toId: string;                     // FileFact.id, ModuleFact.id, or ExternalPackage id
  fromKind: "file" | "module";
  toKind: "file" | "module" | "external-package";
  relationship: DependencyRelationshipType;
  direction: "uses" | "used-by";     // redundant with from/to but explicit for graph rendering
  confidence: number;                // 1.0 for static imports, lower for heuristic call-detection
}
```

## 6. Entry points

```typescript
type EntryPointType =
  | "http-route" | "cli-command" | "app-startup" | "worker" | "script" | "scheduled-job";

interface EntryPoint {
  id: string;
  type: EntryPointType;
  name: string;                     // e.g. "POST /api/users", "bin/migrate"
  fileId: string;
  detectionEvidence: string;        // e.g. "Next.js app/api/users/route.ts export POST"
}
```

## 7. Data flows

```typescript
interface DataFlow {
  id: string;
  label: string;                    // e.g. "Create user"
  /** Ordered chain of entities the request/data passes through. */
  steps: DataFlowStep[];
  entryPointId: string | null;      // originating entry point, if applicable
  confidence: number;                // static tracing is heuristic beyond 1-2 hops
}

interface DataFlowStep {
  order: number;
  entityId: string;                 // FileFact.id or ModuleFact.id
  entityKind: "file" | "module";
  role: "route" | "controller" | "service" | "repository" | "database" | "external-api" | "component" | "other";
}
```

## 8. Git intelligence

```typescript
interface GitIntelligence {
  commitFrequency: {
    period: "day" | "week" | "month";
    series: { date: string; commitCount: number }[];
  };
  recentChanges: {
    fileId: string;
    lastModifiedAt: string;
    lastCommitSha: string;
  }[];
  hotspots: {
    fileId: string;
    changeCount: number;             // commits touching this file, given window
    coChangedWith: string[];         // fileIds frequently changed together (evidence for coupling)
  }[];
  contributors: {
    name: string;
    email: string;
    commitCount: number;
    firstCommitAt: string;
    lastCommitAt: string;
  }[];
}
```

## 9. Code health

```typescript
interface CodeHealthReport {
  largeFiles: { fileId: string; linesOfCode: number }[];
  todoFixme: { fileId: string; line: number; text: string; kind: "TODO" | "FIXME" }[];
  deadCodeCandidates: { fileId: string; exportName: string; reason: string }[]; // e.g. "no incoming references found"
  duplicatedCodeCandidates: {
    fileIds: string[];
    similarity: number;              // 0..1, from a similarity-hash algorithm
    lineRanges: { fileId: string; start: number; end: number }[];
  }[];
  missingTests: { moduleId: string; reason: string }[];
  deprecatedPatterns: { fileId: string; pattern: string; evidence: string }[];
}
```

## 10. Security indicators

Evidence-based only — **Bob cannot add to this list**; it may only narrate
entries already here.

```typescript
interface SecurityReport {
  vulnerableDependencies: {
    packageName: string;
    installedVersion: string;
    advisoryId: string;              // e.g. GHSA/OSV id
    severity: "low" | "moderate" | "high" | "critical";
    source: "osv" | "npm-audit" | "github-advisory";
  }[];
  patternMatches: {
    fileId: string;
    line: number;
    rule: string;                    // e.g. "hardcoded-aws-key", "eval-usage"
    severity: "low" | "moderate" | "high" | "critical";
  }[];
}
```

## 11. Tests

```typescript
interface TestIntelligence {
  testFiles: { fileId: string; framework: string | null; testedModuleIds: string[] }[];
  coverage: {
    available: boolean;               // true only if a coverage report was found/parseable
    overallPercentage: number | null;
    byModule: { moduleId: string; percentage: number }[];
  };
  missingTestCandidates: { moduleId: string; importance: number; reason: string }[];
}
```

## 12. Documentation

```typescript
interface DocumentationReport {
  readme: { exists: boolean; fileId: string | null; sections: string[] };
  docsDirectory: { exists: boolean; fileIds: string[] };
  apiDocumentation: { exists: boolean; toolDetected: string | null; fileIds: string[] }; // e.g. OpenAPI spec, TypeDoc
  undocumentedImportantModules: { moduleId: string; importance: number }[];
}
```

## 13. Domain concepts (AI-derived)

This is the one place in the "facts" model where AI output lives, and it is
kept structurally isolated and explicitly tagged so nothing downstream can
mistake it for a deterministic fact.

```typescript
interface DomainConcept {
  id: string;
  name: string;                      // e.g. "Billing", "Authentication"
  description: string;
  relatedModuleIds: string[];         // must reference real ModuleFact ids — validated
  relatedFileIds: string[];           // must reference real FileFact ids — validated
  provenance: Extract<Provenance, { source: "ai-interpreted" }>;
}
```

Validation rule (enforced in `knowledge-model/validation.ts`): any
`relatedModuleIds`/`relatedFileIds` not found in `modules`/`files` is rejected
before persistence — Bob cannot reference an entity that doesn't exist.

## 14. The Interpreted Layer (Bob's output, kept separate)

```typescript
interface InterpretedLayer {
  meta: {
    repositoryKnowledgeModelId: string;
    generatedAt: string;
    bobModelVersion: string;
  };
  explanations: EntityExplanation[];
  journey: OnboardingJourney;
  missions: Mission[];
}

interface EntityExplanation {
  entityId: string;                  // must reference a real RKM entity
  entityKind: "file" | "module" | "dataFlow" | "dependency";
  summary: string;
  detail: string;
  citedFactIds: string[];             // RKM entity/fact ids this explanation is grounded in
}

interface OnboardingJourney {
  id: string;
  title: string;
  steps: JourneyStep[];
}

interface JourneyStep {
  order: number;
  title: string;
  narrative: string;
  focusEntityIds: string[];           // must reference real RKM entities — drives world camera
  goal: string;
}

interface Mission {
  id: string;
  title: string;
  description: string;
  difficulty: "intro" | "easy" | "medium" | "advanced";
  relatedEntityIds: string[];
  objective: MissionObjective;
}

/** Objectives are deterministically checkable — completion is verified
 *  against RKM facts, not by asking the AI whether it thinks you're done. */
type MissionObjective =
  | { type: "visit-entity"; entityId: string }
  | { type: "trace-data-flow"; dataFlowId: string }
  | { type: "identify-dependency"; fromId: string; toId: string }
  | { type: "find-risk-indicator"; fileId: string; kind: RiskIndicator["kind"] };
```

Every ID field in `InterpretedLayer` is Zod-validated against the
`RepositoryKnowledgeModel` it was generated from at write time.

## 15. World entities (layer 4 — pure mapping from RKM + InterpretedLayer)

The world is a rendering of the RKM; this mapping is a **deterministic
function**, not a further AI step.

```typescript
type WorldEntityType =
  | "biome" | "region" | "landmark" | "object" | "path" | "portal" | "cave" | "factory"
  | "library" | "training-ground" | "ruins" | "gate";

interface WorldModel {
  meta: { repositoryKnowledgeModelId: string; generatedAt: string };
  biome: WorldBiome;
  regions: WorldRegion[];
  landmarks: WorldLandmark[];
  paths: WorldPath[];
}

interface WorldEntity {
  id: string;
  type: WorldEntityType;
  sourceEntityId: string;            // traceability back to the RKM fact this represents
  sourceEntityKind: "repository" | "module" | "file" | "dependency" | "entryPoint" | "test" | "documentation" | "codeHealth" | "security";
  visualState: VisualState;          // derived deterministically from health/risk fields
}

interface VisualState {
  healthTier: "thriving" | "healthy" | "stressed" | "critical";
  environmentTags: ("fog" | "toxic" | "dramatic-lighting" | "sunlight" | "footprints" | "warning-indicators")[];
  scale: number;                     // derived from importance/centrality
}

interface WorldBiome extends WorldEntity { type: "biome"; name: string; }       // repository as a whole
interface WorldRegion extends WorldEntity { type: "region"; name: string; }    // directory/domain
interface WorldLandmark extends WorldEntity { }                                 // module/entry point/db/API/tests/docs
interface WorldPath extends WorldEntity { type: "path"; fromLandmarkId: string; toLandmarkId: string; } // dependency/data flow
```

### Deterministic mapping table (repository fact → world entity)

| RKM fact | World entity | `type` |
|---|---|---|
| `RepositoryInfo` | The world itself | `biome` |
| `ModuleFact` (top-level directory/domain) | Region | `region` |
| `ModuleFact` (high importance/centrality) | Landmark | `landmark` |
| `FileFact` | Tree/object | `object` |
| `DependencyEdge` | Path between landmarks | `path` |
| `EntryPoint` (http-route, app-startup) | Gate | `gate` |
| Data-flow step with `role: "database"` | Cave | `cave` |
| Data-flow step with `role: "external-api"` | Portal | `portal` |
| Entry point `type: "scheduled-job"`/CI config files | Factory | `factory` |
| `DocumentationReport` items | Library | `library` |
| `TestIntelligence` test files/modules | Training ground | `training-ground` |
| `CodeHealthReport` risk clusters (dead code, duplication) | Ruins | `ruins` |
| `GitIntelligence.recentChanges` | Footprints/traveled paths (environment tag) | tag on region/path |
| `CodeHealthReport`/low health tier | Dead trees, fog (environment tags) | tag on region/object |
| `SecurityReport` entries | Toxic/hazard tags | tag on object/landmark |
| High `centrality` module | Enormous central tree | `landmark` (scale-boosted) |

`VisualState.healthTier` and `environmentTags` are computed by a pure
function of `riskIndicators`, `complexity`, `security`, and `git` fields —
never by asking Bob "does this look healthy."

## 16. Schema evolution

`meta.schemaVersion` (RKM) and equivalent on `InterpretedLayer`/`WorldModel`
follow semver. Additive fields bump minor; anything that changes meaning of
an existing field bumps major and requires a re-analysis migration path
(cached models below the current major are treated as stale).
