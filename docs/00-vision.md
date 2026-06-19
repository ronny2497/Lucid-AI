# 00 — Vision

## The problem

Teams building with LLMs keep asking the wrong question. They ask **"did the agent work?"** — a question about a single output. The right question is **"what did the harness observe, and what did it do about what it observed?"** — a question about the *engineered scaffold* around the model: how it loaded context, whether it planned before acting, whether it verified after acting, whether it learned anything.

That scaffold — the **harness** — is where almost all of the reliability of an agentic system actually lives. The model is a swappable component. The harness is the engineering. Yet the harness is the part nobody can *see*:

- Observability tools (LangSmith, Langfuse, raw OpenTelemetry) show you **LLM calls and chains** — tokens, latency, the prompt/completion. They do not show you whether the *harness* did its job, because they have no model of what a harness's job *is*.
- Eval tools score **task outcomes**. They tell you the success rate dropped; they don't tell you that it dropped because the harness stopped verifying state-mutating actions.
- Self-improvement research (AHE, NexAU, auto-research) shows harnesses *can* evolve themselves — but as bespoke research artifacts, not as a framework-neutral, observable, governable system anyone can adopt.

So there is a gap: **no plane that makes the harness itself legible, scores it against a discipline, and closes the loop by improving it.**

## The thesis

There is now a recognizable **discipline** of harness engineering. Independently, OpenAI (Codex), Anthropic, Thoughtworks, and others converged on the same five principles:

1. **Context** — load the right tokens at the right time.
2. **Plan + Execute** — separate intent from action; one thing per step.
3. **Feedback** — verify after execution. (The most-skipped, highest-leverage principle.)
4. **One Thing at a Time** — vertical slices, incremental commits, no big-bang work.
5. **Codebase = Docs** — encode tacit knowledge into durable in-repo artifacts.

If these five are the discipline, then a harness can be **measured against them**. Lucid is the instrument that does the measuring — and then acts on the measurement.

> **Stop asking whether the agent worked. Ask what the harness observed.**

## What Lucid is

A **base layer**, in three parts:

1. **A standard** — the *Harness Semantic Conventions (HSC)*: an open, OpenTelemetry-compatible vocabulary for the events a harness emits (context-load, plan, tool-call, feedback-check, verify-result, evolve, …), each tagged with the principle and 2×2 quadrant it belongs to.
2. **An observability + evaluation plane** — ingests HSC traces from *any* harness and scores them on two layers: standard agent metrics, and the principle/2×2 diagnostic.
3. **A self-evolution engine** — diagnoses the gaps and, at a configurable autonomy level, recommends or applies harness improvements, up to weight-level training.

## What Lucid is *not*

- **Not an application.** A sales assistant, a coding agent, an internal copilot — those are the *top layer*, built on a harness. Lucid sits *under* them, observing and improving the harness. Lucid bakes in nothing application-specific.
- **Not a chain/agent-building SDK.** You don't build your agent *in* Lucid (though you can instrument one you built anywhere). Lucid is the observability + evolution plane, not the construction kit. It is complementary to LangGraph, Mastra, hand-rolled loops, etc.
- **Not model-specific.** Any model, any provider. The harness is the unit; the model is swappable.

## Who it's for

- **Agent/harness builders** who need to know *why* their system is unreliable, in terms they can act on.
- **Platform/infra teams** standardizing how many agents are observed across an org.
- **Researchers** working on self-improving systems who want a framework-neutral substrate.
- **Compliance-facing teams** who need the audit artifacts (change manifests, decision trails) that regulation increasingly requires.

## Differentiation

| System | Unit of analysis | Discipline-native rubric? | Self-evolution? | Open standard? |
|---|---|---|---|---|
| LangSmith / Langfuse | LLM calls, chains | No | No | No |
| Raw OpenTelemetry + GenAI conventions | Spans, generic LLM attrs | No | No | Partial (generic) |
| DSPy | Prompt/program optimization | No (optimizes programs) | Program-level only | No |
| AHE / NexAU (research) | A specific harness | Yes (bespoke) | Yes (bespoke) | No |
| **Lucid** | **The harness** | **Yes (5 principles + 2×2)** | **Yes (configurable ladder)** | **Yes (HSC, OTel-compatible)** |

**The wedge:** Lucid is the only plane that is simultaneously (a) an open harness-level standard, (b) a principle-based diagnostic, and (c) a configurable self-improvement engine.

## Strategic posture

- **OSS, category-defining.** The standard + SDK + adapters are Apache-2.0. Adoption of the *standard* is the moat; a managed self-evolution service is a possible later commercial tier (open-core), never the protocol.
- **Standard-first.** HSC is designed to be upstreamable into OpenTelemetry. Becoming "the way harnesses are observed" beats owning a silo.
- **Governable by design.** Every evolution action is logged, attributable, reversible. The autonomy ladder defaults to human-in-the-loop. This is both an ethics requirement and a feature for regulated adopters.

## The one-sentence test

If a reader leaves with only one sentence, it should be:
*Lucid makes any agent harness legible against the five convergence principles, then closes the loop by improving it — at whatever level of autonomy you choose.*
