import { z } from "zod";
import { ConfidenceLevelSchema } from "./flow";

/**
 * A FeaturePlan is fundamentally different from Flow/Journey: those are
 * STATICALLY RECONSTRUCTED from real code that already exists. A FeaturePlan
 * is `ai-interpreted` (see ProvenanceSchema, src/types/knowledge-model.ts) —
 * the agent reasoning about a feature that does NOT exist yet, grounded against
 * the real Repository Knowledge Model but never claiming to be a fact.
 *
 * The one hard invariant carried over from Flow/Journey: any reference to
 * something that's supposed to be REAL (an `existing`-status step's
 * filePath, a modifiedFiles entry, an impactedEntities id) is validated
 * against the actual RepositoryKnowledgeModel/Architecture graph before
 * this ever reaches the client — see
 * src/server/plan/validateFeaturePlan.ts's `validateFeaturePlan`. A
 * hallucinated reference is dropped, not silently trusted. `new`-status
 * steps and `newFiles` are proposals by definition — nothing to validate,
 * they don't exist yet.
 */

export const FeaturePlanStepKindSchema = z.enum([
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

export const FeaturePlanStepSchema = z.object({
  id: z.string(),
  kind: FeaturePlanStepKindSchema,
  label: z.string(),
  status: z.enum(["new", "existing"]),
  /** A real FileFact.id when status is "existing" (validated); a suggested, not-yet-real path when "new". */
  filePath: z.string(),
  explanation: z.string(),
});

export const ImpactedEntitySchema = z.object({
  kind: z.enum(["domain", "infra"]),
  /** A real Domain.id or InfraNode.id from the current Architecture graph — validated. */
  id: z.string(),
  name: z.string(),
  reason: z.string(),
});

export const NewFileSchema = z.object({ suggestedPath: z.string(), purpose: z.string() });
export const ModifiedFileSchema = z.object({
  /** A real FileFact.id — validated. */
  filePath: z.string(),
  reason: z.string(),
});

export const FeaturePlanSchema = z.object({
  id: z.string(),
  /** The user's own request, echoed back verbatim. */
  description: z.string(),
  name: z.string(),
  summary: z.string(),
  confidence: ConfidenceLevelSchema,
  steps: z.array(FeaturePlanStepSchema),
  impactedEntities: z.array(ImpactedEntitySchema),
  newFiles: z.array(NewFileSchema),
  modifiedFiles: z.array(ModifiedFileSchema),
  /** Disclosure of anything dropped during validation (a hallucinated file/entity reference) — never silent. */
  evidence: z.array(z.string()),
  generatedAt: z.string(),
});

export type FeaturePlanStepKind = z.infer<typeof FeaturePlanStepKindSchema>;
export type FeaturePlanStep = z.infer<typeof FeaturePlanStepSchema>;
export type ImpactedEntity = z.infer<typeof ImpactedEntitySchema>;
export type NewFile = z.infer<typeof NewFileSchema>;
export type ModifiedFile = z.infer<typeof ModifiedFileSchema>;
export type FeaturePlan = z.infer<typeof FeaturePlanSchema>;
