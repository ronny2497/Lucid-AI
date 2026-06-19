/**
 * deriveBaseMetrics — the REQ-03 base-metrics layer (RESEARCH Pattern 3).
 *
 * Derives the five Phase-1 base metrics from the raw per-trace inputs the
 * `TraceStore` returns (`getMetricsInput`), with pricing and the success policy
 * SINGLE-SOURCED from `@lucid/hsc-map`:
 *
 *   - successRate     : fraction of traces judged successful via `successOf`
 *                       (declared->inferred), with the source breakdown.
 *   - costPerRun       : average USD/run via `costOf`. `null` (flagged
 *                        `costUnknown`) when any priced model is unknown OR no
 *                        trace carries a priceable model — NEVER fabricated.
 *   - latencyP50/P95   : nearest-rank percentiles over per-trace durations.
 *   - totalTokens      : sum of input+output tokens across the window.
 *   - toolErrorRate    : errored tool.call events / total tool.call events,
 *                        using the store's structural counts (A6) — never by
 *                        parsing log text.
 *
 * Anti-Patterns (RESEARCH): success is NOT pattern-matched from log text, cost
 * is NOT fabricated for unknown models, and no pricing table or `gen_ai.*`
 * attribute name is redeclared here.
 */

import type { MetricsInput } from "@lucid/store";
import { costOf, successOf } from "@lucid/hsc-map";

/** The stable base-metrics shape consumed by the API, CLI, and explorer UI. */
export interface BaseMetrics {
  /** Number of traces in the window the metrics were derived over. */
  traceCount: number;
  /** Fraction (0..1) of traces judged successful. 0 for an empty window. */
  successRate: number;
  /** How each trace's success judgement was sourced (declared vs inferred). */
  successSourceBreakdown: {
    declared: number;
    inferred: number;
  };
  /**
   * Mean USD cost per run, or `null` when cost cannot be priced (unknown model,
   * or no priceable model in the window). Pair with `costUnknown`.
   */
  costPerRun: number | null;
  /** True when `costPerRun` is null because pricing was unavailable. */
  costUnknown: boolean;
  /** Median (p50) per-trace duration in the store's native duration unit (ns). */
  latencyP50: number;
  /** p95 per-trace duration. */
  latencyP95: number;
  /** Total input+output tokens summed across the window. */
  totalTokens: number;
  /** Errored tool.call events / total tool.call events (0 when none). */
  toolErrorRate: number;
}

/**
 * Nearest-rank percentile of a numeric set. Returns 0 for an empty set.
 * `p` is a percentile in [0, 100].
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(Math.max(rank, 1), sorted.length) - 1;
  return sorted[index];
}

/**
 * Derive the five base metrics from a window of stored-trace inputs.
 * Pure: no I/O, no store access — the caller supplies `MetricsInput`.
 */
export function deriveBaseMetrics(input: MetricsInput): BaseMetrics {
  const { traces } = input;
  const traceCount = traces.length;

  // --- success (single-sourced policy via successOf) -----------------------
  let successes = 0;
  const successSourceBreakdown = { declared: 0, inferred: 0 };
  for (const t of traces) {
    const { success, successSource } = successOf({ statusCode: t.statusCode });
    if (success) successes += 1;
    successSourceBreakdown[successSource] += 1;
  }
  const successRate = traceCount === 0 ? 0 : successes / traceCount;

  // --- cost (single-sourced pricing via costOf; null on any unknown) -------
  // A trace is priceable only when it carries a model AND that model is in the
  // pricing table. If any priced model is unknown — or no trace is priceable —
  // the whole window's cost is reported unknown rather than under-counted.
  let costSum = 0;
  let pricedTraces = 0;
  let sawUnknown = false;
  for (const t of traces) {
    if (t.model === null) {
      sawUnknown = true;
      continue;
    }
    const cost = costOf(t.inputTokens, t.outputTokens, t.model);
    if (cost === null) {
      sawUnknown = true;
      continue;
    }
    costSum += cost;
    pricedTraces += 1;
  }
  const costUnknown = sawUnknown || pricedTraces === 0;
  const costPerRun = costUnknown ? null : costSum / pricedTraces;

  // --- latency (percentiles over per-trace durations) ----------------------
  const durations = traces
    .map((t) => t.durationNs)
    .filter((d): d is number => d !== null);
  const latencyP50 = percentile(durations, 50);
  const latencyP95 = percentile(durations, 95);

  // --- tokens --------------------------------------------------------------
  const totalTokens = traces.reduce(
    (sum, t) => sum + t.inputTokens + t.outputTokens,
    0,
  );

  // --- tool-error rate (structural, A6 — never log-text) -------------------
  let toolCallTotal = 0;
  let toolErrorTotal = 0;
  for (const t of traces) {
    toolCallTotal += t.mutatingToolCallCount;
    toolErrorTotal += t.toolErrorCount;
  }
  const toolErrorRate = toolCallTotal === 0 ? 0 : toolErrorTotal / toolCallTotal;

  return {
    traceCount,
    successRate,
    successSourceBreakdown,
    costPerRun,
    costUnknown,
    latencyP50,
    latencyP95,
    totalTokens,
    toolErrorRate,
  };
}
