import type { AnalyzeEvent } from "@/types/analyze-events";

const MAX_AGENT_STEPS = 24;

/** Reads the newline-delimited JSON stream from POST /api/analyze. */
export async function streamAnalyze(url: string, onEvent: (event: AnalyzeEvent) => void): Promise<void> {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    let message = `Request failed (${res.status})`;
    try {
      message = JSON.parse(text).error ?? message;
    } catch {
      // ignore
    }
    onEvent({ type: "error", error: message });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let worldId: string | null = null;
  let agentUnavailable = false;

  const emitLine = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as AnalyzeEvent;
    if (event.type === "result") worldId = event.worldId;
    if (event.type === "agent_unavailable") agentUnavailable = true;
    onEvent(event);
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      emitLine(line);
    }
  }
  if (buffer.trim()) emitLine(buffer);

  if (!worldId || agentUnavailable) return;

  try {
    for (let step = 0; step < MAX_AGENT_STEPS; step += 1) {
      onEvent({ type: "agent_progress" });
      const heartbeat = setInterval(() => onEvent({ type: "agent_progress" }), 10_000);
      let stepResponse: Response;
      try {
        stepResponse = await fetch("/api/demo-agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ worldId }),
        });
      } finally {
        clearInterval(heartbeat);
      }

      if (!stepResponse.ok) {
        const detail = await stepResponse.text().catch(() => "");
        let reason = `Agent step failed (${stepResponse.status})`;
        try {
          reason = JSON.parse(detail).error ?? reason;
        } catch {
          // Keep the status-based message.
        }
        onEvent({ type: "agent_unavailable", reason });
        return;
      }

      const result = (await stepResponse.json()) as { events?: AnalyzeEvent[]; done?: boolean };
      for (const event of result.events ?? []) onEvent(event);
      if (result.done) return;
    }
    onEvent({ type: "agent_unavailable", reason: "Agent analysis did not finish within the step limit." });
  } catch (error) {
    onEvent({ type: "agent_unavailable", reason: error instanceof Error ? error.message : "Agent analysis request failed." });
  }
}
