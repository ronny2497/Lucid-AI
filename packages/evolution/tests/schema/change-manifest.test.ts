/**
 * Schema contract test for `ChangeManifestSchema` (Wave 0, plan 03-01).
 *
 * This is GREEN now — it tests the frozen contract authored in src/schema.ts.
 * It also asserts the two golden fixtures conform to their respective schemas
 * (the diagnostic input against @lucid/diagnostic's DiagnosticResultSchema, and
 * the expected manifest against ChangeManifestSchema) so the fixtures cannot
 * drift from the contracts they are supposed to encode.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DiagnosticResultSchema } from "@lucid/diagnostic";
import { NO_VERIFY_AFTER_MUTATION_ID } from "@lucid/diagnostic";
import { PRINCIPLES } from "@lucid/hsc-schema";
import {
  ChangeManifestSchema,
  ExpectedEffectSchema,
  ChangeSetKindSchema,
} from "../../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "fixtures");
const readFixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(fixtures, name), "utf8"));

/** A minimal valid manifest used as the parse-baseline; mutate per case. */
function validManifest(): Record<string, unknown> {
  return {
    id: "cm-test001",
    schema_version: "1",
    target: "my-agent@v37",
    change: "add-gate",
    detail:
      "Insert a verify.result step after each tool.call that mutates state; affected tools: db.write, api.post.",
    rationale: "Cites finding F1: state-mutating calls lacked verification.",
    evidence_ref: "lucid://findings/F1",
    expected_effect: { feedback: 0.4 },
    status: "proposed",
    estimator: "rule-based",
    generated_at: "2026-06-18T00:00:00.000Z",
  };
}

describe("ChangeManifestSchema — the load-bearing Phase 3 contract", () => {
  it("parses a fully-valid manifest", () => {
    expect(() => ChangeManifestSchema.parse(validManifest())).not.toThrow();
  });

  it("REJECTS a manifest with an empty expected_effect (unfalsifiable — T-03-02)", () => {
    const m = { ...validManifest(), expected_effect: {} };
    expect(() => ChangeManifestSchema.parse(m)).toThrow();
  });

  it("REJECTS a manifest with an all-null expected_effect", () => {
    const m = {
      ...validManifest(),
      expected_effect: { feedback: null, context: null },
    };
    expect(() => ChangeManifestSchema.parse(m)).toThrow();
  });

  it("REJECTS a manifest missing expected_effect entirely", () => {
    const m = validManifest();
    delete m.expected_effect;
    expect(() => ChangeManifestSchema.parse(m)).toThrow();
  });

  it("REJECTS a change kind outside the closed five-kind taxonomy", () => {
    const m = { ...validManifest(), change: "rewrite-everything" };
    expect(() => ChangeManifestSchema.parse(m)).toThrow();
  });

  it("accepts each of the five canonical change kinds", () => {
    for (const kind of [
      "add-gate",
      "trim-context",
      "edit-skill",
      "prompt-patch",
      "delete-layer",
    ]) {
      expect(() => ChangeSetKindSchema.parse(kind)).not.toThrow();
    }
  });

  it("REJECTS an expected_effect key that is not a canonical principle name", () => {
    const m = { ...validManifest(), expected_effect: { latency: 0.4 } };
    expect(() => ChangeManifestSchema.parse(m)).toThrow();
  });

  it("constrains expected_effect keys to exactly the PRINCIPLES tuple", () => {
    // Every canonical principle is an accepted (optional) key.
    for (const principle of PRINCIPLES) {
      expect(() =>
        ExpectedEffectSchema.parse({ [principle]: 0.1 }),
      ).not.toThrow();
    }
  });

  it("REJECTS a schema_version other than the literal \"1\"", () => {
    const m = { ...validManifest(), schema_version: "2" };
    expect(() => ChangeManifestSchema.parse(m)).toThrow();
  });

  it("enforces the closed status enum", () => {
    expect(() =>
      ChangeManifestSchema.parse({ ...validManifest(), status: "draft" }),
    ).toThrow();
    for (const status of ["proposed", "accepted", "rejected", "applied"]) {
      expect(() =>
        ChangeManifestSchema.parse({ ...validManifest(), status }),
      ).not.toThrow();
    }
  });

  it("enforces the estimator tag enum", () => {
    expect(() =>
      ChangeManifestSchema.parse({ ...validManifest(), estimator: "vibes" }),
    ).toThrow();
  });
});

describe("golden fixtures conform to their contracts", () => {
  it("golden-diagnostic-empty-feedback.json is a valid DiagnosticResult with the flagship finding", () => {
    const diagnostic = readFixture("golden-diagnostic-empty-feedback.json");
    const parsed = DiagnosticResultSchema.parse(diagnostic);
    expect(parsed.findings[0]?.detectorId).toBe(NO_VERIFY_AFTER_MUTATION_ID);
    expect(NO_VERIFY_AFTER_MUTATION_ID).toBe("feedback.no-verify-after-mutation");
    // The feedback PrincipleScore must carry non-null score + counts so the
    // 03-02 estimator can scale the heuristic delta by the hit fraction.
    const feedbackScore = parsed.principles.find((p) => p.principle === "feedback");
    expect(feedbackScore).toBeDefined();
    expect(feedbackScore?.score).not.toBeNull();
    expect(feedbackScore?.hitCount).toBeGreaterThan(0);
    expect(feedbackScore?.relevantEventCount).toBeGreaterThan(0);
  });

  it("expected-manifest-add-gate.json is a valid ChangeManifest with a positive feedback prediction", () => {
    const manifest = readFixture("expected-manifest-add-gate.json");
    const parsed = ChangeManifestSchema.parse(manifest);
    expect(parsed.change).toBe("add-gate");
    expect(parsed.status).toBe("proposed");
    expect(parsed.estimator).toBe("rule-based");
    expect(parsed.expected_effect.feedback).toBeTypeOf("number");
    expect(parsed.expected_effect.feedback as number).toBeGreaterThan(0);
  });

  it("the two fixtures agree on the target agent and the W3 expected_effect pin", () => {
    const diagnostic = DiagnosticResultSchema.parse(
      readFixture("golden-diagnostic-empty-feedback.json"),
    );
    const manifest = ChangeManifestSchema.parse(
      readFixture("expected-manifest-add-gate.json"),
    );
    // target encodes the pre-apply baseline (agentId@harness_version).
    expect(manifest.target).toBe(
      `${diagnostic.agentId}@${diagnostic.harness_version}`,
    );

    // ── W3 CROSS-WAVE PIN ──────────────────────────────────────────────────
    // 03-02's rule-based estimator computes:
    //   expected_effect.feedback = round2( BASE_ADD_GATE_FEEDBACK * hitFraction )
    //   where BASE_ADD_GATE_FEEDBACK = 0.40 (RESEARCH Pattern 3 HEURISTIC_DELTAS)
    //   and   hitFraction = feedbackScore.hitCount / max(relevantEventCount, 1)
    // The fixture below pins hitCount=18, relevantEventCount=24 → hitFraction=0.75
    //   → 0.40 * 0.75 = 0.30 (rounded to 2dp).
    // 03-02 MUST reproduce 0.30 from these counts — no cross-wave deep-equals drift.
    const feedbackScore = diagnostic.principles.find(
      (p) => p.principle === "feedback",
    )!;
    const BASE_ADD_GATE_FEEDBACK = 0.4;
    const hitFraction =
      feedbackScore.hitCount / Math.max(feedbackScore.relevantEventCount, 1);
    const recomputed = Number((BASE_ADD_GATE_FEEDBACK * hitFraction).toFixed(2));
    expect(recomputed).toBe(0.3);
    expect(manifest.expected_effect.feedback).toBe(recomputed);
  });
});
