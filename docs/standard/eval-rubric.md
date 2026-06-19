# HSC v0 — Evaluation Rubric (Specification Only)

> **Status:** Normative **definition only**. This document defines the base metrics
> and the five per-principle detectors that **Phase 2** will implement. It ships
> **no scorer** in Phase 0 — it is the input contract Phase 2 implements rather than
> invents.
>
> All detectors reference HSC v0 events and the absence rule defined in
> [`hsc-v0-spec.md`](./hsc-v0-spec.md).

---

## 1. Base metrics (framework-neutral)

Each base metric names its input event/attribute and its formula. All inputs are
HSC v0 events ([spec §2](./hsc-v0-spec.md)).

| Metric | Input event / attribute | Formula |
|---|---|---|
| **Success** | terminal turn outcome; `error` events | `1` if the turn reached its terminal goal with no unrecovered `error`, else `0` (per-turn; averaged over turns). |
| **Cost** | `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens` × model price | `Σ (input_tokens·p_in + output_tokens·p_out)` over all `chat`-backed events in the trace. |
| **Latency** | span `start_time` / `end_time` | wall-clock `end_time − start_time` of the enclosing `invoke_agent` (turn) span; reported per turn. |
| **Tokens** | `gen_ai.usage.input_tokens` + `gen_ai.usage.output_tokens` | `Σ (input_tokens + output_tokens)` over the trace. |
| **Tool-error rate** | `tool.call` events; `error` events attributable to a tool | `count(tool.call followed by an attributable error) / count(tool.call)`. |

---

## 2. Per-principle detectors

Each detector states **inputs**, **predicate**, and **score formula**. Scores are in
`[0, 1]`; higher is better.

### 2.1 Context

- **Inputs:** `context.load` events; `gen_ai.usage.input_tokens`.
- **Predicate:** context is loaded before action and is neither starved nor bloated.
- **Score:** `1 − normalized_deviation(input_tokens, target_band)` — fraction of turns
  whose loaded context falls within a healthy token band (deviation from band,
  clamped to `[0,1]`).

### 2.2 Plan + Execute

- **Inputs:** `plan.emit`, `tool.call` events (ordering within a turn).
- **Predicate:** intent is separated from action — a `plan.emit` precedes the
  turn's `tool.call`s.
- **Score:** `fraction of turns containing ≥1 tool.call that have a preceding
  plan.emit in the same turn`.

### 2.3 Feedback (the highest-leverage detector)

- **Inputs:** `tool.call` events with `harness.mutated_state = true`;
  `verify.result` events.
- **Predicate:** every state-mutating action is followed by a verification.
- **Score formula (canonical):**

  > **Feedback = fraction of `tool.call` events with `harness.mutated_state = true`
  > that are followed by a `verify.result` in the same turn.**

  ```
  Feedback = | { c ∈ tool.call : c.harness.mutated_state = true
                 ∧ ∃ v ∈ verify.result, same turn, v after c } |
             ─────────────────────────────────────────────────────────
             | { c ∈ tool.call : c.harness.mutated_state = true } |
  ```

- **Absence is signal ([spec §4](./hsc-v0-spec.md)):** a mutating `tool.call` with no
  following `verify.result` is a **valid** trace and lowers this score — it is the
  empty-feedback-quadrant finding, **not** a defect to be patched by synthesizing a
  `verify.result`. Scorers **MUST NOT** count fabricated or inferred verifications
  toward this metric (see §3).

### 2.4 One Thing at a Time

- **Inputs:** `task.slice` events; `tool.call` count per slice.
- **Predicate:** work is decomposed into vertical slices rather than big-bang changes.
- **Score:** `fraction of turns whose actions are scoped under a task.slice` (turns
  with many mutating `tool.call`s and no `task.slice` score low).

### 2.5 Codebase = Docs

- **Inputs:** `doc.encode` events.
- **Predicate:** tacit knowledge produced during a run is encoded into a durable
  artifact.
- **Score:** `fraction of knowledge-producing turns that emit ≥1 doc.encode`
  (a turn that discovers reusable knowledge but emits no `doc.encode` scores low).

---

## 3. Inferred-event handling (mandatory)

Every detector above **MUST** check `harness.inferred` ([spec §5](./hsc-v0-spec.md)).
Scorers **MUST** either weight inferred events lower or count them separately from
directly-observed events, and **MUST NOT** treat an inferred `plan.emit` /
`context.load` as equivalent to a directly-observed one. Per spec §5.2, `verify.result`
and `feedback.check` are never inferred, so the Feedback detector (§2.3) only ever
counts genuine, directly-observed verifications.

---

## 4. Phase boundary

This rubric is **Phase 2 implementation input**, not a Phase 0 scorer. Phase 0 ships
the definitions; Phase 2 implements the metrics and the 2×2 diagnostic against them.
Plan 00-04's adapter mapping and the Phase 2 scorer **MUST** reference the Feedback
detector formula in §2.3 verbatim so all consumers share one definition.
