import { worldStore } from "./worldStore";
import { worldUrl } from "./baseUrl";
import { buildWorldModel } from "./builder";
import type { RepositoryKnowledgeModel } from "@/types/knowledge-model";
import type { FlowModel } from "@/types/flow";
import type { JourneyModel } from "@/types/journey";
import type { WorldRecord } from "@/types/world";

/**
 * Shared by both entry points that can produce a World (browser-first
 * ingestion and the agent-first `analyze_repository` MCP tool) — see
 * docs/WORLD_ARCHITECTURE.md. Always creates a NEW World, even for a
 * repeated ingest of the same repository: a World represents one analysis
 * *visit*, not one commit — the same repository ingested twice deliberately
 * produces two independent, isolated Worlds.
 *
 * `knowledgeModel` here is the SEEDED model (file tree only, no modules/
 * dependencies/etc. yet — see src/server/ingestion/seedKnowledgeModel.ts),
 * not a fully-analyzed one: everything beyond the file tree is filled in
 * later, incrementally, by a connected agent's submit_* tool calls.
 */
export async function createWorldFromAnalysis(
  owner: string,
  repo: string,
  knowledgeModel: RepositoryKnowledgeModel
): Promise<{ world: WorldRecord; url: string }> {
  const emptyFlowModel: FlowModel = { meta: { repositoryKnowledgeModelId: knowledgeModel.meta.repositoryId, generatedAt: knowledgeModel.meta.generatedAt }, flows: [] };
  const emptyJourneyModel: JourneyModel = { meta: { repositoryKnowledgeModelId: knowledgeModel.meta.repositoryId, generatedAt: knowledgeModel.meta.generatedAt }, journeys: [] };

  const world = await worldStore.createWorld({
    repositoryUrl: `https://github.com/${owner}/${repo}`,
    repositoryId: `${owner}/${repo}`,
    commitSha: knowledgeModel.meta.commitSha,
    snapshot: {
      knowledgeModel,
      flowModel: emptyFlowModel,
      journeyModel: emptyJourneyModel,
      worldModel: buildWorldModel(knowledgeModel),
    },
  });
  return { world, url: worldUrl(world.id) };
}
