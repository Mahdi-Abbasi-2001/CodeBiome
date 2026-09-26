import { z } from "zod";

/**
 * World Model — a deterministic, pure-function mapping of the Repository
 * Knowledge Model into world entities. See docs/REPOSITORY_KNOWLEDGE_MODEL.md
 * §15. Every entity carries `sourceEntityId`/`sourceEntityKind` for
 * traceability back to the fact it represents — the world is a view, not a
 * separate source of truth.
 */

export const WorldEntityTypeSchema = z.enum([
  "biome",
  "region",
  "landmark",
  "object",
  "path",
  "portal",
  "cave",
  "factory",
  "library",
  "training-ground",
  "ruins",
  "gate",
]);

export const VisualStateSchema = z.object({
  healthTier: z.enum(["thriving", "healthy", "stressed", "critical"]),
  environmentTags: z.array(
    z.enum(["fog", "toxic", "dramatic-lighting", "sunlight", "footprints", "warning-indicators"])
  ),
  scale: z.number(),
});

const worldEntityBase = {
  id: z.string(),
  sourceEntityId: z.string(),
  sourceEntityKind: z.enum([
    "repository",
    "module",
    "file",
    "dependency",
    "entryPoint",
    "test",
    "documentation",
    "codeHealth",
    "security",
  ]),
  visualState: VisualStateSchema,
};

export const WorldBiomeSchema = z.object({ ...worldEntityBase, type: z.literal("biome"), name: z.string() });
export const WorldRegionSchema = z.object({
  ...worldEntityBase,
  type: z.literal("region"),
  name: z.string(),
  /** Short, honest label shown in the HUD/panel — e.g. "core domain", "database". */
  label: z.string().nullable(),
});
/**
 * Landmarks cover every point-entity type from the world-mapping table
 * (§15 of REPOSITORY_KNOWLEDGE_MODEL.md) except region/biome/path. The
 * concrete type is decided deterministically in the World Model builder
 * from real RKM facts (module naming, test/doc detection, risk indicators,
 * dependency graph shape) — never inferred by the renderer.
 */
export const WorldLandmarkTypeSchema = z.enum([
  "landmark",
  "cave",
  "portal",
  "library",
  "training-ground",
  "ruins",
  "gate",
  "factory",
]);
export const WorldLandmarkSchema = z.object({
  ...worldEntityBase,
  type: WorldLandmarkTypeSchema,
  name: z.string(),
  label: z.string().nullable(),
});
export const WorldPathSchema = z.object({
  ...worldEntityBase,
  type: z.literal("path"),
  fromLandmarkId: z.string(),
  toLandmarkId: z.string(),
  /** Both modules depend on each other — a real, computed graph-cycle signal. */
  cyclic: z.boolean(),
  /**
   * The underlying dependency edges' confidence (1.0 for a language-defined
   * resolution like a JS relative import or Rust `mod x;`, lower for a
   * heuristic suffix-match like a bare Rust `use` or PHP PSR-4 namespace).
   * Averaged when several file-level edges collapse into one module-level
   * path. Previously computed by every analyzer and never read by anything
   * downstream — now it visibly dims lower-confidence paths in the world.
   */
  confidence: z.number(),
});

export const WorldModelSchema = z.object({
  meta: z.object({ repositoryKnowledgeModelId: z.string(), generatedAt: z.string() }),
  biome: WorldBiomeSchema,
  regions: z.array(WorldRegionSchema),
  landmarks: z.array(WorldLandmarkSchema),
  paths: z.array(WorldPathSchema),
});

export type WorldModel = z.infer<typeof WorldModelSchema>;
export type WorldBiome = z.infer<typeof WorldBiomeSchema>;
export type WorldRegion = z.infer<typeof WorldRegionSchema>;
export type WorldLandmark = z.infer<typeof WorldLandmarkSchema>;
export type WorldPath = z.infer<typeof WorldPathSchema>;
export type VisualState = z.infer<typeof VisualStateSchema>;
