/**
 * AutonomyConfigSchema — conservative defaults + the ADR-0004 L1/L2 boundary
 * (Task 2, REQ-05 / T-04-02).
 */

import { describe, it, expect } from "vitest";

import { AutonomyConfigSchema } from "../../src/apply-config.js";

describe("AutonomyConfigSchema", () => {
  it("parses an absent/empty config to the all-defaults object (autonomy L0)", () => {
    const cfg = AutonomyConfigSchema.parse({});
    expect(cfg.autonomy).toBe("L0");
    expect(cfg.require_human_approval).toBe(true);
    expect(cfg.rollback).toBe("auto");
    expect(cfg.guard.regression_metric).toBe("success");
    expect(cfg.guard.min_delta).toBe(0);
    expect(cfg.guard.sample).toBe(200);
    expect(cfg.trainer).toBeNull();
    expect(cfg.version_retention).toBe(10);
    expect(cfg.allow_change_types).toEqual([
      "add-gate",
      "trim-context",
      "edit-skill",
      "prompt-patch",
      "delete-layer",
    ]);
  });

  it("REJECTS a non-null trainer when autonomy !== \"L2\" (L1)", () => {
    expect(() =>
      AutonomyConfigSchema.parse({ autonomy: "L1", trainer: { plugin: "grpo" } }),
    ).toThrow();
  });

  it("REJECTS a non-null trainer at L0", () => {
    expect(() =>
      AutonomyConfigSchema.parse({ autonomy: "L0", trainer: { plugin: "x" } }),
    ).toThrow();
  });

  it("ACCEPTS a non-null trainer when autonomy === \"L2\" (the boundary, not a feature)", () => {
    const cfg = AutonomyConfigSchema.parse({
      autonomy: "L2",
      trainer: { plugin: "grpo" },
    });
    expect(cfg.autonomy).toBe("L2");
    expect(cfg.trainer).not.toBeNull();
  });

  it("REJECTS an invalid regression_metric", () => {
    expect(() =>
      AutonomyConfigSchema.parse({ guard: { regression_metric: "not-a-metric" } }),
    ).toThrow();
  });

  it("ACCEPTS \"success\" and any canonical PRINCIPLES value as regression_metric", () => {
    expect(AutonomyConfigSchema.parse({ guard: { regression_metric: "success" } }).guard.regression_metric).toBe("success");
    expect(AutonomyConfigSchema.parse({ guard: { regression_metric: "feedback" } }).guard.regression_metric).toBe("feedback");
    expect(AutonomyConfigSchema.parse({ guard: { regression_metric: "context" } }).guard.regression_metric).toBe("context");
  });
});
