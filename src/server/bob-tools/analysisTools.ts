import { parseGitHubUrl } from "@/lib/parseGitHubUrl";
import { runAnalysisPipeline } from "@/server/analysis/runAnalysisPipeline";
import { createWorldFromAnalysis } from "@/server/world/createWorldFromAnalysis";
import { InvalidToolArgumentsError } from "./errors";

/**
 * The Bob-first entry point (docs/WORLD_ARCHITECTURE.md) — lets a developer
 * ask Bob to analyze a repository directly, with NO requirement to have
 * opened the CodeBiome web app first. Runs the exact same
 * `runAnalysisPipeline` the browser's manual "paste a GitHub URL" flow uses
 * (src/server/api-handlers/analyze.ts) — one deterministic pipeline, two
 * entry points, never two analysis systems.
 *
 * Every number in the returned `summary` is read directly off the real,
 * just-built RepositoryKnowledgeModel/FlowModel — never invented, per the
 * project's standing AI-grounding rule.
 */

export interface AnalyzeRepositoryResult {
  worldId: string;
  worldUrl: string;
  repository: string;
  commitSha: string;
  summary: {
    modules: number;
    files: number;
    flows: number;
    entryPoints: number;
  };
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

  const result = await runAnalysisPipeline(owner, repo);
  const { world, url } = await createWorldFromAnalysis(owner, repo, result);

  const summary = {
    modules: result.knowledgeModel.modules.length,
    files: result.knowledgeModel.files.length,
    flows: result.flowModel.flows.length,
    entryPoints: result.knowledgeModel.entryPoints.length,
  };

  return {
    worldId: world.id,
    worldUrl: url,
    repository: `${owner}/${repo}`,
    commitSha: result.knowledgeModel.meta.commitSha,
    summary,
    message: `Repository analyzed successfully. I created a CodeBiome world for this repository: ${url}`,
  };
}
