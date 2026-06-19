import { describe, expect, it } from "vitest";

import { GEN_AI_ATTR, HARNESS_ATTR } from "@lucid/hsc-schema";

// EC-1 — the unaided third-party certification path.
//
// This test imports ONLY the PUBLIC packages a real adapter author would have:
//   - the adapter under test (authored on @lucid/adapter-sdk + @lucid/hsc-schema);
//   - the @lucid/conformance suite (`runConformanceSuite`) + badge (`emitBadge`).
//
// The conformance suite + badge come from @lucid/conformance — a devDependency
// of this package — via its published subpath exports (`./suite`, `./badge`).
// This is the exact end-to-end path the authoring guide documents (scaffold ->
// author -> drive -> run the offline suite -> emit a self-declared badge). The
// ADAPTER itself never imports @lucid/conformance — only this TEST does (the
// unaided property: a third party authors against the public SDK, then certifies
// against the published suite).
import { runConformanceSuite } from "@lucid/conformance/suite";
import { emitBadge } from "@lucid/conformance/badge";

import {
  runScenario,
  buildManifest,
  HSC_VERSION,
  type AgentsRunStep,
} from "../src/adapter.js";

/**
 * A representative OpenAI Agents SDK run: the agent loads context, the model
 * responds (a plan), it calls two tools (one mutating), and the model responds
 * again. There is NO verification step — the framework has none — so the trace
 * honestly carries no verify.result / feedback.check.
 */
const HONEST_RUN: AgentsRunStep[] = [
  { kind: "agent_start", genAi: { [GEN_AI_ATTR.agentName]: "triage" } },
  { kind: "model_response", genAi: { [GEN_AI_ATTR.requestModel]: "gpt-4o" } },
  { kind: "tool_call", genAi: { [GEN_AI_ATTR.toolName]: "web_search" } },
  {
    kind: "tool_call",
    genAi: { [GEN_AI_ATTR.toolName]: "write_file" },
    mutatedState: true,
  },
  { kind: "model_response", genAi: { [GEN_AI_ATTR.requestModel]: "gpt-4o" } },
];

const SUITE_OPTS = {
  hscVersion: HSC_VERSION,
  adapter: { name: "@lucid/adapter-openai-agents", hscVersion: HSC_VERSION },
} as const;

describe("EC-1 — a third-party adapter certifies unaided through the public suite", () => {
  it("drives the adapter -> trace -> three-layer suite -> PASS verdict + badge", () => {
    // 1. AUTHOR-DRIVEN: produce a real HSC trace from a run, public surface only.
    const trace = runScenario(HONEST_RUN, { traceId: "ec1-openai-agents" });

    // 2. CERTIFY: run the published three-layer conformance suite over it.
    const report = runConformanceSuite(trace, SUITE_OPTS);

    // 3. The honest trace PASSES all three layers (Layer 1 is advisory for the
    //    turns/events shape; Layers 2 + 3 pass; absence is signal, never a fail).
    expect(report.verdict).toBe("PASS");
    expect(report.layers.otelValidity.pass).toBe(true);
    expect(report.layers.hscExtension.pass).toBe(true);
    expect(report.layers.behavioralHonesty.pass).toBe(true);
    expect(report.errors.filter((e) => e.severity === "error")).toEqual([]);
    expect(report.hscVersion).toBe(HSC_VERSION);

    // 4. BADGE: emit the self-declared, re-verifiable badge keyed to HSC version.
    const manifest = buildManifest();
    const badge = emitBadge(report, { eventCoverage: manifest.eventCoverage });
    expect(badge.verdict).toBe("PASS");
    expect(badge.hscVersion).toBe(HSC_VERSION);
    expect(badge.label).toBe(`HSC ${HSC_VERSION}`);
    expect(badge.adapter.name).toBe("@lucid/adapter-openai-agents");
    // The badge carries the keys a re-verifier needs to re-run the offline suite.
    expect(badge.reportRef.verdict).toBe("PASS");
    expect(badge.reportRef.errorCount).toBe(0);
    expect(badge.eventCoverage).toEqual(
      expect.arrayContaining(["context.load", "plan.emit", "tool.call"]),
    );
  });

  it("the honest trace contains NO verify.result / feedback.check (absence preserved)", () => {
    const trace = runScenario(HONEST_RUN);
    const types = trace.turns.flatMap((t) =>
      t.events.map((e) => e[HARNESS_ATTR.eventType] as string),
    );
    expect(types).not.toContain("verify.result");
    expect(types).not.toContain("feedback.check");
  });

  it("a deliberately-broken variant (fabricated verify.result) FAILS with a located honesty error", () => {
    // The careless-third-party mistake: synthesize a verify.result to fill the
    // honest absence. The suite must catch it.
    const brokenRun: AgentsRunStep[] = [
      { kind: "agent_start" },
      { kind: "model_response" },
      {
        kind: "tool_call",
        genAi: { [GEN_AI_ATTR.toolName]: "write_file" },
        mutatedState: true,
        __fabricateVerify: true,
      },
    ];
    const trace = runScenario(brokenRun, { traceId: "ec1-broken" });
    const report = runConformanceSuite(trace, SUITE_OPTS);

    expect(report.verdict).toBe("FAIL");
    // The behavioral-honesty layer locates the fabricated verify.result.
    const honestyErrors = report.layers.behavioralHonesty.errors;
    const fabricated = honestyErrors.find((e) => e.code === "fabricated-event");
    expect(fabricated).toBeDefined();
    expect(fabricated!.layer).toBe("behavioralHonesty");
    expect(fabricated!.severity).toBe("error");
    // It is LOCATED — carries a JSON-pointer-ish path into the offending event.
    expect(fabricated!.path).toMatch(/\/turns\/0\/events\/\d+/);

    // The badge carries the FAIL honestly — it never masks the violation.
    const badge = emitBadge(report);
    expect(badge.verdict).toBe("FAIL");
    expect(badge.reportRef.errorCount).toBeGreaterThan(0);
  });
});
