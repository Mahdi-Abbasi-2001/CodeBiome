# CodeBiome — Technical Architecture

This document describes the current system. For the original hackathon-era
proposal (React Three Fiber 3D world, a hosted "Bob" LLM client, Prisma
sketches — all since replaced), see
[`docs/ARCHITECTURE_DECISIONS.md`](./ARCHITECTURE_DECISIONS.md) and
[`docs/WORLD_VISUAL_REDESIGN.md`](./WORLD_VISUAL_REDESIGN.md), both kept as
historical record.

## 1. The core principle

CodeBiome does not analyze repositories itself. A connected AI agent (any
MCP client) fetches and reasons about the actual code, then tells CodeBiome
what it found. CodeBiome's job is narrower and more mechanical than "running
analysis": verify every claim against the repository's real file tree, and
render whatever has been verified. This is the same "propose → validate →
store → visualize" pattern the project already used for its AI-interpreted
layer (domain concepts, onboarding journeys, feature plans) — generalized to
cover the entire architecture model, not just that one layer.

| Layer | Responsibility | Can it "invent" facts? |
|---|---|---|
| 1. Ingestion | Fetch the repo, record its real file tree (path, size, a light structural type guess) | No — direct observation only |
| 2. Agent submissions | An MCP agent explores the code and calls `submit_modules`/`submit_dependencies`/`submit_entry_points`/`submit_frameworks`/`submit_security_findings`/`submit_code_health`/`submit_flow`/`submit_request_journey` | Yes, but every file/module reference is checked against layer 1 first — an unverifiable reference is rejected, not stored |
| 3. Repository Knowledge Model (RKM) | The canonical, incrementally-built record combining 1 + 2 | N/A — it's the contract |
| 4. World Model | Deterministic mapping of the current RKM into world entities (regions, landmarks, paths) | No — pure function of the RKM, recomputed on every read |
| 5. User-facing experiences | The five lenses (Architecture/Onboarding/Flow/Health/Plan) | No — pure consumers of layers 3 & 4 |

The rule that matters: **layers 4 and 5 never read raw repository data or
talk to an agent directly.** They only ever consume the RKM. This is what
makes the visualization layer safe to leave untouched even though what feeds
it changed completely — the contract, not the pipeline, is what's stable.

See [`docs/REPOSITORY_KNOWLEDGE_MODEL.md`](./REPOSITORY_KNOWLEDGE_MODEL.md)
for the schema, and [`docs/MCP_CLIENTS.md`](./MCP_CLIENTS.md) for how an
agent connects and submits.

## 2. Why this shape, not a built-in analyzer

CodeBiome used to run 13 regex-based analyzers (one per language for
dependency detection, plus structure/security/entry-point/frontend-call
analyzers) to build the RKM deterministically. Two problems with that:

1. A regex analyzer is already worse at understanding code than the AI agent
   that's supposed to be consuming its output. CodeBiome was duplicating,
   and losing at, a job the connected agent does better with its own repo
   access — including fetching public repos, which any web-enabled agent can
   already do without CodeBiome's help.
2. Several analyzer outputs the original product spec promised (git
   intelligence, code health beyond large-files, test/doc coverage) were
   permanently empty stubs — real capability gaps, not just an accuracy
   ceiling.

The fix generalizes a pattern that was already working well elsewhere in this
project: `contribute_domain_concept` already let an agent propose something
and had CodeBiome validate every reference before storing it. Doing the same
for modules, dependencies, entry points, frameworks, security findings, code
health, flows, and request journeys removes the maintenance burden of 13
analyzers, closes the empty-stub gap (an agent can actually assess git
hotspots, TODOs, dead code — a real capability upgrade, not just parity), and
lets CodeBiome focus its own engineering effort on the one thing that's
actually differentiated: a durable, shareable, live-updating visualization,
not fact-finding a capable agent can already do itself.

## 3. Stack

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js 14 (App Router), TypeScript | One deployable unit on Vercel; `/api/bridge/[target]` is the entire backend |
| Rendering | Plain SVG/DOM (no 3D engine) | The five lenses and Domain View are flat, data-dense views — see `docs/WORLD_VISUAL_REDESIGN.md` for why the original 3D renderer was replaced |
| Client state | Plain React state (`useState`) | No caching/revalidation logic complex enough to justify a state library |
| Repository ingestion | GitHub REST API + tarball download (`codeload.github.com`) + `tar` (npm) | No `git` binary dependency, no full clone; fits one Node.js Route Handler invocation |
| Validation | Zod | Schema-validates the RKM; the actual mechanism (not just convention) behind "an agent can't invent a repository fact" |
| MCP transport | `@modelcontextprotocol/sdk`, Streamable HTTP (stateless) + a local stdio entry point | Works with any MCP client; stateless HTTP fits serverless, stdio fits clients that spawn a local process |
| Persistence | Vercel Blob (production) / filesystem or in-memory (local dev) | Small JSON documents, no database needed — see `docs/WORLD_ARCHITECTURE.md` |
| Built-in demo agent | `@anthropic-ai/sdk`, an in-process MCP client running a tool-use loop | Keeps the web UI's "paste a URL" flow working without requiring an externally connected agent |

Deliberately **one Next.js application**, not a split frontend/backend —
module boundaries, not process boundaries, keep concerns separated.

## 4. Backend module map

```
src/server/
  ingestion/          GitHub tarball fetch (githubClient.ts, snapshotBuilder.ts)
                      + seedKnowledgeModel.ts (file tree -> starting RKM, no analysis)
                      + fileContent.ts (on-demand single-file fetch)
  mcp-tools/          All 32 MCP tools:
                        - read/query tools (get_module, list_flows, trace_dependency_path, ...)
                          — generic reads over whatever RKM state currently exists
                        - the 8 submit_* tools (submissionTools.ts) — validate + merge
                          into the RKM, following the shared helpers in submissionHelpers.ts
                        - the 3 pre-existing write-back tools (contribute_domain_concept,
                          create_onboarding_journey, propose_feature_plan) — unchanged,
                          this was the template the submit_* tools generalized
                        - 6 world-action tools (open_module, start_flow, ...) — drive the
                          browser's live view
                        - resolveRepository.ts — World resolution + the per-connection
                          default (see docs/WORLD_ARCHITECTURE.md §4)
  demo-agent/          CodeBiome's own built-in LLM-driven MCP client (runDemoAgent.ts)
  world/               worldStore.ts (persistence), builder.ts (RKM -> WorldModel, pure fn),
                        createWorldFromAnalysis.ts, baseUrl.ts, id.ts
  agent/               eventBus.ts (activityEventBus), sessionContext.ts,
                        domainConceptStore.ts, onboardingJourneyStore.ts
  plan/                featurePlanStore.ts, validateFeaturePlan.ts
  api-handlers/        mcp.ts, mcpAuth.ts, analyze.ts, sessionContext.ts, agentEvents.ts
```

Rules enforced by convention (not yet a lint boundary rule):
- `world/builder.ts` and the `lib/` derivation functions (`domains.ts`,
  `health.ts`, `infrastructure.ts`) only ever read the RKM/WorldModel shape —
  never ingestion internals, never an agent's raw tool-call arguments.
- Every `submit_*` tool validates before it merges — nothing is written to a
  World's knowledge model until every file/module reference in the call
  resolves to something real.
- `api-handlers/` route handlers contain no business logic beyond request
  parsing and streaming — they call into `mcp-tools/`, `ingestion/`, or
  `demo-agent/` and serialize the result.

## 5. Frontend module map

```
src/
  app/
    page.tsx                  URL input + redirect to /world/[worldId] on completion
    world/[worldId]/page.tsx  Fetches the World snapshot, renders the five-lens experience
  features/
    landing/                  Landing page
    scanning/                 Live ingestion/agent-progress view (ScanningView.tsx)
    world/                    ArchitectureDiagram, OnboardingDiagram, FlowDiagram,
                               HealthDiagram, PlanDiagram, DomainView (building-cluster
                               drill-down), WorldHud, CodeViewer
  lib/                        Pure client-side derivations over the RKM/WorldModel:
                               domains.ts, health.ts, infrastructure.ts, domainLayout.ts,
                               domainSequence.ts, buildingRoles.ts, classifyLayer.ts
```

None of the five lens components or their derivation functions changed
during the analyzer-to-agent-submission rework — they already consumed the
RKM/WorldModel shape generically, which is exactly what made the rework
tractable.

## 6. Vercel deployment constraints

- The Node.js runtime (`export const runtime = "nodejs"`) is required for
  filesystem/`tar` access during ingestion — the Edge runtime can't do this.
  `maxDuration` is 60s on the Hobby tier; verify this against your current
  Vercel plan.
- No `git` binary/clone: ingestion downloads a single tarball and extracts
  it into `/tmp`, deleted in a `finally` block once ingestion finishes
  reading from it.
- No file-count cap — a full repository's file tree is always recorded, not
  a sample.
- No database: World state is small JSON documents in Vercel Blob (or a
  filesystem/in-memory store locally) — see
  [`docs/WORLD_ARCHITECTURE.md`](./WORLD_ARCHITECTURE.md).

## 7. Explicit non-goals

Not built: authentication/accounts beyond the optional `MCP_AUTH_TOKEN`
bearer gate, multiplayer/shared editing of a single World, billing,
private-repo support (ingestion is public-repo only), a "finalize this
World" step (lenses simply render whatever has been submitted so far), and
tiered read/write MCP auth (the auth gate is all-or-nothing by design — see
[`docs/MCP_CLIENTS.md`](./MCP_CLIENTS.md)).
