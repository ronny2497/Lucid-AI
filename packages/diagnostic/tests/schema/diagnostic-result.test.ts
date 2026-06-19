/**
 * GREEN in Wave 0/1: validates the frozen DiagnosticResult schema family and
 * confirms all three golden fixtures conform to the Phase 0 `harnessTraceSchema`.
 *
 * This is the only GREEN test in this plan. The detector/scorer/plotter/integration
 * scaffolds remain RED until Plans 02-02 .. 02-04 implement their modules.
 */

import { describe, it, expect } from "vitest";
import * as Ajv2020Module from "ajv/dist/2020.js";
import * as addFormatsModule from "ajv-formats";
import { harnessTraceSchema } from "@lucid/hsc-schema";

// ajv/dist/2020 and ajv-formats are CommonJS; unwrap the default export so this
// compiles under tsc (NodeNext) and runs under vitest/esbuild — same interop the
// @lucid/conformance package uses.
const Ajv2020 = ((Ajv2020Module as { default?: unknown }).default ??
  Ajv2020Module) as typeof import("ajv/dist/2020.js").default;
const addFormats = ((addFormatsModule as { default?: unknown }).default ??
  addFormatsModule) as typeof import("ajv-formats")["default"];
import {
  DiagnosticResultSchema,
  PrincipleScoreSchema,
  Plot2x2Schema,
} from "../../src/schema.js";
import emptyFeedback from "../fixtures/golden-trace-empty-feedback.json" with { type: "json" };
import fullFeedback from "../fixtures/golden-trace-full-feedback.json" with { type: "json" };
import sparse from "../fixtures/golden-trace-sparse.json" with { type: "json" };
import { sparseExpectation } from "../fixtures/expectations.js";

// A hand-built, fully valid DiagnosticResult.
const validResult = {
  traceId: "trace-empty-feedback",
  agentId: "hermes-agent",
  harness_version: "0.1.0",
  principles: [
    {
      principle: "feedback",
      score: 0,
      coverage: 1,
      hitCount: 3,
      relevantEventCount: 3,
      worstDetector: "feedback.no-verify-after-mutation",
    },
  ],
  findings: [
    {
      id: "F1",
      detectorId: "feedback.no-verify-after-mutation",
      principle: "feedback",
      severity: "high",
      evidence: "db.write (2), api.post (1)",
      remediation: "add verify.result after db.write / api.post calls",
      eventIds: ["e3", "e4", "e6"],
      forwardAction: "lucid evolve propose --finding F1",
    },
  ],
  plot2x2: {
    cells: {
      feedforward_computational: { count: 4, eventTypes: ["context.load", "task.slice", "doc.encode"] },
      feedforward_inferential: { count: 1, eventTypes: ["plan.emit"] },
      feedback_computational: { count: 0, eventTypes: [] },
      feedback_inferential: { count: 0, eventTypes: [] },
    },
    emptyColumns: ["feedback"],
    emptyRows: [],
  },
  generatedAt: "2026-06-18T00:00:00.000Z",
  llmJudgeEnabled: false,
};

describe("DiagnosticResultSchema", () => {
  it("parses a valid hand-built DiagnosticResult", () => {
    const parsed = DiagnosticResultSchema.parse(validResult);
    expect(parsed.traceId).toBe("trace-empty-feedback");
    expect(parsed.principles[0].score).toBe(0);
  });

  it("rejects a result missing `findings`", () => {
    const { findings, ...withoutFindings } = validResult;
    void findings;
    expect(DiagnosticResultSchema.safeParse(withoutFindings).success).toBe(false);
  });

  it("rejects an out-of-range principle score (> 1)", () => {
    const bad = {
      ...validResult,
      principles: [{ ...validResult.principles[0], score: 1.5 }],
    };
    expect(DiagnosticResultSchema.safeParse(bad).success).toBe(false);
  });
});

describe("PrincipleScoreSchema", () => {
  it("accepts score null with coverage 0 (the absence guard)", () => {
    const r = PrincipleScoreSchema.safeParse({
      principle: "feedback",
      score: null,
      coverage: 0,
      hitCount: 0,
      relevantEventCount: 0,
      worstDetector: "",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a score above 1", () => {
    const r = PrincipleScoreSchema.safeParse({
      principle: "feedback",
      score: 1.2,
      coverage: 1,
      hitCount: 0,
      relevantEventCount: 1,
      worstDetector: "",
    });
    expect(r.success).toBe(false);
  });
});

describe("Plot2x2Schema", () => {
  it("accepts an empty feedback column", () => {
    const r = Plot2x2Schema.safeParse(validResult.plot2x2);
    expect(r.success).toBe(true);
  });
});

describe("golden fixtures conform to harnessTraceSchema", () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(harnessTraceSchema as object);

  it.each([
    ["empty-feedback", emptyFeedback],
    ["full-feedback", fullFeedback],
    ["sparse", sparse],
  ])("%s fixture validates", (_name, fixture) => {
    const ok = validate(fixture);
    if (!ok) {
      // Surface the AJV errors for fast debugging when a fixture drifts.
      throw new Error(JSON.stringify(validate.errors, null, 2));
    }
    expect(ok).toBe(true);
  });

  it("sparse expectation encodes the null/coverage:0 feedback guard", () => {
    expect(sparseExpectation.principles.feedback?.score).toBeNull();
    expect(sparseExpectation.principles.feedback?.coverage).toBe(0);
  });
});
