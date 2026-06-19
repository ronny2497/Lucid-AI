/**
 * @lucid/hsc-schema — the canonical interface for HSC v0.
 *
 * Every downstream Phase 0+ plan imports event-type strings, attribute paths,
 * types, the JSON Schema, and the quadrant predicate from here rather than
 * hardcoding them (REQ-07).
 */

export {
  EVENT_TYPES,
  PRINCIPLES,
  type HscEventType,
  type HscPrinciple,
  type QuadrantX,
  type QuadrantY,
} from "./event-types.js";

export {
  HARNESS_ATTR,
  GEN_AI_ATTR,
  type HarnessAttrPath,
  type GenAiAttrPath,
} from "./attributes.js";

export {
  quadrantFor,
  EMITTER_SPECIFIED_Y,
  type Quadrant,
} from "./quadrant.js";

export { EVENT_PRINCIPLE } from "./event-principle.js";

export { harnessTraceSchema } from "./schema.js";
