import { describe, it, expect } from "vitest";
import { entryPointAnalyzer, type EntryPointAnalyzerOutput } from "./entry-point-analyzer";
import { fakeSnapshot, runWithStructure } from "@/server/testing/fixtures";

async function entryPointsFor(files: Record<string, string>) {
  const snapshot = fakeSnapshot(files);
  const run = await runWithStructure(snapshot, entryPointAnalyzer);
  const result = run.results.get("entry-point-analyzer") as { data: EntryPointAnalyzerOutput } | undefined;
  return result?.data.entryPoints ?? [];
}

describe("entry-point-analyzer", () => {
  it("detects an Express route registration (existing behavior, unaffected by the Next.js fix)", async () => {
    const entryPoints = await entryPointsFor({
      "src/index.js": `const app = require('express')();\napp.get('/api/orders', () => {});\n`,
    });
    expect(entryPoints).toContainEqual(
      expect.objectContaining({ type: "http-route", name: "/api/orders", detectionEvidence: expect.stringContaining("Express-style") })
    );
  });

  // Next.js App Router route handlers (app/**/route.ts) don't register a
  // route with any in-content call — the file's own path IS the route, and
  // HTTP methods are named exports. No existing ROUTE_PATTERNS regex could
  // ever match this shape, which is the real gap this analyzer had until
  // it was found via live testing against a real Next.js repository (see
  // docs/BOB_INTEGRATION.md).
  describe("Next.js App Router (app/**/route.ts)", () => {
    it("detects a route handler and reconstructs its real URL path from the file location", async () => {
      const entryPoints = await entryPointsFor({
        "src/app/api/chat/route.ts": `export async function POST(req: Request) {\n  return new Response("ok");\n}\n`,
      });
      expect(entryPoints).toContainEqual(
        expect.objectContaining({ type: "http-route", name: "/api/chat", detectionEvidence: expect.stringContaining("POST") })
      );
    });

    it("detects multiple exported HTTP methods on the same route file", async () => {
      const entryPoints = await entryPointsFor({
        "src/app/api/health/route.ts": `export async function GET() { return new Response("ok"); }\nexport async function HEAD() { return new Response(null); }\n`,
      });
      const entry = entryPoints.find((e) => e.name === "/api/health");
      expect(entry?.detectionEvidence).toContain("GET");
      expect(entry?.detectionEvidence).toContain("HEAD");
    });

    it("filters out organizational route groups — they never appear in the real URL", async () => {
      const entryPoints = await entryPointsFor({
        "src/app/(marketing)/about/route.ts": `export async function GET() { return new Response("ok"); }\n`,
      });
      expect(entryPoints).toContainEqual(expect.objectContaining({ name: "/about" }));
    });

    it("reconstructs the root path for a top-level app/route.ts", async () => {
      const entryPoints = await entryPointsFor({
        "app/route.ts": `export async function GET() { return new Response("ok"); }\n`,
      });
      expect(entryPoints).toContainEqual(expect.objectContaining({ name: "/" }));
    });

    it("does not mistake a page.tsx (not a route handler) for an HTTP entry point", async () => {
      const entryPoints = await entryPointsFor({
        "src/app/about/page.tsx": `export default function AboutPage() { return null; }\n`,
      });
      expect(entryPoints.find((e) => e.type === "http-route")).toBeUndefined();
    });
  });

  describe("Next.js Pages Router (pages/api/**)", () => {
    it("detects a Pages Router API route and prefixes it with /api/", async () => {
      const entryPoints = await entryPointsFor({
        "pages/api/chat.ts": `export default function handler(req, res) { res.json({}); }\n`,
      });
      expect(entryPoints).toContainEqual(expect.objectContaining({ type: "http-route", name: "/api/chat" }));
    });

    it("preserves nested segments and dynamic route brackets", async () => {
      const entryPoints = await entryPointsFor({
        "pages/api/user/[id].ts": `export default function handler(req, res) { res.json({}); }\n`,
      });
      expect(entryPoints).toContainEqual(expect.objectContaining({ name: "/api/user/[id]" }));
    });
  });

  it("still falls back to the app-startup naming heuristic when nothing stronger is found", async () => {
    const entryPoints = await entryPointsFor({
      "src/index.js": `console.log('booting');\n`,
    });
    expect(entryPoints).toContainEqual(expect.objectContaining({ type: "app-startup", name: "index.js" }));
  });

  it("excludes shebang scripts under a fixtures/ directory (execa-style test fixtures)", async () => {
    const entryPoints = await entryPointsFor({
      "test/fixtures/noop.js": `#!/usr/bin/env node\nprocess.exit(0);\n`,
    });
    expect(entryPoints).toEqual([]);
  });
});
