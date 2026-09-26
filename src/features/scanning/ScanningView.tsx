"use client";

import type { AnalyzeStage } from "@/types/analyze-events";

export type StageStatus = "pending" | "active" | "done";
export type ScanStages = Record<AnalyzeStage, { status: StageStatus; detail?: Record<string, number> }>;

export const INITIAL_SCAN_STAGES: ScanStages = {
  fetch: { status: "pending" },
  structure: { status: "pending" },
  dependency: { status: "pending" },
  entrypoints: { status: "pending" },
  model: { status: "pending" },
  flows: { status: "pending" },
  world: { status: "pending" },
};

const STAGE_LABELS: Record<AnalyzeStage, string> = {
  fetch: "Fetching repository from GitHub",
  structure: "Mapping files & modules",
  dependency: "Discovering dependencies",
  entrypoints: "Finding entry points",
  model: "Building the Knowledge Model",
  flows: "Reconstructing likely execution paths",
  world: "Generating the CodeBiome world",
};

function stageDetail(stage: AnalyzeStage, detail?: Record<string, number>): string | null {
  if (!detail) return null;
  if (stage === "fetch") return `${detail.fileCount} files read`;
  if (stage === "structure") return `${detail.fileCount} files · ${detail.moduleCount} modules clustered`;
  if (stage === "dependency") return `${detail.edgeCount} dependency edges found`;
  if (stage === "entrypoints") return `${detail.entryPointCount} entry point(s) detected`;
  if (stage === "model") return `${detail.fileCount} files, ${detail.moduleCount} modules in the Knowledge Model`;
  if (stage === "flows") return `${detail.flowCount} candidate flow(s) inferred — statically, not from execution`;
  if (stage === "world") return `${detail.regionCount} regions, ${detail.landmarkCount} landmarks generated`;
  return null;
}

const ORDER: AnalyzeStage[] = ["fetch", "structure", "dependency", "entrypoints", "model", "flows", "world"];

/**
 * Every row here reflects a real, currently-implemented pipeline step —
 * never a fabricated one. The two "not yet built" rows at the bottom are
 * clearly labeled as such (Step 11: never claim a step ran if it didn't).
 */
export function ScanningView({
  owner,
  repo,
  stages,
  error,
}: {
  owner: string;
  repo: string;
  stages: ScanStages;
  error: string | null;
}) {
  const doneCount = ORDER.filter((s) => stages[s].status === "done").length;
  const percent = Math.round((doneCount / ORDER.length) * 100);

  return (
    <div className="flex min-h-screen flex-col bg-biome-bg px-6 py-10 text-ink-primary sm:px-14 sm:py-16">
      <div className="flex items-center justify-between border-b border-white/[0.07] pb-6">
        <div className="flex items-center gap-2.5">
          <svg width="22" height="22" viewBox="0 0 26 26">
            <circle cx="13" cy="13" r="11" fill="none" stroke="#4FD1C5" strokeWidth="1.6" />
            <circle cx="13" cy="13" r="4.5" fill="#F2B84B" />
          </svg>
          <span className="font-display text-base font-semibold">CodeBiome</span>
        </div>
        <div className="font-mono text-[13px] text-ink-faint">
          {owner}/{repo}
        </div>
      </div>

      <div className="mx-auto mt-12 w-full max-w-[580px]">
        <div className="mb-3.5 font-mono text-xs tracking-[1.6px] text-teal">BUILDING THE KNOWLEDGE MODEL</div>
        <h1 className="font-display text-2xl font-semibold sm:text-[34px]">Reading the repository.</h1>
        <p className="mt-2 max-w-[480px] text-sm text-ink-faint">
          Deterministic analyzers establish the facts first — nothing here is interpreted or invented.
        </p>

        {error && (
          <div className="mt-6 rounded-lg border border-ember/30 bg-ember/10 px-4 py-3 text-sm text-[#F5C9C1]">{error}</div>
        )}

        <div className="mt-8 flex flex-col">
          {ORDER.map((stage) => (
            <StageRow key={stage} stage={stage} state={stages[stage]} />
          ))}
          <FutureRow label="Full health, test & git-history audit" />
          <FutureRow label="Bob interpretation" />
        </div>

        <div className="mt-6 h-1 w-full overflow-hidden rounded-full bg-white/[0.08]">
          <div
            className="h-full bg-gradient-to-r from-teal to-amber transition-all duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function StageRow({ stage, state }: { stage: AnalyzeStage; state: ScanStages[AnalyzeStage] }) {
  const isDone = state.status === "done";
  const isActive = state.status === "active";
  return (
    <div className={`flex gap-4 py-3.5 ${state.status === "pending" ? "opacity-45" : ""}`}>
      <div
        className={`flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full border-[1.5px] ${
          isDone ? "border-teal bg-teal/10" : isActive ? "animate-cb-pulse border-amber bg-amber/10" : "border-white/15 bg-white/[0.04]"
        }`}
      >
        {isDone && (
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M2 8.5 6 12.5 14 3.5" stroke="#4FD1C5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        {isActive && (
          <svg className="animate-spin" width="13" height="13" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="#F2B84B" strokeWidth="2" strokeDasharray="20 18" />
          </svg>
        )}
      </div>
      <div>
        <div className={`text-[15px] ${isActive ? "font-semibold text-ink-bright" : "font-medium text-ink-primary"}`}>
          {STAGE_LABELS[stage]}
        </div>
        <div className={`mt-0.5 font-mono text-xs ${isActive ? "text-amber" : "text-ink-muted"}`}>
          {stageDetail(stage, state.detail) ?? (isActive ? "running…" : isDone ? "done" : "queued")}
        </div>
      </div>
    </div>
  );
}

function FutureRow({ label }: { label: string }) {
  return (
    <div className="flex gap-4 py-3.5 opacity-40">
      <div className="h-[26px] w-[26px] flex-shrink-0 rounded-full border-[1.5px] border-white/15 bg-white/[0.04]" />
      <div>
        <div className="text-[15px] text-ink-secondary">{label}</div>
        <div className="mt-0.5 font-mono text-xs text-ink-muted">not implemented in this build yet</div>
      </div>
    </div>
  );
}
