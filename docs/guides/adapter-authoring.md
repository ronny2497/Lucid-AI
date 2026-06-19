# Authoring & Certifying an Adapter

> **Audience:** you maintain (or use) an agent framework that has no prebuilt Lucid adapter, and you want to publish one. This is the **unaided onramp** (REQ-07): everything here is reachable with the **public** `@lucid/adapter-sdk` + `@lucid/hsc-schema` packages and the published `@lucid/conformance` suite. You never need core-team help, and you never reach into Lucid internals.
>
> **Command labels:** lines marked **REAL** are exported APIs you can call today. Lines marked **ILLUSTRATIVE** describe the intended CLI experience and may still be evolving (consistent with the [guides README](README.md) convention).

An adapter maps **your framework's observable lifecycle** onto **HSC events**. The whole contract is: emit what your framework genuinely does, omit what it doesn't, and never invent the difference. The conformance suite then certifies that your adapter is honest.

There are three shipped adapters to read as worked examples:

- **hermes** — the reference adapter (full lifecycle, including verification).
- **`@lucid/adapter-langgraph`** — a neutral adapter over LangGraph's OTel spans; emits **no** `verify.result`/`feedback.check` because LangGraph has none.
- **`@lucid/adapter-openai-agents`** — the third community adapter, authored **entirely** on the public SDK surface as the [EC-1](../standard/hsc-overview.md) proof. Read its `src/adapter.ts` end-to-end: it is the smallest complete worked example of this guide.

---

## The five steps

```
scaffold ──▶ map lifecycle ──▶ run conformance ──▶ read + fix ──▶ emit badge
```

### 1. Scaffold

```bash
# ILLUSTRATIVE — the adapter scaffolder
npx @lucid/adapter-sdk init @lucid/adapter-myframework
```

The scaffolder emits a runnable adapter stub, a `manifest.json`, and a fixture (see `scaffoldAdapter` in `@lucid/adapter-sdk`). You can also start by copying `@lucid/adapter-openai-agents` — its `package.json` is the canonical shape:

- `type: module`, license `Apache-2.0`, `exports → dist`;
- **dependencies:** `@lucid/adapter-sdk` + `@lucid/hsc-schema` **only** — nothing else from Lucid;
- the framework SDK is an **optional `peerDependency`** (the adapter stays installable and testable without it);
- `@lucid/conformance` is a **devDependency** used only by your certify test.

> **Do not** add `@lucid/sdk-internal` or import `@lucid/conformance` from your adapter source. The whole point of EC-1 is that the public surface is sufficient. The conformance suite is imported only by your *test*.

### 2. Map your framework lifecycle to HSC events

Declare one hook per lifecycle moment your framework genuinely exposes, using `defineAdapter` (**REAL**, from `@lucid/adapter-sdk`):

```ts
// REAL — public surface only
import { defineAdapter } from "@lucid/adapter-sdk";

export const adapter = defineAdapter({
  name: "@lucid/adapter-myframework",
  version: "0.0.0",
  framework: "myframework@1.x",
  targets: "v0", // the HSC spec version you target
  honestAbsences: ["verify.result", "feedback.check"], // events your framework LACKS
  onContextLoad: (ctx) =>
    ctx.emit({ substantiated: true, attrs: { principle: "context" } }),
  onPlanEmit: (ctx) =>
    ctx.emit({ substantiated: true, attrs: { principle: "plan_execute" } }),
  onToolCall: (ctx) =>
    ctx.emit({ substantiated: true, attrs: { principle: "plan_execute" } }),
  // onVerify / onFeedbackCheck NOT declared — honest absence.
});
```

Every `ctx.emit(...)` routes through the **emit-or-omit** gate (D-05). The gate enforces honesty in code, not docs:

- `substantiated: false` (or not calling `emit` at all) ⇒ **nothing is emitted**. The absence is the signal.
- `inferred: true` is permitted **only** for the two feedforward events `context.load` and `plan.emit`. Marking any other event inferred ⇒ the gate rejects it.

> **Absence is signal — the load-bearing rule.** If your framework has no verification step, do **NOT** synthesize a `verify.result`. List it in `honestAbsences` instead. A mutating `tool.call` with no following verification is a **fully conformant** trace — the missing verification is exactly the finding Lucid surfaces. Faking it to "look complete" is the single failure the conformance suite is built to catch (see step 4 and the [badge guide](conformance-badge.md)).

`toManifest()` (**REAL**) assembles and validates your `manifest.json` against `AdapterManifestSchema`; an invalid declaration (unknown event type, or an event listed in both `eventCoverage` and `honestAbsences`) throws loudly rather than shipping a malformed manifest.

### 3. Run the conformance suite

Drive your adapter over a representative run to produce an HSC trace, then run the published three-layer suite over it.

```bash
# ILLUSTRATIVE — the conformance CLI
lucid conformance --adapter ./my-trace.json
```

```ts
// REAL — the suite API your certify test calls
import { runConformanceSuite, emitBadge } from "@lucid/conformance"; // see note below
const report = runConformanceSuite(trace, { hscVersion: "v0", adapter: { name, hscVersion: "v0" } });
```

> **Note on imports.** `runConformanceSuite` and `emitBadge` live in `@lucid/conformance` (`src/suite.ts`, `src/badge.ts`). Reference them at the path your installed version exposes — the `@lucid/adapter-openai-agents` certify test (`test/certify.test.ts`) shows a working import. `validateTrace` is available from the package root.

The suite runs three independent layers:

1. **`otelValidity`** — OTLP envelope + `gen_ai.*` checks (advisory for the turns/events trace shape).
2. **`hscExtension`** — schema + structural + principle/quadrant predicates.
3. **`behavioralHonesty`** — negative honesty rules only (prohibited inference, fabricated event). It **never** requires an event to be *present*.

The verdict is **PASS** only when all three layers pass.

### 4. Read the report and fix

The report is machine-readable (`ConformanceReport`) — see the [conformance-badge guide](conformance-badge.md) for its shape and the MUST-vs-SHOULD tiers. Each error carries a `code`, a `layer`, and a JSON-pointer-ish `path` into the offending event, so a failure is **located**, not a vague "invalid". Typical first-run findings:

| Code | Meaning | Fix |
|---|---|---|
| `wrong-principle` / `wrong-quadrant-x` / `wrong-quadrant-y` | A tag doesn't match the canonical binding | Source principle/quadrant from `@lucid/hsc-schema` (`EVENT_PRINCIPLE`, `quadrantFor`) — never hand-assign |
| `fabricated-event` | You emitted a `verify.result`/`feedback.check` your framework didn't substantiate | Delete it; declare the absence in `honestAbsences` |
| `prohibited-inference` | `harness.inferred=true` on a non-feedforward event | Only `context.load`/`plan.emit` may be inferred |
| `schema-invalid` | A trace field violates the HSC v0 schema | Match the [HSC overview](../standard/hsc-overview.md) attribute paths |

### 5. Emit the badge

```bash
# ILLUSTRATIVE
lucid conformance --adapter ./my-trace.json --emit-badge
```

```ts
// REAL
const badge = emitBadge(report, { eventCoverage: adapter.toManifest().eventCoverage });
```

The badge is a **self-declared** claim keyed to the HSC version (e.g. `HSC v0`). It carries the verdict verbatim — a FAIL report yields a FAIL badge; it is never masked. Anyone can re-run the offline suite to re-verify it. See the [conformance-badge guide](conformance-badge.md).

---

## The DX target (PRD §7)

- **Supported framework:** install adapter → first trace in **minutes**, zero agent rewrites.
- **Your framework:** scaffold → map the moments you have → certify → publish a badge, all on the public surface, no core-team involvement.
- **Never fake events.** Partial coverage yields partial value; a fabricated event fails certification.

## Reference

- Public authoring surface: `@lucid/adapter-sdk` (`defineAdapter`, `emit-or-omit`, `AdapterManifestSchema`).
- Worked example: `packages/adapter-openai-agents/src/adapter.ts` + `test/certify.test.ts` (the EC-1 path).
- Event types & attributes: [`../standard/hsc-overview.md`](../standard/hsc-overview.md).
- Badge & report: [`conformance-badge.md`](conformance-badge.md). Compliance export: [`compliance-export.md`](compliance-export.md).
