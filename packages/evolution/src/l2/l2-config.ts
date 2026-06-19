/**
 * `L2Config` — the `lucid.config.yaml` `evolution.*` L2 surface (REQ-05, Phase 5
 * plan 05-04).
 *
 * This is the L2 superset of the Phase 4 `AutonomyConfig` (apply-config.ts): it
 * carries the weight-level training knobs the structural L1 config does not — the
 * trainer plugin reference, the reward composition, and the promotion-gate config.
 * It preserves the LOAD-BEARING ADR-0004 boundary that the Phase 4 config already
 * enforces: a non-null `trainer` is a CONFIG-PARSE ERROR unless `autonomy === "L2"`.
 *
 * RECONCILIATION WITH PHASE 4 (A4 corrected — Phase 4 IS on disk): the Phase 4
 * `AutonomyConfigSchema`/`apply()`/`FileApplyStore` machinery already ships. We do
 * NOT scaffold a new autonomy base here — we mirror the same `autonomy` enum + the
 * same trainer-null-unless-L2 superRefine so the two configs agree, and add only
 * the L2-specific `trainer`/`reward`/`promote_gate` fields. A future plan may fold
 * `L2ConfigSchema` and `AutonomyConfigSchema` into a single layered schema; for now
 * the L2 fields live here so the L2 orchestrator/CLI parse exactly what they need
 * without forcing the L1 path to grow GRPO knobs.
 *
 * The `reward.weights` keys are the canonical `PRINCIPLES` (derived from
 * `@lucid/hsc-schema`, never hardcoded) so a principle rename propagates and a
 * non-principle weight key is rejected at parse time.
 *
 * NO-PYTHON-CORE-DEP (ADR-0002/0004): this module imports only `zod`,
 * `@lucid/hsc-schema`, and the sibling gate config. It spawns no subprocess and
 * imports no Python — the import graph stays pure-TS.
 */

import { z } from "zod";
import { PRINCIPLES } from "@lucid/hsc-schema";

import { PromoteGateConfigSchema } from "./promotion-gate.js";

/**
 * The trainer plugin reference (L2 ONLY). `plugin` names the configured trainer
 * implementation (e.g. `"filesystem"` for the `FilesystemTrainerPlugin`);
 * `base_model` is the base-model ref the candidate is fine-tuned from. Both are
 * non-empty. A non-null value is only legal at `autonomy === "L2"` (superRefine).
 */
export const TrainerRefSchema = z.object({
  plugin: z.string().min(1),
  base_model: z.string().min(1),
});
export type TrainerRef = z.infer<typeof TrainerRefSchema>;

/**
 * The reward composition: `from` is pinned to the literal `"diagnostic"`
 * (reward-in-TS, ADR-0004 — the reward is computed in TS from the Phase 2
 * `DiagnosticResult`, never re-derived in Python). `weights` is a principle→number
 * map whose keys are the canonical `PRINCIPLES`; a non-principle key is rejected.
 */
export const RewardConfigSchema = z
  .object({
    from: z.literal("diagnostic").default("diagnostic"),
    weights: z.record(
      z.enum(PRINCIPLES as unknown as [string, ...string[]]),
      z.number(),
    ),
  })
  .default({ weights: {} });
export type RewardConfig = z.infer<typeof RewardConfigSchema>;

/**
 * The L2 `evolution.*` config. Parses an operator-supplied object (or nothing) to
 * a fully-defaulted configuration and rejects the ADR-0004 boundary violation (a
 * non-null trainer below L2). Defaults are conservative: autonomy "L0" (no L2
 * loop), trainer null.
 */
export const L2ConfigSchema = z
  .object({
    /** L0 recommend-only (default), L1 structural auto-apply, L2 weight-level GRPO. */
    autonomy: z.enum(["L0", "L1", "L2"]).default("L0"),
    /** The trainer plugin — L2 ONLY. At L0/L1 the only valid value is null. */
    trainer: TrainerRefSchema.nullable().default(null),
    /** How the scalar reward is composed (reward-in-TS; principle weights). */
    reward: RewardConfigSchema,
    /** The promotion gate (held-out eval / metric / margin). */
    promote_gate: PromoteGateConfigSchema,
  })
  .superRefine((cfg, ctx) => {
    if (cfg.autonomy !== "L2" && cfg.trainer != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["trainer"],
        message:
          'trainer must be null unless autonomy === "L2" — a trainer plugin (weights / GRPO) is L2-only; L0/L1 are pure-TS structural evolution (ADR-0004 / T-04-02)',
      });
    }
  });
export type L2Config = z.infer<typeof L2ConfigSchema>;
