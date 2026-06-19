/**
 * Promotion-gate tests (plan 05-03) — the primary L2 safety mechanism.
 *
 * Imports the gate/evaluator symbols by RELATIVE path (NOT via `@lucid/evolution`):
 * the barrel re-export is deferred to 05-04 (Wave 3) so 05-02 and 05-03 stay
 * file-disjoint and run in parallel in Wave 2.
 *
 * Pins:
 *   Task 1 (evaluator):
 *     - loadHoldout parses the fixture / throws on a missing file
 *     - SuccessEvaluator returns the pass fraction (0.75 for 3-of-4)
 *     - the default scorer scores nothing (fail-closed default)
 *   Task 2 (gate):
 *     - evaluateCandidate: clears the margin → passed; below margin → not passed
 *     - an error-manifest fails closed WITHOUT calling the evaluator (call count 0)
 *     - promoteCandidate THROWS on a failed gate result (NO bypass)
 *     - promote/discard each emit exactly one evolve.promote event (low-cardinality
 *       name; candidate_id/delta in attrs); every decision is audited
 */

import { describe, it, expect, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  SuccessEvaluator,
  loadHoldout,
  noopScorer,
  type Evaluator,
  type HoldoutEntry,
} from "../../src/l2/evaluator.js";
import {
  evaluateCandidate,
  promoteCandidate,
  discardCandidate,
  PromoteGateConfigSchema,
  EVOLVE_PROMOTE_EVENT,
  type GateResult,
  type EmitSink,
  type EmittedEvolvePromote,
} from "../../src/l2/promotion-gate.js";
import { buildCandidateProvenance } from "../../src/l2/candidate-provenance.js";
import type { ResultManifest } from "../../src/l2/schemas/result-manifest.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOLDOUT_PATH = join(HERE, "fixtures", "holdout.jsonl");

/** A full successful-run manifest (mirrors result-manifest.test.ts). */
function okManifest(): ResultManifest {
  return {
    job_id: "job-0001",
    candidate_id: "cand-0001",
    artifact_path: "/abs/out/job-0001/adapter",
    base_model_ref: "Qwen/Qwen2.5-0.5B",
    metrics: { reward_mean: 0.71, reward_std: 0.12, steps: 40, epochs: 1 },
    principle_deltas: { feedback: 0.21, context: 0.04 },
    config_snapshot: { loss_type: "dr_grpo" },
    completed_at: "2026-06-18T12:00:00.000Z",
  };
}

/** A failed-training manifest (metrics omitted, error set). */
function errorManifest(): ResultManifest {
  return {
    job_id: "job-0002",
    candidate_id: "cand-0002",
    artifact_path: "",
    base_model_ref: "Qwen/Qwen2.5-0.5B",
    config_snapshot: {},
    completed_at: "2026-06-18T12:30:00.000Z",
    error: "CUDA out of memory at step 3",
  };
}

/** A mock evaluator returning a fixed score, with a spy on its evaluate(). */
function fixedEvaluator(score: number): Evaluator & { evaluate: ReturnType<typeof vi.fn> } {
  const evaluate = vi.fn(async () => score);
  return { evaluate };
}

const gateConfig = { eval: HOLDOUT_PATH, metric: "success", min_improvement: 0.02 };

/** A capturing emit sink + the events it captured. */
function capturingSink(): { sink: EmitSink; events: EmittedEvolvePromote[] } {
  const events: EmittedEvolvePromote[] = [];
  const sink: EmitSink = (event) => {
    events.push(event as EmittedEvolvePromote);
  };
  return { sink, events };
}

// ----------------------------------------------------------------------------
// Task 1 — evaluator
// ----------------------------------------------------------------------------

describe("loadHoldout", () => {
  it("parses the JSONL fixture into the right entry count", () => {
    const holdout = loadHoldout(HOLDOUT_PATH);
    expect(holdout).toHaveLength(4);
    expect(holdout[0]).toHaveProperty("prompt");
    expect(holdout[0]).toHaveProperty("expected_output");
  });

  it("throws a clear error on a missing file", () => {
    expect(() => loadHoldout(join(HERE, "fixtures", "does-not-exist.jsonl"))).toThrow(
      /cannot read holdout/i,
    );
  });
});

describe("SuccessEvaluator", () => {
  it("returns the pass fraction (0.75 for 3 of 4)", async () => {
    const holdout = loadHoldout(HOLDOUT_PATH);
    let i = 0;
    // scorer passes the first 3 of 4 entries
    const evaluator = new SuccessEvaluator(() => i++ < 3);
    const score = await evaluator.evaluate("/opaque/artifact", holdout, "success");
    expect(score).toBe(0.75);
  });

  it("uses a conservative default scorer (scores nothing → 0.0)", async () => {
    const holdout = loadHoldout(HOLDOUT_PATH);
    const evaluator = new SuccessEvaluator();
    expect(await evaluator.evaluate("/opaque/artifact", holdout, "success")).toBe(0);
    expect(noopScorer("/opaque/artifact", holdout[0])).toBe(false);
  });

  it("returns 0 for an empty holdout (fail-closed: no evidence of success)", async () => {
    const evaluator = new SuccessEvaluator(() => true);
    expect(await evaluator.evaluate("/opaque/artifact", [] as HoldoutEntry[], "success")).toBe(0);
  });
});

// ----------------------------------------------------------------------------
// Task 2 — gate
// ----------------------------------------------------------------------------

describe("PromoteGateConfigSchema", () => {
  it("defaults metric to 'success' and min_improvement to 0.02", () => {
    const cfg = PromoteGateConfigSchema.parse({ eval: "/abs/holdout.jsonl" });
    expect(cfg.metric).toBe("success");
    expect(cfg.min_improvement).toBe(0.02);
  });

  it("rejects an empty eval path", () => {
    expect(() => PromoteGateConfigSchema.parse({ eval: "" })).toThrow();
  });
});

describe("evaluateCandidate", () => {
  it("passes when the candidate clears the margin (0.55 vs 0.5 @ 0.02)", async () => {
    const evaluator = fixedEvaluator(0.55);
    const result = await evaluateCandidate(okManifest(), evaluator, gateConfig, 0.5);
    expect(result.passed).toBe(true);
    expect(result.candidateScore).toBe(0.55);
    expect(result.incumbentScore).toBe(0.5);
    expect(result.delta).toBeCloseTo(0.05, 10);
    expect(result.metric).toBe("success");
    expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
  });

  it("does NOT pass when the candidate is below the margin (0.51 vs 0.5 @ 0.02)", async () => {
    const evaluator = fixedEvaluator(0.51);
    const result = await evaluateCandidate(okManifest(), evaluator, gateConfig, 0.5);
    expect(result.passed).toBe(false);
    expect(result.delta).toBeCloseTo(0.01, 10);
  });

  it("fails closed on an error-manifest WITHOUT running the evaluator", async () => {
    const evaluator = fixedEvaluator(0.99);
    const result = await evaluateCandidate(errorManifest(), evaluator, gateConfig, 0.5);
    expect(result.passed).toBe(false);
    expect(result.candidateScore).toBeNull();
    expect(result.delta).toBeNull();
    expect(result.reason).toBe("training-error");
    // THE fail-closed assertion: the evaluator was never called.
    expect(evaluator.evaluate).toHaveBeenCalledTimes(0);
  });

  it("fails closed when metrics are missing even without an error string", async () => {
    const evaluator = fixedEvaluator(0.99);
    const noMetrics: ResultManifest = { ...okManifest(), metrics: undefined };
    const result = await evaluateCandidate(noMetrics, evaluator, gateConfig, 0.5);
    expect(result.passed).toBe(false);
    expect(evaluator.evaluate).toHaveBeenCalledTimes(0);
  });
});

describe("promoteCandidate / discardCandidate (audit every decision, no bypass)", () => {
  it("THROWS when promoting a failed gate result (the no-bypass guard)", async () => {
    const failed: GateResult = {
      passed: false,
      candidateScore: 0.51,
      incumbentScore: 0.5,
      delta: 0.01,
      metric: "success",
    };
    const provenance = buildCandidateProvenance(okManifest(), {}, HOLDOUT_PATH, failed);
    const { sink, events } = capturingSink();
    await expect(promoteCandidate(okManifest(), failed, provenance, sink)).rejects.toThrow();
    // No promote event leaked from the refused promotion.
    expect(events).toHaveLength(0);
  });

  it("emits exactly one evolve.promote event (outcome 'promoted') on a passing result", async () => {
    const passed: GateResult = {
      passed: true,
      candidateScore: 0.55,
      incumbentScore: 0.5,
      delta: 0.05,
      metric: "success",
    };
    const provenance = buildCandidateProvenance(okManifest(), { feedback: 0.5 }, HOLDOUT_PATH, passed);
    const { sink, events } = capturingSink();
    await promoteCandidate(okManifest(), passed, provenance, sink);
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe(EVOLVE_PROMOTE_EVENT);
    expect(events[0].name).toBe("evolve.promote");
    expect(events[0].attrs.outcome).toBe("promoted");
    expect(events[0].attrs.candidate_id).toBe("cand-0001");
    expect(events[0].attrs.delta).toBe(0.05);
    expect(events[0].attrs.base_model_ref).toBe("Qwen/Qwen2.5-0.5B");
  });

  it("emits exactly one evolve.promote event (outcome 'discarded') on a discard", async () => {
    const failed: GateResult = {
      passed: false,
      candidateScore: 0.51,
      incumbentScore: 0.5,
      delta: 0.01,
      metric: "success",
    };
    const provenance = buildCandidateProvenance(okManifest(), {}, HOLDOUT_PATH, failed);
    const { sink, events } = capturingSink();
    await discardCandidate(okManifest(), failed, provenance, sink);
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe("evolve.promote");
    expect(events[0].attrs.outcome).toBe("discarded");
    expect(events[0].attrs.delta).toBe(0.01);
  });

  it("carries the low-cardinality event name (candidate_id is in attrs, not the name)", async () => {
    const passed: GateResult = {
      passed: true,
      candidateScore: 0.6,
      incumbentScore: 0.5,
      delta: 0.1,
      metric: "success",
    };
    const provenance = buildCandidateProvenance(okManifest(), {}, HOLDOUT_PATH, passed);
    const { sink, events } = capturingSink();
    await promoteCandidate(okManifest(), passed, provenance, sink);
    expect(events[0].name).not.toContain("cand-0001");
    expect(events[0].name).toBe("evolve.promote");
  });
});
