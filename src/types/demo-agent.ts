export type DemoAgentPhase = "modules" | "dependencies" | "frameworks" | "complete" | "failed";

export interface DemoAgentPathGroup {
  path: string;
  fileCount: number;
  fileIds: string[];
}

export interface DemoAgentRunState {
  phase: DemoAgentPhase;
  attempts: number;
  moduleGroupIndex: number;
  pathGroups: DemoAgentPathGroup[];
  manifestEvidence: string;
  relationshipEvidence: string;
  messages: unknown[];
  error?: string;
}