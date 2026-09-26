import type { Analyzer, AnalyzerResult } from "./types";
import type { RepositorySnapshot } from "../ingestion/types";
import type { StructureAnalyzerOutput } from "./structure-analyzer";
import type { DependencyEdgeDraft } from "./dependency-analyzer";

export interface CSharpDependencyAnalyzerOutput {
  edges: DependencyEdgeDraft[];
}

// `using Foo.Bar;`, `global using Foo.Bar;`, `using static Foo.Bar;`,
// `using Alias = Foo.Bar;`.
const USING_PATTERN = /^\s*(?:global\s+)?using\s+(?:static\s+)?(?:\w+\s*=\s*)?([\w.]+)\s*;/gm;

/**
 * C# namespaces are a WEAKER convention than Java packages — the compiler
 * doesn't enforce namespace-to-folder correspondence, projects just usually
 * follow it. Same suffix-match technique as Java, but at lower confidence
 * to reflect that it's a looser convention, not a language rule.
 */
function resolveCSharpUsing(dottedPath: string, allPaths: Set<string>): string | null {
  const segments = dottedPath.split(".");
  if (segments.length < 2) return null;
  const suffix = `/${segments.join("/")}.cs`;
  const flat = `${segments.join("/")}.cs`;
  for (const path of allPaths) {
    if (path.endsWith(suffix) || path === flat) return path;
  }
  return null;
}

export const csharpDependencyAnalyzer: Analyzer<CSharpDependencyAnalyzerOutput> = {
  id: "csharp-dependency-analyzer",
  displayName: "C# Dependency Analyzer",
  version: "0.1.0",
  dependsOn: ["structure-analyzer"],
  supports: (snapshot: RepositorySnapshot) => snapshot.files.some((f) => f.path.endsWith(".cs")),
  async run({ snapshot, getDependencyResult }): Promise<AnalyzerResult<CSharpDependencyAnalyzerOutput>> {
    const structure = getDependencyResult<StructureAnalyzerOutput>("structure-analyzer");
    const edges: DependencyEdgeDraft[] = [];

    if (!structure) {
      return {
        analyzerId: "csharp-dependency-analyzer",
        version: "0.1.0",
        producedAt: new Date().toISOString(),
        data: { edges },
        diagnostics: [{ level: "error", message: "structure-analyzer result unavailable" }],
      };
    }

    const allPaths = new Set(structure.data.files.map((f) => f.path));
    const csFiles = structure.data.files.filter((f) => f.language === "C#");
    const snapshotByPath = new Map(snapshot.files.map((f) => [f.path, f]));

    let edgeCounter = 0;
    for (const file of csFiles) {
      const snapshotFile = snapshotByPath.get(file.path);
      if (!snapshotFile || snapshotFile.isBinary) continue;
      const content = await snapshotFile.readContent();
      if (!content) continue;

      for (const match of content.matchAll(USING_PATTERN)) {
        if (match[1] === "System" || match[1].startsWith("System.")) continue; // BCL, never local
        const target = resolveCSharpUsing(match[1], allPaths);
        if (!target || target === file.path) continue;

        edges.push({
          id: `csdep-${edgeCounter++}`,
          fromId: file.path,
          toId: target,
          fromKind: "file",
          toKind: "file",
          relationship: "imports",
          direction: "uses",
          confidence: 0.6,
        });
      }
    }

    return {
      analyzerId: "csharp-dependency-analyzer",
      version: "0.1.0",
      producedAt: new Date().toISOString(),
      data: { edges },
      diagnostics: [],
    };
  },
};
