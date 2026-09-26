import { describe, it, expect } from "vitest";
import { cFamilyDependencyAnalyzer } from "./c-family-dependency-analyzer";
import { fakeSnapshot, runWithStructure, edgesFor } from "@/server/testing/fixtures";

describe("c-family-dependency-analyzer", () => {
  it("resolves a quoted include exactly relative to the current file, at full confidence", async () => {
    const snapshot = fakeSnapshot({
      "src/main.c": `#include "util.h"`,
      "src/util.h": `void helper(void);`,
    });
    const run = await runWithStructure(snapshot, cFamilyDependencyAnalyzer);
    const edges = edgesFor(run, "c-family-dependency-analyzer");
    expect(edges).toContainEqual(expect.objectContaining({ fromId: "src/main.c", toId: "src/util.h", confidence: 1 }));
  });

  it("resolves an angle-bracket include via suffix match, at reduced confidence", async () => {
    const snapshot = fakeSnapshot({
      "tests/fuzz.cpp": `#include <nlohmann/json.hpp>`,
      "include/nlohmann/json.hpp": `namespace nlohmann {}`,
    });
    const run = await runWithStructure(snapshot, cFamilyDependencyAnalyzer);
    const edges = edgesFor(run, "c-family-dependency-analyzer");
    expect(edges).toContainEqual(
      expect.objectContaining({ fromId: "tests/fuzz.cpp", toId: "include/nlohmann/json.hpp", confidence: 0.5 })
    );
  });

  it("does not resolve a genuine system header", async () => {
    const snapshot = fakeSnapshot({ "src/main.c": `#include <stdio.h>` });
    const run = await runWithStructure(snapshot, cFamilyDependencyAnalyzer);
    expect(edgesFor(run, "c-family-dependency-analyzer")).toHaveLength(0);
  });

  it("ignores a commented-out include", async () => {
    const snapshot = fakeSnapshot({
      "src/main.c": `// #include "util.h"`,
      "src/util.h": `void helper(void);`,
    });
    const run = await runWithStructure(snapshot, cFamilyDependencyAnalyzer);
    expect(edgesFor(run, "c-family-dependency-analyzer")).toHaveLength(0);
  });
});
