import type { Analyzer } from "./types";

export class AnalyzerRegistry {
  private analyzers = new Map<string, Analyzer>();

  register(analyzer: Analyzer): void {
    if (this.analyzers.has(analyzer.id)) {
      throw new Error(`Analyzer "${analyzer.id}" is already registered`);
    }
    this.analyzers.set(analyzer.id, analyzer);
  }

  getAll(): Analyzer[] {
    return [...this.analyzers.values()];
  }

  /** Topological sort by `dependsOn`. Throws on cycles or missing dependencies. */
  getExecutionOrder(): Analyzer[] {
    const visited = new Set<string>();
    const order: Analyzer[] = [];

    const visit = (analyzer: Analyzer, stack: string[]): void => {
      if (visited.has(analyzer.id)) return;
      if (stack.includes(analyzer.id)) {
        throw new Error(`Analyzer dependency cycle detected: ${[...stack, analyzer.id].join(" -> ")}`);
      }
      for (const depId of analyzer.dependsOn ?? []) {
        const dep = this.analyzers.get(depId);
        if (!dep) throw new Error(`Analyzer "${analyzer.id}" depends on unknown analyzer "${depId}"`);
        visit(dep, [...stack, analyzer.id]);
      }
      visited.add(analyzer.id);
      order.push(analyzer);
    };

    for (const analyzer of this.analyzers.values()) visit(analyzer, []);
    return order;
  }
}
