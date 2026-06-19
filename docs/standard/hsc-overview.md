# Harness Semantic Conventions (HSC) — Conceptual Overview

> **Status:** conceptual overview only. The formal JSON Schema + attribute registry is a Phase 0 deliverable ([PRD](../../prd/phase-0-foundations-standard.md)). All names below are **proposed**, not frozen.

HSC is the open, **OpenTelemetry-compatible** vocabulary that makes any harness observable by Lucid. It defines: (1) the event types, (2) the `harness.*` attribute set, (3) the principle/quadrant tagging rules, and (4) how all of this maps onto OTel spans/events. See [ADR-0001](../03-decisions/ADR-0001-otel-compatible-hsc-profile.md).

---

## Why a standard (the developer payoff)
Because HSC is the contract, a developer instruments **once** and gets: framework-neutral storage (any OTel backend), the base-metrics layer, the principle/2×2 diagnostic, and eligibility for self-evolution — all without coupling to Lucid internals. Emit HSC → everything downstream works.

---

## The event types (proposed)

| Event | Meaning | Principle | Quadrant (x,y) |
|---|---|---|---|
| `context.load` | tokens/artifacts assembled into context | context | feedforward, computational/inferential |
| `plan.emit` | a plan/intent produced before action | plan_execute | feedforward, inferential |
| `task.slice` | a unit of work scoped (vertical slice) | one_at_a_time | feedforward, computational |
| `tool.call` | a tool/action invoked (`mutated_state?`) | plan_execute | — |
| `feedback.check` | a verification step initiated | feedback | feedback, computational/inferential |
| `verify.result` | the outcome of a verification | feedback | feedback, computational |
| `doc.encode` | tacit knowledge written to a durable artifact | codebase_docs | feedforward, computational |
| `evolve.propose` | a change_manifest proposed | (meta) | feedback, inferential |
| `evolve.apply` | a change_manifest applied | (meta) | feedback, computational |
| `error` | a failure/exception | — | — |

**Absence is signal.** A `tool.call{mutated_state:true}` with no subsequent `feedback.check`/`verify.result` *is* the empty-feedback-quadrant finding. HSC never fabricates a missing event.

---

## The `harness.*` attribute extension (proposed)

The agentic core (LLM calls, tool execution, agent invocations) maps to existing **OTel GenAI** spans. HSC adds a namespaced extension for what OTel lacks:

| Attribute | Example | Purpose |
|---|---|---|
| `harness.event_type` | `feedback.check` | the HSC event type |
| `harness.principle` | `feedback` | which convergence principle |
| `harness.quadrant.x` | `feedback` | feedforward \| feedback |
| `harness.quadrant.y` | `computational` | computational \| inferential |
| `harness.version` | `v37` | harness build, for version diffing |
| `harness.mutated_state` | `true` | did the action mutate state |
| `harness.change_manifest_id` | `cm-123` | links evolve events to a proposal |
| `harness.inferred` | `true` | this event was *inferred*, not emitted (lower confidence) |

---

## How a developer emits HSC (three paths, increasing effort)

1. **Adapter (near-zero effort)** — install the adapter for your framework; it emits HSC automatically.
   ```bash
   # ILLUSTRATIVE
   npm i @lucid/adapter-langgraph
   ```
2. **SDK (low, incremental effort)** — wrap your loop / emit events where you have them.
   ```ts
   // ILLUSTRATIVE
   import { harness } from "@lucid/sdk";
   await harness.event("plan.emit", { principle: "plan_execute", attrs: { steps: 3 } });
   ```
3. **Raw OTel (advanced)** — emit OTel spans with `harness.*` attributes directly; validate with `lucid conformance`.

---

## Versioning & conformance
- HSC is **versioned**; adapters declare the HSC version they target.
- A **conformance test suite** (Phase 6) lets any adapter certify it emits valid HSC.
- The roadmap is to **upstream** the harness layer into OpenTelemetry once stable.

---

## Governance & Upstreaming

The standard is governed by two documents that pin how it evolves and how it relates to OpenTelemetry:

- **[Versioning & Vendor-Extension Policy](versioning-policy.md)** — HSC SemVer rules (MAJOR = removing event types / changing required attributes or bindings; MINOR = additive optional attributes/events; PATCH = clarifications), the breaking-change RFC process (proposal issue → discussion window → maintainer signoff for MUST/SHALL → CHANGELOG), the rule that the **conformance suite + badge are keyed to the HSC version** ("HSC v0 conformant"), and the **`harness.x.<vendor>.*`** vendor-extension policy (allowed, excluded from core diagnostics until promoted, WARNed when undeclared).
- **[OTel Upstreaming Proposal](upstream-proposal.md)** — the **non-blocking** proposal to contribute the `harness.*` layer to OpenTelemetry GenAI as a `gen_ai.harness.*` sub-namespace (with a standalone-companion-convention fallback) and the compatibility-shim strategy. **Upstreaming is upside, not a Phase 6 dependency** — HSC ships the extension regardless of the OTel timeline ([ADR-0001](../03-decisions/ADR-0001-otel-compatible-hsc-profile.md), RESEARCH Pitfall 5).

Adapter authors: see the [authoring & certification guide](../guides/adapter-authoring.md) and the [conformance report & badge guide](../guides/conformance-badge.md).

---

## Open questions deferred to Phase 0
- Exact OTel GenAI convention version to pin.
- Machine-checkable predicate definitions for each quadrant axis.
- How aggressive the optional `harness.inferred` layer should be for harnesses lacking explicit plan/feedback steps.
