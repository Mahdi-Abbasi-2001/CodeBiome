# Analyzer Architecture

Defines how deterministic repository facts (layer 1) are produced, so new
analyzers can be added independently without touching the pipeline runner,
the Knowledge Model builder, or each other. This is the concrete design
behind §6 of [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## 1. Design goals

- **Independent & pluggable** — adding an analyzer means writing one module
  and registering it; nothing else changes.
- **Declared dependencies, not hidden coupling** — an analyzer that needs
  another analyzer's output declares it explicitly; the pipeline runner
  topologically sorts and injects results. No analyzer reaches into another's
  internals or re-parses the repository redundantly.
- **Pure and testable** — an analyzer is a function from
  `(RepositorySnapshot, prior results)` to a validated result. No hidden
  network calls, no ambient state. Fixture-based unit tests are trivial.
- **Fails independently** — one analyzer throwing doesn't take down the
  pipeline; it's recorded as a diagnostic and downstream analyzers that don't
  depend on it still run.
- **Versioned outputs** — every result carries the analyzer's version, so the
  Knowledge Model's `meta.analyzerVersions` can drive cache invalidation.

## 2. Core interfaces

```typescript
/** Raw input every analyzer works from. Built once by the ingestion module. */
interface RepositorySnapshot {
  repositoryId: string;
  commitSha: string;
  defaultBranch: string;
  fetchedAt: string;

  files: SnapshotFile[];             // full file listing + content refs
  manifests: ParsedManifest[];       // package.json, requirements.txt, go.mod, etc., pre-parsed
  gitLog: RawGitLogEntry[] | null;   // null if only a tarball (no history) was fetched
}

interface SnapshotFile {
  path: string;
  sizeBytes: number;
  /** Content is not inlined here for large repos — fetched on demand via this accessor. */
  readContent: () => Promise<string>;
  isBinary: boolean;
}

interface ParsedManifest {
  kind: "package.json" | "requirements.txt" | "go.mod" | "Cargo.toml" | "pom.xml" | "other";
  path: string;
  dependencies: { name: string; versionRange: string }[];
}

interface RawGitLogEntry {
  sha: string;
  authorName: string;
  authorEmail: string;
  committedAt: string;
  filesChanged: string[];
}

/** What every analyzer returns. */
interface AnalyzerResult<T> {
  analyzerId: string;
  version: string;                   // semver of this analyzer's output shape/logic
  producedAt: string;
  data: T;
  diagnostics: AnalyzerDiagnostic[]; // non-fatal issues encountered
}

interface AnalyzerDiagnostic {
  level: "info" | "warning" | "error";
  message: string;
  filePath?: string;
}

/** Passed to every analyzer at run time. */
interface AnalyzerContext {
  snapshot: RepositorySnapshot;
  config: AnalyzerConfig;
  logger: AnalyzerLogger;
  /** Read-only access to results of analyzers listed in this analyzer's `dependsOn`. */
  getDependencyResult: <T>(analyzerId: string) => AnalyzerResult<T> | undefined;
}

interface AnalyzerConfig {
  /** Per-analyzer tunables, e.g. complexity thresholds, large-file line count. */
  [analyzerId: string]: Record<string, unknown> | undefined;
}

interface AnalyzerLogger {
  info(message: string): void;
  warn(message: string): void;
}

/** The pluggable unit itself. */
interface Analyzer<T = unknown> {
  id: string;                        // stable, unique, e.g. "dependency-analyzer"
  displayName: string;
  version: string;
  /** Other analyzer ids that must run first; their results are available via context. */
  dependsOn?: string[];
  /** Cheap check — e.g. skip GitHistoryAnalyzer if snapshot.gitLog is null. */
  supports(snapshot: RepositorySnapshot): boolean;
  run(context: AnalyzerContext): Promise<AnalyzerResult<T>>;
}
```

## 3. Registry and pipeline runner

```typescript
interface AnalyzerRegistry {
  register(analyzer: Analyzer): void;
  getAll(): Analyzer[];
  /** Topologically sorts by `dependsOn`; throws on cycles or missing deps. */
  getExecutionOrder(): Analyzer[];
}

interface AnalyzerRunSummary {
  results: Map<string, AnalyzerResult<unknown>>;
  failures: { analyzerId: string; error: string }[];
}

interface AnalyzerPipelineRunner {
  run(snapshot: RepositorySnapshot, registry: AnalyzerRegistry, config: AnalyzerConfig): Promise<AnalyzerRunSummary>;
}
```

Runner behavior:
1. Resolve execution order from the registry (topological sort on `dependsOn`).
2. For each analyzer in order: skip if `supports()` is false; otherwise run
   it, catch and record thrown errors as a failure (do not abort the
   pipeline), and store the result for dependents to read via
   `getDependencyResult`.
3. Independent analyzers (no shared `dependsOn` edge) may run concurrently —
   the runner groups the sorted order into "waves" of mutually-independent
   analyzers.
4. Return an `AnalyzerRunSummary`; the Knowledge Model builder decides how to
   handle partial failures (e.g. proceed with `codeHealth` missing rather
   than fail the whole pipeline).

## 4. Concrete analyzers (mapped to the spec's "core toolbox")

| Analyzer id | Depends on | Produces (maps to RKM section) |
|---|---|---|
| `structure-analyzer` | — | `files`, `modules` (base shape, before enrichment) |
| `dependency-analyzer` | `structure-analyzer` | `dependencies`, module `centrality`/`importance` |
| `entry-point-analyzer` | `structure-analyzer`, `dependency-analyzer` | `entryPoints` |
| `data-flow-analyzer` | `entry-point-analyzer`, `dependency-analyzer` | `dataFlows` |
| `git-history-analyzer` | `structure-analyzer` (skips via `supports()` if `gitLog` is null) | `git` |
| `code-health-analyzer` | `structure-analyzer`, `dependency-analyzer` | `codeHealth`, per-file `complexity`/`riskIndicators` |
| `security-analyzer` | `structure-analyzer` | `security` (dependency-audit lookups + static pattern rules only) |
| `test-analyzer` | `structure-analyzer`, `dependency-analyzer` | `tests` |
| `documentation-analyzer` | `structure-analyzer` | `documentation` |

Notes:
- The spec's "Domain/glossary analyzer" is **not** in this table: naming and
  describing domain concepts requires inference beyond static facts, so it is
  implemented as a Bob interpretation service (`ai/services/domain-concepts.ts`
  in ARCHITECTURE.md §4), not a deterministic analyzer. It may consume a
  lightweight deterministic pre-pass (e.g. identifier/term frequency per
  module) produced by `structure-analyzer`, but the naming/description output
  goes into `domainConcepts` with `source: "ai-interpreted"`, never into a
  deterministic field.
- `security-analyzer` is intentionally rule/evidence-based only (advisory DB
  lookups on parsed manifests, regex/static pattern rules). It has no AI
  involvement — this is the direct implementation of "the AI must not
  arbitrarily declare something insecure."

## 5. Adding a new analyzer (extension contract)

To add an analyzer, implement `Analyzer<T>`, declare `dependsOn` for any
inputs beyond the raw snapshot, and register it:

```typescript
const duplicationAnalyzer: Analyzer<DuplicatedCodeCandidate[]> = {
  id: "duplication-analyzer",
  displayName: "Duplicated Code Analyzer",
  version: "1.0.0",
  dependsOn: ["structure-analyzer"],
  supports: () => true,
  async run(ctx) {
    const structure = ctx.getDependencyResult<StructureResult>("structure-analyzer");
    // ... similarity-hash file contents from ctx.snapshot ...
    return { analyzerId: "duplication-analyzer", version: "1.0.0", producedAt: new Date().toISOString(), data, diagnostics: [] };
  },
};

registry.register(duplicationAnalyzer);
```

No changes are needed to the runner, the Knowledge Model builder's other
sections, or any other analyzer. The Knowledge Model builder maps
`AnalyzerResult`s to RKM fields by `analyzerId`, so a new analyzer only
requires adding one mapping entry in `knowledge-model/builder.ts` plus the
corresponding RKM schema field (see `REPOSITORY_KNOWLEDGE_MODEL.md`) if it
introduces a genuinely new fact category, or an extension of an existing
array (e.g. more `RiskIndicator` kinds) if it doesn't.

## 6. Testing strategy

Each analyzer is tested against fixture `RepositorySnapshot`s (small, hand-
built or recorded from real repos) with no network access, asserting on the
`AnalyzerResult.data` shape. The pipeline runner is tested separately with
mock analyzers to verify ordering, concurrency waves, and failure isolation.
