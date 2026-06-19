import { describe, it, expect } from "vitest";
import {
  EVENT_PRINCIPLE,
  EVENT_TYPES,
  PRINCIPLES,
  harnessTraceSchema,
} from "../src/index.js";

/**
 * EVENT_PRINCIPLE is the canonical event_type → principle binding (spec §2),
 * the single source of truth that kills the BL-02-class fixture drift. These
 * tests pin it to the spec and assert no enum drift between the TS constants and
 * the JSON Schema (LO-03).
 */
describe("EVENT_PRINCIPLE — canonical §2 binding", () => {
  it("binds every principle-bearing event type exactly as spec §2 (incl. the Phase 5 L2 events)", () => {
    expect(EVENT_PRINCIPLE).toEqual({
      "context.load": "context",
      "plan.emit": "plan_execute",
      "task.slice": "one_at_a_time",
      "tool.call": "plan_execute",
      "feedback.check": "feedback",
      "verify.result": "feedback",
      "doc.encode": "codebase_docs",
      "evolve.propose": "feedback",
      "evolve.apply": "feedback",
      "evolve.train": "feedback",
      "evolve.promote": "feedback",
    });
  });

  it("binds the two Phase 5 L2 audit events to the feedback principle (same as the evolve.* siblings)", () => {
    expect(EVENT_PRINCIPLE["evolve.train"]).toBe("feedback");
    expect(EVENT_PRINCIPLE["evolve.promote"]).toBe("feedback");
  });

  it("omits `error` (cross-cutting, §3.3 — no principle binding)", () => {
    expect("error" in EVENT_PRINCIPLE).toBe(false);
    expect(EVENT_PRINCIPLE["error"]).toBeUndefined();
  });

  it("every bound value is one of the 5 canonical PRINCIPLES", () => {
    for (const principle of Object.values(EVENT_PRINCIPLE)) {
      expect(PRINCIPLES).toContain(principle);
    }
  });

  it("covers every non-error event type", () => {
    const bound = Object.keys(EVENT_PRINCIPLE).sort();
    const expected = EVENT_TYPES.filter((t) => t !== "error").slice().sort();
    expect(bound).toEqual(expected);
  });
});

/**
 * LO-03: the JSON Schema enums are hand-authored copies of the TS constants.
 * Assert they cannot drift from EVENT_TYPES / PRINCIPLES.
 */
describe("schema enum ↔ TS constant parity (LO-03)", () => {
  const event = (harnessTraceSchema as any).$defs.HarnessEvent.properties;

  it("harness.event_type.enum deep-equals EVENT_TYPES", () => {
    expect(event["harness.event_type"].enum).toEqual([...EVENT_TYPES]);
  });

  it("harness.principle.enum deep-equals PRINCIPLES", () => {
    expect(event["harness.principle"].enum).toEqual([...PRINCIPLES]);
  });
});
