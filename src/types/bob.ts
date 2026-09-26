import type { DependencyEdge, ModuleFact, RiskIndicator } from "./knowledge-model";
import type { Flow, FlowStep } from "./flow";

/**
 * The Bob integration boundary (Step 14). Nothing in this file talks to a
 * real model yet — it exists so the UI can be built against a stable shape
 * now, and a real IBM Bob/MCP-backed implementation can be dropped in later
 * (src/server/ai/) without touching any component that imports `BobClient`.
 *
 * Hard rule carried over from docs/REPOSITORY_KNOWLEDGE_MODEL.md: Bob only
 * ever *interprets* facts already present in the Repository Knowledge
 * Model. `BobContext` is built entirely from RKM data — never from raw
 * source, never invented — so a real implementation has no path to
 * fabricate an entity that doesn't already exist.
 */

export interface BobContext {
  repositoryId: string;
  selectedEntity: {
    id: string;
    kind: "module" | "file";
    name: string;
  };
  /** A trimmed slice of real RKM facts about the selected entity — not the whole model. */
  relevantFacts: {
    importance: number;
    centrality: number;
    linesOfCode: number;
    risk: RiskIndicator[];
  };
  dependencies: Pick<ModuleFact, "id" | "name">[];
  dependents: Pick<ModuleFact, "id" | "name">[];
  /** Populated once a data-flow analyzer exists; empty array until then. */
  dataFlow: { label: string; steps: string[] }[];
  /**
   * Present only during a Feature/Flow walkthrough (Step 5). Lets Bob answer
   * flow-aware questions ("why does the request go through this component?")
   * grounded in the SAME statically-reconstructed path the user is looking
   * at — never a runtime trace. `currentStep`/`previousStep`/`nextStep` are
   * plain data, not narration; the UI still labels the flow as inferred.
   */
  flowContext: {
    flow: Pick<Flow, "id" | "name" | "confidence" | "evidence">;
    currentStep: FlowStep;
    previousStep: FlowStep | null;
    nextStep: FlowStep | null;
  } | null;
}

export interface BobResponse {
  explanation: string;
  /** RKM fact ids the explanation is grounded in — always non-empty for a real response. */
  evidence: string[];
  referencedEntities: string[];
  suggestedActions: string[];
}

export interface BobClient {
  ask(context: BobContext, question: string): Promise<BobResponse>;
}

export class BobNotConnectedError extends Error {
  constructor() {
    super("Bob is not connected in this build yet.");
    this.name = "BobNotConnectedError";
  }
}

/**
 * The only implementation that exists in this vertical slice. It never
 * fabricates an answer — it always signals "not connected" so the UI can
 * show an honest empty state instead of a fake chatbot. Swap this for a
 * real client (e.g. `src/server/ai/anthropicBobClient.ts`) when Bob is
 * wired up; no caller needs to change.
 */
export class NotConnectedBobClient implements BobClient {
  async ask(): Promise<BobResponse> {
    throw new BobNotConnectedError();
  }
}

export const bobClient: BobClient = new NotConnectedBobClient();
