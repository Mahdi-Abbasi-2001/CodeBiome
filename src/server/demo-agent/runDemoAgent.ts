import Groq from "groq-sdk";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "groq-sdk/resources/chat/completions";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerMcpTools } from "@/server/mcp-tools";
import { worldStore } from "@/server/world/worldStore";
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

const MAX_OUTPUT_TOKENS = 4096;
const MAX_TOOL_RESULT_CHARS = 2000;
const MAX_PHASE_ATTEMPTS = 2;
const MAX_INVENTORY_GROUPS = 32;
const MODULE_GROUPS_PER_BATCH = 4;
const MAX_FILES_PER_GROUP = 8;

const SOURCE_EXTENSIONS = new Set(["c", "cc", "cpp", "cs", "go", "h", "hpp", "java", "js", "jsx", "kt", "mjs", "php", "py", "rb", "rs", "scala", "sh", "swift", "ts", "tsx", "vue"]);

export function buildAgentPathInventory(filePaths: string[]): string {
  return buildAgentPathGroups(filePaths)
    .map((group) => `${group.path} (${group.fileCount} source files)\n${group.fileIds.map((filePath) => `  - ${filePath}`).join("\n")}`)
    .join("\n");
}

export function buildAgentPathGroups(filePaths: string[]) {
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

  return [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, MAX_INVENTORY_GROUPS)
    .map(([directory, paths]) => {
      const representativePaths = paths
        .sort((a, b) => pathPriority(b) - pathPriority(a) || a.localeCompare(b))
        .slice(0, MAX_FILES_PER_GROUP);
      return { path: directory, fileCount: paths.length, fileIds: representativePaths };
    });
}

function pathPriority(filePath: string): number {
  const basename = filePath.split("/").pop()?.toLowerCase() ?? "";
  if (/^(index|main|app|server|client|route|router|handler)\./.test(basename)) return 2;
  return 0;
}

function moduleBatchMessages(worldId: string, repositoryId: string, fileCount: number, groups: ReturnType<typeof buildAgentPathGroups>, startIndex: number) {
  const batch = groups.slice(startIndex, startIndex + MODULE_GROUPS_PER_BATCH);
  const inventory = batch
    .map((group) => `${group.path} (${group.fileCount} source files)\n${group.fileIds.map((fileId) => `  - ${fileId}`).join("\n")}`)
    .join("\n");
  return [
    {
      role: "system",
      content: `You are mapping ${repositoryId} (${fileCount} files). Submit exactly one module for each listed directory group and no other modules. Use the exact group path as id and path; include all and only its listed fileIds. These are representative files, not the complete module contents. Set importance from 0 to 1. Always pass worldId "${worldId}".\n\n${inventory}`,
    },
    { role: "user", content: "Submit modules for this directory batch." },
  ];
}

function dependencyMessages(worldId: string, repositoryId: string, modules: { id: string; name: string; path: string }[], relationshipEvidence: string) {
  return [
    {
      role: "system",
      content: `Analyze dependencies for ${repositoryId}. Submit only edges supported by the source evidence below; do not infer dependencies from directory names alone. Create an edge for each exact client fetch URL that matches a server route. Also capture explicit route-to-controller and controller-to-model imports. Keep separate modules separate; do not collapse a client subtree into its parent. If evidence is insufficient, submit fewer edges. Always pass worldId "${worldId}".\n\nModules:\n${modules.map((module) => `${module.id}: ${module.name} (${module.path})`).join("\n")}\n\nSource evidence:\n${relationshipEvidence || "No source-level relationship evidence was extracted."}`,
    },
    { role: "user", content: "Submit evidence-backed dependencies between these modules." },
  ];
}

function frameworkMessages(worldId: string, repositoryId: string, manifestEvidence: string, relationshipEvidence: string) {
  return [
    {
      role: "system",
      content: `Identify technologies declared in these manifests and confirmed by source imports for ${repositoryId}. Use exact source file paths containing the imports as evidence so each technology can attach to a real module. Map React and React Router to frontend, Express to backend, Mongoose or MongoDB clients to database, and payment SDKs such as Stripe to external-api when present. Also detect other clearly declared frameworks or infrastructure. Categories are frontend, backend, database, cache, queue, search, external-api, or fullstack. Include clear frameworks/infrastructure only, not generic utilities. Always pass worldId "${worldId}".\n\nManifests:\n${manifestEvidence}\n\nSource imports:\n${relationshipEvidence}`,
    },
    { role: "user", content: "Submit detected frameworks and infrastructure." },
  ];
}

export function createDemoAgentRunState(worldId: string, repositoryId: string, fileCount: number, filePaths: string[], manifestEvidence = "", relationshipEvidence = ""): DemoAgentRunState {
  const pathGroups = buildAgentPathGroups(filePaths);
  return {
    phase: "modules",
    attempts: 0,
    moduleGroupIndex: 0,
    pathGroups,
    manifestEvidence,
    relationshipEvidence,
    messages: moduleBatchMessages(worldId, repositoryId, fileCount, pathGroups, 0),
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
    const toolName = run.phase === "modules" ? "submit_modules" : run.phase === "dependencies" ? "submit_dependencies" : "submit_frameworks";
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

    const snapshot = await worldStore.getSnapshot(worldId);
    if (!snapshot) throw new Error("World not found while continuing architecture analysis.");

    if (run.phase === "modules") {
      const moduleGroupIndex = run.moduleGroupIndex + MODULE_GROUPS_PER_BATCH;
      if (moduleGroupIndex < run.pathGroups.length) {
        return {
          run: {
            ...run,
            attempts: 0,
            moduleGroupIndex,
            messages: moduleBatchMessages(
              worldId,
              snapshot.knowledgeModel.repository.id,
              snapshot.knowledgeModel.files.length,
              run.pathGroups,
              moduleGroupIndex
            ),
          },
          done: false,
        };
      }
      return {
        run: {
          ...run,
          phase: "dependencies",
          attempts: 0,
          messages: dependencyMessages(
            worldId,
            snapshot.knowledgeModel.repository.id,
            snapshot.knowledgeModel.modules.map(({ id, name, path }) => ({ id, name, path })),
            run.relationshipEvidence
          ),
        },
        done: false,
      };
    }

    if (run.phase === "dependencies" && (run.manifestEvidence.trim() || run.relationshipEvidence.trim())) {
      return {
        run: {
          ...run,
          phase: "frameworks",
          attempts: 0,
          messages: frameworkMessages(worldId, snapshot.knowledgeModel.repository.id, run.manifestEvidence, run.relationshipEvidence),
        },
        done: false,
      };
    }

    const completedRun: DemoAgentRunState = { ...run, phase: "complete", attempts: 0, messages };
    onEvent({ type: "done" });
    return { run: completedRun, done: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Demo agent failed";
    if (/tool_use_failed|failed to parse tool call arguments|invalid_request_error/i.test(message) && run.attempts + 1 < MAX_PHASE_ATTEMPTS) {
      onEvent({ type: "message", text: "Retrying the architecture submission with stricter evidence and smaller batches." });
      return {
        run: {
          ...run,
          attempts: run.attempts + 1,
          messages: [
            ...run.messages,
            { role: "user", content: "The previous tool arguments were rejected as malformed or too large. Retry with valid compact JSON, using only the paths, modules, and evidence explicitly provided in the system message." },
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
  submit_modules: "Submit one real module for each supplied directory group, using its exact path and listed file IDs. Importance must be between 0 and 1.",
  submit_dependencies: "Submit real dependency edges: fromId/toId/fromKind/toKind/relationship/confidence (confidence MUST be a number between 0 and 1).",
  submit_frameworks: "Submit technologies declared in the supplied manifests: name/category/evidence/confidence. Use exact manifest file paths as evidence.",
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

