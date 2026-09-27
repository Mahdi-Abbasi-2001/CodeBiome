import { describe, it, expect, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, symlink, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as tar from "tar";

vi.mock("./githubClient", () => ({
  fetchRepoMeta: vi.fn(),
  downloadTarball: vi.fn(),
}));

import { fetchRepoMeta, downloadTarball } from "./githubClient";
import { buildRepositorySnapshot } from "./snapshotBuilder";

describe("buildRepositorySnapshot", () => {
  it("skips a tracked symlink whose target was never committed instead of crashing the whole walk (regression: cal.com's packages/prisma/.env)", async () => {
    const srcDir = await mkdtemp(path.join(tmpdir(), "codebiome-test-src-"));
    try {
      const repoDir = path.join(srcDir, "demo-repo-main");
      await mkdir(path.join(repoDir, "packages", "prisma"), { recursive: true });
      await writeFile(path.join(repoDir, "index.ts"), "export const x = 1;\n");
      await writeFile(path.join(repoDir, "packages", "prisma", "schema.prisma"), "// schema\n");
      // A tracked symlink whose target is gitignored and so was never
      // actually committed — the exact shape of cal.com's real repo.
      await symlink("../../.env", path.join(repoDir, "packages", "prisma", ".env"));

      const tarPath = path.join(srcDir, "repo.tar.gz");
      await tar.c({ gzip: true, file: tarPath, cwd: srcDir }, ["demo-repo-main"]);
      const tarball = await readFile(tarPath);

      vi.mocked(fetchRepoMeta).mockResolvedValue({
        defaultBranch: "main",
        description: null,
        fullName: "demo/repo",
        headCommitSha: "abc123",
      });
      vi.mocked(downloadTarball).mockResolvedValue(tarball);

      const { snapshot, cleanup } = await buildRepositorySnapshot("demo", "repo");
      try {
        expect(snapshot.files.map((f) => f.path).sort()).toEqual(["index.ts", "packages/prisma/schema.prisma"]);
      } finally {
        await cleanup();
      }
    } finally {
      await rm(srcDir, { recursive: true, force: true });
    }
  });
});
