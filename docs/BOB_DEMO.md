# Hackathon Demo Script — IBM Bob + CodeBiome

> **Historical record.** This demo script predates both the 2D-lens UI rework and the agent-submission architecture rework. See [`docs/DEMO_SCRIPT.md`](./DEMO_SCRIPT.md) for the current demo script. Kept for historical reference.

3–5 minutes. Every step below was actually run against a real IBM Bob 2.0
session and a real repository during development — see
[`BOB_INTEGRATION.md` §9](./BOB_INTEGRATION.md#9-how-this-was-actually-verified--with-real-ibm-bob-20)
for the full transcripts. Nothing here is scripted or faked; it's a replay
of what genuinely happened.

**Repository used:** `lujakob/nestjs-realworld-example-app` (NestJS,
controller → service → entity, a real login/auth flow — good balance of
"recognizable" and "has real architecture to explain"). Swap in whatever
repo fits your audience; the flow below is repository-agnostic.

**Setup before you're in front of judges** (see `BOB_INTEGRATION.md` §12
for the full one-time install):
- CodeBiome running (`npm run start`), MCP server live at `/api/mcp`.
- Bob Shell installed and authenticated (`BOB_API_KEY` exported, or logged
  in via `bob chat`).
- `bob mcp add codebiome http://localhost:3000/api/mcp -t http -s global`
  already run once — persists across sessions.
- Two windows visible side by side: your terminal (running `bob run`) and
  the CodeBiome browser tab.

---

## The story: "Imagine you just joined this project"

**1. Open the repository in CodeBiome.**
Paste the GitHub URL, let it analyze. The world appears — landmarks,
trails, the usual CodeBiome visualization. Say out loud: *"This is
CodeBiome's deterministic layer — it knows the repository's structure,
dependencies, and entry points. No AI involved yet."*

**2. Point at the "Bob isn't connected" HUD widget** (top-left). *"Right
now, nobody's asked Bob anything about this repo — CodeBiome says so
honestly instead of faking a connection."*

**3. Ask Bob, in your terminal:**
```bash
bob run --accept-license --trust "I'm new to this repository. What should I understand first? Then show me the first thing I should explore."
```
While it runs, narrate: *"Bob is deciding for itself which of CodeBiome's
16 tools to call — I haven't told it anything about this repo's
structure."*

**4. Switch to the browser the moment it finishes.**
The HUD widget now reads "Bob is connected" with a live tool-call feed:
`get_repository_overview`, `list_flows`, `get_module`, `get_flow`,
`start_flow`. The world has already navigated to the highest-centrality
module and opened a flow walkthrough at step 1 — **with zero clicks from
you.** Read Bob's terminal output out loud: it explains *why* it picked
that module (real centrality/importance numbers), not a guess.

**5. Ask a follow-up, in the same spirit as the onboarding story:**
```bash
bob run --accept-license --trust "How does this application handle a login request end to end?"
```
Bob calls `find_feature` → `get_flow` → `get_module` → several `get_file`
calls, reading actual source (controller, service, DTO, auth middleware),
and returns a precise, code-grounded walkthrough — argon2 password
verification, exact JWT claims, the works. *"That's not a summary of
training data — it just read this repository's real files."*

**6. Click through a couple of walkthrough steps yourself** ("Continue →"
in the Investigation Panel) to show the human and the AI can both drive the
same walkthrough interchangeably — it's one shared state, not two
disconnected UIs.

**7. Select an unrelated module in CodeBiome by hand** (pause the
walkthrough), then ask Bob:
```bash
bob run --accept-license --trust "What would be affected if I changed this module?"
```
Bob calls `get_current_context` first — no module name given — then
`show_impact`. The browser highlights every real dependent module. *"Bob
knew what I was looking at because CodeBiome told it — I never typed the
module's name."*

**8. Close on the product line:**

> "CodeBiome knows the repository, deterministically. Bob understands and
> explains it, through real tool calls you can watch happen live. Neither
> one pretends to be the other — and that boundary is the whole point."

---

## If something doesn't cooperate live

- **Bob takes >20s to respond:** normal for a multi-tool investigation
  (§9.2 shows 15–35s / $0.05–$0.19 per question). Narrate while it thinks
  instead of standing in silence.
- **The browser tab looks stale:** confirm the SSE connection — refresh
  the tab once; `useBobBridge` reconnects and replays recent history.
- **Bob calls a different tool sequence than the table above:** that's
  expected and fine to point out — *"it picks its own path every time,
  that's not scripted"* is a stronger demo moment than a rehearsed one.

## What NOT to claim during the demo

- Don't say CodeBiome "traced" or "ran" the repository — every flow is
  static reconstruction, and Bob's own answers should (mostly) carry that
  framing too. If Bob states something confidently that's really a
  structural inference, it's fine to add the caveat yourself out loud —
  see `BOB_INTEGRATION.md` §9.3 for a real example of this exact gap.
- Don't claim Bob's answer appears "inside" CodeBiome — it doesn't, and
  saying so would misrepresent the architecture (`BOB_INTEGRATION.md` §1).
  The honest framing — Bob's answer lives in Bob's own window, CodeBiome's
  world reacts to Bob's actions — is the more interesting story anyway.
