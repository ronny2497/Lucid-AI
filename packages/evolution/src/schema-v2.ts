/**
 * @lucid/evolution — `ChangeManifestV2Schema`: the machine-parseable apply contract (REQ-05).
 *
 * Phase 4 (L1 — Auto-Apply) is where the Phase 3 v1 `change_manifest` becomes
 * something the harness can APPLY programmatically. At L0 every change kind shared
 * a single prose `detail` string (a human-applicable instruction). At L1 `detail`
 * becomes a DISCRIMINATED UNION keyed by `kind`, so the applicator (04-02) can
 * dispatch a typed, kind-specific apply per change without ever parsing prose.
 *
 * This is the load-bearing Wave-0 contract: it is authored BEFORE any apply code
 * exists. The schema is the spec, not the test. Three properties it freezes:
 *
 *   1. STRUCTURAL-ONLY (HARD, ADR-0004 / L1 boundary) — every detail variant and
 *      its `targetFiles` operate ONLY on harness structural surfaces (prompts /
 *      skills / config / context-policy). There is NO field referencing model
 *      weights, GRPO, a TrainerPlugin, or a Python training artifact. Weight
 *      mutation is L2 (Phase 5), explicitly out of scope here.
 *
 *   2. PATH-TRAVERSAL GUARD (T-04-01) — `targetFiles` is the attacker-influenceable
 *      surface that drives a privileged write. `TargetFilesSchema` REJECTS any
 *      entry that is an absolute path or contains a parent-directory segment, at
 *      parse time, before any byte is written. The applicator additionally
 *      re-checks containment within the harness root (defense in depth).
 *
 *   3. CONSISTENCY (cross-field refinement) — the top-level `change` and
 *      `detail.kind` must agree, and `agentId` must equal the agent component of
 *      `target` (`"agent-id@harness-version"`). `agentId` is the normalized agent
 *      identity downstream consumers read directly (04-02 `registry.snapshot`,
 *      04-04 `runRegressionGuard` / `registry.promote`, `ApplyRecord.agentId`); it
 *      is DERIVED from `target` and kept consistent by the refinement so the two
 *      can never drift.
 *
 * The v2 schema EXTENDS the frozen Phase 3 v1 `ChangeManifestSchema` (it omits the
 * prose `detail` + `schema_version "1"` and re-adds `schema_version "2"`, `agentId`,
 * and the discriminated detail union) — the v1 closed-taxonomy `ChangeSetKindSchema`
 * and `ExpectedEffectSchema` are imported unchanged. Phase 4 NEVER redefines or adds
 * a change kind.
 *
 * ONLY-imports `zod` + the frozen v1 schema. No filesystem write path lives here —
 * this module bounds the write surface; it does not perform a write.
 */

import { z } from "zod";

import {
  ChangeManifestSchema,
  ChangeSetKindSchema,
} from "./schema.js";

/**
 * A list of harness-relative target file paths a change applies to.
 *
 * The refinement REJECTS any entry that is an absolute path or contains a
 * parent-directory segment — the path-traversal guard (T-04-01). The apply path is
 * a privileged write surface; a `targetFiles` entry must be a forward-relative path
 * confined to the harness root (e.g. `"config/gates.yaml"`), never something that
 * can escape it (e.g. `"../../etc/passwd"` or `"/etc/passwd"`). Every detail variant
 * carries one of these.
 */
export const TargetFilesSchema = z
  .array(z.string().min(1))
  .min(1)
  .refine(
    (paths) =>
      paths.every((p) => {
        // Reject POSIX and Windows absolute paths.
        if (p.startsWith("/") || p.startsWith("\\")) return false;
        if (/^[A-Za-z]:[\\/]/.test(p)) return false;
        // Reject any parent-directory segment, on either separator.
        const segments = p.split(/[\\/]/);
        return !segments.includes("..");
      }),
    {
      message:
        "targetFiles entries must be harness-relative paths confined to the harness root — an entry that escapes the root via a parent-directory reference or an absolute path is rejected as a privileged-write path-traversal risk (T-04-01)",
    },
  );

/**
 * add-gate: insert a verify/gate step after a mutating operation. The thing that
 * fixes a "no verify gate after a mutating tool call" finding.
 */
export const AddGateDetailSchema = z.object({
  kind: z.literal("add-gate"),
  /** The step/operation after which the new gate is inserted. */
  insertAfter: z.string().min(1),
  /** The gate identifier/name to insert. */
  gate: z.string().min(1),
  /** The condition the gate enforces (e.g. "verify result before continuing"). */
  condition: z.string().min(1),
  targetFiles: TargetFilesSchema,
});
export type AddGateDetail = z.infer<typeof AddGateDetailSchema>;

/** trim-context: reduce context window / remove a stale context source. */
export const TrimContextDetailSchema = z.object({
  kind: z.literal("trim-context"),
  /** The context source to remove (e.g. a stale doc or budget line). */
  removeSource: z.string().min(1),
  targetFiles: TargetFilesSchema,
});
export type TrimContextDetail = z.infer<typeof TrimContextDetailSchema>;

/** edit-skill: modify an existing skill definition (structural, not weights). */
export const EditSkillDetailSchema = z.object({
  kind: z.literal("edit-skill"),
  /** The skill being edited. */
  skillId: z.string().min(1),
  /** Structured instruction describing the structural edit to apply. */
  instruction: z.string().min(1),
  targetFiles: TargetFilesSchema,
});
export type EditSkillDetail = z.infer<typeof EditSkillDetailSchema>;

/** prompt-patch: patch a prompt template (structural prompt text, not weights). */
export const PromptPatchDetailSchema = z.object({
  kind: z.literal("prompt-patch"),
  /** The prompt template being patched. */
  promptId: z.string().min(1),
  /** Structured instruction describing the patch to apply. */
  instruction: z.string().min(1),
  targetFiles: TargetFilesSchema,
});
export type PromptPatchDetail = z.infer<typeof PromptPatchDetailSchema>;

/** delete-layer: remove a harness layer that is no longer earning its keep. */
export const DeleteLayerDetailSchema = z.object({
  kind: z.literal("delete-layer"),
  /** The harness layer to remove. */
  layerId: z.string().min(1),
  targetFiles: TargetFilesSchema,
});
export type DeleteLayerDetail = z.infer<typeof DeleteLayerDetailSchema>;

/**
 * The machine-parseable `detail` — a discriminated union on `kind` covering all
 * five (and only the five) L0/L1 change kinds. A v1 prose-string `detail` does NOT
 * match any variant and is therefore REJECTED. The applicator dispatches per
 * `detail.kind`.
 */
export const ChangeManifestV2DetailSchema = z.discriminatedUnion("kind", [
  AddGateDetailSchema,
  TrimContextDetailSchema,
  EditSkillDetailSchema,
  PromptPatchDetailSchema,
  DeleteLayerDetailSchema,
]);
export type ChangeManifestV2Detail = z.infer<typeof ChangeManifestV2DetailSchema>;

/**
 * The root v2 `change_manifest` — the typed, versioned, applyable proposal artifact.
 *
 * Extends the frozen v1 `ChangeManifestSchema`: it carries forward v1's
 * `id/target/change/rationale/evidence_ref/expected_effect/status/estimator/
 * review_note?/generated_at`, drops the v1 prose `detail` + `schema_version "1"`,
 * and re-adds `schema_version "2"`, the normalized `agentId`, and the discriminated
 * `detail` union.
 *
 * The `.superRefine` REJECTS:
 *   (a) a manifest whose top-level `change` !== `detail.kind` (the closed-taxonomy
 *       consistency check — you cannot label an add-gate manifest as a prompt-patch);
 *   (b) a manifest whose `agentId` !== the agent component of `target`
 *       (`target.split("@")[0]`) — `agentId` is derived from `target` and the two
 *       can never drift, so a downstream consumer reading `manifest.agentId` always
 *       sees the same identity encoded in `target`.
 */
export const ChangeManifestV2Schema = ChangeManifestSchema.omit({
  detail: true,
  schema_version: true,
})
  .extend({
    /** Pinned to "2": the machine-parseable apply contract. */
    schema_version: z.literal("2"),
    /**
     * The normalized agent identity, derived from `target` and kept consistent
     * with it by the superRefine. Downstream consumers (04-02 snapshot, 04-04
     * guard/promote, `ApplyRecord.agentId`) read THIS field directly.
     */
    agentId: z.string().min(1),
    /** The discriminated, machine-parseable detail the applicator executes. */
    detail: ChangeManifestV2DetailSchema,
  })
  .superRefine((manifest, ctx) => {
    if (manifest.change !== manifest.detail.kind) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["detail", "kind"],
        message: `detail.kind ("${manifest.detail.kind}") must equal the top-level change ("${manifest.change}") — a manifest cannot be labelled one kind and carry another's detail`,
      });
    }
    const agentOfTarget = manifest.target.split("@")[0];
    if (manifest.agentId !== agentOfTarget) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["agentId"],
        message: `agentId ("${manifest.agentId}") must equal the agent component of target ("${agentOfTarget}") — agentId is derived from target and the two must not drift`,
      });
    }
  });
export type ChangeManifestV2 = z.infer<typeof ChangeManifestV2Schema>;

// Re-export the v1 kind enum so v2 consumers import the closed taxonomy from one place.
export { ChangeSetKindSchema };
