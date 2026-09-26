"use client";

import { useEffect, useState } from "react";
import { WorldExperience } from "@/features/world-experience/WorldExperience";
import type { WorldSnapshot, WorldMutableState } from "@/types/world";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; snapshot: WorldSnapshot; mutableState: WorldMutableState };

/**
 * `/world/{worldId}` — the World URL (docs/WORLD_ARCHITECTURE.md) either
 * entry point produces: Bob's `analyze_repository` MCP tool, or the
 * browser's own manual "paste a GitHub URL" flow (src/app/page.tsx). Opening
 * this URL reconstructs the whole CodeBiome experience from the World id
 * alone — no GitHub URL re-entry, no dependency on whichever server process
 * originally ran the analysis (the World is read from `worldStore`, durable
 * across Vercel instances — see docs/VERCEL_DEPLOYMENT.md §3 for why that
 * matters).
 */
export default function WorldPage({ params }: { params: { worldId: string } }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/world/${encodeURIComponent(params.worldId)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setState({ status: "error", message: body.error ?? `This World could not be loaded (HTTP ${res.status}).` });
          return;
        }
        const body = await res.json();
        setState({ status: "ready", snapshot: body.snapshot, mutableState: body.mutableState });
      })
      .catch((err) => {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : "Failed to load this World." });
      });
    return () => {
      cancelled = true;
    };
  }, [params.worldId]);

  if (state.status === "loading") {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-biome-bg text-ink-muted">
        Loading CodeBiome world…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-biome-bg px-6 text-center text-ink-primary">
        <div className="font-display text-xl font-semibold text-ink-bright">World not found</div>
        <p className="max-w-md text-sm text-ink-muted">{state.message}</p>
        <a href="/" className="mt-2 rounded-md bg-teal px-4 py-2 text-sm font-semibold text-biome-bg">
          Analyze a repository
        </a>
      </div>
    );
  }

  const { snapshot, mutableState } = state;
  return (
    <WorldExperience
      worldId={snapshot.world.id}
      owner={snapshot.knowledgeModel.repository.owner}
      repo={snapshot.knowledgeModel.repository.name}
      knowledgeModel={snapshot.knowledgeModel}
      worldModel={snapshot.worldModel}
      flowModel={snapshot.flowModel}
      initialDomainConcepts={mutableState.domainConcepts.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        relatedModuleIds: c.relatedModuleIds,
        relatedFileIds: c.relatedFileIds,
        confidence: c.provenance.confidence,
      }))}
      initialOnboardingJourneys={mutableState.onboardingJourneys}
    />
  );
}
