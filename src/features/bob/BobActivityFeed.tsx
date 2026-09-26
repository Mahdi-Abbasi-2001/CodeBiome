"use client";

import type { ActivityEvent } from "@/types/bob-events";

/**
 * The ONLY thing CodeBiome can honestly show about "what Bob is doing" —
 * see docs/BOB_INTEGRATION.md. This is a live log of real MCP `tools/call`
 * requests a connected IBM Bob session has made against CodeBiome's server
 * (src/app/api/mcp/route.ts), each with a short deterministic summary of
 * the result. It is never Bob's own natural-language answer — MCP only
 * returns tool results to the client that called them, so CodeBiome never
 * receives that text. No entry here is fabricated, scheduled, or simulated.
 */
export function BobActivityFeed({ activity }: { activity: ActivityEvent[] }) {
  const recent = [...activity].reverse().slice(0, 6);

  return (
    <div className="pointer-events-auto w-[230px] rounded-xl border border-teal/25 bg-teal/[0.06] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <div className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full bg-teal text-xs font-bold text-biome-bg">
          B
        </div>
        <div>
          <div className="text-xs font-semibold text-teal">Bob is connected</div>
          <div className="text-[10px] text-ink-muted">live MCP tool activity</div>
        </div>
      </div>
      <ul className="mt-2 space-y-1.5">
        {recent.map((event, i) => (
          <li key={`${event.at}-${i}`} className="rounded-md bg-white/[0.05] px-2 py-1.5 text-[11px] leading-snug text-[#D8DBDE]">
            <span className="font-mono text-[10px] text-teal">{event.tool}</span>
            <div>{event.summary}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
