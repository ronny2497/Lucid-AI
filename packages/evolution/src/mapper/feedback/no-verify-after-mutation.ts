/**
 * @lucid/evolution — the FLAGSHIP mapper rule.
 *
 * Maps the Phase 2 `feedback.no-verify-after-mutation` finding to exactly ONE
 * `add-gate` `CandidateChangeSet`: insert a `verify.result` step after each
 * state-mutating `tool.call`.
 *
 * Worked path properties:
 *   - The `detail` names the offending tools, but the names are PARSED FROM
 *     `finding.evidence` at runtime (via `parseOffendingTools`) — there is NO
 *     hardcoded tool list and NO harness-specific tool reference anywhere in this
 *     module (RESEARCH Anti-Pattern: coupling to harness tool names; T-03-05).
 *   - The `detail` is a verbatim-applicable instruction built only from structured
 *     finding fields (tool names + the gate action) — never raw trace content.
 *   - The `rationale` cites the finding id and the feedback gap.
 *
 * ZERO BLAST RADIUS (L0): returns a plain object; no write path, no status mutation.
 */

import { NO_VERIFY_AFTER_MUTATION_ID } from "@lucid/diagnostic";
import type { DiagnosticResult, Finding } from "@lucid/diagnostic";

import type { CandidateChangeSet } from "../../types.js";
import { parseOffendingTools, parseMutationCounts, type ChangeSetRule } from "../rules.js";

/** Re-export the frozen id constant so the registry keys never hardcode the string. */
export { NO_VERIFY_AFTER_MUTATION_ID };

/**
 * Build the flagship add-gate candidate from a no-verify-after-mutation finding.
 *
 * Tool names AND the unverified/total counts are derived from `finding.evidence`
 * at runtime; if the evidence does not parse the detail/rationale degrade
 * gracefully (still falsifiable, still no hardcoded names or counts).
 */
function mapNoVerifyAfterMutation(
  finding: Finding,
  _diagnostic: DiagnosticResult,
): CandidateChangeSet[] {
  const tools = parseOffendingTools(finding.evidence);
  const toolList = tools.length > 0 ? tools.join(", ") : "every state-mutating tool";

  const detail =
    `Insert a verify.result step after each tool.call that mutates state; ` +
    `affected tools: ${toolList}. Add the step immediately after the tool call ` +
    `in the same turn, before any subsequent action.`;

  const counts = parseMutationCounts(finding.evidence);
  const countPhrase = counts
    ? `${counts.unverified} of ${counts.total} state-mutating calls had no verification step in the same turn`
    : `state-mutating calls were left without a verification step in the same turn`;

  const rationale =
    `Finding ${finding.id} (${finding.detectorId}): ` +
    `${countPhrase}. ` +
    `This is the highest-leverage Feedback gap per the 2x2 diagnostic ` +
    `(feedback column empty).`;

  return [
    {
      change: "add-gate",
      detail,
      rationale,
    },
  ];
}

/** The flagship rule, keyed by the frozen detector-id constant. */
export const noVerifyAfterMutationRule: ChangeSetRule = {
  detectorId: NO_VERIFY_AFTER_MUTATION_ID,
  map: mapNoVerifyAfterMutation,
};
