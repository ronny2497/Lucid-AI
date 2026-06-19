/**
 * `buildEvolveApplyRecord` / `emitEvolveApply` — the low-cardinality, tamper-evident
 * `evolve.apply` HSC audit event (Plan 04-03, Task 3).
 *
 * Asserts:
 *   - `event.name` is the `EVENT_TYPES` `"evolve.apply"` member (a const, not a
 *     literal) and the manifest id is NOT in `event.name` — LOW CARDINALITY (T-04-13);
 *   - the body carries who/what/predicted/observed/rollback fields;
 *   - `content_hash` is a 64-char hex SHA-256 and recomputing it over the body
 *     (minus the hash) matches — tamper-evidence (T-04-12);
 *   - the body carries only paths + derived scores, NO raw harness content (T-04-04);
 *   - the same event serves keep AND rollback (rollback_status distinguishes them);
 *   - `emitEvolveApply` hands the built record to the injected sink.
 *
 * Imports the module directly (not the barrel) — `src/index.ts` is owned by 04-04.
 */

import { describe, it, expect } from "vitest";
import { EVENT_TYPES } from "@lucid/hsc-schema";

import {
  buildEvolveApplyRecord,
  emitEvolveApply,
  recomputeApplyContentHash,
  EVOLVE_APPLY_EVENT,
  type EvolveApplyInput,
  type EvolveApplyRecord,
} from "../../src/hsc-emit-apply.js";

function keepInput(over: Partial<EvolveApplyInput> = {}): EvolveApplyInput {
  return {
    approvedBy: "auto-approver:guard",
    autonomyLevel: "L1",
    manifestId: "cm-trim-22",
    changeKind: "trim-context",
    agentId: "my-agent",
    fromVersion: "v37",
    toVersion: "v38",
    affectedFiles: ["context-policy/budget.yaml"],
    expectedEffect: { context: 0.1 },
    guardMetric: "context",
    baselineScore: 0.72,
    candidateScore: 0.85,
    guardDelta: 0.13,
    verdict: "KEEP",
    rollbackStatus: "none",
    generatedAt: "2026-06-18T12:00:00.000Z",
    ...over,
  };
}

describe("evolve.apply HSC audit event", () => {
  it("uses the EVENT_TYPES 'evolve.apply' member as event.name (not a literal)", () => {
    const record = buildEvolveApplyRecord(keepInput());
    expect(record.event.name).toBe("evolve.apply");
    expect(EVOLVE_APPLY_EVENT).toBe(EVENT_TYPES[EVENT_TYPES.indexOf("evolve.apply")]);
    expect(record.event.name).toBe(EVOLVE_APPLY_EVENT);
    expect(EVENT_TYPES).toContain(record.event.name);
  });

  it("keeps event.name LOW CARDINALITY — the manifest id lives in attributes/body (T-04-13)", () => {
    const input = keepInput();
    const record = buildEvolveApplyRecord(input);
    expect(record.event.name).not.toContain(input.manifestId);
    expect(record.event.name).toBe("evolve.apply"); // exactly the constant
    expect(record.attributes["harness.apply.manifest_id"]).toBe(input.manifestId);
    expect(record.body["harness.apply.manifest_id"]).toBe(input.manifestId);
  });

  it("carries who/what/predicted/observed/rollback fields in the body", () => {
    const input = keepInput();
    const b = buildEvolveApplyRecord(input).body;
    // WHO
    expect(b["harness.apply.approved_by"]).toBe(input.approvedBy);
    expect(b["harness.apply.autonomy_level"]).toBe("L1");
    // WHAT
    expect(b["harness.apply.change_kind"]).toBe(input.changeKind);
    expect(b["harness.apply.agent_id"]).toBe(input.agentId);
    expect(b["harness.apply.from_version"]).toBe(input.fromVersion);
    expect(b["harness.apply.to_version"]).toBe(input.toVersion);
    expect(b["harness.apply.affected_files"]).toEqual(input.affectedFiles);
    // PREDICTED
    expect(b["harness.apply.expected_effect"]).toBe(JSON.stringify(input.expectedEffect));
    // OBSERVED
    expect(b["harness.apply.guard_metric"]).toBe(input.guardMetric);
    expect(b["harness.apply.baseline_score"]).toBe(input.baselineScore);
    expect(b["harness.apply.candidate_score"]).toBe(input.candidateScore);
    expect(b["harness.apply.guard_delta"]).toBe(input.guardDelta);
    expect(b["harness.apply.verdict"]).toBe("KEEP");
    // ROLLBACK
    expect(b["harness.apply.rollback_status"]).toBe("none");
  });

  it("includes a recomputable SHA-256 content_hash over the body (tamper-evidence, T-04-12)", () => {
    const record = buildEvolveApplyRecord(keepInput());
    const hash = record.body["harness.apply.content_hash"];
    expect(hash).toMatch(/^[0-9a-f]{64}$/); // 64-char hex SHA-256
    // Recomputing over the body (minus the hash field) matches.
    expect(recomputeApplyContentHash(record)).toBe(hash);
    // A tampered body fails the recompute check.
    const tampered: EvolveApplyRecord = {
      ...record,
      body: { ...record.body, "harness.apply.candidate_score": 0.99 },
    };
    expect(recomputeApplyContentHash(tampered)).not.toBe(hash);
  });

  it("carries no raw harness content — only paths + derived scores (T-04-04)", () => {
    const record = buildEvolveApplyRecord(keepInput());
    const serialized = JSON.stringify(record);
    expect(serialized).not.toMatch(/gen_ai\.input/);
    expect(serialized).not.toMatch(/raw_content|file_content|fileContent/);
    // affected_files are paths, not bodies.
    expect(record.body["harness.apply.affected_files"]).toEqual(["context-policy/budget.yaml"]);
  });

  it("serves both keep and rollback — rollback_status distinguishes them (no evolve.rollback type)", () => {
    const keep = buildEvolveApplyRecord(keepInput({ verdict: "KEEP", rollbackStatus: "none" }));
    const auto = buildEvolveApplyRecord(
      keepInput({ verdict: "REVERT", rollbackStatus: "auto-rollback" }),
    );
    const manual = buildEvolveApplyRecord(
      keepInput({ verdict: "REVERT", rollbackStatus: "manual-rollback" }),
    );
    // Same low-cardinality event.name for all three.
    expect(keep.event.name).toBe("evolve.apply");
    expect(auto.event.name).toBe("evolve.apply");
    expect(manual.event.name).toBe("evolve.apply");
    expect(EVENT_TYPES).not.toContain("evolve.rollback");
    // Distinguished only by rollback_status + verdict.
    expect(keep.body["harness.apply.rollback_status"]).toBe("none");
    expect(auto.body["harness.apply.rollback_status"]).toBe("auto-rollback");
    expect(manual.body["harness.apply.rollback_status"]).toBe("manual-rollback");
  });

  it("emitEvolveApply hands the built record to the injected sink", () => {
    const input = keepInput();
    const captured: EvolveApplyRecord[] = [];
    emitEvolveApply(input, (r) => captured.push(r));
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual(buildEvolveApplyRecord(input));
  });

  it("requires a verdict input (built only after the guard runs)", () => {
    // The verdict is a required field of EvolveApplyInput — a record cannot be built
    // without it. This is a compile-time guarantee; assert it is carried through.
    const record = buildEvolveApplyRecord(keepInput({ verdict: "INSUFFICIENT_DATA" }));
    expect(record.body["harness.apply.verdict"]).toBe("INSUFFICIENT_DATA");
  });
});
