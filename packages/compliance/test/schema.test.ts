import { describe, expect, it } from "vitest";

import { EuAiActRecordSchema, EvidencePackageSchema } from "../src/schema.js";

/**
 * RED scaffold for the EU AI Act Article 12 evidence schemas (REQ-06).
 *
 * Pins: the Article 12 record parses; integrity_hash + prev_hash are mandatory
 * (tamper-evidence, T-06-01); the EvidencePackage parses; an empty/missing
 * disclaimer is rejected (T-06-02); a regime outside the launch set is rejected;
 * change_manifest_ids accepts the Phase 3 "cm-..." id shape (cross-phase link).
 */

function baseRecord() {
  return {
    record_id: "rec-0001",
    start_time: "2026-06-19T00:00:00.000Z",
    end_time: "2026-06-19T00:05:00.000Z",
    agent_id: "agent-7",
    harness_version: "0.16.0",
    model_id: "claude-sonnet-4",
    change_manifest_ids: ["cm-abc123"],
    integrity_hash: "a".repeat(64),
    prev_hash: "0".repeat(64),
  };
}

function basePackage() {
  return {
    regime: "eu-ai-act" as const,
    generated_at: "2026-06-19T00:10:00.000Z",
    agent_id: "agent-7",
    period: { since: "2026-06-01T00:00:00.000Z", until: "2026-06-19T00:00:00.000Z" },
    records: [baseRecord()],
    disclaimer:
      "This package is evidence assembly, not legal certification or a conformity attestation.",
    redaction_applied: true,
  };
}

describe("EuAiActRecordSchema", () => {
  it("parses a complete Article 12 record", () => {
    expect(EuAiActRecordSchema.safeParse(baseRecord()).success).toBe(true);
  });

  it("REJECTS a record missing integrity_hash (tamper-evidence mandatory)", () => {
    const r = baseRecord() as Record<string, unknown>;
    delete r.integrity_hash;
    expect(EuAiActRecordSchema.safeParse(r).success).toBe(false);
  });

  it("REJECTS a record missing prev_hash (tamper-evidence mandatory)", () => {
    const r = baseRecord() as Record<string, unknown>;
    delete r.prev_hash;
    expect(EuAiActRecordSchema.safeParse(r).success).toBe(false);
  });

  it("accepts the Phase 3 ChangeManifest cm-... id shape in change_manifest_ids", () => {
    const r = { ...baseRecord(), change_manifest_ids: ["cm-add-gate-001", "cm-trim-002"] };
    expect(EuAiActRecordSchema.safeParse(r).success).toBe(true);
  });
});

describe("EvidencePackageSchema", () => {
  it("parses a complete evidence package", () => {
    expect(EvidencePackageSchema.safeParse(basePackage()).success).toBe(true);
  });

  it("REJECTS a package with an empty disclaimer", () => {
    const p = { ...basePackage(), disclaimer: "" };
    expect(EvidencePackageSchema.safeParse(p).success).toBe(false);
  });

  it("REJECTS a package with a missing disclaimer", () => {
    const p = basePackage() as Record<string, unknown>;
    delete p.disclaimer;
    expect(EvidencePackageSchema.safeParse(p).success).toBe(false);
  });

  it("REJECTS a regime outside the launch set", () => {
    const p = { ...basePackage(), regime: "nist-ai-rmf" };
    expect(EvidencePackageSchema.safeParse(p).success).toBe(false);
  });

  it("accepts the colorado regime (overlay)", () => {
    const p = { ...basePackage(), regime: "colorado" as const };
    expect(EvidencePackageSchema.safeParse(p).success).toBe(true);
  });

  it("REJECTS an unknown extra key (strict)", () => {
    const p = { ...basePackage(), extra: 1 };
    expect(EvidencePackageSchema.safeParse(p).success).toBe(false);
  });
});
