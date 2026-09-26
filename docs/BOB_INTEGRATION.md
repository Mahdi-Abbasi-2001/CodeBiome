# IBM Bob 2.0 Integration

## 0. What this document is

This records the investigation into how CodeBiome can actually integrate
with IBM Bob 2.0 — done *before* any code was written, per the same
discipline this project has followed at every prior step ("inspect and
propose, then implement incrementally"). The conclusion changes the shape
of the integration from what a first guess might assume, so read §1 before
anything else.

**See also `docs/WORLD_ARCHITECTURE.md`** for the Bob-first workflow added
after this document was written: `analyze_repository` lets a developer ask
Bob to analyze a repository with no requirement to open the CodeBiome web
app first, backed by durable (Vercel Blob) World storage so it works
correctly across Vercel's separate serverless instances.

Sources consulted (IBM's own documentation, current as of this writing):

- [bob.ibm.com/docs/ide](https://bob.ibm.com/docs/ide) — what Bob is, its
  modes, its architecture
- [bob.ibm.com/docs/ide/configuration/mcp/understanding-mcp](https://bob.ibm.com/docs/ide/configuration/mcp/understanding-mcp)
  and [.../mcp-in-bob](https://bob.ibm.com/docs/ide/configuration/mcp/mcp-in-bob) —
  Bob's MCP client configuration
- [bob.ibm.com/docs/ide/changelog](https://bob.ibm.com/docs/ide/changelog) —
  what's new in 2.0 vs 1.0
- [ibm.com/think/tutorials/mcp-integration-ibm-bob](https://www.ibm.com/think/tutorials/mcp-integration-ibm-bob) —
  IBM's own worked example of building an MCP server for Bob
- [ibm.com/products/ai-coding-agent](https://www.ibm.com/products/ai-coding-agent) —
  product/licensing model
- [bob.ibm.com/docs/shell](https://bob.ibm.com/docs/shell) and
  [.../shell/getting-started/install-and-setup](https://bob.ibm.com/docs/shell/getting-started/install-and-setup) —
  Bob Shell installation, auth, and `bob run`/`bob chat` usage (§10, §13)

## 1. What IBM Bob actually is (and why it changes the architecture)

**IBM Bob is an AI coding agent — an IDE plugin plus a CLI ("Bob Shell") —
that a developer runs against their own checkout of a repository.** It is
in the same product category as Claude Code, Cursor, or GitHub Copilot
Workspace: an interactive tool a human drives from their editor/terminal,
not a hosted API you call from a web backend to get a chat completion back.

Three facts from IBM's own docs drive every decision below:

1. **Bob is an MCP *client* only.** Its docs state this explicitly: "Bob
   (the client) connects to MCP servers." Bob calls *out* to MCP servers to
   gain tools. There is no documented mechanism for an external
   application to call *into* Bob to get an answer back — MCP has no such
   direction, and IBM's docs don't describe one.
2. **There is no "IBM Bob API" for embedding Bob's reasoning in another
   app.** Bob 2.0 is licensed per-seat ("Bobcoins", IBM account required)
   and used interactively — IDE, web-based interface, or Bob Shell. Nothing
   in IBM's documentation offers a headless/programmatic invocation mode
   that a web backend could call to get a synthesized natural-language
   answer.
3. **MCP tool results go back to the client that called them, not
   anywhere else.** When Bob calls a tool, the MCP server (CodeBiome, in
   this design) returns the tool's result to Bob's own process. CodeBiome's
   server never sees Bob's final answer, its reasoning, or even the
   original question — only the tool name and arguments Bob chose to call.

**Consequence:** the architecture this project's earlier plan implicitly
assumed — CodeBiome's web page calling out to "Bob" to get an answer to
render in its own chat panel — is not how the real product works, in
either direction. The correct, IBM-supported shape is the reverse: **Bob is
the client, CodeBiome is the server.** A developer configures their own Bob
(in their IDE, pointed at the repository) to connect to CodeBiome's MCP
server; Bob decides which tools to call, when, and in what order; Bob's own
UI (in the IDE) is where the developer reads Bob's synthesized answer.

This is why the acceptance criterion "no fake API integration" mattered
enough to investigate first: the tempting shortcut — wrap an LLM call,
label it "Bob" — would have been exactly the fabrication the brief
explicitly forbids. What's implemented instead is the actual, officially
documented mechanism.

## 2. Architecture

```
   Developer's own IBM Bob session          CodeBiome (this app)
   (IDE plugin or Bob Shell CLI,                  │
    running against the repo checkout)             │
            │                                       │
            │ MCP (Streamable HTTP)                 │
            │ .bob/mcp.json -> this app's /api/mcp   │
            ▼                                       │
   ┌────────────────────┐                           │
   │  CodeBiome MCP      │◄── same Next.js process ──┘
   │  server (/api/mcp)  │
   └─────────┬───────────┘
             │ registerBobTools()
   ┌─────────┴──────────────────────────────────┐
   ▼                     ▼                        ▼
Repository tools    Flow tools              World-action tools
(get_repository_    (list_flows, get_flow,  (open_module, start_flow,
 overview, search_   trace_dependency_path,  focus_flow_step, open_file,
 repository,         get_module_dependencies, show_dependencies,
 get_file,           find_feature)            show_impact)
 get_module)              │                        │
   │                      │                        │ publishes a
   └──────────┬───────────┘                        │ WorldActionEvent
              ▼                                     ▼
   Repository Knowledge Model (RKM)         src/server/bob/eventBus.ts
   + FlowModel (existing, unmodified)      (in-memory pub/sub, this
              │                             process only)
              ▼                                     │
   Deterministic analyzers (existing,                │ SSE
   unmodified) -> GitHub                             ▼
                                          Browser tab showing this
                                          repository's CodeBiome world
                                          (src/features/bob/useBobBridge.ts)
                                                      │
                                                      ▼
                                          Same selection/flow-walkthrough
                                          state a human clicking the UI
                                          would produce (src/app/page.tsx)
```

Every box under "Repository tools" / "Flow tools" is a thin wrapper around
code that already existed before this feature: the RKM, the flow inference
engine, and the World Model builder are untouched. Nothing here is a second
analysis pipeline.

### 2.1 How Bob's output gets reflected in the CodeBiome UI

This is the part worth being precise about, because it's the one place the
honest architecture is *less* than a naive "Bob chatbot in a panel" design
would promise, and the brief explicitly requires that boundary to be
explicit rather than glossed over:

- **CodeBiome never receives Bob's natural-language answer.** MCP doesn't
  route it there. What a developer using Bob actually sees — "I found a
  likely order-creation flow, let me walk you through it..." — is rendered
  entirely inside Bob's own IDE/CLI interface, not inside CodeBiome.
- **What CodeBiome *can* honestly show, and does:** every MCP tool call
  Bob makes is a real, observable event on CodeBiome's server (it has to
  handle the call to answer it). Two things happen with that:
  1. The six *world-action* tools (`open_module`, `start_flow`,
     `focus_flow_step`, `open_file`, `show_dependencies`, `show_impact`)
     each publish a `WorldActionEvent` on an in-memory bus
     (`src/server/bob/eventBus.ts`). The browser tab for that repository
     holds an SSE connection (`/api/bob-events`, consumed by
     `useBobBridge.ts`) and applies the action to the *exact same* state
     transitions a human clicking the UI would trigger
     (`handleBobOpenModule`, `handleBobStartFlow`, etc. in `page.tsx`). So
     when Bob calls `start_flow`, the browser's camera and Investigation
     Panel genuinely move — this is verified working end-to-end (§10).
  2. *Every* tool call (including read-only ones like `get_module`) also
     publishes an `ActivityEvent` with a short, deterministic summary
     (e.g. `"Inspected module \"OrderService\""`). The world's HUD shows
     this as a live "Bob is connected" feed
     (`src/features/bob/BobActivityFeed.tsx`) — a real-time, truthful log
     of what Bob is doing, which is the closest honest substitute for
     showing "Bob's answer" that the actual protocol allows.
- **Before any real Bob session has connected**, the HUD shows exactly
  that: "Bob isn't connected yet" (or "listening, no calls yet" if the SSE
  bridge is up but idle) — never a fake "Bob is thinking..." animation.

## 3. What runs where

| | Runs inside |
|---|---|
| Natural-language understanding, tool selection, multi-tool synthesis, the actual explanation the developer reads | **IBM Bob** (developer's IDE/CLI) |
| Repository facts, flows, dependency graph, all 16 tool implementations | **CodeBiome's server** (`src/server/bob-tools/`, `src/app/api/mcp/route.ts`) |
| Applying a Bob-triggered navigation to the 3D world | **CodeBiome's browser client** (`src/features/bob/useBobBridge.ts` → existing `page.tsx` state) |
| The Repository Knowledge Model, Flow inference, World Model | **Unmodified existing code** — see `docs/REPOSITORY_KNOWLEDGE_MODEL.md` / `docs/ANALYZER_ARCHITECTURE.md` |

## 4. The tools Bob can call

All 22 are registered in `src/server/bob-tools/index.ts`; each one's actual
logic is a small, independently unit-tested, framework-free function (see
`*.test.ts` next to each source file) — the MCP wiring is the only part
that knows about the SDK.

**Analysis tool** (`src/server/bob-tools/analysisTools.ts`) — the Bob-first
entry point, added in docs/WORLD_ARCHITECTURE.md:
- `analyze_repository` — analyzes a GitHub repository from scratch (the
  same deterministic pipeline `/api/analyze` uses) and creates a durable
  CodeBiome World, with **no requirement that the developer has opened the
  CodeBiome web app first**. Returns a real World URL. Every other tool
  below accepts the resulting `worldId` (alongside the older `owner`/`repo`
  convenience path) — see docs/WORLD_ARCHITECTURE.md §4.

**Repository tools** (`src/server/bob-tools/repositoryTools.ts`)
- `get_current_context` — what the developer is currently looking at in the
  CodeBiome browser tab (selected module, active flow, current step), if
  anything. **Added after real Bob testing** (§10) showed "explain this
  module" has no way to resolve "this" without it — see §10.3.
- `get_repository_overview` — languages, frameworks, statistics, entry
  points, the highest-importance modules.
- `search_repository` — keyword match over module names/paths, file
  paths, and entry-point evidence. Explicitly labeled `method:
  "keyword-match"` — not semantic search.
- `get_file` — real source content as of the analyzed commit (same
  on-demand GitHub fetch the Investigation Panel's Code tab already uses —
  see `src/server/ingestion/fileContent.ts`, extracted so both share it).
- `get_module` — a module's files, importance/centrality, risk, real
  dependency/dependent names, entry points inside it, and which detected
  flows pass through it.

**Flow tools** (`src/server/bob-tools/flowTools.ts`) — expose the existing
`inferFlows` output and the dependency graph already computed on every
`ModuleFact`, not a second graph:
- `list_flows`, `get_flow` — the existing FlowModel, with the same
  "statically reconstructed, not a runtime trace" disclosure the UI shows.
- `trace_dependency_path` — BFS over the real module dependency graph;
  explicitly reports "no path found" rather than guessing when two modules
  aren't connected.
- `get_module_dependencies` — dependencies, dependents, dependency depth,
  direct circular pairs.
- `find_feature` — maps a natural-language query (*"how does a user place
  an order?"*) to candidate flows/modules/entry points by keyword overlap.
  Labeled `method: "keyword-heuristic"` with an explicit disclosure that
  it's not semantic understanding — Bob is expected to be the layer that
  turns these ranked candidates into an actual answer, exactly as intended
  by "use deterministic tools for facts, use Bob for reasoning."

**World-action tools** (`src/server/bob-tools/worldActionTools.ts`) — the
one hard invariant every one of these enforces: *validate against the real
RKM/FlowModel first, publish the navigation event second.* Bob can never
make the world "go to" something that doesn't exist.
- `open_module`, `start_flow`, `focus_flow_step`, `open_file`,
  `show_dependencies`, `show_impact` (computes real transitive dependents
  via BFS on `dependentIds`).

**Domain-concept tools** (`src/server/bob-tools/domainConceptTools.ts`) —
the AI-interpretation layer:
- `list_domain_concepts`, `contribute_domain_concept`. See §5.1.

**Onboarding-journey tools** (`src/server/bob-tools/onboardingTools.ts`) —
the other half of the AI-interpretation layer, and the primary onboarding
workflow:
- `create_onboarding_journey`, `list_onboarding_journeys`,
  `advance_onboarding_step`. See §5.2.

## 5. The AI-interpretation layer — Bob materially shapes what the developer sees

Every tool so far is Bob *reading* CodeBiome's facts or *navigating* an
already-built world. This layer is different: it's the one place Bob
*writes* something back — a genuine architectural interpretation that
becomes part of what every future viewer of this repository's world sees,
clearly and permanently tagged as AI-derived.

This layer has two shapes now — an unordered grouping (domain concepts,
§5.1) and an ordered, narrated path (onboarding journeys, §5.3) — sharing
the same hard invariant and the same additive-store pattern.

### 5.1 Domain concepts — why this doesn't compromise the deterministic foundation

`RepositoryKnowledgeModel.domainConcepts` — and the `ai-interpreted` branch
of `ProvenanceSchema` (`confidence`, `generatedBy: "bob"`, `modelVersion`)
— were part of the schema from the very first version of this project
(`docs/REPOSITORY_KNOWLEDGE_MODEL.md`), always empty until now. This
feature is the schema's original intent, finally implemented, not a new
concept bolted on:

- **The deterministic RKM is never mutated.** A contributed concept is
  stored in a separate, additive store
  (`src/server/bob/domainConceptStore.ts`) — the same shape as
  `sessionContextStore` — never written into the cached
  `RepositoryKnowledgeModel` object. The world you'd get from re-running
  analysis is bit-for-bit the same with or without any concepts Bob has
  contributed.
- **The hard invariant is enforced exactly like every other tool in this
  project.** `contribute_domain_concept` validates every
  `relatedModuleIds`/`relatedFileIds` entry against the real RKM *before*
  storing anything — a fabricated reference is rejected with
  `EntityNotFoundError` and nothing is stored or published. Verified both
  in unit tests (`domainConceptTools.test.ts`) and against the real running
  server (§10.2): `curl`-ing a concept referencing
  `"src/totally-fake-module"` against the actual analyzed
  `Mahdi-Abbasi-2001/liara-docs-assistant` repository returned
  `isError: true` with `No module "src/totally-fake-module" was found in
  this repository's analysis.` and published nothing.
- **Every concept is visually and structurally distinct from deterministic
  facts** — a separate periwinkle-themed "Bob's Interpretation" panel
  (`src/features/bob/DomainConceptsPanel.tsx`), never blended into the
  teal/amber deterministic world coloring, always showing Bob's own
  `confidence` percentage on every card.

#### How a concept reaches the world

```
Bob investigates (get_module, get_file, ...)
  -> calls contribute_domain_concept(name, description,
       relatedModuleIds, relatedFileIds?, confidence)
  -> validated against the real RKM (hard invariant)
  -> stored in domainConceptStore, keyed by repositoryId
  -> published as a DomainConceptEvent on the same event bus
     world-actions already use
  -> browser (useBobBridge) appends it to live `domainConcepts` state
  -> "Bob's Interpretation (N)" badge in the HUD updates in real time
  -> clicking a concept card selects one of its real modules and
     highlights all of them in the world (same highlight mechanism
     `show_impact` already used)
```

`list_domain_concepts` lets Bob check what's already been contributed
before adding more — its description explicitly instructs this, and real
testing (§10.2) confirmed Bob calls it first unprompted.

### 5.2 Onboarding journeys — ordered, narrated paths, and the primary onboarding workflow

Where a domain concept is an unordered grouping, an onboarding journey
(`src/types/onboarding.ts`) is Bob's second write path: an ORDERED sequence
of real modules Bob has decided a newcomer should walk, each step carrying
Bob's own reason. This is the direct implementation of the brief's core
workflow — "developer asks Bob to help them understand an unfamiliar
repository" — and it is deliberately its own concept, not a repurposed
`DataFlow`/Flow: a Flow is a single reconstructed request path through one
entry point; a journey can span multiple unrelated areas of the codebase
(auth, then content, then tests) in whatever order Bob judges most useful
for onboarding, which a deterministic call-chain reconstruction can't
produce on its own.

Same hard invariant, same additive-store shape as domain concepts:

- **The deterministic RKM is never mutated.** A journey is stored in
  `src/server/bob/onboardingJourneyStore.ts` — same shape as
  `domainConceptStore` — never written into the cached
  `RepositoryKnowledgeModel`. Re-running analysis produces the identical
  world with or without any journey Bob has ever created.
- **Every step's `moduleId` is validated against the real RKM before
  anything is stored.** `create_onboarding_journey` resolves each step
  through the same `findModule` lookup every other tool uses; the first
  fake reference throws `EntityNotFoundError` and nothing is stored or
  published — verified in `onboardingTools.test.ts` and, live, against
  `lujakob/nestjs-realworld-example-app` (§10.6).
- **`title`, `goal`, and each step's `reason` are pure interpretation** —
  CodeBiome validates only that they're non-empty, never their content.
  `provenance` carries the same `{ source: "ai-interpreted", confidence,
  generatedBy: "bob", modelVersion }` shape as a domain concept's.
- **Visually distinct**, using the same periwinkle "this is Bob" language
  as domain concepts: a dedicated "Bob's Onboarding Journeys" panel
  (`src/features/bob/OnboardingJourneyPanel.tsx`) and a periwinkle
  "BOB'S ONBOARDING JOURNEY" HUD card (`src/features/hud/WorldHud.tsx`),
  never blended into the teal (deterministic flow) or amber (important
  path) world coloring.

#### How a journey reaches the world, and how the interactive loop works

```
Bob investigates (get_repository_overview, find_feature, get_module, list_flows, ...)
  -> calls create_onboarding_journey(title, goal, steps[], confidence)
  -> every step's moduleId validated against the real RKM (hard invariant)
  -> stored in onboardingJourneyStore, keyed by repositoryId
  -> published as an OnboardingJourneyEvent (the full journey) AND a
     WorldAction ("focus_onboarding_step", stepIndex 0) — the world
     reacts immediately, the same way start_flow already does
  -> browser (useBobBridge) appends the journey to live `onboardingJourneys`
     state and applies the focus action: Investigation Panel opens on
     step 1's module, HUD shows "BOB'S ONBOARDING JOURNEY — Step 1/N"
  -> developer clicks "Continue →" (works with zero Bob involvement —
     verified live, §10.6) OR asks Bob a follow-up ("what's next?",
     "why does this matter?")
  -> a follow-up resolves through get_current_context, which now also
     reports the active onboarding journey/step (extended
     src/server/bob/sessionContext.ts + repositoryTools.ts) — Bob never
     needs the developer to repeat a module or journey name
  -> Bob can call advance_onboarding_step(journeyId, stepIndex) to move
     the walkthrough itself, or simply explain and let the developer
     click Continue — both are legitimate; real testing (§10.6) showed
     Bob choosing to ask ("Shall I advance the journey to step 3?")
     rather than acting unprompted, which is an honest interaction, not
     a gap
```

`list_onboarding_journeys` lets Bob check what already exists before
creating a near-duplicate — real testing (§10.6) confirmed Bob calls it
(and `list_domain_concepts`) unprompted, before creating anything.

## 6. What context Bob receives

Nothing, up front — deliberately. Per the brief's "progressive retrieval,
not a giant precomputed prompt" requirement, CodeBiome never sends Bob the
whole Repository Knowledge Model. Bob receives only:

- The static tool *descriptions* and JSON-Schema *input shapes* (visible
  via `tools/list`) — Bob's own model decides which to call based on these.
- Whatever a called tool returns — one module, one flow, one search result
  at a time.

Every tool accepts optional `owner`/`repo`. If Bob already knows the
repository it's running against (it usually will — it's running in that
checkout), it can pass them; if omitted, CodeBiome resolves to whichever
repository it most recently finished analyzing
(`knowledgeModelStore.getMostRecentlyAnalyzed()` /
`getLatestByRepositoryId()`, see §9) — the common case for a single-session
hackathon demo with one browser tab open.

## 7. Confidence and uncertainty — carried through, not reinvented

Every tool result reuses the SAME confidence vocabulary the UI already
established in Step 5 (`high`/`medium`/`low`, "statically reconstructed",
"not a runtime trace"):

- `get_flow`/`list_flows` return the Flow's real `confidence` field and an
  explicit `disclosure` string.
- `search_repository`/`find_feature` are labeled by *method*
  (`keyword-match` / `keyword-heuristic`) so nothing downstream can
  mistake a string match for semantic understanding.
- `trace_dependency_path` returns `found: false` with a disclosure
  ("does not prove no relationship exists — only that static analysis
  didn't find one") instead of a false negative dressed up as fact.
- Every "entity not found" case (`get_module`, `get_flow`, `get_file`,
  every world-action tool) throws a typed `EntityNotFoundError` that
  becomes an honest MCP `isError: true` result — Bob is told "no such
  module", never handed a fabricated stand-in.

CodeBiome cannot stop Bob from *phrasing* an answer confidently — that's
Bob's model, outside this app's control — but every fact CodeBiome hands it
carries its own honesty about how it was derived.

## 8. Credentials

**None are required for this integration, and this was verified, not
assumed** (per the explicit instruction not to ask for a key before
checking):

- **CodeBiome's MCP server needs no IBM credential.** It's the *server*
  side of MCP — Bob connects to it, not the other way around, so there is
  no "call IBM Bob" step in this codebase to authenticate.
- **`GITHUB_TOKEN`** (already in `.env.example`, pre-existing, optional) —
  raises the GitHub API rate limit for the *existing* analyze/get_file
  pipeline. `get_file` reuses this; nothing new to configure.
- **A demoing developer's own IBM Bob installation** does require its own
  IBM account/license (Bob 2.0 has a 30-day free trial) — but that
  credential belongs to whoever runs Bob, is unrelated to CodeBiome's
  codebase or environment, and this repository never touches it.

## 9. Performance and caching

- **No new analysis pipeline, no re-downloading.** Every read tool
  resolves through `resolveKnowledgeModel`/`resolveFlowModel`
  (`src/server/bob-tools/resolveRepository.ts`), which reads the *same*
  in-memory `knowledgeModelStore` `/api/analyze` already populates.
  Flow inference (`inferFlows`) is a cheap pure function recomputed per
  call, exactly as `/api/analyze` already does — never cached separately,
  never re-fetched from GitHub.
- **Stateless MCP transport.** `/api/mcp/route.ts` uses
  `WebStandardStreamableHTTPServerTransport` in stateless mode (a fresh
  `McpServer` per HTTP request) — the recommended shape for a server that
  may run on serverless, since there's no long-lived connection to keep
  warm between calls, only the shared in-memory stores.
- **Known limitation, inherited from the existing architecture (not new):**
  `knowledgeModelStore` and `bobEventBus` are in-memory and per-process —
  the exact same caveat `InMemoryKnowledgeModelStore` already documented
  ("not durable across cold starts or multiple concurrent instances").
  On a real multi-instance Vercel deployment, `/api/analyze` and `/api/mcp`
  could land on different serverless instances with separate memory. For a
  single-developer hackathon demo (one dev server, one browser tab, one Bob
  session) this is a non-issue; scaling it further is a database problem
  this project has already deferred once (see `ARCHITECTURE_DECISIONS.md`)
  and would defer again here for the same reason.

## 10. How this was actually verified — with real IBM Bob 2.0

Two verification passes happened, in order. The first (curl standing in for
an MCP client) proved the protocol layer worked. The second, later pass
replaced curl with an actual, licensed, authenticated IBM Bob 2.0 session —
this section documents that second pass, since "the endpoint responds to
curl" was never the bar.

### 10.0 What Bob was actually run

**Bob Shell 2.0.4** (`bob run` / headless mode), not the IDE plugin — chosen
because it has a documented, scriptable one-shot mode
(`bob run "<prompt>" --format stream-json`) that streams every tool call and
result as it happens, which is what made rigorous, inspectable verification
possible at all. The IDE plugin has no equivalent way to observe its MCP
traffic from outside the editor.

Install (Ubuntu, real machine, not a container):
```bash
curl -fsSL https://bob.ibm.com/download/bobshell.sh | bash
```
This failed twice with `EACCES: permission denied, mkdir '/usr/local/lib/node_modules'`
— Debian/Ubuntu's packaged `npm` ignores a plain `npm config set prefix`
for global installs. The fix that actually worked was exporting the prefix
as an environment variable, which npm's config resolution does honor:
```bash
mkdir -p ~/.npm-global
export npm_config_prefix="$HOME/.npm-global"
export PATH="$HOME/.npm-global/bin:$PATH"
curl -fsSL https://bob.ibm.com/download/bobshell.sh | bash
```

Authenticated via `BOB_API_KEY` (the user's own IBM Bob API key, obtained
from bob.ibm.com — see §8; this is Bob's credential, never CodeBiome's).

### 10.1 Connecting Bob to CodeBiome — the real, tested config

```bash
bob mcp add codebiome http://localhost:3000/api/mcp -t http -s global
```

This is what `bob mcp add` actually wrote to `~/.bob/settings/mcp.json`
(the empirically observed schema — **not** what either doc-summary pass
during investigation guessed; field names are `url` and `transportType`,
not `type`/`httpURL`):
```json
{
  "mcpServers": {
    "codebiome": {
      "url": "http://localhost:3000/api/mcp",
      "transportType": "http"
    }
  }
}
```
`bob mcp list` confirmed: `codebiome: http://localhost:3000/api/mcp | enabled | http | global`.

### 10.2 Results — every test in the validation brief, against a real Bob session

Repository under test: `lujakob/nestjs-realworld-example-app` (NestJS,
controller → service → entity, real login/auth flow), analyzed through the
normal CodeBiome UI first, exactly as required.

| # | Question asked (verbatim) | Tools Bob called, in order | Result |
|---|---|---|---|
| 1 | "What is the lujakob/nestjs-realworld-example-app repository and what are its major architectural areas?" | `get_repository_overview` | Correct, fully grounded answer citing real centrality/importance numbers and all 5 real route controllers. No invented modules. |
| 2 | "How does a user log in?" | `find_feature` → `get_flow` → `get_module` → `get_file`×4 (controller, service, login DTO, auth middleware) | A precise, technically accurate walkthrough (argon2 password verify, exact JWT claims, 60-day expiry, `AuthMiddleware` for subsequent requests) — traceable line-for-line to the real files it fetched. |
| 3 | (same as #2 — Bob's own multi-tool chain already matched the brief's example exactly) | *(see above)* | Confirms genuine multi-step investigation, not a single lucky tool call. |
| 4 | "Find the most relevant flow for user login and walk me through it." | `find_feature` → `get_flow` → `get_file`×4 → `start_flow` | Bob investigated *before* acting, then called `start_flow`. **Browser reacted with zero manual interaction**: Investigation Panel opened on `user`, Flow tab at step 1/5, HUD walkthrough card in sync, activity feed showing the real call sequence. |
| 5 | "Continue the walkthrough to the next step." (via `bob run -r <task-id>`) | `focus_flow_step(stepIndex: 1)` (after redundantly re-running its earlier investigation — see §10.3) | Browser advanced to step 2/5 ("User Service"), camera refocused, evidence panel updated, activity feed recorded it. |
| 6 | "Explain this module." (**no module name given**) | `get_current_context` → `get_module` → `get_file`×8 | Bob's first call resolved "this" to the real selected module (`src/user`) via the new `get_current_context` tool (added because of this exact gap — §10.3 below... see "Problems found and fixed"), then investigated thoroughly. |
| 7 | "What would be affected if I changed this module?" | `get_current_context` → `show_impact` | Browser switched to the Dependents tab, highlighted the 4 real dependent modules, zero manual clicks. |
| 8 | "I'm new to this repository. What should I understand first? Then show me the first thing I should explore." | `get_repository_overview` → `list_flows` → `get_module`×2 → `get_flow` → `start_flow` | Correctly identified `src/user` (centrality 1.0) as the starting point, explained why with real numbers, then navigated CodeBiome there. This is the onboarding story in full. |
| Uncertainty | "Under concurrent load, does user registration ever produce a race condition?" | `get_repository_overview` → `get_file`×3 | Correctly identified a real check-then-act race (no `unique: true` on the entity, two separate DB round-trips) — technically excellent code review. **But** stated it as "real and exploitable" without flagging that this is a structural/logical inference from reading code, not an observed runtime event. See §10.3. |

Every dollar amount, tool call, and file path above came from real
`--format stream-json` output, not a hand-written transcript.

### 10.3 Problems found — and what was actually done about them

**Found: no way for Bob to resolve "this"/"here".** None of the original 15
tools let Bob learn what's currently selected in the CodeBiome browser —
Test 6 in the validation brief exists specifically to probe this, and it
failed on the first attempt (`get_current_context` didn't exist yet). Fixed
with the smallest change that closes the gap, no more: a new
`sessionContextStore` (`src/server/bob/sessionContext.ts`) that the browser
POSTs to on every selection/walkthrough change
(`/api/session-context/route.ts`), and one new tool,
`get_current_context`, that reads it. Re-tested afterward: Bob's first call
on "explain this module" was correctly `get_current_context({})`, no module
name given anywhere in the prompt. This is now covered by two new tests in
`repositoryTools.test.ts`.

**Found: `bob run -r <task-id>` doesn't skip re-investigation.** Resuming a
headless task and asking it to "continue" caused Bob to redundantly re-run
its entire prior tool sequence (`find_feature` → `get_flow` → 4×`get_file`
→ `start_flow`) before finally calling the actually-new `focus_flow_step`.
The *end state* was still correct (browser landed on the right step), so
this wasn't fixed — it's a Bob Shell session-continuity characteristic, not
a CodeBiome defect, and speculatively working around it would mean
guessing at Bob Shell internals this project doesn't control.

**Found: a tool-description fix did not change Bob's confidence framing.**
After the race-condition answer in §10.2 stated a code-structural inference
as flat fact, `get_file`'s description was extended with an explicit
reminder ("this is static source text... say so explicitly rather than
asserting [runtime claims] as confirmed fact" — see `src/server/bob-tools/index.ts`).
Re-running the *identical* question afterward produced materially the same
confident phrasing ("Yes — the race condition is real and exploitable").
Reported honestly rather than iterating further: a tool description can
inform what Bob knows, but it does not reliably control Bob's own
generation style — that boundary belongs to Bob's model, not to CodeBiome's
server. (Separately: this specific claim — an `await`-yield-based
check-then-act race — is arguably closer to a valid static/logical
deduction from known Node.js semantics than to an empirical runtime claim,
so the case is a genuinely debatable edge of the uncertainty principle, not
a clean failure.)

**Not a problem, just an observation:** Bob's own model routinely called
4–10 tools per question, including several `get_file` calls beyond what the
flow/module tools alone returned — it consistently went to primary source
when the question warranted it, unprompted.

### 10.4 What was NOT changed

No change was made to `open_module`, `start_flow`, `focus_flow_step`,
`open_file`, `show_dependencies`, `show_impact`, or any flow/dependency
tool's logic — real testing found them working exactly as designed on the
first attempt. No new tools beyond `get_current_context` were added; Bob
never called for a capability that didn't exist (aside from that one gap).

### 10.5 The AI-interpretation layer (§5), validated against a real, previously-untouched repository

Tested against `Mahdi-Abbasi-2001/liara-docs-assistant` (a RAG chatbot for
Liara cloud documentation — Next.js, hybrid lexical+semantic search, none
of this project's prior testing had touched it), to rule out any chance the
earlier NestJS-repo testing had somehow primed the result.

1. **Baseline overview** (`get_repository_overview` → `get_module`×5):
   Bob correctly identified the repository as "an AI-powered documentation
   assistant for Liara... using a hybrid semantic + lexical search," named
   all 5 architectural zones with real file counts, and flagged real
   `hardcoded-secret-pattern` risk indicators CodeBiome's security analyzer
   had actually detected — no invented facts.
2. **Interpretation prompt**: *"What higher-level domain concepts does this
   codebase implement that a deterministic static analyzer couldn't name on
   its own? Contribute your interpretation to CodeBiome."* Result: a
   20-tool-call, 80-second, $0.87 investigation
   (`get_repository_overview` → `list_domain_concepts` [checking for
   duplicates first, unprompted — exactly what the tool description asks
   for] → `get_module`×4 → `get_file`×8, reading actual source including
   `hybrid-search.ts`, `schema.sql`, `03-embed.ts`, `route.ts` →
   `contribute_domain_concept`×5).
3. **The five concepts contributed** were genuinely insightful, not
   restatements of file lists — e.g. "Hybrid Lexical + Semantic Search with
   Reciprocal Rank Fusion" (confidence 0.97), explaining *why* RRF rather
   than a weighted average, citing the actual code comment about MiniSearch
   scores being unbounded vs. cosine similarity being `[0,1]`; and
   "Deterministic Agentic Tool Orchestration" (0.95), correctly identifying
   that a `prepareStep` callback mechanically removes model discretion at
   specific steps — the kind of *design-intent* reasoning no static
   analyzer could produce, exactly the case §5 exists for.
4. **Verified live in the browser, zero manual interaction**: the "Bob's
   Interpretation" HUD badge updated to `(5)` in real time as each
   contribution landed; opening the panel showed all 5 real concepts with
   correct confidence percentages and real module names; clicking one
   selected its first related module and focused the world there.
5. **Hard invariant re-verified against this specific live repository**
   (not just the synthetic test fixtures): a `curl` call to
   `contribute_domain_concept` referencing `"src/totally-fake-module"`
   against the real, currently-analyzed `liara-docs-assistant` model
   returned `isError: true` with an honest "no such module" message and
   published nothing to the event bus or the panel.

### 10.6 The onboarding-journey capability (§5.2), validated end-to-end with real IBM Bob 2.0

Tested against `lujakob/nestjs-realworld-example-app`, analyzed fresh
through the normal CodeBiome UI first. Two real `bob run` sessions, using
the exact prompt from the brief's Test 1/Test 2 scenarios.

**Session 1 — "I'm new to this repository..."** (verbatim, matching the
brief's Phase 2 example prompt):

```bash
bob run --accept-license --trust --format stream-json "I'm new to this repository. Analyze it and create a guided onboarding journey that helps me understand the main user workflow. Use CodeBiome to visualize the architecture and guide me through the relevant parts of the codebase. Only use repository facts available through CodeBiome. Clearly distinguish verified repository facts from your own interpretation."
```

Real tool sequence observed (`--format stream-json`, not paraphrased):
`get_repository_overview` → `list_flows` → `get_flow` → `get_module`×5
(user, article, shared, profile, tag) → `list_onboarding_journeys` [checking
for an existing journey first, unprompted] → `list_domain_concepts`
[same] → `get_module`×1 more → `contribute_domain_concept`×2 →
`create_onboarding_journey`.

The journey Bob created (real tool result, not summarized):

| Step | Module | Bob's reason |
|---|---|---|
| 1 | `src` | "Start at the application root... bootstrap entry point... full dependency map at a glance" |
| 2 | `src/shared` | "cross-cutting concerns every request passes through... has no dependencies and is the foundation layer" |
| 3 | `src/user` | "highest-importance module (importance 0.775, centrality 1.0)... auth middleware, User entity, UserService" |
| 4 | `src/profile` | "depends on user and is used by article... important before article because article.service uses profile data" |
| 5 | `src/article` | "largest module by LOC (451)... core content domain... create/read/update/delete of articles and comments" |
| 6 | `src/tag` | "simplest standalone feature module... only test file in the repository, good place to understand testing conventions" |

Title: *"Main User Workflow: Register → Publish → Follow"*, confidence
0.85 — every `moduleId` above is a real module in this repository's
analysis (verified by cross-checking against `get_module`'s own output in
the same session, not just trusted).

**Browser reaction, zero manual interaction**: the activity feed showed the
real sequence above in order; the Investigation Panel opened on `src`; the
new "BOB'S ONBOARDING JOURNEY" HUD card appeared showing "Step 1 / 6",
the journey title, and step 1's real reason text, with working
"Continue →" / "Exit" buttons.

**Manually clicking "Continue →"** (no Bob call involved) correctly
advanced to step 2 (`shared`) — Investigation Panel, world camera, and HUD
reason text all updated. This verifies the acceptance criterion "guided
walkthrough still works independently of Bob."

**Session 2 — contextual follow-up**, asked while `shared` (step 2) was
still focused from the manual click above:

```bash
bob run --accept-license --trust --format stream-json "Why is the module I'm currently looking at important, and what should I look at next in the onboarding journey?"
```

Real tool sequence: `get_current_context` → `get_module` → `list_onboarding_journeys`.
`get_current_context`'s real result (not paraphrased) correctly included
the onboarding state the browser had reported:

```json
{
  "hasSelection": true,
  "selectedModule": { "id": "src/shared", "name": "shared" },
  "activeOnboardingJourney": {
    "id": "journey-rnkgyxsp",
    "title": "Main User Workflow: Register → Publish → Follow",
    "stepIndex": 1,
    "reason": "Before touching any domain logic, inspect the shared module..."
  }
}
```

Bob's answer (its own window, not CodeBiome's UI) correctly explained why
`shared` matters, cited the two real files in it, identified `src/user` as
step 3 with its real importance/centrality numbers, and ended by *asking*
— "Shall I advance the journey to step 3 and focus the world on
`src/user`?" — rather than calling `advance_onboarding_step` unprompted.
This is reported as an honest interaction pattern, not a gap: the tool
exists and Bob knows about it (confirmed by its own answer referencing the
exact next step), but chose to confirm before acting on an informational
question. Total cost for this session: $0.092, 3 tool calls, 15 seconds.

No problems were found in this pass — both the creation flow and the
contextual follow-up worked on the first real attempt.

## 11. Demo script

1. Paste a GitHub URL into CodeBiome; the world appears (unchanged from
   Step 5).
2. In a separate window, open the same repository in an IDE with IBM Bob
   2.0, with `.bob/mcp.json` pointed at this app's `/api/mcp` (see §13).
3. Ask Bob, in its own chat: *"How does a user place an order?"* (or
   whatever fits the demoed repository). Watch Bob's own tool-call
   indicators in its IDE — it will call `find_feature`, then likely
   `get_flow`/`get_module`, then `start_flow`.
4. Switch to the CodeBiome browser tab: the world has already reacted —
   camera moved, flow highlighted, walkthrough card showing step 1, and the
   "Bob is connected" feed showing the real call sequence.
5. Ask a follow-up — *"what depends on this?"* — and watch `show_impact`
   land live.

This is the "split-screen" demo: Bob's reasoning visible in its own
window, CodeBiome's world visibly reacting in the other, tied together by
nothing but real MCP traffic. See `docs/BOB_ONBOARDING_DEMO.md` for the
dedicated onboarding-journey walkthrough of this same idea.

## 12. Tests

`src/server/bob-tools/*.test.ts` (51 tests, all against a *real* RKM built
by running the actual analyzer pipeline over synthetic files — see
`src/server/testing/knowledgeModelFixture.ts` — never hand-mocked):

- `repositoryTools.test.ts` — overview resolution (explicit owner/repo,
  fallback-to-most-recent, not-analyzed error), keyword search hits/misses,
  module lookup by id/name, missing-module/file errors, real file fetch
  (mocked `fetch`, never a real network call in CI), `get_current_context`
  reflecting an active onboarding-journey step reported by the browser.
- `onboardingTools.test.ts` — journey creation with real module references,
  rejection of a fabricated module reference (nothing stored/published),
  empty title/goal/reason and out-of-range-confidence rejection, an empty
  `steps` array rejection, listing, and `advance_onboarding_step`'s valid/
  unknown-journey/out-of-range-index cases.
- `flowTools.test.ts` — flow listing/detail with disclosure text,
  dependency-path found/not-found, dependency depth, `find_feature`
  ranking and its empty-result case.
- `worldActionTools.test.ts` — every action's validation, its published
  `WorldActionEvent`/`ActivityEvent` (captured directly off the real event
  bus, not mocked), and its rejection of invalid arguments
  (`InvalidToolArgumentsError` for an out-of-range step index,
  `EntityNotFoundError` for a nonexistent module/flow/file) — plus proof
  that a rejected call publishes *nothing*.
- `mcpServer.test.ts` — end-to-end through the real MCP protocol layer
  (`Client` + `McpServer` linked by the SDK's own `InMemoryTransport`, the
  same mechanism the SDK uses for its own tests): tool advertisement,
  a real call returning real data, zod-schema rejection of missing
  arguments, and the not-analyzed-repository error path.

## 13. Local development / setup

No new environment variables for CodeBiome itself. These are the exact
steps that were actually run end-to-end (§10) — not a guess from docs.

**1. Install Bob Shell.** (The IDE plugin works too, but Shell's headless
mode is what makes its MCP traffic inspectable — see §10.0.)
```bash
curl -fsSL https://bob.ibm.com/download/bobshell.sh | bash
```
If this fails with `EACCES: permission denied, mkdir '/usr/local/lib/node_modules'`
(likely on Debian/Ubuntu, whose packaged `npm` ignores a plain
`npm config set prefix` for this), do this instead:
```bash
mkdir -p ~/.npm-global
export npm_config_prefix="$HOME/.npm-global"
export PATH="$HOME/.npm-global/bin:$PATH"   # add to ~/.bashrc to persist
curl -fsSL https://bob.ibm.com/download/bobshell.sh | bash
```

**2. Authenticate.** Get an API key from bob.ibm.com (your account, not
CodeBiome's) and `export BOB_API_KEY="..."` — or run `bob chat` once for
interactive SSO login instead.

**3. Start CodeBiome and analyze a repository** as normal
(`npm run dev` or `npm run build && npm run start`), through the web UI.

**4. Point Bob at CodeBiome's MCP server:**
```bash
bob mcp add codebiome http://localhost:3000/api/mcp -t http -s global
```
Verify with `bob mcp list` — should show
`codebiome: http://localhost:3000/api/mcp | enabled | http | global`.
(This writes `~/.bob/settings/mcp.json`; hand-editing it directly also
works — see §10.1 for the exact schema Bob Shell actually writes.)

**5. Ask Bob a question**, headless or interactive:
```bash
bob run --accept-license --trust "How does this application handle a request?"
# or: bob chat
```
Watch the CodeBiome browser tab — it reacts live to any world-action tool
Bob decides to call, with no further interaction.

For a deployed CodeBiome instance, replace the `-t http` URL with the
deployed origin's `/api/mcp` — no other change, since the transport is
stateless.

## 14. What is intentionally NOT implemented

- **No embedded chat panel that calls "Bob" and prints an answer.** Section
  1 explains why this would have been fake: no such call exists. The
  in-app "Ask Bob" / Bob tab experience continues to be the honest
  `NotConnectedBobClient` interface from Step 5 (`src/types/bob.ts`) —
  preserved as-is, since it already does the right thing (shows the real
  grounded context, never fabricates a response). It is *not* the
  integration point; `src/server/bob-tools/` + `/api/mcp` is.
- **No resources or prompts (MCP primitives).** Only tools are
  implemented. Bob's own docs and IBM's tutorial both center entirely on
  tool-calling for exactly this kind of integration; resources/prompts
  would add surface area without a concrete use case here.
- **No stdio transport.** Only Streamable HTTP. stdio would require
  distributing/spawning a separate local server process alongside Bob;
  Streamable HTTP lets the *same* Next.js app (dev or deployed) serve both
  the web UI and the MCP endpoint with zero extra process management —
  the simpler, more demo-friendly choice for a hackathon.
- **No multi-repository/multi-session routing.** One most-recently-analyzed
  repository is the implicit context when Bob omits `owner`/`repo` — correct
  for a single-developer, single-tab demo, not a multi-tenant product.
- **No persistence of MCP activity across restarts.** `bobEventBus` is
  in-memory, matching `knowledgeModelStore`'s existing, already-documented
  limitation — not a new corner cut for this feature.
- **No attempt to make Bob's own answer appear inside CodeBiome's UI.**
  As established in §1, that data never reaches this server. The activity
  feed is the honest substitute, not a workaround pretending otherwise.
- **Domain concepts (§5) don't persist across server restarts either** —
  same in-memory limitation as everything else in this project. A concept
  Bob contributed is gone once the process restarts, exactly like the
  analyzed repository itself; re-contributing is one more Bob question
  away, not a re-analysis.
- **No automatic/scheduled interpretation.** Bob only contributes a domain
  concept when asked to (or when it decides to as part of answering a
  broader question) — CodeBiome never prompts Bob on its own or runs
  interpretation as a background job.
- **Onboarding journeys (§5.2) don't persist across server restarts
  either** — same in-memory limitation as domain concepts and everything
  else in this project. A journey Bob created is gone once the process
  restarts; re-creating it is one more Bob question away.
- **No automatic step advancement.** `advance_onboarding_step` exists so
  Bob *can* move the walkthrough itself, but nothing forces it to — real
  testing (§10.6) showed Bob choosing to explain and ask permission
  ("shall I advance to step 3?") rather than act unprompted on an
  informational question. This is a legitimate Bob judgment call, not a
  missing capability.
- **No measurable "time saved" metrics.** Per the brief's explicit
  instruction not to fabricate productivity numbers, no before/after
  timing claims are made anywhere in this project. The concrete,
  non-fabricated comparison is the tool-call sequence itself: manual
  onboarding is "search → open files → trace imports → build a mental
  model"; guided onboarding is "ask Bob → verified investigation →
  `create_onboarding_journey` → guided world" — a real reduction in steps,
  not a timed benchmark.
