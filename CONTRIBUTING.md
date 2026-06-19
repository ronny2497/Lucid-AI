# Contributing to Lucid-AI

Thanks for helping build the harness observability + self-evolution plane. Adapters, detectors, conformance fixtures, and docs are especially welcome.

## Development setup

Prereqs: **Node ≥ 20**, **pnpm ≥ 9**. (Python ≥ 3.10 only for the optional L2 trainer sidecar.)

```bash
pnpm install
pnpm -r build          # tsc across the workspace
pnpm -r test           # vitest across all packages
```

> **macOS native build:** `@lucid/store`'s `better-sqlite3` may need the SDK include path. If the build can't find `<climits>`:
> ```bash
> export SDKROOT="$(xcrun --show-sdk-path)"
> export CPLUS_INCLUDE_PATH="$SDKROOT/usr/include/c++/v1:$SDKROOT/usr/include"
> ```

Run one package: `pnpm --filter @lucid/<pkg> test` (or `build` / `typecheck`).

## Repository layout

```
packages/        the @lucid/* workspace (schema, conformance, sdk, store, hsc-map,
                 collector, diagnostic, evolution, adapter-sdk, adapter-*, compliance, explorer)
                 + trainer-grpo  (optional Python GRPO sidecar)
docs/            vision · concepts · architecture · decisions (ADRs) · the HSC standard · guides
examples/        sample HSC traces (wire + OTLP/JSON)
```

## Where things live (start points)

- **The standard:** `packages/hsc-schema` + [`docs/standard/`](docs/standard/). Adding/changing an event type ripples to `EVENT_PRINCIPLE`, the JSON-Schema enum, `quadrantFor`, and the conformance/diagnostic suites — change them together and re-run those packages.
- **A new detector:** `packages/diagnostic/src/detectors/<principle>/…` — import event-type/attribute constants from `@lucid/hsc-schema` (never hardcode the strings). Keep the **zero-denominator guard**: a principle with no relevant events scores `null` + `coverage:0`, never `1.0`.
- **A new adapter:** build on the public `@lucid/adapter-sdk` — `defineAdapter()` + the emit-or-omit helper (never fabricate a missing event — *absence is signal*). Scaffold a runnable skeleton with the `adapter init` command, then prove it with the conformance suite (`lucid-conformance --adapter <dir> --emit-badge`). See [`docs/guides/adapter-authoring.md`](docs/guides/adapter-authoring.md) and [`docs/guides/conformance-badge.md`](docs/guides/conformance-badge.md).
- **Self-evolution:** `packages/evolution`. The L0/L1/L2 boundary is load-bearing — L1 touches only structural surfaces (config/prompts/skills/context-policy) with snapshot + rollback; weights are L2-only and run behind the `TrainerPlugin` boundary so the TS core never imports Python.

## Testing expectations

- **TDD.** New behavior lands with tests; for schema/contract work, freeze the schema + fixtures first (Wave-0 style), then implement to GREEN.
- Every detector/scorer/plotter change must keep the golden-fixture suites passing. Add a fixture for any new finding.
- No watch-mode flags in committed test scripts; suites must run non-interactively under `pnpm -r test`.

## Commit & PR conventions

- **[Conventional Commits](https://www.conventionalcommits.org/)**: `feat(scope): …`, `fix(scope): …`, `docs(scope): …`, `test(scope): …`, etc.
- **Do not add AI co-authorship trailers** (no `Co-Authored-By` / "Generated with" lines) to commits.
- Keep commits atomic; reference the package/area in the scope. PRs should describe *what changed and why*, link any relevant `docs/standard/` section, and show `pnpm -r build && pnpm -r test` green.
- Changes to the standard follow the **HSC versioning policy** — see [`docs/standard/versioning-policy.md`](docs/standard/versioning-policy.md). Vendor-specific extensions go under `harness.x.<vendor>.*`.

## License

By contributing you agree your contributions are licensed under [Apache-2.0](./LICENSE).
