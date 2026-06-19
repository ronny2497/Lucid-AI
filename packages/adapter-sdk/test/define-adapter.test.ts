import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { trace } from "@opentelemetry/api";
import { HARNESS_ATTR } from "@lucid/hsc-schema";
import { AdapterManifestSchema } from "../src/manifest.js";

import { defineAdapter, HOOK_EVENT_TYPE } from "../src/define-adapter.js";

/**
 * RED tests for defineAdapter — the declarative authoring surface over @lucid/sdk.
 *
 * Spans are captured through an InMemorySpanExporter (same harness as the SDK
 * tests). The load-bearing property is behavioral honesty: a hook that does not
 * fire emits nothing, and a hook that fires with substantiated:false emits
 * nothing — there is no synthesis path.
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

function emittedEventTypes(): string[] {
  return exporter
    .getFinishedSpans()
    .map((s) => s.attributes[HARNESS_ATTR.eventType] as string);
}

describe("defineAdapter — declared targets + enumerable hooks", () => {
  it("exposes the declared HSC target version and the enumerable hook set", () => {
    const adapter = defineAdapter({
      name: "demo-adapter",
      version: "0.1.0",
      framework: "demo@1.0",
      targets: "v0",
      onToolCall: (ctx) => ctx.emit({ substantiated: true, attrs: { principle: "plan_execute" } }),
      onContextLoad: (ctx) => ctx.emit({ substantiated: true, attrs: { principle: "context" } }),
    });

    expect(adapter.targets).toBe("v0");
    // hooks are enumerable and map to their HSC event types.
    expect(adapter.hooks.sort()).toEqual(["onContextLoad", "onToolCall"].sort());
    expect(HOOK_EVENT_TYPE.onToolCall).toBe("tool.call");
    expect(HOOK_EVENT_TYPE.onVerify).toBe("verify.result");
  });
});

describe("defineAdapter — honest absence preserved end-to-end", () => {
  it("a scenario with a tool call but NO verify hook emits tool.call and NO verify.result", () => {
    const adapter = defineAdapter({
      name: "no-verify-adapter",
      version: "0.1.0",
      framework: "demo@1.0",
      targets: "v0",
      // Only a tool-call hook is declared; the framework has no verification step.
      onToolCall: (ctx) =>
        ctx.emit({ substantiated: true, attrs: { principle: "plan_execute", mutatedState: true } }),
    });

    adapter.drive("onToolCall", {});

    const events = emittedEventTypes();
    expect(events).toContain("tool.call");
    expect(events).not.toContain("verify.result");
    expect(events).not.toContain("feedback.check");
  });
});

describe("defineAdapter — every emission routes through emit-or-omit", () => {
  it("a hook called with substantiated:false emits nothing", () => {
    const adapter = defineAdapter({
      name: "honest-adapter",
      version: "0.1.0",
      framework: "demo@1.0",
      targets: "v0",
      onVerify: (ctx) =>
        // The framework provided no verification result this turn.
        ctx.emit({ substantiated: false, attrs: { principle: "feedback" } }),
    });

    const result = adapter.drive("onVerify", {});

    expect(exporter.getFinishedSpans()).toHaveLength(0);
    expect(result).toBeUndefined();
  });

  it("driving a hook that was never declared is a no-op (no span)", () => {
    const adapter = defineAdapter({
      name: "sparse-adapter",
      version: "0.1.0",
      framework: "demo@1.0",
      targets: "v0",
      onToolCall: (ctx) => ctx.emit({ substantiated: true, attrs: { principle: "plan_execute" } }),
    });

    const result = adapter.drive("onVerify", {});
    expect(result).toBeUndefined();
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });
});

describe("defineAdapter — toManifest() is AdapterManifestSchema-valid", () => {
  it("derives eventCoverage from declared hooks and honestAbsences from spec", () => {
    const adapter = defineAdapter({
      name: "manifest-adapter",
      version: "0.2.0",
      framework: "demo@1.0",
      targets: "v0",
      honestAbsences: ["verify.result", "feedback.check"],
      onContextLoad: (ctx) => ctx.emit({ substantiated: true, attrs: { principle: "context" } }),
      onPlanEmit: (ctx) => ctx.emit({ substantiated: true, attrs: { principle: "plan_execute" } }),
      onToolCall: (ctx) => ctx.emit({ substantiated: true, attrs: { principle: "plan_execute" } }),
    });

    const manifest = adapter.toManifest();

    // schema-valid
    const parsed = AdapterManifestSchema.safeParse(manifest);
    expect(parsed.success).toBe(true);

    expect(manifest.name).toBe("manifest-adapter");
    expect(manifest.hscVersion).toBe("v0");
    expect(manifest.eventCoverage.sort()).toEqual(
      ["context.load", "plan.emit", "tool.call"].sort(),
    );
    expect(manifest.honestAbsences.sort()).toEqual(
      ["feedback.check", "verify.result"].sort(),
    );
  });

  it("throws loudly if a declared honest absence overlaps with covered hooks", () => {
    const adapter = defineAdapter({
      name: "bad-adapter",
      version: "0.1.0",
      framework: "demo@1.0",
      targets: "v0",
      // tool.call is both covered (hook) AND declared an honest absence → invalid.
      honestAbsences: ["tool.call"],
      onToolCall: (ctx) => ctx.emit({ substantiated: true, attrs: { principle: "plan_execute" } }),
    });

    expect(() => adapter.toManifest()).toThrow();
  });
});
