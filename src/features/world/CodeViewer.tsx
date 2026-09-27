"use client";

import { useEffect, useState } from "react";

type CodeState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; content: string; truncated: boolean };

/**
 * Renders one real file's source, fetched on demand from /api/file. Never
 * fabricated — if the fetch fails, this shows the error, not placeholder code.
 */
export function CodeViewer({ owner, repo, gitRef, path }: { owner: string; repo: string; gitRef: string; path: string }) {
  const [state, setState] = useState<CodeState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    const params = new URLSearchParams({ owner, repo, ref: gitRef, path });
    fetch(`/api/file?${params.toString()}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
        return body as { content: string; truncated: boolean };
      })
      .then((body) => {
        if (!cancelled) setState({ kind: "ready", content: body.content, truncated: body.truncated });
      })
      .catch((err) => {
        if (!cancelled) setState({ kind: "error", message: err instanceof Error ? err.message : "Failed to load file" });
      });
    return () => {
      cancelled = true;
    };
  }, [owner, repo, gitRef, path]);

  if (state.kind === "loading") {
    return (
      <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: "#6B7580", padding: "24px 0" }}>
        Fetching source from GitHub…
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: "#E0553F", padding: "24px 0" }}>
        {state.message}
      </div>
    );
  }

  const lines = state.content.split("\n");

  return (
    <div>
      <div
        style={{
          background: "#0B0F14",
          border: "0.5px solid rgba(255,255,255,0.08)",
          borderRadius: 8,
          overflow: "auto",
          maxHeight: 600,
        }}
      >
        <table style={{ borderCollapse: "collapse", fontFamily: "'IBM Plex Mono',monospace", fontSize: 11.5, lineHeight: 1.6, width: "100%" }}>
          <tbody>
            {lines.map((line, i) => (
              <tr key={i}>
                <td
                  style={{
                    color: "#4A5560",
                    textAlign: "right",
                    padding: "0 10px",
                    userSelect: "none",
                    verticalAlign: "top",
                    whiteSpace: "nowrap",
                    position: "sticky",
                    left: 0,
                    background: "#0B0F14",
                  }}
                >
                  {i + 1}
                </td>
                <td style={{ color: "#D8DBDE", padding: "0 16px 0 0", whiteSpace: "pre" }}>{line || " "}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {state.truncated && (
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, color: "#6B7580", marginTop: 8 }}>
          File truncated to the first portion.
        </div>
      )}
    </div>
  );
}
