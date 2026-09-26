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
