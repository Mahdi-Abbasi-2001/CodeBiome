import type { Analyzer, AnalyzerResult } from "./types";
import type { RepositorySnapshot } from "../ingestion/types";
import type { StructureAnalyzerOutput } from "./structure-analyzer";
import type { DependencyEdgeDraft } from "./dependency-analyzer";
import { posixJoin } from "./pathUtils";
import { stripLineComments } from "./commentUtils";

export interface RubyDependencyAnalyzerOutput {
  edges: DependencyEdgeDraft[];
}

// `require_relative 'foo/bar'` and `require 'foo/bar'` (with or without
// parens). Captured separately since they resolve completely differently.
// NOT anchored to line start (a `\b` word boundary), so a commented-out
// `# require 'foo'` would otherwise still match — content is comment
// -stripped before this runs.
const REQUIRE_PATTERN = /\b(require_relative|require)\s*\(?\s*['"]([^'"]+)['"]/g;

/**
 * `require_relative` is a language-defined relative path from the current
 * file — fully deterministic, confidence 1. Plain `require` resolves via
 * Ruby's load path, which for a typical gem/app layout means "relative to
 * some `lib/` directory" — not a language rule, just the overwhelmingly
 * common convention, so it's applied as a suffix match at reduced
 * confidence, and only after ruling out common stdlib/gem names would be
 * pointless to special-case (a plain `require 'json'` simply won't match
 * any real file, so it naturally produces no edge either way).
 */
export const rubyDependencyAnalyzer: Analyzer<RubyDependencyAnalyzerOutput> = {
  id: "ruby-dependency-analyzer",
  displayName: "Ruby Dependency Analyzer",
  version: "0.1.0",
  dependsOn: ["structure-analyzer"],
  supports: (snapshot: RepositorySnapshot) => snapshot.files.some((f) => f.path.endsWith(".rb")),
  async run({ snapshot, getDependencyResult }): Promise<AnalyzerResult<RubyDependencyAnalyzerOutput>> {
    const structure = getDependencyResult<StructureAnalyzerOutput>("structure-analyzer");
    const edges: DependencyEdgeDraft[] = [];

    if (!structure) {
      return {
        analyzerId: "ruby-dependency-analyzer",
        version: "0.1.0",
        producedAt: new Date().toISOString(),
        data: { edges },
        diagnostics: [{ level: "error", message: "structure-analyzer result unavailable" }],
      };
    }

    const allPaths = new Set(structure.data.files.map((f) => f.path));
    const rubyFiles = structure.data.files.filter((f) => f.language === "Ruby");
    const snapshotByPath = new Map(snapshot.files.map((f) => [f.path, f]));

    let edgeCounter = 0;
    const addEdge = (fromId: string, toId: string | null, confidence: number) => {
      if (!toId || toId === fromId) return;
      edges.push({
        id: `rbdep-${edgeCounter++}`,
        fromId,
        toId,
        fromKind: "file",
        toKind: "file",
        relationship: "imports",
        direction: "uses",
        confidence,
      });
    };

    for (const file of rubyFiles) {
      const snapshotFile = snapshotByPath.get(file.path);
      if (!snapshotFile || snapshotFile.isBinary) continue;
      const rawContent = await snapshotFile.readContent();
      if (!rawContent) continue;
      const content = stripLineComments(rawContent, "hash");

      const fromDir = file.path.split("/").slice(0, -1).join("/");

      for (const match of content.matchAll(REQUIRE_PATTERN)) {
        const [, keyword, requirePath] = match;

        if (keyword === "require_relative") {
          const target = posixJoin(fromDir, requirePath);
          const candidate = allPaths.has(`${target}.rb`) ? `${target}.rb` : allPaths.has(target) ? target : null;
          addEdge(file.path, candidate, 1);
        } else {
          let found: string | null = null;
          for (const path of allPaths) {
            if (path.endsWith(`/lib/${requirePath}.rb`) || path === `lib/${requirePath}.rb`) {
              found = path;
              break;
            }
          }
          addEdge(file.path, found, 0.6);
        }
      }
    }

    return {
      analyzerId: "ruby-dependency-analyzer",
      version: "0.1.0",
      producedAt: new Date().toISOString(),
      data: { edges },
      diagnostics: [],
    };
  },
};
