import Groq from "groq-sdk";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "groq-sdk/resources/chat/completions";
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
 * Uses Groq (free tier, OpenAI-compatible chat-completions API with tool
 * calling) rather than a paid provider, so the demo works without anyone
 * needing to fund an API key. Requires GROQ_API_KEY. Without it, this is
 * simply unavailable — the web UI falls back to telling the developer to
 * connect their own agent instead (see docs/MCP_CLIENTS.md); CodeBiome does
 * not otherwise make any outbound LLM call.
 */

export type DemoAgentEvent =
  | { type: "tool_call"; tool: string; args: unknown; ok: boolean; summary: string }
  | { type: "message"; text: string }
  | { type: "done" }
  | { type: "error"; error: string };

// Groq gates its most-known Llama models (llama-3.3-70b-versatile,
// llama-3.1-8b-instant) behind an Enterprise/"contact sales" plan as of
// this writing — a normal free-tier key gets a 404 "model not found" for
// them. openai/gpt-oss-120b is a production model open to every account,
// with real tool-calling support. Verify against
// https://console.groq.com/docs/models before changing this, since model
// availability on Groq's free tier moves faster than this comment can.
const DEFAULT_MODEL = "openai/gpt-oss-120b";
// Vercel Hobby caps this whole request at 60s (src/app/api/bridge/[target]/route.ts's
// maxDuration) — a hard wall, not something a bigger token/turn budget can
// buy its way past. Each turn is a real network round trip to Groq (often
// several seconds on a bigger repo's tool results), so this stays low
// enough that a typical run has a real chance of finishing in time rather
// than being killed mid-stream with no clean terminal event. The frontend
// (ScanningView) also has its own watchdog for when a run doesn't make it.
const DEFAULT_MAX_TURNS = 8;
const MAX_OUTPUT_TOKENS = 1024;
const MAX_TOOL_RESULT_CHARS = 2000;

/**
 * Groq's free plan caps every text model at 8,000 tokens/minute — and since
 * a stateless chat-completions API resends the full tool-schema payload on
 * every single turn, sending all 31 real MCP tools (with their full,
 * capable-agent-oriented descriptions) blew that budget before the model
 * even replied once. This is a demo-agent-only concession: real MCP clients
 * (Claude, Cursor, etc.) aren't token-constrained the same way and keep
 * getting the full tool surface with full descriptions over MCP itself —
 * only what THIS in-process loop sends to Groq is trimmed.
 */
const ESSENTIAL_TOOLS: Record<string, string> = {
  get_repository_overview: "Repository metadata: languages, file/module counts, entry points. Call first.",
  search_repository: "Keyword search over module/file paths.",
  get_file: "Fetch a file's real source by repository-relative path.",
  submit_modules: "Submit real module boundaries you found: id/name/path/fileIds/importance.",
  submit_dependencies: "Submit real dependency edges: fromId/toId/fromKind/toKind/relationship/confidence.",
  submit_entry_points: "Submit real entry points: type/name/fileId/detectionEvidence.",
  submit_frameworks: "Submit detected frameworks/technologies: name/category/evidence/confidence.",
  submit_security_findings: "Submit security findings: patternMatches and/or vulnerableDependencies.",
  submit_code_health: "Submit code-health signals: todos, dead code, test files, coverage, docs, git history.",
  submit_flow: "Submit a statically-traced request flow: ordered steps through real files.",
  submit_request_journey: "Submit a multi-page user journey: ordered steps through real files.",
};

/** Strips `description`/`title` keys from a JSON-schema tree — the per-field prose that helps a capable agent is pure token overhead for an 8K-TPM budget; type/enum/required constraints (what actually matters for a valid call) are untouched. */
function stripSchemaVerbosity(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripSchemaVerbosity);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "description" || key === "title") continue;
      out[key] = stripSchemaVerbosity(value);
    }
    return out;
  }
  return node;
}

export function demoAgentAvailable(): boolean {
  return !!process.env.GROQ_API_KEY;
}

export async function runDemoAgent(
  worldId: string,
  repositoryId: string,
  fileCount: number,
  topLevelEntries: string[],
  onEvent: (event: DemoAgentEvent) => void
): Promise<void> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    onEvent({
      type: "error",
      error: "GROQ_API_KEY is not set, so CodeBiome's built-in demo agent is unavailable. Connect your own MCP agent instead (see docs/MCP_CLIENTS.md) and ask it to analyze this World.",
    });
    return;
  }

  const server = new McpServer({ name: "codebiome-demo-agent", version: "1.0.0" });
  registerMcpTools(server, { defaultWorldId: worldId });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "codebiome-demo-agent", version: "1.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  const { tools: mcpTools } = await client.listTools();
  const tools: ChatCompletionTool[] = mcpTools
    .filter((t) => t.name in ESSENTIAL_TOOLS)
    .map((t) => ({
      type: "function",
      function: { name: t.name, description: ESSENTIAL_TOOLS[t.name], parameters: stripSchemaVerbosity(t.inputSchema) as Record<string, unknown> },
    }));

  const groq = new Groq({ apiKey });
  const model = process.env.DEMO_AGENT_MODEL || DEFAULT_MODEL;
  const maxTurns = Number(process.env.DEMO_AGENT_MAX_TURNS) || DEFAULT_MAX_TURNS;

  const system =
    `You are CodeBiome's built-in analysis agent for repository "${repositoryId}" (World id "${worldId}", ${fileCount} files, ` +
    `top-level entries: ${topLevelEntries.join(", ")}). You have AT MOST ${maxTurns} tool calls total, and the whole run is killed at ` +
    `60 seconds regardless of how many turns you have left — assume you will only get through 4-6 calls in practice. Get the most ` +
    `valuable data submitted FIRST; anything after that is a bonus, not a guarantee.\n\n` +
    `The Architecture view only shows a module once it has a real detected relationship: a dependency edge to another module, a ` +
    `detected framework, or a linked infrastructure technology (database/cache/queue/external API). A module with none of those stays ` +
    `invisible even though it exists — so submitting modules alone is NOT enough to produce a useful result. In this exact order:\n` +
    `1. ONE call to get_repository_overview OR search_repository (not both) to orient yourself — don't spend more than one call exploring blind.\n` +
    `2. ONE call to submit_modules with every module you can identify from paths/overview alone (you rarely need get_file just to name ` +
    `module boundaries).\n` +
    `3. ONE call to submit_dependencies, immediately next, with every real relationship you can infer between those modules from what ` +
    `you already know (path conventions, the overview's framework hints) — a small number of get_file calls to confirm specific real ` +
    `edges is fine, but do not read files exhaustively. This step is what actually makes Architecture render — never skip or defer it.\n` +
    `4. If a turn remains: submit_frameworks for any technology you can identify with real file evidence.\n` +
    `5. Only with turns still remaining: submit_entry_points, submit_security_findings, submit_code_health, submit_flow, submit_request_journey.\n\n` +
    `Every fileId/moduleId you reference must be a REAL path — never invent one. Always pass worldId "${worldId}" explicitly on every ` +
    `call. Batch generously (every module/edge you know about in ONE call) rather than one tiny call per item. Stop calling tools and ` +
    `reply with a short summary as soon as modules, dependencies, and frameworks are submitted — do not keep exploring for its own sake.`;

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    { role: "user", content: "Analyze this repository now." },
  ];

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      const response = await groq.chat.completions.create({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages,
        tools,
      });

      const message = response.choices[0]?.message;
      if (!message) {
        onEvent({ type: "error", error: "Groq returned no message." });
        return;
      }

      messages.push({ role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls });

      if (message.content?.trim()) onEvent({ type: "message", text: message.content.trim() });

      const toolCalls = message.tool_calls ?? [];
      if (toolCalls.length === 0) {
        onEvent({ type: "done" });
        return;
      }

      for (const call of toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          // Malformed JSON from the model — fed back as a tool error below rather than crashing the loop.
        }

        try {
          const result = (await client.callTool({ name: call.function.name, arguments: args })) as {
            content: { type: string; text?: string }[];
            isError?: boolean;
          };
          const rawText = result.content.find((c) => c.type === "text")?.text ?? JSON.stringify(result);
          // A single get_file call on a large file could otherwise consume
          // most of Groq's free-tier 8,000-token/minute budget by itself —
          // this keeps any one tool result from starving the rest of the run.
          const text = rawText.length > MAX_TOOL_RESULT_CHARS ? `${rawText.slice(0, MAX_TOOL_RESULT_CHARS)}\n…(truncated — result was longer)` : rawText;
          onEvent({ type: "tool_call", tool: call.function.name, args, ok: !result.isError, summary: result.isError ? text : `${call.function.name} succeeded` });
          messages.push({ role: "tool", tool_call_id: call.id, content: text });
        } catch (error) {
          const errMessage = error instanceof Error ? error.message : "Unknown error";
          onEvent({ type: "tool_call", tool: call.function.name, args, ok: false, summary: errMessage });
          messages.push({ role: "tool", tool_call_id: call.id, content: errMessage });
        }
      }
    }
    onEvent({ type: "done" });
  } catch (error) {
    onEvent({ type: "error", error: error instanceof Error ? error.message : "Demo agent failed" });
  }
}
