import type { AnalyzeEvent } from "@/types/analyze-events";

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

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      onEvent(JSON.parse(line) as AnalyzeEvent);
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as AnalyzeEvent);
}
