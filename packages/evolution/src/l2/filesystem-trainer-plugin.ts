/**
 * `FilesystemTrainerPlugin` — the ONLY place a Python subprocess is spawned in
 * `@lucid/evolution` (REQ-05, Phase 5 plan 05-04).
 *
 * This is the real `TrainerPlugin`: it bridges the TS core to the optional Python
 * GRPO sidecar (`packages/trainer-grpo`) over the coarse FILESYSTEM JOB BOUNDARY
 * (ADR-0004). The contract:
 *
 *   1. TS writes the `TrainerPluginSpec` to `<output_dir>/job-spec.json` and
 *      asserts the dataset/rewards files the spec references already exist on disk.
 *   2. TS spawns the configured sidecar command, passing `["--spec", <jobSpecPath>]`
 *      appended to the configured `args`. The sidecar reads the spec, runs GRPO,
 *      and writes `<output_dir>/result_manifest.json`.
 *   3. TS POLLS for `<output_dir>/result_manifest.json` with exponential backoff up
 *      to `timeoutMs`, then reads it and validates it against `ResultManifestSchema`.
 *
 * LAZY SPAWN (HARD, threat T-05-02): `child_process.spawn` is called INSIDE `train()`
 * — never at module load. Importing this module (or `@lucid/evolution`) pulls in no
 * Python and spawns nothing; an L0/L1 user never reaches this code. The spawn is
 * reached ONLY when the L2 orchestrator (gated on `autonomy:L2`) calls `train()`.
 *
 * SAFE SPAWN (HARD, threat T-05-03): the subprocess is spawned with the args as a
 * LIST and `shell` left to its default (never `shell: true`), so there is no shell
 * interpolation / command-injection surface. Every path in the spec is asserted
 * ABSOLUTE before the spawn (the spec schema already enforces absoluteness; this is
 * a defense-in-depth re-assert at the boundary).
 *
 * FAIL CLOSED (threat T-05-10): a spawn error, a non-zero exit before a manifest is
 * written, or a poll timeout yields a ResultManifest with `error` set (and `metrics`
 * omitted) rather than a thrown promise — so the 05-03 gate sees a failed run and
 * DISCARDS it. The trainer can never "succeed silently" past a crash.
 *
 * This module imports only Node stdlib (`node:child_process`, `node:fs`,
 * `node:path`) + the TS schemas — NO new npm dependency, NO Python in the import
 * graph.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import {
  ResultManifestSchema,
  type ResultManifest,
} from "./schemas/result-manifest.js";
import type { TrainerPluginSpec } from "./schemas/trainer-plugin-spec.js";
import type { TrainerPlugin } from "./trainer-plugin.js";

/** Construction options for {@link FilesystemTrainerPlugin}. */
export interface FilesystemTrainerPluginOptions {
  /** The sidecar executable (e.g. `"python"` or `"lucid-trainer-grpo"`). */
  command: string;
  /** Leading args (e.g. `["-m", "lucid_trainer_grpo.cli"]`); `--spec <path>` is appended. */
  args: string[];
  /** Overall poll deadline in ms (default 30 minutes). */
  timeoutMs?: number;
  /** Initial poll interval in ms; doubles each miss up to a cap (default 500ms). */
  pollMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_POLL_MS = 500;
const MAX_POLL_MS = 10_000;

/** The manifest file the sidecar is contracted to write into `output_dir`. */
const RESULT_MANIFEST_FILE = "result_manifest.json";
/** The job-spec file TS writes into `output_dir` for the sidecar to read. */
const JOB_SPEC_FILE = "job-spec.json";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class FilesystemTrainerPlugin implements TrainerPlugin {
  private readonly command: string;
  private readonly args: string[];
  private readonly timeoutMs: number;
  private readonly pollMs: number;

  constructor(opts: FilesystemTrainerPluginOptions) {
    this.command = opts.command;
    this.args = [...opts.args];
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  }

  /**
   * Run a GRPO job for `spec` via the Python sidecar and resolve to its
   * `ResultManifest`. The subprocess spawn happens HERE (lazy) — never at import.
   * On any failure (spawn error, non-zero exit before a manifest, timeout) it
   * resolves to a fail-closed error-manifest the gate will discard.
   */
  async train(spec: TrainerPluginSpec): Promise<ResultManifest> {
    // Defense-in-depth: re-assert absoluteness of every path before spawning.
    for (const [name, p] of [
      ["output_dir", spec.output_dir],
      ["dataset_path", spec.dataset_path],
      ["rewards_path", spec.rewards_path],
    ] as const) {
      if (!path.isAbsolute(p)) {
        return this.errorManifest(spec, `spec.${name} must be absolute before spawn: ${p}`);
      }
    }

    // The sidecar dereferences the dataset/rewards by path; assert they exist so a
    // missing handoff file fails closed here rather than as an opaque sidecar crash.
    if (!existsSync(spec.dataset_path)) {
      return this.errorManifest(spec, `dataset file not found: ${spec.dataset_path}`);
    }
    if (!existsSync(spec.rewards_path)) {
      return this.errorManifest(spec, `rewards file not found: ${spec.rewards_path}`);
    }

    mkdirSync(spec.output_dir, { recursive: true });
    const jobSpecPath = path.join(spec.output_dir, JOB_SPEC_FILE);
    const manifestPath = path.join(spec.output_dir, RESULT_MANIFEST_FILE);
    writeFileSync(jobSpecPath, JSON.stringify(spec, null, 2), "utf8");

    // LAZY, SAFE SPAWN: args as a list, never shell:true. The child writes the
    // manifest to disk; we poll for it below (the coarse async boundary, ADR-0004).
    let spawnError: string | null = null;
    let exited = false;
    let exitCode: number | null = null;
    const child = spawn(this.command, [...this.args, "--spec", jobSpecPath], {
      stdio: "ignore",
      // `shell` is intentionally left default (false) — no shell interpolation.
    });
    child.on("error", (err) => {
      spawnError = err instanceof Error ? err.message : String(err);
    });
    child.on("exit", (code) => {
      exited = true;
      exitCode = code;
    });

    // Poll for the manifest with exponential backoff up to the deadline.
    const deadline = Date.now() + this.timeoutMs;
    let interval = this.pollMs;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (spawnError !== null) {
        try {
          child.kill();
        } catch {
          /* child may already be gone */
        }
        return this.errorManifest(spec, `sidecar spawn failed: ${spawnError}`);
      }
      if (existsSync(manifestPath)) {
        break;
      }
      if (exited && !existsSync(manifestPath)) {
        return this.errorManifest(
          spec,
          `sidecar exited (code ${exitCode}) without writing ${RESULT_MANIFEST_FILE}`,
        );
      }
      if (Date.now() >= deadline) {
        try {
          child.kill();
        } catch {
          /* best effort */
        }
        return this.errorManifest(
          spec,
          `timed out after ${this.timeoutMs}ms waiting for ${RESULT_MANIFEST_FILE}`,
        );
      }
      await sleep(interval);
      interval = Math.min(interval * 2, MAX_POLL_MS);
    }

    // Read + validate the manifest. A malformed manifest also fails closed.
    try {
      const raw = readFileSync(manifestPath, "utf8");
      return ResultManifestSchema.parse(JSON.parse(raw));
    } catch (cause) {
      return this.errorManifest(
        spec,
        `invalid ${RESULT_MANIFEST_FILE}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }

  /** Build a schema-valid fail-closed manifest (metrics omitted, error set). */
  private errorManifest(spec: TrainerPluginSpec, error: string): ResultManifest {
    return ResultManifestSchema.parse({
      job_id: spec.job_id,
      candidate_id: `failed-${spec.job_id}`,
      artifact_path: spec.output_dir,
      base_model_ref: spec.base_model_ref,
      config_snapshot: { ...spec.grpo_config },
      completed_at: new Date().toISOString(),
      error,
    });
  }
}
