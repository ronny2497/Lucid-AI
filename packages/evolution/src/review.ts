/**
 * @lucid/evolution — `updateManifestStatus`: the L0 status-only transition.
 *
 * This is the human-in-the-loop review action. `lucid evolve review <id> --accept`
 * and `--reject` call this to record the reviewer's decision on a `change_manifest`.
 *
 * THE L0 BOUNDARY (the load-bearing security property of Phase 3):
 *
 *   `--accept` records `status: "accepted"` and APPLIES NOTHING. This function
 *   returns a NEW manifest object — it never mutates the input, never writes to a
 *   harness config/prompt/skill/context file, and never advances to `"applied"`.
 *   `"applied"` is reserved for Phase 4 (L1, the gated auto-apply path) and is
 *   UNREACHABLE here: passing it throws. (must_haves.prohibitions; threat T-03-10)
 *
 * The valid L0 transitions are: `proposed -> accepted | rejected` (and re-affirming
 * `proposed`). The returned manifest is re-validated against `ChangeManifestSchema`
 * before it is handed back, so a review can never produce an invalid record.
 *
 * ZERO BLAST RADIUS (L0): pure function over the manifest. No filesystem, no
 * harness write path. The only persistence is the caller writing the returned
 * manifest to the `ProposalStore` (an audit artifact) — never to a harness file.
 */

import { ChangeManifestSchema, type ChangeManifest } from "./schema.js";

/**
 * The statuses a reviewer may set at L0. `"applied"` is intentionally excluded —
 * it is a Phase 4 (L1) transition, not a human review decision.
 */
export type ReviewStatus = "proposed" | "accepted" | "rejected";

/**
 * Record a reviewer's decision on a manifest.
 *
 * Returns a NEW `ChangeManifest` (the input is never mutated) with `status` set and
 * `review_note` set when a note is supplied. The result is re-validated against
 * `ChangeManifestSchema` before return.
 *
 * @throws if `status === "applied"` — the L0 boundary. Auto-apply is Phase 4; at
 *         L0 the only side effect of accepting a proposal is recording the decision.
 * @throws if the resulting manifest fails `ChangeManifestSchema` validation.
 */
export function updateManifestStatus(
  manifest: ChangeManifest,
  status: ReviewStatus,
  note?: string,
): ChangeManifest {
  // The L0 hard boundary: "applied" is reserved for Phase 4 (auto-apply). A review
  // action can NEVER advance a proposal to applied — that would imply a harness
  // mutation, which Phase 3 has no path to perform. (threat T-03-10)
  if ((status as string) === "applied") {
    throw new Error(
      'updateManifestStatus: status "applied" is reserved for Phase 4 (L1 auto-apply); ' +
        "at L0 a review may only set proposed | accepted | rejected — it applies NOTHING.",
    );
  }

  // Build a NEW object — never mutate the caller's manifest.
  const next: ChangeManifest = {
    ...manifest,
    status,
    ...(note !== undefined ? { review_note: note } : {}),
  };

  // The schema is the spec: re-validate before returning so a review can never
  // produce an invalid record.
  return ChangeManifestSchema.parse(next);
}
