/**
 * Resolves this deployment's own public base URL, so a World URL the agent hands
 * back to a developer always points at wherever CodeBiome actually is —
 * never hardcoded (docs/WORLD_ARCHITECTURE.md).
 *
 * Precedence: an explicit override, then Vercel's own stable production
 * domain (set automatically on every deployment — not the per-deployment
 * preview URL, which would break the agent's link on the next redeploy), then
 * Vercel's general deployment URL (covers preview deployments too), then
 * localhost for `npm run dev`/`npm run start`.
 */
export function getAppBaseUrl(): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/+$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export function worldUrl(worldId: string): string {
  return `${getAppBaseUrl()}/world/${worldId}`;
}
