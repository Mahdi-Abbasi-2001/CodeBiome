import type { Analyzer, AnalyzerResult } from "./types";
import type { StructureAnalyzerOutput } from "./structure-analyzer";
import { stripCLikeComments } from "./commentUtils";

export interface EntryPointCandidate {
  id: string;
  type: "http-route" | "cli-command" | "app-startup" | "worker" | "script" | "scheduled-job" | "frontend-page";
  name: string;
  fileId: string;
  detectionEvidence: string;
}

export interface EntryPointAnalyzerOutput {
  entryPoints: EntryPointCandidate[];
}

/**
 * One row per web-framework route convention actually checked. This is a
 * bounded, disclosed list — not a claim of universal framework coverage.
 * Each pattern's own capture group 1 is the route path when the framework
 * expresses one as a literal string; many (decorators, Go/Rust macros) often
 * don't carry a full path locally, in which case `name` falls back to the
 * file name.
 */
const ROUTE_PATTERNS: { framework: string; pattern: RegExp }[] = [
  // Express / Fastify / Koa
  { framework: "Express-style", pattern: /\b(?:app|router)\.(?:get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g },
  // NestJS / Angular decorators
  { framework: "NestJS", pattern: /@(?:Get|Post|Put|Delete|Patch)\s*\(\s*['"`]?([^'")`]*)['"`]?\s*\)/g },
  // Spring
  {
    framework: "Spring",
    pattern: /@(?:GetMapping|PostMapping|PutMapping|DeleteMapping|RequestMapping)\s*\(\s*(?:value\s*=\s*)?['"]([^'"]*)['"]/g,
  },
  // Flask / FastAPI
  { framework: "Flask/FastAPI", pattern: /@(?:app|router)\.(?:get|post|put|delete|patch|route)\s*\(\s*['"]([^'"]+)['"]/g },
  // Django urls.py
  { framework: "Django", pattern: /\b(?:path|re_path)\s*\(\s*['"]([^'"]*)['"]/g },
  // Rails routes.rb
  { framework: "Rails", pattern: /^\s*(?:get|post|put|patch|delete)\s+['"]([^'"]+)['"]/gm },
  // Laravel
  { framework: "Laravel", pattern: /Route::(?:get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/g },
  // Go (gin/echo-style method routing, and stdlib)
  { framework: "Go net/http", pattern: /\.(?:GET|POST|PUT|DELETE|PATCH)\s*\(\s*"([^"]+)"/g },
  { framework: "Go net/http", pattern: /http\.HandleFunc\s*\(\s*"([^"]+)"/g },
  // Rust actix-web / axum
  { framework: "Rust web", pattern: /#\[(?:get|post|put|delete|patch)\(\s*"([^"]+)"/g },
  { framework: "Rust web", pattern: /\.route\s*\(\s*"([^"]+)"/g },
];

/**
 * A frontend "page" — a real screen a website user can land on, the
 * counterpart to a backend `http-route` — is the anchor journey inference
 * (src/server/journeys/inferJourneys.ts) needs to stitch multi-request user
 * operations together (see docs on JourneyModel, src/types/journey.ts).
 * Bounded, disclosed detection, same tradeoff as ROUTE_PATTERNS above: the
 * Next.js file-convention case is high-confidence (the file path IS the
 * route, no fabrication); the React Router JSX case is lower-confidence
 * (a `<Route>` declaration's containing file isn't always the page
 * component itself — see FRONTEND_PAGE_PATTERNS' comment).
 */
function detectNextPage(filePath: string): { routePath: string } | null {
  const appPageMatch = filePath.match(/(^|\/)app\/((?:.*\/)?)page\.(tsx|jsx|ts|js|mjs)$/);
  const pagesMatch = filePath.match(/(^|\/)pages\/(.*)\.(tsx|jsx|ts|js|mjs)$/);

  if (appPageMatch) {
    const segments = appPageMatch[2].split("/").filter((seg) => seg && !/^\(.*\)$/.test(seg));
    return { routePath: "/" + segments.join("/") };
  }

  if (pagesMatch) {
    const rest = pagesMatch[2];
    if (rest.startsWith("api/")) return null; // handled as an http-route above, not a page
    if (/^_(app|document|error)$/.test(rest.split("/").pop() ?? "")) return null; // Next.js framework files, not a real page
    const segments = rest.split("/").filter((seg) => seg && seg.toLowerCase() !== "index");
    return { routePath: "/" + segments.join("/") };
  }

  return null;
}

/**
 * `<Route path="...">` (React Router). Content-based, not file-path-based,
 * so — unlike `detectNextPage` — this can only prove "this file declares a
 * route for this path," not that the file IS the page's own component
 * (`element={<X/>}` may point elsewhere). Lower confidence, disclosed as
 * such in `detectionEvidence`.
 */
const FRONTEND_PAGE_PATTERNS: { framework: string; pattern: RegExp }[] = [
  { framework: "React Router", pattern: /<Route\s+[^>]*?path\s*=\s*["']([^"']+)["']/g },
];

const CLI_PATH_PATTERN = /(^|\/)(bin|cli)(\/|$)/i;
const APP_STARTUP_FILENAME = /^(index|main|server|app)\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb)$/i;
const SHEBANG_PATTERN = /^#!/;

const HTTP_METHOD_EXPORT_PATTERN = /export\s+(?:async\s+)?(?:function\s+(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b|const\s+(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s*[=:])/g;

/**
 * Next.js App Router route handlers (`app/**\/route.ts`) and Pages Router
 * API routes (`pages/api/**.ts`) don't register a route with a call like
 * `app.get(...)` the way every other framework in ROUTE_PATTERNS does —
 * the FILE PATH itself is the route, and HTTP methods are named exports
 * (`export async function GET(...)`). None of ROUTE_PATTERNS' in-content
 * regexes can ever match this convention, which is why entry-point
 * detection previously found nothing in Next.js repositories (including
 * this project's own — see docs/BOB_INTEGRATION.md's real-world testing).
 * Checked by file path, not content, before the generic ROUTE_PATTERNS scan.
 */
function detectNextRouteHandler(filePath: string, content: string): { routePath: string; methods: string[] } | null {
  const appRouteMatch = filePath.match(/(^|\/)app\/((?:.*\/)?)route\.(ts|tsx|js|jsx|mjs)$/);
  const pagesApiMatch = filePath.match(/(^|\/)pages\/api\/(.*)\.(ts|tsx|js|jsx|mjs)$/);

  let routePath: string;
  if (appRouteMatch) {
    // e.g. "api/chat/" -> "/api/chat"; "" (root route.ts) -> "/". Route
    // groups like "(marketing)" are organizational only and never appear
    // in the real URL, so they're filtered out.
    const segments = appRouteMatch[2]
      .split("/")
      .filter((seg) => seg && !/^\(.*\)$/.test(seg));
    routePath = "/" + segments.join("/");
  } else if (pagesApiMatch) {
    routePath = "/api/" + pagesApiMatch[2];
  } else {
    return null;
  }

  const methods = new Set<string>();
  let match: RegExpExecArray | null;
  HTTP_METHOD_EXPORT_PATTERN.lastIndex = 0;
  while ((match = HTTP_METHOD_EXPORT_PATTERN.exec(content))) {
    methods.add((match[1] ?? match[2])!);
  }

  return { routePath, methods: [...methods] };
}

/**
 * Finds candidate entry points from real, matchable evidence — a web
 * framework route registration, a CLI-shaped path/shebang, or (as a
 * fallback with lower confidence) a conventional app-bootstrap filename.
 * This is the deterministic layer flow inference builds on: see
 * server/flows/inferFlows.ts. Not a language-server-grade route resolver —
 * a regex scan, same tradeoff as every other analyzer in this pipeline.
 */
export const entryPointAnalyzer: Analyzer<EntryPointAnalyzerOutput> = {
  id: "entry-point-analyzer",
  displayName: "Entry Point Analyzer",
  version: "0.1.0",
  dependsOn: ["structure-analyzer"],
  supports: () => true,
  async run({ snapshot, getDependencyResult }): Promise<AnalyzerResult<EntryPointAnalyzerOutput>> {
    const structure = getDependencyResult<StructureAnalyzerOutput>("structure-analyzer");
    const entryPoints: EntryPointCandidate[] = [];

    if (!structure) {
      return {
        analyzerId: "entry-point-analyzer",
        version: "0.1.0",
        producedAt: new Date().toISOString(),
        data: { entryPoints },
        diagnostics: [{ level: "error", message: "structure-analyzer result unavailable" }],
      };
    }

    const snapshotByPath = new Map(snapshot.files.map((f) => [f.path, f]));
    let counter = 0;
    const seenFiles = new Set<string>();

    for (const file of structure.data.files) {
      if (file.type !== "source" && file.type !== "config") continue;
      // Test fixtures are frequently small standalone scripts with their own
      // shebang line (execa's test suite alone has 140+) — real evidence of
      // "runnable as a subprocess," but not a useful onboarding entry point.
      // Excluded the same way `/test/` paths already are by file type.
      if (/(^|\/)(fixtures?|__fixtures__)(\/|$)/i.test(file.path)) continue;
      const snapshotFile = snapshotByPath.get(file.path);
      if (!snapshotFile || snapshotFile.isBinary) continue;

      const rawContent = await snapshotFile.readContent();
      if (!rawContent) continue;
      const content = stripCLikeComments(rawContent);

      const nextRoute = detectNextRouteHandler(file.path, content);
      if (nextRoute) {
        entryPoints.push({
          id: `entry-${counter++}`,
          type: "http-route",
          name: nextRoute.routePath,
          fileId: file.id,
          detectionEvidence:
            nextRoute.methods.length > 0
              ? `Next.js route handler (${nextRoute.methods.join(", ")}) — path from file location, not a call site`
              : "Next.js route handler file — path from file location, not a call site",
        });
        seenFiles.add(file.id);
        continue;
      }

      // Content-based (React Router's explicit `<Route path="...">`) is
      // checked BEFORE the file-path convention below: "pages/" as a
      // directory name is a plain React Router convention too, not
      // exclusively Next.js, so a file that actually declares a real route
      // should win on that stronger, explicit signal rather than a guess
      // from its directory position.
      let bestPagePath: string | null = null;
      let bestPageFramework: string | null = null;
      for (const { framework, pattern } of FRONTEND_PAGE_PATTERNS) {
        pattern.lastIndex = 0;
        const match = pattern.exec(content);
        if (match) {
          bestPageFramework = framework;
          bestPagePath = match[1];
          break;
        }
      }
      if (bestPageFramework && bestPagePath) {
        entryPoints.push({
          id: `entry-${counter++}`,
          type: "frontend-page",
          name: bestPagePath,
          fileId: file.id,
          detectionEvidence: `Matched a ${bestPageFramework} route declaration — path from the <Route> call site, not necessarily this file's own page component`,
        });
        seenFiles.add(file.id);
        continue;
      }

      const nextPage = detectNextPage(file.path);
      if (nextPage) {
        entryPoints.push({
          id: `entry-${counter++}`,
          type: "frontend-page",
          name: nextPage.routePath,
          fileId: file.id,
          detectionEvidence: "Next.js page file — path from file location, not a call site",
        });
        seenFiles.add(file.id);
        continue;
      }

      let bestPath: string | null = null;
      let bestFramework: string | null = null;
      for (const { framework, pattern } of ROUTE_PATTERNS) {
        pattern.lastIndex = 0;
        const match = pattern.exec(content);
        if (match) {
          bestFramework = framework;
          bestPath = match[1] || null;
          break;
        }
      }

      if (bestFramework) {
        entryPoints.push({
          id: `entry-${counter++}`,
          type: "http-route",
          name: bestPath ? bestPath : file.path.split("/").pop()!,
          fileId: file.id,
          detectionEvidence: `Matched a ${bestFramework} route pattern`,
        });
        seenFiles.add(file.id);
        continue;
      }

      if (SHEBANG_PATTERN.test(rawContent) || CLI_PATH_PATTERN.test(file.path)) {
        entryPoints.push({
          id: `entry-${counter++}`,
          type: "cli-command",
          name: file.path.split("/").pop()!,
          fileId: file.id,
          detectionEvidence: SHEBANG_PATTERN.test(rawContent) ? "File has a shebang line" : "File is under a bin/ or cli/ path",
        });
        seenFiles.add(file.id);
      }
    }

    // Fallback, lower confidence: a conventional bootstrap filename at a
    // shallow path, only when nothing stronger was already found there —
    // naming alone, clearly marked as such.
    const shallowCandidates = structure.data.files
      .filter((f) => !seenFiles.has(f.id) && APP_STARTUP_FILENAME.test(f.path.split("/").pop() ?? ""))
      .sort((a, b) => a.path.split("/").length - b.path.split("/").length);

    if (shallowCandidates.length > 0) {
      const f = shallowCandidates[0];
      entryPoints.push({
        id: `entry-${counter++}`,
        type: "app-startup",
        name: f.path.split("/").pop()!,
        fileId: f.id,
        detectionEvidence: "Conventional entry-point filename (index/main/server/app) — naming heuristic only",
      });
    }

    return {
      analyzerId: "entry-point-analyzer",
      version: "0.1.0",
      producedAt: new Date().toISOString(),
      data: { entryPoints },
      diagnostics: [],
    };
  },
};
