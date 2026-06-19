import { describe, expect, it } from "vitest";

import { ConformanceReportSchema } from "../src/report.js";

/**
 * RED scaffold for the ConformanceReport schema (REQ-07).
 *
 * Pins: a fully-populated report parses; the PASS-vs-failing-layer cross-field
 * refinement rejects an inconsistent report; unknown extra keys are rejected
 * (strict). This is the badge contract that 06-02's suite must emit against.
 */

function passingLayer() {
  return { pass: true, checks: 3, passed: 3, errors: [] };
}

function baseReport() {
  return {
    hscVersion: "v0",
    suiteVersion: "0.0.0",
    adapter: { name: "hermes", hscVersion: "v0" },
    layers: {
      otelValidity: passingLayer(),
      hscExtension: passingLayer(),
      behavioralHonesty: passingLayer(),
    },
    verdict: "PASS" as const,
    errors: [],
    generatedAt: "2026-06-19T00:00:00.000Z",
  };
}

describe("ConformanceReportSchema", () => {
  it("parses a fully-populated PASS report", () => {
    const parsed = ConformanceReportSchema.safeParse(baseReport());
    expect(parsed.success).toBe(true);
  });

  it("parses a FAIL report with layer errors", () => {
    const report = baseReport();
    report.verdict = "FAIL" as never;
    report.layers.hscExtension = {
      pass: false,
      checks: 3,
      passed: 2,
      errors: [
        {
          code: "wrong-principle",
          message: "principle for tool.call must be plan_execute",
          path: "/turns/0/events/2/harness.principle",
          layer: "hscExtension",
          severity: "error",
        },
      ],
    } as never;
    report.errors = report.layers.hscExtension.errors as never;
    const parsed = ConformanceReportSchema.safeParse(report);
    expect(parsed.success).toBe(true);
  });

  it("REJECTS a report whose verdict is PASS while a layer is failing", () => {
    const report = baseReport();
    report.layers.behavioralHonesty = {
      pass: false,
      checks: 2,
      passed: 1,
      errors: [
        {
          code: "fabricated-event",
          message: "adapter fabricated a verify.result",
          layer: "behavioralHonesty",
          severity: "error",
        },
      ],
    } as never;
    const parsed = ConformanceReportSchema.safeParse(report);
    expect(parsed.success).toBe(false);
  });

  it("REJECTS an unknown extra top-level key (strict)", () => {
    const report = { ...baseReport(), extraneous: true };
    const parsed = ConformanceReportSchema.safeParse(report);
    expect(parsed.success).toBe(false);
  });

  it("REJECTS an unknown key nested in a layer result (strict)", () => {
    const report = baseReport();
    (report.layers.otelValidity as Record<string, unknown>).bogus = 1;
    const parsed = ConformanceReportSchema.safeParse(report);
    expect(parsed.success).toBe(false);
  });
});
