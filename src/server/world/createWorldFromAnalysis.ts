import { worldStore } from "./worldStore";
import { worldUrl } from "./baseUrl";
import type { AnalysisPipelineResult } from "@/server/analysis/runAnalysisPipeline";
import type { WorldRecord } from "@/types/world";

/**
 * Shared by both entry points that can produce a World (browser-first
 * manual analysis and Bob-first `analyze_repository`) — see
 * docs/WORLD_ARCHITECTURE.md. Always creates a NEW World, even for a
 * cache-hit analysis of an already-seen commit: a World represents one
 * analysis *visit*, not one commit — the same repository analyzed twice
 * deliberately produces two independent, isolated Worlds.
 */
export async function createWorldFromAnalysis(
  owner: string,
  repo: string,
  result: AnalysisPipelineResult
): Promise<{ world: WorldRecord; url: string }> {
  const world = await worldStore.createWorld({
    repositoryUrl: `https://github.com/${owner}/${repo}`,
    repositoryId: `${owner}/${repo}`,
    commitSha: result.knowledgeModel.meta.commitSha,
    snapshot: { knowledgeModel: result.knowledgeModel, flowModel: result.flowModel, worldModel: result.worldModel },
  });
  return { world, url: worldUrl(world.id) };
}
