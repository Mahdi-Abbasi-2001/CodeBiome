import type { RepositoryKnowledgeModel } from "./knowledge-model";
import type { WorldModel } from "./world-model";
import type { FlowModel } from "./flow";

/**
 * Newline-delimited JSON events streamed by POST /api/analyze. Each stage
 * event corresponds to a real pipeline step actually running — the client
 * never shows a step as complete before its "done" event arrives, and
 * stages that v1 hasn't implemented yet (health/security auditing beyond
 * pattern-matching, Bob interpretation) are never emitted as if they ran.
 * See docs/ARCHITECTURE_DECISIONS.md and the Step 4/5 implementation reports.
 */
export type AnalyzeStage = "fetch" | "structure" | "dependency" | "entrypoints" | "model" | "flows" | "world";

export type AnalyzeEvent =
  | { type: "stage"; stage: AnalyzeStage; status: "start" }
  | { type: "stage"; stage: AnalyzeStage; status: "done"; detail: Record<string, number> }
  | {
      type: "result";
      knowledgeModel: RepositoryKnowledgeModel;
      worldModel: WorldModel;
      flowModel: FlowModel;
      cached: boolean;
      /** The World this analysis was persisted under (docs/WORLD_ARCHITECTURE.md) — the browser redirects here instead of rendering the world inline. */
      worldId: string;
      worldUrl: string;
    }
  | { type: "error"; error: string };
