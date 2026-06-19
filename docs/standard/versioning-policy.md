# HSC Versioning & Vendor-Extension Policy

> **Status:** the governance contract for evolving the HSC standard. It defines how the spec is versioned (SemVer), how breaking changes are reviewed, how the conformance suite + badge are keyed to the spec, and how vendors may extend `harness.*` without forking the standard.

## SemVer for the HSC spec

HSC is versioned with **Semantic Versioning**. The version is a property of the **spec** (event types, attribute registry, principle/quadrant bindings), and adapters declare the HSC version they target (`hscVersion` on the manifest, `targets` in `defineAdapter`).

| Bump | When | Examples |
|---|---|---|
| **MAJOR** | A change that can make a previously-conformant trace non-conformant | Removing an event type; changing or removing a **required** attribute; changing a principle/quadrant binding; tightening a predicate so existing valid traces now fail |
| **MINOR** | Backward-compatible additions | Adding a new **optional** attribute; adding a new event type; relaxing a predicate so more traces pass; documenting a new vendor-extension convention |
| **PATCH** | Clarifications with no schema effect | Wording fixes; clarified examples; non-normative guidance; typo corrections in the registry |

**Guiding rule:** if a change could turn an existing PASS into a FAIL, it is MAJOR. Absence-is-signal is load-bearing here — *adding* a positive presence requirement (e.g. "a mutating tool.call MUST be followed by a verify.result") would break honest traces and is therefore a MAJOR change that the conformance suite is explicitly designed **not** to make.

## The breaking-change RFC process

A MAJOR change (or any change to a **MUST/SHALL** clause) follows a documented RFC process:

1. **Proposal issue** — a written RFC describing the change, the motivation, the migration path, and the conformance impact (which existing traces/badges it would affect).
2. **Discussion window** — a fixed minimum comment period so adopters and adapter authors can weigh in. Breaking changes are never merged silently.
3. **Maintainer signoff** — a MUST/SHALL change requires explicit maintainer approval, recorded on the RFC. Non-normative (PATCH) changes do not require an RFC.
4. **CHANGELOG entry** — every MAJOR/MINOR change lands with a CHANGELOG entry stating the bump, the affected attributes/events, and the migration note. The CHANGELOG is the authoritative record of what changed between spec versions.

## The conformance suite is versioned to HSC

The conformance suite and the badge are **keyed to the HSC spec version**:

- A report records both `hscVersion` (e.g. `v0`) and `suiteVersion` (the suite build that produced it).
- The badge label reads **"HSC v0 conformant"** — a badge is always scoped to the spec version it was produced against. A badge earned against HSC v0 makes no claim about HSC v1.
- When the spec bumps MAJOR, the suite bumps to match, and adapters re-certify against the new version to carry the new badge. Old badges remain truthful claims about the old version — they are never silently revalidated.

See the [conformance-badge guide](../guides/conformance-badge.md) for the report/badge shape and the re-verification flow.

## Vendor-extension policy: `harness.x.<vendor>.*`

Vendors and adapter authors will need attributes the core spec does not define. The policy keeps that possible **without fragmenting the standard**:

- **Allowed namespace.** A vendor MAY emit attributes under `harness.x.<vendor>.*` (e.g. `harness.x.acme.queue_depth`). The reserved `x.` segment marks the attribute as a vendor extension, distinct from core `harness.*`.
- **Excluded from core diagnostics.** Vendor-extension attributes are **not** consumed by core diagnostics, predicates, or badge logic **unless promoted** into the core spec via the RFC process above (at which point they shed the `x.<vendor>` segment and become MINOR additions). Until promoted, they are carried but inert to the standard.
- **The suite WARNs on undeclared vendor extensions.** The conformance suite emits a **WARN** (advisory, never a FAIL) when it encounters a `harness.x.<vendor>.*` attribute that the adapter's manifest did not declare — surfacing the extension so adopters see it, without penalizing legitimate use. A declared vendor extension is silent; an undeclared one is flagged for visibility.
- **No collision with the test sentinel.** The reserved `harness.x.lucid.test.*` namespace (used by the behavioral-honesty fixtures) is a Lucid-internal vendor extension under this same rule, which is why it can never collide with a real HSC attribute.

> **Why a reserved `x.` segment?** It gives vendors room to innovate while keeping the core small and the conformance contract stable. If a vendor extension proves broadly useful, the RFC process promotes it into core — a deliberate, reviewed MINOR addition rather than ad-hoc dialect drift. This is the mechanism that lets HSC stay one standard instead of fragmenting into per-vendor `harness.*` dialects.

## References

- [HSC overview — Governance & Upstreaming](hsc-overview.md#governance--upstreaming).
- [Conformance report & badge](../guides/conformance-badge.md) — how badges are keyed to the spec version.
- [OTel upstreaming proposal](upstream-proposal.md) — the compatibility-shim posture for a future canonical-attribute migration.
- [`attribute-registry.md`](attribute-registry.md) — the `harness.*` / `gen_ai.*` two-namespace rule.
