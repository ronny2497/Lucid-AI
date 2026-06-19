/**
 * Public input type for the @lucid/sdk emission API.
 *
 * `HscAttrs` is what a harness passes to `harness.event` / `harness.start`. The
 * SDK translates these logical fields onto the dotted `harness.*` attribute
 * paths from `@lucid/hsc-schema` (HARNESS_ATTR) — call sites never spell the
 * dotted strings themselves.
 */

import type { HscPrinciple, QuadrantX, QuadrantY } from "@lucid/hsc-schema";

/**
 * Caller-supplied attributes for a single HSC event span.
 *
 * Only `principle` is required; everything else is optional. The SDK derives
 * `quadrant.x` (and `quadrant.y` for non-emitter-specified events) from
 * `quadrantFor(eventType)` — the caller's `quadrant` overrides/supplies values
 * the table cannot determine (notably `feedback.check`'s emitter-specified y).
 *
 * Content-bearing fields (prompt text, tool-call arguments) are NEVER set by
 * the SDK on its own; a caller who wants them recorded passes them explicitly
 * through `genAi` / `extra` (opt-in; T-01-07).
 */
export interface HscAttrs {
  /** HSC convergence principle for this event (required). */
  principle: HscPrinciple;
  /**
   * Caller-supplied quadrant overrides. For deterministic events the SDK fills
   * x/y from `quadrantFor`; supplying values here overrides them. For
   * `feedback.check` (EMITTER_SPECIFIED_Y) the caller MUST supply `y` here for
   * it to be set at all — the SDK never auto-assigns it.
   */
  quadrant?: { x?: QuadrantX; y?: QuadrantY };
  /** Whether this event mutated durable state (harness.mutated_state). */
  mutatedState?: boolean;
  /** Harness build version (harness.version). */
  version?: string;
  /**
   * Reused OTel GenAI attributes, keyed by their dotted `gen_ai.*` paths (use
   * GEN_AI_ATTR from @lucid/hsc-schema). Passed through to the span verbatim.
   * This is the opt-in surface for any content-bearing field.
   */
  genAi?: Record<string, unknown>;
  /** Additional namespaced span attributes, passed through verbatim. */
  extra?: Record<string, unknown>;
}
