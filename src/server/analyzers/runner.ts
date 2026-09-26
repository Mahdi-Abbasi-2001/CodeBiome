import type { Analyzer, AnalyzerResult } from "./types";
import type { AnalyzerRegistry } from "./registry";
import type { RepositorySnapshot } from "../ingestion/types";

export interface AnalyzerRunSummary {
  results: Map<string, AnalyzerResult>;
  failures: { analyzerId: string; error: string }[];
}

export interface AnalyzerRunHooks {
  onAnalyzerStart?: (analyzerId: string) => void;
  onAnalyzerDone?: (analyzerId: string, result: AnalyzerResult) => void;
  onAnalyzerError?: (analyzerId: string, error: string) => void;
}

/** Groups the registry's topological order into "waves": each wave is every
 *  analyzer whose declared dependencies are all satisfied by a strictly
 *  earlier wave, so everything in one wave is safe to run concurrently. With
 *  structure-analyzer as the only dependency of all 9+ language-specific
 *  dependency analyzers, this collapses to two waves in practice — wave 1 is
 *  just structure-analyzer, wave 2 is every dependency/security analyzer
 *  running in parallel instead of one after another. */
function buildWaves(order: Analyzer[]): Analyzer[][] {
  const waves: Analyzer[][] = [];
  const placed = new Set<string>();
  let remaining = [...order];

  while (remaining.length > 0) {
    const wave = remaining.filter((a) => (a.dependsOn ?? []).every((d) => placed.has(d)));
    if (wave.length === 0) {
      // Shouldn't happen — getExecutionOrder() already validates the
      // dependency graph — but never spin forever if it somehow does.
      waves.push(remaining);
      break;
    }
    waves.push(wave);
    for (const a of wave) placed.add(a.id);
    remaining = remaining.filter((a) => !wave.includes(a));
  }

  return waves;
}

/**
 * Runs analyzers wave-by-wave: independent analyzers within a wave run
 * concurrently via `Promise.all`, and one analyzer throwing is recorded as a
 * failure without aborting the others — see docs/ANALYZER_ARCHITECTURE.md
 * §3. Optional hooks let a caller (e.g. the streaming API route) surface
 * real per-analyzer progress without the runner knowing anything about HTTP.
 */
export async function runAnalyzers(
  snapshot: RepositorySnapshot,
  registry: AnalyzerRegistry,
  hooks: AnalyzerRunHooks = {}
): Promise<AnalyzerRunSummary> {
  const waves = buildWaves(registry.getExecutionOrder());
  const results = new Map<string, AnalyzerResult>();
  const failures: { analyzerId: string; error: string }[] = [];

  for (const wave of waves) {
    await Promise.all(
      wave.map(async (analyzer) => {
        if (!analyzer.supports(snapshot)) return;
        hooks.onAnalyzerStart?.(analyzer.id);
        try {
          const result = await analyzer.run({
            snapshot,
            getDependencyResult: <T>(id: string) => results.get(id) as AnalyzerResult<T> | undefined,
          });
          results.set(analyzer.id, result);
          hooks.onAnalyzerDone?.(analyzer.id, result);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          failures.push({ analyzerId: analyzer.id, error: message });
          hooks.onAnalyzerError?.(analyzer.id, message);
        }
      })
    );
  }

  return { results, failures };
}
