/**
 * Newline-delimited JSON events streamed by POST /api/analyze. CodeBiome no
 * longer runs its own architecture analysis — "fetch" and "seed" are the
 * only stages CodeBiome itself performs (download the repo, record its real
 * file tree); everything after that is CodeBiome's built-in demo agent
 * exploring the code and calling submit_* tools, exactly like an externally
 * connected agent would (see src/server/demo-agent/runDemoAgent.ts). Each
 * `agent_tool_call` event corresponds to a real tool call that just
 * happened — never simulated.
 */
export type AnalyzeStage = "fetch" | "seed";

export type AnalyzeEvent =
  | { type: "stage"; stage: AnalyzeStage; status: "start" }
  | { type: "stage"; stage: AnalyzeStage; status: "done"; detail: Record<string, number> }
  | { type: "agent_tool_call"; tool: string; ok: boolean; summary: string }
  | { type: "agent_message"; text: string }
  | { type: "agent_unavailable"; reason: string }
  /** The built-in demo agent finished its run (it decided it was done, or hit its turn cap) — the last event the stream emits when an agent ran. */
  | { type: "agent_done" }
  | {
      type: "result";
      /** The World this analysis was persisted under (docs/WORLD_ARCHITECTURE.md) — the browser navigates here once the agent (if any) has finished. */
      worldId: string;
      worldUrl: string;
      fileCount: number;
    }
  | { type: "error"; error: string };
