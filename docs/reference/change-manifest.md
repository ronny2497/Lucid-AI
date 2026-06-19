# `change_manifest` Reference

The `change_manifest` is the load-bearing artifact of the self-evolution plane: a
typed, versioned, **falsifiable** proposal that turns a Phase 2 diagnosis into a
PR-like recommendation. It is produced by `lucid evolve propose`, emitted as an
`evolve.propose` HSC audit event, and persisted so it can be listed and reviewed.

At **L0 (Recommend)** a manifest is *advisory only* — accepting it records a
decision and applies nothing. The schema below matches the shipped
`@lucid/evolution` code (`packages/evolution/src/schema.ts`), not just an
illustrative sketch.

## Field reference

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` (`cm-…`) | Stable, short, human-readable id. Derived deterministically from the manifest content, so the same finding yields the same id. |
| `schema_version` | `"1"` | Pinned to `"1"` at L0. Phase 4 bumps to `"2"` when `detail` becomes machine-parseable. |
| `target` | `string` | `"agent-id@harness-version"`, e.g. `my-agent@v37`. Encodes the **pre-apply baseline** the diagnosis ran against — the version the falsifiability loop diffs from. |
| `change` | enum | One of the five change kinds (below). The closed L0 taxonomy. |
| `detail` | `string` | A precise, **verbatim-applicable** instruction. Prose + tool *names* + counts only — **never raw trace content** (no prompt text, no tool arguments). |
| `rationale` | `string` | Why the change is recommended, citing the finding. |
| `evidence_ref` | `string` | Back-link to the originating finding, e.g. `lucid://findings/F1`. |
| `expected_effect` | object | The falsifiable prediction — per-principle score deltas (below). |
| `status` | enum | Lifecycle status (below). |
| `estimator` | enum | How `expected_effect` was produced: `rule-based` (default) or `llm-assisted`. The reviewer sees this; it matters for calibration. |
| `review_note` | `string?` | Optional reviewer annotation, set when a decision is recorded. |
| `generated_at` | `string` | ISO 8601 timestamp. |

## The five change kinds (closed taxonomy)

A manifest's `change` is exactly one of these — a sixth kind cannot be proposed at
L0:

| Kind | Meaning |
|------|---------|
| `add-gate` | Insert a verify/gate step after a mutating operation (e.g. a `verify.result` after a state-mutating `tool.call`). |
| `trim-context` | Reduce the context window or remove stale context sources. |
| `edit-skill` | Modify the content of an existing skill definition. |
| `prompt-patch` | Patch a prompt template. |
| `delete-layer` | Remove a harness layer that is no longer earning its keep — the discipline of *removing* harness as models improve. |

## `expected_effect` — the falsifiability rule

`expected_effect` is a per-principle map of **predicted score deltas**, keyed by the
five canonical principles (`context`, `plan_execute`, `feedback`, `one_at_a_time`,
`codebase_docs`). Each value is a number (or omitted/`null` for "no change
predicted"):

```yaml
expected_effect:
  feedback: +0.3   # predicted +0.30 lift on the Feedback principle
```

**A manifest MUST contain at least one non-null principle delta.** An empty
`expected_effect` is *unfalsifiable* — it makes no checkable prediction — and is
rejected at parse time. Even a conservative `+0.05` is better than nothing: it
makes the change accountable. The keys are the same names as
`DiagnosticResult.principles[].principle`, so the predicted delta compares
like-for-like against the observed delta on re-run.

## `status` lifecycle

```
proposed ──▶ accepted        (L0: lucid evolve review --accept)
         └─▶ rejected        (L0: lucid evolve review --reject)

accepted ──▶ applied         (Phase 4 / L1 ONLY — not reachable at L0)
```

At **L0** the only transitions are `proposed → accepted | rejected`. `--accept`
sets `status: accepted` and **applies nothing** — you apply the change by hand.
The `applied` status is reserved for **Phase 4 (L1)**, the gated auto-apply path;
the L0 review code refuses to set it. This is the zero-blast-radius boundary,
enforced in code, not just convention.

## The falsifiability loop

A proposal is advisory, but accountable. The full loop:

1. `lucid evolve propose --finding F1 --from diagnostic.json` emits a manifest with,
   e.g., `expected_effect: { feedback: +0.3 }`.
2. You **apply the change by hand** to your harness (L0 — manual only).
3. You re-run your harness to emit a new trace at the next harness version.
4. `lucid diagnose` runs on the new trace → a new `DiagnosticResult`.
5. `lucid diff` compares the two versions and reports the **actual** per-principle
   delta.
6. You check the actual delta against the manifest's `expected_effect` — did the
   score move in the predicted direction by roughly the predicted magnitude?

The directional check (predicted vs. observed) is what makes the recommendation
falsifiable rather than a guess, and it is the origin of `expected_effect`
calibration data over time.

## See also

- [Configuring Self-Evolution](../guides/configuring-self-evolution.md) — the L0/L1/L2 guide and the live `lucid evolve` commands.
- The schema source: `packages/evolution/src/schema.ts`.
