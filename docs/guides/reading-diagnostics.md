# Reading Diagnostics

> **Illustrative.** Defines the intended developer experience; not yet implemented.

Lucid gives you two layers of output. This guide explains how to read both and turn them into action.

## Layer 1 — Base metrics (the "what")
```bash
# ILLUSTRATIVE
lucid metrics --agent my-agent --since 24h
# success 0.92 · cost $0.41/run · p50 1.2s · p95 4.8s · tokens 18.4k · tool-error 3%
```
These tell you **that** something changed. They are framework-neutral and conventional. Use them for regressions, cost, and SLOs — not for *why*.

## Layer 2 — The principle/2×2 diagnostic (the "why" and "where")
```bash
# ILLUSTRATIVE
lucid diagnose --agent my-agent
```
```
Principle scorecard
  Context        0.81
  Plan+Execute   0.74
  Feedback       0.18   ⚠
  One-at-a-time  0.66
  Codebase=Docs  0.90

Findings
  [F1] 38% of state-mutating tool calls (db.write, api.post) had no verify.result   → principle: feedback
  [F2] Context window exceeded 80% of budget in 22% of turns                         → principle: context

2×2
  COMPUTATIONAL
   feedforward: ●●●        feedback: (empty)
  INFERENTIAL
   feedforward: ●●         feedback: ●
```

### How to read each part
- **Scorecard:** 0–1 per principle. A low score is not "bad quality" in the abstract — it maps to specific events (or their absence).
- **Findings:** the actionable items. Each names the principle, the evidence, and (in the UI) a proposed remediation.
- **2×2:** the *picture* of your harness's control surface. The classic pattern is a full left column (feedforward) and an empty right column (feedback). An empty quadrant is a roadmap, not just a grade.

## From diagnosis to action
1. **Sort by leverage.** Feedback gaps are usually highest-leverage; start there.
2. **Read the finding's evidence.** F1 above points at exact tools (`db.write`, `api.post`).
3. **Choose how to fix:**
   - **By hand** — add a verification step after those calls.
   - **With Lucid (L0)** — `lucid evolve propose` generates a reviewable change_manifest. See [Configuring Self-Evolution](configuring-self-evolution.md).
4. **Verify the fix.** Re-run and diff:
   ```bash
   lucid diff --agent my-agent --from v37 --to v38
   # Feedback 0.18 → 0.61 (+0.43) ✓ as predicted
   ```

## Cohort & version diffing (the Build-to-Delete workflow)
```bash
# ILLUSTRATIVE
lucid diff --agent my-agent --from v37 --to v38
```
Use this to answer "did removing a harness layer help or hurt?" — the discipline of *deleting* harness, not only adding it. Tag `harness.version` on your events to enable this.

## Reference
- The principles & 2×2: [`../01-concepts.md`](../01-concepts.md)
- What feeds the diagnostic: [`../standard/hsc-overview.md`](../standard/hsc-overview.md)
