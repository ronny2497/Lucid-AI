# Instrumenting Your Harness

> **Illustrative.** Defines the intended developer experience; not yet implemented.

There are three ways to emit Harness Semantic Conventions (HSC). They trade effort for control. You can mix them.

## The three paths

| Path | Effort | When to use |
|---|---|---|
| **Adapter** | Near-zero | Your framework has a prebuilt adapter (hermes, LangGraph, Claude Code, …). |
| **SDK** | Low, incremental | Custom/hand-rolled harness; you emit events where you have them. |
| **Raw OTel** | Advanced | You already emit OpenTelemetry and want to add `harness.*` attributes directly. |

---

## Path 1 — Adapter (recommended when available)
```bash
# ILLUSTRATIVE
npm i @lucid/adapter-langgraph
```
```ts
import { withLucid } from "@lucid/adapter-langgraph";
const instrumented = withLucid(yourGraph, { agentId: "my-agent" });
```
The adapter maps your framework's lifecycle to HSC events automatically. Check the adapter's README for which events it emits and which it can't (those become honest *absences*).

---

## Path 2 — SDK (the incremental path)
Start small. Even emitting only `tool.call` events yields the feedback diagnostic.
```ts
// ILLUSTRATIVE
import { harness } from "@lucid/sdk";

// 1. Context assembly
await harness.event("context.load", { principle: "context", attrs: { tokens: 1840, sources: ["docs", "memory"] } });

// 2. Planning before acting
await harness.event("plan.emit", { principle: "plan_execute", attrs: { steps: 3 } });

// 3. Acting (mark state mutation!)
const span = harness.start("tool.call", { principle: "plan_execute", attrs: { tool: "db.write", mutated_state: true } });
// ... do the work ...
span.end();

// 4. Verifying after acting (this is the high-leverage one most harnesses skip)
await harness.event("feedback.check", { principle: "feedback" });
await harness.event("verify.result", { principle: "feedback", attrs: { passed: true } });
```

### The single most valuable attribute: `mutated_state`
Mark any `tool.call` that changes the world (`mutated_state: true`). A mutating call with no following `verify.result` is exactly what produces the empty-feedback-quadrant finding. If you instrument nothing else, instrument this.

---

## Path 3 — Raw OpenTelemetry (advanced)
Because HSC is OTel-compatible, you can emit OTel spans with `harness.*` attributes directly and skip the SDK:
```ts
// ILLUSTRATIVE
span.setAttribute("harness.event_type", "verify.result");
span.setAttribute("harness.principle", "feedback");
span.setAttribute("harness.quadrant.x", "feedback");
span.setAttribute("harness.quadrant.y", "computational");
```
Validate your output against the standard:
```bash
lucid conformance --trace ./sample-trace.json
```

---

## Coverage and honesty
- **Partial is fine.** Instrument incrementally; partial coverage yields partial diagnostics.
- **Never fake events.** If your harness has no planning step, don't emit `plan.emit`. The absence is the finding.
- **Tag the harness version** (`harness.version`) so Lucid can diff v_n vs v_{n+1} — essential for the Build-to-Delete workflow (did removing a layer help or hurt?).

## Reference
- Event types & attributes: [`../standard/hsc-overview.md`](../standard/hsc-overview.md)
- Concepts: [`../01-concepts.md`](../01-concepts.md)
