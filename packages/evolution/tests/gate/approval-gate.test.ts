/**
 * Plan 04-02 Task 3 — checkApprovalPolicy, the deterministic approval gate.
 *
 * Asserts: PASS only at L1+/allow-listed/approver; L0 fails; a non-allow-listed kind
 * fails; missing approver under require_human_approval fails; require_human_approval
 * false passes with "auto"; and the function is deterministic (two identical calls
 * return equal results).
 */

import { describe, it, expect } from "vitest";

import { checkApprovalPolicy } from "../../src/gate.js";
import { AutonomyConfigSchema, type AutonomyConfig } from "../../src/apply-config.js";
import { ChangeManifestV2Schema, type ChangeManifestV2 } from "../../src/schema-v2.js";

function config(overrides: Record<string, unknown> = {}): AutonomyConfig {
  return AutonomyConfigSchema.parse(overrides);
}

function manifest(change: ChangeManifestV2["change"] = "add-gate"): ChangeManifestV2 {
  const detailByKind: Record<string, Record<string, unknown>> = {
    "add-gate": { kind: "add-gate", insertAfter: "x", gate: "g", condition: "c", targetFiles: ["config/gates.yaml"] },
    "trim-context": { kind: "trim-context", removeSource: "s", targetFiles: ["context-policy/budget.yaml"] },
    "edit-skill": { kind: "edit-skill", skillId: "s", instruction: "i", targetFiles: ["skills/search.ts"] },
    "prompt-patch": { kind: "prompt-patch", promptId: "p", instruction: "i", targetFiles: ["prompts/system.txt"] },
    "delete-layer": { kind: "delete-layer", layerId: "l", targetFiles: ["skills/search.ts"] },
  };
  return ChangeManifestV2Schema.parse({
    id: "cm-1",
    schema_version: "2",
    target: "my-agent@v37",
    agentId: "my-agent",
    change,
    detail: detailByKind[change],
    rationale: "r",
    evidence_ref: "lucid://findings/F1",
    expected_effect: { feedback: 0.1 },
    status: "accepted",
    estimator: "rule-based",
    generated_at: "2026-06-18T12:00:00.000Z",
  });
}

describe("checkApprovalPolicy", () => {
  it("PASSES at L1 with an allow-listed kind and an approver", () => {
    const result = checkApprovalPolicy(config({ autonomy: "L1" }), manifest("add-gate"), {
      approvedBy: "alice",
    });
    expect(result).toEqual({ pass: true, approvedBy: "alice" });
  });

  it("PASSES at L2 as well (L1+)", () => {
    const result = checkApprovalPolicy(
      config({ autonomy: "L2", trainer: null }),
      manifest("add-gate"),
      { approvedBy: "alice" },
    );
    expect(result.pass).toBe(true);
  });

  it("REJECTS at L0 (auto-apply not permitted)", () => {
    const result = checkApprovalPolicy(config({ autonomy: "L0" }), manifest("add-gate"), {
      approvedBy: "alice",
    });
    expect(result.pass).toBe(false);
    if (!result.pass) expect(result.reason).toMatch(/L0/);
  });

  it("REJECTS a change kind absent from allow_change_types", () => {
    const result = checkApprovalPolicy(
      config({ autonomy: "L1", allow_change_types: ["trim-context"] }),
      manifest("add-gate"),
      { approvedBy: "alice" },
    );
    expect(result.pass).toBe(false);
    if (!result.pass) expect(result.reason).toMatch(/add-gate/);
  });

  it("REJECTS when require_human_approval is true and no approver is supplied", () => {
    const result = checkApprovalPolicy(
      config({ autonomy: "L1", require_human_approval: true }),
      manifest("add-gate"),
      {},
    );
    expect(result.pass).toBe(false);
    if (!result.pass) expect(result.reason).toMatch(/approval/i);
  });

  it("REJECTS a whitespace-only approver under require_human_approval", () => {
    const result = checkApprovalPolicy(
      config({ autonomy: "L1", require_human_approval: true }),
      manifest("add-gate"),
      { approvedBy: "   " },
    );
    expect(result.pass).toBe(false);
  });

  it("PASSES with approvedBy 'auto' when require_human_approval is false", () => {
    const result = checkApprovalPolicy(
      config({ autonomy: "L1", require_human_approval: false }),
      manifest("add-gate"),
      {},
    );
    expect(result).toEqual({ pass: true, approvedBy: "auto" });
  });

  it("is deterministic — two identical calls return equal results", () => {
    const cfg = config({ autonomy: "L1" });
    const m = manifest("add-gate");
    const a = checkApprovalPolicy(cfg, m, { approvedBy: "alice" });
    const b = checkApprovalPolicy(cfg, m, { approvedBy: "alice" });
    expect(a).toEqual(b);
  });
});
