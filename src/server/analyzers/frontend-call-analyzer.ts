import type { Analyzer, AnalyzerResult } from "./types";
import type { StructureAnalyzerOutput } from "./structure-analyzer";
import type { EntryPointAnalyzerOutput } from "./entry-point-analyzer";
import type { DependencyEdgeDraft } from "./dependency-analyzer";
import { stripCLikeComments } from "./commentUtils";

export interface FrontendCallAnalyzerOutput {
  edges: DependencyEdgeDraft[];
}

/**
 * The real facts journey inference (src/server/journeys/inferJourneys.ts,
 * src/types/journey.ts) is built on: which frontend files call which real
 * backend routes (`http-request` edges), and which frontend files navigate
 * to which real frontend pages (`navigates-to` edges) — both already
 * detected by entry-point-analyzer's `http-route`/`frontend-page`
 * candidates. This analyzer never invents a target: a `fetch`/`axios`/
 * `<form>`/navigation call only becomes an edge when its literal path
 * string actually matches a real detected entry point's path. A call whose
 * URL is a runtime-computed variable (not a literal) is silently skipped —
 * the same "a broken/dynamic reference never qualifies" rule
 * dependency-analyzer already applies to external packages.
 */

// Plain-string OR (possibly-interpolated) template-literal capture, shared
// by every pattern below — group order is always [plainQuote, plainValue,
// templateValue] so callers can do `m[2] ?? m[3]` uniformly.
const STR = `(?:(['"])([^'"]*)\\1|\`([^\`]*)\`)`;

const API_CALL_PATTERNS: { label: string; pattern: RegExp }[] = [
  { label: "fetch", pattern: new RegExp(`\\bfetch\\s*\\(\\s*${STR}`, "g") },
  { label: "axios", pattern: new RegExp(`\\baxios\\.(?:get|post|put|delete|patch)\\s*\\(\\s*${STR}`, "g") },
  { label: "axios", pattern: new RegExp(`\\baxios\\s*\\(\\s*\\{[^}]*?\\burl\\s*:\\s*${STR}`, "g") },
  { label: "form action", pattern: /<form\s+[^>]*?\baction\s*=\s*(['"])([^'"]*)\1/g },
];

const NAVIGATION_PATTERNS: { label: string; pattern: RegExp }[] = [
  { label: "navigate()", pattern: new RegExp(`\\bnavigate\\s*\\(\\s*${STR}`, "g") },
  { label: "router.push", pattern: new RegExp(`\\brouter\\.push\\s*\\(\\s*${STR}`, "g") },
  { label: "history.push", pattern: new RegExp(`\\bhistory\\.push\\s*\\(\\s*${STR}`, "g") },
  { label: "<Link>", pattern: /<Link\s+[^>]*?\b(?:to|href)\s*=\s*(['"])(\/[^'"]*)\1/g },
  { label: "<a href>", pattern: /<a\s+[^>]*?\bhref\s*=\s*(['"])(\/[^'"]*)\1/g },
  { label: "window.location", pattern: new RegExp(`\\bwindow\\.location(?:\\.href)?\\s*=\\s*${STR}`, "g") },
];

/** A route/call path segment that can't be compared literally — a real param (`:id`, `[id]`) or a template interpolation (`${id}`). */
function isWildcardSegment(segment: string): boolean {
  return segment.startsWith(":") || (segment.startsWith("[") && segment.endsWith("]")) || segment.includes("${");
}

/** Same segment count, every non-wildcard segment equal — either side may carry the wildcard. */
function pathsMatch(routePath: string, calledPath: string): { matches: boolean; exact: boolean } {
  const a = routePath.split("/").filter(Boolean);
  const b = calledPath.split("/").filter(Boolean);
  if (a.length !== b.length) return { matches: false, exact: false };
  let exact = true;
  for (let i = 0; i < a.length; i++) {
    if (isWildcardSegment(a[i]) || isWildcardSegment(b[i])) {
      exact = false;
      continue;
    }
    if (a[i] !== b[i]) return { matches: false, exact: false };
  }
  return { matches: true, exact };
}

/** Extracts every literal (or interpolated-template) path a set of regex patterns capture from `content`, skipping anything that isn't clearly an internal path (`/...`). */
function extractLiteralPaths(content: string, patterns: { label: string; pattern: RegExp }[]): Array<{ path: string; label: string }> {
  const found: Array<{ path: string; label: string }> = [];
  for (const { label, pattern } of patterns) {
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) {
      const raw = match[2] ?? match[3];
      if (!raw || !raw.startsWith("/")) continue; // external/absolute URL, mailto:, anchor, etc. — not a real internal target
      found.push({ path: raw.split("?")[0], label });
    }
  }
  return found;
}

interface RouteTarget {
  fileId: string;
  path: string;
}

function resolveTarget(calledPath: string, targets: RouteTarget[]): { fileId: string; exact: boolean } | null {
  for (const target of targets) {
    const { matches, exact } = pathsMatch(target.path, calledPath);
    if (matches) return { fileId: target.fileId, exact };
  }
  return null;
}

export const frontendCallAnalyzer: Analyzer<FrontendCallAnalyzerOutput> = {
  id: "frontend-call-analyzer",
  displayName: "Frontend Call Analyzer",
  version: "0.1.0",
  dependsOn: ["structure-analyzer", "entry-point-analyzer"],
  supports: () => true,
  async run({ snapshot, getDependencyResult }): Promise<AnalyzerResult<FrontendCallAnalyzerOutput>> {
    const structure = getDependencyResult<StructureAnalyzerOutput>("structure-analyzer");
    const entryPointResult = getDependencyResult<EntryPointAnalyzerOutput>("entry-point-analyzer");
    const edges: DependencyEdgeDraft[] = [];

    if (!structure || !entryPointResult) {
      return {
        analyzerId: "frontend-call-analyzer",
        version: "0.1.0",
        producedAt: new Date().toISOString(),
        data: { edges },
        diagnostics: [{ level: "error", message: "structure-analyzer or entry-point-analyzer result unavailable" }],
      };
    }

    const backendRoutes: RouteTarget[] = entryPointResult.data.entryPoints
      .filter((e) => e.type === "http-route")
      .map((e) => ({ fileId: e.fileId, path: e.name }));
    const frontendPages: RouteTarget[] = entryPointResult.data.entryPoints
      .filter((e) => e.type === "frontend-page")
      .map((e) => ({ fileId: e.fileId, path: e.name }));

    if (backendRoutes.length === 0 && frontendPages.length === 0) {
      return {
        analyzerId: "frontend-call-analyzer",
        version: "0.1.0",
        producedAt: new Date().toISOString(),
        data: { edges },
        diagnostics: [],
      };
    }

    const snapshotByPath = new Map(snapshot.files.map((f) => [f.path, f]));
    let edgeCounter = 0;

    for (const file of structure.data.files) {
      if (file.type !== "source") continue;
      const snapshotFile = snapshotByPath.get(file.path);
      if (!snapshotFile || snapshotFile.isBinary) continue;
      const rawContent = await snapshotFile.readContent();
      if (!rawContent) continue;
      const content = stripCLikeComments(rawContent);

      const emitted = new Set<string>();

      for (const { path: calledPath } of extractLiteralPaths(content, API_CALL_PATTERNS)) {
        const resolved = resolveTarget(calledPath, backendRoutes);
        if (!resolved || resolved.fileId === file.id) continue;
        const key = `http-request:${resolved.fileId}`;
        if (emitted.has(key)) continue;
        emitted.add(key);
        edges.push({
          id: `fcall-${edgeCounter++}`,
          fromId: file.path,
          toId: resolved.fileId,
          fromKind: "file",
          toKind: "file",
          relationship: "http-request",
          direction: "uses",
          confidence: resolved.exact ? 1 : 0.75,
        });
      }

      for (const { path: calledPath } of extractLiteralPaths(content, NAVIGATION_PATTERNS)) {
        const resolved = resolveTarget(calledPath, frontendPages);
        if (!resolved || resolved.fileId === file.id) continue;
        const key = `navigates-to:${resolved.fileId}`;
        if (emitted.has(key)) continue;
        emitted.add(key);
        edges.push({
          id: `fcall-${edgeCounter++}`,
          fromId: file.path,
          toId: resolved.fileId,
          fromKind: "file",
          toKind: "file",
          relationship: "navigates-to",
          direction: "uses",
          confidence: resolved.exact ? 1 : 0.75,
        });
      }
    }

    return {
      analyzerId: "frontend-call-analyzer",
      version: "0.1.0",
      producedAt: new Date().toISOString(),
      data: { edges },
      diagnostics: [],
    };
  },
};
