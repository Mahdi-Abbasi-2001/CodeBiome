# 5-Minute Demo Voiceover Script — CodeBiome

Pure narration, meant to be recorded standalone now and matched to screen
footage later. Nothing below depends on which repository ends up on
screen, what a specific tab happens to show, or which MCP client is
recording alongside it — it talks about what CodeBiome *does* and *how*,
not what's currently visible on any one page. Each section has a target
duration for pacing (roughly 130–150 words/minute) and a one-line, generic
**[footage: …]** cue — a note for whoever cuts the video, not something to
read aloud.

Total target: ~5:00.

---

## 1. The problem (0:00–0:25)

> Joining a codebase you didn't write means the same slow ritual every
> time: search for a name, open a file, follow an import, repeat — for
> days — before you have any real mental model of how the thing works.
> CodeBiome turns that exploration into something durable: a real AI agent
> investigates the actual code, and what it finds becomes a shared,
> explorable map — not a transcript that disappears when the chat ends.

*[footage: logo / landing page, no interaction yet]*

## 2. What CodeBiome is (0:25–1:05)

> Paste a GitHub URL, and CodeBiome does exactly one thing on its own:
> fetch the repository and record its real file tree. Nothing more. An AI
> agent — any MCP-compatible one you already use, or CodeBiome's own
> built-in one — explores that code the way a person would, and tells
> CodeBiome what it found. Every single claim it makes gets checked against
> the real files before it's ever shown: reference a file that doesn't
> exist, and the claim is rejected, not rendered.

*[footage: a repository URL being entered; the fetch/file-tree recording step]*

## 3. Any agent, verified either way (1:05–1:50)

> This is the part that's different from most AI code tools: CodeBiome
> doesn't run its own analysis and hope it's as good as your agent's
> reasoning — it doesn't have to be, because it isn't competing with your
> agent, it's verifying it. Thirty-two MCP tools are exposed at one
> endpoint. Claude, Cursor, Cline, Windsurf, IBM Bob — any client that
> speaks the protocol connects the same way and calls the same tools:
> explore with get_file and search_repository, then submit what it found —
> real modules, real dependency edges, real entry points, real security
> findings — each one checked against the file tree before it's stored.
> Nothing is invented to fill a gap, because there's no gap-filling step at
> all.

*[footage: a terminal running a real agent session, cut to the browser tab
reacting live as tool calls land — no specific sequence scripted]*

## 4. Five lenses on whatever's been verified (1:50–2:35)

> What's been submitted so far renders through five lenses, live, call by
> call. Architecture shows the real modules and how they and the
> surrounding infrastructure — databases, caches, queues, external APIs —
> actually connect. Onboarding is a path through the codebase, ordered and
> narrated by the agent for someone new to it. Flow reconstructs one
> request end to end, hop by hop, each one scored by confidence. Health
> turns all of it into a single score, but never an opaque one — every
> contributing vulnerability, weakness, and strength is listed right
> alongside it. And Plan is the one lens that's genuinely agent-authored: a
> proposed feature plan, rendered so it visibly reads as proposed, never
> mistaken for something already built.

*[footage: a quick pass across Architecture, Onboarding, Flow, Health, and
Plan — whichever repo is on screen, no specific data called out]*

## 5. No agent connected? CodeBiome has its own (2:35–3:15)

> If you'd rather not connect your own agent for a quick look, CodeBiome
> ships with one built in — the same tool calls, the same verification,
> just running inside CodeBiome itself instead of your IDE. Paste a URL
> with no agent connected, and it explores the repository and populates the
> World the same way any external agent would, live, in the browser. It has
> no special access CodeBiome wouldn't grant anyone else — if it can
> populate a useful World through the public tool surface, that's proof any
> agent can.

*[footage: pasting a URL with no external client connected; the built-in
agent's tool calls appearing as a live log]*

## 6. Built to stay honest (3:15–4:15)

> A few things run through all of this on purpose. Every flow and every
> onboarding journey is a static reconstruction the agent submitted —
> CodeBiome never executes the repository it's analyzing, and the
> interface never implies otherwise. Every confidence level, every "this is
> the agent's interpretation, not a verified fact" label, is disclosed in
> the same place a person would actually look. Multiple agents can work
> against the same deployment without colliding with each other's analysis
> — each connection resolves to its own World, never someone else's. And
> the whole thing runs on a serverless free tier: no database required to
> try it, a durable store when you deploy it for real.

*[footage: a confidence badge or "agent's interpretation" label in
close-up; optional — cut if time is short]*

## 7. Close (4:15–5:00)

> CodeBiome verifies and visualizes — that never changes. Which AI agent
> does the actual understanding is up to you: bring your own, or use the
> one built in. Neither one ever pretends to be more certain than the real
> files allow, and that boundary is the whole point.

*[footage: pull back to a wide shot of the Architecture graph, fade to the
project URL]*

---

## Notes for whoever records the screen footage (not part of the voiceover)

- **Don't chase exact wording.** The narration above never names a specific
  flow, module, tool count, or agent brand on screen, so footage can be cut
  and re-cut against it freely.
- **Repository recommendation:** a small, real full-stack app with more than
  one obvious domain (frontend, backend, database) lights up more of
  Architecture and Onboarding than a backend-only repo would.
- **Have a real agent session ready.** Section 3 needs an actual MCP client
  connected and calling tools live — see [`docs/MCP_CLIENTS.md`](./MCP_CLIENTS.md)
  for setup. Don't fake the tool-call log; it's meant to be real, same as
  before.
- **Section 5's built-in agent needs `OPENROUTER_API_KEY` set** on whatever
  instance you're recording against — verify it's populating a World before
  you start rolling, since a missing key degrades gracefully (a note, not a
  crash) rather than erroring loudly on screen.
- **One honest limitation to remember while filming Flow:** flows and
  journeys are only as complete as what the recording agent actually
  submitted — if it didn't call `submit_flow` for a given request path,
  Flow just won't show it yet. Don't film a shot implying Flow reaches
  something nobody submitted.
- **Pacing match:** aim for roughly the timestamps above when cutting (give
  section 3, the multi-agent verification story, the most screen time)
  so voice and footage breathe together.
