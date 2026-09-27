# Deploying CodeBiome to Vercel

> **Historical record (mostly still accurate).** This is a real deployment investigation report, including genuine bugs found and fixed against a live Vercel deployment and a real IBM Bob session. The infrastructure findings (Vercel instance behavior, Blob storage setup, the one-Vercel-Function consolidation) remain accurate. Some names have since changed: `bobEventBus` → `activityEventBus`, `/api/bob-events` → `/api/agent-events`, `knowledgeModelStore` was removed entirely (no per-commit analysis cache exists anymore — see [`docs/REPOSITORY_KNOWLEDGE_MODEL.md`](./REPOSITORY_KNOWLEDGE_MODEL.md)). See [`docs/MCP_CLIENTS.md`](./MCP_CLIENTS.md) for current MCP client setup.

This document covers making the existing CodeBiome application (unchanged
architecture, visual design, deterministic pipeline, RKM, FlowModel, Bob
integration, onboarding journeys) deployable to Vercel with a working
remote MCP endpoint for IBM Bob. See `docs/BOB_REMOTE_MCP.md` for the Bob
IDE connection steps.

**Status: deployed and verified.** Live URLs are in §5.

**Update — the cross-instance state limitation documented in §3/§8 below
has since been resolved.** §3/§8 describe the state of the `/api/bridge`
consolidation-only fix, which reduced but did not eliminate the risk of
Bob's tool calls landing on a different Vercel instance than the browser's.
`docs/WORLD_ARCHITECTURE.md` replaces the in-memory "most recently
analyzed" pointer with durable, Vercel Blob-backed World storage — every
World is now correctly readable from any instance, not just a warm one.
The rest of this document (transport, routing, the `export-detail.json`
investigation) is unaffected and still accurate.

## 1. Prerequisites

- A Vercel account (Hobby tier is enough for a hackathon demo).
- This repository, pushed to a Git provider Vercel can import from (GitHub,
  GitLab, or Bitbucket) — **or** the Vercel CLI, which can deploy directly
  from a local directory without git (used for the actual deployment below).
- Environment variables — see §4. None are required to get a working
  deployment; `GITHUB_TOKEN` only raises an API rate limit.
- IBM Bob (Shell or IDE) if you intend to connect it — see
  `docs/BOB_REMOTE_MCP.md`.

## 2. Architecture changes made for Vercel compatibility

**MCP transport: unchanged, already correct.** `/api/mcp` already used
`WebStandardStreamableHTTPServerTransport` (Streamable HTTP, the modern
transport IBM's own docs describe) in stateless mode before this phase.
Verified against the real deployment: `initialize` and `tools/list` (all 21
tools) both work correctly over HTTPS — see §5.

**Runtime: unchanged, already correct.** Every API route already declared
`export const runtime = "nodejs"` (required for the tarball/`tar`-based
ingestion pipeline, which needs `/tmp` filesystem access unavailable on the
Edge runtime). No route was moved to Edge.

**Routing: consolidated into one literal route + `rewrites()`.** The four
state-sharing endpoints — `/api/analyze`, `/api/mcp`, `/api/session-context`,
`/api/bob-events` — are all backed by one file,
[`src/app/api/bridge/route.ts`](../src/app/api/bridge/route.ts), which
dispatches on a `?target=<name>` query parameter. `next.config.mjs`'s
`rewrites()` maps each public path onto `/api/bridge` internally, so
**external URLs are byte-for-byte unchanged** — `/api/analyze`, `/api/mcp`,
`/api/session-context`, and `/api/bob-events` all still work exactly as
before, same methods, same request/response shapes, confirmed against the
live deployment (§5). `/api/file` was left as its own separate, literal
route (see §3 for why).

A `[...catchall]` dynamic route was tried first for this same consolidation
and *also* solved the state-sharing problem — but surfaced a separate, real
Next.js 14.2.35 defect that had to be routed around; see §6 for the full
story, since understanding it matters for anyone extending this routing
later.

**No `vercel.json` was added.** Vercel auto-detects Next.js and all
per-route configuration (`runtime`, `maxDuration`) is expressed as Next.js
route segment config in the route file itself.

## 3. State handling — what's in-memory, and why it needed a fix

**The problem, verified, not assumed.** Vercel deploys each `route.ts` file
as its own independent serverless function with its own process memory.
Before this phase, CodeBiome had five in-memory stores
(`knowledgeModelStore`, `sessionContextStore`, `bobEventBus`,
`domainConceptStore`, `onboardingJourneyStore`) each written by one API
route and read by a *different* one:

```
POST /api/analyze          writes  knowledgeModelStore
POST /api/session-context  writes  sessionContextStore
*    /api/mcp              reads   knowledgeModelStore, sessionContextStore
                            writes  bobEventBus, domainConceptStore, onboardingJourneyStore
GET  /api/bob-events (SSE) reads   bobEventBus
```

If these four had shipped as four separate Vercel Functions, every one of
those cross-endpoint reads would see empty state, always. **The fix: fold
them into one Vercel Function** (§2), not a database — none of the five
stores' implementation changed; they're still the same plain in-memory
`Map`s.

**Verified working on the real deployment**, back-to-back: `POST
/api/analyze` for `sindresorhus/execa`, immediately followed by `POST
/api/mcp` calling `get_repository_overview` with no `owner`/`repo`
arguments (forcing the "most recently analyzed" fallback) — returned the
correct real data. This is the exact flow that would have failed 100% of
the time without the §2 fix.

**The residual limitation is real, more frequent in practice than initially
estimated, and was empirically confirmed repeatedly, not just theorized
once.** First observed during a live IBM Bob Shell session against the
deployed URL (§5.3): a 103-second, 24-tool-call investigation hit
`create_onboarding_journey` failing with `"No repository has been analyzed
by CodeBiome yet"` even though `get_repository_overview` had succeeded
minutes earlier in the *same* session. Follow-up testing showed this is
**not rare**: analyzing a repository via `curl`, then calling
`get_repository_overview` for it via a **separate** `curl` invocation
*seconds* later — sometimes even the very next request — returned the same
"not analyzed" error. This reproduced consistently enough across repeated
trials that it should be treated as "expect this to happen within a normal
demo session," not "an edge case under heavy load."

Investigated whether this is fixable at the platform-configuration level
before accepting it: Vercel's Fluid Compute execution model (which shares
warm-instance memory across concurrent invocations of one function) has
been the **default for all new projects since April 2025** — confirmed via
Vercel's own docs — so this project already has it, without needing
`vercel.json`'s `fluid: true` (redundant here). Fluid Compute reduces cold
starts and lets *simultaneous* requests share an instance; it does not
guarantee that two sequential-but-independent requests (a `curl` call, then
a separate Bob tool call moments later) land on the same instance — Vercel's
request router still makes that decision per-request, and idle instances
can still be reclaimed. There is no further configuration-level fix
available for a plain in-memory store; a deterministic fix requires real
shared persistence (a database or equivalent), which is out of scope for
this deployment-focused phase per its own explicit instructions ("do not
add a database unless genuinely necessary" — that necessity applies to
*reliable cross-instance state*, a different, larger problem than "get the
app deployed," which this phase solved).

**Practical mitigation for a demo**: immediately before a Bob session,
re-run the analysis (fast — seconds for a small-to-medium repo) and start
asking Bob right away; if a mid-session call fails with "not analyzed,"
that's the signal to re-analyze and continue. **Recommended next step if a
fully reliable multi-client demo is required**: add a small persistence
layer (e.g. Vercel Blob or KV) behind the existing `KnowledgeModelStore`/
`sessionContextStore`/`bobEventBus` interfaces — a scoped, separate task,
not attempted here since it wasn't necessary to achieve *a working
deployment*, which was this phase's objective.

**`/api/file` was deliberately left out of the consolidation** — no
cross-endpoint state dependency, so it stays its own simpler function.

**No new environment variables, no new dependencies, no database** were
introduced by the state fix.

## 4. Environment variables

| Variable | Required? | Where | Purpose |
|---|---|---|---|
| `GITHUB_TOKEN` | Optional | Development & Production | Raises the GitHub REST/tarball API rate limit from 60/hour (unauthenticated) to 5,000/hour. Public repositories analyze fine without it up to that limit. Create one with no scopes selected (public read access only). |
| `BLOB_READ_WRITE_TOKEN` or `BLOB_STORE_ID` | One of these required in production, both absent in development | Production only | Vercel Blob credential backing durable World storage (`docs/WORLD_ARCHITECTURE.md` §3) — auto-injected by `vercel storage connect`, never set by hand. The CLI's current default connects via OIDC, which sets `BLOB_STORE_ID` (not `BLOB_READ_WRITE_TOKEN`) and relies on a per-request `VERCEL_OIDC_TOKEN` injected by the runtime; an older/manual connection may instead set `BLOB_READ_WRITE_TOKEN`. `worldStore` treats either as sufficient. Without either, it silently falls back to an in-memory implementation that does NOT survive across serverless instances — correct for local dev, wrong for a real deployment. |

No Bob API key, no database URL, no other secret is required anywhere in
this codebase: CodeBiome is the *server* side of the MCP connection (see
`docs/BOB_INTEGRATION.md` §8). The live deployment below was done
**without** setting `GITHUB_TOKEN` — public-repo analysis worked fine
within the unauthenticated rate limit.

**To set `GITHUB_TOKEN` on Vercel**: Project Settings → Environment
Variables → add it for Production. **Never commit it.**

**To set `BLOB_READ_WRITE_TOKEN`/`BLOB_STORE_ID`**: don't — provision a Blob
store instead (`vercel storage create <name> --type blob --access private`
then `vercel storage connect <name> --yes`), which injects whichever one
applies automatically. As deployed for this project, `storage connect` used
OIDC auth and injected `BLOB_STORE_ID` (plus `BLOB_WEBHOOK_PUBLIC_KEY`), not
`BLOB_READ_WRITE_TOKEN` — both are supported by `worldStore`'s selection
check.

## 5. Live deployment

```
CodeBiome:  https://codebiome.vercel.app
MCP:        https://codebiome.vercel.app/api/mcp
```

Deployed via the Vercel CLI (`vercel --prod`) to project
`momentum-208e/codebiome`, aliased to the production domain above.

### 5.1 What was verified against the live URL (not a local build)

- `GET https://codebiome.vercel.app/` → `200`, UI loads.
- `POST /api/mcp` `initialize` → correct protocol handshake.
- `POST /api/mcp` `tools/list` → all **21** real tools returned.
- `POST /api/analyze` — real analysis of `sindresorhus/execa` completed
  (NDJSON stream, real GitHub data, real RKM built).
- `POST /api/mcp` `get_repository_overview` (no `owner`/`repo`) immediately
  after — correctly resolved the just-analyzed repository via the "most
  recently analyzed" fallback, proving the §3 state fix works in
  production, not just in theory.
- `GET /api/file` (missing params) → `400`.
- `GET /api/analyze` → `405` (wrong method).
- `POST /api/session-context` (missing `repositoryId`) → `400`.
- `GET /api/bob-events` (missing `repositoryId`) → `400`.

### 5.2 What was NOT re-verified live (already covered by the automated suite)

The full `create_onboarding_journey` → world-action → SSE-replay chain and
every invalid-argument/invalid-reference case are covered by
`src/app/api/bridge/route.test.ts` (14 tests, run against the real
production build's route code) and the rest of the 138-test suite — not
re-run manually against the live URL beyond what §5.1 and §5.3 exercised.

### 5.3 Real IBM Bob Shell session against the deployed URL

```bash
bob mcp add codebiome-remote https://codebiome.vercel.app/api/mcp -t http -s global
bob run --accept-license --trust "I'm new to this repository. Analyze it and create a guided onboarding journey..."
```

Real, observed tool sequence (24 calls, $0.68, 103s):
`get_repository_overview` → `list_flows` → `get_flow` → `get_module`×12 →
`list_onboarding_journeys` (checking for duplicates, unprompted) →
`list_domain_concepts` (same) → `contribute_domain_concept`×5 →
`create_onboarding_journey` (failed — see §3's residual-limitation finding)
→ `open_module` (also failed, same cause). Bob's own final answer correctly
distinguished **"Verified facts"** (real LOC counts, real dependency
lists, real file names, all cited) from **"My interpretation"** on every
architectural point it made, and transparently told the developer that the
world-reaction tools needed the repo re-opened in the browser — an honest
degradation, not a fabricated success.

This is genuine remote IBM Bob validation — a real Bob Shell 2.0.4
session, a real deployed Vercel URL, real MCP tool calls, including one
real, disclosed failure mode. Nothing here is simulated.

## 6. The `export-detail.json` deployment blocker — root cause, found and fixed

An earlier deployment attempt failed identically 3 times, on Vercel's own
remote build infrastructure, with:
```
Error: ENOENT: no such file or directory, lstat '/vercel/path0/.next/export-detail.json'
```
This was initially suspected to be an unfixable external Vercel platform
bug (multiple Vercel Community threads report the same symptom with no
confirmed fix). **A focused follow-up investigation found the actual root
cause and a legitimate, official fix.** In order:

1. **Removed a stray `.npmrc`** that had ended up at the project root
   (`prefix=/home/mahdi/.npm-global`, an artifact of local tooling setup,
   not part of the app). This caused a real `npm error` during Vercel's
   install step but, verified by testing, was **not** the cause of the
   `export-detail.json` crash — the identical error persisted after
   removing it. Kept removed regardless; it never belonged in the repo.
2. **Got the exact stack trace**, which Vercel's own CLI/build log
   suppresses (it prints only `.message`), by running `vercel build`
   locally with `NODE_OPTIONS="--require <local-diagnostic-hook>.js"` — a
   monkey-patch of `fs.lstat`/`fs.promises.lstat` that logged a stack trace
   only when called with a path containing `export-detail.json`. This is a
   read-only diagnostic technique (no files modified, nothing shipped) —
   distinct from patching `@vercel/next`'s own installed files, which
   was correctly avoided per this phase's explicit instructions. The trace
   pointed to `@vercel/next`'s `serverBuild` → `collectTracedFiles`,
   called once per file listed in **each individual route's own
   `.next/server/app/.../route.js.nft.json` trace manifest** — a file
   Next.js itself generates via `@vercel/nft`, not something `@vercel/next`
   invents.
3. **Inspected the actual polluted manifest**: the affected route's own
   `route.js.nft.json` listed `../../../../export-detail.json`,
   `../../../../export/404.html`, `../../../../export/500.html`, and
   `../../../../cache/webpack/**/*.pack` as traced dependencies —
   files that do not exist anywhere in a build that never runs `next
   export` (confirmed: `.next/export-marker.json` correctly reports
   `hasExportPathMap: false`, and no `.next/export/` directory is ever
   created). This is a genuine Next.js 14.2.35 output-file-tracing defect:
   for **exactly one** Node.js-runtime API route per build, its generated
   trace manifest incorrectly includes these nonexistent build-cache/export
   artifacts. `@vercel/next`'s `collectTracedFiles` does an **unguarded**
   `lstat` on every listed file (unlike its own `getExportStatus` helper,
   which correctly uses an existence check) — crashing the instant it hits
   one of these phantom entries.
4. **Ruled out routing structure as the cause, empirically, not by
   assumption**: the SAME pollution was reproduced with (a) the original
   five separate literal routes, (b) a `[...codebiome]` catch-all
   consolidating four of them, (c) an optional catch-all
   `[[...codebiome]]`, and (d) a single literal `/api/bridge` route — in
   each rebuild, a *different* route ended up carrying the bogus trace
   entries (`[...codebiome]` once, `/api/bridge` once, plain `/api/analyze`
   once). This proves the defect is a **pre-existing Next.js 14.2.35 build
   characteristic of this project's route/dependency graph**, not caused by
   the consolidation work in §2 or by any specific route shape.
5. **Applied the fix**: Next.js's own official, documented mechanism for
   correcting an over-inclusive trace —
   `experimental.outputFileTracingExcludes` in `next.config.mjs` — scoped
   globally (`'/*'`) since the affected route isn't fixed:
   ```js
   experimental: {
     outputFileTracingExcludes: {
       "/*": [".next/export-detail.json", ".next/export/**/*", ".next/cache/webpack/**/*"],
     },
   },
   ```
   This is not a suppression hack, not a fake file, not a patched
   dependency — it's the config option Next.js's own docs name specifically
   for "Next.js might incorrectly include unused files" in a trace. (On
   Next.js 14.2.35 this option lives under `experimental` in
   `next/dist/server/config-schema.js`; it is a stable top-level option in
   later Next.js versions.)
6. **Verified the fix holds**: two consecutive clean local rebuilds (no
   pollution in any `.nft.json`), then a real `vercel --prod` deploy
   succeeded on the first attempt with the fix in place.

**What was deliberately NOT done**, per this phase's explicit constraints:
no `.next/export-detail.json` was ever created manually; `@vercel/next`'s
installed package was read for diagnosis but never modified for the
working fix; no postbuild script suppresses or works around the crash;
`output: "standalone"` was tried as an unrelated one-line experiment and
reverted (didn't help, isn't needed); no dependency tree upgrade was
performed — only the one official, scoped config option was added.

## 7. Testing performed

- ✅ **Local**: `npm run typecheck`, `npm run test` (138/138), `npm run build` — clean, both before and after the §6 fix.
- ✅ **Local production server** (`npm run start`): all endpoints exercised via `curl`, including the full analyze → MCP cross-endpoint flow.
- ✅ **Real deployment**: see §5.

### Post-deployment checklist

- [x] CodeBiome UI loads at `https://codebiome.vercel.app`
- [x] Repository analysis completes against a real GitHub repo
- [x] `POST /api/mcp` `tools/list` returns all 21 tools
- [x] A real Bob session can call `get_repository_overview` and get real data back
- [x] Cross-endpoint state (analyze → mcp) works for back-to-back requests
- [ ] `create_onboarding_journey` + live browser world-reaction — covered by
      the automated suite (`route.test.ts`) and by local browser testing in
      the prior phase; not re-verified against the live browser + live
      deployment combination in this session (would need the CodeBiome tab
      open against the deployed URL during a live Bob session — see §8)

## 8. Limitations (honest, not exhaustive marketing copy)

- **In-memory state can be lost mid-session if Vercel scales `/api/bridge`
  to an additional instance** — empirically observed during the real Bob
  session in §5.3, not just theoretical. Mitigation: re-analyze (fast,
  cached by commit SHA) if a long session starts erroring. Fixing this
  properly requires real persistence (a database), explicitly out of scope
  for this hackathon phase.
- **No authentication on `/api/mcp` or `/api/analyze`** — anyone with the
  deployed URL can call every tool and trigger analysis of any public
  repository. Fine for a demo, not for production.
- **`GITHUB_TOKEN` is optional but recommended for a live demo** — the
  unauthenticated 60/hour GitHub API limit is easy to exhaust across a few
  analyses in one session; not set on the current deployment.
- **SSE (`/api/bob-events`) connections are capped by the function's
  `maxDuration`** (60s) — the browser's `EventSource` auto-reconnects and
  replays recent history, so live reactions keep working, just with an
  occasional (≤60s) reconnect blip.
- **The full "developer's browser open against the live deployment, Bob
  driving it live" loop** was validated architecturally (automated tests)
  and via a real remote Bob session hitting the real API, but not as one
  single combined live demo run with a browser tab open during this
  session — worth a dry run before presenting.
