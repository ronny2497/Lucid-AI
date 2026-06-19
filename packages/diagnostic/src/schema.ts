/**
 * @lucid/diagnostic — the frozen DiagnosticResult schema family (REQ-04).
 *
 * These Zod schemas are the OUTPUT contract of the Phase 2 pipeline. They are
 * defined BEFORE any scorer/detector/plotter exists: downstream plans implement
 * code until `diagnose()` over each golden fixture matches the recorded
 * expectation. The schema is the spec, not the test.
 *
 * The principle enum is derived from `PRINCIPLES` (Phase 0) rather than written as
 * five literals, so a Phase 0 rename propagates here automatically (A7 mitigation).
 *
 * Threat T-02-02: there is intentionally NO field for raw trace content
 * (`gen_ai.input.messages`, tool arguments). `evidence`/`remediation` are free
 * strings the pipeline fills with derived counts + tool NAMES only.
 */

import { z } from "zod";
import { PRINCIPLES } from "@lucid/hsc-schema";

/**
 * Zod enum of the five convergence principles, sourced from the Phase 0 tuple.
 * `PRINCIPLES` is a readonly tuple of string literals, which is exactly the shape
 * `z.enum` accepts.
 */
export const PrincipleEnum = z.enum(PRINCIPLES);

/** The four 2x2 quadrant cell keys (composite of x_y). */
export const QUADRANT_KEYS = [
  "feedforward_computational",
  "feedforward_inferential",
  "feedback_computational",
  "feedback_inferential",
] as const;
export const QuadrantKeyEnum = z.enum(QUADRANT_KEYS);

/**
 * A per-principle coverage-weighted score (RESEARCH Pattern 2).
 *
 * `score` is nullable: `null` + `coverage: 0` is the canonical "no relevant
 * events" signal — a sparse trace must never masquerade as a passing harness.
 */
export const PrincipleScoreSchema = z.object({
  principle: PrincipleEnum,
  /** 0..1; null when relevantEventCount === 0 (absence is signal). */
  score: z.number().min(0).max(1).nullable(),
  /** 0..1: fraction of principle-relevant events actually emitted. */
  coverage: z.number().min(0).max(1),
  hitCount: z.number().int().nonnegative(),
  relevantEventCount: z.number().int().nonnegative(),
  /** Id of the detector with the most hits for this principle (or ""). */
  worstDetector: z.string(),
});
export type PrincipleScore = z.infer<typeof PrincipleScoreSchema>;

/** A ranked finding packaging one or more detector hits (RESEARCH Pattern 4). */
export const FindingSchema = z.object({
  /** Sequential within a run, e.g. "F1", "F2". */
  id: z.string(),
  detectorId: z.string(),
  principle: PrincipleEnum,
  severity: z.enum(["high", "med", "low"]),
  /** Derived counts + tool names only — never raw content (T-02-02). */
  evidence: z.string(),
  remediation: z.string(),
  eventIds: z.array(z.string()),
  /** e.g. "lucid evolve propose --finding F1". */
  forwardAction: z.string(),
});
export type Finding = z.infer<typeof FindingSchema>;

/** One 2x2 cell: a density count plus the distinct event types binned into it. */
export const Plot2x2CellSchema = z.object({
  count: z.number().int().nonnegative(),
  eventTypes: z.array(z.string()),
});

/** The 2x2 binning result (RESEARCH Pattern 3). */
export const Plot2x2Schema = z.object({
  /** One entry per QUADRANT_KEYS composite key. */
  cells: z.record(QuadrantKeyEnum, Plot2x2CellSchema),
  /** Columns (x-axis) with zero tagged events — drives the headline finding. */
  emptyColumns: z.array(z.enum(["feedforward", "feedback"])),
  /** Rows (y-axis) with zero tagged events. */
  emptyRows: z.array(z.enum(["computational", "inferential"])),
});
export type Plot2x2 = z.infer<typeof Plot2x2Schema>;

/** The root read model returned by `diagnose()`. */
export const DiagnosticResultSchema = z.object({
  traceId: z.string(),
  agentId: z.string(),
  harness_version: z.string().optional(),
  principles: z.array(PrincipleScoreSchema),
  findings: z.array(FindingSchema),
  plot2x2: Plot2x2Schema,
  /** ISO 8601 timestamp. */
  generatedAt: z.string(),
  llmJudgeEnabled: z.boolean(),
});
export type DiagnosticResult = z.infer<typeof DiagnosticResultSchema>;
