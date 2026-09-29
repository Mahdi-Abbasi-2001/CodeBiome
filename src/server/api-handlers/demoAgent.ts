import { NextRequest, NextResponse } from "next/server";
import { demoAgentAvailable, createDemoAgentRunState, runDemoAgentStep } from "@/server/demo-agent/runDemoAgent";
import { worldStore } from "@/server/world/worldStore";
import type { AnalyzeEvent } from "@/types/analyze-events";

export async function handleDemoAgentStep(req: NextRequest): Promise<Response> {
  let body: { worldId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.worldId !== "string" || !body.worldId.trim()) {
    return NextResponse.json({ error: "Missing 'worldId'" }, { status: 400 });
  }
  if (!demoAgentAvailable()) {
    return NextResponse.json({ error: "GROQ_API_KEY is not set" }, { status: 503 });
  }

  const world = await worldStore.getWorld(body.worldId);
  const snapshot = await worldStore.getSnapshot(body.worldId);
  if (!world || !snapshot) return NextResponse.json({ error: "World not found" }, { status: 404 });

  let run = await worldStore.getDemoAgentRun(world.id);
  if (!run) {
    run = createDemoAgentRunState(
      world.id,
      world.repositoryId,
      snapshot.knowledgeModel.files.length,
      snapshot.knowledgeModel.files.map((file) => file.path).sort()
    );
    await worldStore.setDemoAgentRun(world.id, run);
  }

  if (run.phase === "complete") return NextResponse.json({ events: [{ type: "agent_done" }], done: true });
  if (run.phase === "failed") {
    return NextResponse.json({ events: [{ type: "agent_unavailable", reason: run.error ?? "Agent analysis failed." }], done: true });
  }

  const events: AnalyzeEvent[] = [];
  const result = await runDemoAgentStep(world.id, run, (event) => {
    if (event.type === "tool_call") events.push({ type: "agent_tool_call", tool: event.tool, ok: event.ok, summary: event.summary });
    else if (event.type === "message") events.push({ type: "agent_message", text: event.text });
    else if (event.type === "error") events.push({ type: "agent_unavailable", reason: event.error });
    else if (event.type === "done") events.push({ type: "agent_done" });
  });
  await worldStore.setDemoAgentRun(world.id, result.run);

  return NextResponse.json({ events, done: result.done });
}