export type DemoAgentPhase = "modules" | "dependencies" | "frameworks" | "complete" | "failed";

export interface DemoAgentPathGroup {
  path: string;
  fileCount: number;
  fileIds: string[];
}

export interface DemoAgentDependencyHint {
  fromId: string;
  toId: string;
  fromKind: "module";
  toKind: "module";
  relationship: "http-request";
  confidence: number;
}

export interface DemoAgentRunState {
  phase: DemoAgentPhase;
  attempts: number;
  moduleGroupIndex: number;
  pathGroups: DemoAgentPathGroup[];
  manifestEvidence: string;
  relationshipEvidence: string;
  dependencyHints: DemoAgentDependencyHint[];
  messages: unknown[];
  error?: string;
}