import type { RepositoryKnowledgeModel, ModuleFact } from "@/types/knowledge-model";
import type { WorldRecord } from "@/types/world";
import { worldStore } from "@/server/world/worldStore";
import { buildWorldModel } from "@/server/world/builder";
import { resolveWorldId } from "./resolveRepository";
import { EntityNotFoundError } from "./errors";

/**
 * Shared plumbing for every submit_* MCP tool (src/server/mcp-tools/
 * submissionTools.ts). These tools are what replaced the old analyzer
 * pipeline: instead of CodeBiome computing the Repository Knowledge Model
 * itself, a connected agent submits pieces of it, and CodeBiome's only job
 * is to (1) verify every reference against files/modules that really exist
 * in this World's file tree, (2) merge the submission into the World's
 * living knowledge model, and (3) recompute the purely-derived fields
 * (module dependencyIds/dependentIds/centrality, the World Model) that
 * follow mechanically from what's been submitted so far.
 *
 * Same hard invariant every write-back tool in this project already
 * enforces (contribute_domain_concept, create_onboarding_journey): a
 * reference to something that isn't real is rejected, not silently
 * accepted or invented around.
 */

export function requireFile(model: RepositoryKnowledgeModel, fileId: string) {
  const file = model.files.find((f) => f.id === fileId || f.path === fileId);
  if (!file) throw new EntityNotFoundError("file", fileId);
  return file;
}

export function requireModule(model: RepositoryKnowledgeModel, moduleId: string) {
  const mod = model.modules.find((m) => m.id === moduleId || m.name.toLowerCase() === moduleId.toLowerCase() || m.path === moduleId);
  if (!mod) throw new EntityNotFoundError("module", moduleId);
  return mod;
}

/**
 * Recomputes every module's dependencyIds/dependentIds/centrality from the
 * current dependencies[] edges — these are aggregate/derived fields, never
 * something an agent submits directly, so they can't drift out of sync with
 * whatever edges actually exist. Mirrors the aggregation server/world/
 * builder.ts already does for module-level paths.
 */
export function recomputeModuleGraph(model: RepositoryKnowledgeModel): RepositoryKnowledgeModel {
  const fileToModule = new Map<string, string>();
  for (const m of model.modules) for (const fileId of m.fileIds) fileToModule.set(fileId, m.id);

  const dependencyIds = new Map<string, Set<string>>();
  const dependentIds = new Map<string, Set<string>>();
  for (const m of model.modules) {
    dependencyIds.set(m.id, new Set());
    dependentIds.set(m.id, new Set());
  }

  for (const edge of model.dependencies) {
    const fromModuleId = edge.fromKind === "module" ? edge.fromId : fileToModule.get(edge.fromId);
    const toModuleId = edge.toKind === "module" ? edge.toId : edge.toKind === "file" ? fileToModule.get(edge.toId) : null;
    if (!fromModuleId || !toModuleId || fromModuleId === toModuleId) continue;
    if (!dependencyIds.has(fromModuleId) || !dependencyIds.has(toModuleId)) continue;
    dependencyIds.get(fromModuleId)!.add(toModuleId);
    dependentIds.get(toModuleId)!.add(fromModuleId);
  }

  const maxDegree = Math.max(1, ...model.modules.map((m) => (dependencyIds.get(m.id)?.size ?? 0) + (dependentIds.get(m.id)?.size ?? 0)));

  const modules: ModuleFact[] = model.modules.map((m) => {
    const deps = [...(dependencyIds.get(m.id) ?? [])];
    const dependents = [...(dependentIds.get(m.id) ?? [])];
    return {
      ...m,
      dependencyIds: deps,
      dependentIds: dependents,
      centrality: (deps.length + dependents.length) / (2 * maxDegree),
    };
  });

  return { ...model, modules };
}

/**
 * The core of every submit_* tool: resolve the target World, run `merge`
 * against its CURRENT knowledge model (so validation sees everything
 * submitted so far, including in the same conversation a moment ago),
 * recompute the World Model from the result, and persist both atomically
 * via `worldStore.updateSnapshot`'s read-modify-write.
 *
 * `merge` should validate every reference it cares about and throw
 * (EntityNotFoundError/InvalidToolArgumentsError) on the first bad one —
 * nothing is stored until the whole submission checks out, same as
 * contribute_domain_concept/create_onboarding_journey.
 */
export async function submitToKnowledgeModel(
  args: { worldId?: string; owner?: string; repo?: string },
  merge: (model: RepositoryKnowledgeModel) => RepositoryKnowledgeModel
): Promise<{ world: WorldRecord; knowledgeModel: RepositoryKnowledgeModel }> {
  const worldId = await resolveWorldId(args);
  const snapshot = await worldStore.updateSnapshot(worldId, (current) => {
    const merged = recomputeModuleGraph(merge(current.knowledgeModel));
    return { ...current, knowledgeModel: merged, worldModel: buildWorldModel(merged) };
  });
  return { world: snapshot.world, knowledgeModel: snapshot.knowledgeModel };
}

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export { randomId };
