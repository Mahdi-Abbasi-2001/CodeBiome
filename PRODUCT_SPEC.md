# Repository World — Product Specification

> **Historical record.** This is the original hackathon vision document. The
> product has since evolved twice: first from the 2.5D avatar-navigable
> world described here to a flat, five-lens 2D dashboard (Architecture /
> Onboarding / Flow / Health / Plan), and then from "IBM Bob as a hardcoded
> intelligence layer" to "any MCP-compatible agent, verified against real
> files, with CodeBiome itself never analyzing the repository." See
> [`README.md`](./README.md) and [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
> for what's actually built today. Kept for historical reference — the
> underlying goal (help someone understand an unfamiliar codebase quickly,
> grounded in real facts) is unchanged even though the mechanism is not.

## Vision

Transform any public GitHub repository into an interactive world that
helps developers understand an unfamiliar codebase through exploration,
AI guidance, and hands-on onboarding.

The product is an AI-powered onboarding toolbox.

The user provides a public GitHub repository URL.

The system analyzes the repository and generates:
- repository architecture
- dependencies
- data flows
- code health
- risks
- Git history
- documentation
- domain concepts
- tests
- onboarding journey

IBM Bob is a core part of the intelligence layer.

The final result is presented as an interactive 2.5D world.

The repository becomes a procedurally generated environment.

The user is represented by an avatar who can:
- follow a guided onboarding journey
- freely explore the repository
- investigate components
- ask Bob questions
- trace data flows
- inspect code
- understand dependencies
- complete onboarding missions
- discover a suitable first contribution

## Primary users

1. Developers joining an existing project
2. Developers joining an open-source project
3. Developers inheriting an unfamiliar codebase

## Core experience

GitHub URL
→ Repository analysis
→ Repository knowledge model
→ Bob intelligence
→ World generation
→ Guided journey / Free exploration
→ Understanding
→ Missions
→ First contribution

## Visual direction

2.5D / cinematic hybrid.

The world should feel like an explorable game environment,
but remain clearly recognizable as a serious developer tool.

The user has an avatar.

The environment changes according to repository characteristics.

Examples:

Healthy code:
- healthy trees
- sunlight
- clear paths

Dead code:
- dead trees
- fog
- abandoned areas

Critical code:
- dangerous environment
- warning indicators
- dramatic lighting

Security issue:
- toxic environment
- hazard indicators

Highly connected module:
- enormous central tree

Database:
- underground cave

External API:
- portal

CI/CD:
- factory

Documentation:
- library

Tests:
- training grounds

Entry point:
- gate

Git activity:
- footprints / traveled paths

Technical debt:
- ruins

## Modes

Guided Journey:
Bob generates a repository-specific onboarding path.

Free Explore:
The user can explore the entire repository world.

## AI

Use a hybrid architecture.

Deterministic analysis establishes facts.

IBM Bob interprets those facts and generates:
- explanations
- architecture understanding
- onboarding journey
- domain concepts
- missions
- contextual guidance

The AI must not invent repository facts.

## Core toolbox

Repository scanner
Architecture mapper
Dependency analyzer
Data-flow analyzer
Git history analyzer
Code health analyzer
Security analyzer
Test analyzer
Documentation analyzer
Domain/glossary analyzer

## Interactive toolbox

Guided onboarding
Free exploration
Explain this
Trace this
What depends on this?
What would break?
Show code
Show history
Ask Bob
Missions
Quizzes
First contribution

## Product principle

The repository should not be presented primarily as a graph,
file tree, or static report.

The repository should be experienced as a world.

Graphs, trees, dependency information, and reports are underlying
technical representations used by the world and investigation tools.
