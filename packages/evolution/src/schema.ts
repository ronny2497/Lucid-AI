/**
 * @lucid/evolution — the frozen `change_manifest` Zod schema family (REQ-05).
 *
 * This is the load-bearing cross-phase contract of Phase 3 (L0 — Recommend). It
 * is authored BEFORE any mapper/estimator/propose code exists: downstream plans
 * (03-02 mapper/estimator/propose, 03-03 CLI/HSC/persistence) implement code
 * until `propose()` over the golden fixture matches `expected-manifest-add-gate.json`.
 * The schema is the spec, not the test.
 *
 * Three properties this schema enforces:
 *
 *   1. CLOSED TAXONOMY — `change` is exactly the five L0 change-set kinds. A
 *      sixth kind cannot be proposed at L0. (PRD §5/§6)
 *
 *   2. MANDATORY FALSIFIABILITY — every manifest carries a non-empty
 *      `expected_effect` with at least one non-null principle delta. A proposal
 *      with no predicted delta is unfalsifiable and is REJECTED at parse time.
 *      (RESEARCH Anti-Pattern: empty expected_effect; threat T-03-02)
 *
 *   3. NO RAW-CONTENT FIELD — `detail`/`rationale` are prose-instruction strings;
 *      there is intentionally NO field for raw trace content (prompt text, tool
 *      arguments). The same prohibition that governs `Finding.evidence` in Phase 2
 *      (T-02-02) applies here. (threat T-03-01 / Pitfall 4)
 *
 * The principle keys of `expected_effect` are DERIVED from the `PRINCIPLES` tuple
 * exported by `@lucid/hsc-schema` rather than written as five string literals, so
 * a Phase 0 principle rename propagates here automatically and the keys can never
 * drift from the canonical five (B2 VERIFIED against event-types.ts).
 *
 * ZERO BLAST RADIUS (L0): this module imports only `zod` and `@lucid/hsc-schema`
 * `PRINCIPLES`. It has NO harness-filesystem write path. (threat T-03-03)
 */

import { z } from "zod";
import { PRINCIPLES } from "@lucid/hsc-schema";

/**
 * The five supported change-set kinds — the closed L0 taxonomy.
 *
 * At L0 every kind shares the same prose `detail` shape (a human-applicable
 * instruction). Phase 4 (L1) is where these become a discriminated union with
 * kind-specific machine-parseable `detail` sub-schemas, because Phase 4 must
 * APPLY them programmatically. (PRD §8)
 */
export const ChangeSetKindSchema = z.enum([
  "add-gate", // insert a verify/gate step after a mutating operation
  "trim-context", // reduce context window / remove stale context sources
  "edit-skill", // modify an existing skill definition (content)
  "prompt-patch", // patch a prompt template
  "delete-layer", // remove a harness layer that is no longer earning its keep
]);
export type ChangeSetKind = z.infer<typeof ChangeSetKindSchema>;

/**
 * Per-principle predicted score delta — the falsifiable prediction.
 *
 * The key set is built from the `PRINCIPLES` tuple so it is exactly the canonical
 * five principle names (`context`, `plan_execute`, `feedback`, `one_at_a_time`,
 * `codebase_docs`) — no hardcoded literals, no aliases. `.strict()` REJECTS any
 * key not in that set. Each value is a nullable/optional number: `null`/absent
 * means "no change predicted for this principle".
 *
 * These keys are designed to align exactly with `DiagnosticResult.principles[].principle`
 * and (B3) `VersionDiff.principles[key].delta`, so the falsifiability loop
 * (predicted vs. observed) compares like-for-like.
 */
const expectedEffectShape = Object.fromEntries(
  PRINCIPLES.map((principle) => [principle, z.number().nullable().optional()]),
) as Record<(typeof PRINCIPLES)[number], z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;

export const ExpectedEffectSchema = z
  .object(expectedEffectShape)
  .strict()
  .refine(
    (effect) => Object.values(effect).some((delta) => delta !== null && delta !== undefined),
    {
      message:
        "expected_effect must contain at least one non-null principle delta — an empty expected_effect is unfalsifiable (RESEARCH Anti-Pattern; threat T-03-02)",
    },
  );
export type ExpectedEffect = z.infer<typeof ExpectedEffectSchema>;

/**
 * How the `expected_effect` prediction was produced. `rule-based` is the default
 * deterministic heuristic; `llm-assisted` is the opt-in refinement. The human
 * reviewer sees this tag; it matters for calibration tracking. (PRD §11)
 */
export const EstimatorTagSchema = z.enum(["rule-based", "llm-assisted"]);
export type EstimatorTag = z.infer<typeof EstimatorTagSchema>;

/** The lifecycle status of a proposal. L0 never auto-advances to `applied`. */
export const ManifestStatusSchema = z.enum([
  "proposed",
  "accepted",
  "rejected",
  "applied",
]);
export type ManifestStatus = z.infer<typeof ManifestStatusSchema>;

/**
 * The root `change_manifest` — the typed, versioned, falsifiable proposal artifact.
 *
 * Reads like a PR: diff-shaped `detail`, provenance via `evidence_ref` back-link
 * to the originating `Finding`, and a pinned checkable prediction in
 * `expected_effect`. There is intentionally NO field for raw trace content.
 */
export const ChangeManifestSchema = z.object({
  /** "cm-{id}" — stable, short, human-readable. id generation is 03-02's concern. */
  id: z.string().min(1),
  /** Pinned to "1" now; Phase 4 bumps to "2" when `detail` becomes machine-parseable. */
  schema_version: z.literal("1"),
  /** "agent-id@harness-version", e.g. "my-agent@v37" — encodes the pre-apply baseline. */
  target: z.string().min(1),
  change: ChangeSetKindSchema,
  /** Precise, verbatim-applicable instruction — prose only, tool NAMES + counts, never raw content. */
  detail: z.string().min(1),
  /** Why this change is recommended, citing the finding. */
  rationale: z.string().min(1),
  /** Back-link to the originating finding, e.g. "lucid://findings/F1". */
  evidence_ref: z.string().min(1),
  expected_effect: ExpectedEffectSchema,
  status: ManifestStatusSchema,
  estimator: EstimatorTagSchema,
  /** Optional reviewer annotation set when status transitions to accepted/rejected. */
  review_note: z.string().optional(),
  /** ISO 8601 timestamp. */
  generated_at: z.string().min(1),
});
export type ChangeManifest = z.infer<typeof ChangeManifestSchema>;
