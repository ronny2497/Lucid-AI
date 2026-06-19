# lucid-trainer-grpo

The **reference weight-level GRPO trainer sidecar** for Lucid's L2 self-evolution
tier (REQ-05, Phase 5). It wraps HuggingFace [TRL](https://github.com/huggingface/trl)
`GRPOTrainer` behind the coarse **filesystem job boundary** described in
[ADR-0004](../../docs/03-decisions/ADR-0004-grpo-trainerplugin-boundary.md).

> **The Lucid core never needs Python.** This is a **separate, optional** package.
> It has **no `package.json`** and is **not** pulled by any `npm install` /
> `pnpm install`. `@lucid/evolution` and `@lucid/collector` import with zero Python
> installed. You only ever install this sidecar if you self-host an open-weight
> model and opt into `autonomy: L2`. An L0/L1 user is never forced into Python.

## What it does

The TypeScript core does everything except the gradient math:

1. `@lucid/evolution` exports prompts from collected traces, computes a **scalar
   reward per prompt in TypeScript** from the Phase 2 `DiagnosticResult`, and writes
   a job to disk: a `job-spec.json` (`TrainerPluginSpec`), a prompts-only
   `dataset.jsonl`, and a `rewards.json` (`RewardDataset`).
2. This sidecar reads that spec, runs GRPO on **fresh on-policy rollouts**, and writes
   `<output_dir>/result_manifest.json` (`ResultManifest`).
3. The TS **promotion gate** reads the manifest and decides promotion. The sidecar
   never promotes anything — there is no `promoted`/`status` field in the manifest.

### Two hard boundaries

- **On-policy, prompts only** (`trainer.py`): GRPO is an *online* algorithm. For each
  prompt the trainer **samples fresh completions from the current policy** and scores
  them. Stored production completions are *never* used as training data — the dataset
  carries prompts only.
- **Reward in TS** (`reward_bridge.py`): the reward function only **looks up the
  pre-computed TS scalar by `prompt_hash`** (Approach A). It imports no Lucid
  diagnostic logic and **never re-derives a quality score in Python**. Python does
  gradient math only.

The `prompt_hash` is the **W3 cross-language contract** — constructed identically in
TS and Python: `"sha256:" + sha256(utf8(prompt)).hexdigest()`. A shared fixture
(`packages/evolution/tests/l2/fixtures/w3-prompt-hash.json`) pins one prompt→hash
pair; `tests/test_trainer.py` asserts this package reproduces it, so any divergence
fails loudly.

## Install

```bash
# from packages/trainer-grpo/
pip install -e .            # the HuggingFace training stack (trl/peft/accelerate/transformers/datasets)
pip install -e ".[vllm]"    # + optional vLLM accelerator (requires CUDA)
pip install -e ".[dev]"     # + pytest for the smoke test
```

**Prerequisites for a real run:** Python ≥ 3.10 **and a CUDA GPU** for a genuine
GRPO training job. The CPU tiny-model smoke test below needs **neither a GPU nor
vLLM**.

## Run

The TS `FilesystemTrainerPlugin` invokes this for you at `autonomy: L2`; you do not
normally run it by hand. The contract:

```bash
python -m lucid_trainer_grpo.cli --spec /abs/path/to/job-spec.json
# or, via the console script:
lucid-trainer-grpo --spec /abs/path/to/job-spec.json
```

It reads + validates the spec (absolute paths; `num_generations ≥ 2`), runs the
trainer, and writes `<output_dir>/result_manifest.json`. **It fails closed:** any
error (missing/invalid spec, training exception) writes a manifest with `error` set
and `metrics` omitted, so the gate discards the run — the boundary never silently
succeeds.

## Test (CPU smoke — EC-2)

```bash
pytest                       # W3 hash + manifest + spec-validation (pure stdlib; no ML deps)
pytest -k test_smoke         # the real tiny-CPU-model GRPO step (EC-2)
```

`test_smoke` runs a real GRPO step on a 2-layer test model
(`hf-internal-testing/tiny-random-LlamaForCausalLM`, `use_vllm=False`,
`num_generations=2`, `max_completion_length=32`, 1 epoch) in ~60s on CPU and asserts
a `result_manifest.json` with `metrics.reward_mean`. It **skips with an explicit
reason** when the ML stack or the tiny model is unavailable offline. The W3-hash,
manifest round-trip, and fail-closed spec-validation tests run **everywhere** with no
ML deps. The **real GPU GRPO run + held-out eval is Manual-Only**.

## Loss type: `dr_grpo` (with a `dapo` fallback)

The default `loss_type` is **`dr_grpo`** (Dr. GRPO — the length-bias-free loss
recommended as of 2026). If the installed TRL build does not accept `dr_grpo`,
`trainer.py` **falls back to `dapo`** (also token-level) and records the loss type
actually used in the manifest's `config_snapshot`.

## Alternative backends

A faster LoRA training backend, [Unsloth](https://github.com/unslothai/unsloth),
exists. It is **deliberately not a dependency** of this package: its legitimacy was
flagged *SUS* in the Phase 5 research audit and it requires its **own
package-legitimacy verification** before adoption. If you choose to swap it in, do
that verification first — the `TrainerPlugin` boundary is swappable by design.

## Why a sidecar (not a TS dependency)

GRPO needs the full PyTorch / TRL training stack, which is Python-only and
GPU-heavy. Forcing that onto every Lucid user would violate the pure-TS core
([ADR-0002](../../docs/03-decisions/ADR-0002-typescript-primary-language.md)). The
filesystem job boundary keeps the language split clean: TS writes a job, Python
writes a manifest, and neither imports the other.
