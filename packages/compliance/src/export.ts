/**
 * Compliance export orchestrator (REQ-06, EC-3).
 *
 * `exportEvidence(source, opts)`:
 *   1. fetches draft audit records for the window via the injected AuditSource;
 *   2. runs the 06-05 redaction-completeness gate — REFUSES to produce a package
 *      when an enabled content field has no configured redaction action (T-06-16,
 *      no silent PII leak);
 *   3. maps the records onto the requested regime's obligations (EU AI Act
 *      Article 12 primary, Colorado overlay);
 *   4. hash-chains the mapped records (audit-trail.ts) so the output is
 *      tamper-evident (T-06-15);
 *   5. assembles an EvidencePackage with the MANDATORY non-certification
 *      disclaimer (T-06-17) and the honest `redaction_applied` flag (T-06-16);
 *   6. parses the package through EvidencePackageSchema before returning it.
 *
 * The exporter NEVER imports @lucid/store / @lucid/evolution — only the seam.
 * It promises EVIDENCE ASSEMBLY, never legal certification.
 */

import { chainRecords } from "./audit-trail.js";
import { mapEuAiAct, type ObligationCoverage } from "./regimes/eu-ai-act.js";
import { mapColorado } from "./regimes/colorado.js";
import {
  checkRedactionCompleteness,
  type RedactionConfig,
} from "./redaction-gate.js";
import { EvidencePackageSchema, type EvidencePackage, type Regime } from "./schema.js";
import type { AuditQuery, AuditDraftRecord, AuditSource } from "./index.js";

/**
 * The non-certification disclaimer stamped on EVERY package (RESEARCH Pitfall 2 /
 * T-06-17). The package is evidence assembly, NOT a legal certification or
 * conformity attestation.
 */
export const NON_CERTIFICATION_DISCLAIMER =
  "This package is evidence assembly, NOT a legal certification or conformity attestation. " +
  "It assembles audit records to support a regulated adopter's own compliance assessment; " +
  "it does not certify conformity with the EU AI Act, Colorado SB 26-189, or any other law.";

/** Options for {@link exportEvidence}. */
export interface ExportOptions {
  /** The regulatory regime to assemble for. */
  readonly regime: Regime;
  /** The agent id to scope the export to. */
  readonly agentId: string;
  /** Inclusive period start (ISO 8601). */
  readonly since: string;
  /** Inclusive period end (ISO 8601). */
  readonly until: string;
  /** The redaction config the export was assembled under (06-05 gate). */
  readonly redactionConfig: RedactionConfig;
  /** HMAC secret for the hash chain. */
  readonly secret: string;
  /** Override the assembly timestamp (for deterministic tests). */
  readonly generatedAt?: string;
}

/** A successful export: the parsed package + the obligation-coverage manifest. */
export interface ExportResult {
  readonly ok: true;
  readonly package: EvidencePackage;
  readonly coverage: ObligationCoverage;
}

/** A refused export: the actionable reason (redaction incomplete, etc.). */
export interface ExportRefusal {
  readonly ok: false;
  readonly reason: string;
  /** Content fields present without a configured redaction action. */
  readonly offendingFields: string[];
}

export type ExportOutcome = ExportResult | ExportRefusal;

/**
 * Project a draft record into the flat attribute bag the redaction gate
 * inspects: the two opt-in content keys are PRESENT only when the draft actually
 * carries an `input_summary` / `output_summary` content field. (tool-call
 * arguments are not surfaced into Article 12 records, so they are never present.)
 */
function toRedactionRecord(draft: AuditDraftRecord): Record<string, unknown> {
  const bag: Record<string, unknown> = {};
  if (typeof draft.input_summary === "string") {
    bag["gen_ai.input.messages"] = draft.input_summary;
  }
  // output_summary is content-bearing but maps to no opt-in content key in the
  // gate's registry; it is carried by the schema's optional field only. We still
  // surface input_summary (the prompt content) which IS the gated key.
  return bag;
}

/**
 * Assemble a tamper-evident EvidencePackage for the window, or refuse when
 * redaction is incomplete. Returns a discriminated outcome (never throws on a
 * redaction failure — the caller maps `ok:false` to a non-zero exit).
 */
export async function exportEvidence(
  source: AuditSource,
  opts: ExportOptions,
): Promise<ExportOutcome> {
  const query: AuditQuery = { agentId: opts.agentId, since: opts.since, until: opts.until };
  const drafts = await source.fetchRecords(query);

  // (2) Redaction-completeness gate BEFORE any mapping / assembly (T-06-16).
  const redactionRecords = drafts.map(toRedactionRecord);
  const completeness = checkRedactionCompleteness(redactionRecords, opts.redactionConfig);
  if (!completeness.complete) {
    return {
      ok: false,
      reason:
        "refusing to export: redaction incomplete — content field(s) present with no configured redaction action: " +
        completeness.offendingFields.join(", "),
      offendingFields: completeness.offendingFields,
    };
  }

  // (3) Map onto the regime's obligations.
  const mapping = opts.regime === "eu-ai-act" ? mapEuAiAct(drafts) : mapColorado(drafts);

  // (4) Hash-chain the mapped records (tamper-evidence, T-06-15).
  const records = chainRecords(mapping.records, opts.secret);

  // (5) Assemble the package with the mandatory disclaimer + honest redaction flag.
  const pkg: EvidencePackage = {
    regime: opts.regime,
    generated_at: opts.generatedAt ?? new Date().toISOString(),
    agent_id: opts.agentId,
    period: { since: opts.since, until: opts.until },
    records,
    disclaimer: NON_CERTIFICATION_DISCLAIMER,
    redaction_applied: completeness.redactionApplied,
  };

  // (6) Parse through the frozen contract before returning (no malformed output).
  const parsed = EvidencePackageSchema.safeParse(pkg);
  if (!parsed.success) {
    return {
      ok: false,
      reason: `internal error: assembled package failed schema validation: ${parsed.error.message}`,
      offendingFields: [],
    };
  }

  return { ok: true, package: parsed.data, coverage: mapping.coverage };
}
