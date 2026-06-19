import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { AdapterManifestSchema } from "@lucid/adapter-sdk";
import { HARNESS_ATTR, GEN_AI_ATTR } from "@lucid/hsc-schema";
import {
  adapter,
  buildManifest,
  projectStep,
  runScenario,
  HONEST_ABSENCES,
  HSC_VERSION,
  type AgentsRunStep,
} from "../src/adapter.js";

/**
 * Unit tests for the OpenAI Agents SDK adapter.
 *
 * These assert the two authoring-contract properties the EC-1 onramp depends on:
 *   (1) honest absence — driving a run with tool calls but NO verification step
 *       produces tool.call events and NO verify.result / feedback.check, and
 *       those two types are declared in honestAbsences;
 *   (2) manifest validity — the adapter's toManifest() output (and the checked-in
 *       manifest.json) validates against AdapterManifestSchema and targets v0.
 *
 * The adapter is exercised through its PUBLIC surface only (`@lucid/adapter-sdk`
 * + `@lucid/hsc-schema`) — exactly the surface a third-party author would have.
 */

const here = dirname(fileURLToPath(import.meta.url));

function eventTypesOf(trace: ReturnType<typeof runScenario>): string[] {
  return trace.turns.flatMap((t) =>
    t.events.map((e) => e[HARNESS_ATTR.eventType] as string),
  );
}

describe("manifest — schema-valid and targets HSC v0", () => {
  it("buildManifest() validates against AdapterManifestSchema", () => {
    const manifest = buildManifest();
    expect(() => AdapterManifestSchema.parse(manifest)).not.toThrow();
    expect(manifest.hscVersion).toBe(HSC_VERSION);
    expect(manifest.framework).toMatch(/^openai-agents@/);
  });

  it("declares verify.result + feedback.check as honest absences (not coverage)", () => {
    const manifest = buildManifest();
    expect(manifest.honestAbsences).toEqual(
      expect.arrayContaining(["verify.result", "feedback.check"]),
    );
    expect(manifest.eventCoverage).not.toContain("verify.result");
    expect(manifest.eventCoverage).not.toContain("feedback.check");
    // The adapter's declared lifecycle hooks never include the verify/feedback ones.
    expect(adapter.hooks).not.toContain("onVerify");
    expect(adapter.hooks).not.toContain("onFeedbackCheck");
    expect(HONEST_ABSENCES).toEqual(["verify.result", "feedback.check"]);
  });

  it("the checked-in manifest.json matches buildManifest() and is schema-valid", () => {
    const onDisk = JSON.parse(
      readFileSync(join(here, "..", "manifest.json"), "utf8"),
    );
    expect(() => AdapterManifestSchema.parse(onDisk)).not.toThrow();
    expect(onDisk).toEqual(buildManifest());
  });
});

describe("honest absence — a run with tool calls but no verification", () => {
  const RUN: AgentsRunStep[] = [
    { kind: "agent_start", genAi: { [GEN_AI_ATTR.agentName]: "researcher" } },
    { kind: "model_response", genAi: { [GEN_AI_ATTR.requestModel]: "gpt-4o" } },
    {
      kind: "tool_call",
      genAi: { [GEN_AI_ATTR.toolName]: "web_search" },
    },
    {
      kind: "tool_call",
      genAi: { [GEN_AI_ATTR.toolName]: "write_file" },
      mutatedState: true,
    },
    { kind: "model_response", genAi: { [GEN_AI_ATTR.requestModel]: "gpt-4o" } },
  ];

  it("emits context.load / plan.emit / tool.call and NO verify.result / feedback.check", () => {
    const trace = runScenario(RUN);
    const types = eventTypesOf(trace);
    expect(types).toContain("context.load");
    expect(types).toContain("plan.emit");
    expect(types).toContain("tool.call");
    expect(types).not.toContain("verify.result");
    expect(types).not.toContain("feedback.check");
  });

  it("forwards only non-content gen_ai identifiers and stamps mutated_state", () => {
    const trace = runScenario(RUN);
    const events = trace.turns[0]!.events;
    const mutating = events.find(
      (e) => e[GEN_AI_ATTR.toolName] === "write_file",
    )!;
    expect(mutating[HARNESS_ATTR.eventType]).toBe("tool.call");
    expect(mutating[HARNESS_ATTR.mutatedState]).toBe(true);
    expect(mutating[HARNESS_ATTR.principle]).toBe("plan_execute");
  });

  it("sources principle + quadrant from the schema bindings (not hand-assigned)", () => {
    const ctx = projectStep({ kind: "agent_start" }, 1)!;
    expect(ctx[HARNESS_ATTR.eventType]).toBe("context.load");
    expect(ctx[HARNESS_ATTR.principle]).toBe("context");
    expect(ctx[HARNESS_ATTR.quadrantX]).toBe("feedforward");
    expect(ctx[HARNESS_ATTR.quadrantY]).toBe("computational");
  });

  it("skips an unknown step kind (opaque passthrough, never coerced)", () => {
    // @ts-expect-error — an unknown step kind is not part of AgentsStepKind.
    expect(projectStep({ kind: "totally_unknown" }, 1)).toBeNull();
  });
});
