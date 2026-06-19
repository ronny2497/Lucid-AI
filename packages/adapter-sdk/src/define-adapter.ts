/**
 * defineAdapter() — the declarative authoring surface over @lucid/sdk (REQ-07).
 *
 * An adapter author declares, per HSC lifecycle event, a hook that maps their
 * framework's observable moment onto an HSC event. Each hook receives a context
 * carrying an `emit()` that routes EVERY emission through {@link emitOrOmit}, so
 * the no-fabrication / absence-is-signal invariant (D-05) holds regardless of
 * author intent — the author cannot bypass the honesty gate.
 *
 * Framework-neutrality (D-07): nothing here imports any specific framework. The
 * surface is structural; the author supplies the framework string and the hook
 * bodies. `evolve.*` events are intentionally NOT exposed as hooks — adapters
 * never infer self-evolution audit events (§5.2), so there is no authoring path
 * that could emit them.
 *
 * Single-sourcing (REQ-07): the hook → event-type binding is a derived map, not
 * hand-spelled at call sites, and `toManifest()` validates its output through the
 * 06-01 AdapterManifestSchema so an invalid declaration fails loudly rather than
 * shipping a malformed manifest.
 */

import { type HscEventType } from "@lucid/hsc-schema";
import {
  AdapterManifestSchema,
  type AdapterManifest,
} from "./manifest.js";
import { emitOrOmit, type EmitContext, type EmitResult } from "./emit-or-omit.js";

/**
 * The principle-bearing observable lifecycle hooks an adapter may declare, bound
 * to the HSC event type each one emits. `evolve.*` and `error` are excluded:
 * evolve.* are never adapter-inferred (§5.2) and `error` is a cross-cutting span
 * event, not a lifecycle hook.
 */
export const HOOK_EVENT_TYPE = {
  onContextLoad: "context.load",
  onPlanEmit: "plan.emit",
  onTaskSlice: "task.slice",
  onToolCall: "tool.call",
  onFeedbackCheck: "feedback.check",
  onVerify: "verify.result",
  onDocEncode: "doc.encode",
} as const satisfies Record<string, HscEventType>;

/** The set of declarable hook names. */
export type HookName = keyof typeof HOOK_EVENT_TYPE;

/**
 * The context handed to a lifecycle hook. `source` is the framework-supplied
 * payload the author maps from (opaque to the SDK); `emit` is the ONLY emission
 * path and routes through emit-or-omit. Calling `emit` with `substantiated:false`
 * (or not calling it at all) preserves an honest absence.
 */
export interface HookContext<TSource = unknown> {
  /** The framework event/payload this hook is mapping (author-defined shape). */
  readonly source: TSource;
  /** Emit the hook's HSC event through the no-fabrication gate. */
  emit(ctx: EmitContext): EmitResult | undefined;
}

/** A single lifecycle hook: maps a framework moment onto an HSC emission. */
export type Hook<TSource = unknown> = (ctx: HookContext<TSource>) => EmitResult | undefined;

/**
 * The declarative adapter spec. `targets` is the HSC version string; the optional
 * metadata feeds `toManifest()`; the optional per-event hooks declare coverage.
 */
export interface AdapterSpec {
  /** Adapter package name (manifest `name`). */
  name: string;
  /** Adapter version (manifest `version`). */
  version: string;
  /** The framework + version this adapter bridges (manifest `framework`). */
  framework: string;
  /** The HSC spec version this adapter targets, e.g. "v0" (manifest `hscVersion`). */
  targets: string;
  /**
   * HSC event types the framework genuinely LACKS, which the adapter explicitly
   * omits. Surfaced verbatim as the manifest `honestAbsences` (absence is signal).
   */
  honestAbsences?: readonly HscEventType[];
  /** Optional link to the machine-readable ConformanceReport (the badge). */
  conformanceReport?: string;

  // Per-event lifecycle hooks (all optional — a framework declares only what it
  // genuinely observes; an undeclared hook is an honest non-coverage, not a gap).
  onContextLoad?: Hook;
  onPlanEmit?: Hook;
  onTaskSlice?: Hook;
  onToolCall?: Hook;
  onFeedbackCheck?: Hook;
  onVerify?: Hook;
  onDocEncode?: Hook;
}

/**
 * A defined adapter. `targets` and `hooks` are introspectable; `drive` invokes a
 * single declared hook against a framework payload; `toManifest` assembles and
 * validates the AdapterManifest.
 */
export interface Adapter {
  /** The HSC version this adapter targets. */
  readonly targets: string;
  /** The declared hook names (enumerable coverage). */
  readonly hooks: readonly HookName[];
  /**
   * Drive a single declared hook against a framework `source` payload. Returns
   * the hook's emit result, or `undefined` when the hook is undeclared or its
   * emission was omitted (honest absence / prohibited inference).
   */
  drive(hook: HookName, source: unknown): EmitResult | undefined;
  /** Assemble + validate the AdapterManifest (throws on an invalid declaration). */
  toManifest(): AdapterManifest;
}

/** All hook names, in canonical lifecycle order. */
const HOOK_NAMES = Object.keys(HOOK_EVENT_TYPE) as HookName[];

/**
 * Define an adapter from a declarative spec. The returned adapter exposes its
 * target version + declared hooks, drives hooks through the emit-or-omit gate,
 * and produces a schema-valid manifest.
 */
export function defineAdapter(spec: AdapterSpec): Adapter {
  // Collect the declared hooks (those actually supplied on the spec).
  const specRecord = spec as unknown as Record<string, unknown>;
  const declared = HOOK_NAMES.filter((name) => typeof specRecord[name] === "function");

  return {
    targets: spec.targets,
    hooks: declared,

    drive(hook: HookName, source: unknown): EmitResult | undefined {
      const fn = specRecord[hook] as Hook | undefined;
      if (typeof fn !== "function") {
        // Undeclared hook: the framework does not observe this event. Emitting
        // nothing IS the correct behavior (absence is signal) — never coerce.
        return undefined;
      }
      const eventType = HOOK_EVENT_TYPE[hook];
      const ctx: HookContext = {
        source,
        emit: (emitCtx: EmitContext) => emitOrOmit(eventType, emitCtx),
      };
      return fn(ctx);
    },

    toManifest(): AdapterManifest {
      const eventCoverage = declared.map((name) => HOOK_EVENT_TYPE[name]);
      const candidate = {
        name: spec.name,
        version: spec.version,
        hscVersion: spec.targets,
        framework: spec.framework,
        eventCoverage,
        honestAbsences: [...(spec.honestAbsences ?? [])],
        ...(spec.conformanceReport !== undefined
          ? { conformanceReport: spec.conformanceReport }
          : {}),
      };
      // Validate through the 06-01 contract; .parse throws on any violation
      // (unknown key, non-EVENT_TYPES member, coverage/absence overlap).
      return AdapterManifestSchema.parse(candidate);
    },
  };
}
