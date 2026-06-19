import { describe, expect, it } from "vitest";

import {
  GOLDEN_CORPUS,
  VIOLATION_TAG_SET,
  type GoldenEntry,
} from "../src/golden/index.js";

/**
 * RED scaffold for the golden-trace corpus INDEX (Phase 6, Wave 0 contract).
 *
 * Pins the structural invariants the index must hold so that 06-02 cannot drift
 * the corpus shape when it materializes the referenced trace files. Crucially,
 * it pins the ABSENCE-IS-SIGNAL invariant: at least one pass entry must declare
 * NO verify.result / feedback.check.
 */

const ABSENT_VERIFICATION = new Set(["verify.result", "feedback.check"]);

function entriesOfCategory(category: GoldenEntry["category"]): GoldenEntry[] {
  return GOLDEN_CORPUS.filter((e) => e.category === category);
}

describe("golden corpus index — categories & verdicts", () => {
  it("every entry has a category in {pass, fail, behavioral}", () => {
    expect(GOLDEN_CORPUS.length).toBeGreaterThan(0);
    for (const entry of GOLDEN_CORPUS) {
      expect(["pass", "fail", "behavioral"]).toContain(entry.category);
    }
  });

  it("entry ids are unique", () => {
    const ids = GOLDEN_CORPUS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("the corpus enumerates all three categories", () => {
    expect(entriesOfCategory("pass").length).toBeGreaterThan(0);
    expect(entriesOfCategory("fail").length).toBeGreaterThan(0);
    expect(entriesOfCategory("behavioral").length).toBeGreaterThan(0);
  });

  it("pass entries declare expectedVerdict PASS with no error tags", () => {
    for (const entry of entriesOfCategory("pass")) {
      expect(entry.expectedVerdict).toBe("PASS");
      expect(entry.expectedErrorTags).toHaveLength(0);
    }
  });

  it("fail entries declare expectedVerdict FAIL with at least one error tag", () => {
    for (const entry of entriesOfCategory("fail")) {
      expect(entry.expectedVerdict).toBe("FAIL");
      expect(entry.expectedErrorTags.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("golden corpus index — absence-is-signal (D-05)", () => {
  it("contains at least one PASS entry whose declared event set omits verify.result AND feedback.check", () => {
    const honestAbsence = entriesOfCategory("pass").filter(
      (e) => !e.declaredEvents.some((ev) => ABSENT_VERIFICATION.has(ev)),
    );
    // Absence-is-signal MUST remain representable: a pass trace with no
    // verification step is valid (HSC spec §4 / D-05).
    expect(honestAbsence.length).toBeGreaterThanOrEqual(1);
  });
});

describe("golden corpus index — violation-tag union closure", () => {
  it("every distinct expectedErrorTag is drawn from the documented union", () => {
    const used = new Set<string>();
    for (const entry of entriesOfCategory("fail")) {
      for (const tag of entry.expectedErrorTags) {
        used.add(tag);
      }
    }
    expect(used.size).toBeGreaterThan(0);
    for (const tag of used) {
      expect(VIOLATION_TAG_SET.has(tag)).toBe(true);
    }
  });

  it("no fail entry references a tag outside the union", () => {
    for (const entry of entriesOfCategory("fail")) {
      for (const tag of entry.expectedErrorTags) {
        expect(VIOLATION_TAG_SET.has(tag)).toBe(true);
      }
    }
  });
});
