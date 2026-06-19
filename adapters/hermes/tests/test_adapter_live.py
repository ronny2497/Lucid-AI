"""Live integration test: attach the adapter to a real hermes-agent run.

This test (marked ``live``) constructs a hermes ``AIAgent`` with the HSC adapter
callbacks attached, runs a short scripted task that performs at least one
state-mutating tool call (a ``write_file``), and asserts that >= 1 emitted span
carries ``harness.event_type``.

It SKIPs — with an explicit, specific reason — when the hermes runtime or model
credentials are unavailable, so it NEVER silently passes empty. The Phase 0 exit
artifact (``examples/hermes-trace.json``) is produced by the deterministic
scripted-callback capture (``capture_trace.py``) when a live run is not possible;
see ``adapters/hermes/mapping.md`` "Provenance" for the live-vs-capture honesty.
"""

from __future__ import annotations

import os
import sys

import pytest

_ADAPTER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ADAPTER_DIR not in sys.path:
    sys.path.insert(0, _ADAPTER_DIR)


def _hermes_runtime_available():
    """Return (ok, reason). hermes must be importable AND have model creds."""
    try:
        # hermes-agent lives at ../hermes-agent relative to the repo root; it is a
        # reference harness, not vendored. Importing AIAgent confirms the runtime.
        import importlib

        importlib.import_module("run_agent")  # hermes-agent's AIAgent module
    except Exception as exc:  # pragma: no cover - environment dependent
        return False, f"hermes-agent runtime not importable: {exc!r}"
    # A live run needs model credentials. Absent an API key, skip rather than
    # attempt a network/model call.
    if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("OPENAI_API_KEY")):
        return False, "no model API key (ANTHROPIC_API_KEY / OPENAI_API_KEY) in env"
    return True, ""


@pytest.mark.live
def test_live_hermes_run_emits_harness_event_type(tmp_path):
    ok, reason = _hermes_runtime_available()
    if not ok:
        pytest.skip(f"live hermes run unavailable: {reason}")

    # --- Real live run (only reached when the runtime + creds are present) ---
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import SimpleSpanProcessor
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
        InMemorySpanExporter,
    )

    from hsc_adapter import HermesHSCAdapter
    from run_agent import AIAgent  # type: ignore

    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    tracer = provider.get_tracer("lucid.hsc.hermes")
    adapter = HermesHSCAdapter(tracer, harness_version="0.16.0", provider_name="anthropic")

    workdir = tmp_path / "work"
    workdir.mkdir()
    agent = AIAgent(  # pragma: no cover - exercised only with a live runtime
        tool_start_callback=adapter.on_tool_start,
        tool_complete_callback=adapter.on_tool_complete,
        step_callback=adapter.on_step,
        working_directory=str(workdir),
    )
    # A short task that must perform a state-mutating write_file.
    agent.run("Create a file named note.txt containing the text 'hello' and stop.")
    provider.shutdown()

    spans = exporter.get_finished_spans()
    event_typed = [
        s for s in spans if "harness.event_type" in dict(s.attributes or {})
    ]
    assert event_typed, "live hermes run produced no span carrying harness.event_type"
    # At least one mutating tool.call should be present for this task.
    assert any(
        dict(s.attributes or {}).get("harness.event_type") == "tool.call"
        for s in event_typed
    )
