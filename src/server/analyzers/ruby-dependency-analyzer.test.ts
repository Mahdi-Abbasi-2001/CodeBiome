import { describe, it, expect } from "vitest";
import { rubyDependencyAnalyzer } from "./ruby-dependency-analyzer";
import { fakeSnapshot, runWithStructure, edgesFor } from "@/server/testing/fixtures";

describe("ruby-dependency-analyzer", () => {
  it("resolves require_relative exactly relative to the current file", async () => {
    const snapshot = fakeSnapshot({
      "test/test_helper_spec.rb": `require_relative 'test_helper'`,
      "test/test_helper.rb": `# helpers`,
    });
    const run = await runWithStructure(snapshot, rubyDependencyAnalyzer);
    const edges = edgesFor(run, "ruby-dependency-analyzer");
    expect(edges).toContainEqual(
      expect.objectContaining({ fromId: "test/test_helper_spec.rb", toId: "test/test_helper.rb", confidence: 1 })
    );
  });

  it("resolves a plain require via a lib/ suffix match, at reduced confidence", async () => {
    const snapshot = fakeSnapshot({
      "benchmark/run.rb": `require 'faker'`,
      "lib/faker.rb": `module Faker; end`,
    });
    const run = await runWithStructure(snapshot, rubyDependencyAnalyzer);
    const edges = edgesFor(run, "ruby-dependency-analyzer");
    expect(edges).toContainEqual(
      expect.objectContaining({ fromId: "benchmark/run.rb", toId: "lib/faker.rb", confidence: 0.6 })
    );
  });

  it("does not resolve a require with no matching file (stdlib/gem)", async () => {
    const snapshot = fakeSnapshot({ "lib/thing.rb": `require 'json'` });
    const run = await runWithStructure(snapshot, rubyDependencyAnalyzer);
    expect(edgesFor(run, "ruby-dependency-analyzer")).toHaveLength(0);
  });

  it("ignores a commented-out require line", async () => {
    const snapshot = fakeSnapshot({
      "test/test_helper_spec.rb": `# require_relative 'test_helper'`,
      "test/test_helper.rb": `# helpers`,
    });
    const run = await runWithStructure(snapshot, rubyDependencyAnalyzer);
    expect(edgesFor(run, "ruby-dependency-analyzer")).toHaveLength(0);
  });
});
