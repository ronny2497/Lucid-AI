"""reward_bridge — Approach-A reward lookup for the GRPO sidecar (REQ-05, ADR-0004).

REWARD-IN-TS (HARD, threat T-05-04): the reward is computed ENTIRELY in
TypeScript (``@lucid/evolution`` ``reward-computer.ts``) from the Phase 2
``DiagnosticResult`` and written to ``rewards.json`` (a ``RewardDataset``). This
module ONLY LOOKS UP that pre-computed scalar by ``prompt_hash`` (Approach A) and
hands it to TRL as the GRPO reward. It imports NO ``@lucid/diagnostic`` logic and
NEVER re-derives a principle / quality score in Python — Python does gradient
math only. Adding quality scoring here would break the ADR-0004 boundary.

W3 CROSS-LANGUAGE CONTRACT: the ``prompt_hash`` is constructed IDENTICALLY here
and in the TS exporter / reward-computer, so the two languages agree on which
reward belongs to which prompt:

    prompt_hash = "sha256:" + hex( sha256( utf8_bytes(prompt) ) )

  - SHA-256 of the prompt string encoded as UTF-8 (no BOM, no trailing newline
    added — the exact ``prompt`` bytes, unmodified),
  - rendered as lowercase hex,
  - prefixed with the literal ASCII string ``"sha256:"``.

This mirrors, byte-for-byte, the TS ``canonicalPromptHash`` and the exporter's
``hashPrompt``. The shared fixture
``packages/evolution/tests/l2/fixtures/w3-prompt-hash.json`` pins one
prompt→hash pair; ``tests/test_trainer.py`` asserts this function reproduces it,
so any TS/Python divergence fails loudly.

This module is PURE STDLIB (``hashlib`` / ``json``) — it imports no ML library,
so the W3 hash + reward-lookup contract is testable with no heavy deps.
"""

from __future__ import annotations

import hashlib
import json
from typing import Callable, Sequence

#: The literal prefix every ``prompt_hash`` carries (W3 cross-language contract).
PROMPT_HASH_PREFIX = "sha256:"

#: Reward used for a fresh-rollout prompt whose hash is absent from rewards.json.
#: A prompt the TS side did not score carries no training signal; a neutral 0.0
#: keeps the group well-formed without injecting a phantom positive reward. This
#: should not normally happen — the dataset and rewards are written together.
DEFAULT_UNMATCHED_REWARD = 0.0


def canonical_prompt_hash(prompt: str) -> str:
    """Return the W3 ``prompt_hash`` for ``prompt``.

    Identical to the TS ``canonicalPromptHash`` /
    ``trajectory-exporter.hashPrompt``:
    ``"sha256:" + sha256(prompt.encode("utf-8")).hexdigest()`` (lowercase hex).
    """
    return PROMPT_HASH_PREFIX + hashlib.sha256(prompt.encode("utf-8")).hexdigest()


def load_rewards_by_hash(rewards_path: str) -> dict[str, float]:
    """Load ``rewards.json`` (a ``RewardDataset``) into a ``prompt_hash -> reward`` map.

    Reads the TS-written ``RewardDataset`` shape: ``{ entries: [{ prompt_hash,
    baseline_reward, ... }] }``. Only the ``prompt_hash`` and the pre-computed
    ``baseline_reward`` scalar are consumed — the per-principle breakdown is TS
    provenance the trainer does not touch (reward-in-TS).
    """
    with open(rewards_path, "r", encoding="utf-8") as handle:
        dataset = json.load(handle)

    entries = dataset.get("entries", [])
    table: dict[str, float] = {}
    for entry in entries:
        prompt_hash = entry["prompt_hash"]
        table[prompt_hash] = float(entry["baseline_reward"])
    return table


def make_reward_func(
    rewards_path: str,
    default_reward: float = DEFAULT_UNMATCHED_REWARD,
) -> Callable[..., list[float]]:
    """Build the TRL reward function from the TS-written ``rewards.json``.

    Returns a ``(completions, prompts=None, **kwargs) -> list[float]`` callable
    matching the TRL ``GRPOTrainer`` reward-function signature (RESEARCH A7 —
    ``**kwargs`` carries any extra dataset columns). For each FRESH completion it
    looks up the pre-computed TS scalar by the W3 hash of the corresponding
    PROMPT (Approach A) — the completion text is NOT scored by Python; only the
    prompt selects which TS reward applies. The lookup may be served either by
    the ``prompt`` text (re-hashed here) or by a ``prompt_hash`` column TRL
    forwards in ``kwargs``.

    HARD: this never inspects ``completion`` content to derive quality — that is
    the reward-in-TS boundary (ADR-0004). Returns one scalar per completion.
    """
    table = load_rewards_by_hash(rewards_path)

    def reward_func(
        completions: Sequence[object],
        prompts: Sequence[str] | None = None,
        **kwargs: object,
    ) -> list[float]:
        n = len(completions)

        # Prefer an explicit prompt_hash column if TRL forwards one (kwargs),
        # else re-hash the prompt text with the W3 formula. Both resolve to the
        # SAME key the TS side wrote.
        hashes_kwarg = kwargs.get("prompt_hash")
        prompt_hashes: list[str | None]
        if isinstance(hashes_kwarg, (list, tuple)) and len(hashes_kwarg) == n:
            prompt_hashes = [str(h) for h in hashes_kwarg]
        elif prompts is not None and len(prompts) == n:
            prompt_hashes = [canonical_prompt_hash(str(p)) for p in prompts]
        else:
            # No way to key the reward — fall back per completion (documented).
            prompt_hashes = [None] * n

        rewards: list[float] = []
        for prompt_hash in prompt_hashes:
            if prompt_hash is not None and prompt_hash in table:
                rewards.append(table[prompt_hash])
            else:
                rewards.append(default_reward)
        return rewards

    return reward_func
