"use client";

import { useEffect, useState } from "react";
import type { RepositoryKnowledgeModel, ModuleFact } from "@/types/knowledge-model";
import { bobClient, BobNotConnectedError, type BobContext, type BobResponse } from "@/types/bob";

/**
 * The Bob tab. There is no real Bob integration in this vertical slice
 * (Step 14) — this deliberately does NOT fabricate an AI explanation.
 * It builds the real `BobContext` that a connected Bob would receive, calls
 * the interface, and renders the resulting "not connected" state — proving
 * the grounding data is real and the interface works end to end, without
 * pretending a model answered.
 */
export function BobPanel({
  knowledgeModel,
  mod,
  moduleById,
  flowContext,
}: {
  knowledgeModel: RepositoryKnowledgeModel;
  mod: ModuleFact;
  moduleById: Map<string, ModuleFact>;
  flowContext?: BobContext["flowContext"];
}) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "not-connected"; context: BobContext } | { status: "answered"; response: BobResponse }
  >({ status: "loading" });

  useEffect(() => {
    const context: BobContext = {
      repositoryId: knowledgeModel.meta.repositoryId,
      selectedEntity: { id: mod.id, kind: "module", name: mod.name },
      relevantFacts: {
        importance: mod.importance,
        centrality: mod.centrality,
        linesOfCode: mod.complexity.linesOfCode,
        risk: mod.risk,
      },
      dependencies: mod.dependencyIds.map((id) => ({ id, name: moduleById.get(id)?.name ?? id })),
      dependents: mod.dependentIds.map((id) => ({ id, name: moduleById.get(id)?.name ?? id })),
      dataFlow: [],
      flowContext: flowContext ?? null,
    };

    bobClient
      .ask(context, `Explain ${mod.name}`)
      .then((response) => setState({ status: "answered", response }))
      .catch((error) => {
        if (error instanceof BobNotConnectedError) setState({ status: "not-connected", context });
        else setState({ status: "not-connected", context });
      });
  }, [knowledgeModel.meta.repositoryId, mod, moduleById, flowContext]);

  if (state.status === "loading") return null;

  if (state.status === "answered") {
    return (
      <div className="space-y-2 rounded-lg border border-periwinkle/25 bg-periwinkle/[0.06] p-4 text-sm">
        <p className="text-[13px] leading-relaxed text-[#EDEFF5]">{state.response.explanation}</p>
      </div>
    );
  }

  const { context } = state;
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-periwinkle/25 bg-periwinkle/[0.06] p-4">
        <div className="mb-2 flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-periwinkle text-[10px] font-bold text-biome-bg">
            B
          </div>
          <span className="text-xs font-semibold text-periwinkle-pale">Bob</span>
        </div>
        <p className="text-[13px] leading-relaxed text-[#EDEFF5]">
          Bob isn&apos;t connected in this build. This vertical slice ships the interface only — see{" "}
          <code className="font-mono text-periwinkle-light">src/types/bob.ts</code> — so the real integration can be
          dropped in without touching this UI.
        </p>
      </div>

      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[1.4px] text-ink-muted">
          What Bob would receive (real, grounded data)
        </div>
        <dl className="grid grid-cols-2 gap-2 text-[12px]">
          <Fact label="Importance" value={context.relevantFacts.importance.toFixed(2)} />
          <Fact label="Centrality" value={context.relevantFacts.centrality.toFixed(2)} />
          <Fact label="Lines of code" value={String(context.relevantFacts.linesOfCode)} />
          <Fact label="Risk indicators" value={String(context.relevantFacts.risk.length)} />
          <Fact label="Dependencies" value={String(context.dependencies.length)} />
          <Fact label="Dependents" value={String(context.dependents.length)} />
          {context.flowContext && (
            <Fact label="Active flow step" value={`${context.flowContext.flow.name} (${context.flowContext.currentStep.kind})`} />
          )}
        </dl>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-white/[0.04] px-2.5 py-2">
      <div className="text-ink-muted">{label}</div>
      <div className="font-medium text-ink-primary">{value}</div>
    </div>
  );
}
