/**
 * Schema contract test for `RewardDatasetSchema` (Wave 0, plan 05-01).
 *
 * Pins the two HARD boundaries: ON-POLICY prompts-only via `.strict()` (T-05-01)
 * and REWARD-IN-TS via `reward_source: "diagnostic"` (T-05-04), plus the
 * PRINCIPLES-derived breakdown keys.
 */

import { describe, it, expect } from "vitest";
import {
  RewardDatasetSchema,
  RewardEntrySchema,
  PROMPT_HASH_PREFIX,
} from "../../src/l2/schemas/reward-dataset.js";

/** A valid prompts-only dataset. */
function validDataset(): Record<string, unknown> {
  return {
    version: "1",
    job_id: "job-0001",
    reward_source: "diagnostic",
    reward_composition: { feedback: 0.5, context: 0.3, plan_execute: 0.2 },
    entries: [
      {
        prompt_hash: "sha256:aaa",
        prompt: "Write the file then verify it.",
        baseline_reward: 0.18,
        principle_breakdown: { feedback: 0.1, context: 0.4 },
      },
      {
        prompt_hash: "sha256:bbb",
        prompt: "Summarize the diff.",
        baseline_reward: 0.66,
        principle_breakdown: { feedback: 0.7 },
      },
    ],
  };
}

describe("RewardDatasetSchema", () => {
  it("exposes the W3 cross-language hash prefix", () => {
    expect(PROMPT_HASH_PREFIX).toBe("sha256:");
  });

  it("parses a valid prompts-only dataset", () => {
    const ds = RewardDatasetSchema.parse(validDataset());
    expect(ds.reward_source).toBe("diagnostic");
    expect(ds.entries).toHaveLength(2);
  });

  it("REJECTS an entry carrying a completion field (on-policy guard)", () => {
    const bad = validDataset() as any;
    bad.entries[0].completion = "the stored response text";
    expect(() => RewardDatasetSchema.parse(bad)).toThrow();
  });

  it("REJECTS an entry carrying a response / output_text field (on-policy guard)", () => {
    const withResponse = { ...validEntry(), response: "x" };
    expect(() => RewardEntrySchema.parse(withResponse)).toThrow();
    const withOutput = { ...validEntry(), output_text: "x" };
    expect(() => RewardEntrySchema.parse(withOutput)).toThrow();
  });

  it("REJECTS a principle_breakdown with a non-principle key", () => {
    const bad = validDataset() as any;
    bad.entries[0].principle_breakdown = { feedback: 0.1, not_a_principle: 0.2 };
    expect(() => RewardDatasetSchema.parse(bad)).toThrow();
  });

  it("REJECTS a reward_composition with a non-principle key", () => {
    const bad = { ...validDataset(), reward_composition: { feedback: 0.5, bogus: 0.5 } };
    expect(() => RewardDatasetSchema.parse(bad)).toThrow();
  });

  it("REJECTS a reward_source other than 'diagnostic' (reward-in-TS)", () => {
    const bad = { ...validDataset(), reward_source: "python_reward_model" };
    expect(() => RewardDatasetSchema.parse(bad)).toThrow();
  });

  it("REJECTS an entry with an empty prompt or empty prompt_hash", () => {
    expect(() => RewardEntrySchema.parse({ ...validEntry(), prompt: "" })).toThrow();
    expect(() => RewardEntrySchema.parse({ ...validEntry(), prompt_hash: "" })).toThrow();
  });
});

/** A valid standalone RewardEntry. */
function validEntry(): Record<string, unknown> {
  return {
    prompt_hash: "sha256:ccc",
    prompt: "Plan before executing.",
    baseline_reward: 0.42,
    principle_breakdown: { plan_execute: 0.5 },
  };
}
