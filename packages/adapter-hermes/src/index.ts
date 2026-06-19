/**
 * @lucid/adapter-hermes — the hermes reference adapter (public surface).
 *
 * Reference / test-only: it exercises the FULL 10-event HSC taxonomy through
 * `@lucid/sdk` so the store, explorer, and Phase 2 detectors have at least one
 * of every event type to read, AND it demonstrates both feedback shapes (a
 * checked mutation and the honest empty-feedback case). Nothing hermes-specific
 * leaks into Lucid core (D-07) — this package shares only `@lucid/sdk` and
 * `@lucid/hsc-schema`.
 *
 * The principle and quadrant tags for every emitted event come from the
 * canonical bindings in `@lucid/hsc-schema` (`EVENT_PRINCIPLE`, `quadrantFor`).
 * `feedback.check`'s quadrant.y is emitter-specified, so the reference run
 * supplies it explicitly (the SDK never auto-assigns it).
 */

import {
  EVENT_PRINCIPLE,
  EVENT_TYPES,
  GEN_AI_ATTR,
  type HscEventType,
  type HscPrinciple,
  type QuadrantY,
} from "@lucid/hsc-schema";
import { harness, type HscAttrs } from "@lucid/sdk";
import { mapLifecycle, COVERED_EVENT_TYPES, type HermesLifecyclePoint } from "./mapping.js";

export { HermesToHsc, mapLifecycle, COVERED_EVENT_TYPES } from "./mapping.js";
export type { HermesLifecyclePoint } from "./mapping.js";

/**
 * Principle for `error`. `error` is cross-cutting (spec §3.3) and carries no
 * binding in `EVENT_PRINCIPLE`, but the HarnessTrace schema requires a valid
 * `harness.principle` on every event; the conformance predicate skips the
 * principle check for `error`. We tag it `feedback` (an error feeds back into
 * the loop) so the emitted span carries a schema-valid principle.
 */
const ERROR_PRINCIPLE: HscPrinciple = "feedback";

/** Resolve the schema-bound principle for an event type (with the error carve-out). */
function principleFor(eventType: HscEventType): HscPrinciple {
  if (eventType === "error") return ERROR_PRINCIPLE;
  const principle = EVENT_PRINCIPLE[eventType];
  if (principle === undefined) {
    throw new Error(`no principle bound for ${eventType} (schema EVENT_PRINCIPLE)`);
  }
  return principle;
}

/** Options for a hermes reference emission. */
export interface HermesEmitOptions {
  /** Logical agent id stamped on emitted events (`gen_ai.agent.id`). */
  agentId?: string;
  /** Harness build version stamped on each event (`harness.version`). */
  version?: string;
  /** Whether this event mutated durable state (`harness.mutated_state`). */
  mutatedState?: boolean;
  /**
   * Emitter-specified quadrant.y. REQUIRED for `feedback.check` (the SDK never
   * auto-assigns it); accepted for `verify.result` (may be overridden to
   * inferential, spec §6.2). Ignored for other event types.
   */
  quadrantY?: QuadrantY;
  /** Non-content gen_ai.* identifiers (e.g. tool name, model) to forward. */
  genAi?: Record<string, unknown>;
}

/** hermes's state-mutating tools — a `tool.call` on one sets mutated_state=true. */
export const FILE_MUTATING_TOOL_NAMES: ReadonlySet<string> = new Set(["write_file", "patch"]);

/**
 * Emit one HSC event for a hermes event type through `@lucid/sdk`.
 *
 * Builds `HscAttrs` from the schema-bound principle plus the supplied options.
 * For `feedback.check` the caller MUST pass `quadrantY` (emitter-specified);
 * for other events it is ignored (the SDK derives quadrant from the table).
 */
export function emitHsc(
  eventType: HscEventType,
  opts: HermesEmitOptions = {},
): void {
  const attrs: HscAttrs = { principle: principleFor(eventType) };
  if (opts.version !== undefined) attrs.version = opts.version;
  if (opts.mutatedState !== undefined) attrs.mutatedState = opts.mutatedState;
  if (
    (eventType === "feedback.check" || eventType === "verify.result") &&
    opts.quadrantY !== undefined
  ) {
    attrs.quadrant = { y: opts.quadrantY };
  }
  const genAi: Record<string, unknown> = { ...(opts.genAi ?? {}) };
  if (opts.agentId !== undefined) genAi[GEN_AI_ATTR.agentId] = opts.agentId;
  if (Object.keys(genAi).length > 0) attrs.genAi = genAi;
  harness.event(eventType, attrs);
}

/**
 * Emit one HSC event for a hermes lifecycle point (mapped via `mapLifecycle`).
 * Returns the emitted event type, or `null` if the point did not map.
 */
export function emitForLifecycle(
  p: HermesLifecyclePoint,
  opts: HermesEmitOptions = {},
): HscEventType | null {
  const eventType = mapLifecycle(p);
  if (eventType === null) return null;
  emitHsc(eventType, opts);
  return eventType;
}

/**
 * Run the reference trajectory: emit one of EVERY HSC event type through
 * `@lucid/sdk`, exercising the full taxonomy. It demonstrates BOTH feedback
 * shapes: a checked mutation (a mutating `tool.call` followed by a
 * `verify.result`) and the honest empty-feedback case (a second mutating
 * `tool.call` with NO following `verify.result`). The honest absence is real —
 * it is the trailing mutation, not a removed event.
 *
 * Returns the ordered list of emitted event types.
 */
export function runReferenceTrajectory(opts: HermesEmitOptions = {}): HscEventType[] {
  const base = { agentId: opts.agentId ?? "hermes-reference", version: opts.version };
  const emitted: HscEventType[] = [];
  const emit = (eventType: HscEventType, extra: HermesEmitOptions = {}): void => {
    emitHsc(eventType, { ...base, ...extra });
    emitted.push(eventType);
  };

  emit("context.load", { genAi: { [GEN_AI_ATTR.usageInputTokens]: 1024 } });
  emit("plan.emit");
  emit("task.slice");
  // A checked mutation: mutating tool.call -> feedback.check -> verify.result.
  emit("tool.call", {
    mutatedState: true,
    genAi: { [GEN_AI_ATTR.toolName]: "write_file" },
  });
  emit("feedback.check", { quadrantY: "computational" });
  emit("verify.result", { quadrantY: "computational" });
  emit("doc.encode");
  emit("evolve.propose");
  emit("evolve.apply");
  // Phase 5 L2 self-evolution audit events: a weight-level candidate is trained,
  // then the gate promotes it. Included so the reference run stays exhaustive.
  emit("evolve.train");
  emit("evolve.promote");
  // The honest empty-feedback case: a mutating tool.call with NO verify.result
  // after it. This is the trailing event — the absence is preserved, not faked.
  emit("tool.call", {
    mutatedState: true,
    genAi: { [GEN_AI_ATTR.toolName]: "patch" },
  });
  emit("error");

  return emitted;
}

/** The canonical HSC event types, re-exported for coverage assertions. */
export { EVENT_TYPES };
export type { HscEventType };
