import { describe, it, expect } from "vitest";
import { computeHealthReport } from "./health";
import { buildWorldModel } from "@/server/world/builder";
import { buildTestKnowledgeModel } from "@/server/testing/knowledgeModelFixture";

async function fixture() {
  const model = await buildTestKnowledgeModel({
    "src/user/user.controller.ts": `export class UserController {}\n`,
    "src/user/user.spec.ts": `describe('user', () => { it('works', () => {}); });\n`,
    "README.md": `# Demo\n`,
  });
  const worldModel = buildWorldModel(model);
  return { model, worldModel };
}

describe("computeHealthReport", () => {
  it("gives a clean repository a perfect score with an empty breakdown", async () => {
    const { model, worldModel } = await fixture();
    const report = computeHealthReport(model, worldModel);

    expect(report.score.value).toBe(100);
    expect(report.score.breakdown).toEqual([]);
    expect(report.vulnerabilities).toEqual([]);
    expect(report.weaknesses).toEqual([]);
    expect(report.strengths.map((s) => s.id)).toEqual(expect.arrayContaining(["no-secrets", "readme", "tests"]));
  });

  it("surfaces a real security pattern match as a vulnerability and deducts from the score", async () => {
    const { model, worldModel } = await fixture();
    model.security.patternMatches = [{ fileId: "src/user/user.controller.ts", line: 3, rule: "aws-access-key-id", severity: "critical" }];

    const report = computeHealthReport(model, worldModel);

    expect(report.vulnerabilities).toHaveLength(1);
    expect(report.vulnerabilities[0].severity).toBe("critical");
    expect(report.score.value).toBe(85);
    expect(report.score.breakdown).toContainEqual({ label: "1 critical security finding", delta: -15 });
    expect(report.strengths.map((s) => s.id)).not.toContain("no-secrets");
  });

  it("sorts multiple vulnerabilities by severity, worst first", async () => {
    const { model, worldModel } = await fixture();
    model.security.patternMatches = [
      { fileId: "a.ts", line: 1, rule: "hardcoded-secret-assignment", severity: "moderate" },
      { fileId: "b.ts", line: 2, rule: "aws-access-key-id", severity: "critical" },
      { fileId: "c.ts", line: 3, rule: "slack-token", severity: "high" },
    ];

    const report = computeHealthReport(model, worldModel);
    expect(report.vulnerabilities.map((v) => v.severity)).toEqual(["critical", "high", "moderate"]);
  });

  it("lists a real large file as a weakness and deducts from the score", async () => {
    const { model, worldModel } = await fixture();
    model.codeHealth.largeFiles = [{ fileId: "src/user/user.controller.ts", linesOfCode: 900 }];

    const report = computeHealthReport(model, worldModel);

    expect(report.weaknesses).toContainEqual({
      id: "large-src/user/user.controller.ts",
      label: "Large file",
      detail: "src/user/user.controller.ts — 900 lines",
      fileId: "src/user/user.controller.ts",
    });
    expect(report.score.breakdown).toContainEqual({ label: "1 large file", delta: -2 });
  });

  it("flags a missing README as both a weakness and a score deduction, and drops the readme strength", async () => {
    const { model, worldModel } = await fixture();
    model.documentation.readme.exists = false;

    const report = computeHealthReport(model, worldModel);

    expect(report.weaknesses).toContainEqual({ id: "no-readme", label: "No README", detail: expect.any(String) });
    expect(report.score.breakdown).toContainEqual({ label: "No README", delta: -5 });
    expect(report.strengths.map((s) => s.id)).not.toContain("readme");
  });

  it("caps the deduction for one severity instead of scaling it unboundedly with finding count", async () => {
    const { model, worldModel } = await fixture();
    model.security.patternMatches = Array.from({ length: 20 }, (_, i) => ({
      fileId: `f${i}.ts`,
      line: 1,
      rule: "aws-access-key-id",
      severity: "critical" as const,
    }));

    const report = computeHealthReport(model, worldModel);
    expect(report.vulnerabilities).toHaveLength(20);
    expect(report.score.breakdown).toContainEqual({ label: "20 critical security findings", delta: -30 });
    expect(report.score.value).toBe(70);
  });

  it("still floors at 0 once real problems add up across multiple categories, even with per-category caps", async () => {
    const { model, worldModel } = await fixture();
    model.security.patternMatches = [
      ...Array.from({ length: 5 }, (_, i) => ({ fileId: `c${i}.ts`, line: 1, rule: "aws-access-key-id", severity: "critical" as const })),
      ...Array.from({ length: 5 }, (_, i) => ({ fileId: `h${i}.ts`, line: 1, rule: "slack-token", severity: "high" as const })),
      ...Array.from({ length: 5 }, (_, i) => ({ fileId: `m${i}.ts`, line: 1, rule: "hardcoded-secret-assignment", severity: "moderate" as const })),
      ...Array.from({ length: 5 }, (_, i) => ({ fileId: `l${i}.ts`, line: 1, rule: "hardcoded-secret-assignment", severity: "low" as const })),
    ];
    model.codeHealth.largeFiles = Array.from({ length: 10 }, (_, i) => ({ fileId: `big${i}.ts`, linesOfCode: 900 }));
    model.documentation.readme.exists = false;

    const report = computeHealthReport(model, worldModel);
    expect(report.score.value).toBe(0);
  });

  it("reports real repository-wide stats", async () => {
    const { model, worldModel } = await fixture();
    const report = computeHealthReport(model, worldModel);

    expect(report.stats.fileCount).toBe(model.repository.statistics.fileCount);
    expect(report.stats.moduleCount).toBe(model.repository.statistics.moduleCount);
    expect(report.stats.totalLinesOfCode).toBe(model.repository.statistics.totalLinesOfCode);
  });
});
