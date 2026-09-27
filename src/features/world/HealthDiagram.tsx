"use client";

import { useMemo, useState } from "react";
import type { WorldSnapshot } from "@/types/world";
import { computeHealthReport, type VulnerabilityItem, type WeaknessItem, type StrengthItem } from "@/lib/health";
import type { Domain } from "@/lib/domains";
import { CodeViewer } from "./CodeViewer";
import { ForestBackdrop } from "./ForestBackdrop";
import { WorldHud, type WorldLens } from "./WorldHud";
import { StepGlyph, softColor, TEAL, AMBER, INDIGO, CORAL, NEUTRAL, INK } from "./StepGlyph";

/**
 * Every number and finding on this tab traces back to a real, already-computed
 * RKM field (see src/lib/health.ts's doc comment) — no invented metric, no
 * placeholder "0 issues" for analyzers that don't exist yet. The one
 * synthesized figure is the composite score, and its full breakdown is
 * always shown alongside it rather than presented as an opaque number.
 */

const TIER_COLOR: Record<Domain["healthTier"], string> = {
  thriving: TEAL,
  healthy: INDIGO,
  stressed: AMBER,
  critical: CORAL,
};

const SEVERITY_COLOR: Record<VulnerabilityItem["severity"], string> = {
  critical: CORAL,
  high: CORAL,
  moderate: AMBER,
  low: NEUTRAL,
};

function scoreColor(value: number): string {
  if (value >= 80) return TEAL;
  if (value >= 60) return AMBER;
  return CORAL;
}

type Selected = { kind: "vulnerability"; item: VulnerabilityItem } | { kind: "weakness"; item: WeaknessItem } | null;

function ScoreRing({ value }: { value: number }) {
  const color = scoreColor(value);
  const r = 42;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - value / 100);
  return (
    <svg width={104} height={104} viewBox="0 0 104 104">
      <circle cx={52} cy={52} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={9} />
      <circle
        cx={52}
        cy={52}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={9}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform="rotate(-90 52 52)"
      />
      <text x={52} y={48} textAnchor="middle" fontFamily="'Space Grotesk',system-ui,sans-serif" fontSize={26} fontWeight={700} fill={INK}>
        {value}
      </text>
      <text x={52} y={66} textAnchor="middle" fontFamily="'IBM Plex Mono',monospace" fontSize={9.5} fill="#6B7580">
        / 100
      </text>
    </svg>
  );
}

function StatChip({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.09)", borderRadius: 10, padding: "8px 14px", minWidth: 92 }}>
      <div style={{ fontFamily: "'Space Grotesk',system-ui,sans-serif", fontSize: 16, fontWeight: 600, color: INK }}>{value}</div>
      <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9.5, color: "#6B7580", marginTop: 2 }}>{label}</div>
    </div>
  );
}

export function HealthDiagram({
  snapshot,
  onSelectLens,
  onEnterDomain,
}: {
  snapshot: WorldSnapshot;
  onSelectLens: (lens: WorldLens) => void;
  onEnterDomain?: (domainId: string) => void;
}) {
  const { knowledgeModel, worldModel } = snapshot;
  const [repoOwner, repoName] = knowledgeModel.meta.repositoryId.split("/");
  const repoRef = knowledgeModel.meta.commitSha;

  const report = useMemo(() => computeHealthReport(knowledgeModel, worldModel), [knowledgeModel, worldModel]);
  const applicationDomains = useMemo(() => report.domains.filter((d) => !d.isInfra), [report.domains]);

  const [selected, setSelected] = useState<Selected>(null);
  const [viewingFilePath, setViewingFilePath] = useState<string | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);

  function selectVulnerability(item: VulnerabilityItem) {
    setViewingFilePath(null);
    setSelected((cur) => (cur?.kind === "vulnerability" && cur.item === item ? null : { kind: "vulnerability", item }));
  }
  function selectWeakness(item: WeaknessItem) {
    setViewingFilePath(null);
    setSelected((cur) => (cur?.kind === "weakness" && cur.item === item ? null : { kind: "weakness", item }));
  }

  return (
    <div style={{ position: "relative", width: "100%", minHeight: "100vh", overflow: "hidden", background: "#0A0D12", color: "#F3F1EA" }}>
      <ForestBackdrop />
      <WorldHud repoName={knowledgeModel.repository.name} activeLens="health" onSelectLens={onSelectLens} />

      <div style={{ position: "absolute", inset: 0, padding: "88px 32px 32px", overflowY: "auto" }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <div style={{ display: "flex", gap: 24, alignItems: "center", background: "rgba(18,23,29,0.7)", border: "0.5px solid rgba(255,255,255,0.09)", borderRadius: 12, padding: "18px 22px", marginBottom: 24, flexWrap: "wrap" }}>
            <ScoreRing value={report.score.value} />
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontFamily: "'Space Grotesk',system-ui,sans-serif", fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Repository health</div>
              <button
                onClick={() => setShowBreakdown((v) => !v)}
                style={{ background: "transparent", border: 0, padding: 0, fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: "#6B7580", cursor: "pointer" }}
              >
                {report.score.breakdown.length === 0 ? "No deductions — full marks" : `${showBreakdown ? "Hide" : "Show"} how this is calculated →`}
              </button>
              {showBreakdown && report.score.breakdown.length > 0 && (
                <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none" }}>
                  {report.score.breakdown.map((b, i) => (
                    <li key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, color: "#9CA6AC", padding: "3px 0", maxWidth: 340 }}>
                      <span>{b.label}</span>
                      <span style={{ color: CORAL }}>{b.delta}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <StatChip label="files" value={report.stats.fileCount} />
              <StatChip label="modules" value={report.stats.moduleCount} />
              <StatChip label="lines of code" value={report.stats.totalLinesOfCode.toLocaleString()} />
              <StatChip label="languages" value={report.stats.languageCount} />
              <StatChip label="technologies" value={report.stats.frameworkCount} />
            </div>
          </div>

          {applicationDomains.length > 0 && (
            <>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: 1.2, color: TEAL, margin: "0 0 12px" }}>HEALTH BY DOMAIN</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 20, marginBottom: 32 }}>
                {applicationDomains.map((d) => {
                  const color = TIER_COLOR[d.healthTier];
                  return (
                    <div key={d.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 96, cursor: onEnterDomain ? "pointer" : "default" }} onClick={() => onEnterDomain?.(d.id)}>
                      <svg width={96} height={64} viewBox="0 0 96 64">
                        <StepGlyph shape="hex" color={color} w={96} h={64} selected={false} />
                      </svg>
                      <div style={{ fontFamily: "'Space Grotesk',system-ui,sans-serif", fontSize: 12, fontWeight: 600, color: INK, marginTop: 8, textAlign: "center" }}>{d.name}</div>
                      <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9.5, color, marginTop: 1 }}>{d.healthTier}</div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 16, fontFamily: "'IBM Plex Mono',monospace", fontSize: 9.5, color: "#6B7580", marginBottom: 32, marginTop: -16, flexWrap: "wrap" }}>
                {(Object.keys(TIER_COLOR) as Domain["healthTier"][]).map((tier) => (
                  <span key={tier} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 2, background: TIER_COLOR[tier], display: "inline-block" }} />
                    {tier}
                  </span>
                ))}
              </div>
            </>
          )}

          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: 1.2, color: TEAL, margin: "0 0 12px" }}>
            VULNERABILITIES · {report.vulnerabilities.length}
          </div>
          {report.vulnerabilities.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "#6B7580", marginBottom: 32 }}>No secret-pattern matches found in this repository.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 32 }}>
              {report.vulnerabilities.map((v, i) => (
                <button
                  key={i}
                  onClick={() => selectVulnerability(v)}
                  style={{ textAlign: "left", display: "flex", alignItems: "center", gap: 10, background: "rgba(18,23,29,0.6)", border: "0.5px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "9px 12px", cursor: "pointer" }}
                >
                  <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9.5, fontWeight: 600, color: SEVERITY_COLOR[v.severity], background: softColor(SEVERITY_COLOR[v.severity]), borderRadius: 999, padding: "2px 9px", flexShrink: 0 }}>
                    {v.severity}
                  </span>
                  <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11.5, color: "#D8DBDE" }}>{v.rule}</span>
                  <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, color: "#6B7580", marginLeft: "auto" }}>
                    {v.fileId}:{v.line}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <div>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: 1.2, color: AMBER, margin: "0 0 12px" }}>
                WEAKNESSES · {report.weaknesses.length}
              </div>
              {report.weaknesses.length === 0 ? (
                <div style={{ fontSize: 12.5, color: "#6B7580" }}>No flagged weaknesses.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {report.weaknesses.map((w) => (
                    <button
                      key={w.id}
                      onClick={() => selectWeakness(w)}
                      style={{ textAlign: "left", background: "rgba(18,23,29,0.6)", border: "0.5px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "9px 12px", cursor: "pointer" }}
                    >
                      <div style={{ fontFamily: "'Space Grotesk',system-ui,sans-serif", fontSize: 12, fontWeight: 600, color: INK }}>{w.label}</div>
                      <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, color: "#6B7580", marginTop: 2 }}>{w.detail}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: 1.2, color: TEAL, margin: "0 0 12px" }}>
                STRENGTHS · {report.strengths.length}
              </div>
              {report.strengths.length === 0 ? (
                <div style={{ fontSize: 12.5, color: "#6B7580" }}>No positive signals detected yet.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {report.strengths.map((s: StrengthItem) => (
                    <div key={s.id} style={{ background: "rgba(18,23,29,0.6)", border: "0.5px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "9px 12px" }}>
                      <div style={{ fontFamily: "'Space Grotesk',system-ui,sans-serif", fontSize: 12, fontWeight: 600, color: INK }}>{s.label}</div>
                      <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, color: "#6B7580", marginTop: 2 }}>{s.detail}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
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
          ) : selected?.kind === "vulnerability" ? (
            <>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: 0.6,
                  textTransform: "uppercase",
                  color: SEVERITY_COLOR[selected.item.severity],
                  background: softColor(SEVERITY_COLOR[selected.item.severity]),
                  borderRadius: 999,
                  padding: "3px 10px",
                  marginBottom: 10,
                }}
              >
                {selected.item.severity}
              </div>
              <div style={{ fontFamily: "'Space Grotesk',system-ui,sans-serif", fontSize: 20, fontWeight: 700 }}>{selected.item.rule}</div>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: "#6B7580", marginBottom: 18 }}>
                {selected.item.fileId}:{selected.item.line}
              </div>
              <button
                onClick={() => setViewingFilePath(selected.item.fileId)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  background: softColor(TEAL),
                  color: TEAL,
                  border: `0.5px solid ${TEAL}55`,
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
          ) : selected?.kind === "weakness" ? (
            <>
              <div style={{ fontFamily: "'Space Grotesk',system-ui,sans-serif", fontSize: 20, fontWeight: 700, marginBottom: 10 }}>{selected.item.label}</div>
              <div style={{ fontSize: 13, lineHeight: 1.55, color: "#D8DBDE", marginBottom: 18 }}>{selected.item.detail}</div>
              {selected.item.fileId && (
                <button
                  onClick={() => setViewingFilePath(selected.item.fileId!)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    background: softColor(TEAL),
                    color: TEAL,
                    border: `0.5px solid ${TEAL}55`,
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
              )}
              {selected.item.domainId && onEnterDomain && (
                <button
                  onClick={() => onEnterDomain(selected.item.domainId!)}
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
