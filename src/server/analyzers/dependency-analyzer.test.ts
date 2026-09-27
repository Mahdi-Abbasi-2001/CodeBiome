import { describe, it, expect } from "vitest";
import { dependencyAnalyzer } from "./dependency-analyzer";
import { fakeSnapshot, runWithStructure, edgesFor } from "@/server/testing/fixtures";

describe("dependency-analyzer (JS/TS)", () => {
  it("resolves a plain relative import with an implicit extension", async () => {
    const snapshot = fakeSnapshot({
      "src/index.ts": `import { helper } from './helper';`,
      "src/helper.ts": `export const helper = () => 1;`,
    });
    const run = await runWithStructure(snapshot, dependencyAnalyzer);
    const edges = edgesFor(run, "dependency-analyzer");
    expect(edges).toContainEqual(expect.objectContaining({ fromId: "src/index.ts", toId: "src/helper.ts" }));
  });

  it("resolves a .js-specifier that actually points at a .ts/.d.ts source (Node16/NodeNext ESM)", async () => {
    const snapshot = fakeSnapshot({
      "types/convert.d.ts": `import type {Options} from './arguments/options.js';`,
      "types/arguments/options.d.ts": `export type Options = {};`,
    });
    const run = await runWithStructure(snapshot, dependencyAnalyzer);
    const edges = edgesFor(run, "dependency-analyzer");
    expect(edges).toContainEqual(
      expect.objectContaining({ fromId: "types/convert.d.ts", toId: "types/arguments/options.d.ts" })
    );
  });

  it("resolves `export ... from` and `export * from` barrel re-exports", async () => {
    const snapshot = fakeSnapshot({
      "src/index.ts": `export * from './core';\nexport { helper } from './helper';`,
      "src/core.ts": `export const core = 1;`,
      "src/helper.ts": `export const helper = () => 1;`,
    });
    const run = await runWithStructure(snapshot, dependencyAnalyzer);
    const edges = edgesFor(run, "dependency-analyzer");
    expect(edges).toContainEqual(expect.objectContaining({ toId: "src/core.ts" }));
    expect(edges).toContainEqual(expect.objectContaining({ toId: "src/helper.ts" }));
  });

  it("does not create an edge for an unrecognized external package import", async () => {
    const snapshot = fakeSnapshot({
      "src/index.ts": `import { z } from 'zod';`,
    });
    const run = await runWithStructure(snapshot, dependencyAnalyzer);
    expect(edgesFor(run, "dependency-analyzer")).toHaveLength(0);
  });

  it("creates a real external-package edge for a known infrastructure/framework import", async () => {
    const snapshot = fakeSnapshot({
      "src/db.ts": `import mysql from 'mysql2';\nimport Redis from 'ioredis';`,
    });
    const run = await runWithStructure(snapshot, dependencyAnalyzer);
    const edges = edgesFor(run, "dependency-analyzer");
    expect(edges).toContainEqual(
      expect.objectContaining({ fromId: "src/db.ts", toId: "mysql2", toKind: "external-package", relationship: "package-dependency" })
    );
    expect(edges).toContainEqual(expect.objectContaining({ fromId: "src/db.ts", toId: "ioredis", toKind: "external-package" }));
  });

  it("strips a subpath and never emits a duplicate edge for the same package imported twice in one file", async () => {
    const snapshot = fakeSnapshot({
      "src/es.ts": `import { Client } from '@elastic/elasticsearch';\nimport type { ApiResponse } from '@elastic/elasticsearch/lib/Transport';`,
    });
    const run = await runWithStructure(snapshot, dependencyAnalyzer);
    const edges = edgesFor(run, "dependency-analyzer").filter((e: { toId: string }) => e.toId === "@elastic/elasticsearch");
    expect(edges).toHaveLength(1);
  });

  it("ignores a commented-out import line", async () => {
    const snapshot = fakeSnapshot({
      "src/index.ts": `// import { helper } from './helper';\nconst x = 1;`,
      "src/helper.ts": `export const helper = () => 1;`,
    });
    const run = await runWithStructure(snapshot, dependencyAnalyzer);
    expect(edgesFor(run, "dependency-analyzer")).toHaveLength(0);
  });

  // Found missing via real-world testing against a real Next.js repository
  // (docs/BOB_INTEGRATION.md): every route handler used `@/lib/...`-style
  // path-aliased imports exclusively, so zero dependency edges were ever
  // found from any entry point and no flow could be reconstructed — despite
  // entry-point detection correctly finding the routes themselves.
  describe("tsconfig.json path aliases (e.g. Next.js's default @/*)", () => {
    it("resolves a wildcard path alias using the project's own tsconfig.json — the exact Next.js default", async () => {
      const snapshot = fakeSnapshot({
        "tsconfig.json": `{"compilerOptions":{"paths":{"@/*":["./src/*"]}}}`,
        "src/app/api/chat/route.ts": `import { chatModel } from "@/lib/ai/provider";`,
        "src/lib/ai/provider.ts": `export const chatModel = {};`,
      });
      const run = await runWithStructure(snapshot, dependencyAnalyzer);
      const edges = edgesFor(run, "dependency-analyzer");
      expect(edges).toContainEqual(
        expect.objectContaining({ fromId: "src/app/api/chat/route.ts", toId: "src/lib/ai/provider.ts", confidence: 1 })
      );
    });

    it("resolves an exact (non-wildcard) path alias", async () => {
      const snapshot = fakeSnapshot({
        "tsconfig.json": `{"compilerOptions":{"paths":{"@config":["./src/config.ts"]}}}`,
        "src/index.ts": `import { config } from "@config";`,
        "src/config.ts": `export const config = {};`,
      });
      const run = await runWithStructure(snapshot, dependencyAnalyzer);
      expect(edgesFor(run, "dependency-analyzer")).toContainEqual(expect.objectContaining({ toId: "src/config.ts" }));
    });

    it("respects an explicit baseUrl combined with paths", async () => {
      const snapshot = fakeSnapshot({
        "tsconfig.json": `{"compilerOptions":{"baseUrl":"src","paths":{"@/*":["./*"]}}}`,
        "src/index.ts": `import { helper } from "@/helper";`,
        "src/helper.ts": `export const helper = 1;`,
      });
      const run = await runWithStructure(snapshot, dependencyAnalyzer);
      expect(edgesFor(run, "dependency-analyzer")).toContainEqual(expect.objectContaining({ toId: "src/helper.ts" }));
    });

    it("tolerates JSONC comments and trailing commas in tsconfig.json — real-world tsconfig files use both", async () => {
      const snapshot = fakeSnapshot({
        "tsconfig.json": `{\n  // path aliases\n  "compilerOptions": {\n    "paths": {\n      "@/*": ["./src/*"],\n    },\n  },\n}`,
        "src/index.ts": `import { helper } from "@/helper";`,
        "src/helper.ts": `export const helper = 1;`,
      });
      const run = await runWithStructure(snapshot, dependencyAnalyzer);
      expect(edgesFor(run, "dependency-analyzer")).toContainEqual(expect.objectContaining({ toId: "src/helper.ts" }));
    });

    it("never invents a resolution when there is no tsconfig.json — an aliased import stays an unresolved external, same as before this fix", async () => {
      const snapshot = fakeSnapshot({
        "src/index.ts": `import { helper } from "@/helper";`,
        "src/helper.ts": `export const helper = 1;`,
      });
      const run = await runWithStructure(snapshot, dependencyAnalyzer);
      expect(edgesFor(run, "dependency-analyzer")).toHaveLength(0);
    });

    it("correctly parses a tsconfig.json whose OTHER fields contain glob strings that a naive block-comment stripper would misread — the exact real-world shape that broke this the first time", async () => {
      // "@/*" contains a literal `/*`, and the `include` array's `"**/*.ts"`
      // supplies an incidental `*/` far later in the file. A regex-based
      // block-comment stripper with no concept of string literals (like
      // stripCLikeComments, used for actual source scanning) would read the
      // first as a comment-open and the second as its close, deleting the
      // entire `paths` block in between. This is verbatim the real
      // liara-docs-assistant tsconfig.json shape found via live testing.
      const snapshot = fakeSnapshot({
        "tsconfig.json": JSON.stringify(
          {
            compilerOptions: {
              lib: ["dom", "dom.iterable", "esnext"],
              paths: { "@/*": ["./src/*"] },
            },
            include: ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
            exclude: ["node_modules"],
          },
          null,
          2
        ),
        "src/app/api/chat/route.ts": `import { chatModel } from "@/lib/ai/provider";`,
        "src/lib/ai/provider.ts": `export const chatModel = {};`,
      });
      const run = await runWithStructure(snapshot, dependencyAnalyzer);
      expect(edgesFor(run, "dependency-analyzer")).toContainEqual(
        expect.objectContaining({ fromId: "src/app/api/chat/route.ts", toId: "src/lib/ai/provider.ts" })
      );
    });

    it("never invents a resolution for an alias pattern that isn't actually configured", async () => {
      const snapshot = fakeSnapshot({
        "tsconfig.json": `{"compilerOptions":{"paths":{"@ui/*":["./src/components/*"]}}}`,
        "src/index.ts": `import { helper } from "@/helper";`,
        "src/helper.ts": `export const helper = 1;`,
      });
      const run = await runWithStructure(snapshot, dependencyAnalyzer);
      expect(edgesFor(run, "dependency-analyzer")).toHaveLength(0);
    });
  });
});
