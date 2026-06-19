/**
 * The L2 promotion gate — the primary safety mechanism for weight-level
 * self-evolution (REQ-05, Phase 5 L2, plan 05-03).
 *
 * No freshly-trained candidate reaches production without clearing an INDEPENDENT
 * held-out bar. This module is the gate that enforces it. Four hard properties:
 *
 *   1. NO BYPASS (threat T-05-10): `evaluateCandidate` sets `passed` STRICTLY from
 *      `delta >= min_improvement`. There is no flag, config field, or manifest
 *      field that promotes a `passed:false` candidate. `promoteCandidate` THROWS
 *      when `gateResult.passed` is false — the refusal is structural, not advisory.
 *
 *   2. FAIL CLOSED (threat T-05-10): a `ResultManifest` carrying an `error`, or
 *      missing `metrics` (a failed/aborted training run), gates to `passed:false`
 *      WITHOUT EVEN RUNNING THE EVALUATOR. A failure is never silently treated as
 *      a pass; the evaluator is reached only for a well-formed successful run.
 *
 *   3. INDEPENDENT METRIC (threat T-05-11, RESEARCH Pitfall 5): the gate depends
 *      on the pluggable `Evaluator` INTERFACE, whose default `SuccessEvaluator`
 *      measures a task-success rate — a metric the GRPO reward did NOT directly
 *      optimize. `principle_deltas` from the manifest are NOT the gate metric
 *      (they may be surfaced to a reviewer, but they do not gate). This is the
 *      reward-hacking mitigation made structural.
 *
 *   4. AUDIT EVERY DECISION (threat T-05-12): both `promoteCandidate` and
 *      `discardCandidate` emit an `evolve.promote` HSC event (outcome
 *      `"promoted"` | `"discarded"`) carrying the full `CandidateProvenance`. A
 *      gate decision is NEVER silent. `event.name` is the low-cardinality
 *      `EVENT_TYPES` member; the candidate_id/delta live in `attrs`
 *      (mirrors the Phase 4 `evolve.apply` low-cardinality-name discipline).
 *
 * OPAQUE ARTIFACT / NO-PYTHON-CORE-DEP (threat T-05-13): the gate treats
 * `manifest.artifact_path` as an OPAQUE string. It imports no torch/peft/Python,
 * spawns no subprocess, and never loads or merges LoRA weights — running the
 * candidate against the holdout is the injected `Evaluator`'s job (typically a
 * sidecar across the language boundary). The gate stays pure-TS.
 *
 * RESIDUAL GAPS (documented assumptions):
 *   - A4: Phase 4's autonomy-config / gate machinery is NOT on disk, so this plan
 *     defines a STANDALONE `PromoteGateConfig` here; 05-04 reconciles it into the
 *     larger L2 config surface.
 *   - A5-followup: there is no built HSC emit TRANSPORT in `@lucid/evolution` yet.
 *     This module produces the `evolve.promote` event PAYLOAD and hands it to an
 *     injected `EmitSink`; wiring the sink to the collector/store is 05-04's job.
 *
 * This module imports only `zod`, `@lucid/hsc-schema` (the event-type constant),
 * and sibling TS — no new npm dependency.
 */

import { z } from "zod";
import { EVENT_TYPES } from "@lucid/hsc-schema";

import { loadHoldout, type Evaluator } from "./evaluator.js";
import type { ResultManifest } from "./schemas/result-manifest.js";
import type { CandidateProvenance } from "./candidate-provenance.js";

/**
 * The `evolve.promote` event-type constant resolved from the canonical
 * `EVENT_TYPES` tuple (NOT a bare string literal) — the low-cardinality
 * `event.name`. A rename of the constant fails to compile here, so the name can
 * never drift (mirrors `EVOLVE_APPLY_EVENT` in `hsc-emit-apply.ts`).
 */
export const EVOLVE_PROMOTE_EVENT: (typeof EVENT_TYPES)[number] =
  EVENT_TYPES[EVENT_TYPES.indexOf("evolve.promote")];

/**
 * The L2 promote-gate config (PRD `promote_gate` block). Standalone here because
 * Phase 4's autonomy-config is not on disk (assumption A4); 05-04 wires it into
 * the larger L2 config. `metric` and `min_improvement` carry the PRD defaults.
 */
export const PromoteGateConfigSchema = z.object({
  /** Path to the held-out eval set (JSONL). Required and non-empty. */
  eval: z.string().min(1),
  /** The operator-chosen, reward-independent metric name. */
  metric: z.string().default("success"),
  /** The margin the candidate must clear: passed iff delta >= min_improvement. */
  min_improvement: z.number().default(0.02),
});
export type PromoteGateConfig = z.infer<typeof PromoteGateConfigSchema>;

/**
 * The gate's verdict. `passed` is derived STRICTLY from `delta >= min_improvement`
 * for a well-formed run, or forced to `false` (with a `reason`) when the gate
 * fails closed. `candidateScore`/`delta` are `null` on a fail-closed verdict
 * (the evaluator never ran).
 */
export interface GateResult {
  /** The gate's verdict — the ONLY authority on whether the candidate may promote. */
  passed: boolean;
  /** The independent held-out score; `null` when the gate failed closed. */
  candidateScore: number | null;
  /** The incumbent's held-out score (the bar to beat). */
  incumbentScore: number;
  /** candidateScore - incumbentScore; `null` when the gate failed closed. */
  delta: number | null;
  /** The metric the gate measured. */
  metric: string;
  /** Set when the gate failed closed (e.g. "training-error"); absent otherwise. */
  reason?: string;
}

/** The `evolve.promote` event payload shape (low-cardinality name; ids/delta in attrs). */
export interface EmittedEvolvePromote {
  /** Exactly the `EVENT_TYPES` evolve.promote member — low cardinality. */
  name: (typeof EVENT_TYPES)[number];
  /** Variable data: the decision outcome + candidate lineage (no raw content). */
  attrs: {
    outcome: "promoted" | "discarded";
    candidate_id: string;
    base_model_ref: string;
    job_id: string;
    metric: string;
    delta: number | null;
    min_improvement: number;
    holdout_path: string;
    [k: string]: unknown;
  };
}

/**
 * The injected emit transport. A capturing array in tests; the collector's OTLP /
 * store emit path in production (wired by 05-04, assumption A5-followup). The sink
 * is the only side effect — an append-only audit record, never a harness write.
 */
export type EmitSink = (event: EmittedEvolvePromote) => void | Promise<void>;

/**
 * Build and emit an `evolve.promote` event for one gate decision via the injected
 * sink. The `event.name` is the low-cardinality constant; the candidate_id/delta
 * and the rest of the lineage live in `attrs` (no raw holdout/output content).
 */
async function emitEvolvePromote(
  outcome: "promoted" | "discarded",
  provenance: CandidateProvenance,
  emit: EmitSink,
): Promise<void> {
  const event: EmittedEvolvePromote = {
    name: EVOLVE_PROMOTE_EVENT,
    attrs: {
      outcome,
      candidate_id: provenance.candidate_id,
      base_model_ref: provenance.base_model_ref,
      job_id: provenance.job_id,
      metric: provenance.gate.metric,
      delta: provenance.gate.delta,
      min_improvement: provenance.gate.min_improvement,
      holdout_path: provenance.gate.holdout_path,
    },
  };
  await emit(event);
}

/**
 * Evaluate a candidate against the production incumbent on an INDEPENDENT held-out
 * eval. The decision logic, in order:
 *
 *   1. FAIL CLOSED: if the manifest carries an `error` OR has no `metrics` (a
 *      failed/aborted training run), return `passed:false` with a `reason`
 *      WITHOUT running the evaluator — the artifact is presumed untrustworthy.
 *   2. Otherwise load the held-out set, run the pluggable `evaluator` over the
 *      OPAQUE `artifact_path` to get `candidateScore`, compute
 *      `delta = candidateScore - incumbentScore`, and set
 *      `passed = delta >= gateConfig.min_improvement`.
 *
 * There is NO parameter, flag, or field that flips `passed` to true otherwise.
 *
 * @param manifest the trainer-output manifest (read-only; never mutated).
 * @param evaluator the pluggable, reward-independent held-out evaluator.
 * @param gateConfig the eval path / metric / margin.
 * @param incumbentScore the production incumbent's held-out score (the bar).
 */
export async function evaluateCandidate(
  manifest: ResultManifest,
  evaluator: Evaluator,
  gateConfig: PromoteGateConfig,
  incumbentScore: number,
): Promise<GateResult> {
  // (1) Fail closed on a failed/aborted training run — BEFORE the evaluator runs.
  if (manifest.error !== undefined || manifest.metrics === undefined) {
    return {
      passed: false,
      candidateScore: null,
      incumbentScore,
      delta: null,
      metric: gateConfig.metric,
      reason: manifest.error !== undefined ? "training-error" : "missing-metrics",
    };
  }

  // (2) Independent held-out eval. The artifact_path is opaque — the evaluator
  // (a sidecar across the boundary, by default) does any real predict-and-compare.
  const holdout = loadHoldout(gateConfig.eval);
  const candidateScore = await evaluator.evaluate(
    manifest.artifact_path,
    holdout,
    gateConfig.metric,
  );
  const delta = candidateScore - incumbentScore;

  return {
    passed: delta >= gateConfig.min_improvement,
    candidateScore,
    incumbentScore,
    delta,
    metric: gateConfig.metric,
  };
}

/**
 * Promote a candidate to production — callable ONLY for a passing gate result.
 *
 * THE NO-BYPASS GUARD (threat T-05-10): if `gateResult.passed` is false this
 * THROWS and emits nothing. No argument can override this; promotion is
 * exclusively the gate's verdict. On a passing result it emits exactly one
 * `evolve.promote` event (outcome `"promoted"`) carrying the full provenance.
 *
 * NOTE: this function emits the AUDIT record for the promotion. The actual swap
 * of the live incumbent pointer is the orchestrator's job (05-04); the gate's
 * contract is "no audited promotion without a passing verdict".
 */
export async function promoteCandidate(
  _manifest: ResultManifest,
  gateResult: GateResult,
  provenance: CandidateProvenance,
  emit: EmitSink,
): Promise<void> {
  if (!gateResult.passed) {
    throw new Error(
      "promoteCandidate: refusing to promote a candidate that did not pass the gate " +
        "(no-bypass guard) — promotion is exclusively the gate's verdict",
    );
  }
  await emitEvolvePromote("promoted", provenance, emit);
}

/**
 * Discard a candidate that did not clear the gate (or failed closed). Emits
 * exactly one `evolve.promote` event with outcome `"discarded"` so that EVERY
 * gate decision — pass or fail — is auditable and never silent (threat T-05-12).
 */
export async function discardCandidate(
  _manifest: ResultManifest,
  _gateResult: GateResult,
  provenance: CandidateProvenance,
  emit: EmitSink,
): Promise<void> {
  await emitEvolvePromote("discarded", provenance, emit);
}
