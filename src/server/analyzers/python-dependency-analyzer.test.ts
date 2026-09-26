import { describe, it, expect } from "vitest";
import { pythonDependencyAnalyzer } from "./python-dependency-analyzer";
import { fakeSnapshot, runWithStructure, edgesFor } from "@/server/testing/fixtures";

describe("python-dependency-analyzer", () => {
  it("resolves `from . import x` to a sibling submodule", async () => {
    const snapshot = fakeSnapshot({
      "pkg/__init__.py": `from . import utils`,
      "pkg/utils.py": `def helper(): pass`,
    });
    const run = await runWithStructure(snapshot, pythonDependencyAnalyzer);
    const edges = edgesFor(run, "python-dependency-analyzer");
    expect(edges).toContainEqual(expect.objectContaining({ fromId: "pkg/__init__.py", toId: "pkg/utils.py" }));
  });

  it("resolves `from .foo import Bar`", async () => {
    const snapshot = fakeSnapshot({
      "pkg/main.py": `from .models import User`,
      "pkg/models.py": `class User: pass`,
    });
    const run = await runWithStructure(snapshot, pythonDependencyAnalyzer);
    const edges = edgesFor(run, "python-dependency-analyzer");
    expect(edges).toContainEqual(expect.objectContaining({ fromId: "pkg/main.py", toId: "pkg/models.py" }));
  });

  it("resolves an absolute `from a.b import c` when a real file matches", async () => {
    const snapshot = fakeSnapshot({
      "app/main.py": `from app.services.billing import charge`,
      "app/services/billing.py": `def charge(): pass`,
    });
    const run = await runWithStructure(snapshot, pythonDependencyAnalyzer);
    const edges = edgesFor(run, "python-dependency-analyzer");
    expect(edges).toContainEqual(expect.objectContaining({ fromId: "app/main.py", toId: "app/services/billing.py" }));
  });

  it("does not fabricate an edge for an unresolvable absolute import (stdlib/third-party)", async () => {
    const snapshot = fakeSnapshot({
      "app/main.py": `from django.http import HttpResponse`,
    });
    const run = await runWithStructure(snapshot, pythonDependencyAnalyzer);
    expect(edgesFor(run, "python-dependency-analyzer")).toHaveLength(0);
  });

  it("ignores a commented-out import line", async () => {
    const snapshot = fakeSnapshot({
      "pkg/main.py": `# from .models import User\nx = 1`,
      "pkg/models.py": `class User: pass`,
    });
    const run = await runWithStructure(snapshot, pythonDependencyAnalyzer);
    expect(edgesFor(run, "python-dependency-analyzer")).toHaveLength(0);
  });
});
