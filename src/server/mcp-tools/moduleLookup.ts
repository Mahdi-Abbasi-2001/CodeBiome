import type { ModuleFact, RepositoryKnowledgeModel } from "@/types/knowledge-model";
import { EntityNotFoundError } from "./errors";

/**
 * the agent knows module names/paths from conversation, not CodeBiome's internal
 * ids — so lookups try an exact id match first (what every internal caller
 * uses) and fall back to a case-insensitive name or path match before
 * failing. Never fuzzy/similarity matching: a wrong guess must fail loudly
 * (EntityNotFoundError) rather than silently resolve to the wrong module.
 */
export function findModule(model: RepositoryKnowledgeModel, moduleIdOrName: string): ModuleFact {
  const byId = model.modules.find((m) => m.id === moduleIdOrName);
  if (byId) return byId;

  const needle = moduleIdOrName.toLowerCase();
  const byName = model.modules.find((m) => m.name.toLowerCase() === needle || m.path.toLowerCase() === needle);
  if (byName) return byName;

  throw new EntityNotFoundError("module", moduleIdOrName);
}

export function moduleRef(mod: ModuleFact): { id: string; name: string } {
  return { id: mod.id, name: mod.name };
}
