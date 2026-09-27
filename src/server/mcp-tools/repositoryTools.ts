import type { RepositoryKnowledgeModel } from "@/types/knowledge-model";
import { resolveKnowledgeModel, resolveFlowModel, resolveWorld } from "./resolveRepository";
import { findModule } from "./moduleLookup";
import { EntityNotFoundError } from "./errors";
import { fetchFileContent } from "@/server/ingestion/fileContent";
import { sessionContextStore } from "@/server/agent/sessionContext";

/**
 * The repository-facts tools (docs/BOB_INTEGRATION.md §"Repository tools").
 * Every function here is a plain, synchronous-where-possible transform over
 * the already-built RepositoryKnowledgeModel — no new analysis, no second
 * knowledge model, nothing that talks to GitHub except `getFile` (which
 * fetches on demand, exactly like the Investigation Panel's Code tab does).
 */

export interface RepositoryOverviewResult {
  repositoryId: string;
  owner: string;
  name: string;
  url: string;
  defaultBranch: string;
  description: string | null;
  commitSha: string;
  analyzedAt: string;
  languages: { language: string; percentage: number }[];
  frameworks: { name: string; category: string; confidence: number }[];
  statistics: RepositoryKnowledgeModel["repository"]["statistics"];
  entryPoints: { id: string; type: string; name: string; filePath: string }[];
  /** The highest-importance modules — a reasonable starting point for "what are the important directories". */
  importantModules: { id: string; name: string; path: string; importance: number; centrality: number }[];
}

export async function getRepositoryOverview(args: { worldId?: string; owner?: string; repo?: string }): Promise<RepositoryOverviewResult> {
  const model = await resolveKnowledgeModel(args);
  const fileById = new Map(model.files.map((f) => [f.id, f]));

  return {
    repositoryId: model.meta.repositoryId,
    owner: model.repository.owner,
    name: model.repository.name,
    url: model.repository.url,
    defaultBranch: model.repository.defaultBranch,
    description: model.repository.description,
    commitSha: model.meta.commitSha,
    analyzedAt: model.meta.generatedAt,
    languages: model.repository.languages.map((l) => ({ language: l.language, percentage: l.percentage })),
    frameworks: model.repository.frameworks.map((f) => ({ name: f.name, category: f.category, confidence: f.confidence })),
    statistics: model.repository.statistics,
    entryPoints: model.entryPoints.map((e) => ({
      id: e.id,
      type: e.type,
      name: e.name,
      filePath: fileById.get(e.fileId)?.path ?? e.fileId,
    })),
    importantModules: [...model.modules]
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 10)
      .map((m) => ({ id: m.id, name: m.name, path: m.path, importance: m.importance, centrality: m.centrality })),
  };
}

export interface SearchMatch {
  kind: "module" | "file" | "entryPoint";
  id: string;
  name: string;
  path: string;
  /** Why this matched — always a real, inspectable reason, never a semantic-similarity score CodeBiome can't justify. */
  matchedOn: string;
}

export interface SearchRepositoryResult {
  query: string;
  method: "keyword-match";
  matches: SearchMatch[];
}

/**
 * Deterministic keyword search — NOT semantic/embedding search. Matches
 * query tokens against module names/paths, file paths, and entry-point
 * names/evidence. Explicitly labeled `method: "keyword-match"` in the
 * result so the agent (and any UI built on this) never overstates it as
 * understanding-based retrieval.
 */
export async function searchRepository(args: { query: string; worldId?: string; owner?: string; repo?: string }): Promise<SearchRepositoryResult> {
  const model = await resolveKnowledgeModel(args);
  const tokens = args.query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
  if (tokens.length === 0) return { query: args.query, method: "keyword-match", matches: [] };

  const score = (haystack: string): number => tokens.filter((t) => haystack.toLowerCase().includes(t)).length;

  const matches: (SearchMatch & { score: number })[] = [];

  for (const m of model.modules) {
    const s = score(`${m.name} ${m.path} ${m.description ?? ""}`);
    if (s > 0) matches.push({ kind: "module", id: m.id, name: m.name, path: m.path, matchedOn: "module name/path", score: s });
  }
  for (const f of model.files) {
    const s = score(f.path);
    if (s > 0) matches.push({ kind: "file", id: f.id, name: f.path.split("/").pop() ?? f.path, path: f.path, matchedOn: "file path", score: s });
  }
  const fileById = new Map(model.files.map((f) => [f.id, f]));
  for (const e of model.entryPoints) {
    const s = score(`${e.name} ${e.detectionEvidence}`);
    if (s > 0)
      matches.push({
        kind: "entryPoint",
        id: e.id,
        name: e.name,
        path: fileById.get(e.fileId)?.path ?? e.fileId,
        matchedOn: "entry point name/evidence",
        score: s,
      });
  }

  matches.sort((a, b) => b.score - a.score);
  return {
    query: args.query,
    method: "keyword-match",
    matches: matches.slice(0, 15).map(({ score: _score, ...rest }) => rest),
  };
}

export interface GetFileResult {
  path: string;
  content: string;
  truncated: boolean;
  moduleId: string | null;
  language: string | null;
  linesOfCode: number;
}

export async function getFile(args: { path: string; worldId?: string; owner?: string; repo?: string }): Promise<GetFileResult> {
  const model = await resolveKnowledgeModel(args);
  const file = model.files.find((f) => f.path === args.path || f.id === args.path);
  if (!file) throw new EntityNotFoundError("file", args.path);

  const owningModule = model.modules.find((m) => m.fileIds.includes(file.id));
  const [owner, repo] = model.meta.repositoryId.split("/");
  const fetched = await fetchFileContent(owner, repo, model.meta.commitSha, file.path);
  if (!fetched.ok) throw new Error(fetched.error);

  return {
    path: file.path,
    content: fetched.content,
    truncated: fetched.truncated,
    moduleId: owningModule?.id ?? null,
    language: file.language,
    linesOfCode: file.linesOfCode,
  };
}

export interface GetModuleResult {
  id: string;
  name: string;
  path: string;
  description: string | null;
  importance: number;
  centrality: number;
  linesOfCode: number;
  fileCount: number;
  files: string[];
  risk: RepositoryKnowledgeModel["modules"][number]["risk"];
  dependencies: { id: string; name: string }[];
  dependents: { id: string; name: string }[];
  entryPoints: { id: string; type: string; name: string }[];
  /** Flows (see flowTools.ts) that pass through this module, by name — lets the agent connect a module to the flows it already found via list_flows/get_flow. */
  participatesInFlows: string[];
}

export async function getModule(args: { moduleId: string; worldId?: string; owner?: string; repo?: string }): Promise<GetModuleResult> {
  const { knowledgeModel: model, flowModel } = await resolveFlowModel(args);
  const mod = findModule(model, args.moduleId);
  const moduleById = new Map(model.modules.map((m) => [m.id, m]));
  const fileById = new Map(model.files.map((f) => [f.id, f]));

  const entryPointsInModule = model.entryPoints.filter((e) => mod.fileIds.includes(e.fileId));
  const flowsThroughModule = flowModel.flows.filter((f) => f.steps.some((s) => s.moduleId === mod.id)).map((f) => f.name);

  return {
    id: mod.id,
    name: mod.name,
    path: mod.path,
    description: mod.description,
    importance: mod.importance,
    centrality: mod.centrality,
    linesOfCode: mod.complexity.linesOfCode,
    fileCount: mod.fileIds.length,
    files: mod.fileIds.map((id) => fileById.get(id)?.path ?? id),
    risk: mod.risk,
    dependencies: mod.dependencyIds.map((id) => ({ id, name: moduleById.get(id)?.name ?? id })),
    dependents: mod.dependentIds.map((id) => ({ id, name: moduleById.get(id)?.name ?? id })),
    entryPoints: entryPointsInModule.map((e) => ({ id: e.id, type: e.type, name: e.name })),
    participatesInFlows: flowsThroughModule,
  };
}

export interface CurrentContextResult {
  hasSelection: boolean;
  selectedModule: { id: string; name: string } | null;
  activeFlow: { id: string; name: string } | null;
  currentStep: { id: string; label: string } | null;
  /** An active onboarding journey (see src/types/onboarding.ts), if the developer is currently walking one. */
  activeOnboardingJourney: { id: string; title: string; stepIndex: number; reason: string } | null;
  note: string;
}

/**
 * What is the developer currently looking at in the CodeBiome browser tab,
 * right now — added after real an external agent testing showed "explain this
 * module" / "what depends on this" has no way to resolve "this" otherwise
 * (see docs/BOB_INTEGRATION.md, ARCHITECTURE_DECISIONS.md §8). Sourced from
 * `sessionContextStore`, which the browser updates on every selection/
 * walkthrough change (src/app/api/session-context/route.ts) — this tool
 * never guesses; if nothing has been selected yet it says so honestly.
 */
export async function getCurrentContext(args: { worldId?: string; owner?: string; repo?: string }): Promise<CurrentContextResult> {
  const { world } = await resolveWorld(args);
  const ctx = await sessionContextStore.get(world.id);

  if (!ctx || (!ctx.selectedModuleId && !ctx.activeFlowId && !ctx.activeOnboardingJourneyId)) {
    return {
      hasSelection: false,
      selectedModule: null,
      activeFlow: null,
      currentStep: null,
      activeOnboardingJourney: null,
      note: "Nothing is currently selected in the CodeBiome browser tab for this repository.",
    };
  }

  return {
    hasSelection: true,
    selectedModule: ctx.selectedModuleId ? { id: ctx.selectedModuleId, name: ctx.selectedModuleName ?? ctx.selectedModuleId } : null,
    activeFlow: ctx.activeFlowId ? { id: ctx.activeFlowId, name: ctx.activeFlowName ?? ctx.activeFlowId } : null,
    currentStep: ctx.currentStepId ? { id: ctx.currentStepId, label: ctx.currentStepLabel ?? ctx.currentStepId } : null,
    activeOnboardingJourney: ctx.activeOnboardingJourneyId
      ? {
          id: ctx.activeOnboardingJourneyId,
          title: ctx.activeOnboardingJourneyTitle ?? ctx.activeOnboardingJourneyId,
          stepIndex: ctx.currentOnboardingStepIndex ?? 0,
          reason: ctx.currentOnboardingStepReason ?? "",
        }
      : null,
    note: "This reflects the CodeBiome browser tab's state as of its last update — it can be a few seconds stale.",
  };
}
