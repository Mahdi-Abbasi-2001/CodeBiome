import { NextRequest, NextResponse } from "next/server";
import { sessionContextStore, type SessionContext } from "@/server/agent/sessionContext";

/**
 * The browser POSTs here whenever the developer's selection/walkthrough
 * state changes (see the effect in src/features/world-experience/
 * WorldExperience.tsx) — this is the only way CodeBiome's server (and
 * therefore the `get_current_context` MCP tool) can know what's currently
 * on screen, since that state lives in React, not on the server. See
 * src/server/agent/sessionContext.ts.
 *
 * Keyed by World id (docs/WORLD_ARCHITECTURE.md), not repositoryId — reads
 * through `worldStore`, so it's correct regardless of which Vercel instance
 * handles this request versus whichever handles the agent's `get_current_context`
 * call.
 */
export async function handleSessionContext(req: NextRequest): Promise<Response> {
  const body = (await req.json()) as Partial<SessionContext> & { worldId?: string };
  if (!body.worldId) {
    return NextResponse.json({ error: "worldId is required" }, { status: 400 });
  }

  await sessionContextStore.set(body.worldId, {
    selectedModuleId: body.selectedModuleId ?? null,
    selectedModuleName: body.selectedModuleName ?? null,
    activeFlowId: body.activeFlowId ?? null,
    activeFlowName: body.activeFlowName ?? null,
    currentStepId: body.currentStepId ?? null,
    currentStepLabel: body.currentStepLabel ?? null,
    activeOnboardingJourneyId: body.activeOnboardingJourneyId ?? null,
    activeOnboardingJourneyTitle: body.activeOnboardingJourneyTitle ?? null,
    currentOnboardingStepIndex: body.currentOnboardingStepIndex ?? null,
    currentOnboardingStepReason: body.currentOnboardingStepReason ?? null,
    updatedAt: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true });
}
