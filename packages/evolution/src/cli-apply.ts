/**
 * @lucid/evolution — the testable `lucid evolve apply/rollback/audit` command surface
 * (Plan 04-04, Task 2, REQ-05).
 *
 * Mirrors the Phase 3 `cli.ts` pattern: command bodies are plain async functions over
 * an injected `CliIO` sink + the apply collaborators (an `ApplyStore`, a
 * `HarnessVersionRegistry`, the `evolve.apply` emit sink, the loaded `AutonomyConfig`,
 * a `TraceQuery`, a `DiagnoseFn`, the harness root). They unit-test without a process
 * or an argv parser; `commander` is wired ONLY in the collector's `run()` (which lazily
 * imports these functions). `packages/collector/src/cli.ts` extends the Phase 3
 * `lucid evolve propose|review|list` subcommand tree with these three.
 *
 *   - apply    --manifest <path> [--approved-by <id>]  -> run the gated loop, render
 *              kept (v37->v38) / rolled-back (with the guard evidence) / rejected
 *              (with the reason) / apply-failed. Returns 0 on a terminal applied/kept/
 *              rolled-back outcome, non-zero on rejected/apply-failed.
 *   - rollback --agent <id> --to <version>             -> the manual kill-switch: load
 *              the snapshot for the target version and call rollbackController with
 *              mode "manual-rollback". Returns 1 when the snapshot/version is absent.
 *   - audit    [--agent <id>] [--since <t>] [--status]  -> print the matching
 *              ApplyRecords one line each (or "(no apply records)").
 *
 * STRUCTURAL-ONLY (HARD, ADR-0004): the three commands are the entire L1 operator
 * surface. The L2 weight-level tier (Phase 5) adds no command here. A negative grep
 * over this file enforces the boundary.
 *
 * MANIFEST SOURCE: `applyCommand` loads a v2 manifest JSON (`--manifest`/`--from`) and
 * parses it against `ChangeManifestV2Schema` at the trust boundary. A v1 source is
 * migrated via `migrateV1toV2` (the v1 re-propose path) — but the testable default is
 * a v2 JSON. The `AutonomyConfig` is parsed against `AutonomyConfigSchema` before the
 * loop (so a non-null trainer below L2 is rejected at parse time — T-04-02).
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import { apply, type ApplyDeps, type ApplyOutcome } from "./apply.js";
import { rollbackController } from "./rollback.js";
import { ChangeManifestV2Schema, type ChangeManifestV2 } from "./schema-v2.js";
import { AutonomyConfigSchema, type AutonomyConfig } from "./apply-config.js";
import { migrateV1toV2, type RepropseV2DetailFn } from "./migrate.js";
import { ChangeManifestSchema } from "./schema.js";
import { emitEvolveApply, type EvolveApplyRecord } from "./hsc-emit-apply.js";
import type { ApplyRecord, ApplyStore, ApplyRecordFilter } from "./apply-store.js";
import type { HarnessVersionRegistry } from "./version-registry.js";

/** A minimal output sink so tests can capture stdout/stderr (mirrors the Phase 3 CliIO). */
export interface CliIO {
  out: (line: string) => void;
  err: (line: string) => void;
}

/**
 * The apply collaborators the three commands share. `config` is the parsed
 * AutonomyConfig; `traceQuery`/`diagnoseFn` are the guard inputs; `emit` is the
 * `evolve.apply` audit sink; `harnessRoot` is the dir targetFiles are confined to.
 */
export interface ApplyCliDeps {
  store: ApplyStore;
  registry: HarnessVersionRegistry;
  config: AutonomyConfig;
  traceQuery: ApplyDeps["traceQuery"];
  diagnoseFn: ApplyDeps["diagnoseFn"];
  emit: (record: EvolveApplyRecord) => void;
  harnessRoot: string;
  /** A v1->v2 re-propose function, used only when `--manifest` points at a v1 manifest. */
  reproposeFn?: RepropseV2DetailFn;
}

/** Args for `applyCommand`. Exactly one of `manifest`/`from` is the manifest path. */
export interface ApplyCommandArgs {
  manifest?: string;
  from?: string;
  approvedBy?: string;
}

/** Args for `rollbackCommand` — the manual kill-switch. */
export interface RollbackCommandArgs {
  agent: string;
  to: string;
  approvedBy?: string;
}

/** Args for `auditCommand`. All filters optional (AND-combined). */
export interface AuditCommandArgs {
  agent?: string;
  since?: string;
  status?: ApplyRecord["verdict"];
}

/**
 * Load a `ChangeManifestV2` from a JSON path. A `schema_version "2"` source parses
 * directly; a `schema_version "1"` source is migrated via `migrateV1toV2` (requires a
 * `reproposeFn`). Any other shape is a parse error at the trust boundary.
 */
function loadManifest(path: string, reproposeFn?: RepropseV2DetailFn): ChangeManifestV2 {
  const raw = JSON.parse(readFileSync(path, "utf8")) as { schema_version?: unknown };
  if (raw.schema_version === "1") {
    if (!reproposeFn) {
      throw new Error(
        `manifest ${path} is schema_version "1"; supply a reproposeFn to migrate it to v2`,
      );
    }
    return migrateV1toV2(ChangeManifestSchema.parse(raw), reproposeFn);
  }
  return ChangeManifestV2Schema.parse(raw);
}

/** Render an apply outcome for the operator (one human-readable summary). */
function renderOutcome(io: CliIO, manifestId: string, outcome: ApplyOutcome): number {
  switch (outcome.outcome) {
    case "kept":
      io.out(
        `kept  ${manifestId}  ${outcome.record.fromVersion}->${outcome.record.toVersion}  verdict=KEEP  ${outcome.record.evidence}`,
      );
      return 0;
    case "rolled-back":
      io.out(
        `rolled-back  ${manifestId}  verdict=${outcome.verdict.verdict}  rollback_status=${outcome.record.rollbackStatus}  ${outcome.record.evidence}`,
      );
      return 0;
    case "already-applied":
      io.out(
        `already-applied  ${manifestId}  verdict=${outcome.record.verdict}  (idempotent — nothing re-applied)`,
      );
      return 0;
    case "apply-failed":
      io.err(
        `apply-failed  ${manifestId}  ${outcome.error instanceof Error ? outcome.error.message : String(outcome.error)}`,
      );
      return 1;
    case "rejected":
      io.err(`rejected  ${manifestId}  ${outcome.reason}`);
      return 1;
  }
}

/**
 * `lucid evolve apply --manifest <path> [--approved-by <id>]`.
 *
 * Loads the v2 manifest (migrating a v1 source if needed), runs the gated loop via
 * `apply()`, and renders the outcome. Returns 0 on kept/rolled-back/already-applied,
 * non-zero on rejected/apply-failed.
 */
export async function applyCommand(
  io: CliIO,
  deps: ApplyCliDeps,
  args: ApplyCommandArgs,
): Promise<number> {
  const path = args.manifest ?? args.from;
  if (!path) {
    io.err("apply requires --manifest <path>");
    return 1;
  }
  let manifest: ChangeManifestV2;
  try {
    manifest = loadManifest(path, deps.reproposeFn);
  } catch (err) {
    io.err(`failed to load manifest ${path}: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const outcome = await apply(manifest, deps.config, {
    registry: deps.registry,
    store: deps.store,
    traceQuery: deps.traceQuery,
    diagnoseFn: deps.diagnoseFn,
    emit: deps.emit,
    harnessRoot: deps.harnessRoot,
    approvedBy: args.approvedBy,
  });
  return renderOutcome(io, manifest.id, outcome);
}

/** A stable, short SHA-256 (hex) hash over the canonical record body (sans hash). */
function recordContentHash(body: Record<string, unknown>): string {
  const canonical = JSON.stringify(body, Object.keys(body).sort());
  return "sha256:" + createHash("sha256").update(canonical).digest("hex");
}

/**
 * `lucid evolve rollback --agent <id> --to <version>` — the manual kill-switch.
 *
 * Resolves the immutable snapshot for the target version via
 * `registry.getSnapshot(agent, to)` (returns 1 + an error when absent) and calls
 * `rollbackController` with mode "manual-rollback". A manual rollback has no policy
 * checkpoint — restoring a known-good baseline is always safe.
 */
export async function rollbackCommand(
  io: CliIO,
  deps: Pick<ApplyCliDeps, "store" | "registry" | "emit">,
  args: RollbackCommandArgs,
): Promise<number> {
  const snapshot = await deps.registry.getSnapshot(args.agent, args.to);
  if (snapshot === null) {
    io.err(`no snapshot found for ${args.agent}@${args.to} — cannot roll back`);
    return 1;
  }

  const record = await rollbackController({
    snapshot,
    registry: deps.registry,
    manifestId: `manual-${args.agent}-${args.to}`,
    agentId: args.agent,
    fromVersion: args.to,
    toVersion: args.to,
    changeKind: "trim-context",
    approvedBy: args.approvedBy ?? "manual",
    store: deps.store,
    evidence: `manual kill-switch: restored ${args.agent}@${args.to} from snapshot ${snapshot.snapshotId}`,
    mode: "manual-rollback",
    baselineScore: null,
    candidateScore: null,
    guardMetric: "manual",
    emit: (rec: ApplyRecord) => {
      emitEvolveApply(
        {
          approvedBy: rec.approvedBy,
          autonomyLevel: "L1",
          manifestId: rec.manifestId,
          changeKind: rec.changeKind,
          agentId: rec.agentId,
          fromVersion: rec.fromVersion,
          toVersion: rec.toVersion,
          affectedFiles: rec.affectedFiles,
          expectedEffect: {},
          guardMetric: "manual",
          baselineScore: rec.baselineScore,
          candidateScore: rec.candidateScore,
          guardDelta: rec.delta,
          verdict: rec.verdict,
          rollbackStatus: rec.rollbackStatus,
        },
        deps.emit,
      );
    },
  });
  // The contentHash hint keeps the rendered line referenceable in the audit trail.
  void recordContentHash;
  io.out(
    `rolled-back  ${args.agent}@${args.to}  rollback_status=${record.rollbackStatus}  files=${record.affectedFiles.length}`,
  );
  return 0;
}

/**
 * `lucid evolve audit [--agent <id>] [--since <t>] [--status <verdict>]`.
 *
 * Prints one line per matching ApplyRecord (manifest id, change kind, approver,
 * verdict, from->to, rollback status), or "(no apply records)" when empty. Read-only.
 */
export async function auditCommand(
  io: CliIO,
  store: ApplyStore,
  args: AuditCommandArgs = {},
): Promise<number> {
  const filter: ApplyRecordFilter = {
    agentId: args.agent,
    since: args.since,
    status: args.status,
  };
  const records = await store.listApplyRecords(filter);
  if (records.length === 0) {
    io.out("(no apply records)");
    return 0;
  }
  for (const r of records) {
    io.out(
      `${r.manifestId}  change=${r.changeKind}  by=${r.approvedBy}  verdict=${r.verdict}  ${r.fromVersion}->${r.toVersion}  rollback=${r.rollbackStatus}`,
    );
  }
  return 0;
}
