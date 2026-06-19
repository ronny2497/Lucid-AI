/**
 * @lucid/evolution — `ApplyStore` + `ApplyRecord`: the auto-apply audit store
 * (Task 2, REQ-05).
 *
 * Every privileged apply must be RECORDED. `ApplyRecord` is the audit body for an
 * `evolve.apply` action (kept add-gate, regressed-and-reverted trim-context, etc.).
 * `ApplyStore` is the queryable index over those records.
 *
 * WHY A DEDICATED STORE (decoupled from `@lucid/store` `TraceStore`): the Phase 1
 * `TraceStore` exposes only `writeSpans / queryTraces / getTrace / getMetricsInput`
 * — there is NO event-name-filtered query path (VERIFIED on disk in
 * packages/store/src/interface.ts). So `lucid evolve list --status applied` has no
 * efficient query against the trace store as-is. `ApplyStore` is therefore the
 * SEPARATE, listable audit index — mirroring the Phase 3 `ProposalStore` decoupling
 * discipline. Nothing here imports a concrete store.
 *
 * EVENT NAMING RECONCILIATION: `EVENT_TYPES` contains `evolve.apply` but NO
 * `evolve.rollback` member. A rollback is therefore audited as an `evolve.apply`
 * event with `rollbackStatus: "auto-rollback"` (or `"manual-rollback"`), NOT a new
 * event type. `ApplyRecord.rollbackStatus` carries that distinction. (04-03 emits
 * the HSC event; this plan only freezes the record shape.)
 *
 * CONTENT-FREE / TAMPER-EVIDENT (T-04-04): `ApplyRecord` carries only file PATHS
 * (`affectedFiles`), derived SCORES (`baselineScore` / `candidateScore` / `delta`,
 * each `number | null`), and a SHA-256 `contentHash`. There is intentionally NO
 * field for raw harness content (prompt text, tool arguments, file bodies) — the
 * same prohibition that governs `Finding.evidence` (T-02-02) and the v1 manifest
 * (T-03-01). The hash is tamper-evidence, not content disclosure.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";

import { ChangeSetKindSchema } from "./schema.js";

/** The regression-guard verdict for an apply. */
export const GuardVerdictSchema = z.enum([
  "KEEP", // candidate >= baseline + min_delta — promote
  "REVERT", // candidate regressed — auto/manual rollback
  "INSUFFICIENT_DATA", // not enough samples to decide
  "NULL_SCORE", // a score was null (absence is signal — cannot KEEP)
]);
export type GuardVerdict = z.infer<typeof GuardVerdictSchema>;

/**
 * Whether (and how) the apply was rolled back. `evolve.rollback` is NOT an
 * EVENT_TYPES member — a rollback is an `evolve.apply` with one of these statuses.
 */
export const RollbackStatusSchema = z.enum([
  "none", // kept, no rollback
  "auto-rollback", // guard reverted it automatically
  "manual-rollback", // a human reverted it
]);
export type RollbackStatus = z.infer<typeof RollbackStatusSchema>;

/**
 * The audit body for one `evolve.apply` action. PATHS + derived scores + a
 * tamper-evidence `contentHash` only — never raw harness content (T-04-04).
 */
export const ApplyRecordSchema = z.object({
  /** "ar-{id}" — stable, short. */
  id: z.string().min(1),
  /** The `cm-{id}` of the applied manifest. */
  manifestId: z.string().min(1),
  /** Normalized agent identity (mirrors ChangeManifestV2.agentId). */
  agentId: z.string().min(1),
  /** The pre-apply harness version, e.g. "v37". */
  fromVersion: z.string().min(1),
  /** The post-apply candidate harness version, e.g. "v38". */
  toVersion: z.string().min(1),
  /** Which kind of change was applied (the closed taxonomy). */
  changeKind: ChangeSetKindSchema,
  /** Who approved the apply (human id or an automated-approver tag). */
  approvedBy: z.string().min(1),
  verdict: GuardVerdictSchema,
  /** Pre-change metric score; null when absent (absence is signal). */
  baselineScore: z.number().nullable(),
  /** Post-change metric score; null when absent. */
  candidateScore: z.number().nullable(),
  /** candidate - baseline; null when either is null. */
  delta: z.number().nullable(),
  /** Derived evidence string — counts / metric summary, never raw content. */
  evidence: z.string(),
  /** Harness-relative paths the apply touched — paths only, no bodies. */
  affectedFiles: z.array(z.string()),
  /** SHA-256 over the applied content — tamper-evidence, not disclosure. */
  contentHash: z.string().min(1),
  rollbackStatus: RollbackStatusSchema,
  /** ISO 8601 timestamp. */
  createdAt: z.string().min(1),
});
export type ApplyRecord = z.infer<typeof ApplyRecordSchema>;

/** Filter for {@link ApplyStore.listApplyRecords}. All fields optional (AND-combined). */
export interface ApplyRecordFilter {
  /** Restrict to records for this agent. */
  agentId?: string;
  /** Restrict to records with this verdict. */
  status?: ApplyRecord["verdict"];
  /** Restrict to records created at/after this ISO timestamp. */
  since?: string;
}

/**
 * The queryable audit index over `ApplyRecord`s — SEPARATE from `TraceStore`
 * (which has no event-name query path). A concrete file/in-memory implementation
 * ships here; Phase 1 may later satisfy it natively.
 */
export interface ApplyStore {
  /** Persist an apply record (UPSERT by id is an implementation choice). */
  saveApplyRecord(record: ApplyRecord): Promise<void>;
  /** List records matching the filter (e.g. all KEEP for one agent since T). */
  listApplyRecords(filter: ApplyRecordFilter): Promise<ApplyRecord[]>;
  /** Fetch a single record by `ar-{id}`, or null if absent. */
  getApplyRecord(id: string): Promise<ApplyRecord | null>;
}

/** The default apply-record index path, alongside the trace store (never a harness path). */
export const DEFAULT_APPLY_RECORDS_PATH = "lucid-apply-records.json";

/** The on-disk file shape — a versioned envelope around the record list. */
interface ApplyRecordsFile {
  applyRecords: ApplyRecord[];
}

/**
 * A file-backed `ApplyStore` over a single JSON file. Append/upsert by id; filter
 * on read. Uses only `node:fs`; the only write is to its own JSON index — never a
 * harness file, never raw content.
 */
export class FileApplyStore implements ApplyStore {
  private readonly path: string;

  constructor(path: string = DEFAULT_APPLY_RECORDS_PATH) {
    this.path = path;
  }

  /** Read + re-validate every stored record so a corrupt index can never yield invalid records. */
  private readAll(): ApplyRecord[] {
    if (!existsSync(this.path)) return [];
    const raw = readFileSync(this.path, "utf8").trim();
    if (raw === "") return [];
    const parsed = JSON.parse(raw) as ApplyRecordsFile;
    const list = Array.isArray(parsed?.applyRecords) ? parsed.applyRecords : [];
    return list.map((r) => ApplyRecordSchema.parse(r));
  }

  private writeAll(records: ApplyRecord[]): void {
    const file: ApplyRecordsFile = { applyRecords: records };
    writeFileSync(this.path, JSON.stringify(file, null, 2) + "\n", "utf8");
  }

  async saveApplyRecord(record: ApplyRecord): Promise<void> {
    const validated = ApplyRecordSchema.parse(record);
    const records = this.readAll();
    const idx = records.findIndex((r) => r.id === validated.id);
    if (idx >= 0) {
      records[idx] = validated;
    } else {
      records.push(validated);
    }
    this.writeAll(records);
  }

  async listApplyRecords(filter: ApplyRecordFilter = {}): Promise<ApplyRecord[]> {
    return this.readAll().filter((r) => {
      if (filter.agentId !== undefined && r.agentId !== filter.agentId) return false;
      if (filter.status !== undefined && r.verdict !== filter.status) return false;
      if (filter.since !== undefined && r.createdAt < filter.since) return false;
      return true;
    });
  }

  async getApplyRecord(id: string): Promise<ApplyRecord | null> {
    return this.readAll().find((r) => r.id === id) ?? null;
  }
}
