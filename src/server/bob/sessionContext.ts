import type { WorldSessionContext } from "@/types/world";
import { worldStore } from "@/server/world/worldStore";

/**
 * Reverse of the event bus (server -> browser): this is browser -> server,
 * so a connected Bob session can answer "explain THIS module" / "what
 * depends on THIS" without the developer repeating a module name Bob has
 * no other way to know. Found missing during real IBM Bob testing
 * (docs/BOB_INTEGRATION.md "Test 6" / ARCHITECTURE_DECISIONS.md).
 *
 * Now keyed by World id, not repositoryId (docs/WORLD_ARCHITECTURE.md) — a
 * thin wrapper over `worldStore`'s mutable state so two Worlds for the same
 * repository never see each other's navigation state, and so the value
 * survives across Vercel instances instead of living in a bare `Map`.
 */
export type SessionContext = WorldSessionContext;

class SessionContextStore {
  async set(worldId: string, context: SessionContext): Promise<void> {
    await worldStore.updateMutableState(worldId, (state) => ({ ...state, sessionContext: context }));
  }

  async get(worldId: string): Promise<SessionContext | null> {
    const state = await worldStore.getMutableState(worldId);
    return state.sessionContext;
  }
}

export const sessionContextStore = new SessionContextStore();
