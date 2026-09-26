import type { Analyzer, AnalyzerResult } from "./types";
import type { RepositorySnapshot } from "../ingestion/types";
import type { StructureAnalyzerOutput } from "./structure-analyzer";
import type { DependencyEdgeDraft } from "./dependency-analyzer";
import { stripLineComments } from "./commentUtils";

export interface GoDependencyAnalyzerOutput {
  edges: DependencyEdgeDraft[];
}

const MODULE_DIRECTIVE = /^module\s+(\S+)/m;
const IMPORT_BLOCK = /import\s*\(([\s\S]*?)\)/g;
const SINGLE_IMPORT = /^\s*import\s+(?:\w+\s+)?"([^"]+)"/gm;
// Unlike SINGLE_IMPORT, this scans the whole grouped-import block content for
// ANY quoted string rather than one match per anchored line — a commented
// -out `// "some/path"` inside the block would otherwise still match, so the
// block's content is comment-stripped first (see call site below).
const QUOTED_PATH = /"([^"]+)"/g;

/**
 * Go's import unit is a whole PACKAGE (a directory), not a single file — so
 * unlike the other language analyzers, resolution here needs `go.mod`'s
 * declared module path to tell local imports (`<module>/internal/foo`) apart
 * from external ones (`fmt`, `github.com/some/lib`). An edge's `toId` is
 * just the first `.go` file found in the resolved local package directory —
 * arbitrary within that directory, but knowledge-model/builder.ts only ever
 * aggregates edges up to module granularity, so which file it is doesn't
 * matter, only which directory. No `go.mod` at the repo root → this
 * analyzer skips itself entirely rather than guessing a module path.
 */
export const goDependencyAnalyzer: Analyzer<GoDependencyAnalyzerOutput> = {
  id: "go-dependency-analyzer",
  displayName: "Go Dependency Analyzer",
  version: "0.1.0",
  dependsOn: ["structure-analyzer"],
  supports: (snapshot: RepositorySnapshot) => snapshot.files.some((f) => f.path === "go.mod"),
  async run({ snapshot, getDependencyResult }): Promise<AnalyzerResult<GoDependencyAnalyzerOutput>> {
    const structure = getDependencyResult<StructureAnalyzerOutput>("structure-analyzer");
    const edges: DependencyEdgeDraft[] = [];

    if (!structure) {
      return {
        analyzerId: "go-dependency-analyzer",
        version: "0.1.0",
        producedAt: new Date().toISOString(),
        data: { edges },
        diagnostics: [{ level: "error", message: "structure-analyzer result unavailable" }],
      };
    }

    const snapshotByPath = new Map(snapshot.files.map((f) => [f.path, f]));
    const goModFile = snapshotByPath.get("go.mod");
    const goModContent = goModFile ? await goModFile.readContent() : "";
    const moduleMatch = goModContent.match(MODULE_DIRECTIVE);

    if (!moduleMatch) {
      return {
        analyzerId: "go-dependency-analyzer",
        version: "0.1.0",
        producedAt: new Date().toISOString(),
        data: { edges },
        diagnostics: [{ level: "info", message: "go.mod present but no 'module' directive found" }],
      };
    }
    const modulePrefix = `${moduleMatch[1]}/`;

    const allPaths = structure.data.files.map((f) => f.path);
    const goFiles = structure.data.files.filter((f) => f.language === "Go");

    let edgeCounter = 0;
    for (const file of goFiles) {
      const snapshotFile = snapshotByPath.get(file.path);
      if (!snapshotFile || snapshotFile.isBinary) continue;
      const content = await snapshotFile.readContent();
      if (!content) continue;

      const importPaths: string[] = [];
      for (const block of content.matchAll(IMPORT_BLOCK)) {
        const blockContent = stripLineComments(block[1], "slash");
        for (const quoted of blockContent.matchAll(QUOTED_PATH)) importPaths.push(quoted[1]);
      }
      for (const single of content.matchAll(SINGLE_IMPORT)) importPaths.push(single[1]);

      for (const importPath of importPaths) {
        if (!importPath.startsWith(modulePrefix)) continue; // external or stdlib
        const localDir = importPath.slice(modulePrefix.length);
        if (!localDir) continue;

        const target = allPaths.find((p) => p.startsWith(`${localDir}/`) && p.endsWith(".go"));
        if (!target || target === file.path) continue;

        edges.push({
          id: `godep-${edgeCounter++}`,
          fromId: file.path,
          toId: target,
          fromKind: "file",
          toKind: "file",
          relationship: "imports",
          direction: "uses",
          confidence: 0.85,
        });
      }
    }

    return {
      analyzerId: "go-dependency-analyzer",
      version: "0.1.0",
      producedAt: new Date().toISOString(),
      data: { edges },
      diagnostics: [],
    };
  },
};
