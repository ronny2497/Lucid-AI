"""quadrant_for() — the OQ-02 quadrant predicate, mirrored from @lucid/hsc-schema.

hermes (and this adapter) is Python and cannot import the TypeScript
``@lucid/hsc-schema`` package, so the OQ-02 table is duplicated here
DELIBERATELY. The canonical source of truth is ``quadrantFor()`` /
``QUADRANT_TABLE`` in ``packages/hsc-schema/src/quadrant.ts`` and the spec table
in ``docs/standard/hsc-v0-spec.md`` §3.2. These three MUST agree byte-for-byte;
the Plan 00-04 checkpoint cross-checks them (warning #4).

x-axis: feedforward (control before action) vs. feedback (control after action).
y-axis: computational (deterministic) vs. inferential (model-judged).

``feedback.check`` is the single emitter-specified-y event: its y can be either
computational or inferential, so ``quadrant_for`` returns ``y=None`` and lists it
in ``EMITTER_SPECIFIED_Y``. The emitter MUST set ``harness.quadrant.y`` explicitly
on every ``feedback.check`` event (spec §3.2.1). ``tool.call`` and ``error`` carry
``(None, None)`` by design (untagged actions / cross-cutting).
"""

from __future__ import annotations

from typing import Optional, Tuple

# The 10 HSC v0 event types (D-04). Mirrors EVENT_TYPES in @lucid/hsc-schema.
EVENT_TYPES: Tuple[str, ...] = (
    "context.load",
    "plan.emit",
    "task.slice",
    "tool.call",
    "feedback.check",
    "verify.result",
    "doc.encode",
    "evolve.propose",
    "evolve.apply",
    "error",
)

# Event types whose quadrant.y is emitter-specified (NOT auto-derived). Mirrors
# EMITTER_SPECIFIED_Y in @lucid/hsc-schema. Currently only feedback.check.
EMITTER_SPECIFIED_Y = frozenset({"feedback.check"})

# OQ-02 spec table. Byte-for-byte mirror of QUADRANT_TABLE in
# packages/hsc-schema/src/quadrant.ts. feedback.check.y is recorded as None
# here (emitter-specified); tool.call / error carry (None, None) by design.
_QUADRANT_TABLE = {
    "context.load": ("feedforward", "computational"),
    "plan.emit": ("feedforward", "inferential"),
    "task.slice": ("feedforward", "computational"),
    "tool.call": (None, None),
    "feedback.check": ("feedback", None),  # y emitter-specified — not auto-assigned
    "verify.result": ("feedback", "computational"),
    "doc.encode": ("feedforward", "computational"),
    "evolve.propose": ("feedback", "inferential"),
    "evolve.apply": ("feedback", "computational"),
    "error": (None, None),
}


def quadrant_for(event_type: str) -> Tuple[Optional[str], Optional[str]]:
    """Return the deterministic ``(x, y)`` quadrant for an HSC event type.

    Mirrors ``quadrantFor()`` in ``@lucid/hsc-schema``. For ``feedback.check``,
    ``y`` is ``None`` (emitter-specified); the caller must supply it explicitly.

    Raises:
        KeyError: if ``event_type`` is not one of the 10 HSC v0 event types.
    """
    return _QUADRANT_TABLE[event_type]
