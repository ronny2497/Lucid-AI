import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-node";
import { trace } from "@opentelemetry/api";
import { HARNESS_ATTR, GEN_AI_ATTR } from "@lucid/hsc-schema";
import { validateTrace } from "@lucid/conformance";
import { LangGraphToHsc, mapSpan } from "../src/mapping.js";
import { emitForSpan, type ObservedSpan } from "../src/adapter.js";

/**
 * Tests for the neutral LangGraph adapter.
 *
 * The mapping is asserted directly. For the emission path we register an
 * InMemorySpanExporter (SimpleSpanProcessor) so spans `emitForSpan` produces
 * through @lucid/sdk are captured synchronously, then assemble them into a
 * HarnessTrace document and assert it passes @lucid/conformance validateTrace().
 *
 * We do NOT exercise `withLucid` here: it calls initTracing() to register a real
 * OTLP exporter, which would clobber the in-memory test provider. `emitForSpan`
 * is the same emission unit `withLucid().observe()` drives per span.
 */

const OPTS = { agentId: "lg-agent-1" } as const;

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

/**
 * Project a captured OTel span into a HarnessEvent plain object (the shape the
 * HarnessTrace JSON Schema / validateTrace expects), copying the harness.* and
 * gen_ai.* attributes verbatim and synthesizing a span_id.
 */
function toHarnessEvent(span: ReadableSpan, idx: number): Record<string, unknown> {
  const a = span.attributes as Record<string, unknown>;
  const event: Record<string, unknown> = {
    span_id: `span-${idx}`,
    name: span.name,
  };
  for (const [k, v] of Object.entries(a)) {
    if (v !== undefined && v !== null) event[k] = v;
  }
  return event;
}

function assembleTrace(spans: readonly ReadableSpan[]): unknown {
  return {
    hsc_version: "v0",
    trace_id: "trace-langgraph-test",
    harness_id: "langgraph",
    turns: [
      {
        turn_id: "turn-0",
        events: spans.map((s, i) => toHarnessEvent(s, i)),
      },
    ],
  };
}

describe("mapSpan — LangGraph OTel span name -> HSC event type", () => {
  it("maps execute_tool -> tool.call", () => {
    expect(mapSpan({ name: "execute_tool" })).toBe("tool.call");
  });

  it("maps chat -> plan.emit", () => {
    expect(mapSpan({ name: "chat" })).toBe("plan.emit");
  });

  it("maps invoke_agent -> task.slice", () => {
    expect(mapSpan({ name: "invoke_agent" })).toBe("task.slice");
  });

  it("maps an unknown span name -> null (opaque passthrough, not coerced)", () => {
    expect(mapSpan({ name: "some_unknown_langgraph_span" })).toBeNull();
    expect(mapSpan({ name: "tool" })).toBeNull();
  });

  it("the mapping table contains NO feedback.check / verify.result target", () => {
    const targets = Object.values(LangGraphToHsc) as string[];
    expect(targets).not.toContain("feedback.check");
    expect(targets).not.toContain("verify.result");
  });
});

describe("emitForSpan — emits HSC events through @lucid/sdk", () => {
  it("emits a tool.call span carrying schema-sourced event_type + principle", () => {
    const out = emitForSpan(
      { name: "execute_tool", attributes: { [GEN_AI_ATTR.toolName]: "search" } },
      OPTS,
    );
    expect(out).toBe("tool.call");

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const attrs = spans[0]!.attributes;
    expect(attrs[HARNESS_ATTR.eventType]).toBe("tool.call");
    expect(attrs[HARNESS_ATTR.principle]).toBe("plan_execute");
    // Non-content gen_ai identifiers are forwarded; agentId is stamped.
    expect(attrs[GEN_AI_ATTR.toolName]).toBe("search");
    expect(attrs[GEN_AI_ATTR.agentId]).toBe("lg-agent-1");
  });

  it("skips an unknown span (returns null, emits nothing)", () => {
    const out = emitForSpan({ name: "totally_unknown" }, OPTS);
    expect(out).toBeNull();
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });

  it("a representative batch emits NO feedback.check / verify.result", () => {
    const batch: ObservedSpan[] = [
      { name: "invoke_agent" },
      { name: "chat", attributes: { [GEN_AI_ATTR.requestModel]: "gpt-4o" } },
      { name: "execute_tool", attributes: { [GEN_AI_ATTR.toolName]: "search" } },
      { name: "execute_tool", attributes: { [GEN_AI_ATTR.toolName]: "write_file" } },
      { name: "chat" },
    ];
    for (const s of batch) emitForSpan(s, OPTS);

    const emittedTypes = exporter
      .getFinishedSpans()
      .map((s) => s.attributes[HARNESS_ATTR.eventType] as string);

    expect(emittedTypes).not.toContain("feedback.check");
    expect(emittedTypes).not.toContain("verify.result");
    // It DID emit the three core operations.
    expect(emittedTypes).toContain("task.slice");
    expect(emittedTypes).toContain("plan.emit");
    expect(emittedTypes).toContain("tool.call");
  });
});

describe("assembled trace passes @lucid/conformance validateTrace()", () => {
  it("a LangGraph-derived trace is valid (and honestly lacks feedback)", () => {
    const batch: ObservedSpan[] = [
      { name: "invoke_agent" },
      { name: "chat", attributes: { [GEN_AI_ATTR.requestModel]: "gpt-4o" } },
      { name: "execute_tool", attributes: { [GEN_AI_ATTR.toolName]: "search" } },
    ];
    for (const s of batch) emitForSpan(s, OPTS);

    const traceDoc = assembleTrace(exporter.getFinishedSpans());
    const result = validateTrace(traceDoc);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);

    // The valid trace contains no feedback.check / verify.result — the honest
    // empty-feedback-column signal is preserved, not patched.
    const turn = (traceDoc as { turns: Array<{ events: Array<Record<string, unknown>> }> }).turns[0]!;
    const types = turn.events.map((e) => e[HARNESS_ATTR.eventType]);
    expect(types).not.toContain("feedback.check");
    expect(types).not.toContain("verify.result");
  });
});
