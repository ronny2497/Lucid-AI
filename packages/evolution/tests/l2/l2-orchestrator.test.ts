/**
 * Tests for `runL2` — the closed L2 loop (plan 05-04).
 *
 * Drives the whole loop with the pure-TS `MockTrainerPlugin` + a mock evaluator +
 * an in-memory `TraceQuery` stub + capturing emit sinks + a tmpdir, asserting the
 * EC behaviors with NO Python:
 *   - EC-1: export → reward → train → schema-valid manifest + an `evolve.train`
 *     event is emitted (low-cardinality name; job_id/size in attrs).
 *   - EC-3: a candidate that beats the incumbent by >= min_improvement is promoted
 *     (an `evolve.promote` "promoted" event).
 *   - EC-2: a candidate below the margin is discarded (promoted false; "discarded"
 *     event; promote is never called past the gate). An error-manifest from a
 *     failing plugin is discarded too (fail closed).
 *   - a zero-variance reward dataset surfaces a warning.
 *   - a re-run with the same jobId does not double-promote (idempotency).
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TraceFilter, TraceQuery, DiagnosticResult } from "@lucid/diagnostic";

import { runL2, EVOLVE_TRAIN_EVENT, type L2Deps } from "../../src/l2/l2-orchestrator.js";
import { MockTrainerPlugin } from "../../src/l2/mock-trainer-plugin.js";
import { canonicalPromptHash } from "../../src/l2/reward-computer.js";
import { L2ConfigSchema, type L2Config } from "../../src/l2/l2-config.js";
import type { Evaluator } from "../../src/l2/evaluator.js";
import type { ResultManifest } from "../../src/l2/schemas/result-manifest.js";
import type { TrainerPlugin } from "../../src/l2/trainer-plugin.js";
import type { EmittedEvolvePromote, EmitSink } from "../../src/l2/promotion-gate.js";
import type { TrainerPluginSpec } from "../../src/l2/schemas/trainer-plugin-spec.js";
import type { EmittedEvolveTrain } from "../../src/l2/l2-orchestrator.js";

/** A held-out eval fixture path that exists (any readable JSONL the gate can load). */
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const HOLDOUT_PATH = join(HERE, "fixtures", "holdout.jsonl");

/** Build a trace whose single context.load attr yields a known reconstructed prompt. */
function trace(traceId: string, contextText: string) {
  return {
    hscVersion: "v1",
    traceId,
    agentId: "agent-1",
    harnessVersion: "v42",
    startTime: 1,
    endTime: 2,
    statusCode: 0,
    attrs: {},
    turns: [
      {
        turnId: `${traceId}-t0`,
        events: [
          {
            eventId: `${traceId}-e0`,
            traceId,
            parentId: null,
            eventType: "context.load",
            principle: "context",
            quadrantX: "feedforward",
            quadrantY: "computational",
            startTime: 1,
            endTime: 1,
            statusCode: 0,
            attrs: { "context.text": contextText },
          },
        ],
      },
    ],
  };
}

/** The exporter reconstructs the prompt as `context.text=<value>` (one attr). */
function reconstructedPrompt(contextText: string): string {
  return `context.text=${contextText}`;
}

/** A DiagnosticResult with given per-principle scores (covered). */
function diagnostic(scores: Record<string, number>): DiagnosticResult {
  return {
    traceId: "t",
    agentId: "agent-1",
    harness_version: "v42",
    principles: Object.entries(scores).map(([principle, score]) => ({
      principle,
      score,
      coverage: 1,
      hitCount: 1,
      relevantEventCount: 1,
      worstDetector: "",
    })),
    findings: [],
    plot2x2: {
      cells: {
        feedforward_computational: { count: 0, eventTypes: [] },
        feedforward_inferential: { count: 0, eventTypes: [] },
        feedback_computational: { count: 0, eventTypes: [] },
        feedback_inferential: { count: 0, eventTypes: [] },
      },
      emptyColumns: [],
      emptyRows: [],
    },
    generatedAt: "2026-06-18T12:00:00.000Z",
    llmJudgeEnabled: false,
  } as unknown as DiagnosticResult;
}

/** An in-memory TraceQuery stub. */
function stubQuery(traces: unknown[]): TraceQuery {
  return {
    async queryTraces(_filter: TraceFilter): Promise<never[]> {
      return traces as never[];
    },
  } as unknown as TraceQuery;
}

/** A mock evaluator returning a fixed candidate score. */
function fixedEvaluator(score: number): Evaluator {
  return { async evaluate() { return score; } };
}

/** A trainer plugin that always returns a fail-closed error-manifest. */
class FailingTrainerPlugin implements TrainerPlugin {
  async train(spec: TrainerPluginSpec): Promise<ResultManifest> {
    return {
      job_id: spec.job_id,
      candidate_id: `failed-${spec.job_id}`,
      artifact_path: spec.output_dir,
      base_model_ref: spec.base_model_ref,
      config_snapshot: {},
      completed_at: new Date().toISOString(),
      error: "simulated training failure",
    };
  }
}

/** Two varied prompts whose reconstructed-prompt hashes map to diagnostics. */
function variedSetup() {
  const traces = [trace("tr-a", "PROMPT_A"), trace("tr-b", "PROMPT_B")];
  const diags = new Map<string, DiagnosticResult>([
    [canonicalPromptHash(reconstructedPrompt("PROMPT_A")), diagnostic({ feedback: 0.2, context: 0.4 })],
    [canonicalPromptHash(reconstructedPrompt("PROMPT_B")), diagnostic({ feedback: 0.8, context: 0.9 })],
  ]);
  return { traces, diags };
}

/** A capturing promote sink + its events. */
function capturePromote(): { sink: EmitSink; events: EmittedEvolvePromote[] } {
  const events: EmittedEvolvePromote[] = [];
  return { sink: (e) => { events.push(e as EmittedEvolvePromote); }, events };
}

/** A capturing train sink + its events. */
function captureTrain(): { sink: (e: EmittedEvolveTrain) => void; events: EmittedEvolveTrain[] } {
  const events: EmittedEvolveTrain[] = [];
  return { sink: (e) => { events.push(e); }, events };
}

/** A fully-formed L2 config at autonomy L2 with a filesystem trainer ref. */
function l2Config(minImprovement = 0.02): L2Config {
  return L2ConfigSchema.parse({
    autonomy: "L2",
    trainer: { plugin: "mock", base_model: "Qwen/Qwen2.5-0.5B" },
    reward: { weights: { feedback: 0.5, context: 0.5 } },
    promote_gate: { eval: HOLDOUT_PATH, metric: "success", min_improvement: minImprovement },
  });
}

function makeWorkDir(): string {
  return mkdtempSync(join(tmpdir(), "lucid-l2-"));
}

function baseDeps(overrides: Partial<L2Deps> = {}): L2Deps {
  const { traces, diags } = variedSetup();
  const { sink } = capturePromote();
  return {
    query: stubQuery(traces),
    diagnosticsByPromptHash: diags,
    trainerPlugin: new MockTrainerPlugin(),
    evaluator: fixedEvaluator(0.55),
    emit: sink,
    config: l2Config(),
    incumbentScore: 0.5,
    workDir: makeWorkDir(),
    ...overrides,
  };
}

describe("runL2 — EC-1 (export → reward → train → schema-valid manifest)", () => {
  it("produces a manifest and emits an evolve.train event", async () => {
    const train = captureTrain();
    const result = await runL2(
      baseDeps({ emitTrain: train.sink }),
      { jobId: "job-ec1", agentId: "agent-1" },
    );
    expect(result.manifest.job_id).toBe("job-ec1");
    expect(result.manifest.candidate_id).toBeTruthy();
    expect(result.manifest.metrics?.reward_mean).toBeTypeOf("number");
    // The handoff audit event fired with a low-cardinality name + attrs.
    expect(train.events).toHaveLength(1);
    expect(train.events[0].name).toBe(EVOLVE_TRAIN_EVENT);
    expect(train.events[0].name).toBe("evolve.train");
    expect(train.events[0].attrs.job_id).toBe("job-ec1");
    expect(train.events[0].attrs.dataset_size).toBe(2);
  });
});

describe("runL2 — EC-3 (gate promotes a candidate that beats the incumbent)", () => {
  it("promotes when delta >= min_improvement and emits a 'promoted' event", async () => {
    const promote = capturePromote();
    const result = await runL2(
      baseDeps({ evaluator: fixedEvaluator(0.55), incumbentScore: 0.5, emit: promote.sink }),
      { jobId: "job-ec3", agentId: "agent-1" },
    );
    expect(result.promoted).toBe(true);
    expect(result.gateResult.passed).toBe(true);
    expect(result.gateResult.delta).toBeCloseTo(0.05, 10);
    expect(promote.events).toHaveLength(1);
    expect(promote.events[0].attrs.outcome).toBe("promoted");
    expect(promote.events[0].name).toBe("evolve.promote");
  });
});

describe("runL2 — EC-2 (below-margin and error candidates are discarded)", () => {
  it("discards a below-margin candidate (promoted false, 'discarded' event)", async () => {
    const promote = capturePromote();
    const result = await runL2(
      baseDeps({ evaluator: fixedEvaluator(0.505), incumbentScore: 0.5, emit: promote.sink }),
      { jobId: "job-ec2", agentId: "agent-1" },
    );
    expect(result.promoted).toBe(false);
    expect(result.gateResult.passed).toBe(false);
    expect(promote.events).toHaveLength(1);
    expect(promote.events[0].attrs.outcome).toBe("discarded");
  });

  it("discards an error-manifest (fail closed — evaluator never decides a pass)", async () => {
    const promote = capturePromote();
    const result = await runL2(
      baseDeps({
        trainerPlugin: new FailingTrainerPlugin(),
        evaluator: fixedEvaluator(0.99),
        emit: promote.sink,
      }),
      { jobId: "job-err", agentId: "agent-1" },
    );
    expect(result.promoted).toBe(false);
    expect(result.gateResult.passed).toBe(false);
    expect(result.gateResult.reason).toBe("training-error");
    expect(promote.events[0].attrs.outcome).toBe("discarded");
  });
});

describe("runL2 — zero-variance advisory (Pitfall 2)", () => {
  it("surfaces a warning when every baseline reward is identical", async () => {
    // Both prompts get the SAME principle scores → identical baseline rewards.
    const traces = [trace("tr-a", "PROMPT_A"), trace("tr-b", "PROMPT_B")];
    const sameDiag = diagnostic({ feedback: 0.5, context: 0.5 });
    const diags = new Map<string, DiagnosticResult>([
      [canonicalPromptHash(reconstructedPrompt("PROMPT_A")), sameDiag],
      [canonicalPromptHash(reconstructedPrompt("PROMPT_B")), sameDiag],
    ]);
    const result = await runL2(
      baseDeps({ query: stubQuery(traces), diagnosticsByPromptHash: diags }),
      { jobId: "job-zv", agentId: "agent-1" },
    );
    expect(result.datasetStats.frac_low_variance).toBe(true);
    expect(result.warning).toMatch(/zero-variance/i);
  });
});

describe("runL2 — idempotency by jobId", () => {
  it("does not double-promote a jobId already promoted", async () => {
    const promote = capturePromote();
    const result = await runL2(
      baseDeps({
        evaluator: fixedEvaluator(0.55),
        incumbentScore: 0.5,
        emit: promote.sink,
        alreadyPromoted: (jobId) => jobId === "job-dup",
      }),
      { jobId: "job-dup", agentId: "agent-1" },
    );
    // The gate passed, but the idempotency guard prevents a second promotion.
    expect(result.gateResult.passed).toBe(true);
    expect(result.promoted).toBe(false);
    expect(promote.events[0].attrs.outcome).toBe("discarded");
  });
});
