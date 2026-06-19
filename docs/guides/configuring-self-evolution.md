# Configuring Self-Evolution

> **L0, L1, and L2 are shipped (Phases 3 + 4 + 5).** The `lucid evolve propose /
> review / list` (L0, advisory), `lucid evolve apply / rollback / audit` (L1, gated
> auto-apply), and `lucid evolve train / show / promote / rollback` (L2, weight-level
> GRPO) commands are live. **L2 is optional and skippable** — it is the only tier that
> touches model weights or involves Python, and only teams that self-host an
> open-weight model ever need it. The TS core imports with zero Python.
>
> **L1 is structural-only.** It edits ONLY harness structural surfaces —
> prompts, skills, config, and context-policy. It NEVER touches model parameters;
> that is L2 (Phase 5), behind the swappable `TrainerPlugin`.

The Self-Evolution Engine turns diagnoses into harness improvements. It has **one config knob** — the autonomy level — and three opt-in tiers. **It defaults to human-in-the-loop. Nothing escalates without your configuration.**

## The autonomy ladder

| Level | What it does | Blast radius | Requires |
|---|---|---|---|
| **L0** | Diagnose + **recommend** change-sets | Zero (advisory) | nothing |
| **L1** | **Auto-apply** structural edits (prompts/skills/config/context) behind gates + rollback | harness structure | approval gate config |
| **L2** | **Weight-level** training via GRPO | model weights | self-hosted model + Python `TrainerPlugin` |

## Configure it
```yaml
# lucid.config.yaml — ILLUSTRATIVE
evolution:
  autonomy: L1                 # L0 | L1 | L2
  require_human_approval: true # even at L1, gate before apply
  rollback: auto               # auto-revert on regression
  guard:
    regression_metric: success # block apply if this regresses
    min_delta: 0.0
  trainer: null                # only set for L2 (see below)
```

## L0 — Recommend only (start here)

> **Shipped (Phase 3).** The commands below are live in the `lucid` CLI.

L0 has **zero blast radius**: it turns a Phase 2 diagnosis into a falsifiable,
PR-like **change_manifest**, emits it as an auditable `evolve.propose` HSC event,
and persists it so you can list and review it. **It applies NOTHING.** `--accept`
records your decision; you apply the change *by hand*. Auto-apply is L1 (Phase 4).

### Propose

`propose` reads a **DiagnosticResult** (from a `--from <diagnostic.json>` file —
the JSON a Phase 2 `diagnose()` run produces) and turns the named finding into a
manifest:

```bash
lucid evolve propose --finding F1 --from diagnostic.json
```

It renders the manifest for review, emits the `evolve.propose` audit event, and
saves the proposal to the local proposal index (`lucid-proposals.json` by default;
override with `LUCID_PROPOSALS_PATH`). The render always ends with an explicit
advisory line so an accept is never mistaken for an apply:

```yaml
# change_manifest cm-abc123def456
target: my-agent@v37
change: add-gate
detail: Insert a verify.result step after each state-mutating tool.call; affected tools: db.write, api.post.
rationale: Cites finding F1: 18 of 24 state-mutating calls lacked verification.
evidence_ref: lucid://findings/F1
expected_effect:
  feedback: +0.3
status: proposed
estimator: rule-based
generated_at: 2026-06-18T00:00:00.000Z
# advisory only — nothing has been applied
```

> The fields above are the **actual** `change_manifest` schema — see
> [`../reference/change-manifest.md`](../reference/change-manifest.md).

### Review

`review` records your decision (status only — **it writes nothing to your harness**):

```bash
lucid evolve review cm-abc123def456 --accept --note "good; will add after db.write first"
lucid evolve review cm-abc123def456 --reject --note "not the right fix for this harness"
```

`--accept` sets `status: accepted`. **That is all it does** — you apply the change
yourself. There is no `applied` status at L0; that transition is reserved for
Phase 4 (L1). An unknown manifest id exits non-zero.

### List

```bash
lucid evolve list --agent my-agent --status proposed
```

Lists proposals matching the filter — one line per manifest (id, target, change,
status, expected_effect). `--status` accepts `proposed | accepted | rejected`.

### The falsifiability loop

L0 is advisory, but it is **accountable**: every proposal pins an `expected_effect`
prediction. After you apply a change by hand and re-run your harness, re-run
`lucid diagnose` and compare the actual per-principle delta against the manifest's
`expected_effect`. That predicted-vs-observed check is what makes an L0 proposal
falsifiable rather than a guess.

> The `--from <diagnostic.json>` input is the Phase 3 reconciliation of the fact
> that Phase 2 computes a `DiagnosticResult` on demand and does not persist one:
> you pass the diagnostic JSON explicitly. A future diagnose-integrated path
> (re-running `diagnose()` over a stored trace) will be wired once the CLI exposes
> `diagnose` directly.

## L1 — Auto-apply structural (gated, reversible)

> **Shipped (Phase 4).** The commands below are live in the `lucid` CLI. L1 is the
> closed control loop: **gate → snapshot → apply → regression guard →
> promote (KEEP) or auto-rollback (any non-KEEP)** — and every step is recorded.

L1 applies a change to your **config / prompts / skills / context-policy** behind the
approval gate, runs a fixed-sample regression guard over recent traces, and **promotes
only on a KEEP verdict**. Any non-KEEP verdict (a regression, insufficient samples, or
a null score) triggers an **automatic, byte-identical rollback** from an immutable
pre-apply snapshot. There is always a manual kill-switch, and every apply (and every
rollback) is in the audit trail.

The five change types are exactly the L0 taxonomy — **no new kinds at L1**:
`add-gate`, `trim-context`, `edit-skill`, `prompt-patch`, `delete-layer`. (Yes,
`delete-layer` — the discipline of *removing* harness as models improve.)

### apply

`apply` runs the gated loop for a v2 `change_manifest`:

```bash
lucid evolve apply --manifest cm-7f3a91.json --approved-by alice
```

What happens, in order:

1. **Gate first.** `apply` checks the change against your `evolution.*` config: the
   autonomy level (auto-apply is refused at `L0`), the `allow_change_types` allow-list,
   and — when `require_human_approval` is true — the `--approved-by` identity. A reject
   leaves your harness **completely untouched** (no snapshot, no write).
2. **Snapshot, then apply.** The applicator snapshots every target file *before* the
   first write, then applies the typed change atomically.
3. **Regression guard.** It re-scores a fixed-sample cohort of recent traces for the
   baseline and the candidate version and compares your `guard.regression_metric`.
4. **Promote or roll back.** On a **KEEP** verdict the candidate is promoted and the
   manifest advances to `status: applied`. On **any** non-KEEP verdict — a regression
   (`REVERT`), too few samples (`INSUFFICIENT_DATA`), or a null score (`NULL_SCORE`) —
   the change is **automatically rolled back** to the byte-identical snapshot.
5. **Audit.** Either way, an `evolve.apply` event is emitted (the rollback case carries
   `rollback_status: auto-rollback`) and an `ApplyRecord` is written.

`apply` is **idempotent by manifest id**: re-running it for an already-applied manifest
returns the existing record and re-applies nothing.

### rollback — the kill-switch

`rollback` is the always-present manual revert. It restores a known-good harness
version from its snapshot — no gate, no guard, because restoring a known-good baseline
is always safe:

```bash
lucid evolve rollback --agent my-agent --to v37
```

It exits non-zero if no snapshot exists for that version.

### audit — the trail

`audit` reads the `ApplyRecord` trail — one line per apply or rollback (manifest id,
change kind, approver, verdict, version transition, rollback status):

```bash
lucid evolve audit --agent my-agent --since 2026-06-01T00:00:00Z
lucid evolve audit --agent my-agent --status REVERT
```

> **Structural-only boundary.** The L1 `apply` and `rollback` commands operate on
> harness structural files only. There is no model-parameter path here, and no `train`
> command — the model-parameter tier is L2 (Phase 5), behind the `TrainerPlugin`. See
> [`../reference/autonomy-config.md`](../reference/autonomy-config.md) for the full
> `evolution.*` field reference.

## L2 — Weight-level (GRPO), for self-hosted models only

> **Shipped (Phase 5).** The commands below are live in the `lucid` CLI. L2 is the
> only tier that touches model weights, and the only one that involves Python — via
> the swappable **`TrainerPlugin`** (see
> [ADR-0004](../03-decisions/ADR-0004-grpo-trainerplugin-boundary.md)). **It is opt-in
> and skippable.** If you do not self-host weights you never configure it, never run
> an L2 command, and never install Python — the TS core has no Python dependency.

L2 closes a falsifiable training loop: collect trajectories → **compute the reward in
TypeScript** from your Phase 2 principle/2×2 scores → hand a job (prompts + scalar
rewards) to the trainer → the trainer runs **GRPO on fresh on-policy rollouts** →
a candidate is **gated on a held-out eval** → promote on a margin, otherwise discard.
The framework computes *rewards*; the trainer does *only the gradient math*.

### Configure it

```yaml
# lucid.config.yaml
evolution:
  autonomy: L2                   # L0 | L1 | L2 — L2 unlocks the trainer
  trainer:                       # MUST be null unless autonomy is L2 (rejected otherwise)
    plugin: grpo-python          # the reference Python sidecar; swappable
    base_model: ./models/my-llm  # HF id or local path to your open-weight model
  reward:
    from: diagnostic             # the reward is your TS-computed diagnostic score
    weights:                     # per-principle weights (canonical principle names)
      planning: 1.0
      verification: 1.0
  promote_gate:
    eval: ./evals/holdout.jsonl  # the held-out set a candidate must improve
    metric: success
    min_improvement: 0.02        # promote only if the candidate beats the incumbent by ≥ this
```

The `trainer` block is **rejected unless `autonomy: L2`** (the trainer-null-unless-L2
boundary, ADR-0004) — you cannot accidentally point at a trainer without explicitly
enabling the tier.

### train

```bash
lucid evolve train --agent my-agent [--since 7d]
```

Exports recent trajectories, computes the per-prompt rewards in TS, writes the job
(prompts-only dataset + rewards + a job spec) to disk, hands it to the trainer plugin,
reads the result manifest, and runs it through the promotion gate — printing the
candidate id and the gate verdict. A zero-variance reward set surfaces a **warning**
before handoff (a degenerate GRPO gradient). With no trainer configured (L0/L1) it
prints a clear `L2 not configured` notice and exits cleanly — **it never crashes or
requires Python.**

### show

```bash
lucid evolve show <candidate-id>
```

Prints the run's result-manifest summary: base model, method, trajectory count,
held-out delta, and per-principle deltas.

### promote

```bash
lucid evolve promote <candidate-id>
```

Promotes a candidate — **only if the gate passed.** The CLI delegates to the gate and
**refuses (non-zero exit) a candidate the gate failed**; there is no flag that
bypasses the gate.

### rollback

```bash
lucid evolve rollback --model my-llm --to v37
```

Resets the incumbent **model pointer** to a prior version. This is a **pointer reset,
never a weight deletion** — a bad candidate can always be backed out.

### The Python sidecar (optional)

The reference trainer is a separate, optional Python package
([`packages/trainer-grpo`](../../packages/trainer-grpo/README.md), TRL `GRPOTrainer`).
You drive everything from the CLI/SDK and **never write Python**; the sidecar is
invoked behind the `TrainerPlugin` boundary only when an L2 `train` runs. See the
[self-hosting guide](./self-hosting-trainer-sidecar.md) for install, GPU
prerequisites, and the CPU smoke path. The real GPU GRPO run is a manual,
self-hosted operation.

## Governance
- Every `evolve.propose` / `evolve.apply` / `evolve.train` is an **HSC event** — Lucid observes its own actions.
- Full **audit trail**: who/what/when/why, with the change_manifest attached.
- Defaults are conservative: recommend-only, human approval, auto-rollback.

## Reference
- The ladder & change-sets: [`../01-concepts.md`](../01-concepts.md)
- The training boundary: [ADR-0004](../03-decisions/ADR-0004-grpo-trainerplugin-boundary.md)
