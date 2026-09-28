# CodeBiome

Turn any public GitHub repository into a verified, explorable understanding
of its architecture, request flows, health, and onboarding path — built by
an AI agent you connect (any MCP client — Claude, Cursor, Cline, Windsurf,
IBM Bob, or CodeBiome's own built-in one), never by CodeBiome guessing on
its own.

**Live:** [codebiome.vercel.app](https://codebiome.vercel.app) · **MCP
endpoint:** `/api/mcp` (see [`docs/MCP_CLIENTS.md`](docs/MCP_CLIENTS.md) for
per-client setup)

## What it does

Paste a GitHub URL. CodeBiome fetches the repository and records its real
file tree — that's all it does on its own. An AI agent then explores the
actual code (using its own tools) and tells CodeBiome what it found by
calling `submit_modules`, `submit_dependencies`, `submit_entry_points`,
`submit_frameworks`, `submit_security_findings`, `submit_code_health`,
`submit_flow`, and `submit_request_journey`. Every reference in every
submission — a file path, a module id — is checked against the real file
tree before it's accepted; a claim about something that doesn't exist is
rejected, not invented around. What's submitted so far is rendered as five
lenses, live, call by call:

| Lens | What it answers |
|---|---|
| **Architecture** | What are the real modules, and how do they and the surrounding infrastructure (databases, caches, queues, external APIs) actually connect? |
| **Onboarding** | Where should a newcomer start, and in what order — a journey the agent proposes and narrates, over real modules only. |
| **Flow** | How does one request travel through the system end to end, hop by hop, with a confidence level on every step — as reconstructed and submitted by the agent. |
| **Health** | A composite score with every contributing vulnerability, weakness, and strength shown — never an opaque number. |
| **Plan** | A proposed feature plan the agent authored while answering a developer's question — rendered as a viewer, visibly not-yet-real. |

CodeBiome itself never claims to understand the codebase — it only verifies
and visualizes. If nothing has been submitted yet, a lens honestly says so
instead of showing a guess.

## Why the architecture is shaped this way

CodeBiome used to run its own 13 regex-based analyzers to build this model
deterministically. That approach was quietly losing to the exact thing it
was trying to help: a capable coding agent already understands code better
than a regex pattern does, and any web-enabled agent can already fetch a
public repo's files on its own — CodeBiome's "grounding" wasn't actually
scarce. What analyzers can't easily replicate — a durable, shareable World
that outlives the conversation, and a live bridge between an agent's
reasoning and a browsable UI — is exactly what CodeBiome now focuses all of
its engineering effort on, instead of splitting attention between that and
maintaining per-language analyzers.

The trade a connected agent makes for CodeBiome is real and specific: a
precomputed, queryable graph (dependency BFS, module importance) instead of
re-deriving one from scratch every conversation, plus a persistent visual
artifact and a live-linked browser experience — not "access to facts it
couldn't otherwise get."

## Connecting an agent

Any MCP client that supports Streamable HTTP can connect to `/api/mcp` — see
[`docs/MCP_CLIENTS.md`](docs/MCP_CLIENTS.md) for exact config for Claude
Desktop, Claude Code, Cursor, Cline, Windsurf, and a generic client, plus a
local stdio option (`npm run mcp:stdio`) for clients that prefer to spawn a
process instead of hitting a URL. Set `MCP_AUTH_TOKEN` before deploying
somewhere the URL might leak — unset, the endpoint is open (fine for local
dev, not for a public deployment with mutating tools).

If you'd rather not connect your own agent, paste a URL into the web UI:
CodeBiome's own built-in demo agent (an LLM tool-use loop calling the exact
same tools any other agent would — see
[`src/server/demo-agent/`](src/server/demo-agent/)) will explore the repo
for you, as long as `GROQ_API_KEY` is set. Without it, the World is
still created with a real file tree — you just need to connect your own
agent to populate it.

IBM Bob was this project's original hackathon integration; the full
historical writeup (including real Bob 2.0 session transcripts) lives in
[`docs/BOB_INTEGRATION.md`](docs/BOB_INTEGRATION.md) and
[`docs/BOB_REMOTE_MCP.md`](docs/BOB_REMOTE_MCP.md).

## Getting started

```bash
npm install
cp .env.example .env.local   # optional: GITHUB_TOKEN, GROQ_API_KEY, MCP_AUTH_TOKEN
npm run dev                  # http://localhost:3000
```

No database and no required environment variables for local development —
CodeBiome falls back to an in-memory/file World store automatically. See
[`docs/WORLD_ARCHITECTURE.md`](docs/WORLD_ARCHITECTURE.md) for the durable
Vercel Blob-backed store used in production.

```bash
npm run test         # vitest
npm run typecheck     # tsc --noEmit
npm run lint
npm run build && npm run start
npm run mcp:stdio     # local stdio MCP transport, for clients that spawn a process
```

## Architecture

```
GitHub URL
  → tarball fetch (codeload.github.com, no git dependency)
  → real file tree recorded (no analysis)
  → an MCP agent explores the code and calls submit_* tools
  → Repository Knowledge Model grows incrementally (Zod-validated, existence-checked)
  → World Model (pure function of the current Knowledge Model)
  → 5 lenses (Architecture / Onboarding / Flow / Health / Plan), updating live
  → MCP server (/api/mcp) — any agent's investigation + submission surface
```

Built for Vercel's Hobby tier: no Postgres, Prisma, or background job
runner. World state persists via Vercel Blob when configured, or an
in-memory/file store otherwise — durable enough that an agent's tool call
and a browser tab always see the same World regardless of which serverless
instance handles each request.

Further reading:
- [`docs/MCP_CLIENTS.md`](docs/MCP_CLIENTS.md) — per-client MCP setup (the front door for connecting any agent)
- [`docs/WORLD_ARCHITECTURE.md`](docs/WORLD_ARCHITECTURE.md) — World storage and MCP↔browser state bridge
- [`docs/REPOSITORY_KNOWLEDGE_MODEL.md`](docs/REPOSITORY_KNOWLEDGE_MODEL.md) — the schema every lens and every tool reads from
- [`docs/VERCEL_DEPLOYMENT.md`](docs/VERCEL_DEPLOYMENT.md) — deployment specifics and constraints
- [`docs/ANALYZER_ARCHITECTURE.md`](docs/ANALYZER_ARCHITECTURE.md) — historical record of the removed analyzer pipeline

## Project structure

```
src/
  app/                Next.js App Router — pages and API routes
  features/
    landing/           Landing page
    scanning/          Live ingestion/agent-progress view
    world/              The five lenses + shared viewer components
  server/
    ingestion/          GitHub tarball fetch + file-tree seeding (seedKnowledgeModel.ts)
    mcp-tools/           All 32 MCP tools, including the 8 submit_* tools
    demo-agent/          CodeBiome's own built-in LLM-driven MCP client
    world/               World Model + durable/in-memory/file store
    agent/               Event bus + session-context bridge to the browser
    plan/                Feature-plan validation
  lib/                 Client-side derived views (domains, health, infra)
  types/               Shared types across server and client
scripts/
  mcp-stdio.ts          Local stdio MCP transport entry point
```

## Tech stack

Next.js 14 (App Router) · React 18 · TypeScript · Zod ·
`@modelcontextprotocol/sdk` · `groq-sdk` (built-in demo agent, free tier) ·
Vitest · Vercel (Hobby tier) + Vercel Blob
