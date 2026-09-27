# Repository Knowledge Model (RKM)

The RKM is the single canonical, structured representation of a repository
that every downstream consumer (the five lenses, Domain View, every MCP
tool) reads from. It is **layer 3** of the architecture described in
[`ARCHITECTURE.md`](./ARCHITECTURE.md). The schema itself is unchanged from
this project's original design — what changed is how it gets populated.

Two hard rules shape this schema:

1. **Provenance is explicit.** A field's `Provenance` is either
   `"deterministic"` (directly observed — a file's path, size) or
   `"ai-interpreted"` (an agent's judgment call — `confidence` and
   `generatedBy` always accompany it). Nothing pretends to be a fact when
   it's actually an interpretation.
2. **An agent never fabricates entities.** Every `submit_*` MCP tool call
   (`src/server/mcp-tools/submissionTools.ts`) validates every file/module
   reference against the real, ingested file tree BEFORE anything is
   merged into the model — an unresolvable reference rejects the whole
   call. This is enforced by code at write time (see
   `src/server/mcp-tools/submissionHelpers.ts`'s `requireFile`/
   `requireModule`), not just convention.

## 0. How this model actually gets built

Unlike the RKM's original design (a deterministic analyzer pipeline
computing every field in one pass), the model now starts almost empty and
grows incrementally:

1. **Ingestion** (`src/server/ingestion/seedKnowledgeModel.ts`) seeds
   `files[]` directly from the real file tree — path, size, a light
   structural type guess (source/test/config/documentation/asset by
   extension and directory convention), and line count. `repository.
   languages` (byte-weighted) and two free deterministic signals
   (`codeHealth.largeFiles`, `documentation.readme.exists`) are computed
   here too, since they need no judgment call. Everything else starts empty:
   `modules`, `dependencies`, `entryPoints`, `repository.frameworks`,
   `security`, the rest of `codeHealth`/`tests`/`documentation`, and `git`.
2. **A connected MCP agent** (any client — see
   [`docs/MCP_CLIENTS.md`](./MCP_CLIENTS.md)) explores the real code with
   its own tools, then calls `submit_modules`, `submit_dependencies`,
   `submit_entry_points`, `submit_frameworks`, `submit_security_findings`,
   `submit_code_health`, `submit_flow`, and `submit_request_journey` —
   each one merges into the model, validated first.
3. **`ModuleFact.dependencyIds`/`dependentIds`/`centrality`** are the one
   set of fields no tool accepts directly — they're recomputed
   automatically from `dependencies[]` every time `submit_modules` or
   `submit_dependencies` runs (`recomputeModuleGraph` in
   `submissionHelpers.ts`), so they can never drift out of sync with the
   edges that actually exist.
4. **`WorldModel`** (§15) is not stored at all — it's a pure function of
   whatever the current `RepositoryKnowledgeModel` is, recomputed on every
   read.

## 1. Top-level shape

```typescript
interface RepositoryKnowledgeModel {
  meta: ModelMeta;
  repository: RepositoryInfo;
  files: FileFact[];
  modules: ModuleFact[];
  dependencies: DependencyEdge[];
  entryPoints: EntryPoint[];
  dataFlows: DataFlow[];        // reserved, always empty — see §7
  git: GitIntelligence;
  codeHealth: CodeHealthReport;
  security: SecurityReport;
  tests: TestIntelligence;
  documentation: DocumentationReport;

  /** AI-derived. Empty until an agent calls contribute_domain_concept. Never merged into the fields above. */
  domainConcepts: DomainConcept[];
}

interface ModelMeta {
  schemaVersion: string;
  repositoryId: string;
  commitSha: string;
  generatedAt: string;
  analyzerVersions: Record<string, string>;  // empty now that there are no analyzers — kept for schema stability
}

/** Attached to any fact that isn't purely deterministic. */
type Provenance =
  | { source: "deterministic" }
  | { source: "ai-interpreted"; confidence: number; generatedBy: string; modelVersion: string };
```

`generatedBy` is a free-text agent/client name (e.g. `"claude-code"`,
`"cursor"`, `"codebiome-demo-agent"`) — never a hardcoded single agent, since
any MCP client can submit.

Onboarding journeys and feature plans are modeled as **separate top-level
types** (`OnboardingJourney` in `src/types/onboarding.ts`, `FeaturePlan` in
`src/types/featurePlan.ts`), not fields mixed into
`RepositoryKnowledgeModel` — see §14. This keeps "facts" and "agent
narrative" physically separate, not just tagged.

## 2. Repository

```typescript
interface RepositoryInfo {
  id: string;
  owner: string;
  name: string;
  url: string;
  defaultBranch: string;
  description: string | null;
  languages: LanguageStat[];        // computed at ingestion, byte-weighted by extension
  frameworks: FrameworkDetection[]; // empty until an agent calls submit_frameworks
  statistics: RepositoryStatistics;
}

interface LanguageStat {
  language: string;
  bytes: number;
  percentage: number;
}

interface FrameworkDetection {
  name: string;
  category: "frontend" | "backend" | "fullstack" | "mobile" | "infra" | "testing" | "other" | "database" | "cache" | "queue" | "search" | "external-api";
  evidence: string[];    // real file ids/paths the submitting agent cited — validated
  confidence: number;    // the agent's own confidence, 0..1
}

interface RepositoryStatistics {
  fileCount: number;         // set at ingestion
  totalLinesOfCode: number;  // set at ingestion
  moduleCount: number;       // kept in sync by submit_modules
  contributorCount: number;  // kept in sync by submit_code_health's git-contributor field
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
  id: string;               // = path, by convention
  path: string;
  type: FileType;            // guessed at ingestion from path/extension conventions — a thin, uncontroversial heuristic, not the deep analysis this project used to attempt
  language: string | null;   // by extension, at ingestion
  sizeBytes: number;
  linesOfCode: number;

  importance: number;        // always 0 — no tool currently sets a per-file importance; module-level importance (submit_modules) is what the lenses use

  complexity: ComplexityMetrics | null;  // always null — no tool currently accepts per-file complexity metrics

  testStatus: {
    isTestFile: boolean;      // guessed at ingestion from path convention
    coveredByTests: boolean;  // always false unless set via submit_code_health's testFiles
    testFileIds: string[];
  };

  documentationStatus: {
    hasFileLevelDoc: boolean;    // always false — not currently agent-submittable
    docCommentCoverage: number;  // always 0 — not currently agent-submittable
  };

  riskIndicators: RiskIndicator[];  // empty until an agent submits security findings/code health that reference this file
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
  evidence: string;
}
```

## 4. Modules

A module is whatever boundary a connected agent decided to submit via
`submit_modules` — typically a directory or logical grouping the agent
identified while exploring the code. Not derived by CodeBiome itself.

```typescript
interface ModuleFact {
  id: string;                // agent-supplied, defaults to `path` if omitted
  name: string;
  path: string;
  description: string | null;
  fileIds: string[];         // validated against the real file tree

  importance: number;        // the submitting agent's own judgment, 0..1
  centrality: number;        // RECOMPUTED automatically from dependencies[] — never agent-submitted directly
  complexity: ComplexityMetrics;  // linesOfCode summed from real constituent files; cyclomaticComplexity always 0 (not currently agent-submittable)
  risk: RiskIndicator[];     // optional, agent-submitted alongside the module

  dependencyIds: string[];   // RECOMPUTED from dependencies[]
  dependentIds: string[];    // RECOMPUTED from dependencies[]
}
```

## 5. Dependencies

```typescript
type DependencyRelationshipType =
  | "imports" | "calls" | "extends" | "http-request"
  | "navigates-to" | "reads-writes-db" | "package-dependency";

interface DependencyEdge {
  id: string;                // generated
  fromId: string;            // a real FileFact.id or ModuleFact.id — validated
  toId: string;              // a real FileFact.id/ModuleFact.id, or any string for toKind "external-package" (not validated — package names aren't in the file tree)
  fromKind: "file" | "module";
  toKind: "file" | "module" | "external-package";
  relationship: DependencyRelationshipType;
  direction: "uses" | "used-by";  // always "uses" — the submitting agent's own perspective, canonicalized
  confidence: number;              // the submitting agent's own confidence, 0..1
}
```

## 6. Entry points

```typescript
type EntryPointType =
  | "http-route" | "cli-command" | "app-startup" | "worker" | "script" | "scheduled-job" | "frontend-page";

interface EntryPoint {
  id: string;
  type: EntryPointType;
  name: string;
  fileId: string;              // validated
  detectionEvidence: string;   // the submitting agent's own justification
}
```

## 7. Data flows

```typescript
interface DataFlow {
  id: string;
  label: string;
  steps: DataFlowStep[];
  entryPointId: string | null;
  confidence: number;
}

interface DataFlowStep {
  order: number;
  entityId: string;
  entityKind: "file" | "module";
  role: "route" | "controller" | "service" | "repository" | "database" | "external-api" | "component" | "other";
}
```

Reserved for a possible future lower-level deterministic trace concept —
always empty today. What actually carries request-flow information is the
separate `Flow`/`Journey` types (§14), submitted via `submit_flow`/
`submit_request_journey`.

## 8. Git intelligence

```typescript
interface GitIntelligence {
  commitFrequency: { period: "day" | "week" | "month"; series: { date: string; commitCount: number }[] };
  recentChanges: { fileId: string; lastModifiedAt: string; lastCommitSha: string }[];
  hotspots: { fileId: string; changeCount: number; coChangedWith: string[] }[];
  contributors: { name: string; email: string; commitCount: number; firstCommitAt: string; lastCommitAt: string }[];
}
```

Populated only if a connected agent has access to git history and reports
it via `submit_code_health`'s `gitHotspots`/`gitContributors` fields —
CodeBiome itself has no git history access (ingestion is a tarball
download, not a clone). This is what used to be a permanently empty stub
under the old analyzer pipeline; an agent can genuinely fill it now.

## 9. Code health

```typescript
interface CodeHealthReport {
  largeFiles: { fileId: string; linesOfCode: number }[];  // computed at ingestion (>300 LOC), free
  todoFixme: { fileId: string; line: number; text: string; kind: "TODO" | "FIXME" }[];
  deadCodeCandidates: { fileId: string; exportName: string; reason: string }[];
  duplicatedCodeCandidates: { fileIds: string[]; similarity: number; lineRanges: { fileId: string; start: number; end: number }[] }[];
  missingTests: { moduleId: string; reason: string }[];
  deprecatedPatterns: { fileId: string; pattern: string; evidence: string }[];
}
```

Everything but `largeFiles` was a permanently empty stub under the old
analyzer pipeline (it was never actually computed). All of it is now
genuinely fillable via `submit_code_health`, since it only requires an
agent's judgment, not a bespoke analyzer.

## 10. Security indicators

```typescript
interface SecurityReport {
  vulnerableDependencies: { packageName: string; installedVersion: string; advisoryId: string; severity: "low" | "moderate" | "high" | "critical"; source: "osv" | "npm-audit" | "github-advisory" }[];
  patternMatches: { fileId: string; line: number; rule: string; severity: "low" | "moderate" | "high" | "critical" }[];
}
```

Populated via `submit_security_findings` — `patternMatches`' `fileId` is
validated; `vulnerableDependencies` entries are not (package names aren't
part of the file tree).

## 11. Tests

```typescript
interface TestIntelligence {
  testFiles: { fileId: string; framework: string | null; testedModuleIds: string[] }[];
  coverage: { available: boolean; overallPercentage: number | null; byModule: { moduleId: string; percentage: number }[] };
  missingTestCandidates: { moduleId: string; importance: number; reason: string }[];
}
```

`coverage` should only be set (via `submit_code_health`) if the submitting
agent found a real coverage report — never estimated.

## 12. Documentation

```typescript
interface DocumentationReport {
  readme: { exists: boolean; fileId: string | null; sections: string[] };  // exists/fileId set at ingestion; sections not currently agent-submittable
  docsDirectory: { exists: boolean; fileIds: string[] };
  apiDocumentation: { exists: boolean; toolDetected: string | null; fileIds: string[] };
  undocumentedImportantModules: { moduleId: string; importance: number }[];
}
```

## 13. Domain concepts (AI-derived)

The one place in the "facts" model where agent interpretation lives inline,
kept structurally isolated and explicitly tagged.

```typescript
interface DomainConcept {
  id: string;
  name: string;
  description: string;
  relatedModuleIds: string[];  // validated
  relatedFileIds: string[];    // validated
  provenance: Extract<Provenance, { source: "ai-interpreted" }>;
}
```

Submitted via `contribute_domain_concept` — this tool, along with
`create_onboarding_journey` and `propose_feature_plan`, was the original
template every `submit_*` tool's "validate every reference before storing"
pattern generalizes from.

## 14. Onboarding journeys and feature plans (kept as separate top-level types)

Unlike the speculative `InterpretedLayer` sketch from this project's
original design (explanations/journey/missions, never actually built), the
real implementation is two independently-typed, independently-stored
artifacts:

```typescript
// src/types/onboarding.ts — submitted via create_onboarding_journey
interface OnboardingJourney {
  id: string;
  title: string;
  goal: string;
  steps: { order: number; moduleId: string; moduleName: string; reason: string }[];  // moduleId validated
  provenance: { source: "ai-interpreted"; confidence: number; generatedBy: string; modelVersion: string };
  createdAt: string;
}

// src/types/featurePlan.ts — submitted via propose_feature_plan
interface FeaturePlan {
  id: string;
  description: string;   // the developer's own request, echoed back
  name: string;
  summary: string;
  confidence: "high" | "medium" | "low";
  steps: { id: string; kind: FeaturePlanStepKind; label: string; status: "new" | "existing"; filePath: string; explanation: string }[];
  impactedEntities: { kind: "domain" | "infra"; id: string; name: string; reason: string }[];
  newFiles: { suggestedPath: string; purpose: string }[];
  modifiedFiles: { filePath: string; reason: string }[];  // validated — an unresolvable reference is dropped, not the whole call rejected
  evidence: string[];    // discloses anything downgraded/dropped during validation
  generatedAt: string;
}
```

`propose_feature_plan` is the one write-back tool that downgrades/drops
individual unresolvable references (disclosed in `evidence`) rather than
rejecting the whole call — a deliberate exception, since a feature plan is
inherently speculative (some of it describes files that don't exist yet).
Every other `submit_*`/write-back tool rejects the entire call on the first
bad reference.

## 15. World entities (layer 4 — pure mapping from the RKM)

The World is a rendering of the RKM; this mapping is a **deterministic
function** (`src/server/world/builder.ts`), recomputed on every read — not a
further agent step.

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

interface VisualState {
  healthTier: "thriving" | "healthy" | "stressed" | "critical";
  environmentTags: ("fog" | "toxic" | "dramatic-lighting" | "sunlight" | "footprints" | "warning-indicators")[];
  scale: number;
}
```

### Deterministic mapping table (RKM fact → world entity)

| RKM fact | World entity | `type` |
|---|---|---|
| `RepositoryInfo` | The world itself | `biome` |
| `ModuleFact` | Region | `region` |
| `ModuleFact` (mostly test files, or path matches a tests convention) | Landmark | `training-ground` |
| `ModuleFact` (mostly documentation files, or path matches a docs convention) | Landmark | `library` |
| `ModuleFact` (path matches a db/model convention) | Landmark | `cave` |
| `ModuleFact` with a `dead-code-candidate`/`deprecated-pattern` risk indicator | Landmark | `ruins` |
| `ModuleFact` (importance ≥ 0.6) | Landmark | `landmark` |
| A conventional entry filename (`index`/`main`/`server`/`app`) | Landmark | `gate` |
| `DependencyEdge` (file-to-file, aggregated to module level) | Path between regions | `path` |

`VisualState.healthTier`/`environmentTags`/`scale` are computed by a pure
function of `importance` and whether the module has any `risk` entries —
never by asking an agent "does this look healthy."

## 16. Schema evolution

`meta.schemaVersion` follows semver. Additive fields bump minor; anything
that changes the meaning of an existing field bumps major.
