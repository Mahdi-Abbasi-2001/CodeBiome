import { NextRequest } from "next/server";
import { worldStore } from "@/server/world/worldStore";

/**
 * Server-Sent Events stream of real Bob activity for one World — the live
 * bridge described in docs/BOB_INTEGRATION.md "How Bob's output gets
 * reflected in the CodeBiome UI" and docs/WORLD_ARCHITECTURE.md "Browser <->
 * Bob event routing". The browser (src/features/bob/useBobBridge.ts) opens
 * this once a World is loaded; every event it receives corresponds to an
 * actual MCP tool call CodeBiome's server just handled — there is no
 * simulated or scheduled traffic here.
 *
 * Reads exclusively through `worldStore.getEventsSince` (durable,
 * Blob-backed in production) rather than the old in-memory-only push —
 * this is what makes Bob's world-action land in the browser even when
 * Bob's MCP call and this SSE connection are handled by different Vercel
 * instances (empirically confirmed to happen often enough to matter, see
 * docs/VERCEL_DEPLOYMENT.md §3). The tradeoff, made deliberately: events
 * arrive on a short poll (`POLL_INTERVAL_MS`) instead of instantly — a
 * human watching a demo cannot tell the difference between instant and
 * ~1.5s, and a single delivery mechanism that's correct everywhere beats an
 * instant one that silently misses cross-instance events.
 *
 * On Vercel this connection is force-closed after the function's
 * `maxDuration`; the browser's native `EventSource` auto-reconnects and
 * replays full history from `worldStore`, so live reactions keep working
 * across that reconnect too.
 */
const POLL_INTERVAL_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function handleBobEvents(req: NextRequest): Promise<Response> {
  const worldId = req.nextUrl.searchParams.get("worldId");
  if (!worldId) {
    return new Response(JSON.stringify({ error: "worldId is required" }), { status: 400 });
  }

  const encoder = new TextEncoder();
  let cancelled = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      let cursor = 0;
      try {
        const initial = await worldStore.getEventsSince(worldId, 0);
        for (const event of initial.events) send(event);
        cursor = initial.latestIndex;
      } catch {
        // A fresh World with no events yet, or a transient read error —
        // either way, start from an empty cursor and let the poll loop
        // below catch up on the next tick.
      }

      while (!cancelled) {
        await sleep(POLL_INTERVAL_MS);
        if (cancelled) break;
        try {
          const { events, latestIndex } = await worldStore.getEventsSince(worldId, cursor);
          for (const event of events) send(event);
          cursor = latestIndex;
        } catch {
          // Transient Blob read error — try again next tick rather than
          // killing the connection over one failed poll.
        }
      }
      controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
