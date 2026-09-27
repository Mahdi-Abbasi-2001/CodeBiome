"use client";

import { useCallback, useEffect, useState } from "react";
import type { WorldSnapshot, WorldMutableState } from "@/types/world";
import { EMPTY_WORLD_MUTABLE_STATE } from "@/types/world";
import { ArchitectureDiagram } from "@/features/world/ArchitectureDiagram";
import { OnboardingDiagram } from "@/features/world/OnboardingDiagram";
import { FlowDiagram } from "@/features/world/FlowDiagram";
import { HealthDiagram } from "@/features/world/HealthDiagram";
import { PlanDiagram } from "@/features/world/PlanDiagram";
import { DomainView } from "@/features/world/DomainView";
import type { WorldLens } from "@/features/world/WorldHud";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; snapshot: WorldSnapshot; mutableState: WorldMutableState };
type View = { kind: "lens"; lens: WorldLens } | { kind: "domain"; domainId: string };

const VALID_LENSES: WorldLens[] = ["architecture", "onboarding", "flow", "health", "plan"];

export default function WorldPage({ params, searchParams }: { params: { worldId: string }; searchParams: { lens?: string } }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const initialLens = VALID_LENSES.includes(searchParams.lens as WorldLens) ? (searchParams.lens as WorldLens) : "architecture";
  const [view, setView] = useState<View>({ kind: "lens", lens: initialLens });

  const load = useCallback(async () => {
    const res = await fetch(`/api/world/${params.worldId}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
    return { snapshot: body.snapshot as WorldSnapshot, mutableState: (body.mutableState as WorldMutableState) ?? EMPTY_WORLD_MUTABLE_STATE };
  }, [params.worldId]);

  useEffect(() => {
    let cancelled = false;
    load()
      .then(({ snapshot, mutableState }) => {
        if (!cancelled) setState({ kind: "ready", snapshot, mutableState });
      })
      .catch((err) => {
        if (!cancelled) setState({ kind: "error", message: err instanceof Error ? err.message : "Failed to load world" });
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const refresh = useCallback(async () => {
    const { snapshot, mutableState } = await load();
    setState({ kind: "ready", snapshot, mutableState });
  }, [load]);

  if (state.kind === "loading") {
    return (
      <div style={{ minHeight: "100vh", background: "#0A0D12", color: "#9CA6AC", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'IBM Plex Mono',monospace", fontSize: 13 }}>
        Loading world…
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div style={{ minHeight: "100vh", background: "#0A0D12", color: "#F3F1EA", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12, fontFamily: "'IBM Plex Sans',sans-serif" }}>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Couldn&apos;t load this world</div>
        <div style={{ fontSize: 13, color: "#9CA6AC", fontFamily: "'IBM Plex Mono',monospace" }}>{state.message}</div>
      </div>
    );
  }

  if (view.kind === "domain") {
    return <DomainView snapshot={state.snapshot} domainId={view.domainId} onZoomOut={() => setView({ kind: "lens", lens: "architecture" })} />;
  }

  const onSelectLens = (lens: WorldLens) => setView({ kind: "lens", lens });
  const onEnterDomain = (domainId: string) => setView({ kind: "domain", domainId });

  if (view.lens === "onboarding") {
    return (
      <OnboardingDiagram
        snapshot={state.snapshot}
        journeys={state.mutableState.onboardingJourneys}
        onSelectLens={onSelectLens}
        onEnterDomain={onEnterDomain}
        onRefresh={refresh}
      />
    );
  }

  if (view.lens === "flow") {
    return <FlowDiagram snapshot={state.snapshot} onSelectLens={onSelectLens} />;
  }

  if (view.lens === "health") {
    return <HealthDiagram snapshot={state.snapshot} onSelectLens={onSelectLens} onEnterDomain={onEnterDomain} />;
  }

  if (view.lens === "plan") {
    return (
      <PlanDiagram
        snapshot={state.snapshot}
        featurePlans={state.mutableState.featurePlans}
        onSelectLens={onSelectLens}
        onEnterDomain={onEnterDomain}
        onRefresh={refresh}
      />
    );
  }

  return <ArchitectureDiagram snapshot={state.snapshot} onEnterDomain={onEnterDomain} onSelectLens={onSelectLens} />;
}
