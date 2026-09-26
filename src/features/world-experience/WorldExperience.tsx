"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { WorldHud, type WalkthroughHudState, type OnboardingHudState } from "@/features/hud/WorldHud";
import { InvestigationPanel } from "@/features/investigation-panel/InvestigationPanel";
import { FlowExplorer } from "@/features/flow-explorer/FlowExplorer";
import { DomainConceptsPanel } from "@/features/bob/DomainConceptsPanel";
import { OnboardingJourneyPanel } from "@/features/bob/OnboardingJourneyPanel";
import { BobFocusHud } from "@/features/bob/BobFocusHud";
import { useBobBridge } from "@/features/bob/useBobBridge";
import type { DomainConceptEvent, OnboardingJourneyEvent } from "@/types/bob-events";
import type { RepositoryKnowledgeModel } from "@/types/knowledge-model";
import type { WorldModel } from "@/types/world-model";
import type { FlowModel } from "@/types/flow";
import type { ExplorationUpdate, BobFocus } from "@/world-engine/WorldView";
import type { Lens } from "@/world-engine/lens";
import { computeDomains } from "@/world-engine/domains";

// The 3D world is loaded only once a World is available — the landing/
// scanning screens (still owned by src/app/page.tsx) never pay for the
// three.js bundle (Step 15).
const WorldView = dynamic(() => import("@/world-engine/WorldView").then((m) => m.WorldView), {
  ssr: false,
  loading: () => <div className="flex h-full w-full items-center justify-center text-ink-muted">Loading world…</div>,
});

const EMPTY_EXPLORATION: ExplorationUpdate = {
  nearestRegionName: null,
  visitedCount: 0,
  totalCount: 0,
  avatarPosition: [0, 0],
};

/**
 * The CodeBiome 3D world experience for ONE World (docs/WORLD_ARCHITECTURE.md)
 * — everything that used to live inline in src/app/page.tsx's "world" phase,
 * extracted so it can be mounted from `/world/[worldId]` regardless of
 * whether that World was created by a developer pasting a GitHub URL
 * (browser-first) or by Bob calling `analyze_repository` (Bob-first). Both
 * paths produce the same World abstraction and land here.
 */
export function WorldExperience({
  worldId,
  owner,
  repo,
  knowledgeModel,
  worldModel,
  flowModel,
  initialDomainConcepts,
  initialOnboardingJourneys,
}: {
  worldId: string;
  owner: string;
  repo: string;
  knowledgeModel: RepositoryKnowledgeModel;
  worldModel: WorldModel;
  flowModel: FlowModel;
  initialDomainConcepts: DomainConceptEvent["concept"][];
  initialOnboardingJourneys: OnboardingJourneyEvent["journey"][];
}) {
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [exploration, setExploration] = useState<ExplorationUpdate>(EMPTY_EXPLORATION);

  // Lenses (product brief: "one persistent spatial model with multiple
  // visual lenses"). `focusedDomainId` is the progressive-disclosure
  // drill-down state — null means the Architecture overview (domains only);
  // set means a domain has been "entered" and its modules are revealed.
  const [lens, setLens] = useState<Lens>("architecture");
  const [focusedDomainId, setFocusedDomainId] = useState<string | null>(null);

  // Bob's OWN physical focus in the world — set only by genuine Bob MCP
  // actions that aren't already covered by an active Flow/Onboarding route
  // (open_module, open_file, show_dependencies, show_impact). Never set by
  // the developer's own clicks (handleSelectEntity) or CodeBiome itself —
  // this is exactly "Bob should physically move through the architecture
  // when investigating something," driven only by real tool calls.
  const [bobDirectFocus, setBobDirectFocus] = useState<{ moduleId: string; why: string | null } | null>(null);

  // Domain grouping is a pure, client-side derived view of the real World
  // Model (src/world-engine/domains.ts) — computed here too (not just
  // inside WorldView) so selecting/focusing a module can automatically
  // reveal the domain it lives on, wherever the selection came from.
  const domains = useMemo(() => computeDomains(worldModel, knowledgeModel), [worldModel, knowledgeModel]);
  const domainIdForModule = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of domains) for (const id of d.moduleIds) m.set(id, d.id);
    return m;
  }, [domains]);

  const moduleWhy = useCallback(
    (moduleId: string): string | null => {
      const landmark = worldModel.landmarks.find((l) => l.sourceEntityKind === "module" && l.sourceEntityId === moduleId);
      if (landmark?.label) return landmark.label;
      const mod = knowledgeModel.modules.find((m) => m.id === moduleId);
      if (mod?.description) return mod.description;
      if (mod && mod.importance >= 0.6) return "Central to this workflow — high architectural importance";
      return null;
    },
    [worldModel, knowledgeModel]
  );

  // Whatever is selected (however it got selected — a developer click, a
  // Bob action, or a Flow/Onboarding step landing there) automatically
  // reveals the domain it lives on, so the Investigation Panel is never
  // open on a module whose building isn't actually visible.
  useEffect(() => {
    if (!selectedModuleId) return;
    const domainId = domainIdForModule.get(selectedModuleId);
    if (domainId) setFocusedDomainId(domainId);
  }, [selectedModuleId, domainIdForModule]);

  // Feature/Flow Walkthrough state. `activeFlowId` + `currentStepIndex`
  // track the walkthrough's own position; `selectedModuleId` (above) tracks
  // whatever the user is actually LOOKING at right now — the two are allowed
  // to diverge (that divergence IS "paused for exploration"), and re-synced
  // by Resume. No separate "paused" flag is needed: it's derived below.
  const [flowExplorerOpen, setFlowExplorerOpen] = useState(false);
  const [activeFlowId, setActiveFlowId] = useState<string | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  // IBM Bob (docs/BOB_INTEGRATION.md) drives these same states through real
  // MCP tool calls, not through any code path of its own — see the handlers
  // passed to useBobBridge below. `requestedTab`/`requestedFilePath` carry
  // one-shot navigation requests (a Bob `show_dependencies`/`open_file`
  // call) into the Investigation Panel; `bobImpactHighlight` is the
  // world-highlight set for `show_impact` when no flow walkthrough is
  // already highlighting something.
  const [requestedTab, setRequestedTab] = useState<{ tab: "overview" | "code" | "dependencies" | "dependents" | "health" | "flow" | "bob"; nonce: number } | null>(null);
  const [requestedFilePath, setRequestedFilePath] = useState<{ path: string; nonce: number } | null>(null);
  const [bobImpactHighlight, setBobImpactHighlight] = useState<Set<string> | null>(null);

  // The AI-interpretation layer (docs/BOB_INTEGRATION.md §14). Concepts
  // themselves live in useBobBridge (server-sourced, real); this is just
  // "which one is the developer currently highlighting in the world".
  const [domainConceptsOpen, setDomainConceptsOpen] = useState(false);
  const [domainConceptHighlight, setDomainConceptHighlight] = useState<Set<string> | null>(null);

  // Bob's onboarding journeys (docs/BOB_INTEGRATION.md, src/types/onboarding.ts).
  // Journeys themselves live in useBobBridge (server-sourced, real); this is
  // "which journey/step is the developer currently walking" — the same
  // shape as activeFlowId/currentStepIndex above, kept as its own track
  // since a journey isn't a Flow and can reference modules a single
  // reconstructed flow never touches.
  const [onboardingJourneysOpen, setOnboardingJourneysOpen] = useState(false);
  const [activeOnboardingJourneyId, setActiveOnboardingJourneyId] = useState<string | null>(null);
  const [currentOnboardingStepIndex, setCurrentOnboardingStepIndex] = useState(0);

  const activeFlow = useMemo(
    () => (activeFlowId ? flowModel.flows.find((f) => f.id === activeFlowId) ?? null : null),
    [flowModel, activeFlowId]
  );
  const currentStep = activeFlow?.steps[currentStepIndex] ?? null;
  const paused = activeFlow !== null && currentStep !== null && selectedModuleId !== currentStep.moduleId;

  const flowHighlightModuleIds = useMemo(() => {
    if (!activeFlow) return null;
    return new Set(activeFlow.steps.map((s) => s.moduleId).filter((id): id is string => id !== null));
  }, [activeFlow]);

  const handleSelectEntity = useCallback((sourceEntityId: string) => {
    setSelectedModuleId(sourceEntityId);
    setBobImpactHighlight(null);
    setDomainConceptHighlight(null);
  }, []);

  const handleClose = useCallback(() => {
    setSelectedModuleId(null);
  }, []);

  const handleStartFlow = useCallback(
    (flowId: string) => {
      const flow = flowModel.flows.find((f) => f.id === flowId);
      if (!flow) return;
      setActiveFlowId(flowId);
      setCurrentStepIndex(0);
      setSelectedModuleId(flow.steps[0].moduleId);
      setFlowExplorerOpen(false);
      setLens("flow");
    },
    [flowModel]
  );

  const handleContinueFlow = useCallback(() => {
    if (!activeFlow) return;
    const nextIndex = currentStepIndex + 1;
    if (nextIndex >= activeFlow.steps.length) {
      setActiveFlowId(null);
      return;
    }
    setCurrentStepIndex(nextIndex);
    setSelectedModuleId(activeFlow.steps[nextIndex].moduleId);
  }, [activeFlow, currentStepIndex]);

  const handleResumeFlow = useCallback(() => {
    if (!activeFlow || !currentStep) return;
    setSelectedModuleId(currentStep.moduleId);
  }, [activeFlow, currentStep]);

  const handleExitFlow = useCallback(() => {
    setActiveFlowId(null);
    setLens("architecture");
  }, []);

  // The IBM Bob world-action handlers — see docs/BOB_INTEGRATION.md "How
  // Bob's output gets reflected in the CodeBiome UI". Each one reuses the
  // SAME state transitions a human clicking the UI would trigger; a real,
  // externally connected Bob session calling e.g. `start_flow` over MCP
  // ends up on exactly this code path, not a separate one.
  const handleBobOpenModule = useCallback(
    (moduleId: string) => {
      setSelectedModuleId(moduleId);
      setBobImpactHighlight(null);
      setDomainConceptHighlight(null);
      setBobDirectFocus({ moduleId, why: moduleWhy(moduleId) });
    },
    [moduleWhy]
  );

  const handleBobStartFlow = useCallback(
    (flowId: string) => {
      handleStartFlow(flowId);
      setLens("flow");
    },
    [handleStartFlow]
  );

  const handleBobFocusFlowStep = useCallback(
    (flowId: string, stepIndex: number) => {
      const flow = flowModel.flows.find((f) => f.id === flowId);
      if (!flow || stepIndex < 0 || stepIndex >= flow.steps.length) return;
      setActiveFlowId(flowId);
      setCurrentStepIndex(stepIndex);
      setSelectedModuleId(flow.steps[stepIndex].moduleId);
      setLens("flow");
    },
    [flowModel]
  );

  const handleBobOpenFile = useCallback(
    (path: string, moduleId: string | null, _line: number | null) => {
      if (!moduleId) return;
      setSelectedModuleId(moduleId);
      setRequestedTab({ tab: "code", nonce: Date.now() });
      setRequestedFilePath({ path, nonce: Date.now() });
      setBobDirectFocus({ moduleId, why: moduleWhy(moduleId) });
    },
    [moduleWhy]
  );

  const handleBobShowDependencies = useCallback(
    (moduleId: string) => {
      setSelectedModuleId(moduleId);
      setRequestedTab({ tab: "dependencies", nonce: Date.now() });
      setBobDirectFocus({ moduleId, why: moduleWhy(moduleId) });
      setLens("dependencies");
    },
    [moduleWhy]
  );

  const handleBobShowImpact = useCallback(
    (moduleId: string, affectedModuleIds: string[]) => {
      setSelectedModuleId(moduleId);
      setRequestedTab({ tab: "dependents", nonce: Date.now() });
      setBobImpactHighlight(new Set(affectedModuleIds));
      setBobDirectFocus({ moduleId, why: moduleWhy(moduleId) });
      setLens("dependencies");
    },
    [moduleWhy]
  );

  // Bob's onboarding-journey world action (create_onboarding_journey's
  // implicit step-0 focus, or a later advance_onboarding_step call) — the
  // action itself carries the moduleId directly, so this never depends on
  // the journey already having arrived in `onboardingJourneys` below.
  const handleBobFocusOnboardingStep = useCallback((journeyId: string, _journeyName: string, stepIndex: number, moduleId: string, _reason: string) => {
    setActiveOnboardingJourneyId(journeyId);
    setCurrentOnboardingStepIndex(stepIndex);
    setSelectedModuleId(moduleId);
    setBobImpactHighlight(null);
    setDomainConceptHighlight(null);
    setLens("onboarding");
  }, []);

  const { activity: bobActivity, connected: bobConnected, domainConcepts, onboardingJourneys } = useBobBridge(
    worldId,
    {
      onOpenModule: handleBobOpenModule,
      onStartFlow: handleBobStartFlow,
      onFocusFlowStep: handleBobFocusFlowStep,
      onOpenFile: handleBobOpenFile,
      onShowDependencies: handleBobShowDependencies,
      onShowImpact: handleBobShowImpact,
      onFocusOnboardingStep: handleBobFocusOnboardingStep,
    },
    { domainConcepts: initialDomainConcepts, onboardingJourneys: initialOnboardingJourneys }
  );

  const handleSelectDomainConcept = useCallback((concept: DomainConceptEvent["concept"]) => {
    setDomainConceptHighlight(new Set(concept.relatedModuleIds));
    setBobImpactHighlight(null);
    if (concept.relatedModuleIds[0]) setSelectedModuleId(concept.relatedModuleIds[0]);
    setDomainConceptsOpen(false);
  }, []);

  // Onboarding-journey walkthrough state — same "paused = diverged from the
  // current step by manual selection" derivation as the flow walkthrough
  // above, applied to Bob-authored journeys instead of a reconstructed flow.
  const activeOnboardingJourney = useMemo(
    () => (activeOnboardingJourneyId ? onboardingJourneys.find((j) => j.id === activeOnboardingJourneyId) ?? null : null),
    [onboardingJourneys, activeOnboardingJourneyId]
  );
  const currentOnboardingStep = activeOnboardingJourney?.steps[currentOnboardingStepIndex] ?? null;
  const onboardingPaused =
    activeOnboardingJourney !== null && currentOnboardingStep !== null && selectedModuleId !== currentOnboardingStep.moduleId;
  const onboardingHighlightModuleIds = useMemo(
    () => (activeOnboardingJourney ? new Set(activeOnboardingJourney.steps.map((s) => s.moduleId)) : null),
    [activeOnboardingJourney]
  );

  const handleStartOnboardingJourney = useCallback(
    (journeyId: string) => {
      const journey = onboardingJourneys.find((j) => j.id === journeyId);
      if (!journey) return;
      setActiveOnboardingJourneyId(journeyId);
      setCurrentOnboardingStepIndex(0);
      setSelectedModuleId(journey.steps[0].moduleId);
      setOnboardingJourneysOpen(false);
      setLens("onboarding");
    },
    [onboardingJourneys]
  );

  const handleContinueOnboarding = useCallback(() => {
    if (!activeOnboardingJourney) return;
    const nextIndex = currentOnboardingStepIndex + 1;
    if (nextIndex >= activeOnboardingJourney.steps.length) {
      setActiveOnboardingJourneyId(null);
      return;
    }
    setCurrentOnboardingStepIndex(nextIndex);
    setSelectedModuleId(activeOnboardingJourney.steps[nextIndex].moduleId);
  }, [activeOnboardingJourney, currentOnboardingStepIndex]);

  const handleResumeOnboarding = useCallback(() => {
    if (!activeOnboardingJourney || !currentOnboardingStep) return;
    setSelectedModuleId(currentOnboardingStep.moduleId);
  }, [activeOnboardingJourney, currentOnboardingStep]);

  const handleExitOnboarding = useCallback(() => {
    setActiveOnboardingJourneyId(null);
    setLens("architecture");
  }, []);

  // Reports "what the developer is currently looking at" to the server so a
  // connected Bob session can resolve "explain this module" / "what depends
  // on this" without the developer repeating a name — see
  // src/server/bob-tools/repositoryTools.ts (`getCurrentContext`) and
  // docs/BOB_INTEGRATION.md. Scoped by World id (docs/WORLD_ARCHITECTURE.md),
  // not repositoryId. Fire-and-forget: this is a best-effort signal, not
  // something the UI depends on getting through.
  useEffect(() => {
    const selectedModuleName = selectedModuleId ? knowledgeModel.modules.find((m) => m.id === selectedModuleId)?.name ?? null : null;
    fetch("/api/session-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        worldId,
        selectedModuleId,
        selectedModuleName,
        activeFlowId: activeFlow?.id ?? null,
        activeFlowName: activeFlow?.name ?? null,
        currentStepId: currentStep?.id ?? null,
        currentStepLabel: currentStep?.label ?? null,
        activeOnboardingJourneyId: activeOnboardingJourney?.id ?? null,
        activeOnboardingJourneyTitle: activeOnboardingJourney?.title ?? null,
        currentOnboardingStepIndex: activeOnboardingJourney ? currentOnboardingStepIndex : null,
        currentOnboardingStepReason: currentOnboardingStep?.reason ?? null,
      }),
    }).catch(() => {});
  }, [worldId, knowledgeModel, selectedModuleId, activeFlow, currentStep, activeOnboardingJourney, currentOnboardingStepIndex, currentOnboardingStep]);

  const selectedName = selectedModuleId ? knowledgeModel.modules.find((m) => m.id === selectedModuleId)?.name ?? null : null;
  const moduleNameById = new Map(knowledgeModel.modules.map((m) => [m.id, m.name]));

  const walkthroughHud: WalkthroughHudState | null =
    activeFlow && currentStep
      ? {
          flowName: activeFlow.name,
          stepIndex: currentStepIndex,
          totalSteps: activeFlow.steps.length,
          currentStepLabel: currentStep.label,
          paused,
          onContinue: handleContinueFlow,
          onResume: handleResumeFlow,
          onExit: handleExitFlow,
        }
      : null;

  // Bob's resolved world position: an active Flow/Onboarding step always
  // takes priority (Bob is "guiding" that walkthrough regardless of who
  // clicked Continue), otherwise Bob's own last direct MCP-driven focus.
  const bobFocus: BobFocus | null =
    activeFlow && currentStep && currentStep.moduleId
      ? { moduleId: currentStep.moduleId, fileId: currentStep.entityId }
      : activeOnboardingJourney && currentOnboardingStep
        ? { moduleId: currentOnboardingStep.moduleId, fileId: null }
        : bobDirectFocus
          ? { moduleId: bobDirectFocus.moduleId, fileId: null }
          : null;
  const bobActive = bobFocus !== null;
  const bobWhy = activeFlow && currentStep ? currentStep.explanation : activeOnboardingJourney && currentOnboardingStep ? currentOnboardingStep.reason : bobDirectFocus?.why ?? null;
  const bobNext = activeFlow && currentStep ? activeFlow.steps[currentStepIndex + 1]?.label ?? null : activeOnboardingJourney && currentOnboardingStep ? activeOnboardingJourney.steps[currentOnboardingStepIndex + 1]?.moduleName ?? null : null;
  const bobFocusModuleName = bobFocus ? knowledgeModel.modules.find((m) => m.id === bobFocus.moduleId)?.name ?? bobFocus.moduleId : null;

  // The Activity lens' highlight set — every module a real recent MCP tool
  // call actually referenced (never synthesized), plus wherever Bob is
  // focused right now.
  const activityModuleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const event of bobActivity) {
      const moduleId = (event.args as Record<string, unknown> | undefined)?.moduleId;
      if (typeof moduleId === "string") ids.add(moduleId);
    }
    if (bobFocus) ids.add(bobFocus.moduleId);
    return ids;
  }, [bobActivity, bobFocus]);

  const activeOnboardingModuleIds = activeOnboardingJourney ? activeOnboardingJourney.steps.map((s) => s.moduleId) : null;

  // Clicking empty ground: close the Investigation Panel first (if open),
  // otherwise zoom back out to the domain overview (if a domain is
  // entered) — one click at a time, same "undo the most recent zoom-in
  // step" feel as a map application.
  // Selecting the Flow/Onboarding lens with nothing active yet opens the
  // picker that starts one, rather than switching to an empty lens — the
  // lens switcher and "Explore a Feature"/"Bob's Onboarding" pickers are
  // two views of the same underlying action.
  const handleChangeLens = useCallback(
    (next: Lens) => {
      if (next === "flow" && !activeFlow) {
        setFlowExplorerOpen(true);
        return;
      }
      if (next === "onboarding" && !activeOnboardingJourney) {
        setOnboardingJourneysOpen(true);
        return;
      }
      setLens(next);
    },
    [activeFlow, activeOnboardingJourney]
  );

  const handleBackgroundClick = useCallback(() => {
    if (selectedModuleId !== null) {
      setSelectedModuleId(null);
      return;
    }
    setFocusedDomainId(null);
  }, [selectedModuleId]);

  const onboardingWalkthroughHud: OnboardingHudState | null =
    activeOnboardingJourney && currentOnboardingStep
      ? {
          journeyTitle: activeOnboardingJourney.title,
          stepIndex: currentOnboardingStepIndex,
          totalSteps: activeOnboardingJourney.steps.length,
          currentModuleName: currentOnboardingStep.moduleName,
          currentReason: currentOnboardingStep.reason,
          paused: onboardingPaused,
          onContinue: handleContinueOnboarding,
          onResume: handleResumeOnboarding,
          onExit: handleExitOnboarding,
        }
      : null;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-biome-bg">
      <WorldView
        worldModel={worldModel}
        knowledgeModel={knowledgeModel}
        lens={lens}
        focusedDomainId={focusedDomainId}
        onFocusDomain={setFocusedDomainId}
        selectedModuleId={selectedModuleId}
        onSelectEntity={handleSelectEntity}
        onDeselect={handleBackgroundClick}
        onExplorationUpdate={setExploration}
        flowHighlightModuleIds={flowHighlightModuleIds ?? onboardingHighlightModuleIds ?? bobImpactHighlight ?? domainConceptHighlight}
        activeFlow={lens === "flow" ? activeFlow : null}
        currentFlowStepId={currentStep?.id ?? null}
        activeOnboardingModuleIds={lens === "onboarding" ? activeOnboardingModuleIds : null}
        bobFocus={bobFocus}
        bobActive={bobActive}
        activityModuleIds={lens === "activity" ? activityModuleIds : null}
      />
      <WorldHud
        owner={owner}
        repo={repo}
        currentRegionName={exploration.nearestRegionName}
        selectedName={selectedName}
        visitedCount={exploration.visitedCount}
        totalCount={exploration.totalCount}
        avatarPosition={exploration.avatarPosition}
        worldModel={worldModel}
        knowledgeModel={knowledgeModel}
        lens={lens}
        onChangeLens={handleChangeLens}
        focusedDomainId={focusedDomainId}
        onZoomOut={() => setFocusedDomainId(null)}
        onOpenDomainConcepts={() => setDomainConceptsOpen(true)}
        walkthrough={walkthroughHud}
        onboardingWalkthrough={onboardingWalkthroughHud}
        bobActivity={bobActivity}
        bobConnected={bobConnected}
        domainConceptCount={domainConcepts.length}
        onboardingJourneyCount={onboardingJourneys.length}
      />
      {bobFocus && bobFocusModuleName && (
        <BobFocusHud moduleName={bobFocusModuleName} why={bobWhy} next={bobNext} />
      )}
      {selectedModuleId && (
        <div className="absolute inset-y-0 right-0 z-10">
          <InvestigationPanel
            knowledgeModel={knowledgeModel}
            moduleId={selectedModuleId}
            onClose={handleClose}
            activeFlow={activeFlow}
            currentStepId={currentStep?.id ?? null}
            onContinueFlow={handleContinueFlow}
            onResumeFlow={handleResumeFlow}
            onExitFlow={handleExitFlow}
            requestedTab={requestedTab}
            requestedFilePath={requestedFilePath}
          />
        </div>
      )}
      {flowExplorerOpen && (
        <FlowExplorer flows={flowModel.flows} onSelectFlow={handleStartFlow} onClose={() => setFlowExplorerOpen(false)} />
      )}
      {domainConceptsOpen && (
        <DomainConceptsPanel
          concepts={domainConcepts}
          moduleNameById={moduleNameById}
          onSelectConcept={handleSelectDomainConcept}
          onClose={() => setDomainConceptsOpen(false)}
        />
      )}
      {onboardingJourneysOpen && (
        <OnboardingJourneyPanel
          journeys={onboardingJourneys}
          onStartJourney={handleStartOnboardingJourney}
          onClose={() => setOnboardingJourneysOpen(false)}
        />
      )}
    </div>
  );
}
