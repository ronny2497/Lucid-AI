/**
 * GREEN as of Plan 02-03.
 *
 * Exhaustive unit coverage for `buildPlot` (the 2×2 plotter):
 *   - correct cell placement for each quadrant-tagged event,
 *   - exclusion of `tool.call` / `error` (quadrantFor null/null) from all cells,
 *   - `feedback.check` y resolved from the emitter-set value (NOT auto-assigned),
 *   - `emptyColumns` / `emptyRows` for a full-quadrant trace vs a feedforward-only one,
 *   - the returned object validates against `Plot2x2Schema`,
 *   - `buildPlot` is pure (does not mutate its input).
 *
 * Event-type, quadrant, and attribute-path values come from `@lucid/hsc-schema`
 * constants — no bare HSC literal is written where a constant exists.
 */

import { describe, it, expect } from "vitest";
import { HARNESS_ATTR, quadrantFor } from "@lucid/hsc-schema";
import type { HscEventType } from "@lucid/hsc-schema";
import { buildPlot } from "../../src/plotter/index.js";
import { Plot2x2Schema } from "../../src/schema.js";

/** Build a structured-ish flat event record keyed on HSC attribute constants. */
function ev(
  id: string,
  eventType: HscEventType,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    eventId: id,
    eventType,
    [HARNESS_ATTR.eventType]: eventType,
    ...extra,
  };
}

/** Wrap raw events in the flat trace shape `buildPlot` accepts. */
function trace(events: Record<string, unknown>[]): { turns: { events: Record<string, unknown>[] }[] } {
  return { turns: [{ events }] };
}

describe("buildPlot — 2×2 binning", () => {
  it("places each quadrant-tagged event in exactly one cell via quadrantFor", () => {
    const plot = buildPlot(
      trace([
        ev("e1", "context.load"), // feedforward_computational
        ev("e2", "plan.emit"), // feedforward_inferential
        ev("e3", "verify.result"), // feedback_computational
        ev("e4", "evolve.propose"), // feedback_inferential
      ]),
    );

    expect(plot.cells.feedforward_computational.count).toBe(1);
    expect(plot.cells.feedforward_inferential.count).toBe(1);
    expect(plot.cells.feedback_computational.count).toBe(1);
    expect(plot.cells.feedback_inferential.count).toBe(1);

    expect(plot.cells.feedforward_computational.eventTypes).toContain("context.load");
    expect(plot.cells.feedback_inferential.eventTypes).toContain("evolve.propose");
  });

  it("accumulates count and dedupes eventTypes within a cell", () => {
    const plot = buildPlot(
      trace([
        ev("e1", "context.load"),
        ev("e2", "task.slice"),
        ev("e3", "doc.encode"),
        ev("e4", "context.load"), // same type repeated
      ]),
    );

    // context.load, task.slice, doc.encode all map to feedforward_computational.
    expect(plot.cells.feedforward_computational.count).toBe(4);
    const types = plot.cells.feedforward_computational.eventTypes;
    expect(new Set(types)).toEqual(new Set(["context.load", "task.slice", "doc.encode"]));
    expect(types).toHaveLength(3); // deduped
  });

  it("excludes tool.call and error events from every cell (absence is signal)", () => {
    // Sanity: quadrantFor agrees these have no quadrant.
    expect(quadrantFor("tool.call")).toEqual({ x: null, y: null });
    expect(quadrantFor("error")).toEqual({ x: null, y: null });

    const plot = buildPlot(
      trace([
        ev("e1", "context.load"),
        ev("e2", "tool.call", { [HARNESS_ATTR.mutatedState]: true }),
        ev("e3", "error"),
      ]),
    );

    const total = Object.values(plot.cells).reduce((n, c) => n + c.count, 0);
    expect(total).toBe(1); // only context.load binned
    for (const cell of Object.values(plot.cells)) {
      expect(cell.eventTypes).not.toContain("tool.call");
      expect(cell.eventTypes).not.toContain("error");
    }
  });

  it("does not let an invalid (non-enum) emitter quadrant fabricate a cell (T-02-06)", () => {
    const plot = buildPlot(
      trace([
        // tool.call has no quadrant; an adversarial x must not place it.
        ev("e1", "tool.call", {
          [HARNESS_ATTR.quadrantX]: "sideways",
          [HARNESS_ATTR.quadrantY]: "diagonal",
        }),
      ]),
    );
    const total = Object.values(plot.cells).reduce((n, c) => n + c.count, 0);
    expect(total).toBe(0);
  });

  describe("feedback.check (EMITTER_SPECIFIED_Y)", () => {
    it("bins feedback.check using the emitter-set quadrant.y", () => {
      const plot = buildPlot(
        trace([
          ev("e1", "feedback.check", {
            [HARNESS_ATTR.quadrantX]: "feedback",
            [HARNESS_ATTR.quadrantY]: "inferential",
          }),
        ]),
      );
      expect(plot.cells.feedback_inferential.count).toBe(1);
      expect(plot.cells.feedback_inferential.eventTypes).toContain("feedback.check");
    });

    it("excludes feedback.check when its y is absent (never auto-assigned)", () => {
      // quadrantFor leaves feedback.check y null (emitter-specified).
      expect(quadrantFor("feedback.check")).toEqual({ x: "feedback", y: null });

      const plot = buildPlot(
        trace([
          ev("e1", "feedback.check", {
            [HARNESS_ATTR.quadrantX]: "feedback",
            // no quadrant.y → unbinnable on the y-axis
          }),
        ]),
      );
      const total = Object.values(plot.cells).reduce((n, c) => n + c.count, 0);
      expect(total).toBe(0);
    });
  });

  describe("empty column / row detection", () => {
    it("reports no empty columns/rows for a full-quadrant trace", () => {
      const plot = buildPlot(
        trace([
          ev("e1", "context.load"), // ff_comp
          ev("e2", "plan.emit"), // ff_inf
          ev("e3", "verify.result"), // fb_comp
          ev("e4", "evolve.propose"), // fb_inf
        ]),
      );
      expect(plot.emptyColumns).toEqual([]);
      expect(plot.emptyRows).toEqual([]);
    });

    it("reports feedback empty for a feedforward-only trace", () => {
      const plot = buildPlot(
        trace([
          ev("e1", "context.load"),
          ev("e2", "plan.emit"),
          ev("e3", "task.slice"),
        ]),
      );
      expect(plot.emptyColumns).toEqual(["feedback"]);
      // both feedforward rows present (computational + inferential) → no empty rows
      expect(plot.emptyRows).toEqual([]);
    });

    it("reports an empty inferential row when only computational events exist", () => {
      const plot = buildPlot(
        trace([
          ev("e1", "context.load"), // ff_comp
          ev("e2", "verify.result"), // fb_comp
        ]),
      );
      expect(plot.emptyRows).toEqual(["inferential"]);
      expect(plot.emptyColumns).toEqual([]);
    });
  });

  it("returns a value that validates against Plot2x2Schema", () => {
    const plot = buildPlot(
      trace([ev("e1", "context.load"), ev("e2", "evolve.propose")]),
    );
    expect(() => Plot2x2Schema.parse(plot)).not.toThrow();
  });

  it("is pure — does not mutate the input trace", () => {
    const input = trace([ev("e1", "context.load"), ev("e2", "tool.call")]);
    const snapshot = JSON.stringify(input);
    buildPlot(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("accepts a flat HarnessEvent[] input shape", () => {
    const plot = buildPlot([ev("e1", "context.load"), ev("e2", "evolve.propose")] as never);
    expect(plot.cells.feedforward_computational.count).toBe(1);
    expect(plot.cells.feedback_inferential.count).toBe(1);
  });
});
