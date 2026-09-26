import { describe, it, expect } from "vitest";
import { goDependencyAnalyzer } from "./go-dependency-analyzer";
import { fakeSnapshot, runWithStructure, edgesFor } from "@/server/testing/fixtures";

describe("go-dependency-analyzer", () => {
  it("resolves a single import of a local package using the go.mod module path", async () => {
    const snapshot = fakeSnapshot({
      "go.mod": `module github.com/example/app\n\ngo 1.21`,
      "main.go": `package main\n\nimport "github.com/example/app/internal/foo"`,
      "internal/foo/foo.go": `package foo`,
    });
    const run = await runWithStructure(snapshot, goDependencyAnalyzer);
    const edges = edgesFor(run, "go-dependency-analyzer");
    expect(edges).toContainEqual(expect.objectContaining({ fromId: "main.go", toId: "internal/foo/foo.go" }));
  });

  it("resolves a grouped import block", async () => {
    const snapshot = fakeSnapshot({
      "go.mod": `module example.com/app`,
      "main.go": `package main\n\nimport (\n\t"fmt"\n\t"example.com/app/pkg/util"\n)`,
      "pkg/util/util.go": `package util`,
    });
    const run = await runWithStructure(snapshot, goDependencyAnalyzer);
    const edges = edgesFor(run, "go-dependency-analyzer");
    expect(edges).toContainEqual(expect.objectContaining({ fromId: "main.go", toId: "pkg/util/util.go" }));
  });

  it("does not resolve an external/stdlib import", async () => {
    const snapshot = fakeSnapshot({
      "go.mod": `module example.com/app`,
      "main.go": `package main\n\nimport "fmt"`,
    });
    const run = await runWithStructure(snapshot, goDependencyAnalyzer);
    expect(edgesFor(run, "go-dependency-analyzer")).toHaveLength(0);
  });

  it("ignores a commented-out import inside a grouped block", async () => {
    const snapshot = fakeSnapshot({
      "go.mod": `module example.com/app`,
      "main.go": `package main\n\nimport (\n\t// "example.com/app/pkg/util"\n\t"fmt"\n)`,
      "pkg/util/util.go": `package util`,
    });
    const run = await runWithStructure(snapshot, goDependencyAnalyzer);
    expect(edgesFor(run, "go-dependency-analyzer")).toHaveLength(0);
  });

  it("skips itself entirely when there is no go.mod", async () => {
    const snapshot = fakeSnapshot({ "main.go": `package main` });
    const run = await runWithStructure(snapshot, goDependencyAnalyzer);
    expect(run.results.has("go-dependency-analyzer")).toBe(false);
  });
});
