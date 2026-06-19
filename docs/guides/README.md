# Developer Guides

Structured, consumable documentation for developers using Lucid. These are written from the **developer's point of view**: what you do, in what order, and how seamless it should feel.

> **Status:** Lucid is pre-implementation. These guides describe the **intended developer experience** and use **illustrative** commands/code/config (marked as such). They double as the DX spec the product must satisfy.

## Start here

1. **[Getting Started](getting-started.md)** — from zero to your first diagnosed run, step by step.
2. **[Instrumenting Your Harness](instrumenting-your-harness.md)** — the three ways to emit HSC (adapter / SDK / raw OTel) and when to use each.
3. **[Reading Diagnostics](reading-diagnostics.md)** — how to interpret the scorecard, the 2×2, and findings, and turn them into action.
4. **[Configuring Self-Evolution](configuring-self-evolution.md)** — the autonomy ladder (L0/L1/L2), gates, rollback, and the `TrainerPlugin`.
5. **[Authoring & Certifying an Adapter](adapter-authoring.md)** — the unaided onramp: scaffold → map your framework's lifecycle to HSC → run the conformance suite → fix → emit a badge, all on the public SDK surface.
6. **[The Conformance Report & Badge](conformance-badge.md)** — the machine-readable report, the self-declared (re-verifiable) badge, and the MUST-vs-SHOULD tiers (validity/honesty block the badge; coverage warns).
7. **[Compliance Export](compliance-export.md)** — assemble an EU AI Act / Colorado SB 26-189 evidence package from your audit trail. **Evidence assembly, not legal certification.**

## Adapter gallery

Three adapters ship as worked examples: **hermes** (the reference, full lifecycle), **`@lucid/adapter-langgraph`** (a neutral OTel-span adapter), and **`@lucid/adapter-openai-agents`** (the third community adapter, authored entirely on the public SDK surface — the EC-1 proof that a third party can author and certify unaided). To add your framework, follow [Authoring & Certifying an Adapter](adapter-authoring.md).

## The DX promise (the bar every feature is held to)

- **Supported framework:** install adapter → first trace in **minutes**, zero rewrites.
- **Unsupported framework:** wrap your loop, emit events **incrementally** — partial instrumentation still yields partial value.
- **Never** "rewrite your agent to use us." Lucid observes the harness you already have.
- Every capability is reachable from **both** a CLI and a typed SDK.
