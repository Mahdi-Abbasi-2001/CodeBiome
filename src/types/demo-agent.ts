export type DemoAgentPhase = "modules" | "dependencies" | "complete" | "failed";

export interface DemoAgentRunState {
  phase: DemoAgentPhase;
  attempts: number;
  messages: unknown[];
  error?: string;
}