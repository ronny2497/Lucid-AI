/**
 * `TrainerPlugin` — the language-agnostic weight-level training seam (ADR-0004).
 *
 * This is the ONLY thing the L2 orchestrator (05-04) depends on. TypeScript hands
 * a `TrainerPluginSpec` (a job-spec written to disk) and receives a
 * `ResultManifest` (read back from disk). Implementations may:
 *   - write the spec to disk and poll for a result manifest produced by an
 *     out-of-process Python sidecar (the real trainer, 05-04, invoked only behind
 *     a lazy factory at `autonomy:L2`), or
 *   - compute a manifest synthetically with no training at all (the
 *     `MockTrainerPlugin` CI path).
 *
 * The orchestrator never knows which. ADR-0004's boundary is exactly this: TS
 * owns the reward computation and the gate; Python (when present) does gradient
 * math only and never re-derives quality.
 *
 * NO-PYTHON-CORE-DEP (ADR-0002/0004): this interface imports nothing beyond the
 * two TS schema types — no Python, no `child_process`, no subprocess. The pure-TS
 * import graph stays clean for every L0/L1 user (threat T-05-02).
 */

import type { TrainerPluginSpec } from "./schemas/trainer-plugin-spec.js";
import type { ResultManifest } from "./schemas/result-manifest.js";

export interface TrainerPlugin {
  /**
   * Run (or simulate) a weight-level training job for `spec` and resolve to the
   * trainer's `ResultManifest`. Implementations MUST return a schema-valid
   * manifest; a failed run is represented by a manifest with `error` set and
   * `metrics` omitted (never a rejected promise for an ordinary training failure).
   */
  train(spec: TrainerPluginSpec): Promise<ResultManifest>;
}
