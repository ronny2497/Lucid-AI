# @lucid/adapter-langgraph → HSC v0 coverage

> **Status:** Neutral framework adapter coverage. Records, honestly, which HSC v0
> event types the LangGraph adapter **emits** and which are **honest absences**
> (the absence is signal, never fabricated — D-05 / RESEARCH Pitfall 5). This
> adapter exists to prove nothing hermes-specific leaked into HSC (D-07): it
> shares only `@lucid/sdk` and `@lucid/hsc-schema` with the rest of Lucid.

The canonical event-type strings, principles, quadrant table, and `harness.*` /
`gen_ai.*` attribute paths come from `@lucid/hsc-schema`. The adapter maps
LangGraph's OTel span names to HSC event types in `src/mapping.ts`; the span
names (`invoke_agent` / `chat` / `execute_tool`) are RESEARCH assumption **A4**,
pending confirmation against `@langchain/langgraph` source (Task 1 human-verify).

---

## Per-event coverage (all 10 HSC v0 event types)

| HSC event type | disposition | LangGraph source span | Notes |
|---|---|---|---|
| `context.load`   | **honest absence** | — | LangGraph emits no distinct context-assembly span; token usage rides on `chat`. Not synthesized as a separate event. |
| `plan.emit`      | **direct emit** | `chat` | An LLM call surfaces the plan / next step. Reuses `gen_ai.request.model` / token usage when present. |
| `task.slice`     | **direct emit** | `invoke_agent` | A graph / agent invocation is a unit of work. |
| `tool.call`      | **direct emit** | `execute_tool` | A tool node executes a tool. Reuses `gen_ai.tool.name` when present. LangGraph does not report durable-state mutation, so `harness.mutated_state` is left unset (honest). |
| `feedback.check` | **honest absence** | — | **LangGraph has no feedback-check hook.** Never emitted, never synthesized (D-05, RESEARCH Pitfall 5, spec §5.2). **This is the key diagnostic signal — the first live empty-feedback-column demo for Phase 2.** |
| `verify.result`  | **honest absence** | — | **LangGraph has no verification step.** A tool node returning a value is not verification. Never emitted, never synthesized (D-05, spec §4/§5.2). |
| `doc.encode`     | **honest absence** | — | No distinct durable-knowledge-write hook in LangGraph; such writes (if any) surface as a `tool.call`. Not emitted as a distinct event. |
| `evolve.propose` | **honest absence** | — | Not applicable to a base LangGraph agent; `evolve.*` is never inferred (spec §5.2). |
| `evolve.apply`   | **honest absence** | — | Not applicable to a base LangGraph agent; `evolve.*` is never inferred (spec §5.2). |
| `error`          | **honest absence** (for this baseline) | — | The neutral baseline maps only the three core operation spans; an error surfaces as a span event on the underlying OTel span and is not projected as a distinct HSC `error` event by this adapter. |

### Emitted summary

The neutral LangGraph adapter directly emits exactly three HSC event types:

- `task.slice`  (from `invoke_agent`)
- `plan.emit`   (from `chat`)
- `tool.call`   (from `execute_tool`)

### Honest-absence summary (D-05)

The defining property of this adapter is what it does **not** emit. `feedback.check`
and `verify.result` are **honest absences** — LangGraph exposes no verification or
feedback-check source, so the adapter never synthesizes them. An unrecognized span
maps to `null` (`mapSpan`) and is passed through opaque, never coerced into an HSC
event.

The empty-feedback-quadrant finding follows directly: a LangGraph trace contains
`tool.call` events with **no following `verify.result` or `feedback.check`**. Per
spec §4 this is a VALID, honest trace — the gap is the diagnostic, not a defect to
patch. This is the first live, real third-party agent demonstrating the empty
feedback column for Phase 2.
