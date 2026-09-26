import { describe, it, expect } from "vitest";
import { rustDependencyAnalyzer } from "./rust-dependency-analyzer";
import { fakeSnapshot, runWithStructure, edgesFor } from "@/server/testing/fixtures";

describe("rust-dependency-analyzer", () => {
  it("resolves `mod foo;` to foo.rs in the current file's own module directory", async () => {
    const snapshot = fakeSnapshot({
      "src/lib.rs": `mod manifest;`,
      "src/manifest.rs": `pub struct Manifest;`,
    });
    const run = await runWithStructure(snapshot, rustDependencyAnalyzer);
    const edges = edgesFor(run, "rust-dependency-analyzer");
    expect(edges).toContainEqual(expect.objectContaining({ fromId: "src/lib.rs", toId: "src/manifest.rs" }));
  });

  it("resolves `mod foo;` to foo/mod.rs for a non-root file", async () => {
    const snapshot = fakeSnapshot({
      "src/logical_plan.rs": `mod analyze;`,
      "src/logical_plan/analyze/mod.rs": `pub fn run() {}`,
    });
    const run = await runWithStructure(snapshot, rustDependencyAnalyzer);
    const edges = edgesFor(run, "rust-dependency-analyzer");
    expect(edges).toContainEqual(
      expect.objectContaining({ fromId: "src/logical_plan.rs", toId: "src/logical_plan/analyze/mod.rs" })
    );
  });

  it("resolves `use crate::foo::Bar;` relative to the crate's src/ root", async () => {
    const snapshot = fakeSnapshot({
      "core/src/context.rs": `use crate::errors::CoreError;`,
      "core/src/errors.rs": `pub struct CoreError;`,
    });
    const run = await runWithStructure(snapshot, rustDependencyAnalyzer);
    const edges = edgesFor(run, "rust-dependency-analyzer");
    expect(edges).toContainEqual(expect.objectContaining({ fromId: "core/src/context.rs", toId: "core/src/errors.rs" }));
  });

  it("resolves `use self::x;` and `use super::y;`", async () => {
    const snapshot = fakeSnapshot({
      "src/foo.rs": `use self::bar::Baz;\nuse super::sibling::Thing;`,
      "src/foo/bar.rs": `pub struct Baz;`,
      "src/sibling.rs": `pub struct Thing;`,
    });
    const run = await runWithStructure(snapshot, rustDependencyAnalyzer);
    const edges = edgesFor(run, "rust-dependency-analyzer");
    expect(edges).toContainEqual(expect.objectContaining({ toId: "src/foo/bar.rs" }));
    expect(edges).toContainEqual(expect.objectContaining({ toId: "src/sibling.rs" }));
  });

  it("does not create an edge for a stdlib crate", async () => {
    const snapshot = fakeSnapshot({
      "src/lib.rs": `use std::collections::HashMap;`,
    });
    const run = await runWithStructure(snapshot, rustDependencyAnalyzer);
    expect(edgesFor(run, "rust-dependency-analyzer")).toHaveLength(0);
  });

  it("normalizes underscore crate names back to a hyphenated directory for bare `use` paths", async () => {
    const snapshot = fakeSnapshot({
      "wren-core-base/manifest.rs": `pub struct Manifest;`,
      "consumer/lib.rs": `use wren_core_base::manifest::Manifest;`,
    });
    const run = await runWithStructure(snapshot, rustDependencyAnalyzer);
    const edges = edgesFor(run, "rust-dependency-analyzer");
    expect(edges).toContainEqual(
      expect.objectContaining({ fromId: "consumer/lib.rs", toId: "wren-core-base/manifest.rs" })
    );
  });

  it("ignores a commented-out mod/use line", async () => {
    const snapshot = fakeSnapshot({
      "src/lib.rs": `// mod manifest;`,
      "src/manifest.rs": `pub struct Manifest;`,
    });
    const run = await runWithStructure(snapshot, rustDependencyAnalyzer);
    expect(edgesFor(run, "rust-dependency-analyzer")).toHaveLength(0);
  });
});
