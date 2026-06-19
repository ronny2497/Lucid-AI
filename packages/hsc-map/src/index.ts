/**
 * @lucid/hsc-map — the isolation boundary for every PROVISIONAL HSC assumption.
 *
 * A Phase 0 HSC lock / reconcile touches ONLY this package:
 *   - GenAiAttrMap        : the provisional gen_ai.* attribute names (A2/A6)
 *   - PRICING_USD_PER_1K  : the provisional model pricing table
 *   - successOf           : the declared-then-inferred success policy (A3)
 */

export { GenAiAttrMap, type GenAiLogicalName } from "./genai-attrs.js";
export {
  PRICING_USD_PER_1K,
  costOf,
  type ModelPrice,
} from "./pricing.js";
export {
  successOf,
  HARNESS_DECLARED_SUCCESS_ATTR,
  type SuccessResult,
  type SuccessSource,
  type SuccessInput,
} from "./success.js";
