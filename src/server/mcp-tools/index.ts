import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { activityEventBus } from "@/server/agent/eventBus";
import { resolveWorld } from "./resolveRepository";
import * as repositoryTools from "./repositoryTools";
import * as flowTools from "./flowTools";
import * as worldActionTools from "./worldActionTools";
import * as domainConceptTools from "./domainConceptTools";
import * as onboardingTools from "./onboardingTools";
import * as analysisTools from "./analysisTools";
import * as planTools from "./planTools";
import * as submissionTools from "./submissionTools";

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
  worldId: z
    .string()
    .optional()
    .describe(
      "The CodeBiome World id — from analyze_repository's result, or from whatever the developer currently has open. Omit to fall back to owner/repo, or to this connection's own configured default World (never another agent's or user's World)."
    ),
  owner: z.string().optional(),
  repo: z.string().optional(),
};

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function err(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : "Unknown error";
  return { content: [{ type: "text", text: message }], isError: true };
}

export interface RegisterMcpToolsOptions {
  /**
   * Resolved per MCP connection from that connection's own request (e.g. an
   * `?worldId=` query param — see src/server/api-handlers/mcp.ts), never
   * from shared/global state. This is what lets two different agents/
   * developers hitting the same deployed CodeBiome instance resolve
   * independently instead of colliding on "whichever World was most recent"
   * (docs/WORLD_ARCHITECTURE.md §4).
   */
  defaultWorldId?: string;
}

export function registerMcpTools(server: McpServer, options: RegisterMcpToolsOptions = {}): void {
  /** Merges this connection's default in ONLY when the call gave no worldId/owner/repo at all. */
  function withDefault<Args extends Record<string, unknown>>(args: Args): Args & { worldId?: string } {
    if (args.worldId || args.owner || args.repo) return args;
    return { ...args, worldId: options.defaultWorldId };
  }

  async function activeWorldContext(args: { worldId?: string; owner?: string; repo?: string }): Promise<{ worldId: string; repositoryId: string } | null> {
    try {
      const { world } = await resolveWorld(withDefault(args));
      return { worldId: world.id, repositoryId: world.repositoryId };
    } catch {
      return null;
    }
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
        return ok(await fn(withDefault(args)));
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
      const resolvedArgs = withDefault(args);
      const context = await activeWorldContext(resolvedArgs);
      try {
        const result = await fn(resolvedArgs);
        if (context) {
          activityEventBus.publish({
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
          activityEventBus.publish({
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

  server.registerTool(
    "analyze_repository",
    {
      title: "Analyze repository",
      description:
        "The agent-first entry point (docs/WORLD_ARCHITECTURE.md): fetches a public GitHub repository and records its real file tree — NO requirement that the developer has opened the CodeBiome web app first. This does NOT run any architecture analysis itself: CodeBiome no longer guesses at modules/dependencies/entry points on your behalf. After calling this, explore the repository yourself (get_file, search_repository, get_repository_overview) and then call submit_modules/submit_dependencies/submit_entry_points/submit_frameworks/submit_security_findings/submit_code_health/submit_flow/submit_request_journey to tell CodeBiome what you actually found — every reference you submit is checked against the real file tree before it's stored, so you can't invent a file that doesn't exist, but nothing appears until you submit it. Call this FIRST when asked to analyze/onboard into a repository the developer names by URL; use the returned worldId in every subsequent tool call in this conversation so they all operate on the same World, which updates live as you submit findings.",
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
        agentName: z.string().optional().describe("Your agent/client name (e.g. 'claude-code', 'cursor') — shown as this concept's provenance. Omit if unknown."),
        agentVersion: z.string().optional(),
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
        agentName: z.string().optional().describe("Your agent/client name (e.g. 'claude-code', 'cursor') — shown as this journey's provenance. Omit if unknown."),
        agentVersion: z.string().optional(),
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
        "Lists onboarding journeys already created for this repository (via create_onboarding_journey in this or an earlier session) — not deterministic facts, each is the agent's own interpretation with its own confidence. Check this before creating a new journey to avoid duplicating one that already covers the same ground.",
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

  const featurePlanStepSchema = z.object({
    kind: z
      .enum(["page", "entry", "controller", "handler", "service", "entity", "function", "repository", "database", "external-api", "event", "unknown"])
      .describe("The architectural layer this step plays."),
    label: z.string().describe("Short human-readable label, e.g. 'Wishlist Controller'."),
    status: z.enum(["new", "existing"]).describe("'existing' means this file already exists in the repository — verified before storage. 'new' means it would need to be created."),
    filePath: z
      .string()
      .describe(
        "If status is 'existing', this MUST exactly match a real file path you've confirmed exists (e.g. via get_file/get_module/search_repository) — a path that doesn't resolve is automatically relabeled 'new'. If status is 'new', a suggested path following the repository's real conventions."
      ),
    explanation: z.string().describe("One sentence: why this step is here."),
  });

  server.registerTool(
    "propose_feature_plan",
    {
      title: "Propose feature plan",
      description:
        "Proposes how a NOT-YET-BUILT feature would likely be implemented in this repository, and what it would impact — YOUR interpretation, grounded in the real repository structure. Unlike a flow (a reconstruction of code that already exists), this describes something speculative: a mix of real existing files this feature would reuse and new files it would need. The moment you call this, the proposal is stored and rendered in the CodeBiome web app's \"Plan\" tab — the returned url opens it directly; hand that to the developer. Investigate first (get_repository_overview, find_feature, get_module, list_flows, trace_dependency_path) so every 'existing' step is grounded in something you've actually confirmed — a filePath/domain/technology reference that doesn't resolve to something real is automatically corrected (downgraded to 'new', or dropped) rather than rejecting the whole call, and every correction is disclosed back to the developer. Call list_feature_plans first to avoid proposing a near-duplicate.",
      inputSchema: {
        description: z.string().describe("The developer's own feature request, echoed back verbatim."),
        name: z.string().describe("A short (1-4 word) name for the feature, e.g. 'Wishlist'."),
        summary: z.string().describe("2-3 plain-language sentences: what this adds and what it reuses from the existing codebase."),
        confidence: z.enum(["high", "medium", "low"]).describe("Your own confidence in this plan given how well the repository supports it — be honest."),
        steps: z.array(featurePlanStepSchema).min(1).describe("The likely request/execution path for this feature, in order."),
        impactedEntities: z
          .array(
            z.object({
              kind: z.enum(["domain", "infra"]),
              name: z.string().describe("Must exactly match a real domain name (from get_repository_overview/get_module) or a real detected technology name."),
              reason: z.string(),
            })
          )
          .optional()
          .describe("Which real domains or technologies this feature would touch."),
        newFiles: z.array(z.object({ suggestedPath: z.string(), purpose: z.string() })).optional(),
        modifiedFiles: z
          .array(z.object({ filePath: z.string().describe("MUST be a real, existing file path — verified before storage."), reason: z.string() }))
          .optional()
          .describe("Real existing files that would need to change."),
        ...repoArgs,
      },
    },
    wrapAction(planTools.proposeFeaturePlan)
  );

  server.registerTool(
    "list_feature_plans",
    {
      title: "List feature plans",
      description:
        "Lists feature implementation plans already proposed for this repository (via propose_feature_plan in this or an earlier session) — not deterministic facts, each is the agent's own interpretation with its own confidence. Check this before proposing a new plan to avoid duplicating one that already covers the same feature.",
      inputSchema: { ...repoArgs },
    },
    wrap("list_feature_plans", (_a, r: any) => `${r.plans.length} feature plan(s) on file`, planTools.listFeaturePlans)
  );

  // ---------------------------------------------------------------------
  // submit_* tools — these are how the architecture actually gets built.
  // CodeBiome no longer analyzes the repository itself; it verifies every
  // reference you submit against the real file tree (analyze_repository's
  // result) and renders whatever you've submitted so far.
  // ---------------------------------------------------------------------

  const riskIndicatorSchema = z.object({
    kind: z.enum(["large-file", "high-complexity", "todo-fixme", "no-tests", "duplicated-code", "dead-code-candidate", "deprecated-pattern", "vulnerable-dependency", "hardcoded-secret-pattern"]),
    severity: z.enum(["low", "medium", "high"]),
    detail: z.string(),
    evidence: z.string(),
  });

  server.registerTool(
    "submit_modules",
    {
      title: "Submit modules",
      description:
        "Tells CodeBiome about real module/directory boundaries you found in this repository — the foundation everything else (dependencies, entry points, the Architecture lens) is built on. Every fileId you list MUST be a real path from analyze_repository's file tree (call search_repository/get_file if unsure) — a module referencing a file that doesn't exist is rejected. Call this before submit_dependencies, since dependency edges resolve file-level edges up to whichever module owns each file.",
      inputSchema: {
        modules: z
          .array(
            z.object({
              id: z.string().optional().describe("Stable id for this module — defaults to `path` if omitted. Re-submitting the same id updates it."),
              name: z.string(),
              path: z.string().describe("The directory (or representative path) this module groups."),
              description: z.string().optional(),
              fileIds: z.array(z.string()).min(1).describe("Real file paths belonging to this module."),
              importance: z.number().min(0).max(1).describe("Your judgment of how architecturally central this module is, 0 to 1."),
              risk: z.array(riskIndicatorSchema).optional(),
            })
          )
          .min(1),
        ...repoArgs,
      },
    },
    wrap("submit_modules", (a: any, r: any) => `Submitted ${a.modules.length} module(s), ${r.moduleCount} on file`, submissionTools.submitModules)
  );

  server.registerTool(
    "submit_dependencies",
    {
      title: "Submit dependencies",
      description:
        "Tells CodeBiome about real dependency edges you found (imports, calls, http requests, db reads/writes, package dependencies). Both ends MUST already exist — a real file (fromKind/toKind: 'file'), a real module you already submitted via submit_modules ('module'), or, for toKind 'external-package', any package name (not checked against the file tree). Module-level dependencyIds/dependentIds/centrality are recomputed automatically from these edges — never submit those yourself.",
      inputSchema: {
        dependencies: z
          .array(
            z.object({
              fromId: z.string(),
              toId: z.string(),
              fromKind: z.enum(["file", "module"]),
              toKind: z.enum(["file", "module", "external-package"]),
              relationship: z.enum(["imports", "calls", "extends", "http-request", "navigates-to", "reads-writes-db", "package-dependency"]),
              confidence: z.number().min(0).max(1).describe("1.0 for something unambiguous (a direct import), lower for a heuristic match."),
            })
          )
          .min(1),
        ...repoArgs,
      },
    },
    wrap("submit_dependencies", (a: any, r: any) => `Submitted ${a.dependencies.length} edge(s), ${r.dependencyCount} on file`, submissionTools.submitDependencies)
  );

  server.registerTool(
    "submit_entry_points",
    {
      title: "Submit entry points",
      description: "Tells CodeBiome about real entry points you found (HTTP routes, CLI commands, app startup, workers, scheduled jobs, frontend pages). fileId MUST be a real file.",
      inputSchema: {
        entryPoints: z
          .array(
            z.object({
              id: z.string().optional(),
              type: z.enum(["http-route", "cli-command", "app-startup", "worker", "script", "scheduled-job", "frontend-page"]),
              name: z.string(),
              fileId: z.string().describe("Real file path where this entry point is declared."),
              detectionEvidence: z.string().describe("What in the file makes this an entry point — shown to the developer."),
            })
          )
          .min(1),
        ...repoArgs,
      },
    },
    wrap("submit_entry_points", (a: any, r: any) => `Submitted ${a.entryPoints.length} entry point(s), ${r.entryPointCount} on file`, submissionTools.submitEntryPoints)
  );

  server.registerTool(
    "submit_frameworks",
    {
      title: "Submit frameworks",
      description: "Tells CodeBiome about frameworks/technologies you detected (e.g. a web framework, a database, a cache, a queue, an external API). Each evidence fileId MUST be a real file.",
      inputSchema: {
        frameworks: z
          .array(
            z.object({
              name: z.string(),
              category: z.enum(["frontend", "backend", "fullstack", "mobile", "infra", "testing", "other", "database", "cache", "queue", "search", "external-api"]),
              evidence: z.array(z.string()).min(1).describe("Real file paths that show this technology is used (e.g. an import, a config file)."),
              confidence: z.number().min(0).max(1),
            })
          )
          .min(1),
        ...repoArgs,
      },
    },
    wrap("submit_frameworks", (a: any, r: any) => `Submitted ${a.frameworks.length} framework(s), ${r.frameworkCount} on file`, submissionTools.submitFrameworks)
  );

  server.registerTool(
    "submit_security_findings",
    {
      title: "Submit security findings",
      description: "Tells CodeBiome about security issues you found — a pattern match at a specific file/line (e.g. a hardcoded secret), and/or a vulnerable dependency you identified (e.g. from a lockfile). patternMatches' fileId MUST be a real file.",
      inputSchema: {
        patternMatches: z
          .array(z.object({ fileId: z.string(), line: z.number().int().min(1), rule: z.string(), severity: z.enum(["low", "moderate", "high", "critical"]) }))
          .optional(),
        vulnerableDependencies: z
          .array(
            z.object({
              packageName: z.string(),
              installedVersion: z.string(),
              advisoryId: z.string(),
              severity: z.enum(["low", "moderate", "high", "critical"]),
              source: z.enum(["osv", "npm-audit", "github-advisory"]),
            })
          )
          .optional(),
        ...repoArgs,
      },
    },
    wrap(
      "submit_security_findings",
      (_a, r: any) => `Now ${r.patternMatchCount} pattern match(es), ${r.vulnerableDependencyCount} vulnerable dependenc(ies) on file`,
      submissionTools.submitSecurityFindings
    )
  );

  server.registerTool(
    "submit_code_health",
    {
      title: "Submit code health",
      description:
        "Tells CodeBiome about repository-hygiene signals you assessed yourself — the things the old built-in analyzer never actually computed: TODO/FIXME comments, dead-code candidates, duplicated code, modules missing tests, deprecated patterns, which files are tests and what they cover, test coverage if you found a coverage report, a docs directory, API documentation, and git history signals (hotspots, contributors) if you have that information. All fields are optional but provide at least one. Every fileId/moduleId referenced MUST be real.",
      inputSchema: {
        todoFixme: z.array(z.object({ fileId: z.string(), line: z.number().int().min(1), text: z.string(), kind: z.enum(["TODO", "FIXME"]) })).optional(),
        deadCodeCandidates: z.array(z.object({ fileId: z.string(), exportName: z.string(), reason: z.string() })).optional(),
        duplicatedCodeCandidates: z.array(z.object({ fileIds: z.array(z.string()).min(2), similarity: z.number().min(0).max(1), reason: z.string() })).optional(),
        missingTests: z.array(z.object({ moduleId: z.string(), reason: z.string() })).optional(),
        deprecatedPatterns: z.array(z.object({ fileId: z.string(), pattern: z.string(), evidence: z.string() })).optional(),
        testFiles: z.array(z.object({ fileId: z.string(), framework: z.string().nullable(), testedModuleIds: z.array(z.string()) })).optional(),
        coverage: z
          .object({ overallPercentage: z.number().min(0).max(100), byModule: z.array(z.object({ moduleId: z.string(), percentage: z.number().min(0).max(100) })).optional() })
          .optional()
          .describe("Only if you actually found a real coverage report — never estimate this."),
        docsDirectoryFileIds: z.array(z.string()).optional(),
        apiDocumentation: z.object({ toolDetected: z.string().nullable(), fileIds: z.array(z.string()) }).optional(),
        gitHotspots: z.array(z.object({ fileId: z.string(), changeCount: z.number().int().min(0), coChangedWith: z.array(z.string()) })).optional(),
        gitContributors: z
          .array(z.object({ name: z.string(), email: z.string(), commitCount: z.number().int().min(0), firstCommitAt: z.string(), lastCommitAt: z.string() }))
          .optional(),
        ...repoArgs,
      },
    },
    wrap("submit_code_health", (_a, r: any) => `Updated: ${r.updated.join(", ")}`, submissionTools.submitCodeHealth)
  );

  const flowStepInputSchema = z.object({
    entityId: z.string().describe("Real file path this step happens in."),
    moduleId: z.string().optional().describe("Real module id, if you've already submitted one that owns this file."),
    kind: z.enum(["entry", "controller", "handler", "service", "entity", "function", "repository", "database", "external-api", "event", "unknown"]),
    label: z.string(),
    symbol: z.string().optional().describe("The function/method name, if known."),
    explanation: z.string().describe("One sentence: what happens at this step."),
    evidence: z.array(z.string()).optional().describe("Short quotes/line references backing this step."),
  });

  server.registerTool(
    "submit_flow",
    {
      title: "Submit flow",
      description:
        "Submits a statically-reconstructed request/execution flow you traced through the real code — an ordered chain of steps (entry -> controller -> service -> ... -> database), each grounded in a real file. Steps are linked in the order given. Every step's entityId MUST be a real file. Re-submitting the same id (or omitting id, which then generates a new one) lets you build up or correct a flow across multiple calls.",
      inputSchema: {
        id: z.string().optional(),
        name: z.string(),
        description: z.string(),
        confidence: z.enum(["high", "medium", "low"]),
        steps: z.array(flowStepInputSchema).min(1),
        evidence: z.array(z.string()).optional(),
        ...repoArgs,
      },
    },
    wrap("submit_flow", (a: any) => `Submitted flow "${a.name}" (${a.steps.length} step(s))`, submissionTools.submitFlow)
  );

  server.registerTool(
    "submit_request_journey",
    {
      title: "Submit request journey",
      description:
        "Submits a multi-request user journey you traced across pages (e.g. sign-up: a register page -> its call to a backend flow -> a redirect to another page). A 'call' step's flowId, if given, MUST already exist (submit_flow first). Every step's entityId MUST be a real file.",
      inputSchema: {
        id: z.string().optional(),
        name: z.string(),
        description: z.string(),
        confidence: z.enum(["high", "medium", "low"]),
        steps: z
          .array(
            z.object({
              kind: z.enum(["page", "call"]),
              entityId: z.string().describe("Real file path — the page file for a 'page' step, the backend entry-point file for a 'call' step."),
              label: z.string(),
              flowId: z.string().optional().describe("For a 'call' step: the flow this call reaches, if you've already submitted it via submit_flow."),
              explanation: z.string(),
              evidence: z.array(z.string()).optional(),
            })
          )
          .min(1),
        evidence: z.array(z.string()).optional(),
        ...repoArgs,
      },
    },
    wrap("submit_request_journey", (a: any) => `Submitted journey "${a.name}" (${a.steps.length} step(s))`, submissionTools.submitRequestJourney)
  );
}
