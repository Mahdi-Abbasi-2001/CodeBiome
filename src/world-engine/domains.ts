import type { WorldModel, WorldRegion } from "@/types/world-model";
import type { RepositoryKnowledgeModel } from "@/types/knowledge-model";

/**
 * The Domain tier of the approved visual hierarchy
 * (Repository -> Domain/Region -> Module/Landmark -> Files -> Code).
 *
 * Deliberately NOT a new field on WorldModel/RepositoryKnowledgeModel: this
 * is a pure, client-side derived grouping of the EXISTING `WorldRegion`s
 * (which already are 1:1 with real `ModuleFact`s), computed on every render
 * from data already fetched. No new analysis, no schema change, no
 * migration risk for already-persisted Worlds in Blob storage — "nothing
 * sits somewhere by accident" is satisfied by grouping on each module's
 * real directory path, not by inventing structure.
 *
 * Grouping rule: a module's domain key is the first path segment that isn't
 * a generic wrapper directory (src/lib/app/source/packages/internal). Two
 * modules with the same key become one multi-module Domain (the case a
 * deeper, nested repository produces); a module with a unique key becomes
 * its own single-module Domain (the common case for a flat repository like
 * this project's own demo target, nestjs-realworld-example-app, where every
 * module already lives directly under `src/`) — an honest reflection of
 * that repository's actual structure, not a limitation of the grouping.
 */

const GENERIC_ROOT_SEGMENTS = new Set(["src", "lib", "app", "source", "packages", "internal"]);

export interface Domain {
  id: string;
  /** Display name — the grouping key, humanized. */
  name: string;
  /** Real ModuleFact ids of every member module. */
  moduleIds: string[];
  /** WorldRegion ids of every member (region ids are `region-<moduleId>`). */
  regionIds: string[];
  /** True only if EVERY member module classified as a test or docs landmark — the slate-blue "infrastructure" treatment. */
  isInfra: boolean;
  /** Worst health tier among members — an aggregate is only as healthy as its weakest module. */
  healthTier: "thriving" | "healthy" | "stressed" | "critical";
  hasRisk: boolean;
  /** Relative size signal (member count + file count) — drives terrace footprint. */
  footprint: number;
  /** Relative importance/centrality signal (max among members) — drives terrace height. */
  height: number;
}

function domainKeyForPath(path: string): string {
  const segments = path.split("/").filter(Boolean);
  let idx = 0;
  while (idx < segments.length - 1 && GENERIC_ROOT_SEGMENTS.has(segments[idx].toLowerCase())) idx++;
  return segments[idx] ?? path;
}

function humanize(key: string): string {
  return key.replace(/[-_]+/g, " ").trim() || key;
}

const HEALTH_RANK: Record<Domain["healthTier"], number> = { critical: 0, stressed: 1, healthy: 2, thriving: 3 };
function worstHealth(a: Domain["healthTier"], b: Domain["healthTier"]): Domain["healthTier"] {
  return HEALTH_RANK[a] <= HEALTH_RANK[b] ? a : b;
}

export function computeDomains(worldModel: WorldModel, knowledgeModel: RepositoryKnowledgeModel): Domain[] {
  const moduleById = new Map(knowledgeModel.modules.map((m) => [m.id, m]));
  const landmarkTypeBySourceId = new Map(
    worldModel.landmarks.filter((l) => l.sourceEntityKind === "module").map((l) => [l.sourceEntityId, l.type])
  );

  const groups = new Map<string, WorldRegion[]>();
  for (const region of worldModel.regions) {
    const mod = moduleById.get(region.sourceEntityId);
    const key = mod ? domainKeyForPath(mod.path) : region.sourceEntityId;
    const list = groups.get(key) ?? [];
    list.push(region);
    groups.set(key, list);
  }

  const domains: Domain[] = [];
  for (const [key, regions] of groups) {
    let healthTier: Domain["healthTier"] = "thriving";
    let hasRisk = false;
    let footprint = 0;
    let height = 0;
    let infraCount = 0;

    for (const region of regions) {
      healthTier = worstHealth(healthTier, region.visualState.healthTier);
      if (region.visualState.environmentTags.includes("warning-indicators")) hasRisk = true;
      const mod = moduleById.get(region.sourceEntityId);
      footprint += 1 + (mod ? mod.fileIds.length : 0) * 0.15;
      height = Math.max(height, region.visualState.scale);
      const landmarkType = landmarkTypeBySourceId.get(region.sourceEntityId);
      if (landmarkType === "training-ground" || landmarkType === "library") infraCount++;
    }

    domains.push({
      id: `domain-${key}`,
      name: humanize(key),
      moduleIds: regions.map((r) => r.sourceEntityId),
      regionIds: regions.map((r) => r.id),
      isInfra: infraCount === regions.length,
      healthTier,
      hasRisk,
      footprint,
      height,
    });
  }

  // Deterministic order: most important (tallest) domains first — the same
  // "give the important thing a stable, central-feeling position" principle
  // layoutDomains() below relies on.
  domains.sort((a, b) => b.height - a.height || a.name.localeCompare(b.name));
  return domains;
}

export function domainForModule(domains: Domain[], moduleId: string): Domain | null {
  return domains.find((d) => d.moduleIds.includes(moduleId)) ?? null;
}

export interface DomainBridge {
  fromDomainId: string;
  toDomainId: string;
  /** Normalized 0..1 against the strongest cross-domain relationship in this repository — "stronger coupling = wider road." */
  weight: number;
  /** Both domains depend on each other, at the module level — a real, computed signal, same meaning as WorldPath.cyclic. */
  cyclic: boolean;
  confidence: number;
}

/**
 * Aggregates the real file-level dependency edges already in the
 * Repository Knowledge Model into one relationship per pair of Domains that
 * are architecturally connected — this is what the Architecture lens
 * overview renders as bridges between terraces, so the world shows "major
 * relationships" without drawing every underlying file edge at once.
 */
export function computeDomainBridges(domains: Domain[], knowledgeModel: RepositoryKnowledgeModel): DomainBridge[] {
  const domainByModuleId = new Map<string, string>();
  for (const d of domains) for (const moduleId of d.moduleIds) domainByModuleId.set(moduleId, d.id);

  const fileToModule = new Map<string, string>();
  for (const m of knowledgeModel.modules) for (const fileId of m.fileIds) fileToModule.set(fileId, m.id);

  const tally = new Map<string, { count: number; confidenceSum: number; forward: boolean; backward: boolean }>();
  for (const edge of knowledgeModel.dependencies) {
    if (edge.fromKind !== "file" || edge.toKind !== "file") continue;
    const fromModule = fileToModule.get(edge.fromId);
    const toModule = fileToModule.get(edge.toId);
    if (!fromModule || !toModule) continue;
    const fromDomain = domainByModuleId.get(fromModule);
    const toDomain = domainByModuleId.get(toModule);
    if (!fromDomain || !toDomain || fromDomain === toDomain) continue;

    const [a, b] = [fromDomain, toDomain].sort();
    const key = `${a}::${b}`;
    const entry = tally.get(key) ?? { count: 0, confidenceSum: 0, forward: false, backward: false };
    entry.count += 1;
    entry.confidenceSum += edge.confidence;
    if (fromDomain === a) entry.forward = true;
    else entry.backward = true;
    tally.set(key, entry);
  }

  const maxCount = Math.max(1, ...[...tally.values()].map((v) => v.count));
  const allBridges: DomainBridge[] = [];
  for (const [key, v] of tally) {
    const [fromDomainId, toDomainId] = key.split("::");
    allBridges.push({
      fromDomainId,
      toDomainId,
      weight: v.count / maxCount,
      cyclic: v.forward && v.backward,
      confidence: v.confidenceSum / v.count,
    });
  }

  // "A bridge should be relatively rare and meaningful" — every cross-domain
  // relationship exists, but the world only builds physical bridges for the
  // architecturally significant ones. Keep the strongest relationships (by
  // real edge count, normalized as `weight`), capped well below "one per
  // domain pair" regardless of repository size, and never a bridge whose
  // underlying signal is weak/incidental.
  const MAX_BRIDGES = Math.max(3, Math.min(5, Math.ceil(domains.length * 0.5)));
  const MIN_BRIDGE_WEIGHT = 0.3;
  return allBridges
    .filter((b) => b.weight >= MIN_BRIDGE_WEIGHT)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_BRIDGES);
}
