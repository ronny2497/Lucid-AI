/**
 * @lucid/evolution — the flagship `add-gate` `StructuralAdapter` (Plan 04-02).
 *
 * Inserts a verify/gate step into the harness gates config. This is the worked
 * example the other four adapters mirror: consume the typed `AddGateDetail`, write
 * ONLY the named `targetFiles` inside `harnessRoot`, and be idempotent (re-applying
 * the same gate does not duplicate it).
 *
 * Structural surface: `config/gates.yaml` (a YAML list of gate entries). We do a
 * minimal, deterministic, line-oriented insert — no YAML library, no prose parsing,
 * no raw trace attributes (T-04-04). The inserted entry is derived purely from the
 * typed `detail.insertAfter` / `detail.gate` / `detail.condition` fields.
 */

import {
  assertWithinRoot,
  atomicWriteFile,
  checkWithinRoot,
  readTarget,
  type StructuralAdapter,
  type ValidationResult,
} from "./adapter.js";
import type { AddGateDetail, ChangeManifestV2Detail } from "../schema-v2.js";

/** Render the gate entry block for a given add-gate detail (deterministic). */
function gateEntryBlock(detail: AddGateDetail): string {
  return [
    `  - id: ${detail.gate}`,
    `    after: ${detail.insertAfter}`,
    `    requires: ${detail.condition}`,
  ].join("\n");
}

/**
 * Idempotency marker: the gate is considered already present iff a gate entry with
 * the same `id:` already exists in the config (deterministic string check, no YAML
 * parse needed for the closed structural surface).
 */
function alreadyHasGate(content: string, gateId: string): boolean {
  return content.split(/\r?\n/).some((line) => line.trim() === `- id: ${gateId}`);
}

export const addGateAdapter: StructuralAdapter = {
  changeKind: "add-gate",

  validate(detail: ChangeManifestV2Detail, harnessRoot: string): ValidationResult {
    if (detail.kind !== "add-gate") {
      return { ok: false, reason: `addGateAdapter received detail.kind "${detail.kind}"` };
    }
    const contained = checkWithinRoot(detail.targetFiles, harnessRoot);
    if (!contained.ok) return contained;
    // The target gates config must already exist (we insert into it, not create it).
    const [resolved] = assertWithinRoot(detail.targetFiles, harnessRoot);
    try {
      readTarget(resolved, detail.targetFiles[0]);
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
    return { ok: true };
  },

  apply(detail: ChangeManifestV2Detail, harnessRoot: string): string[] {
    if (detail.kind !== "add-gate") {
      throw new Error(`addGateAdapter received detail.kind "${detail.kind}"`);
    }
    // Re-assert containment in the write path (defense in depth, T-04-06).
    const resolvedPaths = assertWithinRoot(detail.targetFiles, harnessRoot);
    const written: string[] = [];

    // add-gate operates on the single gates-config target (the first targetFile).
    const target = detail.targetFiles[0];
    const absPath = resolvedPaths[0];
    const content = readTarget(absPath, target);

    if (alreadyHasGate(content, detail.gate)) {
      // Idempotent: the gate already exists — no write, but report the target as
      // (already) satisfied so callers see the canonical written-file list.
      return [target];
    }

    const trimmed = content.replace(/\s+$/, "");
    const next = `${trimmed}\n\n${gateEntryBlock(detail)}\n`;
    atomicWriteFile(absPath, next);
    written.push(target);
    return written;
  },
};
