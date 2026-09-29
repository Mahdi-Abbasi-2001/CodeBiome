import { NextRequest } from "next/server";
import { parseGitHubUrl } from "@/lib/parseGitHubUrl";
import { buildRepositorySnapshot } from "@/server/ingestion/snapshotBuilder";
import { seedKnowledgeModel } from "@/server/ingestion/seedKnowledgeModel";
import { createWorldFromAnalysis } from "@/server/world/createWorldFromAnalysis";
import { createDemoAgentRunState, demoAgentAvailable } from "@/server/demo-agent/runDemoAgent";
import { worldStore } from "@/server/world/worldStore";
import type { AnalyzeEvent } from "@/types/analyze-events";

/**
 * The browser-first entry point (docs/WORLD_ARCHITECTURE.md "Browser-first
 * fallback") — manual "paste a GitHub URL" flow. Streams newline-delimited
 * JSON so the scanning UI can show real progress.
 *
 * CodeBiome itself only does two things here: fetch the repository, and
 * record its real file tree (src/server/ingestion/seedKnowledgeModel.ts) —
 * exactly what the agent-first `analyze_repository` MCP tool does (see
 * src/server/mcp-tools/analysisTools.ts). It then hands the freshly created
 * (still mostly empty) World to CodeBiome's own built-in demo agent, which
 * explores the code and calls the same submit_* tools an externally
 * connected agent would — see src/server/demo-agent/runDemoAgent.ts. If no
 * GROQ_API_KEY is configured, the demo agent step is skipped (not a
 * fatal error): the World still exists, still has its real file tree, and a
 * developer can connect their own agent to it instead (docs/MCP_CLIENTS.md).
 *
 * Needs Node's filesystem/tar APIs (not available on the Edge runtime).
 * Runtime/duration segment config lives on
 * src/app/api/bridge/[target]/route.ts, which is the actual Vercel Function
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
        emit({ type: "stage", stage: "fetch", status: "start" });
        const { snapshot, cleanup } = await buildRepositorySnapshot(owner, repo);
        emit({ type: "stage", stage: "fetch", status: "done", detail: { fileCount: snapshot.files.length } });

        let knowledgeModel;
        try {
          emit({ type: "stage", stage: "seed", status: "start" });
          knowledgeModel = await seedKnowledgeModel(snapshot);
          emit({ type: "stage", stage: "seed", status: "done", detail: { fileCount: knowledgeModel.files.length } });
        } finally {
          await cleanup();
        }

        const { world, url } = await createWorldFromAnalysis(owner, repo, knowledgeModel);
        const agentAvailable = demoAgentAvailable();
        let agentStateError: string | null = null;
        if (agentAvailable) {
          const filePaths = knowledgeModel.files.map((file) => file.path).sort();
          try {
            await worldStore.setDemoAgentRun(
              world.id,
              createDemoAgentRunState(world.id, `${owner}/${repo}`, knowledgeModel.files.length, filePaths)
            );
          } catch (error) {
            agentStateError = error instanceof Error ? error.message : "Could not save the agent continuation state.";
          }
        }

        emit({ type: "result", worldId: world.id, worldUrl: url, fileCount: knowledgeModel.files.length });

        if (!agentAvailable) {
          emit({ type: "agent_unavailable", reason: "GROQ_API_KEY is not set — connect your own MCP agent to populate this World (see docs/MCP_CLIENTS.md)." });
        } else if (agentStateError) {
          emit({ type: "agent_unavailable", reason: `Could not start the built-in agent: ${agentStateError}` });
        }
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
