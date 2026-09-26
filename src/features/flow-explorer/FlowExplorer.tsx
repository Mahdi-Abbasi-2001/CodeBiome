"use client";

import type { Flow } from "@/types/flow";

const KIND_LABELS: Record<string, string> = {
  entry: "Entry",
  controller: "Controller",
  handler: "Handler",
  service: "Service",
  entity: "Entity",
  function: "Function",
  repository: "Repository",
  database: "Database",
  "external-api": "External API",
  event: "Event",
  unknown: "Unknown",
};

const CONFIDENCE_TONE: Record<Flow["confidence"], string> = {
  high: "text-teal",
  medium: "text-amber",
  low: "text-ink-muted",
};

function layerChain(flow: Flow): string {
  const seen = new Set<string>();
  const kinds: string[] = [];
  for (const step of flow.steps) {
    if (seen.has(step.kind)) continue;
    seen.add(step.kind);
    kinds.push(KIND_LABELS[step.kind] ?? step.kind);
  }
  return kinds.join(" → ");
}

/**
 * "Explore a Feature" (Step 5). Every flow listed here is a STATICALLY
 * RECONSTRUCTED likely execution path, not something CodeBiome ran — the
 * subtitle says so explicitly, and each flow's own confidence badge
 * discloses how strong the underlying evidence is.
 */
export function FlowExplorer({
  flows,
  onSelectFlow,
  onClose,
}: {
  flows: Flow[];
  onSelectFlow: (flowId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="pointer-events-auto fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-6">
      <div className="flex max-h-[80vh] w-full max-w-[560px] flex-col rounded-xl border border-white/10 bg-biome-panel shadow-[0_40px_100px_rgba(0,0,0,0.55)]">
        <div className="flex flex-shrink-0 items-start justify-between border-b border-white/10 px-6 py-5">
          <div>
            <div className="font-mono text-[11px] tracking-[1.6px] text-teal">EXPLORE A FEATURE</div>
            <h2 className="mt-1.5 font-display text-xl font-semibold text-ink-bright">What do you want to understand?</h2>
            <p className="mt-1.5 text-xs text-ink-muted">
              Each path below is statically reconstructed from real entry points and dependency edges — not a runtime
              trace of this repository.
            </p>
          </div>
          <button
            aria-label="Close feature explorer"
            onClick={onClose}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/[0.06]"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M2 2l12 12M14 2 2 14" stroke="#B7BDC3" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3">
          {flows.length === 0 ? (
            <p className="px-3 py-6 text-sm text-ink-muted">
              No confident flows could be reconstructed for this repository yet — this analyzer works best when
              entry points (routes, CLI commands) are statically detectable.
            </p>
          ) : (
            flows.map((flow) => (
              <button
                key={flow.id}
                onClick={() => onSelectFlow(flow.id)}
                className="mb-1.5 w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-4 py-3.5 text-left transition-colors hover:border-teal/30 hover:bg-white/[0.06]"
              >
                <div className="flex items-center justify-between">
                  <span className="font-display text-[15px] font-semibold text-ink-bright">{flow.name}</span>
                  <span className={`font-mono text-[10px] uppercase tracking-wide ${CONFIDENCE_TONE[flow.confidence]}`}>
                    {flow.confidence} confidence
                  </span>
                </div>
                <div className="mt-1 text-xs text-ink-muted">{flow.steps.length} component{flow.steps.length === 1 ? "" : "s"}</div>
                <div className="mt-1.5 font-mono text-[11px] text-ink-secondary">{layerChain(flow)}</div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
