# World Visual Redesign — Explorable Architectural World

This document covers the Claude Design visual/UX redesign implemented on
top of the existing, working World architecture (`docs/WORLD_ARCHITECTURE.md`)
and Repository Knowledge Model / FlowModel (`docs/REPOSITORY_KNOWLEDGE_MODEL.md`).
**Nothing about persistence, MCP tools, session context, the event bridge,
onboarding journeys, or the RKM/FlowModel pipeline changed.** This is a
rendering and interaction layer rewrite in `src/world-engine/`,
`src/features/world-experience/`, and `src/features/hud/`, plus one small
additive backend classification rule.

Older docs (`ARCHITECTURE.md`, `REPOSITORY_KNOWLEDGE_MODEL.md`,
`ARCHITECTURE_DECISIONS.md`, `VERCEL_DEPLOYMENT.md`) still describe the
previous "bioluminescent forest" visual language (trees/canopies, floating
connector lines) in places — that text describes the World Model's
*data* shape, which is unchanged; only the renderer's interpretation of
`WorldRegion`/`WorldLandmark`/`WorldPath` changed. This document is the
current source of truth for the visual language.

## 1. The core concept

"CodeBiome is an explorable architectural world where software becomes a
place you can navigate — and Bob is your guide." Spatial position now
communicates architectural meaning: domain terraces for the high-level
overview, buildings for modules, roads/bridges for real dependencies —
never an arbitrary floating line.

## 2. The Domain tier — a pure, client-side derived grouping

The approved hierarchy is Repository → Domain/Region → Module/Landmark →
Files → Code. The persisted `WorldModel` (`src/types/world-model.ts`) was
**not** changed to add a "domain" concept — every `WorldRegion` already
corresponds 1:1 to a real `ModuleFact`. Instead, `src/world-engine/domains.ts`
computes a `Domain` grouping **on every render**, purely from data already
fetched (`WorldModel` + `RepositoryKnowledgeModel`):

- **Grouping key**: a module's first path segment that isn't a generic
  wrapper directory (`src`, `lib`, `app`, `source`, `packages`, `internal`).
  Two modules sharing that segment become one multi-module Domain; a module
  with a unique segment becomes its own single-module Domain.
- **This project's own demo repository** (`lujakob/nestjs-realworld-example-app`)
  has every module directly under `src/` (`src/user`, `src/article`, …), so
  it produces one Domain per module — an honest reflection of that
  repository's actual flat structure, not a limitation. A repository with
  real nested module directories produces genuine multi-module Domains
  (see `src/world-engine/domains.test.ts` for both cases).
- **Aggregates**: `footprint` (terrace size, from member file counts),
  `height` (terrace height, from the most central member's importance),
  `healthTier` (worst among members), `isInfra` (true only when every
  member is a test/docs landmark — the slate-blue treatment).

Zero schema change, zero migration risk for Worlds already persisted in
Vercel Blob — this is why the redesign could ship without touching
`src/server/world/builder.ts`'s output shape (except the one addition in
§6 below).

## 3. Rendering — `src/world-engine/`

- **`entities.tsx`**: `DomainTerrace` (a raised platform; footprint =
  radius, height = centrality, color = health, a glowing boundary ring),
  `Building` (replaces the old tree `Canopy` for a generic module),
  `Road` (a dependency: `kind: "road"` hugs the ground within one Domain,
  `kind: "bridge"` arcs up with two pylons between two different Domains;
  a cyclic dependency gets a small looping ring at its midpoint in addition
  to the existing dashed-amber styling). `CaveMouth`/`LibraryStack`/
  `TrainingGround`/`GateStructure`/`RuinsMarker` (database/docs/tests/entry
  point/ruins) are unchanged — they already read as architectural, not
  forest, elements.
- **`domains.ts`**: `computeDomains`, `computeDomainBridges` (aggregates
  real file-level dependency edges into one relationship per Domain pair —
  what the overview renders as bridges, so "major relationships" show
  without drawing every underlying edge at once).
- **`flowLayout.ts`**: `layoutFlowSteps` — a Flow's steps are
  FILE-granularity (`FlowStep.moduleId`), finer than a Domain/Module's
  ground position. Two steps in the same module (e.g. a controller and its
  service) are spread into a small deterministic ring around that module's
  real position, so each step has a distinct place for Bob to visit.
- **`Bob.tsx`**: the periwinkle guide orb. Interpolates toward whatever
  `WorldExperience` says Bob is investigating; invents no position of its
  own.
- **`WorldView.tsx`**: orchestrates all of the above per the current lens
  (`src/world-engine/lens.ts`) and progressive-disclosure state
  (`focusedDomainId`).
- **`src/lib/worldLayout.ts`**: `layoutDomains`/`layoutWithinDomain`/
  `domainRadius` place terraces and, once a Domain is "entered," its member
  buildings. Uses the same bounded `SPACING * sqrt(i)` phyllotaxis-spiral
  growth as the original per-module layout (not a cumulative
  footprint-stacking scheme) so a repository with many Domains still fits
  in a walkable, visible world.

## 4. Progressive disclosure

- **Overview** (`focusedDomainId === null`): Domain terraces + aggregated
  Domain-to-Domain bridges only. No individual modules, files, or
  file-level dependency edges are shown.
- **Entering a Domain** (click a terrace, or select/land on one of its
  modules from anywhere — a Bob action, a Flow/Onboarding step): camera
  zooms in, that Domain's member modules are revealed as buildings, its
  intra-Domain roads appear, every other Domain stays visible but dimmed.
  `WorldExperience`'s `useEffect` on `selectedModuleId` keeps
  `focusedDomainId` in sync automatically, regardless of how the selection
  happened.
- Clicking empty ground closes the Investigation Panel first, then (a
  second click) zooms back out to the overview.

## 5. Lenses — one world, six emphases (`src/world-engine/lens.ts`)

`architecture` (default), `flow`, `dependencies`, `onboarding`, `health`,
`activity`. The lens switcher lives in `WorldHud`'s top bar. Selecting
`flow`/`onboarding` with nothing active yet opens the existing picker
(`FlowExplorer`/`OnboardingJourneyPanel`) that starts one, rather than
switching to an empty lens (`WorldExperience.handleChangeLens`). The World's
geometry never changes between lenses — only opacity, route overlays, and
which highlight set (`flowHighlightModuleIds` / `activeOnboardingModuleIds`
/ `activityModuleIds`) is active.

- **Flow**: the active Flow's real file-granularity route, rendered as a
  distinct glowing path connecting real step waypoints; unrelated Domains
  fade to a quiet, dimmed silhouette; Bob's orb travels the route; the
  camera follows the current step. The permanent disclaimer — **"statically
  reconstructed · not a runtime trace"** — is shown on the walkthrough card
  verbatim (`src/features/hud/WorldHud.tsx`), and the Investigation Panel's
  own Flow tab carries the same disclosure in its own words. Uses the
  EXISTING `FlowModel`/flow-inference output; no second flow-analysis
  system was created.
- **Dependencies**: brightens every road/bridge (real edges, aggregated at
  the Domain level in the overview, per-module within an entered Domain); a
  cyclic dependency's looping-road treatment is most visible here.
- **Onboarding**: same mechanism as Flow, driven by the active onboarding
  journey's module-granularity steps (`src/types/onboarding.ts`) instead of
  a Flow's file-granularity steps. Uses the EXISTING onboarding MCP
  tools/journey state (`create_onboarding_journey`,
  `advance_onboarding_step`, `src/server/bob/onboardingJourneyStore.ts`) —
  no new journey concept, no revived dedicated "Guided Journey" screen.
- **Health**: the same health-tier coloring the Architecture lens already
  shows, intensified — a lighter-weight lens by design, since color-by-health
  is already always-on information, not something exclusive to a mode.
- **Activity**: highlights every module a real, recent MCP tool call
  actually referenced (extracted from `ActivityEvent.args.moduleId` when
  present) plus wherever Bob is currently focused — never a synthesized or
  simulated activity signal.

## 6. Bob — a physical guide, not just a chat panel

`WorldExperience` derives one `bobFocus: { moduleId, stepId } | null`:

1. An active Flow's current step (if `currentStep.moduleId` resolves) — Bob
   is "guiding" that walkthrough regardless of who clicked Continue.
2. Otherwise an active Onboarding journey's current step.
3. Otherwise Bob's own last **direct** MCP-driven focus — set only by
   `open_module`, `open_file`, `show_dependencies`, `show_impact` (never by
   a developer's own click, and never invented). See
   `src/features/world-experience/WorldExperience.tsx`'s
   `handleBob*` callbacks and the `bobDirectFocus` state.

The compact contextual HUD (`src/features/bob/BobFocusHud.tsx`) shows
`INVESTIGATING <module> / WHY <reason> / NEXT <next step>` — `why` comes
from a Flow step's own deterministic `explanation`, an Onboarding step's
`reason`, or (for a direct focus) the module's landmark label/description;
`next` comes from the following Flow/Onboarding step. Both are `null`-able
and simply omitted when there's nothing real to show — never fabricated.

This is rendering-only: every Bob action still flows through the exact same
event/state system as before (`useBobBridge`, `src/types/bob-events.ts`,
`src/server/bob/eventBus.ts`) — no fake tool calls, no synthesized activity.

## 7. Developer ↔ Bob, both directions — unchanged plumbing

- **Developer → Bob**: selecting any module (a click, or landing there via
  a Flow/Onboarding step) still POSTs to `/api/session-context`
  (`WorldExperience`'s existing `useEffect`, untouched) so
  `get_current_context` reflects it. Verified live against a locally
  running instance (§9).
- **Bob → Developer**: `open_module`/`start_flow`/`focus_flow_step`/
  `open_file`/`show_dependencies`/`show_impact`/`focus_onboarding_step`
  still drive the exact same `handleBob*` callbacks as before — now they
  also switch to the relevant lens (e.g. `start_flow` → Flow lens) and set
  `bobDirectFocus` where applicable, on top of their existing behavior.

## 8. The one backend change: ruins classification

`src/server/world/builder.ts`'s `classifyModule` gained one new branch: a
module whose `risk` array already contains a `dead-code-candidate` or
`deprecated-pattern` `RiskIndicator` (a real, already-computed RKM fact —
no new analyzer) now classifies as `ruins` instead of a plain
landmark/region, per "deprecated/dead areas = ruins." See
`src/server/world/builder.test.ts`'s ruins-classification test.

## 9. What was verified

- Full test suite (164 tests, including 11 new ones for
  `domains.ts`/`flowLayout.ts`/the ruins classification) and `tsc --noEmit`
  both pass; `next build` succeeds.
- A real analysis of `lujakob/nestjs-realworld-example-app` (the demo
  repository) against a local production build (`next build && next start`
  — `next dev`'s per-route on-demand compilation can otherwise
  re-instantiate the in-memory World store mid-flow, a `next dev`-only
  artifact unrelated to this redesign), verified in-browser:
  - Architecture lens shows 8 real Domains as terraces with real
    boundary rings, one visibly colored amber/red for its real `stressed`
    health tier (the `shared` module).
  - Clicking a Domain terrace reveals its module as a building; clicking
    the building opens the Investigation Panel with real file/centrality/
    importance data.
  - The Flow lens, walked through the real "User" flow: Bob's orb
    appeared and moved between real step waypoints, the compact
    INVESTIGATING/WHY/NEXT HUD tracked each step (including real dependency
    evidence such as `"user.controller imports user.service (deterministic
    edge)"`), the walkthrough card showed the exact required disclaimer
    text, and the walkthrough correctly crossed from the `user` Domain into
    the `article` Domain when the route did.
  - The Dependencies lens rendered a real bidirectional (`user` ↔
    `article`) dependency as a dashed, looping cyclic road.
  - The Onboarding lens's picker correctly reported no journey existed yet
    for this fresh World (Bob-only journey creation was not exercised in
    this pass — the mechanism is identical to the already-tested Flow
    lens).
  - `open_module` called directly against the local `/api/mcp` endpoint
    moved Bob's focus and opened the Investigation Panel live in an
    already-open browser tab; `get_current_context` correctly reported the
    resulting selection back.

## 10. Known limitations / scope trims

- The Domain-grouping heuristic (§2) is a single-level, path-prefix
  grouping — it does not attempt deeper multi-level clustering for
  repositories with more than one layer of meaningful nesting.
- The minimap (`WorldHud`) still plots per-module dots (via the original
  `layoutRegions`), not per-Domain dots — a minor granularity mismatch with
  the new Domain-first navigation model.
- The Health lens is intentionally the lightest of the six — it reuses the
  Architecture lens' always-on health coloring rather than introducing a
  separate dashboard-style overlay.
- The Activity lens' highlight set depends on a tool call's arguments
  actually containing a `moduleId` — tool calls that don't reference a
  specific module (e.g. `analyze_repository`, `list_flows`) don't
  contribute to it, by design (never inventing a location for activity that
  doesn't have one).
- Onboarding-journey creation and the Onboarding lens' live in-world
  visualization were exercised through the picker and the (identical)
  Flow-lens mechanism, but not through a real end-to-end
  `create_onboarding_journey` MCP call in this verification pass.
