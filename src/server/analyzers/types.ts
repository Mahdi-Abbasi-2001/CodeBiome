import type { RepositorySnapshot } from "../ingestion/types";

export interface AnalyzerDiagnostic {
  level: "info" | "warning" | "error";
  message: string;
  filePath?: string;
}

export interface AnalyzerResult<T = unknown> {
  analyzerId: string;
  version: string;
  producedAt: string;
  data: T;
  diagnostics: AnalyzerDiagnostic[];
}

export interface AnalyzerContext {
  snapshot: RepositorySnapshot;
  /** Read-only access to the result of an analyzer listed in this analyzer's `dependsOn`. */
  getDependencyResult: <T>(analyzerId: string) => AnalyzerResult<T> | undefined;
}

/**
 * The pluggable unit of deterministic analysis. See
 * docs/ANALYZER_ARCHITECTURE.md for the full design and extension contract.
 */
export interface Analyzer<T = unknown> {
  id: string;
  displayName: string;
  version: string;
  dependsOn?: string[];
  supports(snapshot: RepositorySnapshot): boolean;
  run(context: AnalyzerContext): Promise<AnalyzerResult<T>>;
}
