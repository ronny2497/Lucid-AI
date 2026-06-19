/**
 * `Evaluator` — the pluggable held-out eval seam for the L2 promotion gate
 * (REQ-05, Phase 5 L2, plan 05-03).
 *
 * The promotion gate (`promotion-gate.ts`) decides whether a freshly-trained
 * candidate beats the production incumbent. It MUST decide on a metric the
 * trainer did NOT directly optimize — otherwise the gate cannot catch reward
 * hacking. This module is the seam that makes that mitigation structural.
 *
 * PLUGGABLE (RESEARCH Open Question 2): `Evaluator` is an interface, not a
 * hardcoded eval loop. A team can supply a custom held-out evaluator (a domain
 * benchmark, an LLM-judge, a regression suite). The gate depends on the
 * INTERFACE, never on a concrete implementation, so the metric is the operator's
 * choice. The default `SuccessEvaluator` is a task-success-rate checker.
 *
 * INDEPENDENT METRIC (RESEARCH Pitfall 5 — reward-hacking mitigation): the
 * default `SuccessEvaluator` computes a task-SUCCESS rate over a held-out set; it
 * is NOT a re-computation of the principle/reward score the GRPO trainer
 * maximized. The reward function and the gate metric are intentionally different
 * things, so a model that gamed the reward still has to clear an independent bar.
 *
 * OPAQUE ARTIFACT (RESEARCH Pitfall 6 — NO-PYTHON-CORE-DEP): the evaluator treats
 * `artifactPath` as an OPAQUE string. It pulls in no ML framework (no torch / no
 * peft), starts no Python child process, and does NOT load or merge LoRA weights in TS.
 * Running the candidate against the holdout (loading weights, generating
 * completions) is the eval-runner's / sidecar's job behind the language boundary;
 * the TS core receives the comparison verdict through the injected `scorer`. This
 * keeps the gate pure-TS and the L2 boundary (ADR-0004) intact.
 *
 * NO RAW CONTENT crosses out of this module into the audit trail — the evaluator
 * returns a scalar score only; the holdout prompt/expected text never reaches the
 * `evolve.promote` event (that discipline is enforced in `candidate-provenance.ts`).
 *
 * This module imports only `node:fs` (stdlib) — no new npm dependency.
 */

import { readFileSync } from "node:fs";

/**
 * A single held-out eval input: a prompt plus the expected output the candidate
 * is scored against. This is EVAL input data (the inputs the gate measures
 * against) — it is NOT training data and is never fed to the trainer. Extra keys
 * are permitted so an operator can carry domain metadata, but the gate reads only
 * `prompt`/`expected_output`.
 */
export interface HoldoutEntry {
  prompt: string;
  expected_output: string;
  [k: string]: unknown;
}

/**
 * The pluggable held-out evaluator the gate depends on. An implementation runs
 * the candidate (identified by the opaque `artifactPath`) against the `holdout`
 * under the named `metric` and returns a scalar score (higher is better; the
 * default `SuccessEvaluator` returns a success rate in [0, 1]).
 *
 * The interface is the seam: a custom held-out evaluator (independent of the
 * training reward) can be supplied wholesale, and the gate never inspects the
 * artifact itself.
 */
export interface Evaluator {
  /**
   * @param artifactPath OPAQUE path to the candidate artifact — never loaded or
   *   merged in TS; passed through to the injected scorer / sidecar.
   * @param holdout the held-out eval inputs.
   * @param metric the operator-chosen metric name (independent of the reward).
   * @returns a scalar score; higher is better.
   */
  evaluate(artifactPath: string, holdout: HoldoutEntry[], metric: string): Promise<number>;
}

/**
 * Per-entry scorer the {@link SuccessEvaluator} delegates to. Given the opaque
 * candidate `artifactPath` and one holdout `entry`, it returns whether the
 * candidate's output for that entry counts as a success. The real predict-and-
 * compare (generate a completion from the artifact, compare to `expected_output`)
 * lives behind this seam — typically the sidecar / eval-runner across the Python
 * boundary, or a pre-scored sidecar output read by a closure. The default scorer
 * (below) returns `false`, forcing the operator to supply a real one.
 */
export type EntryScorer = (
  artifactPath: string,
  entry: HoldoutEntry,
) => Promise<boolean> | boolean;

/**
 * The default conservative scorer: it counts NOTHING as a success. It exists so
 * that an operator who forgets to supply a real scorer gets a 0.0 score (which
 * fails the gate, fail-closed) rather than a silently-passing stub. The real
 * predict-and-compare scorer is supplied by the operator / sidecar.
 */
export const noopScorer: EntryScorer = () => false;

/**
 * The default, independent-metric evaluator: a task-SUCCESS-rate checker over the
 * holdout. It scores via an injected {@link EntryScorer} and returns the fraction
 * of holdout entries the scorer marks as a success.
 *
 * It is NOT a principle/reward re-score — it is deliberately a different metric
 * from whatever the trainer optimized (Pitfall 5). It treats `artifactPath` as
 * opaque and loads no weights (Pitfall 6); the injected scorer owns any real
 * predict-and-compare.
 */
export class SuccessEvaluator implements Evaluator {
  private readonly scorer: EntryScorer;

  /**
   * @param scorer the per-entry predict-and-compare; defaults to {@link noopScorer}
   *   (which scores everything as a failure), documented as "the operator/sidecar
   *   supplies the real predict-and-compare scorer".
   */
  constructor(scorer: EntryScorer = noopScorer) {
    this.scorer = scorer;
  }

  /**
   * Runs the injected scorer over every holdout entry and returns the success
   * rate (passes / total). An empty holdout returns 0 (no evidence of success →
   * fail-closed when the gate compares against the margin).
   *
   * The `_metric` name is accepted for interface conformance; the default
   * implementation's metric IS "task success rate". A custom `Evaluator` is the
   * place to branch on `metric`.
   */
  async evaluate(
    artifactPath: string,
    holdout: HoldoutEntry[],
    _metric: string,
  ): Promise<number> {
    if (holdout.length === 0) return 0;
    let passes = 0;
    for (const entry of holdout) {
      if (await this.scorer(artifactPath, entry)) passes += 1;
    }
    return passes / holdout.length;
  }
}

/**
 * Load a held-out eval set from a JSONL file (one JSON object per line). Blank
 * lines are skipped. A missing file throws a clear error (the gate treats a
 * missing/unreadable holdout as a fail-closed condition — see the gate). An empty
 * file returns `[]`.
 *
 * @param path filesystem path to the `.jsonl` holdout fixture.
 * @throws if the file cannot be read, with a message naming the path.
 */
export function loadHoldout(path: string): HoldoutEntry[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (cause) {
    throw new Error(
      `loadHoldout: cannot read holdout eval file at "${path}" — the promotion gate fails closed without a holdout`,
      { cause },
    );
  }
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, i) => {
      try {
        return JSON.parse(line) as HoldoutEntry;
      } catch (cause) {
        throw new Error(`loadHoldout: invalid JSON on line ${i + 1} of "${path}"`, { cause });
      }
    });
}
