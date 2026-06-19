/**
 * Registry coverage test (Plan 02-02).
 *
 * Asserts the detector registry exposes exactly one addressable rule detector per
 * the five `PRINCIPLES`, the flagship is `defaultEnabled: true`, and every detector
 * is retrievable by its id via `getDetector`.
 */

import { describe, it, expect } from "vitest";
import { PRINCIPLES } from "@lucid/hsc-schema";
import {
  detectorRegistry,
  getDetector,
  NO_VERIFY_AFTER_MUTATION_ID,
} from "../../src/detectors/index.js";

describe("detectorRegistry", () => {
  it("registers at least one rule detector per principle, exactly one each here", () => {
    for (const principle of PRINCIPLES) {
      const forPrinciple = detectorRegistry.filter((d) => d.principle === principle);
      expect(forPrinciple.length, `principle ${principle} must have a detector`).toBe(1);
    }
  });

  it("every detector is a rule detector addressable by its id", () => {
    for (const d of detectorRegistry) {
      expect(d.kind).toBe("rule");
      expect(getDetector(d.id)).toBe(d);
    }
  });

  it("registry size equals the number of principles", () => {
    expect(detectorRegistry).toHaveLength(PRINCIPLES.length);
  });

  it("the flagship feedback detector is defaultEnabled", () => {
    const flagship = getDetector(NO_VERIFY_AFTER_MUTATION_ID);
    expect(flagship).toBeDefined();
    expect(flagship!.defaultEnabled).toBe(true);
    expect(flagship!.principle).toBe("feedback");
  });

  it("getDetector returns undefined for an unknown id", () => {
    expect(getDetector("does.not.exist")).toBeUndefined();
  });
});
