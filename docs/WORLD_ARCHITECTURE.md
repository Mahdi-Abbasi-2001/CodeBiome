# World Architecture — Agent-First Repository Analysis

This document covers the CodeBiome **World** abstraction: what makes it
possible for a developer to ask any connected MCP agent to analyze a
repository *without ever opening the CodeBiome web app first*, for the
resulting World to be reliably reachable from any Vercel serverless
instance, and for two different agents/developers hitting the same
deployment to never collide with each other.

See also: [`docs/MCP_CLIENTS.md`](./MCP_CLIENTS.md) (connecting an agent),
[`docs/REPOSITORY_KNOWLEDGE_MODEL.md`](./REPOSITORY_KNOWLEDGE_MODEL.md) (the
schema a World's knowledge model grows into), `docs/VERCEL_DEPLOYMENT.md`
(the deployment/persistence investigation this design responds to — kept as
a historical record, some names below have since changed from what it
describes).

## 1. The problem this solves

"Which repository is CodeBiome currently showing" cannot be answered by
per-process in-memory state: a developer's browser call to `/api/analyze`
and an agent's later call to `/api/mcp` are independent HTTP requests that
Vercel does not guarantee land on the same warm instance. A World must be
readable from ANY instance, and — since any MCP client can now connect, not
just one developer's single agent session — two different agents hitting the
same deployed instance must never silently resolve to each other's World.

## 2. The World abstraction

A **World** is one repository analysis — a first-class, durable, opaquely
identified record:

```ts
interface WorldRecord {
  id: string;              // opaque, e.g. "5XG-E1DRD5KY" — 9 random bytes, base64url
  repositoryUrl: string;   // https://github.com/owner/repo
  repositoryId: string;    // "owner/repo"
  commitSha: string;
  createdAt: string;
}
```

Two parts:

```
World
 ├── WorldSnapshot (GROWS incrementally — no longer computed once and frozen)
 │    ├── knowledgeModel   (starts as just a file tree; submit_* tools grow it)
 │    ├── flowModel        (starts empty; grown by submit_flow)
 │    └── worldModel       (NOT stored — recomputed from knowledgeModel on every
 │                          read/write, since it's a pure function of it)
 │
 └── WorldMutableState (mutable — an agent's interpretation + navigation session)
      ├── sessionContext       (what the developer is looking at right now)
      ├── domainConcepts[]     (AI-interpreted groupings an agent contributed)
      ├── onboardingJourneys[] (ordered, narrated paths an agent created)
      └── featurePlans[]       (proposed feature implementations an agent authored)
```

This is a real shift from how Worlds worked before: `knowledgeModel` and
`flowModel` used to be computed once, deterministically, at analysis time,
and treated as immutable — the only mutable part was the AI-interpretation
layer on top. Now the knowledge model itself is something a connected agent
builds up call by call (`submit_modules`, `submit_dependencies`, ...), so it
has to be mutable too. `worldStore.updateSnapshot()` is the read-merge-write
mechanism every `submit_*` tool uses (see
[`docs/REPOSITORY_KNOWLEDGE_MODEL.md`](./REPOSITORY_KNOWLEDGE_MODEL.md)).
`worldModel` stops being part of what's stored at all — `server/world/
builder.ts`'s pure function just runs again against whatever the current
knowledge model is, every time a submission changes it.

**Analyzing the same repository twice deliberately creates two independent
Worlds** — different ids, different mutable state, isolated events. A World
represents one analysis *visit*.

## 3. Persistence — Vercel Blob, not a database

`src/server/world/worldStore.ts` is the single source of truth for World
data. Three implementations, selected automatically:

- **`BlobWorldStore`** (when `BLOB_READ_WRITE_TOKEN` OR `BLOB_STORE_ID` is
  set — production): plain JSON blobs at deterministic pathnames
  (`worlds/{id}/snapshot.json`, `worlds/{id}/state.json`,
  `worlds/{id}/events.json`, plus small index blobs), written with
  `access: "private"` and `allowOverwrite: true`. A read-through/write-through
  in-memory `Map` cache sits in front purely for same-instance speed — never
  the source of truth.
- **`FileWorldStore`** (local `npm run dev`/`npm run start`, no Blob env
  vars): same interface, backed by the OS temp directory — a plain in-memory
  `Map` isn't safe here since Next's dev server doesn't guarantee route
  handlers share a module instance.
- **`InMemoryWorldStore`** (under `vitest` only): plain `Map`s, fastest for
  tests.

This was chosen over Postgres/Redis/Vercel KV because the actual requirement
is "read/write small-to-medium JSON documents, correctly, from any
instance" — Vercel Blob is the smallest primitive that provides that.

**Provisioning** (one-time, via the Vercel CLI or dashboard):
```bash
vercel storage create codebiome-worlds --type blob --access private
vercel storage connect codebiome-worlds --yes
```
The Vercel CLI's current default `storage connect` flow uses OIDC auth — it
sets `BLOB_STORE_ID` but not `BLOB_READ_WRITE_TOKEN`; the actual per-request
credential is injected by the Vercel runtime itself. The store-selection
check treats either var as sufficient on its own.

## 4. World resolution — how every MCP tool finds "which World"

`src/server/mcp-tools/resolveRepository.ts`'s `resolveWorld()` tries, in
order:

1. **`worldId`** — the robust path. An agent gets this once from
   `analyze_repository`'s own result and threads it through every subsequent
   call in the same conversation.
2. **`owner`/`repo`** — backward-compatible convenience: resolves to
   whichever World was most recently created for that repository
   (`worldStore.getLatestWorldIdForRepository`).
3. **A per-connection `defaultWorldId`** — derived from THIS MCP
   connection's own request (its `?worldId=` query param — see
   `src/server/api-handlers/mcp.ts`), never from shared/global state. A
   developer's client config points at a specific World's URL; that's the
   only thing that can supply this default.
4. **None of the above resolves anything**: throws `MissingWorldIdError`.

**This replaced a real bug.** The old chain's step 3 was "resolve to the
single most recently created World across the whole deployment" — fine for
one developer with one agent, actively wrong the moment CodeBiome started
supporting multiple concurrent agents/clients: two different developers
hitting the same deployed instance without an explicit `worldId` would
silently collide on "whichever World was most recent," each seeing (and
potentially mutating) the other's analysis. The per-connection default
closes that hole — a connection only ever defaults to a World if its own
config told it to.

Every tool's args type accepts an optional `worldId`/`owner`/`repo` — the
resolution underneath is uniform across all 32 tools.

## 5. `analyze_repository` — the agent-first entry point

A focused MCP tool (`src/server/mcp-tools/analysisTools.ts`):

```json
{ "repositoryUrl": "https://github.com/owner/repo" }
```
returns:
```json
{
  "worldId": "5XG-E1DRD5KY",
  "worldUrl": "https://codebiome.vercel.app/world/5XG-E1DRD5KY",
  "repository": "owner/repo",
  "commitSha": "...",
  "fileCount": 600,
  "topLevelEntries": ["src", "docs", "package.json"],
  "message": "..."
}
```

**This does NOT run any architecture analysis.** It fetches the repository
(`buildRepositorySnapshot`) and records its real file tree
(`seedKnowledgeModel`, src/server/ingestion/) — the same ingestion step the
browser's manual "paste a GitHub URL" flow uses. Nothing about modules,
dependencies, or entry points exists yet; the calling agent is expected to
explore the repository itself and then call the `submit_*` tools. This is
the core of the architecture rework — see
[`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) §1-2 for why.

## 6. World URL — `/world/[worldId]`

`src/app/world/[worldId]/page.tsx` fetches `GET /api/world/{worldId}` and
reconstructs the full CodeBiome experience: the five lenses, the
Investigation Panel, and whatever has been submitted/contributed so far —
all from the World id alone. **No GitHub URL re-entry required.**

### Browser-first flow

`src/app/page.tsx` (the root `/` page) supports pasting a GitHub URL
manually. It ingests the repository the same way `analyze_repository` does,
then hands the freshly created World to CodeBiome's own built-in demo agent
(`src/server/demo-agent/runDemoAgent.ts`) — an in-process MCP client running
an LLM tool-use loop against the exact same tools an external agent would
call — so the "paste a URL and watch it get analyzed" experience still
exists without requiring a manually-driven external agent. If
`GROQ_API_KEY` isn't set, this step is skipped (not a fatal error): the
World still exists with a real file tree, and a developer can connect their
own agent to populate it instead.

```
Agent-first:    an agent -> analyze_repository -> worldUrl -> browser opens it
                            -> agent explores + calls submit_* tools
Browser-first:  developer -> paste URL -> /api/analyze -> redirect to /world/{id}
                            -> CodeBiome's own demo agent explores + submits
```

Both entry points produce the exact same World abstraction and land on the
same URL shape; both are populated by an agent calling the exact same
`submit_*` tools — CodeBiome's own demo agent has no special access.

## 7. Browser <-> agent event routing, scoped by World

Every `AgentEvent` (`src/types/agent-events.ts`) carries a `worldId` field.
`src/server/agent/eventBus.ts`'s `activityEventBus` publishes by appending to
`worldStore` (durable); `src/server/api-handlers/agentEvents.ts`'s SSE
handler (`/api/agent-events`) reads back through
`worldStore.getEventsSince(worldId, ...)`, filtered to exactly that World —
an event from World A cannot reach a World B browser tab, even when both
were analyzed from the same repository.

Delivery is a short poll (`POLL_INTERVAL_MS = 1500`) against the durable
event log, not an instant in-memory push — a deliberate correctness-for-
latency tradeoff: a human watching a demo cannot distinguish instant from
~1.5s, and a single delivery mechanism correct regardless of which instance
handled which request is worth more than an instant one that silently misses
cross-instance events.

## 8. Local development vs. production

| | Local (`npm run dev`/`start`) | Production (Vercel) |
|---|---|---|
| World persistence | `FileWorldStore` (OS temp dir) | `BlobWorldStore` (Vercel Blob) |
| Setup required | None | One-time `vercel storage create` + `connect` |
| World URL base | `http://localhost:3000` | `https://<production-domain>` (`VERCEL_PROJECT_PRODUCTION_URL`, or `APP_BASE_URL` override) |
| stdio MCP process | `npm run mcp:stdio` shares the same `FileWorldStore` automatically | Not applicable — connect over HTTP instead |

## 9. Example agent workflow

```
Developer (in any connected MCP client):
"Analyze https://github.com/lujakob/nestjs-realworld-example-app and
 create a guided onboarding journey for the main user workflow."

Agent:
  analyze_repository({ repositoryUrl: "..." })
    -> { worldId: "abc123", worldUrl: "https://.../world/abc123", fileCount: 340, ... }
  get_file / search_repository  x N   (explores the real code itself)
  submit_modules({ worldId: "abc123", modules: [...] })
  submit_dependencies({ worldId: "abc123", dependencies: [...] })
  submit_entry_points({ worldId: "abc123", entryPoints: [...] })
  submit_flow({ worldId: "abc123", name: "...", steps: [...] })
  create_onboarding_journey({ worldId: "abc123", title: "...", steps: [...] })

Agent's answer to the developer:
"I analyzed the repository and created a CodeBiome world:
 https://.../world/abc123 — [explanation, citing what it actually submitted]"

Developer opens the URL -> the world loads, already showing the modules,
flow, and onboarding journey the agent submitted, updating live if the
agent submits more.
```

## 10. Known limitations

- **Read-modify-write on `WorldSnapshot`/`WorldMutableState`, not a
  transaction.** Two concurrent tool calls that both mutate the same World
  (e.g. two agents submitting modules at once) could race (last write
  wins).
- **No World expiry/cleanup.** Worlds accumulate in Blob storage
  indefinitely.
- **Auth is opt-in and all-or-nothing.** `MCP_AUTH_TOKEN`, when set, gates
  the entire `/api/mcp` endpoint; unset (the local-dev default), a World id
  is opaque but not a security boundary — anyone with the URL can view or
  act on a World. See [`docs/MCP_CLIENTS.md`](./MCP_CLIENTS.md).
- **SSE delivery is polled, not pushed** (§7) — up to ~1.5s latency for a
  cross-instance event to reach a browser tab.
