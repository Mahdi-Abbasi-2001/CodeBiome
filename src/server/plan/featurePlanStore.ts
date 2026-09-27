import type { FeaturePlan } from "@/types/featurePlan";
import { worldStore } from "@/server/world/worldStore";

/**
 * Same shape and same caveats as `onboardingJourneyStore.ts`/
 * `domainConceptStore.ts`: a thin wrapper over `worldStore`'s mutable
 * state, keyed by World id — a plan proposed here is layered on top of a
 * World's immutable snapshot, never written into it.
 */
class FeaturePlanStore {
  async list(worldId: string): Promise<FeaturePlan[]> {
    const state = await worldStore.getMutableState(worldId);
    return state.featurePlans;
  }

  async add(worldId: string, plan: FeaturePlan): Promise<void> {
    await worldStore.updateMutableState(worldId, (state) => ({
      ...state,
      featurePlans: [...state.featurePlans, plan],
    }));
  }

  async find(worldId: string, planIdOrName: string): Promise<FeaturePlan | null> {
    const plans = await this.list(worldId);
    return plans.find((p) => p.id === planIdOrName) ?? plans.find((p) => p.name.toLowerCase() === planIdOrName.toLowerCase()) ?? null;
  }
}

export const featurePlanStore = new FeaturePlanStore();
