import { buildTestKnowledgeModel } from "./knowledgeModelFixture";
import { createWorldFromAnalysis } from "@/server/world/createWorldFromAnalysis";
import { worldStore } from "@/server/world/worldStore";
import { buildWorldModel } from "@/server/world/builder";
import type { RepositoryKnowledgeModel } from "@/types/knowledge-model";
import type { FlowModel } from "@/types/flow";
import type { JourneyModel } from "@/types/journey";
import type { WorldModel } from "@/types/world-model";
import type { WorldRecord } from "@/types/world";

/**
 * Test-only equivalent of the real `analyze_repository` flow
 * (docs/WORLD_ARCHITECTURE.md): builds a real (fixture-derived, see
 * knowledgeModelFixture.ts) RKM from an in-memory file map, then creates a
 * real World from it via the same `worldStore` every MCP tool resolves
 * against — so a test's `{owner, repo}` or `{worldId}` args resolve exactly
 * the way a real request would.
 *
 * flowModel/journeyModel start empty, same as a real freshly-created World
 * — tests that need a flow/journey present should submit one via
 * submissionTools.submitFlow/submitRequestJourney, exactly like a real agent
 * would, rather than relying on auto-inference (which no longer exists).
 */
export async function seedWorld(
  files: Record<string, string>,
  repoId: { owner: string; repo: string } = { owner: "test", repo: "repo" }
): Promise<{ model: RepositoryKnowledgeModel; flowModel: FlowModel; journeyModel: JourneyModel; worldModel: WorldModel; world: WorldRecord }> {
  const model = await buildTestKnowledgeModel(files, repoId);
  const { world } = await createWorldFromAnalysis(repoId.owner, repoId.repo, model);
  const snapshot = await worldStore.getSnapshot(world.id);
  if (!snapshot) throw new Error("seedWorld: snapshot missing immediately after creation");

  return { model: snapshot.knowledgeModel, flowModel: snapshot.flowModel, journeyModel: snapshot.journeyModel, worldModel: buildWorldModel(snapshot.knowledgeModel), world };
}
