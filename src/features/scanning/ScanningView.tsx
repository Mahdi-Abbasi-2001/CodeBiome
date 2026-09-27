"use client";

import { useEffect, useRef, useState } from "react";
import { streamAnalyze } from "@/lib/streamAnalyze";
import type { AnalyzeStage } from "@/types/analyze-events";
import type { ParsedRepoRef } from "@/lib/parseGitHubUrl";

type StageStatus = "pending" | "active" | "done";

interface StageDef {
  stage: AnalyzeStage;
  label: string;
  detail: (d: Record<string, number>) => string;
}

const STAGES: StageDef[] = [
  { stage: "fetch", label: "Fetching the repository", detail: (d) => `${d.fileCount ?? 0} files downloaded` },
  {
    stage: "structure",
    label: "Mapping structure & modules",
    detail: (d) => `${d.moduleCount ?? 0} modules clustered from directory structure`,
  },
  { stage: "dependency", label: "Discovering dependencies", detail: (d) => `${d.edgeCount ?? 0} dependency edges found` },
  { stage: "entrypoints", label: "Finding entry points", detail: (d) => `${d.entryPointCount ?? 0} entry points identified` },
  {
    stage: "model",
    label: "Building the Knowledge Model",
    detail: (d) => `${d.fileCount ?? 0} files · ${d.moduleCount ?? 0} modules`,
  },
  { stage: "flows", label: "Inferring flows", detail: (d) => `${d.flowCount ?? 0} flows inferred` },
  {
    stage: "world",
    label: "Preparing the world",
    detail: (d) => `${d.regionCount ?? 0} regions · ${d.landmarkCount ?? 0} landmarks`,
  },
];

interface ScanState {
  status: Record<AnalyzeStage, StageStatus>;
  detail: Record<AnalyzeStage, Record<string, number>>;
  error: string | null;
}

function initialState(): ScanState {
  const status = {} as Record<AnalyzeStage, StageStatus>;
  const detail = {} as Record<AnalyzeStage, Record<string, number>>;
  for (const s of STAGES) {
    status[s.stage] = "pending";
    detail[s.stage] = {};
  }
  return { status, detail, error: null };
}

function StageIcon({ status }: { status: StageStatus }) {
  if (status === "done") {
    return (
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: "50%",
          background: "rgba(79,209,197,0.12)",
          border: "1.5px solid #4FD1C5",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path d="M2 8.5 6 12.5 14 3.5" stroke="#4FD1C5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }
  if (status === "active") {
    return (
      <div
        className="cb-pulse-fast"
        style={{
          width: 26,
          height: 26,
          borderRadius: "50%",
          background: "rgba(242,184,75,0.14)",
          border: "1.5px solid #F2B84B",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <svg className="cb-spin" width="13" height="13" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" stroke="#F2B84B" strokeWidth="2" strokeDasharray="20 18" />
        </svg>
      </div>
    );
  }
  return (
    <div
      style={{
        width: 26,
        height: 26,
        borderRadius: "50%",
        background: "rgba(255,255,255,0.04)",
        border: "1.5px solid rgba(255,255,255,0.16)",
        flexShrink: 0,
      }}
    />
  );
}

function AssemblingWorldScene({ progress }: { progress: number }) {
  return (
    <svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <defs>
        <radialGradient id="sky2" cx="82%" cy="10%" r="70%">
          <stop offset="0%" stopColor="#161F2B" />
          <stop offset="100%" stopColor="#0A0D12" />
        </radialGradient>
      </defs>
      <rect width="1440" height="900" fill="url(#sky2)" />
      <polygon points="700,660 900,580 1100,630 1300,560 1440,610 1440,900 700,900" fill="#151F1A" opacity="0.9" />
      <polygon points="760,740 980,660 1180,710 1400,650 1440,670 1440,900 760,900" fill="#0F1B15" />

      {/* materialized landmark: small tree (structure complete) */}
      <g opacity={progress > 0.25 ? 0.95 : 0.25} style={{ transition: "opacity 0.6s ease" }}>
        <circle cx="900" cy="600" r="60" fill="#1F5C41" />
        <circle cx="880" cy="580" r="38" fill="#3FA672" opacity="0.85" />
        <rect x="892" y="640" width="14" height="60" fill="#12241C" />
      </g>

      {/* materializing landmark: dashed wireframe gate (in progress) */}
      <g className="cb-fade" opacity={progress > 0.4 ? 1 : 0.15} style={{ transition: "opacity 0.6s ease" }}>
        <rect x="1080" y="640" width="10" height="80" fill="none" stroke="#4FD1C5" strokeWidth="1.5" strokeDasharray="4 4" />
        <rect x="1160" y="640" width="10" height="80" fill="none" stroke="#4FD1C5" strokeWidth="1.5" strokeDasharray="4 4" />
        <rect x="1074" y="628" width="102" height="10" fill="none" stroke="#4FD1C5" strokeWidth="1.5" strokeDasharray="4 4" />
      </g>

      {/* not-yet-generated landmark: faint ghost outline */}
      <g className="cb-fade" opacity="0.35">
        <ellipse cx="1300" cy="700" rx="50" ry="58" fill="none" stroke="#7C9CFF" strokeWidth="1.2" strokeDasharray="3 6" />
      </g>

      {/* scan grid */}
      <g stroke="#4FD1C5" opacity="0.10">
        <line x1="650" y1="0" x2="650" y2="900" />
        <line x1="850" y1="0" x2="850" y2="900" />
        <line x1="1050" y1="0" x2="1050" y2="900" />
        <line x1="1250" y1="0" x2="1250" y2="900" />
        <line x1="0" y1="300" x2="1440" y2="300" />
        <line x1="0" y1="500" x2="1440" y2="500" />
        <line x1="0" y1="700" x2="1440" y2="700" />
      </g>
      <rect
        x={650 + progress * 600}
        y="0"
        width="2"
        height="900"
        fill="#4FD1C5"
        opacity="0.5"
        className="cb-pulse-fast"
        style={{ transition: "x 0.8s ease" }}
      />
    </svg>
  );
}

/**
 * Real repos of this scale finish analysis in well under a second — far
 * faster than a human can read a 7-stage checklist. Events are queued and
 * drained on a minimum cadence so the (100% real, never fabricated) stage
 * data is still legible instead of flashing by in one frame.
 */
const MIN_STEP_MS = 260;

export function ScanningView({ repoRef, url, onComplete, onError }: { repoRef: ParsedRepoRef; url: string; onComplete: (worldUrl: string) => void; onError?: (message: string) => void }) {
  const [state, setState] = useState<ScanState>(initialState);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const queue: Array<() => void> = [];
    let draining = false;

    const drain = () => {
      const next = queue.shift();
      if (!next) {
        draining = false;
        return;
      }
      draining = true;
      next();
      setTimeout(drain, MIN_STEP_MS);
    };

    const enqueue = (apply: () => void) => {
      queue.push(apply);
      if (!draining) drain();
    };

    streamAnalyze(url, (event) => {
      if (event.type === "stage") {
        enqueue(() => {
          setState((prev) => {
            const status = { ...prev.status, [event.stage]: event.status === "start" ? "active" : "done" } as Record<AnalyzeStage, StageStatus>;
            const detail = event.status === "done" ? { ...prev.detail, [event.stage]: event.detail } : prev.detail;
            return { ...prev, status, detail };
          });
        });
      } else if (event.type === "result") {
        enqueue(() => onComplete(event.worldUrl));
      } else if (event.type === "error") {
        enqueue(() => {
          setState((prev) => ({ ...prev, error: event.error }));
          onError?.(event.error);
        });
      }
    }).catch((err) => {
      const message = err instanceof Error ? err.message : "Analysis failed";
      enqueue(() => {
        setState((prev) => ({ ...prev, error: message }));
        onError?.(message);
      });
    });
  }, [url, onComplete, onError]);

  const doneCount = STAGES.filter((s) => state.status[s.stage] === "done").length;
  const progress = doneCount / STAGES.length;
  const activeStage = STAGES.find((s) => state.status[s.stage] === "active");

  const files = state.detail.structure?.fileCount ?? state.detail.fetch?.fileCount;
  const modules = state.detail.structure?.moduleCount ?? state.detail.model?.moduleCount;
  const edges = state.detail.dependency?.edgeCount;
  const entryPoints = state.detail.entrypoints?.entryPointCount;

  return (
    <div style={{ position: "relative", width: "100%", minHeight: "100vh", overflow: "hidden", background: "#0A0D12", color: "#F3F1EA" }}>
      <AssemblingWorldScene progress={progress} />

      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(100deg,#0A0D12 0%,#0A0D12 40%,rgba(10,13,18,0.9) 54%,rgba(10,13,18,0.4) 72%,rgba(10,13,18,0.05) 90%)",
        }}
      />

      {/* top identity bar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 80,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 56px",
          boxSizing: "border-box",
          borderBottom: "0.5px solid rgba(255,255,255,0.07)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <svg width="22" height="22" viewBox="0 0 26 26">
            <circle cx="13" cy="13" r="11" fill="none" stroke="#4FD1C5" strokeWidth="1.6" />
            <circle cx="13" cy="13" r="4.5" fill="#F2B84B" />
          </svg>
          <span style={{ fontFamily: "'Space Grotesk',system-ui,sans-serif", fontSize: 16, fontWeight: 600 }}>CodeBiome</span>
        </div>
        <div style={{ fontFamily: "'IBM Plex Mono','SF Mono',Menlo,monospace", fontSize: 13, color: "#9CA6AC" }}>
          {repoRef.owner}/{repoRef.repo}
        </div>
      </div>

      {/* main progress column */}
      <div style={{ position: "absolute", left: 56, top: 150, width: 580 }}>
        <div style={{ fontFamily: "'IBM Plex Mono','SF Mono',Menlo,monospace", fontSize: 12, letterSpacing: 1.6, color: "#4FD1C5", marginBottom: 14 }}>
          BUILDING THE KNOWLEDGE MODEL
        </div>
        <h1 style={{ fontFamily: "'Space Grotesk',system-ui,sans-serif", fontSize: 34, fontWeight: 600, margin: "0 0 8px" }}>
          {state.error ? "Something went wrong." : "Reading the repository."}
        </h1>
        <p style={{ fontSize: 15, color: "#9CA6AC", margin: "0 0 40px", maxWidth: 480 }}>
          {state.error ?? "Deterministic analyzers establish the facts first — Bob only interprets what's already found."}
        </p>

        {!state.error && (
          <>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {STAGES.map((s) => {
                const status = state.status[s.stage];
                return (
                  <div key={s.stage} style={{ display: "flex", gap: 16, padding: "14px 0", opacity: status === "pending" ? 0.45 : 1 }}>
                    <StageIcon status={status} />
                    <div>
                      <div style={{ fontSize: 15, fontWeight: status === "active" ? 600 : 500, color: status === "active" ? "#F8F6EF" : status === "pending" ? "#B7BDC3" : "#F3F1EA" }}>
                        {s.label}
                      </div>
                      <div
                        style={{
                          fontFamily: "'IBM Plex Mono','SF Mono',Menlo,monospace",
                          fontSize: 12,
                          color: status === "active" ? "#F2B84B" : "#6B7580",
                          marginTop: 2,
                        }}
                      >
                        {status === "pending" ? "queued" : s.detail(state.detail[s.stage])}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 28, height: 4, width: "100%", background: "rgba(255,255,255,0.08)", borderRadius: 2, overflow: "hidden" }}>
              <div
                style={{
                  width: `${Math.max(4, progress * 100)}%`,
                  height: "100%",
                  background: "linear-gradient(90deg,#4FD1C5,#F2B84B)",
                  transition: "width 0.5s ease",
                }}
              />
            </div>
          </>
        )}
      </div>

      {/* live counters */}
      {!state.error && (
        <div style={{ position: "absolute", left: 56, bottom: 40, display: "flex", gap: 14 }}>
          {[
            { value: files, label: "files parsed" },
            { value: edges, label: "dependency edges" },
            { value: modules, label: "modules identified" },
            { value: entryPoints, label: "entry points found" },
          ].map((c) => (
            <div key={c.label} style={{ background: "#12171D", border: "0.5px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "14px 20px", minWidth: 120 }}>
              <div style={{ fontFamily: "'Space Grotesk',system-ui,sans-serif", fontSize: 22, fontWeight: 600, color: "#F3F1EA" }}>
                {c.value ?? "—"}
              </div>
              <div style={{ fontSize: 12, color: "#6B7580", marginTop: 2 }}>{c.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Bob status chip */}
      {!state.error && (
        <div
          style={{
            position: "absolute",
            right: 56,
            bottom: 40,
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "rgba(124,156,255,0.08)",
            border: "0.5px solid rgba(124,156,255,0.3)",
            borderRadius: 22,
            padding: "10px 18px 10px 10px",
          }}
        >
          <div
            className="cb-pulse-fast"
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: "#7C9CFF",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              fontWeight: 700,
              color: "#0A0D12",
            }}
          >
            B
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "#DCE3FF" }}>Bob is watching the scan</div>
            <div style={{ fontFamily: "'IBM Plex Mono','SF Mono',Menlo,monospace", fontSize: 11, color: "#8FA0DB" }}>
              {activeStage ? `${activeStage.label.toLowerCase()}…` : "will name domain concepts once modules settle"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
