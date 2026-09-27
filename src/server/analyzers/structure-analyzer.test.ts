import { describe, it, expect } from "vitest";
import { structureAnalyzer, type StructureAnalyzerOutput } from "./structure-analyzer";
import { AnalyzerRegistry } from "./registry";
import { runAnalyzers } from "./runner";
import { fakeSnapshot } from "@/server/testing/fixtures";

async function run(files: Record<string, string>): Promise<StructureAnalyzerOutput> {
  const registry = new AnalyzerRegistry();
  registry.register(structureAnalyzer);
  const summary = await runAnalyzers(fakeSnapshot(files), registry);
  return summary.results.get("structure-analyzer")!.data as StructureAnalyzerOutput;
}

describe("structure-analyzer module grouping", () => {
  it("splits a top-level directory with 2+ distinct child directories", async () => {
    const output = await run({
      "core/wren/src/lib.rs": "",
      "core/wren-core/src/lib.rs": "",
      "core/wren-core-base/src/lib.rs": "",
    });
    const moduleIds = output.modules.map((m) => m.id);
    expect(moduleIds).toContain("core/wren");
    expect(moduleIds).toContain("core/wren-core");
    expect(moduleIds).toContain("core/wren-core-base");
    expect(moduleIds).not.toContain("core");
  });

  it("does NOT split a top-level directory with only one child directory", async () => {
    const output = await run({
      "lib/onlyThing/a.ts": "",
      "lib/onlyThing/b.ts": "",
    });
    const moduleIds = output.modules.map((m) => m.id);
    expect(moduleIds).toContain("lib");
    expect(moduleIds).not.toContain("lib/onlyThing");
  });

  it("never splits a docs/tests/examples directory even with many subdirectories", async () => {
    const output = await run({
      "docs/api/index.md": "",
      "docs/guides/getting-started.md": "",
      "docs/tutorials/basics.md": "",
    });
    const moduleIds = output.modules.map((m) => m.id);
    expect(moduleIds).toContain("docs");
    expect(moduleIds).not.toContain("docs/api");
    expect(moduleIds).not.toContain("docs/guides");
  });

  it("groups a single top-level file with no directory into 'root'", async () => {
    const output = await run({ "README.md": "" });
    expect(output.modules.map((m) => m.id)).toContain("root");
  });
});

describe("structure-analyzer file classification", () => {
  it("classifies a file under a REPO-ROOT tests/ directory as a test file (regression: a leading-slash substring check missed this)", async () => {
    const output = await run({ "tests/e2e/login.shared.ts": "" });
    const file = output.files.find((f) => f.path === "tests/e2e/login.shared.ts")!;
    expect(file.type).toBe("test");
    expect(file.isTestFile).toBe(true);
  });

  it("classifies a file under a nested tests/ directory as a test file", async () => {
    const output = await run({ "packages/api/tests/handler.ts": "" });
    const file = output.files.find((f) => f.path === "packages/api/tests/handler.ts")!;
    expect(file.type).toBe("test");
  });

  it("classifies a *.test.mjs file as a test file (regression: the extension allowlist missed mjs/cjs)", async () => {
    const output = await run({ "scripts/smoke.test.mjs": "" });
    const file = output.files.find((f) => f.path === "scripts/smoke.test.mjs")!;
    expect(file.type).toBe("test");
  });

  it("does not misclassify an ordinary directory that merely contains the substring 'test'", async () => {
    const output = await run({ "src/latest/feature.ts": "" });
    const file = output.files.find((f) => f.path === "src/latest/feature.ts")!;
    expect(file.type).toBe("source");
  });
});
