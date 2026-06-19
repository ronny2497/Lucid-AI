/**
 * @lucid/evolution — mapper rule registry shapes + the per-detector mapping table.
 *
 * A `ChangeSetRule` is a pure function from a `Finding` (in the context of its
 * `DiagnosticResult`) to zero-or-more `CandidateChangeSet`s. The registry that
 * `findingToChangeSets()` dispatches over is keyed by the FROZEN detector-id
 * constants imported from `@lucid/diagnostic` — NEVER by string literals copied
 * out of RESEARCH (RESEARCH Pitfall 2: a drifted/copied id silently maps to
 * zero proposals). `tests/mapper/coverage.test.ts` is the guard: it fails loudly
 * if any key here is absent from the diagnostic `detectorRegistry`.
 *
 * `MAPPING_KINDS` pairs each detector-id with its PRIMARY change-set kind. The
 * kind choices follow RESEARCH's intent (reconciled to the frozen ids in the
 * 03-02 interface_context):
 *
 *   feedback.no-verify-after-mutation → add-gate      (flagship; fully worked)
 *   context.budget-pressure           → trim-context
 *   plan_execute.act-before-plan      → prompt-patch
 *   one_at_a_time.oversized-slice     → add-gate
 *   codebase_docs.no-doc-encoding     → prompt-patch
 *
 * `delete-layer` is intentionally NOT in this table: no principle rule emits a
 * delete-layer on a score alone. It is reserved for a future VersionDiff-evidence
 * path (a documented seam; flagged low-confidence) so a low score can never
 * socially-engineer removal of a needed harness layer (Pitfall 5 / threat T-03-08).
 *
 * ZERO BLAST RADIUS (L0): rules return plain `CandidateChangeSet` objects. They
 * declare no harness-filesystem write path and never mutate manifest status.
 */

import {
  NO_VERIFY_AFTER_MUTATION_ID,
  BUDGET_PRESSURE_ID,
  ACT_BEFORE_PLAN_ID,
  OVERSIZED_SLICE_ID,
  NO_DOC_ENCODING_ID,
} from "@lucid/diagnostic";
import type { DiagnosticResult, Finding } from "@lucid/diagnostic";

import type { CandidateChangeSet, ChangeSetKind } from "../types.js";

/**
 * A single mapping rule: dispatch key + the pure mapping function.
 *
 * `detectorId` is one of the frozen `@lucid/diagnostic` constants (never a copied
 * literal). `map` reads ONLY the finding's structured fields (principle, severity,
 * tool names parsed from `evidence` at runtime, derived counts) — never raw trace
 * content / tool-call arguments (T-03-05 / Pitfall 4).
 */
export interface ChangeSetRule {
  readonly detectorId: string;
  map(finding: Finding, diagnostic: DiagnosticResult): CandidateChangeSet[];
}

/**
 * The primary change-set kind per FROZEN detector-id constant. Keyed by the
 * imported constants so a Phase 2 id rename propagates here; a guard test asserts
 * every key resolves via `getDetector(id)`.
 */
export const MAPPING_KINDS: Record<string, ChangeSetKind> = {
  [NO_VERIFY_AFTER_MUTATION_ID]: "add-gate",
  [BUDGET_PRESSURE_ID]: "trim-context",
  [ACT_BEFORE_PLAN_ID]: "prompt-patch",
  [OVERSIZED_SLICE_ID]: "add-gate",
  [NO_DOC_ENCODING_ID]: "prompt-patch",
};

/**
 * Parse the offending tool NAMES out of a finding's structured `evidence` string
 * at runtime. The Phase 2 evidence format lists tools as `name (count)` pairs,
 * e.g. `"... Offending tools by count: db.write (11), api.post (7)."`.
 *
 * We extract only the bare tool identifiers (dot/colon/dash/word characters) that
 * directly precede a parenthesised count — NEVER raw arguments or prose. Tool
 * names are therefore DERIVED from the finding at runtime, never written as
 * literals in any rule source (RESEARCH Anti-Pattern: coupling to harness tool
 * names; T-03-05).
 *
 * Returns the names in first-seen order, de-duplicated. Empty array if none parse.
 */
export function parseOffendingTools(evidence: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  // Match a tool identifier immediately followed by a "(<digits>)" count.
  const re = /([A-Za-z][\w.:-]*)\s*\(\s*\d+\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(evidence)) !== null) {
    const name = m[1];
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

/**
 * Parse the `"<unverified> of <total>"` mutation counts out of a finding's
 * structured `evidence` string at runtime (Phase 2 evidence format begins
 * `"18 of 24 state-mutating tool.call events ..."`). Returns derived counts only
 * — never raw content. `undefined` if the leading "X of Y" pair is absent.
 */
export function parseMutationCounts(
  evidence: string,
): { unverified: number; total: number } | undefined {
  const m = /^\s*(\d+)\s+of\s+(\d+)\b/.exec(evidence);
  if (!m) return undefined;
  return { unverified: Number(m[1]), total: Number(m[2]) };
}
