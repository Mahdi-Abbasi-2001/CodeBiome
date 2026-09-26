import { describe, it, expect } from "vitest";
import { securityAnalyzer } from "./security-analyzer";
import { fakeSnapshot, runWithStructure } from "@/server/testing/fixtures";

describe("security-analyzer", () => {
  it("flags a hardcoded AWS access key as critical", async () => {
    const snapshot = fakeSnapshot({
      "config/settings.py": `AWS_KEY = "AKIAABCDEFGHIJKLMNOP"`,
    });
    const run = await runWithStructure(snapshot, securityAnalyzer);
    const result = run.results.get("security-analyzer")?.data as { patternMatches: { rule: string; severity: string }[] };
    expect(result.patternMatches).toContainEqual(
      expect.objectContaining({ rule: "aws-access-key-id", severity: "critical" })
    );
  });

  it("flags a private key block", async () => {
    const snapshot = fakeSnapshot({
      "certs/key.pem": `-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----`,
    });
    const run = await runWithStructure(snapshot, securityAnalyzer);
    const result = run.results.get("security-analyzer")?.data as { patternMatches: { rule: string }[] };
    expect(result.patternMatches).toContainEqual(expect.objectContaining({ rule: "private-key-block" }));
  });

  it("does not flag ordinary code with no secret-shaped content", async () => {
    const snapshot = fakeSnapshot({ "src/index.ts": `export const add = (a: number, b: number) => a + b;` });
    const run = await runWithStructure(snapshot, securityAnalyzer);
    const result = run.results.get("security-analyzer")?.data as { patternMatches: unknown[] };
    expect(result.patternMatches).toHaveLength(0);
  });

  it("does not flag a short/placeholder-looking password variable", async () => {
    const snapshot = fakeSnapshot({ "src/config.ts": `const password = "";` });
    const run = await runWithStructure(snapshot, securityAnalyzer);
    const result = run.results.get("security-analyzer")?.data as { patternMatches: unknown[] };
    expect(result.patternMatches).toHaveLength(0);
  });
});
