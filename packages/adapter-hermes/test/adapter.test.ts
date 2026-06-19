import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-node";
import { trace } from "@opentelemetry/api";
import { EVENT_TYPES, HARNESS_ATTR } from "@lucid/hsc-schema";
import { validateTrace } from "@lucid/conformance";
import { HermesToHsc, COVERED_EVENT_TYPES, mapLifecycle } from "../src/mapping.js";
import { runReferenceTrajectory, emitForLifecycle } from "../src/index.js";

/**
 * Tests for the hermes reference adapter.
 *
 * An InMemorySpanExporter (SimpleSpanProcessor) captures the spans the adapter
 * emits through @lucid/sdk; we assemble them into a HarnessTrace document and
 * assert it passes @lucid/conformance validateTrace(). The mapping is asserted
 * to cover every EVENT_TYPES member (incl. the Phase 5 L2 self-evolution events).
 */

let exporter: InMemorySpanExporter;
let provider: NodeTracerProvider;

beforeEach(() => {
  exporter = new InMemorySpanExporter();
  provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  provider.register();
});

afterEach(async () => {
  trace.disable();
  exporter.reset();
  await provider.shutdown();
});

function toHarnessEvent(span: ReadableSpan, idx: number): Record<string, unknown> {
  const a = span.attributes as Record<string, unknown>;
  const event: Record<string, unknown> = { span_id: `span-${idx}`, name: span.name };
  for (const [k, v] of Object.entries(a)) {
    if (v !== undefined && v !== null) event[k] = v;
  }
  return event;
}

function assembleTrace(spans: readonly ReadableSpan[]): unknown {
  return {
    hsc_version: "v0",
    trace_id: "trace-hermes-test",
    harness_id: "hermes",
    turns: [
      {
        turn_id: "turn-0",
        events: spans.map((s, i) => toHarnessEvent(s, i)),
      },
    ],
  };
}

describe("HermesToHsc mapping — full HSC taxonomy", () => {
  it("covers every EVENT_TYPES member", () => {
    for (const et of EVENT_TYPES) {
      expect(COVERED_EVENT_TYPES.has(et)).toBe(true);
    }
    expect(COVERED_EVENT_TYPES.size).toBe(EVENT_TYPES.length);
  });

  it("the mapping VALUES are exactly the canonical event types (no extras)", () => {
    const values = new Set(Object.values(HermesToHsc));
    expect(values).toEqual(new Set(EVENT_TYPES));
  });

  it("includes the feedback.check and verify.result targets", () => {
    const values = Object.values(HermesToHsc) as string[];
    expect(values).toContain("feedback.check");
    expect(values).toContain("verify.result");
  });

  it("maps a known lifecycle point and returns null for an unknown one", () => {
    expect(mapLifecycle({ point: "tool_invoked" })).toBe("tool.call");
    expect(mapLifecycle({ point: "verification_ran" })).toBe("verify.result");
    expect(mapLifecycle({ point: "not_a_real_point" })).toBeNull();
  });
});

describe("emitForLifecycle — emits via @lucid/sdk", () => {
  it("emits a feedback.check carrying the emitter-specified quadrant.y", () => {
    const out = emitForLifecycle({ point: "feedback_checked" }, { quadrantY: "inferential" });
    expect(out).toBe("feedback.check");
    const attrs = exporter.getFinishedSpans()[0]!.attributes;
    expect(attrs[HARNESS_ATTR.eventType]).toBe("feedback.check");
    expect(attrs[HARNESS_ATTR.quadrantX]).toBe("feedback");
    expect(attrs[HARNESS_ATTR.quadrantY]).toBe("inferential");
  });

  it("returns null and emits nothing for an unknown lifecycle point", () => {
    expect(emitForLifecycle({ point: "nope" })).toBeNull();
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });
});

describe("runReferenceTrajectory — full taxonomy + both feedback shapes", () => {
  it("emits at least one of every HSC event type", () => {
    runReferenceTrajectory();
    const emitted = new Set(
      exporter.getFinishedSpans().map((s) => s.attributes[HARNESS_ATTR.eventType] as string),
    );
    for (const et of EVENT_TYPES) {
      expect(emitted.has(et)).toBe(true);
    }
  });

  it("emits the feedback.check / verify.result pairing", () => {
    runReferenceTrajectory();
    const types = exporter
      .getFinishedSpans()
      .map((s) => s.attributes[HARNESS_ATTR.eventType] as string);
    expect(types).toContain("feedback.check");
    expect(types).toContain("verify.result");
  });

  it("preserves the honest empty-feedback case (a trailing mutating tool.call with no following verify.result)", () => {
    runReferenceTrajectory();
    const spans = exporter.getFinishedSpans();
    const types = spans.map((s) => s.attributes[HARNESS_ATTR.eventType] as string);

    // There are two mutating tool.calls; only the first is followed by a
    // verify.result. The last tool.call has no verify.result after it.
    const mutatingIdxs = spans
      .map((s, i) => ({ i, et: s.attributes[HARNESS_ATTR.eventType], mut: s.attributes[HARNESS_ATTR.mutatedState] }))
      .filter((x) => x.et === "tool.call" && x.mut === true)
      .map((x) => x.i);
    expect(mutatingIdxs.length).toBe(2);

    const lastMutating = mutatingIdxs[mutatingIdxs.length - 1]!;
    const followedByVerify = types.slice(lastMutating + 1).includes("verify.result");
    expect(followedByVerify).toBe(false); // honest absence preserved
  });

  it("assembles into a validateTrace()-passing trace", () => {
    runReferenceTrajectory();
    const traceDoc = assembleTrace(exporter.getFinishedSpans());
    const result = validateTrace(traceDoc);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});
