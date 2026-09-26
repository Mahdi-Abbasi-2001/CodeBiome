import type { DomainConcept } from "@/types/knowledge-model";
import { worldStore } from "@/server/world/worldStore";

/**
 * The AI-interpretation layer, made real. `RepositoryKnowledgeModel.
 * domainConcepts` was reserved from the very first version of the schema
 * (see docs/REPOSITORY_KNOWLEDGE_MODEL.md, `ProvenanceSchema`'s
 * `ai-interpreted` branch) for exactly this: a set of AI-derived groupings
 * layered ON TOP of the deterministic facts, never replacing them.
 *
 * Deliberately NOT written back into a World's immutable WorldSnapshot —
 * that object is the deterministic record from the moment analysis
 * finished, and mutating it in place would blur the "layer 3 is the
 * contract" rule from docs/ARCHITECTURE.md. Instead this is a thin wrapper
 * over `worldStore`'s mutable state, keyed by World id
 * (docs/WORLD_ARCHITECTURE.md) — not repositoryId, so two Worlds for the
 * same repository never share contributed concepts.
 */
class DomainConceptStore {
  async list(worldId: string): Promise<DomainConcept[]> {
    const state = await worldStore.getMutableState(worldId);
    return state.domainConcepts;
  }

  async add(worldId: string, concept: DomainConcept): Promise<void> {
    await worldStore.updateMutableState(worldId, (state) => ({
      ...state,
      domainConcepts: [...state.domainConcepts, concept],
    }));
  }
}

export const domainConceptStore = new DomainConceptStore();
