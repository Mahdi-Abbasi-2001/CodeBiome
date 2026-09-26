import { NextRequest, NextResponse } from "next/server";
import { fetchFileContent } from "@/server/ingestion/fileContent";

// Deliberately NOT part of the analysis pipeline: the repository snapshot is
// deleted once analysis finishes (see snapshotBuilder.ts), so the
// investigation panel's Code tab re-fetches one file's raw content on demand
// when a user opens it, instead of shipping every file's source in the
// initial analyze payload. Keeps the first-load payload small (Step 15) and
// shows genuinely real code (never fabricated) without adding a database.
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const owner = searchParams.get("owner");
  const repo = searchParams.get("repo");
  const ref = searchParams.get("ref");
  const path = searchParams.get("path");

  if (!owner || !repo || !ref || !path) {
    return NextResponse.json({ error: "owner, repo, ref and path are all required" }, { status: 400 });
  }

  const result = await fetchFileContent(owner, repo, ref, path);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ path: result.path, content: result.content, truncated: result.truncated });
}
