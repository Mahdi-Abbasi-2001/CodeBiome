export interface SnapshotFile {
  /** Repo-relative, posix-style path. */
  path: string;
  absolutePath: string;
  sizeBytes: number;
  isBinary: boolean;
  /** Returns "" for binary files or files over the read-size cap. */
  readContent: () => Promise<string>;
}

export interface RepositorySnapshot {
  repositoryId: string;
  owner: string;
  repo: string;
  defaultBranch: string;
  commitSha: string;
  fetchedAt: string;
  description: string | null;
  files: SnapshotFile[];
}
