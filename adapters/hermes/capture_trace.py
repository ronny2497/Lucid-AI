"""Scripted-callback capture: produce examples/hermes-trace.json from REAL adapter output.

This is the Phase 0 exit-artifact producer. It drives ``HermesHSCAdapter`` with a
deterministic sequence of synthetic *hermes-style callback inputs* (the same shapes
hermes-agent passes to ``tool_start_callback`` / ``tool_complete_callback`` /
``reasoning_callback`` / ``pre_llm_call`` / ``step_callback``), and lets the adapter
+ ``FileSpanExporter`` emit the trace exactly as they would during a live run.

PROVENANCE (honest, per PLAN warning #3): the resulting ``examples/hermes-trace.json``
is a **recorded scripted-callback capture**, NOT a live hermes-agent run. It is real
adapter output (the spans/attributes are produced by the adapter code, not
hand-authored), but the *callback inputs* are synthetic rather than emitted by a live
hermes model loop. A live run is preferred; this capture is documented degradation
(see adapters/hermes/mapping.md "Provenance"). The live path is exercised by
tests/test_adapter_live.py, which SKIPs when the hermes runtime is unavailable.

The capture deliberately includes the empty-feedback-quadrant seed: a
``tool.call{mutated_state:true}`` (write_file) with NO following ``verify.result`` or
``feedback.check`` — the honest absence the spec §4 requires us to preserve.

Run:
    python adapters/hermes/capture_trace.py [output_path]
Default output: examples/hermes-trace.json (HarnessTrace envelope, conformance-validated).
Also writes:    examples/hermes-trace.otlp.json (raw OTLP/JSON, transport-compat).
"""

from __future__ import annotations

import os
import sys

_ADAPTER_DIR = os.path.dirname(os.path.abspath(__file__))
if _ADAPTER_DIR not in sys.path:
    sys.path.insert(0, _ADAPTER_DIR)

from opentelemetry.sdk.trace import TracerProvider  # noqa: E402
from opentelemetry.sdk.trace.export import SimpleSpanProcessor  # noqa: E402

from file_exporter import FileSpanExporter  # noqa: E402
from hsc_adapter import HermesHSCAdapter  # noqa: E402


# Synthetic hermes-style callback inputs for a short "write a skill file" task.
# Mirrors what hermes passes to its callbacks; chosen to exercise the event types
# hermes can emit and to seed the empty-feedback finding.
_SCRIPT = {
    "model": "claude-sonnet-4",
    "agent_id": "hermes-session-0001",
    "provider": "anthropic",
    # context.load (inferred token count from pre_llm_call / last_prompt_tokens)
    "prompt_tokens": 4096,
    # reasoning_callback scratchpad -> inferred plan.emit
    "scratchpad_finish_reasons": ["stop"],
    # tool_start/tool_complete inputs
    "tool_call_id": "toolu_01ABC",
    "tool_name": "write_file",
    "tool_args": {"path": "skills/example.md", "content": "<suppressed>"},
    "tool_result": '{"bytes_written": 128, "path": "skills/example.md"}',
}


def run_capture(harness_trace_path: str, otlp_path: str) -> None:
    # --- HarnessTrace envelope (the conformance-validated exit artifact) ---
    ht_exporter = FileSpanExporter(
        harness_trace_path,
        envelope="harness_trace",
        trace_id="hermes-capture-0001",
        harness_id="hermes",
        harness_version="0.16.0",
    )
    otlp_exporter = FileSpanExporter(otlp_path, envelope="otlp")

    provider = TracerProvider()
    # Fan out to both exporters from the SAME spans so the two envelopes cannot
    # diverge.
    provider.add_span_processor(SimpleSpanProcessor(ht_exporter))
    provider.add_span_processor(SimpleSpanProcessor(otlp_exporter))
    tracer = provider.get_tracer("lucid.hsc.hermes")

    adapter = HermesHSCAdapter(
        tracer,
        harness_id="hermes",
        harness_version="0.16.0",
        provider_name=_SCRIPT["provider"],
    )

    # Turn-level invoke_agent (INTERNAL) span encloses the run.
    turn = adapter.start_turn(model=_SCRIPT["model"], agent_id=_SCRIPT["agent_id"])

    # 1) context.load — inferred token count (no explicit assembly hook; OQ-03 §5.1)
    adapter.emit_inferred_context_load(
        input_tokens=_SCRIPT["prompt_tokens"], model=_SCRIPT["model"]
    )

    # 2) plan.emit — inferred from reasoning scratchpad (OQ-03 §5.1)
    adapter.emit_inferred_plan(
        model=_SCRIPT["model"], finish_reasons=_SCRIPT["scratchpad_finish_reasons"]
    )

    # 3) tool.call (write_file) — mutates state, intentionally NOT verified.
    adapter.on_tool_start(
        _SCRIPT["tool_call_id"], _SCRIPT["tool_name"], _SCRIPT["tool_args"]
    )
    adapter.on_tool_complete(
        _SCRIPT["tool_call_id"],
        _SCRIPT["tool_name"],
        _SCRIPT["tool_args"],
        _SCRIPT["tool_result"],
    )
    # NO verify.result / feedback.check emitted: hermes has no feedback hook
    # (expected absence) — the empty-feedback seed (spec §4) is preserved.

    turn.end()
    provider.shutdown()  # flushes both FileSpanExporters


if __name__ == "__main__":
    repo_root = os.path.abspath(os.path.join(_ADAPTER_DIR, "..", ".."))
    ht = sys.argv[1] if len(sys.argv) > 1 else os.path.join(repo_root, "examples", "hermes-trace.json")
    otlp = os.path.join(os.path.dirname(ht), "hermes-trace.otlp.json")
    os.makedirs(os.path.dirname(ht), exist_ok=True)
    run_capture(ht, otlp)
    print(f"wrote {ht}")
    print(f"wrote {otlp}")
