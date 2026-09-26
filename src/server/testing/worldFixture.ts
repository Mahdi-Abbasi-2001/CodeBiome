import { buildTestKnowledgeModel } from "./knowledgeModelFixture";
import { knowledgeModelStore } from "@/server/knowledge-model/store";
import { worldStore } from "@/server/world/worldStore";
import { inferFlows } from "@/server/flows/inferFlows";
import { buildWorldModel } from "@/server/world/builder";
import type { RepositoryKnowledgeModel } from "@/types/knowledge-model";
import type { FlowModel } from "@/types/flow";
import type { WorldModel } from "@/types/world-model";
import type { WorldRecord } from "@/types/world";

/**
 * Test-only equivalent of the real `analyze_repository` / manual-analyze
 * flow (docs/WORLD_ARCHITECTURE.md): builds a real RKM from an in-memory
 * file map (no network), then creates a real World from it via the same
 * `worldStore` every bob-tool resolves against — so a test's `{owner,
 * repo}` or `{worldId}` args resolve exactly the way a real request would,
 * whether the World store backing them is the in-memory test implementation
 * or (in production) Vercel Blob.
 */
export async function seedWorld(
  files: Record<string, string>,
  repoId: { owner: string; repo: string } = { owner: "test", repo: "repo" }
): Promise<{ model: RepositoryKnowledgeModel; flowModel: FlowModel; worldModel: WorldModel; world: WorldRecord }> {
  const model = await buildTestKnowledgeModel(files, repoId);
  await knowledgeModelStore.set(model);

  const flowModel = inferFlows(model);
  const worldModel = buildWorldModel(model);
  const world = await worldStore.createWorld({
    repositoryUrl: `https://github.com/${repoId.owner}/${repoId.repo}`,
    repositoryId: `${repoId.owner}/${repoId.repo}`,
    commitSha: model.meta.commitSha,
    snapshot: { knowledgeModel: model, flowModel, worldModel },
  });

  return { model, flowModel, worldModel, world };
}
