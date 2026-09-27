"use client";

import { useEffect, useMemo, useState } from "react";
import type { WorldSnapshot } from "@/types/world";
import type { FeaturePlan, FeaturePlanStep, FeaturePlanStepKind, ImpactedEntity } from "@/types/featurePlan";
import type { ConfidenceLevel } from "@/types/flow";
import { computeDomains, type Domain } from "@/lib/domains";
import { computeInfrastructureNodes, type InfraNode } from "@/lib/infrastructure";
import { CodeViewer } from "./CodeViewer";
import { ForestBackdrop } from "./ForestBackdrop";
import { WorldHud, type WorldLens } from "./WorldHud";
import { StepGlyph, softColor, TEAL, AMBER, INDIGO, PURPLE, CORAL, SKYBLUE, NEUTRAL, GHOST, INK } from "./StepGlyph";

/**
 * The one AI-INTERPRETED tab (see src/server/plan/validateFeaturePlan.ts's
 * doc comment) — everything else in this app is a statically reconstructed
 * fact. Unlike Flow/Journey, this app never generates a plan itself: the agent
 * (an external MCP client — a developer's own IDE session) proposes it via
 * `propose_feature_plan` while answering the developer directly, and this
 * tab is purely a VIEWER for what's already been stored and validated. The
 * UI must never let a proposed step/file read as if it were real detected
 * code: "new" steps render dashed/ghost, the page-level badge never claims
 * certainty.
 */

const STEP_KIND_META: Record<FeaturePlanStepKind, { shape: import("./StepGlyph").StepShape; color: string }> = {
  page: { shape: "entry", color: TEAL },
  entry: { shape: "entry", color: TEAL },
  controller: { shape: "hex", color: INDIGO },
  handler: { shape: "hex", color: INDIGO },
  service: { shape: "hex", color: INDIGO },
  entity: { shape: "card", color: AMBER },
  function: { shape: "box", color: NEUTRAL },
  repository: { shape: "vault", color: PURPLE },
  database: { shape: "cylinder", color: TEAL },
  "external-api": { shape: "external", color: CORAL },
  event: { shape: "rings", color: SKYBLUE },
  unknown: { shape: "box", color: NEUTRAL },
};

const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = { high: "high confidence", medium: "medium confidence", low: "low confidence" };

const STEP_W = 132;
const STEP_H = 84;
const GAP_X = 96;

function layoutSteps(count: number) {
  const positions = Array.from({ length: count }, (_, i) => i * (STEP_W + GAP_X));
  const width = count > 0 ? count * STEP_W + (count - 1) * GAP_X : 0;
  return { positions, width: width + 40 };
}

type Selected = { kind: "step"; step: FeaturePlanStep } | { kind: "entity"; entity: ImpactedEntity } | null;

/**
 * Pure client-side heuristics grounded in this repository's real detected
 * infra/domains — no LLM call, no invented technology. These are things to
 * ask the agent, not a local form to submit — see the tab's empty state.
 */
function suggestFeatures(domains: Domain[], infraNodes: InfraNode[]): string[] {
  const suggestions: string[] = [];
  const byCategory = (cat: InfraNode["category"]) => infraNodes.filter((n) => n.category === cat);

  for (const n of byCategory("external-api")) suggestions.push(`Add webhook handling for ${n.name} events`);
  for (const n of byCategory("queue")) suggestions.push(`Add a background job queued through ${n.name}`);
  for (const n of byCategory("cache")) suggestions.push(`Add response caching using ${n.name}`);
  for (const n of byCategory("search")) suggestions.push(`Add full-text search using ${n.name}`);

  const realDomain = domains.find((d) => !d.isInfra);
  if (byCategory("database").length > 0 && realDomain) suggestions.push(`Add a comments feature to ${realDomain.name}`);

  suggestions.push("Add user authentication with email and password");
  suggestions.push("Add rate limiting to the API");

  return suggestions.slice(0, 5);
}

export function PlanDiagram({
  snapshot,
  featurePlans,
  onSelectLens,
  onEnterDomain,
  onRefresh,
}: {
  snapshot: WorldSnapshot;
  featurePlans: FeaturePlan[];
  onSelectLens: (lens: WorldLens) => void;
  onEnterDomain?: (domainId: string) => void;
  onRefresh?: () => Promise<void>;
}) {
  const { knowledgeModel, worldModel } = snapshot;
  const [repoOwner, repoName] = knowledgeModel.meta.repositoryId.split("/");
  const repoRef = knowledgeModel.meta.commitSha;

  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(featurePlans[0]?.id ?? null);
  const [selected, setSelected] = useState<Selected>(null);
  const [viewingFilePath, setViewingFilePath] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!selectedPlanId && featurePlans.length > 0) setSelectedPlanId(featurePlans[0].id);
  }, [featurePlans, selectedPlanId]);

  const domains = useMemo(() => computeDomains(worldModel, knowledgeModel), [worldModel, knowledgeModel]);
  const infraNodes = useMemo(() => computeInfrastructureNodes(knowledgeModel, domains), [knowledgeModel, domains]);
  const applicationDomains = useMemo(() => domains.filter((d) => !d.isInfra).slice(0, 6), [domains]);
  const dataInfra = useMemo(() => infraNodes.filter((n) => n.category !== "frontend").slice(0, 6), [infraNodes]);
  const suggestions = useMemo(() => suggestFeatures(domains, infraNodes), [domains, infraNodes]);

  const plan = featurePlans.find((p) => p.id === selectedPlanId) ?? null;

  function selectPlan(id: string) {
    setSelectedPlanId(id);
    setSelected(null);
    setViewingFilePath(null);
  }

  function selectStep(step: FeaturePlanStep) {
    setViewingFilePath(null);
    setSelected((cur) => (cur?.kind === "step" && cur.step.id === step.id ? null : { kind: "step", step }));
  }

  function selectEntity(entity: ImpactedEntity) {
    setViewingFilePath(null);
    setSelected((cur) => (cur?.kind === "entity" && cur.entity.id === entity.id ? null : { kind: "entity", entity }));
  }

  async function handleRefresh() {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  async function copySuggestion(s: string, i: number) {
    // Clipboard access can fail (permissions, insecure context) — the pill's own text is
    // always readable for a manual copy, so the click is acknowledged either way.
    try {
      await navigator.clipboard.writeText(s);
    } catch {
      // ignored — see comment above
    }
    setCopiedIndex(i);
    setTimeout(() => setCopiedIndex((cur) => (cur === i ? null : cur)), 1500);
  }

  const { positions: stepX, width: stepsWidth } = useMemo(() => layoutSteps(plan?.steps.length ?? 0), [plan]);
  const impactedIds = useMemo(() => new Set((plan?.impactedEntities ?? []).map((e) => e.id)), [plan]);
  const impactMapHeight = Math.max(applicationDomains.length, dataInfra.length, 1) * 96 + 30;

  if (featurePlans.length === 0) {
    return (
      <div style={{ position: "relative", minHeight: "100vh", overflow: "hidden", background: "#0A0D12", color: "#F3F1EA" }}>
        <ForestBackdrop />
        <WorldHud repoName={knowledgeModel.repository.name} activeLens="plan" onSelectLens={onSelectLens} />
        <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: "88px 24px 24px", textAlign: "center" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontFamily: "'IBM Plex Mono',monospace",
              fontSize: 10,
              letterSpacing: 1,
              color: GHOST,
              background: "rgba(255,255,255,0.04)",
              border: `0.5px dashed ${GHOST}80`,
              borderRadius: 999,
              padding: "4px 10px",
              marginBottom: 18,
            }}
          >
            AI-SUGGESTED — proposed by the agent, not verified, not yet built
          </div>
          <h1 style={{ fontFamily: "'Space Grotesk',system-ui,sans-serif", fontSize: 20, fontWeight: 600, margin: "0 0 10px" }}>No feature plans yet</h1>
          <p style={{ fontSize: 13.5, color: "#9CA6AC", maxWidth: 440, lineHeight: 1.6, margin: "0 0 28px" }}>
            Ask the agent about a feature in your IDE — e.g. &quot;how would I implement a wishlist in this repo?&quot; — and the plan it proposes will show up here automatically.
          </p>
          {onRefresh && (
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "0.5px solid rgba(255,255,255,0.14)",
                borderRadius: 9,
                padding: "8px 18px",
                fontSize: 12.5,
                color: "#B7BDC3",
                fontFamily: "'IBM Plex Sans',sans-serif",
                cursor: refreshing ? "default" : "pointer",
                marginBottom: 32,
              }}
            >
              {refreshing ? "Checking…" : "Check again →"}
            </button>
          )}
          {suggestions.length > 0 && (
            <div style={{ maxWidth: 480 }}>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9.5, letterSpacing: 1, color: "#6B7580", marginBottom: 10 }}>THINGS YOU COULD ASK BOB</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => copySuggestion(s, i)}
                    title="Copy"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      border: "0.5px solid rgba(255,255,255,0.12)",
                      borderRadius: 999,
                      padding: "6px 14px",
                      fontSize: 12,
                      color: copiedIndex === i ? TEAL : "#B7BDC3",
                      fontFamily: "'IBM Plex Sans',sans-serif",
                      cursor: "pointer",
                    }}
                  >
                    {copiedIndex === i ? "Copied ✓" : s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", minHeight: "100vh", overflow: "hidden", background: "#0A0D12", color: "#F3F1EA" }}>
      <ForestBackdrop />
      <WorldHud repoName={knowledgeModel.repository.name} activeLens="plan" onSelectLens={onSelectLens} />

      {pickerOpen ? (
        <div style={{ position: "absolute", left: 24, top: 82, width: 270, maxHeight: "calc(100vh - 180px)", overflowY: "auto", zIndex: 1, background: "rgba(18,23,29,0.82)", border: "0.5px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "14px 12px", backdropFilter: "blur(6px)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, padding: "0 4px" }}>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: 1.2, color: TEAL }}>
              {featurePlans.length} FEATURE PLAN{featurePlans.length === 1 ? "" : "S"}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {onRefresh && (
                <button onClick={handleRefresh} disabled={refreshing} aria-label="Check for new plans" style={{ background: "transparent", border: 0, color: "#6B7580", cursor: refreshing ? "default" : "pointer", fontSize: 12 }}>
                  {refreshing ? "…" : "↻"}
                </button>
              )}
              <button onClick={() => setPickerOpen(false)} aria-label="Close list" style={{ background: "transparent", border: 0, color: "#6B7580", cursor: "pointer", fontSize: 13, lineHeight: 1 }}>
                ✕
              </button>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {featurePlans.map((p) => {
              const active = p.id === selectedPlanId;
              return (
                <button
                  key={p.id}
                  onClick={() => selectPlan(p.id)}
                  style={{ textAlign: "left", border: 0, borderRadius: 8, padding: "9px 10px", background: active ? "rgba(79,209,197,0.14)" : "transparent", cursor: "pointer" }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontFamily: "'Space Grotesk',system-ui,sans-serif", fontSize: 13, fontWeight: 600, color: active ? TEAL : INK }}>{p.name}</span>
                    <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9, color: p.confidence === "high" ? TEAL : p.confidence === "medium" ? AMBER : NEUTRAL, flexShrink: 0 }}>{p.confidence}</span>
                  </div>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, color: "#9CA6AC", marginTop: 2 }}>{p.steps.length} steps</div>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <button
          onClick={() => setPickerOpen(true)}
          aria-label="Show plan list"
          style={{ position: "absolute", left: 24, top: 82, zIndex: 1, background: "rgba(18,23,29,0.82)", border: "0.5px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "8px 12px", backdropFilter: "blur(6px)", color: TEAL, fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: 1.2, cursor: "pointer" }}
        >
          {featurePlans.length} PLAN{featurePlans.length === 1 ? "" : "S"}
        </button>
      )}

      <div style={{ position: "absolute", inset: 0, padding: "88px 32px 32px", overflowY: "auto" }}>
        <div style={{ maxWidth: 920, margin: "0 auto" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontFamily: "'IBM Plex Mono',monospace",
              fontSize: 10,
              letterSpacing: 1,
              color: GHOST,
              background: "rgba(255,255,255,0.04)",
              border: `0.5px dashed ${GHOST}80`,
              borderRadius: 999,
              padding: "4px 10px",
              marginBottom: 18,
            }}
          >
            AI-SUGGESTED — proposed by the agent, not verified, not yet built
          </div>

          {plan && (
            <>
              <div style={{ background: "rgba(18,23,29,0.7)", border: "0.5px solid rgba(255,255,255,0.09)", borderRadius: 12, padding: "18px 20px", marginBottom: 32 }}>
                <h2 style={{ fontFamily: "'Space Grotesk',system-ui,sans-serif", fontSize: 17, fontWeight: 600, margin: "0 0 6px" }}>{plan.name}</h2>
                <p style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11.5, color: "#6B7580", margin: "0 0 10px" }}>&quot;{plan.description}&quot;</p>
                <p style={{ fontSize: 13.5, lineHeight: 1.6, color: "#D8DBDE", margin: 0 }}>{plan.summary}</p>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: AMBER, marginTop: 12 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
                  {CONFIDENCE_LABEL[plan.confidence]}
                </div>
                {plan.evidence.length > 0 && (
                  <ul style={{ margin: "10px 0 0", padding: 0, listStyle: "none" }}>
                    {plan.evidence.map((e, i) => (
                      <li key={i} style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, color: "#6B7580", marginTop: 4 }}>
                        {e}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: 1.2, color: TEAL, margin: "0 0 12px" }}>PROPOSED FLOW</div>
              <div style={{ overflowX: "auto", padding: "8px 0 28px", marginBottom: 8 }}>
                <svg viewBox={`0 0 ${stepsWidth} 150`} style={{ width: Math.min(stepsWidth, 1000), maxWidth: "100%", height: "auto" }}>
                  <defs>
                    <marker id="pd-arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
                      <path d="M0,0 L10,5 L0,10 z" fill="#4A5560" />
                    </marker>
                  </defs>
                  <g transform="translate(20,10)">
                    {plan.steps.slice(1).map((step, i) => {
                      const x1 = stepX[i] + STEP_W;
                      const x2 = stepX[i + 1];
                      const y = STEP_H / 2;
                      return <line key={step.id} x1={x1} y1={y} x2={x2 - 4} y2={y} stroke="#4A5560" strokeWidth={1.6} markerEnd="url(#pd-arrow)" />;
                    })}
                    {plan.steps.map((step, i) => {
                      const meta = STEP_KIND_META[step.kind];
                      const isNew = step.status === "new";
                      const isSelected = selected?.kind === "step" && selected.step.id === step.id;
                      return (
                        <g
                          key={step.id}
                          transform={`translate(${stepX[i]},0)`}
                          onClick={() => selectStep(step)}
                          tabIndex={0}
                          role="button"
                          aria-label={`${step.label}, ${step.status}`}
                          style={{ cursor: "pointer" }}
                        >
                          <StepGlyph shape={meta.shape} color={meta.color} w={STEP_W} h={STEP_H} selected={isSelected} ghost={isNew} />
                          {isNew && (
                            <g>
                              <rect x={STEP_W - 34} y={-9} width={34} height={16} rx={8} fill="#0A0D12" stroke={GHOST} strokeWidth={0.75} strokeDasharray="2 2" />
                              <text x={STEP_W - 17} y={2.5} textAnchor="middle" fontFamily="'IBM Plex Mono',monospace" fontSize={8.5} fill={GHOST}>
                                NEW
                              </text>
                            </g>
                          )}
                          <text x={STEP_W / 2} y={STEP_H + 18} textAnchor="middle" fontFamily="'Space Grotesk',system-ui,sans-serif" fontSize={12.5} fontWeight={600} fill={INK}>
                            {step.label}
                          </text>
                          <text x={STEP_W / 2} y={STEP_H + 32} textAnchor="middle" fontFamily="'IBM Plex Mono',monospace" fontSize={10} fill={isNew ? GHOST : meta.color}>
                            {step.status}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                </svg>
              </div>

              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: 1.2, color: TEAL, margin: "24px 0 12px" }}>WHAT THIS TOUCHES</div>
              <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 20, alignItems: "start" }}>
                <div style={{ background: "rgba(18,23,29,0.5)", border: "0.5px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 20 }}>
                  <svg viewBox={`0 0 640 ${impactMapHeight}`} style={{ width: "100%", height: "auto", overflow: "visible" }}>
                    <text x="90" y="18" fontFamily="'IBM Plex Mono',monospace" fontSize="9.5" letterSpacing="1" fill="#6B7580">
                      APPLICATION
                    </text>
                    <text x="420" y="18" fontFamily="'IBM Plex Mono',monospace" fontSize="9.5" letterSpacing="1" fill="#6B7580">
                      DATA &amp; INFRA
                    </text>
                    {applicationDomains.map((d, i) => {
                      const affected = impactedIds.has(d.id);
                      const entity = plan.impactedEntities.find((e) => e.id === d.id);
                      const x = 40,
                        y = 40 + i * 96;
                      return (
                        <g
                          key={d.id}
                          transform={`translate(${x},${y})`}
                          opacity={affected ? 1 : 0.32}
                          onClick={() => entity && selectEntity(entity)}
                          style={{ cursor: entity ? "pointer" : "default" }}
                        >
                          {affected && <rect x={-6} y={-6} width={130 + 12} height={76 + 12} rx={16} fill="none" stroke={AMBER} strokeWidth={1.4} strokeDasharray="3 4" />}
                          <StepGlyph shape="hex" color={INDIGO} w={130} h={76} selected={false} />
                          <text x={65} y={94} textAnchor="middle" fontFamily="'Space Grotesk',system-ui,sans-serif" fontSize={11.5} fontWeight={600} fill={INK}>
                            {d.name}
                          </text>
                          <text x={65} y={107} textAnchor="middle" fontFamily="'IBM Plex Mono',monospace" fontSize={9.5} fill={INDIGO}>
                            domain
                          </text>
                        </g>
                      );
                    })}
                    {dataInfra.map((n, i) => {
                      const affected = impactedIds.has(n.id);
                      const entity = plan.impactedEntities.find((e) => e.id === n.id);
                      const x = 400,
                        y = 40 + i * 96;
                      return (
                        <g
                          key={n.id}
                          transform={`translate(${x},${y})`}
                          opacity={affected ? 1 : 0.32}
                          onClick={() => entity && selectEntity(entity)}
                          style={{ cursor: entity ? "pointer" : "default" }}
                        >
                          {affected && <rect x={-6} y={-6} width={100 + 12} height={76 + 12} rx={16} fill="none" stroke={AMBER} strokeWidth={1.4} strokeDasharray="3 4" />}
                          <StepGlyph shape="cylinder" color={TEAL} w={100} h={76} selected={false} />
                          <text x={50} y={94} textAnchor="middle" fontFamily="'Space Grotesk',system-ui,sans-serif" fontSize={11.5} fontWeight={600} fill={INK}>
                            {n.name}
                          </text>
                          <text x={50} y={107} textAnchor="middle" fontFamily="'IBM Plex Mono',monospace" fontSize={9.5} fill={TEAL}>
                            {n.category}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </div>

                <div style={{ background: "rgba(18,23,29,0.7)", border: "0.5px solid rgba(255,255,255,0.09)", borderRadius: 12, padding: "16px 18px" }}>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9.5, letterSpacing: 1, color: "#6B7580", marginBottom: 8 }}>
                    NEW FILES · {plan.newFiles.length}
                  </div>
                  {plan.newFiles.map((f, i) => (
                    <div key={i} style={{ marginBottom: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 8.5, fontWeight: 500, background: GHOST, color: "#12171D", borderRadius: 4, padding: "2px 4px", minWidth: 22, textAlign: "center" }}>
                          {(f.suggestedPath.split(".").pop() ?? "").toUpperCase()}
                        </span>
                        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11.5, color: "#D8DBDE" }}>{f.suggestedPath}</span>
                      </div>
                      <div style={{ fontSize: 10.5, color: "#6B7580", marginLeft: 30, marginTop: 2 }}>{f.purpose}</div>
                    </div>
                  ))}

                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9.5, letterSpacing: 1, color: "#6B7580", margin: "14px 0 8px" }}>
                    MODIFIED FILES · {plan.modifiedFiles.length}
                  </div>
                  {plan.modifiedFiles.map((f, i) => (
                    <div key={i} style={{ marginBottom: 10 }}>
                      <button
                        onClick={() => setViewingFilePath(f.filePath)}
                        style={{ display: "flex", alignItems: "center", gap: 8, background: "transparent", border: 0, padding: 0, cursor: "pointer", width: "100%", textAlign: "left" }}
                      >
                        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 8.5, fontWeight: 500, background: NEUTRAL, color: "#12171D", borderRadius: 4, padding: "2px 4px", minWidth: 22, textAlign: "center" }}>
                          {(f.filePath.split(".").pop() ?? "").toUpperCase()}
                        </span>
                        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11.5, color: "#D8DBDE" }}>{f.filePath}</span>
                      </button>
                      <div style={{ fontSize: 10.5, color: "#6B7580", marginLeft: 30, marginTop: 2 }}>{f.reason}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {(selected || viewingFilePath) && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            width: viewingFilePath ? 640 : 360,
            maxWidth: "90vw",
            zIndex: 2,
            background: "rgba(13,17,22,0.96)",
            borderLeft: "0.5px solid rgba(201,154,108,0.35)",
            padding: "88px 24px 24px",
            overflowY: "auto",
            backdropFilter: "blur(8px)",
            transition: "width 0.15s ease",
          }}
        >
          <button
            onClick={() => (viewingFilePath ? setViewingFilePath(null) : setSelected(null))}
            style={{ position: "absolute", top: 24, right: 24, background: "transparent", border: 0, color: "#6B7580", cursor: "pointer", fontSize: 13 }}
          >
            {viewingFilePath ? "← back" : "✕ close"}
          </button>

          {viewingFilePath ? (
            <>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: 1.2, color: NEUTRAL, marginBottom: 8 }}>SOURCE</div>
              <div style={{ fontFamily: "'Space Grotesk',system-ui,sans-serif", fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{viewingFilePath.split("/").pop()}</div>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: "#6B7580", marginBottom: 20 }}>{viewingFilePath}</div>
              <CodeViewer owner={repoOwner} repo={repoName} gitRef={repoRef} path={viewingFilePath} />
            </>
          ) : selected?.kind === "step" ? (
            <>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: 0.6,
                  textTransform: "uppercase",
                  color: selected.step.status === "new" ? GHOST : STEP_KIND_META[selected.step.kind].color,
                  background: softColor(selected.step.status === "new" ? GHOST : STEP_KIND_META[selected.step.kind].color),
                  borderRadius: 999,
                  padding: "3px 10px",
                  marginBottom: 10,
                }}
              >
                {selected.step.status === "new" ? "New" : "Existing"}
              </div>
              <div style={{ fontFamily: "'Space Grotesk',system-ui,sans-serif", fontSize: 20, fontWeight: 700 }}>{selected.step.label}</div>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: "#6B7580", marginBottom: 14 }}>{selected.step.filePath}</div>
              <div style={{ fontSize: 13, lineHeight: 1.55, color: "#D8DBDE", marginBottom: 18 }}>{selected.step.explanation}</div>
              {selected.step.status === "existing" ? (
                <button
                  onClick={() => setViewingFilePath(selected.step.filePath)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    background: softColor(STEP_KIND_META[selected.step.kind].color),
                    color: STEP_KIND_META[selected.step.kind].color,
                    border: `0.5px solid ${STEP_KIND_META[selected.step.kind].color}55`,
                    borderRadius: 8,
                    padding: "10px 12px",
                    fontFamily: "'Space Grotesk',system-ui,sans-serif",
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  View source →
                </button>
              ) : (
                <div style={{ fontSize: 11.5, color: "#6B7580", fontStyle: "italic" }}>This file doesn&apos;t exist yet — nothing to view.</div>
              )}
            </>
          ) : selected?.kind === "entity" ? (
            <>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: 0.6,
                  textTransform: "uppercase",
                  color: AMBER,
                  background: softColor(AMBER),
                  borderRadius: 999,
                  padding: "3px 10px",
                  marginBottom: 10,
                }}
              >
                {selected.entity.kind}
              </div>
              <div style={{ fontFamily: "'Space Grotesk',system-ui,sans-serif", fontSize: 20, fontWeight: 700 }}>{selected.entity.name}</div>
              <div style={{ fontSize: 13, lineHeight: 1.55, color: "#D8DBDE", margin: "14px 0 18px" }}>{selected.entity.reason}</div>
              {selected.entity.kind === "domain" && onEnterDomain && (
                <button
                  onClick={() => onEnterDomain(selected.entity.id)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    background: softColor(INDIGO),
                    color: INDIGO,
                    border: `0.5px solid ${INDIGO}55`,
                    borderRadius: 8,
                    padding: "10px 12px",
                    fontFamily: "'Space Grotesk',system-ui,sans-serif",
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Open domain view →
                </button>
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
