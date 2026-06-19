/**
 * `runL2` — the closed L2 weight-level GRPO loop (REQ-05, Phase 5 plan 05-04).
 *
 * This is the orchestrator that wires the four pure-TS halves built in 05-01/02/03
 * (the trainer-plugin contract, the exporter+reward computer, and the promotion
 * gate) into a single end-to-end loop, gated on `autonomy:L2`:
 *
 *   1. exportTrajectories(query, opts)           → prompts-only PromptRecord[]
 *   2. buildRewardDataset(prompts, diags, …)     → { dataset, stats }
 *      ↳ if stats.frac_low_variance: surface a zero-variance WARNING (Pitfall 2)
 *   3. write dataset JSONL + rewards.json + a schema-valid TrainerPluginSpec to disk
 *   4. emit `evolve.train` (low-cardinality name; job_id/base/size in attrs)
 *   5. manifest = await trainerPlugin.train(spec)
 *   6. gateResult = evaluateCandidate(manifest, evaluator, promote_gate, incumbent)
 *   7. gateResult.passed ? promoteCandidate(…) : discardCandidate(…)
 *   8. return a structured L2RunResult
 *
 * FOUR HARD PROPERTIES:
 *
 *   - GATED, NO BYPASS (threat T-05-10): promotion happens EXCLUSIVELY via the
 *     05-03 gate. `promoteCandidate` is called only when `gateResult.passed`; a
 *     below-margin candidate is `discardCandidate`d. There is no flag that promotes
 *     past the gate.
 *
 *   - FAIL CLOSED (threat T-05-10): a training-error manifest gates to
 *     `passed:false` inside `evaluateCandidate` (which short-circuits before the
 *     evaluator) and is discarded. The orchestrator never promotes a failed run.
 *
 *   - IDEMPOTENT BY jobId (RESEARCH "idempotent loop"): the injected
 *     `alreadyPromoted(jobId)` guard (default: never) lets a caller make a re-run
 *     with the same `jobId` a no-op for promotion — a retried loop never
 *     double-promotes the same candidate.
 *
 *   - NO PYTHON IN THE LOOP: `runL2` itself imports no Python and spawns nothing.
 *     The ONLY subprocess is inside `FilesystemTrainerPlugin.train` (a `TrainerPlugin`
 *     impl injected via `deps.trainerPlugin`); with the `MockTrainerPlugin` the whole
 *     loop runs on a CPU CI box with no Python (EC-1/EC-3).
 *
 * This module imports only Node stdlib (`node:fs`, `node:path`) + sibling TS — NO
 * new npm dependency, NO Python.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import type { TraceQuery, DiagnosticResult } from "@lucid/diagnostic";
import { EVENT_TYPES } from "@lucid/hsc-schema";

import {
  exportTrajectories,
  serializeToJsonl,
  type ExportOptions,
} from "./trajectory-exporter.js";
import {
  buildRewardDataset,
  type RewardWeights,
  type RewardCoverageStats,
} from "./reward-computer.js";
import {
  TrainerPluginSpecSchema,
  type TrainerPluginSpec,
} from "./schemas/trainer-plugin-spec.js";
import type { ResultManifest } from "./schemas/result-manifest.js";
import type { TrainerPlugin } from "./trainer-plugin.js";
import type { Evaluator } from "./evaluator.js";
import {
  evaluateCandidate,
  promoteCandidate,
  discardCandidate,
  type GateResult,
  type EmitSink,
} from "./promotion-gate.js";
import { buildCandidateProvenance } from "./candidate-provenance.js";
import type { L2Config } from "./l2-config.js";

/**
 * The `evolve.train` event-type constant resolved from the canonical `EVENT_TYPES`
 * tuple (NOT a bare string literal) — the low-cardinality `event.name`. A rename of
 * the constant fails to compile here, so the name can never drift (mirrors
 * `EVOLVE_PROMOTE_EVENT`).
 */
export const EVOLVE_TRAIN_EVENT: (typeof EVENT_TYPES)[number] =
  EVENT_TYPES[EVENT_TYPES.indexOf("evolve.train")];

/** The `evolve.train` event payload (low-cardinality name; ids/size in attrs). */
export interface EmittedEvolveTrain {
  name: (typeof EVENT_TYPES)[number];
  attrs: {
    job_id: string;
    base_model_ref: string;
    dataset_size: number;
    reward_variance: number;
    low_variance: boolean;
    [k: string]: unknown;
  };
}

/** A sink for the `evolve.train` audit event (capturing array in tests). */
export type TrainEmitSink = (event: EmittedEvolveTrain) => void | Promise<void>;

/**
 * The collaborators `runL2` needs. All side effects are injected so the loop is
 * fully testable with the `MockTrainerPlugin` + a mock evaluator + capturing sinks
 * (no Python, no GPU, no real store).
 */
export interface L2Deps {
  /** The abstract read seam over stored traces (a Phase 1 store, or a test stub). */
  query: TraceQuery;
  /** Pre-computed Phase 2 diagnostics keyed by `prompt_hash` (reward-in-TS). */
  diagnosticsByPromptHash: Map<string, DiagnosticResult>;
  /** The trainer plugin (MockTrainerPlugin in CI, FilesystemTrainerPlugin at L2). */
  trainerPlugin: TrainerPlugin;
  /** The independent held-out evaluator the gate runs (reward-independent metric). */
  evaluator: Evaluator;
  /** The `evolve.promote` audit sink (gate decisions). */
  emit: EmitSink;
  /** The `evolve.train` audit sink (handoff). Optional — a no-op when absent. */
  emitTrain?: TrainEmitSink;
  /** The parsed L2 config (autonomy / trainer / reward / promote_gate). */
  config: L2Config;
  /** The production incumbent's held-out score — the bar the candidate must beat. */
  incumbentScore: number;
  /** Absolute dir the dataset/rewards/spec/manifest are written under. */
  workDir: string;
  /**
   * Idempotency guard: returns true when this `jobId` has already been promoted,
   * so a re-run does not double-promote. Default: always false (no prior run).
   */
  alreadyPromoted?: (jobId: string) => boolean | Promise<boolean>;
}

/** The structured result of one `runL2` invocation. */
export interface L2RunResult {
  /** The training job id (the loop is idempotent by this). */
  jobId: string;
  /** The candidate produced by the trainer (from the manifest). */
  candidate_id: string;
  /** The trainer-output manifest (read-only). */
  manifest: ResultManifest;
  /** The gate's verdict — the only authority on promotion. */
  gateResult: GateResult;
  /** True iff the candidate was promoted (gate passed AND not already promoted). */
  promoted: boolean;
  /** The reward dataset coverage stats (carries the zero-variance advisory). */
  datasetStats: RewardCoverageStats;
  /** Set when a zero-variance reward set was detected before handoff (Pitfall 2). */
  warning?: string;
}

/** Options for one loop run: the export cohort selector + the required job id. */
export type L2RunOptions = ExportOptions & { jobId: string };

/**
 * Run the closed L2 loop. See the module header for the eight steps and the four
 * hard properties. Never promotes when the gate fails; idempotent by `jobId`.
 *
 * @throws never for an ordinary training failure (a failed manifest is discarded);
 *   only a programmer error (e.g. a missing holdout the evaluator config points at)
 *   propagates as a thrown error.
 */
export async function runL2(deps: L2Deps, opts: L2RunOptions): Promise<L2RunResult> {
  const { jobId } = opts;
  const weights = (deps.config.reward.weights ?? {}) as RewardWeights;

  // (1) Export prompts-only trajectories (ON-POLICY — never a stored completion).
  const prompts = await exportTrajectories(deps.query, opts);

  // (2) Build the reward dataset (reward-in-TS) + coverage stats.
  const { dataset, stats } = buildRewardDataset(
    prompts,
    deps.diagnosticsByPromptHash,
    weights,
    jobId,
  );

  // (2a) Zero-variance advisory (Pitfall 2): the GRPO advantage degenerates to ~0
  // when every baseline reward is identical. Surface a WARNING before handoff —
  // advisory, never silent data loss; the dataset is still handed off.
  let warning: string | undefined;
  if (stats.frac_low_variance) {
    warning =
      `zero-variance reward dataset for job ${jobId}: ` +
      `${stats.included} entries with variance ${stats.reward_variance} < threshold — ` +
      `GRPO advantage will be ~0 (Pitfall 2)`;
  }

  // (3) Write the dataset JSONL + rewards.json + the TrainerPluginSpec to disk.
  mkdirSync(deps.workDir, { recursive: true });
  const datasetPath = path.join(deps.workDir, `${jobId}-dataset.jsonl`);
  const rewardsPath = path.join(deps.workDir, `${jobId}-rewards.json`);
  const outputDir = path.join(deps.workDir, jobId);
  mkdirSync(outputDir, { recursive: true });

  // The dataset JSONL is prompts-only (PromptRecord[]); the rewards.json carries the
  // scalar baseline rewards by prompt_hash for the Python reward_bridge (Approach A).
  writeFileSync(datasetPath, serializeToJsonl(prompts), "utf8");
  writeFileSync(rewardsPath, JSON.stringify(dataset, null, 2), "utf8");

  const baseModelRef = deps.config.trainer?.base_model ?? "unknown-base-model";
  const spec: TrainerPluginSpec = TrainerPluginSpecSchema.parse({
    job_id: jobId,
    dataset_path: datasetPath,
    rewards_path: rewardsPath,
    base_model_ref: baseModelRef,
    output_dir: outputDir,
    grpo_config: {},
    peft_config: {},
  });

  // (4) Emit the handoff audit event (low-cardinality name; ids/size in attrs).
  if (deps.emitTrain) {
    await deps.emitTrain({
      name: EVOLVE_TRAIN_EVENT,
      attrs: {
        job_id: jobId,
        base_model_ref: baseModelRef,
        dataset_size: dataset.entries.length,
        reward_variance: stats.reward_variance,
        low_variance: stats.frac_low_variance,
      },
    });
  }

  // (5) Hand the spec to the trainer plugin (Mock in CI; the lazy sidecar at L2).
  const manifest = await deps.trainerPlugin.train(spec);

  // (6) The independent held-out gate — the ONLY promotion authority. A failed /
  // error manifest fails closed inside evaluateCandidate (before the evaluator).
  const gateResult = await evaluateCandidate(
    manifest,
    deps.evaluator,
    deps.config.promote_gate,
    deps.incumbentScore,
  );

  // (7) Promote XOR discard. Idempotency: a jobId already promoted is not re-promoted.
  const provenance = buildCandidateProvenance(
    manifest,
    weights as Record<string, number | undefined>,
    deps.config.promote_gate.eval,
    gateResult,
    deps.config.promote_gate.min_improvement,
  );

  const alreadyDone = deps.alreadyPromoted ? await deps.alreadyPromoted(jobId) : false;

  let promoted = false;
  if (gateResult.passed && !alreadyDone) {
    await promoteCandidate(manifest, gateResult, provenance, deps.emit);
    promoted = true;
  } else {
    // A below-margin / failed candidate (or an already-promoted re-run) is discarded
    // — every decision is audited via the evolve.promote sink (no silent drop).
    await discardCandidate(manifest, gateResult, provenance, deps.emit);
    promoted = false;
  }

  return {
    jobId,
    candidate_id: manifest.candidate_id,
    manifest,
    gateResult,
    promoted,
    datasetStats: stats,
    ...(warning !== undefined ? { warning } : {}),
  };
}
