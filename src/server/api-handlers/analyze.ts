import { NextRequest } from "next/server";
import { parseGitHubUrl } from "@/lib/parseGitHubUrl";
import { runAnalysisPipeline } from "@/server/analysis/runAnalysisPipeline";
import { createWorldFromAnalysis } from "@/server/world/createWorldFromAnalysis";
import type { AnalyzeEvent, AnalyzeStage } from "@/types/analyze-events";

/**
 * The browser-first entry point (docs/WORLD_ARCHITECTURE.md "Browser-first
 * fallback") — manual "paste a GitHub URL" analysis. Runs the exact same
 * `runAnalysisPipeline` Bob's `analyze_repository` MCP tool uses (see
 * src/server/bob-tools/analysisTools.ts), streamed as newline-delimited
 * JSON so the scanning UI can show real progress, then creates a World from
 * the result exactly like the Bob-first path does — both entry points
 * produce the same World abstraction, per the brief. The browser redirects
 * to `/world/{worldId}` on the final "result" event rather than rendering
 * the world inline; the world experience only ever reads from a World id,
 * whichever path created it.
 *
 * Needs Node's filesystem/tar APIs (not available on the Edge runtime).
 * Runtime/duration segment config lives on
 * src/app/api/[...codebiome]/route.ts, which is the actual Vercel Function
 * this handler runs inside of.
 */
export async function handleAnalyze(req: NextRequest): Promise<Response> {
  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }
  if (!body.url) {
    return new Response(JSON.stringify({ error: "Missing 'url'" }), { status: 400 });
  }

  let owner: string;
  let repo: string;
  try {
    ({ owner, repo } = parseGitHubUrl(body.url));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid GitHub URL";
    return new Response(JSON.stringify({ error: message }), { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: AnalyzeEvent) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

      try {
        const result = await runAnalysisPipeline(owner, repo, {
          onStageStart: (stage: AnalyzeStage) => emit({ type: "stage", stage, status: "start" }),
          onStageDone: (stage: AnalyzeStage, detail) => emit({ type: "stage", stage, status: "done", detail }),
        });

        const { world, url } = await createWorldFromAnalysis(owner, repo, result);

        emit({
          type: "result",
          knowledgeModel: result.knowledgeModel,
          worldModel: result.worldModel,
          flowModel: result.flowModel,
          cached: result.cached,
          worldId: world.id,
          worldUrl: url,
        });
      } catch (error) {
        emit({ type: "error", error: error instanceof Error ? error.message : "Analysis failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
