/**
 * @lucid/evolution — `AutonomyConfigSchema`: the `lucid.config.yaml` `evolution.*`
 * contract that bounds WHEN auto-apply runs (Task 2, REQ-05).
 *
 * Auto-apply is a privileged write path. The v2 manifest schema bounds WHAT can be
 * applied; this config bounds WHEN: gated, conservative-by-default, and — the
 * load-bearing ADR-0004 boundary — NO trainer outside L2.
 *
 * Two properties this schema freezes:
 *
 *   1. CONSERVATIVE DEFAULTS — an absent/empty `evolution.*` block parses to a safe
 *      all-defaults object: autonomy "L0" (recommend-only, no auto-apply),
 *      require_human_approval true, rollback "auto", guard.regression_metric
 *      "success", guard.min_delta 0, guard.sample 200, trainer null,
 *      version_retention 10. You must opt IN to autonomy; you never opt out.
 *
 *   2. L1/L2 BOUNDARY (ADR-0004, T-04-02) — the `.superRefine` REJECTS a non-null
 *      `trainer` whenever `autonomy !== "L2"`. L0/L1 are pure-TS structural
 *      evolution; a TrainerPlugin (weights / GRPO) is L2-only (Phase 5). Encoding
 *      this as a schema validation error means a misconfig that would escalate the
 *      blast radius toward weight mutation fails at config-parse time. L2 itself is
 *      out of scope here — this schema only enforces the boundary, it does not
 *      implement L2.
 *
 * `guard.regression_metric` is "success" or one of the canonical `PRINCIPLES` — the
 * union is DERIVED from the `@lucid/hsc-schema` `PRINCIPLES` tuple, never hardcoded,
 * so the metric set cannot drift from the canonical principle names.
 *
 * STRUCTURAL-ONLY: there is no weight / GRPO / `.safetensors` field anywhere in this
 * schema. `trainer` is typed `z.unknown().nullable()` precisely so that no trainer
 * SHAPE is given a home at L1 — the only valid L1/L0 value is `null`.
 */

import { z } from "zod";
import { PRINCIPLES } from "@lucid/hsc-schema";

import { ChangeSetKindSchema } from "./schema.js";

/** The five change kinds an L1 config may allow, defaulting to all five. */
const ALL_CHANGE_KINDS = [
  "add-gate",
  "trim-context",
  "edit-skill",
  "prompt-patch",
  "delete-layer",
] as const;

/**
 * The regression-guard config: which metric to compare, the minimum improvement to
 * KEEP, and the sample size. `regression_metric` is "success" or a canonical
 * principle name (derived from `PRINCIPLES`).
 */
export const GuardConfigSchema = z
  .object({
    regression_metric: z
      .union([
        z.literal("success"),
        z.enum(PRINCIPLES as unknown as [string, ...string[]]),
      ])
      .default("success"),
    min_delta: z.number().default(0),
    sample: z.number().int().positive().default(200),
  })
  .default({});
export type GuardConfig = z.infer<typeof GuardConfigSchema>;

/**
 * The `evolution.*` autonomy config. Parses an operator-supplied object (or
 * nothing) to a safe, fully-defaulted configuration; rejects the ADR-0004
 * boundary violation (a non-null trainer below L2).
 */
export const AutonomyConfigSchema = z
  .object({
    /** L0 recommend-only (default), L1 structural auto-apply, L2 weights (Phase 5). */
    autonomy: z.enum(["L0", "L1", "L2"]).default("L0"),
    /** A human must approve before apply (default true — opt OUT explicitly). */
    require_human_approval: z.boolean().default(true),
    /** Which change kinds auto-apply may touch (default: all five). */
    allow_change_types: z.array(ChangeSetKindSchema).default([...ALL_CHANGE_KINDS]),
    guard: GuardConfigSchema,
    /** Auto-rollback on regression (default) or require a manual rollback. */
    rollback: z.enum(["auto", "manual"]).default("auto"),
    /**
     * The trainer plugin — L2 ONLY. At L0/L1 the only valid value is null. Typed
     * `unknown` so no trainer shape is given a home below L2; the superRefine
     * enforces the boundary (ADR-0004 / T-04-02).
     */
    trainer: z.unknown().nullable().default(null),
    /** How many prior harness versions to retain snapshots for. */
    version_retention: z.number().int().positive().default(10),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.autonomy !== "L2" && cfg.trainer != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["trainer"],
        message:
          "trainer must be null unless autonomy === \"L2\" — a trainer plugin (weights / GRPO) is L2-only; L0/L1 are pure-TS structural evolution (ADR-0004 / T-04-02)",
      });
    }
  });
export type AutonomyConfig = z.infer<typeof AutonomyConfigSchema>;
