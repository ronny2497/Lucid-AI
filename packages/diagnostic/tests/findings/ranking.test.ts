/**
 * GREEN once Plan 02-04 implements `buildFindings`.
 *
 * Asserts the findings-engine contract: leverage ordering, sequential id
 * assignment, flagship roll-up grouping by tool name, absence-finding emission for
 * a null-score principle, and the forwardAction format. The fixtures here are
 * hand-built minimal traces/hits — the end-to-end golden-fixture assertions live in
 * tests/integration/diagnose.test.ts.
 */

import { describe, it, expect } from "vitest";
import { buildFindings, LEVERAGE_ORDER, FEEDBACK_ABSENT_ID } from "../../src/findings/index.js";
import { FindingSchema, type PrincipleScore, type Plot2x2 } from "../../src/schema.js";
import type { DetectorHit, HarnessTrace } from "../../src/types.js";

/** A structured trace whose events name the tools the flagship hits cite. */
const traceWithTools: HarnessTrace = {
  traceId: "t",
  agentId: "a",
  turns: [
    {
      id: "t1",
      events: [
        { eventId: "e1", eventType: "tool.call", principle: "plan_execute", quadrant: { x: null, y: null }, attrs: { "gen_ai.tool.name": "db.write" } },
        { eventId: "e2", eventType: "tool.call", principle: "plan_execute", quadrant: { x: null, y: null }, attrs: { "gen_ai.tool.name": "db.write" } },
        { eventId: "e3", eventType: "tool.call", principle: "plan_execute", quadrant: { x: null, y: null }, attrs: { "gen_ai.tool.name": "api.post" } },
      ],
    },
  ],
};

const emptyPlot: Plot2x2 = {
  cells: {
    feedforward_computational: { count: 0, eventTypes: [] },
    feedforward_inferential: { count: 0, eventTypes: [] },
    feedback_computational: { count: 0, eventTypes: [] },
    feedback_inferential: { count: 0, eventTypes: [] },
  },
  emptyColumns: [],
  emptyRows: [],
};

function score(principle: PrincipleScore["principle"], partial: Partial<PrincipleScore> = {}): PrincipleScore {
  return {
    principle,
    score: 0.5,
    coverage: 1,
    hitCount: 1,
    relevantEventCount: 2,
    worstDetector: "",
    ...partial,
  };
}

describe("buildFindings — ranking + ids", () => {
  it("sorts by LEVERAGE_ORDER then assigns sequential F1..Fn ids", () => {
    // Hits in non-leverage order: codebase_docs, plan_execute, feedback.
    const hits: DetectorHit[] = [
      { detectorId: "codebase_docs.no-doc-encoding", principle: "codebase_docs", eventIds: ["e1"], evidence: "x", leverage: "med", remediation: "r" },
      { detectorId: "plan_execute.act-before-plan", principle: "plan_execute", eventIds: ["e2"], evidence: "y", leverage: "med", remediation: "r" },
      { detectorId: "feedback.no-verify-after-mutation", principle: "feedback", eventIds: ["e1"], evidence: "z", leverage: "high", remediation: "r" },
    ];
    const findings = buildFindings(
      hits,
      [score("feedback"), score("plan_execute"), score("codebase_docs")],
      emptyPlot,
      traceWithTools,
    );
    expect(findings.map((f) => f.principle)).toEqual(["feedback", "plan_execute", "codebase_docs"]);
    expect(findings.map((f) => f.id)).toEqual(["F1", "F2", "F3"]);
    // LEVERAGE_ORDER is the canonical ranking key.
    expect(LEVERAGE_ORDER[0]).toBe("feedback");
  });

  it("rolls the flagship's many hits into ONE finding grouped by tool name", () => {
    const hits: DetectorHit[] = [
      { detectorId: "feedback.no-verify-after-mutation", principle: "feedback", eventIds: ["e1"], evidence: "db.write (unverified)", leverage: "high", remediation: "add verify" },
      { detectorId: "feedback.no-verify-after-mutation", principle: "feedback", eventIds: ["e2"], evidence: "db.write (unverified)", leverage: "high", remediation: "add verify" },
      { detectorId: "feedback.no-verify-after-mutation", principle: "feedback", eventIds: ["e3"], evidence: "api.post (unverified)", leverage: "high", remediation: "add verify" },
    ];
    const findings = buildFindings(hits, [score("feedback")], emptyPlot, traceWithTools);
    expect(findings).toHaveLength(1);
    // Grouped by tool name with counts (db.write seen twice, api.post once).
    expect(findings[0]!.evidence).toBe("db.write (2), api.post (1)");
    expect(findings[0]!.severity).toBe("high");
    expect(findings[0]!.eventIds).toEqual(["e1", "e2", "e3"]);
  });

  it("emits an explicit absence finding for a null-score principle (never dropped)", () => {
    const scores: PrincipleScore[] = [
      score("feedback", { score: null, coverage: 0, hitCount: 0, relevantEventCount: 0 }),
    ];
    const plot: Plot2x2 = { ...emptyPlot, emptyColumns: ["feedback"] };
    const findings = buildFindings([], scores, plot, traceWithTools);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.detectorId).toBe(FEEDBACK_ABSENT_ID);
    expect(findings[0]!.evidence).toContain("absence is the finding");
    expect(findings[0]!.evidence).toContain("feedback column");
  });

  it("every finding's forwardAction equals 'lucid evolve propose --finding <id>' and validates", () => {
    const hits: DetectorHit[] = [
      { detectorId: "context.budget-pressure", principle: "context", eventIds: ["e9"], evidence: "context.load of 4200 input tokens exceeds budget 4000", leverage: "med", remediation: "trim" },
    ];
    const findings = buildFindings(hits, [score("context")], emptyPlot, traceWithTools);
    for (const f of findings) {
      expect(f.forwardAction).toBe(`lucid evolve propose --finding ${f.id}`);
      expect(FindingSchema.safeParse(f).success).toBe(true);
    }
    // No tool name derivable for a context.load event → falls back to derived evidence.
    expect(findings[0]!.evidence).toContain("input tokens");
  });
});
