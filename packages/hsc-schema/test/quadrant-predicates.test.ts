import { describe, it, expect } from "vitest";
import { quadrantFor, EMITTER_SPECIFIED_Y, EVENT_TYPES } from "../src/index.js";

/**
 * OQ-02 spec table (RESEARCH "OQ-02 Answer" full mapping table).
 *
 * | Event type      | quadrant.x  | quadrant.y          |
 * | context.load    | feedforward | computational       |
 * | plan.emit       | feedforward | inferential         |
 * | task.slice      | feedforward | computational       |
 * | tool.call       | null        | null                |
 * | feedback.check  | feedback    | emitter-specified   | (y MUST NOT be auto-assigned)
 * | verify.result   | feedback    | computational       |
 * | doc.encode      | feedforward | computational       |
 * | evolve.propose  | feedback    | inferential         |
 * | evolve.apply    | feedback    | computational       |
 * | evolve.train    | feedback    | inferential         | (Phase 5 L2)
 * | evolve.promote  | feedback    | computational       | (Phase 5 L2)
 * | error           | null        | null                |
 */

describe("quadrantFor — deterministic x/y per OQ-02 spec table", () => {
  it("context.load → feedforward / computational", () => {
    expect(quadrantFor("context.load")).toEqual({ x: "feedforward", y: "computational" });
  });

  it("plan.emit → feedforward / inferential", () => {
    expect(quadrantFor("plan.emit")).toEqual({ x: "feedforward", y: "inferential" });
  });

  it("task.slice → feedforward / computational", () => {
    expect(quadrantFor("task.slice")).toEqual({ x: "feedforward", y: "computational" });
  });

  it("tool.call → null / null (action; absence is the signal)", () => {
    expect(quadrantFor("tool.call")).toEqual({ x: null, y: null });
  });

  it("verify.result → feedback / computational", () => {
    expect(quadrantFor("verify.result")).toEqual({ x: "feedback", y: "computational" });
  });

  it("doc.encode → feedforward / computational", () => {
    expect(quadrantFor("doc.encode")).toEqual({ x: "feedforward", y: "computational" });
  });

  it("evolve.propose → feedback / inferential", () => {
    expect(quadrantFor("evolve.propose")).toEqual({ x: "feedback", y: "inferential" });
  });

  it("evolve.apply → feedback / computational", () => {
    expect(quadrantFor("evolve.apply")).toEqual({ x: "feedback", y: "computational" });
  });

  it("evolve.train → feedback / inferential (Phase 5 L2)", () => {
    expect(quadrantFor("evolve.train")).toEqual({ x: "feedback", y: "inferential" });
  });

  it("evolve.promote → feedback / computational (Phase 5 L2)", () => {
    expect(quadrantFor("evolve.promote")).toEqual({ x: "feedback", y: "computational" });
  });

  it("error → null / null (cross-cutting; no quadrant)", () => {
    expect(quadrantFor("error")).toEqual({ x: null, y: null });
  });
});

describe("feedback.check — emitter-specified y (MUST NOT auto-assign)", () => {
  it("returns x=feedback and does NOT auto-assign a non-null y", () => {
    const q = quadrantFor("feedback.check");
    expect(q.x).toBe("feedback");
    expect(q.y).toBeNull();
  });

  it("is flagged in EMITTER_SPECIFIED_Y", () => {
    expect(EMITTER_SPECIFIED_Y.has("feedback.check")).toBe(true);
  });

  it("is the ONLY event flagged emitter-specified for quadrant.y", () => {
    expect([...EMITTER_SPECIFIED_Y]).toEqual(["feedback.check"]);
  });
});

describe("quadrantFor covers every declared event type", () => {
  it("returns a defined {x,y} for every EVENT_TYPES member", () => {
    expect(EVENT_TYPES).toHaveLength(12);
    for (const et of EVENT_TYPES) {
      const q = quadrantFor(et);
      expect(q).toHaveProperty("x");
      expect(q).toHaveProperty("y");
    }
  });
});
