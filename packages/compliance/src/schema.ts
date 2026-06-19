/**
 * @lucid/compliance — the EU AI Act Article 12 evidence-export contract (REQ-06).
 *
 * This module freezes the schemas the compliance exporter (06-04) emits against,
 * authored BEFORE the exporter exists. It targets EU AI Act Article 12
 * record-keeping (the tighter, better-specified regime); Colorado (SB 26-189) is
 * a lighter overlay carried in the `regime` enum and marked
 * `[PENDING AG RULEMAKING]` in 06-04's template.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ASSUMPTION A1 (RESEARCH §Assumptions) — the change_manifest link is by ID only:
 *
 *   `change_manifest_ids` references the Phase 3 ChangeManifest `id` contract
 *   ("cm-..."), but this package takes NO runtime dependency on
 *   `@lucid/evolution` (nor `@lucid/store`). The exporter consumes EXPORTED
 *   audit records, not the live proposal store, via the injected `AuditSource`
 *   seam below. This keeps compliance a leaf package whose value tracks the
 *   AVAILABILITY of Phase 3–5 audit data without coupling to its runtime.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Two tamper-evidence fields (`integrity_hash`, `prev_hash`) are MANDATORY at the
 * contract level (threat T-06-01) so 06-04 cannot emit a record without the
 * hash-chain. The `disclaimer` field is a required non-empty string (threat
 * T-06-02, RESEARCH Pitfall 2): the export is EVIDENCE ASSEMBLY, NOT legal
 * certification, and there is intentionally NO field anywhere in this schema
 * that promises conformity or certification.
 */

import { z } from "zod";

/**
 * The launch set of supported regulatory regimes.
 *   - "eu-ai-act" — the primary, well-specified regime (Article 12).
 *   - "colorado"  — SB 26-189 overlay; lighter, [PENDING AG RULEMAKING].
 * A package whose regime is outside this set is rejected.
 */
export const RegimeSchema = z.enum(["eu-ai-act", "colorado"]);
export type Regime = z.infer<typeof RegimeSchema>;

/**
 * A single EU AI Act Article 12 usage record (RESEARCH Pattern 3).
 *
 * `change_manifest_ids` carries the Phase 3 ChangeManifest ids ("cm-...") for
 * change traceability — by id STRING only (Assumption A1); the evolution package
 * is never imported at runtime. `integrity_hash` + `prev_hash` form the
 * append-only hash chain (RESEARCH Pattern 4) and are both REQUIRED.
 */
export const EuAiActRecordSchema = z
  .object({
    /** Unique record identifier. */
    record_id: z.string().min(1),
    /** ISO 8601 — usage period start. */
    start_time: z.string().min(1),
    /** ISO 8601 — usage period end. */
    end_time: z.string().min(1),
    /** From harness.agent_id / gen_ai.agent.id. */
    agent_id: z.string().min(1),
    /** From harness.version — system version for traceability. */
    harness_version: z.string().min(1),
    /** From gen_ai.request.model. */
    model_id: z.string().min(1),
    /** From gen_ai.input.messages — opt-in only (redaction-gated). */
    input_summary: z.string().optional(),
    /** From gen_ai.response.* — opt-in only (redaction-gated). */
    output_summary: z.string().optional(),
    /** From evolve.propose / manual override events. */
    human_oversight_action: z.string().optional(),
    /**
     * Phase 3 ChangeManifest ids ("cm-...") for change traceability. Linked by
     * id string only — see Assumption A1 (no @lucid/evolution runtime dep).
     */
    change_manifest_ids: z.array(z.string().min(1)),
    /** HMAC-SHA256 over record content — tamper-evidence (REQUIRED; T-06-01). */
    integrity_hash: z.string().min(1),
    /** Hash chain: links to the previous record's integrity_hash (REQUIRED). */
    prev_hash: z.string().min(1),
  })
  .strict();
export type EuAiActRecord = z.infer<typeof EuAiActRecordSchema>;

/**
 * The tamper-evident evidence package the exporter (06-04) emits.
 *
 * `disclaimer` MUST read as evidence-assembly-not-legal-certification (RESEARCH
 * Pitfall 2 / threat T-06-02); a missing or empty disclaimer is REJECTED.
 * `redaction_applied` is the required boolean the exporter must set true before
 * persisting any optional content field (threat T-06-03).
 */
export const EvidencePackageSchema = z
  .object({
    /** The regulatory regime this package targets (launch set only). */
    regime: RegimeSchema,
    /** ISO 8601 — when the package was assembled. */
    generated_at: z.string().min(1),
    /** The agent this evidence package is scoped to. */
    agent_id: z.string().min(1),
    /** The usage period the package covers. */
    period: z
      .object({
        /** ISO 8601 — inclusive period start. */
        since: z.string().min(1),
        /** ISO 8601 — inclusive period end. */
        until: z.string().min(1),
      })
      .strict(),
    /** The Article 12 usage records, in hash-chain order. */
    records: z.array(EuAiActRecordSchema),
    /**
     * REQUIRED, non-empty. MUST state this package is evidence assembly, NOT a
     * legal certification or conformity attestation (RESEARCH Pitfall 2).
     */
    disclaimer: z.string().min(1),
    /** Whether content-field redaction was applied before persistence (T-06-03). */
    redaction_applied: z.boolean(),
  })
  .strict();
export type EvidencePackage = z.infer<typeof EvidencePackageSchema>;
