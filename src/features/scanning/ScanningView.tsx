"use client";

import { useEffect, useRef, useState } from "react";
import { streamAnalyze } from "@/lib/streamAnalyze";
import type { ParsedRepoRef } from "@/lib/parseGitHubUrl";

type StageStatus = "pending" | "active" | "done" | "skipped";

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
  if (status === "skipped") {
    return (
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: "50%",
          background: "rgba(255,255,255,0.04)",
          border: "1.5px solid rgba(255,255,255,0.16)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          fontSize: 13,
          color: "#6B7580",
        }}
      >
        –
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

      {/* materialized landmark: fetch + file-tree recorded */}
      <g opacity={progress > 0.15 ? 0.95 : 0.25} style={{ transition: "opacity 0.6s ease" }}>
        <circle cx="900" cy="600" r="60" fill="#1F5C41" />
        <circle cx="880" cy="580" r="38" fill="#3FA672" opacity="0.85" />
        <rect x="892" y="640" width="14" height="60" fill="#12241C" />
      </g>

      {/* materializing landmark: an agent's submissions taking shape */}
      <g className="cb-fade" opacity={progress > 0.35 ? 1 : 0.15} style={{ transition: "opacity 0.6s ease" }}>
        <rect x="1080" y="640" width="10" height="80" fill="none" stroke="#4FD1C5" strokeWidth="1.5" strokeDasharray="4 4" />
        <rect x="1160" y="640" width="10" height="80" fill="none" stroke="#4FD1C5" strokeWidth="1.5" strokeDasharray="4 4" />
        <rect x="1074" y="628" width="102" height="10" fill="none" stroke="#4FD1C5" strokeWidth="1.5" strokeDasharray="4 4" />
      </g>

      {/* not-yet-submitted landmark: faint ghost outline */}
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

interface LogLine {
  id: number;
  text: string;
  tone: "info" | "ok" | "warn";
}

interface ScanState {
  fetchStatus: StageStatus;
  seedStatus: StageStatus;
  agentStatus: StageStatus;
  fileCount: number | null;
  toolCallCount: number;
  submittedCounts: { modules: number; dependencies: number; entryPoints: number; flows: number };
  log: LogLine[];
  agentNote: string | null;
  error: string | null;
  worldUrl: string | null;
}

function initialState(): ScanState {
  return {
    fetchStatus: "pending",
    seedStatus: "pending",
    agentStatus: "pending",
    fileCount: null,
    toolCallCount: 0,
    submittedCounts: { modules: 0, dependencies: 0, entryPoints: 0, flows: 0 },
    log: [],
    agentNote: null,
    error: null,
    worldUrl: null,
  };
}

/**
 * Real repos finish fetch+seed in well under a second — far faster than a
 * human can read a checklist. Events are queued and drained on a minimum
 * cadence so fast stages are still legible instead of flashing by in one
 * frame. The agent phase naturally paces itself (each tool call is a real
 * LLM round trip), so this only throttles the deterministic part.
 */
const MIN_STEP_MS = 220;

export function ScanningView({ repoRef, url, onComplete, onError }: { repoRef: ParsedRepoRef; url: string; onComplete: (worldUrl: string) => void; onError?: (message: string) => void }) {
  const [state, setState] = useState<ScanState>(initialState);
  const startedRef = useRef(false);
  const nextLogId = useRef(0);

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

    const pushLog = (text: string, tone: LogLine["tone"]) =>
      setState((prev) => ({ ...prev, log: [...prev.log.slice(-40), { id: nextLogId.current++, text, tone }] }));

    let worldUrl: string | null = null;
    let settled = false;
    const settle = (fallbackNote?: string) => {
      if (settled || !worldUrl) return;
      settled = true;
      if (fallbackNote) enqueue(() => setState((prev) => ({ ...prev, agentNote: fallbackNote })));
      enqueue(() => onComplete(worldUrl!));
    };

    /**
     * The agent's own loop can be cut off mid-run (Vercel's function
     * duration limit, a stalled upstream connection) with no clean
     * terminal event ever reaching the client — without this, the page
     * would just hang on "calling …" forever. Once a World exists, any
     * silence this long means "stop waiting and show what's there" rather
     * than "still working" — a World with partial data beats a frozen
     * loading screen.
     */
    let lastActivityAt = Date.now();
    const WATCHDOG_IDLE_MS = 25_000;
    const watchdog = setInterval(() => {
      if (worldUrl && !settled && Date.now() - lastActivityAt > WATCHDOG_IDLE_MS) {
        settle("taking longer than expected — opening what's been found so far…");
      }
    }, 2000);

    streamAnalyze(url, (event) => {
      lastActivityAt = Date.now();
      if (event.type === "stage" && event.stage === "fetch") {
        enqueue(() =>
          setState((prev) => ({
            ...prev,
            fetchStatus: event.status === "start" ? "active" : "done",
            fileCount: event.status === "done" ? event.detail.fileCount : prev.fileCount,
          }))
        );
      } else if (event.type === "stage" && event.stage === "seed") {
        enqueue(() => setState((prev) => ({ ...prev, seedStatus: event.status === "start" ? "active" : "done", agentStatus: event.status === "done" ? "active" : prev.agentStatus })));
      } else if (event.type === "agent_tool_call") {
        enqueue(() => {
          pushLog(event.summary, event.ok ? "ok" : "warn");
          setState((prev) => {
            const submittedCounts = { ...prev.submittedCounts };
            if (event.tool === "submit_modules") submittedCounts.modules += 1;
            if (event.tool === "submit_dependencies") submittedCounts.dependencies += 1;
            if (event.tool === "submit_entry_points") submittedCounts.entryPoints += 1;
            if (event.tool === "submit_flow" || event.tool === "submit_request_journey") submittedCounts.flows += 1;
            return { ...prev, toolCallCount: prev.toolCallCount + 1, submittedCounts, agentNote: `calling ${event.tool}…` };
          });
        });
      } else if (event.type === "agent_message") {
        enqueue(() => pushLog(event.text, "info"));
      } else if (event.type === "agent_unavailable") {
        enqueue(() => setState((prev) => ({ ...prev, agentStatus: "skipped", agentNote: event.reason })));
        settle();
      } else if (event.type === "agent_done") {
        enqueue(() => setState((prev) => ({ ...prev, agentStatus: "done", agentNote: "finished" })));
        settle();
      } else if (event.type === "result") {
        worldUrl = event.worldUrl;
        enqueue(() => setState((prev) => ({ ...prev, worldUrl: event.worldUrl })));
      } else if (event.type === "error") {
        settled = true;
        enqueue(() => {
          setState((prev) => ({ ...prev, error: event.error }));
          onError?.(event.error);
        });
      }
    })
      .catch((err) => {
        const message = err instanceof Error ? err.message : "Analysis failed";
        settled = true;
        enqueue(() => {
          setState((prev) => ({ ...prev, error: message }));
          onError?.(message);
        });
      })
      .finally(() => {
        // The stream ended (cleanly or not) with no terminal redirect event —
        // a World exists, so open it rather than leaving the page stuck.
        settle();
        clearInterval(watchdog);
      });

    return () => clearInterval(watchdog);
  }, [url, onComplete, onError]);

  const stageWeight = { fetch: 0.15, seed: 0.15 } as const;
  let progress = 0;
  if (state.fetchStatus === "done") progress += stageWeight.fetch;
  else if (state.fetchStatus === "active") progress += stageWeight.fetch * 0.5;
  if (state.seedStatus === "done") progress += stageWeight.seed;
  else if (state.seedStatus === "active") progress += stageWeight.seed * 0.5;
  if (state.agentStatus === "done" || state.agentStatus === "skipped") progress = 1;
  else if (state.agentStatus === "active") progress += 0.7 * (1 - 1 / (1 + state.toolCallCount / 5));

  const { modules, dependencies, entryPoints, flows } = state.submittedCounts;

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
      <div style={{ position: "absolute", left: 56, top: 150, width: 600 }}>
        <div style={{ fontFamily: "'IBM Plex Mono','SF Mono',Menlo,monospace", fontSize: 12, letterSpacing: 1.6, color: "#4FD1C5", marginBottom: 14 }}>
          BUILDING THE KNOWLEDGE MODEL
        </div>
        <h1 style={{ fontFamily: "'Space Grotesk',system-ui,sans-serif", fontSize: 34, fontWeight: 600, margin: "0 0 8px" }}>
          {state.error ? "Something went wrong." : "Reading the repository."}
        </h1>
        <p style={{ fontSize: 15, color: "#9CA6AC", margin: "0 0 32px", maxWidth: 500 }}>
          {state.error ?? "CodeBiome records the real file tree — an AI agent does the architecture reasoning, and every claim it makes is checked against these real files before it's shown."}
        </p>

        {!state.error && (
          <>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", gap: 16, padding: "14px 0", opacity: state.fetchStatus === "pending" ? 0.45 : 1 }}>
                <StageIcon status={state.fetchStatus} />
                <div>
                  <div style={{ fontSize: 15, fontWeight: state.fetchStatus === "active" ? 600 : 500, color: state.fetchStatus === "active" ? "#F8F6EF" : state.fetchStatus === "pending" ? "#B7BDC3" : "#F3F1EA" }}>
                    Fetching the repository
                  </div>
                  <div style={{ fontFamily: "'IBM Plex Mono','SF Mono',Menlo,monospace", fontSize: 12, color: state.fetchStatus === "active" ? "#F2B84B" : "#6B7580", marginTop: 2 }}>
                    {state.fetchStatus === "pending" ? "queued" : `${state.fileCount ?? 0} files downloaded`}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 16, padding: "14px 0", opacity: state.seedStatus === "pending" ? 0.45 : 1 }}>
                <StageIcon status={state.seedStatus} />
                <div>
                  <div style={{ fontSize: 15, fontWeight: state.seedStatus === "active" ? 600 : 500, color: state.seedStatus === "active" ? "#F8F6EF" : state.seedStatus === "pending" ? "#B7BDC3" : "#F3F1EA" }}>
                    Recording the file tree
                  </div>
                  <div style={{ fontFamily: "'IBM Plex Mono','SF Mono',Menlo,monospace", fontSize: 12, color: state.seedStatus === "active" ? "#F2B84B" : "#6B7580", marginTop: 2 }}>
                    {state.seedStatus === "done" ? "no analysis performed — an agent explores the real code next" : state.seedStatus === "pending" ? "queued" : "walking directory structure…"}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 16, padding: "14px 0", opacity: state.agentStatus === "pending" ? 0.45 : 1 }}>
                <StageIcon status={state.agentStatus} />
                <div>
                  <div style={{ fontSize: 15, fontWeight: state.agentStatus === "active" ? 600 : 500, color: state.agentStatus === "active" ? "#F8F6EF" : state.agentStatus === "pending" ? "#B7BDC3" : "#F3F1EA" }}>
                    An AI agent explores &amp; submits findings
                  </div>
                  <div style={{ fontFamily: "'IBM Plex Mono','SF Mono',Menlo,monospace", fontSize: 12, color: state.agentStatus === "active" ? "#F2B84B" : "#6B7580", marginTop: 2, maxWidth: 480 }}>
                    {state.agentStatus === "pending" && "queued"}
                    {state.agentStatus === "active" && (state.agentNote ?? `${state.toolCallCount} tool call(s) so far`)}
                    {state.agentStatus === "done" && `${state.toolCallCount} tool call(s) made`}
                    {state.agentStatus === "skipped" && (state.agentNote ?? "no agent connected")}
                  </div>
                </div>
              </div>
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

            {state.log.length > 0 && (
              <div style={{ marginTop: 22, fontFamily: "'IBM Plex Mono','SF Mono',Menlo,monospace", fontSize: 12.5, display: "flex", flexDirection: "column", gap: 6, maxHeight: 180, overflowY: "auto" }}>
                {state.log.map((l) => (
                  <div key={l.id} style={{ color: l.tone === "warn" ? "#F2B84B" : l.tone === "ok" ? "#4FD1C5" : "#9CA6AC" }}>
                    {l.text}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* live counters */}
      {!state.error && (
        <div style={{ position: "absolute", left: 56, bottom: 40, display: "flex", gap: 14 }}>
          {[
            { value: state.fileCount, label: "files found" },
            { value: modules || undefined, label: "modules submitted" },
            { value: dependencies || undefined, label: "dependency edges submitted" },
            { value: entryPoints + flows || undefined, label: "entry points & flows submitted" },
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

      {/* agent status chip */}
      {!state.error && state.agentStatus !== "pending" && (
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
            className={state.agentStatus === "active" ? "cb-pulse-fast" : undefined}
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
            AI
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "#DCE3FF" }}>
              {state.agentStatus === "skipped" ? "No agent connected" : state.agentStatus === "done" ? "Agent finished" : "Agent is exploring the repository"}
            </div>
            <div style={{ fontFamily: "'IBM Plex Mono','SF Mono',Menlo,monospace", fontSize: 11, color: "#8FA0DB", maxWidth: 320 }}>
              {state.agentStatus === "skipped" ? "connect your own via docs/MCP_CLIENTS.md" : state.agentNote ?? "…"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
