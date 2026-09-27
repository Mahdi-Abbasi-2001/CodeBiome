import type { RepositoryKnowledgeModel, DependencyEdge } from "@/types/knowledge-model";
import { EntryPointSchema } from "@/types/knowledge-model";
import type { Flow, FlowStep, FlowStepKind, ConfidenceLevel } from "@/types/flow";
import { FlowModelSchema, type FlowModel } from "@/types/flow";
import type { z } from "zod";

type EntryPoint = z.infer<typeof EntryPointSchema>;

/**
 * Static flow inference — Step 5. Turns real entry points + real dependency
 * edges (both already established as facts elsewhere in the pipeline) into
 * a small number of named, evidence-backed candidate flows.
 *
 * HARD INVARIANT: every FlowStep.entityId is a real RepositoryKnowledgeModel
 * file id, reached by literally walking `model.dependencies` — this never
 * invents a relationship. What IS inferred (disclosed via `confidence` and
 * `evidence`) is: (a) which real edge, among several from one file, best
 * continues a "flow" rather than a lateral hop, and (b) which architectural
 * *layer* a file plays based on its path/name — naming is supporting
 * evidence only, per docs/REPOSITORY_KNOWLEDGE_MODEL.md, never treated as
 * equivalent to the deterministic edge itself.
 *
 * This produces a STATICALLY RECONSTRUCTED / LIKELY execution path. Nothing
 * here executes the analyzed repository — see docs/ARCHITECTURE_DECISIONS.md
 * and the Step 5 report for the same disclosure applied to the UI copy.
 */

const MAX_CHAIN_DEPTH = 6;
const MAX_FLOWS = 8;
const TERMINAL_KINDS: FlowStepKind[] = ["database", "external-api"];

// Prefix boundary includes "." deliberately: "article.service.ts" /
// "user.controller.ts" (Nest/Angular-style dot-suffixed naming) is at least
// as common as "services/article.ts" (directory-based), and the original
// `[/_-]`-only boundary silently missed every dot-suffixed file — caught by
// testing against a real NestJS repo, not by unit tests using only
// directory-based fixtures.
const LAYER_PATTERNS: { kind: FlowStepKind; pattern: RegExp }[] = [
  { kind: "controller", pattern: /(^|[/_.-])controllers?([/_-]|\.|$)/i },
  { kind: "handler", pattern: /(^|[/_.-])handlers?([/_-]|\.|$)/i },
  { kind: "service", pattern: /(^|[/_.-])services?([/_-]|\.|$)/i },
  { kind: "repository", pattern: /(^|[/_.-])(repositor(y|ies)|dao)([/_-]|\.|$)/i },
  // Entity/model files are the DATA BOUNDARY — a distinct role from the
  // database/infra layer below (an ORM `@Entity()` class vs. a raw db
  // connection/migration file are architecturally different things, and
  // the World renderer gives them visually distinct structures — see
  // src/world-engine/buildingRoles.ts). Previously "models?" was lumped
  // into "database", which collapsed that distinction.
  { kind: "entity", pattern: /(^|[/_.-])(entit(y|ies)|models?)([/_-]|\.|$)/i },
  { kind: "database", pattern: /(^|[/_.-])(db|database|schemas?|prisma|migrations?)([/_-]|\.|$)/i },
  { kind: "external-api", pattern: /(^|[/_.-])(clients?|sdk|integrations?)([/_-]|\.|$)/i },
  { kind: "event", pattern: /(^|[/_.-])(events?|emitter|pubsub|queue|producer|consumer)([/_-]|\.|$)/i },
];

export function classifyLayer(path: string): FlowStepKind {
  for (const { kind, pattern } of LAYER_PATTERNS) if (pattern.test(path)) return kind;
  return "function";
}

/** "OrderController.ts" -> "Order Controller"; "article.service.ts" -> "Article Service". Best-effort, never claimed as a verified AST symbol. */
function humanizeIdentifier(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, "");
  const spaced = stem.replace(/[_.-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

function symbolFromFileName(path: string): string {
  return path.split("/").pop()!.replace(/\.[^.]+$/, "");
}

const GENERIC_DIRS = new Set(["src", "app", "lib", "pkg", "packages", "apps", "controllers", "services", "routes", "handlers", "api"]);

/**
 * Prefers, in order: (1) a real HTTP path segment when the framework
 * expressed one as a leading-slash string (Express/Flask/Laravel/Rails
 * style); (2) the entry file's own feature directory (e.g. "profile" from
 * "src/profile/profile.controller.ts") — reliable across the many
 * frameworks (NestJS included) whose route decorators carry no full path
 * locally; (3) the humanized filename minus a common layer suffix.
 */
function deriveFlowName(entryPoint: EntryPoint, filePath: string): string {
  if (entryPoint.type === "http-route" && entryPoint.name.includes("/")) {
    const segments = entryPoint.name
      .split("/")
      .filter(Boolean)
      .filter((s) => !s.startsWith(":") && !s.startsWith("{") && !/^\d+$/.test(s))
      .filter((s) => !["api", "v1", "v2", "v3"].includes(s.toLowerCase()));
    if (segments.length > 0) return humanizeIdentifier(segments[segments.length - 1]);
  }

  const dirs = filePath.split("/").slice(0, -1);
  for (let i = dirs.length - 1; i >= 0; i--) {
    if (!GENERIC_DIRS.has(dirs[i].toLowerCase())) return humanizeIdentifier(dirs[i]);
  }

  const name = humanizeIdentifier(entryPoint.name).replace(/\b(Controller|Service|Handler|Routes?)\b/gi, "").trim();
  return name || humanizeIdentifier(entryPoint.name);
}

function edgeConfidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= 0.9) return "high";
  if (confidence >= 0.6) return "medium";
  return "low";
}

const CONFIDENCE_RANK: Record<ConfidenceLevel, number> = { low: 0, medium: 1, high: 2 };
function weakest(levels: ConfidenceLevel[]): ConfidenceLevel {
  return levels.reduce((min, l) => (CONFIDENCE_RANK[l] < CONFIDENCE_RANK[min] ? l : min), "high" as ConfidenceLevel);
}

function buildChain(
  entryPoint: EntryPoint,
  model: RepositoryKnowledgeModel,
  outgoingByFile: Map<string, DependencyEdge[]>,
  fileToModule: Map<string, string>
): FlowStep[] {
  const fileById = new Map(model.files.map((f) => [f.id, f]));
  const startFile = fileById.get(entryPoint.fileId);
  if (!startFile) return [];

  const entryKindGuess = classifyLayer(startFile.path);
  const entryConfidence: ConfidenceLevel = entryPoint.type === "app-startup" ? "medium" : "high";

  const steps: FlowStep[] = [
    {
      id: "step-0",
      entityId: startFile.id,
      moduleId: fileToModule.get(startFile.id) ?? null,
      kind: entryKindGuess === "function" ? "entry" : entryKindGuess,
      label: humanizeIdentifier(startFile.path.split("/").pop()!),
      filePath: startFile.path,
      symbol: symbolFromFileName(startFile.path),
      explanation: `${humanizeIdentifier(startFile.path.split("/").pop()!)} is the entry point for this flow.`,
      evidence: [entryPoint.detectionEvidence],
      confidence: entryConfidence,
      nextStepIds: [],
    },
  ];

  const visited = new Set([startFile.id]);
  let currentId = startFile.id;
  let currentKind = entryKindGuess;

  for (let depth = 0; depth < MAX_CHAIN_DEPTH; depth++) {
    if (TERMINAL_KINDS.includes(currentKind)) break;

    const outgoing = (outgoingByFile.get(currentId) ?? []).filter((e) => !visited.has(e.toId) && fileById.has(e.toId));
    if (outgoing.length === 0) break;

    // Prefer a real edge that moves to a DIFFERENT architectural layer (a
    // genuine "flow" progresses; staying in the same layer is a lateral
    // implementation detail), then higher edge confidence, then higher
    // target module importance as a tiebreaker.
    const scored = outgoing.map((edge) => {
      const targetFile = fileById.get(edge.toId)!;
      const kind = classifyLayer(targetFile.path);
      const layerChanged = kind !== currentKind ? 1 : 0;
      const targetModule = fileToModule.get(edge.toId);
      const importance = targetModule ? model.modules.find((m) => m.id === targetModule)?.importance ?? 0 : 0;
      return { edge, targetFile, kind, score: layerChanged * 10 + edge.confidence * 3 + importance };
    });
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];

    const isNaming = best.kind !== "function";
    const evidence = [`${symbolFromFileName(currentId)} imports ${symbolFromFileName(best.targetFile.path)} (deterministic edge)`];
    if (isNaming) evidence.push(`"${best.targetFile.path}" matches the ${best.kind} naming convention (heuristic, not verified semantics)`);

    const step: FlowStep = {
      id: `step-${steps.length}`,
      entityId: best.targetFile.id,
      moduleId: fileToModule.get(best.targetFile.id) ?? null,
      kind: best.kind,
      label: humanizeIdentifier(best.targetFile.path.split("/").pop()!),
      filePath: best.targetFile.path,
      symbol: symbolFromFileName(best.targetFile.path),
      explanation: `${humanizeIdentifier(best.targetFile.path.split("/").pop()!)} is reached from ${humanizeIdentifier(
        currentId.split("/").pop()!
      )} via a real ${best.edge.relationship} dependency.`,
      evidence,
      confidence: isNaming ? edgeConfidenceLevel(best.edge.confidence) : weakest([edgeConfidenceLevel(best.edge.confidence), "medium"]),
      nextStepIds: [],
    };
    steps[steps.length - 1].nextStepIds = [step.id];
    steps.push(step);

    visited.add(best.targetFile.id);
    currentId = best.targetFile.id;
    currentKind = best.kind;
  }

  return steps;
}

function scoreFlowCandidate(steps: FlowStep[]): number {
  const distinctLayers = new Set(steps.map((s) => s.kind)).size;
  const avgConfidence = steps.reduce((sum, s) => sum + CONFIDENCE_RANK[s.confidence], 0) / steps.length;
  const reachesTerminal = steps.some((s) => TERMINAL_KINDS.includes(s.kind)) ? 2 : 0;
  return distinctLayers * 3 + avgConfidence * 2 + reachesTerminal + steps.length * 0.5;
}

/** Pure function: RepositoryKnowledgeModel -> FlowModel. No AI, no I/O — see
 *  module doc comment above for the disclosure this data model exists to
 *  support (statically reconstructed, never a runtime trace). */
export function inferFlows(model: RepositoryKnowledgeModel): FlowModel {
  const fileToModule = new Map<string, string>();
  for (const m of model.modules) for (const fileId of m.fileIds) fileToModule.set(fileId, m.id);

  // "imports" only — a Flow is a server-side call chain through real code
  // dependencies. `http-request`/`navigates-to` edges (frontend-call-
  // analyzer.ts) are a different kind of hop entirely — a user-journey step
  // between pages/requests, not "this file uses that file's exports" —
  // and are walked separately by src/server/journeys/inferJourneys.ts.
  const outgoingByFile = new Map<string, DependencyEdge[]>();
  for (const edge of model.dependencies) {
    if (edge.fromKind !== "file" || edge.toKind !== "file" || edge.relationship !== "imports") continue;
    if (!outgoingByFile.has(edge.fromId)) outgoingByFile.set(edge.fromId, []);
    outgoingByFile.get(edge.fromId)!.push(edge);
  }

  const candidates: Flow[] = [];
  const usedNames = new Map<string, number>(); // name -> best score seen, to dedupe

  // A "frontend-page" isn't a server-side request entry point — it's the
  // anchor journeys start from instead (inferJourneys.ts), never a Flow.
  for (const entryPoint of model.entryPoints.filter((e) => e.type !== "frontend-page")) {
    const steps = buildChain(entryPoint, model, outgoingByFile, fileToModule);
    if (steps.length < 2) continue; // no useful chain — not worth surfacing

    const name = deriveFlowName(entryPoint, steps[0].filePath);
    const score = scoreFlowCandidate(steps);
    const existingScore = usedNames.get(name.toLowerCase());
    if (existingScore !== undefined && existingScore >= score) continue;
    usedNames.set(name.toLowerCase(), score);

    const layerSummary = [...new Set(steps.map((s) => s.kind))].join(" → ");
    candidates.push({
      id: `flow-${entryPoint.id}`,
      name,
      description: `${steps.length}-step likely execution path starting at ${entryPoint.name} (${layerSummary}).`,
      confidence: weakest(steps.map((s) => s.confidence)),
      entryPointId: steps[0].id,
      steps,
      evidence: [entryPoint.detectionEvidence, `${steps.length - 1} real dependency edge(s) traced from the entry point`],
    });
  }

  // Dedup by name keeping the best-scoring variant (a name can appear twice
  // above if two different entry points independently produced it before
  // the running usedNames max was known at insert time).
  const bestByName = new Map<string, Flow>();
  for (const flow of candidates) {
    const key = flow.name.toLowerCase();
    const prev = bestByName.get(key);
    if (!prev || scoreFlowCandidate(flow.steps) > scoreFlowCandidate(prev.steps)) bestByName.set(key, flow);
  }

  const flows = [...bestByName.values()]
    .sort((a, b) => scoreFlowCandidate(b.steps) - scoreFlowCandidate(a.steps))
    .slice(0, MAX_FLOWS);

  return FlowModelSchema.parse({
    meta: { repositoryKnowledgeModelId: model.meta.repositoryId, generatedAt: new Date().toISOString() },
    flows,
  });
}
