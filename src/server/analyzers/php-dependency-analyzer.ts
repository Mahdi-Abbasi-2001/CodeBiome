import type { Analyzer, AnalyzerResult } from "./types";
import type { RepositorySnapshot } from "../ingestion/types";
import type { StructureAnalyzerOutput } from "./structure-analyzer";
import type { DependencyEdgeDraft } from "./dependency-analyzer";
import { posixJoin } from "./pathUtils";
import { stripLineComments, stripBlockComments } from "./commentUtils";

export interface PhpDependencyAnalyzerOutput {
  edges: DependencyEdgeDraft[];
}

// `require 'foo.php'`, `require_once('foo/bar.php')`, `include`/`include_once`
// — only the simple "single quoted string literal" form; anything built by
// concatenation (`require __DIR__ . '/foo.php'`, extremely common in
// practice) has no quote directly after the keyword and is deliberately not
// matched rather than guessed at. NOT anchored to line start (a `\b` word
// boundary), so content is comment-stripped before this runs.
const REQUIRE_PATTERN = /\b(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]/g;
// `use Foo\Bar\Baz;`, `use Foo\Bar\Baz as Alias;`.
const USE_PATTERN = /^\s*use\s+\\?([A-Za-z_][A-Za-z0-9_\\]*)/gm;

/** PSR-4 maps a namespace onto a directory declared in composer.json
 *  (`autoload.psr-4`), which isn't parsed here — this is a suffix match
 *  against real files instead, same tradeoff as the Java/C# resolvers. */
function resolvePhpUse(namespace: string, allPaths: Set<string>): string | null {
  const segments = namespace.split("\\").filter(Boolean);
  if (segments.length < 2) return null;
  const suffix = `/${segments.join("/")}.php`;
  const flat = `${segments.join("/")}.php`;
  for (const path of allPaths) {
    if (path.endsWith(suffix) || path === flat) return path;
  }
  return null;
}

export const phpDependencyAnalyzer: Analyzer<PhpDependencyAnalyzerOutput> = {
  id: "php-dependency-analyzer",
  displayName: "PHP Dependency Analyzer",
  version: "0.1.0",
  dependsOn: ["structure-analyzer"],
  supports: (snapshot: RepositorySnapshot) => snapshot.files.some((f) => f.path.endsWith(".php")),
  async run({ snapshot, getDependencyResult }): Promise<AnalyzerResult<PhpDependencyAnalyzerOutput>> {
    const structure = getDependencyResult<StructureAnalyzerOutput>("structure-analyzer");
    const edges: DependencyEdgeDraft[] = [];

    if (!structure) {
      return {
        analyzerId: "php-dependency-analyzer",
        version: "0.1.0",
        producedAt: new Date().toISOString(),
        data: { edges },
        diagnostics: [{ level: "error", message: "structure-analyzer result unavailable" }],
      };
    }

    const allPaths = new Set(structure.data.files.map((f) => f.path));
    const phpFiles = structure.data.files.filter((f) => f.language === "PHP");
    const snapshotByPath = new Map(snapshot.files.map((f) => [f.path, f]));

    let edgeCounter = 0;
    const addEdge = (fromId: string, toId: string | null, confidence: number) => {
      if (!toId || toId === fromId) return;
      edges.push({
        id: `phpdep-${edgeCounter++}`,
        fromId,
        toId,
        fromKind: "file",
        toKind: "file",
        relationship: "imports",
        direction: "uses",
        confidence,
      });
    };

    for (const file of phpFiles) {
      const snapshotFile = snapshotByPath.get(file.path);
      if (!snapshotFile || snapshotFile.isBinary) continue;
      const rawContent = await snapshotFile.readContent();
      if (!rawContent) continue;
      const content = stripBlockComments(stripLineComments(rawContent, "both"));

      const fromDir = file.path.split("/").slice(0, -1).join("/");

      for (const match of content.matchAll(REQUIRE_PATTERN)) {
        const requirePath = match[1];
        if (requirePath.startsWith("/")) continue; // absolute filesystem path, not repo-relative
        const target = posixJoin(fromDir, requirePath);
        addEdge(file.path, allPaths.has(target) ? target : null, 1);
      }

      for (const match of content.matchAll(USE_PATTERN)) {
        addEdge(file.path, resolvePhpUse(match[1], allPaths), 0.6);
      }
    }

    return {
      analyzerId: "php-dependency-analyzer",
      version: "0.1.0",
      producedAt: new Date().toISOString(),
      data: { edges },
      diagnostics: [],
    };
  },
};
