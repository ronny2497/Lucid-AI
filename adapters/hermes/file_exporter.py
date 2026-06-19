"""FileSpanExporter — serialize captured OTel spans to a hand-inspectable HSC trace.

This exporter implements the OTel ``SpanExporter`` interface so it can be wired
into a ``TracerProvider`` via ``SimpleSpanProcessor`` (RESEARCH Pattern 3). On
``export`` it accumulates each span as a plain dict; on ``shutdown`` it writes the
JSON file.

Two on-disk shapes (the Plan 00-04 envelope reconciliation — see mapping.md
"Envelope reconciliation"):

* ``envelope="harness_trace"`` (DEFAULT, the codified exit-criterion artifact):
  the HSC ``HarnessTrace`` document the committed conformance CLI validates —
  ``{"hsc_version","trace_id","turns":[{"turn_id","events":[<event>...]}]}`` where
  each event is a flat object carrying dotted-key ``harness.*`` / ``gen_ai.*``
  attributes plus span identity fields. This is what
  ``node packages/conformance/dist/cli.js --trace examples/hermes-trace.json``
  validates (exit 0). ``examples/hermes-trace.json`` MUST use this shape.

* ``envelope="otlp"`` (transport-compatibility sibling): the raw OTLP/JSON
  ``{"resourceSpans":[{"scopeSpans":[{"spans":[...]}]}]}`` envelope named in
  ``docs/standard/transport-profile.md``. Any OTLP-aware backend can read it when
  Phase 1 ingestion is built. Written to ``examples/hermes-trace.otlp.json``.

Why two shapes: the transport profile names OTLP/JSON as the wire/on-disk
envelope, but the Phase 0 conformance validator (Plan 00-03, already shipped)
compiles the ``HarnessTrace`` JSON Schema and validates the ``HarnessTrace``
document directly — it does NOT extract a HarnessTrace from an OTLP envelope.
The binding, falsifiable Phase 0 exit criterion is the CLI exit code, so the
primary artifact is the HarnessTrace shape; the OTLP shape ships alongside it for
forward-compat. Both are produced from the SAME captured spans, so they cannot
diverge.

Privacy (T-00-09): this exporter serializes only the span attributes the adapter
set. The adapter does not set ``gen_ai.input.messages`` / tool-argument content by
default, so no prompt/argument payload reaches the file unless an operator opted
in upstream.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Sequence

try:  # pragma: no cover - import shape depends on installed OTel SDK
    from opentelemetry.sdk.trace.export import SpanExporter, SpanExportResult
except Exception:  # pragma: no cover - allow import without the SDK present
    # Minimal stand-ins so this module imports even when opentelemetry-sdk is
    # not installed (e.g. offline authoring / schema review). The real classes
    # are used whenever the SDK is available.
    class SpanExportResult:  # type: ignore[no-redef]
        SUCCESS = 0
        FAILURE = 1

    class SpanExporter:  # type: ignore[no-redef]
        def export(self, spans):  # noqa: D401 - interface stub
            raise NotImplementedError

        def shutdown(self):
            raise NotImplementedError


def _span_to_dict(span: Any) -> Dict[str, Any]:
    """Project a ReadableSpan onto a flat, hand-inspectable event dict.

    The attributes (``harness.*`` + ``gen_ai.*``) are spread as dotted top-level
    keys so the result conforms to the HSC ``HarnessEvent`` schema (which keys on
    dotted strings like ``"harness.event_type"``), not nested under ``attributes``.
    """
    ctx = span.get_span_context() if hasattr(span, "get_span_context") else span.context
    attrs = dict(span.attributes or {})

    event: Dict[str, Any] = {
        "span_id": format(ctx.span_id, "016x"),
        "trace_id": format(ctx.trace_id, "032x"),
        "parent_span_id": (
            format(span.parent.span_id, "016x") if getattr(span, "parent", None) else None
        ),
        "name": span.name,
    }
    if getattr(span, "start_time", None) is not None:
        event["start_time_unix_nano"] = int(span.start_time)
    if getattr(span, "end_time", None) is not None:
        event["end_time_unix_nano"] = int(span.end_time)

    # Spread attributes as dotted top-level keys (HarnessEvent shape). Drop None
    # values so the trace stays clean and the schema's nullable types are not
    # forced to carry explicit nulls for unset attributes.
    for key, value in attrs.items():
        if value is None:
            continue
        # OTel stores sequence attrs as tuples; normalize to list for JSON.
        if isinstance(value, tuple):
            value = list(value)
        event[key] = value

    # Span-level error events (HSC `error` is a span event, not a status — see
    # otel-mapping.md anti-patterns). Surface them so the absence/error model is
    # inspectable, without conflating with OTel span status.
    span_events = getattr(span, "events", None) or []
    if span_events:
        event["events"] = [
            {"name": e.name, "attributes": dict(e.attributes or {})} for e in span_events
        ]
    return event


def _span_to_otlp(span: Any) -> Dict[str, Any]:
    """Project a ReadableSpan onto an OTLP/JSON span object (attributes nested)."""
    ctx = span.get_span_context() if hasattr(span, "get_span_context") else span.context
    attrs = dict(span.attributes or {})
    otlp_attrs: List[Dict[str, Any]] = []
    for key, value in attrs.items():
        if value is None:
            continue
        if isinstance(value, bool):
            otlp_attrs.append({"key": key, "value": {"boolValue": value}})
        elif isinstance(value, int):
            otlp_attrs.append({"key": key, "value": {"intValue": str(value)}})
        elif isinstance(value, (list, tuple)):
            otlp_attrs.append(
                {
                    "key": key,
                    "value": {
                        "arrayValue": {
                            "values": [{"stringValue": str(v)} for v in value]
                        }
                    },
                }
            )
        else:
            otlp_attrs.append({"key": key, "value": {"stringValue": str(value)}})
    out: Dict[str, Any] = {
        "traceId": format(ctx.trace_id, "032x"),
        "spanId": format(ctx.span_id, "016x"),
        "parentSpanId": (
            format(span.parent.span_id, "016x") if getattr(span, "parent", None) else ""
        ),
        "name": span.name,
        "attributes": otlp_attrs,
    }
    if getattr(span, "start_time", None) is not None:
        out["startTimeUnixNano"] = str(int(span.start_time))
    if getattr(span, "end_time", None) is not None:
        out["endTimeUnixNano"] = str(int(span.end_time))
    return out


class FileSpanExporter(SpanExporter):
    """Accumulate exported spans and write them to ``path`` on shutdown.

    Args:
        path: output file path.
        envelope: ``"harness_trace"`` (default; conformance-validated HarnessTrace
            document) or ``"otlp"`` (raw OTLP/JSON resourceSpans envelope).
        hsc_version: HSC version string for the HarnessTrace envelope.
        trace_id: optional explicit top-level trace id; if omitted, the trace id of
            the first captured span is used.
        harness_id / harness_version: optional HarnessTrace metadata.
    """

    def __init__(
        self,
        path: str,
        *,
        envelope: str = "harness_trace",
        hsc_version: str = "v0",
        trace_id: Optional[str] = None,
        harness_id: Optional[str] = None,
        harness_version: Optional[str] = None,
    ) -> None:
        if envelope not in ("harness_trace", "otlp"):
            raise ValueError(f"unknown envelope: {envelope!r}")
        self._path = path
        self._envelope = envelope
        self._hsc_version = hsc_version
        self._trace_id = trace_id
        self._harness_id = harness_id
        self._harness_version = harness_version
        self._events: List[Dict[str, Any]] = []
        self._otlp_spans: List[Dict[str, Any]] = []

    def export(self, spans: Sequence[Any]):
        for span in spans:
            self._events.append(_span_to_dict(span))
            self._otlp_spans.append(_span_to_otlp(span))
        return SpanExportResult.SUCCESS

    def _build_harness_trace(self) -> Dict[str, Any]:
        # Use the explicit trace id, else the first captured event's trace id,
        # else a placeholder. All adapter spans share one trace per run.
        trace_id = self._trace_id
        if trace_id is None and self._events:
            trace_id = self._events[0].get("trace_id", "trace-0000")
        if trace_id is None:
            trace_id = "trace-0000"
        doc: Dict[str, Any] = {
            "hsc_version": self._hsc_version,
            "trace_id": trace_id,
        }
        if self._harness_id is not None:
            doc["harness_id"] = self._harness_id
        if self._harness_version is not None:
            doc["harness_version"] = self._harness_version
        # The HarnessTrace `events` array carries only HSC events — those that
        # carry `harness.event_type`. The turn-level OTel `invoke_agent`
        # (INTERNAL) span is the agentic-core enclosure (otel-mapping turn-level
        # row); it has no HSC event_type and so is NOT an HSC event. It is
        # represented as the turn itself, not as an event in the array (otherwise
        # it would fail the conformance rule that every event carries
        # harness.event_type). Its span identity is recorded as turn metadata.
        hsc_events = [e for e in self._events if "harness.event_type" in e]
        turn_span = next(
            (e for e in self._events if "harness.event_type" not in e), None
        )
        turn: Dict[str, Any] = {"turn_id": "turn-1", "events": hsc_events}
        if turn_span is not None:
            # Carry the enclosing invoke_agent span id for traceability (optional
            # metadata; not validated by the v0 HarnessTrace schema).
            turn["span_id"] = turn_span.get("span_id")
            turn["name"] = turn_span.get("name")
        # Single turn for the Phase 0 capture; multi-turn grouping is a Phase 1
        # ingestion concern.
        doc["turns"] = [turn]
        return doc

    def _build_otlp(self) -> Dict[str, Any]:
        return {"resourceSpans": [{"scopeSpans": [{"spans": list(self._otlp_spans)}]}]}

    def to_dict(self) -> Dict[str, Any]:
        """Return the configured-envelope document (without writing it)."""
        if self._envelope == "harness_trace":
            return self._build_harness_trace()
        return self._build_otlp()

    def write(self) -> None:
        """Write the configured-envelope document to ``self._path`` now."""
        with open(self._path, "w", encoding="utf-8") as fh:
            json.dump(self.to_dict(), fh, indent=2, default=str)
            fh.write("\n")

    def shutdown(self) -> None:
        self.write()

    def force_flush(self, timeout_millis: int = 30_000) -> bool:  # pragma: no cover
        return True
