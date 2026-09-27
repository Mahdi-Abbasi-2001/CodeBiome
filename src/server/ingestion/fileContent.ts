// Shared by /api/file (Investigation Panel's Code tab) and the agent-facing
// `get_file` MCP tool (src/server/bob-tools/repositoryTools.ts) — one real
// GitHub fetch path, not two. See /api/file/route.ts for why this fetches
// on demand instead of shipping every file's source in the analyze payload.

const MAX_CONTENT_BYTES = 60_000;

function authHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export type FileContentResult =
  | { ok: true; path: string; content: string; truncated: boolean }
  | { ok: false; path: string; error: string; status: 404 | 502 };

export async function fetchFileContent(
  owner: string,
  repo: string,
  ref: string,
  path: string
): Promise<FileContentResult> {
  const url = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(ref)}/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;

  try {
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) {
      return { ok: false, path, error: `Could not fetch ${path}: ${res.status}`, status: 404 };
    }
    const full = await res.text();
    const truncated = full.length > MAX_CONTENT_BYTES;
    return { ok: true, path, content: truncated ? full.slice(0, MAX_CONTENT_BYTES) : full, truncated };
  } catch (error) {
    return { ok: false, path, error: error instanceof Error ? error.message : "Failed to fetch file content", status: 502 };
  }
}
