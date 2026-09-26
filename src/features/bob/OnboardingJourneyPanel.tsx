"use client";

import type { OnboardingJourneyEvent } from "@/types/bob-events";

/**
 * Bob's onboarding-journey layer, visible (src/types/onboarding.ts). Every
 * journey here was created by a real, connected Bob session calling
 * `create_onboarding_journey` — this panel never invents one itself. Kept
 * visually distinct from the deterministic "Explore a Feature" list
 * (FlowExplorer, teal) using the same periwinkle "this is Bob" language as
 * DomainConceptsPanel, since a journey is Bob's interpretation of what
 * matters, not a reconstructed execution path.
 */
export function OnboardingJourneyPanel({
  journeys,
  onStartJourney,
  onClose,
}: {
  journeys: OnboardingJourneyEvent["journey"][];
  onStartJourney: (journeyId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="pointer-events-auto fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-6">
      <div className="flex max-h-[80vh] w-full max-w-[560px] flex-col rounded-xl border border-periwinkle/25 bg-biome-panel shadow-[0_40px_100px_rgba(0,0,0,0.55)]">
        <div className="flex flex-shrink-0 items-start justify-between border-b border-white/10 px-6 py-5">
          <div>
            <div className="font-mono text-[11px] tracking-[1.6px] text-periwinkle">BOB&apos;S ONBOARDING JOURNEYS</div>
            <h2 className="mt-1.5 font-display text-xl font-semibold text-ink-bright">Guided paths Bob has prepared</h2>
            <p className="mt-1.5 text-xs text-ink-muted">
              Each journey is Bob&apos;s own ordered path through real, verified modules — not a reconstructed
              execution flow. Every step&apos;s reason is Bob&apos;s interpretation.
            </p>
          </div>
          <button
            aria-label="Close onboarding journeys panel"
            onClick={onClose}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/[0.06]"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M2 2l12 12M14 2 2 14" stroke="#B7BDC3" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3">
          {journeys.length === 0 ? (
            <p className="px-3 py-6 text-sm text-ink-muted">
              Bob hasn&apos;t created an onboarding journey for this repository yet. Ask it something like &ldquo;I&apos;m
              new to this repository, help me understand the main user workflow&rdquo; — when it calls{" "}
              <code className="font-mono text-periwinkle-light">create_onboarding_journey</code>, it appears here.
            </p>
          ) : (
            journeys.map((journey) => (
              <div
                key={journey.id}
                className="mb-1.5 rounded-lg border border-white/[0.06] bg-white/[0.03] px-4 py-3.5 transition-colors hover:border-periwinkle/30 hover:bg-white/[0.06]"
              >
                <div className="flex items-center justify-between">
                  <span className="font-display text-[15px] font-semibold text-ink-bright">{journey.title}</span>
                  <span className="font-mono text-[10px] uppercase tracking-wide text-periwinkle">
                    {Math.round(journey.provenance.confidence * 100)}% confidence
                  </span>
                </div>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#D8DBDE]">{journey.goal}</p>
                <ol className="mt-2.5 space-y-1">
                  {journey.steps.map((step) => (
                    <li key={step.order} className="font-mono text-[11px] text-ink-secondary">
                      <span className="text-periwinkle-light">{step.order + 1}.</span> {step.moduleName}
                      <span className="text-ink-muted"> — {step.reason}</span>
                    </li>
                  ))}
                </ol>
                <button
                  onClick={() => onStartJourney(journey.id)}
                  className="mt-3 rounded-md bg-periwinkle px-3 py-1.5 text-xs font-semibold text-biome-bg"
                >
                  Start Journey
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
