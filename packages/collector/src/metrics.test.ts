/**
 * RED-first unit tests for `deriveBaseMetrics` (REQ-03 base metrics).
 *
 * These drive the five derivations over a `MetricsInput` fixture (the raw
 * per-trace inputs `TraceStore.getMetricsInput` returns):
 *   - success rate (via successOf — declared->inferred policy)
 *   - cost/run (costOf — null when a model is unpriced, never fabricated)
 *   - latency p50/p95 (percentile over span durations)
 *   - total tokens (input + output)
 *   - tool-error rate (errored tool.call events / mutating tool.call population, A6)
 *
 * Policy/pricing are single-sourced from `@lucid/hsc-map`; nothing about
 * pricing or gen_ai.* attribute names is redeclared here. The fixtures use
 * ONLY the real `MetricsInputRow` fields the store produces.
 */

import { describe, it, expect } from "vitest";
import type { MetricsInput, MetricsInputRow } from "@lucid/store";
import { HARNESS_DECLARED_SUCCESS_ATTR } from "@lucid/hsc-map";
import { deriveBaseMetrics, percentile } from "./metrics.js";

/** OTel SpanStatusCode values used in the fixtures. */
const OK = 1;
const ERROR = 2;

function row(overrides: Partial<MetricsInputRow>): MetricsInputRow {
  return {
    traceId: "t-default",
    agentId: "agent-a",
    statusCode: OK,
    durationNs: 1_000_000,
    inputTokens: 0,
    outputTokens: 0,
    model: null,
    mutatingToolCallCount: 0,
    toolErrorCount: 0,
    ...overrides,
  };
}

describe("percentile", () => {
  it("returns 0 for an empty set", () => {
    expect(percentile([], 50)).toBe(0);
  });

  it("computes the p50 and p95 of a known set (nearest-rank)", () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    // nearest-rank: p50 -> index ceil(0.5*10)-1 = 4 -> 50; p95 -> index 9 -> 100
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 95)).toBe(100);
  });

  it("is order-independent", () => {
    expect(percentile([30, 10, 20], 50)).toBe(20);
  });
});

describe("deriveBaseMetrics", () => {
  it("computes success rate via successOf over the trace status codes", () => {
    const input: MetricsInput = {
      traces: [
        row({ traceId: "t1", statusCode: OK }), // success (inferred)
        row({ traceId: "t2", statusCode: 0 }), // UNSET -> success (inferred)
        row({ traceId: "t3", statusCode: ERROR }), // failure (inferred)
        row({ traceId: "t4", statusCode: ERROR }), // failure (inferred)
      ],
    };
    const m = deriveBaseMetrics(input);
    // 2 of 4 succeed
    expect(m.successRate).toBeCloseTo(0.5, 6);
    // No declared-success attr is surfaced by the store yet, so all are inferred.
    expect(m.successSourceBreakdown.inferred).toBe(4);
    expect(m.successSourceBreakdown.declared).toBe(0);
  });

  it("computes cost/run via costOf and returns null when any model is unknown", () => {
    const known: MetricsInput = {
      traces: [
        row({
          traceId: "t1",
          model: "gpt-4o",
          inputTokens: 1000,
          outputTokens: 1000,
        }),
      ],
    };
    const km = deriveBaseMetrics(known);
    // gpt-4o: (1000*0.0025 + 1000*0.01)/1000 = 0.0125 per trace
    expect(km.costPerRun).toBeCloseTo(0.0125, 6);
    expect(km.costUnknown).toBe(false);

    const unknown: MetricsInput = {
      traces: [
        row({ traceId: "t1", model: "some-unpriced-model", inputTokens: 100, outputTokens: 100 }),
      ],
    };
    const um = deriveBaseMetrics(unknown);
    expect(um.costPerRun).toBeNull();
    expect(um.costUnknown).toBe(true);
  });

  it("flags cost unknown when a model attribute is entirely absent", () => {
    const input: MetricsInput = {
      traces: [row({ traceId: "t1", model: null, inputTokens: 50, outputTokens: 50 })],
    };
    const m = deriveBaseMetrics(input);
    expect(m.costPerRun).toBeNull();
    expect(m.costUnknown).toBe(true);
  });

  it("averages cost across all priced traces", () => {
    const input: MetricsInput = {
      traces: [
        row({ traceId: "t1", model: "gpt-4o", inputTokens: 1000, outputTokens: 1000 }), // 0.0125
        row({ traceId: "t2", model: "gpt-4o", inputTokens: 0, outputTokens: 0 }), // 0
      ],
    };
    const m = deriveBaseMetrics(input);
    expect(m.costPerRun).toBeCloseTo(0.00625, 6);
    expect(m.costUnknown).toBe(false);
  });

  it("computes latency p50/p95 from span durations", () => {
    const durations = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const input: MetricsInput = {
      traces: durations.map((d, i) => row({ traceId: `t${i}`, durationNs: d })),
    };
    const m = deriveBaseMetrics(input);
    expect(m.latencyP50).toBe(50);
    expect(m.latencyP95).toBe(100);
  });

  it("sums total tokens (input + output) across traces", () => {
    const input: MetricsInput = {
      traces: [
        row({ traceId: "t1", inputTokens: 100, outputTokens: 50 }),
        row({ traceId: "t2", inputTokens: 200, outputTokens: 25 }),
      ],
    };
    const m = deriveBaseMetrics(input);
    expect(m.totalTokens).toBe(375);
  });

  it("computes tool-error rate from tool.call counts (not log text)", () => {
    const input: MetricsInput = {
      traces: [
        row({ traceId: "t1", mutatingToolCallCount: 4, toolErrorCount: 1 }),
        row({ traceId: "t2", mutatingToolCallCount: 6, toolErrorCount: 2 }),
      ],
    };
    const m = deriveBaseMetrics(input);
    // 3 errors / 10 tool.call events
    expect(m.toolErrorRate).toBeCloseTo(0.3, 6);
  });

  it("returns a 0 tool-error rate when there are no tool.call events", () => {
    const input: MetricsInput = {
      traces: [row({ traceId: "t1", mutatingToolCallCount: 0, toolErrorCount: 0 })],
    };
    expect(deriveBaseMetrics(input).toolErrorRate).toBe(0);
  });

  it("returns safe zeros for an empty window", () => {
    const m = deriveBaseMetrics({ traces: [] });
    expect(m.successRate).toBe(0);
    expect(m.totalTokens).toBe(0);
    expect(m.toolErrorRate).toBe(0);
    expect(m.latencyP50).toBe(0);
    expect(m.latencyP95).toBe(0);
    // No traces means no priced cost — surfaced as unknown, never a fabricated 0.
    expect(m.costPerRun).toBeNull();
    expect(m.costUnknown).toBe(true);
    expect(m.traceCount).toBe(0);
  });

  it("uses the single-sourced declared-success attribute name (no local policy)", () => {
    // Guards against this module redeclaring the success policy: the attr name
    // is owned by @lucid/hsc-map, asserted here to keep the contract single-sourced.
    expect(HARNESS_DECLARED_SUCCESS_ATTR).toBe("harness.success");
  });
});
