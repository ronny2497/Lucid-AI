/**
 * @lucid/evolution — the finding→change-set mapper.
 *
 * `findingToChangeSets(finding, diagnostic)` dispatches on `finding.detectorId`
 * to the matching rule in a registry KEYED BY THE FROZEN `@lucid/diagnostic`
 * detector-id constants (never copied string literals). Each of the five Phase 2
 * principle detectors has a rule, so no finding type silently produces zero
 * proposals (PRD M2; RESEARCH Pitfall 2). An unknown `detectorId` returns `[]`
 * (no crash, nothing sensitive logged).
 *
 * Shipped mapping table (id constant → primary change kind):
 *   feedback.no-verify-after-mutation → add-gate     (flagship; fully worked)
 *   context.budget-pressure           → trim-context
 *   plan_execute.act-before-plan      → prompt-patch
 *   one_at_a_time.oversized-slice     → add-gate
 *   codebase_docs.no-doc-encoding     → prompt-patch
 *
 * Every non-flagship rule builds its `detail`/`rationale` ONLY from the finding's
 * structured fields (principle, severity, tool names parsed from `evidence`,
 * derived counts) — never raw trace content / tool-call arguments (T-03-05).
 *
 * `delete-layer` SEAM: no rule emits a delete-layer on a score alone. A delete
 * proposal requires explicit `VersionDiff` evidence (a future parameter) and is
 * flagged low-confidence; the score-only path can never yield it (Pitfall 5 /
 * threat T-03-08). The seam is documented here and guarded by coverage.test.ts.
 *
 * ZERO BLAST RADIUS (L0): the mapper returns plain `CandidateChangeSet` objects.
 * It declares no harness-filesystem write path and never mutates manifest status.
 */

import {
  BUDGET_PRESSURE_ID,
  ACT_BEFORE_PLAN_ID,
  OVERSIZED_SLICE_ID,
  NO_DOC_ENCODING_ID,
} from "@lucid/diagnostic";
import type { DiagnosticResult, Finding } from "@lucid/diagnostic";

import type { CandidateChangeSet } from "../types.js";
import { MAPPING_KINDS, parseOffendingTools, type ChangeSetRule } from "./rules.js";
import { noVerifyAfterMutationRule } from "./feedback/no-verify-after-mutation.js";

/**
 * Render the offending tools (parsed from evidence) into a prose clause, or a
 * tool-agnostic fallback when none parse. Tool names are DERIVED at runtime.
 */
function toolClause(finding: Finding): string {
  const tools = parseOffendingTools(finding.evidence);
  return tools.length > 0
    ? `affected tools: ${tools.join(", ")}`
    : "across the affected tools";
}

/** context.budget-pressure → trim-context. */
const budgetPressureRule: ChangeSetRule = {
  detectorId: BUDGET_PRESSURE_ID,
  map(finding) {
    return [
      {
        change: "trim-context",
        detail:
          `Reduce the context window for this agent: drop stale or low-signal ` +
          `context sources before the next turn (${toolClause(finding)}). ` +
          `Keep only the context required for the current task slice.`,
        rationale:
          `Finding ${finding.id} (${finding.detectorId}, severity ${finding.severity}): ` +
          `context budget pressure detected. Trimming stale context restores ` +
          `headroom on the Context principle.`,
      },
    ];
  },
};

/** plan_execute.act-before-plan → prompt-patch. */
const actBeforePlanRule: ChangeSetRule = {
  detectorId: ACT_BEFORE_PLAN_ID,
  map(finding) {
    return [
      {
        change: "prompt-patch",
        detail:
          `Patch the agent's system/plan prompt to require an explicit plan.emit ` +
          `step before any tool.call (${toolClause(finding)}). State the plan, ` +
          `then act — never act before planning.`,
        rationale:
          `Finding ${finding.id} (${finding.detectorId}, severity ${finding.severity}): ` +
          `actions were taken before a plan was emitted. A prompt patch enforcing ` +
          `plan-before-act closes the Plan/Execute gap.`,
      },
    ];
  },
};

/** one_at_a_time.oversized-slice → add-gate. */
const oversizedSliceRule: ChangeSetRule = {
  detectorId: OVERSIZED_SLICE_ID,
  map(finding) {
    return [
      {
        change: "add-gate",
        detail:
          `Insert a slice-size gate before task execution: reject or split any ` +
          `task slice that exceeds the one-at-a-time budget (${toolClause(finding)}). ` +
          `Gate each slice to a single focused change before proceeding.`,
        rationale:
          `Finding ${finding.id} (${finding.detectorId}, severity ${finding.severity}): ` +
          `oversized task slices were detected. A size gate enforces the ` +
          `One-at-a-Time principle.`,
      },
    ];
  },
};

/** codebase_docs.no-doc-encoding → prompt-patch. */
const noDocEncodingRule: ChangeSetRule = {
  detectorId: NO_DOC_ENCODING_ID,
  map(finding) {
    return [
      {
        change: "prompt-patch",
        detail:
          `Patch the agent prompt to encode codebase docs into context before ` +
          `acting: load and cite the relevant documentation for the working area ` +
          `(${toolClause(finding)}) at the start of each task.`,
        rationale:
          `Finding ${finding.id} (${finding.detectorId}, severity ${finding.severity}): ` +
          `the agent acted without encoding codebase documentation. A prompt patch ` +
          `requiring doc-encoding closes the Codebase-Docs gap.`,
      },
    ];
  },
};

/**
 * The rule registry, keyed by the FROZEN detector-id constants. Built as a Map so
 * dispatch is O(1) and the keys are exactly the imported constants — never copied
 * literals. `coverage.test.ts` asserts every key resolves via `getDetector(id)`.
 */
const RULES: ReadonlyArray<ChangeSetRule> = [
  noVerifyAfterMutationRule,
  budgetPressureRule,
  actBeforePlanRule,
  oversizedSliceRule,
  noDocEncodingRule,
];

const RULE_REGISTRY: ReadonlyMap<string, ChangeSetRule> = new Map(
  RULES.map((rule) => [rule.detectorId, rule]),
);

/**
 * Map a Phase 2 `Finding` (in the context of its `DiagnosticResult`) to zero or
 * more typed `CandidateChangeSet`s. Dispatches on `finding.detectorId` to the
 * matching frozen-id-keyed rule; an unmatched id returns `[]` (no crash).
 */
export function findingToChangeSets(
  finding: Finding,
  diagnostic: DiagnosticResult,
): CandidateChangeSet[] {
  const rule = RULE_REGISTRY.get(finding.detectorId);
  if (!rule) return [];
  return rule.map(finding, diagnostic);
}

/** The detector ids the mapper keys on (for the Pitfall-2 coverage guard). */
export const MAPPED_DETECTOR_IDS: readonly string[] = RULES.map((r) => r.detectorId);

export { MAPPING_KINDS };
export type { ChangeSetRule };
