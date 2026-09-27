import { mkdtemp, writeFile, rm, mkdir, readdir, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as tar from "tar";
import { fetchRepoMeta, downloadTarball, type GitHubRepoMeta } from "./githubClient";
import type { RepositorySnapshot, SnapshotFile } from "./types";

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "out",
  "vendor",
  ".cache",
  "coverage",
  ".turbo",
]);

const BINARY_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "ico",
  "webp",
  "bmp",
  "mp4",
  "mov",
  "avi",
  "zip",
  "gz",
  "tar",
  "pdf",
  "woff",
  "woff2",
  "ttf",
  "eot",
  "otf",
  "exe",
  "dll",
  "so",
  "dylib",
  "class",
  "jar",
  "wasm",
  "bin",
]);

// No cap on how many files get walked — a repository's full file list is
// wanted, not a truncated sample. The remaining real constraint is Vercel's
// serverless function duration (`maxDuration` on the Hobby plan this
// project runs on, src/app/api/bridge/[target]/route.ts): an exceptionally
// large repository can still time out mid-analysis, but that's an honest
// failure (visible in the response) rather than a silent, undisclosed
// truncation. MAX_READABLE_BYTES stays — it protects against reading one
// pathological giant file (a committed bundle, a data dump) into memory,
// which is an unrelated concern from how many files the repo has.
const MAX_READABLE_BYTES = 200_000;

export interface SnapshotBuildResult {
  snapshot: RepositorySnapshot;
  /** Must be called (in a `finally`) once analysis has finished reading files. */
  cleanup: () => Promise<void>;
}

/**
 * `meta` can be passed in when the caller already fetched it (e.g. to check
 * the knowledge-model cache by commit SHA *before* paying for the tarball
 * download+extract below — see route.ts) so it isn't fetched twice.
 */
export async function buildRepositorySnapshot(
  owner: string,
  repo: string,
  meta?: GitHubRepoMeta
): Promise<SnapshotBuildResult> {
  const repoMeta = meta ?? (await fetchRepoMeta(owner, repo));
  const tarball = await downloadTarball(owner, repo, repoMeta.headCommitSha);

  const workDir = await mkdtemp(path.join(tmpdir(), "codebiome-"));
  const tarPath = path.join(workDir, "repo.tar.gz");
  await writeFile(tarPath, tarball);

  const extractDir = path.join(workDir, "extracted");
  await mkdir(extractDir, { recursive: true });
  // GitHub tarballs wrap everything in a single "<repo>-<ref>/" directory; strip it.
  await tar.x({ file: tarPath, cwd: extractDir, strip: 1 });

  const files: SnapshotFile[] = [];

  const queue: { dir: string; relativeBase: string }[] = [{ dir: extractDir, relativeBase: "" }];

  while (queue.length > 0) {
    const { dir, relativeBase } = queue.shift()!;
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        queue.push({ dir: path.join(dir, entry.name), relativeBase: path.posix.join(relativeBase, entry.name) });
        continue;
      }
      // A tracked symlink (e.g. a monorepo package's `.env` symlinked to a
      // root `.env` that's gitignored and so never actually committed)
      // extracts as a real symlink `tar.x` writes back out as-is. Neither
      // `isDirectory()` nor `isFile()` is true for it, so without this
      // check it falls into the "regular file" branch below, and `stat`
      // (which follows the link) throws ENOENT for a target that was never
      // part of the repository's real content — not a file this analysis
      // can honestly represent either way, so it's skipped, not followed.
      if (entry.isSymbolicLink() || !entry.isFile()) continue;

      const absolutePath = path.join(dir, entry.name);
      const relativePath = path.posix.join(relativeBase, entry.name);
      const ext = entry.name.includes(".") ? entry.name.split(".").pop()!.toLowerCase() : "";
      const isBinary = BINARY_EXTENSIONS.has(ext);
      let fileStat;
      try {
        fileStat = await stat(absolutePath);
      } catch {
        // Broken symlink, a file removed mid-walk, a permissions quirk in
        // the extracted tarball — none of these should abort analysis of
        // the other 599 files. Skip this one file instead.
        continue;
      }

      // Memoized: structure-analyzer reads every source/test/doc/config
      // file for line counts, and then whichever single language-specific
      // dependency analyzer matches this file reads it again for its import
      // scan (as of this fix, the security analyzer reads it a third time
      // too) — without caching, that's 2-3x redundant disk reads per file
      // on every analysis. The read only actually happens once; every
      // subsequent call returns the same cached string.
      let contentPromise: Promise<string> | null = null;

      files.push({
        path: relativePath,
        absolutePath,
        sizeBytes: fileStat.size,
        isBinary,
        readContent: () => {
          if (isBinary || fileStat.size > MAX_READABLE_BYTES) return Promise.resolve("");
          if (!contentPromise) contentPromise = readFile(absolutePath, "utf8");
          return contentPromise;
        },
      });
    }
  }

  const snapshot: RepositorySnapshot = {
    repositoryId: `${owner}/${repo}`,
    owner,
    repo,
    defaultBranch: repoMeta.defaultBranch,
    commitSha: repoMeta.headCommitSha,
    fetchedAt: new Date().toISOString(),
    description: repoMeta.description,
    files,
  };

  return {
    snapshot,
    cleanup: async () => {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}
