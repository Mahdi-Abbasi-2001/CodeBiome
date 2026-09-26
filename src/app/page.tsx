"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { LandingHero } from "@/features/landing/LandingHero";
import { ScanningView, INITIAL_SCAN_STAGES, type ScanStages } from "@/features/scanning/ScanningView";
import { streamAnalyze } from "@/lib/streamAnalyze";
import { parseGitHubUrl } from "@/lib/parseGitHubUrl";

type Phase = "landing" | "scanning";

/**
 * The browser-first entry point (docs/WORLD_ARCHITECTURE.md "Browser-first
 * fallback") — paste a GitHub URL, watch deterministic analysis run, then
 * get redirected to `/world/{worldId}` exactly like Bob's own
 * `analyze_repository` MCP tool would hand a developer that same URL. This
 * page no longer renders the 3D world itself (see
 * src/features/world-experience/WorldExperience.tsx, mounted from
 * `/world/[worldId]`) — both entry points produce the same World
 * abstraction and land on the same URL shape.
 */
export default function Home() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("landing");
  const [repoRef, setRepoRef] = useState<{ owner: string; repo: string } | null>(null);
  const [scanStages, setScanStages] = useState<ScanStages>(INITIAL_SCAN_STAGES);
  const [scanError, setScanError] = useState<string | null>(null);

  const handleAnalyze = useCallback(
    (url: string) => {
      let parsed: { owner: string; repo: string };
      try {
        parsed = parseGitHubUrl(url);
      } catch (e) {
        setRepoRef({ owner: "?", repo: "?" });
        setScanError(e instanceof Error ? e.message : "Invalid GitHub URL");
        setPhase("scanning");
        return;
      }

      setRepoRef(parsed);
      setScanStages(INITIAL_SCAN_STAGES);
      setScanError(null);
      setPhase("scanning");

      streamAnalyze(url, (event) => {
        if (event.type === "stage") {
          setScanStages((prev) => ({
            ...prev,
            [event.stage]: {
              status: event.status === "start" ? "active" : "done",
              detail: event.status === "done" ? event.detail : prev[event.stage].detail,
            },
          }));
        } else if (event.type === "result") {
          // A World now exists for this analysis (docs/WORLD_ARCHITECTURE.md)
          // — hand off to it instead of rendering the world inline here.
          router.push(`/world/${event.worldId}`);
        } else if (event.type === "error") {
          setScanError(event.error);
        }
      }).catch((err) => setScanError(err instanceof Error ? err.message : "Analysis failed"));
    },
    [router]
  );

  if (phase === "scanning" && repoRef) {
    return <ScanningView owner={repoRef.owner} repo={repoRef.repo} stages={scanStages} error={scanError} />;
  }

  return <LandingHero onAnalyze={handleAnalyze} />;
}
