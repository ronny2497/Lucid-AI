"""Pytest fixtures for the hermes HSC adapter offline unit tests.

Provides an in-memory OTel TracerProvider so tests can drive the adapter
callbacks and assert on the captured spans without any live hermes run, model
credentials, or file I/O. Also provides a tmp-path FileSpanExporter-backed setup
for the serialization tests.
"""

from __future__ import annotations

import os
import sys

import pytest

# Make the adapter package importable as top-level modules (hsc_adapter,
# file_exporter, quadrant) regardless of pytest's rootdir.
_ADAPTER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ADAPTER_DIR not in sys.path:
    sys.path.insert(0, _ADAPTER_DIR)

from opentelemetry.sdk.trace import TracerProvider  # noqa: E402
from opentelemetry.sdk.trace.export import (  # noqa: E402
    SimpleSpanProcessor,
)
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (  # noqa: E402
    InMemorySpanExporter,
)


@pytest.fixture()
def memory_exporter():
    """An InMemorySpanExporter wired into a fresh TracerProvider.

    Yields ``(tracer, exporter)``. Read finished spans via
    ``exporter.get_finished_spans()``.
    """
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    tracer = provider.get_tracer("lucid.hsc.hermes.test")
    yield tracer, exporter
    exporter.clear()


def attr(span, key):
    """Helper: read a single attribute off a finished ReadableSpan."""
    return dict(span.attributes or {}).get(key)
