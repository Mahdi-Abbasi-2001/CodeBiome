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

  it("does not flag a fake credential inside a test fixture (regression: real repos' tests/*.test.ts routinely assert against fake PEM blocks and keys)", async () => {
    const snapshot = fakeSnapshot({
      "tests/auth.test.ts": `it('rejects a bad key', () => { const key = "AKIAABCDEFGHIJKLMNOP"; expect(verify(key)).toBe(false); });`,
    });
    const run = await runWithStructure(snapshot, securityAnalyzer);
    const result = run.results.get("security-analyzer")?.data as { patternMatches: unknown[] };
    expect(result.patternMatches).toHaveLength(0);
  });

  it("does not flag an example credential inside documentation (regression: docs/*.md routinely show AWS's own published example key)", async () => {
    const snapshot = fakeSnapshot({
      "docs/setup.md": `Set AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE in your environment.`,
    });
    const run = await runWithStructure(snapshot, securityAnalyzer);
    const result = run.results.get("security-analyzer")?.data as { patternMatches: unknown[] };
    expect(result.patternMatches).toHaveLength(0);
  });

  it("still flags a real-looking credential inside ordinary source code", async () => {
    const snapshot = fakeSnapshot({ "src/config.ts": `export const key = "AKIAABCDEFGHIJKLMNOP";` });
    const run = await runWithStructure(snapshot, securityAnalyzer);
    const result = run.results.get("security-analyzer")?.data as { patternMatches: { rule: string }[] };
    expect(result.patternMatches).toContainEqual(expect.objectContaining({ rule: "aws-access-key-id" }));
  });
});
