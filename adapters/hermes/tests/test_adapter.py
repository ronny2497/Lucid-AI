"""Offline unit tests for the hermes HSC adapter (no live hermes run).

Drives the adapter callbacks with synthetic tool-call / LLM data and asserts the
HSC v0 behavior: harness.* + gen_ai.* attributes, the OQ-02 quadrant, the
mutated_state rule, expected-absence guard rails, content suppression, and the
FileSpanExporter OTLP/HarnessTrace serialization.
"""

from __future__ import annotations

import json
import os
import sys

import pytest

_ADAPTER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ADAPTER_DIR not in sys.path:
    sys.path.insert(0, _ADAPTER_DIR)

from conftest import attr  # noqa: E402
from file_exporter import FileSpanExporter  # noqa: E402
from hsc_adapter import HermesHSCAdapter  # noqa: E402
from quadrant import EVENT_TYPES, EMITTER_SPECIFIED_Y, quadrant_for  # noqa: E402


# --- quadrant_for parity with the spec / @lucid/hsc-schema -------------------


def test_quadrant_for_tool_call_is_untagged():
    assert quadrant_for("tool.call") == (None, None)


def test_quadrant_for_error_is_untagged():
    assert quadrant_for("error") == (None, None)


def test_quadrant_for_feedback_check_y_is_emitter_specified():
    x, y = quadrant_for("feedback.check")
    assert x == "feedback"
    assert y is None
    assert "feedback.check" in EMITTER_SPECIFIED_Y


def test_quadrant_table_full_oq02():
    expected = {
        "context.load": ("feedforward", "computational"),
        "plan.emit": ("feedforward", "inferential"),
        "task.slice": ("feedforward", "computational"),
        "tool.call": (None, None),
        "feedback.check": ("feedback", None),
        "verify.result": ("feedback", "computational"),
        "doc.encode": ("feedforward", "computational"),
        "evolve.propose": ("feedback", "inferential"),
        "evolve.apply": ("feedback", "computational"),
        "error": (None, None),
    }
    assert set(EVENT_TYPES) == set(expected)
    for et, q in expected.items():
        assert quadrant_for(et) == q


# --- tool.call drive ---------------------------------------------------------


def test_tool_call_mutating_sets_state_and_execute_tool(memory_exporter):
    tracer, exporter = memory_exporter
    adapter = HermesHSCAdapter(tracer, harness_version="0.16.0")

    adapter.on_tool_start("tc-1", "write_file", {"path": "skills/x.md"})
    adapter.on_tool_complete("tc-1", "write_file", {"path": "skills/x.md"}, '{"bytes_written": 12}')

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    span = spans[0]
    assert attr(span, "harness.event_type") == "tool.call"
    assert attr(span, "gen_ai.operation.name") == "execute_tool"
    assert attr(span, "gen_ai.tool.name") == "write_file"
    assert attr(span, "harness.mutated_state") is True
    # tool.call is an untagged action: x/y are null (not set / None).
    assert attr(span, "harness.quadrant.x") is None
    assert attr(span, "harness.quadrant.y") is None
    assert attr(span, "harness.principle") == "plan_execute"


def test_tool_call_nonmutating_sets_state_false(memory_exporter):
    tracer, exporter = memory_exporter
    adapter = HermesHSCAdapter(tracer)
    adapter.on_tool_start("tc-2", "read_file", {"path": "README.md"})
    adapter.on_tool_complete("tc-2", "read_file", {"path": "README.md"}, "contents")
    span = exporter.get_finished_spans()[0]
    assert attr(span, "harness.mutated_state") is False


def test_tool_call_does_not_emit_verify_result(memory_exporter):
    """A successful write is NOT a verification (D-05, Pitfall 3)."""
    tracer, exporter = memory_exporter
    adapter = HermesHSCAdapter(tracer)
    adapter.on_tool_start("tc-3", "write_file", {})
    adapter.on_tool_complete("tc-3", "write_file", {}, '{"bytes_written": 5}')
    spans = exporter.get_finished_spans()
    types = [attr(s, "harness.event_type") for s in spans]
    assert "verify.result" not in types
    assert "feedback.check" not in types


def test_content_not_recorded_by_default(memory_exporter):
    """T-00-09: no tool-argument / message content on spans by default."""
    tracer, exporter = memory_exporter
    adapter = HermesHSCAdapter(tracer)
    adapter.on_tool_start("tc-4", "write_file", {"path": "secret.txt", "content": "API_KEY=xyz"})
    adapter.on_tool_complete("tc-4", "write_file", {"content": "API_KEY=xyz"}, '{"bytes_written": 1}')
    span = exporter.get_finished_spans()[0]
    attrs = dict(span.attributes or {})
    assert "gen_ai.input.messages" not in attrs
    assert "gen_ai.tool.call.arguments" not in attrs
    # the secret value must not appear in any attribute value
    assert all("API_KEY" not in str(v) for v in attrs.values())


# --- inferred events (OQ-03) -------------------------------------------------


def test_inferred_context_load_flagged(memory_exporter):
    tracer, exporter = memory_exporter
    adapter = HermesHSCAdapter(tracer)
    adapter.emit_inferred_context_load(input_tokens=1234, model="claude")
    span = exporter.get_finished_spans()[0]
    assert attr(span, "harness.event_type") == "context.load"
    assert attr(span, "harness.inferred") is True
    assert attr(span, "gen_ai.operation.name") == "chat"
    assert attr(span, "gen_ai.usage.input_tokens") == 1234


def test_inferred_plan_flagged(memory_exporter):
    tracer, exporter = memory_exporter
    adapter = HermesHSCAdapter(tracer)
    adapter.emit_inferred_plan(model="claude", finish_reasons=["stop"])
    span = exporter.get_finished_spans()[0]
    assert attr(span, "harness.event_type") == "plan.emit"
    assert attr(span, "harness.inferred") is True
    assert attr(span, "harness.quadrant.x") == "feedforward"
    assert attr(span, "harness.quadrant.y") == "inferential"


# --- expected-absence guard rails -------------------------------------------


@pytest.mark.parametrize(
    "absent",
    ["verify.result", "feedback.check", "task.slice", "evolve.propose", "evolve.apply"],
)
def test_adapter_refuses_to_emit_expected_absences(absent):
    """The base-attr builder refuses expected-absence event types (D-05)."""
    from hsc_adapter import _base_harness_attrs

    with pytest.raises(ValueError):
        _base_harness_attrs(absent)


# --- error as a span event, not span status ---------------------------------


def test_error_emitted_as_span_event(memory_exporter):
    tracer, exporter = memory_exporter
    adapter = HermesHSCAdapter(tracer)
    turn = adapter.start_turn(model="claude")
    adapter.on_event("error", {"message": "boom"}, enclosing_span=turn)
    turn.end()
    span = exporter.get_finished_spans()[0]
    names = [e.name for e in (span.events or [])]
    assert "error" in names
    err = next(e for e in span.events if e.name == "error")
    assert dict(err.attributes)["harness.event_type"] == "error"


# --- FileSpanExporter serialization -----------------------------------------


def test_file_exporter_harness_trace_envelope(tmp_path):
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import SimpleSpanProcessor

    out = tmp_path / "trace.json"
    exporter = FileSpanExporter(str(out), envelope="harness_trace", harness_id="hermes")
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    tracer = provider.get_tracer("lucid.hsc.hermes.test")
    adapter = HermesHSCAdapter(tracer)
    adapter.on_tool_start("tc-1", "write_file", {})
    adapter.on_tool_complete("tc-1", "write_file", {}, '{"bytes_written": 3}')
    exporter.shutdown()

    doc = json.loads(out.read_text())
    assert doc["hsc_version"] == "v0"
    assert "trace_id" in doc
    assert isinstance(doc["turns"], list) and doc["turns"]
    events = doc["turns"][0]["events"]
    assert events[0]["harness.event_type"] == "tool.call"
    assert events[0]["harness.mutated_state"] is True


def test_file_exporter_otlp_envelope(tmp_path):
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import SimpleSpanProcessor

    out = tmp_path / "trace.otlp.json"
    exporter = FileSpanExporter(str(out), envelope="otlp")
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    tracer = provider.get_tracer("lucid.hsc.hermes.test")
    adapter = HermesHSCAdapter(tracer)
    adapter.on_tool_start("tc-1", "write_file", {})
    adapter.on_tool_complete("tc-1", "write_file", {}, '{"bytes_written": 3}')
    exporter.shutdown()

    doc = json.loads(out.read_text())
    assert "resourceSpans" in doc
    spans = doc["resourceSpans"][0]["scopeSpans"][0]["spans"]
    assert spans and spans[0]["name"].startswith("execute_tool")
