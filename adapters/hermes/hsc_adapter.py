"""HermesHSCAdapter — tap hermes-agent lifecycle callbacks, emit HSC v0 OTel spans.

The adapter wires hermes-agent's documented ``AIAgent`` callbacks
(``tool_start_callback``, ``tool_complete_callback``, ``step_callback``,
``event_callback``, ``reasoning_callback``, and the ``pre_llm_call`` hook) onto
OpenTelemetry spans that carry the HSC ``harness.*`` extension attributes plus the
reused OTel ``gen_ai.*`` attributes, per ``docs/standard/otel-mapping.md`` and
``docs/standard/attribute-registry.md``. A ``FileSpanExporter`` serializes the
captured spans to a hand-inspectable HSC trace.

Design constraints honored (from PLAN <prohibitions> and docs/standard):

* Every emitted span carries ``harness.event_type`` AND a non-null
  ``harness.principle`` AND ``harness.quadrant.x/y`` (x/y are null for tool.call
  and error, per spec §3.2).
* Only OTel-defined ``gen_ai.operation.name`` values are emitted
  (``execute_tool`` / ``invoke_agent`` / ``chat``). HSC-specific typing lives in
  ``harness.event_type`` (otel-mapping anti-patterns).
* The adapter NEVER emits ``verify.result`` or ``feedback.check`` for hermes —
  these are expected absences recorded in ``mapping.md`` (D-05, RESEARCH Pitfall
  3). A successful ``write_file`` is NOT a verification.
* ``harness.inferred=true`` is set ONLY for the permitted ``plan.emit`` (from a
  reasoning scratchpad) and ``context.load`` (token count) cases (OQ-03 §5.1).
  ``verify.result`` / ``feedback.check`` / ``evolve.*`` are never inferred.
* Prompt / tool-argument content is NOT emitted by default (T-00-09); ``args`` and
  ``result`` payloads are dropped unless ``record_content=True`` is passed.

The dotted attribute strings are mirrored deliberately from ``@lucid/hsc-schema``
(``HARNESS_ATTR`` / ``GEN_AI_ATTR``); Python cannot import the TS package, so the
strings are duplicated and kept in sync with ``docs/standard/attribute-registry.md``.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from quadrant import EMITTER_SPECIFIED_Y, quadrant_for

# ---------------------------------------------------------------------------
# Canonical attribute paths (mirrored from @lucid/hsc-schema HARNESS_ATTR /
# GEN_AI_ATTR — see docs/standard/attribute-registry.md). harness.* and gen_ai.*
# are strictly disjoint namespaces.
# ---------------------------------------------------------------------------
HARNESS_EVENT_TYPE = "harness.event_type"
HARNESS_PRINCIPLE = "harness.principle"
HARNESS_QUADRANT_X = "harness.quadrant.x"
HARNESS_QUADRANT_Y = "harness.quadrant.y"
HARNESS_MUTATED_STATE = "harness.mutated_state"
HARNESS_INFERRED = "harness.inferred"
HARNESS_VERSION = "harness.version"
HARNESS_CHANGE_MANIFEST_ID = "harness.change_manifest_id"

GEN_AI_OPERATION_NAME = "gen_ai.operation.name"
GEN_AI_PROVIDER_NAME = "gen_ai.provider.name"
GEN_AI_AGENT_NAME = "gen_ai.agent.name"
GEN_AI_AGENT_ID = "gen_ai.agent.id"
GEN_AI_REQUEST_MODEL = "gen_ai.request.model"
GEN_AI_USAGE_INPUT_TOKENS = "gen_ai.usage.input_tokens"
GEN_AI_USAGE_OUTPUT_TOKENS = "gen_ai.usage.output_tokens"
GEN_AI_TOOL_NAME = "gen_ai.tool.name"
GEN_AI_RESPONSE_FINISH_REASONS = "gen_ai.response.finish_reasons"

# Principle per HSC event type (spec §2 table). Mirrors the spec; the adapter
# never invents principles outside the 5-member set.
_PRINCIPLE_FOR_EVENT = {
    "context.load": "context",
    "plan.emit": "plan_execute",
    "task.slice": "one_at_a_time",
    "tool.call": "plan_execute",
    "feedback.check": "feedback",
    "verify.result": "feedback",
    "doc.encode": "codebase_docs",
    "evolve.propose": "feedback",
    "evolve.apply": "feedback",
    # `error` is cross-cutting (spec §3.3) and emitted as a span event, not via
    # this map.
}

# hermes's state-mutating tools (agent/tool_result_classification.py:
# FILE_MUTATING_TOOL_NAMES). A tool.call on one of these sets
# harness.mutated_state=true.
FILE_MUTATING_TOOL_NAMES = frozenset({"write_file", "patch"})

# HSC event types this adapter MUST NOT emit for hermes (expected absences,
# recorded in mapping.md). Guard rail: emitting one is a programming error.
EXPECTED_ABSENCES = frozenset(
    {"task.slice", "feedback.check", "verify.result", "evolve.propose", "evolve.apply"}
)


def _base_harness_attrs(event_type: str, quadrant_y: Optional[str] = None) -> Dict[str, Any]:
    """Build the mandatory harness.* attribute block for an event type.

    Sets event_type, principle, and quadrant.x/y from the OQ-02 table. For
    ``feedback.check`` (emitter-specified y) the caller supplies ``quadrant_y``.
    For untagged actions (tool.call, error) x/y are None.
    """
    if event_type in EXPECTED_ABSENCES:
        raise ValueError(
            f"refusing to emit {event_type!r}: it is an expected absence for hermes "
            "(see adapters/hermes/mapping.md; D-05)."
        )
    x, y = quadrant_for(event_type)
    if event_type in EMITTER_SPECIFIED_Y:
        y = quadrant_y  # emitter MUST supply it
    attrs: Dict[str, Any] = {
        HARNESS_EVENT_TYPE: event_type,
        HARNESS_PRINCIPLE: _PRINCIPLE_FOR_EVENT[event_type],
        HARNESS_QUADRANT_X: x,
        HARNESS_QUADRANT_Y: y,
    }
    return attrs


class HermesHSCAdapter:
    """Wires hermes-agent callbacks to HSC v0 OTel spans.

    Args:
        tracer: an OTel ``Tracer`` (from a provider configured with a
            ``FileSpanExporter`` / ``InMemorySpanExporter`` via a span processor).
        harness_id: harness identity (default ``"hermes"``).
        harness_version: harness build version (e.g. ``"0.16.0"``).
        provider_name: model provider name for the turn-level agent span.
        record_content: if False (default), prompt/tool-argument/result content is
            NOT recorded on spans (T-00-09 information-disclosure mitigation).
    """

    def __init__(
        self,
        tracer: Any,
        *,
        harness_id: str = "hermes",
        harness_version: Optional[str] = None,
        provider_name: Optional[str] = None,
        record_content: bool = False,
    ) -> None:
        self._tracer = tracer
        self._harness_id = harness_id
        self._harness_version = harness_version
        self._provider_name = provider_name
        self._record_content = record_content
        # Open tool spans keyed by hermes tool_call_id.
        self._open_tool_spans: Dict[str, Any] = {}

    # -- internal helpers --------------------------------------------------

    def _start(self, name: str, attrs: Dict[str, Any]) -> Any:
        span = self._tracer.start_span(name)
        if self._harness_version is not None:
            attrs.setdefault(HARNESS_VERSION, self._harness_version)
        for key, value in attrs.items():
            if value is not None:
                span.set_attribute(key, value)
        return span

    # -- hermes callback taps ---------------------------------------------

    def on_tool_start(self, tool_call_id: str, name: str, args: Any) -> Any:
        """hermes ``tool_start_callback(tool_call_id, name, args)``.

        Starts a ``tool.call`` span (OTel ``execute_tool``). Tool-argument content
        is dropped unless ``record_content`` is set (T-00-09). ``mutated_state`` is
        set on completion (we know success/landing only then).
        """
        attrs = _base_harness_attrs("tool.call")
        attrs[GEN_AI_OPERATION_NAME] = "execute_tool"
        attrs[GEN_AI_TOOL_NAME] = name
        span = self._start(f"execute_tool {name}", attrs)
        self._open_tool_spans[tool_call_id] = (span, name)
        return span

    def on_tool_complete(
        self, tool_call_id: str, name: str, args: Any, result: Any
    ) -> None:
        """hermes ``tool_complete_callback(tool_call_id, name, args, result)``.

        Sets ``harness.mutated_state`` from ``FILE_MUTATING_TOOL_NAMES`` and ends
        the span. It deliberately does NOT emit a ``verify.result`` even when the
        tool reports success: a successful write is not verification (D-05,
        RESEARCH Pitfall 3). The absence is the signal.
        """
        entry = self._open_tool_spans.pop(tool_call_id, None)
        span = entry[0] if entry else None
        if span is None:
            return
        mutated = name in FILE_MUTATING_TOOL_NAMES
        span.set_attribute(HARNESS_MUTATED_STATE, mutated)
        span.end()

    def on_step(self, api_call_count: int, prev_tools: Any = None) -> Any:
        """hermes ``step_callback(api_call_count, prev_tools)``.

        Emits/updates the turn-level ``invoke_agent`` (INTERNAL) span. For the
        Phase 0 capture this is represented as an LLM ``chat`` request span; the
        turn span is created once via :meth:`start_turn`.
        """
        return None

    def start_turn(self, model: Optional[str] = None, agent_id: Optional[str] = None) -> Any:
        """Open the enclosing turn-level ``invoke_agent`` (INTERNAL) span.

        Reuses ``gen_ai.agent.name`` / ``gen_ai.agent.id`` / ``gen_ai.provider.name``
        (otel-mapping turn-level row). This is an OTel agentic-core span; it carries
        no HSC event_type of its own and is the parent of the HSC event spans.
        """
        span = self._tracer.start_span("invoke_agent hermes")
        span.set_attribute(GEN_AI_OPERATION_NAME, "invoke_agent")
        span.set_attribute(GEN_AI_AGENT_NAME, self._harness_id)
        if agent_id is not None:
            span.set_attribute(GEN_AI_AGENT_ID, agent_id)
        if self._provider_name is not None:
            span.set_attribute(GEN_AI_PROVIDER_NAME, self._provider_name)
        if model is not None:
            span.set_attribute(GEN_AI_REQUEST_MODEL, model)
        return span

    def emit_llm_chat(
        self,
        *,
        model: Optional[str] = None,
        input_tokens: Optional[int] = None,
        output_tokens: Optional[int] = None,
        finish_reasons: Optional[list] = None,
    ) -> Any:
        """Emit a ``context.load`` span backed by an OTel ``chat`` LLM call.

        Per otel-mapping, ``context.load`` projects onto the ``chat`` operation and
        reuses ``gen_ai.request.model`` + ``gen_ai.usage.input_tokens``. When the
        token count is INFERRED from API usage (no explicit context-assembly hook
        fired, e.g. via hermes' ``pre_llm_call``), set ``harness.inferred=true`` via
        :meth:`emit_inferred_context_load` instead.
        """
        attrs = _base_harness_attrs("context.load")
        attrs[GEN_AI_OPERATION_NAME] = "chat"
        attrs[GEN_AI_REQUEST_MODEL] = model
        attrs[GEN_AI_USAGE_INPUT_TOKENS] = input_tokens
        attrs[GEN_AI_USAGE_OUTPUT_TOKENS] = output_tokens
        if finish_reasons is not None:
            attrs[GEN_AI_RESPONSE_FINISH_REASONS] = finish_reasons
        span = self._start("chat context.load", attrs)
        span.end()
        return span

    def emit_inferred_context_load(
        self, *, input_tokens: int, model: Optional[str] = None
    ) -> Any:
        """Emit an INFERRED ``context.load`` (token count only) — OQ-03 §5.1.

        Permitted ONLY when no explicit context-assembly hook fires and the token
        count is derived from API usage (hermes ``pre_llm_call`` /
        ``context_compressor.last_prompt_tokens``). Carries ``harness.inferred=true``.
        """
        attrs = _base_harness_attrs("context.load")
        attrs[GEN_AI_OPERATION_NAME] = "chat"
        attrs[GEN_AI_USAGE_INPUT_TOKENS] = input_tokens
        attrs[GEN_AI_REQUEST_MODEL] = model
        attrs[HARNESS_INFERRED] = True
        span = self._start("chat context.load (inferred)", attrs)
        span.end()
        return span

    def emit_inferred_plan(
        self, *, model: Optional[str] = None, finish_reasons: Optional[list] = None
    ) -> Any:
        """Emit an INFERRED ``plan.emit`` from a reasoning scratchpad — OQ-03 §5.1.

        hermes ``reasoning_callback`` surfaces REASONING_SCRATCHPAD content; when it
        contains step-structured reasoning, the adapter infers ``plan.emit`` and
        flags ``harness.inferred=true``. Projects onto the ``chat`` operation.
        """
        attrs = _base_harness_attrs("plan.emit")
        attrs[GEN_AI_OPERATION_NAME] = "chat"
        attrs[GEN_AI_REQUEST_MODEL] = model
        if finish_reasons is not None:
            attrs[GEN_AI_RESPONSE_FINISH_REASONS] = finish_reasons
        attrs[HARNESS_INFERRED] = True
        span = self._start("chat plan.emit (inferred)", attrs)
        span.end()
        return span

    def emit_doc_encode(self, *, tool_name: str = "write_file") -> Any:
        """Emit a ``doc.encode`` span (durable-knowledge write).

        NOTE: in hermes, skill/knowledge writes go through the ``write_file`` tool
        and overlap with ``tool.call`` — ``doc.encode`` as a *distinct* event is an
        expected absence for the hermes baseline (mapping.md). This helper exists for
        adapters/harnesses that DO expose a distinct doc-encode hook; the hermes
        reference run does not call it.
        """
        attrs = _base_harness_attrs("doc.encode")
        span = self._start("doc.encode", attrs)
        span.end()
        return span

    def on_event(self, event_type: str, data: Any, *, enclosing_span: Any = None) -> None:
        """hermes ``event_callback(event_type, data)`` — surface ``error`` events.

        An HSC ``error`` is emitted as a span EVENT (``span.add_event("error", ...)``)
        carrying ``harness.event_type="error"``, NOT by setting OTel span status
        (otel-mapping anti-pattern; RESEARCH Pitfall 1). ``error`` has no quadrant
        and no principle of its own (cross-cutting, spec §3.3).
        """
        if event_type != "error" or enclosing_span is None:
            return
        message = ""
        if isinstance(data, dict):
            message = str(data.get("message", ""))
        enclosing_span.add_event(
            "error",
            {
                HARNESS_EVENT_TYPE: "error",
                "error.message": message if self._record_content else "",
            },
        )
