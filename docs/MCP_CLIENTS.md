# Connecting an MCP client to CodeBiome

CodeBiome exposes a standard MCP server (`@modelcontextprotocol/sdk`) at
`/api/mcp`. Nothing about the transport or tool protocol is specific to any
one agent — this doc covers the two ways to connect (remote HTTP, or local
stdio) and gives config for several popular clients. **Verify the exact flag
names/config-file shape against that client's own current documentation
before relying on this** — CLI flags and config formats change between
client versions faster than this doc can track.

## Which mode should I use?

- **Remote HTTP** (`/api/mcp`) — for a deployed CodeBiome instance, or a
  local one you want any client to reach at a URL. Works with every client
  below.
- **Local stdio** (`npm run mcp:stdio`) — for a client that prefers to spawn
  a local process rather than hit a URL. Shares state with a `npm run dev`
  instance on the same machine automatically (both read/write the same local
  World store); point it at the same Blob credentials as a deployed instance
  to share state with that instead.

## Authentication

Unset (local dev default): the endpoint is open — anyone who can reach the
URL can call every tool. Before deploying somewhere the URL might leak, set:

```bash
MCP_AUTH_TOKEN=some-long-random-value
```

Then every client config below needs an `Authorization: Bearer
some-long-random-value` header on its HTTP requests. stdio mode has no
separate auth — it runs as your own local process with your own filesystem
access, same trust boundary as any other local dev tool.

## Remote HTTP config

**Claude Code**
```bash
claude mcp add --transport http codebiome http://localhost:3000/api/mcp \
  --header "Authorization: Bearer <token>"   # omit --header if MCP_AUTH_TOKEN is unset
```

**Claude Desktop** — Settings → Connectors → Add custom connector, URL
`http://localhost:3000/api/mcp` (or your deployed URL), with the
Authorization header added in its custom-headers field if set.

**Cursor** (`.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "codebiome": {
      "url": "http://localhost:3000/api/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

**Cline** (`cline_mcp_settings.json`): same shape as Cursor's above, under
whichever key Cline's current version expects for a remote/HTTP server —
check Cline's own docs, since this has moved between releases.

**Windsurf** (`mcp_config.json`): same `url` + `headers` shape as Cursor's.

**Generic / VS Code Copilot** (`.vscode/mcp.json`):
```json
{
  "servers": {
    "codebiome": {
      "type": "http",
      "url": "http://localhost:3000/api/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

**IBM Bob** (this project's original integration —
[`docs/BOB_INTEGRATION.md`](BOB_INTEGRATION.md) has the full validated
writeup):
```bash
bob mcp add codebiome http://localhost:3000/api/mcp -t http -s global
```

## Local stdio config

Point any stdio-capable client at:

```json
{
  "command": "npm",
  "args": ["run", "mcp:stdio"],
  "cwd": "/absolute/path/to/CodeBiome"
}
```

(Claude Desktop/Code, Cursor, Cline, and Windsurf all accept this same
`command`/`args`/`cwd`/`env` shape for a locally-spawned server — the exact
top-level JSON key differs per client, same caveat as above.)

## Verifying your own setup

```bash
# Confirm the server responds and lists all 32 tools
curl -s -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | python3 -c "import json,sys; print(len(json.load(sys.stdin)['result']['tools']))"

# With MCP_AUTH_TOKEN set, the same call with no header should 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# stdio mode, no running Next.js server required
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | npx tsx scripts/mcp-stdio.ts
```
