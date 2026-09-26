export interface GitHubRepoMeta {
  defaultBranch: string;
  description: string | null;
  fullName: string;
  headCommitSha: string;
}

function authHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Turns GitHub's rate-limit 403/429 into a message a user can actually act
 *  on, instead of a bare status code — unauthenticated requests are capped
 *  at 60/hour, easy to hit across a few analyses in one demo session. */
async function describeError(res: Response, context: string): Promise<string> {
  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (remaining === "0") {
      const resetHeader = res.headers.get("x-ratelimit-reset");
      const resetAt = resetHeader ? new Date(Number(resetHeader) * 1000).toLocaleTimeString() : null;
      const hint = process.env.GITHUB_TOKEN
        ? ""
        : " Set a GITHUB_TOKEN environment variable to raise this from 60 to 5000 requests/hour.";
      return `GitHub API rate limit exceeded.${resetAt ? ` Resets at ${resetAt}.` : ""}${hint}`;
    }
  }
  return `${context}: ${res.status} ${res.statusText}`;
}

export async function fetchRepoMeta(owner: string, repo: string): Promise<GitHubRepoMeta> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: { Accept: "application/vnd.github+json", ...authHeaders() },
  });
  if (!res.ok) {
    throw new Error(await describeError(res, `GitHub repo lookup failed for ${owner}/${repo}`));
  }
  const json = await res.json();
  const defaultBranch = json.default_branch as string;

  const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${defaultBranch}`, {
    headers: { Accept: "application/vnd.github+json", ...authHeaders() },
  });
  const headCommitSha = commitRes.ok ? ((await commitRes.json()).sha as string) : defaultBranch;

  return {
    defaultBranch,
    description: (json.description as string | null) ?? null,
    fullName: json.full_name as string,
    headCommitSha,
  };
}

/** Tarball download via codeload — avoids a full `git clone` for the common case. */
export async function downloadTarball(owner: string, repo: string, ref: string): Promise<Buffer> {
  const res = await fetch(`https://codeload.github.com/${owner}/${repo}/tar.gz/${ref}`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(await describeError(res, `Failed to download tarball for ${owner}/${repo}@${ref}`));
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
