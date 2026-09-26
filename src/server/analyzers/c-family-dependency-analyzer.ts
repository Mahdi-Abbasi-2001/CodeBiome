import type { Analyzer, AnalyzerResult } from "./types";
import type { RepositorySnapshot } from "../ingestion/types";
import type { StructureAnalyzerOutput } from "./structure-analyzer";
import type { DependencyEdgeDraft } from "./dependency-analyzer";
import { posixJoin } from "./pathUtils";

export interface CFamilyDependencyAnalyzerOutput {
  edges: DependencyEdgeDraft[];
}

// `#include "foo.h"` (quoted — always project-relative by convention) vs
// `#include <foo.h>` (angle brackets — system/configured-include-path
// headers, but plenty of codebases put their own public headers there too).
// Both line-anchored, so a commented-out `// #include "foo.h"` never
// matches (the line starts with "//", not "#") — no separate
// comment-stripping needed.
const QUOTED_INCLUDE = /^\s*#\s*include\s*"([^"]+)"/gm;
const ANGLE_INCLUDE = /^\s*#\s*include\s*<([^>]+)>/gm;

/**
 * C/C++ share `#include` syntax and header-resolution rules, so one analyzer
 * covers both (structure-analyzer already tags them as separate languages
 * for stats purposes). Quoted includes already carry their own extension
 * and are resolved exactly relative to the including file's directory —
 * that's the language-defined rule, not a heuristic, so confidence is 1.
 * Angle-bracket includes are usually system/library headers, but some
 * projects put their own public headers on an include path, so they're
 * still tried via a suffix match against real files, at reduced confidence.
 */
export const cFamilyDependencyAnalyzer: Analyzer<CFamilyDependencyAnalyzerOutput> = {
  id: "c-family-dependency-analyzer",
  displayName: "C/C++ Dependency Analyzer",
  version: "0.1.0",
  dependsOn: ["structure-analyzer"],
  supports: (snapshot: RepositorySnapshot) => snapshot.files.some((f) => /\.(c|h|cpp|hpp|cc|cxx|hxx)$/i.test(f.path)),
  async run({ snapshot, getDependencyResult }): Promise<AnalyzerResult<CFamilyDependencyAnalyzerOutput>> {
    const structure = getDependencyResult<StructureAnalyzerOutput>("structure-analyzer");
    const edges: DependencyEdgeDraft[] = [];

    if (!structure) {
      return {
        analyzerId: "c-family-dependency-analyzer",
        version: "0.1.0",
        producedAt: new Date().toISOString(),
        data: { edges },
        diagnostics: [{ level: "error", message: "structure-analyzer result unavailable" }],
      };
    }

    const allPaths = new Set(structure.data.files.map((f) => f.path));
    const cFiles = structure.data.files.filter((f) => f.language === "C" || f.language === "C++");
    const snapshotByPath = new Map(snapshot.files.map((f) => [f.path, f]));

    let edgeCounter = 0;
    const addEdge = (fromId: string, toId: string | null, confidence: number) => {
      if (!toId || toId === fromId) return;
      edges.push({
        id: `cdep-${edgeCounter++}`,
        fromId,
        toId,
        fromKind: "file",
        toKind: "file",
        relationship: "imports",
        direction: "uses",
        confidence,
      });
    };

    for (const file of cFiles) {
      const snapshotFile = snapshotByPath.get(file.path);
      if (!snapshotFile || snapshotFile.isBinary) continue;
      const content = await snapshotFile.readContent();
      if (!content) continue;

      const fromDir = file.path.split("/").slice(0, -1).join("/");

      for (const match of content.matchAll(QUOTED_INCLUDE)) {
        const target = posixJoin(fromDir, match[1]);
        addEdge(file.path, allPaths.has(target) ? target : null, 1);
      }

      for (const match of content.matchAll(ANGLE_INCLUDE)) {
        const includePath = match[1];
        let found: string | null = null;
        for (const path of allPaths) {
          if (path === includePath || path.endsWith(`/${includePath}`)) {
            found = path;
            break;
          }
        }
        addEdge(file.path, found, 0.5);
      }
    }

    return {
      analyzerId: "c-family-dependency-analyzer",
      version: "0.1.0",
      producedAt: new Date().toISOString(),
      data: { edges },
      diagnostics: [],
    };
  },
};
