/**
 * @lucid/evolution — `apply()`: the closed L1 control loop (Plan 04-04, Task 1, REQ-05).
 *
 * This is the single privileged entrypoint that turns the five collaborators built in
 * 04-02/04-03 into ONE safe, idempotent operation. The load-bearing ordering
 * (04-RESEARCH System Architecture + Patterns 3/4/5, Pitfall 5, Anti-Patterns):
 *
 *   0. IDEMPOTENCY — look up an existing terminal ApplyRecord by manifest id; if one
 *      exists, return it WITHOUT re-applying (no double-write, T-04-15).
 *   1. GATE FIRST — `checkApprovalPolicy(config, manifest, { approvedBy })`. A REJECT
 *      returns `{ outcome: "rejected", reason }` with NO snapshot and NO write
 *      (T-04-14). The gate is not bypassable.
 *   2. APPLY (ATOMIC) — `applyManifest` snapshots BEFORE the first write and reverts
 *      the whole change on any error. An apply failure records + emits a failure
 *      ApplyRecord and returns `{ outcome: "apply-failed" }`.
 *   3. GUARD — `runRegressionGuard(agentId, baseline, candidate, guard, traceQuery,
 *      diagnoseFn)` produces a typed verdict over a fixed-sample A/B cohort.
 *   4. KEEP — promote the candidate version, advance the manifest status to "applied"
 *      (returned, not mutated), build + emit the `evolve.apply`(KEEP) event, save the
 *      KEEP ApplyRecord, and return `{ outcome: "kept" }`.
 *   5. NON-KEEP (REVERT | INSUFFICIENT_DATA | NULL_SCORE) — route EVERY non-KEEP
 *      verdict through `rollbackController` (auto-rollback): restore the byte-identical
 *      snapshot, record a REVERT ApplyRecord, emit the `evolve.apply`-with-rollback
 *      event, and return `{ outcome: "rolled-back" }`. INSUFFICIENT_DATA and NULL_SCORE
 *      NEVER resolve to a silent keep (T-04-16).
 *
 * EMIT ONLY AFTER THE VERDICT (Anti-Pattern guard, T-04-14): the `evolve.apply` audit
 * event is built only once a guard verdict exists — never at apply time. Every terminal
 * path saves exactly one ApplyRecord and emits exactly one `evolve.apply` event
 * (T-04-17 / Pitfall 5).
 *
 * STRUCTURAL-ONLY (HARD, ADR-0004 / T-04-18): the orchestrator wires only the five
 * structural collaborators (config / prompts / skills / context-policy). The L2 tier
 * (model-parameter mutation) is Phase 5 and is explicitly out of scope here; this file
 * has no path to it. A negative grep over this file enforces the boundary.
 */

import { createHash } from "node:crypto";

import { checkApprovalPolicy } from "./gate.js";
import { applyManifest, resolveAdapter } from "./applicator/index.js";
import { runRegressionGuard, type DiagnoseFn, type GuardVerdict, type TraceQuery } from "./guard.js";
import { rollbackController } from "./rollback.js";
import { buildEvolveApplyRecord, emitEvolveApply, type EvolveApplyRecord } from "./hsc-emit-apply.js";

import type { AutonomyConfig } from "./apply-config.js";
import type { ApplyRecord, ApplyStore, GuardVerdict as ApplyVerdict } from "./apply-store.js";
import type { ChangeManifestV2 } from "./schema-v2.js";
import type { HarnessVersionRegistry } from "./version-registry.js";

/**
 * The collaborators the orchestrator wires. `traceQuery`/`diagnoseFn` are injected
 * (tests pass mocks; the argv path wires the real `@lucid/store` + `@lucid/diagnostic`).
 * `emit` is the `evolve.apply` audit sink (a capturing array in tests, the collector's
 * OTLP/store emit path in production). `harnessRoot` is the dir every targetFile is
 * confined to. `approvedBy` carries the human approver identity into the gate + record.
 */
export interface ApplyDeps {
  registry: HarnessVersionRegistry;
  store: ApplyStore;
  traceQuery: TraceQuery;
  diagnoseFn: DiagnoseFn;
  /** The `evolve.apply` audit sink — invoked ONLY after the verdict (never at apply time). */
  emit: (record: EvolveApplyRecord) => void;
  harnessRoot: string;
  /** The human approver identity (when `require_human_approval`). */
  approvedBy?: string;
}

/**
 * The typed outcome of an `apply()` call — a discriminated union. Every non-rejected
 * terminal outcome carries the persisted `ApplyRecord`; `kept`/`rolled-back` also carry
 * the resulting/applied manifest (status "applied") and the guard verdict.
 */
export type ApplyOutcome =
  | { outcome: "rejected"; reason: string }
  | { outcome: "apply-failed"; error: unknown; record: ApplyRecord }
  | { outcome: "kept"; record: ApplyRecord; manifest: ChangeManifestV2; verdict: GuardVerdict }
  | { outcome: "rolled-back"; record: ApplyRecord; verdict: GuardVerdict }
  | { outcome: "already-applied"; record: ApplyRecord };

/** Derive the baseline harness version from `target` ("agent@v37" -> "v37"). */
function baselineVersionOf(manifest: ChangeManifestV2): string {
  const parts = manifest.target.split("@");
  return parts.length > 1 ? parts[parts.length - 1] : manifest.target;
}

/** A stable, short SHA-256 (hex) tamper-evidence hash over the canonical record body (sans hash). */
function recordContentHash(body: Record<string, unknown>): string {
  const canonical = JSON.stringify(body, Object.keys(body).sort());
  return "sha256:" + createHash("sha256").update(canonical).digest("hex");
}

/** A compact, content-free evidence string from a guard verdict (counts/scores only). */
function verdictEvidence(verdict: GuardVerdict, metric: string): string {
  switch (verdict.verdict) {
    case "KEEP":
      return `${metric} ${verdict.delta >= 0 ? "+" : ""}${verdict.delta} (candidate ${verdict.candidateScore} vs baseline ${verdict.baselineScore}); candidate >= baseline + min_delta`;
    case "REVERT":
      return `${metric} ${verdict.delta >= 0 ? "+" : ""}${verdict.delta} (candidate ${verdict.candidateScore} vs baseline ${verdict.baselineScore}); below min_delta — auto-reverted`;
    case "INSUFFICIENT_DATA":
      return `insufficient ${metric} samples (baseline n=${verdict.baselineN}, candidate n=${verdict.candidateN}) — promotion blocked, auto-reverted`;
    case "NULL_SCORE":
      return `null ${metric} score (${verdict.reason}) — promotion blocked, auto-reverted`;
  }
}

/** Null-safe scores from a verdict (for the audit body). */
function verdictScores(verdict: GuardVerdict): {
  baselineScore: number | null;
  candidateScore: number | null;
  delta: number | null;
} {
  if (verdict.verdict === "KEEP" || verdict.verdict === "REVERT") {
    return {
      baselineScore: verdict.baselineScore,
      candidateScore: verdict.candidateScore,
      delta: verdict.delta,
    };
  }
  return { baselineScore: null, candidateScore: null, delta: null };
}

/**
 * Run the closed L1 control loop for `manifest` under `config`.
 *
 * Idempotent by manifest id; gate-first; atomic apply; falsifiable guard; promote on
 * KEEP or roll back on ANY non-KEEP; emit only after the verdict; exactly one
 * ApplyRecord + one `evolve.apply` event per terminal path. Structural-only.
 */
export async function apply(
  manifest: ChangeManifestV2,
  config: AutonomyConfig,
  deps: ApplyDeps,
): Promise<ApplyOutcome> {
  const { registry, store, traceQuery, diagnoseFn, emit, harnessRoot } = deps;
  const agentId = manifest.agentId;
  const metric = config.guard.regression_metric;
  const baselineVersion = baselineVersionOf(manifest);

  // 0. IDEMPOTENCY — a terminal record for this manifest id means we already ran.
  //    Return it without re-applying (no double-write to the harness). T-04-15.
  const existing = (await store.listApplyRecords({ agentId })).find(
    (r) => r.manifestId === manifest.id,
  );
  if (existing) {
    return { outcome: "already-applied", record: existing };
  }

  // 1. GATE FIRST — a REJECT writes NOTHING (no snapshot, no apply, no record). T-04-14.
  const policy = checkApprovalPolicy(config, manifest, { approvedBy: deps.approvedBy });
  if (!policy.pass) {
    return { outcome: "rejected", reason: policy.reason };
  }
  const approvedBy = policy.approvedBy;
  // The gate already rejected L0; only L1/L2 reach here.
  const autonomyLevel: "L1" | "L2" = config.autonomy === "L2" ? "L2" : "L1";

  // 2. APPLY (ATOMIC) — applyManifest snapshots before the first write and reverts the
  //    whole change on any error. An apply failure still records + emits + returns.
  const result = await applyManifest(
    manifest,
    registry,
    resolveAdapter(manifest.change),
    harnessRoot,
    baselineVersion,
  );

  if (!result.success) {
    const affectedFiles = manifest.detail.targetFiles;
    const createdAt = new Date().toISOString();
    const failBody = {
      id: `ar-${manifest.id}`,
      manifestId: manifest.id,
      agentId,
      fromVersion: baselineVersion,
      toVersion: baselineVersion,
      changeKind: manifest.change,
      approvedBy,
      verdict: "REVERT" as ApplyVerdict,
      baselineScore: null,
      candidateScore: null,
      delta: null,
      evidence: `apply failed before guard: ${result.error instanceof Error ? result.error.message : String(result.error)}`,
      affectedFiles,
      rollbackStatus: "auto-rollback" as const,
      createdAt,
    };
    const failRecord: ApplyRecord = { ...failBody, contentHash: recordContentHash(failBody) };
    // Emit AFTER the (non-)verdict — applyManifest already reverted any partial write.
    emitEvolveApply(
      {
        approvedBy,
        autonomyLevel,
        manifestId: manifest.id,
        changeKind: manifest.change,
        agentId,
        fromVersion: baselineVersion,
        toVersion: baselineVersion,
        affectedFiles,
        expectedEffect: manifest.expected_effect,
        guardMetric: metric,
        baselineScore: null,
        candidateScore: null,
        guardDelta: null,
        verdict: "REVERT",
        rollbackStatus: "auto-rollback",
      },
      emit,
    );
    await store.saveApplyRecord(failRecord);
    return { outcome: "apply-failed", error: result.error, record: failRecord };
  }

  const candidateVersion = result.candidateVersion;
  const snapshot = result.snapshot;
  const affectedFiles = snapshot.files.map((f) => f.path);

  // 3. GUARD — the falsifiable A/B regression check on the candidate version.
  const verdict = await runRegressionGuard(
    agentId,
    baselineVersion,
    candidateVersion,
    config.guard,
    traceQuery,
    diagnoseFn,
  );

  const scores = verdictScores(verdict);
  const evidence = verdictEvidence(verdict, metric);

  // 4. KEEP — promote, advance status to "applied", emit (AFTER the verdict), record.
  if (verdict.verdict === "KEEP") {
    await registry.promote(agentId, candidateVersion);

    const createdAt = new Date().toISOString();
    const keepBody = {
      id: `ar-${manifest.id}`,
      manifestId: manifest.id,
      agentId,
      fromVersion: baselineVersion,
      toVersion: candidateVersion,
      changeKind: manifest.change,
      approvedBy,
      verdict: "KEEP" as ApplyVerdict,
      baselineScore: scores.baselineScore,
      candidateScore: scores.candidateScore,
      delta: scores.delta,
      evidence,
      affectedFiles,
      rollbackStatus: "none" as const,
      createdAt,
    };
    const record: ApplyRecord = { ...keepBody, contentHash: recordContentHash(keepBody) };

    emitEvolveApply(
      {
        approvedBy,
        autonomyLevel,
        manifestId: manifest.id,
        changeKind: manifest.change,
        agentId,
        fromVersion: baselineVersion,
        toVersion: candidateVersion,
        affectedFiles,
        expectedEffect: manifest.expected_effect,
        guardMetric: metric,
        baselineScore: scores.baselineScore,
        candidateScore: scores.candidateScore,
        guardDelta: scores.delta,
        verdict: "KEEP",
        rollbackStatus: "none",
      },
      emit,
    );
    await store.saveApplyRecord(record);

    // Return the applied manifest (status "applied") WITHOUT mutating the input.
    const applied: ChangeManifestV2 = { ...manifest, status: "applied" };
    return { outcome: "kept", record, manifest: applied, verdict };
  }

  // 5. NON-KEEP — REVERT | INSUFFICIENT_DATA | NULL_SCORE all roll back. T-04-16.
  //    rollbackController restores the byte-identical snapshot, records a REVERT
  //    ApplyRecord, and emits in a finally-path. We wrap its ApplyRecord emit to
  //    build + emit the evolve.apply event (rollback_status auto-rollback).
  const record = await rollbackController({
    snapshot,
    registry,
    manifestId: manifest.id,
    agentId,
    fromVersion: baselineVersion,
    toVersion: candidateVersion,
    changeKind: manifest.change,
    approvedBy,
    store,
    evidence,
    mode: "auto-rollback",
    baselineScore: scores.baselineScore,
    candidateScore: scores.candidateScore,
    guardMetric: metric,
    emit: (rec: ApplyRecord) => {
      emitEvolveApply(
        {
          approvedBy: rec.approvedBy,
          autonomyLevel,
          manifestId: rec.manifestId,
          changeKind: rec.changeKind,
          agentId: rec.agentId,
          fromVersion: rec.fromVersion,
          toVersion: rec.toVersion,
          affectedFiles: rec.affectedFiles,
          expectedEffect: manifest.expected_effect,
          guardMetric: metric,
          baselineScore: rec.baselineScore,
          candidateScore: rec.candidateScore,
          guardDelta: rec.delta,
          verdict: rec.verdict,
          rollbackStatus: rec.rollbackStatus,
        },
        emit,
      );
    },
  });

  return { outcome: "rolled-back", record, verdict };
}
