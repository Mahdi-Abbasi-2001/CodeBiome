import { NextRequest, NextResponse } from "next/server";
import { worldStore } from "@/server/world/worldStore";

/**
 * Reads a World back for the browser (docs/WORLD_ARCHITECTURE.md) — used by
 * `/world/[worldId]` on mount so opening a World's URL reconstructs the
 * whole CodeBiome experience (RKM, FlowModel, WorldModel, and whatever
 * domain concepts/onboarding journeys/session context the agent or an earlier
 * visit already contributed) without the developer re-entering the GitHub
 * URL.
 *
 * Deliberately its own separate, literal route rather than folded into
 * `/api/bridge` — it has no cross-endpoint in-memory state dependency (it
 * only reads `worldStore`, which is durable/Blob-backed in production and
 * therefore already consistent regardless of which Vercel instance handles
 * this request), so it doesn't need to share a process with `/api/mcp` etc.
 * See docs/VERCEL_DEPLOYMENT.md §3 for why THOSE four do need to share one.
 */
export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: { worldId: string } }) {
  const snapshot = await worldStore.getSnapshot(params.worldId);
  if (!snapshot) {
    return NextResponse.json({ error: `No CodeBiome world "${params.worldId}" was found. It may have expired, or the id may be wrong.` }, { status: 404 });
  }
  const mutableState = await worldStore.getMutableState(params.worldId);
  return NextResponse.json({ snapshot, mutableState });
}
