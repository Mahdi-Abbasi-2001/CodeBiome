import { describe, it, expect } from "vitest";
import { phpDependencyAnalyzer } from "./php-dependency-analyzer";
import { fakeSnapshot, runWithStructure, edgesFor } from "@/server/testing/fixtures";

describe("php-dependency-analyzer", () => {
  it("resolves a simple relative require_once", async () => {
    const snapshot = fakeSnapshot({
      "index.php": `require_once 'includes/bootstrap.php';`,
      "includes/bootstrap.php": `<?php`,
    });
    const run = await runWithStructure(snapshot, phpDependencyAnalyzer);
    const edges = edgesFor(run, "php-dependency-analyzer");
    expect(edges).toContainEqual(expect.objectContaining({ fromId: "index.php", toId: "includes/bootstrap.php" }));
  });

  it("does not match a __DIR__-concatenated require (no quote directly after the keyword)", async () => {
    const snapshot = fakeSnapshot({
      "index.php": `require __DIR__ . '/includes/bootstrap.php';`,
      "includes/bootstrap.php": `<?php`,
    });
    const run = await runWithStructure(snapshot, phpDependencyAnalyzer);
    expect(edgesFor(run, "php-dependency-analyzer")).toHaveLength(0);
  });

  it("resolves a PSR-4 `use` namespace via suffix match, when the namespace segment is itself a real directory", async () => {
    // Suffix matching only works when the namespace root is physically
    // present in the path (composer.json mapping like `"Carbon\\":
    // "src/Carbon/"`, confirmed against the real briannesbitt/Carbon repo).
    // A mapping that DROPS the namespace root entirely (`"App\\": "src/"`,
    // also extremely common — Laravel/Symfony) is NOT resolvable this way
    // without actually parsing composer.json, which isn't attempted here.
    const snapshot = fakeSnapshot({
      "src/Carbon/CarbonInterval.php": `use Carbon\\Exceptions\\InvalidIntervalException;`,
      "src/Carbon/Exceptions/InvalidIntervalException.php": `<?php namespace Carbon\\Exceptions;`,
    });
    const run = await runWithStructure(snapshot, phpDependencyAnalyzer);
    const edges = edgesFor(run, "php-dependency-analyzer");
    expect(edges).toContainEqual(
      expect.objectContaining({
        fromId: "src/Carbon/CarbonInterval.php",
        toId: "src/Carbon/Exceptions/InvalidIntervalException.php",
      })
    );
  });

  it("ignores a commented-out require", async () => {
    const snapshot = fakeSnapshot({
      "index.php": `// require_once 'includes/bootstrap.php';`,
      "includes/bootstrap.php": `<?php`,
    });
    const run = await runWithStructure(snapshot, phpDependencyAnalyzer);
    expect(edgesFor(run, "php-dependency-analyzer")).toHaveLength(0);
  });
});
