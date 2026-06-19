/**
 * @lucid/diagnostic — detector registry.
 *
 * `detectorRegistry` is the canonical ordered list of every rule-based detector:
 * the flagship `feedback.no-verify-after-mutation` plus one rule detector per
 * remaining principle. `getDetector(id)` resolves a detector by its stable id.
 *
 * Each detector is addressable by id and tagged with its `principle` (a
 * `@lucid/hsc-schema` `PRINCIPLES` value) — no principle/event/tool literal is
 * written here.
 */

import type { Detector } from "../types.js";

import { noVerifyAfterMutation, NO_VERIFY_AFTER_MUTATION_ID } from "./feedback/no-verify-after-mutation.js";
import { budgetPressure, BUDGET_PRESSURE_ID } from "./context/budget-pressure.js";
import { planBeforeAct, ACT_BEFORE_PLAN_ID } from "./plan-execute/plan-before-act.js";
import { sliceSize, OVERSIZED_SLICE_ID } from "./one-at-a-time/slice-size.js";
import { docEncodingPresence, NO_DOC_ENCODING_ID } from "./codebase-docs/doc-encoding-presence.js";

/** Stable detector ids re-exported as constants (callers never hardcode strings). */
export {
  NO_VERIFY_AFTER_MUTATION_ID,
  BUDGET_PRESSURE_ID,
  ACT_BEFORE_PLAN_ID,
  OVERSIZED_SLICE_ID,
  NO_DOC_ENCODING_ID,
};

export {
  noVerifyAfterMutation,
  budgetPressure,
  planBeforeAct,
  sliceSize,
  docEncodingPresence,
};

/**
 * All registered rule detectors. Flagship first; then one per remaining principle.
 * Order is the canonical iteration order for the orchestrator (02-04).
 */
export const detectorRegistry: readonly Detector[] = [
  noVerifyAfterMutation,
  budgetPressure,
  planBeforeAct,
  sliceSize,
  docEncodingPresence,
] as const;

/** Resolve a detector by its stable id, or `undefined` if none matches. */
export function getDetector(id: string): Detector | undefined {
  return detectorRegistry.find((d) => d.id === id);
}
