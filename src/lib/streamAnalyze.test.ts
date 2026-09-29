import { afterEach, describe, expect, it, vi } from "vitest";
import { streamAnalyze } from "./streamAnalyze";

describe("streamAnalyze", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("continues through bounded agent requests until the agent finishes", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"type":"result","worldId":"world-1","worldUrl":"/world/world-1","fileCount":2}\n'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ events: [{ type: "agent_tool_call", tool: "submit_modules", ok: true, summary: "submitted" }], done: false })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ events: [{ type: "agent_done" }], done: true })));
    vi.stubGlobal("fetch", fetchMock);
    const events: string[] = [];

    await streamAnalyze("https://github.com/owner/repo", (event) => events.push(event.type));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ worldId: "world-1" });
    expect(events).toContain("agent_tool_call");
    expect(events.at(-1)).toBe("agent_done");
  });

  it("reports a step endpoint failure without dropping the created world", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"type":"result","worldId":"world-2","worldUrl":"/world/world-2","fileCount":1}\n'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Agent unavailable" }), { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const events: string[] = [];

    await streamAnalyze("https://github.com/owner/repo", (event) => events.push(event.type));

    expect(events).toContain("result");
    expect(events.at(-1)).toBe("agent_unavailable");
  });
});