/**
 * RED until Plan 02-03.
 *
 * The 2x2 plotter bins tagged events into the four quadrant cells and reports
 * empty columns/rows. For the empty-feedback fixture (no feedback-tagged events),
 * `buildPlot` MUST list "feedback" in `emptyColumns`. The import resolves once
 * 02-03 creates `src/plotter/index.ts`.
 */

import { describe, it, expect } from "vitest";
// @ts-expect-error — implemented in Plan 02-03 (RED scaffold).
import { buildPlot } from "../../src/plotter/index.js";
import emptyFeedback from "../fixtures/golden-trace-empty-feedback.json" with { type: "json" };
import fullFeedback from "../fixtures/golden-trace-full-feedback.json" with { type: "json" };
import { emptyFeedbackExpectation, fullFeedbackExpectation } from "../fixtures/expectations.js";

describe("buildPlot empty-column detection", () => {
  it("reports the feedback column empty when no feedback-tagged events exist", () => {
    const plot = buildPlot(emptyFeedback as never);
    expect(plot.emptyColumns).toEqual(emptyFeedbackExpectation.emptyColumns);
  });

  it("reports no empty columns when both columns are populated (full-feedback)", () => {
    const plot = buildPlot(fullFeedback as never);
    expect(plot.emptyColumns).toEqual(fullFeedbackExpectation.emptyColumns);
  });
});
