"use client";

/**
 * Bob's compact contextual HUD (product brief: "Do not turn this into a
 * large conversational overlay"). Shown whenever Bob has a real, resolved
 * focus in the world — driven entirely by `WorldExperience`'s derived
 * `bobFocus`/`bobWhy`/`bobNext`, which themselves only ever come from a real
 * MCP tool call or the current step of an active Flow/Onboarding
 * walkthrough. This component never invents a reason or a next step; both
 * are `null`-able and simply omitted when there's nothing real to show.
 */
export function BobFocusHud({ moduleName, why, next }: { moduleName: string; why: string | null; next: string | null }) {
  return (
    <div className="pointer-events-none absolute bottom-6 left-1/2 z-10 w-[300px] -translate-x-1/2 rounded-xl border border-periwinkle/30 bg-biome-panel/90 px-4 py-3 backdrop-blur">
      <div className="flex items-center gap-2">
        <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-periwinkle text-[10px] font-bold text-biome-bg">
          B
        </div>
        <span className="font-mono text-[10px] tracking-[1.4px] text-periwinkle">INVESTIGATING</span>
      </div>
      <div className="mt-1 font-display text-sm font-semibold text-ink-bright">{moduleName}</div>
      {why && (
        <div className="mt-1.5">
          <div className="font-mono text-[9.5px] tracking-wide text-ink-muted">WHY</div>
          <div className="text-xs text-ink-secondary">{why}</div>
        </div>
      )}
      {next && (
        <div className="mt-1.5">
          <div className="font-mono text-[9.5px] tracking-wide text-ink-muted">NEXT</div>
          <div className="text-xs text-ink-secondary">{next}</div>
        </div>
      )}
    </div>
  );
}
