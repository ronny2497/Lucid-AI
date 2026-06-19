"""cli — the GRPO sidecar entrypoint (REQ-05, ADR-0004).

``python -m lucid_trainer_grpo.cli --spec <path>`` (or the ``lucid-trainer-grpo``
console script) reads the TS-written ``TrainerPluginSpec`` JSON, VALIDATES it,
runs ``trainer.run``, and writes ``<output_dir>/result_manifest.json`` matching
the TS ``ResultManifestSchema`` field names.

THE BOUNDARY NEVER SILENTLY SUCCEEDS (FAIL CLOSED, threat T-05-10): every failure
path — a missing/invalid spec, a validation error, or any exception from the
trainer — writes a manifest with ``error`` set (and ``metrics`` OMITTED) so the TS
gate sees a failed run and DISCARDS the candidate. The only way a promotable
manifest (with ``metrics``) is produced is a real successful training run.

SAFE: this entrypoint spawns NO subprocess and uses NO ``shell=True``. It reads a
file and calls in-process Python. Spec validation re-asserts the TS-side guards
(absolute paths, ``num_generations >= 2``) as defense-in-depth at the boundary.

The validation + manifest path is PURE STDLIB; ``trainer.run`` lazy-imports the
ML stack, so a CLI invocation that fails validation needs no ML deps at all.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

from .manifest import write_error_manifest, write_manifest


class SpecValidationError(ValueError):
    """Raised when the job spec is missing a field or violates a boundary guard."""


def load_spec(spec_path: str) -> dict[str, Any]:
    """Read + parse the spec JSON. Raises ``SpecValidationError`` on a read error."""
    try:
        with open(spec_path, "r", encoding="utf-8") as handle:
            spec = json.load(handle)
    except FileNotFoundError as exc:
        raise SpecValidationError(f"spec file not found: {spec_path}") from exc
    except json.JSONDecodeError as exc:
        raise SpecValidationError(f"spec is not valid JSON: {exc}") from exc
    if not isinstance(spec, dict):
        raise SpecValidationError("spec must be a JSON object")
    return spec


def validate_spec(spec: dict[str, Any]) -> None:
    """Validate the spec against the ``TrainerPluginSpec`` field set + boundary guards.

    Mirrors the TS ``TrainerPluginSpecSchema`` (05-01): required string fields,
    ABSOLUTE path fields (threat T-05-03), and ``num_generations >= 2`` (a GRPO
    group of one has an undefined group-relative advantage). A plain field check
    — no jsonschema dep — so the validation path stays pure stdlib.
    """
    required_str = ("job_id", "base_model_ref")
    for field in required_str:
        value = spec.get(field)
        if not isinstance(value, str) or not value:
            raise SpecValidationError(f"spec.{field} must be a non-empty string")

    path_fields = ("dataset_path", "rewards_path", "output_dir")
    for field in path_fields:
        value = spec.get(field)
        if not isinstance(value, str) or not value:
            raise SpecValidationError(f"spec.{field} must be a non-empty string path")
        if not os.path.isabs(value):
            raise SpecValidationError(
                f"spec.{field} must be an ABSOLUTE path (got {value!r}) — the sidecar "
                "resolves it independently of its working directory (T-05-03)"
            )

    grpo_config = spec.get("grpo_config", {})
    if not isinstance(grpo_config, dict):
        raise SpecValidationError("spec.grpo_config must be an object when present")
    num_generations = grpo_config.get("num_generations", 8)
    if not isinstance(num_generations, int) or num_generations < 2:
        raise SpecValidationError(
            "spec.grpo_config.num_generations must be an integer >= 2 — GRPO's "
            "group-relative advantage is undefined for a group of one"
        )

    if not os.path.exists(spec["dataset_path"]):
        raise SpecValidationError(f"dataset file not found: {spec['dataset_path']}")
    if not os.path.exists(spec["rewards_path"]):
        raise SpecValidationError(f"rewards file not found: {spec['rewards_path']}")


def run_job(spec_path: str) -> str:
    """Load + validate the spec, run the trainer, write the manifest. Returns its path.

    On ANY failure writes a fail-closed error manifest (the gate discards) rather
    than raising out of the process — the boundary always leaves an auditable
    manifest behind.
    """
    # Best-effort context for an error manifest if the spec itself is unreadable.
    output_dir = os.getcwd()
    job_id = "unknown"
    base_model_ref = "unknown"
    config_snapshot: dict[str, Any] = {}

    try:
        spec = load_spec(spec_path)
        # Populate error-manifest context as soon as we have the spec.
        output_dir = spec.get("output_dir", output_dir) if isinstance(spec, dict) else output_dir
        if isinstance(spec, dict):
            job_id = spec.get("job_id", job_id) or job_id
            base_model_ref = spec.get("base_model_ref", base_model_ref) or base_model_ref
            config_snapshot = spec.get("grpo_config", {}) or {}
        validate_spec(spec)
    except SpecValidationError as exc:
        return write_error_manifest(
            output_dir,
            job_id=job_id,
            base_model_ref=base_model_ref,
            config_snapshot=config_snapshot,
            error=f"spec validation failed: {exc}",
        )

    try:
        from . import trainer  # lazy: pulls the ML stack only for a real run

        result = trainer.run(spec)
    except Exception as exc:  # noqa: BLE001 — the boundary must never crash silently
        return write_error_manifest(
            spec["output_dir"],
            job_id=spec["job_id"],
            base_model_ref=spec["base_model_ref"],
            config_snapshot=spec.get("grpo_config", {}),
            error=f"training failed: {type(exc).__name__}: {exc}",
        )

    return write_manifest(
        spec["output_dir"],
        job_id=spec["job_id"],
        candidate_id=result["candidate_id"],
        artifact_path=result["artifact_path"],
        base_model_ref=spec["base_model_ref"],
        config_snapshot=result.get("config_snapshot", spec.get("grpo_config", {})),
        metrics=result.get("metrics"),
        principle_deltas=result.get("principle_deltas"),
    )


def main(argv: list[str] | None = None) -> int:
    """CLI entrypoint. Parses ``--spec`` and runs the job. Returns a process code.

    Exit 0 when a manifest was written (including a fail-closed error manifest —
    the failure is reported IN the manifest, which is the contracted channel the
    TS gate reads). Exit 2 only if the manifest itself could not be written.
    """
    parser = argparse.ArgumentParser(
        prog="lucid-trainer-grpo",
        description="Run a GRPO job from a Lucid TrainerPluginSpec and write a ResultManifest.",
    )
    parser.add_argument(
        "--spec",
        required=True,
        help="absolute path to the TrainerPluginSpec JSON written by the TS side",
    )
    args = parser.parse_args(argv)

    try:
        manifest_path = run_job(args.spec)
    except OSError as exc:
        # Could not even write the manifest — report on stderr and signal failure.
        print(f"lucid-trainer-grpo: could not write manifest: {exc}", file=sys.stderr)
        return 2

    print(manifest_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
