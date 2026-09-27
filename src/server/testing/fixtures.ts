import type { RepositorySnapshot, SnapshotFile } from "@/server/ingestion/types";

/** Builds a fake RepositorySnapshot from a plain path->content map — no disk,
 *  no network, no tarball. Used by every test that needs a repository. */
export function fakeSnapshot(files: Record<string, string>, repoId: { owner: string; repo: string } = { owner: "test", repo: "repo" }): RepositorySnapshot {
  const snapshotFiles: SnapshotFile[] = Object.entries(files).map(([filePath, content]) => ({
    path: filePath,
    absolutePath: `/fake/${filePath}`,
    sizeBytes: Buffer.byteLength(content, "utf8"),
    isBinary: false,
    readContent: async () => content,
  }));

  return {
    repositoryId: `${repoId.owner}/${repoId.repo}`,
    owner: repoId.owner,
    repo: repoId.repo,
    defaultBranch: "main",
    commitSha: "0".repeat(40),
    fetchedAt: new Date().toISOString(),
    description: null,
    files: snapshotFiles,
  };
}
