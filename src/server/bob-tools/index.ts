import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { bobEventBus } from "@/server/bob/eventBus";
import { resolveWorld } from "./resolveRepository";
import * as repositoryTools from "./repositoryTools";
import * as flowTools from "./flowTools";
import * as worldActionTools from "./worldActionTools";
import * as domainConceptTools from "./domainConceptTools";
import * as onboardingTools from "./onboardingTools";
import * as analysisTools from "./analysisTools";

/**
 * Wires the pure functions in repositoryTools.ts / flowTools.ts /
 * worldActionTools.ts into MCP tool registrations. This is the ONLY file
 * that knows about the MCP SDK — every tool's actual logic lives in a
 * plain, framework-free function so it can be unit tested directly (see
 * *.test.ts next to each) without spinning up a transport.
 *
 * Every registration does the same three things, uniformly:
 *   1. Best-effort resolve which World this call is about
 *      (docs/WORLD_ARCHITECTURE.md), so the live activity log
 *      (docs/BOB_INTEGRATION.md) can be shown to the right browser tab even
 *      for tools that don't return a worldId themselves.
 *   2. Call the underlying function.
 *   3. On success, publish an ActivityEvent (scoped to that World) with a
 *      short factual summary; on a known error (missing entity, repo not
 *      analyzed, bad args), return `isError: true` with the message — never
 *      throw a raw exception back through the transport.
 */

// Every tool accepts `worldId` — the robust, preferred identifier once a
// conversation has called `analyze_repository` — alongside the legacy
// `owner`/`repo` convenience path, both resolved by resolveWorld()
// (docs/WORLD_ARCHITECTURE.md).
const repoArgs = {
  worldId: z.string().optional().describe("The CodeBiome World id — from analyze_repository's result, or from whatever the developer currently has open. Omit to fall back to owner/repo, or to CodeBiome's most recently created World."),
  owner: z.string().optional(),
  repo: z.string().optional(),
};

async function activeWorldContext(args: { worldId?: string; owner?: string; repo?: string }): Promise<{ worldId: string; repositoryId: string } | null> {
  try {
    const { world } = await resolveWorld(args);
    return { worldId: world.id, repositoryId: world.repositoryId };
  } catch {
    return null;
  }
}

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function err(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : "Unknown error";
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * For the six world-action tools only: they already publish their own
 * WorldActionEvent + a richer, action-specific ActivityEvent internally
 * (see worldActionTools.ts's `publish` helper), so this wrapper only
 * handles JSON-RPC result shaping and error conversion — using `wrap`
 * below for these would double-log every action to the activity feed.
 */
function wrapAction<Args extends Record<string, unknown>>(fn: (args: Args) => Promise<unknown>) {
  return async (args: Args): Promise<CallToolResult> => {
    try {
      return ok(await fn(args));
    } catch (error) {
      return err(error);
    }
  };
}

function wrap<Args extends Record<string, unknown>>(
  toolName: string,
  summarize: (args: Args, result: unknown) => string,
  fn: (args: Args) => Promise<unknown>
) {
  return async (args: Args): Promise<CallToolResult> => {
    const context = await activeWorldContext(args);
    try {
      const result = await fn(args);
      if (context) {
        bobEventBus.publish({
          kind: "activity",
          worldId: context.worldId,
          repositoryId: context.repositoryId,
          tool: toolName,
          args,
          summary: summarize(args, result),
          at: new Date().toISOString(),
        });
      }
      return ok(result);
    } catch (error) {
      if (context) {
        bobEventBus.publish({
          kind: "activity",
          worldId: context.worldId,
          repositoryId: context.repositoryId,
          tool: toolName,
          args,
          summary: `${toolName} failed: ${error instanceof Error ? error.message : "unknown error"}`,
          at: new Date().toISOString(),
        });
      }
      return err(error);
    }
  };
}

export function registerBobTools(server: McpServer): void {
  server.registerTool(
    "analyze_repository",
    {
      title: "Analyze repository",
      description:
        "The Bob-first entry point (docs/WORLD_ARCHITECTURE.md): analyzes a public GitHub repository from scratch — deterministic structure/dependency/entry-point/security analysis, static flow inference, and a 3D World Model — with NO requirement that the developer has opened the CodeBiome web app first. Creates a new CodeBiome World and returns its id and a real, clickable World URL the developer can open to see the 3D world. Every number in the result is read directly off the real analysis, never invented. Call this FIRST when asked to analyze/onboard into a repository the developer names by URL; use the returned worldId in every subsequent tool call in this conversation so they all operate on the same World. Can take up to a minute or more for a large repository.",
      inputSchema: {
        repositoryUrl: z.string().describe("A GitHub repository URL, e.g. https://github.com/owner/repo"),
      },
    },
    wrapAction(analysisTools.analyzeRepository)
  );

  server.registerTool(
    "get_current_context",
    {
      title: "Get current context",
      description:
        "What the developer is currently looking at in the CodeBiome browser tab right now (selected module, active flow walkthrough, current step), if anything. Call this when a question uses a pronoun or implicit reference like 'this module', 'this', or 'here' instead of naming an entity explicitly — it tells you what 'this' refers to instead of guessing.",
      inputSchema: { ...repoArgs },
    },
    wrap("get_current_context", (_a, r: any) => (r.hasSelection ? `Developer is looking at ${r.selectedModule?.name ?? "?"}` : "Nothing selected"), repositoryTools.getCurrentContext)
  );

  server.registerTool(
    "get_repository_overview",
    {
      title: "Get repository overview",
      description:
        "Repository metadata: languages, frameworks, file/module counts, detected entry points, and the highest-importance modules. Call this first to orient yourself in an unfamiliar repository.",
      inputSchema: { ...repoArgs },
    },
    wrap("get_repository_overview", (_a, r: any) => `${r.repository ?? r.name}: ${r.statistics.moduleCount} modules, ${r.entryPoints.length} entry points`, repositoryTools.getRepositoryOverview)
  );

  server.registerTool(
    "search_repository",
    {
      title: "Search repository",
      description: "Deterministic keyword search over module names/paths, file paths, and entry-point evidence. Not semantic search — returns real path/name matches with the reason each matched.",
      inputSchema: { query: z.string(), ...repoArgs },
    },
    wrap("search_repository", (a: any, r: any) => `"${a.query}" -> ${r.matches.length} match(es)`, repositoryTools.searchRepository)
  );

  server.registerTool(
    "get_file",
    {
      title: "Get file",
      description:
        "Fetch a file's real source content (as of the analyzed commit) by repository-relative path. This is static source text — it shows what the code says, not what it does when it actually runs. Claims about runtime behavior derived from reading it (timing, concurrency/race conditions, actual call frequency, whether an error path is ever hit in practice) are your inference from code structure, not an observation — say so explicitly rather than asserting them as confirmed fact.",
      inputSchema: { path: z.string(), ...repoArgs },
    },
    wrap("get_file", (a: any) => `Read ${a.path}`, repositoryTools.getFile)
  );

  server.registerTool(
    "get_module",
    {
      title: "Get module",
      description: "Full facts about one module: files, importance/centrality, risk indicators, dependencies, dependents, entry points inside it, and which detected flows pass through it.",
      inputSchema: { moduleId: z.string().describe("Module id, name, or path"), ...repoArgs },
    },
    wrap("get_module", (a: any) => `Inspected module "${a.moduleId}"`, repositoryTools.getModule)
  );

  server.registerTool(
    "list_flows",
    {
      title: "List flows",
      description: "All statically reconstructed execution-path flows CodeBiome detected, with confidence and the modules/layers each passes through.",
      inputSchema: { ...repoArgs },
    },
    wrap("list_flows", (_a, r: any) => `${r.flows.length} flow(s)`, flowTools.listFlows)
  );

  server.registerTool(
    "get_flow",
    {
      title: "Get flow",
      description: "The complete step-by-step reconstruction of one flow, with per-step evidence and confidence. Always a static reconstruction, never a runtime trace.",
      inputSchema: { flowId: z.string().describe("Flow id or name"), ...repoArgs },
    },
    wrap("get_flow", (a: any, r: any) => `Explained flow "${r.name}" (${r.steps.length} steps)`, flowTools.getFlow)
  );

  server.registerTool(
    "trace_dependency_path",
    {
      title: "Trace dependency path",
      description: "Finds a chain of real dependency edges between two modules via BFS over the deterministic module graph. Explicitly reports when no path is found rather than guessing.",
      inputSchema: { from: z.string().describe("Source module id/name/path"), to: z.string().describe("Target module id/name/path"), ...repoArgs },
    },
    wrap("trace_dependency_path", (_a, r: any) => (r.found ? `Path found: ${r.path.map((m: any) => m.name).join(" -> ")}` : "No path found"), flowTools.traceDependencyPath)
  );

  server.registerTool(
    "get_module_dependencies",
    {
      title: "Get module dependencies",
      description: "A module's direct dependencies/dependents, dependency depth, and any direct circular dependency pairs.",
      inputSchema: { moduleId: z.string(), ...repoArgs },
    },
    wrap("get_module_dependencies", (a: any, r: any) => `${r.dependencies.length} dependencies, ${r.dependents.length} dependents`, flowTools.getModuleDependencies)
  );

  server.registerTool(
    "find_feature",
    {
      title: "Find feature",
      description:
        "Maps a natural-language question (e.g. \"how does a user place an order?\") to candidate flows/modules/entry points using keyword-overlap heuristics — NOT semantic understanding. Use this to narrow down what to investigate next with get_flow/get_module.",
      inputSchema: { query: z.string(), ...repoArgs },
    },
    wrap(
      "find_feature",
      (a: any, r: any) => `"${a.query}" -> ${r.candidateFlows.length} flow(s), ${r.candidateModules.length} module(s) matched`,
      flowTools.findFeature
    )
  );

  server.registerTool(
    "open_module",
    {
      title: "Open module",
      description: "Navigates the CodeBiome world to a module and opens its Investigation Panel. Fails if the module doesn't exist in this repository's analysis.",
      inputSchema: { moduleId: z.string(), ...repoArgs },
    },
    wrapAction(worldActionTools.openModule)
  );

  server.registerTool(
    "start_flow",
    {
      title: "Start flow walkthrough",
      description: "Enters guided Walkthrough Mode for a detected flow in the CodeBiome world, at step 1.",
      inputSchema: { flowId: z.string(), ...repoArgs },
    },
    wrapAction(worldActionTools.startFlow)
  );

  server.registerTool(
    "focus_flow_step",
    {
      title: "Focus flow step",
      description: "Moves an active (or newly started) flow walkthrough to a specific step index (0-based) and focuses the world camera there.",
      inputSchema: { flowId: z.string(), stepIndex: z.number().int().min(0), ...repoArgs },
    },
    wrapAction(worldActionTools.focusFlowStep)
  );

  server.registerTool(
    "open_file",
    {
      title: "Open file",
      description: "Opens a specific file (optionally at a line) in the Investigation Panel's Code tab.",
      inputSchema: { path: z.string(), line: z.number().int().min(1).optional(), ...repoArgs },
    },
    wrapAction(worldActionTools.openFile)
  );

  server.registerTool(
    "show_dependencies",
    {
      title: "Show dependencies",
      description: "Opens a module and switches its Investigation Panel to the Dependencies tab.",
      inputSchema: { moduleId: z.string(), ...repoArgs },
    },
    wrapAction(worldActionTools.showDependencies)
  );

  server.registerTool(
    "show_impact",
    {
      title: "Show impact",
      description: "Highlights every module that transitively depends on the given module — \"what would I affect if I changed this?\"",
      inputSchema: { moduleId: z.string(), ...repoArgs },
    },
    wrapAction(worldActionTools.showImpact)
  );

  server.registerTool(
    "list_domain_concepts",
    {
      title: "List domain concepts",
      description:
        "Lists the AI-interpreted domain concepts already contributed for this repository (via contribute_domain_concept in this or an earlier session) — not deterministic facts, each carries its own confidence. Check this before contributing a new concept to avoid duplicating one that already exists.",
      inputSchema: { ...repoArgs },
    },
    wrap("list_domain_concepts", (_a, r: any) => `${r.concepts.length} concept(s) on file`, domainConceptTools.listDomainConcepts)
  );

  server.registerTool(
    "contribute_domain_concept",
    {
      title: "Contribute domain concept",
      description:
        "Submits YOUR interpretation of a higher-level domain concept this repository implements (e.g. 'Order Fulfillment', 'Authentication', 'Rate Limiting') — something no deterministic analyzer can name on its own, but that you can recognize from reading the code and its real structure. This is the ONE tool that lets you materially shape what the developer sees: a contributed concept is layered into the CodeBiome world as an explicit AI interpretation, always labeled with your confidence and never presented as a deterministic fact. Every module/file you cite MUST already exist in this repository's analysis (call get_module/get_repository_overview/search_repository first if unsure) — a concept referencing something that doesn't exist will be rejected. Call list_domain_concepts first to avoid contributing a duplicate.",
      inputSchema: {
        name: z.string().describe("Short concept name, e.g. 'Authentication' or 'Order Fulfillment'"),
        description: z.string().describe("What this concept is and why these modules/files embody it — this is shown to the developer as your explanation"),
        relatedModuleIds: z.array(z.string()).min(1).describe("Real module ids/names/paths this concept groups — must already exist"),
        relatedFileIds: z.array(z.string()).optional().describe("Optional real file ids/paths that are especially representative of this concept"),
        confidence: z.number().min(0).max(1).describe("Your confidence in this interpretation, 0 to 1 — shown to the developer, be honest"),
        ...repoArgs,
      },
    },
    wrapAction(domainConceptTools.contributeDomainConcept)
  );

  server.registerTool(
    "create_onboarding_journey",
    {
      title: "Create onboarding journey",
      description:
        "Creates a guided, ordered onboarding journey through real modules — YOUR interpretation of what a newcomer should look at, in what order, and why. Unlike a flow (a single reconstructed request path), a journey can span multiple areas of the codebase and is narrated entirely by you. The moment you call this, CodeBiome's world reacts: it focuses the first step's module immediately, the same way start_flow does. Investigate first (get_repository_overview, find_feature, get_module, list_flows) so every step is grounded in real evidence — every moduleId you reference MUST already exist in this repository's analysis or the call is rejected. Call list_onboarding_journeys first to avoid creating a near-duplicate.",
      inputSchema: {
        title: z.string().describe("Short journey title, e.g. 'Understanding Order Creation'"),
        goal: z.string().describe("One-sentence goal, e.g. 'Understand how an order request travels through the application'"),
        steps: z
          .array(
            z.object({
              moduleId: z.string().describe("Real module id, name, or path — must already exist"),
              reason: z.string().describe("Why this module matters at this point in the journey — your explanation, shown to the developer"),
            })
          )
          .min(1)
          .describe("Ordered steps — the array order IS the walkthrough order"),
        confidence: z.number().min(0).max(1).describe("Your confidence in this journey as a good onboarding path, 0 to 1 — shown to the developer, be honest"),
        ...repoArgs,
      },
    },
    wrapAction(onboardingTools.createOnboardingJourney)
  );

  server.registerTool(
    "list_onboarding_journeys",
    {
      title: "List onboarding journeys",
      description:
        "Lists onboarding journeys already created for this repository (via create_onboarding_journey in this or an earlier session) — not deterministic facts, each is Bob's own interpretation with its own confidence. Check this before creating a new journey to avoid duplicating one that already covers the same ground.",
      inputSchema: { ...repoArgs },
    },
    wrap("list_onboarding_journeys", (_a, r: any) => `${r.journeys.length} onboarding journey(s) on file`, onboardingTools.listOnboardingJourneys)
  );

  server.registerTool(
    "advance_onboarding_step",
    {
      title: "Advance onboarding step",
      description:
        "Moves an existing onboarding journey to a specific step index (0-based) and focuses the world camera on that step's module — use this to guide the developer to the next step after a follow-up question like 'what happens after this?' once you've confirmed (via get_module_dependencies/get_flow) which step comes next. Fails if the journey or step index doesn't exist.",
      inputSchema: { journeyId: z.string().describe("Journey id or title"), stepIndex: z.number().int().min(0), ...repoArgs },
    },
    wrapAction(onboardingTools.advanceOnboardingStep)
  );
}
