import type { RepositoryKnowledgeModel, DomainConcept } from "./knowledge-model";
import type { FlowModel } from "./flow";
import type { JourneyModel } from "./journey";
import type { WorldModel } from "./world-model";
import type { OnboardingJourney } from "./onboarding";
import type { FeaturePlan } from "./featurePlan";

/**
 * A CodeBiome World (docs/WORLD_ARCHITECTURE.md) — one repository analysis,
 * identified by an opaque id. The same repository analyzed twice produces
 * two independent Worlds with independent ids, independent mutable state,
 * and independent events; nothing is shared between them.
 */
export interface WorldRecord {
  id: string;
  repositoryUrl: string;
  /** "owner/repo" — kept for display and for the owner/repo backward-compat resolution path. */
  repositoryId: string;
  commitSha: string;
  createdAt: string;
}

/** The immutable analysis snapshot a World was created from — never mutated after creation. */
export interface WorldSnapshot {
  world: WorldRecord;
  knowledgeModel: RepositoryKnowledgeModel;
  flowModel: FlowModel;
  /** Multi-request user journeys built on top of flowModel — see src/types/journey.ts. */
  journeyModel: JourneyModel;
  worldModel: WorldModel;
}

/**
 * What the browser reports about "what the developer is currently looking
 * at" for one World — see src/server/bob/sessionContext.ts. Previously
 * keyed by repositoryId (a bare Map); now a field inside a World's mutable
 * state, keyed by worldId, so two Worlds for the same repository never see
 * each other's navigation state.
 */
export interface WorldSessionContext {
  selectedModuleId: string | null;
  selectedModuleName: string | null;
  activeFlowId: string | null;
  activeFlowName: string | null;
  currentStepId: string | null;
  currentStepLabel: string | null;
  activeOnboardingJourneyId: string | null;
  activeOnboardingJourneyTitle: string | null;
  currentOnboardingStepIndex: number | null;
  currentOnboardingStepReason: string | null;
  updatedAt: string;
}

/**
 * The AI-interpretation / navigation-session layer for one World — mutable,
 * additive, and persisted separately from the immutable WorldSnapshot (see
 * ARCHITECTURE.md "layer 3 is the contract": the deterministic snapshot
 * must never be mutated in place by anything Bob contributes).
 */
export interface WorldMutableState {
  sessionContext: WorldSessionContext | null;
  domainConcepts: DomainConcept[];
  onboardingJourneys: OnboardingJourney[];
  /** Bob-proposed feature implementation plans — see src/types/featurePlan.ts and the "Plan" tab. */
  featurePlans: FeaturePlan[];
}

export const EMPTY_WORLD_MUTABLE_STATE: WorldMutableState = {
  sessionContext: null,
  domainConcepts: [],
  onboardingJourneys: [],
  featurePlans: [],
};
