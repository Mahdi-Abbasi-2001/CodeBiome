# Connecting IBM Bob IDE to a Remote CodeBiome MCP Server

> **Historical record.** Written for connecting a local IBM Bob install to a deployed CodeBiome instance. See [`docs/MCP_CLIENTS.md`](./MCP_CLIENTS.md) for current, client-agnostic setup (any MCP client, plus the `MCP_AUTH_TOKEN` auth option this document predates). Kept for historical reference.

This document is the remote-deployment counterpart to
[`BOB_INTEGRATION.md` §13](./BOB_INTEGRATION.md#13-local-development--setup),
which covers pointing Bob at a `localhost` CodeBiome instance. Everything
about the MCP integration itself — the 22 tools, the hard invariant that
Bob can never invent a repository entity, the event bridge to the browser —
is unchanged; only the URL changes.

**Bob no longer needs the developer to open the CodeBiome web app first.**
See [`WORLD_ARCHITECTURE.md`](./WORLD_ARCHITECTURE.md) — a developer can
ask Bob to analyze a repository directly (`analyze_repository`), and Bob
hands back a real, durable World URL to open. The remote-connection steps
below are unchanged either way.

## 0. What actually changes, and what doesn't

- **Transport**: unchanged. `/api/mcp` already implements Streamable HTTP
  (`WebStandardStreamableHTTPServerTransport`, stateless mode) — the same
  transport whether it's served from `localhost:3000` or a deployed Vercel
  URL. See `docs/VERCEL_DEPLOYMENT.md` §"MCP transport" for the verification
  detail.
- **Config schema**: unchanged from what was empirically verified against a
  real Bob Shell 2.0.4 session in `BOB_INTEGRATION.md` §10.1 — only the
  `url` value changes from `http://localhost:3000/api/mcp` to
  `https://YOUR-DEPLOYMENT-DOMAIN/api/mcp`. Bob Shell's own `bob mcp add`
  command writes the exact same JSON shape regardless of whether the URL is
  local or remote; there is no separate "remote" config format.
- **Credentials**: still none required for CodeBiome's side. The MCP server
  has no auth of its own (see `BOB_INTEGRATION.md` §8) — this is a hackathon
  posture (anyone with the URL can call the tools), documented as a
  limitation in `VERCEL_DEPLOYMENT.md`, not silently glossed over.

## 1. The verified config shape (Bob Shell)

This is `bob mcp add`'s own output schema, empirically confirmed in
`BOB_INTEGRATION.md` §10.1 against a real install of Bob Shell 2.0.4 — not
guessed from IBM's docs. It is reproduced here with placeholders instead of
hardcoding a guess at a "remote" variant:

```bash
bob mcp add codebiome https://YOUR-DEPLOYMENT-DOMAIN.vercel.app/api/mcp -t http -s global
```

Which writes to `~/.bob/settings/mcp.json`:

```json
{
  "mcpServers": {
    "codebiome": {
      "url": "https://YOUR-DEPLOYMENT-DOMAIN.vercel.app/api/mcp",
      "transportType": "http"
    }
  }
}
```

Verify with `bob mcp list` — it should show:
```
codebiome: https://YOUR-DEPLOYMENT-DOMAIN.vercel.app/api/mcp | enabled | http | global
```

**On the task brief's suggested schema** (`{"type": "streamable-http", "url": "..."}`):
that field name/value do not match what this project's own testing observed
Bob Shell actually write (`transportType`/`http`, not `type`/`streamable-http`)
— see `BOB_INTEGRATION.md` §10.1 for the exact same caution the first time
this was investigated. The IDE plugin's own settings UI may use different
field names internally than the CLI's config file; if you're configuring
through the IDE's UI rather than hand-editing `mcp.json`, use whatever field
the UI itself exposes for "server URL" and "transport: HTTP/Streamable
HTTP" — the important, verified fact is the *transport itself*
(Streamable HTTP, not stdio, not legacy SSE), not a specific JSON key name
that varies by which Bob surface you're configuring through.

## 2. Hand-editing `~/.bob/settings/mcp.json` directly

Also works, per the same file `bob mcp add` writes — useful if you're
scripting a demo setup or don't have interactive `bob` CLI access on the
machine running Bob:

```json
{
  "mcpServers": {
    "codebiome": {
      "url": "https://YOUR-DEPLOYMENT-DOMAIN.vercel.app/api/mcp",
      "transportType": "http"
    }
  }
}
```

## 3. Verifying the connection

```bash
bob mcp list
```
should show `codebiome` as `enabled`. Then ask Bob something that forces a
tool call:

```bash
bob run --accept-license --trust "Use the codebiome MCP server to get a repository overview of whatever repository is currently analyzed."
```

If nothing has been analyzed yet at the deployed URL, `get_repository_overview`
returns the same honest `RepositoryNotAnalyzedError` message it always does
locally — open the deployed CodeBiome UI first and analyze a repository,
exactly as the local workflow requires (see `BOB_INTEGRATION.md` §6).

## 4. Local `curl`-level protocol verification (before involving Bob at all)

The same three checks used to validate `/api/mcp` during local development
(`BOB_INTEGRATION.md`'s original protocol-layer pass, before real Bob
testing) apply unchanged against the deployed URL — replace `localhost:3000`
with your deployment domain:

```bash
# 1. Initialize
curl -s -X POST https://YOUR-DEPLOYMENT-DOMAIN.vercel.app/api/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl-test","version":"1.0"}}}'

# 2. Tool discovery — should list all 22 tools
curl -s -X POST https://YOUR-DEPLOYMENT-DOMAIN.vercel.app/api/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# 3. A real tool call
curl -s -X POST https://YOUR-DEPLOYMENT-DOMAIN.vercel.app/api/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_repository_overview","arguments":{}}}'
```

A 200 response with real JSON-RPC content on all three (not merely an HTTP
200 on a root health-check page) is what "real MCP protocol behavior"
means here — see `docs/VERCEL_DEPLOYMENT.md`'s testing checklist for the
full pass this project actually ran.

## 5. What was actually validated

Documented honestly, per this project's standing rule (never claim a
validation that didn't happen — see `BOB_INTEGRATION.md` §11-§14).

**Current status (World architecture, docs/WORLD_ARCHITECTURE.md)**: the
cross-instance state loss described in an earlier version of this section
is fixed — World data now lives in Vercel Blob, not in-memory, so it
survives a request landing on a fresh serverless instance. Re-validated for
real against the live deployment after that fix:

- A live IBM Bob Shell 2.0.4 session, connected ONLY to
  `codebiome-remote` (`https://codebiome.vercel.app/api/mcp`) — the local
  `codebiome` server was removed from `~/.bob/settings/mcp.json` for the
  duration of this run so there was no possibility of it silently using a
  local server instead. No repository was pre-analyzed in the browser
  beforehand. Prompted with: "Analyze
  https://github.com/lujakob/nestjs-realworld-example-app and then create
  an onboarding journey for a new developer to understand how user
  authentication works in this project."
- Bob called `analyze_repository` first — no browser interaction required
  to start — got back a real `worldId` and `worldUrl`, then threaded that
  `worldId` through every subsequent call: `get_repository_overview`,
  `list_flows`, `get_flow`, `get_module` (x2), `get_file` (x6, reading the
  actual `src/user` auth files), `list_onboarding_journeys` and
  `list_domain_concepts` (checked for existing entries before contributing,
  per the AI-grounding discipline), then `create_onboarding_journey` —
  which **succeeded**, unlike the pre-World-architecture run this section
  used to describe. Bob's final answer cited the real World URL and a
  6-step journey grounded entirely in real file paths and file contents.
- Separately, live browser reaction was also validated against the real
  deployment: with a World's page already open in a browser tab, an
  `open_module` MCP call made via a completely separate HTTP request (no
  shared browser session) caused that already-open tab to update within
  the ~1.5s poll interval — 3D camera focus, module detail panel, and the
  live activity log — without a page reload. This closes the gap the
  previous version of this section flagged as "not part of this validation
  pass."
