/**
 * The event shapes carried over CodeBiome's live Bob bridge — see
 * docs/BOB_INTEGRATION.md "How Bob's output gets reflected in the CodeBiome
 * UI". Published server-side by src/server/bob/eventBus.ts (only reachable
 * from server code) whenever a real, externally connected IBM Bob session
 * calls one of CodeBiome's MCP tools; consumed client-side by
 * src/features/bob/useBobBridge.ts over SSE. Kept in src/types/ (not
 * src/server/) so client components can import the shapes without ever
 * importing server-only runtime code, same convention as knowledge-model.ts
 * and flow.ts.
 */

import type { OnboardingJourney } from "./onboarding";

export type WorldAction =
  | { type: "open_module"; moduleId: string; moduleName: string }
  | { type: "start_flow"; flowId: string; flowName: string }
  | { type: "focus_flow_step"; flowId: string; flowName: string; stepIndex: number; stepLabel: string }
  | { type: "open_file"; path: string; moduleId: string | null; line: number | null }
  | { type: "show_dependencies"; moduleId: string; moduleName: string }
  | { type: "show_impact"; moduleId: string; moduleName: string; affectedModuleIds: string[] }
  | {
      type: "focus_onboarding_step";
      journeyId: string;
      journeyName: string;
      stepIndex: number;
      moduleId: string;
      moduleName: string;
      /** Bob's own reason for this step — interpretation, carried through so the HUD can show it directly. */
      reason: string;
    };

export interface WorldActionEvent {
  kind: "world-action";
  /** The scoping field every consumer filters on (docs/WORLD_ARCHITECTURE.md) — a World A event must never reach a World B browser tab, even for the same repository. */
  worldId: string;
  repositoryId: string;
  action: WorldAction;
  at: string;
}

export interface ActivityEvent {
  kind: "activity";
  worldId: string;
  repositoryId: string;
  tool: string;
  args: Record<string, unknown>;
  /** A short, deterministic, factual summary of the result — never AI-generated narration. */
  summary: string;
  at: string;
}

/**
 * The AI-interpretation layer (see src/server/bob/domainConceptStore.ts).
 * Published whenever a connected Bob session successfully calls
 * `contribute_domain_concept` — every field on `concept` is exactly what
 * Bob submitted (validated against the real RKM first), never anything
 * CodeBiome invented on its own.
 */
export interface DomainConceptEvent {
  kind: "domain-concept";
  worldId: string;
  repositoryId: string;
  concept: {
    id: string;
    name: string;
    description: string;
    relatedModuleIds: string[];
    relatedFileIds: string[];
    confidence: number;
  };
  at: string;
}

/**
 * The onboarding-journey layer (see src/types/onboarding.ts). Published
 * whenever a connected Bob session successfully calls
 * `create_onboarding_journey` — `journey` is exactly what was stored
 * (verified module references, Bob's own title/goal/reasons), never
 * anything CodeBiome invented. A `focus_onboarding_step` WorldAction always
 * accompanies journey creation (step 0) and every later
 * `advance_onboarding_step` call, so the world reacts the same way a flow
 * walkthrough's `focus_flow_step` already does.
 */
export interface OnboardingJourneyEvent {
  kind: "onboarding-journey";
  worldId: string;
  repositoryId: string;
  journey: OnboardingJourney;
  at: string;
}

export type BobEvent = WorldActionEvent | ActivityEvent | DomainConceptEvent | OnboardingJourneyEvent;
