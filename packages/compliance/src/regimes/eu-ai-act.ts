/**
 * EU AI Act Article 12 obligation mapper — the PRIMARY, well-specified regime.
 *
 * Maps the injected `AuditDraftRecord`s (the trace-derived audit basics, plus —
 * when Phase 3–5 data exists — change_manifest ids and human-oversight actions)
 * onto Article 12 record-keeping obligations, and reports an honest
 * `ObligationCoverage` manifest stating which obligations are FULLY vs PARTIALLY
 * covered. When Phase 3–5 audit data is ABSENT (RESEARCH Assumption A1), this
 * mapper produces VALID partial records (Article 12 basic logging) and marks
 * change-traceability / human-oversight as partial — it NEVER fabricates them.
 *
 * Source: RESEARCH §"HSC → EU AI Act mapping" table:
 *   - Usage period (start/end)   ← record start_time / end_time   [always present]
 *   - Agent id                   ← record agent_id                [always present]
 *   - System / model version     ← harness_version + model_id     [always present]
 *   - Human oversight action     ← evolve.propose / override       [requires Phase 3+]
 *   - Change traceability        ← change_manifest_ids             [requires Phase 3+]
 *
 * This is EVIDENCE ASSEMBLY, not legal certification — the exporter stamps the
 * non-certification disclaimer (RESEARCH Pitfall 2).
 */

import type { AuditDraftRecord } from "../index.js";

/** Coverage status for a single Article 12/13 obligation. */
export type CoverageStatus = "full" | "partial";

/** One obligation's coverage verdict + (when partial) the reason. */
export interface ObligationCoverageEntry {
  /** The obligation key (Article 12 minimum fields + Article 13 traceability). */
  readonly obligation: string;
  /** Whether this obligation is fully or only partially covered by the data. */
  readonly status: CoverageStatus;
  /** When partial, WHY (e.g. "requires Phase 3–5 audit data"). Empty when full. */
  readonly note: string;
}

/** The obligation-coverage manifest the export embeds for auditor honesty. */
export interface ObligationCoverage {
  /** Per-obligation coverage entries (stable order). */
  readonly obligations: readonly ObligationCoverageEntry[];
  /**
   * True when ANY obligation is only partially covered (i.e. some Phase 3–5
   * audit data was absent). The export surfaces this so the package is never
   * presented as a complete Article 12 record set when it is not.
   */
  readonly partial: boolean;
}

/** The result of mapping audit drafts to Article 12 obligations. */
export interface EuAiActMapping {
  /** The draft records to hash-chain into the evidence package, in order. */
  readonly records: readonly AuditDraftRecord[];
  /** The honest obligation-coverage manifest. */
  readonly coverage: ObligationCoverage;
}

const REQUIRES_PHASE_35 = "requires Phase 3–5 audit data (change_manifest / evolve.propose)";

/**
 * Map a set of audit draft records onto EU AI Act Article 12 obligations.
 *
 * Article 12 BASIC logging (usage period, agent id, system/model version) is
 * ALWAYS covered from the trace basics. Change traceability is FULL only when at
 * least one record carries `change_manifest_ids`; human oversight is FULL only
 * when at least one record carries a `human_oversight_action`. Otherwise those
 * obligations are PARTIAL with an explicit "requires Phase 3–5 audit data" note —
 * the records themselves carry an empty `change_manifest_ids` / no oversight,
 * never a fabricated value.
 */
export function mapEuAiAct(records: readonly AuditDraftRecord[]): EuAiActMapping {
  const hasChangeTraceability = records.some(
    (r) => Array.isArray(r.change_manifest_ids) && r.change_manifest_ids.length > 0,
  );
  const hasHumanOversight = records.some(
    (r) => typeof r.human_oversight_action === "string" && r.human_oversight_action.length > 0,
  );

  const obligations: ObligationCoverageEntry[] = [
    {
      obligation: "Article 12 — usage period (start/end timestamps)",
      status: "full",
      note: "",
    },
    {
      obligation: "Article 12 — agent identification",
      status: "full",
      note: "",
    },
    {
      obligation: "Article 12 — system & model version (harness_version, model_id)",
      status: "full",
      note: "",
    },
    {
      obligation: "Article 12 — human oversight actions",
      status: hasHumanOversight ? "full" : "partial",
      note: hasHumanOversight ? "" : REQUIRES_PHASE_35,
    },
    {
      obligation: "Article 13 — change traceability (change_manifest ids)",
      status: hasChangeTraceability ? "full" : "partial",
      note: hasChangeTraceability ? "" : REQUIRES_PHASE_35,
    },
  ];

  const partial = obligations.some((o) => o.status === "partial");

  // Pass records through UNCHANGED — the mapper never invents change_manifest_ids
  // or oversight actions; absence stays absence (empty array / omitted field).
  return { records, coverage: { obligations, partial } };
}
