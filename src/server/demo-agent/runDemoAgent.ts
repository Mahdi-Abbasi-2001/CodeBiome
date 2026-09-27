import Anthropic from "@anthropic-ai/sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerMcpTools } from "@/server/mcp-tools";

/**
 * CodeBiome's own built-in agent — used only so the web UI's "paste a URL"
 * flow still populates a World without requiring the developer to connect
 * an external MCP client by hand. Architecturally this is nothing special:
 * it's an in-process MCP CLIENT (the exact same `Client` + `InMemoryTransport`
 * pattern src/server/mcp-tools/mcpServer.test.ts already uses to test the
 * server) driven by an LLM tool-use loop, calling the SAME submit_* tools
 * any other connected agent would — no bypass of validation, no special
 * access. If this loop can populate a useful World through the public tool
 * surface, that's real evidence the tool surface is sufficient for any
 * agent, not just this one.
 *
 * Requires ANTHROPIC_API_KEY. Without it, this is simply unavailable — the
 * web UI falls back to telling the developer to connect their own agent
 * instead (see docs/MCP_CLIENTS.md); CodeBiome does not otherwise make any
 * outbound LLM call.
 */

export type DemoAgentEvent =
  | { type: "tool_call"; tool: string; args: unknown; ok: boolean; summary: string }
  | { type: "message"; text: string }
  | { type: "done" }
  | { type: "error"; error: string };

const DEFAULT_MODEL = "claude-sonnet-5";
const DEFAULT_MAX_TURNS = 30;
const MAX_OUTPUT_TOKENS = 4096;

export function demoAgentAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export async function runDemoAgent(
  worldId: string,
  repositoryId: string,
  fileCount: number,
  topLevelEntries: string[],
  onEvent: (event: DemoAgentEvent) => void
): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    onEvent({
      type: "error",
      error: "ANTHROPIC_API_KEY is not set, so CodeBiome's built-in demo agent is unavailable. Connect your own MCP agent instead (see docs/MCP_CLIENTS.md) and ask it to analyze this World.",
    });
    return;
  }

  const server = new McpServer({ name: "codebiome-demo-agent", version: "1.0.0" });
  registerMcpTools(server, { defaultWorldId: worldId });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "codebiome-demo-agent", version: "1.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  const { tools: mcpTools } = await client.listTools();
  const tools = mcpTools
    .filter((t) => t.name !== "analyze_repository")
    .map((t) => ({ name: t.name, description: t.description ?? "", input_schema: t.inputSchema as Anthropic.Tool["input_schema"] }));

  const anthropic = new Anthropic({ apiKey });
  const model = process.env.DEMO_AGENT_MODEL || DEFAULT_MODEL;
  const maxTurns = Number(process.env.DEMO_AGENT_MAX_TURNS) || DEFAULT_MAX_TURNS;

  const system =
    `You are CodeBiome's built-in analysis agent for repository "${repositoryId}" (World id "${worldId}", ${fileCount} files, ` +
    `top-level entries: ${topLevelEntries.join(", ")}).\n\n` +
    `Explore the real repository using get_file/search_repository/get_repository_overview, then record what you actually find by ` +
    `calling submit_modules, submit_dependencies, submit_entry_points, submit_frameworks, submit_security_findings, submit_code_health, ` +
    `submit_flow, and submit_request_journey. Every fileId/moduleId you reference must be a REAL path — never invent one. Always pass ` +
    `worldId "${worldId}" explicitly on every call. Prioritize covering the whole repository's main modules and their dependencies before ` +
    `going deep on any one flow. When you believe the architecture is reasonably well covered, stop calling tools and reply with a short ` +
    `plain-text summary.`;

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: "Analyze this repository now." }];

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      const response = await anthropic.messages.create({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system,
        tools,
        messages,
      });

      messages.push({ role: "assistant", content: response.content });

      const toolUses = response.content.filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
      const textBlocks = response.content.filter((block): block is Anthropic.TextBlock => block.type === "text");
      for (const t of textBlocks) if (t.text.trim()) onEvent({ type: "message", text: t.text.trim() });

      if (toolUses.length === 0) {
        onEvent({ type: "done" });
        return;
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        try {
          const result = (await client.callTool({ name: use.name, arguments: (use.input as Record<string, unknown>) ?? {} })) as {
            content: { type: string; text?: string }[];
            isError?: boolean;
          };
          const text = result.content.find((c) => c.type === "text")?.text ?? JSON.stringify(result);
          onEvent({ type: "tool_call", tool: use.name, args: use.input, ok: !result.isError, summary: result.isError ? text : `${use.name} succeeded` });
          toolResults.push({ type: "tool_result", tool_use_id: use.id, content: text, is_error: !!result.isError });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          onEvent({ type: "tool_call", tool: use.name, args: use.input, ok: false, summary: message });
          toolResults.push({ type: "tool_result", tool_use_id: use.id, content: message, is_error: true });
        }
      }
      messages.push({ role: "user", content: toolResults });
    }
    onEvent({ type: "done" });
  } catch (error) {
    onEvent({ type: "error", error: error instanceof Error ? error.message : "Demo agent failed" });
  }
}
