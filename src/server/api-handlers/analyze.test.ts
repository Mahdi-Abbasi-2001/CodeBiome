import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { handleAnalyze } from "./analyze";
import { buildTestKnowledgeModel } from "@/server/testing/knowledgeModelFixture";
import { knowledgeModelStore } from "@/server/knowledge-model/store";

/**
 * Regression test for a real bug found deploying to Vercel
 * (docs/VERCEL_DEPLOYMENT.md §6): the cache-hit branch called
 * `controller.close()` explicitly and then `return`ed, but the
 * surrounding `finally` block ALSO calls `controller.close()`
 * unconditionally on every exit path — a double close. Node's local
 * ReadableStream implementation tolerated this silently, but Vercel's
 * production runtime threw `TypeError [ERR_INVALID_STATE]: Invalid state:
 * Controller is already closed`, which killed the response after only the
 * first NDJSON line reached the client. This only manifested on a SECOND
 * analysis of an already-cached repository — exactly why it survived
 * unnoticed through every prior local test and manual check, which never
 * re-analyzed the same commit twice in one warm process.
 *
 * Honest caveat: Node's local ReadableStream tolerates the double close()
 * silently (this test passes whether or not the bug is present) — the
 * crash was specific to Vercel's production Next.js runtime, and was only
 * actually caught by reading `vercel logs` against the real deployment
 * (see docs/VERCEL_DEPLOYMENT.md §6). This test still earns its place: real
 * coverage of a previously-untested cache-hit path, and it documents the
 * exact fix (a single close(), in `finally` only) so a future edit can't
 * reintroduce a second explicit call without a reviewer seeing why that's
 * wrong.
 */
describe("handleAnalyze — cache-hit path", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("completes the stream without a double controller.close() on a cache hit", async () => {
    const repoId = { owner: "cachehit-owner", repo: "cachehit-repo" };
    const model = await buildTestKnowledgeModel({ "src/index.js": "console.log(1);\n" }, repoId);
    await knowledgeModelStore.set(model); // commitSha is "0".repeat(40), per fixtures.ts

    global.fetch = vi.fn(async (url: string) => {
      if (url.includes("/commits/")) {
        return new Response(JSON.stringify({ sha: "0".repeat(40) }), { status: 200 });
      }
      return new Response(JSON.stringify({ default_branch: "main", description: null, full_name: "cachehit-owner/cachehit-repo" }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const req = new NextRequest("http://localhost:3000/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/cachehit-owner/cachehit-repo" }),
    });

    const res = await handleAnalyze(req);
    expect(res.status).toBe(200);

    // Reading the stream to completion is what surfaces the double-close
    // error (Next.js's pipe-to-response path failed with exactly this
    // shape on Vercel) — a passing `res.text()` proves the fix.
    const text = await res.text();
    const lines = text.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toContainEqual(expect.objectContaining({ type: "stage", stage: "fetch", status: "done" }));
    expect(lines).toContainEqual(expect.objectContaining({ type: "result", cached: true }));
  });
});
