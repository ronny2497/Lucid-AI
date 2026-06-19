"""manifest — write the ``ResultManifest`` the TS gate reads (REQ-05).

The Python sidecar's output half of the filesystem job boundary. ``write_manifest``
serializes ``<output_dir>/result_manifest.json`` with field names matching the TS
``ResultManifestSchema`` EXACTLY (``packages/evolution/src/l2/schemas/result-manifest.ts``):

    job_id          : str   (required)
    candidate_id    : str   (required)
    artifact_path   : str   (required — the LoRA adapter dir, or output_dir on failure)
    base_model_ref  : str   (required)
    metrics         : { reward_mean, reward_std, steps, epochs,
                        frac_reward_zero_std?, training_duration_s? }  (OPTIONAL)
    principle_deltas: { <principle>: number }  (optional)
    config_snapshot : { ... }  (required — the GRPOConfig as logged)
    completed_at    : str   (required — ISO 8601)
    error           : str   (optional — set, with metrics omitted, on a failed run)

FAIL CLOSED (threat T-05-10): on a failed/aborted run the sidecar writes a
manifest with ``error`` set and ``metrics`` OMITTED — never a silent crash. The
TS gate reads the missing metrics / ``error`` and DISCARDS the candidate, so a
failure is never treated as a promotable success.

NO AUTO-PROMOTE (GATED-PROMOTION): there is intentionally NO ``promoted`` /
``status`` field. Promotion is the TS gate's verdict, never something the trainer
can set on itself.

Pure stdlib (``json`` / ``os`` / ``datetime``) — testable with no ML deps.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Mapping, Optional

#: The manifest filename the TS ``FilesystemTrainerPlugin`` polls for in output_dir.
RESULT_MANIFEST_FILE = "result_manifest.json"


def _iso_now() -> str:
    """An ISO 8601 UTC timestamp (e.g. ``2026-06-19T00:00:00.000Z``)."""
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def build_metrics(
    *,
    reward_mean: float,
    reward_std: float,
    steps: int,
    epochs: int,
    frac_reward_zero_std: Optional[float] = None,
    training_duration_s: Optional[float] = None,
) -> dict[str, Any]:
    """Build a ``metrics`` object matching ``MetricsSchema`` field names."""
    metrics: dict[str, Any] = {
        "reward_mean": float(reward_mean),
        "reward_std": float(reward_std),
        "steps": int(steps),
        "epochs": int(epochs),
    }
    if frac_reward_zero_std is not None:
        metrics["frac_reward_zero_std"] = float(frac_reward_zero_std)
    if training_duration_s is not None:
        metrics["training_duration_s"] = float(training_duration_s)
    return metrics


def write_manifest(
    output_dir: str,
    *,
    job_id: str,
    candidate_id: str,
    artifact_path: str,
    base_model_ref: str,
    config_snapshot: Mapping[str, Any],
    metrics: Optional[Mapping[str, Any]] = None,
    principle_deltas: Optional[Mapping[str, float]] = None,
    error: Optional[str] = None,
    completed_at: Optional[str] = None,
) -> str:
    """Write ``<output_dir>/result_manifest.json`` and return its path.

    On a successful run pass ``metrics`` (and optionally ``principle_deltas``).
    On a failed run pass ``error`` and OMIT ``metrics`` — the gate fails closed.
    """
    os.makedirs(output_dir, exist_ok=True)

    manifest: dict[str, Any] = {
        "job_id": job_id,
        "candidate_id": candidate_id,
        "artifact_path": artifact_path,
        "base_model_ref": base_model_ref,
        "config_snapshot": dict(config_snapshot),
        "completed_at": completed_at or _iso_now(),
    }
    if metrics is not None:
        manifest["metrics"] = dict(metrics)
    if principle_deltas is not None:
        manifest["principle_deltas"] = dict(principle_deltas)
    if error is not None:
        manifest["error"] = error

    manifest_path = os.path.join(output_dir, RESULT_MANIFEST_FILE)
    with open(manifest_path, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2)
    return manifest_path


def write_error_manifest(
    output_dir: str,
    *,
    job_id: str,
    base_model_ref: str,
    config_snapshot: Mapping[str, Any],
    error: str,
) -> str:
    """Write a FAIL-CLOSED error manifest (metrics omitted, ``error`` set).

    Mirrors the TS ``FilesystemTrainerPlugin.errorManifest`` shape so a Python-side
    failure is indistinguishable, at the gate, from a TS-detected one — both
    discard. ``candidate_id`` is namespaced ``failed-<job_id>`` and
    ``artifact_path`` is the (possibly empty) output dir.
    """
    return write_manifest(
        output_dir,
        job_id=job_id,
        candidate_id=f"failed-{job_id}",
        artifact_path=output_dir,
        base_model_ref=base_model_ref,
        config_snapshot=config_snapshot,
        error=error,
    )
