import type { Analyzer, AnalyzerResult } from "./types";
import type { StructureAnalyzerOutput } from "./structure-analyzer";
import type { RepositorySnapshot } from "../ingestion/types";
import { posixJoin } from "./pathUtils";
import { stripCLikeComments } from "./commentUtils";

export interface DependencyEdgeDraft {
  id: string;
  fromId: string;
  toId: string;
  fromKind: "file";
  toKind: "file" | "external-package";
  relationship: "imports";
  direction: "uses";
  confidence: number;
}

export interface DependencyAnalyzerOutput {
  edges: DependencyEdgeDraft[];
}

// Matches `import ... from '...'`, `export ... from '...'` (including
// `export * from '...'` and `export type {X} from '...'`), bare
// `import '...'`, `require('...')`, and dynamic `import('...')`.
//
// The `export ... from` cases matter a lot in practice: barrel/index files
// and type-only re-export modules are often ALL "export"/no "import"
// statements, and missing them was making otherwise well-connected modules
// (anything with a `types/` or `index.ts` re-export surface) look like
// isolated, disconnected nodes in the world even though they're real edges.
const IMPORT_PATTERN =
  /\bfrom\s+['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]\s*\)|\bimport\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s+['"]([^'"]+)['"]/g;

/** Extension/index-file fallback list shared by relative AND path-alias resolution — one resolution algorithm, two ways to arrive at a base path. */
function resolveCandidateFile(basePath: string, allPaths: Set<string>): string | null {
  // Node16/NodeNext-style TypeScript ESM writes ".js" (or ".mjs"/".cjs")
  // specifiers that point at ".ts"/".tsx"/".d.ts" source — the specifier's
  // own extension is a lie about the source file's real extension. Without
  // stripping it, every such import (extremely common in modern TS
  // codebases, especially type-only barrel files) silently fails to
  // resolve, making well-connected modules look isolated in the world.
  const stripped = basePath.replace(/\.(m|c)?jsx?$/, "");

  const candidates = [
    basePath,
    stripped,
    `${stripped}.ts`,
    `${stripped}.tsx`,
    `${stripped}.d.ts`,
    `${stripped}.js`,
    `${stripped}.jsx`,
    `${stripped}/index.ts`,
    `${stripped}/index.tsx`,
    `${stripped}/index.js`,
  ];
  return candidates.find((candidate) => allPaths.has(candidate)) ?? null;
}

function resolveRelativeImport(fromPath: string, specifier: string, allPaths: Set<string>): string | null {
  if (!specifier.startsWith(".")) return null;
  const fromDir = fromPath.split("/").slice(0, -1).join("/");
  return resolveCandidateFile(posixJoin(fromDir, specifier), allPaths);
}

interface PathAliasConfig {
  /** Directory the config file itself lives in, relative to repo root — usually "" (root tsconfig.json). */
  configDir: string;
  baseUrl: string;
  paths: Record<string, string[]>;
}

/**
 * A `/`-aware, string-boundary-aware comment stripper for JSONC — unlike
 * `stripCLikeComments`, this tracks whether it's currently inside a string
 * literal and never treats a `/` there as the start of a comment. JSON
 * string values routinely contain `/` (paths, globs) and even literal `/*`
 * sequences (a path-alias pattern like `"@/*"`), which a plain regex-based
 * block-comment stripper cannot tell apart from a real comment opener.
 */
function stripJsonComments(source: string): string {
  let result = "";
  let i = 0;
  let inString = false;

  while (i < source.length) {
    const ch = source[i];

    if (inString) {
      result += ch;
      if (ch === "\\" && i + 1 < source.length) {
        result += source[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i++;
      continue;
    }

    if (ch === '"') {
      inString = true;
      result += ch;
      i++;
      continue;
    }

    if (ch === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }

    if (ch === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    result += ch;
    i++;
  }

  return result;
}

/**
 * Reads the project's OWN `tsconfig.json`/`jsconfig.json` `compilerOptions.
 * paths` + `baseUrl` — the deterministic, language-defined source of truth
 * for path aliases (e.g. Next.js's default `"@/*": ["./src/*"]`). Never
 * guessed or hardcoded: if the repo has no such config, or it doesn't
 * parse, alias resolution is simply skipped — those imports fall through
 * to "external package", the same honest behavior as before this existed.
 *
 * Found missing during real-world testing (docs/BOB_INTEGRATION.md): a
 * Next.js repository's route handlers exclusively used `@/lib/...`-style
 * aliased imports, so `resolveRelativeImport` alone found zero outgoing
 * edges from every entry point and no flow could ever be reconstructed —
 * despite entry-point detection correctly finding the routes themselves.
 */
async function loadPathAliasConfig(snapshot: RepositorySnapshot): Promise<PathAliasConfig | null> {
  const configFile = snapshot.files.find((f) => f.path === "tsconfig.json" || f.path === "jsconfig.json");
  if (!configFile || configFile.isBinary) return null;

  const raw = await configFile.readContent();
  if (!raw) return null;

  try {
    // tsconfig.json is JSONC in practice (comments + trailing commas are
    // widely used and accepted by tsc) — strip both before JSON.parse.
    // Deliberately NOT `stripCLikeComments`: its block-comment regex has no
    // concept of string literals, so it misreads a path-alias value like
    // `"@/*"` as the START of a `/* */` comment and "closes" it at the next
    // incidental `*/` anywhere later in the file (a glob like `"**/*.ts"` in
    // `include` supplies one) — silently deleting everything in between,
    // `paths` included. Found via real-world testing (docs/BOB_INTEGRATION.md):
    // this ate the exact `"paths": {"@/*": [...]}` block this function exists
    // to read. `stripJsonComments` below tracks string boundaries instead.
    const withoutComments = stripJsonComments(raw);
    const withoutTrailingCommas = withoutComments.replace(/,(\s*[}\]])/g, "$1");
    const parsed = JSON.parse(withoutTrailingCommas);
    const compilerOptions = parsed.compilerOptions;
    if (!compilerOptions?.paths || typeof compilerOptions.paths !== "object") return null;

    const configDir = configFile.path.split("/").slice(0, -1).join("/");
    return {
      configDir,
      baseUrl: typeof compilerOptions.baseUrl === "string" ? compilerOptions.baseUrl : ".",
      paths: compilerOptions.paths,
    };
  } catch {
    return null;
  }
}

function resolveAliasImport(specifier: string, config: PathAliasConfig, allPaths: Set<string>): string | null {
  const baseDir = posixJoin(config.configDir, config.baseUrl);

  for (const [pattern, targets] of Object.entries(config.paths)) {
    if (!Array.isArray(targets)) continue;
    const starIndex = pattern.indexOf("*");

    if (starIndex === -1) {
      if (specifier !== pattern) continue;
      for (const target of targets) {
        const resolved = resolveCandidateFile(posixJoin(baseDir, target), allPaths);
        if (resolved) return resolved;
      }
      continue;
    }

    const prefix = pattern.slice(0, starIndex);
    const suffix = pattern.slice(starIndex + 1);
    if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
    if (specifier.length < prefix.length + suffix.length) continue;
    const wildcard = specifier.slice(prefix.length, specifier.length - suffix.length);

    for (const target of targets) {
      const resolvedTarget = target.replace("*", wildcard);
      const resolved = resolveCandidateFile(posixJoin(baseDir, resolvedTarget), allPaths);
      if (resolved) return resolved;
    }
  }

  return null;
}

/**
 * Regex-based import scan (JS/TS relative + configured-path-alias imports)
 * — deliberately not a full AST parse for v1. See
 * docs/ARCHITECTURE_DECISIONS.md for why this scope is enough for the first
 * vertical slice, and docs/ANALYZER_ARCHITECTURE.md for how to extend
 * language coverage later.
 */
export const dependencyAnalyzer: Analyzer<DependencyAnalyzerOutput> = {
  id: "dependency-analyzer",
  displayName: "Dependency Analyzer",
  version: "0.1.0",
  dependsOn: ["structure-analyzer"],
  supports: () => true,
  async run({ snapshot, getDependencyResult }): Promise<AnalyzerResult<DependencyAnalyzerOutput>> {
    const structure = getDependencyResult<StructureAnalyzerOutput>("structure-analyzer");
    const edges: DependencyEdgeDraft[] = [];

    if (!structure) {
      return {
        analyzerId: "dependency-analyzer",
        version: "0.1.0",
        producedAt: new Date().toISOString(),
        data: { edges },
        diagnostics: [{ level: "error", message: "structure-analyzer result unavailable" }],
      };
    }

    const allPaths = new Set(structure.data.files.map((f) => f.path));
    const sourceFiles = structure.data.files.filter((f) => f.type === "source" || f.type === "test");
    const snapshotByPath = new Map(snapshot.files.map((f) => [f.path, f]));
    const aliasConfig = await loadPathAliasConfig(snapshot);

    let edgeCounter = 0;
    for (const file of sourceFiles) {
      const snapshotFile = snapshotByPath.get(file.path);
      if (!snapshotFile || snapshotFile.isBinary) continue;
      const rawContent = await snapshotFile.readContent();
      if (!rawContent) continue;
      const content = stripCLikeComments(rawContent);

      for (const match of content.matchAll(IMPORT_PATTERN)) {
        const specifier = match[1] ?? match[2] ?? match[3] ?? match[4];
        if (!specifier) continue;
        const target = specifier.startsWith(".")
          ? resolveRelativeImport(file.path, specifier, allPaths)
          : aliasConfig
            ? resolveAliasImport(specifier, aliasConfig, allPaths)
            : null;
        if (!target || target === file.path) continue;

        edges.push({
          id: `dep-${edgeCounter++}`,
          fromId: file.path,
          toId: target,
          fromKind: "file",
          toKind: "file",
          relationship: "imports",
          direction: "uses",
          confidence: 1,
        });
      }
    }

    return {
      analyzerId: "dependency-analyzer",
      version: "0.1.0",
      producedAt: new Date().toISOString(),
      data: { edges },
      diagnostics: [],
    };
  },
};
