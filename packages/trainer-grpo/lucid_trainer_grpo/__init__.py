"""lucid-trainer-grpo — the reference weight-level GRPO trainer sidecar (REQ-05).

A SEPARATE, OPTIONAL Python package invoked only behind the TS
``FilesystemTrainerPlugin`` boundary at ``autonomy:L2`` (ADR-0004). It reads a
TS-written ``TrainerPluginSpec`` job from disk, runs TRL ``GRPOTrainer`` on
FRESH on-policy rollouts scored by TS-computed scalar rewards (Approach A —
``reward_bridge`` looks the scalar up by ``prompt_hash`` and NEVER recomputes
quality), and writes a schema-matching ``ResultManifest``.

The Lucid core takes no Python dependency; this package is never pulled by an
``npm install`` (ADR-0002).
"""

__version__ = "0.0.0"

__all__ = ["__version__"]
