/**
 * @lucid/evolution — the `delete-layer` `StructuralAdapter` (Plan 04-02).
 *
 * Removes a harness layer that is no longer earning its keep. The layer is a named
 * structural file (the entry in `detail.targetFiles`); the snapshot taken by
 * `applyManifest` BEFORE this runs makes the removal fully reversible. Consumes the
 * typed `DeleteLayerDetail.layerId` only. Writes/removes ONLY the named targetFile
 * inside harnessRoot. Idempotent: removing an already-absent layer is a no-op.
 *
 * STRUCTURAL-ONLY: the removed path is asserted within harnessRoot (T-04-06); it can
 * never be a model-weight / training artifact (that surface is L2, out of scope).
 */

import { existsSync } from "node:fs";

import {
  assertWithinRoot,
  checkWithinRoot,
  removeTarget,
  type StructuralAdapter,
  type ValidationResult,
} from "./adapter.js";
import type { ChangeManifestV2Detail } from "../schema-v2.js";

export const deleteLayerAdapter: StructuralAdapter = {
  changeKind: "delete-layer",

  validate(detail: ChangeManifestV2Detail, harnessRoot: string): ValidationResult {
    if (detail.kind !== "delete-layer") {
      return { ok: false, reason: `deleteLayerAdapter received detail.kind "${detail.kind}"` };
    }
    // Containment is the safety property; the layer file may or may not still exist
    // (idempotent removal), so we do not require existence here.
    return checkWithinRoot(detail.targetFiles, harnessRoot);
  },

  apply(detail: ChangeManifestV2Detail, harnessRoot: string): string[] {
    if (detail.kind !== "delete-layer") {
      throw new Error(`deleteLayerAdapter received detail.kind "${detail.kind}"`);
    }
    const resolvedPaths = assertWithinRoot(detail.targetFiles, harnessRoot);
    const written: string[] = [];
    detail.targetFiles.forEach((target, i) => {
      const absPath = resolvedPaths[i];
      if (existsSync(absPath)) {
        removeTarget(absPath);
      }
      // Report the layer as (now) removed regardless — the canonical affected path.
      written.push(target);
    });
    return written;
  },
};
