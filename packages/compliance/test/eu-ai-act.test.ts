import { describe, expect, it } from "vitest";

import { mapEuAiAct } from "../src/regimes/eu-ai-act.js";
import { chainRecords } from "../src/audit-trail.js";
import { EuAiActRecordSchema } from "../src/schema.js";
import type { AuditDraftRecord } from "../src/index.js";

/**
 * EU AI Act Article 12 mapper — the primary regime (RESEARCH §HSC→EU mapping).
 *
 * Pins: a FULL record set maps to schema-valid Article 12 records (usage period,
 * agent id, harness/model version, change_manifest_ids, human oversight) and
 * reports full coverage; a Phase-3-5-ABSENT set produces VALID records with
 * EMPTY change_manifest_ids and NO oversight, marks those obligations PARTIAL
 * with an explicit reason, and does NOT fabricate traceability.
 */

const SECRET = "k";

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

describe("mapEuAiAct — full record set", () => {
  const full = [
    draft({ record_id: "f1", change_manifest_ids: ["cm-1"], human_oversight_action: "reviewer approved" }),
    draft({ record_id: "f2", change_manifest_ids: ["cm-2", "cm-3"] }),
  ];

  it("produces records that parse against EuAiActRecordSchema once hash-chained", () => {
    const { records } = mapEuAiAct(full);
    const chained = chainRecords(records, SECRET);
    for (const r of chained) {
      expect(EuAiActRecordSchema.safeParse(r).success).toBe(true);
    }
  });

  it("preserves change_manifest_ids and human_oversight_action", () => {
    const { records } = mapEuAiAct(full);
    expect(records[0].change_manifest_ids).toEqual(["cm-1"]);
    expect(records[0].human_oversight_action).toBe("reviewer approved");
    expect(records[1].change_manifest_ids).toEqual(["cm-2", "cm-3"]);
  });

  it("reports FULL coverage for change traceability + human oversight when present", () => {
    const { coverage } = mapEuAiAct(full);
    expect(coverage.partial).toBe(false);
    const change = coverage.obligations.find((o) => o.obligation.includes("change traceability"));
    const oversight = coverage.obligations.find((o) => o.obligation.includes("human oversight"));
    expect(change?.status).toBe("full");
    expect(oversight?.status).toBe("full");
  });
});

describe("mapEuAiAct — Phase 3-5 ABSENT", () => {
  const basics = [draft({ record_id: "b1", change_manifest_ids: [] })];

  it("produces valid records with empty change_manifest_ids and no fabricated oversight", () => {
    const { records } = mapEuAiAct(basics);
    expect(records[0].change_manifest_ids).toEqual([]);
    expect(records[0].human_oversight_action).toBeUndefined();
    const chained = chainRecords(records, SECRET);
    expect(EuAiActRecordSchema.safeParse(chained[0]).success).toBe(true);
  });

  it("marks change traceability + human oversight PARTIAL with a Phase 3-5 reason", () => {
    const { coverage } = mapEuAiAct(basics);
    expect(coverage.partial).toBe(true);
    const change = coverage.obligations.find((o) => o.obligation.includes("change traceability"));
    const oversight = coverage.obligations.find((o) => o.obligation.includes("human oversight"));
    expect(change?.status).toBe("partial");
    expect(change?.note).toMatch(/Phase 3.5/);
    expect(oversight?.status).toBe("partial");
  });

  it("still reports FULL coverage for the always-present Article 12 basics", () => {
    const { coverage } = mapEuAiAct(basics);
    const period = coverage.obligations.find((o) => o.obligation.includes("usage period"));
    const agent = coverage.obligations.find((o) => o.obligation.includes("agent identification"));
    const version = coverage.obligations.find((o) => o.obligation.includes("system & model version"));
    expect(period?.status).toBe("full");
    expect(agent?.status).toBe("full");
    expect(version?.status).toBe("full");
  });
});
