# World Architecture — Bob-First Repository Analysis

This document covers the CodeBiome **World** abstraction: what makes it
possible for a developer to ask IBM Bob to analyze a repository *without
ever opening the CodeBiome web app first*, and for the resulting analysis
to be reliably reachable from any Vercel serverless instance.

See also: `docs/BOB_INTEGRATION.md` (the MCP tool architecture this builds
on), `docs/VERCEL_DEPLOYMENT.md` (the deployment/persistence investigation
this phase's design responds to), `docs/BOB_REMOTE_MCP.md` (connecting Bob
to a deployed CodeBiome).

## 1. The problem this solves

Before this phase, "which repository is CodeBiome currently showing" was
answered by in-memory, per-process state (`knowledgeModelStore`'s "most
recently analyzed" pointer). This worked locally (one process) but broke on
Vercel: a developer's browser call to `/api/analyze` and Bob's later call to
`/api/mcp` are independent HTTP requests that Vercel does not guarantee
lands on the same warm instance. Empirically confirmed
(`docs/VERCEL_DEPLOYMENT.md` §3) to happen often enough to matter, this
surfaced as Bob's tools intermittently returning *"No repository has been
analyzed by CodeBiome yet in this session."*

It also meant the ONLY way to start was: open the browser, paste a URL,
keep that tab/session alive, then switch to Bob. There was no way for Bob
to be the entry point.

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

Two parts, split deliberately (mirrors `docs/ARCHITECTURE.md`'s "layer 3 is
the contract" rule):

```
World
 ├── WorldSnapshot (immutable — never mutated after creation)
 │    ├── knowledgeModel   (the real RKM)
 │    ├── flowModel        (statically inferred flows)
 │    └── worldModel       (the 3D world model)
 │
 └── WorldMutableState (mutable — Bob's interpretation + navigation session)
      ├── sessionContext       (what the developer is looking at right now)
      ├── domainConcepts[]     (AI-interpreted groupings Bob contributed)
      └── onboardingJourneys[] (ordered, narrated paths Bob created)
```

**Analyzing the same repository twice deliberately creates two independent
Worlds** — different ids, different mutable state, isolated events. A World
represents one analysis *visit*, not a cache keyed by commit. (The
underlying `knowledgeModelStore` fetch-avoidance cache, unchanged, still
means re-analyzing an already-seen commit is fast — it just always gets a
fresh World identity on top.)

## 3. Persistence — Vercel Blob, not a database

`src/server/world/worldStore.ts` is the single source of truth for World
data. Two implementations, selected automatically:

- **`BlobWorldStore`** (when `BLOB_READ_WRITE_TOKEN` OR `BLOB_STORE_ID` is
  set — production): plain JSON blobs at deterministic pathnames
  (`worlds/{id}/snapshot.json`, `worlds/{id}/state.json`,
  `worlds/{id}/events.json`, plus two small index blobs for the owner/repo
  and "most recent" fallback lookups), written with `access: "private"` and
  `allowOverwrite: true`, read back with the SDK's `get()` (not a raw
  `fetch` of the blob URL — a private blob's URL isn't fetchable
  unauthenticated; `get()` resolves the same OIDC/token credential `put()`
  used). This store was provisioned as `--access private`
  (`docs/VERCEL_DEPLOYMENT.md` §4); Vercel rejects `access: "public"` writes
  against a private store outright — confirmed against the real deployment,
  not just inferred from docs. A read-through/write-through in-memory `Map`
  cache sits in front of it purely for same-instance speed — never the
  source of truth, so a cold/different instance falls through to Blob
  correctly.
- **`InMemoryWorldStore`** (neither var set — local `npm run dev`/`npm run
  start`): the exact same interface, backed by plain `Map`s. Zero required
  local setup, matching this project's existing philosophy for every prior
  store.

This was chosen over Postgres/Redis/Vercel KV because the actual
requirement is "read/write small-to-medium JSON blobs, correctly, from any
instance" — Vercel Blob is the smallest primitive that provides that,
without provisioning a database. See `docs/VERCEL_DEPLOYMENT.md` §6 for why
this project already ruled out heavier options once before.

**Provisioning** (one-time, via the Vercel CLI or dashboard):
```bash
vercel storage create codebiome-worlds --type blob --access private
vercel storage connect codebiome-worlds --yes
```
**Important, empirically confirmed during this project's own deployment**:
the Vercel CLI's current default `storage connect` flow uses OIDC auth — it
injects `BLOB_STORE_ID` (and `BLOB_WEBHOOK_PUBLIC_KEY`) into the project's
environment, but deliberately does **not** set `BLOB_READ_WRITE_TOKEN`. The
actual per-request credential (`VERCEL_OIDC_TOKEN`) is injected by the
Vercel runtime itself and never appears in `vercel env ls` — the
`@vercel/blob` SDK resolves it automatically given `BLOB_STORE_ID`. The
store-selection check above deliberately treats either var as sufficient on
its own; gating only on `BLOB_READ_WRITE_TOKEN` would silently fall back to
in-memory storage under this now-default connection method, no code change
needed either way to pick up whichever one is present.

## 4. World resolution — how every MCP tool finds "which World"

`src/server/bob-tools/resolveRepository.ts`'s `resolveWorld()` (and the
`resolveKnowledgeModel`/`resolveFlowModel` wrappers every existing tool
already called) now try, in order:

1. **`worldId`** — the robust path. Bob gets this once from
   `analyze_repository`'s own result and threads it through every
   subsequent call in the same conversation, exactly the way it already
   threaded `owner`/`repo` before. This is an ordinary piece of
   conversation context to an LLM agent — Bob does not need any new MCP
   protocol feature to "remember" it, and the developer never has to copy
   or paste an id anywhere.
2. **`owner`/`repo`** — backward-compatible convenience: resolves to
   whichever World was most recently created for that repository
   (`worldStore.getLatestWorldIdForRepository`).
3. **Neither** — resolves to the single most recently created World across
   the deployment (`worldStore.getMostRecentWorldId`) — the same
   "developer has one World open" fallback this project always had, now
   backed by durable storage instead of in-memory-only.

Every existing tool (`get_repository_overview`, `get_module`, `list_flows`,
`start_flow`, `contribute_domain_concept`, `create_onboarding_journey`,
etc.) kept its exact function body — only the args type widened to accept
an optional `worldId`, and the resolution underneath is now World-aware.
**No tool implementation was duplicated.**

## 5. `analyze_repository` — the Bob-first entry point

A new, focused MCP tool (`src/server/bob-tools/analysisTools.ts`):

```json
{
  "repositoryUrl": "https://github.com/owner/repo"
}
```
returns:
```json
{
  "worldId": "5XG-E1DRD5KY",
  "worldUrl": "https://codebiome.vercel.app/world/5XG-E1DRD5KY",
  "repository": "owner/repo",
  "commitSha": "...",
  "summary": { "modules": 33, "files": 600, "flows": 1, "entryPoints": 1 },
  "message": "Repository analyzed successfully. I created a CodeBiome world for this repository: https://codebiome.vercel.app/world/5XG-E1DRD5KY"
}
```
Every number in `summary` is read directly off the real, just-built
`RepositoryKnowledgeModel`/`FlowModel` — never invented.

**It runs the exact same deterministic pipeline** the browser's manual
"paste a GitHub URL" flow uses — both call
`src/server/analysis/runAnalysisPipeline.ts` (extracted from what used to
be `/api/analyze`'s only body), then both call
`src/server/world/createWorldFromAnalysis.ts` to create a World from the
result. **There is exactly one analysis pipeline**; `analyze_repository`
does not duplicate it, and does not skip any deterministic step to be
faster.

## 6. World URL — `/world/[worldId]`

`src/app/world/[worldId]/page.tsx` fetches `GET /api/world/{worldId}`
(`src/app/api/world/[worldId]/route.ts`, its own simple route — it only
reads `worldStore`, no cross-endpoint in-memory dependency, so it doesn't
need to share a process with anything) and reconstructs the full CodeBiome
experience: the 3D world, the Investigation Panel, Flow Explorer, and
whatever domain concepts/onboarding journeys were already contributed —
all from the World id alone. **No GitHub URL re-entry required.**

The actual world UI (`src/features/world-experience/WorldExperience.tsx`)
is unchanged in substance from before this phase — it was extracted
verbatim from `src/app/page.tsx`'s old inline "world" render phase, just
parameterized by `worldId` instead of reading `knowledgeModel.meta.repositoryId`.
**The visual design was not touched.**

### Browser-first fallback

`src/app/page.tsx` (the root `/` page) still supports pasting a GitHub URL
manually — it now runs the same pipeline via `/api/analyze`, and on success
redirects (`router.push`) to `/world/{worldId}` instead of rendering the
world inline. **Both entry points produce the exact same World
abstraction** and land on the same URL shape:

```
Bob-first:     Bob -> analyze_repository -> worldUrl -> browser opens it
Browser-first: developer -> paste URL -> /api/analyze -> redirect to /world/{id}
```

## 7. Browser <-> Bob event routing, scoped by World

Every `BobEvent` (`src/types/bob-events.ts`) now carries a `worldId` field,
not just the pre-existing `repositoryId`. `src/server/bob/eventBus.ts`
publishes by appending to `worldStore` (durable); `src/server/api-handlers/
bobEvents.ts`'s SSE handler reads back through
`worldStore.getEventsSince(worldId, ...)`, filtered to exactly that World —
**an event from World A is structurally incapable of reaching a World B
browser tab**, even when both were analyzed from the same repository,
because they're stored under different `worlds/{id}/events.json` blobs
entirely.

**Delivery mechanism, deliberately changed**: the old in-memory
`EventEmitter` push (instant, but only reached a subscriber on the exact
same warm instance that published the event — the same class of bug as §1)
was replaced with a short poll (`POLL_INTERVAL_MS = 1500`) against the
durable event log. This is a correctness-for-latency tradeoff, made
deliberately: a human watching a demo cannot distinguish instant from
~1.5s, and a single delivery mechanism that is correct regardless of which
instance handled which request is worth far more than an instant one that
silently misses cross-instance events. **Verified working end-to-end**,
locally, with a real Bob Shell session: a browser tab opened via the
browser-first flow visibly reacted (Investigation Panel focus, "BOB'S
ONBOARDING JOURNEY" HUD card) to a separate, real `bob run` process calling
`create_onboarding_journey` against the same World id.

## 8. Local development vs. production

| | Local (`npm run dev`/`start`) | Production (Vercel) |
|---|---|---|
| World persistence | `InMemoryWorldStore` (plain `Map`s) | `BlobWorldStore` (Vercel Blob) |
| Setup required | None | One-time `vercel storage create` + `connect` |
| World URL base | `http://localhost:3000` | `https://<production-domain>` (from `VERCEL_PROJECT_PRODUCTION_URL`, or `APP_BASE_URL` override — see `src/server/world/baseUrl.ts`) |
| Cross-instance correctness | N/A (one process) | Durable — verified via Blob-backed reads from a freshly created serverless instance |

## 9. Example Bob workflow

```
Developer (in Bob IDE):
"Analyze https://github.com/lujakob/nestjs-realworld-example-app and
 create a guided onboarding journey for the main user workflow."

Bob:
  analyze_repository({ repositoryUrl: "..." })
    -> { worldId: "abc123", worldUrl: "https://.../world/abc123", summary: {...} }
  get_repository_overview({ worldId: "abc123" })
  list_flows({ worldId: "abc123" })
  get_flow({ worldId: "abc123", flowId: "..." })
  get_module({ worldId: "abc123", moduleId: "..." })  x N
  create_onboarding_journey({ worldId: "abc123", title: "...", steps: [...] })

Bob's answer to the developer:
"Repository analyzed successfully. I created a CodeBiome world for this
 repository: https://.../world/abc123 — [explanation, citing real facts]"

Developer opens the URL -> the 3D world loads, already showing the
onboarding journey Bob created, no GitHub URL re-entry needed.

Developer, in Bob: "What happens after this?"
Bob: get_current_context({ worldId: "abc123" }) -> resolves "this" from
     what the browser last reported -> investigates -> answers, optionally
     calling advance_onboarding_step to move the walkthrough itself.
```

## 10. What did NOT change

- The deterministic analyzers, RKM schema, FlowModel inference, and World
  Model builder — untouched.
- The 3D visual experience — untouched (extracted, not redesigned).
- The AI-grounding invariant — every domain concept and onboarding journey
  step still validates every referenced entity against the real RKM before
  storing anything; Bob still cannot invent a module, file, or dependency
  edge. This was not weakened anywhere in this phase.
- The existing manual browser-first workflow — still works, now on the
  same World abstraction instead of an anonymous inline render.

## 11. Known limitations

- **Read-modify-write on `WorldMutableState`, not a transaction.** Two
  concurrent tool calls that both mutate a World's session context /
  domain concepts / onboarding journeys could race (last write wins). Same
  class of weak-consistency tradeoff this project already accepted for
  every in-memory store before Worlds existed — now explicitly disclosed
  rather than papered over.
- **No World expiry/cleanup.** Worlds accumulate in Blob storage
  indefinitely. Fine for a hackathon; a real product would need a TTL or
  cleanup job.
- **No authentication.** A World id is opaque but not a security boundary
  — anyone with the URL (or who guesses a 9-byte random id, which is not
  practical, but is not *cryptographically* hardened either) can view or
  act on a World. Proportional to the rest of this application's existing
  posture (no auth anywhere yet).
- **SSE delivery is polled, not pushed** (§7) — up to ~1.5s latency for a
  cross-instance event to reach a browser tab. Deliberate, disclosed
  tradeoff, not a bug.
