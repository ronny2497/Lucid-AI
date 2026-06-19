# HSC v0 — Transport Profile

> **Status:** Normative. Records the pinned OTel GenAI semconv reference, the OTLP
> baseline transport and on-disk envelope, and the HSC self-versioning policy.
> See [ADR-0001](../03-decisions/ADR-0001-otel-compatible-hsc-profile.md).

---

## 1. Pinned OTel GenAI semantic-convention reference

HSC v0 reuses `gen_ai.*` attributes from the
`open-telemetry/semantic-conventions-genai` repository. That repository is in
**Development** status and has **no formal release tags or semver** as of authoring
(RESEARCH OQ-01). HSC therefore pins its normative reference to a **specific commit
SHA**, never to `main` and never to a semver tag.

```yaml
# Pinned reference — the integrity anchor for every reused gen_ai.* name.
genai_semconv_repo:   open-telemetry/semantic-conventions-genai
genai_semconv_commit: 93de98a5b1298ee6708c76ca87cb389861689732   # HEAD as of 2026-06-18 (resolved via git ls-remote; repo has no release tags — OQ-01)
```

> **Pin provenance:** `93de98a5b1298ee6708c76ca87cb389861689732` is the
> `open-telemetry/semantic-conventions-genai` HEAD resolved on 2026-06-18 via
> `git ls-remote https://github.com/open-telemetry/semantic-conventions-genai.git HEAD`.
> The repo is Development-status with no release tags, so a commit SHA is the only
> stable integrity anchor (the threat **T-00-03** anchor and the Plan 00-04 cross-check
> reference this exact value). Bump it only when a new HSC version is authored.

### Reused `gen_ai.*` attributes at the pinned commit (OQ-01)

HSC v0 depends on exactly these `gen_ai.*` attributes at the pinned commit:

- `gen_ai.operation.name`
- `gen_ai.provider.name`
- `gen_ai.agent.name`
- `gen_ai.agent.id`
- `gen_ai.request.model`
- `gen_ai.usage.input_tokens`
- `gen_ai.usage.output_tokens`
- `gen_ai.tool.name`
- `gen_ai.response.finish_reasons`

These are the same attributes projected per HSC event in
[`otel-mapping.md`](./otel-mapping.md). `gen_ai.system` is **not** used (superseded
by `gen_ai.provider.name`).

---

## 2. Transport and on-disk envelope

- **Baseline transport:** OTLP/HTTP.
- **On-disk trace format:** the OTLP/JSON envelope
  `resourceSpans > scopeSpans > spans`. A Phase 0 trace
  (`examples/hermes-trace.json`) is hand-inspectable JSON in this envelope, and any
  OTLP-aware backend can read it directly when Phase 1 ingestion is built. This makes
  the OTel-compatibility claim of ADR-0001 concrete.

---

## 3. Churn risk and HSC self-versioning policy

- **Churn risk: HIGH.** `semantic-conventions-genai` is Development-status with
  active work and no releases; `gen_ai.*` names can be renamed between the pinned
  commit and an adapter build (the `gen_ai.system` → `gen_ai.provider.name` rename
  is the cautionary precedent). This is threat **T-00-03**; the pinned commit SHA is
  the mitigation (see [ADR-0001](../03-decisions/ADR-0001-otel-compatible-hsc-profile.md)).
- **HSC version:** HSC is currently `v0`. The pinned `genai_semconv_commit` is bumped
  **only** when a new HSC version is authored — never silently. Adapters declare the
  HSC version they target.
