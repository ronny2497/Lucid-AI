/**
 * Pitfall-2 guard — silent zero-proposal bug.
 *
 * Asserts:
 *   1. Every detector id the mapper keys on resolves via `getDetector(id)` from
 *      `@lucid/diagnostic` (a copied/drifted id would fail HERE, loudly, instead
 *      of silently mapping to zero proposals).
 *   2. Each of the five Phase 2 principle detector ids yields >=1 candidate, so no
 *      finding type can silently produce zero proposals (PRD M2).
 *   3. An unknown detectorId returns `[]` (no crash) — the safe default.
 *   4. No principle rule emits `delete-layer` on a score-only path (the delete
 *      seam requires VersionDiff evidence; Pitfall 5 / threat T-03-08).
 */

import { describe, it, expect } from "vitest";
import {
  getDetector,
  NO_VERIFY_AFTER_MUTATION_ID,
  BUDGET_PRESSURE_ID,
  ACT_BEFORE_PLAN_ID,
  OVERSIZED_SLICE_ID,
  NO_DOC_ENCODING_ID,
} from "@lucid/diagnostic";
import type { DiagnosticResult, Finding } from "@lucid/diagnostic";

import { findingToChangeSets, MAPPED_DETECTOR_IDS } from "../../src/mapper/index.js";

/** A minimal valid-enough DiagnosticResult context for mapping (mapper reads only the finding). */
const stubDiagnostic = (): DiagnosticResult =>
  ({
    traceId: "t",
    agentId: "a",
    harness_version: "v1",
    principles: [],
    findings: [],
    plot2x2: {
      cells: {},
      emptyColumns: [],
      emptyRows: [],
    },
    generatedAt: "2026-06-18T00:00:00.000Z",
    llmJudgeEnabled: false,
  }) as unknown as DiagnosticResult;

const makeFinding = (detectorId: string, principle: Finding["principle"]): Finding => ({
  id: "F1",
  detectorId,
  principle,
  severity: "high",
  evidence: "12 of 30 events flagged. Offending tools by count: tool.alpha (8), tool.beta (4).",
  remediation: "remediate",
  eventIds: ["evt-1"],
  forwardAction: "lucid evolve propose --finding F1",
});

const PRINCIPLE_CASES: ReadonlyArray<[string, Finding["principle"]]> = [
  [NO_VERIFY_AFTER_MUTATION_ID, "feedback"],
  [BUDGET_PRESSURE_ID, "context"],
  [ACT_BEFORE_PLAN_ID, "plan_execute"],
  [OVERSIZED_SLICE_ID, "one_at_a_time"],
  [NO_DOC_ENCODING_ID, "codebase_docs"],
];

describe("mapper coverage — Pitfall-2 guard", () => {
  it("every mapped detector id resolves in the @lucid/diagnostic detector set", () => {
    for (const id of MAPPED_DETECTOR_IDS) {
      expect(getDetector(id), `mapped id "${id}" is absent from detectorRegistry`).toBeDefined();
    }
  });

  it("keys exactly the five Phase 2 principle detector ids", () => {
    expect([...MAPPED_DETECTOR_IDS].sort()).toEqual(
      PRINCIPLE_CASES.map(([id]) => id).sort(),
    );
  });

  it("each of the five principle detector ids yields >=1 candidate", () => {
    const diagnostic = stubDiagnostic();
    for (const [id, principle] of PRINCIPLE_CASES) {
      const candidates = findingToChangeSets(makeFinding(id, principle), diagnostic);
      expect(candidates.length, `detector "${id}" produced zero candidates`).toBeGreaterThanOrEqual(1);
    }
  });

  it("never emits delete-layer on a score-only path", () => {
    const diagnostic = stubDiagnostic();
    for (const [id, principle] of PRINCIPLE_CASES) {
      const candidates = findingToChangeSets(makeFinding(id, principle), diagnostic);
      for (const c of candidates) {
        expect(c.change).not.toBe("delete-layer");
      }
    }
  });

  it("returns [] for an unknown detectorId (no crash)", () => {
    const diagnostic = stubDiagnostic();
    const candidates = findingToChangeSets(
      makeFinding("does.not-exist", "feedback"),
      diagnostic,
    );
    expect(candidates).toEqual([]);
  });
});
