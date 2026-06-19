# The Conformance Report & Self-Declared Badge

> **Audience:** adapter authors who have run the suite, and adopters deciding whether to trust an adapter's badge. This documents the machine-readable `ConformanceReport`, the self-declared badge, the MUST-vs-SHOULD tiers, and how any party re-verifies a badge offline.
>
> Real APIs: `runConformanceSuite`, `emitBadge` (`@lucid/conformance`). See the [authoring guide](adapter-authoring.md) for how to produce a report.

## The model: self-certification, no registry authority

Lucid follows the **OpenID-Foundation self-certification** model: there is **no** central authority that grants conformance. An adapter author runs the **offline** suite over their own trace and publishes a **self-declared badge**. The badge embeds exactly the keys a third party needs to **re-run the same offline suite and confirm the claim** — so a badge can never assert more than its underlying report substantiates.

This keeps the standard credible without a gatekeeper: trust is **re-verifiable**, not asserted.

## The machine-readable `ConformanceReport`

`runConformanceSuite(trace, opts)` returns a schema-valid `ConformanceReport`. Its shape (see `@lucid/conformance` `report.ts`):

```jsonc
{
  "hscVersion": "v0",
  "suiteVersion": "0.1.0",
  "adapter": { "name": "@lucid/adapter-openai-agents", "hscVersion": "v0" },
  "layers": {
    "otelValidity":      { "pass": true,  "checks": 1, "passed": 1, "errors": [ /* ... */ ] },
    "hscExtension":      { "pass": true,  "checks": 1, "passed": 1, "errors": [] },
    "behavioralHonesty": { "pass": true,  "checks": 1, "passed": 1, "errors": [] }
  },
  "verdict": "PASS",
  "errors": [ /* flattened across all layers, for badge readers */ ],
  "generatedAt": "2026-06-19T00:00:00.000Z"
}
```

Every error entry is **located**:

```jsonc
{ "code": "fabricated-event", "message": "…", "path": "/turns/0/events/2/harness.event_type",
  "layer": "behavioralHonesty", "severity": "error" }
```

**Invariant:** the report is parsed against `ConformanceReportSchema` before it is returned, and the schema enforces that `verdict: "PASS"` is impossible while any layer's `pass` is `false`. A green badge therefore cannot exist without three green layers.

## The three layers

| Layer | What it checks | Shape sensitivity |
|---|---|---|
| `otelValidity` | OTLP/JSON envelope + `gen_ai.*` conventions | **Hard** only for OTLP-shaped input; for a turns/events trace it records a single advisory `not-otlp` **WARN** and passes |
| `hscExtension` | HSC v0 JSON Schema + every event carries `harness.event_type` + principle/quadrant predicates match the canonical bindings | Operates on the turns/events shape |
| `behavioralHonesty` | **Negative rules only** — prohibited inference, fabricated event. Never positive-requires an event to be present | Operates on the turns/events shape |

## MUST vs SHOULD: what blocks the badge

| Tier | Severity | Effect on badge |
|---|---|---|
| **MUST** (validity + honesty) | `error` | **Blocks** the badge — any `error`-severity entry in `otelValidity`/`hscExtension`/`behavioralHonesty` flips the layer (and the verdict) to FAIL |
| **SHOULD** (coverage) | `warn` | **Advisory** — low/partial event coverage is a WARN, not a failure. Absence is signal: an honestly-absent event never reduces the verdict |

In short: **validity and honesty are MUST and block the badge; coverage is SHOULD and only warns.** A minimal-but-honest adapter (e.g. one that emits only `tool.call`) can earn a PASS badge — its low coverage is surfaced as a warning, never masked.

## The self-declared badge

`emitBadge(report, { eventCoverage })` derives a badge — a strict subset of the report plus a `reportRef` back to it:

```jsonc
{
  "label": "HSC v0",
  "hscVersion": "v0",
  "suiteVersion": "0.1.0",
  "verdict": "PASS",
  "adapter": { "name": "@lucid/adapter-openai-agents", "hscVersion": "v0" },
  "eventCoverage": ["context.load", "plan.emit", "tool.call"],
  "reportRef": { "hscVersion": "v0", "suiteVersion": "0.1.0", "verdict": "PASS",
                 "generatedAt": "…", "errorCount": 0 }
}
```

- **Keyed to the HSC version.** The label reads `HSC v0`; a badge is always scoped to the spec version it was produced against (see the [versioning policy](../standard/versioning-policy.md)).
- **FAIL is never masked.** `emitBadge` on a FAIL report returns a badge with `verdict: "FAIL"` (it does not throw, it does not pretend). Repudiation resistance: the honest verdict is carried, not hidden.
- **Coverage is shown, not used to gate.** `eventCoverage` is surfaced so adopters see breadth before trusting the badge — a low value is a warning in the report, not a downgraded badge.

## How a re-verifier confirms a badge

The badge is only as good as a re-run. Any adopter or auditor:

1. Obtains the adapter's published trace (or drives the adapter themselves on the public surface).
2. Runs `runConformanceSuite` **offline** with the badge's `hscVersion` + `suiteVersion`.
3. Compares the resulting `verdict` + `errorCount` against the badge's `reportRef`.

If they disagree, the badge is stale or wrong — and the discrepancy is itself machine-detectable. No network call, no registry, no authority required.

## Reference

- Authoring + fixing: [`adapter-authoring.md`](adapter-authoring.md).
- Versioning of the suite + badge: [`../standard/versioning-policy.md`](../standard/versioning-policy.md).
- Compliance evidence (a different artifact): [`compliance-export.md`](compliance-export.md).
