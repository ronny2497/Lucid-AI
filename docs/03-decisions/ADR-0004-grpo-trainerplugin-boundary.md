# ADR-0004 — Weight-level training via a swappable Python `TrainerPlugin`

- **Status:** Accepted
- **Date:** 2026-06-18
- **Deciders:** Rishabh

## Context
The L2 tier of the autonomy ladder is weight-level self-evolution via GRPO (Group Relative Policy Optimization). The GRPO ecosystem — Hugging Face TRL `GRPOTrainer`, vLLM rollouts, PEFT/LoRA, PyTorch/CUDA — is entirely Python. There is no production-grade LLM RL-training stack in JS/TS. The framework's primary language is TypeScript (ADR-0002).

## Options considered
1. **Reimplement GRPO in TypeScript.**
   - Pros: single language.
   - Cons: infeasible — LLM RL training needs PyTorch/CUDA, distributed training, mixed precision; JS ML (TF.js, transformers.js, ONNX) is inference-oriented; would discard the entire mature ecosystem. Multi-year effort.
2. **Tightly couple a Python trainer into the core.**
   - Pros: direct.
   - Cons: forces Python as a core dependency on *all* users, even the majority who never touch L2.
3. **Swappable `TrainerPlugin` boundary; Python GRPO as the reference impl.**
   - Pros: core stays pure-TS; training is an offline, batch, async job (a coarse, easy boundary); reward logic stays in TS; other trainers (Unsloth, hosted RFT APIs) can plug in.
   - Cons: a defined cross-language interface to design and maintain.

## Decision
Define a **`TrainerPlugin`** interface: input `{dataset + scalar rewards + base model ref}`, output `{model artifact + result manifest}`. The reference implementation is a **Python GRPO sidecar** (TRL + vLLM), invoked over the OTLP/dataset boundary (job API/queue + filesystem or container). The framework **never hard-depends on Python**; L0/L1 are pure TypeScript.

## Rationale
GRPO training is offline, batch, and infrequent — the cleanest possible boundary. Keeping "what is good" (reward = principle/2×2 scoring) in TS preserves the framework's core IP in its primary language; Python does only gradient math. Making it a plugin keeps the common install pure-TS and lets the trainer be swapped.

## Consequences
- L2 ships as a separate optional package/sidecar/container; core `npm install` unaffected.
- The `TrainerPlugin` contract and dataset/reward format must be specified in Phase 5.
- Rewards are computed in TS and passed as scalars; Python never decides quality.

## Developer impact
The large majority of developers (L0/L1) never install Python. Only teams self-hosting weights opt into L2; they run the sidecar but still drive it from TS/CLI. Alternative trainers can be plugged in without touching the framework.
