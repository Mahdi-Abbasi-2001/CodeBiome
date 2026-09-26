import type { ModuleFact } from "@/types/knowledge-model";
import { resolveWorld } from "./resolveRepository";
import { findModule } from "./moduleLookup";
import { EntityNotFoundError, InvalidToolArgumentsError } from "./errors";
import { bobEventBus } from "@/server/bob/eventBus";
import type { WorldAction } from "@/types/bob-events";

/**
 * World-action tools (docs/BOB_INTEGRATION.md §"Bob controls the CodeBiome
 * experience"). Every tool here does three things, in order:
 *
 *   1. Resolves the target World (docs/WORLD_ARCHITECTURE.md) — `worldId`
 *      when Bob has it (the common case once a conversation has called
 *      `analyze_repository` or the developer reported one via session
 *      context), falling back to `owner`/`repo` or "most recently created".
 *   2. Validates the target against that World's deterministic RKM/
 *      FlowModel — Bob can never make the world "navigate" to something
 *      that doesn't exist, same invariant the Flow system already enforces.
 *   3. Publishes a WorldActionEvent on the shared event bus, SCOPED to that
 *      World's id — never broadcast to any other World, even one analyzed
 *      from the same repository. The browser tab showing this World (see
 *      src/features/bob/useBobBridge.ts) is subscribed via SSE and applies
 *      the action to the EXISTING selection/flow-walkthrough state — these
 *      tools never touch React state directly, they only describe what
 *      should happen, honestly, as data.
 */

function publish(worldId: string, repositoryId: string, action: WorldAction, tool: string, args: Record<string, unknown>, summary: string) {
  const at = new Date().toISOString();
  bobEventBus.publish({ kind: "world-action", worldId, repositoryId, action, at });
  bobEventBus.publish({ kind: "activity", worldId, repositoryId, tool, args, summary, at });
}

export async function openModule(args: { moduleId: string; worldId?: string; owner?: string; repo?: string }) {
  const { world, knowledgeModel: model } = await resolveWorld(args);
  const mod = findModule(model, args.moduleId);
  publish(world.id, model.meta.repositoryId, { type: "open_module", moduleId: mod.id, moduleName: mod.name }, "open_module", args, `Opened module "${mod.name}"`);
  return { ok: true, moduleId: mod.id, moduleName: mod.name };
}

export async function startFlow(args: { flowId: string; worldId?: string; owner?: string; repo?: string }) {
  const { world, knowledgeModel, flowModel } = await resolveWorld(args);
  const flow = flowModel.flows.find((f) => f.id === args.flowId || f.name.toLowerCase() === args.flowId.toLowerCase());
  if (!flow) throw new EntityNotFoundError("flow", args.flowId);
  publish(world.id, knowledgeModel.meta.repositoryId, { type: "start_flow", flowId: flow.id, flowName: flow.name }, "start_flow", args, `Started walkthrough of flow "${flow.name}"`);
  return { ok: true, flowId: flow.id, flowName: flow.name, stepCount: flow.steps.length };
}

export async function focusFlowStep(args: { flowId: string; stepIndex: number; worldId?: string; owner?: string; repo?: string }) {
  const { world, knowledgeModel, flowModel } = await resolveWorld(args);
  const flow = flowModel.flows.find((f) => f.id === args.flowId || f.name.toLowerCase() === args.flowId.toLowerCase());
  if (!flow) throw new EntityNotFoundError("flow", args.flowId);
  if (!Number.isInteger(args.stepIndex) || args.stepIndex < 0 || args.stepIndex >= flow.steps.length) {
    throw new InvalidToolArgumentsError(`stepIndex must be an integer between 0 and ${flow.steps.length - 1} for flow "${flow.name}" (it has ${flow.steps.length} steps).`);
  }
  const step = flow.steps[args.stepIndex];
  publish(
    world.id,
    knowledgeModel.meta.repositoryId,
    { type: "focus_flow_step", flowId: flow.id, flowName: flow.name, stepIndex: args.stepIndex, stepLabel: step.label },
    "focus_flow_step",
    args,
    `Focused step ${args.stepIndex + 1}/${flow.steps.length} of "${flow.name}": ${step.label}`
  );
  return { ok: true, flowId: flow.id, stepIndex: args.stepIndex, step: { id: step.id, label: step.label, kind: step.kind, moduleId: step.moduleId } };
}

export async function openFile(args: { path: string; line?: number; worldId?: string; owner?: string; repo?: string }) {
  const { world, knowledgeModel: model } = await resolveWorld(args);
  const file = model.files.find((f) => f.path === args.path || f.id === args.path);
  if (!file) throw new EntityNotFoundError("file", args.path);
  const owningModule = model.modules.find((m) => m.fileIds.includes(file.id));

  publish(
    world.id,
    model.meta.repositoryId,
    { type: "open_file", path: file.path, moduleId: owningModule?.id ?? null, line: args.line ?? null },
    "open_file",
    args,
    `Opened ${file.path}${args.line ? `:${args.line}` : ""}`
  );
  return { ok: true, path: file.path, moduleId: owningModule?.id ?? null };
}

export async function showDependencies(args: { moduleId: string; worldId?: string; owner?: string; repo?: string }) {
  const { world, knowledgeModel: model } = await resolveWorld(args);
  const mod = findModule(model, args.moduleId);
  publish(world.id, model.meta.repositoryId, { type: "show_dependencies", moduleId: mod.id, moduleName: mod.name }, "show_dependencies", args, `Showed dependencies of "${mod.name}"`);
  return { ok: true, moduleId: mod.id, moduleName: mod.name, dependencyCount: mod.dependencyIds.length };
}

export async function showImpact(args: { moduleId: string; worldId?: string; owner?: string; repo?: string }) {
  const { world, knowledgeModel: model } = await resolveWorld(args);
  const mod = findModule(model, args.moduleId);
  const moduleById = new Map(model.modules.map((m) => [m.id, m]));
  const affected = transitiveDependents(moduleById, mod.id);

  publish(
    world.id,
    model.meta.repositoryId,
    { type: "show_impact", moduleId: mod.id, moduleName: mod.name, affectedModuleIds: affected },
    "show_impact",
    args,
    `Highlighted ${affected.length} module(s) transitively depending on "${mod.name}"`
  );
  return { ok: true, moduleId: mod.id, moduleName: mod.name, affectedModules: affected.map((id) => ({ id, name: moduleById.get(id)?.name ?? id })) };
}

function transitiveDependents(moduleById: Map<string, ModuleFact>, startId: string): string[] {
  const visited = new Set<string>([startId]);
  let frontier = [startId];
  const result: string[] = [];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const dependent of moduleById.get(id)?.dependentIds ?? []) {
        if (!visited.has(dependent)) {
          visited.add(dependent);
          next.push(dependent);
          result.push(dependent);
        }
      }
    }
    frontier = next;
  }
  return result;
}
