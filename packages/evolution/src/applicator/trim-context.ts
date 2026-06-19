/**
 * @lucid/evolution — the `trim-context` `StructuralAdapter` (Plan 04-02).
 *
 * Removes a named context source from the context-policy budget file
 * (`context-policy/budget.yaml`). Consumes the typed `TrimContextDetail.removeSource`
 * only — no prose, no raw trace attributes. Writes ONLY the named targetFile inside
 * harnessRoot. Idempotent: removing an already-absent source is a no-op write.
 */

import {
  assertWithinRoot,
  atomicWriteFile,
  checkWithinRoot,
  readTarget,
  type StructuralAdapter,
  type ValidationResult,
} from "./adapter.js";
import type { ChangeManifestV2Detail, TrimContextDetail } from "../schema-v2.js";

/**
 * Remove the `- id: <removeSource>` source entry (and its indented child lines) from
 * a budget YAML. Deterministic line-oriented edit over the closed structural surface.
 */
function removeSourceEntry(content: string, removeSource: string): string {
  const lines = content.split(/\r?\n/);
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const isEntryStart = /^\s*-\s+id:\s*/.test(line);
    if (isEntryStart) {
      const id = line.replace(/^\s*-\s+id:\s*/, "").trim();
      skipping = id === removeSource;
      if (skipping) continue;
      out.push(line);
      continue;
    }
    // While skipping, drop the indented child lines that belong to the removed entry
    // (more-indented than a list item, i.e. they start with whitespace and are not a
    // new top-level/list line).
    if (skipping) {
      if (/^\s+\S/.test(line) && !/^\s*-\s/.test(line)) continue;
      // Any non-child line ends the skip region.
      skipping = false;
    }
    out.push(line);
  }
  return out.join("\n");
}

export const trimContextAdapter: StructuralAdapter = {
  changeKind: "trim-context",

  validate(detail: ChangeManifestV2Detail, harnessRoot: string): ValidationResult {
    if (detail.kind !== "trim-context") {
      return { ok: false, reason: `trimContextAdapter received detail.kind "${detail.kind}"` };
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
    if (detail.kind !== "trim-context") {
      throw new Error(`trimContextAdapter received detail.kind "${detail.kind}"`);
    }
    const d = detail as TrimContextDetail;
    const resolvedPaths = assertWithinRoot(detail.targetFiles, harnessRoot);
    const target = detail.targetFiles[0];
    const absPath = resolvedPaths[0];
    const content = readTarget(absPath, target);
    const next = removeSourceEntry(content, d.removeSource);
    atomicWriteFile(absPath, next.replace(/\s+$/, "") + "\n");
    return [target];
  },
};
