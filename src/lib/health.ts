import type { RepositoryKnowledgeModel } from "@/types/knowledge-model";
import type { WorldModel } from "@/types/world-model";
import { computeDomains, type Domain } from "./domains";

/**
 * The Health tab's data model — a pure, client-side derived view over the
 * SAME Repository Knowledge Model every other tab reads, exactly like
 * `domains.ts`/`infrastructure.ts`: no new analyzer, no schema change, no
 * fabricated signal. Only fields an analyzer has actually populated are
 * surfaced here — `codeHealth.deadCodeCandidates`, `tests.coverage`,
 * `security.vulnerableDependencies`, etc. are still empty stubs in the RKM
 * (no analyzer implements them yet) and are deliberately left out rather
 * than shown as a false "0 issues" or a fake percentage.
 */

export interface VulnerabilityItem {
  fileId: string;
  line: number;
  rule: string;
  severity: "low" | "moderate" | "high" | "critical";
}

export interface WeaknessItem {
  id: string;
  label: string;
  detail: string;
  fileId?: string;
  domainId?: string;
}

export interface StrengthItem {
  id: string;
  label: string;
  detail: string;
}

export interface ScoreBreakdownEntry {
  label: string;
  delta: number;
}

export interface HealthReport {
  stats: {
    fileCount: number;
    moduleCount: number;
    totalLinesOfCode: number;
    languageCount: number;
    frameworkCount: number;
  };
  domains: Domain[];
  vulnerabilities: VulnerabilityItem[];
  weaknesses: WeaknessItem[];
  strengths: StrengthItem[];
  score: { value: number; breakdown: ScoreBreakdownEntry[] };
}

const SEVERITY_DEDUCTION: Record<VulnerabilityItem["severity"], number> = { critical: 15, high: 10, moderate: 5, low: 2 };
const SEVERITY_CAP: Record<VulnerabilityItem["severity"], number> = { critical: 30, high: 20, moderate: 15, low: 10 };
const SEVERITY_RANK: Record<VulnerabilityItem["severity"], number> = { critical: 3, high: 2, moderate: 1, low: 0 };
const STRESSED_DOMAIN_CAP = 20;
const CRITICAL_DOMAIN_CAP = 20;

/**
 * Starts at 100 and only ever subtracts — every deduction is disclosed in
 * `breakdown` so the number is never a black box. Weights are a judgment
 * call (disclosed to the user, not hidden): a critical secret match costs
 * more than a large file, a critical-tier domain costs more than a
 * stressed one. Every category is individually capped (the same idea
 * already used for large files) so one abundant-but-repetitive category —
 * a large repository naturally has more large files, more modules, more
 * chances for a few real findings — can't alone floor the whole score at
 * 0; only a repository with real problems spread across several
 * categories should ever actually hit the floor. Clamped to [0, 100].
 */
function computeScore(params: {
  vulnerabilities: VulnerabilityItem[];
  largeFileCount: number;
  stressedDomainCount: number;
  criticalDomainCount: number;
  readmeExists: boolean;
}): HealthReport["score"] {
  const breakdown: ScoreBreakdownEntry[] = [];
  let value = 100;

  const bySeverity = new Map<VulnerabilityItem["severity"], number>();
  for (const v of params.vulnerabilities) bySeverity.set(v.severity, (bySeverity.get(v.severity) ?? 0) + 1);
  for (const severity of ["critical", "high", "moderate", "low"] as const) {
    const count = bySeverity.get(severity);
    if (!count) continue;
    const delta = -Math.min(SEVERITY_CAP[severity], SEVERITY_DEDUCTION[severity] * count);
    value += delta;
    breakdown.push({ label: `${count} ${severity} security finding${count === 1 ? "" : "s"}`, delta });
  }

  if (params.largeFileCount > 0) {
    const delta = -Math.min(20, params.largeFileCount * 2);
    value += delta;
    breakdown.push({ label: `${params.largeFileCount} large file${params.largeFileCount === 1 ? "" : "s"}`, delta });
  }

  if (params.stressedDomainCount > 0) {
    const delta = -Math.min(STRESSED_DOMAIN_CAP, params.stressedDomainCount * 5);
    value += delta;
    breakdown.push({ label: `${params.stressedDomainCount} stressed domain${params.stressedDomainCount === 1 ? "" : "s"}`, delta });
  }

  if (params.criticalDomainCount > 0) {
    const delta = -Math.min(CRITICAL_DOMAIN_CAP, params.criticalDomainCount * 10);
    value += delta;
    breakdown.push({ label: `${params.criticalDomainCount} critical domain${params.criticalDomainCount === 1 ? "" : "s"}`, delta });
  }

  if (!params.readmeExists) {
    value -= 5;
    breakdown.push({ label: "No README", delta: -5 });
  }

  return { value: Math.max(0, Math.min(100, Math.round(value))), breakdown };
}

export function computeHealthReport(knowledgeModel: RepositoryKnowledgeModel, worldModel: WorldModel): HealthReport {
  const domains = computeDomains(worldModel, knowledgeModel);
  const applicationDomains = domains.filter((d) => !d.isInfra);
  const stressedDomains = applicationDomains.filter((d) => d.healthTier === "stressed");
  const criticalDomains = applicationDomains.filter((d) => d.healthTier === "critical");
  const thrivingDomains = applicationDomains.filter((d) => d.healthTier === "thriving");

  const vulnerabilities = [...knowledgeModel.security.patternMatches].sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
  );
  const largeFiles = knowledgeModel.codeHealth.largeFiles;
  const readmeExists = knowledgeModel.documentation.readme.exists;
  const testFileCount = knowledgeModel.files.filter((f) => f.testStatus.isTestFile).length;
  const moduleById = new Map(knowledgeModel.modules.map((m) => [m.id, m]));

  const weaknesses: WeaknessItem[] = [];
  for (const f of largeFiles.slice(0, 8)) {
    weaknesses.push({
      id: `large-${f.fileId}`,
      label: "Large file",
      detail: `${f.fileId} — ${f.linesOfCode.toLocaleString()} lines`,
      fileId: f.fileId,
    });
  }
  for (const d of [...criticalDomains, ...stressedDomains]) {
    const reasons = d.moduleIds
      .map((id) => moduleById.get(id))
      .flatMap((m) => m?.risk.map((r) => r.detail) ?? []);
    weaknesses.push({
      id: `domain-${d.id}`,
      label: `${d.healthTier === "critical" ? "Critical" : "Stressed"} domain: ${d.name}`,
      detail: reasons.length > 0 ? [...new Set(reasons)].join("; ") : "Flagged risk indicators present.",
      domainId: d.id,
    });
  }
  if (!readmeExists) {
    weaknesses.push({ id: "no-readme", label: "No README", detail: "The repository has no README file to orient a new contributor." });
  }

  const strengths: StrengthItem[] = [];
  if (vulnerabilities.length === 0) {
    strengths.push({
      id: "no-secrets",
      label: "No hardcoded secrets detected",
      detail: "Pattern scan found no matches for AWS keys, private-key blocks, Slack tokens, or hardcoded API secrets.",
    });
  }
  if (readmeExists) {
    strengths.push({ id: "readme", label: "README present", detail: "The repository documents itself with a README." });
  }
  if (thrivingDomains.length > 0) {
    strengths.push({
      id: "thriving",
      label: `${thrivingDomains.length} thriving domain${thrivingDomains.length === 1 ? "" : "s"}`,
      detail: thrivingDomains.map((d) => d.name).join(", "),
    });
  }
  if (knowledgeModel.repository.frameworks.length > 0) {
    const names = knowledgeModel.repository.frameworks.map((f) => f.name);
    strengths.push({
      id: "frameworks",
      label: `${names.length} real technolog${names.length === 1 ? "y" : "ies"} detected`,
      detail: names.join(", "),
    });
  }
  if (testFileCount > 0) {
    strengths.push({
      id: "tests",
      label: `${testFileCount} test file${testFileCount === 1 ? "" : "s"} detected`,
      detail: "Files matching test naming/location conventions.",
    });
  }

  const score = computeScore({
    vulnerabilities,
    largeFileCount: largeFiles.length,
    stressedDomainCount: stressedDomains.length,
    criticalDomainCount: criticalDomains.length,
    readmeExists,
  });

  return {
    stats: {
      fileCount: knowledgeModel.repository.statistics.fileCount,
      moduleCount: knowledgeModel.repository.statistics.moduleCount,
      totalLinesOfCode: knowledgeModel.repository.statistics.totalLinesOfCode,
      languageCount: knowledgeModel.repository.languages.length,
      frameworkCount: knowledgeModel.repository.frameworks.length,
    },
    domains,
    vulnerabilities,
    weaknesses,
    strengths,
    score,
  };
}
