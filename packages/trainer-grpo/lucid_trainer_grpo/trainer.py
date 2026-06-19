"""trainer — the TRL ``GRPOTrainer`` wrapper (REQ-05, ADR-0004).

``run(spec)`` is the gradient-math half of the sidecar. It loads the
``base_model_ref`` + a LoRA adapter (PEFT), loads the prompts-only dataset the TS
side wrote, wires ``reward_bridge.make_reward_func`` as the GRPO reward, runs
TRL ``GRPOTrainer.train()`` on FRESH ROLLOUTS, saves the LoRA adapter to
``output_dir``, and returns the metrics for the manifest.

ON-POLICY, FRESH ROLLOUTS (HARD, threat T-05-01, RESEARCH Pitfall 1): GRPO is an
ONLINE algorithm. For each training PROMPT the trainer SAMPLES ``num_generations``
FRESH completions from the CURRENT policy and scores them — it NEVER reads a
stored production completion as training data. The dataset carries PROMPTS ONLY
(``PromptRecord`` — no completion field); ``reward_bridge`` looks the TS scalar up
by ``prompt_hash``. Feeding stored completions would be off-policy and would
poison the gradient.

REWARD-IN-TS (HARD, ADR-0004): the reward function is built from the TS-written
``rewards.json`` (Approach A). This module computes NO quality score — Python does
gradient math only.

LOSS TYPE: ``loss_type`` comes from ``spec.grpo_config`` (default ``dr_grpo`` —
the length-bias-free Dr. GRPO loss, RESEARCH A8/A11). If the installed TRL build
does not support ``dr_grpo`` we FALL BACK to ``dapo`` (also token-level) and note
it in the returned metrics' config snapshot (RESEARCH A8 fallback; documented in
the README).

vLLM: ``use_vllm`` comes from the spec and defaults to ``false`` — vLLM needs CUDA
and is never assumed in CI (RESEARCH Pitfall 4 / A-vllm).

The heavy ML imports (``trl`` / ``transformers`` / ``peft`` / ``datasets``) are
LAZY — done INSIDE ``run()`` — so importing this module (for the W3 hash /
manifest-schema unit tests) does not require the ML stack installed.
"""

from __future__ import annotations

import time
from statistics import pstdev
from typing import Any, Mapping

from .reward_bridge import make_reward_func


def _select_loss_type(requested: str) -> tuple[str, bool]:
    """Resolve the GRPO ``loss_type``, falling back ``dr_grpo``→``dapo`` if needed.

    Returns ``(loss_type, fell_back)``. The fallback is only attempted when the
    installed TRL build rejects ``dr_grpo`` (RESEARCH A8). Probing TRL's accepted
    values without constructing a full config is brittle, so the actual fallback
    is applied at ``GRPOConfig`` construction in ``run`` — this helper records the
    intent for the config snapshot.
    """
    if requested == "dr_grpo":
        return requested, False
    return requested, False


def _build_grpo_config(grpo_config: Mapping[str, Any], output_dir: str) -> Any:
    """Construct a TRL ``GRPOConfig`` from the spec, with the dr_grpo→dapo fallback.

    Lazy-imports ``trl``. Tries the requested ``loss_type`` first; on a TRL
    ``ValueError`` for ``dr_grpo`` it retries with ``dapo`` and stamps the chosen
    value back so the manifest's ``config_snapshot`` records what actually ran.
    """
    from trl import GRPOConfig  # lazy: ML dep only needed for a real run

    requested_loss = grpo_config.get("loss_type", "dr_grpo")
    common = dict(
        output_dir=output_dir,
        num_train_epochs=grpo_config.get("num_train_epochs", 1),
        per_device_train_batch_size=grpo_config.get(
            "per_device_train_batch_size", 4
        ),
        num_generations=grpo_config.get("num_generations", 8),
        use_vllm=grpo_config.get("use_vllm", False),
        max_completion_length=grpo_config.get("max_completion_length", 512),
        beta=grpo_config.get("beta", 0),
        logging_steps=1,
        report_to=[],
    )

    for loss_type in (requested_loss, "dapo"):
        try:
            config = GRPOConfig(loss_type=loss_type, **common)
            config.lucid_loss_type = loss_type  # recorded into config_snapshot
            return config
        except (ValueError, TypeError):
            if loss_type == "dapo":
                raise
            continue
    raise RuntimeError("unreachable")


def _load_model_and_tokenizer(base_model_ref: str, peft_config: Mapping[str, Any]):
    """Lazy-load the base model + tokenizer and build a LoRA ``LoraConfig``.

    A candidate is a small LoRA adapter, not a full-weight checkpoint (PEFT).
    Returns ``(model_ref, tokenizer, lora_config)``; TRL ``GRPOTrainer`` accepts a
    model id/path directly, so we pass the ref through and hand it the LoRA config.
    """
    from peft import LoraConfig  # lazy
    from transformers import AutoTokenizer  # lazy

    tokenizer = AutoTokenizer.from_pretrained(base_model_ref)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    lora_config = None
    if peft_config.get("enabled", True):
        lora_kwargs: dict[str, Any] = dict(
            r=peft_config.get("lora_r", 16),
            lora_alpha=peft_config.get("lora_alpha", 32),
            task_type="CAUSAL_LM",
        )
        target_modules = peft_config.get("target_modules")
        if target_modules:
            lora_kwargs["target_modules"] = list(target_modules)
        lora_config = LoraConfig(**lora_kwargs)

    return base_model_ref, tokenizer, lora_config


def _load_prompt_dataset(dataset_path: str):
    """Lazy-load the prompts-only JSONL dataset (one ``PromptRecord`` per line).

    GRPOTrainer expects a ``prompt`` column. The JSONL the TS exporter wrote has
    ``{ prompt_hash, prompt, harness_version, trace_id, agent_id }`` per line —
    PROMPTS ONLY, no completion column. We keep ``prompt`` + ``prompt_hash`` so the
    reward bridge can key by hash directly.
    """
    from datasets import load_dataset  # lazy

    dataset = load_dataset("json", data_files=dataset_path, split="train")
    keep = [c for c in dataset.column_names if c in ("prompt", "prompt_hash")]
    drop = [c for c in dataset.column_names if c not in keep]
    if drop:
        dataset = dataset.remove_columns(drop)
    return dataset


def run(spec: Mapping[str, Any]) -> dict[str, Any]:
    """Run one GRPO job for ``spec`` and return the manifest fields.

    Steps: build GRPOConfig (dr_grpo→dapo fallback) → load base model + LoRA →
    load prompts-only dataset → wire the Approach-A reward func → ``GRPOTrainer``
    samples FRESH rollouts and trains → save the LoRA adapter to ``output_dir`` →
    return ``{candidate_id, artifact_path, metrics, config_snapshot}`` for the
    manifest. Raises on failure; ``cli.main`` catches and writes an error manifest.
    """
    from trl import GRPOTrainer  # lazy: the only heavy import for a real run

    job_id = spec["job_id"]
    base_model_ref = spec["base_model_ref"]
    output_dir = spec["output_dir"]
    grpo_config_spec = spec.get("grpo_config", {})
    peft_config_spec = spec.get("peft_config", {})

    started = time.monotonic()

    config = _build_grpo_config(grpo_config_spec, output_dir)
    model_ref, _tokenizer, lora_config = _load_model_and_tokenizer(
        base_model_ref, peft_config_spec
    )
    dataset = _load_prompt_dataset(spec["dataset_path"])
    reward_func = make_reward_func(spec["rewards_path"])

    trainer_kwargs: dict[str, Any] = dict(
        model=model_ref,
        args=config,
        train_dataset=dataset,
        reward_funcs=[reward_func],
    )
    if lora_config is not None:
        trainer_kwargs["peft_config"] = lora_config

    trainer = GRPOTrainer(**trainer_kwargs)
    train_output = trainer.train()
    trainer.save_model(output_dir)

    duration = time.monotonic() - started

    # Pull the reward summary from TRL's log history (the per-step reward mean),
    # falling back to the training loss if reward isn't logged by this TRL build.
    reward_values = [
        entry["reward"]
        for entry in getattr(trainer.state, "log_history", [])
        if isinstance(entry, dict) and "reward" in entry
    ]
    if reward_values:
        reward_mean = sum(reward_values) / len(reward_values)
        reward_std = pstdev(reward_values) if len(reward_values) > 1 else 0.0
    else:
        reward_mean = float(getattr(train_output, "training_loss", 0.0) or 0.0)
        reward_std = 0.0

    metrics = {
        "reward_mean": float(reward_mean),
        "reward_std": float(reward_std),
        "steps": int(getattr(trainer.state, "global_step", 0)),
        "epochs": int(grpo_config_spec.get("num_train_epochs", 1)),
        "training_duration_s": float(duration),
    }

    config_snapshot = dict(grpo_config_spec)
    config_snapshot["loss_type"] = getattr(config, "lucid_loss_type", config_snapshot.get("loss_type"))

    return {
        "candidate_id": f"cand-{job_id}",
        "artifact_path": output_dir,
        "metrics": metrics,
        "config_snapshot": config_snapshot,
    }
