# `evolution.*` Autonomy Config Reference

The `evolution.*` block of `lucid.config.yaml` bounds **when** the self-evolution plane
may act. Where the [`change_manifest`](./change-manifest.md) bounds *what* can be applied,
this config bounds *whether and how* an apply runs: the autonomy level, the approval gate,
the allowed change kinds, the regression guard, and the rollback policy.

The schema below matches the shipped `@lucid/evolution` code
(`packages/evolution/src/apply-config.ts`), not an illustrative sketch. It is parsed by
`AutonomyConfigSchema`, which applies the defaults below and **rejects** the
trainer-boundary violation (see [The L1/L2 boundary](#the-l1l2-boundary)) at parse time.

## Conservative by default

An absent or empty `evolution:` block parses to a fully-defaulted, **safe** config:
`autonomy: L0` (recommend-only, no auto-apply), `require_human_approval: true`,
`rollback: auto`, all five change types allowed, the `success`-rate guard, and a null
trainer. **You opt *in* to autonomy; you never opt out.**

```yaml
# lucid.config.yaml
evolution:
  autonomy: L1                  # L0 | L1 | L2     (default L0)
  require_human_approval: true  # gate before apply (default true)
  allow_change_types:           # the apply allow-list (default: all five)
    - add-gate
    - trim-context
    - edit-skill
    - prompt-patch
    - delete-layer
  rollback: auto                # auto | manual    (default auto)
  guard:
    regression_metric: success  # "success" | a principle name (default "success")
    min_delta: 0.0              # minimum improvement to KEEP (default 0)
    sample: 200                 # fixed cohort size per cohort (default 200)
  trainer: null                 # L2 ONLY — must be null at L0/L1 (default null)
  version_retention: 10         # snapshots to retain (default 10)
```

## Field reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `autonomy` | `"L0" \| "L1" \| "L2"` | `"L0"` | The autonomy ladder level. `L0` is recommend-only (auto-apply is **refused**). `L1` enables structural auto-apply. `L2` is the weight-level tier (Phase 5). |
| `require_human_approval` | `boolean` | `true` | When true, `apply` requires an approver identity (`--approved-by`) and refuses without one — even at `L1`. Opt out explicitly. |
| `allow_change_types` | `array<change-kind>` | all five | The allow-list the gate checks `manifest.change` against. A change kind not in this list is rejected before any write. The kinds are the closed taxonomy: `add-gate`, `trim-context`, `edit-skill`, `prompt-patch`, `delete-layer`. |
| `guard.regression_metric` | `"success"` or a principle name | `"success"` | The metric the regression guard compares between the baseline and candidate cohorts. `"success"` is the cohort success rate; a principle name (`context`, `plan_execute`, `feedback`, `one_at_a_time`, `codebase_docs`) is the averaged principle score. The principle names are derived from the canonical `PRINCIPLES` tuple — they cannot drift. |
| `guard.min_delta` | `number` | `0` | The minimum `candidate − baseline` improvement required to **KEEP**. A delta below this is a `REVERT`. |
| `guard.sample` | `number` (int > 0) | `200` | The fixed cohort size sampled per version. If the candidate cohort has fewer than `sample` traces, the guard returns `INSUFFICIENT_DATA` and blocks promotion — an under-sampled cohort is never silently kept. |
| `rollback` | `"auto" \| "manual"` | `"auto"` | Whether a regression auto-rolls-back (`auto`) or waits for a manual `lucid evolve rollback` (`manual`). |
| `trainer` | `unknown \| null` | `null` | The trainer plugin — **L2 only**. At `L0`/`L1` the only valid value is `null`. See below. |
| `version_retention` | `number` (int > 0) | `10` | How many prior harness-version snapshots to retain for rollback. |

## The guard verdicts

The regression guard returns one of four verdicts; only `KEEP` promotes. Every other
verdict blocks promotion and (under `rollback: auto`) triggers an automatic,
byte-identical rollback:

| Verdict | Meaning | Effect |
|---------|---------|--------|
| `KEEP` | `candidate − baseline ≥ min_delta` | Promote the candidate; advance the manifest to `status: applied`. |
| `REVERT` | `candidate − baseline < min_delta` (a regression) | Roll back to the pre-apply snapshot. |
| `INSUFFICIENT_DATA` | The candidate cohort has fewer than `sample` traces | Roll back — absence of signal is never a pass. |
| `NULL_SCORE` | The guard metric is null on either cohort | Roll back — `null` is signal, never a `0` backfill or a `NaN` keep. |

## The L1/L2 boundary

`L0` and `L1` are **pure-TypeScript structural evolution** — they edit prompts, skills,
config, and context-policy, and never touch model parameters. A trainer plugin (the
weight-level tier) is **L2 only** (Phase 5), behind the swappable `TrainerPlugin`
described in [ADR-0004](../03-decisions/ADR-0004-grpo-trainerplugin-boundary.md).

`AutonomyConfigSchema` encodes this as a hard rule: **`trainer` MUST be `null` unless
`autonomy: L2`.** A config that sets a non-null `trainer` at `L0` or `L1` fails at
config-parse time — a misconfiguration that would escalate the blast radius toward
model-parameter mutation can never reach the apply loop. L2 itself is out of scope at
L1; the schema only *enforces* the boundary, it does not implement the tier.

## See also

- [`change-manifest.md`](./change-manifest.md) — the *what* (the applyable artifact).
- [`../guides/configuring-self-evolution.md`](../guides/configuring-self-evolution.md) —
  the L0/L1 commands and the gate → guard → rollback flow.
- [ADR-0004](../03-decisions/ADR-0004-grpo-trainerplugin-boundary.md) — the trainer boundary.
