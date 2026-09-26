import type { RepositoryKnowledgeModel } from "@/types/knowledge-model";

/**
 * Persistence seam for the Knowledge Model. Implementing this interface
 * against Postgres later (see docs/ARCHITECTURE_DECISIONS.md) requires no
 * change anywhere else — callers only depend on this interface.
 */
export interface KnowledgeModelStore {
  get(repositoryId: string, commitSha: string): Promise<RepositoryKnowledgeModel | null>;
  set(model: RepositoryKnowledgeModel): Promise<void>;
  /** Most recently analyzed model for a repository, regardless of commit — lets a caller that only knows "owner/repo" (e.g. an MCP tool) find it without tracking commit SHAs itself. */
  getLatestByRepositoryId(repositoryId: string): Promise<RepositoryKnowledgeModel | null>;
  /** The single most recently analyzed model across all repositories — the "currently open in CodeBiome" fallback for a Bob tool call that doesn't name a repository at all. */
  getMostRecentlyAnalyzed(): Promise<RepositoryKnowledgeModel | null>;
}

/**
 * In-memory, per-lambda-instance cache. Not durable across cold starts or
 * multiple concurrent instances — acceptable for the hackathon prototype,
 * where it mainly avoids re-analyzing the same repo twice in a demo.
 */
export class InMemoryKnowledgeModelStore implements KnowledgeModelStore {
  private cache = new Map<string, RepositoryKnowledgeModel>();
  private latestByRepositoryId = new Map<string, RepositoryKnowledgeModel>();
  private mostRecent: RepositoryKnowledgeModel | null = null;

  private key(repositoryId: string, commitSha: string): string {
    return `${repositoryId}@${commitSha}`;
  }

  async get(repositoryId: string, commitSha: string): Promise<RepositoryKnowledgeModel | null> {
    return this.cache.get(this.key(repositoryId, commitSha)) ?? null;
  }

  async set(model: RepositoryKnowledgeModel): Promise<void> {
    this.cache.set(this.key(model.meta.repositoryId, model.meta.commitSha), model);
    this.latestByRepositoryId.set(model.meta.repositoryId, model);
    this.mostRecent = model;
  }

  async getLatestByRepositoryId(repositoryId: string): Promise<RepositoryKnowledgeModel | null> {
    return this.latestByRepositoryId.get(repositoryId) ?? null;
  }

  async getMostRecentlyAnalyzed(): Promise<RepositoryKnowledgeModel | null> {
    return this.mostRecent;
  }
}

export const knowledgeModelStore: KnowledgeModelStore = new InMemoryKnowledgeModelStore();
