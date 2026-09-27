# Onboarding-Journey Demo Script — IBM Bob + CodeBiome

> **Historical record.** This demo walkthrough predates the agent-submission architecture rework — onboarding journeys are still a real, current feature, but the surrounding analysis pipeline described here has changed (see [`docs/REPOSITORY_KNOWLEDGE_MODEL.md`](./REPOSITORY_KNOWLEDGE_MODEL.md)). Kept for historical reference.

3–5 minutes. Every step below was actually run against a real IBM Bob 2.0
session (Bob Shell) and a real repository during development — see
[`BOB_INTEGRATION.md` §10.6](./BOB_INTEGRATION.md#106-the-onboarding-journey-capability-52-validated-end-to-end-with-real-ibm-bob-20)
for the full transcripts. Nothing here is scripted or faked; it's a replay
of what genuinely happened. This complements `BOB_DEMO.md` (the earlier
flow-walkthrough/domain-concept demo) with the newer, higher-level
onboarding-journey capability that's the primary workflow this phase adds.

**Repository used:** `lujakob/nestjs-realworld-example-app` — a real
NestJS app with 6 real modules (`user`, `article`, `profile`, `tag`,
`shared`, plus the app root), a real dependency graph, and no single
"correct" onboarding order that a deterministic flow reconstruction alone
would produce — a good demonstration of why an ordered, narrated Bob
journey adds something a Flow walkthrough doesn't.

**Setup before you're in front of judges** (see `BOB_INTEGRATION.md` §13
for the full one-time install):
- CodeBiome running (`npm run start`), MCP server live at `/api/mcp`.
- Bob Shell installed and authenticated (`BOB_API_KEY` exported).
- `bob mcp add codebiome http://localhost:3000/api/mcp -t http -s global`
  already run once.
- Two windows visible side by side: your terminal (running `bob run`) and
  the CodeBiome browser tab.

---

## The story: "A new developer just joined this project"

**1. Open the repository in CodeBiome.** Paste the GitHub URL, let it
analyze. Say out loud: *"This is CodeBiome's deterministic layer — modules,
dependencies, and entry points, no AI involved yet. The world exists and
is fully explorable with or without Bob."*

**2. Point at the two Bob buttons in the HUD** — "Bob's Interpretation"
and "Bob's Onboarding" — both show `(0)`. *"Neither has anything yet.
CodeBiome doesn't pretend Bob has already looked at this repository."*

**3. Ask Bob, in your terminal** (verbatim, the brief's own onboarding
prompt):
```bash
bob run --accept-license --trust "I'm new to this repository. Analyze it and create a guided onboarding journey that helps me understand the main user workflow. Use CodeBiome to visualize the architecture and guide me through the relevant parts of the codebase. Only use repository facts available through CodeBiome. Clearly distinguish verified repository facts from your own interpretation."
```
While it runs, narrate: *"Watch it investigate — repository overview, the
flows CodeBiome already reconstructed, five different modules — before it
writes anything back. It even checks whether an onboarding journey already
exists first, unprompted, so it doesn't create a duplicate."*

**4. Switch to the browser the moment it finishes.** The activity feed
shows the real sequence (`get_repository_overview` → `list_flows` →
`get_module`×5 → `list_onboarding_journeys` → `list_domain_concepts` →
`contribute_domain_concept`×2 → `create_onboarding_journey`). The world has
already reacted — Investigation Panel open on `src`, and a new periwinkle
"BOB'S ONBOARDING JOURNEY" card at bottom-left reading "Step 1 / 6 — Main
User Workflow: Register → Publish → Follow" with the real reason text for
step 1. **Zero clicks from you.**

**5. Open "Bob's Onboarding (1)" in the top bar.** Show the full 6-step
journey — every step names a real module and a reason Bob wrote, e.g.
*"src/user — highest-importance module (importance 0.775, centrality
1.0)... this is where you understand how identity works."* Say: *"Every
one of these module names is real and verified — Bob can't invent one.
The reasoning is Bob's own."*

**6. Click "Continue →" on the HUD card yourself** (no Bob call). The
world advances to step 2 (`shared`), Investigation Panel updates, camera
moves. *"This works exactly the same whether a human or Bob is driving —
one shared state, not two disconnected UIs."*

**7. Ask a contextual follow-up, with `shared` still focused:**
```bash
bob run --accept-license --trust "Why is the module I'm currently looking at important, and what should I look at next in the onboarding journey?"
```
Bob calls `get_current_context` first — no module or journey name given
anywhere in the prompt — which resolves both "the module I'm looking at"
(`shared`) and "the onboarding journey" (title, step index) from what the
browser last reported. Its answer correctly explains `shared`'s role,
cites its two real files, and identifies `src/user` as the next step with
real importance/centrality numbers — then asks *"Shall I advance the
journey to step 3?"* rather than acting unprompted. *"That's Bob choosing
to confirm before acting on an informational question — a good sign, not
a gap."*

**8. Close on the product line:**

> "CodeBiome knows the repository, deterministically — that never changes.
> Bob decided what a newcomer should see first, in what order, and why —
> that's its interpretation, always labeled as such. Neither one pretends
> to be the other."

---

## If something doesn't cooperate live

- **Bob creates a journey with a different step order or module
  selection than shown above:** expected and worth pointing out — *"it's
  reasoning about this repository fresh, not replaying a script."*
- **Bob calls `advance_onboarding_step` directly instead of asking:**
  also fine — both are legitimate; say so.
- **The HUD still shows "Bob isn't connected yet":** confirm the SSE
  connection with a tab refresh; `useBobBridge` reconnects and replays
  recent history including any journey already created.

## What NOT to claim during the demo

- Don't say the journey order is "the correct" way to onboard — it's
  Bob's interpretation of a good order, not a deterministic fact. The
  panel's own copy says so; keep your narration consistent with it.
- Don't claim Bob's own answer (step 7) appears inside CodeBiome's UI —
  it doesn't and it's not supposed to (see `BOB_INTEGRATION.md` §1). The
  world reacting live is the honest, more interesting story.
- Don't fabricate a time-saved percentage. The honest comparison is steps,
  not a stopwatch: manual onboarding is "search → open files → trace
  imports → build a mental model"; guided onboarding is "ask Bob →
  verified investigation → guided world."
