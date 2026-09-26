import type { Analyzer, AnalyzerResult } from "./types";

export interface StructureFile {
  id: string;
  path: string;
  type: "source" | "test" | "config" | "documentation" | "asset" | "generated" | "build-output" | "other";
  language: string | null;
  sizeBytes: number;
  linesOfCode: number;
  isTestFile: boolean;
}

export interface StructureModule {
  id: string;
  name: string;
  path: string;
  fileIds: string[];
}

export interface StructureAnalyzerOutput {
  files: StructureFile[];
  modules: StructureModule[];
  languageStats: { language: string; bytes: number; percentage: number }[];
  readme: { exists: boolean; fileId: string | null };
}

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  go: "Go",
  rb: "Ruby",
  java: "Java",
  rs: "Rust",
  c: "C",
  h: "C",
  cpp: "C++",
  hpp: "C++",
  cc: "C++",
  cs: "C#",
  php: "PHP",
  css: "CSS",
  scss: "SCSS",
  html: "HTML",
  md: "Markdown",
  mdx: "Markdown",
  json: "JSON",
  yml: "YAML",
  yaml: "YAML",
  sh: "Shell",
  sql: "SQL",
};

const CONFIG_FILENAMES = new Set([
  "package.json",
  "tsconfig.json",
  "next.config.js",
  "next.config.mjs",
  "tailwind.config.ts",
  "tailwind.config.js",
  ".eslintrc.json",
  ".eslintrc.js",
  "docker-compose.yml",
  "dockerfile",
]);

// Directories that represent one cohesive thing regardless of how many
// subfolders they happen to have (e.g. "docs/api/" and "docs/guides/" are
// still just "docs") — never split these one level deeper, even if they'd
// otherwise qualify under SPLIT_MIN_CHILD_DIRS. This also protects the
// world-mapping heuristics in world/builder.ts that key off a module's path
// ending in exactly "docs"/"tests"/etc.
const NEVER_SPLIT_TOP_LEVEL_DIRS = new Set([
  "docs",
  "doc",
  "documentation",
  "examples",
  "example",
  "tests",
  "test",
  "spec",
  "specs",
  "evals",
  "eval",
  "scripts",
  "script",
  "misc",
  "media",
  "assets",
  "static",
  "fixtures",
  "vendor",
]);

// A top-level directory with at least this many DISTINCT immediate
// subdirectories is treated as a namespace/monorepo folder (e.g. "core/"
// holding several unrelated sub-projects) rather than one module — it gets
// split one level deeper, same as the old fixed "src/app/lib/..." whitelist
// did, except decided from the repo's actual shape instead of a name list.
const SPLIT_MIN_CHILD_DIRS = 2;

function extensionOf(filePath: string): string {
  const name = filePath.split("/").pop() ?? filePath;
  return name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
}

function classifyFile(filePath: string, isBinary: boolean): StructureFile["type"] {
  const name = (filePath.split("/").pop() ?? "").toLowerCase();
  const ext = extensionOf(filePath);
  if (isBinary) return "asset";
  if (
    /\.(test|spec)\.[jt]sx?$/.test(name) ||
    filePath.includes("__tests__") ||
    filePath.includes("/test/") ||
    filePath.includes("/tests/")
  ) {
    return "test";
  }
  if (CONFIG_FILENAMES.has(name) || ["yml", "yaml", "toml", "ini"].includes(ext)) return "config";
  if (["md", "mdx"].includes(ext) || filePath.startsWith("docs/")) return "documentation";
  if (filePath.includes("/dist/") || filePath.includes("/build/") || filePath.includes("/.next/")) {
    return "build-output";
  }
  if (LANGUAGE_BY_EXT[ext]) return "source";
  return "other";
}

/** Which top-level directories should split one level deeper, decided from
 *  the actual file tree rather than a fixed name list. */
function computeSplitDirs(filePaths: string[]): Set<string> {
  const childDirsByTop = new Map<string, Set<string>>();
  for (const path of filePaths) {
    const segments = path.split("/");
    if (segments.length <= 2) continue;
    const top = segments[0];
    if (NEVER_SPLIT_TOP_LEVEL_DIRS.has(top.toLowerCase())) continue;
    if (!childDirsByTop.has(top)) childDirsByTop.set(top, new Set());
    childDirsByTop.get(top)!.add(segments[1]);
  }
  const splitDirs = new Set<string>();
  for (const [top, children] of childDirsByTop) {
    if (children.size >= SPLIT_MIN_CHILD_DIRS) splitDirs.add(top);
  }
  return splitDirs;
}

function moduleKeyFor(filePath: string, splitDirs: Set<string>): { id: string; name: string; path: string } {
  const segments = filePath.split("/");
  if (segments.length === 1) return { id: "root", name: "(root)", path: "" };
  if (splitDirs.has(segments[0]) && segments.length > 2) {
    return { id: `${segments[0]}/${segments[1]}`, name: segments[1], path: `${segments[0]}/${segments[1]}` };
  }
  return { id: segments[0], name: segments[0], path: segments[0] };
}

/**
 * Produces the base file/module facts (§structure) that every other v1
 * analyzer builds on. See docs/ANALYZER_ARCHITECTURE.md.
 */
export const structureAnalyzer: Analyzer<StructureAnalyzerOutput> = {
  id: "structure-analyzer",
  displayName: "Structure Analyzer",
  version: "0.1.0",
  supports: () => true,
  async run({ snapshot }): Promise<AnalyzerResult<StructureAnalyzerOutput>> {
    const files: StructureFile[] = [];
    const modulesByKey = new Map<string, StructureModule>();
    const languageBytes = new Map<string, number>();
    let readme: { exists: boolean; fileId: string | null } = { exists: false, fileId: null };

    // Needs the full path list up front, so it's computed before the main
    // loop rather than folded into module grouping per-file.
    const splitDirs = computeSplitDirs(snapshot.files.map((f) => f.path));

    for (const file of snapshot.files) {
      const ext = extensionOf(file.path);
      const language = LANGUAGE_BY_EXT[ext] ?? null;
      const type = classifyFile(file.path, file.isBinary);

      let linesOfCode = 0;
      if (!file.isBinary && (type === "source" || type === "test" || type === "documentation" || type === "config")) {
        const content = await file.readContent();
        linesOfCode = content ? content.split("\n").length : 0;
      }

      if (language) languageBytes.set(language, (languageBytes.get(language) ?? 0) + file.sizeBytes);

      const fileId = file.path;
      files.push({
        id: fileId,
        path: file.path,
        type,
        language,
        sizeBytes: file.sizeBytes,
        linesOfCode,
        isTestFile: type === "test",
      });

      if (/^readme(\.md|\.txt)?$/i.test(file.path)) {
        readme = { exists: true, fileId };
      }

      const moduleKey = moduleKeyFor(file.path, splitDirs);
      const existing = modulesByKey.get(moduleKey.id);
      if (existing) {
        existing.fileIds.push(fileId);
      } else {
        modulesByKey.set(moduleKey.id, {
          id: moduleKey.id,
          name: moduleKey.name,
          path: moduleKey.path,
          fileIds: [fileId],
        });
      }
    }

    const totalBytes = [...languageBytes.values()].reduce((a, b) => a + b, 0) || 1;
    const languageStats = [...languageBytes.entries()]
      .map(([language, bytes]) => ({ language, bytes, percentage: bytes / totalBytes }))
      .sort((a, b) => b.bytes - a.bytes);

    return {
      analyzerId: "structure-analyzer",
      version: "0.1.0",
      producedAt: new Date().toISOString(),
      data: { files, modules: [...modulesByKey.values()], languageStats, readme },
      diagnostics: [],
    };
  },
};
