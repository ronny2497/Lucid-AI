# Proposal: Upstream the HSC `harness.*` layer to OpenTelemetry GenAI

> **NON-BLOCKING UPSIDE — NOT A PHASE 6 DEPENDENCY.** This proposal documents a parallel community track. Lucid ships the HSC `harness.*` extension **regardless** of whether OpenTelemetry ever adopts it. No code path, no release, and no exit criterion depends on an OTel merge. Per [ADR-0001](../03-decisions/ADR-0001-otel-compatible-hsc-profile.md) and PRD §3, upstreaming is **upside, not a prerequisite** (RESEARCH Pitfall 5). The OTel merge timeline is outside Lucid's control; treating it as a dependency would block shipping value on an external committee — so we explicitly do not.

## Summary

HSC reuses OpenTelemetry **GenAI** semantic conventions verbatim for the agentic core (LLM calls, tool execution, agent invocations) and adds a small `harness.*` extension for the concepts OTel lacks: the **convergence principle**, the **feedforward/feedback × computational/inferential quadrant**, the **evolve/change-manifest** linkage, and **`mutated_state`**. This proposal offers that `harness.*` layer to the OpenTelemetry GenAI semantic-conventions community as a **`gen_ai.harness.*` sub-namespace** (with a standalone-companion-convention fallback).

## Why it's a good candidate

- The `harness.*` layer is **clean and non-conflicting**: by the HSC two-namespace rule (`attribute-registry.md`), no `harness.*` attribute lives under `gen_ai.*` and no `gen_ai.*` attribute is reinvented. So a `gen_ai.harness.*` sub-namespace slots in without colliding with any existing GenAI attribute.
- It is **complementary, not overlapping**, with the existing GenAI agentic proposal. The GenAI SIG's agentic conventions effort (Issue #35, `semantic-conventions-genai`) covers tasks, agents, teams, artifacts, and memory — it does **not** cover the convergence-principle / quadrant layer HSC contributes. The two compose.

## Current OTel GenAI status (June 2026)

- OTel GenAI semantic conventions remain in **Development** status [CITED: opentelemetry.io/blog/2026/genai-observability/]. Lucid pins a specific semconv commit (recorded in Plan 02's `transport-profile.md`) and tracks it deliberately — the **pinned-version posture** of [ADR-0001](../03-decisions/ADR-0001-otel-compatible-hsc-profile.md). A convention in Development can change; HSC's pin insulates adopters from churn while this proposal proceeds.
- The agentic conventions proposal (Issue #35) is in early proposal stage [CITED: github.com/open-telemetry/semantic-conventions-genai/issues/35].

## The proposal: `gen_ai.harness.*` (with a fallback)

**Primary:** propose the `harness.*` layer as a GenAI **sub-namespace** — `gen_ai.harness.event_type`, `gen_ai.harness.principle`, `gen_ai.harness.quadrant.x`/`.y`, `gen_ai.harness.mutated_state`, `gen_ai.harness.change_manifest_id`, `gen_ai.harness.inferred`. This keeps the convergence layer inside the GenAI family where agentic tooling already looks.

**Fallback:** if the GenAI SIG prefers it, propose the layer as a **standalone companion convention** (`harness.*` as its own semantic-convention group that references GenAI). Per the PRD §11 default: **pursue the sub-namespace first; fall back to a companion convention if the SIG prefers** — non-blocking either way (RESEARCH).

## Compatibility-shim strategy

Whatever the outcome, adopters are insulated:

- HSC **ships as a Lucid extension regardless** (the `harness.*` namespace as it exists today).
- **If OTel adopts the layer**, adapters simply **stop emitting the Lucid-namespaced attribute separately and map to the canonical OTel attribute** (e.g. `harness.principle` → `gen_ai.harness.principle`). Because the two-namespace rule already guarantees no conflict, this is a rename in the adapter's emit path, not a redesign.
- The HSC conformance suite is versioned to the HSC spec (see the [versioning policy](versioning-policy.md)); a future "HSC vN over canonical OTel attributes" is a normal version bump, not a break in the standard's meaning.

## Engagement steps (the parallel track)

1. Open a proposal **issue** in `semantic-conventions-genai` for the `harness.*` layer, framed as a `gen_ai.harness.*` sub-namespace (with the companion-convention fallback noted).
2. Engage the **OTel GenAI SIG** on GitHub and the CNCF Slack `#opentelemetry` channel [CITED: opentelemetry.io contributor process].
3. Document the HSC `harness.*` attribute registry as a **Weaver-compatible custom registry**, and offer `weaver registry live-check --registry ./hsc-registry` as an **optional, extra** validation layer on top of `lucid conformance` [CITED: opentelemetry.io/blog/2025/otel-weaver/]. This is additive validation for adapter authors who want it — never required to certify.

> **Weaver is optional upside too.** The Weaver live-check is an *extra* conformance signal, not a gate. `lucid conformance` remains the load-bearing certification path; Weaver compatibility is documented as available, and skippable.

## Explicit non-dependency statement (RESEARCH Pitfall 5)

To be unambiguous: **the OTel merge of `harness.*` is not required for any Lucid capability.** Phase 6 — the third adapter, the conformance suite, the badge, and the compliance export — ships and works with zero dependence on this proposal's outcome. If the proposal is accepted, adapters gain a canonical home for the convergence layer. If it is declined or delayed indefinitely, nothing in Lucid changes. That is the definition of upside, not a blocker.

## References

- [`attribute-registry.md`](attribute-registry.md) — the two-namespace rule that makes the layer non-conflicting.
- [`otel-mapping.md`](otel-mapping.md) — how `harness.*` maps onto OTel spans today.
- [`versioning-policy.md`](versioning-policy.md) — HSC SemVer + the compatibility-shim posture.
- [ADR-0001](../03-decisions/ADR-0001-otel-compatible-hsc-profile.md) — OTel-compatible HSC profile + pinned-version posture.
- [OTel GenAI agentic conventions Issue #35](https://github.com/open-telemetry/semantic-conventions-genai/issues/35).
- [OTel Weaver — custom registries and live-check](https://opentelemetry.io/blog/2025/otel-weaver/).
