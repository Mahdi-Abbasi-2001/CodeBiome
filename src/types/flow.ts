import { z } from "zod";

/**
 * Feature/Flow Walkthroughs (Step 5). A Flow is a STATICALLY RECONSTRUCTED
 * execution path — never a runtime trace. CodeBiome never executes the
 * analyzed repository; every step here is a real file connected to the next
 * by a real dependency edge already present in the Repository Knowledge
 * Model. Always describe these to the user as "inferred flow" /
 * "statically reconstructed flow" / "likely execution path" — never as
 * something CodeBiome observed running.
 *
 * Deliberately a separate derived artifact from the RKM, not a field on it —
 * same relationship WorldModel already has to the RKM (see
 * docs/REPOSITORY_KNOWLEDGE_MODEL.md §15 and server/world/builder.ts):
 *
 *   RepositoryKnowledgeModel -> Flow Inference -> FlowModel -> World Model
 *
 * `RepositoryKnowledgeModel.dataFlows` (already in the schema, always empty)
 * stays reserved for a possible future LOWER-level deterministic trace
 * concept; it is intentionally left untouched by this feature rather than
 * overloaded with a second, richer shape.
 */

export const FlowStepKindSchema = z.enum([
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

export const ConfidenceLevelSchema = z.enum(["high", "medium", "low"]);

export const FlowStepSchema = z.object({
  id: z.string(),
  /** A real FileFact.id — the hard invariant: this must exist in the RKM. */
  entityId: z.string(),
  /** The module this file belongs to, for world-highlighting/camera focus (regions/landmarks are module-granularity). */
  moduleId: z.string().nullable(),
  kind: FlowStepKindSchema,
  label: z.string(),
  filePath: z.string(),
  /** Best-effort — derived from the filename, or (for the entry step) a light content pattern. Never claimed as verified AST-level symbol resolution. */
  symbol: z.string().nullable(),
  /** A deterministic, template-built sentence — never AI-generated. */
  explanation: z.string(),
  evidence: z.array(z.string()),
  confidence: ConfidenceLevelSchema,
  nextStepIds: z.array(z.string()),
});

export const FlowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  confidence: ConfidenceLevelSchema,
  entryPointId: z.string(), // = steps[0].id
  steps: z.array(FlowStepSchema),
  evidence: z.array(z.string()),
});

export const FlowModelSchema = z.object({
  meta: z.object({ repositoryKnowledgeModelId: z.string(), generatedAt: z.string() }),
  flows: z.array(FlowSchema),
});

export type FlowStepKind = z.infer<typeof FlowStepKindSchema>;
export type ConfidenceLevel = z.infer<typeof ConfidenceLevelSchema>;
export type FlowStep = z.infer<typeof FlowStepSchema>;
export type Flow = z.infer<typeof FlowSchema>;
export type FlowModel = z.infer<typeof FlowModelSchema>;
