/**
 * The onboarding-journey layer — Bob's second write path into what a
 * developer sees, alongside domain concepts (src/types/knowledge-model.ts's
 * `DomainConcept`). Where a domain concept is an unordered grouping ("these
 * modules together are Authentication"), a journey is an ORDERED, narrated
 * path through real modules Bob has decided a newcomer should walk, each
 * step carrying Bob's own reason. Kept as its own top-level shape (not
 * merged into RepositoryKnowledgeModel) for the same reason DomainConcept
 * is additive rather than in-place: the deterministic RKM must stay exactly
 * what re-running analysis would produce, with or without anything Bob has
 * contributed.
 *
 * Every `moduleId`/`moduleName` here is a verified reference resolved
 * against the real RKM at creation time (src/server/bob-tools/
 * onboardingTools.ts) — Bob can never point a step at a module that doesn't
 * exist. `reason` and `goal` are pure AI interpretation: CodeBiome does not
 * validate or generate their content, only that they're non-empty.
 */

export interface OnboardingStep {
  order: number;
  /** Real ModuleFact.id — resolved and verified before storage. */
  moduleId: string;
  moduleName: string;
  /** Bob's own explanation of why this step matters for this journey — interpretation, not fact. */
  reason: string;
}

export interface OnboardingJourney {
  id: string;
  /** Bob-authored title, e.g. "Understanding Order Creation". */
  title: string;
  /** Bob-authored goal statement, e.g. "Understand how an order request travels through the application". */
  goal: string;
  steps: OnboardingStep[];
  provenance: {
    source: "ai-interpreted";
    confidence: number;
    generatedBy: "bob";
    modelVersion: string;
  };
  createdAt: string;
}
