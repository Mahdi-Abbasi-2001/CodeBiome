import { describe, it, expect } from "vitest";
import { javaDependencyAnalyzer } from "./java-dependency-analyzer";
import { fakeSnapshot, runWithStructure, edgesFor } from "@/server/testing/fixtures";

describe("java-dependency-analyzer", () => {
  it("resolves a dotted package import to its file via the src/main/java convention", async () => {
    const snapshot = fakeSnapshot({
      "src/main/java/com/example/app/Main.java": `import com.example.app.util.Helper;`,
      "src/main/java/com/example/app/util/Helper.java": `class Helper {}`,
    });
    const run = await runWithStructure(snapshot, javaDependencyAnalyzer);
    const edges = edgesFor(run, "java-dependency-analyzer");
    expect(edges).toContainEqual(
      expect.objectContaining({
        fromId: "src/main/java/com/example/app/Main.java",
        toId: "src/main/java/com/example/app/util/Helper.java",
      })
    );
  });

  it("does not resolve a JDK/third-party import", async () => {
    const snapshot = fakeSnapshot({
      "src/main/java/com/example/app/Main.java": `import java.util.List;\nimport org.junit.Test;`,
    });
    const run = await runWithStructure(snapshot, javaDependencyAnalyzer);
    expect(edgesFor(run, "java-dependency-analyzer")).toHaveLength(0);
  });

  it("ignores a commented-out import", async () => {
    const snapshot = fakeSnapshot({
      "src/main/java/com/example/Main.java": `// import com.example.util.Helper;`,
      "src/main/java/com/example/util/Helper.java": `class Helper {}`,
    });
    const run = await runWithStructure(snapshot, javaDependencyAnalyzer);
    expect(edgesFor(run, "java-dependency-analyzer")).toHaveLength(0);
  });
});
