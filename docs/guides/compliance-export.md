# Compliance Export

> **THIS IS EVIDENCE ASSEMBLY, NOT LEGAL CERTIFICATION.** The compliance export bundles your existing Lucid audit records into a regulator-shaped evidence package. It does **not** certify that your AI system is compliant with any law, and it is **not** legal advice. Whether your evidence satisfies a given obligation is a determination for you and your counsel. The export manifest carries this disclaimer prominently, and so does every section below.

> **Audience:** regulated adopters who already run Lucid and need to assemble an audit-trail evidence package for the EU AI Act (primary) or Colorado SB 26-189 (lighter overlay). Commands are **ILLUSTRATIVE** of the intended CLI; field mappings are sourced from the cited regulations.

## What the export does

```bash
# ILLUSTRATIVE
lucid compliance export --regime eu-ai-act --since 2026-01-01 --out ./evidence/
```

The export reads from the Lucid **audit trail** + **change manifests**, maps each record onto a regime's obligation fields, and bundles the result into a **tamper-evident** package. It is a **batch** operation — evidence assembly, run periodically or on demand, not a live gate.

## Per-regime obligation mapping

Lucid maps to the **better-specified** regime (EU AI Act Article 12) as primary, and presents the **narrower, still-settling** Colorado regime as a lighter overlay.

### EU AI Act — Article 12 (primary)

The EU AI Act Article 12 record-keeping minimum fields are the export's primary target. Lucid maps its existing telemetry onto them:

| Article 12 field | Lucid source |
|---|---|
| Period (start/end timestamps) | event span timestamps |
| Reference database / input data | `context.load` + input summary (non-content) |
| Input data for which the search was made | `gen_ai.*` request identifiers (model, agent) |
| Identification of natural persons involved (human oversight) | human-oversight action records |
| System version | `harness.version` |

> **Timeline context (not a reason to delay).** The EU AI Act Omnibus has provisionally delayed high-risk Annex III obligations from August 2026 to **December 2027**. This relieves enforcement pressure but does **not** remove the need for evidence assembly — regulated adopters want their package ready before enforcement begins. **Retention posture:** Article 12 does not fix a retention period; regulatory commentary cites a **six-month minimum**, with sector rules (finance, healthcare) often longer. Lucid defaults to a six-month-minimum posture; configure longer as your sector requires.

### Colorado SB 26-189 (lighter overlay — **PENDING AG RULEMAKING**)

Colorado repealed SB 24-205 and replaced it with **SB 26-189** (signed May 14, 2026; effective **January 1, 2027**) — a **narrower** notice-and-transparency regime focused on automated decisions in consequential decisions. The original SB 24-205 three-year audit-retention requirement **did not survive** into SB 26-189.

> **PENDING AG RULEMAKING.** The operational details of SB 26-189 depend on Colorado Attorney General rulemaking that is not yet published. The Colorado overlay is therefore **provisional**: it is presented as a lighter mapping over the same audit records, and every Colorado-specific obligation in the export is tagged `PENDING AG RULEMAKING` until the rules are final. Do not treat the Colorado overlay as settled.

## The tamper-evident audit trail

The export's integrity rests on the store layer's **hash-chained, append-only** audit log (`node:crypto`, HMAC-SHA256 over each record, chained to the prior record's hash). This makes the evidence package **independently verifiable**: any party can recompute the chain and detect tampering, with no external ledger or blockchain. The export manifest includes the chain head hash so a recipient can verify the bundle they received matches what was exported.

## The redaction-completeness gate

The opt-in content fields (`gen_ai.input.messages`, `gen_ai.tool.call.arguments`) are the primary PII/secret surface; they are **off by default**. When content capture is enabled, the export will **not** emit a package until the **redaction-completeness gate** passes — it verifies that the configured redaction (OTel Collector Redaction/Attribute/Transform processors, plus SDK-side defense-in-depth) actually covered every content-bearing field present in the selected records. The gate **fails closed**: if it cannot prove completeness, the export refuses rather than shipping un-redacted PII into an evidence bundle.

## Partial coverage (when Phase 3-5 data is absent)

Compliance evidence is only as complete as the telemetry you captured. If diagnostics, change-manifest, or self-evolution data from earlier phases is **absent**, the export **degrades honestly**:

- It assembles the fields it **can** substantiate from the records present.
- It marks every obligation field it **cannot** populate as `NOT CAPTURED` (never invented — absence-is-signal extends to compliance, exactly as it does to traces).
- The manifest summarizes coverage so a reviewer sees, at a glance, which obligations are evidenced and which are gaps to close.

A partial package is still useful (partial coverage → partial value), and an honest gap is far safer than a fabricated record.

## Reference

- Conformance badge (a different artifact — adapter honesty, not regulatory evidence): [`conformance-badge.md`](conformance-badge.md).
- Authoring adapters: [`adapter-authoring.md`](adapter-authoring.md).
- HSC attributes & the content-field redaction surface: [`../standard/hsc-overview.md`](../standard/hsc-overview.md).
