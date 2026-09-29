/** @type {import('next').NextConfig} */
const nextConfig = {
  // Works around a real Next.js 14.2.35 output-file-tracing defect found
  // during Vercel deployment investigation (docs/VERCEL_DEPLOYMENT.md has
  // the full writeup): for ONE Node.js-runtime API route per build — which
  // one is not determined by anything in this project's own code, it moved
  // between routes across otherwise-identical rebuilds — Next.js's own
  // `@vercel/nft`-based trace incorrectly lists build-time-only artifacts
  // that never exist in a normal (non-`next export`) build:
  // `.next/export-detail.json`, `.next/export/404.html`, `.next/export/500.html`,
  // and `.next/cache/webpack/**/*.pack`. `@vercel/next`'s builder does an
  // unguarded `lstat` on every traced file and crashes with ENOENT the
  // moment it hits one of these. This is Next.js's own official, documented
  // mechanism for correcting an over-inclusive trace — not a suppression
  // hack — applied globally (`/*`) since the affected route isn't fixed.
  experimental: {
    outputFileTracingExcludes: {
      "/*": [".next/export-detail.json", ".next/export/**/*", ".next/cache/webpack/**/*"],
    },
  },
  // Maps the state-sharing API endpoints onto one route family
  // (src/app/api/bridge/[target]/route.ts) so they compile to a single
  // Vercel Function — see that file's doc comment and
  // docs/VERCEL_DEPLOYMENT.md. External URLs are unchanged. Uses a PATH
  // segment (`/api/bridge/<target>`), not a `?target=` query destination —
  // the query-destination form worked on real Vercel but was found not to
  // reliably propagate under `next start` (see the route file's doc
  // comment). The original request's own query string (e.g.
  // `/api/agent-events?worldId=...`) is still forwarded automatically.
  async rewrites() {
    return [
      { source: "/api/mcp", destination: "/api/bridge/mcp" },
      { source: "/api/analyze", destination: "/api/bridge/analyze" },
      { source: "/api/demo-agent", destination: "/api/bridge/demo-agent" },
      { source: "/api/session-context", destination: "/api/bridge/session-context" },
      { source: "/api/agent-events", destination: "/api/bridge/agent-events" },
    ];
  },
};

export default nextConfig;
