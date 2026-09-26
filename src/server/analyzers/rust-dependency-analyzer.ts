import type { Analyzer, AnalyzerResult } from "./types";
import type { RepositorySnapshot } from "../ingestion/types";
import type { StructureAnalyzerOutput } from "./structure-analyzer";
import type { DependencyEdgeDraft } from "./dependency-analyzer";
import { posixJoin } from "./pathUtils";

export interface RustDependencyAnalyzerOutput {
  edges: DependencyEdgeDraft[];
}

// `use crate::foo::Bar;`, `pub use self::x;`, `pub(crate) use super::y::Z;`
// — captures the leading `a::b::c` path, stopping before `{`, `*`, `as`, `;`.
// Line-anchored, so a commented-out `// use crate::foo;` never matches — no
// separate comment-stripping needed.
const USE_PATTERN = /^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+([\w:]+)/gm;
// `mod foo;` / `pub mod foo;` — NOT `mod foo { ... }` inline modules, which
// need no file resolution since they're defined right there. Also
// line-anchored.
const MOD_DECL_PATTERN = /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/gm;

function fileStem(filePath: string): string {
  return (filePath.split("/").pop() ?? "").replace(/\.rs$/, "");
}

const MODULE_ROOT_FILENAMES = new Set(["mod", "lib", "main"]);

/** The directory representing THIS file's own module — for `mod.rs`/`lib.rs`/
 *  `main.rs` the module IS its containing directory; for any other `foo.rs`,
 *  its submodules live in a sibling `foo/` directory (`self::x` / `mod x;`
 *  resolve here). */
function ownModuleDir(filePath: string): string {
  const dir = filePath.split("/").slice(0, -1).join("/");
  const stem = fileStem(filePath);
  return MODULE_ROOT_FILENAMES.has(stem) ? dir : posixJoin(dir, stem);
}

/** The directory of this file's PARENT module (for `super::`). */
function parentModuleDir(filePath: string): string {
  const dir = filePath.split("/").slice(0, -1).join("/");
  const stem = fileStem(filePath);
  return MODULE_ROOT_FILENAMES.has(stem) ? dir.split("/").slice(0, -1).join("/") : dir;
}

/** The crate's `src/` root — the nearest ancestor directory literally named
 *  "src" — used to resolve `crate::` (absolute-within-this-crate) paths. In
 *  a Cargo workspace with several crates (exactly WrenAI's shape), each
 *  crate's own `src/` is found independently per file, so `crate::` never
 *  crosses into a sibling crate by accident. */
function crateSrcRoot(filePath: string): string | null {
  const segments = filePath.split("/");
  const idx = segments.lastIndexOf("src");
  if (idx <= 0) return null;
  return segments.slice(0, idx + 1).join("/");
}

/**
 * Tries the full path first, then progressively drops trailing segments.
 * This matters a lot in practice: `use crate::errors::CoreError;` has
 * `errors::CoreError` after `crate::`, but `CoreError` is a struct defined
 * INSIDE `errors.rs`, not a further submodule of its own — the overwhelming
 * common case for a `use` statement importing a specific item. Without this
 * fallback, only `mod x;` declarations (which never have this extra
 * trailing segment) would ever resolve, and every `use crate::`/`self::`/
 * `super::` import of an actual type/fn/const would silently produce no
 * edge — caught by a test, not by manual spot-checking, since the real
 * repos checked by hand only happened to show `mod x;`-derived edges.
 */
function resolveModulePath(base: string, slashPath: string, allPaths: Set<string>): string | null {
  if (!slashPath) return null;
  const segments = slashPath.split("/");
  for (let i = segments.length; i > 0; i--) {
    const candidate = posixJoin(base, segments.slice(0, i).join("/"));
    if (allPaths.has(`${candidate}.rs`)) return `${candidate}.rs`;
    if (allPaths.has(`${candidate}/mod.rs`)) return `${candidate}/mod.rs`;
  }
  return null;
}

/** For a bare `use foo::bar;` (no crate/self/super prefix) — Rust 2018+
 *  treats this as absolute-from-some-crate-root OR an external crate name.
 *  We can't tell which without parsing Cargo.toml dependencies, so this
 *  only ever produces an edge when a real file's path suffix-matches, at
 *  reduced confidence — same technique and same reasoning as the Python
 *  analyzer's absolute-import resolution.
 *
 *  Rust identifiers can't contain hyphens, so a crate directory named
 *  "wren-core-base" is always referenced in code as `wren_core_base` — the
 *  first segment is tried both as-written and with underscores turned back
 *  into hyphens, since that's the crate/package name, not a real path
 *  segment inside it. (A Cargo `package = "..."` rename to a name that
 *  doesn't match the directory at all — WrenAI's `wren-core-py` depends on
 *  `wren-core` renamed to package `wren-semantic-core` — still won't
 *  resolve; that needs actual Cargo.toml dependency parsing, not attempted
 *  here.) */
function suffixResolve(segments: string[], allPaths: Set<string>): string | null {
  // Same trailing-segment fallback as resolveModulePath, and for the same
  // reason: the last segment of a `use` path is very often an item name,
  // not a submodule. Stops at 2 remaining segments (never falls back to a
  // single bare word) to avoid coincidental matches against common names.
  for (let i = segments.length; i >= 2; i--) {
    const head = segments[0];
    const rest = segments.slice(1, i);
    const attempts = [[head, ...rest].join("/")];
    if (head.includes("_")) attempts.push([head.replace(/_/g, "-"), ...rest].join("/"));

    for (const slashPath of attempts) {
      const suffixes = [`/${slashPath}.rs`, `/${slashPath}/mod.rs`];
      for (const path of allPaths) {
        if (suffixes.some((s) => path.endsWith(s)) || path === `${slashPath}.rs` || path === `${slashPath}/mod.rs`) {
          return path;
        }
      }
    }
  }
  return null;
}

const STDLIB_CRATES = new Set(["std", "core", "alloc"]);

/**
 * Regex-based Rust module/use scan — same "not a full parser" tradeoff as
 * the other language analyzers. `crate::`/`self::`/`super::` paths and
 * `mod x;` declarations are resolved with full confidence since Rust's
 * module system maps deterministically onto the file tree; bare absolute
 * `use` paths are only accepted when they suffix-match a real file, at
 * reduced confidence. See docs/ANALYZER_ARCHITECTURE.md.
 */
export const rustDependencyAnalyzer: Analyzer<RustDependencyAnalyzerOutput> = {
  id: "rust-dependency-analyzer",
  displayName: "Rust Dependency Analyzer",
  version: "0.1.0",
  dependsOn: ["structure-analyzer"],
  supports: (snapshot: RepositorySnapshot) => snapshot.files.some((f) => f.path.endsWith(".rs")),
  async run({ snapshot, getDependencyResult }): Promise<AnalyzerResult<RustDependencyAnalyzerOutput>> {
    const structure = getDependencyResult<StructureAnalyzerOutput>("structure-analyzer");
    const edges: DependencyEdgeDraft[] = [];

    if (!structure) {
      return {
        analyzerId: "rust-dependency-analyzer",
        version: "0.1.0",
        producedAt: new Date().toISOString(),
        data: { edges },
        diagnostics: [{ level: "error", message: "structure-analyzer result unavailable" }],
      };
    }

    const allPaths = new Set(structure.data.files.map((f) => f.path));
    const rustFiles = structure.data.files.filter((f) => f.language === "Rust");
    const snapshotByPath = new Map(snapshot.files.map((f) => [f.path, f]));

    let edgeCounter = 0;
    const addEdge = (fromId: string, toId: string | null, confidence: number) => {
      if (!toId || toId === fromId) return;
      edges.push({
        id: `rsdep-${edgeCounter++}`,
        fromId,
        toId,
        fromKind: "file",
        toKind: "file",
        relationship: "imports",
        direction: "uses",
        confidence,
      });
    };

    for (const file of rustFiles) {
      const snapshotFile = snapshotByPath.get(file.path);
      if (!snapshotFile || snapshotFile.isBinary) continue;
      const content = await snapshotFile.readContent();
      if (!content) continue;

      for (const match of content.matchAll(MOD_DECL_PATTERN)) {
        addEdge(file.path, resolveModulePath(ownModuleDir(file.path), match[1], allPaths), 1);
      }

      for (const match of content.matchAll(USE_PATTERN)) {
        const segments = match[1].split("::").filter(Boolean);
        if (segments.length < 2) continue;
        const [head, ...rest] = segments;
        const restPath = rest.join("/");

        if (head === "crate") {
          const root = crateSrcRoot(file.path);
          addEdge(file.path, root ? resolveModulePath(root, restPath, allPaths) : null, 1);
        } else if (head === "self") {
          addEdge(file.path, resolveModulePath(ownModuleDir(file.path), restPath, allPaths), 1);
        } else if (head === "super") {
          addEdge(file.path, resolveModulePath(parentModuleDir(file.path), restPath, allPaths), 1);
        } else if (!STDLIB_CRATES.has(head)) {
          addEdge(file.path, suffixResolve(segments, allPaths), 0.6);
        }
      }
    }

    return {
      analyzerId: "rust-dependency-analyzer",
      version: "0.1.0",
      producedAt: new Date().toISOString(),
      data: { edges },
      diagnostics: [],
    };
  },
};
