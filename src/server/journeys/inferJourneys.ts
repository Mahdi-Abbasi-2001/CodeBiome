import type { RepositoryKnowledgeModel, DependencyEdge, EntryPointSchema } from "@/types/knowledge-model";
import type { Flow, ConfidenceLevel } from "@/types/flow";
import { FlowModelSchema, type FlowModel } from "@/types/flow";
import type { Journey, JourneyStep } from "@/types/journey";
import { JourneyModelSchema, type JourneyModel } from "@/types/journey";
import type { z } from "zod";

type EntryPoint = z.infer<typeof EntryPointSchema>;

/**
 * Static journey inference — the level above Flow (src/server/flows/
 * inferFlows.ts). A Flow reconstructs ONE request's server-side call chain;
 * a Journey stitches several of those together the way a real user
 * actually experiences a multi-step operation (sign up, check out): a
 * frontend page, the real API call it makes, the real page it navigates to
 * next, that page's own call, and so on.
 *
 * HARD INVARIANT, same as inferFlows: every step's `entityId` is a real
 * RepositoryKnowledgeModel file id, and every hop is a real `http-request`/
 * `navigates-to` edge produced by frontend-call-analyzer.ts from an actual
 * `fetch`/`axios`/`<form>`/navigation call site — never inferred from
 * naming alone, never AI-generated. Where a page has more than one
 * possible next call or navigation target, that hop's confidence drops to
 * "low" rather than silently asserting the one this walk happened to pick
 * is "the" path — the same honesty rule flows already apply.
 */

const MAX_JOURNEY_DEPTH = 6; // page/call hops, comparable to inferFlows' MAX_CHAIN_DEPTH
const MAX_JOURNEYS = 8;

const CONFIDENCE_RANK: Record<ConfidenceLevel, number> = { low: 0, medium: 1, high: 2 };

function humanizeIdentifier(text: string): string {
  const stem = text.replace(/\.[^./]+$/, "");
  const spaced = stem
    .replace(/^\//, "")
    .replace(/[/_.-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  if (!spaced) return "Home";
  return spaced
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

interface Edge {
  toId: string;
  confidence: number;
}

function buildEdgeIndex(dependencies: DependencyEdge[], relationship: "http-request" | "navigates-to"): Map<string, Edge[]> {
  const index = new Map<string, Edge[]>();
  for (const edge of dependencies) {
    if (edge.relationship !== relationship || edge.fromKind !== "file" || edge.toKind !== "file") continue;
    if (!index.has(edge.fromId)) index.set(edge.fromId, []);
    index.get(edge.fromId)!.push({ toId: edge.toId, confidence: edge.confidence });
  }
  return index;
}

function buildJourneySteps(
  startPage: EntryPoint,
  httpRequestByFile: Map<string, Edge[]>,
  navigatesToByFile: Map<string, Edge[]>,
  flowByEntryFileId: Map<string, Flow>,
  fileById: Map<string, RepositoryKnowledgeModel["files"][number]>,
  pageById: Map<string, EntryPoint>
): JourneyStep[] {
  const steps: JourneyStep[] = [
    {
      id: "jstep-0",
      kind: "page",
      entityId: startPage.fileId,
      filePath: fileById.get(startPage.fileId)?.path ?? startPage.fileId,
      label: humanizeIdentifier(startPage.name),
      flowId: null,
      explanation: `${humanizeIdentifier(startPage.name)} is the starting page for this journey.`,
      evidence: [startPage.detectionEvidence],
      confidence: startPage.detectionEvidence.startsWith("Next.js") ? "high" : "medium",
    },
  ];

  const visitedPages = new Set([startPage.fileId]);
  let currentPageFileId = startPage.fileId;

  for (let depth = 0; depth < MAX_JOURNEY_DEPTH; depth++) {
    const calls = (httpRequestByFile.get(currentPageFileId) ?? []).filter((e) => flowByEntryFileId.has(e.toId));
    if (calls.length === 0) break;
    const call = calls[0];
    const flow = flowByEntryFileId.get(call.toId)!;
    const callAmbiguous = calls.length > 1;
    steps.push({
      id: `jstep-${steps.length}`,
      kind: "call",
      entityId: call.toId,
      filePath: fileById.get(call.toId)?.path ?? call.toId,
      label: flow.name,
      flowId: flow.id,
      explanation: `${steps[steps.length - 1].label} calls ${flow.name} via a real fetch/axios/form request${callAmbiguous ? " (one of several calls this page makes)" : ""}.`,
      evidence: [`Real fetch/axios/form call site resolved to ${flow.name}'s entry point`],
      confidence: callAmbiguous ? "low" : call.confidence >= 1 ? "high" : "medium",
    });

    const navs = (navigatesToByFile.get(currentPageFileId) ?? []).filter((e) => pageById.has(e.toId) && !visitedPages.has(e.toId));
    if (navs.length === 0) break;
    const nav = navs[0];
    const navAmbiguous = navs.length > 1;
    const nextPage = pageById.get(nav.toId)!;
    visitedPages.add(nextPage.fileId);
    steps.push({
      id: `jstep-${steps.length}`,
      kind: "page",
      entityId: nextPage.fileId,
      filePath: fileById.get(nextPage.fileId)?.path ?? nextPage.fileId,
      label: humanizeIdentifier(nextPage.name),
      flowId: null,
      explanation: `${humanizeIdentifier(nextPage.name)} is reached by a real navigation call from ${steps[0].label}${navAmbiguous ? " (one of several places this page can navigate to)" : ""}.`,
      evidence: [`Real navigate()/router.push()/<Link> call site resolved to ${humanizeIdentifier(nextPage.name)}`],
      confidence: navAmbiguous ? "low" : nav.confidence >= 1 ? "high" : "medium",
    });
    currentPageFileId = nextPage.fileId;
  }

  return steps;
}

function weakest(levels: ConfidenceLevel[]): ConfidenceLevel {
  return levels.reduce((min, l) => (CONFIDENCE_RANK[l] < CONFIDENCE_RANK[min] ? l : min), "high" as ConfidenceLevel);
}

function scoreJourney(steps: JourneyStep[]): number {
  const pageCount = steps.filter((s) => s.kind === "page").length;
  const avgConfidence = steps.reduce((sum, s) => sum + CONFIDENCE_RANK[s.confidence], 0) / steps.length;
  return pageCount * 3 + avgConfidence * 2 + steps.length * 0.5;
}

/** Pure function: (RepositoryKnowledgeModel, FlowModel) -> JourneyModel. No AI, no I/O. */
export function inferJourneys(model: RepositoryKnowledgeModel, flowModel: FlowModel): JourneyModel {
  FlowModelSchema.parse(flowModel);
  const fileById = new Map(model.files.map((f) => [f.id, f]));
  const pages = model.entryPoints.filter((e) => e.type === "frontend-page");
  const pageById = new Map(pages.map((p) => [p.fileId, p]));

  const flowByEntryFileId = new Map<string, Flow>();
  for (const flow of flowModel.flows) {
    const entryFileId = flow.steps[0]?.entityId;
    if (entryFileId) flowByEntryFileId.set(entryFileId, flow);
  }

  const httpRequestByFile = buildEdgeIndex(model.dependencies, "http-request");
  const navigatesToByFile = buildEdgeIndex(model.dependencies, "navigates-to");

  const candidates: Journey[] = [];
  const seenNames = new Map<string, number>();

  for (const page of pages) {
    const steps = buildJourneySteps(page, httpRequestByFile, navigatesToByFile, flowByEntryFileId, fileById, pageById);
    const pageCount = steps.filter((s) => s.kind === "page").length;
    if (pageCount < 2) continue; // never navigated anywhere real — not a multi-step journey, just a page (already covered by Flow)

    const name = humanizeIdentifier(page.name);
    const score = scoreJourney(steps);
    const existing = seenNames.get(name.toLowerCase());
    if (existing !== undefined && existing >= score) continue;
    seenNames.set(name.toLowerCase(), score);

    candidates.push({
      id: `journey-${page.id}`,
      name,
      description: `${pageCount}-page likely user journey starting at ${page.name}, spanning ${steps.filter((s) => s.kind === "call").length} real API call(s).`,
      confidence: weakest(steps.map((s) => s.confidence)),
      steps,
      evidence: [page.detectionEvidence, `${steps.length - 1} real frontend call/navigation site(s) traced from the starting page`],
    });
  }

  const bestByName = new Map<string, Journey>();
  for (const journey of candidates) {
    const key = journey.name.toLowerCase();
    const prev = bestByName.get(key);
    if (!prev || scoreJourney(journey.steps) > scoreJourney(prev.steps)) bestByName.set(key, journey);
  }

  const journeys = [...bestByName.values()].sort((a, b) => scoreJourney(b.steps) - scoreJourney(a.steps)).slice(0, MAX_JOURNEYS);

  return JourneyModelSchema.parse({
    meta: { repositoryKnowledgeModelId: model.meta.repositoryId, generatedAt: new Date().toISOString() },
    journeys,
  });
}
