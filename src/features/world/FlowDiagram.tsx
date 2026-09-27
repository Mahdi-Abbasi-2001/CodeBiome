"use client";

import { useMemo, useState } from "react";
import type { WorldSnapshot } from "@/types/world";
import type { Flow, FlowStepKind, ConfidenceLevel } from "@/types/flow";
import type { Journey } from "@/types/journey";
import { CodeViewer } from "./CodeViewer";
import { ForestBackdrop } from "./ForestBackdrop";
import { WorldHud } from "./WorldHud";
import { StepGlyph, softColor, TEAL, AMBER, INDIGO, PURPLE, CORAL, SKYBLUE, NEUTRAL, LINE_STRONG, INK, INK_SOFT, type StepShape } from "./StepGlyph";
import type { WorldLens } from "./WorldHud";

/**
 * Both Flows and Journeys are STATICALLY RECONSTRUCTED (see
 * src/server/flows/inferFlows.ts and src/server/journeys/inferJourneys.ts's
 * doc comments) — CodeBiome never runs the analyzed repository. A Flow is
 * one request's server-side call chain; a Journey is several pages and the
 * real Flows they call, stitched together by real frontend fetch/
 * navigation call sites. Both render through the same step-pipeline below,
 * unified into one `PipelineStep` shape — the UI must never imply either
 * was observed running, hence the persistent "inferred" framing and the
 * per-step confidence shown on every hop, not just buried in a tooltip.
 */

const LINE_DIM = "#2B2F36";

const FLOW_KIND_META: Record<FlowStepKind, { shape: StepShape; color: string; badge: string }> = {
  entry: { shape: "entry", color: TEAL, badge: "Entry point" },
  controller: { shape: "hex", color: INDIGO, badge: "Controller" },
  handler: { shape: "hex", color: INDIGO, badge: "Handler" },
  service: { shape: "hex", color: INDIGO, badge: "Service" },
  entity: { shape: "card", color: AMBER, badge: "Entity" },
  function: { shape: "box", color: NEUTRAL, badge: "Function" },
  repository: { shape: "vault", color: PURPLE, badge: "Repository" },
  database: { shape: "cylinder", color: TEAL, badge: "Database" },
  "external-api": { shape: "external", color: CORAL, badge: "External API" },
  event: { shape: "rings", color: SKYBLUE, badge: "Event" },
  unknown: { shape: "box", color: NEUTRAL, badge: "Unclassified" },
};

const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = { high: "high confidence", medium: "medium confidence", low: "low confidence" };

/** The common render shape both a Flow's FlowStep[] and a Journey's JourneyStep[] map into — one pipeline renderer, two real data sources. */
interface PipelineStep {
  id: string;
  shape: StepShape;
  color: string;
  label: string;
  badge: string;
  confidence: ConfidenceLevel;
  filePath: string;
  explanation: string;
  evidence: string[];
  /** Set only for a journey's "call" step — jumps into that Flow's own full internal chain. */
  linkedFlowId?: string | null;
}

function flowToPipeline(flow: Flow): PipelineStep[] {
  return flow.steps.map((s) => {
    const meta = FLOW_KIND_META[s.kind];
    return {
      id: s.id,
      shape: meta.shape,
      color: meta.color,
      label: s.label,
      badge: meta.badge,
      confidence: s.confidence,
      filePath: s.filePath,
      explanation: s.explanation,
      evidence: s.evidence,
      linkedFlowId: null,
    };
  });
}

function journeyToPipeline(journey: Journey): PipelineStep[] {
  return journey.steps.map((s) =>
    s.kind === "page"
      ? {
          id: s.id,
          shape: "entry",
          color: TEAL,
          label: s.label,
          badge: "Page",
          confidence: s.confidence,
          filePath: s.filePath,
          explanation: s.explanation,
          evidence: s.evidence,
          linkedFlowId: null,
        }
      : {
          id: s.id,
          shape: "hex",
          color: INDIGO,
          label: s.label,
          badge: "API call",
          confidence: s.confidence,
          filePath: s.filePath,
          explanation: s.explanation,
          evidence: s.evidence,
          linkedFlowId: s.flowId,
        }
  );
}

const STEP_W = 132;
const STEP_H = 84;
const GAP_X = 96;
const TOP_MARGIN = 30;
const LABEL_EXTRA = 44; // room for title + kind badge drawn below each shape (see ArchitectureDiagram's identical fix)
const BOTTOM_MARGIN = 16;

function layoutSteps(steps: PipelineStep[]) {
  const positions = steps.map((_, i) => ({ x: i * (STEP_W + GAP_X), y: 0 }));
  const width = steps.length > 0 ? steps.length * STEP_W + (steps.length - 1) * GAP_X : 0;
  const height = TOP_MARGIN + STEP_H + LABEL_EXTRA + BOTTOM_MARGIN;
  return { positions, width: width + 40, height };
}

type SelectedItem = { kind: "journey"; id: string } | { kind: "flow"; id: string };

export function FlowDiagram({
  snapshot,
  onSelectLens,
}: {
  snapshot: WorldSnapshot;
  onSelectLens: (lens: WorldLens) => void;
}) {
  const { knowledgeModel, flowModel, journeyModel } = snapshot;
  const journeys = journeyModel.journeys;
  const flows = flowModel.flows;
  const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(
    journeys[0] ? { kind: "journey", id: journeys[0].id } : flows[0] ? { kind: "flow", id: flows[0].id } : null
  );
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [viewingFilePath, setViewingFilePath] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(true);
  const [repoOwner, repoName] = knowledgeModel.meta.repositoryId.split("/");
  const repoRef = knowledgeModel.meta.commitSha;

  const selectedJourney: Journey | null = selectedItem?.kind === "journey" ? journeys.find((j) => j.id === selectedItem.id) ?? null : null;
  const selectedFlow: Flow | null = selectedItem?.kind === "flow" ? flows.find((f) => f.id === selectedItem.id) ?? null : null;

  const title = selectedJourney?.name ?? selectedFlow?.name ?? "";
  const description = selectedJourney?.description ?? selectedFlow?.description ?? "";
  const overallConfidence = selectedJourney?.confidence ?? selectedFlow?.confidence ?? null;
  const steps = useMemo<PipelineStep[]>(
    () => (selectedJourney ? journeyToPipeline(selectedJourney) : selectedFlow ? flowToPipeline(selectedFlow) : []),
    [selectedJourney, selectedFlow]
  );
  const { positions, width, height } = useMemo(() => layoutSteps(steps), [steps]);
  const selectedStep = steps.find((s) => s.id === selectedStepId) ?? null;

  function selectItem(item: SelectedItem) {
    setSelectedItem(item);
    setSelectedStepId(null);
    setViewingFilePath(null);
  }

  function selectStep(id: string) {
    setViewingFilePath(null);
    setSelectedStepId((cur) => (cur === id ? null : id));
  }

  if (journeys.length === 0 && flows.length === 0) {
    return (
      <div style={{ position: "relative", minHeight: "100vh", overflow: "hidden", background: "#0A0D12", color: "#9CA6AC", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, textAlign: "center", padding: 24 }}>
        <ForestBackdrop />
        <WorldHud repoName={knowledgeModel.repository.name} activeLens="flow" onSelectLens={onSelectLens} />
        <div style={{ position: "relative" }}>No likely execution paths detected yet.</div>
        <div style={{ position: "relative", fontSize: 11.5, color: "#6B7580", maxWidth: 420 }}>
          This view needs a real entry point (an HTTP route, CLI command, or worker) connected to at least one real dependency edge — none were found in this repository.
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", minHeight: "100vh", overflow: "hidden", background: "#0A0D12", color: "#F3F1EA" }}>
      <ForestBackdrop />
      <WorldHud repoName={knowledgeModel.repository.name} activeLens="flow" onSelectLens={onSelectLens} />

      {/* picker */}
      {pickerOpen ? (
      <div style={{ position: "absolute", left: 24, top: 82, width: 270, maxHeight: "calc(100vh - 180px)", overflowY: "auto", background: "rgba(18,23,29,0.82)", border: "0.5px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "14px 12px", backdropFilter: "blur(6px)", zIndex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginBottom: 2 }}>
          <button
            onClick={() => setPickerOpen(false)}
            aria-label="Close list"
            style={{ background: "transparent", border: 0, color: "#6B7580", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: "0 4px" }}
          >
            ✕
          </button>
        </div>
        {journeys.length > 0 && (
          <>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: 1.2, color: TEAL, marginBottom: 10, padding: "0 4px" }}>
              {journeys.length} USER JOURNEY{journeys.length === 1 ? "" : "S"}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: flows.length > 0 ? 16 : 0 }}>
              {journeys.map((journey) => {
                const active = selectedItem?.kind === "journey" && selectedItem.id === journey.id;
                return (
                  <button
                    key={journey.id}
                    onClick={() => selectItem({ kind: "journey", id: journey.id })}
                    style={{ textAlign: "left", border: 0, borderRadius: 8, padding: "9px 10px", background: active ? "rgba(79,209,197,0.14)" : "transparent", cursor: "pointer" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontFamily: "'Space Grotesk',system-ui,sans-serif", fontSize: 13, fontWeight: 600, color: active ? TEAL : INK }}>{journey.name}</span>
                      <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9, color: journey.confidence === "high" ? TEAL : journey.confidence === "medium" ? AMBER : NEUTRAL, flexShrink: 0 }}>
                        {journey.confidence}
                      </span>
                    </div>
                    <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, color: INK_SOFT, marginTop: 2 }}>
                      {journey.steps.filter((s) => s.kind === "page").length} pages · {journey.steps.filter((s) => s.kind === "call").length} calls
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
        {flows.length > 0 && (
          <>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: 1.2, color: NEUTRAL, marginBottom: 10, padding: "0 4px" }}>
              {flows.length} SINGLE-REQUEST FLOW{flows.length === 1 ? "" : "S"}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {flows.map((flow) => {
                const active = selectedItem?.kind === "flow" && selectedItem.id === flow.id;
                return (
                  <button
                    key={flow.id}
                    onClick={() => selectItem({ kind: "flow", id: flow.id })}
                    style={{ textAlign: "left", border: 0, borderRadius: 8, padding: "9px 10px", background: active ? "rgba(79,209,197,0.14)" : "transparent", cursor: "pointer" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontFamily: "'Space Grotesk',system-ui,sans-serif", fontSize: 13, fontWeight: 600, color: active ? TEAL : INK }}>{flow.name}</span>
                      <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9, color: flow.confidence === "high" ? TEAL : flow.confidence === "medium" ? AMBER : NEUTRAL, flexShrink: 0 }}>
                        {flow.confidence}
                      </span>
                    </div>
                    <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, color: INK_SOFT, marginTop: 2 }}>{flow.steps.length} steps</div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
      ) : (
        <button
          onClick={() => setPickerOpen(true)}
          aria-label="Show journey/flow list"
          style={{
            position: "absolute",
            left: 24,
            top: 82,
            zIndex: 1,
            background: "rgba(18,23,29,0.82)",
            border: "0.5px solid rgba(255,255,255,0.1)",
            borderRadius: 10,
            padding: "8px 12px",
            backdropFilter: "blur(6px)",
            color: TEAL,
            fontFamily: "'IBM Plex Mono',monospace",
            fontSize: 10,
            letterSpacing: 1.2,
            cursor: "pointer",
          }}
        >
          {journeys.length + flows.length} FLOWS
        </button>
      )}

      {steps.length > 0 && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "88px 24px 24px", gap: 22 }}>
          <div style={{ textAlign: "center", maxWidth: 640 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: 1, color: NEUTRAL, background: "rgba(255,255,255,0.05)", border: "0.5px solid rgba(255,255,255,0.1)", borderRadius: 999, padding: "4px 10px", marginBottom: 10 }}>
              STATICALLY INFERRED — not an observed execution trace
            </div>
            <h1 style={{ fontFamily: "'Space Grotesk',system-ui,sans-serif", fontSize: 20, fontWeight: 600, margin: "0 0 4px" }}>{title}</h1>
            <p style={{ fontSize: 12.5, color: INK_SOFT, margin: 0 }}>{description}</p>
          </div>

          <div style={{ width: "100%", overflowX: "auto" }}>
            <svg
              viewBox={`0 0 ${width} ${height}`}
              style={{ display: "block", margin: "0 auto", width: Math.min(width, 1200), maxWidth: "100%", height: "auto", overflow: "visible" }}
              role="img"
              aria-label={`Statically inferred ${selectedJourney ? "journey" : "flow"}: ${title}, ${steps.length} steps`}
            >
              <defs>
                <marker id="fd-arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill={LINE_STRONG} />
                </marker>
              </defs>

              <g transform={`translate(20,${TOP_MARGIN})`}>
                {steps.slice(1).map((step, i) => {
                  const from = positions[i];
                  const to = positions[i + 1];
                  const x1 = from.x + STEP_W;
                  const x2 = to.x;
                  const y = STEP_H / 2;
                  const dashed = step.confidence === "low";
                  return (
                    <g key={step.id}>
                      <line x1={x1} y1={y} x2={x2 - 4} y2={y} stroke={LINE_STRONG} strokeWidth={dashed ? 1.4 : 1.8} strokeDasharray={dashed ? "5 4" : undefined} markerEnd="url(#fd-arrow)" opacity={dashed ? 0.6 : 0.9} />
                      <text x={(x1 + x2) / 2} y={y - 8} textAnchor="middle" fontFamily="'IBM Plex Mono',monospace" fontSize={9} fill={step.confidence === "high" ? INK_SOFT : step.confidence === "medium" ? AMBER : NEUTRAL}>
                        {CONFIDENCE_LABEL[step.confidence]}
                      </text>
                    </g>
                  );
                })}

                {steps.map((step, i) => {
                  const pos = positions[i];
                  const isSelected = selectedStepId === step.id;
                  return (
                    <g
                      key={step.id}
                      transform={`translate(${pos.x},${pos.y})`}
                      onClick={() => selectStep(step.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          selectStep(step.id);
                        }
                      }}
                      tabIndex={0}
                      role="button"
                      aria-label={`${step.label}, ${step.badge}, ${CONFIDENCE_LABEL[step.confidence]}`}
                      style={{ cursor: "pointer" }}
                    >
                      <StepGlyph shape={step.shape} color={step.color} w={STEP_W} h={STEP_H} selected={isSelected} />
                      <text x={STEP_W / 2} y={STEP_H + 18} textAnchor="middle" fontFamily="'Space Grotesk',system-ui,sans-serif" fontSize={12.5} fontWeight={600} fill={INK}>
                        {step.label}
                      </text>
                      <text x={STEP_W / 2} y={STEP_H + 32} textAnchor="middle" fontFamily="'IBM Plex Mono',monospace" fontSize={10} fill={step.color}>
                        {step.badge}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          </div>
        </div>
      )}

      {/* footer stats */}
      {steps.length > 0 && overallConfidence && (
        <div style={{ position: "absolute", right: 24, bottom: 24 }}>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: "#6B7580", background: "rgba(18,23,29,0.7)", border: "0.5px solid rgba(255,255,255,0.08)", borderRadius: 9, padding: "9px 14px" }}>
            {steps.length} steps · overall confidence: {overallConfidence}
          </div>
        </div>
      )}
      <div style={{ position: "absolute", left: 24, bottom: 24, display: "flex", alignItems: "center", gap: 8, background: "rgba(18,23,29,0.7)", border: "0.5px solid rgba(255,255,255,0.09)", borderRadius: 9, padding: "10px 14px" }}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <path d="M2 8h12M8 2l6 6-6 6" stroke={TEAL} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11.5, color: "#9CA6AC" }}>Click a step to see why it's next, and its source</span>
      </div>

      {/* inspector panel */}
      {selectedStep && (
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
            borderLeft: `0.5px solid ${selectedStep.color}55`,
            padding: "88px 24px 24px",
            overflowY: "auto",
            backdropFilter: "blur(8px)",
            transition: "width 0.15s ease",
          }}
        >
          <button
            onClick={() => (viewingFilePath ? setViewingFilePath(null) : setSelectedStepId(null))}
            style={{ position: "absolute", top: 24, right: 24, background: "transparent", border: 0, color: "#6B7580", cursor: "pointer", fontSize: 13 }}
          >
            {viewingFilePath ? "← back" : "✕ close"}
          </button>

          {viewingFilePath ? (
            <>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: 1.2, color: selectedStep.color, marginBottom: 8 }}>{selectedStep.label.toUpperCase()} · SOURCE</div>
              <div style={{ fontFamily: "'Space Grotesk',system-ui,sans-serif", fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{viewingFilePath.split("/").pop()}</div>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: "#6B7580", marginBottom: 20 }}>{viewingFilePath}</div>
              <CodeViewer owner={repoOwner} repo={repoName} gitRef={repoRef} path={viewingFilePath} />
            </>
          ) : (
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
                  color: selectedStep.color,
                  background: softColor(selectedStep.color),
                  borderRadius: 999,
                  padding: "3px 10px",
                  marginBottom: 10,
                }}
              >
                {selectedStep.badge}
              </div>
              <div style={{ fontFamily: "'Space Grotesk',system-ui,sans-serif", fontSize: 20, fontWeight: 700 }}>{selectedStep.label}</div>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: "#6B7580", marginBottom: 14 }}>{selectedStep.filePath}</div>

              <div style={{ fontSize: 13, lineHeight: 1.55, color: "#D8DBDE", marginBottom: 14 }}>{selectedStep.explanation}</div>

              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 11,
                  color: selectedStep.confidence === "high" ? TEAL : selectedStep.confidence === "medium" ? AMBER : NEUTRAL,
                  marginBottom: 18,
                  paddingBottom: 18,
                  borderBottom: "0.5px solid rgba(255,255,255,0.08)",
                  width: "100%",
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
                {CONFIDENCE_LABEL[selectedStep.confidence]}
              </div>

              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: 1, color: "#6B7580", marginBottom: 8 }}>EVIDENCE</div>
              <ul style={{ margin: "0 0 20px", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
                {selectedStep.evidence.map((e, i) => (
                  <li key={i} style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11.5, color: "#B7BDC3", lineHeight: 1.5, paddingLeft: 14, position: "relative" }}>
                    <span style={{ position: "absolute", left: 0, color: selectedStep.color }}>·</span>
                    {e}
                  </li>
                ))}
              </ul>

              {selectedStep.linkedFlowId && (
                <button
                  onClick={() => selectItem({ kind: "flow", id: selectedStep.linkedFlowId! })}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    background: softColor(selectedStep.color),
                    color: selectedStep.color,
                    border: `0.5px solid ${selectedStep.color}55`,
                    borderRadius: 8,
                    padding: "10px 12px",
                    fontFamily: "'Space Grotesk',system-ui,sans-serif",
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: "pointer",
                    marginBottom: 10,
                  }}
                >
                  View full flow →
                </button>
              )}
              <button
                onClick={() => setViewingFilePath(selectedStep.filePath)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  textAlign: "left",
                  background: softColor(selectedStep.color),
                  color: selectedStep.color,
                  border: `0.5px solid ${selectedStep.color}55`,
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
            </>
          )}
        </div>
      )}
    </div>
  );
}
