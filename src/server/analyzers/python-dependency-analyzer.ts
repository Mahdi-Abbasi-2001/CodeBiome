import type { Analyzer, AnalyzerResult } from "./types";
import type { RepositorySnapshot } from "../ingestion/types";
import type { StructureAnalyzerOutput } from "./structure-analyzer";
import type { DependencyEdgeDraft } from "./dependency-analyzer";
import { posixJoin } from "./pathUtils";

export interface PythonDependencyAnalyzerOutput {
  edges: DependencyEdgeDraft[];
}

// `from .foo.bar import X`, `from . import X, Y as z`, `from ..pkg import X`.
// Group 1 = leading dots (possibly ""), group 2 = dotted module path after
// the dots (possibly ""), group 3 = the raw imported-names list. Anchored to
// line start, so a commented-out `# from foo import bar` never matches (the
// line starts with "#", not "from") — no separate comment-stripping needed.
const FROM_IMPORT_PATTERN = /^[ \t]*from\s+(\.*)([\w.]*)\s+import\s+([^\n#]+)/gm;
// `import foo.bar`, `import foo.bar as baz` — NOT `from ... import`. Also
// line-anchored, same immunity to commented-out lines.
const PLAIN_IMPORT_PATTERN = /^[ \t]*import\s+([\w][\w.]*)/gm;

function findFile(candidates: string[], allPaths: Set<string>): string | null {
  return candidates.find((c) => allPaths.has(c)) ?? null;
}

/** `import a.b.c` / `from a.b.c import X` with no leading dots — only ever
 *  resolved if some file in the snapshot's path actually ends with the
 *  dotted path turned into a file, so third-party/stdlib imports (which
 *  won't match anything real) are never turned into edges. Multi-segment
 *  only, to avoid coincidental single-word matches (`import os` etc). */
function resolveAbsoluteImport(modulePath: string, allPaths: Set<string>): string | null {
  const segments = modulePath.split(".");
  if (segments.length < 2) return null;
  const asPath = segments.join("/");
  const suffixes = [`/${asPath}.py`, `/${asPath}/__init__.py`];
  for (const path of allPaths) {
    if (suffixes.some((s) => path.endsWith(s)) || path === `${asPath}.py` || path === `${asPath}/__init__.py`) {
      return path;
    }
  }
  return null;
}

function parseNames(namesRaw: string): string[] {
  return namesRaw
    .replace(/[()\\]/g, " ")
    .split(",")
    .map((n) => n.trim().split(/\s+as\s+/)[0].trim())
    .filter(Boolean);
}

function extractEdges(filePath: string, content: string, allPaths: Set<string>): { target: string; confidence: number }[] {
  const found: { target: string; confidence: number }[] = [];
  const fromDir = filePath.split("/").slice(0, -1).join("/");

  for (const match of content.matchAll(FROM_IMPORT_PATTERN)) {
    const dots = match[1];
    const modulePath = match[2];
    const namesRaw = match[3];

    if (dots.length > 0) {
      // `from .` = current package (same dir as this file); each extra dot
      // goes up one more package level.
      let base = fromDir;
      for (let i = 0; i < dots.length - 1; i++) base = posixJoin(base, "..");

      if (modulePath) {
        const targetBase = posixJoin(base, modulePath.replace(/\./g, "/"));
        const target = findFile([`${targetBase}.py`, `${targetBase}/__init__.py`], allPaths);
        if (target) found.push({ target, confidence: 1 });
        continue;
      }

      // `from . import x, y` — each name may itself be a sibling submodule.
      let matchedAny = false;
      for (const name of parseNames(namesRaw)) {
        const targetBase = posixJoin(base, name);
        const target = findFile([`${targetBase}.py`, `${targetBase}/__init__.py`], allPaths);
        if (target) {
          found.push({ target, confidence: 1 });
          matchedAny = true;
        }
      }
      if (!matchedAny) {
        const initFile = findFile([`${base}/__init__.py`], allPaths);
        if (initFile && initFile !== filePath) found.push({ target: initFile, confidence: 0.6 });
      }
    } else if (modulePath) {
      const target = resolveAbsoluteImport(modulePath, allPaths);
      if (target) found.push({ target, confidence: 0.7 });
    }
  }

  for (const match of content.matchAll(PLAIN_IMPORT_PATTERN)) {
    const target = resolveAbsoluteImport(match[1], allPaths);
    if (target) found.push({ target, confidence: 0.7 });
  }

  return found;
}

/**
 * Regex-based Python import scan — the Python counterpart to
 * dependency-analyzer.ts. Handles explicit relative imports (`from .foo
 * import X`, `from . import X`) with full confidence, and absolute
 * dotted imports (`import a.b.c`, `from a.b.c import X`) ONLY when a real
 * file in the snapshot matches, at reduced confidence — this is a suffix
 * match against the repo's own file paths, not a real `sys.path`/package
 * resolver, so it's disclosed as heuristic via the edge's `confidence`.
 * Not a full AST parse (multi-line parenthesized import lists past the
 * first line aren't followed) — same tradeoff as the JS/TS analyzer.
 */
export const pythonDependencyAnalyzer: Analyzer<PythonDependencyAnalyzerOutput> = {
  id: "python-dependency-analyzer",
  displayName: "Python Dependency Analyzer",
  version: "0.1.0",
  dependsOn: ["structure-analyzer"],
  supports: (snapshot: RepositorySnapshot) => snapshot.files.some((f) => f.path.endsWith(".py")),
  async run({ snapshot, getDependencyResult }): Promise<AnalyzerResult<PythonDependencyAnalyzerOutput>> {
    const structure = getDependencyResult<StructureAnalyzerOutput>("structure-analyzer");
    const edges: DependencyEdgeDraft[] = [];

    if (!structure) {
      return {
        analyzerId: "python-dependency-analyzer",
        version: "0.1.0",
        producedAt: new Date().toISOString(),
        data: { edges },
        diagnostics: [{ level: "error", message: "structure-analyzer result unavailable" }],
      };
    }

    const allPaths = new Set(structure.data.files.map((f) => f.path));
    const pythonFiles = structure.data.files.filter((f) => f.language === "Python");
    const snapshotByPath = new Map(snapshot.files.map((f) => [f.path, f]));

    let edgeCounter = 0;
    for (const file of pythonFiles) {
      const snapshotFile = snapshotByPath.get(file.path);
      if (!snapshotFile || snapshotFile.isBinary) continue;
      const content = await snapshotFile.readContent();
      if (!content) continue;

      for (const { target, confidence } of extractEdges(file.path, content, allPaths)) {
        if (target === file.path) continue;
        edges.push({
          id: `pydep-${edgeCounter++}`,
          fromId: file.path,
          toId: target,
          fromKind: "file",
          toKind: "file",
          relationship: "imports",
          direction: "uses",
          confidence,
        });
      }
    }

    return {
      analyzerId: "python-dependency-analyzer",
      version: "0.1.0",
      producedAt: new Date().toISOString(),
      data: { edges },
      diagnostics: [],
    };
  },
};
