# Harness Semantic Conventions (HSC) v0 — Formal Specification

> **Status:** Normative. This document formalizes the conceptual
> [`hsc-overview.md`](./hsc-overview.md) into the contract every downstream phase
> implements. HSC is an **OpenTelemetry-compatible profile**, not a custom wire
> format (see [ADR-0001](../03-decisions/ADR-0001-otel-compatible-hsc-profile.md)).
>
> **Version:** `v0`. The reused OTel GenAI attribute set is pinned to a specific
> `semantic-conventions-genai` commit recorded in
> [`transport-profile.md`](./transport-profile.md).

The keywords **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and
**MAY** are to be interpreted as described in RFC 2119.

---

## 0. Scope and structure

HSC v0 splits cleanly into two namespaces (D-01, D-02):

- The **OTel-standard part** — the agentic core (LLM calls, tool execution, agent
  invocations) reuses existing OpenTelemetry GenAI `gen_ai.*` attributes verbatim.
  HSC does **not** invent new `gen_ai.*` values. See
  [`otel-mapping.md`](./otel-mapping.md).
- The **HSC extension** — a clean, namespaced `harness.*` attribute set carrying
  the concepts OTel lacks: convergence principle, 2×2 quadrant, harness version,
  state-mutation, change-manifest links, and the honest-absence inference flag. See
  [`attribute-registry.md`](./attribute-registry.md).

An adapter author who reads this document, the attribute registry, and the OTel
mapping can determine — for **any** moment in a harness — exactly which HSC event
to emit and its principle + quadrant, without any access to Lucid internals.

The canonical machine-readable values (event-type strings, principle strings,
quadrant enums, the quadrant predicate) live in the `@lucid/hsc-schema` package.
The prose in this document **MUST** match that executable source; the package is
the single source of truth (see §3.4).

---

## 1. The Harness Trace data model

A `HarnessTrace` is a stream of typed, principle-tagged events for one harness turn
or session (see [01-concepts.md §4](../01-concepts.md)):

```
HarnessTrace
└── Turn[]
    └── Event
        ├── harness.event_type   (the 10 types below)
        ├── harness.principle    (one of 5 convergence principles)
        ├── harness.quadrant.{x,y}
        ├── attrs                (gen_ai.* reused + harness.* extension)
        └── refs                 (parent span, harness.version, agent id)
```

On the wire each `Event` is an OpenTelemetry span (or, for `error`, a span event).
The on-disk serialization is the OTLP/JSON `resourceSpans > scopeSpans > spans`
envelope — see [`transport-profile.md`](./transport-profile.md).

---

## 2. Event taxonomy (D-04)

HSC v0 defines exactly **ten** event types. Every HSC span **MUST** carry a
`harness.event_type` whose value is one of these strings, and a non-null
`harness.principle`.

| `harness.event_type` | Semantics (one line) | Principle |
|---|---|---|
| `context.load`   | Tokens/artifacts assembled into the model's context. | `context` |
| `plan.emit`      | A plan/intent produced before action. | `plan_execute` |
| `task.slice`     | A unit of work scoped as a vertical slice. | `one_at_a_time` |
| `tool.call`      | A tool/action invoked; carries `harness.mutated_state?`. | `plan_execute` |
| `feedback.check` | A verification step initiated. | `feedback` |
| `verify.result`  | The outcome of a verification. | `feedback` |
| `doc.encode`     | Tacit knowledge written to a durable artifact. | `codebase_docs` |
| `evolve.propose` | A `change_manifest` proposed. | `feedback` |
| `evolve.apply`   | A `change_manifest` applied. | `feedback` |
| `error`          | A failure/exception. | (cross-cutting; see §3.3) |

The five convergence principles (`context`, `plan_execute`, `feedback`,
`one_at_a_time`, `codebase_docs`) are defined in
[01-concepts.md §2](../01-concepts.md). `evolve.propose` / `evolve.apply` are meta
events tagged with the `feedback` principle because evolution is feedback-driven
harness improvement.

---

## 3. Principle / quadrant tagging rules

### 3.1 The 2×2

Two axes (Thoughtworks framing, [01-concepts.md §3](../01-concepts.md)):

- **x-axis — feedforward ↔ feedback.** Control *before* action (planning,
  context-shaping) vs. control *after* action (verification, evaluation).
- **y-axis — computational ↔ inferential.** Deterministic mechanism (schema check,
  CI gate, diff) vs. model-judged mechanism (LLM evaluator, reflection).

`harness.quadrant.x ∈ {feedforward, feedback, null}` and
`harness.quadrant.y ∈ {computational, inferential, null}`. `null` means "untagged":
the event is intentionally not placed on that axis.

### 3.2 The machine-checkable quadrant predicate (OQ-02)

For 9 of the 10 event types both `quadrant.x` and `quadrant.y` are
**deterministically derived from `harness.event_type` at emit time** — no model
inference is involved. The following table **IS** the predicate. It is reproduced
verbatim from the `@lucid/hsc-schema` `QUADRANT_TABLE` (the single source of truth;
see §3.4).

| `harness.event_type` | `quadrant.x` | `quadrant.y` | Notes |
|---|---|---|---|
| `context.load`   | `feedforward` | `computational` | Context assembly is deterministic. |
| `plan.emit`      | `feedforward` | `inferential`   | LLM-produced plan. |
| `task.slice`     | `feedforward` | `computational` | Structural scoping. |
| `tool.call`      | `null` (—)    | `null` (—)      | The action itself; its presence/absence in each column is what we measure. |
| `feedback.check` | `feedback`    | **emitter-specified** | y is `null` until the emitter sets it (see §3.2.1). |
| `verify.result`  | `feedback`    | `computational` | Default; an emitter MAY override to `inferential` if LLM-judged. |
| `doc.encode`     | `feedforward` | `computational` | File write. |
| `evolve.propose` | `feedback`    | `inferential`   | LLM-proposed change. |
| `evolve.apply`   | `feedback`    | `computational` | Deterministic diff application. |
| `error`          | `null` (—)    | `null` (—)      | Cross-cutting; no quadrant. |

#### 3.2.1 The one emitter-specified case: `feedback.check`

`feedback.check` is the single event whose `quadrant.y` is **not** auto-derivable: a
feedback check can be either *computational* (a programmatic check — schema/CI/diff)
or *inferential* (an LLM evaluator or reflection step). The emitter therefore
**MUST** set `harness.quadrant.y` explicitly on every `feedback.check` event. Its
`quadrant.x` is always `feedback`. In `@lucid/hsc-schema`, `feedback.check` is the
sole member of `EMITTER_SPECIFIED_Y`, and `quadrantFor("feedback.check")` returns
`y = null` precisely so consumers know the value must come from the emitter rather
than from the table.

Consumers **MUST** consult `EMITTER_SPECIFIED_Y` to distinguish an intentionally
untagged action (`tool.call`, `error`, whose `y` is `null` by design) from a
`feedback.check` whose `y` is `null` only because the emitter has not yet supplied
it.

### 3.3 `error` and the cross-cutting events

`error` carries no quadrant (both axes `null`) and no convergence principle of its
own (it is cross-cutting). An `error` is emitted as a span event, not by setting an
OTel span status — see [`otel-mapping.md`](./otel-mapping.md) and the
anti-patterns there. The OTel span status field describes the OTel span; the HSC
`error` event is a typed harness event.

### 3.4 Single source of truth (no prose drift)

The quadrant values in §3.2 **MUST** be byte-for-byte consistent with the values
returned by `quadrantFor()` in `@lucid/hsc-schema` for all ten event types. The
executable mapping is authoritative; this prose table must not drift from it. This
invariant is cross-checked at the Plan 00-04 checkpoint.

---

## 4. Absence is signal (D-05)

HSC **never fabricates a missing event.** If a harness has no explicit feedback
step, the adapter emits **nothing** for `feedback.check` / `verify.result` — and
that absence is the diagnostic, not a defect in the trace.

**Normative absence rule.** A `tool.call` with `harness.mutated_state = true` that
has **no following `verify.result`** (and no `feedback.check`) in the same turn is a
**VALID** HSC trace. It is the seed of the *empty-feedback-quadrant* finding: the
state was mutated but never verified. A conformance validator **MUST NOT** reject
such a trace, and a producer **MUST NOT** synthesize a `verify.result` to "fill in"
the gap.

Concretely:

- A mutating `tool.call` followed by nothing is honest and complete.
- It is statistically improbable for a real harness that *every*
  `tool.call{mutated_state:true}` is followed by a `verify.result`; a trace
  exhibiting that pattern is a warning sign of fabrication (see §5 prohibitions).

---

## 5. The `harness.inferred` policy (OQ-03)

The optional inference layer marks events the adapter *reconstructed* from indirect
signals when the harness exposes no explicit lifecycle hook. Inferred events are
lower-confidence reconstructions, **not** fabrications, and are always flagged.

**Default: off.** Adapters emit `harness.inferred` only when they cannot directly
observe the event and a permitted indirect signal exists.

### 5.1 Permitted inference (narrow, bounded)

| Inferred event | From signal | Confidence |
|---|---|---|
| `plan.emit` | A reasoning-scratchpad with step-structured content. | MEDIUM |
| `context.load` (token count only) | API usage (e.g. prompt-token count) when no explicit context-assembly hook fires. | MEDIUM |

When emitted under inference, these events **MUST** carry `harness.inferred = true`.

### 5.2 Prohibited inference

Adapters **MUST NOT** infer any of the following — their absence is signal (§4):

- `verify.result` — a successful tool return is **not** verification.
- `feedback.check` — never inferred without an actual model call or rule check.
- `evolve.propose`, `evolve.apply` — `evolve.*` events are **never** inferred.

### 5.3 Downstream obligation

Any scoring or diagnostic layer that consumes HSC **MUST** check
`harness.inferred` and either weight inferred events lower or count them separately
from directly-observed events. See [`eval-rubric.md`](./eval-rubric.md).

---

## 6. Conformance summary

An HSC v0 trace is conformant when:

1. Every event span carries a `harness.event_type` from the §2 set and a non-null
   `harness.principle`.
2. `harness.quadrant.{x,y}` match the §3.2 predicate, except `feedback.check.y`
   which is emitter-specified and `verify.result.y` which MAY be overridden to
   `inferential`.
3. Reused OTel attributes use only OTel-defined `gen_ai.*` names at the pinned
   commit; `harness.*` never appears under the `gen_ai.*` namespace.
4. No event is fabricated to fill an absence (§4); inferred events follow §5 and are
   flagged with `harness.inferred = true`.
