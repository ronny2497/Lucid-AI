# GSD Onboarding Brief — feed this to `/gsd-new-project`

> **Purpose.** Lucid already has a foundation (vision, decisions, roadmap, per-phase PRDs). When initializing GSD, use this brief so GSD **adopts the existing work** as its Discuss/Plan artifacts rather than starting from a blank project. Point `/gsd-new-project` at this file and the `docs/` + `prd/` directories.

## Project in one line
Lucid — an open, framework-neutral **observability + evaluation plane for agent harnesses**, with a configurable **self-evolution engine** on top. "Stop asking whether the agent worked; ask what the harness observed."

## Status
Pre-implementation. Foundations are complete and authoritative. The next GSD milestones are **implementation** phases, not re-discovery.

## Locked decisions (do not re-litigate — see `docs/03-decisions/`)
1. **HSC standard** = OpenTelemetry-compatible profile (ADR-0001)
2. **TypeScript** primary for SDK/collector/eval/UI; Python only as optional trainer sidecar (ADR-0002)
3. **Apache-2.0** for standard + SDK + adapters (ADR-0003)
4. **GRPO behind a swappable `TrainerPlugin`**; framework never hard-depends on Python (ADR-0004)

## Existing artifacts GSD should treat as authoritative input
- `docs/00-vision.md` — problem, thesis, differentiation
- `docs/01-concepts.md` — vocabulary (5 principles, 2×2, Harness Trace, HSC, autonomy ladder)
- `docs/02-architecture.md` — six pillars + data model
- `docs/03-decisions/ADR-0001..0004` — the locked decisions
- `docs/04-roadmap.md` — Phases 0–6 (each a vertical slice with a falsifiable exit)
- `docs/standard/hsc-overview.md` — the standard
- `docs/guides/*` — the developer-experience spec
- `prd/phase-0..6-*.md` — detailed per-phase PRDs (the GSD "Plan" inputs)

## Mapping our roadmap onto GSD's phase loop
Each Lucid phase (0–6) becomes a GSD **milestone**, run through Discuss → Plan → Execute → Verify → Ship:
- **Discuss** is largely done per phase (the PRD's Problem/Approach/Open-questions sections); resolve only the PRD's listed open questions.
- **Plan** = decompose the PRD's scope into work waves.
- **Execute** = fresh-context subagents per wave (matches how the PRDs themselves were authored).
- **Verify** = check against the PRD's exit criterion (this *is* the Feedback principle Lucid preaches).
- **Ship** = PR + archive the phase.

## First GSD milestone
**Phase 0 — Foundations & the standard** (`prd/phase-0-foundations-standard.md`). Exit: a real hermes-agent run emits a valid HSC trace, stored as JSON, hand-inspectable. (hermes-agent is only a reference/test harness — nothing baked in. Do not reference Overpath.)

## Guardrails for GSD agents
- Honor the four ADRs; flag (don't silently change) any conflict.
- Keep all illustrative code marked illustrative until a phase explicitly enters implementation.
- Practice the discipline we measure: legibility, verify-before-ship, one-thing-at-a-time, codebase=docs.
