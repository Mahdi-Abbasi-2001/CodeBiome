import { NextRequest, NextResponse } from "next/server";

/**
 * Optional bearer-token gate for the MCP endpoint only. When `MCP_AUTH_TOKEN`
 * is unset (the local-dev default), this is a no-op — CodeBiome stays
 * zero-config locally, same as every other env-gated feature in this
 * project. Set it before deploying somewhere the URL might leak, since
 * without it anyone with the URL can call every tool, including mutating
 * ones (submit_*, contribute_domain_concept, analyze_repository).
 *
 * Deliberately all-or-nothing (not tiered read/write tokens) — this is not
 * enterprise multi-tenant auth, just "don't leave a write-capable endpoint
 * fully open on the public internet."
 */
export function checkMcpAuth(req: NextRequest): Response | null {
  const token = process.env.MCP_AUTH_TOKEN;
  if (!token) return null;

  const header = req.headers.get("authorization") ?? "";
  const [scheme, value] = header.split(" ");
  if (scheme?.toLowerCase() === "bearer" && value === token) return null;

  return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
}
