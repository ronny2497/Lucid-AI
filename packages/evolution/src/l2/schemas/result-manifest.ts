/**
 * `ResultManifest` — the Python→TS trainer-output contract (REQ-05, Phase 5 L2).
 *
 * The trainer plugin writes this manifest; the TS gate (05-03) reads it. It
 * carries the metrics the gate needs to decide promotion plus enough provenance
 * (job_id, candidate_id, artifact_path, base_model_ref, config_snapshot) to make
 * the run auditable.
 *
 * Two design properties:
 *   - FAILED RUN REPRESENTABLE (threat T-05-05): `metrics` is OPTIONAL and a
 *     free-form `error` string is available, so a manifest describing a failed or
 *     aborted training run still validates. The gate reads `error`/missing metrics
 *     and discards — a failure is never silently treated as success.
 *   - NO AUTO-PROMOTE (GATED-PROMOTION): there is intentionally NO `promoted`/
 *     `status` field. Promotion is the gate's verdict (05-03/05-04), never a value
 *     the trainer can set on itself.
 *
 * NO-PYTHON-CORE-DEP: this module imports only `zod`.
 */

import { z } from "zod";

/**
 * Training metrics. `reward_mean`/`reward_std` summarize the reward distribution
 * over the run; `steps`/`epochs` are the work done. `frac_reward_zero_std` (the
 * fraction of GRPO groups with zero reward variance — the wasted-gradient signal,
 * RESEARCH Pitfall 2) and `training_duration_s` are optional diagnostics.
 */
export const MetricsSchema = z.object({
  reward_mean: z.number(),
  reward_std: z.number(),
  steps: z.number().int().nonnegative(),
  epochs: z.number().int().nonnegative(),
  frac_reward_zero_std: z.number().min(0).max(1).optional(),
  training_duration_s: z.number().optional(),
});
export type Metrics = z.infer<typeof MetricsSchema>;

/**
 * The trainer-output manifest. `metrics` is optional so an error-only failed-run
 * manifest validates; `principle_deltas` (predicted-vs-observed per-principle
 * movement) is optional. No field marks the candidate as promoted.
 */
export const ResultManifestSchema = z.object({
  job_id: z.string().min(1),
  candidate_id: z.string().min(1),
  artifact_path: z.string(),
  base_model_ref: z.string().min(1),
  metrics: MetricsSchema.optional(),
  principle_deltas: z.record(z.string(), z.number()).optional(),
  config_snapshot: z.record(z.string(), z.unknown()),
  /** ISO 8601 timestamp. */
  completed_at: z.string().min(1),
  /** Set (with metrics omitted) when training failed — the run stays auditable. */
  error: z.string().optional(),
});

export type ResultManifest = z.infer<typeof ResultManifestSchema>;
