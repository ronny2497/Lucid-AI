# 01 — Core Concepts & Vocabulary

This document defines the vocabulary every other document uses. Read it once; everything else assumes it.

> **Developer lens.** Each concept below ends with a **"For the developer"** note: what this concept *means in practice* when you sit down to use Lucid. All code/CLI/config shown is **illustrative proposed design**, not yet implemented — it exists to pin down the intended developer experience.

---

## 1. Harness

The **harness** is the engineered scaffold around a model: the loop, the context assembly, the tool registry, the planner, the verifier, the memory, the skills, the checkpoints. It is everything that turns "a model" into "an agent that reliably does work."

- The **model** is a swappable component.
- The **application** (a sales assistant, a coding agent) is what the harness is used *for*.
- The **harness** is the part Lucid observes and improves.

**For the developer:** you already have a harness, whether you call it that or not — your agent loop *is* a harness. Lucid does not ask you to rewrite it. You *instrument* it (emit events) and Lucid does the rest.

---

## 2. The Five Convergence Principles (the discipline / the spine)

The field independently converged on five principles. They are Lucid's scoring spine.

| # | Principle | What it means | The failure when it's missing |
|---|---|---|---|
| 1 | **Context** | Load the right tokens at the right time. | Context bloat or starvation; wrong-answer-from-wrong-context. |
| 2 | **Plan + Execute** | Separate intent from action; one thing per step. | Agent acts before it reasons; tangled multi-goal steps. |
| 3 | **Feedback** | Verify after execution. | The agent never checks whether its action worked. (Most common, highest-leverage gap.) |
| 4 | **One Thing at a Time** | Vertical slices, incremental commits. | Big-bang changes that can't be verified or rolled back. |
| 5 | **Codebase = Docs** | Encode tacit knowledge into durable artifacts. | Knowledge lives in someone's head / a Slack thread; the agent can't see it. |

**For the developer:** these five are the *axes of your scorecard*. When Lucid tells you "Feedback: 0.2," it means 80% of your state-mutating actions had no verification step — a specific, fixable thing, not a vague "quality" number.

---

## 3. The 2×2 (the diagnostic frame)

Two axes, from the Thoughtworks framing:

- **Horizontal: feedforward ↔ feedback.** Does the control happen *before* action (feedforward: planning, context-shaping) or *after* action (feedback: verification, evaluation)?
- **Vertical: computational ↔ inferential.** Is the control a *deterministic* mechanism (computational: a schema check, a gate, a diff) or a *model-judged* one (inferential: an LLM evaluator, a reflection step)?

```
                 COMPUTATIONAL (deterministic)
                          │
   feedforward            │            feedback
   • schema-validated     │   • change_manifest diff
     context assembly     │   • test/CI gate
   ───────────────────────┼───────────────────────
   • LLM planner          │   • LLM evaluator / reflection
   • intent extraction    │   • self-critique
                          │
                 INFERENTIAL (model-judged)
```

The recurring real-world finding: **the right column (feedback) is empty.** Teams build elaborate feedforward control and almost no feedback control. Lucid plots every run on this grid and makes the empty quadrant visible.

**For the developer:** after a run, you open the dashboard and literally see your harness's dots clustered on the left (feedforward) with nothing on the right (feedback). That picture *is* the diagnosis.

---

## 4. The Harness Trace (the load-bearing data abstraction)

Everything Lucid does hangs off one structure: the **Harness Trace** — a stream of typed, principle-tagged events for one harness turn or session.

```
HarnessTrace
└── Turn[]
    └── Event
        ├── type:      context.load | plan.emit | task.slice | tool.call |
        │              feedback.check | verify.result | doc.encode |
        │              evolve.propose | evolve.apply | error
        ├── principle: context | plan_execute | feedback | one_at_a_time | codebase_docs
        ├── quadrant:  { x: feedforward|feedback, y: computational|inferential }
        ├── attrs:     { tokens, cost, latency_ms, model, tool, mutated_state?, ... }
        └── refs:      parent_event_id, harness_version, agent_id
```

**Design rule — absence is signal.** If a harness has no explicit feedback step, the adapter emits *nothing* for `feedback.check` — and that **absence** is exactly the empty-quadrant diagnostic. Lucid never *guesses* a missing event into existence. (Implicit inference, where offered, is a separate, clearly-labeled, lower-confidence layer.)

**For the developer:** you emit these events from your harness (often automatically via an adapter — see §6). A `tool.call` that mutates state with no following `verify.result` is what produces the "missing feedback" finding. You don't compute the diagnosis; you just emit honest events and Lucid computes it.

```ts
// ILLUSTRATIVE proposed SDK — not yet implemented
import { harness } from "@lucid/sdk";

await harness.event("tool.call", {
  tool: "db.write",
  attrs: { mutated_state: true },
});
// ... no verify.result follows → Lucid flags the empty feedback quadrant
```

---

## 5. Harness Semantic Conventions (HSC) — the standard

**HSC** is the open, OpenTelemetry-compatible vocabulary that defines the event types, the `harness.*` attributes, and the `(principle, quadrant)` tagging rules. It is what makes Lucid *framework-neutral*: any harness that emits HSC is observable by Lucid, and any backend that understands HSC can consume it. See [`standard/hsc-overview.md`](standard/hsc-overview.md).

**For the developer:** HSC is the contract. You either (a) use a prebuilt **adapter** for your framework, or (b) emit HSC yourself via the SDK. Either way you're emitting OpenTelemetry under the hood, so your existing OTel collector/backend already works.

---

## 6. Adapters & the SDK (how a harness emits HSC)

- An **adapter** auto-instruments a known framework (e.g. a hermes-agent adapter, a LangGraph adapter, a Claude-Code adapter). Drop it in; it emits HSC for you.
- The **SDK** is the manual path: you call `harness.event(...)` (or use decorators/wrappers) where adapters don't reach.

**For the developer — the seam that matters:** the goal is *near-zero* instrumentation effort for supported frameworks (install adapter → done) and *low, incremental* effort otherwise (wrap your loop, add events where you have them). You should be able to get your first trace flowing in minutes, then enrich it over time.

---

## 7. The two evaluation layers

1. **Base metrics** — framework-neutral, conventional: task success, cost, latency, token efficiency, tool-error rate.
2. **Principle/2×2 diagnostic** — the differentiator: per-principle scores + the 2×2 plot + named structural findings ("38% of state-mutating tool calls had no verification").

**For the developer:** base metrics tell you *that* something regressed; the diagnostic tells you *which principle* and *where*, so you know what to change.

---

## 8. The Self-Evolution Engine & the Autonomy Ladder

One engine, one config knob, three opt-in capability tiers — all human-governed by default:

| Level | Capability | Blast radius |
|---|---|---|
| **L0** | Diagnose + **recommend** typed change-sets | Zero (advisory) |
| **L1** | **Auto-apply** structural edits (prompts/skills/config/context-policy) behind gates + rollback | Harness structure |
| **L2** | **Weight-level** learning via GRPO (optional Python `TrainerPlugin`) | Model weights |

**For the developer:** this is a setting. You choose the level; nothing escalates without your configuration. At L0 you get a PR-like proposal you approve. At L1 Lucid applies it behind a gate and can roll back. At L2 (only if you self-host weights) it can train.

```yaml
# ILLUSTRATIVE proposed config — not yet implemented
evolution:
  autonomy: L1            # L0 | L1 | L2
  require_human_approval: true
  rollback: auto
  trainer: null           # set to a TrainerPlugin only for L2
```

---

## 9. Change-set & change_manifest

The unit of harness improvement. A **typed change-set** (`add-gate`, `trim-context`, `edit-skill`, `prompt-patch`, `delete-layer`) is proposed as a **`change_manifest`** — a falsifiable contract describing what will change and the expected effect on principle scores.

**For the developer:** this is the diff you review. It reads like a PR: "Add a `verify.result` gate after `db.write`; expected Feedback score +0.4." You approve or reject.

---

## Glossary (quick reference)

- **Harness** — the engineered scaffold around a model.
- **Application** — what the harness is used for (the top layer).
- **HSC** — Harness Semantic Conventions; the open standard.
- **Harness Trace** — the principle-tagged event stream Lucid consumes.
- **Adapter** — auto-instrumentation for a known framework.
- **Diagnostic** — the principle/2×2 scoring layer.
- **Autonomy Ladder** — L0/L1/L2 self-evolution levels.
- **Change-set / change_manifest** — a proposed, falsifiable harness improvement.
- **TrainerPlugin** — the swappable boundary to a (Python) weight-level trainer.
