import type { RepositorySnapshot } from "./types";
import type { RepositoryKnowledgeModel, FileFact } from "@/types/knowledge-model";

/**
 * Builds the STARTING (mostly empty) RepositoryKnowledgeModel for a freshly
 * ingested repository. This replaces the old analyzer pipeline entirely: no
 * dependency graph, no entry points, no modules, no security findings are
 * computed here — those are populated later, incrementally, by a connected
 * MCP agent calling the submit_* tools (src/server/mcp-tools/submissionTools.ts).
 *
 * What IS filled in here is deliberately limited to facts that are simply
 * observable from the file tree itself — never a judgment call, so there is
 * nothing for an agent to get more "right" by re-deriving it: file type
 * (by path/extension convention), language (by extension), size and line
 * count, byte-weighted language percentages, and two free deterministic
 * signals (large files, README presence) that need no reasoning either.
 */

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  go: "Go",
  rs: "Rust",
  java: "Java",
  kt: "Kotlin",
  rb: "Ruby",
  php: "PHP",
  c: "C",
  h: "C",
  cpp: "C++",
  cc: "C++",
  hpp: "C++",
  cs: "C#",
  swift: "Swift",
  scala: "Scala",
  sh: "Shell",
  sql: "SQL",
  html: "HTML",
  css: "CSS",
  scss: "SCSS",
  vue: "Vue",
};

const CONFIG_BASENAMES = /(^|\/)(package\.json|package-lock\.json|tsconfig.*\.json|\.eslintrc.*|\.prettierrc.*|Dockerfile|docker-compose.*\.ya?ml|.*\.config\.(js|ts|mjs|cjs))$/i;
const ASSET_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "svg", "ico", "webp", "bmp", "mp4", "mov", "avi", "woff", "woff2", "ttf", "eot", "otf"]);
const CONFIG_EXTENSIONS = new Set(["json", "yml", "yaml", "toml", "ini", "cfg", "conf", "env"]);
const LARGE_FILE_LOC_THRESHOLD = 300;

function extOf(filePath: string): string {
  const base = filePath.split("/").pop() ?? filePath;
  const idx = base.lastIndexOf(".");
  return idx > 0 ? base.slice(idx + 1).toLowerCase() : "";
}

function classifyType(filePath: string): FileFact["type"] {
  const lower = filePath.toLowerCase();
  if (/(^|\/)(test|tests|__tests__|spec|e2e)(\/|$)/.test(lower) || /\.(test|spec)\.[a-z0-9]+$/.test(lower)) return "test";
  if (/(^|\/)(docs?|documentation)(\/|$)/.test(lower) || /\.(md|mdx|rst)$/.test(lower)) return "documentation";
  if (/(^|\/)(dist|build|out|\.next|coverage|target)(\/|$)/.test(lower)) return "build-output";
  const ext = extOf(lower);
  if (CONFIG_BASENAMES.test(lower) || CONFIG_EXTENSIONS.has(ext)) return "config";
  if (ASSET_EXTENSIONS.has(ext)) return "asset";
  if (Object.prototype.hasOwnProperty.call(LANGUAGE_BY_EXT, ext)) return "source";
  return "other";
}

export async function seedKnowledgeModel(snapshot: RepositorySnapshot): Promise<RepositoryKnowledgeModel> {
  const files: FileFact[] = await Promise.all(
    snapshot.files.map(async (f): Promise<FileFact> => {
      const type = classifyType(f.path);
      let linesOfCode = 0;
      if (!f.isBinary) {
        const content = await f.readContent();
        if (content) linesOfCode = content.length === 0 ? 0 : content.split("\n").length;
      }
      return {
        id: f.path,
        path: f.path,
        type,
        language: LANGUAGE_BY_EXT[extOf(f.path)] ?? null,
        sizeBytes: f.sizeBytes,
        linesOfCode,
        importance: 0,
        complexity: null,
        testStatus: { isTestFile: type === "test", coveredByTests: false, testFileIds: [] },
        documentationStatus: { hasFileLevelDoc: false, docCommentCoverage: 0 },
        riskIndicators: [],
      };
    })
  );

  const bytesByLanguage = new Map<string, number>();
  for (const f of files) if (f.language) bytesByLanguage.set(f.language, (bytesByLanguage.get(f.language) ?? 0) + f.sizeBytes);
  const totalLangBytes = [...bytesByLanguage.values()].reduce((a, b) => a + b, 0) || 1;
  const languages = [...bytesByLanguage.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([language, bytes]) => ({ language, bytes, percentage: Math.round((bytes / totalLangBytes) * 1000) / 10 }));

  const totalLinesOfCode = files.reduce((sum, f) => sum + f.linesOfCode, 0);
  const largeFiles = files.filter((f) => f.linesOfCode > LARGE_FILE_LOC_THRESHOLD).map((f) => ({ fileId: f.id, linesOfCode: f.linesOfCode }));
  const readmeFile = files.find((f) => /(^|\/)readme(\.[a-z]+)?$/i.test(f.path));

  const now = new Date().toISOString();

  return {
    meta: {
      schemaVersion: "2.0.0",
      repositoryId: snapshot.repositoryId,
      commitSha: snapshot.commitSha,
      generatedAt: now,
      analyzerVersions: {},
    },
    repository: {
      id: snapshot.repositoryId,
      owner: snapshot.owner,
      name: snapshot.repo,
      url: `https://github.com/${snapshot.repositoryId}`,
      defaultBranch: snapshot.defaultBranch,
      description: snapshot.description,
      languages,
      frameworks: [],
      statistics: {
        fileCount: files.length,
        totalLinesOfCode,
        moduleCount: 0,
        contributorCount: 0,
        firstCommitAt: null,
        lastCommitAt: null,
      },
    },
    files,
    modules: [],
    dependencies: [],
    entryPoints: [],
    dataFlows: [],
    git: { commitFrequency: { period: "week", series: [] }, recentChanges: [], hotspots: [], contributors: [] },
    codeHealth: { largeFiles, todoFixme: [], deadCodeCandidates: [], duplicatedCodeCandidates: [], missingTests: [], deprecatedPatterns: [] },
    security: { vulnerableDependencies: [], patternMatches: [] },
    tests: { testFiles: [], coverage: { available: false, overallPercentage: null, byModule: [] }, missingTestCandidates: [] },
    documentation: {
      readme: { exists: !!readmeFile, fileId: readmeFile?.id ?? null, sections: [] },
      docsDirectory: { exists: false, fileIds: [] },
      apiDocumentation: { exists: false, toolDetected: null, fileIds: [] },
      undocumentedImportantModules: [],
    },
    domainConcepts: [],
  };
}
