"use client";

import type { DomainConceptEvent } from "@/types/bob-events";

/**
 * The AI-interpretation layer, visible (docs/BOB_INTEGRATION.md §14). Every
 * concept here was contributed by a real, connected Bob session calling
 * `contribute_domain_concept` — this panel never generates one itself, and
 * every card is explicitly labeled with Bob's own confidence so it can
 * never be mistaken for one of CodeBiome's deterministic facts.
 */
export function DomainConceptsPanel({
  concepts,
  moduleNameById,
  onSelectConcept,
  onClose,
}: {
  concepts: DomainConceptEvent["concept"][];
  moduleNameById: Map<string, string>;
  onSelectConcept: (concept: DomainConceptEvent["concept"]) => void;
  onClose: () => void;
}) {
  return (
    <div className="pointer-events-auto fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-6">
      <div className="flex max-h-[80vh] w-full max-w-[560px] flex-col rounded-xl border border-periwinkle/25 bg-biome-panel shadow-[0_40px_100px_rgba(0,0,0,0.55)]">
        <div className="flex flex-shrink-0 items-start justify-between border-b border-white/10 px-6 py-5">
          <div>
            <div className="font-mono text-[11px] tracking-[1.6px] text-periwinkle">BOB&apos;S INTERPRETATION</div>
            <h2 className="mt-1.5 font-display text-xl font-semibold text-ink-bright">What Bob has recognized here</h2>
            <p className="mt-1.5 text-xs text-ink-muted">
              Higher-level concepts a connected Bob session identified from the real repository structure — grouped
              modules deterministic analysis alone can&apos;t name. Each carries Bob&apos;s own confidence, never
              presented as fact.
            </p>
          </div>
          <button
            aria-label="Close Bob's interpretation panel"
            onClick={onClose}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/[0.06]"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M2 2l12 12M14 2 2 14" stroke="#B7BDC3" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3">
          {concepts.length === 0 ? (
            <p className="px-3 py-6 text-sm text-ink-muted">
              Bob hasn&apos;t contributed any interpretation of this repository yet. Ask it something like
              &ldquo;what higher-level concepts does this codebase implement?&rdquo; — when it calls{" "}
              <code className="font-mono text-periwinkle-light">contribute_domain_concept</code>, it appears here.
            </p>
          ) : (
            concepts.map((concept) => (
              <button
                key={concept.id}
                onClick={() => onSelectConcept(concept)}
                className="mb-1.5 w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-4 py-3.5 text-left transition-colors hover:border-periwinkle/30 hover:bg-white/[0.06]"
              >
                <div className="flex items-center justify-between">
                  <span className="font-display text-[15px] font-semibold text-ink-bright">{concept.name}</span>
                  <span className="font-mono text-[10px] uppercase tracking-wide text-periwinkle">
                    {Math.round(concept.confidence * 100)}% confidence
                  </span>
                </div>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#D8DBDE]">{concept.description}</p>
                <div className="mt-2 font-mono text-[11px] text-ink-secondary">
                  {concept.relatedModuleIds.map((id) => moduleNameById.get(id) ?? id).join(", ")}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
