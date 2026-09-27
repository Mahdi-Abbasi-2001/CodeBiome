import { fakeSnapshot } from "./fixtures";
import { seedKnowledgeModel } from "@/server/ingestion/seedKnowledgeModel";
import type { RepositoryKnowledgeModel, ModuleFact, DependencyEdge, EntryPointSchema } from "@/types/knowledge-model";
import type { z } from "zod";

/**
 * Builds a full, real RepositoryKnowledgeModel (files, plus simple
 * directory-based modules, regex-detected relative-import dependency edges,
 * and a couple of common entry-point conventions) from an in-memory file
 * map — no network, no tarball. Test-only: this is deliberately a much
 * simpler heuristic than the old removed analyzer pipeline — real
 * architecture facts now come from a connected agent's submit_* calls
 * (src/server/mcp-tools/submissionTools.ts), not from CodeBiome itself, so
 * this fixture only needs to produce something plausible enough to exercise
 * the pure functions/tools that read a RepositoryKnowledgeModel.
 */
export async function buildTestKnowledgeModel(
  files: Record<string, string>,
  repoId: { owner: string; repo: string } = { owner: "test", repo: "repo" }
): Promise<RepositoryKnowledgeModel> {
  const snapshot = fakeSnapshot(files, repoId);
  const base = await seedKnowledgeModel(snapshot);
  const fileIds = new Set(base.files.map((f) => f.id));

  // One module per parent directory (or the file itself, if it's at the
  // repository root) — a simple, predictable convention good enough for
  // tests that need a real module graph, one module per architectural layer
  // (controllers/services/repositories/etc.), to exist.
  const filesByModulePath = new Map<string, string[]>();
  for (const f of base.files) {
    const segments = f.path.split("/");
    const modulePath = segments.length > 1 ? segments.slice(0, -1).join("/") : f.path;
    filesByModulePath.set(modulePath, [...(filesByModulePath.get(modulePath) ?? []), f.id]);
  }

  const modules: ModuleFact[] = [...filesByModulePath.entries()].map(([modulePath, moduleFileIds]) => {
    const loc = moduleFileIds.reduce((sum, id) => sum + (base.files.find((f) => f.id === id)?.linesOfCode ?? 0), 0);
    return {
      id: modulePath,
      name: modulePath,
      path: modulePath,
      description: null,
      fileIds: moduleFileIds,
      importance: Math.min(1, moduleFileIds.length / 5),
      centrality: 0,
      complexity: { cyclomaticComplexity: 0, linesOfCode: loc, maintainabilityIndex: null },
      risk: [],
      dependencyIds: [],
      dependentIds: [],
    };
  });
  const fileToModule = new Map<string, string>();
  for (const m of modules) for (const fid of m.fileIds) fileToModule.set(fid, m.id);

  const IMPORT_PATTERN = /(?:require\(|from\s+)['"](\.[^'"]+)['"]/g;
  const dependencies: DependencyEdge[] = [];
  let depIndex = 0;
  for (const f of base.files) {
    const content = files[f.path] ?? "";
    for (const match of content.matchAll(IMPORT_PATTERN)) {
      const rawTarget = match[1];
      const resolved = resolveRelativeImport(f.path, rawTarget, fileIds);
      if (!resolved) continue;
      dependencies.push({
        id: `test-dep-${depIndex++}`,
        fromId: f.id,
        toId: resolved,
        fromKind: "file",
        toKind: "file",
        relationship: "imports",
        direction: "uses",
        confidence: 1,
      });
    }
  }

  // A tiny curated package->framework map, purely for test fixtures — real
  // framework detection is now submitted by an agent (submit_frameworks),
  // never computed by CodeBiome itself. Only covers the handful of packages
  // this project's own tests reference.
  const PACKAGE_FRAMEWORK_MAP: Record<string, { name: string; category: RepositoryKnowledgeModel["repository"]["frameworks"][number]["category"] }> = {
    typeorm: { name: "TypeORM", category: "database" },
    ioredis: { name: "Redis", category: "cache" },
    redis: { name: "Redis", category: "cache" },
    express: { name: "Express", category: "backend" },
    react: { name: "React", category: "frontend" },
  };
  const PACKAGE_IMPORT_PATTERN = /(?:require\(|from\s+)['"]([^./'"][^'"]*)['"]/g;
  const evidenceByFramework = new Map<string, Set<string>>();
  for (const f of base.files) {
    const content = files[f.path] ?? "";
    for (const match of content.matchAll(PACKAGE_IMPORT_PATTERN)) {
      const pkg = match[1].split("/")[0];
      if (!PACKAGE_FRAMEWORK_MAP[pkg]) continue;
      const name = PACKAGE_FRAMEWORK_MAP[pkg].name;
      if (!evidenceByFramework.has(name)) evidenceByFramework.set(name, new Set());
      evidenceByFramework.get(name)!.add(f.id);
    }
  }
  const frameworks = [...evidenceByFramework.entries()].map(([name, evidence]) => {
    const pkg = Object.entries(PACKAGE_FRAMEWORK_MAP).find(([, v]) => v.name === name)![1];
    return { name, category: pkg.category, evidence: [...evidence], confidence: 1 };
  });

  // Aggregate to module-level dependencyIds/dependentIds, same shape the
  // real submit_dependencies tool computes (src/server/mcp-tools/
  // submissionHelpers.ts's recomputeModuleGraph) — duplicated here in
  // miniature so this fixture doesn't need a World/worldStore to exist yet.
  const moduleById = new Map(modules.map((m) => [m.id, m]));
  for (const edge of dependencies) {
    const fromModuleId = fileToModule.get(edge.fromId);
    const toModuleId = fileToModule.get(edge.toId);
    if (!fromModuleId || !toModuleId || fromModuleId === toModuleId) continue;
    const fromMod = moduleById.get(fromModuleId)!;
    const toMod = moduleById.get(toModuleId)!;
    if (!fromMod.dependencyIds.includes(toModuleId)) fromMod.dependencyIds.push(toModuleId);
    if (!toMod.dependentIds.includes(fromModuleId)) toMod.dependentIds.push(fromModuleId);
  }

  const ENTRY_FILE_PATTERN = /(^|\/)(index|main|server|app)\.(ts|tsx|js|jsx|mjs|cjs)$/i;
  const entryPoints: z.infer<typeof EntryPointSchema>[] = base.files
    .filter((f) => ENTRY_FILE_PATTERN.test(f.path))
    .map((f, i) => ({ id: `test-entry-${i}`, type: "app-startup" as const, name: f.path, fileId: f.id, detectionEvidence: `Conventional entry filename: ${f.path}` }));

  return {
    ...base,
    modules,
    dependencies,
    entryPoints,
    repository: { ...base.repository, frameworks, statistics: { ...base.repository.statistics, moduleCount: modules.length } },
  };
}

function resolveRelativeImport(fromPath: string, rawTarget: string, fileIds: Set<string>): string | null {
  const fromDir = fromPath.split("/").slice(0, -1);
  const parts = [...fromDir, ...rawTarget.split("/")];
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  const base = stack.join("/");

  const candidates = [base, `${base}.js`, `${base}.ts`, `${base}.jsx`, `${base}.tsx`, `${base}/index.js`, `${base}/index.ts`];
  for (const c of candidates) if (fileIds.has(c)) return c;
  return null;
}
