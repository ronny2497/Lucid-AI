/**
 * @lucid/evolution — the `evolve.apply` HSC audit emitter (Plan 04-03, Task 3,
 * REQ-05).
 *
 * Every KEEP and every ROLLBACK produces an `evolve.apply` HSC audit event. This
 * module builds that low-cardinality, tamper-evident LogRecord and hands it to an
 * injected sink. It is the apply analogue of Phase 3's `hsc-emit.ts`
 * (`evolve.propose`) and is named `hsc-emit-apply.ts` to avoid colliding with it.
 *
 * NO `evolve.rollback` EVENT TYPE (VERIFIED — packages/hsc-schema/src/event-types.ts):
 * `EVENT_TYPES` contains `"evolve.apply"` and `"evolve.propose"` but NO
 * `"evolve.rollback"` member. Therefore BOTH a keep AND a rollback emit an
 * `evolve.apply` event; the rollback is distinguished by `rollback_status:
 * "auto-rollback" | "manual-rollback"` in the body — NOT by a separate event name.
 *
 * LOW CARDINALITY (T-04-13): `event.name` is EXACTLY the EVENT_TYPES `"evolve.apply"`
 * constant — imported from `@lucid/hsc-schema`, never written as a bare string
 * literal, so a Phase 0 rename propagates here and the name can never drift.
 * The manifest id and every other variable datum live in `attributes`/`body`, NEVER
 * in `event.name` (opentelemetry.io/docs/specs/semconv/general/events/).
 *
 * TAMPER-EVIDENCE (T-04-12): the body carries a `content_hash` = SHA-256 (hex,
 * `node:crypto`) over the canonically-serialized body EXCLUDING the hash field
 * itself. On compliance export (Phase 6) the hash is recomputable from the body to
 * detect post-emission modification.
 *
 * CONTENT-FREE (T-04-04): the body carries only file PATHS (`affected_files`),
 * derived SCORES (baseline/candidate/delta), and the verdict/rollback metadata —
 * there is intentionally NO field for harness payloads (prompt text, tool call
 * inputs, file bodies).
 *
 * BUILT ONLY AFTER THE GUARD VERDICT: `verdict` is a REQUIRED input. There is no
 * apply-time emission — the audit event is built only once a guard verdict exists
 * (RESEARCH Anti-Pattern: emitting evolve.apply before the guard verdict).
 *
 * STRUCTURAL-ONLY: `node:crypto` is the only new collaborator. No trainer / GRPO /
 * weight path anywhere (ADR-0004 L1 boundary).
 */

import { createHash } from "node:crypto";

import { EVENT_TYPES } from "@lucid/hsc-schema";

import type { ApplyRecord } from "./apply-store.js";
import type { ChangeSetKind } from "./schema.js";

/**
 * The evolve.apply event-type constant, resolved from the canonical `EVENT_TYPES`
 * tuple (NOT a bare string literal). This is the `event.name` value —
 * low-cardinality and fixed; a rename of the constant fails to compile here.
 */
export const EVOLVE_APPLY_EVENT: (typeof EVENT_TYPES)[number] =
  EVENT_TYPES[EVENT_TYPES.indexOf("evolve.apply")];

/** Input to {@link buildEvolveApplyRecord} — the fields the audit body records. */
export interface EvolveApplyInput {
  // WHO
  approvedBy: string;
  autonomyLevel: "L1" | "L2";
  // WHAT
  manifestId: string;
  changeKind: ChangeSetKind;
  agentId: string;
  fromVersion: string;
  toVersion: string;
  affectedFiles: string[];
  // PREDICTED (from the L0 change_manifest)
  expectedEffect: unknown;
  // OBSERVED (from the regression guard)
  guardMetric: string;
  baselineScore: number | null;
  candidateScore: number | null;
  guardDelta: number | null;
  verdict: ApplyRecord["verdict"];
  // ROLLBACK STATUS — "none" for a keep, "auto/manual-rollback" for a revert.
  rollbackStatus: ApplyRecord["rollbackStatus"];
  /** ISO 8601 timestamp; defaults to now when absent. */
  generatedAt?: string;
}

/** The `harness.apply.*` attribute bag (RESEARCH Pattern 6) — minus the integrity hash. */
export interface EvolveApplyAttrs {
  "harness.apply.approved_by": string;
  "harness.apply.autonomy_level": "L1" | "L2";
  "harness.apply.manifest_id": string;
  "harness.apply.change_kind": ChangeSetKind;
  "harness.apply.agent_id": string;
  "harness.apply.from_version": string;
  "harness.apply.to_version": string;
  "harness.apply.affected_files": string[];
  "harness.apply.expected_effect": string;
  "harness.apply.guard_metric": string;
  "harness.apply.baseline_score": number | null;
  "harness.apply.candidate_score": number | null;
  "harness.apply.guard_delta": number | null;
  "harness.apply.verdict": ApplyRecord["verdict"];
  "harness.apply.rollback_status": ApplyRecord["rollbackStatus"];
}

/**
 * The HSC `evolve.apply` LogRecord shape (an OTel-flavoured log event). `event.name`
 * is the low-cardinality discriminator; all variable data — incl. the manifest id —
 * lives in `attributes`/`body`. The body carries `content_hash` for tamper-evidence.
 */
export interface EvolveApplyRecord {
  /** The low-cardinality OTel event discriminator: exactly the EVENT_TYPES evolve.apply member. */
  event: { name: (typeof EVENT_TYPES)[number] };
  /** Indexable `harness.apply.*` attributes (manifest id lives HERE, not in event.name). */
  attributes: EvolveApplyAttrs;
  /** The audit body: who / what / predicted / observed / rollback + the integrity hash. */
  body: EvolveApplyAttrs & {
    "harness.apply.generated_at": string;
    /** SHA-256 (hex) over the canonical body MINUS this field — tamper-evidence. */
    "harness.apply.content_hash": string;
  };
}

/**
 * Deterministically serialize a value with sorted object keys, so the content hash
 * is stable regardless of insertion order (canonical JSON for tamper-evidence).
 */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val as Record<string, unknown>).sort()) {
        sorted[k] = (val as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return val;
  });
}

/**
 * Build the `evolve.apply` LogRecord for a keep or a rollback WITHOUT emitting it.
 *
 * The same event serves keep and rollback — `rollback_status` distinguishes them.
 * `content_hash` is a recomputable SHA-256 (hex) over the canonical body excluding
 * the hash field itself. The body carries only paths + derived scores; no payloads.
 */
export function buildEvolveApplyRecord(input: EvolveApplyInput): EvolveApplyRecord {
  const attributes: EvolveApplyAttrs = {
    "harness.apply.approved_by": input.approvedBy,
    "harness.apply.autonomy_level": input.autonomyLevel,
    "harness.apply.manifest_id": input.manifestId,
    "harness.apply.change_kind": input.changeKind,
    "harness.apply.agent_id": input.agentId,
    "harness.apply.from_version": input.fromVersion,
    "harness.apply.to_version": input.toVersion,
    "harness.apply.affected_files": input.affectedFiles,
    "harness.apply.expected_effect": JSON.stringify(input.expectedEffect),
    "harness.apply.guard_metric": input.guardMetric,
    "harness.apply.baseline_score": input.baselineScore,
    "harness.apply.candidate_score": input.candidateScore,
    "harness.apply.guard_delta": input.guardDelta,
    "harness.apply.verdict": input.verdict,
    "harness.apply.rollback_status": input.rollbackStatus,
  };

  const generatedAt = input.generatedAt ?? new Date().toISOString();

  // The body without the hash — the exact preimage the hash is computed over and
  // the exact preimage a consumer recomputes for tamper detection.
  const bodyWithoutHash = {
    ...attributes,
    "harness.apply.generated_at": generatedAt,
  };
  const contentHash = createHash("sha256").update(canonicalJson(bodyWithoutHash)).digest("hex");

  return {
    event: { name: EVOLVE_APPLY_EVENT },
    attributes,
    body: {
      ...bodyWithoutHash,
      "harness.apply.content_hash": contentHash,
    },
  };
}

/**
 * Recompute the `content_hash` over a built record's body (minus the hash field) —
 * the tamper-evidence check a compliance export performs. Returns the recomputed
 * hex digest; equality with `record.body["harness.apply.content_hash"]` proves the
 * body was not modified after emission.
 */
export function recomputeApplyContentHash(record: EvolveApplyRecord): string {
  const { "harness.apply.content_hash": _omit, ...bodyWithoutHash } = record.body;
  return createHash("sha256").update(canonicalJson(bodyWithoutHash)).digest("hex");
}

/**
 * Emit the `evolve.apply` HSC audit event via an injected sink (a capturing array
 * in tests, the collector's OTLP/store emit path in production) — unit-testable
 * without a live collector. The sink is the only side effect; it is an append-only
 * audit record, never a harness write.
 */
export function emitEvolveApply(
  input: EvolveApplyInput,
  sink: (record: EvolveApplyRecord) => void,
): void {
  sink(buildEvolveApplyRecord(input));
}
