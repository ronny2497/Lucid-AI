# 04 — Roadmap (Phased Decomposition)

This is the build sequence. **No code exists yet**; this stage is foundations + PRDs. Each phase is a **vertical slice** — it cuts through standard → ingest → eval → surface and delivers standalone value — and has a **falsifiable exit criterion**. Detailed PRDs live in [`/prd`](../prd).

The locked foundational decisions ([ADR-0001..0004](03-decisions/)) apply throughout: OTel-compatible HSC, TypeScript primary, Apache-2.0, Python GRPO behind `TrainerPlugin`.

---

## Pillars → principle → reference → source

| Pillar | Convergence principle | Reference (hermes-agent, for testing only) | Source |
|---|---|---|---|
| P1 HSC standard | cross-cutting | Context References, Agent Transports/Diagnostics | OpenAI Codex legibility; OTel GenAI conventions |
| P2 Ingestion + store | — | Agent Runtime / Trajectory / Metrics | LangSmith pattern |
| P3 Base metrics | Plan+Execute, One-at-a-Time | Metrics, Skill Usage Tracking | agent-eval literature |
| P4 Principle/2×2 diagnostic | all five (esp. Feedback) | Memory/Profiles, Context References, Tool Catalog | 5 Convergence Principles; Thoughtworks 2×2; AHE |
| P5 Self-Evolution | Feedback + Build-to-Delete | GRPO Training, Curator, Checkpoint Manager, Skills Hub | AHE / NexAU; auto-research; GRPO |
| P6 Governance/conformance | Codebase=Docs | Secret Redaction, Security Advisories | EU AI Act; AHE change_manifest |

---

## Phases

### Phase 0 — Foundations & the standard *(spec, no UI)* → [PRD](../prd/phase-0-foundations-standard.md)
Author **HSC v0** (event taxonomy, JSON Schema, principle/quadrant tagging, `harness.*` ↔ OTel mapping). Decide the OTel transport profile. Build the **hermes-agent reference adapter**. Define the eval rubric formally.
**Exit:** a real hermes-agent run emits a valid HSC trace, stored as JSON, hand-inspectable.
**Developer value:** the contract a developer will emit against is fully specified and demonstrated end-to-end on one real harness.

### Phase 1 — Ingestion + trace store + read-only explorer *(the core)* → [PRD](../prd/phase-1-ingestion-trace-store.md)
Collector/SDK; trace store; trace explorer UI; complete hermes adapter; add **one neutral adapter** (Claude Code *or* LangGraph) to prove neutrality; ship the **base metrics layer**.
**Exit:** instrument a real third-party agent, view its traces + base metrics in the UI.
**Developer value:** "install adapter → see my agent's traces and base metrics in minutes."

### Phase 2 — The diagnostic layer *(the differentiator)* → [PRD](../prd/phase-2-diagnostic-layer.md)
**Principle scorers** (rules + LLM-judge) and the **2×2 plotter**; the **empty-feedback-column** detector; **version & cohort diffing** (Build-to-Delete use case).
**Exit:** load a real harness → 2×2 + principle scorecard + ≥1 actionable diagnostic with remediation.
**Developer value:** "run `lucid diagnose` and get told exactly which principle is failing and where."

### Phase 3 — Self-Evolution **L0: recommend-only (HITL)** → [PRD](../prd/phase-3-self-evolution-L0-recommend.md)
Diagnosis → **typed change-sets** (`add-gate`, `trim-context`, `edit-skill`, `prompt-patch`, `delete-layer`) as **`change_manifest`**; human review/approval UI; predicted score delta.
**Exit:** Lucid proposes a real change → human applies → re-run shows the predicted score movement.
**Developer value:** "get a PR-like proposal I can read, approve, and apply by hand."

### Phase 4 — Self-Evolution **L1: auto-apply structural (gated)** → [PRD](../prd/phase-4-self-evolution-L1-autoapply.md)
Auto-apply change-sets to config/prompts/skills/context-policy behind approval gates with **rollback + A/B + regression guard**; the **autonomy-config surface**.
**Exit:** closed structural loop with rollback proven against an injected regression.
**Developer value:** "let Lucid fix structural gaps automatically, safely, with one config flag and a kill-switch."

### Phase 5 — Self-Evolution **L2: weight-level (GRPO)** → [PRD](../prd/phase-5-self-evolution-L2-grpo.md)
Trajectory → reward pipeline; the **`TrainerPlugin`** contract; Python GRPO reference sidecar (TRL + vLLM); eval gates before weight promotion.
**Exit:** a GRPO run driven by Lucid-collected trajectories improves a target metric on a held-out eval, gated before promotion.
**Developer value:** "for self-hosted models, turn observed trajectories into a better model, gated and reversible."

### Phase 6 — OSS hardening & ecosystem → [PRD](../prd/phase-6-oss-hardening-ecosystem.md)
**HSC conformance test suite**; adapter SDK + docs; ≥3 community adapters; **governance/compliance export** (audit trail → EU AI Act / Colorado AI Act artifacts); public docs & examples.
**Exit:** a third party certifies a new adapter against HSC unaided.
**Developer value:** "write my own adapter, certify it, and trust it interoperates."

---

## Cross-cutting tracks (run alongside, not after)
- **The Standard (HSC):** versioned, RFC process, conformance suite — the moat.
- **Autonomy & governance:** the configurable ladder + stage-dependent autonomy boundary; every evolve action logged, attributable, reversible.
- **Security:** secret redaction in traces from day one.
- **Developer experience:** every phase ships the docs + CLI/SDK ergonomics for *that* phase, not at the end.

## Sequencing notes
- Phases 0–2 are the "observability plane" and stand alone as a useful product even if self-evolution never ships.
- Phases 3–5 are the autonomy ladder, strictly additive and opt-in.
- Phase 6 hardens the standard for outside contributors; parts of it (redaction, audit) start in Phase 0.
