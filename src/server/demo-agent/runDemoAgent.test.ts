import { describe, expect, it } from "vitest";
import { resolveDemoAgentModel } from "./runDemoAgent";

describe("resolveDemoAgentModel", () => {
  it("prefers the explicit configured model first", () => {
    const ordered = resolveDemoAgentModel("custom/model");

    expect(ordered[0]).toBe("custom/model");
    expect(ordered).toContain("openai/gpt-oss-120b");
  });

  it("keeps a stable fallback list when the configured model is unavailable", () => {
    const ordered = resolveDemoAgentModel("missing/model");

    expect(ordered[0]).toBe("missing/model");
    expect(ordered.slice(1)).toEqual([
      "openai/gpt-oss-120b",
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "meta-llama/llama-4-scout-17b-16e-instruct",
    ]);
  });
});
