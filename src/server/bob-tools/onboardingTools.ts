import type { OnboardingJourney, OnboardingStep } from "@/types/onboarding";
import { resolveWorld } from "./resolveRepository";
import { findModule } from "./moduleLookup";
import { InvalidToolArgumentsError, EntityNotFoundError } from "./errors";
import { onboardingJourneyStore } from "@/server/bob/onboardingJourneyStore";
import { bobEventBus } from "@/server/bob/eventBus";
import type { WorldAction } from "@/types/bob-events";

/**
 * The onboarding-journey capability (docs/BOB_INTEGRATION.md §"Onboarding
 * journeys"). This is Bob's second write path into the world, alongside
 * `contribute_domain_concept` — see domainConceptTools.ts, which this file
 * deliberately mirrors in shape and invariant. It exists to satisfy a
 * distinct use case a domain concept can't: an ORDERED, narrated sequence
 * ("first look at X, then Y, then Z, because...") that CodeBiome's world can
 * walk a developer through, exactly like the existing deterministic Flow
 * walkthrough, but authored by Bob's own judgment about what a newcomer
 * should see first — not reconstructed from a single entry point's call
 * chain.
 *
 * Same hard invariant as every other tool in this project: every step's
 * `moduleId` must already exist in the deterministic RKM, checked BEFORE
 * anything is stored or published. Bob cannot invent a module to walk a
 * developer to.
 *
 * Journeys are stored and published per-World, not per-repository
 * (docs/WORLD_ARCHITECTURE.md) — two Worlds analyzed from the same
 * repository never share onboarding journeys.
 */

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function publishWorldAction(worldId: string, repositoryId: string, action: WorldAction, tool: string, args: Record<string, unknown>, summary: string) {
  const at = new Date().toISOString();
  bobEventBus.publish({ kind: "world-action", worldId, repositoryId, action, at });
  bobEventBus.publish({ kind: "activity", worldId, repositoryId, tool, args, summary, at });
}

export interface CreateOnboardingJourneyResult {
  ok: true;
  journey: OnboardingJourney;
}

export async function createOnboardingJourney(args: {
  title: string;
  goal: string;
  steps: { moduleId: string; reason: string }[];
  confidence: number;
  worldId?: string;
  owner?: string;
  repo?: string;
}): Promise<CreateOnboardingJourneyResult> {
  if (!args.title.trim()) throw new InvalidToolArgumentsError("title must not be empty.");
  if (!args.goal.trim()) throw new InvalidToolArgumentsError("goal must not be empty.");
  if (!Array.isArray(args.steps) || args.steps.length === 0) {
    throw new InvalidToolArgumentsError("steps must include at least one real module — an onboarding journey must point somewhere concrete.");
  }
  for (const step of args.steps) {
    if (!step.reason || !step.reason.trim()) {
      throw new InvalidToolArgumentsError("every step must include a non-empty reason — why this module matters for this journey.");
    }
  }
  if (!(args.confidence >= 0 && args.confidence <= 1)) {
    throw new InvalidToolArgumentsError("confidence must be a number between 0 and 1.");
  }

  const { world, knowledgeModel: model } = await resolveWorld(args);

  // Hard invariant: every step's moduleId must already exist in the
  // deterministic model. findModule throws EntityNotFoundError on the
  // first fake one — no journey is stored until every step checks out.
  const steps: OnboardingStep[] = args.steps.map((s, index) => {
    const mod = findModule(model, s.moduleId);
    return { order: index, moduleId: mod.id, moduleName: mod.name, reason: s.reason.trim() };
  });

  const journey: OnboardingJourney = {
    id: `journey-${randomId()}`,
    title: args.title.trim(),
    goal: args.goal.trim(),
    steps,
    provenance: { source: "ai-interpreted", confidence: args.confidence, generatedBy: "bob", modelVersion: "ibm-bob-2.0" },
    createdAt: new Date().toISOString(),
  };

  await onboardingJourneyStore.add(world.id, journey);
  const at = new Date().toISOString();
  bobEventBus.publish({ kind: "onboarding-journey", worldId: world.id, repositoryId: model.meta.repositoryId, journey, at });
  bobEventBus.publish({
    kind: "activity",
    worldId: world.id,
    repositoryId: model.meta.repositoryId,
    tool: "create_onboarding_journey",
    args,
    summary: `Created onboarding journey "${journey.title}" (${steps.length} step(s))`,
    at,
  });

  // The world reacts immediately, the same way start_flow does: focus the
  // first landmark. Bob (or the developer, from the panel) drives later
  // steps with advance_onboarding_step / the UI's own Continue button.
  const first = steps[0];
  publishWorldAction(
    world.id,
    model.meta.repositoryId,
    { type: "focus_onboarding_step", journeyId: journey.id, journeyName: journey.title, stepIndex: 0, moduleId: first.moduleId, moduleName: first.moduleName, reason: first.reason },
    "create_onboarding_journey",
    args,
    `Focused step 1/${steps.length} of onboarding journey "${journey.title}": ${first.moduleName}`
  );

  return { ok: true, journey };
}

export interface ListOnboardingJourneysResult {
  journeys: OnboardingJourney[];
  disclosure: string;
}

export async function listOnboardingJourneys(args: { worldId?: string; owner?: string; repo?: string }): Promise<ListOnboardingJourneysResult> {
  const { world } = await resolveWorld(args);
  return {
    journeys: await onboardingJourneyStore.list(world.id),
    disclosure:
      "These are AI-interpreted onboarding journeys a Bob session previously created via create_onboarding_journey — the step order and reasons are Bob's own interpretation; every moduleId referenced is a real, verified module in this repository's analysis.",
  };
}

export async function advanceOnboardingStep(args: { journeyId: string; stepIndex: number; worldId?: string; owner?: string; repo?: string }) {
  const { world, knowledgeModel: model } = await resolveWorld(args);
  const journey = await onboardingJourneyStore.find(world.id, args.journeyId);
  if (!journey) throw new EntityNotFoundError("onboarding journey", args.journeyId);
  if (!Number.isInteger(args.stepIndex) || args.stepIndex < 0 || args.stepIndex >= journey.steps.length) {
    throw new InvalidToolArgumentsError(
      `stepIndex must be an integer between 0 and ${journey.steps.length - 1} for journey "${journey.title}" (it has ${journey.steps.length} steps).`
    );
  }

  const step = journey.steps[args.stepIndex];
  publishWorldAction(
    world.id,
    model.meta.repositoryId,
    { type: "focus_onboarding_step", journeyId: journey.id, journeyName: journey.title, stepIndex: args.stepIndex, moduleId: step.moduleId, moduleName: step.moduleName, reason: step.reason },
    "advance_onboarding_step",
    args,
    `Focused step ${args.stepIndex + 1}/${journey.steps.length} of onboarding journey "${journey.title}": ${step.moduleName}`
  );

  return { ok: true, journeyId: journey.id, stepIndex: args.stepIndex, step };
}
