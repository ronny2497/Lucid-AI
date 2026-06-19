/**
 * Tests for `L2ConfigSchema` (plan 05-04).
 *
 * Pins the ADR-0004 boundary the L2 config carries:
 *   - defaults to autonomy L0 with a null trainer;
 *   - a non-null trainer at L0/L1 is REJECTED (config-parse error);
 *   - a non-null trainer at L2 parses;
 *   - reward.weights with a non-principle key is rejected;
 *   - reward.from defaults to "diagnostic" (reward-in-TS).
 */

import { describe, it, expect } from "vitest";
import { L2ConfigSchema } from "../../src/l2/l2-config.js";

/** A minimal valid promote_gate block (eval path is required, no default). */
const GATE = { eval: "/abs/holdout.jsonl" };

describe("L2ConfigSchema", () => {
  it("defaults to autonomy L0 with a null trainer", () => {
    const cfg = L2ConfigSchema.parse({ reward: { weights: {} }, promote_gate: GATE });
    expect(cfg.autonomy).toBe("L0");
    expect(cfg.trainer).toBeNull();
    expect(cfg.reward.from).toBe("diagnostic");
    expect(cfg.promote_gate.metric).toBe("success");
    expect(cfg.promote_gate.min_improvement).toBe(0.02);
  });

  it("REJECTS a non-null trainer at L0 (the ADR-0004 boundary)", () => {
    expect(() =>
      L2ConfigSchema.parse({
        autonomy: "L0",
        trainer: { plugin: "filesystem", base_model: "Qwen/Qwen2.5-0.5B" },
        reward: { weights: {} },
        promote_gate: GATE,
      }),
    ).toThrow();
  });

  it("REJECTS a non-null trainer at L1", () => {
    expect(() =>
      L2ConfigSchema.parse({
        autonomy: "L1",
        trainer: { plugin: "filesystem", base_model: "Qwen/Qwen2.5-0.5B" },
        reward: { weights: {} },
        promote_gate: GATE,
      }),
    ).toThrow();
  });

  it("PARSES a non-null trainer at L2", () => {
    const cfg = L2ConfigSchema.parse({
      autonomy: "L2",
      trainer: { plugin: "filesystem", base_model: "Qwen/Qwen2.5-0.5B" },
      reward: { weights: { feedback: 0.5, context: 0.5 } },
      promote_gate: { eval: "/abs/holdout.jsonl", min_improvement: 0.05 },
    });
    expect(cfg.autonomy).toBe("L2");
    expect(cfg.trainer).not.toBeNull();
    expect(cfg.trainer?.plugin).toBe("filesystem");
    expect(cfg.reward.weights.feedback).toBe(0.5);
    expect(cfg.promote_gate.min_improvement).toBe(0.05);
  });

  it("allows a null trainer at L2 (training not yet configured)", () => {
    const cfg = L2ConfigSchema.parse({
      autonomy: "L2",
      trainer: null,
      reward: { weights: {} },
      promote_gate: GATE,
    });
    expect(cfg.trainer).toBeNull();
  });

  it("REJECTS a reward.weights key that is not a canonical principle", () => {
    expect(() =>
      L2ConfigSchema.parse({
        autonomy: "L2",
        trainer: { plugin: "filesystem", base_model: "m" },
        reward: { weights: { not_a_principle: 0.5 } },
        promote_gate: GATE,
      }),
    ).toThrow();
  });

  it("REJECTS an empty trainer.base_model", () => {
    expect(() =>
      L2ConfigSchema.parse({
        autonomy: "L2",
        trainer: { plugin: "filesystem", base_model: "" },
        reward: { weights: {} },
        promote_gate: GATE,
      }),
    ).toThrow();
  });
});
