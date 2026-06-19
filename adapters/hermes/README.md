# `lucid-hermes-adapter` — HSC v0 reference adapter for hermes-agent

A **reference / test-only** adapter that proves the [HSC v0
specification](../../docs/standard/hsc-v0-spec.md) works on a real, non-TypeScript
harness. It taps hermes-agent's documented lifecycle callbacks and emits
OpenTelemetry spans carrying the HSC `harness.*` extension attributes plus the
reused OTel `gen_ai.*` attributes.

> hermes is the first adapter target **only** because it exercises every event
> type (D-07). Nothing hermes-specific is baked into HSC. Lucid core takes **no**
> Python dependency — this adapter lives under `adapters/` and is reference-only
> (ADR-0002).

## Files

| File | Purpose |
|---|---|
| `hsc_adapter.py` | `HermesHSCAdapter` — wires hermes callbacks → OTel spans with `harness.*` attributes. |
| `file_exporter.py` | `FileSpanExporter` — serializes captured spans to the `HarnessTrace` envelope (conformance-validated) and/or the OTLP/JSON envelope. |
| `quadrant.py` | `quadrant_for()` — the OQ-02 quadrant predicate, mirrored from `@lucid/hsc-schema`. |
| `capture_trace.py` | Scripted-callback capture that produces `examples/hermes-trace.json` from real adapter output. |
| `mapping.md` | Honest per-event emit / inferred / expected-absence table + provenance + envelope reconciliation. |
| `tests/` | Offline unit tests (`test_adapter.py`) + the live integration test (`test_adapter_live.py`, marked `live`, skips when hermes is unavailable). |

## Install

```bash
pip install -e adapters/hermes        # or: uv pip install -e adapters/hermes
```

Requires Python ≥ 3.11 and `opentelemetry-api` + `opentelemetry-sdk` (declared in
`pyproject.toml`).

## Attach to a hermes run

```python
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor

from file_exporter import FileSpanExporter
from hsc_adapter import HermesHSCAdapter

# 1. Wire the exporter into a tracer provider.
exporter = FileSpanExporter("examples/hermes-trace.json",
                            envelope="harness_trace",
                            harness_id="hermes", harness_version="0.16.0")
provider = TracerProvider()
provider.add_span_processor(SimpleSpanProcessor(exporter))
tracer = provider.get_tracer("lucid.hsc.hermes")

adapter = HermesHSCAdapter(tracer, harness_version="0.16.0", provider_name="anthropic")

# 2. Attach the adapter's callbacks when constructing the hermes AIAgent.
agent = AIAgent(
    ...,
    tool_start_callback=adapter.on_tool_start,
    tool_complete_callback=adapter.on_tool_complete,
    step_callback=adapter.on_step,
    reasoning_callback=lambda *_a, **_k: adapter.emit_inferred_plan(model=MODEL),
    event_callback=lambda et, data: adapter.on_event(et, data, enclosing_span=turn),
)

# 3. On shutdown the FileSpanExporter writes the trace.
provider.shutdown()
```

The trace is written to the path you pass to `FileSpanExporter`. By default the
adapter does **not** record prompt / tool-argument / result content (T-00-09
information-disclosure mitigation); pass `record_content=True` to opt in.

## Produce the Phase 0 exit artifact

The exit artifact is a deterministic scripted-callback capture (real adapter
output; see `mapping.md` "Provenance"):

```bash
python adapters/hermes/capture_trace.py
node packages/conformance/dist/cli.js --trace examples/hermes-trace.json   # exit 0
```

This writes both `examples/hermes-trace.json` (the conformance-validated
`HarnessTrace` document) and `examples/hermes-trace.otlp.json` (the OTLP/JSON
transport-compatible sibling).

## Run the tests

```bash
# Offline unit tests (no hermes runtime needed):
python -m pytest adapters/hermes/tests/test_adapter.py -x -q

# Live integration test (skips when hermes runtime / credentials are unavailable):
python -m pytest adapters/hermes/tests/test_adapter_live.py -k live
```

## What hermes can / cannot emit

See [`mapping.md`](./mapping.md). In short: hermes directly emits `tool.call` and
`error`, infers `context.load` (token count) and `plan.emit` (scratchpad), and has
**expected absences** for `task.slice`, `feedback.check`, `verify.result`,
`evolve.propose`, `evolve.apply`, and `doc.encode` (as a distinct event). The
missing `verify.result` after a mutating `write_file` is the honest empty-feedback
finding (spec §4) — preserved, never fabricated.
