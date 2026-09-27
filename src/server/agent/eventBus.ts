import type { AgentEvent } from "@/types/agent-events";
import { worldStore } from "@/server/world/worldStore";

/**
 * The live bridge between a connected an external agent session (calling CodeBiome's
 * MCP tools — see src/server/bob-tools/) and the browser tab showing the
 * World for the same analysis. See docs/BOB_INTEGRATION.md "How the agent's
 * output gets reflected in the CodeBiome UI" and docs/WORLD_ARCHITECTURE.md
 * "Browser <-> the agent event routing". Event shapes live in
 * src/types/bob-events.ts so client code can import them without pulling in
 * server-only runtime code.
 *
 * Every event here corresponds to a REAL MCP `tools/call` this process just
 * handled — never a fabricated or simulated one. Events are scoped by
 * `worldId`, never `repositoryId` alone — two Worlds analyzed from the same
 * repository must never see each other's events.
 *
 * Publishing durably appends to `worldStore` (Blob-backed in production)
 * rather than an in-memory `EventEmitter` — this is what makes the agent's
 * world-action land in the browser even when the agent's MCP call and the
 * browser's SSE connection (src/server/api-handlers/bobEvents.ts, which
 * polls `worldStore.getEventsSince`) are handled by different Vercel
 * instances. See docs/VERCEL_DEPLOYMENT.md §3 for the failure mode this
 * replaces, and docs/WORLD_ARCHITECTURE.md for the full design.
 */
class AgentEventBus {
  publish(event: AgentEvent): void {
    worldStore.appendEvent(event.worldId, event).catch((err) => {
      console.error("Failed to persist the agent event for world", event.worldId, err);
    });
  }
}

export const activityEventBus = new AgentEventBus();
