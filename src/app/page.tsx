"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { LandingHero } from "@/features/landing/LandingHero";
import { ScanningView } from "@/features/scanning/ScanningView";
import { parseGitHubUrl, type ParsedRepoRef } from "@/lib/parseGitHubUrl";

type Phase = { kind: "landing" } | { kind: "scanning"; repoRef: ParsedRepoRef; url: string };

export default function Home() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "landing" });

  const handleAnalyze = useCallback((url: string) => {
    if (!url.trim()) return;
    let repoRef: ParsedRepoRef;
    try {
      repoRef = parseGitHubUrl(url);
    } catch {
      return;
    }
    setPhase({ kind: "scanning", repoRef, url });
  }, []);

  const handleComplete = useCallback(
    (worldUrl: string) => {
      router.push(worldUrl);
    },
    [router]
  );

  if (phase.kind === "scanning") {
    return <ScanningView repoRef={phase.repoRef} url={phase.url} onComplete={handleComplete} />;
  }

  return <LandingHero onAnalyze={handleAnalyze} />;
}
