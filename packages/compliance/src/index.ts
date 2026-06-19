/**
 * @lucid/compliance — public surface.
 *
 * Wave 0 (this plan) freezes the evidence-export schemas AND the injected
 * `AuditSource` seam. The exporter (`export.ts`), the per-regime obligation
 * templates (`eu-ai-act.ts`, `colorado.ts`), and the hash-chain assembly land
 * in 06-04 — intentionally NOT stubbed here.
 *
 * Assumption A1: this package never imports @lucid/store or @lucid/evolution at
 * runtime. The exporter reads Phase 3–5 audit data through the `AuditSource`
 * seam below — an interface the consumer (06-04 / the CLI) injects — so the
 * change_manifest link is by id string only and compliance stays a leaf package.
 */

import type { EuAiActRecord, Regime } from "./schema.js";

export {
  EvidencePackageSchema,
  EuAiActRecordSchema,
  RegimeSchema,
  type EvidencePackage,
  type EuAiActRecord,
  type Regime,
} from "./schema.js";

export {
  checkRedactionCompleteness,
  CONTENT_FIELD_KEYS,
  type RedactionAction,
  type RedactionConfig,
  type RedactionCompleteness,
} from "./redaction-gate.js";

/**
 * The query window an exporter asks the audit source for. ISO 8601 strings.
 */
export interface AuditQuery {
  /** Agent id to scope the export to. */
  readonly agentId: string;
  /** Inclusive period start (ISO 8601). */
  readonly since: string;
  /** Inclusive period end (ISO 8601). */
  readonly until: string;
}

/**
 * The injected audit-data seam (RESEARCH §Compliance Export; Assumption A1).
 *
 * 06-04's exporter depends ONLY on this interface, never on a concrete
 * @lucid/store / @lucid/evolution import. A consumer provides an implementation
 * backed by exported Phase 3–5 audit records (timestamps, model ids, change
 * manifest ids, human-oversight actions). This keeps @lucid/compliance a leaf
 * package and lets the exporter be tested against an in-memory fake.
 *
 * The seam returns DRAFT records (the content fields the exporter maps from
 * audit data) WITHOUT the hash-chain fields — 06-04's assembler computes
 * `prev_hash` / `integrity_hash` and is the only code that closes the chain, so
 * the chain cannot be sourced from untrusted upstream data.
 */
export type AuditDraftRecord = Omit<EuAiActRecord, "integrity_hash" | "prev_hash">;

export interface AuditSource {
  /**
   * Return the draft usage records for the window, in chronological order. The
   * exporter (06-04) hash-chains them into `EuAiActRecord`s.
   */
  fetchRecords(query: AuditQuery): Promise<readonly AuditDraftRecord[]> | readonly AuditDraftRecord[];
}

/**
 * The set of regimes whose obligation templates 06-04 ships. Kept here so the
 * CLI can enumerate supported regimes without importing the (future) templates.
 */
export const SUPPORTED_REGIMES: readonly Regime[] = ["eu-ai-act", "colorado"] as const;

// ── 06-04: the exporter, hash-chain, regime templates, and CLI core ──────────

export {
  appendAuditRecord,
  chainRecords,
  verifyChain,
  verifyChainJsonl,
  toJsonl,
  GENESIS_PREV_HASH,
  type ChainVerification,
} from "./audit-trail.js";

export {
  InMemoryAuditSource,
  traceStoreAuditSource,
  type TraceLike,
  type TraceQuerier,
} from "./source.js";

export {
  mapEuAiAct,
  type EuAiActMapping,
  type ObligationCoverage,
  type ObligationCoverageEntry,
  type CoverageStatus,
} from "./regimes/eu-ai-act.js";

export {
  mapColorado,
  PENDING_AG_RULEMAKING,
  type ColoradoMapping,
} from "./regimes/colorado.js";

export {
  exportEvidence,
  NON_CERTIFICATION_DISCLAIMER,
  type ExportOptions,
  type ExportResult,
  type ExportRefusal,
  type ExportOutcome,
} from "./export.js";

export {
  runComplianceExport,
  type ComplianceExportArgs,
  type ComplianceExportOutcome,
} from "./cli.js";
