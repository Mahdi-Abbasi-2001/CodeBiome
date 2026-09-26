"use client";

import { useEffect, useMemo, useState } from "react";
import type { RepositoryKnowledgeModel, ModuleFact } from "@/types/knowledge-model";
import type { Flow, FlowStep } from "@/types/flow";
import { highlightCode } from "@/lib/highlightCode";
import { BobPanel } from "./BobPanel";

type Tab = "overview" | "code" | "dependencies" | "dependents" | "health" | "flow" | "bob";
const BASE_TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "code", label: "Code" },
  { id: "dependencies", label: "Dependencies" },
  { id: "dependents", label: "Dependents" },
  { id: "health", label: "Health" },
  { id: "bob", label: "Bob" },
];

function moduleIcon(mod: ModuleFact) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24">
      <circle cx="12" cy="9" r="7" fill="#F2B84B" opacity={0.85} />
      <rect x="10" y="15" width="4" height="7" fill="#8A672B" />
    </svg>
  );
}

export function InvestigationPanel({
  knowledgeModel,
  moduleId,
  onClose,
  onHighlightDependency,
  activeFlow = null,
  currentStepId = null,
  onContinueFlow,
  onResumeFlow,
  onExitFlow,
  requestedTab = null,
  requestedFilePath = null,
}: {
  knowledgeModel: RepositoryKnowledgeModel;
  moduleId: string;
  onClose: () => void;
  onHighlightDependency?: (targetModuleId: string | null) => void;
  /** Non-null only while a Flow walkthrough is active. */
  activeFlow?: Flow | null;
  /** The step id the walkthrough is actually sitting on right now — may differ from the step shown here if the user paused to inspect something else. */
  currentStepId?: string | null;
  onContinueFlow?: () => void;
  onResumeFlow?: () => void;
  onExitFlow?: () => void;
  /**
   * Set by a Bob `show_dependencies`/`show_impact` MCP tool call (see
   * src/features/bob/useBobBridge.ts) to jump to a specific tab. `nonce`
   * must change on every request (even to the same tab) so the effect below
   * re-fires — plain tab equality wouldn't distinguish "asked again".
   */
  requestedTab?: { tab: Tab; nonce: number } | null;
  /** Set by a Bob `open_file` MCP tool call to preselect a file in the Code tab. Same `nonce` requirement as `requestedTab`. */
  requestedFilePath?: { path: string; nonce: number } | null;
}) {
  // Multiple flow steps can share a moduleId (e.g. a controller and its
  // service living in the same directory-level module), so a plain
  // moduleId lookup would always resolve to the first such step and never
  // advance. Prefer the walkthrough's actual current step whenever it still
  // matches the module being viewed; only fall back to the first match when
  // the user has navigated to a module the live step isn't on (paused).
  const flowStep = useMemo<FlowStep | null>(() => {
    if (!activeFlow) return null;
    const live = activeFlow.steps.find((s) => s.id === currentStepId);
    if (live && live.moduleId === moduleId) return live;
    return activeFlow.steps.find((s) => s.moduleId === moduleId) ?? null;
  }, [activeFlow, moduleId, currentStepId]);
  const isLiveStep = flowStep !== null && flowStep.id === currentStepId;

  const [tab, setTab] = useState<Tab>("overview");
  const mod = knowledgeModel.modules.find((m) => m.id === moduleId);
  const moduleById = useMemo(() => new Map(knowledgeModel.modules.map((m) => [m.id, m])), [knowledgeModel]);
  const TABS = useMemo(
    () => (flowStep ? [...BASE_TABS.slice(0, 1), { id: "flow" as const, label: "Flow" }, ...BASE_TABS.slice(1)] : BASE_TABS),
    [flowStep]
  );

  // `confidence` was computed by every analyzer and never read by anything
  // downstream — this makes it visible: the same average-per-module-pair
  // technique the World Model uses for path dimming, surfaced here as a
  // "verified" vs "inferred" badge on each dependency/dependent.
  const pairConfidence = useMemo(() => {
    const fileToModule = new Map<string, string>();
    for (const m of knowledgeModel.modules) for (const fileId of m.fileIds) fileToModule.set(fileId, m.id);

    const sums = new Map<string, { sum: number; count: number }>();
    for (const edge of knowledgeModel.dependencies) {
      if (edge.fromKind !== "file" || edge.toKind !== "file") continue;
      const from = fileToModule.get(edge.fromId);
      const to = fileToModule.get(edge.toId);
      if (!from || !to || from === to) continue;
      const key = `${from}->${to}`;
      const entry = sums.get(key) ?? { sum: 0, count: 0 };
      entry.sum += edge.confidence;
      entry.count += 1;
      sums.set(key, entry);
    }
    const averaged = new Map<string, number>();
    for (const [key, { sum, count }] of sums) averaged.set(key, sum / count);
    return averaged;
  }, [knowledgeModel]);

  useEffect(() => setTab(flowStep ? "flow" : "overview"), [moduleId, flowStep]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (requestedTab) setTab(requestedTab.tab);
  }, [requestedTab?.nonce]);

  if (!mod) return null;

  const isHazard = mod.risk.length > 0;

  return (
    <div className="pointer-events-auto flex h-full w-full flex-col border-l border-white/10 bg-biome-panel shadow-[-40px_0_80px_rgba(0,0,0,0.45)] sm:w-[520px]">
      {/* header */}
      <div className="flex-shrink-0 px-6 pt-6">
        <div className="flex items-start justify-between">
          <div className="flex gap-3.5">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[10px] border border-amber/30 bg-amber/10">
              {moduleIcon(mod)}
            </div>
            <div>
              <div className="font-display text-lg font-semibold text-ink-bright">{mod.name}</div>
              <div className="mt-0.5 font-mono text-xs text-ink-muted">{mod.path || "(repository root)"}</div>
            </div>
          </div>
          <button
            aria-label="Close investigation panel"
            onClick={onClose}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/[0.06]"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M2 2l12 12M14 2 2 14" stroke="#B7BDC3" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Badge tone="amber">{mod.importance >= 0.6 ? "core domain" : "module"}</Badge>
          <Badge>centrality {mod.centrality.toFixed(2)}</Badge>
          <Badge>importance {mod.importance.toFixed(2)}</Badge>
          {isHazard && <Badge tone="ember">{mod.risk.length} risk indicator{mod.risk.length > 1 ? "s" : ""}</Badge>}
        </div>

        <div className="mt-5 flex gap-5 overflow-x-auto border-b border-white/10">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`whitespace-nowrap border-b-2 pb-2 text-[12.5px] ${
                tab === t.id ? "border-amber font-semibold text-ink-primary" : "border-transparent text-ink-faint"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* body */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {tab === "overview" && <OverviewTab mod={mod} repo={knowledgeModel.repository} />}
        {tab === "code" && <CodeTab knowledgeModel={knowledgeModel} mod={mod} requestedPath={requestedFilePath} />}
        {tab === "dependencies" && (
          <RelationList
            title="Dependencies"
            ids={mod.dependencyIds}
            moduleById={moduleById}
            onHover={onHighlightDependency}
            confidenceFor={(relatedId) => pairConfidence.get(`${mod.id}->${relatedId}`)}
          />
        )}
        {tab === "dependents" && (
          <RelationList
            title="Dependents"
            ids={mod.dependentIds}
            moduleById={moduleById}
            onHover={onHighlightDependency}
            confidenceFor={(relatedId) => pairConfidence.get(`${relatedId}->${mod.id}`)}
          />
        )}
        {tab === "health" && <HealthTab mod={mod} knowledgeModel={knowledgeModel} />}
        {tab === "flow" && activeFlow && flowStep && (
          <FlowTab
            flow={activeFlow}
            step={flowStep}
            isLiveStep={isLiveStep}
            onContinue={onContinueFlow}
            onResume={onResumeFlow}
            onExit={onExitFlow}
          />
        )}
        {tab === "bob" && (
          <BobPanel
            knowledgeModel={knowledgeModel}
            mod={mod}
            moduleById={moduleById}
            flowContext={
              activeFlow && flowStep
                ? {
                    flow: { id: activeFlow.id, name: activeFlow.name, confidence: activeFlow.confidence, evidence: activeFlow.evidence },
                    currentStep: flowStep,
                    previousStep: activeFlow.steps[activeFlow.steps.findIndex((s) => s.id === flowStep.id) - 1] ?? null,
                    nextStep: activeFlow.steps[activeFlow.steps.findIndex((s) => s.id === flowStep.id) + 1] ?? null,
                  }
                : null
            }
          />
        )}
      </div>
    </div>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: "amber" | "ember" }) {
  const styles =
    tone === "amber"
      ? "bg-amber/10 text-amber border-amber/30"
      : tone === "ember"
        ? "bg-ember/10 text-ember border-ember/30"
        : "bg-white/[0.06] text-ink-secondary border-transparent";
  return <span className={`rounded-md border px-2.5 py-1 text-[11px] ${styles}`}>{children}</span>;
}

function OverviewTab({ mod, repo }: { mod: ModuleFact; repo: RepositoryKnowledgeModel["repository"] }) {
  return (
    <div className="space-y-5 text-sm">
      <section>
        <SectionHeading>Overview</SectionHeading>
        <p className="text-[13.5px] leading-relaxed text-[#D8DBDE]">
          {mod.description ??
            `${mod.name} is one of ${repo.statistics.moduleCount} modules identified in ${repo.owner}/${repo.name}. It contains ${mod.fileIds.length} file${mod.fileIds.length === 1 ? "" : "s"} and ${mod.dependentIds.length} other module${mod.dependentIds.length === 1 ? "" : "s"} depend on it.`}
        </p>
      </section>
      <section>
        <SectionHeading>Files ({mod.fileIds.length})</SectionHeading>
        <ul className="max-h-48 space-y-1 overflow-y-auto text-[12.5px] text-ink-secondary">
          {mod.fileIds.slice(0, 40).map((id) => (
            <li key={id} className="truncate rounded-md bg-white/[0.03] px-2.5 py-1.5">
              {id}
            </li>
          ))}
          {mod.fileIds.length > 40 && <li className="px-2.5 text-ink-muted">+{mod.fileIds.length - 40} more</li>}
        </ul>
      </section>
    </div>
  );
}

function CodeTab({
  knowledgeModel,
  mod,
  requestedPath = null,
}: {
  knowledgeModel: RepositoryKnowledgeModel;
  mod: ModuleFact;
  /** Set by a Bob `open_file` MCP tool call — see InvestigationPanel's `requestedFilePath` prop. */
  requestedPath?: { path: string; nonce: number } | null;
}) {
  const candidateFiles = useMemo(() => {
    if (requestedPath && mod.fileIds.includes(requestedPath.path) && !mod.fileIds.slice(0, 25).includes(requestedPath.path)) {
      return [requestedPath.path, ...mod.fileIds.slice(0, 24)];
    }
    return mod.fileIds.slice(0, 25);
  }, [mod.fileIds, requestedPath]);
  const [selectedPath, setSelectedPath] = useState(candidateFiles[0] ?? "");
  const [state, setState] = useState<{ loading: boolean; error: string | null; content: string | null; truncated: boolean }>({
    loading: false,
    error: null,
    content: null,
    truncated: false,
  });

  useEffect(() => {
    setSelectedPath(candidateFiles[0] ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mod.fileIds]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (requestedPath && mod.fileIds.includes(requestedPath.path)) setSelectedPath(requestedPath.path);
  }, [requestedPath?.nonce]);

  useEffect(() => {
    if (!selectedPath) return;
    let cancelled = false;
    setState({ loading: true, error: null, content: null, truncated: false });
    const params = new URLSearchParams({
      owner: knowledgeModel.repository.owner,
      repo: knowledgeModel.repository.name,
      ref: knowledgeModel.meta.commitSha,
      path: selectedPath,
    });
    fetch(`/api/file?${params}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) setState({ loading: false, error: data.error, content: null, truncated: false });
        else setState({ loading: false, error: null, content: data.content, truncated: data.truncated });
      })
      .catch((err) => {
        if (!cancelled) setState({ loading: false, error: String(err), content: null, truncated: false });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPath, knowledgeModel.repository.owner, knowledgeModel.repository.name, knowledgeModel.meta.commitSha]);

  if (candidateFiles.length === 0) {
    return <p className="text-sm text-ink-muted">No source files recorded for this module.</p>;
  }

  const lines = state.content ? highlightCode(state.content) : null;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <SectionHeading>Code</SectionHeading>
        {candidateFiles.length > 1 && (
          <select
            value={selectedPath}
            onChange={(e) => setSelectedPath(e.target.value)}
            className="rounded-md border border-white/10 bg-biome-field px-2 py-1 font-mono text-[11px] text-ink-secondary"
          >
            {candidateFiles.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="overflow-hidden rounded-lg border border-white/[0.08] bg-biome-code">
        <div className="flex items-center justify-between border-b border-white/[0.07] px-3.5 py-2">
          <span className="font-mono text-[11px] text-ink-muted">{selectedPath}</span>
          <span className="font-mono text-[10px] text-teal">fetched from GitHub</span>
        </div>
        <div className="max-h-96 overflow-auto p-3.5 font-mono text-xs leading-[1.7]">
          {state.loading && <span className="text-ink-muted">Loading source…</span>}
          {state.error && <span className="text-ember">{state.error}</span>}
          {lines && (
            <pre className="whitespace-pre">
              {lines.map((tokens, i) => (
                <div key={i}>
                  <span className="mr-3 select-none text-ink-dim">{String(i + 1).padStart(3, " ")}</span>
                  {tokens.map((t, j) => (
                    <span key={j} style={{ color: t.color }}>
                      {t.text}
                    </span>
                  ))}
                </div>
              ))}
            </pre>
          )}
          {state.truncated && <div className="mt-2 text-ink-muted">— truncated —</div>}
        </div>
      </div>
    </div>
  );
}

function confidenceLabel(confidence: number | undefined): { text: string; className: string } | null {
  if (confidence === undefined) return null;
  if (confidence >= 0.9) return { text: "verified", className: "text-teal" };
  if (confidence >= 0.65) return { text: "inferred", className: "text-amber" };
  return { text: "heuristic guess", className: "text-ink-muted" };
}

function RelationList({
  title,
  ids,
  moduleById,
  onHover,
  confidenceFor,
}: {
  title: string;
  ids: string[];
  moduleById: Map<string, ModuleFact>;
  onHover?: (id: string | null) => void;
  confidenceFor?: (id: string) => number | undefined;
}) {
  return (
    <div>
      <SectionHeading>
        {title} · {ids.length}
      </SectionHeading>
      {ids.length === 0 ? (
        <p className="text-sm text-ink-muted">None detected.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {ids.map((id) => {
            const label = confidenceLabel(confidenceFor?.(id));
            return (
              <div
                key={id}
                onMouseEnter={() => onHover?.(id)}
                onMouseLeave={() => onHover?.(null)}
                className="flex items-center justify-between rounded-md bg-white/[0.04] px-2.5 py-2 text-[12.5px] text-[#D8DBDE]"
              >
                <span>{moduleById.get(id)?.name ?? id}</span>
                {label && <span className={`font-mono text-[10px] ${label.className}`}>{label.text}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function HealthTab({ mod, knowledgeModel }: { mod: ModuleFact; knowledgeModel: RepositoryKnowledgeModel }) {
  const largeFileCount = knowledgeModel.codeHealth.largeFiles.filter((f) => mod.fileIds.includes(f.fileId)).length;
  return (
    <div className="space-y-4">
      <SectionHeading>Health</SectionHeading>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <Metric label="Lines of code" value={mod.complexity.linesOfCode.toLocaleString()} color="#F3F1EA" />
        <Metric label="Files" value={String(mod.fileIds.length)} color="#F3F1EA" />
        <Metric label="Large files" value={String(largeFileCount)} color={largeFileCount > 0 ? "#F2B84B" : "#F3F1EA"} />
      </div>
      <div>
        <div className="mb-2 text-[11px] text-ink-muted">Risk indicators</div>
        {mod.risk.length === 0 ? (
          <p className="text-sm text-ink-muted">None found by v1&apos;s deterministic analyzers.</p>
        ) : (
          <ul className="space-y-1.5">
            {mod.risk.map((r, i) => (
              <li key={i} className="rounded-md border border-ember/25 bg-ember/10 px-2.5 py-2 text-[12.5px] text-[#F5C9C1]">
                <span className="font-semibold">{r.kind}</span> — {r.detail}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-[11.5px] text-ink-muted">
        Cyclomatic complexity and test coverage aren&apos;t computed by v1&apos;s analyzer set yet — shown once the
        code-health and test analyzers land, not estimated here.
      </p>
    </div>
  );
}

const KIND_LABELS: Record<string, string> = {
  entry: "Entry",
  controller: "Controller",
  handler: "Handler",
  service: "Service",
  entity: "Entity",
  function: "Function",
  repository: "Repository",
  database: "Database",
  "external-api": "External API",
  event: "Event",
  unknown: "Unknown",
};

/**
 * Step 5's "why is this here?" section — reused inside the existing
 * Investigation Panel rather than a second, parallel panel. Shows the
 * step's position in the (statically reconstructed) flow, its evidence, and
 * lets the user Continue the walkthrough or Resume it after pausing to
 * inspect something else.
 */
function FlowTab({
  flow,
  step,
  isLiveStep,
  onContinue,
  onResume,
  onExit,
}: {
  flow: Flow;
  step: FlowStep;
  isLiveStep: boolean;
  onContinue?: () => void;
  onResume?: () => void;
  onExit?: () => void;
}) {
  const stepIndex = flow.steps.findIndex((s) => s.id === step.id);
  const previous = flow.steps[stepIndex - 1] ?? null;
  const next = flow.steps[stepIndex + 1] ?? null;
  const isLast = stepIndex === flow.steps.length - 1;

  return (
    <div className="space-y-4">
      <div>
        <SectionHeading>
          {flow.name} · Step {stepIndex + 1} / {flow.steps.length}
        </SectionHeading>
        <p className="text-[11.5px] italic text-ink-muted">
          Statically reconstructed likely execution path — not a runtime trace of this repository.
        </p>
      </div>

      <div className="flex flex-col gap-1.5 text-[12.5px]">
        <StepRow label="Previous" step={previous} />
        <div className="rounded-md border border-teal/30 bg-teal/10 px-2.5 py-2">
          <span className="font-mono text-[10px] uppercase tracking-wide text-teal">Current · {KIND_LABELS[step.kind]}</span>
          <div className="mt-0.5 text-ink-primary">{step.label}</div>
        </div>
        <StepRow label="Next" step={next} />
      </div>

      <div>
        <SectionHeading>Why is this step here?</SectionHeading>
        <p className="text-[13px] leading-relaxed text-[#D8DBDE]">{step.explanation}</p>
        <ul className="mt-2 space-y-1">
          {step.evidence.map((e, i) => (
            <li key={i} className="rounded-md bg-white/[0.04] px-2.5 py-1.5 text-[12px] text-ink-secondary">
              {e}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-white/10 pt-3.5">
        {isLiveStep ? (
          <button onClick={onContinue} className="rounded-md bg-teal px-3.5 py-2 text-xs font-semibold text-biome-bg">
            {isLast ? "Finish walkthrough" : "Continue →"}
          </button>
        ) : (
          <button onClick={onResume} className="rounded-md bg-teal px-3.5 py-2 text-xs font-semibold text-biome-bg">
            Resume walkthrough
          </button>
        )}
        <button onClick={onExit} className="rounded-md border border-white/15 px-3.5 py-2 text-xs text-ink-secondary">
          Exit flow
        </button>
      </div>
    </div>
  );
}

function StepRow({ label, step }: { label: string; step: FlowStep | null }) {
  if (!step) return null;
  return (
    <div className="rounded-md bg-white/[0.03] px-2.5 py-2">
      <span className="font-mono text-[10px] uppercase tracking-wide text-ink-muted">{label}</span>
      <div className="text-ink-secondary">{step.label}</div>
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg bg-white/[0.03] p-2.5">
      <div className="mb-1.5 text-[11px] text-ink-muted">{label}</div>
      <div className="text-lg font-semibold" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[1.4px] text-ink-muted">{children}</div>;
}
