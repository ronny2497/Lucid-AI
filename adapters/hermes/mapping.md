# hermes-agent → HSC v0 adapter mapping

> **Status:** Reference adapter mapping. Records, honestly, which HSC v0 event
> types the hermes-agent reference adapter **directly emits**, which it **infers**
> (flagged `harness.inferred=true`, OQ-03 §5.1), and which are **expected
> absences** for the hermes baseline (D-05; the absence is signal, never
> fabricated). Nothing hermes-specific is baked back into the HSC spec (D-07).

The canonical event-type strings, principles, quadrant table, and `harness.*` /
`gen_ai.*` attribute paths come from `@lucid/hsc-schema` and `docs/standard/*`.
This adapter mirrors those strings deliberately (hermes is Python and cannot
import the TypeScript package).

---

## Per-event mapping (all 10 HSC v0 event types)

| HSC event type | hermes disposition | Tap point / signal | Notes |
|---|---|---|---|
| `context.load`   | **inferred** (`harness.inferred=true`) | `pre_llm_call` hook / `context_compressor.last_prompt_tokens` (token count) | No explicit context-assembly hook fires; the token count is derived from API usage. OQ-03 §5.1 permits this. Projects onto OTel `chat`. |
| `plan.emit`      | **inferred** (`harness.inferred=true`) | `reasoning_callback` (REASONING_SCRATCHPAD with step-structured content) | OQ-03 §5.1 permits inferring `plan.emit` from a step-structured scratchpad. Projects onto OTel `chat`. |
| `task.slice`     | **expected absence** | — | hermes has no task-scoping / vertical-slice concept; it is single-turn / session-based. **expected absence.** |
| `tool.call`      | **direct emit** | `tool_start_callback(tool_call_id, name, args)` → start; `tool_complete_callback(tool_call_id, name, args, result)` → end | OTel `execute_tool`; sets `gen_ai.tool.name`; `harness.mutated_state` from `FILE_MUTATING_TOOL_NAMES = {write_file, patch}`. Untagged quadrant (x/y null). |
| `feedback.check` | **expected absence** | — | hermes exposes no explicit feedback-check hook. This is the **key diagnostic finding** for hermes. **expected absence** — never inferred (spec §5.2). |
| `verify.result`  | **expected absence** | — | `file_mutation_result_landed()` proves a write *landed*, but a successful write is **not** verification (RESEARCH Pitfall 3, spec §4). Recorded as **expected absence** for Phase 0; never fabricated/inferred (spec §5.2). |
| `doc.encode`     | **expected absence** (as a distinct event) | — | hermes writes skills/knowledge via the `write_file` tool, which overlaps with `tool.call{mutated_state:true}`. There is no *distinct* doc-encode hook, so as a distinct event it is an **expected absence**; the knowledge write surfaces as a `tool.call`. |
| `evolve.propose` | **expected absence** | — | Not applicable to the hermes baseline; `evolve.*` is never inferred (spec §5.2). **expected absence.** |
| `evolve.apply`   | **expected absence** | — | Not applicable to the hermes baseline; `evolve.*` is never inferred (spec §5.2). **expected absence.** |
| `error`          | **direct emit** (span event) | `event_callback(event_type, data)` with `event_type == "error"` | Emitted as a span **event** (`span.add_event("error", {harness.event_type:"error", ...})`) on the enclosing turn span — NOT via OTel span status (otel-mapping anti-pattern, RESEARCH Pitfall 1). No quadrant, no principle of its own (cross-cutting, spec §3.3). |

Turn enclosure: the per-turn agent invocation is an OTel `invoke_agent` (INTERNAL)
span reusing `gen_ai.agent.name` / `gen_ai.agent.id` / `gen_ai.provider.name`
(otel-mapping turn-level row). It is the agentic-core enclosure, **not** an HSC
event — it carries no `harness.event_type` and is represented as the turn itself,
not as an event in the `events` array.

### Expected-absence summary (D-05)

For the hermes baseline these five HSC event types are **expected absence** and are
**never fabricated or inferred**:

- `task.slice` — **expected absence** (no vertical-slice concept).
- `feedback.check` — **expected absence** (no feedback hook; key diagnostic).
- `verify.result` — **expected absence** (a successful write is not verification).
- `evolve.propose` — **expected absence** (not applicable to baseline).
- `evolve.apply` — **expected absence** (not applicable to baseline).
- `doc.encode` — **expected absence** as a *distinct* event (overlaps `tool.call`).

The empty-feedback-quadrant finding follows directly: the captured trace contains a
`tool.call{harness.mutated_state:true}` (a `write_file`) with **no following
`verify.result` or `feedback.check`**. Per spec §4 this is a VALID, honest trace —
the gap is the diagnostic, not a defect to patch.

### Feedback detector (consumes this absence)

Phase 2's Feedback detector (`docs/standard/eval-rubric.md` §2.3) is defined as:

> Feedback = fraction of `tool.call` events with `harness.mutated_state = true`
> that are followed by a `verify.result` in the same turn.

For this hermes capture that fraction is `0/1` — the empty feedback quadrant. The
adapter preserves the absence rather than synthesizing a `verify.result` to inflate
the score.

---

## Provenance of `examples/hermes-trace.json` (honest, per PLAN warning #3)

`examples/hermes-trace.json` is a **recorded scripted-callback capture**, NOT a live
hermes-agent run.

- It is **real adapter output**: every span and attribute is produced by
  `HermesHSCAdapter` + `FileSpanExporter` (see `capture_trace.py`), not hand-authored
  ad hoc.
- The **callback inputs are synthetic** — the deterministic sequence in
  `capture_trace.py` mirrors the shapes hermes passes to its callbacks
  (`tool_start_callback`, `tool_complete_callback`, `reasoning_callback`, the
  `pre_llm_call` token count, `step_callback`), rather than being emitted by a live
  hermes model loop (which requires the hermes runtime + model credentials).
- A **live run is preferred** and satisfies the Phase 0 exit criterion directly. The
  live path is implemented in `tests/test_adapter_live.py` (marked `live`); it
  attaches the adapter to a real `AIAgent` and asserts ≥1 span carries
  `harness.event_type`. It **SKIPs with an explicit reason** when the hermes runtime
  / credentials are unavailable (it never silently passes empty).
- This capture is **documented degradation**, not silent. The Plan 00-04 SUMMARY and
  the human-verify checkpoint record this provenance explicitly.

To regenerate the artifact (when the OTel Python SDK is installed):

```bash
python adapters/hermes/capture_trace.py            # → examples/hermes-trace.json (+ .otlp.json)
node packages/conformance/dist/cli.js --trace examples/hermes-trace.json   # exit 0
```

To produce it from a live hermes run instead, run a short hermes task with the
adapter attached (see `README.md`) pointed at the same output path.

---

## Envelope reconciliation (`HarnessTrace` vs OTLP/JSON)

`docs/standard/transport-profile.md` names the OTLP/JSON
`resourceSpans > scopeSpans > spans` envelope as the on-disk wire format. The Phase 0
conformance validator (`@lucid/conformance`, Plan 00-03) compiles the **`HarnessTrace`
JSON Schema** and validates a `HarnessTrace` document
(`{hsc_version, trace_id, turns:[{turn_id, events:[…]}]}`) **directly** — it does not
extract a HarnessTrace from an OTLP envelope.

The binding, falsifiable Phase 0 exit criterion is the conformance CLI exit code, so:

- **`examples/hermes-trace.json`** is the **`HarnessTrace`** document — the artifact
  `node packages/conformance/dist/cli.js --trace examples/hermes-trace.json` validates
  (exit 0). This is the exit-criterion artifact.
- **`examples/hermes-trace.otlp.json`** is the same capture in the raw **OTLP/JSON**
  envelope named by the transport profile, shipped alongside for forward-compat: any
  OTLP-aware backend can read it when Phase 1 ingestion is built.

Both files are produced from the **same captured spans** by `FileSpanExporter`
(`envelope="harness_trace"` and `envelope="otlp"`), so they cannot diverge. Phase 1
ingestion is expected to consume OTLP and project it onto the HarnessTrace shape the
validator already enforces.
