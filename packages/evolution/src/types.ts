/**
 * @lucid/evolution — shared types for the L0 self-evolution layer.
 *
 * Re-exports the schema-inferred manifest types and defines the mapper's
 * intermediate `CandidateChangeSet` shape (produced by `findingToChangeSets()`
 * in 03-02, before the estimator + assembler turn it into a full ChangeManifest).
 *
 * ── B-series assumption ledger (Phase 2 contract) ───────────────────────────
 * Phase 2 is BUILT; the following are now VERIFIED against source on disk and no
 * longer provisional:
 *
 *   B2 [VERIFIED]  The five principle names are exactly
 *                  `context | plan_execute | feedback | one_at_a_time | codebase_docs`,
 *                  exported as the `PRINCIPLES` tuple from `@lucid/hsc-schema`
 *                  (packages/hsc-schema/src/event-types.ts). `ExpectedEffect`
 *                  keys are derived from it — no aliases.
 *   B4 [VERIFIED]  `hitCount`/`relevantEventCount` live on `PrincipleScore`, NOT
 *                  on `Finding` (packages/diagnostic/src/schema.ts). The 03-02
 *                  estimator scales by the matching `PrincipleScore`'s counts.
 *   B6 [VERIFIED]  `Finding.eventIds: string[]` exists, so `evidence_ref` can
 *                  back-link to specific events.
 *
 * Still pending the remaining Phase 2 SUMMARYs (do not block this Wave-0 plan):
 *
 *   B1 [PENDING]   Non-flagship detector-id string values (03-02 imports the
 *                  named constants from `@lucid/diagnostic`, never hardcodes).
 *   B3 [PENDING]   `VersionDiff.principles[key].delta` is keyed by the same five
 *                  principle names — `ExpectedEffect` keys are designed to match
 *                  so the falsifiability loop aligns. Revisit when 02-05 lands.
 *   B5 [PENDING]   Phase 1's store exposes only `queryTraces`/`getTrace`, not an
 *                  event-name query — so 03-03 ships a default ProposalStore
 *                  implementation against the seam defined in proposal-store.ts.
 */

import type { HscPrinciple } from "@lucid/hsc-schema";

export type {
  ChangeManifest,
  ChangeSetKind,
  ExpectedEffect,
  EstimatorTag,
  ManifestStatus,
} from "./schema.js";

import type { ChangeSetKind } from "./schema.js";

/**
 * The five canonical convergence principle names, sourced from the Phase 0 tuple.
 * Use this anywhere a principle key is needed — never a free string literal.
 */
export type Principle = HscPrinciple;

/**
 * The mapper's intermediate output: a typed change-set with the verbatim-applicable
 * instruction and rationale, but BEFORE the estimator attaches `expected_effect`
 * and the assembler attaches `id`/`status`/`generated_at`. `findingToChangeSets()`
 * (03-02) returns `CandidateChangeSet[]`; `propose()` consumes them.
 */
export interface CandidateChangeSet {
  change: ChangeSetKind;
  /** Verbatim human-applicable instruction — prose + tool NAMES only, never raw content. */
  detail: string;
  rationale: string;
}
