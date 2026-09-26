import type { Analyzer, AnalyzerResult } from "./types";
import type { StructureAnalyzerOutput } from "./structure-analyzer";

export interface SecurityFinding {
  fileId: string;
  line: number;
  rule: string;
  severity: "low" | "moderate" | "high" | "critical";
}

export interface SecurityAnalyzerOutput {
  patternMatches: SecurityFinding[];
}

// Evidence-based only, per docs/REPOSITORY_KNOWLEDGE_MODEL.md's rule that
// security findings must never be an AI guess — every one of these fires on
// a concrete, matchable text pattern, the same category of check real
// secret-scanning tools use (git-secrets, truffleHog, gitleaks). This is
// deliberately conservative: false negatives (a secret this doesn't catch)
// are fine for a first pass; false positives on ordinary code are not, so
// the assignment-based rule requires a long, plausible-looking value rather
// than firing on any variable named "password".
const RULES: { id: string; pattern: RegExp; severity: SecurityFinding["severity"] }[] = [
  { id: "aws-access-key-id", pattern: /\bAKIA[0-9A-Z]{16}\b/, severity: "critical" },
  {
    id: "private-key-block",
    pattern: /-----BEGIN (RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----/,
    severity: "critical",
  },
  { id: "slack-token", pattern: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/, severity: "high" },
  {
    id: "hardcoded-secret-assignment",
    pattern: /\b(api[_-]?key|secret[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*['"][A-Za-z0-9_\-/+]{16,}['"]/i,
    severity: "moderate",
  },
];

const SKIP_TYPES = new Set(["asset", "build-output", "generated"]);

/**
 * Populates RepositoryKnowledgeModel.security.patternMatches with real,
 * matched evidence — nothing here is an AI judgment call. Runs on every
 * text-like file; content is already read once by structure-analyzer (or
 * whichever dependency analyzer matches the file's language) and cached by
 * `SnapshotFile.readContent()`'s memoization, so this doesn't add redundant
 * disk I/O even though it scans broadly.
 */
export const securityAnalyzer: Analyzer<SecurityAnalyzerOutput> = {
  id: "security-analyzer",
  displayName: "Security Pattern Analyzer",
  version: "0.1.0",
  dependsOn: ["structure-analyzer"],
  supports: () => true,
  async run({ snapshot, getDependencyResult }): Promise<AnalyzerResult<SecurityAnalyzerOutput>> {
    const structure = getDependencyResult<StructureAnalyzerOutput>("structure-analyzer");
    const patternMatches: SecurityFinding[] = [];

    if (!structure) {
      return {
        analyzerId: "security-analyzer",
        version: "0.1.0",
        producedAt: new Date().toISOString(),
        data: { patternMatches },
        diagnostics: [{ level: "error", message: "structure-analyzer result unavailable" }],
      };
    }

    const candidates = structure.data.files.filter((f) => !SKIP_TYPES.has(f.type));
    const snapshotByPath = new Map(snapshot.files.map((f) => [f.path, f]));

    for (const file of candidates) {
      const snapshotFile = snapshotByPath.get(file.path);
      if (!snapshotFile || snapshotFile.isBinary) continue;
      const content = await snapshotFile.readContent();
      if (!content) continue;

      const lines = content.split("\n");
      lines.forEach((line, index) => {
        for (const rule of RULES) {
          if (rule.pattern.test(line)) {
            patternMatches.push({ fileId: file.path, line: index + 1, rule: rule.id, severity: rule.severity });
          }
        }
      });
    }

    return {
      analyzerId: "security-analyzer",
      version: "0.1.0",
      producedAt: new Date().toISOString(),
      data: { patternMatches },
      diagnostics: [],
    };
  },
};
