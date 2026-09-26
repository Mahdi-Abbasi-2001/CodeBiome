/**
 * The World is one persistent spatial model rendered through different
 * visual lenses (product brief) — geometry/identity never changes between
 * lenses, only emphasis, opacity, color, overlays, routes and annotations.
 * Keep this list and its meaning stable; every consumer (WorldHud's lens
 * switcher, WorldView's rendering, WorldExperience's state) imports this
 * one type rather than redeclaring the six lens names.
 */
export type Lens = "architecture" | "flow" | "dependencies" | "onboarding" | "health" | "activity";

export const LENSES: { id: Lens; label: string }[] = [
  { id: "architecture", label: "Architecture" },
  { id: "flow", label: "Flow" },
  { id: "dependencies", label: "Dependencies" },
  { id: "onboarding", label: "Onboarding" },
  { id: "health", label: "Health" },
  { id: "activity", label: "Activity" },
];
