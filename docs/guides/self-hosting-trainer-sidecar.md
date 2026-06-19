# Self-Hosting the Trainer Sidecar (L2)

> **L2 is optional and skippable.** The Lucid core (`@lucid/evolution`,
> `@lucid/collector`) imports and runs with **zero Python installed**. You only need
> this sidecar if you self-host an open-weight model and opt into `autonomy: L2`. If
> you don't, skip this entire guide — you never run an L2 command and never install
> Python.

This guide covers running the **reference GRPO trainer sidecar**
([`packages/trainer-grpo`](../../packages/trainer-grpo/README.md)) that backs the
`lucid evolve train` command at L2. For the L2 *config and CLI*, see
[Configuring Self-Evolution → L2](./configuring-self-evolution.md#l2--weight-level-grpo-for-self-hosted-models-only).

## The boundary in one picture

```
  @lucid/evolution (TypeScript)                 packages/trainer-grpo (Python, optional)
  ─────────────────────────────                 ─────────────────────────────────────────
  export trajectories                            read   job-spec.json   (TrainerPluginSpec)
  compute reward IN TS  ──────── writes ───────▶ read   dataset.jsonl   (prompts only)
  write job to disk                              read   rewards.json    (scalar by prompt_hash)
                                                 run    TRL GRPOTrainer (fresh on-policy rollouts)
  read result manifest  ◀─────── writes ──────── write  result_manifest.json (ResultManifest)
  promotion gate decides
```

Two halves, one filesystem handoff. **Neither side imports the other.** TypeScript
writes a job; Python writes a manifest. This is the coarse job boundary of
[ADR-0004](../03-decisions/ADR-0004-grpo-trainerplugin-boundary.md).

## Two hard rules the sidecar honors

- **The reward is computed in TypeScript.** Python only *looks up* the pre-computed
  scalar reward by `prompt_hash` (Approach A). It never re-derives a principle or
  quality score — Python does gradient math only.
- **Training is on-policy.** GRPO samples **fresh completions from the current
  policy** for each prompt and scores them. Your stored production completions are
  *never* used as training data — the dataset carries prompts only.

## Prerequisites

| For… | You need |
|---|---|
| The CPU smoke test (EC-2) | Python ≥ 3.10. **No GPU, no vLLM.** |
| A real GRPO training run | Python ≥ 3.10 **and a CUDA GPU**; an open-weight base model. |
| vLLM-accelerated rollouts | CUDA + `pip install lucid-trainer-grpo[vllm]` (optional). |

## Install

```bash
cd packages/trainer-grpo
pip install -e .            # trl, peft, accelerate, transformers, datasets
pip install -e ".[vllm]"    # + optional vLLM accelerator (requires CUDA)
pip install -e ".[dev]"     # + pytest
```

These pip dependencies are the **official HuggingFace training libraries** and live
**solely** in this package's `pyproject.toml` — they are in no `package.json` and are
never pulled by an `npm`/`pnpm` install.

## Point Lucid at it

In your `evolution.trainer` config, set `plugin: grpo-python` and `base_model` to your
model. The TS `FilesystemTrainerPlugin` invokes the sidecar as:

```bash
python -m lucid_trainer_grpo.cli --spec <output_dir>/job-spec.json
```

with the args passed as a **list** (never `shell: true`) and every path **absolute** —
the command-injection / traversal surface is closed at the boundary. The sidecar
re-validates the spec (absolute paths, `num_generations ≥ 2`) on read.

## Verify it works (CPU smoke — EC-2)

```bash
cd packages/trainer-grpo
pytest                  # W3 hash + manifest + spec-validation — pure stdlib, no ML deps
pytest -k test_smoke    # a real tiny-CPU-model GRPO step (~60s on CPU)
```

`test_smoke` runs an actual GRPO step on a 2-layer test model
(`hf-internal-testing/tiny-random-LlamaForCausalLM`, `use_vllm=False`,
`num_generations=2`, `max_completion_length=32`) and asserts a `result_manifest.json`
with `metrics.reward_mean` is produced. It **skips with an explicit reason** if the ML
stack or the tiny model is unavailable offline.

## Fails closed

Every failure path — a missing or invalid spec, or any training exception — writes a
`result_manifest.json` with `error` set and `metrics` omitted. The TS promotion gate
reads that and **discards** the candidate. The boundary never silently succeeds, and
no failed candidate is ever promoted.

## Loss type and backends

The default loss is **`dr_grpo`** (Dr. GRPO, length-bias-free). If your installed TRL
build doesn't support it, the sidecar **falls back to `dapo`** and records which loss
actually ran in the manifest's `config_snapshot`.

A faster backend, Unsloth, exists but is **not a dependency** — it needs its own
package-legitimacy check before adoption. The `TrainerPlugin` boundary is swappable,
so you can substitute your own trainer (any process that reads a `TrainerPluginSpec`
and writes a `ResultManifest`) without touching the TS core.

## The real GPU run is yours to operate

A genuine GRPO training run on a real model needs your own GPU and your own base
weights — it is a **manual, self-hosted** operation (Lucid's CI exercises only the
CPU smoke path). The held-out evaluation that gates promotion runs against the
`promote_gate.eval` set you configure.
