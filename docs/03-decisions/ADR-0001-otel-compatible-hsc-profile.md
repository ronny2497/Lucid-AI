# ADR-0001 — OpenTelemetry-compatible Harness Semantic Conventions profile

- **Status:** Accepted
- **Date:** 2026-06-18
- **Deciders:** Rishabh

## Context
Lucid needs its own vocabulary for harness events (`context.load`, `plan.emit`, `feedback.check`, `verify.result`, `evolve.*`) plus `(principle, quadrant)` tags. We must decide *how* to express and transport this: ride OpenTelemetry, or define a clean custom standard + collector.

OpenTelemetry (OTel) is the vendor-neutral telemetry standard; its GenAI semantic conventions (client/agent spans, events, metrics) exist but are still in **Development** status (experimental) as of mid-2026, with broad upstream backing (AWS, Google, IBM, Microsoft, Traceloop, etc.).

## Options considered
1. **Extend OTel** — emit OTel spans/events; layer a namespaced `harness.*` attribute set on top of `gen_ai.*`.
   - Pros: ride the entire ecosystem (collectors, storage, SDKs, OTLP transport); near-zero adoption friction for OTel users; credible path to *upstream* harness conventions into OTel → legitimacy as the standard; OTel already models *absence* (a missing child span is observable).
   - Cons: constrained by OTel's span model and its experimental churn; principle/quadrant live as non-standard attributes until/unless upstreamed.
2. **Clean custom profile** — own event schema, wire format, and collector.
   - Pros: pristine principle-native model; no impedance mismatch.
   - Cons: adopters must run a new pipeline just for us (friction for an OSS land-grab); we build/maintain transport, storage, sampling, SDKs; competing with OTel instead of extending it.

## Decision
Define an **OpenTelemetry-compatible "Harness Semantic Conventions" (HSC) profile**: emit OTel spans/events over OTLP, reuse all transport/storage, map the agentic core to existing OTel GenAI conventions, and own a clean namespaced `harness.*` extension for the parts OTel lacks (principles, 2×2 quadrant, evolve events, change_manifest). Pin to a specific OTel GenAI convention version; plan to upstream the harness layer later.

## Rationale
For an OSS, category-defining standard, *adoption of the standard is the moat*. Riding OTel maximizes reach, reuses a huge ecosystem, and gives the strongest "we are the standard" path (upstreaming). The only real cost — OTel GenAI is experimental — is mitigated by version pinning.

## Consequences
- We must track OTel GenAI convention changes and pin versions.
- HSC spec must clearly delineate "OTel-standard part" vs. "`harness.*` extension."
- Any OTel-compatible backend can store Lucid traces; we are not forced to ship storage early.

## Developer impact
A developer already running OpenTelemetry gets Lucid almost for free — point the existing exporter at the collector. No new transport to learn. Custom adapters emit OTel spans with `harness.*` attributes, validated by the conformance suite.
