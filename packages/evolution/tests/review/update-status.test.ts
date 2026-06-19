/**
 * `updateManifestStatus` — the L0 status-only review transition (plan 03-03, Task 1).
 *
 * Asserts the L0 boundary as a tested security property:
 *   - accept/reject set the status and re-validate against ChangeManifestSchema;
 *   - the input manifest is NEVER mutated (a new object is returned);
 *   - a supplied `note` lands in `review_note`;
 *   - passing `"applied"` THROWS — it is reserved for Phase 4 (T-03-10), so
 *     `"applied"` is UNREACHABLE via the review path in Phase 3.
 */

import { describe, it, expect } from "vitest";
import { ChangeManifestSchema, updateManifestStatus } from "../../src/index.js";
import type { ChangeManifest } from "../../src/index.js";

function proposed(): ChangeManifest {
  return {
    id: "cm-abc123def456",
    schema_version: "1",
    target: "my-agent@v37",
    change: "add-gate",
    detail: "Insert a verify.result step after each state-mutating tool.call.",
    rationale: "Cites finding F1.",
    evidence_ref: "lucid://findings/F1",
    expected_effect: { feedback: 0.3 },
    status: "proposed",
    estimator: "rule-based",
    generated_at: "2026-06-18T00:00:00.000Z",
  };
}

describe("updateManifestStatus — L0 status-only transition", () => {
  it("sets status 'accepted' and re-validates against the schema", () => {
    const next = updateManifestStatus(proposed(), "accepted");
    expect(next.status).toBe("accepted");
    expect(() => ChangeManifestSchema.parse(next)).not.toThrow();
  });

  it("sets status 'rejected' with a review note", () => {
    const next = updateManifestStatus(proposed(), "rejected", "not the right fix");
    expect(next.status).toBe("rejected");
    expect(next.review_note).toBe("not the right fix");
    expect(() => ChangeManifestSchema.parse(next)).not.toThrow();
  });

  it("returns a NEW object — the input manifest is never mutated", () => {
    const input = proposed();
    const next = updateManifestStatus(input, "accepted", "looks good");
    expect(input.status).toBe("proposed"); // input untouched
    expect(input.review_note).toBeUndefined();
    expect(next).not.toBe(input);
  });

  it("omits review_note when no note is supplied", () => {
    const next = updateManifestStatus(proposed(), "accepted");
    expect(next.review_note).toBeUndefined();
  });

  it("THROWS on 'applied' — reserved for Phase 4, unreachable at L0 (T-03-10)", () => {
    expect(() =>
      // @ts-expect-error — "applied" is intentionally not a ReviewStatus.
      updateManifestStatus(proposed(), "applied"),
    ).toThrow(/applied/i);
  });

  it("can re-affirm 'proposed' (no-op transition)", () => {
    const next = updateManifestStatus(proposed(), "proposed");
    expect(next.status).toBe("proposed");
  });
});
