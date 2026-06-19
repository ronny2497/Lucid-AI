/**
 * @lucid/evolution — `HarnessVersionRegistry` + `FileVersionRegistry`: the
 * reversible-by-construction snapshot store (Task 3, REQ-05 / T-04-05).
 *
 * Auto-apply mutates real harness files. The safety property the applicator (04-02)
 * and the regression guard (04-03) depend on is: ANY apply is reversible to a
 * byte-identical baseline. This registry provides that — NOT via a diff/patch
 * invert (which can fail to apply cleanly), but via an immutable full-file SNAPSHOT
 * taken BEFORE the first write. A revert is then just a file copy back; it cannot
 * fail due to a merge conflict.
 *
 * SNAPSHOT-BEFORE-WRITE (T-04-05): `snapshot()` copies each affected file into
 * `<base>/.lucid/snapshots/{snapshotId}/{relativePath}` and records its SHA-256
 * `contentHash` BEFORE returning — so the known-good baseline exists before the
 * applicator writes a single byte. `revert(snapshot)` copies those immutable files
 * back to their original paths atomically (temp sibling + rename within the same
 * dir). A round-trip (snapshot → mutate → revert) restores byte-identical content.
 *
 * STRUCTURAL-ONLY: the registry writes ONLY under `.lucid/snapshots/` and to the
 * harness file paths it is explicitly handed. There is no model-weight /
 * `.safetensors` path anywhere — weight versioning is L2 (Phase 5), out of scope.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";

/** One snapshotted file: its harness-relative path and SHA-256 content hash. */
export interface SnapshotFile {
  /** Harness-relative path (as handed to snapshot). */
  path: string;
  /** SHA-256 over the file's content at snapshot time (tamper-evidence). */
  contentHash: string;
}

/** An immutable record of one harness version's files. */
export interface VersionSnapshot {
  /** "snap-{id}" — stable, unique. */
  snapshotId: string;
  /** Normalized agent identity. */
  agentId: string;
  /** The harness version this snapshot captures, e.g. "v37". */
  version: string;
  /** The snapshotted files (paths + hashes; bodies live in snapshotDir). */
  files: SnapshotFile[];
  /** Absolute path of the immutable snapshot directory. */
  snapshotDir: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

/**
 * The version-registry seam. Implementations MUST snapshot before any write and
 * revert from the immutable snapshot copy (never a diff invert).
 */
export interface HarnessVersionRegistry {
  /** Snapshot `files` for `agentId@version` into an immutable dir BEFORE any write. */
  snapshot(agentId: string, version: string, files: string[]): Promise<VersionSnapshot>;
  /** Promote a candidate version to current (metadata-only at this layer). */
  promote(agentId: string, candidateVersion: string): Promise<void>;
  /** Restore the original files from a snapshot (byte-identical). */
  revert(snapshot: VersionSnapshot): Promise<void>;
  /** Fetch a stored snapshot for `agentId@version`, or null. */
  getSnapshot(agentId: string, version: string): Promise<VersionSnapshot | null>;
  /** List all snapshots for an agent. */
  listVersions(agentId: string): Promise<VersionSnapshot[]>;
}

const SNAPSHOTS_SUBDIR = join(".lucid", "snapshots");

function sha256(buf: Buffer): string {
  return "sha256:" + createHash("sha256").update(buf).digest("hex");
}

/**
 * A filesystem-backed `HarnessVersionRegistry` rooted at a base dir. Snapshots
 * live under `<base>/.lucid/snapshots/{snapshotId}/`. The base dir is also the
 * root the snapshotted relative paths are resolved against.
 */
export class FileVersionRegistry implements HarnessVersionRegistry {
  private readonly base: string;
  private readonly snapshotsRoot: string;

  constructor(base: string) {
    this.base = base;
    this.snapshotsRoot = join(base, SNAPSHOTS_SUBDIR);
  }

  async snapshot(agentId: string, version: string, files: string[]): Promise<VersionSnapshot> {
    const snapshotId = `snap-${randomBytes(6).toString("hex")}`;
    const snapshotDir = join(this.snapshotsRoot, snapshotId);
    mkdirSync(snapshotDir, { recursive: true });

    const snapshotFiles: SnapshotFile[] = [];
    for (const rel of files) {
      const srcAbs = join(this.base, rel);
      const content = readFileSync(srcAbs);
      const destAbs = join(snapshotDir, rel);
      mkdirSync(dirname(destAbs), { recursive: true });
      // copyFileSync copies bytes verbatim into the immutable snapshot dir.
      copyFileSync(srcAbs, destAbs);
      snapshotFiles.push({ path: rel, contentHash: sha256(content) });
    }

    const snapshot: VersionSnapshot = {
      snapshotId,
      agentId,
      version,
      files: snapshotFiles,
      snapshotDir,
      createdAt: new Date().toISOString(),
    };
    // Persist metadata alongside the copies so getSnapshot/listVersions can read it.
    writeFileSync(
      join(snapshotDir, "snapshot.json"),
      JSON.stringify(snapshot, null, 2) + "\n",
      "utf8",
    );
    return snapshot;
  }

  async promote(_agentId: string, _candidateVersion: string): Promise<void> {
    // Metadata-only at the registry layer; the orchestrator (04-04) records the
    // promoted version. No file mutation here, so nothing to snapshot.
  }

  async revert(snapshot: VersionSnapshot): Promise<void> {
    for (const file of snapshot.files) {
      const snapAbs = join(snapshot.snapshotDir, file.path);
      const destAbs = join(this.base, file.path);
      mkdirSync(dirname(destAbs), { recursive: true });
      // Atomic restore: copy to a temp sibling in the dest dir, then rename.
      const tmpAbs = join(dirname(destAbs), `.revert-${randomBytes(4).toString("hex")}.tmp`);
      copyFileSync(snapAbs, tmpAbs);
      renameSync(tmpAbs, destAbs);
    }
  }

  async getSnapshot(agentId: string, version: string): Promise<VersionSnapshot | null> {
    const all = await this.listVersions(agentId);
    return all.find((s) => s.version === version) ?? null;
  }

  async listVersions(agentId: string): Promise<VersionSnapshot[]> {
    if (!existsSync(this.snapshotsRoot)) return [];
    const out: VersionSnapshot[] = [];
    for (const entry of readdirSync(this.snapshotsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const metaPath = join(this.snapshotsRoot, entry.name, "snapshot.json");
      if (!existsSync(metaPath)) continue;
      const snap = JSON.parse(readFileSync(metaPath, "utf8")) as VersionSnapshot;
      if (snap.agentId === agentId) out.push(snap);
    }
    return out;
  }
}
