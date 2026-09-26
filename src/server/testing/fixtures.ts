import type { RepositorySnapshot, SnapshotFile } from "@/server/ingestion/types";
import type { Analyzer } from "@/server/analyzers/types";
import { AnalyzerRegistry } from "@/server/analyzers/registry";
import { runAnalyzers } from "@/server/analyzers/runner";
import { structureAnalyzer } from "@/server/analyzers/structure-analyzer";

/** Builds a fake RepositorySnapshot from a plain path->content map — no disk,
 *  no network, no tarball. Used by every analyzer test. */
export function fakeSnapshot(files: Record<string, string>): RepositorySnapshot {
  const snapshotFiles: SnapshotFile[] = Object.entries(files).map(([filePath, content]) => ({
    path: filePath,
    absolutePath: `/fake/${filePath}`,
    sizeBytes: Buffer.byteLength(content, "utf8"),
    isBinary: false,
    readContent: async () => content,
  }));

  return {
    repositoryId: "test/repo",
    owner: "test",
    repo: "repo",
    defaultBranch: "main",
    commitSha: "0".repeat(40),
    fetchedAt: new Date().toISOString(),
    description: null,
    files: snapshotFiles,
  };
}

/** Runs structure-analyzer plus one analyzer under test together through the
 *  real pipeline (registry + runner), rather than hand-mocking
 *  StructureAnalyzerOutput — exercises the actual dependsOn/getDependencyResult
 *  wiring the same way production does. */
export async function runWithStructure(snapshot: RepositorySnapshot, analyzer: Analyzer) {
  const registry = new AnalyzerRegistry();
  registry.register(structureAnalyzer);
  registry.register(analyzer);
  return runAnalyzers(snapshot, registry);
}

export interface EdgeDraftLike {
  fromId: string;
  toId: string;
  confidence: number;
}

export function edgesFor(run: Awaited<ReturnType<typeof runWithStructure>>, analyzerId: string): EdgeDraftLike[] {
  const result = run.results.get(analyzerId) as { data: { edges: EdgeDraftLike[] } } | undefined;
  return result?.data.edges ?? [];
}
