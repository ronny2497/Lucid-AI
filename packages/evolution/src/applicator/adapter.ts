/**
 * @lucid/evolution — `StructuralAdapter`: the per-change-kind apply contract
 * (Plan 04-02, Task 1, REQ-05).
 *
 * The applicator is the privileged write path: it is the first place in the whole
 * evolution pipeline that actually mutates harness files. Every write is therefore
 * funnelled through a `StructuralAdapter` that is SAFE BY CONSTRUCTION:
 *
 *   1. It consumes ONLY the typed v2 `detail` (the discriminated-union variant for
 *      its `kind`) — never raw trace attributes, never prose. The applicator knows
 *      exactly which structured fields it reads (T-04-04).
 *
 *   2. It writes ONLY files inside `harnessRoot`. Even though the v2 schema already
 *      rejects absolute / `..` `targetFiles` at parse time, every adapter RE-ASSERTS
 *      containment against the resolved `harnessRoot` before writing — defense in
 *      depth (T-04-06). `validate()` does this as a dry-run; `apply()` re-asserts and
 *      throws.
 *
 *   3. It NEVER touches a model-weight file, a Python training artifact, or a
 *      TrainerPlugin — the L1 structural-only boundary (ADR-0004). The only surfaces
 *      it edits are the harness structural files named in `detail.targetFiles`.
 *
 * No barrel import lives here — adapters are imported by `applicator/index.ts` (the
 * dispatcher) and by tests via their module paths directly; `src/index.ts` (the
 * public barrel) is owned by 04-04.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import type { ChangeManifestV2Detail } from "../schema-v2.js";
import type { ChangeSetKind } from "../schema.js";

/**
 * The result of an adapter dry-run check. `ok: false` carries a human-readable
 * `reason` (surfaced in the apply failure / audit trail).
 */
export type ValidationResult = { ok: true } | { ok: false; reason: string };

/**
 * A per-change-kind structural adapter. `validate` is a side-effect-free dry-run
 * (no write); `apply` performs the actual structural edit and returns the list of
 * harness-relative paths it wrote/removed.
 */
export interface StructuralAdapter {
  /** The single change kind this adapter handles (closed taxonomy). */
  readonly changeKind: ChangeSetKind;
  /** Dry-run: returns ok:false (with reason) if the change cannot be safely applied. */
  validate(detail: ChangeManifestV2Detail, harnessRoot: string): ValidationResult;
  /** Apply the structural edit; returns the harness-relative paths written. Throws on any unsafe condition. */
  apply(detail: ChangeManifestV2Detail, harnessRoot: string): string[];
}

/**
 * Resolve a harness-relative `target` against `harnessRoot` and assert it stays
 * inside the resolved root. Returns the resolved absolute path on success.
 *
 * Defense in depth on top of the schema-level `..`/absolute rejection (T-04-06): an
 * absolute target, or one whose resolved path escapes `harnessRoot` (via `..` or a
 * symlink-relative segment), is REJECTED — never clamped. Throws an `Error` whose
 * message names the offending path.
 */
export function resolveWithinRoot(harnessRoot: string, target: string): string {
  const root = resolve(harnessRoot);
  // An absolute target is never valid — targetFiles are harness-relative.
  if (isAbsolute(target)) {
    throw new Error(
      `target "${target}" is an absolute path; targetFiles must be harness-relative and confined to harnessRoot (T-04-06)`,
    );
  }
  const resolved = resolve(root, target);
  const rel = relative(root, resolved);
  // `rel` escaping the root begins with ".." (or, on Windows, is itself absolute).
  if (rel === ".." || rel.startsWith(".." + "/") || rel.startsWith(".." + "\\") || isAbsolute(rel)) {
    throw new Error(
      `target "${target}" resolves outside harnessRoot ("${root}"); a path that escapes the root is rejected, not clamped (T-04-06)`,
    );
  }
  return resolved;
}

/**
 * Dry-run containment check over a list of `targetFiles`. Returns ok:false with the
 * first offending reason instead of throwing — used by every adapter's `validate`.
 */
export function checkWithinRoot(targetFiles: string[], harnessRoot: string): ValidationResult {
  for (const target of targetFiles) {
    try {
      resolveWithinRoot(harnessRoot, target);
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }
  return { ok: true };
}

/**
 * The throwing variant used inside `apply()`: re-asserts containment for every
 * target and returns the resolved absolute paths. Mirrors `checkWithinRoot` so
 * validate-then-apply share one containment rule.
 */
export function assertWithinRoot(targetFiles: string[], harnessRoot: string): string[] {
  return targetFiles.map((target) => resolveWithinRoot(harnessRoot, target));
}

/**
 * Atomic single-file write: write to a temp sibling in the destination directory,
 * then `rename` over the target. `rename` within the same directory is atomic on
 * POSIX, so a reader never observes a half-written file (Pattern 1 / A2 — `fs`
 * built-ins are sufficient within a single partition).
 */
export function atomicWriteFile(absPath: string, content: string): void {
  const dir = dirname(absPath);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.apply-${randomBytes(6).toString("hex")}.tmp`);
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, absPath);
}

/** Read a harness file as utf8 text. Throws (with the relative target) if missing. */
export function readTarget(absPath: string, target: string): string {
  if (!existsSync(absPath)) {
    throw new Error(`target "${target}" does not exist in harnessRoot`);
  }
  return readFileSync(absPath, "utf8");
}

/**
 * Remove a file inside harnessRoot (used by `delete-layer`). The caller has already
 * snapshotted it, so removal is reversible. We move-then-remove via a temp rename so
 * the removal is also atomic-ish (the rename detaches the inode before unlink).
 */
export function removeTarget(absPath: string): void {
  if (!existsSync(absPath)) return;
  const dir = dirname(absPath);
  const tmp = join(dir, `.delete-${randomBytes(6).toString("hex")}.tmp`);
  renameSync(absPath, tmp);
  rmSync(tmp, { force: true });
}

// `copyFileSync` is re-exported for adapters that need a verbatim copy primitive.
export { copyFileSync };
