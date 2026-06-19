import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { trace } from "@opentelemetry/api";
import { HARNESS_ATTR } from "@lucid/hsc-schema";

import { emitOrOmit, PROHIBITED_INFERENCE } from "../src/emit-or-omit.js";

/**
 * RED tests for emitOrOmit — the no-fabrication gate.
 *
 * Mirrors the @lucid/sdk test harness: an InMemorySpanExporter wired through a
 * SimpleSpanProcessor on the global provider captures every span the SDK emits,
 * so we can assert the EXACT count of spans (0 or 1) per call. The honesty
 * invariant is "absence is signal" (D-05): no substantiating context ⇒ no span.
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

describe("emitOrOmit — substantiation gate (absence is signal, D-05)", () => {
  it("emits exactly one span when called WITH a substantiating context", () => {
    const result = emitOrOmit("tool.call", {
      substantiated: true,
      attrs: { principle: "plan_execute" },
    });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]!.attributes[HARNESS_ATTR.eventType]).toBe("tool.call");
    // A truthy/defined return signals the emission happened.
    expect(result).toBeDefined();
  });

  it("returns undefined and emits NO span when substantiated:false", () => {
    const result = emitOrOmit("verify.result", {
      substantiated: false,
      attrs: { principle: "feedback" },
    });

    expect(result).toBeUndefined();
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });

  it("returns undefined and emits NO span when substantiated is omitted entirely", () => {
    const result = emitOrOmit("verify.result", {
      // no `substantiated` key at all → treated as not substantiated
      attrs: { principle: "feedback" },
    } as never);

    expect(result).toBeUndefined();
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });
});

describe("emitOrOmit — prohibited-inference rejection (§5.2)", () => {
  it("derives the prohibited-inference set as every event type except context.load / plan.emit", () => {
    // §5.2: inference is permitted ONLY for context.load and plan.emit.
    expect(PROHIBITED_INFERENCE.has("verify.result")).toBe(true);
    expect(PROHIBITED_INFERENCE.has("feedback.check")).toBe(true);
    expect(PROHIBITED_INFERENCE.has("evolve.propose")).toBe(true);
    expect(PROHIBITED_INFERENCE.has("evolve.apply")).toBe(true);
    // permitted-inference events are NOT in the set
    expect(PROHIBITED_INFERENCE.has("context.load")).toBe(false);
    expect(PROHIBITED_INFERENCE.has("plan.emit")).toBe(false);
  });

  for (const et of ["verify.result", "feedback.check", "evolve.propose", "evolve.apply"] as const) {
    it(`rejects ${et} when inferred:true (no span, returns undefined)`, () => {
      const result = emitOrOmit(et, {
        substantiated: true,
        inferred: true,
        attrs: { principle: "feedback" },
      });

      expect(result).toBeUndefined();
      expect(exporter.getFinishedSpans()).toHaveLength(0);
    });
  }
});

describe("emitOrOmit — permitted inference carries harness.inferred=true", () => {
  for (const et of ["context.load", "plan.emit"] as const) {
    it(`${et} with inferred:true emits a span carrying harness.inferred=true`, () => {
      const result = emitOrOmit(et, {
        substantiated: true,
        inferred: true,
        attrs: { principle: et === "context.load" ? "context" : "plan_execute" },
      });

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]!.attributes[HARNESS_ATTR.eventType]).toBe(et);
      expect(spans[0]!.attributes[HARNESS_ATTR.inferred]).toBe(true);
      expect(result).toBeDefined();
    });
  }

  it("does NOT stamp harness.inferred when inferred is not set", () => {
    emitOrOmit("plan.emit", {
      substantiated: true,
      attrs: { principle: "plan_execute" },
    });

    const attrs = exporter.getFinishedSpans()[0]!.attributes;
    expect(attrs[HARNESS_ATTR.inferred]).toBeUndefined();
  });
});

describe("emitOrOmit — emitter-specified y is never auto-assigned (EMITTER_SPECIFIED_Y)", () => {
  it("feedback.check without an explicit y leaves quadrant.y unset (delegates to SDK)", () => {
    emitOrOmit("feedback.check", {
      substantiated: true,
      attrs: { principle: "feedback" },
    });

    const attrs = exporter.getFinishedSpans()[0]!.attributes;
    expect(attrs[HARNESS_ATTR.quadrantX]).toBe("feedback");
    // y must NOT be auto-assigned — the SDK's EMITTER_SPECIFIED_Y carve-out holds.
    expect(attrs[HARNESS_ATTR.quadrantY]).toBeUndefined();
  });

  it("feedback.check WITH an explicit y sets it (still no auto-assign)", () => {
    emitOrOmit("feedback.check", {
      substantiated: true,
      attrs: { principle: "feedback", quadrant: { y: "computational" } },
    });

    const attrs = exporter.getFinishedSpans()[0]!.attributes;
    expect(attrs[HARNESS_ATTR.quadrantY]).toBe("computational");
  });
});
