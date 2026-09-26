# Architecture Decisions — Hackathon Vertical Slice

This records the infrastructure review performed before scaffolding, in
response to a hard constraint: **48-hour hackathon, targeting Vercel's free
(Hobby) tier**, first working slice being:

```
GitHub URL → repository fetch → deterministic analysis
  → Repository Knowledge Model → World Model → frontend visualization
```

Every decision below is scoped to *this slice*. Nothing here removes a
capability from the target architecture in `ARCHITECTURE.md` — it defers
infrastructure that doesn't earn its cost yet, while leaving a clean seam to
add it later.

## Classification key

- **REQUIRED NOW** — the first vertical slice does not work without it.
- **USEFUL LATER** — genuinely useful once the product grows past the first
  slice, but adds setup cost/complexity the slice doesn't need yet.
- **NOT NEEDED** — no identified point in the roadmap (as currently scoped)
  where this is the right tool; if the need reappears, re-evaluate then.

## 1. Decision matrix

| Component | Classification | One-line reason |
|---|---|---|
| Postgres | NOT NEEDED (now) / USEFUL LATER | v1 has no multi-session state to persist; the Knowledge Model is returned directly to the client per request |
| Prisma | NOT NEEDED (now) / USEFUL LATER | Only exists to talk to Postgres; follows that decision exactly |
| Inngest (or any background job runner) | NOT NEEDED (now) / USEFUL LATER | Analysis for a size-capped repo fits comfortably in one synchronous serverless request |
| PixiJS | NOT NEEDED — superseded by React Three Fiber | Better visual return-per-hour for a "cinematic" goal with primitive geometry + lighting, and a more natural fit with React |
| TanStack Query | NOT NEEDED (now) / USEFUL LATER | One request-response per analysis; plain `useState`/`fetch` is enough until there's real caching/revalidation to manage |
| Zustand | NOT NEEDED (now) / USEFUL LATER | Only 2-3 pieces of UI state (selection, loading) in v1; introduce it when world-engine state stops fitting in component state |
| Zod | REQUIRED NOW | Enforces the Knowledge Model schema and is the actual mechanism behind "AI can't invent facts" once Bob is added — cheap, no infra |
| `tar` (npm package) | REQUIRED NOW | Extracting the GitHub tarball snapshot without shelling out to `git` |
| React Three Fiber + drei | REQUIRED NOW | The chosen v1 world renderer (see §4) |

## 2. Why Postgres/Prisma/Inngest are deferred, not just "skipped"

### Vercel practical constraints (evidence for the calls below)

- **Serverless Functions**: Hobby-tier functions run on the Node.js runtime
  with a configurable `maxDuration` (we set 60s in `route.ts`); Edge runtime
  functions cannot be used here because the pipeline needs `/tmp` filesystem
  access and the `tar` package. **Always verify the current numeric limit
  against your live Vercel plan before depending on it for large repos** —
  Vercel has changed these limits over time and we should not hard-code
  today's number into design decisions that outlive this document.
- **Filesystem**: only `/tmp` is writable, it's ephemeral per invocation, and
  it is **not** shared across invocations or instances. This rules out using
  `/tmp` as a cache; it's fine as scratch space for a single request's
  extract-then-delete tarball handling, which is exactly how it's used in
  `snapshotBuilder.ts`.
- **Repository cloning**: a full `git clone` needs a `git` binary, is slower
  than necessary, and pulls far more than a first analysis pass needs.
  Instead, v1 downloads a single tarball from `codeload.github.com` (no `git`
  dependency at all) and gets commit metadata from the GitHub REST API. Git
  history depth (for the future Git Intelligence analyzer) is deferred
  precisely because it's the one thing that would require either a real
  clone or paginated API calls beyond what's needed for this slice.
- **Memory**: bounded by capping analyzed files (`MAX_FILES = 600`) and
  skipping content reads over 200KB — keeps a Hobby function's default
  memory ceiling comfortable regardless of target repo size.
- **Streaming**: Route Handlers can stream (SSE/`ReadableStream`) — noted as
  a fast-follow for perceived responsiveness ("fetching…", "analyzing…") but
  not required for v1's correctness; the frontend currently just shows a
  loading state during one request/response cycle.
- **Caching**: without Postgres, v1 caching is a plain in-memory `Map`
  (`InMemoryKnowledgeModelStore`) scoped to a warm lambda instance — a nice
  demo speedup with zero setup, understood to not be durable or shared.

### Given those constraints:

**Inngest — NOT NEEDED NOW.** Background job orchestration solves two
problems: (a) work that exceeds a function's duration limit, and (b)
work that needs retries/resumability. Neither applies to a size-capped
single-repo analysis running synchronously in well under a minute. Adding
Inngest now means standing up an event schema, a dev-mode runner, and a
polling/streaming status API for a problem we don't have yet — hours a
48-hour team can't spare. **It becomes REQUIRED** the moment we (a) drop the
file/size caps to support arbitrarily large repos, or (b) need retryable,
resumable multi-step execution (e.g., because a later analyzer legitimately
needs a full git clone). The pipeline is already written as a plain async
function (`runAnalyzers` + `buildKnowledgeModel` + `buildWorldModel`) with no
Vercel-specific assumptions baked in, so wrapping it in an Inngest step
function later is additive, not a rewrite.

**Postgres/Prisma — NOT NEEDED NOW.** The only things that would need durable
storage in a fuller product are: cross-session caching, multi-user history,
mission/journey progress, auth. None of those exist in the first vertical
slice — the Knowledge Model and World Model are computed per request and
handed to the client as JSON, which the client holds for the session. See §3
for the full reasoning and the migration seam already in place
(`KnowledgeModelStore`).

## 3. Persistence — evidence-based decision

**Decision: no database in v1.** The full flow is:

```
POST /api/analyze → synchronous pipeline → { knowledgeModel, worldModel } JSON
  → held in React state on the client for the session
```

This is sufficient because the first vertical slice has exactly one piece of
state that matters (the currently-viewed repository's Knowledge Model/World
Model), it's naturally request-scoped, and nothing needs to survive a page
reload or be shared across users yet.

What was **not** done: persistence wasn't ripped out of the architecture —
`ARCHITECTURE.md` still documents Postgres/Prisma as the eventual store.
Instead, `src/server/knowledge-model/store.ts` defines a `KnowledgeModelStore`
interface with an in-memory implementation. The Knowledge Model is already
exactly the JSON shape that would go into a `KnowledgeModel` table's JSON
column — moving to Postgres later means writing one new class that
implements the same two methods (`get`, `set`) against Prisma, and swapping
which instance `route.ts` imports. No schema redesign, no call-site changes.

**When Postgres becomes REQUIRED**: multi-session mission/journey progress,
shared/public world links that outlive a single browser tab, caching across
users instead of per-lambda-instance, or auth/accounts.

## 4. World renderer — PixiJS vs. alternatives

Goal, restated from the brief: *visually impressive 2.5D/cinematic*, not a
traditional game — and for v1, only a small number of entities need to
render at all.

| | Visual quality (cinematic) | Dev speed (48h) | Vercel compat. | React interop | Animation | Fits the world metaphor | Hackathon risk |
|---|---|---|---|---|---|---|---|
| **PixiJS** | Good, but needs real 2D art to look "cinematic" — flat lighting by default | Medium — imperative API, needs a React bridge (`@pixi/react`) | Fine (client-only) | Bridged, not native | Strong (sprite/tween ecosystem) | Good for tile/sprite-based 2D worlds | Medium — art asset production is the bottleneck, and that's on the team either way |
| **Canvas/SVG (raw)** | Low-medium without significant custom shader/lighting work | Low — hand-roll scene graph, hit-testing, animation loop | Fine | Awkward for Canvas, natural for SVG (it's DOM) | Manual | Workable for a flat/low-entity-count v1 | Low risk, but visually the least "wow" |
| **React Three Fiber (Three.js)** | High — bloom/fog/emissive materials produce a cinematic look from primitive geometry, no art assets required | High for primitives + lighting; steeper if photoreal models are attempted | Fine (client-only) | Native — it's just React components/hooks | Strong (built-in + `drei`/`framer-motion-3d`) | Strong — fog, glow, particles map directly to the health-tier visual language in the spec | Low-medium — biggest risk is over-scoping 3D asset ambition, not the library itself |
| **CSS/DOM 2.5D** | Low — parallax/transform tricks cap out visually fast | Highest — it's just React/CSS | Fine | Native | CSS transitions only | Weak for anything beyond a very stylized flat map | Lowest risk, weakest payoff for a "cinematic" goal |

**Decision: React Three Fiber (+ `@react-three/drei`) for v1.**

Reasoning: the spec's own visual language (glowing central tree, fog over
dead code, toxic hazard zones, dramatic lighting on critical code) is
*lighting and material description*, not *sprite art*. R3F gets that look
from primitive geometry (boxes, spheres) plus an ambient/directional light
and emissive materials — in other words, the "cinematic" quality the brief
wants is closer to free with R3F than with any 2D approach, which needs
actual illustrated assets to read as cinematic. R3F also integrates with
React natively (it's just components), which matters for wiring click
selection into the investigation panel without an imperative bridge layer.
PixiJS remains the better choice **later** if the world evolves toward dense,
large-scale 2D tile worlds with hundreds of sprite entities — that's an
explicit non-goal for v1 (small number of entities, per the brief).

**Kept behind an abstraction, per the brief's requirement**: `WorldView.tsx`
under `src/world-engine/` is the *only* file in the codebase that imports
`three`/`@react-three/*`. Every other module — the page, the API layer, the
entity panel — depends only on the `WorldModel` type (from
`src/types/world-model.ts`) and `WorldView`'s props
(`worldModel`, `selectedWorldId`, `onSelect`). Swapping the renderer later
means rewriting this one file; nothing else changes. A component-level seam
was chosen over an imperative class interface (`mount()/dispose()`-style)
because R3F is React-first — forcing an imperative wrapper around it would
fight the library rather than use it.

## 5. What did not change

The core architecture is untouched:

```
Deterministic repository analysis → Repository Knowledge Model
  → Bob interpretation → World / Journey / Missions
```

v1 implements the first two stages fully (for a reduced analyzer set) and the
World Model as a pure function of the Knowledge Model. Bob interpretation,
the Interpreted Layer, Guided Journey, and Missions are intentionally not
built yet (see the scaffold's "what is deferred" list) — but nothing in the
schema or module boundaries was changed to accommodate that; they were
simply not implemented yet, exactly as `docs/REPOSITORY_KNOWLEDGE_MODEL.md`
already specified.

## 6. Summary of what changed in `ARCHITECTURE.md`

- Stack table: Postgres/Prisma/Inngest moved from "chosen" to "deferred,
  see ARCHITECTURE_DECISIONS.md"; PixiJS replaced with React Three Fiber.
- Backend section: pipeline now described as a single synchronous Route
  Handler call for v1, with the background-job version noted as the future
  path once repo-size caps are lifted.
- Persistence section: added the `KnowledgeModelStore` interface seam and
  the "no DB in v1" decision.
- Deployment constraints section: tightened with the concrete mitigations
  actually implemented (tarball fetch, file caps, `/tmp` scratch-then-delete,
  Node runtime requirement).

## 7. IBM Bob integration — MCP server, not an outbound API call

When asked to integrate IBM Bob 2.0, the first step was investigating IBM's
actual documentation rather than assuming a mechanism — the full writeup is
`BOB_INTEGRATION.md`. The short version, as an architecture decision:

- **Evidence:** IBM's own docs describe Bob as an MCP *client* (an IDE/CLI
  coding agent a developer runs interactively) with no documented
  headless/API mode for embedding its reasoning in another application.
- **Decision:** CodeBiome exposes an MCP server (`/api/mcp`, Streamable
  HTTP transport, stateless) instead of building any kind of "call Bob, get
  an answer" client code. A developer's own Bob session connects to it and
  decides which of 15 tools to call.
- **Rejected alternative:** wrapping an LLM call and labeling it "Bob" —
  explicitly forbidden by the brief and not how the real product works
  anyway.
- **What this means for `src/types/bob.ts`:** the `BobClient`/
  `NotConnectedBobClient` interface from Step 5 is kept exactly as built —
  it was already honest (never fabricates a response) — but it is not the
  integration point. The real one is `src/server/bob-tools/` +
  `src/app/api/mcp/route.ts`.
- **No credentials added.** Verified before assuming: CodeBiome's MCP
  server requires no IBM credential (it's the server side of the
  connection); the only account requirement (a Bob license) belongs to
  whoever runs Bob, not to this codebase.
- **Validated against a real, licensed IBM Bob 2.0 session** (Bob Shell
  2.0.4, not just protocol-level curl testing) — see `BOB_INTEGRATION.md`
  §9. This surfaced one real gap (Bob had no way to learn what's currently
  selected in the CodeBiome browser tab) fixed with one new tool,
  `get_current_context`, and a small browser→server state bridge
  (`src/server/bob/sessionContext.ts`) — 16 tools total, not 15.
