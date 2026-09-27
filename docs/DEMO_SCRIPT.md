# 5-Minute Demo Voiceover Script — CodeBiome

Pure narration, meant to be recorded standalone now and matched to screen
footage later. Nothing below depends on which repository ends up on
screen, what a specific tab happens to show, or a specific click sequence —
it talks about what CodeBiome *does* and *how*, not what's currently
visible on any one page. Each section has a target duration for pacing (at
a normal speaking pace, roughly 130–150 words/minute) and a one-line,
deliberately generic **[footage: …]** cue in brackets — that's a note for
whoever cuts the video later, not something to read aloud.

Total target: ~5:00. Read it once through against a stopwatch before
recording for real; trim mid-sentence rather than rushing the close.

---

## 1. The problem (0:00–0:25)

> Joining a codebase you didn't write means the same slow ritual every
> time: search for a name, open a file, follow an import, repeat — for
> days — before you have any real mental model of how the thing works.
> CodeBiome builds that model for you, from the actual code, in seconds.
> And when you want to ask a question about it, an AI agent can answer by
> genuinely reading that repository — not by guessing from training data.

*[footage: logo / landing page, no interaction yet]*

## 2. What CodeBiome is (0:25–1:00)

> CodeBiome takes one GitHub URL and turns it into a verified,
> explorable understanding of that repository — its architecture, its real
> request flows, its health, and a guided path for someone new to it. The
> pipeline is simple to state and strict to follow: a deterministic
> analysis engine establishes the facts, and everything downstream — every
> screen, every answer an AI agent gives — is built strictly on top of
> those facts. Nothing is ever invented to fill a gap.

*[footage: a repository URL being entered; the analysis pipeline running]*

## 3. The deterministic core (1:00–1:40)

> Underneath, thirteen analyzers run against every file in the
> repository — no sampling, no size cap, the whole thing. One dependency
> analyzer per language — JavaScript and TypeScript, Python, Go, Rust,
> Java, C and C++, C#, Ruby, PHP — plus analyzers for structure, security
> patterns, entry points, and frontend call sites. The result is a single
> schema-validated model of the repository: its modules, its real
> dependency graph, its inferred request flows, its security findings. That
> schema is enforced with Zod, and it's the actual mechanism behind "an AI
> can never invent a fact about this repository" — not just a promise, a
> constraint the data itself enforces. Two hundred and thirty-plus unit
> tests hold this layer to that standard.

*[footage: the live analysis progress view, showing real counts ticking up]*

## 4. Five lenses on the same facts (1:40–2:30)

> That model is then rendered through five lenses, and every one of them
> is a different question asked of the exact same verified data.
> Architecture shows the real modules and how they and the surrounding
> infrastructure — databases, caches, queues, external APIs — actually
> connect, built only from technologies the repository's own code imports.
> Onboarding is a path through the codebase, ordered and narrated by an AI
> agent for someone new to it. Flow reconstructs one request end to end —
> real files, real hops, each one scored by confidence rather than dressed
> up as certain. Health turns all of it into a single score, but never as
> an opaque number — every contributing vulnerability, weakness, and
> strength is listed right alongside it. And Plan is the one lens that's
> genuinely AI-authored: a proposed feature plan, rendered so it visibly
> reads as proposed, never mistaken for something already built.

*[footage: a quick pass across the Architecture, Onboarding, Flow, Health,
and Plan tabs — whichever repo is on screen, no specific data called out]*

## 5. Bob, as an MCP client — the centerpiece (2:30–3:50)

> Here's the part that isn't just a dashboard: CodeBiome exposes everything
> it knows as an MCP server — twenty-four tools a developer's own coding
> agent can call. IBM Bob runs in a developer's IDE or terminal, decides
> for itself which of those tools to call, and investigates the repository
> the same way a person would — reading the overview, tracing a flow,
> opening real files — before it answers anything. Nothing about this is a
> wrapped chat prompt pretending to be Bob; it's a real agent, making real
> tool calls, that a browser tab watching the same repository can see
> happen live. A click from a person and a tool call from Bob move the
> exact same shared state — because there's only one of it. Ask Bob to
> onboard you to an unfamiliar repository, and it investigates first,
> checks whether a journey already exists so it never duplicates one, and
> only then writes back a real, ordered path through real modules — each
> step naming an actual centrality or importance number, never a guess.

*[footage: a terminal running a real `bob run` prompt, cut to the browser
tab reacting live once it finishes — no specific tool-call sequence
scripted, whatever Bob actually does]*

## 6. Built to stay honest (3:50–4:25)

> A few things run through all of this on purpose. Every flow and every
> onboarding journey is a static reconstruction — CodeBiome never executes
> the repository it's analyzing, and the interface never implies otherwise.
> Every confidence level, every "this is Bob's interpretation, not a
> verified fact" label, is disclosed in the same place a person would
> actually look, not buried in a footnote. And the whole thing is built to
> run on a serverless free tier: no database required to try it, a durable
> store when you deploy it for real, and a schema designed so a fuller
> production setup is additive later, not a rewrite.

*[footage: a confidence badge or "Bob's interpretation" label in close-up;
optional — cut if time is short]*

## 7. Close (4:25–5:00)

> CodeBiome knows the repository, deterministically — that never changes.
> An AI agent understands and explains it, through real tool calls you can
> watch happen live. Neither one ever pretends to be the other, and that
> boundary is the whole point.

*[footage: pull back to a wide shot of the Architecture graph, fade to the
project URL]*

---

## Notes for whoever records the screen footage (not part of the voiceover)

- **Don't chase exact wording.** The narration above never names a specific
  flow, module, or count on screen, so footage can be cut and re-cut
  against it freely — swap repositories, re-run the analysis after a bug
  fix, reorder which tab appears when, without re-recording the voice.
- **Repository recommendation, still current:** `shamahoque/mern-marketplace`
  (default branch `second-edition`) — a small, real full-stack app (React
  client, Express/Mongoose backend, Stripe integration) that lights up more
  of Architecture (client + backend + database + external-API nodes) and
  Onboarding (seven real domains) than a backend-only repo would. Details
  and the trade-off against `lujakob/nestjs-realworld-example-app` (lower
  risk, already Bob-verified, but backend-only) are unchanged from before —
  ask if you want that comparison written back out in full.
- **Known state as of this recording:** the entry-point analyzer previously
  missed Express's chained `router.route(path).get(handler)` registration
  style, which is what `mern-marketplace` uses — that's fixed
  (`src/server/analyzers/entry-point-analyzer.ts` and
  `src/server/flows/inferFlows.ts`), verified end-to-end, and covered by new
  tests, but not yet committed. Re-analyze the repository after pulling
  that fix before capturing Flow-tab footage.
- **One honest limitation to remember while filming Flow:** it traces
  file-to-file imports only, so a bare `import stripe from 'stripe'` inside
  a controller never appears as a Flow hop, even though Stripe correctly
  shows up as a real node on Architecture. Don't film a shot that implies
  Flow reaches into a third-party API call — it doesn't, by design.
- **Pacing match:** aim for roughly the same section lengths as the
  timestamps above when you cut (e.g. give the Bob segment the most screen
  time, ~80 seconds) so voice and footage breathe together even if you
  don't cut to the exact second.
