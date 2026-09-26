"use client";

import { useEffect, useRef, useState } from "react";
import type { ActivityEvent, BobEvent, DomainConceptEvent, OnboardingJourneyEvent, WorldAction } from "@/types/bob-events";

export interface BobBridgeHandlers {
  onOpenModule: (moduleId: string) => void;
  onStartFlow: (flowId: string) => void;
  onFocusFlowStep: (flowId: string, stepIndex: number) => void;
  onOpenFile: (path: string, moduleId: string | null, line: number | null) => void;
  onShowDependencies: (moduleId: string) => void;
  onShowImpact: (moduleId: string, affectedModuleIds: string[]) => void;
  onFocusOnboardingStep: (journeyId: string, journeyName: string, stepIndex: number, moduleId: string, reason: string) => void;
}

function applyAction(action: WorldAction, handlers: BobBridgeHandlers) {
  switch (action.type) {
    case "open_module":
      handlers.onOpenModule(action.moduleId);
      break;
    case "start_flow":
      handlers.onStartFlow(action.flowId);
      break;
    case "focus_flow_step":
      handlers.onFocusFlowStep(action.flowId, action.stepIndex);
      break;
    case "open_file":
      handlers.onOpenFile(action.path, action.moduleId, action.line);
      break;
    case "show_dependencies":
      handlers.onShowDependencies(action.moduleId);
      break;
    case "show_impact":
      handlers.onShowImpact(action.moduleId, action.affectedModuleIds);
      break;
    case "focus_onboarding_step":
      handlers.onFocusOnboardingStep(action.journeyId, action.journeyName, action.stepIndex, action.moduleId, action.reason);
      break;
  }
}

/**
 * Subscribes the browser to real, live MCP tool-call activity for the
 * World currently open (docs/WORLD_ARCHITECTURE.md) — see
 * docs/BOB_INTEGRATION.md. Every event here was published because a real,
 * externally connected IBM Bob session actually called a CodeBiome tool
 * against THIS World; nothing is simulated client-side, and an event from a
 * different World never reaches this hook (scoped by `worldId` end to end:
 * src/server/bob/eventBus.ts -> src/server/api-handlers/bobEvents.ts ->
 * here). World-action events are applied immediately via `handlers`; every
 * read-only tool call is kept in `activity` so the UI can show an honest
 * "what Bob is doing right now" log.
 *
 * `initialDomainConcepts`/`initialOnboardingJourneys` seed state that was
 * already contributed before this browser tab connected — e.g. Bob created
 * the World and an onboarding journey before the developer ever opened the
 * URL. The live SSE history replay (see bobEvents.ts) would eventually
 * surface the same data, but seeding it directly from the World's own
 * persisted mutable state is more robust (immune to the event log's bounded
 * retention) and shows up on first paint instead of after the initial
 * connection round-trip.
 */
export function useBobBridge(
  worldId: string | null,
  handlers: BobBridgeHandlers,
  initial?: { domainConcepts?: DomainConceptEvent["concept"][]; onboardingJourneys?: OnboardingJourneyEvent["journey"][] }
) {
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [domainConcepts, setDomainConcepts] = useState<DomainConceptEvent["concept"][]>(initial?.domainConcepts ?? []);
  const [onboardingJourneys, setOnboardingJourneys] = useState<OnboardingJourneyEvent["journey"][]>(initial?.onboardingJourneys ?? []);
  const [connected, setConnected] = useState(false);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!worldId) {
      setActivity([]);
      setConnected(false);
      return;
    }

    setActivity([]);
    const source = new EventSource(`/api/bob-events?worldId=${encodeURIComponent(worldId)}`);
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (event) => {
      const parsed: BobEvent = JSON.parse(event.data);
      if (parsed.kind === "world-action") applyAction(parsed.action, handlersRef.current);
      else if (parsed.kind === "domain-concept") {
        setDomainConcepts((prev) => (prev.some((c) => c.id === parsed.concept.id) ? prev : [...prev, parsed.concept]));
      } else if (parsed.kind === "onboarding-journey") {
        setOnboardingJourneys((prev) => (prev.some((j) => j.id === parsed.journey.id) ? prev : [...prev, parsed.journey]));
      } else {
        setActivity((prev) => [...prev.slice(-49), parsed]);
      }
    };

    return () => {
      source.close();
      setConnected(false);
    };
  }, [worldId]);

  return { activity, connected, domainConcepts, onboardingJourneys };
}
