# Changelog

All notable changes to Lucid-AI are documented here. This project adheres to
[Semantic Versioning](https://semver.org/) and the format of
[Keep a Changelog](https://keepachangelog.com/).

## [1.0.0] — 2026-06-19

Initial public release. Lucid-AI is an open, framework-neutral observability +
evaluation plane for agent harnesses, with a configurable self-evolution engine
on top.

### The standard

- **Harness Semantic Conventions (HSC)** — an OpenTelemetry-compatible event
  vocabulary for agent harnesses, published as a versioned JSON Schema
  (`@lucid/hsc-schema`).
- **Conformance suite + CLI** (`@lucid/conformance`, `lucid-conformance`) — a
  three-layer, machine-checkable gate for the standard. Layers 1–2 are structural;
  Layer 3 runs the honesty rules. *Absence is signal* — presence of an event is
  never required, only the integrity of what is emitted.

### Observability plane

- **Instrumentation SDK** (`@lucid/sdk`) — emit HSC events from any harness.
- **Collector + store** (`@lucid/collector`, `@lucid/store`) — ingest, persist
  (SQLite), and query traces; `lucid` CLI for ingestion and inspection.
- **HSC mapping** (`@lucid/hsc-map`) and **trace explorer** (`@lucid/explorer`) —
  a Vite/React UI for reading traces.

### Diagnostic lens

- **`@lucid/diagnostic`** — scores traces against the Five Convergence Principles
  arranged on the feedforward/feedback × computational/inferential 2×2. Reports
  per-principle results with explicit null/coverage handling (no silent zeros).

### Self-evolution ladder

- **`@lucid/evolution`** — the diagnose → propose → review → apply → regression-guard
  loop across the autonomy ladder:
  - **L0** — recommend (human applies).
  - **L1** — auto-apply structural changes behind a fail-closed regression guard
    with audit + rollback.
  - **L2** — weight-level GRPO via a pluggable `TrainerPlugin`. The TypeScript core
    never imports Python; training runs in a lazy, self-hostable sidecar
    (`packages/trainer-grpo`, official HuggingFace TRL). Promotion is gated on a
    held-out evaluation. A real GPU run is operator-driven.

### Adapters

- First-party adapters: `@lucid/adapter-sdk` (authoring kit),
  `@lucid/adapter-hermes`, `@lucid/adapter-langgraph`,
  `@lucid/adapter-openai-agents`.

### Compliance

- **`@lucid/compliance`** — exports an EU AI Act Article-12 evidence package with a
  hash-chained audit trail. It consumes evolution audit data through an injected
  seam and degrades to a valid partial package when that data is absent.
  *Legal review of the regulatory mapping is operator responsibility.*

### Tooling

- CI workflow (GitHub Actions): `pnpm -r build` + `pnpm -r test` across the
  workspace plus the Python sidecar's stdlib tests.

[1.0.0]: https://github.com/ronny2497/Lucid-AI/releases/tag/v1.0.0
