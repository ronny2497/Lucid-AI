/**
 * Tests for the reward computer (05-02, REQ-05).
 *
 * Pins the reward disciplines (RESEARCH "Reward From Principle/2×2 Scores",
 * Pitfall 2; threats T-05-07 / T-05-09):
 *   - NULL-IS-SIGNAL: a principle with score null OR coverage 0 is EXCLUDED from the
 *     scalar (never coerced to 0); weights renormalize over the covered principles.
 *   - ALL-NULL DROP: a trajectory whose every weighted principle is null returns null
 *     from computeRewards and is DROPPED by buildRewardDataset.
 *   - SCHEMA-VALID: buildRewardDataset output parses against RewardDatasetSchema
 *     (reward_source "diagnostic").
 *   - ZERO-VARIANCE ADVISORY: an all-identical reward set flags frac_low_variance.
 *
 * W3: a shared prompt→expected-hash fixture is asserted here so 05-04's Python
 * reward_bridge can assert the SAME fixture (prevents silent TS↔Python divergence).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import type { DiagnosticResult } from "@lucid/diagnostic";
import {
  computeRewards,
  buildRewardDataset,
  canonicalPromptHash,
  LOW_VARIANCE_EPS,
  type RewardWeights,
} from "../../src/l2/reward-computer.js";
import { RewardDatasetSchema } from "../../src/l2/schemas/reward-dataset.js";
import type { PromptRecord } from "../../src/l2/trajectory-exporter.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => join(HERE, "fixtures", name);

const sampleDiagnostic = (): DiagnosticResult =>
  JSON.parse(readFileSync(fixture("sample-diagnostic-result.json"), "utf8")) as DiagnosticResult;

/** Build a PromptRecord for a known prompt (hash via the canonical helper). */
function promptRecord(prompt: string, traceId: string): PromptRecord {
  return {
    prompt_hash: canonicalPromptHash(prompt),
    prompt,
    harness_version: "v42",
    trace_id: traceId,
    agent_id: "agent-1",
  };
}

describe("W3 cross-language prompt_hash contract", () => {
  it("canonicalPromptHash matches the shared fixture (TS↔Python pin)", () => {
    const f = JSON.parse(readFileSync(fixture("w3-prompt-hash.json"), "utf8")) as {
      prompt: string;
      expected_prompt_hash: string;
    };
    const actual = canonicalPromptHash(f.prompt);
    if (f.expected_prompt_hash === "PIN_ON_FIRST_RUN") {
      // Not yet frozen: print the canonical hash to paste into the fixture, and
      // assert shape only so the suite is GREEN before the pin is frozen.
      // eslint-disable-next-line no-console
      console.log(`[W3] Freeze the prompt_hash pin → expected_prompt_hash: ${actual}`);
      expect(actual).toMatch(/^sha256:[0-9a-f]{64}$/);
    } else {
      // Frozen: TS MUST reproduce the literal Python's reward_bridge also asserts.
      expect(actual).toBe(f.expected_prompt_hash);
    }
  });

  it("canonicalPromptHash equals the inline sha256 formula (no drift)", () => {
    const prompt = "Plan the task before invoking any state-mutating tool.";
    const expected = "sha256:" + createHash("sha256").update(prompt, "utf8").digest("hex");
    expect(canonicalPromptHash(prompt)).toBe(expected);
    expect(canonicalPromptHash(prompt)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("computeRewards", () => {
  it("EXCLUDES a null/zero-coverage principle (no null→0 coercion)", () => {
    const diag = sampleDiagnostic();
    // feedback.score = 0.18 (covered); one_at_a_time = null/coverage 0 (excluded).
    const weights: RewardWeights = { feedback: 0.5, one_at_a_time: 0.5 };
    const reward = computeRewards(diag, weights);
    // Renormalized over the covered weight (0.5) and rescaled to the original total
    // (1.0): 0.5*0.18 / 0.5 * 1.0 = 0.18 — i.e. exactly the feedback score, NOT
    // feedback*0.5 (= 0.09, which is what a null→0 coercion would have produced).
    expect(reward).not.toBeNull();
    expect(reward).toBeCloseTo(0.18, 10);
    expect(reward).not.toBeCloseTo(0.09, 10);
  });

  it("renormalizes a partially-covered weighting into a comparable range", () => {
    const diag = sampleDiagnostic();
    // context=0.62 (cov 0.75), feedback=0.18 (cov 0.8) both covered; one_at_a_time null.
    const weights: RewardWeights = { context: 0.25, feedback: 0.25, one_at_a_time: 0.5 };
    const reward = computeRewards(diag, weights);
    // covered weight = 0.5; original total = 1.0; weightedSum = 0.25*0.62 + 0.25*0.18
    // = 0.2; reward = 0.2 / 0.5 * 1.0 = 0.4.
    expect(reward).toBeCloseTo(0.4, 10);
  });

  it("returns null when every weighted principle is null/zero-coverage (all-null drop)", () => {
    const diag = sampleDiagnostic();
    const weights: RewardWeights = { one_at_a_time: 1.0 };
    expect(computeRewards(diag, weights)).toBeNull();
  });

  it("reads principles as an ARRAY (find-by-name), not a map", () => {
    const diag = sampleDiagnostic();
    // A weight on a principle not present in the array is simply uncovered.
    const reward = computeRewards(diag, { codebase_docs: 1.0 });
    // codebase_docs.score = 0.71, coverage 0.5 > 0 → covered; renorm = 0.71.
    expect(reward).toBeCloseTo(0.71, 10);
  });
});

describe("buildRewardDataset", () => {
  const weights: RewardWeights = { feedback: 0.5, context: 0.3, plan_execute: 0.2 };

  function diagFor(scores: { feedback?: number | null; context?: number | null }): DiagnosticResult {
    const base = sampleDiagnostic();
    const principles = base.principles.map((p) => {
      if (p.principle === "feedback" && scores.feedback !== undefined) {
        return { ...p, score: scores.feedback, coverage: scores.feedback === null ? 0 : 0.8 };
      }
      if (p.principle === "context" && scores.context !== undefined) {
        return { ...p, score: scores.context, coverage: scores.context === null ? 0 : 0.75 };
      }
      return p;
    });
    return { ...base, principles };
  }

  it("assembles a schema-valid RewardDataset (reward_source 'diagnostic')", () => {
    const prompts = [promptRecord("Verify after writing.", "t1"), promptRecord("Plan first.", "t2")];
    const byHash = new Map<string, DiagnosticResult>([
      [prompts[0].prompt_hash, diagFor({ feedback: 0.2, context: 0.4 })],
      [prompts[1].prompt_hash, diagFor({ feedback: 0.6, context: 0.9 })],
    ]);
    const { dataset, stats } = buildRewardDataset(prompts, byHash, weights, "job-test");

    // Parses against the frozen 05-01 schema.
    const parsed = RewardDatasetSchema.parse(dataset);
    expect(parsed.reward_source).toBe("diagnostic");
    expect(parsed.job_id).toBe("job-test");
    expect(parsed.entries).toHaveLength(2);
    expect(stats.total).toBe(2);
    expect(stats.included).toBe(2);
    expect(stats.dropped_all_null).toBe(0);
    // Each entry carries baseline_reward + a covered principle_breakdown.
    for (const e of parsed.entries) {
      expect(typeof e.baseline_reward).toBe("number");
      expect(Object.keys(e.principle_breakdown).length).toBeGreaterThan(0);
    }
  });

  it("DROPS an all-null prompt (dropped_all_null increments, entry absent)", () => {
    const live = promptRecord("Has signal.", "t1");
    const dead = promptRecord("All null.", "t2");
    const allNull = sampleDiagnostic();
    // Force every principle null/zero-coverage for the dead prompt's diagnostic.
    const deadDiag: DiagnosticResult = {
      ...allNull,
      principles: allNull.principles.map((p) => ({ ...p, score: null, coverage: 0 })),
    };
    const byHash = new Map<string, DiagnosticResult>([
      [live.prompt_hash, diagFor({ feedback: 0.5, context: 0.6 })],
      [dead.prompt_hash, deadDiag],
    ]);

    const { dataset, stats } = buildRewardDataset([live, dead], byHash, weights, "job-drop");
    expect(stats.total).toBe(2);
    expect(stats.included).toBe(1);
    expect(stats.dropped_all_null).toBe(1);
    expect(dataset.entries).toHaveLength(1);
    expect(dataset.entries[0].prompt_hash).toBe(live.prompt_hash);
    RewardDatasetSchema.parse(dataset);
  });

  it("DROPS a prompt with no matching diagnostic", () => {
    const p = promptRecord("orphan", "t1");
    const { dataset, stats } = buildRewardDataset([p], new Map(), weights, "job-orphan");
    expect(stats.dropped_all_null).toBe(1);
    expect(dataset.entries).toHaveLength(0);
  });

  it("flags frac_low_variance on a zero-variance reward set (Pitfall 2 advisory)", () => {
    // Three prompts whose diagnostics yield identical rewards.
    const ps = [promptRecord("a", "t1"), promptRecord("b", "t2"), promptRecord("c", "t3")];
    const identical = diagFor({ feedback: 0.5, context: 0.5 });
    const byHash = new Map<string, DiagnosticResult>(
      ps.map((p) => [p.prompt_hash, identical] as const),
    );
    const { dataset, stats } = buildRewardDataset(ps, byHash, weights, "job-flat");
    expect(dataset.entries).toHaveLength(3);
    expect(stats.reward_variance).toBeLessThan(LOW_VARIANCE_EPS);
    expect(stats.frac_low_variance).toBe(true);
  });

  it("does NOT flag frac_low_variance on a varied reward set", () => {
    const ps = [promptRecord("a", "t1"), promptRecord("b", "t2"), promptRecord("c", "t3")];
    const byHash = new Map<string, DiagnosticResult>([
      [ps[0].prompt_hash, diagFor({ feedback: 0.1, context: 0.1 })],
      [ps[1].prompt_hash, diagFor({ feedback: 0.5, context: 0.5 })],
      [ps[2].prompt_hash, diagFor({ feedback: 0.9, context: 0.9 })],
    ]);
    const { stats } = buildRewardDataset(ps, byHash, weights, "job-varied");
    expect(stats.reward_variance).toBeGreaterThan(LOW_VARIANCE_EPS);
    expect(stats.frac_low_variance).toBe(false);
  });
});
