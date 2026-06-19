import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  SqliteTraceStore,
  type TraceStore,
  type HscSpan,
  type HarnessTrace,
} from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const golden: HarnessTrace = JSON.parse(
  readFileSync(join(__dirname, "../fixtures/golden-hsc-trace.json"), "utf8"),
);

/**
 * Flatten a HarnessTrace fixture into the per-event HscSpan[] that writeSpans
 * accepts. Each span carries the trace-level identity plus one event.
 */
function spansFromTrace(trace: HarnessTrace): HscSpan[] {
  const spans: HscSpan[] = [];
  for (const turn of trace.turns) {
    for (const event of turn.events) {
      spans.push({
        traceId: trace.traceId,
        agentId: trace.agentId,
        harnessVersion: trace.harnessVersion,
        traceStartTime: trace.startTime,
        traceEndTime: trace.endTime ?? null,
        traceStatusCode: trace.statusCode ?? null,
        traceAttrs: trace.attrs ?? {},
        turnId: turn.turnId,
        event,
      });
    }
  }
  return spans;
}

describe("SqliteTraceStore implements TraceStore", () => {
  let store: TraceStore;

  beforeEach(async () => {
    store = new SqliteTraceStore(":memory:");
    await store.writeSpans(spansFromTrace(golden));
  });

  it("round-trips a trace queried by agent_id", async () => {
    const traces = await store.queryTraces({ agentId: golden.agentId });
    expect(traces).toHaveLength(1);
    expect(traces[0].traceId).toBe(golden.traceId);
    expect(traces[0].agentId).toBe(golden.agentId);
    expect(traces[0].harnessVersion).toBe(golden.harnessVersion);
  });

  it("filters by harness.version", async () => {
    const match = await store.queryTraces({ version: golden.harnessVersion });
    expect(match).toHaveLength(1);
    const miss = await store.queryTraces({ version: "9.9.9" });
    expect(miss).toHaveLength(0);
  });

  it("filters by a {startTime,endTime} window", async () => {
    const inWindow = await store.queryTraces({
      startTime: golden.startTime - 1,
      endTime: golden.startTime + 1,
    });
    expect(inWindow).toHaveLength(1);
    const outOfWindow = await store.queryTraces({
      startTime: golden.startTime + 1_000_000_000_000,
      endTime: golden.startTime + 2_000_000_000_000,
    });
    expect(outOfWindow).toHaveLength(0);
  });

  it("getTrace returns the full turns->events tree or null", async () => {
    const trace = await store.getTrace(golden.traceId);
    expect(trace).not.toBeNull();
    const t = trace as HarnessTrace;
    const events = t.turns.flatMap((turn) => turn.events);
    expect(events.length).toBe(3);
    const toolCall = events.find((e) => e.eventType === "tool.call");
    expect(toolCall).toBeDefined();
    expect(toolCall!.attrs["harness.mutated_state"]).toBe(true);

    expect(await store.getTrace("does-not-exist")).toBeNull();
  });

  it("reconstructs gen_ai.* attrs from attrs_json round-trip", async () => {
    const trace = (await store.getTrace(golden.traceId)) as HarnessTrace;
    const events = trace.turns.flatMap((turn) => turn.events);
    const planEmit = events.find((e) => e.eventType === "plan.emit");
    expect(planEmit!.attrs["gen_ai.usage.input_tokens"]).toBe(1200);
    expect(planEmit!.attrs["gen_ai.usage.output_tokens"]).toBe(350);
    expect(planEmit!.attrs["gen_ai.request.model"]).toBe("claude-sonnet-4-5");
  });

  it("preserves absence: a mutating tool.call with no verify.result yields ZERO verify.result rows", async () => {
    const trace = (await store.getTrace(golden.traceId)) as HarnessTrace;
    const events = trace.turns.flatMap((turn) => turn.events);
    const verifyResults = events.filter((e) => e.eventType === "verify.result");
    expect(verifyResults).toHaveLength(0);
    // The mutating tool.call IS present — absence is structural, not a null/zero backfill.
    const mutating = events.filter(
      (e) => e.eventType === "tool.call" && e.attrs["harness.mutated_state"] === true,
    );
    expect(mutating).toHaveLength(1);
  });

  it("getMetricsInput returns per-trace status, durations, token sums, model, and tool-call counts", async () => {
    const mi = await store.getMetricsInput({ agentId: golden.agentId });
    expect(mi.traces).toHaveLength(1);
    const row = mi.traces[0];
    expect(row.traceId).toBe(golden.traceId);
    expect(row.statusCode).toBe(golden.statusCode);
    expect(row.durationNs).toBe(
      (golden.endTime as number) - golden.startTime,
    );
    expect(row.inputTokens).toBe(1200);
    expect(row.outputTokens).toBe(350);
    expect(row.model).toBe("claude-sonnet-4-5");
    expect(row.mutatingToolCallCount).toBe(1);
    expect(row.toolErrorCount).toBe(0);
  });

  it("SQL is parameterized — adversarial agentId is treated as data, not SQL", async () => {
    // If the query string-interpolated agentId, this would break the query or
    // leak rows; with `?` placeholders it simply matches nothing.
    const injection = "agent-langgraph-demo'; DROP TABLE harness_traces;--";
    const traces = await store.queryTraces({ agentId: injection });
    expect(traces).toHaveLength(0);
    // The table still exists and the original row is intact.
    const intact = await store.queryTraces({ agentId: golden.agentId });
    expect(intact).toHaveLength(1);
  });
});
