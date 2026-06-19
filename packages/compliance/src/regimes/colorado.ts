/**
 * Colorado AI Act overlay — a LIGHTER, deliberately UNDERSPECIFIED template.
 *
 * Statute: Colorado SB 26-189 (signed 2026-05-14, effective 2027-01-01). It
 * replaced an earlier, now-repealed Colorado AI statute, which this template
 * intentionally does NOT reference (RESEARCH Pitfall 6). SB 26-189 is a narrower
 * notice-and-transparency regime focused on automated decision-making in
 * "consequential decisions"; its detailed record-keeping obligations depend on
 * Colorado AG rulemaking (due 2027-01-01) that is NOT YET PUBLISHED.
 *
 * Therefore every statute-undetermined field carries the explicit
 * `[PENDING AG RULEMAKING]` sentinel, and this overlay NEVER claims to cover all
 * SB 26-189 obligations. The EU AI Act Article 12 mapper is the primary,
 * well-specified regime; Colorado is an overlay built on the same record shape.
 *
 * This is EVIDENCE ASSEMBLY, not legal certification.
 */

import type { AuditDraftRecord } from "../index.js";
import type { ObligationCoverage, ObligationCoverageEntry } from "./eu-ai-act.js";

/** The explicit sentinel stamped on every statute-undetermined Colorado field. */
export const PENDING_AG_RULEMAKING = "[PENDING AG RULEMAKING]";

/** The Colorado mapping result (same record shape as EU; coverage is lighter). */
export interface ColoradoMapping {
  /** The draft records to hash-chain (the same trace-derived basics). */
  readonly records: readonly AuditDraftRecord[];
  /** The honest, deliberately-partial coverage manifest. */
  readonly coverage: ObligationCoverage;
}

const PENDING_NOTE = `${PENDING_AG_RULEMAKING} — SB 26-189 detail depends on Colorado AG rulemaking due 2027-01-01`;

/**
 * Map audit draft records onto a Colorado SB 26-189 notice-and-transparency
 * overlay. The records carry the same trace basics (agent id, decision output
 * via model id, timestamp, system version) — sufficient for post-decision
 * disclosure (RESEARCH §"HSC → Colorado mapping"). Every obligation whose detail
 * is not yet fixed by statute is marked PARTIAL with the
 * `[PENDING AG RULEMAKING]` sentinel. The overlay NEVER reports `full` coverage
 * of SB 26-189 and NEVER references the earlier, now-repealed Colorado statute.
 */
export function mapColorado(records: readonly AuditDraftRecord[]): ColoradoMapping {
  const obligations: ObligationCoverageEntry[] = [
    {
      // Basic identification IS available from the trace basics.
      obligation: "SB 26-189 — affected-decision identification (agent id, system version, timestamp)",
      status: "full",
      note: "",
    },
    {
      obligation: "SB 26-189 — advance consumer notice content",
      status: "partial",
      note: PENDING_NOTE,
    },
    {
      obligation: "SB 26-189 — post-decision disclosure detail",
      status: "partial",
      note: PENDING_NOTE,
    },
    {
      obligation: "SB 26-189 — consumer rights (explanation / appeal / opt-out) records",
      status: "partial",
      note: PENDING_NOTE,
    },
    {
      obligation: "SB 26-189 — record retention period",
      status: "partial",
      note: PENDING_NOTE,
    },
  ];

  // Colorado is ALWAYS partial — its detail is pending AG rulemaking by design.
  return { records, coverage: { obligations, partial: true } };
}
