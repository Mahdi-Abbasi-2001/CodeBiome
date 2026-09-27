"use client";

import { useEffect, useMemo, useState } from "react";
import type { WorldSnapshot } from "@/types/world";
import type { OnboardingJourney, OnboardingStep } from "@/types/onboarding";
import { computeDomains, domainForModule } from "@/lib/domains";
import { ForestBackdrop } from "./ForestBackdrop";
import { WorldHud, type WorldLens } from "./WorldHud";
import { StepGlyph, softColor, TEAL, INDIGO, GHOST, INK } from "./StepGlyph";

/**
 * The Onboarding tab is a pure viewer, mirroring PlanDiagram exactly: Bob
 * (an external MCP client — a developer's own IDE session) is the only
 * thing that ever calls `create_onboarding_journey` while answering a
 * developer's "how does X work?" question — this app never authors a
 * journey itself. Unlike a FeaturePlan, every step here already points at a
 * REAL, verified module (src/server/bob-tools/onboardingTools.ts's
 * `findModule` rejects the whole call otherwise) — there is no "new" vs
 * "existing" distinction to render, only Bob's chosen order and reasons.
 */

const STEP_W = 132;
const STEP_H = 84;
const GAP_X = 96;

function layoutSteps(count: number) {
  const positions = Array.from({ length: count }, (_, i) => i * (STEP_W + GAP_X));
  const width = count > 0 ? count * STEP_W + (count - 1) * GAP_X : 0;
  return { positions, width: width + 40 };
}

export function OnboardingDiagram({
  snapshot,
  journeys,
  onSelectLens,
  onEnterDomain,
  onRefresh,
}: {
  snapshot: WorldSnapshot;
  journeys: OnboardingJourney[];
  onSelectLens: (lens: WorldLens) => void;
  onEnterDomain?: (domainId: string) => void;
  onRefresh?: () => Promise<void>;
}) {
  const { knowledgeModel, worldModel } = snapshot;

  const [selectedJourneyId, setSelectedJourneyId] = useState<string | null>(journeys[0]?.id ?? null);
  const [selectedStep, setSelectedStep] = useState<OnboardingStep | null>(null);
  const [pickerOpen, setPickerOpen] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!selectedJourneyId && journeys.length > 0) setSelectedJourneyId(journeys[0].id);
  }, [journeys, selectedJourneyId]);

  const domains = useMemo(() => computeDomains(worldModel, knowledgeModel), [worldModel, knowledgeModel]);
  const journey = journeys.find((j) => j.id === selectedJourneyId) ?? null;
  const { positions: stepX, width: stepsWidth } = useMemo(() => layoutSteps(journey?.steps.length ?? 0), [journey]);
  const selectedStepDomain = selectedStep ? domainForModule(domains, selectedStep.moduleId) : null;

  function selectJourney(id: string) {
    setSelectedJourneyId(id);
    setSelectedStep(null);
  }
  function selectStep(step: OnboardingStep) {
    setSelectedStep((cur) => (cur?.moduleId === step.moduleId && cur?.order === step.order ? null : step));
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

  if (journeys.length === 0) {
    return (
      <div style={{ position: "relative", minHeight: "100vh", overflow: "hidden", background: "#0A0D12", color: "#F3F1EA" }}>
        <ForestBackdrop />
        <WorldHud repoName={knowledgeModel.repository.name} activeLens="onboarding" onSelectLens={onSelectLens} />
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
            AI-GUIDED — narrated by Bob, every module referenced is real and verified
          </div>
          <h1 style={{ fontFamily: "'Space Grotesk',system-ui,sans-serif", fontSize: 20, fontWeight: 600, margin: "0 0 10px" }}>No onboarding journeys yet</h1>
          <p style={{ fontSize: 13.5, color: "#9CA6AC", maxWidth: 440, lineHeight: 1.6, margin: "0 0 28px" }}>
            Ask Bob in your IDE — e.g. &quot;walk me through how order creation works&quot; — and the journey it creates will show up here automatically.
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
              }}
            >
              {refreshing ? "Checking…" : "Check again →"}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", minHeight: "100vh", overflow: "hidden", background: "#0A0D12", color: "#F3F1EA" }}>
      <ForestBackdrop />
      <WorldHud repoName={knowledgeModel.repository.name} activeLens="onboarding" onSelectLens={onSelectLens} />

      {pickerOpen ? (
        <div style={{ position: "absolute", left: 24, top: 82, width: 270, maxHeight: "calc(100vh - 180px)", overflowY: "auto", zIndex: 1, background: "rgba(18,23,29,0.82)", border: "0.5px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "14px 12px", backdropFilter: "blur(6px)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, padding: "0 4px" }}>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: 1.2, color: TEAL }}>
              {journeys.length} JOURNEY{journeys.length === 1 ? "" : "S"}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {onRefresh && (
                <button onClick={handleRefresh} disabled={refreshing} aria-label="Check for new journeys" style={{ background: "transparent", border: 0, color: "#6B7580", cursor: refreshing ? "default" : "pointer", fontSize: 12 }}>
                  {refreshing ? "…" : "↻"}
                </button>
              )}
              <button onClick={() => setPickerOpen(false)} aria-label="Close list" style={{ background: "transparent", border: 0, color: "#6B7580", cursor: "pointer", fontSize: 13, lineHeight: 1 }}>
                ✕
              </button>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {journeys.map((j) => {
              const active = j.id === selectedJourneyId;
              return (
                <button
                  key={j.id}
                  onClick={() => selectJourney(j.id)}
                  style={{ textAlign: "left", border: 0, borderRadius: 8, padding: "9px 10px", background: active ? "rgba(79,209,197,0.14)" : "transparent", cursor: "pointer" }}
                >
                  <div style={{ fontFamily: "'Space Grotesk',system-ui,sans-serif", fontSize: 13, fontWeight: 600, color: active ? TEAL : INK }}>{j.title}</div>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, color: "#9CA6AC", marginTop: 2 }}>{j.steps.length} steps</div>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <button
          onClick={() => setPickerOpen(true)}
          aria-label="Show journey list"
          style={{ position: "absolute", left: 24, top: 82, zIndex: 1, background: "rgba(18,23,29,0.82)", border: "0.5px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "8px 12px", backdropFilter: "blur(6px)", color: TEAL, fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: 1.2, cursor: "pointer" }}
        >
          {journeys.length} JOURNEY{journeys.length === 1 ? "" : "S"}
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
            AI-GUIDED — narrated by Bob, every module referenced is real and verified
          </div>

          {journey && (
            <>
              <div style={{ background: "rgba(18,23,29,0.7)", border: "0.5px solid rgba(255,255,255,0.09)", borderRadius: 12, padding: "18px 20px", marginBottom: 32 }}>
                <h2 style={{ fontFamily: "'Space Grotesk',system-ui,sans-serif", fontSize: 17, fontWeight: 600, margin: "0 0 8px" }}>{journey.title}</h2>
                <p style={{ fontSize: 13.5, lineHeight: 1.6, color: "#D8DBDE", margin: 0 }}>{journey.goal}</p>
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, color: "#6B7580", marginTop: 12 }}>
                  {Math.round(journey.provenance.confidence * 100)}% confidence · {journey.steps.length} step{journey.steps.length === 1 ? "" : "s"}
                </div>
              </div>

              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: 1.2, color: TEAL, margin: "0 0 12px" }}>THE PATH</div>
              <div style={{ overflowX: "auto", padding: "8px 0 28px" }}>
                <svg viewBox={`0 0 ${stepsWidth} 150`} style={{ width: Math.min(stepsWidth, 1000), maxWidth: "100%", height: "auto" }}>
                  <defs>
                    <marker id="ob-arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
                      <path d="M0,0 L10,5 L0,10 z" fill="#4A5560" />
                    </marker>
                  </defs>
                  <g transform="translate(20,10)">
                    {journey.steps.slice(1).map((step, i) => {
                      const x1 = stepX[i] + STEP_W;
                      const x2 = stepX[i + 1];
                      const y = STEP_H / 2;
                      return <line key={step.order} x1={x1} y1={y} x2={x2 - 4} y2={y} stroke="#4A5560" strokeWidth={1.6} markerEnd="url(#ob-arrow)" />;
                    })}
                    {journey.steps.map((step, i) => {
                      const isSelected = selectedStep?.order === step.order && selectedStep?.moduleId === step.moduleId;
                      return (
                        <g
                          key={step.order}
                          transform={`translate(${stepX[i]},0)`}
                          onClick={() => selectStep(step)}
                          tabIndex={0}
                          role="button"
                          aria-label={`Step ${i + 1}: ${step.moduleName}`}
                          style={{ cursor: "pointer" }}
                        >
                          <StepGlyph shape="hex" color={TEAL} w={STEP_W} h={STEP_H} selected={isSelected} />
                          <circle cx={16} cy={16} r={13} fill="#0A0D12" stroke={TEAL} strokeWidth={1.4} />
                          <text x={16} y={20.5} textAnchor="middle" fontFamily="'IBM Plex Mono',monospace" fontSize={12} fontWeight={600} fill={TEAL}>
                            {i + 1}
                          </text>
                          <text x={STEP_W / 2} y={STEP_H + 18} textAnchor="middle" fontFamily="'Space Grotesk',system-ui,sans-serif" fontSize={12.5} fontWeight={600} fill={INK}>
                            {step.moduleName}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                </svg>
              </div>
            </>
          )}
        </div>
      </div>

      {selectedStep && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            width: 360,
            maxWidth: "90vw",
            zIndex: 2,
            background: "rgba(13,17,22,0.96)",
            borderLeft: "0.5px solid rgba(201,154,108,0.35)",
            padding: "88px 24px 24px",
            overflowY: "auto",
            backdropFilter: "blur(8px)",
          }}
        >
          <button
            onClick={() => setSelectedStep(null)}
            style={{ position: "absolute", top: 24, right: 24, background: "transparent", border: 0, color: "#6B7580", cursor: "pointer", fontSize: 13 }}
          >
            ✕ close
          </button>

          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: 0.6,
              textTransform: "uppercase",
              color: TEAL,
              background: softColor(TEAL),
              borderRadius: 999,
              padding: "3px 10px",
              marginBottom: 10,
            }}
          >
            Step {selectedStep.order + 1}
          </div>
          <div style={{ fontFamily: "'Space Grotesk',system-ui,sans-serif", fontSize: 20, fontWeight: 700 }}>{selectedStep.moduleName}</div>
          <div style={{ fontSize: 13, lineHeight: 1.55, color: "#D8DBDE", margin: "14px 0 18px" }}>{selectedStep.reason}</div>
          {selectedStepDomain && onEnterDomain && (
            <button
              onClick={() => onEnterDomain(selectedStepDomain.id)}
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
        </div>
      )}
    </div>
  );
}
