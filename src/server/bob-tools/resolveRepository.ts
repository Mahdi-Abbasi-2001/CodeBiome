import type { RepositoryKnowledgeModel } from "@/types/knowledge-model";
import type { FlowModel } from "@/types/flow";
import type { WorldRecord } from "@/types/world";
import { worldStore, WorldNotFoundError } from "@/server/world/worldStore";

export { WorldNotFoundError };

/**
 * Every Bob-facing tool resolves "which World" the same way
 * (docs/WORLD_ARCHITECTURE.md), preferring the most explicit signal
 * available and falling back gracefully:
 *
 *   1. `worldId` — the robust, primary path. Bob gets this from
 *      `analyze_repository`'s own result and threads it through every
 *      subsequent call in the same conversation; a developer who opened a
 *      World's URL and reports "explain this" also has it via
 *      `get_current_context`'s session-context lookup.
 *   2. `owner`/`repo` — backward-compatible convenience: resolves to
 *      whichever World was most recently created for that repository.
 *   3. Neither — resolves to the single most recently created World across
 *      the whole deployment, the common case for a single-developer
 *      hackathon session with one active World.
 *
 * All three paths read through `worldStore` (Blob-backed in production),
 * never a bare in-memory `Map` — this is what makes resolution correct
 * regardless of which Vercel instance handles any given request. See
 * docs/VERCEL_DEPLOYMENT.md §3 for the failure mode this replaces.
 */
export class RepositoryNotAnalyzedError extends Error {
  constructor(owner?: string, repo?: string) {
    super(
      owner && repo
        ? `"${owner}/${repo}" hasn't been analyzed by CodeBiome yet. Call analyze_repository to analyze it, or open it at the CodeBiome web app first.`
        : "No repository has been analyzed by CodeBiome yet. Call analyze_repository to analyze one, or open the CodeBiome web app first."
    );
    this.name = "RepositoryNotAnalyzedError";
  }
}

export async function resolveWorldId(args: { worldId?: string; owner?: string; repo?: string }): Promise<string> {
  if (args.worldId) {
    const world = await worldStore.getWorld(args.worldId);
    if (!world) throw new WorldNotFoundError(args.worldId);
    return world.id;
  }
  if (args.owner && args.repo) {
    const worldId = await worldStore.getLatestWorldIdForRepository(`${args.owner}/${args.repo}`);
    if (!worldId) throw new RepositoryNotAnalyzedError(args.owner, args.repo);
    return worldId;
  }
  const worldId = await worldStore.getMostRecentWorldId();
  if (!worldId) throw new RepositoryNotAnalyzedError();
  return worldId;
}

export async function resolveWorld(args: {
  worldId?: string;
  owner?: string;
  repo?: string;
}): Promise<{ world: WorldRecord; knowledgeModel: RepositoryKnowledgeModel; flowModel: FlowModel }> {
  const worldId = await resolveWorldId(args);
  const snapshot = await worldStore.getSnapshot(worldId);
  // Defensive only — getWorld()/getLatestWorldIdForRepository() already
  // succeeding means the snapshot should exist too; this guards against a
  // corrupted/partial write rather than a normal user-facing case.
  if (!snapshot) throw new WorldNotFoundError(worldId);
  return { world: snapshot.world, knowledgeModel: snapshot.knowledgeModel, flowModel: snapshot.flowModel };
}

/** Back-compat shape most existing tools already call — now backed by World resolution instead of a bare in-memory cache. */
export async function resolveKnowledgeModel(args: { worldId?: string; owner?: string; repo?: string }): Promise<RepositoryKnowledgeModel> {
  const { knowledgeModel } = await resolveWorld(args);
  return knowledgeModel;
}

/** Flow inference is stored in the World's immutable snapshot at creation time — read back here, never recomputed per call. */
export async function resolveFlowModel(args: {
  worldId?: string;
  owner?: string;
  repo?: string;
}): Promise<{ knowledgeModel: RepositoryKnowledgeModel; flowModel: FlowModel }> {
  const { knowledgeModel, flowModel } = await resolveWorld(args);
  return { knowledgeModel, flowModel };
}
