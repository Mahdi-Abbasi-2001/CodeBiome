import type { RepositoryKnowledgeModel } from "@/types/knowledge-model";
import type { FlowModel } from "@/types/flow";
import type { WorldModel } from "@/types/world-model";
import type { WorldRecord } from "@/types/world";
import { worldStore, WorldNotFoundError } from "@/server/world/worldStore";

export { WorldNotFoundError };

/**
 * Every agent-facing tool resolves "which World" the same way
 * (docs/WORLD_ARCHITECTURE.md), preferring the most explicit signal
 * available and failing loudly rather than guessing across connections:
 *
 *   1. `worldId` — the robust, primary path. The agent gets this from
 *      `analyze_repository`'s own result and threads it through every
 *      subsequent call in the same conversation; a developer who opened a
 *      World's URL and reports "explain this" also has it via
 *      `get_current_context`'s session-context lookup.
 *   2. `owner`/`repo` — backward-compatible convenience: resolves to
 *      whichever World was most recently created for that repository.
 *   3. `defaultWorldId` — a per-MCP-connection default (derived from that
 *      connection's own request, e.g. `?worldId=`), never shared globally.
 *   4. None of the above resolves anything: throws `MissingWorldIdError`
 *      rather than silently guessing "whichever World was most recently
 *      created across the whole deployment" — that old behavior let two
 *      different agents/developers hitting the same deployed instance
 *      collide on each other's World.
 *
 * All paths read through `worldStore` (Blob-backed in production), never a
 * bare in-memory `Map` — this is what makes resolution correct regardless of
 * which Vercel instance handles any given request. See
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

/**
 * Thrown when a tool call gives no way at all to identify a World: no
 * explicit `worldId`, no `owner`/`repo`, and no connection-scoped default
 * either. Replaces the old "fall back to whichever World was most recently
 * created across the whole deployment" behavior, which silently collided
 * two different agents/users pointed at the same deployed instance
 * (docs/WORLD_ARCHITECTURE.md §4).
 */
export class MissingWorldIdError extends Error {
  constructor() {
    super(
      "No worldId was given, no owner/repo was given, and this connection has no default World configured. Call analyze_repository first and use its worldId in every subsequent call, or pass owner/repo."
    );
    this.name = "MissingWorldIdError";
  }
}

type WorldRefArgs = { worldId?: string; owner?: string; repo?: string };

/**
 * `defaultWorldId` is threaded in per MCP connection (from the request's own
 * `?worldId=` query param or header — see src/server/api-handlers/mcp.ts),
 * never read from shared/global state. This is what makes two different
 * agents/developers hitting the same deployed CodeBiome instance resolve
 * independently instead of colliding on "whichever World was most recent."
 */
export async function resolveWorldId(args: WorldRefArgs, defaultWorldId?: string): Promise<string> {
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
  if (defaultWorldId) return defaultWorldId;
  throw new MissingWorldIdError();
}

export async function resolveWorld(
  args: WorldRefArgs,
  defaultWorldId?: string
): Promise<{ world: WorldRecord; knowledgeModel: RepositoryKnowledgeModel; flowModel: FlowModel; worldModel: WorldModel }> {
  const worldId = await resolveWorldId(args, defaultWorldId);
  const snapshot = await worldStore.getSnapshot(worldId);
  // Defensive only — getWorld()/getLatestWorldIdForRepository() already
  // succeeding means the snapshot should exist too; this guards against a
  // corrupted/partial write rather than a normal user-facing case.
  if (!snapshot) throw new WorldNotFoundError(worldId);
  return { world: snapshot.world, knowledgeModel: snapshot.knowledgeModel, flowModel: snapshot.flowModel, worldModel: snapshot.worldModel };
}

/** Back-compat shape most existing tools already call — now backed by World resolution instead of a bare in-memory cache. */
export async function resolveKnowledgeModel(args: WorldRefArgs, defaultWorldId?: string): Promise<RepositoryKnowledgeModel> {
  const { knowledgeModel } = await resolveWorld(args, defaultWorldId);
  return knowledgeModel;
}

/** flowModel is read straight off the current snapshot — mutable now (grown by submit_flow), never recomputed here. */
export async function resolveFlowModel(
  args: WorldRefArgs,
  defaultWorldId?: string
): Promise<{ knowledgeModel: RepositoryKnowledgeModel; flowModel: FlowModel }> {
  const { knowledgeModel, flowModel } = await resolveWorld(args, defaultWorldId);
  return { knowledgeModel, flowModel };
}
