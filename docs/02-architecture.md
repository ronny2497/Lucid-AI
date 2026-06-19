# 02 — Architecture

This describes the system: the six pillars, how they fit, the data flow, and — for each pillar — **how a developer actually touches it**. All code/CLI/config is **illustrative proposed design**, not implemented.

---

## System at a glance

```
   YOUR HARNESS (any framework)                      LUCID (the base layer)
   ─────────────────────────────                     ──────────────────────────────────────
                                   HSC events
   ┌───────────────┐   adapter /   (OTLP)      ┌──────────────┐   ┌───────────────────────┐
   │ agent loop,   │──── SDK ──────────────────▶│ P2 Ingestion │──▶│ P2 Trace Store        │
   │ tools, memory │                            │  + Collector │   │ (traces + timeseries) │
   └───────────────┘                            └──────────────┘   └───────────┬───────────┘
        ▲                                                                       │
        │ change_manifest (proposal / apply)                                    ▼
        │                                                          ┌────────────────────────┐
   ┌────┴───────────────┐    diagnosis + rewards                   │ P3 Eval                │
   │ P5 Self-Evolution  │◀─────────────────────────────────────────│  • base metrics        │
   │  Engine (L0/L1/L2) │                                          │ P4 Diagnostic          │
   └────────────────────┘                                          │  • principles + 2×2    │
        │ L2 only                                                  └───────────┬────────────┘
        ▼                                                                       │
   ┌────────────────────┐                                          ┌───────────▼────────────┐
   │ TrainerPlugin       │                                          │ Diagnostic Surface / UI │
   │ (Python GRPO, opt.) │                                          │ (dashboards, 2×2, diffs)│
   └────────────────────┘                                          └─────────────────────────┘

   Cross-cutting: P1 the HSC standard · P6 governance/conformance/security
```

---

## The six pillars

### P1 — Harness Semantic Conventions (the standard)
The open, OTel-compatible vocabulary (event types, `harness.*` attributes, principle/quadrant tagging). This is the contract everything else depends on, and the moat.

**Developer touchpoint:** mostly invisible — the developer consumes HSC *through* adapters/SDK. Advanced users read the spec to write a custom adapter or extend attributes.

### P2 — Ingestion + Trace Store
An OTLP-compatible collector receives HSC events; a store keeps traces + time-series. Because it's OTel-compatible, existing collectors/backends work.

**Developer touchpoint — the install:**
```bash
# ILLUSTRATIVE
npx @lucid/cli init           # writes lucid.config.yaml, points at a collector
docker run lucid/collector    # or bring your own OTel collector
```
Then point your harness's exporter at it. First traces should appear in minutes.

### P3 — Eval: base metrics
Framework-neutral metrics: success, cost, latency, tokens, tool-error rate. Computed from the trace.

**Developer touchpoint:** zero extra work beyond emitting events — metrics are derived. Viewable in the UI and via API/CLI:
```bash
# ILLUSTRATIVE
lucid metrics --agent my-agent --since 24h
```

### P4 — Eval: principle/2×2 diagnostic (the differentiator)
Rule-based detectors + LLM-judge score each principle and place events on the 2×2. Produces named findings and a per-run/per-cohort scorecard, plus version diffing.

**Developer touchpoint — the payoff:**
```bash
# ILLUSTRATIVE
lucid diagnose --agent my-agent
# → Context        0.81
#   Plan+Execute   0.74
#   Feedback       0.18   ⚠ 38% of state-mutating tool calls had no verify.result
#   One-at-a-time  0.66
#   Codebase=Docs  0.90
#   2×2: feedback column empty. Top fix: add verification after db.write.
```

### P5 — Self-Evolution Engine (the autonomy ladder)
Turns diagnoses into typed change-sets (`change_manifest`) and, at the configured level, recommends (L0) / auto-applies with rollback (L1) / trains (L2).

**Developer touchpoint:**
```bash
# ILLUSTRATIVE
lucid evolve propose --agent my-agent        # L0: get a reviewable change_manifest
lucid evolve apply --manifest cm-123 --gate  # L1: apply behind a gate, auto-rollback on regression
```

### P6 — Governance, Conformance & Security
HSC conformance test suite (so third-party adapters can certify); audit/decision trails for every evolve action; secret redaction in traces (traces carry prompts/tool args); compliance export.

**Developer touchpoint:** redaction is on by default; audit trail is automatic; `lucid conformance` validates a custom adapter against HSC.

---

## The data model (recap, see Concepts §4)

The **Harness Trace** is the spine: `Turn[] → Event{type, principle, quadrant, attrs, refs}`. The diagnostic reads it; the evolution engine reads diagnoses; rewards for L2 are computed from it. **Absence of an event is a first-class signal.**

---

## How the pieces communicate

- **Harness → Lucid:** HSC over OTLP (HTTP/gRPC). Language-agnostic; that's why a TS framework and a Python trainer coexist without coupling.
- **Eval → Evolution:** structured diagnoses (JSON) → change-sets.
- **Evolution → Harness:** a `change_manifest` (L0 advisory; L1 applied to config/prompts/skills/context-policy; L2 produces a model artifact).
- **Evolution → Trainer (L2 only):** the **`TrainerPlugin`** interface — `{dataset + scalar rewards + base model ref} → {model artifact + result manifest}`. Reference impl is Python GRPO; swappable. The framework never hard-depends on Python (see [ADR-0004](03-decisions/ADR-0004-grpo-trainerplugin-boundary.md)).

---

## Language & deployment boundaries

- **TypeScript:** SDK, collector glue, eval, diagnostic, evolution orchestration, reward computation, UI/CLI. (See [ADR-0002](03-decisions/ADR-0002-typescript-primary-language.md).)
- **Python:** *optional* trainer sidecar for L2 only, behind `TrainerPlugin`, over the OTLP/dataset boundary.
- **Reward logic stays in TS** — "what is good" is the framework's core competency (principle/2×2 scoring); Python only does gradient math.

---

## Design principles for the framework itself

The framework should *practice the discipline it measures*:

1. **Legibility first** — every Lucid internal action is itself an observable, auditable event.
2. **Absence over guessing** — never fabricate a missing signal.
3. **Pure-TS core** — Python (and any heavy dep) is optional and isolated behind a plugin boundary.
4. **Standard over silo** — HSC is upstreamable to OpenTelemetry; don't invent transport.
5. **Build to delete** — as models improve, parts of a harness should be *removed*; Lucid must be able to recommend deletion, not only addition.
6. **Seamless developer onramp** — supported framework: install adapter → first trace in minutes. Unsupported: wrap loop, emit events incrementally. Never "rewrite your agent to use us."

---

## Where hermes-agent fits

hermes-agent is used **only as a reference harness to instrument and test against** — a real, large, multi-feature harness that exercises every event type. Nothing hermes-specific is baked into Lucid. It is the first adapter target because it stresses the standard, not because the framework depends on it.
