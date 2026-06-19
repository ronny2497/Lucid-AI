/**
 * FileApplyStore + ApplyRecordSchema — the decoupled audit store (Task 2, REQ-05 /
 * T-04-04).
 *
 * Asserts: save then list returns the record; filter by agentId / verdict / since;
 * getApplyRecord by id; and that ApplyRecordSchema carries no raw-content field.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  FileApplyStore,
  ApplyRecordSchema,
  type ApplyRecord,
} from "../../src/apply-store.js";

function record(overrides: Partial<ApplyRecord> = {}): ApplyRecord {
  return ApplyRecordSchema.parse({
    id: "ar-1",
    manifestId: "cm-1",
    agentId: "my-agent",
    fromVersion: "v37",
    toVersion: "v38",
    changeKind: "add-gate",
    approvedBy: "human:alice",
    verdict: "KEEP",
    baselineScore: 0.6,
    candidateScore: 0.75,
    delta: 0.15,
    evidence: "candidate +0.15 over 200 samples",
    affectedFiles: ["config/gates.yaml"],
    contentHash: "sha256:abc123",
    rollbackStatus: "none",
    createdAt: "2026-06-18T12:00:00.000Z",
    ...overrides,
  });
}

describe("FileApplyStore", () => {
  let dir: string;
  let store: FileApplyStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lucid-apply-"));
    store = new FileApplyStore(join(dir, "apply-records.json"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("saveApplyRecord then listApplyRecords returns the record", async () => {
    await store.saveApplyRecord(record());
    const all = await store.listApplyRecords({});
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("ar-1");
  });

  it("filters by agentId and by verdict", async () => {
    await store.saveApplyRecord(record({ id: "ar-1", agentId: "agent-a", verdict: "KEEP" }));
    await store.saveApplyRecord(record({ id: "ar-2", agentId: "agent-b", verdict: "REVERT", rollbackStatus: "auto-rollback" }));
    expect(await store.listApplyRecords({ agentId: "agent-a" })).toHaveLength(1);
    expect(await store.listApplyRecords({ status: "REVERT" })).toHaveLength(1);
    expect((await store.listApplyRecords({ status: "REVERT" }))[0].id).toBe("ar-2");
  });

  it("filters by since", async () => {
    await store.saveApplyRecord(record({ id: "ar-old", createdAt: "2026-01-01T00:00:00.000Z" }));
    await store.saveApplyRecord(record({ id: "ar-new", createdAt: "2026-12-01T00:00:00.000Z" }));
    const recent = await store.listApplyRecords({ since: "2026-06-01T00:00:00.000Z" });
    expect(recent.map((r) => r.id)).toEqual(["ar-new"]);
  });

  it("getApplyRecord by id, and null when absent", async () => {
    await store.saveApplyRecord(record());
    expect((await store.getApplyRecord("ar-1"))?.id).toBe("ar-1");
    expect(await store.getApplyRecord("ar-nope")).toBeNull();
  });

  it("upserts by id", async () => {
    await store.saveApplyRecord(record({ verdict: "KEEP" }));
    await store.saveApplyRecord(record({ verdict: "REVERT", rollbackStatus: "manual-rollback" }));
    const all = await store.listApplyRecords({});
    expect(all).toHaveLength(1);
    expect(all[0].verdict).toBe("REVERT");
  });

  it("ApplyRecordSchema carries no raw-content field (paths + scores + hash only)", () => {
    const shape = ApplyRecordSchema.shape;
    const keys = Object.keys(shape);
    for (const banned of ["body", "content", "prompt", "promptText", "toolArgs", "messages", "raw"]) {
      expect(keys).not.toContain(banned);
    }
    // Tamper-evidence + paths are present.
    expect(keys).toContain("contentHash");
    expect(keys).toContain("affectedFiles");
  });
});
