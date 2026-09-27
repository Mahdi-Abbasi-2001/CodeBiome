import type { FlowStepKind } from "@/types/flow";

/**
 * A file's likely architectural layer, guessed from its path/name alone —
 * naming is supporting evidence only, never treated as equivalent to a real
 * dependency edge. Used by src/lib/buildingRoles.ts (Domain View's building
 * classification) and previously also by the analyzer-era flow inference;
 * kept as its own small, pure, path-only function since it needs nothing
 * else from that removed pipeline.
 */
const LAYER_PATTERNS: { kind: FlowStepKind; pattern: RegExp }[] = [
  { kind: "controller", pattern: /(^|[/_.-])controllers?([/_-]|\.|$)/i },
  { kind: "handler", pattern: /(^|[/_.-])handlers?([/_-]|\.|$)/i },
  { kind: "service", pattern: /(^|[/_.-])services?([/_-]|\.|$)/i },
  { kind: "repository", pattern: /(^|[/_.-])(repositor(y|ies)|dao)([/_-]|\.|$)/i },
  { kind: "entity", pattern: /(^|[/_.-])(entit(y|ies)|models?)([/_-]|\.|$)/i },
  { kind: "database", pattern: /(^|[/_.-])(db|database|schemas?|prisma|migrations?)([/_-]|\.|$)/i },
  { kind: "external-api", pattern: /(^|[/_.-])client\.[^/]+$|(^|[/_.-])clients([/_-]|\.|$)|(^|[/_.-])(sdk|integrations?)([/_-]|\.|$)/i },
  { kind: "event", pattern: /(^|[/_.-])(events?|emitter|pubsub|queue|producer|consumer)([/_-]|\.|$)/i },
];

export function classifyLayer(path: string): FlowStepKind {
  for (const { kind, pattern } of LAYER_PATTERNS) if (pattern.test(path)) return kind;
  return "function";
}
