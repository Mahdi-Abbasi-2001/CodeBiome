import { buildRepositorySnapshot } from "@/server/ingestion/snapshotBuilder";
import { AnalyzerRegistry } from "@/server/analyzers/registry";
import { runAnalyzers } from "@/server/analyzers/runner";
import { structureAnalyzer, type StructureAnalyzerOutput } from "@/server/analyzers/structure-analyzer";
import { dependencyAnalyzer } from "@/server/analyzers/dependency-analyzer";
import { pythonDependencyAnalyzer } from "@/server/analyzers/python-dependency-analyzer";
import { rustDependencyAnalyzer } from "@/server/analyzers/rust-dependency-analyzer";
import { goDependencyAnalyzer } from "@/server/analyzers/go-dependency-analyzer";
import { javaDependencyAnalyzer } from "@/server/analyzers/java-dependency-analyzer";
import { cFamilyDependencyAnalyzer } from "@/server/analyzers/c-family-dependency-analyzer";
import { csharpDependencyAnalyzer } from "@/server/analyzers/csharp-dependency-analyzer";
import { rubyDependencyAnalyzer } from "@/server/analyzers/ruby-dependency-analyzer";
import { phpDependencyAnalyzer } from "@/server/analyzers/php-dependency-analyzer";
import { securityAnalyzer } from "@/server/analyzers/security-analyzer";
import { entryPointAnalyzer, type EntryPointAnalyzerOutput } from "@/server/analyzers/entry-point-analyzer";
import { frontendCallAnalyzer } from "@/server/analyzers/frontend-call-analyzer";
import { fetchRepoMeta } from "@/server/ingestion/githubClient";
import { buildKnowledgeModel } from "@/server/knowledge-model/builder";
import { knowledgeModelStore } from "@/server/knowledge-model/store";
import { buildWorldModel } from "@/server/world/builder";
import { inferFlows } from "@/server/flows/inferFlows";
import { inferJourneys } from "@/server/journeys/inferJourneys";
import type { RepositoryKnowledgeModel } from "@/types/knowledge-model";
import type { FlowModel } from "@/types/flow";
import type { JourneyModel } from "@/types/journey";
import type { WorldModel } from "@/types/world-model";
import type { AnalyzeStage } from "@/types/analyze-events";

/**
 * The ONE deterministic analysis pipeline (docs/WORLD_ARCHITECTURE.md
 * "Do not duplicate the analysis pipeline"). Extracted verbatim from what
 * used to be `/api/analyze`'s only caller so both entry points — the
 * browser's manual "paste a GitHub URL" flow (src/server/api-handlers/
 * analyze.ts, which wants fine-grained streamed progress) and Bob's
 * `analyze_repository` MCP tool (src/server/bob-tools/analysisTools.ts,
 * which just wants the final result) — run the exact same code, never two
 * analysis systems.
 *
 * `knowledgeModelStore` is kept as a same-process fetch-avoidance cache
 * (skip the tarball download+re-analysis if this exact commit was already
 * analyzed by THIS warm instance) — a pure optimization, not the source of
 * truth for "does this analysis exist": that's now `worldStore`
 * (src/server/world/worldStore.ts), which every caller here also ends up
 * writing to when it creates a World from the result.
 */
export interface AnalysisPipelineHooks {
  onStageStart?: (stage: AnalyzeStage) => void;
  onStageDone?: (stage: AnalyzeStage, detail: Record<string, number>) => void;
}

export interface AnalysisPipelineResult {
  knowledgeModel: RepositoryKnowledgeModel;
  flowModel: FlowModel;
  journeyModel: JourneyModel;
  worldModel: WorldModel;
  cached: boolean;
}

export async function runAnalysisPipeline(owner: string, repo: string, hooks: AnalysisPipelineHooks = {}): Promise<AnalysisPipelineResult> {
  const { onStageStart, onStageDone } = hooks;
  let cleanup: (() => Promise<void>) | undefined;

  try {
    onStageStart?.("fetch");

    // Resolve the commit SHA with two cheap metadata calls FIRST, and check
    // the cache before paying for the tarball download+extract — a cache
    // hit still needs to cost less than a miss even on a large repo.
    const meta = await fetchRepoMeta(owner, repo);
    const repositoryId = `${owner}/${repo}`;
    const cachedEarly = await knowledgeModelStore.get(repositoryId, meta.headCommitSha);
    if (cachedEarly) {
      onStageDone?.("fetch", { fileCount: cachedEarly.files.length });
      const cachedFlowModel = inferFlows(cachedEarly);
      return {
        knowledgeModel: cachedEarly,
        worldModel: buildWorldModel(cachedEarly),
        flowModel: cachedFlowModel,
        journeyModel: inferJourneys(cachedEarly, cachedFlowModel),
        cached: true,
      };
    }

    const { snapshot, cleanup: cleanupFn } = await buildRepositorySnapshot(owner, repo, meta);
    cleanup = cleanupFn;
    onStageDone?.("fetch", { fileCount: snapshot.files.length });

    // One dependency analyzer per language, all producing the same edge
    // shape (merged in knowledge-model/builder.ts). Each skips itself via
    // `supports()` when the repo has no files in its language, so e.g. a
    // JS-only repo doesn't pay for the other eight scans.
    const registry = new AnalyzerRegistry();
    registry.register(structureAnalyzer);
    registry.register(dependencyAnalyzer);
    registry.register(pythonDependencyAnalyzer);
    registry.register(rustDependencyAnalyzer);
    registry.register(goDependencyAnalyzer);
    registry.register(javaDependencyAnalyzer);
    registry.register(cFamilyDependencyAnalyzer);
    registry.register(csharpDependencyAnalyzer);
    registry.register(rubyDependencyAnalyzer);
    registry.register(phpDependencyAnalyzer);
    registry.register(securityAnalyzer);
    registry.register(entryPointAnalyzer);
    registry.register(frontendCallAnalyzer);

    onStageStart?.("structure");
    onStageStart?.("dependency");
    onStageStart?.("entrypoints");
    const runSummary = await runAnalyzers(snapshot, registry, {
      onAnalyzerStart: (id) => {
        if (id === "structure-analyzer") onStageStart?.("structure");
        if (id === "dependency-analyzer") onStageStart?.("dependency");
        if (id === "entry-point-analyzer") onStageStart?.("entrypoints");
      },
      onAnalyzerDone: (id, result) => {
        if (id === "structure-analyzer") {
          const data = result.data as StructureAnalyzerOutput;
          onStageDone?.("structure", { fileCount: data.files.length, moduleCount: data.modules.length });
        }
        if (id === "entry-point-analyzer") {
          const data = result.data as EntryPointAnalyzerOutput;
          onStageDone?.("entrypoints", { entryPointCount: data.entryPoints.length });
        }
      },
    });

    const knowledgeModel: RepositoryKnowledgeModel = buildKnowledgeModel(snapshot, runSummary);
    await knowledgeModelStore.set(knowledgeModel);

    // Read back off the already-built model, so "dependency" always
    // completes exactly once with the true combined count regardless of
    // which language-specific analyzers actually ran.
    onStageDone?.("dependency", { edgeCount: knowledgeModel.dependencies.length });

    onStageStart?.("model");
    onStageDone?.("model", { fileCount: knowledgeModel.files.length, moduleCount: knowledgeModel.modules.length });

    // Repository Knowledge Model -> Flow Inference -> World Model — flows
    // are derived from the finished RKM only (real entry points + real
    // dependency edges), never from raw source, never a runtime trace.
    onStageStart?.("flows");
    const flowModel = inferFlows(knowledgeModel);
    const journeyModel = inferJourneys(knowledgeModel, flowModel);
    onStageDone?.("flows", { flowCount: flowModel.flows.length, journeyCount: journeyModel.journeys.length });

    onStageStart?.("world");
    const worldModel = buildWorldModel(knowledgeModel);
    onStageDone?.("world", { regionCount: worldModel.regions.length, landmarkCount: worldModel.landmarks.length });

    return { knowledgeModel, flowModel, journeyModel, worldModel, cached: false };
  } finally {
    if (cleanup) await cleanup();
  }
}
