import { resolveWorld } from "./resolveRepository";
import { InvalidToolArgumentsError } from "./errors";
import { featurePlanStore } from "@/server/plan/featurePlanStore";
import { validateFeaturePlan, type DraftPlan } from "@/server/plan/validateFeaturePlan";
import { bobEventBus } from "@/server/bob/eventBus";
import { worldUrl } from "@/server/world/baseUrl";
import type { FeaturePlan } from "@/types/featurePlan";

/**
 * The "Plan" tab's write path (docs/BOB_INTEGRATION.md-style: mirrors
 * contribute_domain_concept/create_onboarding_journey exactly). Bob is the
 * ONLY thing that ever calls `propose_feature_plan` — this app never calls
 * an LLM itself (see src/server/plan/validateFeaturePlan.ts's doc comment).
 * A developer asks Bob, in their own IDE session, "how would I implement
 * X?"; Bob answers there AND calls this tool so the same proposal renders
 * visually in the CodeBiome web app — the returned `url` is what Bob hands
 * the developer to go see it.
 *
 * Unlike contribute_domain_concept/create_onboarding_journey (which reject
 * the ENTIRE call if any single reference is fake), a bad reference here is
 * downgraded or dropped by validateFeaturePlan rather than failing the
 * whole proposal — a feature plan is inherently speculative by nature, and
 * one made-up file shouldn't discard an otherwise-good plan. Every
 * correction is still disclosed in the stored plan's `evidence`, never
 * silent.
 */

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export interface ProposeFeaturePlanResult {
  ok: true;
  plan: FeaturePlan;
  /** Hand this URL to the developer — it opens the CodeBiome Plan tab directly on this proposal. */
  url: string;
}

export async function proposeFeaturePlan(args: {
  description: string;
  name: string;
  summary: string;
  confidence: "high" | "medium" | "low";
  steps: DraftPlan["steps"];
  impactedEntities?: DraftPlan["impactedEntities"];
  newFiles?: DraftPlan["newFiles"];
  modifiedFiles?: DraftPlan["modifiedFiles"];
  worldId?: string;
  owner?: string;
  repo?: string;
}): Promise<ProposeFeaturePlanResult> {
  if (!args.description?.trim()) {
    throw new InvalidToolArgumentsError("description must not be empty — echo back the developer's own feature request verbatim.");
  }
  if (!args.name?.trim()) throw new InvalidToolArgumentsError("name must not be empty.");
  if (!args.summary?.trim()) throw new InvalidToolArgumentsError("summary must not be empty.");
  if (!Array.isArray(args.steps) || args.steps.length === 0) {
    throw new InvalidToolArgumentsError("steps must include at least one step — a feature plan must show a real proposed path, not just a summary.");
  }

  const { world, knowledgeModel, worldModel } = await resolveWorld(args);

  const draft: DraftPlan = {
    name: args.name.trim(),
    summary: args.summary.trim(),
    confidence: args.confidence,
    steps: args.steps,
    impactedEntities: args.impactedEntities ?? [],
    newFiles: args.newFiles ?? [],
    modifiedFiles: args.modifiedFiles ?? [],
  };

  const plan = validateFeaturePlan(draft, args.description.trim(), `plan-${randomId()}`, knowledgeModel, worldModel);

  await featurePlanStore.add(world.id, plan);
  const at = new Date().toISOString();
  bobEventBus.publish({
    kind: "activity",
    worldId: world.id,
    repositoryId: knowledgeModel.meta.repositoryId,
    tool: "propose_feature_plan",
    args,
    summary: `Proposed feature plan "${plan.name}" (${plan.confidence} confidence, ${plan.steps.length} step(s))${plan.evidence.length > 0 ? ` — ${plan.evidence.length} reference(s) corrected` : ""}`,
    at,
  });

  return { ok: true, plan, url: `${worldUrl(world.id)}?lens=plan` };
}

export interface ListFeaturePlansResult {
  plans: FeaturePlan[];
  disclosure: string;
}

export async function listFeaturePlans(args: { worldId?: string; owner?: string; repo?: string }): Promise<ListFeaturePlansResult> {
  const { world } = await resolveWorld(args);
  return {
    plans: await featurePlanStore.list(world.id),
    disclosure:
      "These are AI-interpreted feature implementation plans a Bob session previously proposed via propose_feature_plan — not deterministic facts. Every 'existing' step/file/domain reference has already been verified against the real repository; anything that couldn't be verified was downgraded or dropped before storage.",
  };
}
