import { describe, it, expect } from "vitest";
import { EVENT_TYPES, type HscEventType } from "../src/index.js";

/**
 * Phase 5 (A5) registers the two L2 weight-level self-evolution audit event
 * types — `evolve.train` and `evolve.promote` — in the canonical `EVENT_TYPES`
 * tuple. They did not exist on disk before Phase 5. These tests pin that the two
 * new members are present, that the original ten are unchanged, and that the
 * derived `HscEventType` union widens to include the new strings (no hand-written
 * second union).
 */

const ORIGINAL_TEN = [
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
] as const;

describe("EVENT_TYPES — Phase 5 L2 audit event registration (A5)", () => {
  it("registers evolve.train and evolve.promote", () => {
    expect(EVENT_TYPES).toContain("evolve.train");
    expect(EVENT_TYPES).toContain("evolve.promote");
  });

  it("preserves all ten original D-04 members", () => {
    for (const original of ORIGINAL_TEN) {
      expect(EVENT_TYPES).toContain(original);
    }
  });

  it("contains exactly the original ten plus the two new L2 members (twelve total)", () => {
    expect(EVENT_TYPES).toHaveLength(12);
    expect(new Set(EVENT_TYPES)).toEqual(new Set([...ORIGINAL_TEN, "evolve.train", "evolve.promote"]));
  });

  it("keeps the evolve.* events grouped before the cross-cutting error event", () => {
    const idx = (t: HscEventType) => EVENT_TYPES.indexOf(t);
    expect(idx("evolve.train")).toBeGreaterThan(idx("evolve.apply"));
    expect(idx("evolve.promote")).toBeGreaterThan(idx("evolve.train"));
    expect(idx("error")).toBeGreaterThan(idx("evolve.promote"));
  });

  it("widens HscEventType to include the two new strings (type-level)", () => {
    // If these assignments compile, the derived union includes the new members.
    const train: HscEventType = "evolve.train";
    const promote: HscEventType = "evolve.promote";
    expect(train).toBe("evolve.train");
    expect(promote).toBe("evolve.promote");
  });
});
