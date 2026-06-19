/**
 * @lucid/evolution — `rollbackController`: the guaranteed-revert + guaranteed-audit
 * rollback path (Plan 04-03, Task 2, REQ-05 / T-04-11).
 *
 * The rollback controller is the REVERSIBILITY layer of L1 auto-apply. When the
 * regression guard returns REVERT (auto path) or a human pulls the kill-switch
 * (manual path), this controller:
 *
 *   1. RESTORES the prior known-good harness files via `registry.revert(snapshot)`
 *      — a byte-identical FILE RESTORE from the immutable pre-apply snapshot, NOT a
 *      diff invert (which can fail to apply cleanly). After this returns, the
 *      harness is back to a known-good state; it is never left half-applied.
 *   2. RECORDS a `verdict: "REVERT"` `ApplyRecord` with `rollbackStatus` set to the
 *      mode (`"auto-rollback"` | `"manual-rollback"`) and a tamper-evidence
 *      `contentHash`.
 *   3. EMITS the audit event in a `finally`-equivalent path AFTER the revert — so
 *      the `evolve.apply`-with-rollback_status audit event fires EVEN IF the record
 *      persistence throws (T-04-11 / Pitfall 5). The event is never swallowed on the
 *      error branch; a rollback is always attributable.
 *
 * STRUCTURALLY SIMPLER THAN APPLY (the critical invariant): rollback has NO policy
 * checkpoint and NO approval check. Restoring a known-good baseline is always safe —
 * there is nothing to authorize. The controller also never re-invokes the change
 * that failed the regression check (it only restores files).
 *
 * STRUCTURAL-ONLY: a rollback is a plain file restore via the registry. It stays on
 * the L1 structural boundary — no model-parameter or training path anywhere
 * (ADR-0004 L1 boundary; T-04-09).
 */

import { createHash } from "node:crypto";

import type { ApplyRecord, ApplyStore } from "./apply-store.js";
import type { ChangeSetKind } from "./schema.js";
import type { HarnessVersionRegistry, VersionSnapshot } from "./version-registry.js";

/** Arguments for {@link rollbackController}. */
export interface RollbackControllerArgs {
  /** The immutable pre-apply snapshot to restore from. */
  snapshot: VersionSnapshot;
  /** The version registry whose `revert` restores the known-good files. */
  registry: HarnessVersionRegistry;
  /** The `cm-{id}` of the manifest being rolled back. */
  manifestId: string;
  /** Normalized agent identity. */
  agentId: string;
  /** The harness version restored TO (the known-good baseline). */
  fromVersion: string;
  /** The candidate harness version being reverted FROM. */
  toVersion: string;
  /** Which structural change was applied (and is now reverted). */
  changeKind: ChangeSetKind;
  /** Who approved the original apply (carried into the audit record). */
  approvedBy: string;
  /** The append-only audit store the REVERT record is persisted to. */
  store: ApplyStore;
  /** Derived evidence string — counts / metric summary, never raw content. */
  evidence: string;
  /** `"auto-rollback"` (guard) or `"manual-rollback"` (kill-switch). */
  mode: "auto-rollback" | "manual-rollback";
  /** The audit sink — invoked in the GUARANTEED (finally) path after revert. */
  emit: (record: ApplyRecord) => void;
  /** The guard's baseline score (carried for the audit body); null when absent. */
  baselineScore: number | null;
  /** The guard's candidate score; null when absent. */
  candidateScore: number | null;
  /** The guard metric the scores were measured on (e.g. "success"). */
  guardMetric: string;
}

/** Null-safe delta: null when either score is null (never a NaN). */
function safeDelta(baseline: number | null, candidate: number | null): number | null {
  if (baseline === null || candidate === null) return null;
  return candidate - baseline;
}

/**
 * Build the REVERT `ApplyRecord` for a rollback. `contentHash` is a SHA-256 over the
 * serialized record body (excluding the hash itself) — tamper-evidence, not content
 * disclosure. The body carries only the affected-file PATHS (from the snapshot) +
 * derived scores.
 */
function buildRevertRecord(args: RollbackControllerArgs): ApplyRecord {
  const affectedFiles = args.snapshot.files.map((f) => f.path);
  const delta = safeDelta(args.baselineScore, args.candidateScore);
  const createdAt = new Date().toISOString();

  // The hash preimage: every record field EXCEPT the hash, with sorted keys for a
  // stable digest. Recomputable for tamper-evidence on export.
  const body = {
    id: `ar-${args.manifestId}-revert`,
    manifestId: args.manifestId,
    agentId: args.agentId,
    fromVersion: args.fromVersion,
    toVersion: args.toVersion,
    changeKind: args.changeKind,
    approvedBy: args.approvedBy,
    verdict: "REVERT" as const,
    baselineScore: args.baselineScore,
    candidateScore: args.candidateScore,
    delta,
    evidence: args.evidence,
    affectedFiles,
    rollbackStatus: args.mode,
    createdAt,
    guardMetric: args.guardMetric,
  };
  const canonical = JSON.stringify(body, Object.keys(body).sort());
  const contentHash = "sha256:" + createHash("sha256").update(canonical).digest("hex");

  return {
    id: body.id,
    manifestId: body.manifestId,
    agentId: body.agentId,
    fromVersion: body.fromVersion,
    toVersion: body.toVersion,
    changeKind: body.changeKind,
    approvedBy: body.approvedBy,
    verdict: body.verdict,
    baselineScore: body.baselineScore,
    candidateScore: body.candidateScore,
    delta: body.delta,
    evidence: body.evidence,
    affectedFiles: body.affectedFiles,
    contentHash,
    rollbackStatus: body.rollbackStatus,
    createdAt: body.createdAt,
  };
}

/**
 * Roll back an apply: restore the known-good files, record a REVERT `ApplyRecord`,
 * and GUARANTEE the audit event fires.
 *
 * The load-bearing sequence:
 *   1. `await registry.revert(snapshot)` FIRST — the harness is restored before
 *      anything that could throw (persistence). It is never left half-applied.
 *   2. Build the REVERT record.
 *   3. `try { await store.saveApplyRecord(record) } finally { emit(record) }` — the
 *      audit emission is in the `finally`, so it fires even if persistence throws
 *      (T-04-11 / Pitfall 5). The persistence error still surfaces to the caller
 *      AFTER emit, so the caller learns the record was not durably stored — but the
 *      audit event was never swallowed.
 *
 * No policy checkpoint, no approval check, no re-entry of the failed change.
 */
export async function rollbackController(args: RollbackControllerArgs): Promise<ApplyRecord> {
  // 1. Restore the known-good baseline FIRST (a byte-identical file restore).
  await args.registry.revert(args.snapshot);

  // 2. Record the REVERT.
  const record = buildRevertRecord(args);

  // 3. Persist + emit so the audit event is GUARANTEED even on a persistence error.
  try {
    await args.store.saveApplyRecord(record);
  } finally {
    // The rollback audit event MUST fire even when saveApplyRecord throws (Pitfall 5).
    args.emit(record);
  }

  return record;
}
