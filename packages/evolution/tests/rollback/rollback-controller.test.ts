/**
 * `rollbackController` — guaranteed revert + REVERT ApplyRecord + audit emission in
 * a finally path (Plan 04-03, Task 2).
 *
 * Asserts:
 *   - `registry.revert(snapshot)` runs (the known-good files are restored);
 *   - a `verdict: "REVERT"` ApplyRecord with the requested `rollbackStatus` is saved;
 *   - the audit `emit` fires with that record;
 *   - FAULT: when `store.saveApplyRecord` throws, `emit` STILL fires (the event is
 *     never swallowed — T-04-11 / Pitfall 5) and the persistence error propagates;
 *   - the manual kill-switch mode yields `rollbackStatus: "manual-rollback"`.
 *
 * Imports the module directly (not the barrel) — `src/index.ts` is owned by 04-04.
 */

import { describe, it, expect } from "vitest";

import { rollbackController, type RollbackControllerArgs } from "../../src/rollback.js";
import type { ApplyRecord, ApplyStore, ApplyRecordFilter } from "../../src/apply-store.js";
import type { HarnessVersionRegistry, VersionSnapshot } from "../../src/version-registry.js";

function snapshot(): VersionSnapshot {
  return {
    snapshotId: "snap-abc",
    agentId: "my-agent",
    version: "v37",
    files: [{ path: "context-policy/budget.yaml", contentHash: "sha256:deadbeef" }],
    snapshotDir: "/tmp/snap-abc",
    createdAt: "2026-06-18T00:00:00.000Z",
  };
}

/** A registry stub recording whether `revert` ran (with the snapshot it received). */
function stubRegistry(): { registry: HarnessVersionRegistry; reverted: VersionSnapshot[] } {
  const reverted: VersionSnapshot[] = [];
  const registry: HarnessVersionRegistry = {
    async snapshot() {
      throw new Error("not used");
    },
    async promote() {},
    async revert(snap: VersionSnapshot) {
      reverted.push(snap);
    },
    async getSnapshot() {
      return null;
    },
    async listVersions() {
      return [];
    },
  };
  return { registry, reverted };
}

/** An in-memory ApplyStore; `failSave` makes saveApplyRecord throw (the fault case). */
function memStore(failSave = false): { store: ApplyStore; saved: ApplyRecord[] } {
  const saved: ApplyRecord[] = [];
  const store: ApplyStore = {
    async saveApplyRecord(record: ApplyRecord) {
      if (failSave) throw new Error("disk full");
      saved.push(record);
    },
    async listApplyRecords(_filter: ApplyRecordFilter) {
      return saved;
    },
    async getApplyRecord(id: string) {
      return saved.find((r) => r.id === id) ?? null;
    },
  };
  return { store, saved };
}

function baseArgs(over: Partial<RollbackControllerArgs> = {}): RollbackControllerArgs {
  const { registry } = stubRegistry();
  const { store } = memStore();
  return {
    snapshot: snapshot(),
    registry,
    manifestId: "cm-trim-22",
    agentId: "my-agent",
    fromVersion: "v37",
    toVersion: "v38",
    changeKind: "trim-context",
    approvedBy: "auto-approver:guard",
    store,
    evidence: "context regressed -0.17 over 200 samples",
    mode: "auto-rollback",
    emit: () => {},
    baselineScore: 0.72,
    candidateScore: 0.55,
    guardMetric: "context",
    ...over,
  };
}

describe("rollbackController — guaranteed revert + audit", () => {
  it("reverts via the registry, saves a REVERT record, and emits the audit event", async () => {
    const { registry, reverted } = stubRegistry();
    const { store, saved } = memStore();
    const emitted: ApplyRecord[] = [];

    const record = await rollbackController(
      baseArgs({ registry, store, emit: (r) => emitted.push(r) }),
    );

    expect(reverted).toHaveLength(1);
    expect(reverted[0].snapshotId).toBe("snap-abc");
    expect(record.verdict).toBe("REVERT");
    expect(record.rollbackStatus).toBe("auto-rollback");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual(record);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual(record);
    // Body carries only the affected-file PATHS from the snapshot (no content).
    expect(record.affectedFiles).toEqual(["context-policy/budget.yaml"]);
    expect(record.delta).toBeCloseTo(0.55 - 0.72);
    expect(record.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("emits the audit event EVEN WHEN persistence throws (Pitfall 5 — never swallowed)", async () => {
    const { registry, reverted } = stubRegistry();
    const { store } = memStore(/* failSave */ true);
    const emitted: ApplyRecord[] = [];

    await expect(
      rollbackController(baseArgs({ registry, store, emit: (r) => emitted.push(r) })),
    ).rejects.toThrow(/disk full/);

    // The revert still happened, and the audit event STILL fired despite the throw.
    expect(reverted).toHaveLength(1);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].verdict).toBe("REVERT");
    expect(emitted[0].rollbackStatus).toBe("auto-rollback");
  });

  it("produces rollbackStatus 'manual-rollback' for the kill-switch path", async () => {
    const emitted: ApplyRecord[] = [];
    const record = await rollbackController(
      baseArgs({ mode: "manual-rollback", emit: (r) => emitted.push(r) }),
    );
    expect(record.rollbackStatus).toBe("manual-rollback");
    expect(emitted[0].rollbackStatus).toBe("manual-rollback");
  });
});
