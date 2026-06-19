/**
 * RED -> GREEN: EventRow renders principle + quadrant badges with honest-absence
 * handling (D-05 / T-01-14) and escapes attribute content (T-01-13).
 *
 * - A feedback.check event with quadrant.x="feedback" and absent quadrant.y must
 *   render a "feedback" badge AND an explicit "absent" y-badge — never a
 *   fabricated value.
 * - Attribute values containing HTML (e.g. "<b>x</b>") must render as literal
 *   escaped text, NOT as live DOM (no raw-HTML injection prop).
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventRow } from "../EventRow.js";
import type { HarnessEvent } from "../../api/types.js";

const feedbackCheckAbsentY: HarnessEvent = {
  eventId: "ev-1",
  traceId: "trace-aaa",
  parentId: null,
  eventType: "feedback.check",
  principle: "feedback",
  quadrantX: "feedback",
  quadrantY: null, // honest absence — emitter-specified, not yet tagged
  startTime: 0,
  endTime: 1_000_000,
  statusCode: 0,
  attrs: {
    "harness.note": "<b>injected</b>",
  },
};

describe("EventRow", () => {
  it("renders the event type and principle badge", () => {
    render(<EventRow event={feedbackCheckAbsentY} />);
    expect(screen.getByText("feedback.check")).toBeInTheDocument();
    // principle badge
    expect(screen.getByText("feedback", { selector: "*" })).toBeTruthy();
  });

  it("renders an explicit 'absent' y-badge when quadrant.y is missing", () => {
    render(<EventRow event={feedbackCheckAbsentY} />);
    // The honest-absence marker must be present and visible.
    expect(screen.getByText(/absent/i)).toBeInTheDocument();
    // It must NOT fabricate a computational/inferential y value.
    expect(screen.queryByText("computational")).not.toBeInTheDocument();
    expect(screen.queryByText("inferential")).not.toBeInTheDocument();
  });

  it("renders the quadrant.x value as a badge", () => {
    render(<EventRow event={feedbackCheckAbsentY} />);
    // feedback appears as the x-quadrant (and as principle); at least one node.
    expect(screen.getAllByText("feedback").length).toBeGreaterThan(0);
  });

  it("renders attribute content as escaped text, not live HTML (T-01-13)", () => {
    const { container } = render(<EventRow event={feedbackCheckAbsentY} />);
    // The literal string is shown to the user...
    expect(screen.getByText("<b>injected</b>")).toBeInTheDocument();
    // ...and NO real <b> element was injected from the attribute value.
    expect(container.querySelector("b")).toBeNull();
  });
});
