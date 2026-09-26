import { AnalyzerRegistry } from "@/server/analyzers/registry";
import { runAnalyzers } from "@/server/analyzers/runner";
import { structureAnalyzer } from "@/server/analyzers/structure-analyzer";
import { dependencyAnalyzer } from "@/server/analyzers/dependency-analyzer";
import { entryPointAnalyzer } from "@/server/analyzers/entry-point-analyzer";
import { buildKnowledgeModel } from "@/server/knowledge-model/builder";
import type { RepositoryKnowledgeModel } from "@/types/knowledge-model";
import { fakeSnapshot } from "./fixtures";

/**
 * Builds a full, real RepositoryKnowledgeModel (structure + dependency +
 * entry-point analysis, then the same builder /api/analyze uses) from an
 * in-memory file map — no network, no tarball. Used by the bob-tools test
 * suite, which needs entry points and dependency edges (not just structure)
 * to exercise flow/dependency/world-action tools meaningfully.
 */
export async function buildTestKnowledgeModel(
  files: Record<string, string>,
  repoId: { owner: string; repo: string } = { owner: "test", repo: "repo" }
): Promise<RepositoryKnowledgeModel> {
  const snapshot = { ...fakeSnapshot(files), owner: repoId.owner, repo: repoId.repo, repositoryId: `${repoId.owner}/${repoId.repo}` };

  const registry = new AnalyzerRegistry();
  registry.register(structureAnalyzer);
  registry.register(dependencyAnalyzer);
  registry.register(entryPointAnalyzer);
  const runSummary = await runAnalyzers(snapshot, registry);

  return buildKnowledgeModel(snapshot, runSummary);
}
