import { randomBytes } from "node:crypto";

/**
 * Opaque World IDs (docs/WORLD_ARCHITECTURE.md). 9 random bytes, base64url
 * encoded — 12 URL-safe characters, ~72 bits of entropy. Not a security
 * boundary (per the brief: a World ID is not authorization, just an
 * unguessable-enough handle for a hackathon prototype), just difficult to
 * enumerate or guess by accident.
 */
export function createWorldId(): string {
  return randomBytes(9).toString("base64url");
}
