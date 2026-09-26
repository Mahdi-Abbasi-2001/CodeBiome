import type { OnboardingJourney } from "@/types/onboarding";
import { worldStore } from "@/server/world/worldStore";

/**
 * Same shape and same caveats as `domainConceptStore.ts`: a thin wrapper
 * over `worldStore`'s mutable state, keyed by World id
 * (docs/WORLD_ARCHITECTURE.md) rather than repositoryId, so two Worlds for
 * the same repository never share onboarding journeys. A journey created
 * here is layered on top of a World's immutable snapshot, never written
 * into it.
 */
class OnboardingJourneyStore {
  async list(worldId: string): Promise<OnboardingJourney[]> {
    const state = await worldStore.getMutableState(worldId);
    return state.onboardingJourneys;
  }

  async add(worldId: string, journey: OnboardingJourney): Promise<void> {
    await worldStore.updateMutableState(worldId, (state) => ({
      ...state,
      onboardingJourneys: [...state.onboardingJourneys, journey],
    }));
  }

  async find(worldId: string, journeyIdOrTitle: string): Promise<OnboardingJourney | null> {
    const journeys = await this.list(worldId);
    return (
      journeys.find((j) => j.id === journeyIdOrTitle) ??
      journeys.find((j) => j.title.toLowerCase() === journeyIdOrTitle.toLowerCase()) ??
      null
    );
  }
}

export const onboardingJourneyStore = new OnboardingJourneyStore();
