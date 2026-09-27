import { parseGitHubUrl } from "@/lib/parseGitHubUrl";
import { buildRepositorySnapshot } from "@/server/ingestion/snapshotBuilder";
import { seedKnowledgeModel } from "@/server/ingestion/seedKnowledgeModel";
import { createWorldFromAnalysis } from "@/server/world/createWorldFromAnalysis";
import { InvalidToolArgumentsError } from "./errors";

/**
 * The agent-first entry point (docs/WORLD_ARCHITECTURE.md) — lets a
 * developer ask their agent to start analyzing a repository directly, with
 * no requirement to have opened the CodeBiome web app first.
 *
 * Unlike the old analyzer pipeline this used to call, this does NOT run any
 * dependency/entry-point/security analysis — it only fetches the repository
 * and records its real file tree (see src/server/ingestion/
 * seedKnowledgeModel.ts). Everything beyond the file list (modules,
 * dependencies, entry points, frameworks, security findings, code health,
 * flows) is populated afterward by the SAME connected agent calling the
 * submit_* tools once it has actually looked at the code — CodeBiome
 * verifies every reference against this file tree but does not try to
 * out-analyze the agent itself.
 */

export interface AnalyzeRepositoryResult {
  worldId: string;
  worldUrl: string;
  repository: string;
  commitSha: string;
  fileCount: number;
  topLevelEntries: string[];
  message: string;
}

export async function analyzeRepository(args: { repositoryUrl: string }): Promise<AnalyzeRepositoryResult> {
  if (!args.repositoryUrl || !args.repositoryUrl.trim()) {
    throw new InvalidToolArgumentsError("repositoryUrl must not be empty — pass a GitHub URL, e.g. https://github.com/owner/repo.");
  }

  let owner: string;
  let repo: string;
  try {
    ({ owner, repo } = parseGitHubUrl(args.repositoryUrl));
  } catch {
    throw new InvalidToolArgumentsError(
      `Could not parse a GitHub owner/repo from "${args.repositoryUrl}". Expected a URL like https://github.com/owner/repo.`
    );
  }

  const { snapshot, cleanup } = await buildRepositorySnapshot(owner, repo);
  let knowledgeModel;
  try {
    knowledgeModel = await seedKnowledgeModel(snapshot);
  } finally {
    await cleanup();
  }

  const { world, url } = await createWorldFromAnalysis(owner, repo, knowledgeModel);

  const topLevelEntries = [...new Set(knowledgeModel.files.map((f) => f.path.split("/")[0]))].sort().slice(0, 25);

  return {
    worldId: world.id,
    worldUrl: url,
    repository: `${owner}/${repo}`,
    commitSha: knowledgeModel.meta.commitSha,
    fileCount: knowledgeModel.files.length,
    topLevelEntries,
    message:
      `Fetched ${owner}/${repo} (${knowledgeModel.files.length} files). No architecture has been submitted yet — ` +
      `explore the repository yourself (get_file, search_repository) and call submit_modules/submit_dependencies/` +
      `submit_entry_points/submit_frameworks/submit_security_findings/submit_code_health/submit_flow/submit_request_journey ` +
      `as you find real structure, using worldId "${world.id}" in every call. The World at ${url} updates live as you do.`,
  };
}
