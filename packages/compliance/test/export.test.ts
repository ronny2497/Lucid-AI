import { describe, expect, it } from "vitest";

import {
  exportEvidence,
  NON_CERTIFICATION_DISCLAIMER,
} from "../src/export.js";
import { InMemoryAuditSource } from "../src/source.js";
import { verifyChain } from "../src/audit-trail.js";
import { EvidencePackageSchema } from "../src/schema.js";
import type { AuditDraftRecord } from "../src/index.js";
import type { RedactionConfig } from "../src/redaction-gate.js";

/**
 * Export orchestrator (REQ-06). Pins: assembles a schema-valid, hash-chained
 * EvidencePackage with the mandatory non-certification disclaimer; refuses on
 * incomplete redaction (no silent leak); stamps redaction_applied honestly.
 */

const SECRET = "export-secret";
const NO_CONTENT_DROP: RedactionConfig = {
  contentFields: { "gen_ai.input.messages": "drop", "gen_ai.tool.call.arguments": "drop" },
};

function draft(over: Partial<AuditDraftRecord> = {}): AuditDraftRecord {
  return {
    record_id: "rec",
    start_time: "2026-01-01T00:00:00.000Z",
    end_time: "2026-01-01T00:01:00.000Z",
    agent_id: "agent-7",
    harness_version: "1.2.3",
    model_id: "claude-sonnet-4",
    change_manifest_ids: [],
    ...over,
  };
}

const WINDOW = { since: "2026-01-01T00:00:00.000Z", until: "2026-12-31T00:00:00.000Z" };

describe("exportEvidence — happy path", () => {
  it("assembles a schema-valid EvidencePackage with disclaimer + hash-chained records", async () => {
    const src = new InMemoryAuditSource([draft({ record_id: "r1" }), draft({ record_id: "r2" })]);
    const out = await exportEvidence(src, {
      regime: "eu-ai-act",
      agentId: "agent-7",
      ...WINDOW,
      redactionConfig: NO_CONTENT_DROP,
      secret: SECRET,
      generatedAt: "2026-06-18T00:00:00.000Z",
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(EvidencePackageSchema.safeParse(out.package).success).toBe(true);
    expect(out.package.disclaimer).toBe(NON_CERTIFICATION_DISCLAIMER);
    expect(out.package.records).toHaveLength(2);
    expect(verifyChain(out.package.records, SECRET).valid).toBe(true);
  });

  it("redaction_applied is FALSE when no content fields were present", async () => {
    const src = new InMemoryAuditSource([draft()]);
    const out = await exportEvidence(src, {
      regime: "eu-ai-act",
      agentId: "agent-7",
      ...WINDOW,
      redactionConfig: NO_CONTENT_DROP,
      secret: SECRET,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.package.redaction_applied).toBe(false);
  });

  it("redaction_applied is TRUE when a content field was present AND configured", async () => {
    const src = new InMemoryAuditSource([draft({ input_summary: "redacted-upstream" })]);
    const out = await exportEvidence(src, {
      regime: "eu-ai-act",
      agentId: "agent-7",
      ...WINDOW,
      redactionConfig: NO_CONTENT_DROP,
      secret: SECRET,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.package.redaction_applied).toBe(true);
  });

  it("carries the obligation-coverage manifest (partial when Phase 3-5 absent)", async () => {
    const src = new InMemoryAuditSource([draft()]);
    const out = await exportEvidence(src, {
      regime: "eu-ai-act",
      agentId: "agent-7",
      ...WINDOW,
      redactionConfig: NO_CONTENT_DROP,
      secret: SECRET,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.coverage.partial).toBe(true);
  });
});

describe("exportEvidence — refusals", () => {
  it("REFUSES when a content field is present with NO configured redaction action", async () => {
    const src = new InMemoryAuditSource([draft({ input_summary: "leaked prompt" })]);
    const out = await exportEvidence(src, {
      regime: "eu-ai-act",
      agentId: "agent-7",
      ...WINDOW,
      // messages NOT configured → incomplete.
      redactionConfig: { contentFields: {} },
      secret: SECRET,
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.offendingFields).toContain("gen_ai.input.messages");
    expect(out.reason).toMatch(/redaction incomplete/);
  });
});

describe("exportEvidence — colorado overlay", () => {
  it("produces a colorado package whose coverage is always partial", async () => {
    const src = new InMemoryAuditSource([draft()]);
    const out = await exportEvidence(src, {
      regime: "colorado",
      agentId: "agent-7",
      ...WINDOW,
      redactionConfig: NO_CONTENT_DROP,
      secret: SECRET,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.package.regime).toBe("colorado");
    expect(out.coverage.partial).toBe(true);
  });
});
