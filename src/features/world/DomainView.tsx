"use client";

import { useEffect, useMemo, useState } from "react";
import type { WorldSnapshot } from "@/types/world";
import { computeDomains, computeDomainBridges } from "@/lib/domains";
import { computeDomainSequence, buildingForFile } from "@/lib/domainSequence";
import { BuildingGlyph, ROLE_LABEL } from "./domainBuildings";
import { CodeViewer } from "./CodeViewer";

const LENS_TABS = ["Architecture", "Onboarding", "Flow", "Health", "Plan"];

function humanizeFileName(path: string): string {
  const stem = path.split("/").pop()!.replace(/\.[^.]+$/, "");
  const spaced = stem.replace(/[_.-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");
}

function roadPath(points: [number, number][]): string {
  if (points.length === 0) return "";
  let d = `M ${points[0][0]} ${points[0][1]} `;
  for (let i = 1; i < points.length; i++) {
    const [px, py] = points[i - 1];
    const [x, y] = points[i];
    const mx = (px + x) / 2;
    const my = (py + y) / 2 - 30;
    d += `Q ${mx} ${my} ${x} ${y} `;
  }
  return d;
}

export function DomainView({ snapshot, domainId, onZoomOut }: { snapshot: WorldSnapshot; domainId: string; onZoomOut: () => void }) {
  const { knowledgeModel, worldModel, world } = snapshot;
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<"details" | "code">("details");
  const [repoOwner, repoName] = knowledgeModel.meta.repositoryId.split("/");
  const repoRef = knowledgeModel.meta.commitSha;

  const domains = useMemo(() => computeDomains(worldModel, knowledgeModel), [worldModel, knowledgeModel]);
  const bridges = useMemo(() => computeDomainBridges(domains, knowledgeModel), [domains, knowledgeModel]);
  const domain = domains.find((d) => d.id === domainId) ?? domains[0];
  const sequence = useMemo(() => computeDomainSequence(domain, knowledgeModel), [domain, knowledgeModel]);

  const neighborName = useMemo(() => {
    const bridge = bridges.find((b) => b.fromDomainId === domain.id || b.toDomainId === domain.id);
    if (!bridge) return null;
    const otherId = bridge.fromDomainId === domain.id ? bridge.toDomainId : bridge.fromDomainId;
    return domains.find((d) => d.id === otherId)?.name ?? null;
  }, [bridges, domain, domains]);

  const selectedBuilding = selectedFileId ? buildingForFile(sequence, selectedFileId) : null;
  const selectedFile = selectedFileId ? knowledgeModel.files.find((f) => f.id === selectedFileId) ?? null : null;
  const selectedModule = selectedBuilding ? knowledgeModel.modules.find((m) => m.id === selectedBuilding.moduleId) ?? null : null;

  useEffect(() => {
    fetch("/api/session-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        worldId: world.id,
        selectedModuleId: selectedModule?.id ?? null,
        selectedModuleName: selectedFile ? humanizeFileName(selectedFile.path) : null,
      }),
    }).catch(() => {});
  }, [world.id, selectedModule?.id, selectedFile]);

  const bobPos: [number, number] = selectedBuilding
    ? [selectedBuilding.position[0] + 50, selectedBuilding.position[1] + 30]
    : sequence.plaza
      ? [sequence.plaza.center[0] + sequence.plaza.radius * 0.55, sequence.plaza.center[1] + 30]
      : [420, 780];

  const mainRoadD = roadPath(sequence.avenuePoints);
  const branchRoads = sequence.branches.map((b) => roadPath([b.from, b.building.position]));

  return (
    <div style={{ position: "relative", width: "100%", minHeight: "100vh", overflow: "hidden", background: "#0A0D12", color: "#F3F1EA" }}>
      <svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid meet" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <defs>
          <radialGradient id="skyDomain" cx="50%" cy="0%" r="90%">
            <stop offset="0%" stopColor="#1B2118" />
            <stop offset="100%" stopColor="#0A0D12" />
          </radialGradient>
          <pattern id="gridDomain" width="46" height="46" patternUnits="userSpaceOnUse">
            <path d="M46 0H0V46" fill="none" stroke="#233028" strokeWidth="1" />
          </pattern>
          <pattern id="gridYard" width="26" height="26" patternUnits="userSpaceOnUse">
            <path d="M26 0H0V26" fill="none" stroke="#0F3324" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="1440" height="900" fill="url(#skyDomain)" />

        {/* ground */}
        <rect x="0" y="150" width="1440" height="750" fill="#1B4531" />
        <rect x="0" y="150" width="1440" height="750" fill="url(#gridDomain)" opacity="0.4" />
        <rect x="0" y="150" width="1440" height="16" fill="#1A222A" opacity="0.6" />
        {neighborName && (
          <text x="1200" y="172" textAnchor="end" fontFamily="'IBM Plex Mono',monospace" fontSize="10" fill="#6B7580">
            {`↑ ${neighborName}, across the bridge`}
          </text>
        )}
        <rect x="0" y="866" width="1440" height="14" fill="#171D19" opacity="0.7" />
        <text x="60" y="884" fontFamily="'IBM Plex Mono',monospace" fontSize="10" fill="#6B7580">
          ← Gateway / wider city continues
        </text>

        {sequence.yard && (
          <g>
            <rect x={sequence.yard.x} y={sequence.yard.y} width={sequence.yard.width} height={sequence.yard.height} rx="12" fill="#081F16" />
            <rect x={sequence.yard.x} y={sequence.yard.y} width={sequence.yard.width} height={sequence.yard.height} rx="12" fill="url(#gridYard)" opacity="0.7" />
            <rect x={sequence.yard.x} y={sequence.yard.y} width={sequence.yard.width} height={sequence.yard.height} rx="12" fill="none" stroke="#0F3324" strokeWidth="2" />
            <text x={sequence.yard.x + sequence.yard.width / 2} y={sequence.yard.y + sequence.yard.height - 10} textAnchor="middle" fontFamily="'IBM Plex Mono',monospace" fontSize="9.5" fill="#3E6552">
              PERSISTENCE INFRASTRUCTURE
            </text>

            {/* retaining wall + ramp */}
            <path d={`M${sequence.yard.x - 10},${sequence.yard.wallY + 5} Q${sequence.yard.x + sequence.yard.width / 2},${sequence.yard.wallY + 20} ${sequence.yard.x + sequence.yard.width + 10},${sequence.yard.wallY + 30}`} stroke="#081C13" strokeWidth="34" fill="none" strokeLinecap="round" />
            <path d={`M${sequence.yard.x - 10},${sequence.yard.wallY - 4} Q${sequence.yard.x + sequence.yard.width / 2},${sequence.yard.wallY + 11} ${sequence.yard.x + sequence.yard.width + 10},${sequence.yard.wallY + 21}`} stroke="#0F3324" strokeWidth="8" fill="none" strokeLinecap="round" opacity="0.9" />
          </g>
        )}

        {sequence.plaza && (
          <g>
            {(() => {
              const [cx, cy] = sequence.plaza.center;
              const r = sequence.plaza.radius;
              const pts = Array.from({ length: 8 }, (_, i) => {
                const a = (Math.PI / 4) * i - Math.PI / 8;
                return [cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.55];
              });
              return (
                <>
                  <polygon points={pts.map((p) => p.join(",")).join(" ")} fill="#245E48" />
                  <polygon points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="#4FD1C5" strokeWidth="1.6" opacity="0.55" />
                  <g stroke="#3FA672" strokeWidth="0.8" opacity="0.35">
                    {pts.map((p, i) => (
                      <line key={i} x1={cx} y1={cy} x2={p[0]} y2={p[1]} />
                    ))}
                  </g>
                  <circle cx={cx} cy={cy} r={r * 0.5} fill="#F2B84B" opacity="0.09" />
                </>
              );
            })()}
          </g>
        )}

        {/* main avenue */}
        {mainRoadD && (
          <>
            <path d={mainRoadD} stroke="#123B2C" strokeWidth="22" fill="none" strokeLinecap="round" />
            <path d={mainRoadD} stroke="#F2B84B" strokeWidth="1.2" fill="none" opacity="0.4" strokeDasharray="1 10" />
          </>
        )}

        {/* junction + side branches */}
        {sequence.junction && (
          <ellipse cx={sequence.junction[0]} cy={sequence.junction[1]} rx="24" ry="10" fill="#123B2C" stroke="#4A2018" strokeWidth="1.4" />
        )}
        {branchRoads.map((d, i) => (
          <path key={i} d={d} stroke="#4A2018" strokeWidth="7" fill="none" strokeDasharray="2 7" opacity="0.6" />
        ))}

        {/* buildings */}
        {sequence.buildings.map((b) => (
          <g
            key={b.fileId}
            onClick={() => {
              setSelectedFileId(b.fileId);
              setPanelTab("details");
            }}
            style={{ cursor: "pointer" }}
            opacity={selectedFileId && selectedFileId !== b.fileId ? 0.7 : 1}
          >
            <BuildingGlyph role={b.role} cx={b.position[0]} cy={b.position[1]} damaged={b.damaged} isPrimary={b.role === "service"} />
          </g>
        ))}

        {/* Bob — a visual guide only, never a click target, and never allowed to sit on top of a building */}
        <g pointerEvents="none" style={{ transition: "transform 0.6s ease" }} transform={`translate(${bobPos[0]},${bobPos[1]})`}>
          <ellipse cx="0" cy="18" rx="10" ry="3" fill="#000" opacity="0.35" />
          <rect x="-6" y="-6" width="12" height="20" rx="5" fill="#B9C8FF" />
          <circle cx="0" cy="-12" r="7" fill="#DCE3FF" />
          <rect x="-6" y="0" width="12" height="6" fill="#7C9CFF" opacity="0.85" />
        </g>
      </svg>

      {/* labels */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <svg viewBox="0 0 1440 900" style={{ width: "100%", height: "100%", overflow: "visible" }}>
          <foreignObject x="0" y="0" width="1440" height="900">
            <div style={{ position: "relative", width: 1440, height: 900 }}>
              {sequence.buildings.map((b) =>
                b.compact ? (
                  // A crowded cluster (many branches, or a main-sequence stop
                  // that had to spiral) can't fit a 220px label per item
                  // without them overlapping regardless of how well the
                  // POSITIONS are spread — this is a smaller, name-only label
                  // instead of pretending the wide one still fits. The full
                  // role/risk detail is one click away in the Investigation
                  // panel, so nothing is actually lost, just not always shown.
                  <div
                    key={b.fileId}
                    title={`${humanizeFileName(b.path)} — ${ROLE_LABEL[b.role] ?? b.role}`}
                    style={{ position: "absolute", left: b.position[0] - 55, top: b.position[1] + 16, width: 110, textAlign: "center" }}
                  >
                    <div
                      style={{
                        fontFamily: "'Space Grotesk',system-ui,sans-serif",
                        fontSize: 9.5,
                        fontWeight: 600,
                        color: b.damaged ? "#F4C6BC" : "#F8F6EF",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {humanizeFileName(b.path)}
                    </div>
                  </div>
                ) : (
                  <div key={b.fileId} style={{ position: "absolute", left: b.position[0] - 110, top: b.position[1] + 20, width: 220, textAlign: "center" }}>
                    <div style={{ fontFamily: "'Space Grotesk',system-ui,sans-serif", fontSize: b.role === "service" ? 15 : 12.5, fontWeight: b.role === "service" ? 700 : 600, color: b.damaged ? "#F4C6BC" : "#F8F6EF" }}>
                      {humanizeFileName(b.path)}
                    </div>
                    <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: b.damaged ? "#E0553F" : b.role === "service" ? "#F2B84B" : "#6B7580" }}>
                      {b.damaged ? "risk · " : ""}
                      {ROLE_LABEL[b.role] ?? b.role}
                    </div>
                  </div>
                )
              )}
            </div>
          </foreignObject>
        </svg>
      </div>

      {/* HUD */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 64, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px", boxSizing: "border-box", background: "linear-gradient(180deg,rgba(10,13,18,0.9),rgba(10,13,18,0))" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <svg width="20" height="20" viewBox="0 0 26 26">
            <circle cx="13" cy="13" r="11" fill="none" stroke="#4FD1C5" strokeWidth="1.6" />
            <circle cx="13" cy="13" r="4.5" fill="#F2B84B" />
          </svg>
          <span style={{ fontFamily: "'Space Grotesk',system-ui,sans-serif", fontSize: 14, fontWeight: 600 }}>CodeBiome</span>
          <span style={{ color: "#3D3D3A" }}>/</span>
          <button onClick={onZoomOut} style={{ background: "transparent", border: 0, fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: "#8A9199", padding: 0, cursor: "pointer" }}>
            {knowledgeModel.repository.name}
          </button>
          <span style={{ color: "#3D3D3A" }}>›</span>
          <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: "#F2B84B", fontWeight: 600 }}>{domain.name}</span>
        </div>
        <div style={{ display: "flex", background: "rgba(255,255,255,0.05)", border: "0.5px solid rgba(255,255,255,0.1)", borderRadius: 20, padding: 3, gap: 1 }}>
          {LENS_TABS.map((lens) => (
            <button
              key={lens}
              disabled={lens !== "Architecture"}
              title={lens === "Architecture" ? undefined : "Zoom out to switch tabs"}
              style={{ border: 0, background: lens === "Architecture" ? "#F2B84B" : "transparent", color: lens === "Architecture" ? "#171208" : "#8A9199", fontWeight: lens === "Architecture" ? 600 : 400, fontSize: 12, padding: "7px 13px", borderRadius: 15, fontFamily: "inherit", cursor: lens === "Architecture" ? "default" : "not-allowed" }}
            >
              {lens}
            </button>
          ))}
        </div>
        <button onClick={onZoomOut} style={{ display: "flex", alignItems: "center", gap: 7, background: "rgba(255,255,255,0.05)", border: "0.5px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px 14px", color: "#B7BDC3", fontSize: 12.5, cursor: "pointer" }}>
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
            <path d="M4 10 8 4l4 6" stroke="#B7BDC3" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Zoom out
        </button>
      </div>

      {/* legend / hierarchy readout */}
      <div style={{ position: "absolute", left: 24, top: 82, width: 296, background: "rgba(18,23,29,0.82)", border: "0.5px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "15px 17px", backdropFilter: "blur(6px)" }}>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: 1.2, color: "#4FD1C5", marginBottom: 9 }}>
          REPOSITORY › {domain.name.toUpperCase()}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11.5, color: "#B7BDC3", marginBottom: 12 }}>
          <div>Entrance → hub → boundary → interface → infrastructure</div>
          {sequence.plaza && <div>Plaza <span style={{ color: "#6B7580" }}>— application layer, at grade</span></div>}
          {sequence.yard && (
            <>
              <div>Wall + ramp <span style={{ color: "#6B7580" }}>— the boundary, one level down</span></div>
              <div>Recessed yard <span style={{ color: "#6B7580" }}>— persistence infrastructure</span></div>
            </>
          )}
        </div>
        {sequence.branches.length > 0 && (
          <div style={{ borderTop: "0.5px solid rgba(255,255,255,0.08)", paddingTop: 10, fontSize: 11.5, lineHeight: 1.5, color: "#9CA6AC" }}>
            One avenue runs the main chain. {sequence.branches.map((b) => humanizeFileName(b.building.path)).join(", ")} fork{sequence.branches.length === 1 ? "s" : ""} off at the junction — <strong style={{ color: "#F4C6BC" }}>related, not on this path.</strong>
          </div>
        )}
      </div>

      {/* stats */}
      <div style={{ position: "absolute", left: 24, bottom: 24, display: "flex", gap: 8 }}>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: "#6B7580", background: "rgba(18,23,29,0.7)", border: "0.5px solid rgba(255,255,255,0.08)", borderRadius: 9, padding: "9px 14px" }}>
          {sequence.buildings.length} module{sequence.buildings.length === 1 ? "" : "s"} · {sequence.internalEdgeCount} internal edge{sequence.internalEdgeCount === 1 ? "" : "s"}
          {sequence.riskFileCount > 0 && ` · ${sequence.riskFileCount} risk indicator${sequence.riskFileCount === 1 ? "" : "s"}`}
        </div>
      </div>

      {/* Investigation panel */}
      {selectedFile && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            width: panelTab === "code" ? 640 : 360,
            maxWidth: "90vw",
            background: "rgba(13,17,22,0.96)",
            borderLeft: "0.5px solid rgba(255,255,255,0.1)",
            padding: "88px 24px 24px",
            overflowY: "auto",
            backdropFilter: "blur(8px)",
            transition: "width 0.15s ease",
          }}
        >
          <button onClick={() => setSelectedFileId(null)} style={{ position: "absolute", top: 24, right: 24, background: "transparent", border: 0, color: "#6B7580", cursor: "pointer", fontSize: 13 }}>
            ✕ close
          </button>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: 1.2, color: "#4FD1C5", marginBottom: 8 }}>INVESTIGATION</div>
          <div style={{ fontFamily: "'Space Grotesk',system-ui,sans-serif", fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{humanizeFileName(selectedFile.path)}</div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: "#6B7580", marginBottom: 16 }}>{selectedFile.path}</div>

          <div style={{ display: "inline-flex", background: "rgba(255,255,255,0.05)", border: "0.5px solid rgba(255,255,255,0.1)", borderRadius: 20, padding: 3, gap: 1, marginBottom: 20 }}>
            {(["details", "code"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setPanelTab(tab)}
                style={{
                  border: 0,
                  background: panelTab === tab ? "#F2B84B" : "transparent",
                  color: panelTab === tab ? "#171208" : "#8A9199",
                  fontWeight: panelTab === tab ? 600 : 400,
                  fontSize: 12,
                  padding: "6px 16px",
                  borderRadius: 15,
                  fontFamily: "inherit",
                  cursor: "pointer",
                  textTransform: "capitalize",
                }}
              >
                {tab}
              </button>
            ))}
          </div>

          {panelTab === "code" ? (
            <CodeViewer owner={repoOwner} repo={repoName} gitRef={repoRef} path={selectedFile.path} />
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13, color: "#D8DBDE" }}>
                <div>
                  Role: <strong style={{ color: "#F3F1EA" }}>{selectedBuilding ? ROLE_LABEL[selectedBuilding.role] ?? selectedBuilding.role : "unclassified"}</strong>
                </div>
                <div>
                  Lines of code: <strong style={{ color: "#F3F1EA" }}>{selectedFile.linesOfCode}</strong>
                </div>
                {selectedFile.complexity && (
                  <div>
                    Cyclomatic complexity: <strong style={{ color: "#F3F1EA" }}>{selectedFile.complexity.cyclomaticComplexity}</strong>
                  </div>
                )}
                <div>
                  Tests: <strong style={{ color: selectedFile.testStatus.coveredByTests ? "#3FA672" : "#E0553F" }}>{selectedFile.testStatus.coveredByTests ? "covered" : "no coverage found"}</strong>
                </div>
              </div>

              {selectedFile.riskIndicators.length > 0 && (
                <div style={{ marginTop: 20 }}>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: 1, color: "#E0553F", marginBottom: 8 }}>RISK INDICATORS</div>
                  {selectedFile.riskIndicators.map((r, i) => (
                    <div key={i} style={{ fontSize: 12.5, color: "#F4C6BC", marginBottom: 6 }}>
                      <strong>{r.kind}</strong> ({r.severity}) — {r.detail}
                    </div>
                  ))}
                </div>
              )}

              {(() => {
                const outgoing = knowledgeModel.dependencies.filter((e) => e.fromId === selectedFile.id && e.fromKind === "file" && e.toKind === "file");
                const incoming = knowledgeModel.dependencies.filter((e) => e.toId === selectedFile.id && e.toKind === "file" && e.fromKind === "file");
                const fileById = new Map(knowledgeModel.files.map((f) => [f.id, f]));
                return (
                  <>
                    {outgoing.length > 0 && (
                      <div style={{ marginTop: 20 }}>
                        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: 1, color: "#6B7580", marginBottom: 8 }}>DEPENDS ON</div>
                        {outgoing.map((e) => (
                          <div key={e.id} style={{ fontSize: 12.5, color: "#B7BDC3", marginBottom: 4 }}>
                            {fileById.get(e.toId)?.path ?? e.toId}
                          </div>
                        ))}
                      </div>
                    )}
                    {incoming.length > 0 && (
                      <div style={{ marginTop: 20 }}>
                        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: 1, color: "#6B7580", marginBottom: 8 }}>USED BY</div>
                        {incoming.map((e) => (
                          <div key={e.id} style={{ fontSize: 12.5, color: "#B7BDC3", marginBottom: 4 }}>
                            {fileById.get(e.fromId)?.path ?? e.fromId}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </>
          )}
        </div>
      )}

      {!selectedFile && sequence.isGeneric && (
        <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", textAlign: "center", color: "#6B7580", fontFamily: "'IBM Plex Mono',monospace", fontSize: 13 }}>
          No recognizable architectural roles in this district yet.
        </div>
      )}
    </div>
  );
}
