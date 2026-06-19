import { describe, expect, it } from "vitest";

import { emitBadge } from "../src/badge.js";
import { ConformanceReportSchema, type ConformanceReport } from "../src/report.js";

/**
 * Badge emission coverage. The badge is the re-verifiable, self-declared claim:
 * it embeds hscVersion + suiteVersion + verdict + a report reference, and it
 * NEVER masks a FAIL (T-06-06 repudiation resistance).
 */

function passingLayer() {
  return { pass: true, checks: 3, passed: 3, errors: [] };
}

function passReport(): ConformanceReport {
  return ConformanceReportSchema.parse({
    hscVersion: "v0",
    suiteVersion: "0.1.0",
    adapter: { name: "hermes", hscVersion: "v0" },
    layers: {
      otelValidity: passingLayer(),
      hscExtension: passingLayer(),
      behavioralHonesty: passingLayer(),
    },
    verdict: "PASS",
    errors: [],
    generatedAt: "2026-06-19T00:00:00.000Z",
  });
}

function failReport(): ConformanceReport {
  const failingLayer = {
    pass: false,
    checks: 2,
    passed: 1,
    errors: [
      {
        code: "fabricated-event",
        message: "adapter fabricated a verify.result",
        layer: "behavioralHonesty" as const,
        severity: "error" as const,
      },
    ],
  };
  return ConformanceReportSchema.parse({
    hscVersion: "v0",
    suiteVersion: "0.1.0",
    adapter: { name: "sketchy", hscVersion: "v0" },
    layers: {
      otelValidity: passingLayer(),
      hscExtension: passingLayer(),
      behavioralHonesty: failingLayer,
    },
    verdict: "FAIL",
    errors: failingLayer.errors,
    generatedAt: "2026-06-19T00:00:00.000Z",
  });
}

describe("emitBadge — PASS report", () => {
  it("embeds hscVersion + suiteVersion + verdict + a report reference", () => {
    const badge = emitBadge(passReport());
    expect(badge.hscVersion).toBe("v0");
    expect(badge.suiteVersion).toBe("0.1.0");
    expect(badge.verdict).toBe("PASS");
    expect(badge.label).toBe("HSC v0");
    expect(badge.adapter).toEqual({ name: "hermes", hscVersion: "v0" });
    expect(badge.reportRef.verdict).toBe("PASS");
    expect(badge.reportRef.hscVersion).toBe("v0");
    expect(badge.reportRef.suiteVersion).toBe("0.1.0");
    expect(badge.reportRef.errorCount).toBe(0);
  });

  it("surfaces declared event coverage when provided", () => {
    const badge = emitBadge(passReport(), {
      eventCoverage: ["context.load", "plan.emit", "tool.call"],
    });
    expect(badge.eventCoverage).toEqual(["context.load", "plan.emit", "tool.call"]);
  });
});

describe("emitBadge — FAIL report (never masked)", () => {
  it("carries verdict FAIL and does not throw", () => {
    const badge = emitBadge(failReport());
    expect(badge.verdict).toBe("FAIL");
    expect(badge.reportRef.verdict).toBe("FAIL");
    expect(badge.reportRef.errorCount).toBe(1);
  });

  it("never asserts conformance on a FAIL report", () => {
    const badge = emitBadge(failReport());
    // The badge does not invent a PASS field or hide the verdict.
    expect(badge.verdict).not.toBe("PASS");
  });
});
