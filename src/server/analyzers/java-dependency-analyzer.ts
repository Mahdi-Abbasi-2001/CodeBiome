import type { Analyzer, AnalyzerResult } from "./types";
import type { RepositorySnapshot } from "../ingestion/types";
import type { StructureAnalyzerOutput } from "./structure-analyzer";
import type { DependencyEdgeDraft } from "./dependency-analyzer";

export interface JavaDependencyAnalyzerOutput {
  edges: DependencyEdgeDraft[];
}

// `import com.foo.Bar;`, `import static com.foo.Bar.baz;`, `import com.foo.*;`.
const IMPORT_PATTERN = /^\s*import\s+(?:static\s+)?([\w.]+?)(?:\.\*)?\s*;/gm;

/** Java packages map directly onto directories by convention (src/main/java/com/foo/Bar.java
 *  for package com.foo) — a suffix match against real files, same technique
 *  as the Python analyzer's absolute-import resolution, and for the same
 *  reason: it only ever produces an edge when a real file matches, so a
 *  third-party import (`java.util.List`, `org.junit.Test`) is never
 *  mistaken for an internal one. */
function resolveJavaImport(dottedPath: string, allPaths: Set<string>): string | null {
  const segments = dottedPath.split(".");
  if (segments.length < 2) return null;
  const suffix = `/${segments.join("/")}.java`;
  const flat = `${segments.join("/")}.java`;
  for (const path of allPaths) {
    if (path.endsWith(suffix) || path === flat) return path;
  }
  return null;
}

/**
 * Regex-based Java import scan — same "not a full parser" tradeoff as the
 * JS/TS and Python analyzers. See docs/ANALYZER_ARCHITECTURE.md.
 */
export const javaDependencyAnalyzer: Analyzer<JavaDependencyAnalyzerOutput> = {
  id: "java-dependency-analyzer",
  displayName: "Java Dependency Analyzer",
  version: "0.1.0",
  dependsOn: ["structure-analyzer"],
  supports: (snapshot: RepositorySnapshot) => snapshot.files.some((f) => f.path.endsWith(".java")),
  async run({ snapshot, getDependencyResult }): Promise<AnalyzerResult<JavaDependencyAnalyzerOutput>> {
    const structure = getDependencyResult<StructureAnalyzerOutput>("structure-analyzer");
    const edges: DependencyEdgeDraft[] = [];

    if (!structure) {
      return {
        analyzerId: "java-dependency-analyzer",
        version: "0.1.0",
        producedAt: new Date().toISOString(),
        data: { edges },
        diagnostics: [{ level: "error", message: "structure-analyzer result unavailable" }],
      };
    }

    const allPaths = new Set(structure.data.files.map((f) => f.path));
    const javaFiles = structure.data.files.filter((f) => f.language === "Java");
    const snapshotByPath = new Map(snapshot.files.map((f) => [f.path, f]));

    let edgeCounter = 0;
    for (const file of javaFiles) {
      const snapshotFile = snapshotByPath.get(file.path);
      if (!snapshotFile || snapshotFile.isBinary) continue;
      const content = await snapshotFile.readContent();
      if (!content) continue;

      for (const match of content.matchAll(IMPORT_PATTERN)) {
        const target = resolveJavaImport(match[1], allPaths);
        if (!target || target === file.path) continue;

        edges.push({
          id: `javadep-${edgeCounter++}`,
          fromId: file.path,
          toId: target,
          fromKind: "file",
          toKind: "file",
          relationship: "imports",
          direction: "uses",
          confidence: 0.8,
        });
      }
    }

    return {
      analyzerId: "java-dependency-analyzer",
      version: "0.1.0",
      producedAt: new Date().toISOString(),
      data: { edges },
      diagnostics: [],
    };
  },
};
