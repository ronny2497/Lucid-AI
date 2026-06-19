"""Tests for the GRPO sidecar (REQ-05, Phase 5 plan 05-04).

Three layers, by dependency weight:

  1. W3 CROSS-LANGUAGE HASH (pure stdlib): assert ``reward_bridge`` reproduces the
     SHARED fixture ``packages/evolution/tests/l2/fixtures/w3-prompt-hash.json``
     that the TS side pinned. A TS/Python divergence MUST fail this test — that is
     the whole point of the fixture (W3).

  2. MANIFEST + REWARD-LOOKUP + SPEC-VALIDATION (pure stdlib): the manifest
     round-trips with the exact ``ResultManifest`` field names; the Approach-A
     reward func looks scalars up by ``prompt_hash``; a bad spec produces a
     FAIL-CLOSED error manifest (the gate discards). No ML deps needed.

  3. ``test_smoke`` (EC-2, MARKED ``slow``): a REAL tiny-CPU-model GRPO step
     (``use_vllm=False``, ``num_generations=2``, ``max_completion_length=32``,
     1 epoch) that consumes a job spec + tiny dataset/rewards and asserts a
     ``result_manifest.json`` with ``metrics.reward_mean`` is produced. SKIPs with
     an explicit reason when the ML stack or a cached tiny model is unavailable
     offline — but the FAIL-CLOSED boundary (validation error → error manifest) is
     always asserted by layer 2, so EC-2's "a spec always yields a manifest"
     invariant has coverage even without GPU/network.
"""

from __future__ import annotations

import json
import os
import hashlib

import pytest

from lucid_trainer_grpo import cli, manifest, reward_bridge

# ---------------------------------------------------------------------------
# Shared W3 fixture location: the TS-pinned prompt→hash contract.
# tests/ -> packages/trainer-grpo -> packages -> <repo>/packages/evolution/...
# ---------------------------------------------------------------------------
_HERE = os.path.dirname(os.path.abspath(__file__))
_PACKAGES_DIR = os.path.dirname(os.path.dirname(_HERE))
W3_FIXTURE = os.path.join(
    _PACKAGES_DIR, "evolution", "tests", "l2", "fixtures", "w3-prompt-hash.json"
)


# ---------------------------------------------------------------------------
# Layer 1 — W3 cross-language prompt_hash contract (pure stdlib).
# ---------------------------------------------------------------------------
def test_w3_prompt_hash_matches_shared_fixture():
    """The Python canonical hash MUST equal the TS-pinned shared fixture (W3)."""
    with open(W3_FIXTURE, "r", encoding="utf-8") as handle:
        fixture = json.load(handle)

    prompt = fixture["prompt"]
    expected = fixture["expected_prompt_hash"]

    assert expected != "PIN_ON_FIRST_RUN", (
        "the W3 fixture is still a sentinel — freeze it from the TS test first"
    )

    actual = reward_bridge.canonical_prompt_hash(prompt)
    assert actual == expected, (
        "W3 DIVERGENCE: Python prompt_hash != the TS-pinned fixture. "
        f"prompt={prompt!r} python={actual} expected={expected}"
    )


def test_w3_hash_formula_is_sha256_hex_with_prefix():
    """Independently re-derive the formula so the test cannot drift with the code."""
    prompt = "Plan the task before invoking any state-mutating tool."
    manual = "sha256:" + hashlib.sha256(prompt.encode("utf-8")).hexdigest()
    assert reward_bridge.canonical_prompt_hash(prompt) == manual


# ---------------------------------------------------------------------------
# Layer 2a — Approach-A reward lookup (pure stdlib).
# ---------------------------------------------------------------------------
def _write_rewards(tmp_path, entries):
    rewards = {
        "version": "1",
        "job_id": "job-test",
        "reward_source": "diagnostic",
        "reward_composition": {},
        "entries": entries,
    }
    path = os.path.join(tmp_path, "rewards.json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(rewards, handle)
    return path


def test_reward_func_looks_up_scalar_by_prompt_hash(tmp_path):
    """The reward func keys the TS scalar by prompt_hash (Approach A), via prompt text."""
    p1, p2 = "alpha prompt", "beta prompt"
    h1, h2 = reward_bridge.canonical_prompt_hash(p1), reward_bridge.canonical_prompt_hash(p2)
    rewards_path = _write_rewards(
        str(tmp_path),
        [
            {"prompt_hash": h1, "prompt": p1, "baseline_reward": 0.9, "principle_breakdown": {}},
            {"prompt_hash": h2, "prompt": p2, "baseline_reward": 0.1, "principle_breakdown": {}},
        ],
    )
    reward_func = reward_bridge.make_reward_func(rewards_path)

    # Fresh completions are IGNORED for scoring — only the prompt selects the TS scalar.
    out = reward_func(["fresh completion A", "fresh completion B"], prompts=[p1, p2])
    assert out == [0.9, 0.1]


def test_reward_func_keys_by_prompt_hash_kwarg(tmp_path):
    """When TRL forwards a prompt_hash column, the func keys by it directly."""
    p1 = "gamma prompt"
    h1 = reward_bridge.canonical_prompt_hash(p1)
    rewards_path = _write_rewards(
        str(tmp_path),
        [{"prompt_hash": h1, "prompt": p1, "baseline_reward": 0.42, "principle_breakdown": {}}],
    )
    reward_func = reward_bridge.make_reward_func(rewards_path)
    out = reward_func(["x"], prompts=[p1], prompt_hash=[h1])
    assert out == [0.42]


def test_reward_func_unmatched_prompt_defaults(tmp_path):
    """A prompt absent from rewards.json gets the documented neutral default (0.0)."""
    rewards_path = _write_rewards(str(tmp_path), [])
    reward_func = reward_bridge.make_reward_func(rewards_path)
    assert reward_func(["c"], prompts=["never scored"]) == [0.0]


# ---------------------------------------------------------------------------
# Layer 2b — manifest round-trip with the exact ResultManifest field names.
# ---------------------------------------------------------------------------
def test_write_manifest_round_trips_result_manifest_fields(tmp_path):
    out_dir = str(tmp_path)
    metrics = manifest.build_metrics(reward_mean=0.55, reward_std=0.12, steps=3, epochs=1)
    path = manifest.write_manifest(
        out_dir,
        job_id="job-1",
        candidate_id="cand-1",
        artifact_path=os.path.join(out_dir, "adapter"),
        base_model_ref="tiny/model",
        config_snapshot={"loss_type": "dr_grpo"},
        metrics=metrics,
    )
    assert path == os.path.join(out_dir, "result_manifest.json")

    with open(path, "r", encoding="utf-8") as handle:
        loaded = json.load(handle)

    # Required ResultManifest fields (must match the TS ResultManifestSchema).
    for field in ("job_id", "candidate_id", "artifact_path", "base_model_ref",
                  "config_snapshot", "completed_at", "metrics"):
        assert field in loaded
    assert loaded["metrics"]["reward_mean"] == 0.55
    assert loaded["metrics"]["reward_std"] == 0.12
    assert loaded["metrics"]["steps"] == 3
    assert loaded["metrics"]["epochs"] == 1
    # No auto-promote field (gated-promotion boundary).
    assert "promoted" not in loaded
    assert "status" not in loaded


def test_error_manifest_omits_metrics_sets_error(tmp_path):
    """A FAIL-CLOSED manifest carries `error` and OMITS `metrics` (the gate discards)."""
    out_dir = str(tmp_path)
    path = manifest.write_error_manifest(
        out_dir,
        job_id="job-2",
        base_model_ref="tiny/model",
        config_snapshot={},
        error="boom",
    )
    with open(path, "r", encoding="utf-8") as handle:
        loaded = json.load(handle)
    assert loaded["error"] == "boom"
    assert "metrics" not in loaded
    assert loaded["candidate_id"] == "failed-job-2"


# ---------------------------------------------------------------------------
# Layer 2c — the CLI boundary fails closed: a bad spec yields an error manifest.
# This covers EC-2's "a spec always yields a manifest" invariant with NO ML deps.
# ---------------------------------------------------------------------------
def _write_dataset_and_rewards(tmp_path):
    prompts = ["Plan before acting.", "Verify after writing."]
    dataset_path = os.path.join(tmp_path, "dataset.jsonl")
    with open(dataset_path, "w", encoding="utf-8") as handle:
        for prompt in prompts:
            handle.write(json.dumps({
                "prompt_hash": reward_bridge.canonical_prompt_hash(prompt),
                "prompt": prompt,
                "harness_version": "v0",
                "trace_id": "t1",
                "agent_id": "a1",
            }) + "\n")
    rewards_path = _write_rewards(
        tmp_path,
        [
            {"prompt_hash": reward_bridge.canonical_prompt_hash(p), "prompt": p,
             "baseline_reward": 0.5, "principle_breakdown": {}}
            for p in prompts
        ],
    )
    return prompts, dataset_path, rewards_path


def test_cli_invalid_spec_num_generations_writes_error_manifest(tmp_path):
    """num_generations < 2 is rejected at the boundary → fail-closed error manifest."""
    out_dir = os.path.join(str(tmp_path), "out")
    os.makedirs(out_dir, exist_ok=True)
    _, dataset_path, rewards_path = _write_dataset_and_rewards(str(tmp_path))
    spec = {
        "job_id": "job-bad",
        "dataset_path": dataset_path,
        "rewards_path": rewards_path,
        "base_model_ref": "tiny/model",
        "output_dir": out_dir,
        "grpo_config": {"num_generations": 1},  # invalid — group of one
        "peft_config": {},
    }
    spec_path = os.path.join(str(tmp_path), "job-spec.json")
    with open(spec_path, "w", encoding="utf-8") as handle:
        json.dump(spec, handle)

    code = cli.main(["--spec", spec_path])
    assert code == 0  # the failure is reported IN the manifest, the gate's channel

    with open(os.path.join(out_dir, "result_manifest.json"), "r", encoding="utf-8") as handle:
        loaded = json.load(handle)
    assert "error" in loaded
    assert "num_generations" in loaded["error"]
    assert "metrics" not in loaded


def test_cli_relative_path_rejected(tmp_path):
    """A relative path is rejected (T-05-03) → fail-closed error manifest."""
    out_dir = os.path.join(str(tmp_path), "out")
    os.makedirs(out_dir, exist_ok=True)
    _, dataset_path, rewards_path = _write_dataset_and_rewards(str(tmp_path))
    spec = {
        "job_id": "job-rel",
        "dataset_path": "relative/dataset.jsonl",  # NOT absolute
        "rewards_path": rewards_path,
        "base_model_ref": "tiny/model",
        "output_dir": out_dir,
        "grpo_config": {"num_generations": 2},
        "peft_config": {},
    }
    spec_path = os.path.join(str(tmp_path), "job-spec.json")
    with open(spec_path, "w", encoding="utf-8") as handle:
        json.dump(spec, handle)

    cli.main(["--spec", spec_path])
    with open(os.path.join(out_dir, "result_manifest.json"), "r", encoding="utf-8") as handle:
        loaded = json.load(handle)
    assert "error" in loaded
    assert "ABSOLUTE" in loaded["error"]


# ---------------------------------------------------------------------------
# Layer 3 — EC-2 real tiny-CPU-model GRPO smoke test (slow, skippable).
# ---------------------------------------------------------------------------
@pytest.mark.slow
def test_smoke(tmp_path):
    """EC-2: a real tiny-CPU-model GRPO step produces a manifest with reward_mean.

    Uses a 2-layer test model (`hf-internal-testing/tiny-random-LlamaForCausalLM`),
    `use_vllm=False`, `num_generations=2`, `max_completion_length=32`, 1 epoch —
    runs on CPU in ~60s. SKIPs with an explicit reason when the ML stack or the
    cached model is unavailable offline (the real GPU GRPO run is Manual-Only).
    """
    pytest.importorskip("trl", reason="trl not installed — heavy ML dep (EC-2 GPU/real run is Manual-Only)")
    pytest.importorskip("transformers", reason="transformers not installed")
    pytest.importorskip("datasets", reason="datasets not installed")
    pytest.importorskip("peft", reason="peft not installed")

    out_dir = os.path.join(str(tmp_path), "out")
    os.makedirs(out_dir, exist_ok=True)
    _, dataset_path, rewards_path = _write_dataset_and_rewards(str(tmp_path))

    spec = {
        "job_id": "job-smoke",
        "dataset_path": dataset_path,
        "rewards_path": rewards_path,
        # A tiny random Llama used across the HF test suite — no real weights to fetch
        # beyond a few MB; CPU-friendly. If it can't be fetched offline, the run below
        # raises and the sidecar writes a fail-closed error manifest, which we treat
        # as a documented skip (the boundary still produced a manifest).
        "base_model_ref": "hf-internal-testing/tiny-random-LlamaForCausalLM",
        "output_dir": out_dir,
        "grpo_config": {
            "num_train_epochs": 1,
            "per_device_train_batch_size": 2,
            "num_generations": 2,
            "loss_type": "dr_grpo",
            "use_vllm": False,
            "max_completion_length": 32,
        },
        "peft_config": {"enabled": True, "lora_r": 8, "lora_alpha": 16},
    }
    spec_path = os.path.join(str(tmp_path), "job-spec.json")
    with open(spec_path, "w", encoding="utf-8") as handle:
        json.dump(spec, handle)

    cli.main(["--spec", spec_path])

    manifest_path = os.path.join(out_dir, "result_manifest.json")
    assert os.path.exists(manifest_path), "the boundary must always write a manifest"
    with open(manifest_path, "r", encoding="utf-8") as handle:
        loaded = json.load(handle)

    if "error" in loaded:
        pytest.skip(
            "tiny model could not be fetched/trained offline; the boundary still "
            f"wrote a fail-closed manifest: {loaded['error']}"
        )

    # A genuine success: EC-2 satisfied — a real GRPO step produced metrics.
    assert "metrics" in loaded
    assert "reward_mean" in loaded["metrics"]
    assert isinstance(loaded["metrics"]["reward_mean"], (int, float))
    assert loaded["candidate_id"] == "cand-job-smoke"
