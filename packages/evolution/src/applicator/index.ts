/**
 * @lucid/evolution — the Change Applicator: `applyManifest` (atomic apply) +
 * `resolveAdapter` (the closed-taxonomy dispatcher). Plan 04-02, Task 2, REQ-05.
 *
 * This is the atomic envelope around the privileged write path. The safety property
 * (04-RESEARCH Pattern 3 / Pitfall 1): a partial apply can NEVER persist. The only
 * way to guarantee that without a fragile diff-invert is to SNAPSHOT every target
 * file BEFORE the first write, run the whole adapter in a single try, and REVERT the
 * entire change from the immutable snapshot on ANY error.
 *
 *   order:
 *     1. adapter.validate(detail, harnessRoot)  — dry-run; fail returns no-write.
 *     2. registry.snapshot(agentId, currentVersion, targetFiles)  — BEFORE any write.
 *     3. try { writtenFiles = adapter.apply(detail, harnessRoot) }  — single try over
 *        the WHOLE apply (never an inner per-file loop — Pitfall 1).
 *     4. catch { registry.revert(snapshot) } — restores byte-identical baseline.
 *
 * Candidate-version bump rule: the current version is `"v<N>"` (e.g. `"v37"`); the
 * candidate is `"v<N+1>"` (e.g. `"v38"`) — matching the golden ApplyRecord fixture
 * (`fromVersion "v37"` -> `toVersion "v38"`). A version that does not match the
 * `v<N>` shape gets a `"-candidate"` suffix fallback so the bump is always defined.
 *
 * STRUCTURAL-ONLY: the applicator dispatches only to the five structural adapters and
 * snapshots only `detail.targetFiles` — no weight path, no TrainerPlugin (ADR-0004).
 */

import type { HarnessVersionRegistry, VersionSnapshot } from "../version-registry.js";
import type { ChangeManifestV2 } from "../schema-v2.js";
import type { ChangeSetKind } from "../schema.js";

import type { StructuralAdapter } from "./adapter.js";
import { addGateAdapter } from "./add-gate.js";
import { trimContextAdapter } from "./trim-context.js";
import { editSkillAdapter } from "./edit-skill.js";
import { promptPatchAdapter } from "./prompt-patch.js";
import { deleteLayerAdapter } from "./delete-layer.js";

export type { StructuralAdapter, ValidationResult } from "./adapter.js";
export { addGateAdapter } from "./add-gate.js";
export { trimContextAdapter } from "./trim-context.js";
export { editSkillAdapter } from "./edit-skill.js";
export { promptPatchAdapter } from "./prompt-patch.js";
export { deleteLayerAdapter } from "./delete-layer.js";

/** The result of an `applyManifest` call — a discriminated success/failure union. */
export type ApplyResult =
  | {
      success: true;
      candidateVersion: string;
      writtenFiles: string[];
      snapshot: VersionSnapshot;
    }
  | {
      success: false;
      error: unknown;
      /** The snapshot we reverted to, or null if we failed before snapshotting. */
      rolledBackTo: VersionSnapshot | null;
    };

/** The closed adapter registry, keyed by change kind. */
const ADAPTERS: Readonly<Record<ChangeSetKind, StructuralAdapter>> = {
  "add-gate": addGateAdapter,
  "trim-context": trimContextAdapter,
  "edit-skill": editSkillAdapter,
  "prompt-patch": promptPatchAdapter,
  "delete-layer": deleteLayerAdapter,
};

/**
 * Dispatch a change kind to its `StructuralAdapter`. The taxonomy is CLOSED: an
 * unknown kind throws (there is no default adapter — a new kind must be added to the
 * frozen v1 enum and registered here, never silently handled).
 */
export function resolveAdapter(kind: ChangeSetKind): StructuralAdapter {
  const adapter = ADAPTERS[kind];
  if (!adapter) {
    throw new Error(`no StructuralAdapter registered for change kind "${kind}" (closed taxonomy)`);
  }
  return adapter;
}

/** Bump `"v<N>"` -> `"v<N+1>"`; fall back to a `-candidate` suffix otherwise. */
function bumpVersion(currentVersion: string): string {
  const m = /^v(\d+)$/.exec(currentVersion);
  if (m) return `v${Number(m[1]) + 1}`;
  return `${currentVersion}-candidate`;
}

/**
 * Apply a v2 manifest atomically: snapshot first, apply once, revert on any failure.
 *
 * @param manifest        the typed v2 change manifest (machine-parseable detail).
 * @param registry        the snapshot/revert collaborator (FileVersionRegistry).
 * @param adapter         the StructuralAdapter for this change kind (from resolveAdapter).
 * @param harnessRoot     the root every targetFile is confined to.
 * @param currentVersion  the harness version being mutated (e.g. "v37").
 */
export async function applyManifest(
  manifest: ChangeManifestV2,
  registry: HarnessVersionRegistry,
  adapter: StructuralAdapter,
  harnessRoot: string,
  currentVersion: string,
): Promise<ApplyResult> {
  // 1. Dry-run validate FIRST. A validation failure never writes, so there is
  //    nothing to revert (rolledBackTo: null).
  const validation = adapter.validate(manifest.detail, harnessRoot);
  if (!validation.ok) {
    return { success: false, error: new Error(validation.reason), rolledBackTo: null };
  }

  // 2. Snapshot every target file BEFORE the first write (the atomic baseline).
  const snapshot = await registry.snapshot(
    manifest.agentId,
    currentVersion,
    manifest.detail.targetFiles,
  );

  // 3. Single try over the WHOLE adapter.apply — never an inner per-file loop.
  try {
    const writtenFiles = adapter.apply(manifest.detail, harnessRoot);
    const candidateVersion = bumpVersion(currentVersion);
    return { success: true, candidateVersion, writtenFiles, snapshot };
  } catch (error) {
    // 4. Revert the ENTIRE change from the immutable snapshot — byte-identical.
    await registry.revert(snapshot);
    return { success: false, error, rolledBackTo: snapshot };
  }
}
