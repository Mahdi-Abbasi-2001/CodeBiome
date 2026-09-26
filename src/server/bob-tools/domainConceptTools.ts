import type { DomainConcept } from "@/types/knowledge-model";
import { resolveWorld } from "./resolveRepository";
import { findModule } from "./moduleLookup";
import { InvalidToolArgumentsError, EntityNotFoundError } from "./errors";
import { domainConceptStore } from "@/server/bob/domainConceptStore";
import { bobEventBus } from "@/server/bob/eventBus";

/**
 * The AI-interpretation layer (docs/BOB_INTEGRATION.md §14). Bob is the
 * only thing that ever calls `contribute_domain_concept` — CodeBiome never
 * generates a DomainConcept itself, so there is no path for this layer to
 * exist without a real, connected Bob session having asserted it.
 *
 * Same hard invariant every other tool in this project enforces: every
 * `relatedModuleIds`/`relatedFileIds` entry must already exist in the real
 * RKM, checked BEFORE anything is stored or published. Bob cannot invent a
 * concept that "explains" a module or file that isn't real.
 *
 * Concepts are stored and published per-World, not per-repository
 * (docs/WORLD_ARCHITECTURE.md) — two Worlds analyzed from the same
 * repository never share contributed concepts.
 */

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export interface ContributeDomainConceptResult {
  ok: true;
  concept: DomainConcept;
}

export async function contributeDomainConcept(args: {
  name: string;
  description: string;
  relatedModuleIds: string[];
  relatedFileIds?: string[];
  confidence: number;
  worldId?: string;
  owner?: string;
  repo?: string;
}): Promise<ContributeDomainConceptResult> {
  if (!args.name.trim()) throw new InvalidToolArgumentsError("name must not be empty.");
  if (!args.description.trim()) throw new InvalidToolArgumentsError("description must not be empty.");
  if (args.relatedModuleIds.length === 0) {
    throw new InvalidToolArgumentsError("relatedModuleIds must reference at least one real module — a domain concept must explain something concrete.");
  }
  if (!(args.confidence >= 0 && args.confidence <= 1)) {
    throw new InvalidToolArgumentsError("confidence must be a number between 0 and 1.");
  }

  const { world, knowledgeModel: model } = await resolveWorld(args);

  // Hard invariant: every reference must already exist in the deterministic
  // model. findModule/file-lookup throw EntityNotFoundError on the first
  // fake one — no concept is stored until every reference checks out.
  const resolvedModuleIds = args.relatedModuleIds.map((id) => findModule(model, id).id);
  const fileIds = args.relatedFileIds ?? [];
  for (const fileId of fileIds) {
    const file = model.files.find((f) => f.id === fileId || f.path === fileId);
    if (!file) throw new EntityNotFoundError("file", fileId);
  }
  const resolvedFileIds = fileIds.map((id) => model.files.find((f) => f.id === id || f.path === id)!.id);

  const concept: DomainConcept = {
    id: `concept-${randomId()}`,
    name: args.name.trim(),
    description: args.description.trim(),
    relatedModuleIds: resolvedModuleIds,
    relatedFileIds: resolvedFileIds,
    provenance: {
      source: "ai-interpreted",
      confidence: args.confidence,
      generatedBy: "bob",
      modelVersion: "ibm-bob-2.0",
    },
  };

  await domainConceptStore.add(world.id, concept);
  const at = new Date().toISOString();
  bobEventBus.publish({
    kind: "domain-concept",
    worldId: world.id,
    repositoryId: model.meta.repositoryId,
    concept: {
      id: concept.id,
      name: concept.name,
      description: concept.description,
      relatedModuleIds: concept.relatedModuleIds,
      relatedFileIds: concept.relatedFileIds,
      confidence: args.confidence,
    },
    at,
  });
  bobEventBus.publish({
    kind: "activity",
    worldId: world.id,
    repositoryId: model.meta.repositoryId,
    tool: "contribute_domain_concept",
    args,
    summary: `Contributed concept "${concept.name}" (confidence ${args.confidence.toFixed(2)}, ${resolvedModuleIds.length} module(s))`,
    at,
  });

  return { ok: true, concept };
}

export interface ListDomainConceptsResult {
  concepts: DomainConcept[];
  disclosure: string;
}

export async function listDomainConcepts(args: { worldId?: string; owner?: string; repo?: string }): Promise<ListDomainConceptsResult> {
  const { world } = await resolveWorld(args);
  return {
    concepts: await domainConceptStore.list(world.id),
    disclosure:
      "These are AI-interpreted groupings a Bob session previously contributed via contribute_domain_concept — not deterministic facts. Each carries its own confidence. Check before re-contributing an equivalent concept.",
  };
}
