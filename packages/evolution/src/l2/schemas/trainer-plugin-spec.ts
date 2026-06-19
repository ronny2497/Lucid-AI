/**
 * `TrainerPluginSpec` — the TS→Python job-handoff contract (REQ-05, Phase 5 L2).
 *
 * This is the ONLY thing TypeScript hands across the language boundary to a
 * weight-level trainer: a set of filesystem paths (dataset, rewards, output dir),
 * a base-model reference, and a GRPO/PEFT hyperparameter bundle. It deliberately
 * carries NO quality logic — Python does gradient math only; the rewards are
 * computed in TS from the Phase 2 `DiagnosticResult` (ADR-0004, reward-in-TS).
 *
 * Two parse-time guards bound the privileged surface:
 *   - every path field must be ABSOLUTE, so the sidecar resolves it independently
 *     of its cwd and cannot be tricked by a relative/traversal path (threat
 *     T-05-03). Per-path containment against an allowed root is the orchestrator's
 *     concern (05-04); this schema only enforces absoluteness.
 *   - `num_generations` must be >= 2: GRPO computes a group-relative advantage,
 *     which is undefined for a group of one (the loss has no variance to subtract).
 *
 * The default `loss_type` is `dr_grpo` — the RESEARCH-recommended (A8/A11)
 * length-bias-free GRPO loss.
 *
 * NO-PYTHON-CORE-DEP (ADR-0002/0004): this module imports only `zod` and
 * `node:path` (stdlib). It spawns no subprocess and imports no Python.
 */

import { z } from "zod";
import path from "node:path";

/**
 * A filesystem path that MUST be absolute. The sidecar dereferences these paths
 * from its own working directory, so a relative path would be ambiguous and a
 * traversal path could escape the intended dir (T-05-03).
 */
export const AbsolutePathSchema = z.string().refine((p) => path.isAbsolute(p), {
  message:
    "path must be absolute so the trainer sidecar resolves it independently of its working directory",
});

/**
 * GRPO training hyperparameters. `num_generations` is the group size used to
 * compute the group-relative advantage and must exceed one. `loss_type` defaults
 * to the length-bias-free `dr_grpo`. `beta` (KL penalty) defaults to 0.
 */
export const GrpoConfigSchema = z
  .object({
    num_train_epochs: z.number().default(1),
    per_device_train_batch_size: z.number().int().positive().default(4),
    num_generations: z
      .number()
      .int()
      .min(2, {
        message:
          "GRPO group size must exceed one — group-relative advantage is undefined for a single generation",
      })
      .default(8),
    loss_type: z.enum(["grpo", "dapo", "dr_grpo"]).default("dr_grpo"),
    use_vllm: z.boolean().default(false),
    max_completion_length: z.number().int().positive().default(512),
    beta: z.number().default(0),
  })
  .default({});

/**
 * PEFT (parameter-efficient fine-tuning) configuration. Enabled by default so a
 * candidate is a small LoRA adapter rather than a full-weight checkpoint.
 */
export const PeftConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    lora_r: z.number().int().positive().default(16),
    lora_alpha: z.number().int().positive().default(32),
    target_modules: z.array(z.string()).optional(),
  })
  .default({});

/**
 * The full job-handoff spec written by TS and read by the trainer plugin.
 */
export const TrainerPluginSpecSchema = z.object({
  job_id: z.string().min(1),
  dataset_path: AbsolutePathSchema,
  rewards_path: AbsolutePathSchema,
  base_model_ref: z.string().min(1),
  output_dir: AbsolutePathSchema,
  grpo_config: GrpoConfigSchema,
  peft_config: PeftConfigSchema,
});

export type TrainerPluginSpec = z.infer<typeof TrainerPluginSpecSchema>;
export type GrpoConfig = z.infer<typeof GrpoConfigSchema>;
export type PeftConfig = z.infer<typeof PeftConfigSchema>;
