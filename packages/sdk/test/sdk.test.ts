import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { trace } from "@opentelemetry/api";
import { HARNESS_ATTR, quadrantFor } from "@lucid/hsc-schema";
import { harness } from "../src/index.js";

/**
 * Wave-0 RED tests for the @lucid/sdk emission core.
 *
 * They register an InMemorySpanExporter via a SimpleSpanProcessor so spans the
 * SDK emits through the global tracer are captured synchronously and can be
 * asserted on. RED until src/sdk.ts + src/index.ts exist.
 *
 * Attribute KEYS are sourced from HARNESS_ATTR and quadrant VALUES from
 * quadrantFor() — never hardcoded — so a Phase 0 rename does not touch the SDK.
 */

let exporter: InMemorySpanExporter;
let provider: NodeTracerProvider;

beforeEach(() => {
  exporter = new InMemorySpanExporter();
  provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  // Make this provider the global one so trace.getTracer() inside the SDK
  // resolves it. register() also installs context/propagation managers.
  provider.register();
});

afterEach(async () => {
  trace.disable();
  exporter.reset();
  await provider.shutdown();
});

describe("harness.event — emits one finished HSC span with schema-sourced attrs", () => {
  it("tool.call carries harness.event_type / principle / mutated_state from HARNESS_ATTR", () => {
    harness.event("tool.call", { principle: "plan_execute", mutatedState: true });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);

    const attrs = spans[0]!.attributes;
    expect(attrs[HARNESS_ATTR.eventType]).toBe("tool.call");
    expect(attrs[HARNESS_ATTR.principle]).toBe("plan_execute");
    expect(attrs[HARNESS_ATTR.mutatedState]).toBe(true);
  });
});

describe("harness.start().end() — opens and closes a single HSC event span", () => {
  it("plan.emit span has the plan.emit event_type and quadrant tags from quadrantFor", () => {
    const handle = harness.start("plan.emit", { principle: "plan_execute" });
    // No finished span until end() is called.
    expect(exporter.getFinishedSpans()).toHaveLength(0);
    handle.end();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);

    const attrs = spans[0]!.attributes;
    const q = quadrantFor("plan.emit");
    expect(attrs[HARNESS_ATTR.eventType]).toBe("plan.emit");
    expect(attrs[HARNESS_ATTR.quadrantX]).toBe(q.x);
    expect(attrs[HARNESS_ATTR.quadrantY]).toBe(q.y);
  });
});

describe("feedback.check — quadrant.y is emitter-specified (EMITTER_SPECIFIED_Y)", () => {
  it("does NOT set quadrant.y when the caller omits it", () => {
    harness.event("feedback.check", { principle: "feedback" });

    const attrs = exporter.getFinishedSpans()[0]!.attributes;
    // x is deterministic (feedback); y must be absent — never auto-assigned.
    expect(attrs[HARNESS_ATTR.quadrantX]).toBe("feedback");
    expect(attrs[HARNESS_ATTR.quadrantY]).toBeUndefined();
  });

  it("sets quadrant.y ONLY when the caller supplies it", () => {
    harness.event("feedback.check", {
      principle: "feedback",
      quadrant: { y: "inferential" },
    });

    const attrs = exporter.getFinishedSpans()[0]!.attributes;
    expect(attrs[HARNESS_ATTR.quadrantX]).toBe("feedback");
    expect(attrs[HARNESS_ATTR.quadrantY]).toBe("inferential");
  });
});

describe("privacy — no content-bearing fields set by default", () => {
  it("does not emit gen_ai.input.messages / tool.call.arguments unless passed", () => {
    harness.event("tool.call", { principle: "plan_execute" });

    const attrs = exporter.getFinishedSpans()[0]!.attributes;
    expect(attrs["gen_ai.input.messages"]).toBeUndefined();
    expect(attrs["gen_ai.tool.call.arguments"]).toBeUndefined();
  });

  it("passes genAi attributes through verbatim when the caller supplies them", () => {
    harness.event("tool.call", {
      principle: "plan_execute",
      genAi: { "gen_ai.tool.name": "write_file" },
    });

    const attrs = exporter.getFinishedSpans()[0]!.attributes;
    expect(attrs["gen_ai.tool.name"]).toBe("write_file");
  });
});
