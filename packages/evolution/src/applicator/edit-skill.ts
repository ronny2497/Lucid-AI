/**
 * @lucid/evolution — the `edit-skill` `StructuralAdapter` (Plan 04-02).
 *
 * Applies a structured instruction to a named skill file (e.g. `skills/search.ts`).
 * Consumes the typed `EditSkillDetail.skillId` / `EditSkillDetail.instruction` only.
 * The instruction is recorded as a deterministic structural annotation appended to
 * the skill file — we do NOT execute it, parse prose into code, or read any raw
 * trace attribute (T-04-04). Writes ONLY the named targetFile inside harnessRoot.
 * Idempotent: the same annotation is written at most once.
 */

import {
  assertWithinRoot,
  atomicWriteFile,
  checkWithinRoot,
  readTarget,
  type StructuralAdapter,
  type ValidationResult,
} from "./adapter.js";
import type { ChangeManifestV2Detail, EditSkillDetail } from "../schema-v2.js";

/** The deterministic structural annotation line for an edit-skill instruction. */
function annotation(detail: EditSkillDetail): string {
  return `// lucid:edit-skill skill=${detail.skillId} instruction=${JSON.stringify(detail.instruction)}`;
}

export const editSkillAdapter: StructuralAdapter = {
  changeKind: "edit-skill",

  validate(detail: ChangeManifestV2Detail, harnessRoot: string): ValidationResult {
    if (detail.kind !== "edit-skill") {
      return { ok: false, reason: `editSkillAdapter received detail.kind "${detail.kind}"` };
    }
    const contained = checkWithinRoot(detail.targetFiles, harnessRoot);
    if (!contained.ok) return contained;
    const [resolved] = assertWithinRoot(detail.targetFiles, harnessRoot);
    try {
      readTarget(resolved, detail.targetFiles[0]);
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
    return { ok: true };
  },

  apply(detail: ChangeManifestV2Detail, harnessRoot: string): string[] {
    if (detail.kind !== "edit-skill") {
      throw new Error(`editSkillAdapter received detail.kind "${detail.kind}"`);
    }
    const d = detail as EditSkillDetail;
    const resolvedPaths = assertWithinRoot(detail.targetFiles, harnessRoot);
    const target = detail.targetFiles[0];
    const absPath = resolvedPaths[0];
    const content = readTarget(absPath, target);

    const marker = annotation(d);
    if (content.includes(marker)) {
      // Idempotent: the structural edit annotation is already present.
      return [target];
    }
    const next = `${content.replace(/\s+$/, "")}\n\n${marker}\n`;
    atomicWriteFile(absPath, next);
    return [target];
  },
};
