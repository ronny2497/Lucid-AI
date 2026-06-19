/**
 * End-to-end integration test for the L2 weight-level GRPO loop.
 *
 * Wave 0 (05-01) shipped this as a RED scaffold: the four fixtures parse against
 * the frozen Wave-0 schemas (the GREEN fixture-guards, kept below), and three
 * EC-1/EC-2/EC-3 cases imported a not-yet-existent `runL2` to keep the module RED
 * until 05-04.
 *
 * 05-04 turns it GREEN: the EC cases now drive the REAL `runL2(deps, opts)` loop
 * against the pure-TS `MockTrainerPlugin` + a mock evaluator + an in-memory
 * `TraceQuery` + a tmpdir — proving the whole loop runs on a CPU CI box with NO
 * Python (the no-Python-core-dep + skippable boundary):
 *   - EC-1: TS export + reward → MockTrainerPlugin → schema-valid ResultManifest.
 *   - EC-2: a failed/regressed candidate is discarded — never promoted.
 *   - EC-3: the gate promotes a candidate that beats the incumbent by
 *     >= min_improvement and discards one below it.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { DiagnosticResultSchema } from "@lucid/diagnostic";
import type { TraceFilter, TraceQuery, DiagnosticResult } from "@lucid/diagnostic";
import {
  RewardDatasetSchema,
  ResultManifestSchema,
  MockTrainerPlugin,
  runL2,
  L2ConfigSchema,
  canonicalPromptHash,
  type Evaluator,
  type L2Deps,
  type L2Config,
} from "@lucid/evolution";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "fixtures");
const readFixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(fixtures, name), "utf8"));
const HOLDOUT_PATH = join(fixtures, "holdout.jsonl");

describe("L2 fixtures conform to the frozen Wave-0 schemas (GREEN)", () => {
  it("sample-rewards.json validates against RewardDatasetSchema", () => {
    const ds = RewardDatasetSchema.parse(readFixture("sample-rewards.json"));
    expect(ds.reward_source).toBe("diagnostic");
    // Reward variance is present (Pitfall 2 awareness baked into the fixture).
    const rewards = ds.entries.map((e) => e.baseline_reward);
    expect(new Set(rewards).size).toBeGreaterThan(1);
  });

  it("sample-diagnostic-result.json validates against DiagnosticResultSchema", () => {
    const dr = DiagnosticResultSchema.parse(readFixture("sample-diagnostic-result.json"));
    const numeric = dr.principles.filter((p) => p.score !== null);
    const nullScored = dr.principles.filter((p) => p.score === null);
    expect(numeric.length).toBeGreaterThan(0);
    expect(nullScored.length).toBeGreaterThan(0);
    // The null-score case is the canonical zero-coverage signal.
    expect(nullScored.every((p) => p.coverage === 0)).toBe(true);
  });

  it("golden-result-manifest.json validates against ResultManifestSchema", () => {
    const m = ResultManifestSchema.parse(readFixture("golden-result-manifest.json"));
    expect(m.candidate_id).toBe("cand-2026-06-18a");
    expect(m.error).toBeUndefined();
  });

  it("sample-prompts.jsonl is prompts-only (no completion/response/output_text)", () => {
    const text = readFileSync(join(fixtures, "sample-prompts.jsonl"), "utf8").trim();
    const lines = text.split("\n");
    for (const line of lines) {
      const obj = JSON.parse(line) as Record<string, unknown>;
      expect(obj.prompt_hash).toBeTruthy();
      expect(obj.prompt).toBeTruthy();
      expect("completion" in obj).toBe(false);
      expect("response" in obj).toBe(false);
      expect("output_text" in obj).toBe(false);
    }
  });

  it("the MockTrainerPlugin CI path is importable and constructable", () => {
    expect(typeof MockTrainerPlugin).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// EC-1/EC-2/EC-3 — the closed loop GREEN via MockTrainerPlugin (no Python).
// ---------------------------------------------------------------------------

/** A trace whose single context.load attr yields the reconstructed prompt below. */
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

const reconstructed = (t: string): string => `context.text=${t}`;

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

function stubQuery(traces: unknown[]): TraceQuery {
  return {
    async queryTraces(_filter: TraceFilter): Promise<never[]> {
      return traces as never[];
    },
  } as unknown as TraceQuery;
}

const fixedEvaluator = (score: number): Evaluator => ({
  async evaluate() {
    return score;
  },
});

function config(minImprovement = 0.02): L2Config {
  return L2ConfigSchema.parse({
    autonomy: "L2",
    trainer: { plugin: "mock", base_model: "Qwen/Qwen2.5-0.5B" },
    reward: { weights: { feedback: 0.5, context: 0.5 } },
    promote_gate: { eval: HOLDOUT_PATH, metric: "success", min_improvement: minImprovement },
  });
}

function deps(overrides: Partial<L2Deps> = {}): L2Deps {
  const traces = [trace("tr-a", "PA"), trace("tr-b", "PB")];
  const diags = new Map<string, DiagnosticResult>([
    [canonicalPromptHash(reconstructed("PA")), diagnostic({ feedback: 0.2, context: 0.4 })],
    [canonicalPromptHash(reconstructed("PB")), diagnostic({ feedback: 0.8, context: 0.9 })],
  ]);
  return {
    query: stubQuery(traces),
    diagnosticsByPromptHash: diags,
    trainerPlugin: new MockTrainerPlugin(),
    evaluator: fixedEvaluator(0.55),
    emit: () => {},
    config: config(),
    incumbentScore: 0.5,
    workDir: mkdtempSync(join(tmpdir(), "lucid-l2-e2e-")),
    ...overrides,
  };
}

describe("L2 loop end-to-end (GREEN via MockTrainerPlugin, no Python)", () => {
  it("EC-1: TS reward → MockTrainerPlugin → schema-valid ResultManifest", async () => {
    const outcome = await runL2(deps(), { jobId: "ec1", agentId: "agent-1" });
    expect(() => ResultManifestSchema.parse(outcome.manifest)).not.toThrow();
    expect(outcome.manifest.metrics?.reward_mean).toBeTypeOf("number");
  });

  it("EC-2: a regressed candidate (below margin) is discarded, never promoted", async () => {
    const outcome = await runL2(
      deps({ evaluator: fixedEvaluator(0.5), incumbentScore: 0.5 }),
      { jobId: "ec2", agentId: "agent-1" },
    );
    expect(outcome.promoted).toBe(false);
    expect(outcome.gateResult.passed).toBe(false);
  });

  it("EC-3: the gate promotes only a candidate that beats the incumbent by >= min_improvement", async () => {
    const promoted = await runL2(
      deps({ evaluator: fixedEvaluator(0.6), incumbentScore: 0.5 }),
      { jobId: "ec3-pass", agentId: "agent-1" },
    );
    expect(promoted.promoted).toBe(true);

    const below = await runL2(
      deps({ evaluator: fixedEvaluator(0.51), incumbentScore: 0.5 }),
      { jobId: "ec3-fail", agentId: "agent-1" },
    );
    expect(below.promoted).toBe(false);
  });
});
