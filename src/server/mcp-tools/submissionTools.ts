import type {
  RepositoryKnowledgeModel,
  ModuleFact,
  DependencyEdge,
  RiskIndicator,
  FrameworkDetection,
} from "@/types/knowledge-model";
import type { Flow, FlowStep } from "@/types/flow";
import type { Journey, JourneyStep } from "@/types/journey";
import { worldStore } from "@/server/world/worldStore";
import { resolveWorldId } from "./resolveRepository";
import { InvalidToolArgumentsError } from "./errors";
import { requireFile, requireModule, submitToKnowledgeModel, randomId } from "./submissionHelpers";

/**
 * The tools that replaced the old analyzer pipeline (src/server/mcp-tools/
 * submissionHelpers.ts has the shared "verify then merge" machinery). A
 * connected agent fetches and reasons about the repository itself, then
 * calls these to tell CodeBiome what it found — CodeBiome's only job is to
 * check every reference against real files/modules and render the result.
 */

// ---------------------------------------------------------------------------
// submit_modules
// ---------------------------------------------------------------------------

export interface SubmitModulesResult {
  ok: true;
  moduleCount: number;
  modules: { id: string; name: string }[];
}

export async function submitModules(args: {
  modules: { id?: string; name: string; path: string; description?: string; fileIds: string[]; importance: number; risk?: RiskIndicator[] }[];
  worldId?: string;
  owner?: string;
  repo?: string;
}): Promise<SubmitModulesResult> {
  if (!Array.isArray(args.modules) || args.modules.length === 0) {
    throw new InvalidToolArgumentsError("modules must include at least one module.");
  }

  const submitted: { id: string; name: string }[] = [];
  const { knowledgeModel } = await submitToKnowledgeModel(args, (model) => {
    const fileById = new Map(model.files.map((f) => [f.id, f]));
    const byId = new Map(model.modules.map((m) => [m.id, m]));

    for (const input of args.modules) {
      if (!(input.importance >= 0 && input.importance <= 1)) {
        throw new InvalidToolArgumentsError(`importance must be between 0 and 1 for module "${input.name}".`);
      }
      if (!Array.isArray(input.fileIds) || input.fileIds.length === 0) {
        throw new InvalidToolArgumentsError(`fileIds must reference at least one real file for module "${input.name}".`);
      }
      const files = input.fileIds.map((id) => requireFile(model, id));

      const id = input.id?.trim() || input.path;
      const linesOfCode = files.reduce((sum, f) => sum + f.linesOfCode, 0);
      const existing = byId.get(id);

      const mod: ModuleFact = {
        id,
        name: input.name,
        path: input.path,
        description: input.description ?? null,
        fileIds: files.map((f) => f.id),
        importance: input.importance,
        centrality: existing?.centrality ?? 0,
        complexity: { cyclomaticComplexity: 0, linesOfCode, maintainabilityIndex: null },
        risk: input.risk ?? [],
        dependencyIds: existing?.dependencyIds ?? [],
        dependentIds: existing?.dependentIds ?? [],
      };
      byId.set(id, mod);
      submitted.push({ id, name: mod.name });
    }

    const modules = [...byId.values()];
    return {
      ...model,
      modules,
      repository: { ...model.repository, statistics: { ...model.repository.statistics, moduleCount: modules.length } },
    };
  });

  return { ok: true, moduleCount: knowledgeModel.modules.length, modules: submitted };
}

// ---------------------------------------------------------------------------
// submit_dependencies
// ---------------------------------------------------------------------------

export interface SubmitDependenciesResult {
  ok: true;
  dependencyCount: number;
  added: number;
}

export async function submitDependencies(args: {
  dependencies: {
    fromId: string;
    toId: string;
    fromKind: "file" | "module";
    toKind: "file" | "module" | "external-package";
    relationship: DependencyEdge["relationship"];
    confidence: number;
  }[];
  worldId?: string;
  owner?: string;
  repo?: string;
}): Promise<SubmitDependenciesResult> {
  if (!Array.isArray(args.dependencies) || args.dependencies.length === 0) {
    throw new InvalidToolArgumentsError("dependencies must include at least one edge.");
  }

  let added = 0;
  const { knowledgeModel } = await submitToKnowledgeModel(args, (model) => {
    const newEdges: DependencyEdge[] = args.dependencies.map((input) => {
      if (!(input.confidence >= 0 && input.confidence <= 1)) {
        throw new InvalidToolArgumentsError(`confidence must be between 0 and 1 for the edge from "${input.fromId}" to "${input.toId}".`);
      }
      const fromId = input.fromKind === "file" ? requireFile(model, input.fromId).id : requireModule(model, input.fromId).id;
      const toId = input.toKind === "external-package" ? input.toId : input.toKind === "file" ? requireFile(model, input.toId).id : requireModule(model, input.toId).id;

      return {
        id: randomId("dep"),
        fromId,
        toId,
        fromKind: input.fromKind,
        toKind: input.toKind,
        relationship: input.relationship,
        direction: "uses",
        confidence: input.confidence,
      };
    });
    added = newEdges.length;
    return { ...model, dependencies: [...model.dependencies, ...newEdges] };
  });

  return { ok: true, dependencyCount: knowledgeModel.dependencies.length, added };
}

// ---------------------------------------------------------------------------
// submit_entry_points
// ---------------------------------------------------------------------------

export interface SubmitEntryPointsResult {
  ok: true;
  entryPointCount: number;
}

export async function submitEntryPoints(args: {
  entryPoints: { id?: string; type: RepositoryKnowledgeModel["entryPoints"][number]["type"]; name: string; fileId: string; detectionEvidence: string }[];
  worldId?: string;
  owner?: string;
  repo?: string;
}): Promise<SubmitEntryPointsResult> {
  if (!Array.isArray(args.entryPoints) || args.entryPoints.length === 0) {
    throw new InvalidToolArgumentsError("entryPoints must include at least one entry point.");
  }

  const { knowledgeModel } = await submitToKnowledgeModel(args, (model) => {
    const byId = new Map(model.entryPoints.map((e) => [e.id, e]));
    for (const input of args.entryPoints) {
      const file = requireFile(model, input.fileId);
      const id = input.id?.trim() || randomId("entry");
      byId.set(id, { id, type: input.type, name: input.name, fileId: file.id, detectionEvidence: input.detectionEvidence });
    }
    return { ...model, entryPoints: [...byId.values()] };
  });

  return { ok: true, entryPointCount: knowledgeModel.entryPoints.length };
}

// ---------------------------------------------------------------------------
// submit_frameworks
// ---------------------------------------------------------------------------

export interface SubmitFrameworksResult {
  ok: true;
  frameworkCount: number;
}

export async function submitFrameworks(args: {
  frameworks: { name: string; category: FrameworkDetection["category"]; evidence: string[]; confidence: number }[];
  worldId?: string;
  owner?: string;
  repo?: string;
}): Promise<SubmitFrameworksResult> {
  if (!Array.isArray(args.frameworks) || args.frameworks.length === 0) {
    throw new InvalidToolArgumentsError("frameworks must include at least one detection.");
  }

  const { knowledgeModel } = await submitToKnowledgeModel(args, (model) => {
    const byName = new Map(model.repository.frameworks.map((f) => [f.name.toLowerCase(), f]));
    for (const input of args.frameworks) {
      if (!(input.confidence >= 0 && input.confidence <= 1)) {
        throw new InvalidToolArgumentsError(`confidence must be between 0 and 1 for framework "${input.name}".`);
      }
      const evidence = input.evidence.map((id) => requireFile(model, id).id);
      byName.set(input.name.toLowerCase(), { name: input.name, category: input.category, evidence, confidence: input.confidence });
    }
    return { ...model, repository: { ...model.repository, frameworks: [...byName.values()] } };
  });

  return { ok: true, frameworkCount: knowledgeModel.repository.frameworks.length };
}

// ---------------------------------------------------------------------------
// submit_security_findings
// ---------------------------------------------------------------------------

export interface SubmitSecurityFindingsResult {
  ok: true;
  patternMatchCount: number;
  vulnerableDependencyCount: number;
}

export async function submitSecurityFindings(args: {
  patternMatches?: { fileId: string; line: number; rule: string; severity: "low" | "moderate" | "high" | "critical" }[];
  vulnerableDependencies?: {
    packageName: string;
    installedVersion: string;
    advisoryId: string;
    severity: "low" | "moderate" | "high" | "critical";
    source: "osv" | "npm-audit" | "github-advisory";
  }[];
  worldId?: string;
  owner?: string;
  repo?: string;
}): Promise<SubmitSecurityFindingsResult> {
  const patternMatches = args.patternMatches ?? [];
  const vulnerableDependencies = args.vulnerableDependencies ?? [];
  if (patternMatches.length === 0 && vulnerableDependencies.length === 0) {
    throw new InvalidToolArgumentsError("Provide at least one of patternMatches or vulnerableDependencies.");
  }

  const { knowledgeModel } = await submitToKnowledgeModel(args, (model) => {
    const resolvedMatches = patternMatches.map((m) => ({ fileId: requireFile(model, m.fileId).id, line: m.line, rule: m.rule, severity: m.severity }));
    return {
      ...model,
      security: {
        vulnerableDependencies: [...model.security.vulnerableDependencies, ...vulnerableDependencies],
        patternMatches: [...model.security.patternMatches, ...resolvedMatches],
      },
    };
  });

  return {
    ok: true,
    patternMatchCount: knowledgeModel.security.patternMatches.length,
    vulnerableDependencyCount: knowledgeModel.security.vulnerableDependencies.length,
  };
}

// ---------------------------------------------------------------------------
// submit_code_health — the tool that fills what used to be permanent empty
// stubs (git intelligence, code health beyond large-files, test/doc
// coverage) since an agent can actually assess these, unlike a regex
// analyzer.
// ---------------------------------------------------------------------------

export interface SubmitCodeHealthResult {
  ok: true;
  updated: string[];
}

export async function submitCodeHealth(args: {
  todoFixme?: { fileId: string; line: number; text: string; kind: "TODO" | "FIXME" }[];
  deadCodeCandidates?: { fileId: string; exportName: string; reason: string }[];
  duplicatedCodeCandidates?: { fileIds: string[]; similarity: number; reason: string }[];
  missingTests?: { moduleId: string; reason: string }[];
  deprecatedPatterns?: { fileId: string; pattern: string; evidence: string }[];
  testFiles?: { fileId: string; framework: string | null; testedModuleIds: string[] }[];
  coverage?: { overallPercentage: number; byModule?: { moduleId: string; percentage: number }[] };
  docsDirectoryFileIds?: string[];
  apiDocumentation?: { toolDetected: string | null; fileIds: string[] };
  gitHotspots?: { fileId: string; changeCount: number; coChangedWith: string[] }[];
  gitContributors?: { name: string; email: string; commitCount: number; firstCommitAt: string; lastCommitAt: string }[];
  worldId?: string;
  owner?: string;
  repo?: string;
}): Promise<SubmitCodeHealthResult> {
  const updated: string[] = [];

  const { knowledgeModel: _knowledgeModel } = await submitToKnowledgeModel(args, (model) => {
    let next = model;

    if (args.todoFixme?.length) {
      const items = args.todoFixme.map((t) => ({ fileId: requireFile(model, t.fileId).id, line: t.line, text: t.text, kind: t.kind }));
      next = { ...next, codeHealth: { ...next.codeHealth, todoFixme: [...next.codeHealth.todoFixme, ...items] } };
      updated.push("codeHealth.todoFixme");
    }
    if (args.deadCodeCandidates?.length) {
      const items = args.deadCodeCandidates.map((d) => ({ fileId: requireFile(model, d.fileId).id, exportName: d.exportName, reason: d.reason }));
      next = { ...next, codeHealth: { ...next.codeHealth, deadCodeCandidates: [...next.codeHealth.deadCodeCandidates, ...items] } };
      updated.push("codeHealth.deadCodeCandidates");
    }
    if (args.duplicatedCodeCandidates?.length) {
      const items = args.duplicatedCodeCandidates.map((d) => ({
        fileIds: d.fileIds.map((id) => requireFile(model, id).id),
        similarity: d.similarity,
        lineRanges: d.fileIds.map((id) => ({ fileId: requireFile(model, id).id, start: 0, end: 0 })),
      }));
      next = { ...next, codeHealth: { ...next.codeHealth, duplicatedCodeCandidates: [...next.codeHealth.duplicatedCodeCandidates, ...items] } };
      updated.push("codeHealth.duplicatedCodeCandidates");
    }
    if (args.missingTests?.length) {
      const items = args.missingTests.map((m) => ({ moduleId: requireModule(model, m.moduleId).id, reason: m.reason }));
      next = { ...next, codeHealth: { ...next.codeHealth, missingTests: [...next.codeHealth.missingTests, ...items] } };
      updated.push("codeHealth.missingTests");
    }
    if (args.deprecatedPatterns?.length) {
      const items = args.deprecatedPatterns.map((d) => ({ fileId: requireFile(model, d.fileId).id, pattern: d.pattern, evidence: d.evidence }));
      next = { ...next, codeHealth: { ...next.codeHealth, deprecatedPatterns: [...next.codeHealth.deprecatedPatterns, ...items] } };
      updated.push("codeHealth.deprecatedPatterns");
    }
    if (args.testFiles?.length) {
      const items = args.testFiles.map((t) => ({
        fileId: requireFile(model, t.fileId).id,
        framework: t.framework,
        testedModuleIds: t.testedModuleIds.map((id) => requireModule(model, id).id),
      }));
      next = { ...next, tests: { ...next.tests, testFiles: [...next.tests.testFiles, ...items] } };
      updated.push("tests.testFiles");
    }
    if (args.coverage) {
      const byModule = (args.coverage.byModule ?? []).map((m) => ({ moduleId: requireModule(model, m.moduleId).id, percentage: m.percentage }));
      next = { ...next, tests: { ...next.tests, coverage: { available: true, overallPercentage: args.coverage.overallPercentage, byModule } } };
      updated.push("tests.coverage");
    }
    if (args.docsDirectoryFileIds?.length) {
      const fileIds = args.docsDirectoryFileIds.map((id) => requireFile(model, id).id);
      next = { ...next, documentation: { ...next.documentation, docsDirectory: { exists: true, fileIds } } };
      updated.push("documentation.docsDirectory");
    }
    if (args.apiDocumentation) {
      const fileIds = args.apiDocumentation.fileIds.map((id) => requireFile(model, id).id);
      next = {
        ...next,
        documentation: {
          ...next.documentation,
          apiDocumentation: { exists: true, toolDetected: args.apiDocumentation.toolDetected, fileIds },
        },
      };
      updated.push("documentation.apiDocumentation");
    }
    if (args.gitHotspots?.length) {
      const items = args.gitHotspots.map((h) => ({ fileId: requireFile(model, h.fileId).id, changeCount: h.changeCount, coChangedWith: h.coChangedWith }));
      next = { ...next, git: { ...next.git, hotspots: [...next.git.hotspots, ...items] } };
      updated.push("git.hotspots");
    }
    if (args.gitContributors?.length) {
      next = { ...next, git: { ...next.git, contributors: [...next.git.contributors, ...args.gitContributors] } };
      next = {
        ...next,
        repository: { ...next.repository, statistics: { ...next.repository.statistics, contributorCount: next.git.contributors.length } },
      };
      updated.push("git.contributors");
    }

    if (updated.length === 0) {
      throw new InvalidToolArgumentsError("Provide at least one code-health field to submit.");
    }
    return next;
  });

  return { ok: true, updated };
}

// ---------------------------------------------------------------------------
// submit_flow / submit_request_journey — these touch flowModel/journeyModel,
// not the RepositoryKnowledgeModel, so they merge against the whole
// WorldSnapshot directly rather than through submitToKnowledgeModel.
// ---------------------------------------------------------------------------

export interface SubmitFlowResult {
  ok: true;
  flow: Flow;
}

export async function submitFlow(args: {
  id?: string;
  name: string;
  description: string;
  confidence: Flow["confidence"];
  steps: { entityId: string; moduleId?: string; kind: FlowStep["kind"]; label: string; symbol?: string; explanation: string; evidence?: string[] }[];
  evidence?: string[];
  worldId?: string;
  owner?: string;
  repo?: string;
}): Promise<SubmitFlowResult> {
  if (!Array.isArray(args.steps) || args.steps.length === 0) {
    throw new InvalidToolArgumentsError("steps must include at least one step.");
  }

  const worldId = await resolveWorldId(args);
  let storedFlow!: Flow;

  const snapshot = await worldStore.updateSnapshot(worldId, (current) => {
    const model = current.knowledgeModel;
    const flowId = args.id?.trim() || randomId("flow");
    const stepIds = args.steps.map((_s, i) => `${flowId}-step-${i}`);

    const steps: FlowStep[] = args.steps.map((s, i) => {
      const file = requireFile(model, s.entityId);
      const moduleId = s.moduleId ? requireModule(model, s.moduleId).id : null;
      return {
        id: stepIds[i],
        entityId: file.id,
        moduleId,
        kind: s.kind,
        label: s.label,
        filePath: file.path,
        symbol: s.symbol ?? null,
        explanation: s.explanation,
        evidence: s.evidence ?? [],
        confidence: args.confidence,
        nextStepIds: i < stepIds.length - 1 ? [stepIds[i + 1]] : [],
      };
    });

    const flow: Flow = {
      id: flowId,
      name: args.name,
      description: args.description,
      confidence: args.confidence,
      entryPointId: stepIds[0],
      steps,
      evidence: args.evidence ?? [],
    };
    storedFlow = flow;

    const flows = current.flowModel.flows.filter((f) => f.id !== flowId);
    flows.push(flow);
    return {
      ...current,
      flowModel: { meta: { repositoryKnowledgeModelId: model.meta.repositoryId, generatedAt: new Date().toISOString() }, flows },
    };
  });

  return { ok: true, flow: storedFlow };
}

export interface SubmitRequestJourneyResult {
  ok: true;
  journey: Journey;
}

export async function submitRequestJourney(args: {
  id?: string;
  name: string;
  description: string;
  confidence: Journey["confidence"];
  steps: { kind: JourneyStep["kind"]; entityId: string; label: string; flowId?: string; explanation: string; evidence?: string[] }[];
  evidence?: string[];
  worldId?: string;
  owner?: string;
  repo?: string;
}): Promise<SubmitRequestJourneyResult> {
  if (!Array.isArray(args.steps) || args.steps.length === 0) {
    throw new InvalidToolArgumentsError("steps must include at least one step.");
  }

  const worldId = await resolveWorldId(args);
  let storedJourney!: Journey;

  const snapshot = await worldStore.updateSnapshot(worldId, (current) => {
    const model = current.knowledgeModel;
    const journeyId = args.id?.trim() || randomId("journey");

    const steps: JourneyStep[] = args.steps.map((s, i) => {
      const file = requireFile(model, s.entityId);
      if (s.flowId && !current.flowModel.flows.some((f) => f.id === s.flowId)) {
        throw new InvalidToolArgumentsError(`flowId "${s.flowId}" does not refer to a flow submitted via submit_flow yet.`);
      }
      return {
        id: `${journeyId}-step-${i}`,
        kind: s.kind,
        entityId: file.id,
        filePath: file.path,
        label: s.label,
        flowId: s.flowId ?? null,
        explanation: s.explanation,
        evidence: s.evidence ?? [],
        confidence: args.confidence,
      };
    });

    const journey: Journey = { id: journeyId, name: args.name, description: args.description, confidence: args.confidence, steps, evidence: args.evidence ?? [] };
    storedJourney = journey;

    const journeys = current.journeyModel.journeys.filter((j) => j.id !== journeyId);
    journeys.push(journey);
    return {
      ...current,
      journeyModel: { meta: { repositoryKnowledgeModelId: model.meta.repositoryId, generatedAt: new Date().toISOString() }, journeys },
    };
  });
  void snapshot;

  return { ok: true, journey: storedJourney };
}
