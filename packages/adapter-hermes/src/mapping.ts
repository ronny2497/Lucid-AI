/**
 * hermes lifecycle -> HSC v0 event-type mapping (the reference adapter core).
 *
 * Unlike the neutral LangGraph adapter (which honestly emits only the three
 * operations LangGraph exposes), the hermes REFERENCE adapter's purpose is to
 * exercise the FULL HSC taxonomy (every member of `EVENT_TYPES`, incl. the
 * Phase 5 L2 self-evolution audit events) so the store, explorer, and Phase 2
 * detectors have at least one of every event type to read. It is reference /
 * test-only and lives under `packages/adapter-hermes/` — nothing hermes-specific
 * leaks into `@lucid/sdk` or `@lucid/hsc-schema` (D-07).
 *
 * The reference run deliberately exercises BOTH feedback shapes:
 *   - a `tool.call{mutated_state:true}` FOLLOWED BY a `verify.result` (a checked
 *     mutation — the populated-feedback case), and
 *   - a `tool.call{mutated_state:true}` with NO following `verify.result` (the
 *     honest empty-feedback case, D-05). The absence is never fabricated away.
 *
 * Event-type targets are typed `HscEventType` and selected from the canonical
 * `EVENT_TYPES` tuple in `@lucid/hsc-schema` — not hand-authored literals
 * (REQ-07 / prohibitions).
 */

import { EVENT_TYPES, type HscEventType } from "@lucid/hsc-schema";

/**
 * Pick an event type from the canonical `EVENT_TYPES` tuple so the value is
 * provably one of the schema's 10 (a typo becomes a compile + load error) — the
 * mapping targets are sourced from `@lucid/hsc-schema`, not hardcoded.
 */
function evt<T extends HscEventType>(name: T): T {
  if (!(EVENT_TYPES as readonly string[]).includes(name)) {
    throw new Error(`unknown HSC event type: ${name}`);
  }
  return name;
}

/**
 * hermes lifecycle point -> HSC event type. Keys are the reference adapter's own
 * lifecycle labels (the points a hermes-style harness surfaces); values are HSC
 * event types from `EVENT_TYPES`. This map covers every event type — that
 * full-taxonomy coverage is the reference adapter's reason to exist. The Phase 5
 * L2 self-evolution audit events (`evolve.train`, `evolve.promote`) are included
 * so the reference taxonomy stays exhaustive.
 */
export const HermesToHsc = {
  context_assembled: evt("context.load"),
  reasoning_step: evt("plan.emit"),
  task_sliced: evt("task.slice"),
  tool_invoked: evt("tool.call"),
  feedback_checked: evt("feedback.check"),
  verification_ran: evt("verify.result"),
  knowledge_written: evt("doc.encode"),
  evolution_proposed: evt("evolve.propose"),
  evolution_applied: evt("evolve.apply"),
  evolution_trained: evt("evolve.train"),
  evolution_promoted: evt("evolve.promote"),
  errored: evt("error"),
} as const satisfies Record<string, HscEventType>;

/** A hermes lifecycle point — only the label drives the mapping. */
export interface HermesLifecyclePoint {
  /** The hermes lifecycle label (e.g. `tool_invoked`). */
  point: string;
}

/**
 * Map a hermes lifecycle point to its HSC event type, or `null` for an
 * unrecognized label. `null` is honest passthrough — the point is left opaque
 * rather than coerced.
 */
export function mapLifecycle(p: HermesLifecyclePoint): HscEventType | null {
  const key = p.point as keyof typeof HermesToHsc;
  return key in HermesToHsc ? HermesToHsc[key] : null;
}

/**
 * The set of HSC event types the reference adapter covers — derived from the
 * mapping VALUES, not re-listed, so coverage cannot drift from the mapping.
 */
export const COVERED_EVENT_TYPES: ReadonlySet<HscEventType> = new Set(
  Object.values(HermesToHsc),
);
