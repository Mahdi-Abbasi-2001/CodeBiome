import type { RepositoryKnowledgeModel, ModuleFact } from "@/types/knowledge-model";
import type { WorldModel, WorldRegion, WorldLandmark, WorldPath, VisualState } from "@/types/world-model";

const LANDMARK_IMPORTANCE_THRESHOLD = 0.6;

// Naming heuristics used ONLY here, in the deterministic World Model
// builder — never in the renderer, never by the agent. They classify a module's
// *world entity type* from facts that already exist in the RKM (module
// name/path, file types, risk indicators). They are honest best-effort
// signals, not a real entry-point/data-flow analyzer — see
// docs/ARCHITECTURE_DECISIONS.md and the Step 4 report for the disclosure.
const TEST_DIR_PATTERN = /(^|\/)(tests?|__tests__|spec)$/i;
const DOCS_DIR_PATTERN = /(^|\/)(docs?|documentation)$/i;
const DB_DIR_PATTERN = /(^|\/)(db|database|models?|prisma|store|storage|repositor(y|ies))$/i;
const ENTRY_FILE_PATTERN = /^(index|main|server|app)\.(ts|tsx|js|jsx|mjs|cjs)$/i;

type EntityKind = { type: WorldLandmark["type"] | "region"; label: string | null };

function classifyModule(mod: ModuleFact, fileTypeById: Map<string, string>): EntityKind {
  const testFileCount = mod.fileIds.filter((id) => fileTypeById.get(id) === "test").length;
  const isMostlyTests = mod.fileIds.length > 0 && testFileCount / mod.fileIds.length > 0.5;
  if (isMostlyTests || TEST_DIR_PATTERN.test(mod.path)) {
    return { type: "training-ground", label: "tests" };
  }

  const docFileCount = mod.fileIds.filter((id) => fileTypeById.get(id) === "documentation").length;
  const isMostlyDocs = mod.fileIds.length > 0 && docFileCount / mod.fileIds.length > 0.5;
  if (isMostlyDocs || DOCS_DIR_PATTERN.test(mod.path)) {
    return { type: "library", label: "documentation" };
  }

  if (DB_DIR_PATTERN.test(mod.path)) {
    return { type: "cave", label: "database (name heuristic)" };
  }

  // A real, already-computed RKM signal (RiskIndicator.kind, from
  // structure/security analysis) — never a new analyzer. "deprecated/dead
  // areas = ruins" per the Claude Design redesign's semantic terrain
  // language: a module flagged dead-code/deprecated reads as an abandoned
  // structure, not a thriving one.
  if (mod.risk.some((r) => r.kind === "dead-code-candidate" || r.kind === "deprecated-pattern")) {
    return { type: "ruins", label: "deprecated / dead-code candidate" };
  }

  if (mod.importance >= LANDMARK_IMPORTANCE_THRESHOLD) {
    return { type: "landmark", label: "core domain" };
  }

  return { type: "region", label: null };
}

function visualStateFor(importance: number, hasRisk: boolean): VisualState {
  const healthTier: VisualState["healthTier"] = hasRisk ? "stressed" : importance > 0.7 ? "thriving" : "healthy";
  return {
    healthTier,
    environmentTags: hasRisk ? ["warning-indicators"] : importance > 0.7 ? ["sunlight"] : [],
    scale: 0.5 + importance,
  };
}

/**
 * Module grouping can legitimately produce the same short name twice (e.g.
 * `lib/arguments` and `types/arguments` after structure-analyzer's split —
 * see docs/ARCHITECTURE_DECISIONS.md). The world label must disambiguate
 * those, since two floating "arguments" trees at different positions would
 * otherwise be indistinguishable at a glance. Only duplicated names are
 * touched; the common case (a unique name) is shown exactly as-is.
 */
function displayNamesFor(modules: ModuleFact[]): Map<string, string> {
  const countByName = new Map<string, number>();
  for (const m of modules) countByName.set(m.name, (countByName.get(m.name) ?? 0) + 1);

  const displayNames = new Map<string, string>();
  for (const m of modules) {
    if ((countByName.get(m.name) ?? 0) <= 1) {
      displayNames.set(m.id, m.name);
      continue;
    }
    const segments = m.path.split("/");
    const parent = segments.length > 1 ? segments[segments.length - 2] : null;
    displayNames.set(m.id, parent ? `${parent} · ${m.name}` : m.name);
  }
  return displayNames;
}

const ENTRY_NAME_PRIORITY = ["index", "main", "server", "app"];

/**
 * A common entry-point filename, anywhere in the repo — a cheap, honest gate
 * signal, not a real entry-point analyzer (see ANALYZER_ARCHITECTURE.md's
 * planned entry-point-analyzer for that). Previously only checked the root
 * module, which misses the overwhelmingly common case of a nested real entry
 * point (`src/index.ts`, `cmd/server/main.go`) while occasionally finding an
 * unrelated root-level demo script instead. Now searches every file and
 * prefers the shallowest match, breaking ties by name priority
 * (index > main > server > app) — still no false claim of certainty, just a
 * better-informed guess among real files.
 */
function findEntryFile(model: RepositoryKnowledgeModel): { fileId: string } | null {
  const matches = model.files
    .map((f) => ({ id: f.id, name: f.id.split("/").pop() ?? "" }))
    .filter((f) => ENTRY_FILE_PATTERN.test(f.name))
    .map((f) => ({
      ...f,
      depth: f.id.split("/").length,
      priority: ENTRY_NAME_PRIORITY.indexOf(f.name.split(".")[0].toLowerCase()),
    }));

  if (matches.length === 0) return null;

  matches.sort((a, b) => a.depth - b.depth || a.priority - b.priority);
  return { fileId: matches[0].id };
}

/**
 * Pure function: RepositoryKnowledgeModel -> WorldModel. No AI, no I/O — the
 * world is a deterministic view of the facts already established. See
 * docs/REPOSITORY_KNOWLEDGE_MODEL.md §15 for the full mapping table.
 */
export function buildWorldModel(model: RepositoryKnowledgeModel): WorldModel {
  const regions: WorldRegion[] = [];
  const landmarks: WorldLandmark[] = [];
  const fileTypeById = new Map(model.files.map((f) => [f.id, f.type]));
  const displayNames = displayNamesFor(model.modules);

  for (const m of model.modules) {
    const { type, label } = classifyModule(m, fileTypeById);
    const visualState = visualStateFor(m.importance, m.risk.length > 0);
    const name = displayNames.get(m.id) ?? m.name;

    regions.push({
      id: `region-${m.id}`,
      type: "region",
      sourceEntityId: m.id,
      sourceEntityKind: "module",
      name,
      label,
      visualState,
    });

    if (type !== "region") {
      // Every non-plain-region module is ALSO a region (so it still forms
      // part of the terrain/layout and can host paths), plus a landmark of
      // its specialized type layered on top.
      landmarks.push({
        id: `landmark-${m.id}`,
        type,
        sourceEntityId: m.id,
        sourceEntityKind: "module",
        name,
        label,
        visualState,
      });
    }
  }

  const entry = findEntryFile(model);
  if (entry) {
    landmarks.push({
      id: `landmark-gate`,
      type: "gate",
      sourceEntityId: entry.fileId,
      sourceEntityKind: "file",
      name: "Entry point",
      label: entry.fileId,
      visualState: { healthTier: "healthy", environmentTags: [], scale: 1 },
    });
  }

  const fileToModule = new Map<string, string>();
  for (const m of model.modules) for (const fileId of m.fileIds) fileToModule.set(fileId, m.id);

  const modulePairs = new Set<string>();
  for (const edge of model.dependencies) {
    if (edge.fromKind !== "file" || edge.toKind !== "file") continue;
    const fromModuleId = fileToModule.get(edge.fromId);
    const toModuleId = fileToModule.get(edge.toId);
    if (!fromModuleId || !toModuleId || fromModuleId === toModuleId) continue;
    modulePairs.add(`${fromModuleId}->${toModuleId}`);
  }

  // Several file-level edges (of possibly different confidence — a certain
  // relative import alongside a heuristic suffix-matched one) can collapse
  // into the same module-level path; average their confidence so the path's
  // dimness reflects how much of the underlying evidence is solid.
  const confidenceSumByPair = new Map<string, { sum: number; count: number; edgeId: string }>();
  for (const edge of model.dependencies) {
    if (edge.fromKind !== "file" || edge.toKind !== "file") continue;
    const fromModuleId = fileToModule.get(edge.fromId);
    const toModuleId = fileToModule.get(edge.toId);
    if (!fromModuleId || !toModuleId || fromModuleId === toModuleId) continue;

    const key = `${fromModuleId}->${toModuleId}`;
    const entry = confidenceSumByPair.get(key) ?? { sum: 0, count: 0, edgeId: edge.id };
    entry.sum += edge.confidence;
    entry.count += 1;
    confidenceSumByPair.set(key, entry);
  }

  const paths: WorldPath[] = [];
  for (const [key, { sum, count, edgeId }] of confidenceSumByPair) {
    const [fromModuleId, toModuleId] = key.split("->");

    // A real, computed signal: both modules depend on each other.
    const cyclic = modulePairs.has(`${toModuleId}->${fromModuleId}`);

    paths.push({
      id: `path-${key}`,
      type: "path",
      sourceEntityId: edgeId,
      sourceEntityKind: "dependency",
      fromLandmarkId: `region-${fromModuleId}`,
      toLandmarkId: `region-${toModuleId}`,
      cyclic,
      confidence: sum / count,
      visualState: { healthTier: "healthy", environmentTags: [], scale: 1 },
    });
  }

  return {
    meta: { repositoryKnowledgeModelId: model.meta.repositoryId, generatedAt: new Date().toISOString() },
    biome: {
      id: "biome-root",
      type: "biome",
      sourceEntityId: model.repository.id,
      sourceEntityKind: "repository",
      name: model.repository.name,
      visualState: { healthTier: "healthy", environmentTags: [], scale: 1 },
    },
    regions,
    landmarks,
    paths,
  };
}
