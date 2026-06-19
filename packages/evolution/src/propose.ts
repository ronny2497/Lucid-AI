/**
 * @lucid/evolution — the `propose()` orchestrator.
 *
 * `propose(finding, diagnostic, opts?)` is the single callable that turns a
 * Phase 2 `Finding` (in the context of its `DiagnosticResult`) into a schema-valid,
 * falsifiable `ChangeManifest`. It:
 *
 *   1. VALIDATES `diagnostic` against `DiagnosticResultSchema` at entry and throws
 *      on malformed input BEFORE any mapping runs (threat T-03-04). The diagnostic
 *      is an attacker-influenceable producer.
 *   2. Maps the finding via `findingToChangeSets(finding, diagnostic)` and selects
 *      the PRIMARY candidate (the first / highest-leverage rule output).
 *   3. Estimates the `expected_effect` via `expectedEffect(candidate, matchingScore)`
 *      where the matching score is `diagnostic.principles[].principle === finding.principle`.
 *   4. Assembles the `ChangeManifest` and PARSES it against `ChangeManifestSchema`
 *      before returning.
 *
 * DETERMINISM: the id is derived deterministically (sha256-prefix of the stable
 * manifest content), so two calls on the same finding produce identical manifests
 * excluding only `generated_at`. No `nanoid` dependency is added — a deterministic
 * content hash satisfies the `cm-{id}` shape AND keeps `propose()` deterministic,
 * which the integration test asserts. (03-01 deferred the nanoid-vs-sha256 choice
 * here; the sha256-prefix path wins because it adds no dependency.)
 *
 * ZERO BLAST RADIUS (L0): `propose()` returns an object. It MUST NOT write to,
 * mutate, or generate any harness config/prompt/skill/context file; it MUST NOT
 * call any status-mutation API; and the output `status` is ALWAYS `"proposed"`.
 * Applying a proposal is Phase 4. (threat T-03-07 / L0 hard prohibition)
 */

import { createHash } from "node:crypto";

import { DiagnosticResultSchema } from "@lucid/diagnostic";
import type { DiagnosticResult, Finding } from "@lucid/diagnostic";

import { ChangeManifestSchema, type ChangeManifest } from "./schema.js";
import type { CandidateChangeSet } from "./types.js";
import { findingToChangeSets } from "./mapper/index.js";
import { expectedEffect } from "./estimator/index.js";

/** Options for `propose()`. `all` is a documented seam for a future ranked-list path. */
export interface ProposeOptions {
  /** When true (future), return/rank all candidates rather than the primary. Unwired at L0. */
  all?: boolean;
}

/**
 * The ranked candidate list for a finding (primary first). Internal helper that
 * the future `--all` path will consume; `propose()` takes `[0]`.
 */
function rankedCandidates(
  finding: Finding,
  diagnostic: DiagnosticResult,
): CandidateChangeSet[] {
  // Rule order IS leverage order (the registry lists flagship/primary first).
  return findingToChangeSets(finding, diagnostic);
}

/**
 * Derive a deterministic, short, human-readable `cm-{id}` from the stable manifest
 * content (everything except `id`/`generated_at`). Same content → same id.
 */
function deterministicId(stable: Omit<ChangeManifest, "id" | "generated_at">): string {
  // Sort keys for a stable serialisation independent of property insertion order.
  const canonical = JSON.stringify(stable, Object.keys(stable).sort());
  const hash = createHash("sha256").update(canonical).digest("hex").slice(0, 12);
  return `cm-${hash}`;
}

/**
 * Turn a Phase 2 finding into a falsifiable, schema-valid `change_manifest`.
 *
 * @throws if `diagnostic` fails `DiagnosticResultSchema` validation (T-03-04)
 * @throws if the finding maps to no candidate (nothing to propose)
 */
export function propose(
  finding: Finding,
  diagnostic: DiagnosticResult,
  _opts: ProposeOptions = {},
): ChangeManifest {
  // 1. Input validation at the trust boundary — throw before any mapping (T-03-04).
  const validated = DiagnosticResultSchema.parse(diagnostic);

  // 2. Map → primary candidate.
  const candidates = rankedCandidates(finding, validated);
  const candidate = candidates[0];
  if (!candidate) {
    throw new Error(
      `propose(): finding ${finding.id} (detector ${finding.detectorId}) mapped to no change-set candidate`,
    );
  }

  // 3. Estimate expected_effect from the matching PrincipleScore (B4: counts live there).
  const principleScore = validated.principles.find((p) => p.principle === finding.principle);
  const expected_effect = expectedEffect(candidate, principleScore);

  // 4. Assemble the manifest. status is ALWAYS "proposed" (L0 — never applied).
  const target = `${validated.agentId}@${validated.harness_version ?? "unknown"}`;
  const stable: Omit<ChangeManifest, "id" | "generated_at"> = {
    schema_version: "1",
    target,
    change: candidate.change,
    detail: candidate.detail,
    rationale: candidate.rationale,
    evidence_ref: `lucid://findings/${finding.id}`,
    expected_effect,
    status: "proposed",
    estimator: "rule-based",
  };

  const manifest: ChangeManifest = {
    id: deterministicId(stable),
    ...stable,
    generated_at: new Date().toISOString(),
  };

  // Validate the assembled manifest before returning (the schema is the spec).
  return ChangeManifestSchema.parse(manifest);
}
