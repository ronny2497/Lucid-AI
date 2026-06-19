/**
 * @lucid/diagnostic — public entrypoint.
 *
 * This is the import path every downstream Phase 2 plan uses: `@lucid/diagnostic`.
 *
 * Wave 0/1 (this plan, 02-01) exports the frozen read-model contract only:
 *   - the DiagnosticResult Zod schema family + inferred types (schema.ts)
 *   - the HarnessTrace runtime shape + Detector interfaces (types.ts)
 *
 * Later plans extend this barrel with the implementation entrypoints:
 *   - `diagnose()` + the findings engine are added by Plan 02-04 (integration)
 *   - `diff()` is added by Plan 02-05
 *   - the concrete detectors / scorers / plotter live under src/{detectors,scorers,plotter}/
 *     and are added by Plans 02-02 / 02-03.
 */

// ---- Output schema family (REQ-04) -----------------------------------------
export {
  PrincipleEnum,
  QuadrantKeyEnum,
  QUADRANT_KEYS,
  PrincipleScoreSchema,
  FindingSchema,
  Plot2x2CellSchema,
  Plot2x2Schema,
  DiagnosticResultSchema,
} from "./schema.js";
export type {
  PrincipleScore,
  Finding,
  Plot2x2,
  DiagnosticResult,
} from "./schema.js";

// ---- Runtime trace shapes + detector interfaces ----------------------------
export { EVENT_PRINCIPLE, quadrantFor } from "./types.js";
export type {
  AttrValue,
  Attrs,
  Quadrant,
  HarnessEvent,
  Turn,
  HarnessTrace,
  Detector,
  DetectorHit,
  DetectorOptions,
  DiagnosticConfig,
  HscEventType,
  HscPrinciple,
  QuadrantX,
  QuadrantY,
} from "./types.js";

// ---- Pipeline entrypoints (Plan 02-04) -------------------------------------
// The single callable + the stages it composes, exposed so downstream plans
// (02-05 diff, Phase 3 evolve) consume the same functions and the same result shape.
export { diagnose } from "./diagnose.js";
export { loadTrace } from "./loader.js";
export { buildFindings, LEVERAGE_ORDER, FEEDBACK_ABSENT_ID } from "./findings/index.js";
export {
  detectorRegistry,
  getDetector,
  NO_VERIFY_AFTER_MUTATION_ID,
  BUDGET_PRESSURE_ID,
  ACT_BEFORE_PLAN_ID,
  OVERSIZED_SLICE_ID,
  NO_DOC_ENCODING_ID,
} from "./detectors/index.js";
export { scorePrinciples, scorePrinciple, INFERRED_WEIGHT } from "./scorers/index.js";
export { buildPlot } from "./plotter/index.js";

// ---- Version & cohort diffing (Plan 02-05, REQ-04) -------------------------
// The Build-to-Delete comparator: diff two cohorts on the convergence principles
// with null-safe deltas + a deterministic verdict, reading traces through the
// abstract TraceQuery interface (no concrete Phase 1 store import). Phase 3/4 consume
// `VersionDiff` for falsifiability — its principle keys are the canonical PRINCIPLES.
export { diff } from "./diff/index.js";
export type { VersionDiff, PrincipleDelta, DiffOptions } from "./diff/index.js";
export type { TraceQuery, TraceFilter } from "./diff/trace-query.js";
