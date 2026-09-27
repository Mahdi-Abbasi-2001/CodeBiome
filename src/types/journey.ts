import { z } from "zod";
import { ConfidenceLevelSchema } from "./flow";

/**
 * Journeys (multi-request user operations, e.g. "sign up": a register page
 * → POST /register → a verify-email page → POST /verify → the dashboard).
 * A Flow (src/types/flow.ts) is a single request's server-side call chain
 * through ONE entry point; a Journey is the next level up — several
 * frontend pages and the real Flows they call, stitched together by real
 * frontend evidence:
 *
 *   - a "page" step exists because a frontend route/page file was found
 *     (src/server/analyzers/entry-point-analyzer.ts's frontend-page
 *     detection — Next.js file convention or a React Router `<Route>`).
 *   - a "call" step exists because that page's own source contains a real
 *     `fetch`/`axios`/`<form action>` call whose literal path matches a
 *     real detected backend route (src/server/analyzers/
 *     frontend-call-analyzer.ts's `http-request` edges).
 *   - the step AFTER a call exists because that same page's source contains
 *     a real navigation call (`navigate(...)`, `router.push(...)`,
 *     `<Link to="...">`) whose literal path matches another real page
 *     (the same analyzer's `navigates-to` edges).
 *
 * Exactly like Flow, this is STATICALLY RECONSTRUCTED — never a runtime/
 * browser trace, never AI-invented. Where the real signal is ambiguous
 * (e.g. a page that can navigate to more than one place), confidence drops
 * rather than the inference silently picking one and asserting it.
 */

export const JourneyStepKindSchema = z.enum(["page", "call"]);

export const JourneyStepSchema = z.object({
  id: z.string(),
  kind: JourneyStepKindSchema,
  /** A real FileFact.id — the page file for a "page" step, the backend entry-point file for a "call" step. */
  entityId: z.string(),
  filePath: z.string(),
  label: z.string(),
  /** Set only for a "call" step — the real Flow (src/types/flow.ts) this call reaches, for drilling into its own internal steps. */
  flowId: z.string().nullable(),
  /** A deterministic, template-built sentence — never AI-generated. */
  explanation: z.string(),
  evidence: z.array(z.string()),
  confidence: ConfidenceLevelSchema,
});

export const JourneySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  confidence: ConfidenceLevelSchema,
  steps: z.array(JourneyStepSchema),
  evidence: z.array(z.string()),
});

export const JourneyModelSchema = z.object({
  meta: z.object({ repositoryKnowledgeModelId: z.string(), generatedAt: z.string() }),
  journeys: z.array(JourneySchema),
});

export type JourneyStepKind = z.infer<typeof JourneyStepKindSchema>;
export type JourneyStep = z.infer<typeof JourneyStepSchema>;
export type Journey = z.infer<typeof JourneySchema>;
export type JourneyModel = z.infer<typeof JourneyModelSchema>;
