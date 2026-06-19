# HSC v0 — `harness.*` Attribute Registry

> **Status:** Normative. This registry defines the **HSC extension** namespace —
> the attributes OpenTelemetry lacks (D-02). The reused OTel `gen_ai.*` attributes
> are documented separately in [`otel-mapping.md`](./otel-mapping.md) and pinned in
> [`transport-profile.md`](./transport-profile.md).
>
> **Invariant:** `harness.*` and `gen_ai.*` live in strictly separate namespaces.
> No `harness.*` attribute is documented or emitted under the `gen_ai.*` namespace,
> and vice versa.

The canonical attribute-path strings are exported from `@lucid/hsc-schema`
(`HARNESS_ATTR`); the table below reproduces them. Downstream code **MUST** import
the paths from that package rather than hardcoding the dotted strings (REQ-07).

---

## The `harness.*` extension attributes

| Attribute | Type | Required? | Example | Notes |
|---|---|---|---|---|
| `harness.event_type` | string (enum) | **REQUIRED** | `feedback.check` | One of the 10 HSC v0 event types (spec §2). Primary key for diagnostics. |
| `harness.principle` | string (enum) | **REQUIRED** | `feedback` | One of `context`, `plan_execute`, `feedback`, `one_at_a_time`, `codebase_docs`. |
| `harness.quadrant.x` | string (enum) \| null | Optional | `feedback` | `feedforward` \| `feedback` \| `null`. Derived from `event_type` per spec §3.2. `null` = untagged action. |
| `harness.quadrant.y` | string (enum) \| null | Optional* | `computational` | `computational` \| `inferential` \| `null`. *REQUIRED on `feedback.check` (emitter-specified, spec §3.2.1). |
| `harness.version` | string | Optional | `v37` | Harness build version, for version diffing — distinct from the model version. |
| `harness.mutated_state` | boolean \| null | Optional | `true` | Did the action mutate state? Set on `tool.call`; drives the absence-is-signal rule (spec §4). |
| `harness.change_manifest_id` | string \| null | Optional | `cm-123` | Links `evolve.propose` / `evolve.apply` events to a proposal. |
| `harness.inferred` | boolean \| null | Optional | `true` | Marks an event reconstructed from indirect signals (spec §5). Lower confidence; scorers MUST account for it separately. |

\* `harness.quadrant.y` is optional in general (deterministically derivable for 8 of
9 quadrant-bearing types) but **REQUIRED** on `feedback.check`, whose y-axis is
emitter-specified.

---

## Content-bearing fields (opt-in, privacy)

HSC v0 reuses but does **not require** the OTel content-bearing fields. These carry
prompt / tool-argument payloads and are an information-disclosure surface
(threat T-00-04). They are **opt-in** and **MUST NOT** be emitted by default:

| OTel field | Disposition | Privacy note |
|---|---|---|
| `gen_ai.input.messages` | Opt-in only | Raw prompt/message content. Off by default; emit only with explicit operator consent. |
| `gen_ai.tool.call.arguments` | Opt-in only | Raw tool-call arguments may contain secrets/PII. Off by default. |

HSC v0 does not require any content field for a conformant trace. Full
redaction/audit tooling is deferred to Phase 6 (noted surface).

---

## Provider identity

HSC v0 uses `gen_ai.provider.name` for the model provider. The legacy provider
attribute it superseded (semconv v1.37.0) is **not** part of this registry and
**MUST NOT** be emitted. See the anti-patterns in
[`otel-mapping.md`](./otel-mapping.md).
