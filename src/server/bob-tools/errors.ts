/**
 * Thrown whenever a Bob tool call references an id/path that doesn't exist
 * in the deterministic Repository Knowledge Model. This is the enforcement
 * point for the hard invariant carried over from the Flow system: Bob (or
 * any MCP client) can never make CodeBiome act on, or receive information
 * about, an entity that isn't real. Tool handlers surface this as an MCP
 * tool error, not a thrown exception that looks like a server fault, so Bob
 * sees "no such module" rather than a stack trace.
 */
export class EntityNotFoundError extends Error {
  constructor(kind: string, id: string) {
    super(`No ${kind} "${id}" was found in this repository's analysis.`);
    this.name = "EntityNotFoundError";
  }
}

export class InvalidToolArgumentsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidToolArgumentsError";
  }
}
