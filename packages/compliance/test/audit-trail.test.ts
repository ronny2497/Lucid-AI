import { describe, expect, it } from "vitest";

import {
  appendAuditRecord,
  chainRecords,
  verifyChain,
  verifyChainJsonl,
  toJsonl,
  GENESIS_PREV_HASH,
} from "../src/audit-trail.js";
import { InMemoryAuditSource } from "../src/source.js";
import type { AuditDraftRecord } from "../src/index.js";
import { EuAiActRecordSchema } from "../src/schema.js";

/**
 * Tamper-evident hash-chain core (REQ-06, T-06-15) + the AuditSource read seam.
 *
 * Pins: HMAC-SHA256 linkage via prev_hash; an untampered chain verifies; any
 * content edit / reorder / out-of-band append breaks the chain and names the
 * first broken index; the in-memory AuditSource satisfies the seam for both the
 * FULL (Phase-3-5-present) and BASICS-ONLY (absent) record sets.
 */

const SECRET = "test-secret-key";

function draft(over: Partial<AuditDraftRecord> = {}): AuditDraftRecord {
  return {
    record_id: "rec-1",
    start_time: "2026-01-01T00:00:00.000Z",
    end_time: "2026-01-01T00:01:00.000Z",
    agent_id: "agent-7",
    harness_version: "1.2.3",
    model_id: "claude-sonnet-4",
    change_manifest_ids: [],
    ...over,
  };
}

describe("appendAuditRecord", () => {
  it("links the genesis record to the documented zero prev_hash and stamps an HMAC integrity_hash", () => {
    const rec = appendAuditRecord(draft(), GENESIS_PREV_HASH, SECRET);
    expect(rec.prev_hash).toBe(GENESIS_PREV_HASH);
    expect(rec.integrity_hash).toMatch(/^[0-9a-f]{64}$/);
    // Stamped record parses against the frozen contract.
    expect(EuAiActRecordSchema.safeParse(rec).success).toBe(true);
  });

  it("links each record to the previous record's integrity_hash", () => {
    const first = appendAuditRecord(draft({ record_id: "r1" }), GENESIS_PREV_HASH, SECRET);
    const second = appendAuditRecord(draft({ record_id: "r2" }), first.integrity_hash, SECRET);
    expect(second.prev_hash).toBe(first.integrity_hash);
  });

  it("is reproducible regardless of input key insertion order (canonical JSON)", () => {
    const a = appendAuditRecord(
      { record_id: "x", start_time: "t0", end_time: "t1", agent_id: "a", harness_version: "v", model_id: "m", change_manifest_ids: [] },
      GENESIS_PREV_HASH,
      SECRET,
    );
    const b = appendAuditRecord(
      { change_manifest_ids: [], model_id: "m", harness_version: "v", agent_id: "a", end_time: "t1", start_time: "t0", record_id: "x" },
      GENESIS_PREV_HASH,
      SECRET,
    );
    expect(a.integrity_hash).toBe(b.integrity_hash);
  });

  it("ignores any pre-existing hash fields on the draft (chain cannot be sourced upstream)", () => {
    const clean = appendAuditRecord(draft({ record_id: "z" }), GENESIS_PREV_HASH, SECRET);
    const dirty = appendAuditRecord(
      { ...draft({ record_id: "z" }), integrity_hash: "deadbeef", prev_hash: "cafe" } as AuditDraftRecord,
      GENESIS_PREV_HASH,
      SECRET,
    );
    expect(dirty.integrity_hash).toBe(clean.integrity_hash);
  });
});

describe("verifyChain", () => {
  it("returns valid:true over an untampered append-only sequence", () => {
    const chain = chainRecords([draft({ record_id: "r1" }), draft({ record_id: "r2" }), draft({ record_id: "r3" })], SECRET);
    const v = verifyChain(chain, SECRET);
    expect(v.valid).toBe(true);
    expect(v.firstBrokenIndex).toBeNull();
  });

  it("detects a content edit and names the first broken index", () => {
    const chain = chainRecords([draft({ record_id: "r1" }), draft({ record_id: "r2" }), draft({ record_id: "r3" })], SECRET);
    const tampered = chain.map((r, i) => (i === 1 ? { ...r, model_id: "swapped-model" } : r));
    const v = verifyChain(tampered, SECRET);
    expect(v.valid).toBe(false);
    expect(v.firstBrokenIndex).toBe(1);
  });

  it("detects a reorder", () => {
    const chain = chainRecords([draft({ record_id: "r1" }), draft({ record_id: "r2" }), draft({ record_id: "r3" })], SECRET);
    const reordered = [chain[1], chain[0], chain[2]];
    const v = verifyChain(reordered, SECRET);
    expect(v.valid).toBe(false);
    expect(v.firstBrokenIndex).toBe(0);
  });

  it("detects an out-of-band append (record added without recomputing the chain)", () => {
    const chain = chainRecords([draft({ record_id: "r1" }), draft({ record_id: "r2" })], SECRET);
    // Append a record whose prev_hash/integrity_hash were not computed for this chain.
    const rogue = { ...draft({ record_id: "rogue" }), prev_hash: "0".repeat(64), integrity_hash: "f".repeat(64) };
    const v = verifyChain([...chain, rogue], SECRET);
    expect(v.valid).toBe(false);
    expect(v.firstBrokenIndex).toBe(2);
  });

  it("fails verification under a different secret (the HMAC key matters)", () => {
    const chain = chainRecords([draft()], SECRET);
    expect(verifyChain(chain, "other-secret").valid).toBe(false);
  });
});

describe("JSONL round-trip", () => {
  it("serializes append-only JSONL and verifies the parsed chain", () => {
    const chain = chainRecords([draft({ record_id: "r1" }), draft({ record_id: "r2" })], SECRET);
    const jsonl = toJsonl(chain);
    expect(jsonl.trim().split("\n")).toHaveLength(2);
    const v = verifyChainJsonl(jsonl, SECRET);
    expect(v.valid).toBe(true);
    expect(v.records).toHaveLength(2);
  });

  it("detects a tampered JSONL line", () => {
    const chain = chainRecords([draft({ record_id: "r1" }), draft({ record_id: "r2" })], SECRET);
    const lines = toJsonl(chain).trim().split("\n");
    const obj = JSON.parse(lines[1]);
    obj.model_id = "tampered";
    lines[1] = JSON.stringify(obj);
    const v = verifyChainJsonl(lines.join("\n"), SECRET);
    expect(v.valid).toBe(false);
    expect(v.firstBrokenIndex).toBe(1);
  });
});

describe("InMemoryAuditSource (seam fixture)", () => {
  const full: AuditDraftRecord[] = [
    draft({ record_id: "f1", change_manifest_ids: ["cm-1"], human_oversight_action: "approved by reviewer" }),
    draft({ record_id: "f2", start_time: "2026-01-02T00:00:00.000Z", change_manifest_ids: ["cm-2", "cm-3"] }),
  ];
  const basicsOnly: AuditDraftRecord[] = [
    draft({ record_id: "b1", change_manifest_ids: [] }),
  ];

  it("returns FULL records (change manifests + oversight) filtered by agent + window", async () => {
    const src = new InMemoryAuditSource(full);
    const out = await src.fetchRecords({ agentId: "agent-7", since: "2026-01-01T00:00:00.000Z", until: "2026-01-01T23:59:59.999Z" });
    expect(out).toHaveLength(1);
    expect(out[0].record_id).toBe("f1");
    expect(out[0].change_manifest_ids).toEqual(["cm-1"]);
    expect(out[0].human_oversight_action).toBe("approved by reviewer");
  });

  it("returns ONLY the trace basics when Phase 3–5 data is absent (empty change_manifest_ids, no oversight)", async () => {
    const src = new InMemoryAuditSource(basicsOnly);
    const out = await src.fetchRecords({ agentId: "agent-7", since: "2026-01-01T00:00:00.000Z", until: "2026-12-31T00:00:00.000Z" });
    expect(out).toHaveLength(1);
    expect(out[0].change_manifest_ids).toEqual([]);
    expect(out[0].human_oversight_action).toBeUndefined();
  });

  it("excludes records outside the agent or window filter", async () => {
    const src = new InMemoryAuditSource(full);
    const wrongAgent = await src.fetchRecords({ agentId: "other", since: "2026-01-01T00:00:00.000Z", until: "2026-12-31T00:00:00.000Z" });
    expect(wrongAgent).toHaveLength(0);
    const narrowWindow = await src.fetchRecords({ agentId: "agent-7", since: "2026-06-01T00:00:00.000Z", until: "2026-06-30T00:00:00.000Z" });
    expect(narrowWindow).toHaveLength(0);
  });
});
