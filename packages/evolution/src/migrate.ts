/**
 * @lucid/evolution — `migrateV1toV2`: the re-propose-based v1 → v2 manifest upgrade.
 *
 * Phase 3 produced `schema_version "1"` manifests whose `detail` is a prose
 * instruction string. Phase 4 needs `schema_version "2"` manifests whose `detail`
 * is a machine-parseable discriminated union (see schema-v2.ts). Bridging the two
 * is done by OPTION B — RE-PROPOSE.
 *
 * THE FORBIDDEN ANTI-PATTERN (RESEARCH Pitfall 3 / Anti-Patterns): regex-parsing
 * the v1 prose `detail` string to fabricate the structured v2 fields. Prose is not
 * a grammar; extracting `insertAfter` / `gate` / `removeSource` from free text by
 * regex is brittle and produces wrong (and, on a privileged write path, dangerous)
 * structured applies. `migrateV1toV2` therefore NEVER inspects `v1.detail`.
 *
 * Instead it takes an INJECTED `reproposeFn` that produces a fresh, structured v2
 * `detail` from the v1 manifest's identity (the same deterministic proposer Phase 3
 * uses, lifted to the v2 detail shape). Injection keeps this module testable
 * without hard-importing the Phase 3 mapper, and makes the no-prose-parse property
 * provable: a v1 whose `detail` is arbitrary unparseable garbage still migrates
 * successfully, because the garbage is never read.
 *
 * The result is validated against `ChangeManifestV2Schema` before return — so a
 * mis-built v2 detail (or a `change`/`detail.kind` / `agentId`/`target` mismatch)
 * fails loud at migration time, not at apply time.
 */

import type { ChangeManifest } from "./schema.js";
import {
  ChangeManifestV2Schema,
  type ChangeManifestV2,
  type ChangeManifestV2Detail,
} from "./schema-v2.js";

/**
 * A function that produces a fresh, structured v2 `detail` for a v1 manifest.
 *
 * It is handed the WHOLE v1 manifest (its `change`, `target`, `rationale`,
 * `evidence_ref`, `expected_effect`) — everything EXCEPT a license to parse the v1
 * prose `detail`. In production this wraps the Phase 3 deterministic proposer; in
 * tests it is a stub returning a fixed structured detail.
 */
export type RepropseV2DetailFn = (v1: ChangeManifest) => ChangeManifestV2Detail;

/**
 * Upgrade a frozen v1 `ChangeManifest` to a `schema_version "2"`
 * `ChangeManifestV2` by RE-PROPOSING a fresh structured `detail` (option B).
 *
 * Carries forward the v1 `id/target/change/rationale/evidence_ref/expected_effect/
 * status/estimator/review_note?/generated_at`, sets `schema_version "2"`, derives
 * `agentId` as `v1.target.split("@")[0]` (the normalized agent identity downstream
 * consumers read — kept consistent with `target` by the schema superRefine), and
 * sets `detail` to `reproposeFn(v1)`. The assembled manifest is parsed by
 * `ChangeManifestV2Schema` before return.
 *
 * It does NOT — and structurally cannot — read `v1.detail`: the prose string is
 * never passed to `reproposeFn` for parsing and is never inspected here.
 */
export function migrateV1toV2(
  v1: ChangeManifest,
  reproposeFn: RepropseV2DetailFn,
): ChangeManifestV2 {
  const detail = reproposeFn(v1);
  const v2 = {
    id: v1.id,
    schema_version: "2" as const,
    target: v1.target,
    agentId: v1.target.split("@")[0],
    change: v1.change,
    detail,
    rationale: v1.rationale,
    evidence_ref: v1.evidence_ref,
    expected_effect: v1.expected_effect,
    status: v1.status,
    estimator: v1.estimator,
    ...(v1.review_note !== undefined ? { review_note: v1.review_note } : {}),
    generated_at: v1.generated_at,
  };
  return ChangeManifestV2Schema.parse(v2);
}
