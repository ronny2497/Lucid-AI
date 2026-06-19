# ADR-0002 — TypeScript as the primary language

- **Status:** Accepted
- **Date:** 2026-06-18
- **Deciders:** Rishabh

## Context
We must choose the primary language for the SDK, collector glue, eval engine, diagnostic, evolution orchestration, and UI/CLI. The two candidates are TypeScript and Python. Weight-level training (GRPO) is unavoidably Python (see ADR-0004), but that is an isolated, offline, optional concern.

## Options considered
1. **TypeScript primary.**
   - Pros: matches the dominant agent/harness ecosystem (most agent frameworks people instrument are JS/TS); the reference harness (hermes-agent) is TS, making the first adapter trivial; mature OTel JS SDK; one language for SDK + eval + UI; the high-frequency surface (adapters) is friction-free.
   - Cons: not the language of ML training — needs a boundary to Python for L2.
2. **Python primary.**
   - Pros: home turf for ML/eval tooling and GRPO; mature OTel Python SDK.
   - Cons: cross-language bridge to instrument the (mostly TS) harnesses people build; the high-frequency adapter surface becomes the awkward boundary.

## Decision
**TypeScript** is the primary language for everything in Phases 0–4 and the L2 *orchestration + reward logic*. **Python** is used only as an optional trainer sidecar for L2 weight-level training, isolated behind the `TrainerPlugin` boundary and the language-agnostic OTLP/dataset format.

## Rationale
The whole point is instrumenting harnesses; the harnesses in scope (and most of the JS-dominated agent ecosystem) are TS, so the high-frequency surface must be frictionless in TS. ML training is a low-frequency, offline, isolatable job — the one place Python wins is also the one place a clean process boundary is natural.

## Consequences
- Core `npm install` stays pure-TS; no Python required unless a developer opts into L2.
- A documented TS↔Python boundary (`TrainerPlugin`) must exist before Phase 5.
- Reward computation ("what is good") stays in TS; Python only does gradient math.

## Developer impact
TS developers instrument with a native SDK and never touch Python. Only teams that self-host weights and opt into L2 run the Python sidecar — and even then they interact with it through TS/CLI, not by writing Python.
