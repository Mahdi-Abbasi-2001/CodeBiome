export interface ParsedRepoRef {
  owner: string;
  repo: string;
}

/** Accepts full GitHub URLs, git remotes, or bare "owner/repo" shorthand. */
export function parseGitHubUrl(input: string): ParsedRepoRef {
  const trimmed = input.trim().replace(/\.git$/i, "").replace(/\/$/, "");

  const urlMatch = trimmed.match(/github\.com[/:]+([^/]+)\/([^/]+)/i);
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2] };
  }

  const shorthandMatch = trimmed.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (shorthandMatch) {
    return { owner: shorthandMatch[1], repo: shorthandMatch[2] };
  }

  throw new Error(`Could not parse a GitHub owner/repo from "${input}"`);
}
