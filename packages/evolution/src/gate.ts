/**
 * @lucid/evolution — `checkApprovalPolicy`: the deterministic approval gate
 * (Plan 04-02, Task 3, REQ-05 / T-04-07).
 *
 * This is the MANDATORY pass-through in front of the privileged write path. The
 * orchestrator (04-04) calls it before `applyManifest`; if it does not PASS, apply
 * never runs. The gate is deterministic server-side access-control policy
 * (04-RESEARCH "Don't Hand-Roll: pure function" / Security Domain V4):
 *
 *   PASS requires ALL of:
 *     - autonomy is "L1" or "L2"           (auto-apply is NOT permitted at L0)
 *     - manifest.change ∈ allow_change_types   (the allow-list gate)
 *     - if require_human_approval: ctx.approvedBy is a non-empty (trimmed) string
 *
 *   Otherwise it returns a typed REJECT carrying the first failing reason.
 *
 * PURITY (non-negotiable): no filesystem access, no clock reads, no randomness. The
 * same inputs always return an equal result, so the decision is reproducible and
 * auditable. This is enforced by a negative grep over this file.
 */

import type { AutonomyConfig } from "./apply-config.js";
import type { ChangeManifestV2 } from "./schema-v2.js";

/** The typed gate verdict: a PASS carries the resolved approver; a REJECT carries the reason. */
export type PolicyResult =
  | { pass: true; approvedBy: string }
  | { pass: false; reason: string };

/**
 * Decide whether `manifest` may be auto-applied under `config`. Pure function:
 * autonomy level + change-kind allow-list + human-approval requirement, evaluated in
 * a fixed order so the first failing condition is the reported reason.
 *
 * @param config    the parsed AutonomyConfig (autonomy / allow_change_types / require_human_approval).
 * @param manifest  the v2 manifest whose `change` kind is checked against the allow-list.
 * @param ctx       the apply context; `approvedBy` is the human approver identity (04-04 supplies it).
 */
export function checkApprovalPolicy(
  config: AutonomyConfig,
  manifest: ChangeManifestV2,
  ctx: { approvedBy?: string } = {},
): PolicyResult {
  // 1. Autonomy gate — auto-apply is never permitted at L0.
  if (config.autonomy === "L0") {
    return {
      pass: false,
      reason:
        'auto-apply is not permitted at autonomy "L0" (recommend-only); promote to "L1" to enable structural auto-apply',
    };
  }

  // 2. Allow-list gate — the change kind must be explicitly permitted.
  if (!config.allow_change_types.includes(manifest.change)) {
    return {
      pass: false,
      reason: `change kind "${manifest.change}" is not in allow_change_types (${config.allow_change_types.join(", ") || "none"})`,
    };
  }

  // 3. Human-approval gate — when required, an approver identity must be supplied.
  if (config.require_human_approval) {
    const approver = ctx.approvedBy?.trim();
    if (!approver) {
      return {
        pass: false,
        reason: "require_human_approval is true but no approver identity (ctx.approvedBy) was supplied",
      };
    }
    return { pass: true, approvedBy: approver };
  }

  // require_human_approval is false: apply is auto-approved.
  return { pass: true, approvedBy: ctx.approvedBy?.trim() || "auto" };
}
