# CodeBiome

Turn any public GitHub repository into a verified, explorable understanding
of its architecture, request flows, health, and onboarding path — then let
an AI coding agent (IBM Bob) investigate it live, through the same facts.

**Live:** [codebiome.vercel.app](https://codebiome.vercel.app) · **MCP
endpoint:** `/api/mcp`

## What it does

Paste a GitHub URL. CodeBiome downloads the repository, runs a deterministic
analysis pipeline over every file (no sampling, no size cap), and builds a
**Repository Knowledge Model** — a schema-validated set of facts about the
codebase: modules, dependencies, entry points, inferred request flows,
security findings, and more. That model is then rendered as five lenses:

| Lens | What it answers |
|---|---|
| **Architecture** | What are the real modules, and how do they and the surrounding infrastructure (databases, caches, queues, external APIs) actually connect? |
| **Onboarding** | Where should a newcomer start, and in what order — a journey an AI agent proposes and narrates, over real modules only. |
| **Flow** | How does one request travel through the system end to end, hop by hop, with a confidence level on every step? |
| **Health** | A composite score with every contributing vulnerability, weakness, and strength shown — never an opaque number. |
| **Plan** | A proposed feature plan an AI agent authored while answering a developer's question — rendered as a viewer, visibly not-yet-real. |

Four lenses are pure views over deterministic facts. **Plan** is the one
AI-interpreted lens, and it is the only one that says so on screen — nothing
in CodeBiome lets an AI-authored guess read as a verified fact.

## AI integration — IBM Bob, as an MCP client

IBM Bob is a coding agent that runs in a developer's own IDE/terminal, not a
hosted service CodeBiome calls out to. So CodeBiome doesn't wrap an LLM call
and label it "Bob" — instead it exposes its own facts as an **MCP server**
(`/api/mcp`, Streamable HTTP, stateless) with 24 tools. A developer's Bob
session connects to it and decides for itself which tools to call —
`get_repository_overview`, `get_flow`, `trace_dependency_path`,
`create_onboarding_journey`, `propose_feature_plan`, and 19 others (full list
in [`src/server/bob-tools/index.ts`](src/server/bob-tools/index.ts)).

A browser tab watching the same repository updates live over SSE the moment
Bob calls a tool — one shared state, whether a human clicks or an agent
calls. See [`docs/BOB_INTEGRATION.md`](docs/BOB_INTEGRATION.md) for the full
architecture writeup, including transcripts from real IBM Bob 2.0 sessions,
and [`docs/BOB_REMOTE_MCP.md`](docs/BOB_REMOTE_MCP.md) for connecting a local
Bob install to a deployed CodeBiome instance.

## The deterministic core

- **13 analyzers**: structure, dependency graphs for JavaScript/TypeScript,
  Python, Go, Rust, Java, C/C++, C#, Ruby, and PHP, plus security, entry
  points, and frontend call sites.
- **Zod-validated schema** — the actual mechanism behind "an AI can never
  invent a repository fact," not just a stated principle.
- **No file cap** — a full repository is always analyzed, not a sample of
  one.
- **226 tests, 37 files**, covering every analyzer and the pipeline that
  wires them together.

## Getting started

```bash
npm install
cp .env.example .env.local   # optional: add a GITHUB_TOKEN to raise the API rate limit
npm run dev                  # http://localhost:3000
```

No database and no required environment variables for local development —
CodeBiome falls back to an in-memory World store automatically. A
`GITHUB_TOKEN` (no scopes needed) raises the unauthenticated GitHub API
limit from 60 to 5,000 requests/hour; `BLOB_READ_WRITE_TOKEN` /
`BLOB_STORE_ID` opt into the durable Vercel Blob-backed store used in
production (see [`docs/WORLD_ARCHITECTURE.md`](docs/WORLD_ARCHITECTURE.md)).

```bash
npm run test        # vitest — 226 tests
npm run typecheck    # tsc --noEmit
npm run lint
npm run build && npm run start
```

### Connect a local Bob session

```bash
bob mcp add codebiome http://localhost:3000/api/mcp -t http -s global
bob run --accept-license --trust "I'm new to this repository. What should I understand first?"
```

## Architecture

```
GitHub URL
  → tarball fetch (codeload.github.com, no git dependency)
  → 13 deterministic analyzers
  → Repository Knowledge Model (Zod-validated)
  → World Model
  → 5 lenses (Architecture / Onboarding / Flow / Health / Plan)
  → MCP server (/api/mcp) — Bob's investigation surface
```

Built for Vercel's Hobby tier: no Postgres, Prisma, or background job
runner — deliberately deferred, not skipped (the reasoning, and the seam
left for adding them later, is in
[`docs/ARCHITECTURE_DECISIONS.md`](docs/ARCHITECTURE_DECISIONS.md)). World
state persists via Vercel Blob when configured, or an in-memory store
otherwise — durable enough that a Bob tool call and a browser tab always see
the same World regardless of which serverless instance handles each request.

Further reading:
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — target architecture
- [`docs/REPOSITORY_KNOWLEDGE_MODEL.md`](docs/REPOSITORY_KNOWLEDGE_MODEL.md) — the schema every lens and every Bob tool reads from
- [`docs/WORLD_ARCHITECTURE.md`](docs/WORLD_ARCHITECTURE.md) — World storage and MCP↔browser state bridge
- [`docs/VERCEL_DEPLOYMENT.md`](docs/VERCEL_DEPLOYMENT.md) — deployment specifics and constraints
- [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) — a full walkthrough script covering every lens and the Bob integration

## Project structure

```
src/
  app/                Next.js App Router — pages and API routes
  features/
    landing/           Landing page
    scanning/          Live analysis-progress view
    world/              The five lenses + shared viewer components
  server/
    analysis/          Pipeline orchestration
    analyzers/         One file per analyzer (13 total)
    ingestion/          GitHub tarball fetch + snapshot building
    knowledge-model/    Schema + builder for the Repository Knowledge Model
    flows/ journeys/    Static reconstruction of request flows and journeys
    world/              World Model + durable/in-memory store
    bob-tools/          The 24 MCP tools Bob calls
    bob/                Event bus + session-context bridge to the browser
    plan/                Feature-plan validation
  lib/                 Client-side derived views (domains, health, infra)
  types/               Shared types across server and client
```

## Tech stack

Next.js 14 (App Router) · React 18 · TypeScript · Zod ·
`@modelcontextprotocol/sdk` · Vitest · Vercel (Hobby tier) + Vercel Blob
