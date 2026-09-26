import { describe, it, expect } from "vitest";
import { csharpDependencyAnalyzer } from "./csharp-dependency-analyzer";
import { fakeSnapshot, runWithStructure, edgesFor } from "@/server/testing/fixtures";

describe("csharp-dependency-analyzer", () => {
  it("resolves a namespace `using` to a matching file (suffix match on <namespace>.cs)", async () => {
    const snapshot = fakeSnapshot({
      "src/App/Program.cs": `using App.Services;`,
      "src/App/Services.cs": `namespace App { class Services {} }`,
    });
    const run = await runWithStructure(snapshot, csharpDependencyAnalyzer);
    const edges = edgesFor(run, "csharp-dependency-analyzer");
    expect(edges).toContainEqual(
      expect.objectContaining({ fromId: "src/App/Program.cs", toId: "src/App/Services.cs" })
    );
  });

  it("does not resolve a System.* namespace", async () => {
    const snapshot = fakeSnapshot({
      "src/App/Program.cs": `using System;\nusing System.Collections.Generic;`,
    });
    const run = await runWithStructure(snapshot, csharpDependencyAnalyzer);
    expect(edgesFor(run, "csharp-dependency-analyzer")).toHaveLength(0);
  });

  it("ignores a commented-out using line", async () => {
    const snapshot = fakeSnapshot({
      "src/App/Program.cs": `// using App.Services;`,
      "src/App/Services.cs": `namespace App { class Services {} }`,
    });
    const run = await runWithStructure(snapshot, csharpDependencyAnalyzer);
    expect(edgesFor(run, "csharp-dependency-analyzer")).toHaveLength(0);
  });
});
