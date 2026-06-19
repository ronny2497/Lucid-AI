/**
 * @lucid/evolution — the `prompt-patch` `StructuralAdapter` (Plan 04-02).
 *
 * Applies a structured instruction to a named prompt template (e.g.
 * `prompts/system.txt`). Consumes the typed `PromptPatchDetail.promptId` /
 * `PromptPatchDetail.instruction` only — never a raw trace attribute / tool-call
 * argument (T-04-04). The instruction is appended as a deterministic structural
 * directive line; we do not synthesize free-form prompt text from a trace. Writes
 * ONLY the named targetFile inside harnessRoot. Idempotent: appended at most once.
 */

import {
  assertWithinRoot,
  atomicWriteFile,
  checkWithinRoot,
  readTarget,
  type StructuralAdapter,
  type ValidationResult,
} from "./adapter.js";
import type { ChangeManifestV2Detail, PromptPatchDetail } from "../schema-v2.js";

/** The deterministic structural patch line for a prompt-patch instruction. */
function patchLine(detail: PromptPatchDetail): string {
  return `[lucid:prompt-patch prompt=${detail.promptId}] ${detail.instruction}`;
}

export const promptPatchAdapter: StructuralAdapter = {
  changeKind: "prompt-patch",

  validate(detail: ChangeManifestV2Detail, harnessRoot: string): ValidationResult {
    if (detail.kind !== "prompt-patch") {
      return { ok: false, reason: `promptPatchAdapter received detail.kind "${detail.kind}"` };
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
    if (detail.kind !== "prompt-patch") {
      throw new Error(`promptPatchAdapter received detail.kind "${detail.kind}"`);
    }
    const d = detail as PromptPatchDetail;
    const resolvedPaths = assertWithinRoot(detail.targetFiles, harnessRoot);
    const target = detail.targetFiles[0];
    const absPath = resolvedPaths[0];
    const content = readTarget(absPath, target);

    const line = patchLine(d);
    if (content.includes(line)) {
      // Idempotent: the patch directive is already present.
      return [target];
    }
    const next = `${content.replace(/\s+$/, "")}\n\n${line}\n`;
    atomicWriteFile(absPath, next);
    return [target];
  },
};
