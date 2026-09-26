"use client";

import { useMemo } from "react";
import type { WorldModel } from "@/types/world-model";
import type { RepositoryKnowledgeModel } from "@/types/knowledge-model";
import type { ActivityEvent } from "@/types/bob-events";
import { layoutDomains, maxLayoutRadius } from "@/lib/worldLayout";
import { computeDomains } from "@/world-engine/domains";
import { computeDomainSequence } from "@/world-engine/sequenceLayout";
import { hasStructuralRisk } from "@/world-engine/buildingRoles";
import { BobActivityFeed } from "@/features/bob/BobActivityFeed";
import { LENSES, type Lens } from "@/world-engine/lens";

const HEALTH_DOT: Record<string, string> = {
  thriving: "#F2B84B",
  healthy: "#3FA672",
  stressed: "#F2B84B",
  critical: "#E0553F",
};

export interface WalkthroughHudState {
  flowName: string;
  stepIndex: number; // 0-based
  totalSteps: number;
  currentStepLabel: string;
  paused: boolean;
  onContinue: () => void;
  onResume: () => void;
  onExit: () => void;
}

export interface OnboardingHudState {
  journeyTitle: string;
  stepIndex: number; // 0-based
  totalSteps: number;
  currentModuleName: string;
  currentReason: string;
  paused: boolean;
  onContinue: () => void;
  onResume: () => void;
  onExit: () => void;
}

export function WorldHud({
  owner,
  repo,
  currentRegionName,
  selectedName,
  visitedCount,
  totalCount,
  avatarPosition,
  worldModel,
  knowledgeModel,
  lens,
  onChangeLens,
  focusedDomainId = null,
  onZoomOut,
  onOpenDomainConcepts,
  walkthrough = null,
  onboardingWalkthrough = null,
  bobActivity = [],
  bobConnected = false,
  domainConceptCount = 0,
  onboardingJourneyCount = 0,
}: {
  owner: string;
  repo: string;
  currentRegionName: string | null;
  selectedName: string | null;
  visitedCount: number;
  totalCount: number;
  avatarPosition: [number, number];
  worldModel: WorldModel;
  knowledgeModel: RepositoryKnowledgeModel;
  /** The active visual lens (src/world-engine/lens.ts) — one persistent world, six emphases. */
  lens: Lens;
  onChangeLens: (lens: Lens) => void;
  /** The domain currently "entered" (progressive disclosure), if any — drives the hierarchy panel and the "Zoom out" control. */
  focusedDomainId?: string | null;
  onZoomOut?: () => void;
  onOpenDomainConcepts: () => void;
  walkthrough?: WalkthroughHudState | null;
  /** Bob's own guided journey, distinct from a deterministic flow walkthrough — see src/types/onboarding.ts. Takes precedence over `walkthrough` in the HUD's bottom-left card when both would otherwise apply. */
  onboardingWalkthrough?: OnboardingHudState | null;
  /** Real MCP tool-call activity from a connected IBM Bob session — see src/features/bob/useBobBridge.ts. Empty until Bob actually calls a tool. */
  bobActivity?: ActivityEvent[];
  bobConnected?: boolean;
  /** How many AI-interpreted domain concepts Bob has contributed so far — see src/server/bob/domainConceptStore.ts. */
  domainConceptCount?: number;
  /** How many onboarding journeys Bob has created so far — see src/server/bob/onboardingJourneyStore.ts. */
  onboardingJourneyCount?: number;
}) {
  const percent = totalCount > 0 ? Math.round((visitedCount / totalCount) * 100) : 0;
  const circumference = 2 * Math.PI * 15;
  const dashOffset = circumference * (1 - percent / 100);

  const domains = useMemo(() => computeDomains(worldModel, knowledgeModel), [worldModel, knowledgeModel]);

  // The minimap reflects the new spatial model — one continuous landmass
  // with districts on it — plotting real Domains (src/world-engine/
  // domains.ts) at their actual district positions, not the old flat
  // per-module layout.
  const { dots, radius } = useMemo(() => {
    const positions = layoutDomains(domains);
    const maxR = maxLayoutRadius(positions);
    const dots = domains.map((d) => {
      const pos = positions.get(d.id) ?? [0, 0, 0];
      return { id: d.id, x: pos[0], z: pos[2], color: HEALTH_DOT[d.healthTier] ?? "#6B7580" };
    });
    return { dots, radius: maxR };
  }, [domains]);

  const toMinimap = (x: number, z: number) => {
    const s = 60 / (radius || 1);
    return { cx: 70 + x * s, cy: 70 + z * s };
  };

  // The hierarchy panel — "Repository › Domain", the entrance-to-
  // infrastructure sequence, and real per-domain stats (module/file/risk
  // counts) — shown only while a domain is entered, mirroring the locked
  // reference design's left panel.
  const focusedDomain = focusedDomainId ? domains.find((d) => d.id === focusedDomainId) ?? null : null;
  const domainStats = useMemo(() => {
    if (!focusedDomain) return null;
    const sequence = computeDomainSequence(focusedDomain, knowledgeModel);
    const fileCount = focusedDomain.moduleIds.reduce((sum, id) => sum + (knowledgeModel.modules.find((m) => m.id === id)?.fileIds.length ?? 0), 0);
    const riskFileCount = focusedDomain.moduleIds.reduce((sum, id) => {
      const mod = knowledgeModel.modules.find((m) => m.id === id);
      if (!mod) return sum;
      return sum + mod.fileIds.filter((fid) => hasStructuralRisk(knowledgeModel.files.find((f) => f.id === fid)?.riskIndicators ?? [])).length;
    }, 0);
    return { moduleCount: focusedDomain.moduleIds.length, fileCount, riskFileCount, buildingCount: sequence.buildings.length, hasYard: sequence.yard !== null };
  }, [focusedDomain, knowledgeModel]);

  return (
    <div className="pointer-events-none absolute inset-0 font-sans text-ink-primary">
      {/* top bar */}
      <div className="pointer-events-auto absolute inset-x-0 top-0 flex h-16 items-center justify-between bg-gradient-to-b from-biome-bg/85 to-transparent px-6">
        <div className="flex items-center gap-3.5">
          <div className="flex items-center gap-2">
            <LogoMark size={20} />
            <span className="font-display text-sm font-semibold">CodeBiome</span>
          </div>
          <span className="text-ink-dim">/</span>
          <div className="flex items-center gap-1.5 font-mono text-[13px] text-ink-secondary">
            <span>{owner}/{repo}</span>
            {currentRegionName && (
              <>
                <span className="text-ink-dim">›</span>
                <span className="text-amber">{currentRegionName}</span>
              </>
            )}
            {selectedName && (
              <>
                <span className="text-ink-dim">›</span>
                <span className="font-semibold text-ink-primary">{selectedName}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          {/* The lens switcher (src/world-engine/lens.ts) — one world, six
              emphases. Selecting Flow/Onboarding with nothing active yet
              opens the picker that starts one (see WorldExperience's
              handleChangeLens) rather than switching to an empty lens. */}
          <div className="flex rounded-full border border-white/10 bg-white/5 p-0.5">
            {LENSES.map((l) => (
              <button
                key={l.id}
                onClick={() => onChangeLens(l.id)}
                title={`${l.label} lens`}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  lens === l.id ? "bg-amber font-semibold text-amber-ink" : "text-ink-muted hover:text-ink-primary"
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
          {focusedDomainId && (
            <button
              onClick={onZoomOut}
              title="Return to the repository overview"
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-ink-secondary hover:text-ink-primary"
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                <path d="M4 10 8 4l4 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Zoom out
            </button>
          )}
          <button
            onClick={onOpenDomainConcepts}
            title="AI-interpreted concepts Bob has contributed — never a deterministic fact"
            className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
              domainConceptCount > 0
                ? "border-periwinkle/30 bg-periwinkle/10 text-periwinkle-pale"
                : "border-white/10 bg-white/5 text-ink-muted hover:text-ink-primary"
            }`}
          >
            Bob&apos;s Interpretation{domainConceptCount > 0 ? ` (${domainConceptCount})` : ""}
          </button>
        </div>
      </div>

      {/* exploration progress */}
      <div className="pointer-events-auto absolute right-6 top-[78px] flex items-center gap-2.5 rounded-xl border border-white/10 bg-biome-panel/70 px-3.5 py-2.5 backdrop-blur">
        <svg width="34" height="34" viewBox="0 0 36 36">
          <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="3" />
          <circle
            cx="18"
            cy="18"
            r="15"
            fill="none"
            stroke="#4FD1C5"
            strokeWidth="3"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            transform="rotate(-90 18 18)"
          />
        </svg>
        <div>
          <div className="text-xs font-medium text-ink-primary">
            {visitedCount} / {totalCount} landmarks
          </div>
          <div className="font-mono text-[11px] text-ink-muted">{percent}% explored</div>
        </div>
      </div>

      {/* Bob status (docs/BOB_INTEGRATION.md). Three real states, never a
          fake "thinking" animation: nothing has called CodeBiome's MCP
          tools yet; the bridge is up but idle; or real tool-call activity
          is arriving from a connected Bob session. Anchored top-LEFT
          (unlike the exploration/minimap widgets) so the Investigation
          Panel — which opens over the right half of the screen, exactly
          when Bob is most likely to be active — never covers it. */}
      <div className="pointer-events-auto absolute left-6 top-[78px] flex flex-col gap-3">
        {bobActivity.length > 0 ? (
          <BobActivityFeed activity={bobActivity} />
        ) : (
          <div className="flex w-[230px] items-center gap-2.5 rounded-xl border border-periwinkle/20 bg-periwinkle/[0.06] px-3 py-2.5">
            <div className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-periwinkle">
              B
            </div>
            <div className="text-xs leading-snug text-periwinkle-pale/80">
              {bobConnected
                ? "CodeBiome's MCP server is up, listening for a connected Bob session — no tool calls yet."
                : "Bob isn't connected yet — see docs/BOB_INTEGRATION.md to point IBM Bob at this repository's MCP server."}
            </div>
          </div>
        )}

        {/* The domain hierarchy panel — real per-domain stats, shown only
            while a domain is entered (mirrors the locked reference design's
            "REPOSITORY › DOMAIN" panel). */}
        {focusedDomain && domainStats && (
          <div className="w-[280px] rounded-xl border border-white/10 bg-biome-panel/85 p-4 backdrop-blur">
            <div className="mb-2 font-mono text-[10px] tracking-[1.2px] text-teal">
              REPOSITORY › {focusedDomain.name.toUpperCase()}
            </div>
            <div className="mb-3 flex flex-col gap-1.5 text-[11.5px] text-ink-secondary">
              <div>Entrance → hub → boundary → interface → infrastructure</div>
              {domainStats.hasYard && (
                <>
                  <div>
                    Plaza <span className="text-ink-muted">— application layer, at grade</span>
                  </div>
                  <div>
                    Recessed yard <span className="text-ink-muted">— persistence infrastructure</span>
                  </div>
                </>
              )}
            </div>
            <div className="border-t border-white/[0.08] pt-2.5 font-mono text-[11px] text-ink-muted">
              {domainStats.moduleCount} module{domainStats.moduleCount === 1 ? "" : "s"} · {domainStats.fileCount} file
              {domainStats.fileCount === 1 ? "" : "s"}
              {domainStats.riskFileCount > 0 && <span className="text-ember"> · {domainStats.riskFileCount} risk indicator{domainStats.riskFileCount === 1 ? "" : "s"}</span>}
            </div>
          </div>
        )}
      </div>

      {onboardingWalkthrough ? (
        <div className="pointer-events-auto absolute bottom-6 left-6 w-80 rounded-xl border border-periwinkle/30 bg-biome-panel/85 p-3.5 backdrop-blur">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-mono text-[10.5px] tracking-wide text-periwinkle">
              {onboardingWalkthrough.paused ? "BOB'S ONBOARDING JOURNEY — PAUSED" : "BOB'S ONBOARDING JOURNEY"}
            </span>
            <span className="text-[10.5px] text-ink-muted">
              Step {onboardingWalkthrough.stepIndex + 1} / {onboardingWalkthrough.totalSteps}
            </span>
          </div>
          <div className="text-sm font-medium text-ink-primary">{onboardingWalkthrough.journeyTitle}</div>
          <div className="mt-0.5 text-xs text-ink-secondary">{onboardingWalkthrough.currentModuleName}</div>
          <div className="mt-1 text-[10.5px] italic text-ink-muted">{onboardingWalkthrough.currentReason}</div>
          <div className="mt-2.5 flex gap-2">
            {onboardingWalkthrough.paused ? (
              <button onClick={onboardingWalkthrough.onResume} className="rounded-md bg-periwinkle px-3 py-1.5 text-xs font-semibold text-biome-bg">
                Resume journey
              </button>
            ) : (
              <button onClick={onboardingWalkthrough.onContinue} className="rounded-md bg-periwinkle px-3 py-1.5 text-xs font-semibold text-biome-bg">
                {onboardingWalkthrough.stepIndex + 1 >= onboardingWalkthrough.totalSteps ? "Finish" : "Continue →"}
              </button>
            )}
            <button onClick={onboardingWalkthrough.onExit} className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-ink-secondary">
              Exit
            </button>
          </div>
        </div>
      ) : walkthrough ? (
        <div className="pointer-events-auto absolute bottom-6 left-6 w-80 rounded-xl border border-teal/25 bg-biome-panel/85 p-3.5 backdrop-blur">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-mono text-[10.5px] tracking-wide text-teal">
              {walkthrough.paused ? "WALKTHROUGH PAUSED" : "WALKTHROUGH"}
            </span>
            <span className="text-[10.5px] text-ink-muted">
              Step {walkthrough.stepIndex + 1} / {walkthrough.totalSteps}
            </span>
          </div>
          <div className="text-sm font-medium text-ink-primary">{walkthrough.flowName}</div>
          <div className="mt-0.5 text-xs text-ink-secondary">{walkthrough.currentStepLabel}</div>
          <div className="mt-1 font-mono text-[9.5px] uppercase tracking-[1.2px] text-ink-muted">
            statically reconstructed &middot; not a runtime trace
          </div>
          <div className="mt-2.5 flex gap-2">
            {walkthrough.paused ? (
              <button onClick={walkthrough.onResume} className="rounded-md bg-teal px-3 py-1.5 text-xs font-semibold text-biome-bg">
                Resume walkthrough
              </button>
            ) : (
              <button onClick={walkthrough.onContinue} className="rounded-md bg-teal px-3 py-1.5 text-xs font-semibold text-biome-bg">
                {walkthrough.stepIndex + 1 >= walkthrough.totalSteps ? "Finish" : "Continue →"}
              </button>
            )}
            <button onClick={walkthrough.onExit} className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-ink-secondary">
              Exit
            </button>
          </div>
        </div>
      ) : (
        <div className="pointer-events-auto absolute bottom-6 left-6 w-80 rounded-xl border border-white/10 bg-biome-panel/80 p-3.5 backdrop-blur">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-mono text-[10.5px] tracking-wide text-ink-muted">MISSIONS</span>
            <span className="text-[10.5px] text-ink-muted">coming soon</span>
          </div>
          <div className="text-sm text-ink-secondary">
            Free-explore the domains above, or switch to the <span className="text-ink-primary">Flow</span> lens to walk
            through a statically reconstructed route.
          </div>
        </div>
      )}

      {/* controls + minimap */}
      <div className="pointer-events-auto absolute bottom-6 right-6 flex items-end gap-2.5">
        <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-biome-panel/70 px-2.5 py-1.5 font-mono text-[10.5px] text-ink-muted">
          <kbd className="rounded border border-ink-dim px-1.5 py-0.5">WASD</kbd> move
          <kbd className="ml-1.5 rounded border border-ink-dim px-1.5 py-0.5">click</kbd> investigate
        </div>
        <div className="relative h-[140px] w-[140px] overflow-hidden rounded-full border border-white/15 bg-biome-panel/85">
          <svg width="140" height="140" viewBox="0 0 140 140" className="absolute inset-0">
            <circle cx="70" cy="70" r="69" fill="#0D1116" />
            {dots.map((d) => {
              const { cx, cy } = toMinimap(d.x, d.z);
              return <circle key={d.id} cx={cx} cy={cy} r={3} fill={d.color} opacity={0.85} />;
            })}
            {(() => {
              const { cx, cy } = toMinimap(avatarPosition[0], avatarPosition[1]);
              return <circle cx={cx} cy={cy} r={3.5} fill="#F3F1EA" stroke="#0A0D12" strokeWidth={1} />;
            })()}
          </svg>
        </div>
      </div>
    </div>
  );
}

function LogoMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26">
      <circle cx="13" cy="13" r="11" fill="none" stroke="#4FD1C5" strokeWidth="1.6" />
      <circle cx="13" cy="13" r="4.5" fill="#F2B84B" />
    </svg>
  );
}
