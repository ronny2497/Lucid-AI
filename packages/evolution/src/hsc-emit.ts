/**
 * @lucid/evolution — the `evolve.propose` HSC audit emitter (REQ-05).
 *
 * Every proposal is itself an observable HSC event: when `propose()` produces a
 * `change_manifest`, the HITL surface emits an `evolve.propose` LogRecord into the
 * trace store the engine already observes. This is the self-observation + audit
 * property — "capture not just what happened but why" (RESEARCH Pattern 4).
 *
 * OTel custom-event shape (RESEARCH Pattern 6): a `LogRecord` whose `event.name`
 * is the discriminator. The CRITICAL rule is LOW CARDINALITY — `event.name` is
 * EXACTLY the `"evolve.propose"` constant; the manifest id and every other
 * variable datum live in the body/attributes, NEVER in the event name
 * (opentelemetry.io/docs/specs/semconv/general/events/). We import the constant
 * from `@lucid/hsc-schema` `EVENT_TYPES` rather than writing the string literal so
 * a Phase 0 rename propagates here and the name can never drift (threat T-03-12).
 *
 * AUDIT PROVENANCE (RESEARCH Pattern 4 — the five fields the literature requires):
 *   - the full `change_manifest` JSON (the "what")
 *   - `evidence_ref`        — the finding back-link (the "why")
 *   - `diagnostic_trace_id` — the diagnosis that triggered the proposal
 *   - `generated_at`        — the timestamp
 *   - `estimator`           — rule-based vs. llm-assisted (calibration tracking)
 *
 * ZERO BLAST RADIUS (L0): this module builds + hands a record to an injected sink.
 * It writes to NO harness config/prompt/skill file. The body carries only the
 * already-structured/derived manifest fields — NEVER raw trace content (T-03-11).
 */

import { EVENT_TYPES } from "@lucid/hsc-schema";

import type { ChangeManifest } from "./schema.js";

/**
 * The `"evolve.propose"` event-type constant, resolved from the canonical
 * `EVENT_TYPES` tuple (not a string literal). This is the `event.name` value —
 * low-cardinality and fixed; the index typed as `(typeof EVENT_TYPES)[number]`
 * so a rename of the constant fails to compile here.
 */
export const EVOLVE_PROPOSE_EVENT: (typeof EVENT_TYPES)[number] = EVENT_TYPES[
  EVENT_TYPES.indexOf("evolve.propose")
];

/**
 * The HSC `evolve.propose` LogRecord shape (an OTel-flavoured log event).
 *
 * `event.name` is the low-cardinality discriminator; all variable data — incl. the
 * manifest `id` — lives in `body`/`attributes`. The audit body carries the full
 * manifest plus its provenance back-links. There is no field for raw trace content.
 */
export interface EvolveProposeRecord {
  /** The low-cardinality OTel event discriminator: exactly `"evolve.propose"`. */
  event: { name: (typeof EVENT_TYPES)[number] };
  /** Indexable attributes — the manifest id + agent target live HERE, not in event.name. */
  attributes: {
    "evolve.manifest_id": string;
    "evolve.target": string;
    "evolve.change": ChangeManifest["change"];
    "evolve.status": ChangeManifest["status"];
    "evolve.estimator": ChangeManifest["estimator"];
  };
  /** The audit body: the full manifest + the five provenance fields (RESEARCH Pattern 4). */
  body: {
    change_manifest: ChangeManifest;
    /** Finding back-link, e.g. "lucid://findings/F1" (the manifest's evidence_ref). */
    evidence_ref: string;
    /** The diagnosis that triggered the proposal — the manifest target's baseline. */
    diagnostic_trace_id: string;
    /** ISO 8601 — when the manifest was generated. */
    generated_at: string;
    /** rule-based | llm-assisted — for calibration tracking. */
    estimator: ChangeManifest["estimator"];
  };
}

/**
 * Build the `evolve.propose` LogRecord for a manifest WITHOUT emitting it.
 *
 * Exposed for testing (assert `event.name` is the EVENT_TYPES member and that the
 * manifest id appears only in `attributes`/`body`, never in `event.name`).
 *
 * `diagnostic_trace_id` is the manifest `target` — `"agent-id@harness-version"`,
 * which encodes the pre-apply baseline the diagnosis was computed against (the
 * value the falsifiability loop diffs against). The full structured manifest is
 * embedded verbatim; no raw trace content is added (T-03-11).
 */
export function buildEvolveProposeRecord(manifest: ChangeManifest): EvolveProposeRecord {
  return {
    event: { name: EVOLVE_PROPOSE_EVENT },
    attributes: {
      "evolve.manifest_id": manifest.id,
      "evolve.target": manifest.target,
      "evolve.change": manifest.change,
      "evolve.status": manifest.status,
      "evolve.estimator": manifest.estimator,
    },
    body: {
      change_manifest: manifest,
      evidence_ref: manifest.evidence_ref,
      diagnostic_trace_id: manifest.target,
      generated_at: manifest.generated_at,
      estimator: manifest.estimator,
    },
  };
}

/**
 * Emit the `evolve.propose` HSC audit event for a manifest via an injected sink.
 *
 * The sink is dependency-injected (a capturing array in tests, the collector's
 * OTLP/store emit path or a local-file/stdout sink in production) so this is
 * unit-testable without a live collector. Zero blast radius: the sink is the only
 * side effect, and it is an append-only audit record — never a harness write.
 */
export function emitEvolvePropose(
  manifest: ChangeManifest,
  sink: (record: EvolveProposeRecord) => void,
): void {
  sink(buildEvolveProposeRecord(manifest));
}
