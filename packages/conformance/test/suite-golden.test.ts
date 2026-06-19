import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { runConformanceSuite } from "../src/suite.js";
import { ConformanceReportSchema } from "../src/report.js";
import { GOLDEN_CORPUS } from "../src/golden/index.js";

/**
 * The suite-golden test — the CODIFIED Phase 6 exit criterion (EC-2).
 *
 * Runs runConformanceSuite over EVERY GOLDEN_CORPUS entry and asserts:
 *   - the assembled report is schema-valid (parses against ConformanceReportSchema);
 *   - the suite's verdict reproduces the entry's recorded expectedVerdict
 *     (PASS / FAIL; behavioral NA entries are asserted separately below);
 *   - each fail entry's report.errors include every declared expectedErrorTag.
 *
 * This is the regression gate that pins the whole conformance contract: any
 * future edit that makes the suite disagree with a recorded verdict breaks here.
 */

const here = dirname(fileURLToPath(import.meta.url));
const goldenDir = join(here, "..", "src", "golden");

function loadTrace(traceRef: string): unknown {
  return JSON.parse(readFileSync(join(goldenDir, traceRef), "utf8"));
}

function errorCodes(report: { errors: { code: string }[] }): Set<string> {
  return new Set(report.errors.map((e) => e.code));
}

describe("runConformanceSuite — every golden corpus entry reproduces its verdict", () => {
  for (const entry of GOLDEN_CORPUS) {
    it(`[${entry.category}] ${entry.id} → ${entry.expectedVerdict}`, () => {
      const trace = loadTrace(entry.traceRef);
      const report = runConformanceSuite(trace, {
        hscVersion: "v0",
        adapter: { name: "hermes", hscVersion: "v0" },
      });

      // The report is always schema-valid.
      expect(ConformanceReportSchema.safeParse(report).success).toBe(true);

      if (entry.expectedVerdict === "PASS") {
        expect(report.verdict).toBe("PASS");
      } else if (entry.expectedVerdict === "FAIL") {
        expect(report.verdict).toBe("FAIL");
        const codes = errorCodes(report);
        for (const tag of entry.expectedErrorTags) {
          expect(codes.has(tag)).toBe(true);
        }
      }
      // NA (behavioral scenarios) verdict is asserted in the dedicated block below.
    });
  }
});

describe("runConformanceSuite — behavioral scenarios (NA) honor absence-is-signal", () => {
  it("behavioral-absence-preserved PASSES the behavioral layer (honest absence)", () => {
    const entry = GOLDEN_CORPUS.find((e) => e.id === "behavioral-absence-preserved");
    expect(entry).toBeDefined();
    const report = runConformanceSuite(loadTrace(entry!.traceRef), {
      hscVersion: "v0",
      adapter: { name: "hermes", hscVersion: "v0" },
    });
    expect(report.layers.behavioralHonesty.pass).toBe(true);
  });

  it("behavioral-no-inferred-evolve PASSES the behavioral layer (no prohibited inference)", () => {
    const entry = GOLDEN_CORPUS.find((e) => e.id === "behavioral-no-inferred-evolve");
    expect(entry).toBeDefined();
    const report = runConformanceSuite(loadTrace(entry!.traceRef), {
      hscVersion: "v0",
      adapter: { name: "hermes", hscVersion: "v0" },
    });
    expect(report.layers.behavioralHonesty.pass).toBe(true);
  });
});

describe("runConformanceSuite — absence-is-signal PASS across all three layers", () => {
  it("the honest-absence pass trace passes Layers 1, 2 AND 3", () => {
    const entry = GOLDEN_CORPUS.find((e) => e.id === "pass-honest-absence");
    expect(entry).toBeDefined();
    const report = runConformanceSuite(loadTrace(entry!.traceRef), {
      hscVersion: "v0",
      adapter: { name: "hermes", hscVersion: "v0" },
    });
    expect(report.layers.otelValidity.pass).toBe(true);
    expect(report.layers.hscExtension.pass).toBe(true);
    expect(report.layers.behavioralHonesty.pass).toBe(true);
    expect(report.verdict).toBe("PASS");
  });
});
