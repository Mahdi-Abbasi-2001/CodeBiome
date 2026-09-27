import type { RepositoryKnowledgeModel } from "@/types/knowledge-model";
import type { WorldModel } from "@/types/world-model";
import { computeDomains } from "@/lib/domains";
import { computeInfrastructureNodes } from "@/lib/infrastructure";
import { FeaturePlanSchema, type FeaturePlan } from "@/types/featurePlan";

/**
 * The safety net every agent-facing write tool in this codebase applies
 * (see contribute_domain_concept, create_onboarding_journey): a FeaturePlan
 * is `ai-interpreted` (ProvenanceSchema, src/types/knowledge-model.ts) —
 * the agent's own reasoning about a feature that doesn't exist yet, generated in
 * the agent's own session (src/server/bob-tools/planTools.ts's
 * `propose_feature_plan`), never by this app calling an LLM itself.
 *
 * The non-negotiable rule carried over from every deterministic module in
 * this codebase: nothing claiming to be REAL reaches storage unverified.
 * `validateFeaturePlan` cross-checks every `existing`-status step, every
 * `modifiedFiles` entry, and every `impactedEntities` reference against the
 * actual analyzed repository — a hallucinated reference is downgraded or
 * dropped, never silently trusted, and always disclosed in `evidence`.
 */

export interface DraftPlan {
  name: string;
  summary: string;
  confidence: "high" | "medium" | "low";
  steps: Array<{ kind: string; label: string; status: "new" | "existing"; filePath: string; explanation: string }>;
  impactedEntities: Array<{ kind: "domain" | "infra"; name: string; reason: string }>;
  newFiles: Array<{ suggestedPath: string; purpose: string }>;
  modifiedFiles: Array<{ filePath: string; reason: string }>;
}

const VALID_STEP_KINDS = new Set([
  "page",
  "entry",
  "controller",
  "handler",
  "service",
  "entity",
  "function",
  "repository",
  "database",
  "external-api",
  "event",
  "unknown",
]);
function stepKindOrUnknown(kind: string): FeaturePlan["steps"][number]["kind"] {
  return (VALID_STEP_KINDS.has(kind) ? kind : "unknown") as FeaturePlan["steps"][number]["kind"];
}

export function validateFeaturePlan(
  draft: DraftPlan,
  description: string,
  id: string,
  knowledgeModel: RepositoryKnowledgeModel,
  worldModel: WorldModel
): FeaturePlan {
  const realFileIds = new Set(knowledgeModel.files.map((f) => f.id));
  const domains = computeDomains(worldModel, knowledgeModel);
  const infraNodes = computeInfrastructureNodes(knowledgeModel, domains);
  const domainByName = new Map(domains.filter((d) => !d.isInfra).map((d) => [d.name.toLowerCase(), d]));
  const infraByName = new Map(infraNodes.map((n) => [n.name.toLowerCase(), n]));

  const evidence: string[] = [];
  let downgraded = false;

  const steps = draft.steps.map((s, i) => {
    let status = s.status;
    if (status === "existing" && !realFileIds.has(s.filePath)) {
      status = "new";
      downgraded = true;
      evidence.push(`the agent referenced "${s.filePath}" as an existing file, but it wasn't found in the repository — treated as a new file instead.`);
    }
    return {
      id: `plan-step-${i}`,
      kind: stepKindOrUnknown(s.kind),
      label: s.label,
      status,
      filePath: s.filePath,
      explanation: s.explanation,
    };
  });

  const impactedEntities = draft.impactedEntities
    .map((e) => {
      const match = e.kind === "domain" ? domainByName.get(e.name.toLowerCase()) : infraByName.get(e.name.toLowerCase());
      if (!match) {
        downgraded = true;
        evidence.push(`the agent referenced "${e.name}" as an impacted ${e.kind}, but it wasn't found in the repository — dropped.`);
        return null;
      }
      return { kind: e.kind, id: match.id, name: e.name, reason: e.reason };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  const modifiedFiles = draft.modifiedFiles
    .map((f) => {
      if (!realFileIds.has(f.filePath)) {
        downgraded = true;
        evidence.push(`the agent listed "${f.filePath}" as a file to modify, but it wasn't found in the repository — dropped.`);
        return null;
      }
      return f;
    })
    .filter((f): f is NonNullable<typeof f> => f !== null);

  let confidence = draft.confidence;
  if (downgraded && confidence === "high") confidence = "medium";

  const plan: FeaturePlan = {
    id,
    description,
    name: draft.name,
    summary: draft.summary,
    confidence,
    steps,
    impactedEntities,
    newFiles: draft.newFiles,
    modifiedFiles,
    evidence,
    generatedAt: new Date().toISOString(),
  };

  return FeaturePlanSchema.parse(plan);
}
