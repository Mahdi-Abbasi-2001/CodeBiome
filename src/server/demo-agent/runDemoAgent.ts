import Groq from "groq-sdk";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "groq-sdk/resources/chat/completions";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerMcpTools } from "@/server/mcp-tools";
import type { DemoAgentRunState } from "@/types/demo-agent";

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
const DEMO_AGENT_MODEL_FALLBACKS = [
  "openai/gpt-oss-120b",
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "meta-llama/llama-4-scout-17b-16e-instruct",
];

export function resolveDemoAgentModel(preferred?: string | null): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const candidate of [preferred?.trim(), ...DEMO_AGENT_MODEL_FALLBACKS]) {
    if (!candidate) continue;
    const normalized = candidate.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    ordered.push(normalized);
  }
  return ordered.length > 0 ? ordered : [DEFAULT_MODEL];
}

export function demoAgentAvailable(): boolean {
  return !!process.env.GROQ_API_KEY;
}

const MAX_OUTPUT_TOKENS = 2048;
const MAX_TOOL_RESULT_CHARS = 2000;
const MAX_PHASE_ATTEMPTS = 2;
const MAX_INVENTORY_GROUPS = 16;
const MAX_FILES_PER_GROUP = 2;
const MAX_MODULES_PER_SUBMISSION = 8;
const MAX_FILES_PER_MODULE = 2;

const SOURCE_EXTENSIONS = new Set(["c", "cc", "cpp", "cs", "go", "h", "hpp", "java", "js", "jsx", "kt", "mjs", "php", "py", "rb", "rs", "scala", "sh", "swift", "ts", "tsx", "vue"]);

export function buildAgentPathInventory(filePaths: string[]): string {
  const groups = new Map<string, string[]>();
  for (const filePath of filePaths) {
    const parts = filePath.split("/");
    const basename = parts.at(-1) ?? filePath;
    const extension = basename.includes(".") ? basename.split(".").pop()!.toLowerCase() : "";
    if (!SOURCE_EXTENSIONS.has(extension) || /(^|\/)(test|tests|__tests__|spec|e2e|dist|build|coverage)(\/|$)/i.test(filePath)) continue;
    const directory = parts.length > 2 ? parts.slice(0, 2).join("/") : parts.slice(0, -1).join("/") || ".";
    const paths = groups.get(directory) ?? [];
    paths.push(filePath);
    groups.set(directory, paths);
  }

  const selectedGroups = [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, MAX_INVENTORY_GROUPS);

  if (selectedGroups.length === 0) return filePaths.slice(0, 60).map((filePath) => `- ${filePath}`).join("\n");

  return selectedGroups
    .map(([directory, paths]) => {
      const representativePaths = paths
        .sort((a, b) => pathPriority(b) - pathPriority(a) || a.localeCompare(b))
        .slice(0, MAX_FILES_PER_GROUP);
      return `${directory} (${paths.length} source files)\n${representativePaths.map((filePath) => `  - ${filePath}`).join("\n")}`;
    })
    .join("\n");
}

function pathPriority(filePath: string): number {
  const basename = filePath.split("/").pop()?.toLowerCase() ?? "";
  if (/^(index|main|app|server|client|route|router|handler)\./.test(basename)) return 2;
  return 0;
}

function buildSystemPrompt(worldId: string, repositoryId: string, fileCount: number, filePaths: string[]): string {
  return `You are CodeBiome's architecture agent for ${repositoryId} (${fileCount} files). You will make one focused submission per request.\n` +
    `Use only exact file paths shown in this inventory as fileIds; it is a representative sample, not the full repository.\n` +
    `For the modules phase, submit at most ${MAX_MODULES_PER_SUBMISSION} real modules and at most ${MAX_FILES_PER_MODULE} fileIds per module. Do not add unlisted files or descriptions. Set each module id equal to its path and importance from 0 to 1.\n` +
    `For the dependencies phase, use only module ids returned by the successful modules submission. Submit only relationships supported by the repository structure; do not invent edges.\n` +
    `Always pass worldId "${worldId}". If the evidence does not support a relationship, do not fabricate one.\n\n` +
    `Repository path inventory:\n${buildAgentPathInventory(filePaths)}`;
}

export function createDemoAgentRunState(worldId: string, repositoryId: string, fileCount: number, filePaths: string[]): DemoAgentRunState {
  return {
    phase: "modules",
    attempts: 0,
    messages: [
      { role: "system", content: buildSystemPrompt(worldId, repositoryId, fileCount, filePaths) },
      { role: "user", content: "Submit the repository's real module boundaries now." },
    ],
  };
}

export interface DemoAgentStepResult {
  run: DemoAgentRunState;
  done: boolean;
}

export async function runDemoAgentStep(
  worldId: string,
  run: DemoAgentRunState,
  onEvent: (event: DemoAgentEvent) => void
): Promise<DemoAgentStepResult> {
  if (run.phase === "complete" || run.phase === "failed") return { run, done: true };
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    const error = "GROQ_API_KEY is not set — connect your own MCP agent to populate this World (see docs/MCP_CLIENTS.md).";
    onEvent({ type: "error", error });
    return { run: { ...run, phase: "failed", error }, done: true };
  }

  const server = new McpServer({ name: "codebiome-demo-agent", version: "1.0.0" });
  registerMcpTools(server, { defaultWorldId: worldId });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "codebiome-demo-agent", version: "1.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  try {
    const { tools: mcpTools } = await client.listTools();
    const toolName = run.phase === "modules" ? "submit_modules" : "submit_dependencies";
    const tool = mcpTools.find((candidate) => candidate.name === toolName);
    if (!tool) throw new Error(`Required MCP tool ${toolName} is unavailable.`);
    const groqTool: ChatCompletionTool = {
      type: "function",
      function: {
        name: tool.name,
        description: ESSENTIAL_TOOLS[tool.name],
        parameters: stripSchemaVerbosity(tool.inputSchema) as Record<string, unknown>,
      },
    };

    const groq = new Groq({ apiKey });
    const modelCandidates = resolveDemoAgentModel(process.env.DEMO_AGENT_MODEL || DEFAULT_MODEL);
    const messages = run.messages as ChatCompletionMessageParam[];
    let response;
    let lastError: unknown;
    for (const modelName of modelCandidates) {
      try {
        response = await groq.chat.completions.create({
          model: modelName,
          max_tokens: MAX_OUTPUT_TOKENS,
          messages,
          tools: [groqTool],
          tool_choice: { type: "function", function: { name: toolName } },
        });
        break;
      } catch (error) {
        lastError = error;
        const text = error instanceof Error ? error.message : String(error);
        if (/tool_use_failed|failed to parse tool call arguments|invalid_request_error/i.test(text)) throw error;
        if (/model not found|unsupported model|unknown model|invalid model|not available/i.test(text)) continue;
        response = await groq.chat.completions.create({
          model: modelName,
          max_tokens: MAX_OUTPUT_TOKENS,
          messages,
          tools: [groqTool],
        });
        break;
      }
    }
    if (!response) throw lastError ?? new Error("No model candidates were available");

    const message = response.choices[0]?.message;
    if (!message) throw new Error("Groq returned no message.");
    messages.push({ role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls });
    if (message.content?.trim()) onEvent({ type: "message", text: message.content.trim() });

    const toolCalls = message.tool_calls ?? [];
    if (toolCalls.length === 0) {
      const error = `The agent did not call ${toolName}.`;
      onEvent({ type: "error", error });
      return { run: { ...run, messages, phase: "failed", error }, done: true };
    }

    let phaseSucceeded = false;
    for (const call of toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        // The MCP validator will return a useful error for malformed arguments.
      }

      try {
        const result = (await client.callTool({ name: call.function.name, arguments: args })) as {
          content: { type: string; text?: string }[];
          isError?: boolean;
        };
        const rawText = result.content.find((content) => content.type === "text")?.text ?? JSON.stringify(result);
        const text = rawText.length > MAX_TOOL_RESULT_CHARS ? `${rawText.slice(0, MAX_TOOL_RESULT_CHARS)}\n…(truncated)` : rawText;
        onEvent({ type: "tool_call", tool: call.function.name, args, ok: !result.isError, summary: result.isError ? text : `${call.function.name} succeeded` });
        messages.push({ role: "tool", tool_call_id: call.id, content: text });
        if (call.function.name === toolName && !result.isError) phaseSucceeded = true;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        onEvent({ type: "tool_call", tool: call.function.name, args, ok: false, summary: errorMessage });
        messages.push({ role: "tool", tool_call_id: call.id, content: errorMessage });
      }
    }

    if (!phaseSucceeded && run.attempts + 1 >= MAX_PHASE_ATTEMPTS) {
      const error = `${toolName} failed after ${MAX_PHASE_ATTEMPTS} attempts.`;
      onEvent({ type: "error", error });
      return { run: { ...run, messages, attempts: run.attempts + 1, phase: "failed", error }, done: true };
    }

    if (!phaseSucceeded) {
      return { run: { ...run, messages, attempts: run.attempts + 1 }, done: false };
    }

    const phase = run.phase === "modules" ? "dependencies" : "complete";
    const nextRun: DemoAgentRunState = { phase, attempts: 0, messages };
    if (phase === "complete") {
      onEvent({ type: "done" });
      return { run: nextRun, done: true };
    }
    nextRun.messages.push({ role: "user", content: "Now submit supported dependencies between the modules you just submitted." });
    return { run: nextRun, done: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Demo agent failed";
    if (/tool_use_failed|failed to parse tool call arguments|invalid_request_error/i.test(message) && run.attempts + 1 < MAX_PHASE_ATTEMPTS) {
      onEvent({ type: "message", text: "Retrying the architecture submission with a smaller valid batch." });
      return {
        run: {
          ...run,
          attempts: run.attempts + 1,
          messages: [
            ...run.messages,
            { role: "user", content: `The previous ${run.phase} tool arguments were rejected as malformed or too large. Retry with valid compact JSON. Submit at most ${MAX_MODULES_PER_SUBMISSION} modules and ${MAX_FILES_PER_MODULE} fileIds per module.` },
          ],
        },
        done: false,
      };
    }
    onEvent({ type: "error", error: message });
    return { run: { ...run, phase: "failed", error: message }, done: true };
  } finally {
    await Promise.allSettled([client.close(), clientTransport.close(), serverTransport.close()]);
  }
}

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
  submit_modules: "Submit real module boundaries you found: id/name/path/fileIds/importance (importance MUST be a number between 0 and 1, e.g. 0.9 for critical, 0.5 for moderate).",
  submit_dependencies: "Submit real dependency edges: fromId/toId/fromKind/toKind/relationship/confidence (confidence MUST be a number between 0 and 1).",
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

