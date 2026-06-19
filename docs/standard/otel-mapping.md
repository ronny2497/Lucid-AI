# HSC v0 → OpenTelemetry GenAI Mapping

> **Status:** Normative. Defines how each HSC event projects onto an OpenTelemetry
> span and which existing `gen_ai.*` attributes it reuses (D-01, D-02,
> [ADR-0001](../03-decisions/ADR-0001-otel-compatible-hsc-profile.md)).
>
> The reused `gen_ai.*` names are sourced from the `semantic-conventions-genai`
> spec **at the exact commit pinned in** [`transport-profile.md`](./transport-profile.md).
> Those are the same attributes enumerated here.

**Two-namespace rule.** The agentic core maps onto OTel GenAI spans using only
OTel-defined `gen_ai.*` attributes and only OTel-defined `gen_ai.operation.name`
values. The HSC extension (`harness.*`) **MUST** stay out of the `gen_ai.*`
namespace; it is carried as additional, namespaced span attributes alongside the
reused OTel ones. HSC does **not** invent new `gen_ai.*` values.

---

## OTel span operations used

HSC v0 reuses exactly these OTel `gen_ai.operation.name` values:

- `execute_tool` — tool execution (semconv v1.41 naming).
- `invoke_agent` — agent invocation, emitted as span kind **INTERNAL** (same-process
  agent; semconv v1.39 CLIENT/INTERNAL split).
- `chat` — an LLM request within a turn.

No other `gen_ai.operation.name` value is emitted. In particular, HSC-specific
typing such as `context.load` is carried in `harness.event_type`, never in
`gen_ai.operation.name`.

---

## Per-event projection table

| HSC event (`harness.event_type`) | OTel span operation | Reused `gen_ai.*` attributes |
|---|---|---|
| `context.load`   | `chat` (LLM-call component) | `gen_ai.request.model`, `gen_ai.usage.input_tokens` |
| `plan.emit`      | `chat` (planner LLM call) | `gen_ai.request.model`, `gen_ai.response.finish_reasons` |
| `task.slice`     | — (no OTel GenAI span; `harness.*` only) | none — purely an HSC extension event |
| `tool.call`      | `execute_tool` | `gen_ai.tool.name`, `gen_ai.operation.name = "execute_tool"` |
| `feedback.check` | `chat` if inferential / — if computational | `gen_ai.request.model` (only when LLM-judged) |
| `verify.result`  | — (deterministic verifier; `harness.*` only) | none by default |
| `doc.encode`     | — (file write; `harness.*` only) | none |
| `evolve.propose` | `chat` (LLM proposes change) | `gen_ai.request.model`, `gen_ai.response.finish_reasons` |
| `evolve.apply`   | — (deterministic diff application) | none |
| `error`          | span event `error` on the enclosing span | none — see anti-patterns below |

The turn-level agent invocation that encloses a turn's events is an `invoke_agent`
(INTERNAL) span reusing `gen_ai.agent.name`, `gen_ai.agent.id`, and
`gen_ai.provider.name`.

### Reused `gen_ai.*` attribute set (OQ-01)

`gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.agent.name`,
`gen_ai.agent.id`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`,
`gen_ai.usage.output_tokens`, `gen_ai.tool.name`, `gen_ai.response.finish_reasons`.

This is the exact set pinned at the recorded commit in
[`transport-profile.md`](./transport-profile.md).

---

## Anti-patterns (MUST NOT)

- **Do not** use OTel span status `ERROR` as the HSC `error` event. They are
  different concepts: span status describes the OTel span; the HSC `error` is a
  typed harness event emitted as a span event
  (`span.add_event("error", { "harness.event_type": "error", ... })`) or a dedicated
  child span.
- **Do not** invent `gen_ai.operation.name` values (e.g. `context_load`,
  `plan_emit`). Only the OTel-defined operations above are permitted; HSC typing
  lives in `harness.event_type`.
- **Do not** place any `harness.*` attribute under the `gen_ai.*` namespace.
- **Do not** emit `gen_ai.system`; it was superseded by `gen_ai.provider.name`.
