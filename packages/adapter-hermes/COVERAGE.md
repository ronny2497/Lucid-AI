# @lucid/adapter-hermes → HSC v0 coverage

> **Status:** hermes REFERENCE adapter coverage (TypeScript, reference/test-only).
> Its purpose is to exercise the **full 10-event HSC taxonomy** so the store, the
> explorer, and the Phase 2 detectors have at least one of every event type to
> read — and to demonstrate BOTH feedback shapes (a checked mutation and the
> honest empty-feedback case). It is reference/test-only and lives under
> `packages/adapter-hermes/`; nothing hermes-specific leaks into `@lucid/sdk` or
> `@lucid/hsc-schema` (D-07).

The canonical event-type strings, principles, quadrant table, and `harness.*` /
`gen_ai.*` attribute paths come from `@lucid/hsc-schema`. The adapter maps hermes
lifecycle points to HSC event types in `src/mapping.ts` and emits through
`@lucid/sdk` (`src/index.ts`).

> **Distinction from the Phase 0 Python baseline.** The Phase 0 reference adapter
> (`adapters/hermes/hsc_adapter.py`) captured a *real hermes-agent baseline*, in
> which `task.slice`, `feedback.check`, `verify.result`, `doc.encode`,
> `evolve.propose`, and `evolve.apply` were **honest expected-absences** (hermes
> exposes no such hooks). This TypeScript adapter is a different artifact: a
> *reference exerciser* whose job is full-taxonomy coverage, so it emits all 10.
> The empty-feedback signal is preserved here as a *trailing mutating `tool.call`
> with no following `verify.result`* — not as a missing event type.

---

## Per-event coverage (all 10 HSC v0 event types — all emitted)

| HSC event type | disposition | hermes lifecycle point | Notes |
|---|---|---|---|
| `context.load`   | **emitted** | `context_assembled` | Carries `gen_ai.usage.input_tokens` (token count). |
| `plan.emit`      | **emitted** | `reasoning_step` | The plan / next step surfaced from reasoning. |
| `task.slice`     | **emitted** | `task_sliced` | A vertical slice of work. |
| `tool.call`      | **emitted** | `tool_invoked` | `harness.mutated_state=true` for `FILE_MUTATING_TOOL_NAMES = {write_file, patch}`; reuses `gen_ai.tool.name`. The reference run emits two mutating tool.calls — one checked, one unchecked. |
| `feedback.check` | **emitted** | `feedback_checked` | quadrant.y is **emitter-specified** (the caller supplies it; the SDK never auto-assigns it). |
| `verify.result`  | **emitted** | `verification_ran` | Follows the FIRST mutating `tool.call` — the populated-feedback case. quadrant.y may be computational or inferential (spec §6.2). |
| `doc.encode`     | **emitted** | `knowledge_written` | A durable-knowledge write as a distinct event. |
| `evolve.propose` | **emitted** | `evolution_proposed` | A proposed self-modification. |
| `evolve.apply`   | **emitted** | `evolution_applied` | An applied self-modification. |
| `error`          | **emitted** | `errored` | Cross-cutting (spec §3.3); carries no principle binding of its own — tagged `feedback` to satisfy the schema's required `harness.principle` while the conformance predicate skips the principle check for `error`. Quadrant x/y are null. |

### Coverage summary

All **10** HSC event types are emitted by the reference adapter — that is its
purpose. The coverage set is derived from the mapping VALUES
(`COVERED_EVENT_TYPES` in `src/mapping.ts`), so it cannot drift from the mapping.

### Both feedback shapes (D-05)

The reference trajectory (`runReferenceTrajectory`) deliberately exercises both:

1. **Checked mutation (populated feedback):** a `tool.call{mutated_state:true}`
   (`write_file`) FOLLOWED BY a `verify.result`.
2. **Honest empty-feedback case:** a second `tool.call{mutated_state:true}`
   (`patch`) with **NO following `verify.result`** — the trailing mutation. Per
   the Phase 2 Feedback detector (`docs/standard/eval-rubric.md` §2.3), the
   fraction of mutating tool.calls followed by a verify.result is `1/2` for this
   trajectory: the populated case and the honest absence coexist. The absence is
   real (a missing trailing verify.result), never fabricated away.
