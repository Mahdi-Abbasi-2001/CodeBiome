"use client";

import { useEffect, useRef, useState } from "react";
import { streamAnalyze } from "@/lib/streamAnalyze";
import type { ParsedRepoRef } from "@/lib/parseGitHubUrl";

type StageStatus = "pending" | "active" | "done";

interface LogLine {
  id: number;
  text: string;
  tone: "info" | "ok" | "warn";
}

interface ScanState {
  fetchStatus: StageStatus;
  seedStatus: StageStatus;
  fileCount: number | null;
  log: LogLine[];
  agentUnavailable: string | null;
  error: string | null;
}

function initialState(): ScanState {
  return { fetchStatus: "pending", seedStatus: "pending", fileCount: null, log: [], agentUnavailable: null, error: null };
}

function StageIcon({ status }: { status: StageStatus }) {
  const color = status === "done" ? "#4FD1C5" : status === "active" ? "#F2B84B" : "rgba(255,255,255,0.16)";
  return (
    <div
      className={status === "active" ? "cb-pulse-fast" : undefined}
      style={{
        width: 22,
        height: 22,
        borderRadius: "50%",
        border: `1.5px solid ${color}`,
        background: status === "pending" ? "rgba(255,255,255,0.04)" : `${color}22`,
        flexShrink: 0,
      }}
    />
  );
}

/**
 * Real repos of this scale finish fetching/seeding in well under a second.
 * Events are queued and drained on a minimum cadence so fast stages are
 * still legible instead of flashing by in one frame. The agent's own tool
 * calls are shown as they actually happen — this is not a fixed checklist
 * anymore, since CodeBiome no longer knows in advance what an agent will
 * find or how many steps it will take.
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
      setState((prev) => ({ ...prev, log: [...prev.log.slice(-30), { id: nextLogId.current++, text, tone }] }));

    streamAnalyze(url, (event) => {
      if (event.type === "stage" && event.stage === "fetch") {
        enqueue(() =>
          setState((prev) => ({
            ...prev,
            fetchStatus: event.status === "start" ? "active" : "done",
            fileCount: event.status === "done" ? event.detail.fileCount : prev.fileCount,
          }))
        );
      } else if (event.type === "stage" && event.stage === "seed") {
        enqueue(() => setState((prev) => ({ ...prev, seedStatus: event.status === "start" ? "active" : "done" })));
      } else if (event.type === "agent_tool_call") {
        enqueue(() => pushLog(event.summary, event.ok ? "ok" : "warn"));
      } else if (event.type === "agent_message") {
        enqueue(() => pushLog(event.text, "info"));
      } else if (event.type === "agent_unavailable") {
        enqueue(() => setState((prev) => ({ ...prev, agentUnavailable: event.reason })));
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

  return (
    <div style={{ position: "relative", width: "100%", minHeight: "100vh", overflow: "hidden", background: "#0A0D12", color: "#F3F1EA" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 80, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 56px", boxSizing: "border-box", borderBottom: "0.5px solid rgba(255,255,255,0.07)" }}>
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

      <div style={{ position: "absolute", left: 56, top: 150, width: 620 }}>
        <div style={{ fontFamily: "'IBM Plex Mono','SF Mono',Menlo,monospace", fontSize: 12, letterSpacing: 1.6, color: "#4FD1C5", marginBottom: 14 }}>
          FETCHING THE REPOSITORY
        </div>
        <h1 style={{ fontFamily: "'Space Grotesk',system-ui,sans-serif", fontSize: 34, fontWeight: 600, margin: "0 0 8px" }}>
          {state.error ? "Something went wrong." : "Reading the repository."}
        </h1>
        <p style={{ fontSize: 15, color: "#9CA6AC", margin: "0 0 32px", maxWidth: 520 }}>
          {state.error ?? "CodeBiome records the real file tree — a connected agent does the actual architecture reasoning, and every claim it makes gets checked against these real files."}
        </p>

        {!state.error && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "8px 0" }}>
                <StageIcon status={state.fetchStatus} />
                <div style={{ fontSize: 14 }}>Fetching repository{state.fileCount != null ? ` — ${state.fileCount} files` : "…"}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "8px 0" }}>
                <StageIcon status={state.seedStatus} />
                <div style={{ fontSize: 14 }}>Recording file tree</div>
              </div>
            </div>

            {state.agentUnavailable && (
              <div style={{ fontSize: 13, color: "#F2B84B", background: "rgba(242,184,75,0.08)", border: "0.5px solid rgba(242,184,75,0.3)", borderRadius: 8, padding: "10px 14px", marginBottom: 20, maxWidth: 520 }}>
                {state.agentUnavailable}
              </div>
            )}

            {state.log.length > 0 && (
              <div style={{ fontFamily: "'IBM Plex Mono','SF Mono',Menlo,monospace", fontSize: 12.5, display: "flex", flexDirection: "column", gap: 6, maxHeight: 260, overflowY: "auto" }}>
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
    </div>
  );
}
