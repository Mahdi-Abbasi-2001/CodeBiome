import { NextRequest, NextResponse } from "next/server";
import { handleMcp } from "@/server/api-handlers/mcp";
import { handleAnalyze } from "@/server/api-handlers/analyze";
import { handleDemoAgentStep } from "@/server/api-handlers/demoAgent";
import { handleSessionContext } from "@/server/api-handlers/sessionContext";
import { handleAgentEvents } from "@/server/api-handlers/agentEvents";
import { checkMcpAuth } from "@/server/api-handlers/mcpAuth";

/**
 * The single Vercel Function backing `/api/mcp`, `/api/analyze`, `/api/demo-agent`,
 * `/api/session-context`, and `/api/agent-events` — see
 * `docs/VERCEL_DEPLOYMENT.md` for the full writeup of WHY these four must
 * be one function (Vercel isolates by file; these four exist only to
 * read/write shared in-memory state with each other — RKM, session
 * context, the agent event bus). External URLs are unchanged:
 * `next.config.mjs` `rewrites()` maps each public path onto
 * `/api/bridge/<target>` internally, and this dynamic segment reads
 * `params.target` to know which logical endpoint was actually requested.
 *
 * Deliberately a PATH segment (`[target]`), not a `?target=` query
 * parameter appended by the rewrite destination — an earlier version of
 * this file used a query-string destination
 * (`/api/bridge?target=mcp`), which worked against the real Vercel
 * deployment but was found, empirically, to NOT reliably propagate under
 * `next start` (the destination's own added query params did not appear in
 * the invoked handler's `req.nextUrl.searchParams` — a known fragile corner
 * of Next.js rewrite query-merging). A path segment is core, well-tested
 * Next.js routing instead of that edge case, and the ORIGINAL request's own
 * query string (e.g. `/api/agent-events?worldId=...`) is still forwarded
 * automatically by `rewrites()` regardless — confirmed for both `next
 * start` and the real Vercel deployment.
 *
 * This is a plain, non-dynamic-at-the-top-level literal route family. A
 * `[...catchall]` dynamic route was tried first for the original
 * consolidation and also worked, but during deployment investigation this
 * project hit a real Next.js 14.2.35 output-file-tracing defect where ONE
 * Node.js-runtime API route per build gets a corrupted trace listing
 * nonexistent build artifacts (`export-detail.json`, `export/404.html`/
 * `500.html`, webpack cache `.pack` files) — confirmed, via a full local
 * repro sweep, to affect whichever route the trace lands on regardless of
 * routing topology. The actual fix is `next.config.mjs`'s
 * `experimental.outputFileTracingExcludes` — Next.js's own official
 * mechanism for correcting an over-inclusive trace, applied globally — so a
 * dynamic segment here (`[target]`) is safe. See docs/VERCEL_DEPLOYMENT.md
 * for the full investigation.
 */
export const runtime = "nodejs";
// Vercel reports a 300-second function timeout for the current production
// deployment. Keep large-repository tarball extraction inside that budget;
// agent turns still run in separate requests.
export const maxDuration = 300;

function notFound(): Response {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

function methodNotAllowed(): Response {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}

type RouteParams = { params: { target: string } };

export async function GET(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const { target } = params;
  if (target === "mcp") return checkMcpAuth(req) ?? handleMcp(req);
  if (target === "agent-events") return handleAgentEvents(req);
  if (target === "analyze" || target === "session-context") return methodNotAllowed();
  if (target === "demo-agent") return methodNotAllowed();
  return notFound();
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const { target } = params;
  if (target === "mcp") return checkMcpAuth(req) ?? handleMcp(req);
  if (target === "analyze") return handleAnalyze(req);
  if (target === "demo-agent") return handleDemoAgentStep(req);
  if (target === "session-context") return handleSessionContext(req);
  if (target === "agent-events") return methodNotAllowed();
  return notFound();
}

export async function DELETE(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const { target } = params;
  if (target === "mcp") return checkMcpAuth(req) ?? handleMcp(req);
  return notFound();
}
